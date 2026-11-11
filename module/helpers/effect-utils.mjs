export function getLegacyActiveEffectChangeMode(change) {
  if (!change || typeof change !== "object") return undefined;
  const sourceMode = change._source?.mode;
  if (sourceMode !== undefined) return sourceMode;
  return Object.getOwnPropertyDescriptor(change, "mode")?.value;
}

export function getActiveEffectChangeType(change) {
  if (!change || typeof change !== "object") return change;
  return change.type ?? getLegacyActiveEffectChangeMode(change);
}

export function isLegacySubtractActiveEffectChangeMode(mode) {
  const text = String(mode ?? "").trim().toLowerCase();
  return text === "6" || text === "subtract";
}

export function isLegacySubtractActiveEffectChangeType(type) {
  return String(type ?? "").trim().toLowerCase() === "custom.6";
}

export function getTurnsUntilActorTurnEnd(actor, combat) {
  const turns = combat?.turns ?? [];
  if (!actor || !turns.length) return 1;

  const currentTurn = Number.isInteger(combat.turn) ? combat.turn : 0;
  const targetTurn = turns.findIndex((combatant) =>
    isSameActorDocument(combatant.actor, actor),
  );
  if (targetTurn < 0) return 1;
  if (targetTurn >= currentTurn) return targetTurn - currentTurn + 1;
  return turns.length - currentTurn + targetTurn + 1;
}

function isSameActorDocument(first, second) {
  return (
    first &&
    second &&
    (first === second ||
      (first.uuid && second.uuid && first.uuid === second.uuid) ||
      (first.id && second.id && first.id === second.id))
  );
}
