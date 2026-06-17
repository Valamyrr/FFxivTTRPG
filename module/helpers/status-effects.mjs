export const STACKABLE_STATUS_EFFECT_IDS = new Set([
  "critical_up",
  "dot",
  "drain",
  "revivify",
]);
const ADDITIVE_STACKABLE_STATUS_EFFECT_IDS = new Set(["critical_up"]);
const STACK_COUNT_FLAG_SCOPE = "ffxiv";
const STACK_COUNT_FLAG_KEY = "stackCount";
const MANUAL_STACK_SOURCE = "__manual__";

const STATUS_DEFINITIONS = [
  {
    id: "transcendent",
    labelKey: "FFXIV.Effects.Ascendent",
    icon: "systems/ffxiv/assets/effects/ascendent.webp",
  },
  {
    id: "bind",
    labelKey: "FFXIV.Effects.Bind",
    icon: "systems/ffxiv/assets/effects/bind.webp",
    flags: {
      ffxiv: {
        target: { check: { advantage: 1 } },
      },
    },
  },
  {
    id: "blind",
    labelKey: "FFXIV.Effects.Blind",
    icon: "systems/ffxiv/assets/effects/blind.webp",
    flags: {
      ffxiv: {
        check: { penalty: -2 },
        target: { check: { advantage: 1 } },
      },
    },
  },
  {
    id: "brink_death",
    labelKey: "FFXIV.Effects.BrinkDeath",
    icon: "systems/ffxiv/assets/effects/brink-of-death.webp",
    flags: {
      ffxiv: {
        check: { penalty: -5 },
      },
    },
  },
  {
    id: "comatose",
    labelKey: "FFXIV.Effects.Comatose",
    icon: "systems/ffxiv/assets/effects/comatose.webp",
  },
  {
    id: "critical_up",
    labelKey: "FFXIV.Effects.CriticalUp",
    icon: "systems/ffxiv/assets/effects/critical-up.webp",
  },
  {
    id: "death",
    labelKey: "FFXIV.Effects.Death",
    icon: "systems/ffxiv/assets/effects/death.webp",
  },
  {
    id: "dot",
    labelKey: "FFXIV.Effects.DOT",
    icon: "systems/ffxiv/assets/effects/dot.webp",
  },
  {
    id: "drain",
    labelKey: "FFXIV.Effects.Drain",
    icon: "systems/ffxiv/assets/effects/drain.webp",
  },
  {
    id: "enmity",
    labelKey: "FFXIV.Effects.Enmity",
    icon: "systems/ffxiv/assets/effects/enmity.webp",
    flags: {
      ffxiv: {
        enmity: { checkPenalty: -5 },
      },
    },
  },
  {
    id: "heavy",
    labelKey: "FFXIV.Effects.Heavy",
    icon: "systems/ffxiv/assets/effects/heavy.webp",
  },
  {
    id: "hidden",
    labelKey: "FFXIV.Effects.Hidden",
    icon: "systems/ffxiv/assets/effects/hidden.webp",
    flags: {
      ffxiv: {
        check: { advantage: 1 },
      },
    },
  },
  {
    id: "invoking",
    labelKey: "FFXIV.Effects.Invoking",
    icon: "systems/ffxiv/assets/effects/invoking.webp",
  },
  {
    id: "knocked_out",
    labelKey: "FFXIV.Effects.KnockedOut",
    icon: "systems/ffxiv/assets/effects/knocked-out.webp",
    flags: {
      ffxiv: {
        check: { penalty: -7 },
        target: { check: { advantage: 2 } },
      },
    },
  },
  {
    id: "paralysis",
    labelKey: "FFXIV.Effects.Paralysis",
    icon: "systems/ffxiv/assets/effects/paralysis.webp",
  },
  {
    id: "petrified",
    labelKey: "FFXIV.Effects.Petrified",
    icon: "systems/ffxiv/assets/effects/petrified.webp",
    flags: {
      ffxiv: {
        check: { penalty: -5 },
        target: { check: { advantage: 1 } },
      },
    },
  },
  {
    id: "prone",
    labelKey: "FFXIV.Effects.Prone",
    icon: "systems/ffxiv/assets/effects/prone.webp",
    flags: {
      ffxiv: {
        check: { penalty: -2 },
        target: { check: { advantage: 1 } },
      },
    },
  },
  {
    id: "ready",
    labelKey: "FFXIV.Effects.Ready",
    icon: "systems/ffxiv/assets/effects/ready.webp",
  },
  {
    id: "revivify",
    labelKey: "FFXIV.Effects.Revivify",
    icon: "systems/ffxiv/assets/effects/revivify.webp",
  },
  {
    id: "silence",
    labelKey: "FFXIV.Effects.Silence",
    icon: "systems/ffxiv/assets/effects/silence.webp",
  },
  {
    id: "sleep",
    labelKey: "FFXIV.Effects.Sleep",
    icon: "systems/ffxiv/assets/effects/sleep.webp",
    flags: {
      ffxiv: {
        check: { penalty: -3 },
      },
    },
  },
  {
    id: "slow",
    labelKey: "FFXIV.Effects.Slow",
    icon: "systems/ffxiv/assets/effects/slow.webp",
    flags: {
      ffxiv: {
        check: { penalty: -2 },
      },
    },
  },
  {
    id: "stun",
    labelKey: "FFXIV.Effects.Stun",
    icon: "systems/ffxiv/assets/effects/stun.webp",
    flags: {
      ffxiv: {
        check: { penalty: -5 },
        target: { check: { advantage: 1 } },
      },
    },
  },
  {
    id: "weakness",
    labelKey: "FFXIV.Effects.Weakness",
    icon: "systems/ffxiv/assets/effects/weakness.webp",
    flags: {
      ffxiv: {
        check: { penalty: -2 },
      },
    },
  },
];

