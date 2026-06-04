export const STACKABLE_STATUS_EFFECT_IDS = new Set(["dot", "drain", "revivify"]);
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
  },
  {
    id: "blind",
    labelKey: "FFXIV.Effects.Blind",
    icon: "systems/ffxiv/assets/effects/blind.webp",
  },
  {
    id: "brink_death",
    labelKey: "FFXIV.Effects.BrinkDeath",
    icon: "systems/ffxiv/assets/effects/brink-of-death.webp",
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
  },
  {
    id: "heavy",
    labelKey: "FFXIV.Effects.Heavy",
    icon: "systems/ffxiv/assets/effects/heavy.webp",
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
  },
  {
    id: "prone",
    labelKey: "FFXIV.Effects.Prone",
    icon: "systems/ffxiv/assets/effects/prone.webp",
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
  },
  {
    id: "slow",
    labelKey: "FFXIV.Effects.Slow",
    icon: "systems/ffxiv/assets/effects/slow.webp",
  },
  {
    id: "stun",
    labelKey: "FFXIV.Effects.Stun",
    icon: "systems/ffxiv/assets/effects/stun.webp",
  },
  {
    id: "weakness",
    labelKey: "FFXIV.Effects.Weakness",
    icon: "systems/ffxiv/assets/effects/weakness.webp",
  },
];

const BENEFICIAL_STATUS_IDS = [
  "critical_up",
  "drain",
  "invoking",
  "ready",
  "revivify",
  "transcendent",
];

const NEGATIVE_STATUS_IDS = [
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
  };
}

export function isStackableStatusEffect(statusId) {
  return STACKABLE_STATUS_EFFECT_IDS.has(String(statusId ?? ""));
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

export function getStatusStackCount(actor, statusId) {
  const effects = getStatusStackEffects(actor, statusId);
  if (!effects.length) return 0;
  if (!isStackableStatusEffect(statusId)) return effects.length;
  return effects.reduce(
    (highest, effect) =>
      Math.max(highest, getStatusStackValue(effect, 1, statusId)),
    0,
  );
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
  { overlay = false, origin = null } = {},
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
  return ActiveEffectClass.create(effect.toObject(), { parent: actor, render: false });
}

async function collapseLegacyStatusStacks(
  actor,
  statusId,
  overrideCount,
  { origin = null } = {},
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
      await actor.deleteEmbeddedDocuments("ActiveEffect", duplicateIds, { render: false });
  }
  return primary;
}

async function setStatusStackCount(
  actor,
  statusId,
  count,
  { origin = null, sourceEffect = null } = {},
) {
  const normalizedCount = Number.parseInt(count, 10) || 0;
  const existing = getStatusStackSourceEffects(actor, statusId, origin, sourceEffect);

  if (normalizedCount <= 0) {
    if (!existing.length) return false;
    const ids = existing.map((effect) => effect.id).filter(Boolean);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
    return true;
  }

  if (!existing.length) {
    await createStatusStack(actor, statusId, normalizedCount, { origin });
    return true;
  }

  await collapseLegacyStatusStacks(actor, statusId, normalizedCount, {
    origin,
  });
  return true;
}

export async function applyStatusEffectStackDelta(
  actor,
  statusId,
  delta,
  { origin = null, sourceEffect = null } = {},
) {
  const amount = Number(delta) || 0;
  if (!actor || !statusId || !amount) return;

  const sourceEffects = getStatusStackSourceEffects(
    actor,
    statusId,
    origin,
    sourceEffect,
  );
  const currentCount = sourceEffects.reduce(
    (total, effect) => total + getStatusStackValue(effect, 1, statusId),
    0,
  );
  const nextCount = Math.max(currentCount + amount, 0);
  return setStatusStackCount(actor, statusId, nextCount, {
    origin,
    sourceEffect,
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

export async function applyStatusEffectChange(
  actor,
  statusId,
  active,
  { overlay = false, origin = null } = {},
) {
  if (!actor || !statusId) return;
  if (isStackableStatusEffect(statusId)) {
    return applyStatusEffectStackDelta(
      actor,
      statusId,
      active === false ? -1 : 1,
      { origin },
    );
  }
  const result = await actor.toggleStatusEffect(statusId, { active, overlay, render: false });
  if (active !== false && origin) {
    await setNonStackableStatusOrigin(actor, statusId, origin);
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
