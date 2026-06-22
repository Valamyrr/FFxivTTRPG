export const FFXIV_SUMMON_SOCKET_TYPE = "summonActor";

export async function createSummonTokenFromRequest({
  sceneId,
  tokenData,
  combatData = null,
}) {
  const scene = game.scenes.get(sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} not found.`);

  const created = await scene.createEmbeddedDocuments("Token", [
    foundry.utils.deepClone(tokenData),
  ]);
  const token = created[0] ?? null;
  if (token && combatData) await addSummonedTokenToCombat(token, combatData);
  return token;
}

async function addSummonedTokenToCombat(token, combatData = {}) {
  const combat = game.combat;
  if (!combat || !token) return;

  const sceneId = token.parent?.id ?? token.scene?.id ?? canvas?.scene?.id;
  const tokenId = token.id ?? token._id;
  if (!sceneId || !tokenId) return;

  const sourceCombatant = getSourceCombatant(combat, combatData);
  if (!sourceCombatant) return;

  const existing = combat.combatants.find((combatant) =>
    combatant.tokenId === tokenId && combatant.sceneId === sceneId,
  );
  const [summonCombatant] = existing
    ? [existing]
    : await combat.createEmbeddedDocuments("Combatant", [{
      sceneId,
      tokenId,
      actorId: token.actor?.id ?? token.actorId ?? null,
      hidden: token.hidden ?? false,
    }]);
  if (!summonCombatant) return;

  await placeCombatantBeforeSource(combat, summonCombatant, sourceCombatant);
}

function getSourceCombatant(combat, combatData = {}) {
  const sourceTokenId = String(combatData.sourceTokenId ?? "").trim();
  const sourceActorUuid = String(combatData.sourceActorUuid ?? "").trim();
  const sourceActorId = String(combatData.sourceActorId ?? "").trim();

  return combat.combatants.find((combatant) => {
    if (sourceTokenId && combatant.tokenId === sourceTokenId) return true;
    const actor = combatant.actor;
    if (sourceActorUuid && actor?.uuid === sourceActorUuid) return true;
    return sourceActorId && combatant.actorId === sourceActorId;
  });
}

async function placeCombatantBeforeSource(combat, summonCombatant, sourceCombatant) {
  const activeCombatantId = combat.combatant?.id ?? null;
  const ordered = Array.from(combat.turns ?? combat.combatants);
  const withoutSummon = ordered.filter((combatant) => combatant.id !== summonCombatant.id);
  const sourceIndex = withoutSummon.findIndex(
    (combatant) => combatant.id === sourceCombatant.id,
  );
  if (sourceIndex < 0) return;

  withoutSummon.splice(sourceIndex, 0, summonCombatant);
  const count = withoutSummon.length;
  await combat.updateEmbeddedDocuments(
    "Combatant",
    withoutSummon.map((combatant, index) => ({
      _id: combatant.id,
      initiative: count - index,
    })),
  );

  if (!activeCombatantId) return;
  const nextTurns = combat.turns ?? withoutSummon;
  const turn = nextTurns.findIndex((combatant) => combatant.id === activeCombatantId);
  if (turn >= 0 && turn !== combat.turn) await combat.update({ turn });
}