export const BENEFICIAL_STATUS_IDS = [
  "critical_up",
  "drain",
  "hidden",
  "invoking",
  "ready",
  "revivify",
  "transcendent",
];

export const NEGATIVE_STATUS_IDS = [
  "bind",
  "blind",
  "brink_death",
  "comatose",
  "death",
  "dot",
  "heavy",
  "knocked_out",
  "paralysis",
  "petrified",
  "prone",
  "silence",
  "sleep",
  "slow",
  "stun",
  "weakness",
];

const COMATOSE_ALLOWED_STATUS_IDS = new Set(["comatose", "death"]);
const KNOCKED_OUT_ALLOWED_STATUS_IDS = new Set([
  "comatose",
  "death",
  "knocked_out",
]);
const ELITE_FOE_ALLOWED_ENFEEBLEMENT_IDS = new Set([
  "dot",
  "enmity",
  "knocked_out",
]);

function getStatusOrder(statusId, fallbackIndex = 0) {
  const beneficialIndex = BENEFICIAL_STATUS_IDS.indexOf(statusId);
  if (beneficialIndex >= 0) return beneficialIndex;

  const negativeIndex = NEGATIVE_STATUS_IDS.indexOf(statusId);
  if (negativeIndex >= 0) return 200 + negativeIndex;

  // Middle bucket for neutral effects.
  return 100 + fallbackIndex;
}

function createStatusEffect(id, labelKey, icon, order) {
  return {
    id,
    name: game.i18n.localize(labelKey),
    label: labelKey,
    img: icon,
    icon,
    order,
    flags: foundry.utils.deepClone(
      STATUS_DEFINITIONS.find((definition) => definition.id === id)?.flags ?? {},
    ),
  };
}

export function isStackableStatusEffect(statusId) {
  return STACKABLE_STATUS_EFFECT_IDS.has(String(statusId ?? ""));
}

export function isAdditiveStackableStatusEffect(statusId) {
  return ADDITIVE_STACKABLE_STATUS_EFFECT_IDS.has(String(statusId ?? ""));
}

export function isBeneficialStatusEffect(statusId) {
  return BENEFICIAL_STATUS_IDS.includes(String(statusId ?? ""));
}

export function isNegativeStatusEffect(statusId) {
  return NEGATIVE_STATUS_IDS.includes(String(statusId ?? ""));
}

