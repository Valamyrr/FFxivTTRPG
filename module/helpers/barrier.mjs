import { getActiveGM } from "./socket.mjs";
import { applyActorJobResourceDelta } from "./job-resources.mjs";

function getLockedBarrier(actor) {
  return Array.from(actor.effects ?? []).find(
    (effect) => !effect.disabled && effect.getFlag("ffxiv", "barrierLock"),
  );
}

export async function applyHealingBarrier(actor, amount, { sourceActor = null, sourceItem = null } = {}) {
  const recipient = sourceItem?.getFlag("ffxiv", "barrier.applyTo") === "self"
    ? sourceActor ?? (sourceItem.parent?.documentName === "Actor" ? sourceItem.parent : null)
    : actor;
  if (!recipient) return null;
  return applyBarrier(recipient, amount, { operation: "grant", sourceItem });
}

export async function applyBarrier(
  actor,
  amount,
  { operation = "grant", sourceItem = null } = {},
) {
  const current = Math.max(Number(actor.system?.barrier?.value) || 0, 0);
  if (getLockedBarrier(actor)) return { current, next: current };
  amount = Math.max(Math.floor(Number(amount) || 0), 0);
  const config = sourceItem?.getFlag("ffxiv", "barrier") ?? {};
  const barrierOperation = ["grant", "set", "max"].includes(config.operation)
    ? config.operation
    : operation;
  const next =
    barrierOperation === "set"
      ? amount
      : barrierOperation === "max"
        ? Math.max(current, amount)
        : current + amount;
  if (next !== current) await actor.update({ "system.barrier.value": next });
  if (config.lock === true && next > 0) {
    const sourceActor = sourceItem?.parent;
    const combatant = game.combat?.combatants?.find(
      (entry) => entry.actor?.uuid === sourceActor?.uuid,
    );
    const flags = {
      ffxiv: {
        barrierLock: {
          sourceActorUuid: sourceActor?.uuid,
          onDepleted: foundry.utils.deepClone(config.onDepleted ?? []),
        },
      },
    };
    if (config.expireAtSourceTurnStart === true && combatant)
      flags.ffxiv.expireAtCombatantTurnStart = {
        combatId: String(game.combat.id),
        combatantId: String(combatant.id),
        round: game.combat.round,
        turn: game.combat.turn,
      };
    await actor.createEmbeddedDocuments("ActiveEffect", [
      {
        name: sourceItem.name,
        img: sourceItem.img,
        origin: sourceItem.uuid,
        changes: [],
        flags,
      },
    ]);
  }
  return { current, next };
}

// One client handles cross-actor consequences, including GM-mediated damage.
function isBarrierAuthority(actor) {
  const gm = getActiveGM();
  return gm ? gm.id === game.user.id : actor.isOwner;
}

export function initBarrierAutomation() {
  Hooks.on("updateActor", async (actor, changes) => {
    const value =
      changes["system.barrier.value"] ??
      foundry.utils.getProperty(changes, "system.barrier.value");
    if (value === undefined || Number(value) > 0 || !isBarrierAuthority(actor))
      return;
    const effect = getLockedBarrier(actor);
    if (!effect) return;
    const lock = effect.getFlag("ffxiv", "barrierLock");
    await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
    const rules = Array.isArray(lock.onDepleted)
      ? lock.onDepleted
      : lock.onDepleted ? [lock.onDepleted] : [];
    for (const rule of rules) {
      const resource = String(rule?.resource ?? "").trim();
      const amount = Math.floor(Number(rule?.amount ?? 1));
      if (!resource || !Number.isFinite(amount) || amount <= 0) continue;
      const recipient = rule.recipient === "target"
        ? actor
        : lock.sourceActorUuid ? await fromUuid(lock.sourceActorUuid) : null;
      if (recipient?.documentName !== "Actor") continue;
      await applyActorJobResourceDelta(recipient, resource, amount);
    }
  });

  Hooks.on("deleteActiveEffect", async (effect) => {
    if (!effect.getFlag("ffxiv", "barrierLock")) return;
    const actor = effect.parent;
    if (actor?.documentName !== "Actor" || !isBarrierAuthority(actor)) return;
    if (Number(actor.system?.barrier?.value) > 0) {
      await actor.update({ "system.barrier.value": 0 });
    }
  });
}
