import { isAbilityAutomationEnabled, isCombatAutomationEnabled } from "./automation.mjs";
import { matchesContentKey } from "./content-keys.mjs";
import { debugError } from "./debug.mjs";
import { getActiveGM } from "./socket.mjs";
import { applyStatusEffectChange, hasStatus, recoverActorHealth } from "./status-effects.mjs";

const pendingHealing = new WeakMap();

export function getHealingModifiers(actor, channel, item) {
  if (!isAbilityAutomationEnabled()) return [];
  const result = [];
  for (const effect of actor?.allApplicableEffects?.() ?? []) {
    if (effect.disabled) continue;
    const data = effect.flags?.ffxiv?.healing?.[channel];
    for (const entry of Array.isArray(data) ? data : data ? [data] : []) {
      if (entry.abilities?.length && !entry.abilities.some((name) => matchesContentKey(item, name))) continue;
      result.push({ effect, entry });
    }
  }
  return result;
}

export async function consumeHealingModifiers(modifiers) {
  for (const { effect, entry } of modifiers ?? []) {
    if (entry.consume && effect.parent?.effects?.has(effect.id)) await effect.delete();
  }
}

export function getRoleDamageBonus(actor, entry) {
  const roles = entry.bonus?.roles ?? [];
  const jobs = entry.bonus?.jobs ?? [];
  const role = actor?.system?.role;
  const matched = roles.includes(role) || (actor?.type === "npc" && entry.bonus?.companions === true) ||
    actor?.items?.some((item) => item.type === "job" &&
      (roles.includes(item.system?.role) || jobs.includes(item.system?.job_name)));
  return Number(matched ? entry.bonus.flat : entry.flat) || 0;
}

export function getTargetCriticalReduction(targets) {
  const values = Array.from(targets ?? []).map((token) =>
    Math.max(0, ...Array.from(token.actor?.allApplicableEffects?.() ?? [])
      .filter((effect) => !effect.disabled)
      .map((effect) => Number(effect.flags?.ffxiv?.critical?.targetReduction) || 0)),
  );
  return values.length ? Math.min(...values) : 0;
}

function getToken(actor) {
  return Array.from(globalThis.canvas?.tokens?.placeables ?? []).find((token) => token.actor?.uuid === actor?.uuid);
}

function inHealingAura(actor, source, range) {
  const target = getToken(actor);
  const origin = getToken(source);
  if (!target || !origin || target.document.disposition !== origin.document.disposition) return false;
  const size = canvas.grid.size;
  return Math.max(Math.abs(target.center.x - origin.center.x), Math.abs(target.center.y - origin.center.y)) <= range * size;
}

export async function modifyRecoveryRoll(roll, item) {
  if (!isAbilityAutomationEnabled() || !item.parent) return roll;
  const healing = item.flags?.ffxiv?.healing?.roll === true;
  let effect;
  let count = 1;
  if (healing) {
    for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
      for (const candidate of token.actor?.allApplicableEffects?.() ?? []) {
        const data = candidate.flags?.ffxiv?.healing?.dice;
        if (candidate.disabled || !data || !inHealingAura(item.parent, token.actor, data.range ?? 2)) continue;
        if (!effect || data.count > count) {
          effect = candidate;
          count = data.count;
        }
      }
    }
  } else {
    effect = Array.from(item.parent.effects ?? []).find((candidate) =>
      !candidate.disabled && candidate.flags?.ffxiv?.damage?.reroll === true,
    );
  }
  if (!effect) return roll;
  const dice = roll.dice.flatMap((die) => die.results
    .filter((result) => result.active !== false && !result.rerolled && (!healing || (die.faces === 6 && result.result < 6)))
    .map((result) => ({ die, result })));
  if (!dice.length) return roll;
  const selected = await foundry.applications.api.DialogV2.prompt({
    window: { title: effect.name },
    content: `<p>${game.i18n.format("FFXIV.Abilities.ChooseEffectDice", { count })}</p><select name="dice" multiple>${dice.map(({ die, result }, index) =>
      `<option value="${index}">d${die.faces}: ${result.result}</option>`,
    ).join("")}</select>`,
    ok: { callback: (_event, button) => Array.from(button.form.elements.dice.selectedOptions).map((option) => Number(option.value)) },
    rejectClose: false,
  });
  if (!selected?.length || selected.length > count) return roll;
  for (const index of selected) {
    const entry = dice[index];
    if (!entry) continue;
    if (healing) entry.result.result = 6;
    else {
      const replacement = await new Roll(`1d${entry.die.faces}`).evaluate();
      entry.result.result = replacement.total;
    }
  }
  roll._total = roll._evaluateTotal();
  if (!healing) await effect.delete();
  return roll;
}

export async function resolveTriggeredHealing(actor, { phaseEnd = false } = {}) {
  const previous = pendingHealing.get(actor) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    if (!isAbilityAutomationEnabled()) return;
    for (const effect of Array.from(actor.effects ?? [])) {
      const data = effect.flags?.ffxiv?.healing?.trigger;
      if (effect.disabled || !data) continue;
      const health = Number(actor.system?.health?.value) || 0;
      const max = Number(actor.system?.health?.max) || 0;
      if (!phaseEnd && health * 2 > max) continue;
      await effect.delete();
      const roll = await new Roll(data.formula, actor.getRollData()).evaluate();
      await recoverActorHealth(actor, roll.total, { ffxivSkipHealingTrigger: true });
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: effect.name });
    }
  });
  pendingHealing.set(actor, pending);
  try { await pending; }
  finally { if (pendingHealing.get(actor) === pending) pendingHealing.delete(actor); }
}

export async function endHealingPhase(actors) {
  if (!isCombatAutomationEnabled()) return;
  for (const actor of actors) {
    await resolveTriggeredHealing(actor, { phaseEnd: true });
    const ids = Array.from(actor.effects ?? [])
      .filter((effect) => effect.flags?.ffxiv?.expireAtPhaseEnd === true)
      .map((effect) => effect.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

export function initHealingAutomation() {
  Hooks.on("updateActor", (actor, changes, options) => {
    if (options?.ffxivUndoApplication || options?.ffxivSkipHealingTrigger || !isCombatAutomationEnabled()) return;
    if (game.user.id !== getActiveGM()?.id || !foundry.utils.hasProperty(changes, "system.health.value")) return;
    if (hasStatus(actor, "knocked_out")) return;
    resolveTriggeredHealing(actor).then(async () => {
      if (Number(actor.system?.health?.value) <= 0 && !hasStatus(actor, "knocked_out")) {
        await applyStatusEffectChange(actor, "knocked_out", true);
      }
    }).catch((error) => debugError("Triggered healing failed:", error));
  });
  Hooks.on("createActiveEffect", (effect) => {
    if (game.user.id !== getActiveGM()?.id || !effect.flags?.ffxiv?.healing?.trigger) return;
    if (effect.parent?.documentName === "Actor")
      resolveTriggeredHealing(effect.parent).catch((error) => debugError("Triggered healing failed:", error));
  });
  Hooks.on("deleteCombat", (combat) => {
    if (game.user.id !== getActiveGM()?.id || !isCombatAutomationEnabled()) return;
    const actors = new Set(Array.from(combat.combatants ?? [], (entry) => entry.actor).filter(Boolean));
    endHealingPhase(actors).catch((error) => debugError("Phase healing failed:", error));
  });
}