export function isEliteFoe(actor) {
  return actor?.type === "npc" && actor.system?.elite_foe === true;
}

export function isEliteFoeBlockedStatus(actor, statusId) {
  const normalizedStatusId = String(statusId ?? "").trim();
  return (
    isEliteFoe(actor) &&
    isNegativeStatusEffect(normalizedStatusId) &&
    !ELITE_FOE_ALLOWED_ENFEEBLEMENT_IDS.has(normalizedStatusId)
  );
}

export function hasStatus(actor, statusId) {
  const normalizedStatusId = String(statusId ?? "").trim();
  if (!actor || !normalizedStatusId) return false;
  if (actor.statuses instanceof Set && actor.statuses.has(normalizedStatusId))
    return true;
  return Array.from(actor.effects ?? []).some((effect) => {
    if (!effect || effect.disabled) return false;
    const statuses = effect.statuses;
    return statuses instanceof Set && statuses.has(normalizedStatusId);
  });
}

function normalizeStackCount(value, fallback = 1) {
  const count = Number.parseInt(value, 10);
  if (Number.isFinite(count) && count > 0) return count;
  return Math.max(1, Number.parseInt(fallback, 10) || 1);
}

export function getStatusStackEffects(actor, statusId) {
  if (!actor?.effects) return [];
  return actor.effects.filter((effect) => {
    const statuses = effect?.statuses;
    return (
      statuses instanceof Set && statuses.size === 1 && statuses.has(statusId)
    );
  });
}

function getStatusValueEffects(actor, statusId) {
  if (!actor?.effects) return [];
  return actor.effects.filter((effect) => {
    const statuses = effect?.statuses;
    return statuses instanceof Set && statuses.has(statusId);
  });
}

export function getStatusStackValue(effect, fallback = 1, statusId = null) {
  if (!effect) return normalizeStackCount(fallback, 1);
  if (statusId) {
    const scoped = Number.parseInt(
      effect.getFlag(STACK_COUNT_FLAG_SCOPE, `statusStacks.${statusId}`),
      10,
    );
    if (Number.isFinite(scoped) && scoped > 0) return scoped;
  }
  return normalizeStackCount(
    effect.getFlag(STACK_COUNT_FLAG_SCOPE, STACK_COUNT_FLAG_KEY),
    fallback,
  );
}

export function getStatusStackTotal(actor, statusId) {
  return getStatusValueEffects(actor, statusId)
    .filter((effect) => !effect.disabled)
    .reduce(
      (total, effect) => total + getStatusStackValue(effect, 1, statusId),
      0,
    );
}

export function getHighestStatusStackCount(actor, statusId) {
  return getStatusValueEffects(actor, statusId)
    .filter((effect) => !effect.disabled)
    .reduce(
      (highest, effect) =>
        Math.max(highest, getStatusStackValue(effect, 1, statusId)),
      0,
    );
}

export function getStatusStackCount(actor, statusId) {
  const effects = getStatusValueEffects(actor, statusId);
  if (!effects.length) return 0;
  if (!isStackableStatusEffect(statusId)) return effects.length;
  if (statusId === "critical_up") return getStatusStackTotal(actor, statusId);
  return getHighestStatusStackCount(actor, statusId);
}

export function getActorCheckPenalty(actor, { ignoredStatuses = [] } = {}) {
  const ignored = new Set(
    (Array.isArray(ignoredStatuses) ? ignoredStatuses : [])
      .map((statusId) => String(statusId ?? "").trim())
      .filter(Boolean),
  );
  return getActorEffectFlagTotal(actor, "flags.ffxiv.check.penalty", {
    ignoredStatuses: ignored,
  });
}

export function getTargetStatusAdvantage(actor) {
  return getActorEffectFlagTotal(actor, "flags.ffxiv.target.check.advantage");
}

