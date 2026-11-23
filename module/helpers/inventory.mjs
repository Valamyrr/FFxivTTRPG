import { isAbilityAutomationEnabled, isCombatAutomationEnabled } from "./automation.mjs";
import { applyBarrier } from "./barrier.mjs";
import {
  applyStatusEffectChange,
  applyStatusEffectStackDelta,
  hasStatus,
  recoverActorMana,
  removeActorEnfeeblement,
} from "./status-effects.mjs";

function activeItems(actor) {
  return Array.from(actor?.items ?? []).filter((item) =>
    ["augment", "consumable"].includes(item.type) && Number(item.system.quantity ?? 1) > 0,
  );
}

function effects(actor) {
  return Array.from(actor?.allApplicableEffects?.() ?? []).filter((effect) => !effect.disabled);
}

function inEncounter(actor) {
  return Boolean(game.combat?.started && game.combat.combatants.some((entry) => entry.actor?.uuid === actor?.uuid));
}

function hasTag(item, tag) {
  return item?.system?.tags?.includes(tag) ?? false;
}

function confirmEffect(source, text = "") {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: source.name },
    content: `<p>${text || game.i18n.format("FFXIV.Inventory.UseEffect", { name: foundry.utils.escapeHTML(source.name) })}</p>`,
    rejectClose: false,
  });
}

export function prepareInventoryData(actor) {
  if (!isAbilityAutomationEnabled()) return;
  const attributes = actor.system.secondary_attributes;
  if (!attributes) return;
  for (const effect of effects(actor)) {
    const amount = Number(effect.flags?.ffxiv?.inventory?.lowerDefense) || 0;
    if (!amount) continue;
    const defense = Number(attributes.defense?.value) || 0;
    const magicDefense = Number(attributes.magic_defense?.value) || 0;
    if (defense < magicDefense) attributes.defense.value += amount;
    else if (magicDefense < defense) attributes.magic_defense.value += amount;
  }
}

export async function prepareInventoryUse(item) {
  if (!isAbilityAutomationEnabled() || !item.parent) return true;
  const data = item.flags?.ffxiv?.inventory;
  if (data?.elementChoices) {
    const elements = ["Fire", "Ice", "Wind", "Earth", "Lightning", "Water"];
    const selected = await foundry.applications.api.DialogV2.prompt({
      window: { title: item.name },
      content: `<p>${game.i18n.format("FFXIV.Inventory.ChooseElements", { count: data.elementChoices })}</p><select name="elements" multiple>${elements.map((element) =>
        `<option value="${element}">${game.i18n.localize(`FFXIV.Tags.${element}Aspected`)}</option>`,
      ).join("")}</select>`,
      ok: { callback: (_event, button) => Array.from(button.form.elements.elements.selectedOptions, (option) => option.value) },
      rejectClose: false,
    });
    if (!selected || selected.length !== Number(data.elementChoices)) return false;
    const existing = Array.from(item.effects).find((effect) => effect.flags?.ffxiv?.inventory?.elementalVeil);
    const effectData = {
      name: item.name, img: item.img, transfer: true,
      flags: { ffxiv: {
        inventory: { elementalVeil: true },
        damage: { application: [{ amount: 1, sourceTags: selected.map((element) => `FFXIV.Tags.${element}Aspected`) }] },
      } },
    };
    if (existing) await existing.update(effectData);
    else await item.createEmbeddedDocuments("ActiveEffect", [effectData]);
  }
  if (data?.belt) {
    if (inEncounter(item.parent)) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Inventory.BeltRest"));
      return false;
    }
    const updates = activeItems(item.parent).filter((other) => other.flags?.ffxiv?.inventory?.belt)
      .map((other) => ({ _id: other.id, "flags.ffxiv.inventory.active": other.id === item.id }));
    await item.parent.updateEmbeddedDocuments("Item", updates);
  }
  return true;
}

