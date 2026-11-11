import { toArray } from "./collections.mjs";
import { matchesContentKey } from "./content-keys.mjs";
import { isAbilityAutomationEnabled } from "./automation.mjs";
import { applyHealingBarrier } from "./barrier.mjs";
import { FFXIVItem } from "../items/item.mjs";
import {
  applyStatusEffectChange,
  getActorDrainValue,
  hasStatus,
  recoverActorHealth,
  recoverActorMana,
} from "./status-effects.mjs";
import { getActiveEffectChangeType } from "./effect-utils.mjs";

async function applyDamageToActor(actor, damage, options = {}) {
  const incomingDamage = Math.max(Number.parseInt(damage, 10) || 0, 0);
  const barrier = Math.max(Number(actor.system.barrier?.value) || 0, 0);
  const healthDamage = Math.max(incomingDamage - barrier, 0);
  const nextHealth = Math.max(
    (Number(actor.system.health?.value) || 0) - healthDamage,
    0,
  );
  const updates = {
    "system.health.value": nextHealth,
  };

  if (barrier > 0) {
    updates["system.barrier.value"] = Math.max(barrier - incomingDamage, 0);
  }

  const result = await actor.update(updates, { ffxivSkipKnockedOutSync: true });
  if (healthDamage > 0 && nextHealth <= 0 && !hasStatus(actor, "knocked_out")) {
    await applyStatusEffectChange(actor, "knocked_out", true);
  }
  showFloatingCombatText(actor, incomingDamage, "damage", options);
  return result;
}

async function applyHealingToActor(actor, amount, options = {}) {
  const healing = await getHealingWithEffects(actor, amount, options);
  return applyResolvedHealingToActor(actor, healing, options);
}

export async function applyResolvedHealingToActor(actor, healing, options = {}) {
  const result = await recoverActorHealth(actor, healing.resolvedHealing);
  if (
    isAbilityAutomationEnabled() &&
    options.sourceItem?.getFlag("ffxiv", "barrier.onHealing") === true
  ) {
    // Use the resolved healing roll, including when the target is at full HP.
    const amount = Math.max(
      Math.floor(Number(healing.resolvedHealing) || 0),
      0,
    );
    await applyHealingBarrier(actor, amount, {
      sourceActor: options.sourceActor,
      sourceItem: options.sourceItem,
    });
  }
  if (result.healing > 0) {
    showFloatingCombatText(actor, result.healing, "healing", options);
  }
  return { ...result, ...healing };
}

function showFloatingCombatText(actor, amount, kind, options = {}) {
  const value = Math.max(Number.parseInt(amount, 10) || 0, 0);
  if (value <= 0) return;
  if (!game.settings.get("ffxiv", "floatingDamageNumbers")) return;
  if (typeof canvas?.interface?.createScrollingText !== "function") return;

  const token = options.token ?? getActorCanvasToken(actor);
  if (!token?.center) return;

  const isHealing = kind === "healing";
  const direction = CONST.TEXT_ANCHOR_POINTS?.TOP ?? 1;
  const anchor = CONST.TEXT_ANCHOR_POINTS?.CENTER ?? 0;
  canvas.interface.createScrollingText(token.center, `${isHealing ? "+" : "-"}${value}`, {
    anchor,
    direction,
    distance: (canvas.grid?.size ?? 100) * 1.5,
    fontSize: 34,
    fill: isHealing ? 0x62d26f : 0xff5c5c,
    stroke: 0x000000,
    strokeThickness: 5,
  });
}

export function getActorCanvasToken(actor) {
  if (!actor) return null;
  const actorUuid = String(actor.uuid ?? "").trim();
  const tokens = canvas?.tokens?.placeables ?? [];
  const exactTokens = tokens.filter((token) => {
    const tokenActor = token.actor;
    return (
      tokenActor === actor ||
      (actorUuid && tokenActor?.uuid === actorUuid)
    );
  });
  if (exactTokens.length) {
    return exactTokens.find((token) => token.isOwner) ?? exactTokens[0];
  }
  if (actorUuid && !actorUuid.startsWith("Actor.")) return null;

  const fallbackTokens = tokens.filter((token) => {
    const tokenActor = token.actor;
    return (
      tokenActor?.id === actor.id ||
      token.document?.actorId === actor.id
    );
  });
  return fallbackTokens.find((token) => token.isOwner) ?? fallbackTokens[0] ?? null;
}

