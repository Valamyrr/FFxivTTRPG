export const FFXIV_SUMMON_SOCKET_TYPE = "summonActor";

export function getSummonTokenDisposition(token) {
  const seen = new Set([token.id]);
  let summon = token.flags?.ffxiv?.summon;
  while (summon) {
    const source = token.parent?.tokens?.get(summon.sourceTokenId);
    if (!source) {
      const actor = summon.sourceActorUuid
        ? fromUuidSync(summon.sourceActorUuid, { strict: false })
        : null;
      const disposition = actor?.token?.disposition ?? actor?.prototypeToken?.disposition;
      return Number.isFinite(disposition) ? disposition : null;
    }
    if (seen.has(source.id)) return null;
    seen.add(source.id);
    token = source;
    summon = token.flags?.ffxiv?.summon;
  }
  return seen.size > 1 && Number.isFinite(token.disposition) ? token.disposition : null;
}

export async function syncSummonTokenDispositions(scene) {
  if (!scene) return;
  const updates = [];
  for (const token of scene.tokens) {
    const disposition = getSummonTokenDisposition(token);
    if (!Number.isFinite(disposition) || token.disposition === disposition) continue;
    updates.push({ _id: token.id, disposition });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
}

export function getSummonerCombatant(combatant) {
  const combat = combatant?.parent;
  if (!combat?.combatants) return null;

  const summonerId = combatant.flags?.ffxiv?.summonerId;
  const summon = combatant.token?.flags?.ffxiv?.summon;
  if (!summonerId && !summon) return null;

  const summoner = summonerId
    ? combat.combatants.get(summonerId)
    : getSourceCombatant(combat, summon, combatant.sceneId);
  return summoner?.id !== combatant.id ? summoner ?? null : null;
}

export async function createSummonTokenFromRequest({
  sceneId,
  tokenData,
  combatData = null,
}) {
  const scene = game.scenes.get(sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} not found.`);

  const data = foundry.utils.deepClone(tokenData);
  const disposition = getSummonTokenDisposition({
    id: data._id,
    parent: scene,
    flags: { ffxiv: { summon: data.flags?.ffxiv?.summon ?? combatData } },
  });
  if (Number.isFinite(disposition)) data.disposition = disposition;

  const created = await scene.createEmbeddedDocuments("Token", [data]);
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

  const sourceCombatant = getSourceCombatant(combat, combatData, sceneId);
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
      flags: { ffxiv: { summonerId: sourceCombatant.id } },
    }]);
  if (!summonCombatant) return;

  if (existing) {
    await combat.updateEmbeddedDocuments("Combatant", [{
      _id: existing.id,
      "flags.ffxiv.summonerId": sourceCombatant.id,
    }]);
  }
}

function getSourceCombatant(combat, combatData = {}, sceneId = null) {
  const sourceTokenId = String(combatData.sourceTokenId ?? "").trim();
  const sourceActorUuid = String(combatData.sourceActorUuid ?? "").trim();
  const sourceActorId = String(combatData.sourceActorId ?? "").trim();

  return combat.combatants.find((combatant) => {
    if (sceneId && combatant.sceneId !== sceneId) return false;
    if (sourceTokenId) return combatant.tokenId === sourceTokenId;
    const actor = combatant.actor;
    if (sourceActorUuid && actor?.uuid === sourceActorUuid) return true;
    return sourceActorId && combatant.actorId === sourceActorId;
  }) ?? null;
}