export async function applyInventoryUse(item) {
  if (!isAbilityAutomationEnabled() || !item.parent) return;
  const actor = item.parent;
  const data = item.flags?.ffxiv?.inventory ?? {};
  if (data.manaRecovery) {
    const level = Number(actor.system.experience?.level?.value) || 0;
    const recovery = data.manaRecovery;
    const amount = recovery.level && level <= recovery.level ? recovery.lowLevelAmount : recovery.amount;
    await recoverActorMana(actor, Number(amount) || 0);
  }
  if (data.cleanse === "any") await removeActorEnfeeblement(actor);
  else if (data.cleanse === "dot") {
    const dots = Array.from(actor.effects).filter((effect) => effect.statuses.has("dot"));
    const id = dots.length === 1 ? dots[0].id : dots.length ? await foundry.applications.api.DialogV2.prompt({
      window: { title: item.name },
      content: `<select name="effect">${dots.map((effect) => `<option value="${effect.id}">${foundry.utils.escapeHTML(effect.name)}</option>`).join("")}</select>`,
      ok: { callback: (_event, button) => button.form.elements.effect.value }, rejectClose: false,
    }) : null;
    if (dots.some((effect) => effect.id === id)) await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
  } else if (data.cleanse) await applyStatusEffectChange(actor, data.cleanse, false);
  if (data.savingThrow) {
    const save = data.savingThrow;
    for (const target of new Set(Array.from(game.user.targets ?? [], (token) => token.actor).filter(Boolean))) {
      const roll = await target._rollAttribute("vitality");
      if (!roll || roll.total >= Number(save.cr)) continue;
      if (save.status === "dot") await applyStatusEffectStackDelta(target, "dot", Number(save.amount) || 3, { origin: item.uuid });
      else await applyStatusEffectChange(target, save.status, true, { origin: item.uuid });
    }
  }
  for (const effect of actor.effects ?? []) {
    if (effect.flags?.ffxiv?.linkedSourceItemId !== item.id || !effect.flags?.ffxiv?.inventory?.phaseOrNextCheck) continue;
    await effect.update({ "flags.ffxiv.expireAtPhaseEnd": inEncounter(actor) });
  }
  if (hasTag(item, "FFXIV.Tags.Meal")) {
    const belt = activeItems(actor).find((entry) => entry.flags?.ffxiv?.inventory?.active && entry.flags.ffxiv.inventory.mealBarrierRank);
    const amount = Number(actor.system.adventuring_rank?.[belt?.flags.ffxiv.inventory.mealBarrierRank]) || 0;
    if (amount > 0) {
      const targets = item.system.target === "Self" ? [actor] : Array.from(new Set(Array.from(game.user.targets ?? [], (token) => token.actor).filter(Boolean)));
      for (const target of targets) {
        const previous = Array.from(target.effects).find((effect) => effect.flags?.ffxiv?.inventory?.mealBarrier);
        if (previous) await previous.delete();
        await target.createEmbeddedDocuments("ActiveEffect", [{
          name: belt.name, img: belt.img, transfer: false,
          flags: { ffxiv: { expireOnRest: true, inventory: { mealBarrier: amount } } },
        }]);
      }
    }
  }
}

function checkEntries(actor, context) {
  const entries = [];
  for (const source of [...effects(actor), ...activeItems(actor)]) {
    const data = source.flags?.ffxiv?.inventory?.check;
    if (!data || (data.attribute && data.attribute !== context.attribute) ||
      (data.tag && !hasTag(context.item, data.tag)) || (data.special && !context.special)) continue;
    if (data.mpCost && !context.item) continue;
    entries.push({ source, data });
  }
  return entries;
}

export async function prepareInventoryCheck(actor, context = {}) {
  const result = { bonus: 0, advantage: 0, criticalReduction: 0, consumed: [] };
  if (!isAbilityAutomationEnabled()) return result;
  if (context.item) {
    for (const target of new Set(Array.from(game.user.targets ?? [], (token) => token.actor).filter(Boolean))) {
      const effect = effects(target).find((entry) => entry.flags?.ffxiv?.inventory?.incomingCheckPenalty);
      if (!effect) continue;
      result.bonus -= Number(effect.flags.ffxiv.inventory.incomingCheckPenalty) || 0;
      result.consumed.push(effect);
    }
  }
  for (const { source, data } of checkEntries(actor, context)) {
    if (data.after || (data.mpCost && Number(actor.system.mana?.value) < Number(data.mpCost))) continue;
    if (data.optional && !await confirmEffect(source)) continue;
    if (data.mpCost) await actor.update({ "system.mana.value": Number(actor.system.mana.value) - Number(data.mpCost) });
    result.bonus += Number(data.bonus) || 0;
    result.advantage += Number(data.advantage) || 0;
    if (data.consume || (source.flags?.ffxiv?.inventory?.phaseOrNextCheck && !inEncounter(actor))) result.consumed.push(source);
  }
  return result;
}

export async function finishInventoryCheck(actor, roll, result, context = {}) {
  if (!isAbilityAutomationEnabled()) return;
  for (const { source, data } of checkEntries(actor, context)) {
    if (!data.after) continue;
    const text = `${await roll.render()}<p>${game.i18n.format("FFXIV.Inventory.UseEffect", { name: foundry.utils.escapeHTML(source.name) })}</p>`;
    if (data.optional && !await confirmEffect(source, text)) continue;
    if (data.bonus) {
      const bonus = Number(data.bonus) || 0;
      roll.terms.push(new foundry.dice.terms.OperatorTerm({ operator: "+" }), new foundry.dice.terms.NumericTerm({ number: bonus }));
    }
    if (data.naturalBonus) {
      const die = roll.dice.find((die) => die.faces === 20);
      const active = die?.results.find((entry) => entry.active !== false);
      if (active) active.result += Number(data.naturalBonus);
    }
    result.criticalReduction += Number(data.criticalReduction) || 0;
    roll._total = roll._evaluateTotal();
    if (data.consume) result.consumed.push(source);
  }
  for (const effect of result.consumed) {
    if (effect.parent?.effects?.has(effect.id)) await effect.delete();
  }
}