export async function applyDamageToActorWithEffects(
  targetActor,
  rawDamage,
  { sourceActor = null, sourceItem = null, targetToken = null } = {},
) {
  const damage = await getDamageWithEffects(targetActor, rawDamage, {
    sourceActor,
    sourceItem,
  });
  if (!damage) return null;
  await applyResolvedDamageToActor(targetActor, damage, {
    sourceActor,
    targetToken,
  });
  return damage;
}

export async function applyResolvedDamageToActor(
  targetActor,
  damage,
  { sourceActor = null, targetToken = null } = {},
) {
  if (!targetActor || !damage) return;
  if (damage.resolvedDamage > 0) {
    await applyDamageToActor(targetActor, damage.resolvedDamage, {
      token: targetToken,
    });
    if (hasStatus(targetActor, "sleep")) {
      await applyStatusEffectChange(targetActor, "sleep", false);
    }
    await applyDrainRecovery(sourceActor);
  }
  await consumeDamageApplicationEffects(
    targetActor,
    damage.consumedEffectIds,
  );
}

async function getDamageWithEffects(
  targetActor,
  rawDamage,
  { sourceActor = null, sourceItem = null } = {},
) {
  if (!targetActor) return null;
  const components = Array.isArray(rawDamage) ? rawDamage : [rawDamage];
  const baseDamage = Math.max(components.reduce((total, amount) =>
    total + (Number.parseInt(amount, 10) || 0), 0), 0);
  if (baseDamage <= 0) {
    return { actor: targetActor, baseDamage, resolvedDamage: 0 };
  }
  if (hasStatus(targetActor, "transcendent")) {
    return { actor: targetActor, baseDamage, resolvedDamage: 0 };
  }
  const outgoing = sourceActor
    ? getActorDamageEffectModifiers(sourceActor, "outgoing", { sourceItem })
    : { flat: 0, mult: 1 };
  const incoming = getActorDamageEffectModifiers(targetActor, "incoming", {
    sourceItem,
  });
  const self = sourceActor?.id === targetActor.id
    ? getActorDamageEffectModifiers(targetActor, "self", { sourceItem })
    : { flat: 0, mult: 1 };

  const totalFlat = outgoing.flat + incoming.flat + self.flat;
  const totalMult = outgoing.mult * incoming.mult * self.mult;
  const modifiedDamage = Math.max(
    Math.floor((baseDamage + totalFlat) * totalMult),
    0,
  );
  const application = await applyDamageApplicationModifiers(
    targetActor,
    modifiedDamage,
    { sourceActor, sourceItem },
  );

  return {
    actor: targetActor,
    baseDamage,
    modifiedDamage,
    resolvedDamage: application.resolvedDamage,
    preventedDamage: Math.max(modifiedDamage - application.resolvedDamage, 0),
    consumedEffectIds: application.consumedEffectIds,
  };
}

async function applyDamageApplicationModifiers(
  targetActor,
  rawDamage,
  { sourceActor = null, sourceItem = null } = {},
) {
  let resolvedDamage = Math.max(Number.parseInt(rawDamage, 10) || 0, 0);
  const consumedEffectIds = [];
  for (const effect of targetActor?.allApplicableEffects?.() ?? []) {
    if (!effect || effect.disabled) continue;

    const data = foundry.utils.getProperty(effect, "flags.ffxiv.damage.application");
    const entries = Array.isArray(data) ? data : data ? [data] : [];
    for (const entry of entries) {
      if (!damageApplicationEntryApplies(entry, { sourceActor, sourceItem }))
        continue;

      const amount = await resolveDamageApplicationAmount(entry, {
        targetActor,
        sourceActor,
        sourceItem,
        currentDamage: resolvedDamage,
      });
      if (!Number.isFinite(amount)) continue;

      const operation = String(entry.operation ?? entry.mode ?? "subtract")
        .trim()
        .toLowerCase();
      if (["override", "replace", "set"].includes(operation)) {
        resolvedDamage = amount;
      } else if (operation === "multiply") {
        resolvedDamage *= amount;
      } else if (["add", "grant"].includes(operation)) {
        resolvedDamage += amount;
      } else {
        resolvedDamage -= amount;
      }

      if ((entry.consume === true || entry.remove === true) && effect.id) {
        consumedEffectIds.push(effect.id);
      }
    }
  }

  return {
    resolvedDamage: Math.max(Math.floor(resolvedDamage), 0),
    consumedEffectIds: Array.from(new Set(consumedEffectIds)),
  };
}