function getActorEffectFlagTotal(actor, path, { ignoredStatuses = null } = {}) {
  return Array.from(actor?.effects ?? []).reduce((total, effect) => {
    if (!effect || effect.disabled) return total;
    if (
      ignoredStatuses instanceof Set &&
      Array.from(effect.statuses ?? []).some((statusId) => ignoredStatuses.has(statusId))
    )
      return total;
    const value = Number(foundry.utils.getProperty(effect, path));
    return Number.isFinite(value) ? total + value : total;
  }, 0);
}

export function getActorCriticalRange(actor, fallback = 20) {
  const baseRange = Number.parseInt(fallback, 10);
  const criticalRange = Number.isFinite(baseRange) && baseRange > 0
    ? baseRange
    : 20;
  return Math.max(1, criticalRange - getStatusStackTotal(actor, "critical_up"));
}

export function getActorDrainValue(actor) {
  return getHighestStatusStackCount(actor, "drain");
}

export function canActorRecover(actor) {
  return !hasStatus(actor, "knocked_out") && !hasStatus(actor, "comatose");
}

export async function recoverActorHealth(actor, amount, options = {}) {
  const healing = Math.max(Number.parseInt(amount, 10) || 0, 0);
  const currentHealth = Number(actor?.system?.health?.value ?? 0);
  if (!actor || healing <= 0 || !canActorRecover(actor)) {
    return {
      changed: false,
      currentHealth,
      nextHealth: currentHealth,
      healing: 0,
    };
  }

  const maxHealth = Number(actor.system?.health?.max);
  const healthCap = Number.isFinite(maxHealth) && maxHealth > 0
    ? maxHealth
    : Number.POSITIVE_INFINITY;
  const nextHealth = Math.min(currentHealth + healing, healthCap);
  if (nextHealth === currentHealth) {
    return {
      changed: false,
      currentHealth,
      nextHealth,
      healing: 0,
    };
  }

  await actor.update({ "system.health.value": nextHealth }, options);
  return {
    changed: true,
    currentHealth,
    nextHealth,
    healing: nextHealth - currentHealth,
  };
}

export async function recoverActorMana(actor, amount, options = {}) {
  const recovery = Math.max(Number.parseInt(amount, 10) || 0, 0);
  const currentMana = Number(actor?.system?.mana?.value ?? 0);
  if (!actor || recovery <= 0 || !canActorRecover(actor)) {
    return {
      changed: false,
      currentMana,
      nextMana: currentMana,
      recovery: 0,
    };
  }

  const maxMana = Number(actor.system?.mana?.max);
  const manaCap = Number.isFinite(maxMana) && maxMana > 0 ? maxMana : 5;
  const nextMana = Math.min(currentMana + recovery, manaCap);
  if (nextMana === currentMana) {
    return {
      changed: false,
      currentMana,
      nextMana,
      recovery: 0,
    };
  }

  await actor.update({ "system.mana.value": nextMana }, options);
  return {
    changed: true,
    currentMana,
    nextMana,
    recovery: nextMana - currentMana,
  };
}

function getStatusStackSourceKey(effect, origin = null) {
  const linkedSourceEffectId = String(
    effect?.getFlag?.(STACK_COUNT_FLAG_SCOPE, "linkedSourceEffectId") ?? "",
  ).trim();
  const linkedSourceItemUuid = String(
    effect?.getFlag?.(STACK_COUNT_FLAG_SCOPE, "linkedSourceItemUuid") ?? "",
  ).trim();
  const linkedSourceItemId = String(
    effect?.getFlag?.(STACK_COUNT_FLAG_SCOPE, "linkedSourceItemId") ?? "",
  ).trim();
  const effectOrigin = String(effect?.origin ?? origin ?? "").trim();
  if (linkedSourceEffectId || linkedSourceItemUuid || linkedSourceItemId) {
    return [
      linkedSourceItemUuid || linkedSourceItemId || effectOrigin,
      linkedSourceEffectId,
    ].join("|");
  }
  return effectOrigin || MANUAL_STACK_SOURCE;
}

function getStatusStackSourceEffects(actor, statusId, origin = null, sourceEffect = null) {
  const targetKey = sourceEffect
    ? getStatusStackSourceKey(sourceEffect, origin)
    : getStatusStackSourceKey(null, origin);
  return getStatusStackEffects(actor, statusId).filter(
    (effect) => getStatusStackSourceKey(effect, origin) === targetKey,
  );
}

