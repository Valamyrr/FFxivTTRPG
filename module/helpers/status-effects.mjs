export const STACKABLE_STATUS_EFFECT_IDS = new Set(["dot", "revivify"]);
const STACK_COUNT_FLAG_SCOPE = "ffxiv";
const STACK_COUNT_FLAG_KEY = "stackCount";

const STATUS_DEFINITIONS = [
  {
    id: "ascendent",
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
  "ascendent",
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

export function getStatusStackValue(effect, fallback = 1) {
  if (!effect) return normalizeStackCount(fallback, 1);
  return normalizeStackCount(
    effect.getFlag(STACK_COUNT_FLAG_SCOPE, STACK_COUNT_FLAG_KEY),
    fallback,
  );
}

export function getStatusStackCount(actor, statusId) {
  const effects = getStatusStackEffects(actor, statusId);
  if (!effects.length) return 0;
  if (!isStackableStatusEffect(statusId)) return effects.length;

  // Legacy compatibility: old stacks were duplicated effects, new stacks are flag-based.
  const primary = effects[0];
  const flagCount = getStatusStackValue(primary, 1);
  return Math.max(flagCount, effects.length);
}

async function createStatusStack(
  actor,
  statusId,
  count = 1,
  { overlay = false } = {},
) {
  const ActiveEffectClass = getDocumentClass("ActiveEffect");
  const effect = await ActiveEffectClass.fromStatusEffect(statusId, {
    parent: actor,
  });
  effect.updateSource({
    [`flags.${STACK_COUNT_FLAG_SCOPE}.${STACK_COUNT_FLAG_KEY}`]:
      normalizeStackCount(count, 1),
  });
  if (overlay) effect.updateSource({ "flags.core.overlay": true });
  return ActiveEffectClass.create(effect.toObject(), { parent: actor });
}

async function collapseLegacyStatusStacks(actor, statusId, overrideCount) {
  const existing = getStatusStackEffects(actor, statusId);
  if (!existing.length) return null;

  const primary = existing[0];
  const targetCount = normalizeStackCount(
    overrideCount,
    getStatusStackCount(actor, statusId),
  );
  const updateData = {
    [`flags.${STACK_COUNT_FLAG_SCOPE}.${STACK_COUNT_FLAG_KEY}`]: targetCount,
  };
  await primary.update(updateData);

  if (existing.length > 1) {
    const duplicateIds = existing
      .slice(1)
      .map((effect) => effect.id)
      .filter(Boolean);
    if (duplicateIds.length)
      await actor.deleteEmbeddedDocuments("ActiveEffect", duplicateIds);
  }
  return primary;
}

async function setStatusStackCount(actor, statusId, count) {
  const normalizedCount = Number.parseInt(count, 10) || 0;
  const existing = getStatusStackEffects(actor, statusId);

  if (normalizedCount <= 0) {
    if (!existing.length) return false;
    const ids = existing.map((effect) => effect.id).filter(Boolean);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    return true;
  }

  if (!existing.length) {
    await createStatusStack(actor, statusId, normalizedCount);
    return true;
  }

  await collapseLegacyStatusStacks(actor, statusId, normalizedCount);
  return true;
}

export async function applyStatusEffectStackDelta(actor, statusId, delta) {
  const amount = Number(delta) || 0;
  if (!actor || !statusId || !amount) return;

  const currentCount = getStatusStackCount(actor, statusId);
  const nextCount = Math.max(currentCount + amount, 0);
  return setStatusStackCount(actor, statusId, nextCount);
}

export async function applyStatusEffectChange(
  actor,
  statusId,
  active,
  { overlay = false } = {},
) {
  if (!actor || !statusId) return;
  if (isStackableStatusEffect(statusId)) {
    return applyStatusEffectStackDelta(
      actor,
      statusId,
      active === false ? -1 : 1,
    );
  }
  return actor.toggleStatusEffect(statusId, { active, overlay });
}

export async function migrateLegacyStatusStackEffects() {
  if (!game.user?.isGM) return;
  for (const actor of game.actors ?? []) {
    for (const statusId of STACKABLE_STATUS_EFFECT_IDS) {
      const existing = getStatusStackEffects(actor, statusId);
      if (!existing.length) continue;

      const hasLegacyDuplicates = existing.length > 1;
      const missingCounterFlag = existing.some((effect) => {
        const value = effect.getFlag(
          STACK_COUNT_FLAG_SCOPE,
          STACK_COUNT_FLAG_KEY,
        );
        return !Number.isFinite(Number.parseInt(value, 10));
      });
      if (!hasLegacyDuplicates && !missingCounterFlag) continue;

      await collapseLegacyStatusStacks(
        actor,
        statusId,
        getStatusStackCount(actor, statusId),
      );
    }
  }
}

export const updateStatusEffects = () => {
  CONFIG.statusEffects = STATUS_DEFINITIONS.map(
    ({ id, labelKey, icon }, index) =>
      createStatusEffect(id, labelKey, icon, getStatusOrder(id, index)),
  );
};