function damageApplicationEntryApplies(entry, { sourceActor = null, sourceItem = null } = {}) {
  if (!entry || typeof entry !== "object") return false;

  const sourceNames = toArray(
    entry.sourceNames ?? entry.sourceName ?? entry.sourceAbilities ?? entry.sourceAbility,
  ).map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  if (
    sourceNames.length &&
    !sourceNames.some((key) => matchesContentKey(sourceItem, key))
  )
    return false;

  const sourceActorNames = toArray(
    entry.sourceActorNames ?? entry.sourceActorName ?? entry.sourceActors ?? entry.sourceActor,
  ).map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  if (
    sourceActorNames.length &&
    !sourceActorNames.some((key) => matchesContentKey(sourceActor, key))
  )
    return false;

  const tags = toArray(entry.sourceTags ?? entry.tags ?? entry.tag).filter(Boolean);
  if (tags.length) {
    const itemTags = Array.isArray(sourceItem?.system?.tags)
      ? sourceItem.system.tags
      : [];
    if (
      !tags.some((tag) =>
        itemTags.some((itemTag) => FFXIVItem._tagMatches(itemTag, [tag])),
      )
    )
      return false;
  }

  return true;
}

async function resolveDamageApplicationAmount(
  entry,
  { targetActor = null, sourceActor = null, sourceItem = null, currentDamage = 0 } = {},
) {
  if (entry.percent !== undefined) {
    const percent = Number(entry.percent);
    if (Number.isFinite(percent)) return Math.ceil(currentDamage * percent / 100);
  }
  if (entry.fraction !== undefined) {
    const fraction = Number(entry.fraction);
    if (Number.isFinite(fraction)) return Math.ceil(currentDamage * fraction);
  }

  const formula = String(entry.formula ?? "").trim();
  if (formula) {
    const rollData =
      sourceItem?.getRollData?.() ??
      sourceActor?.getRollData?.() ??
      targetActor?.getRollData?.() ??
      {};
    const roll = new Roll(formula, {
      ...rollData,
      damage: currentDamage,
    });
    await roll.evaluate();
    return Number(roll.total ?? roll.result);
  }

  return Number(entry.amount ?? entry.flat ?? entry.value ?? 0);
}

async function consumeDamageApplicationEffects(actor, effectIds) {
  const ids = Array.from(new Set(effectIds ?? []))
    .map((id) => String(id ?? "").trim())
    .filter((id) => actor?.effects?.has(id));
  if (!ids.length) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", ids, {
    render: false,
    ffxivSuppressRemovalText: true,
  });
}

export async function getHealingWithEffects(
  targetActor,
  rawHealing,
  { sourceActor = null, sourceItem = null } = {},
) {
  const baseHealing = Math.max(Number.parseInt(rawHealing, 10) || 0, 0);
  if (!targetActor || baseHealing <= 0) {
    return { actor: targetActor, baseHealing, resolvedHealing: 0 };
  }

  let resolvedHealing = baseHealing;
  const entries = getItemHealingApplicationEntries(sourceItem);
  for (const entry of entries) {
    if (!healingApplicationEntryApplies(entry, targetActor, sourceActor)) continue;

    const amount = await resolveHealingApplicationAmount(entry, sourceItem, sourceActor);
    if (!Number.isFinite(amount)) continue;

    const operation = String(entry.operation ?? entry.mode ?? "add")
      .trim()
      .toLowerCase();
    if (["override", "replace", "set"].includes(operation)) {
      resolvedHealing = amount;
    } else if (operation === "multiply") {
      resolvedHealing *= amount;
    } else if (["subtract", "consume"].includes(operation)) {
      resolvedHealing -= amount;
    } else {
      resolvedHealing += amount;
    }
  }

  return {
    actor: targetActor,
    baseHealing,
    resolvedHealing: Math.max(Math.floor(resolvedHealing), 0),
  };
}