async function createStatusStack(
  actor,
  statusId,
  count = 1,
  { overlay = false, origin = null, ffxivSuppressStatusText = false } = {},
) {
  const ActiveEffectClass = getDocumentClass("ActiveEffect");
  const effect = await ActiveEffectClass.fromStatusEffect(statusId, {
    parent: actor,
  });
  effect.updateSource({
    [`flags.${STACK_COUNT_FLAG_SCOPE}.${STACK_COUNT_FLAG_KEY}`]:
      normalizeStackCount(count, 1),
  });
  if (origin) effect.updateSource({ origin });
  if (overlay) effect.updateSource({ "flags.core.overlay": true });
  return ActiveEffectClass.create(effect.toObject(), {
    parent: actor,
    render: false,
    ffxivSuppressStatusText,
  });
}

async function collapseLegacyStatusStacks(
  actor,
  statusId,
  overrideCount,
  { origin = null, ffxivSuppressStatusText = false } = {},
) {
  const existing = getStatusStackEffects(actor, statusId);
  if (!existing.length) return null;

  const primary = existing.find(
    (effect) => getStatusStackSourceKey(effect, origin) === getStatusStackSourceKey(null, origin),
  ) ?? existing[0];
  const targetCount = normalizeStackCount(
    overrideCount,
    getStatusStackCount(actor, statusId),
  );
  const updateData = {
    [`flags.${STACK_COUNT_FLAG_SCOPE}.${STACK_COUNT_FLAG_KEY}`]: targetCount,
  };
  if (origin) updateData.origin = origin;
  await primary.update(updateData, { render: false });

  const sourceKey = getStatusStackSourceKey(primary, origin);
  const duplicates = existing.filter(
    (effect) => effect.id !== primary.id && getStatusStackSourceKey(effect, origin) === sourceKey,
  );
  if (duplicates.length) {
    const duplicateIds = duplicates
      .map((effect) => effect.id)
      .filter(Boolean);
    if (duplicateIds.length)
      await actor.deleteEmbeddedDocuments("ActiveEffect", duplicateIds, { render: false, ffxivSuppressStatusText });
  }
  return primary;
}

async function setStatusStackCount(
  actor,
  statusId,
  count,
  { origin = null, sourceEffect = null, ffxivSuppressStatusText = false } = {},
) {
  const normalizedCount = Number.parseInt(count, 10) || 0;
  const existing = getStatusStackSourceEffects(actor, statusId, origin, sourceEffect);

  if (normalizedCount <= 0) {
    if (!existing.length) return false;
    const ids = existing.map((effect) => effect.id).filter(Boolean);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false, ffxivSuppressStatusText });
    return true;
  }

  if (!existing.length) {
    await createStatusStack(actor, statusId, normalizedCount, { origin, ffxivSuppressStatusText });
    return true;
  }

  await collapseLegacyStatusStacks(actor, statusId, normalizedCount, {
    origin,
    ffxivSuppressStatusText,
  });
  return true;
}

export async function applyStatusEffectStackDelta(
  actor,
  statusId,
  delta,
  { origin = null, sourceEffect = null, ffxivSuppressStatusText = false } = {},
) {
  const amount = Number(delta) || 0;
  if (!actor || !statusId || !amount) return;
  const normalizedStatusId = String(statusId ?? "").trim();
  if (
    amount > 0 &&
    hasStatus(actor, "knocked_out") &&
    !KNOCKED_OUT_ALLOWED_STATUS_IDS.has(normalizedStatusId)
  )
    return false;
  if (
    amount > 0 &&
    hasStatus(actor, "comatose") &&
    !COMATOSE_ALLOWED_STATUS_IDS.has(normalizedStatusId)
  )
    return false;
  if (
    amount > 0 &&
    hasStatus(actor, "transcendent") &&
    isNegativeStatusEffect(normalizedStatusId)
  )
    return false;
  if (amount > 0 && isEliteFoeBlockedStatus(actor, normalizedStatusId))
    return false;

  const sourceEffects = getStatusStackSourceEffects(
    actor,
    normalizedStatusId,
    origin,
    sourceEffect,
  );
  const currentCount = sourceEffects.reduce(
    (total, effect) => total + getStatusStackValue(effect, 1, statusId),
    0,
  );
  const nextCount = Math.max(currentCount + amount, 0);
  return setStatusStackCount(actor, normalizedStatusId, nextCount, {
    origin,
    sourceEffect,
    ffxivSuppressStatusText,
  });
}