export async function rerollInventoryDice(actor, rolls, scope) {
  if (!isAbilityAutomationEnabled()) return false;
  const effect = effects(actor).find((entry) => entry.flags?.ffxiv?.inventory?.reroll === scope);
  const dice = rolls.filter(Boolean).flatMap((roll) => roll.dice.flatMap((die) => die.results
    .filter((result) => result.active !== false && !result.rerolled && !result.ffxivRerolled)
    .map((result) => ({ die, result }))));
  if (!effect || !dice.length || !await confirmEffect(effect)) return false;
  for (const { die, result } of dice) {
    const replacement = await new Roll(`1d${die.faces}`).evaluate();
    result.result = replacement.total;
    result.ffxivRerolled = true;
  }
  for (const roll of rolls.filter(Boolean)) roll._total = roll._evaluateTotal();
  await effect.delete();
  return true;
}

export function getInventoryHealingBonus(actor, item) {
  if (!isAbilityAutomationEnabled() || !hasTag(item, "FFXIV.Tags.Consumable")) return 0;
  const belt = activeItems(actor).find((entry) => entry.flags?.ffxiv?.inventory?.active && entry.flags.ffxiv.inventory.healingRank);
  return Number(actor?.system.adventuring_rank?.[belt?.flags.ffxiv.inventory.healingRank]) || 0;
}

export async function startInventoryEncounter(combat) {
  if (!isCombatAutomationEnabled()) return;
  for (const actor of new Set(Array.from(combat.combatants, (entry) => entry.actor).filter(Boolean))) {
    await actor.unsetFlag("ffxiv", "inventoryTurns");
    for (const effect of actor.effects) {
      const amount = effect.flags?.ffxiv?.inventory?.mealBarrier;
      if (!amount) continue;
      await applyBarrier(actor, amount, { operation: "max" });
      await effect.update({ "flags.ffxiv.inventory.mealBarrier": 0, "flags.ffxiv.expireAtEncounterEnd": true });
    }
  }
}

export async function startInventoryTurn(combat, combatant, firstInStep) {
  if (!isCombatAutomationEnabled()) return;
  const actor = combatant.actor;
  if (!actor || hasStatus(actor, "knocked_out") || hasStatus(actor, "comatose")) return;
  const phase = Number(combat.flags?.ffxiv?.phaseRound ?? 1);
  const previous = actor.flags?.ffxiv?.inventoryTurns;
  const firstTurn = !previous || previous.combatId !== combat.id;
  const firstPhaseTurn = firstTurn || previous.phase !== phase;
  const sources = activeItems(actor);
  for (const item of sources) {
    const data = item.flags?.ffxiv?.inventory;
    if (firstTurn && data?.firstTurnSpeed) await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: item.name, img: item.img, transfer: false,
      changes: [{ key: "system.secondary_attributes.speed.value", mode: 2, value: String(data.firstTurnSpeed) }],
      flags: { ffxiv: { expireAtTurnEnd: true } },
    }]);
    if ((firstTurn || (firstPhaseTurn && data?.opener?.eachPhase)) && data?.opener) await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: item.name, img: item.img, transfer: false,
      flags: { ffxiv: { expireAtTurnEnd: true, inventory: { check: { advantage: 1, consume: true } } } },
    }]);
  }
  await actor.setFlag("ffxiv", "inventoryTurns", { combatId: combat.id, phase });
  if (!firstInStep) return;
  for (const target of new Set(Array.from(combat.combatants, (entry) => entry.actor).filter(Boolean))) {
    const stamp = `${combat.id}:${combat.round}`;
    if (target.flags?.ffxiv?.inventoryStep === stamp) continue;
    const padding = activeItems(target).map((item) => item.flags?.ffxiv?.inventory?.stepBarrier).filter(Boolean);
    if (padding.length) {
      const current = Number(target.system.barrier?.value) || 0;
      const amount = Math.max(...padding.map((data) => Number(data.amount) || 0));
      await applyBarrier(target, current > 0 && padding.some((data) => data.addExisting) ? current + amount : amount, { operation: "max" });
    }
    await target.setFlag("ffxiv", "inventoryStep", stamp);
  }
}

export async function expireInventoryEffects(actor, timing) {
  const ids = Array.from(actor.effects).filter((effect) =>
    effect.flags?.ffxiv?.[timing] === true ||
    (timing === "expireOnFullRest" && effect.flags?.ffxiv?.expireOnRest === true),
  ).map((effect) => effect.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

export function initInventoryAutomation() {
  Hooks.on("deleteCombat", async (combat) => {
    if (game.user.id !== game.users.activeGM?.id || !isCombatAutomationEnabled()) return;
    for (const actor of new Set(Array.from(combat.combatants, (entry) => entry.actor).filter(Boolean))) {
      await expireInventoryEffects(actor, "expireAtEncounterEnd");
    }
  });
}