function getItemHealingApplicationEntries(item) {
  const data = foundry.utils.getProperty(item, "flags.ffxiv.healing.application");
  return Array.isArray(data) ? data : data ? [data] : [];
}

function healingApplicationEntryApplies(entry, targetActor, sourceActor = null) {
  if (!entry || typeof entry !== "object" || !targetActor) return false;

  const condition = entry.when ?? entry.condition ?? entry.conditions ?? {};
  if (!healingHealthConditionApplies(condition.targetHp ?? condition.health, targetActor))
    return false;
  if (!healingHealthConditionApplies(entry.targetHp ?? entry.health, targetActor))
    return false;

  const sourceNames = toArray(
    entry.sourceNames ?? entry.sourceName ?? entry.sourceActors ?? entry.sourceActor,
  ).map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  if (
    sourceNames.length &&
    !sourceNames.some((key) => matchesContentKey(sourceActor, key))
  )
    return false;

  return true;
}

function healingHealthConditionApplies(condition, actor) {
  if (!condition) return true;
  if (typeof condition !== "object") return true;

  const current = Number(actor.system?.health?.value ?? 0);
  const max = Number(actor.system?.health?.max ?? 0);
  if (!Number.isFinite(current)) return false;

  const checks = [
    ["lte", (left, right) => left <= right],
    ["lt", (left, right) => left < right],
    ["gte", (left, right) => left >= right],
    ["gt", (left, right) => left > right],
    ["eq", (left, right) => left === right],
  ];
  for (const [key, predicate] of checks) {
    if (condition[key] === undefined) continue;
    const threshold = resolveHealingHealthThreshold(condition[key], max);
    if (!Number.isFinite(threshold) || !predicate(current, threshold)) return false;
  }
  return true;
}

function resolveHealingHealthThreshold(value, maxHealth) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["half", "halfmax", "bloodied"].includes(normalized)) {
    return Math.ceil((Number(maxHealth) || 0) / 2);
  }
  if (normalized.endsWith("%")) {
    const percent = Number.parseFloat(normalized.slice(0, -1));
    if (Number.isFinite(percent)) return Math.ceil((Number(maxHealth) || 0) * percent / 100);
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0 && numeric < 1) {
    return Math.ceil((Number(maxHealth) || 0) * numeric);
  }
  return numeric;
}

async function resolveHealingApplicationAmount(entry, sourceItem, sourceActor) {
  const formula = String(entry.formula ?? "").trim();
  if (formula) {
    const rollData = sourceItem?.getRollData?.() ?? sourceActor?.getRollData?.() ?? {};
    const roll = new Roll(formula, rollData);
    await roll.evaluate();
    return Number(roll.total ?? roll.result);
  }
  return Number(entry.amount ?? entry.flat ?? entry.value ?? 0);
}

async function applyDrainRecovery(sourceActor) {
  const drain = getActorDrainValue(sourceActor);
  if (drain <= 0) return;
  await applyHealingToActor(sourceActor, drain);
}

export async function applyDamageSourceManaRecovery(sourceActor, sourceItem, damageResults) {
  if (!sourceActor || !sourceItem) return;
  const damageInstances = Array.from(damageResults ?? []).filter(
    (result) => Number(result?.resolvedDamage) > 0,
  ).length;
  if (damageInstances <= 0) return;

  const amount = getActorDamageMpRecovery(sourceActor, sourceItem);
  if (amount <= 0) return;
  await recoverActorMana(sourceActor, amount * damageInstances, {
    render: false,
  });
}