export async function applyStatusEffectStackValue(
  actor,
  statusId,
  count,
  { origin = null, sourceEffect = null, ffxivSuppressStatusText = false } = {},
) {
  if (!actor || !statusId) return;
  const normalizedStatusId = String(statusId ?? "").trim();
  const normalizedCount = Math.max(Number.parseInt(count, 10) || 0, 0);
  if (
    normalizedCount > 0 &&
    hasStatus(actor, "knocked_out") &&
    !KNOCKED_OUT_ALLOWED_STATUS_IDS.has(normalizedStatusId)
  )
    return false;
  if (
    normalizedCount > 0 &&
    hasStatus(actor, "comatose") &&
    !COMATOSE_ALLOWED_STATUS_IDS.has(normalizedStatusId)
  )
    return false;
  if (
    normalizedCount > 0 &&
    hasStatus(actor, "transcendent") &&
    isNegativeStatusEffect(normalizedStatusId)
  )
    return false;
  if (normalizedCount > 0 && isEliteFoeBlockedStatus(actor, normalizedStatusId))
    return false;

  return setStatusStackCount(actor, normalizedStatusId, normalizedCount, {
    origin,
    sourceEffect,
    ffxivSuppressStatusText,
  });
}

async function setNonStackableStatusOrigin(actor, statusId, origin) {
  if (!actor?.effects || !origin) return;
  const effects = actor.effects.filter((effect) => {
    const statuses = effect?.statuses;
    return statuses instanceof Set && statuses.has(statusId);
  });
  for (const effect of effects) {
    if (effect.origin === origin) continue;
    await effect.update({ origin }, { render: false });
  }
}

async function replaceNonStackableStatusEffect(
  actor,
  statusId,
  { overlay = false, origin = null, ffxivSuppressStatusText = false } = {},
) {
  const existing = actor.effects.filter((effect) => {
    const statuses = effect?.statuses;
    return statuses instanceof Set && statuses.has(statusId);
  });
  const ids = existing.map((effect) => effect.id).filter(Boolean);
  if (ids.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false, ffxivSuppressStatusText });
  }

  const ActiveEffectClass = getDocumentClass("ActiveEffect");
  const effect = await ActiveEffectClass.fromStatusEffect(statusId, {
    parent: actor,
  });
  if (origin) effect.updateSource({ origin });
  if (overlay) effect.updateSource({ "flags.core.overlay": true });
  return ActiveEffectClass.create(effect.toObject(), {
    parent: actor,
    render: false,
    ffxivSuppressStatusText,
  });
}

async function deleteStatusEffects(actor, statusIds, { ffxivSuppressStatusText = false } = {}) {
  if (!actor?.effects?.size) return;
  const statusSet = new Set(statusIds);
  const ids = actor.effects
    .filter((effect) => {
      if (!effect || effect.disabled) return false;
      const statuses = effect.statuses;
      return (
        statuses instanceof Set &&
        Array.from(statuses).some((statusId) => statusSet.has(statusId))
      );
    })
    .map((effect) => effect.id)
    .filter(Boolean);
  if (ids.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false, ffxivSuppressStatusText });
  }
}

async function clearComatoseBlockedStatuses(actor) {
  const blockedStatusIds = [...BENEFICIAL_STATUS_IDS, ...NEGATIVE_STATUS_IDS]
    .filter((statusId) => !COMATOSE_ALLOWED_STATUS_IDS.has(statusId));
  await deleteStatusEffects(actor, blockedStatusIds);
}