function getActorDamageMpRecovery(actor, item) {
  let recovery = 0;
  const effects = Array.from(actor?.allApplicableEffects?.() ?? []);
  for (const effect of effects) {
    if (!effect || effect.disabled) continue;

    const data = foundry.utils.getProperty(effect, "flags.ffxiv.mpRecovery.onDamage");
    const entries = Array.isArray(data) ? data : data ? [data] : [];
    for (const entry of entries) {
      if (!mpRecoveryEntryAppliesToItem(entry, item)) continue;
      const amount = Number(entry.amount ?? entry.flat);
      if (Number.isFinite(amount)) recovery += amount;
    }

    for (const change of effect.changes ?? []) {
      const key = String(change?.key ?? "").trim().toLowerCase();
      if (key !== "flags.ffxiv.mprecovery.ondamage.amount") continue;

      const amount = Number(change?.value);
      if (!Number.isFinite(amount)) continue;
      const mode = normalizeActiveEffectChangeMode(change);
      if (mode === "multiply") recovery *= amount;
      else if (mode === "override") recovery = amount;
      else if (mode === "subtract") recovery -= amount;
      else recovery += amount;
    }
  }
  return Math.max(Math.floor(recovery), 0);
}

function mpRecoveryEntryAppliesToItem(entry, item) {
  if (!entry || typeof entry !== "object") return false;
  const requiredTags = toArray(entry.tags ?? entry.tag).filter(Boolean);
  if (!requiredTags.length) return true;

  const itemTags = Array.isArray(item?.system?.tags) ? item.system.tags : [];
  return requiredTags.some((tag) =>
    itemTags.some((itemTag) => FFXIVItem._tagMatches(itemTag, [tag])),
  );
}

function getActorDamageEffectModifiers(actor, channel) {
  const channelPath = `damage.${channel}`;

  const result = { flat: 0, mult: 1 };
  const effects = Array.from(actor?.allApplicableEffects?.() ?? []);
  for (const effect of effects) {
    if (!effect || effect.disabled) continue;

    const flagFlat = Number(foundry.utils.getProperty(effect, `flags.ffxiv.${channelPath}.flat`));
    if (Number.isFinite(flagFlat)) result.flat += flagFlat;
    const flagMult = Number(foundry.utils.getProperty(effect, `flags.ffxiv.${channelPath}.mult`));
    if (Number.isFinite(flagMult)) result.mult *= flagMult;

    for (const change of effect.changes ?? []) {
      const key = String(change?.key ?? "").trim().toLowerCase();
      const mode = normalizeActiveEffectChangeMode(change);
      const value = Number(change?.value);
      if (!Number.isFinite(value)) continue;

      if (key === `flags.ffxiv.${channelPath}.flat`) {
        if (mode === "multiply") result.flat *= value;
        else if (mode === "override") result.flat = value;
        else if (mode === "subtract") result.flat -= value;
        else result.flat += value;
      }
      if (key === `flags.ffxiv.${channelPath}.mult`) {
        if (mode === "add") result.mult += value;
        else if (mode === "override") result.mult = value;
        else if (mode === "subtract") result.mult -= value;
        else result.mult *= value;
      }
    }
  }

  if (!Number.isFinite(result.mult) || result.mult < 0) result.mult = 1;
  if (!Number.isFinite(result.flat)) result.flat = 0;
  return result;
}

function normalizeActiveEffectChangeMode(change) {
  const rawMode = getActiveEffectChangeType(change);
  const mode = String(rawMode ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "");
  if (["multiply", "add", "subtract", "override", "upgrade", "downgrade"].includes(mode))
    return mode;

  const legacy = Number.parseInt(rawMode, 10);
  switch (legacy) {
    case 0:
      return "custom";
    case 1:
      return "multiply";
    case 2:
      return "add";
    case 3:
      return "downgrade";
    case 4:
      return "upgrade";
    case 5:
      return "override";
    case 6:
      return "subtract";
    default:
      return "add";
  }
}