async function clearKnockedOutBlockedStatuses(actor) {
  const blockedStatusIds = [...BENEFICIAL_STATUS_IDS, ...NEGATIVE_STATUS_IDS]
    .filter((statusId) => !KNOCKED_OUT_ALLOWED_STATUS_IDS.has(statusId));
  await deleteStatusEffects(actor, blockedStatusIds);
}

async function applyComatoseStatusEffect(
  actor,
  { overlay = false, origin = null, ffxivSuppressStatusText = false } = {},
) {
  await clearComatoseBlockedStatuses(actor);
  const result = await replaceNonStackableStatusEffect(actor, "comatose", {
    overlay,
    origin,
    ffxivSuppressStatusText,
  });
  await clearComatoseBlockedStatuses(actor);
  return result;
}

async function applyKnockedOutStatusEffect(
  actor,
  { overlay = false, origin = null, ffxivSuppressStatusText = false } = {},
) {
  await clearKnockedOutBlockedStatuses(actor);
  const result = await replaceNonStackableStatusEffect(actor, "knocked_out", {
    overlay,
    origin,
    ffxivSuppressStatusText,
  });
  await clearKnockedOutBlockedStatuses(actor);
  await removeEnmityInflictedByActor(actor);
  return result;
}

async function getEffectSourceActor(effect) {
  const origin = String(effect?.origin ?? "").trim();
  if (!origin || origin.toLowerCase() === "none") return null;

  let source = null;
  try {
    source = await fromUuid(origin);
  } catch (_error) {
    return null;
  }

  if (source?.documentName === "Actor") return source;
  if (source?.parent?.documentName === "Actor") return source.parent;
  if (source?.actor?.documentName === "Actor") return source.actor;
  return null;
}

function getActorsWithStatusEffects() {
  const actors = new Map();
  const addActor = (actor) => {
    if (!actor) return;
    const key = String(actor.uuid ?? actor.id ?? "").trim();
    if (!key || actors.has(key)) return;
    actors.set(key, actor);
  };
  for (const actor of game.actors ?? []) addActor(actor);
  for (const token of canvas?.tokens?.placeables ?? []) addActor(token.actor);
  return Array.from(actors.values());
}

export async function removeEnmityInflictedByActor(sourceActor) {
  if (!sourceActor) return;
  for (const actor of getActorsWithStatusEffects()) {
    const ids = [];
    for (const effect of actor.effects ?? []) {
      if (!effect || effect.disabled) continue;
      const statuses = effect.statuses;
      if (!(statuses instanceof Set) || !statuses.has("enmity")) continue;
      const effectSourceActor = await getEffectSourceActor(effect);
      if (isSameStatusSourceActor(effectSourceActor, sourceActor)) {
        ids.push(effect.id);
      }
    }
    if (ids.length) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
    }
  }
}

function isSameStatusSourceActor(first, second) {
  if (!first || !second) return false;
  if (first === second) return true;
  const firstUuid = String(first.uuid ?? "").trim();
  const secondUuid = String(second.uuid ?? "").trim();
  if (firstUuid || secondUuid) return firstUuid && firstUuid === secondUuid;
  return first.id && first.id === second.id;
}

export async function applyStatusEffectChange(
  actor,
  statusId,
  active,
  { overlay = false, origin = null, ffxivSuppressStatusText = false } = {},
) {
  if (!actor || !statusId) return;
  const normalizedStatusId = String(statusId ?? "").trim();
  const isActive = active !== false;

  if (
    isActive &&
    hasStatus(actor, "knocked_out") &&
    !KNOCKED_OUT_ALLOWED_STATUS_IDS.has(normalizedStatusId)
  )
    return false;

  if (
    isActive &&
    hasStatus(actor, "comatose") &&
    !COMATOSE_ALLOWED_STATUS_IDS.has(normalizedStatusId)
  )
    return false;

  if (
    isActive &&
    hasStatus(actor, "transcendent") &&
    isNegativeStatusEffect(normalizedStatusId)
  )
    return false;

  if (isActive && isEliteFoeBlockedStatus(actor, normalizedStatusId))
    return false;

  if (isActive && normalizedStatusId === "weakness") {
    if (hasStatus(actor, "brink_death")) {
      return applyComatoseStatusEffect(actor, { overlay, origin, ffxivSuppressStatusText });
    }
    if (hasStatus(actor, "weakness")) {
      await applyStatusEffectChange(actor, "weakness", false, { overlay, origin, ffxivSuppressStatusText });
      return applyStatusEffectChange(actor, "brink_death", true, {
        overlay,
        origin,
        ffxivSuppressStatusText,
      });
    }
  }

  if (isActive && normalizedStatusId === "comatose") {
    return applyComatoseStatusEffect(actor, { overlay, origin, ffxivSuppressStatusText });
  }

  if (isActive && normalizedStatusId === "knocked_out") {
    return applyKnockedOutStatusEffect(actor, { overlay, origin, ffxivSuppressStatusText });
  }

  if (
    isActive &&
    normalizedStatusId === "stun" &&
    actor.getFlag("ffxiv", "stunnedInEncounter") === true &&
    !hasStatus(actor, "stun")
  )
    return false;

  if (isStackableStatusEffect(normalizedStatusId)) {
    return applyStatusEffectStackDelta(
      actor,
      normalizedStatusId,
      isActive ? 1 : -1,
      { origin, ffxivSuppressStatusText },
    );
  }
  if (normalizedStatusId === "enmity" && isActive && origin) {
    return replaceNonStackableStatusEffect(actor, normalizedStatusId, {
      overlay,
      origin,
      ffxivSuppressStatusText,
    });
  }
  const result = await actor.toggleStatusEffect(normalizedStatusId, {
    active,
    overlay,
    render: false,
    ffxivSuppressStatusText,
  });
  if (isActive && origin) {
    await setNonStackableStatusOrigin(actor, normalizedStatusId, origin);
  }
  if (isActive && normalizedStatusId === "stun") {
    await actor.setFlag("ffxiv", "stunnedInEncounter", true);
  }
  return result;
}

export async function migrateLegacyStatusStackEffects() {
  if (!game.user?.isGM) return;
  for (const actor of game.actors ?? []) {
    for (const statusId of STACKABLE_STATUS_EFFECT_IDS) {
      const existing = getStatusStackEffects(actor, statusId);
      if (!existing.length) continue;

      const groups = new Map();
      for (const effect of existing) {
        const key = getStatusStackSourceKey(effect);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(effect);
      }

      for (const group of groups.values()) {
        const missingCounterFlag = group.some((effect) => {
          const value = effect.getFlag(
            STACK_COUNT_FLAG_SCOPE,
            STACK_COUNT_FLAG_KEY,
          );
          return !Number.isFinite(Number.parseInt(value, 10));
        });
        if (group.length === 1 && !missingCounterFlag) continue;

        const primary = group[0];
        const targetCount = group.reduce(
          (total, effect) => total + getStatusStackValue(effect, 1, statusId),
          0,
        );
        await primary.update(
          {
            [`flags.${STACK_COUNT_FLAG_SCOPE}.${STACK_COUNT_FLAG_KEY}`]:
              normalizeStackCount(targetCount, 1),
          },
          { render: false },
        );

        const duplicateIds = group
          .slice(1)
          .map((effect) => effect.id)
          .filter(Boolean);
        if (duplicateIds.length) {
          await actor.deleteEmbeddedDocuments("ActiveEffect", duplicateIds, {
            render: false,
          });
        }
      }
    }
  }
}

export const updateStatusEffects = () => {
  const effects = STATUS_DEFINITIONS.map(({ id, labelKey, icon }, index) =>
    createStatusEffect(id, labelKey, icon, getStatusOrder(id, index)),
  );
  effects.sort((a, b) => {
    const orderA = Number(a.order) || 0;
    const orderB = Number(b.order) || 0;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.name ?? a.label ?? a.id).localeCompare(
      String(b.name ?? b.label ?? b.id),
    );
  });
  CONFIG.statusEffects = effects;
};
