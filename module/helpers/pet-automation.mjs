import { isAbilityAutomationEnabled, isCombatAutomationEnabled } from "./automation.mjs";
import { getSourceText, matchesContentKey } from "./content-keys.mjs";
import { getActorPets } from "./job-resources.mjs";

function getPetForm(actor) {
  return actor?.flags?.ffxiv?.petForm ?? String(getSourceText(actor, "name") ?? "").replace(/\s*\(LV[^)]*\)\s*$/i, "");
}

export async function preparePetAction(item) {
  const data = item.flags?.ffxiv?.pet;
  if (!isAbilityAutomationEnabled() || !data) return null;
  const pets = getActorPets(item.parent);
  const ids = new Set(pets.map((pet) => pet.id));
  const token = Array.from(globalThis.canvas?.scene?.tokens ?? []).find((entry) => ids.has(entry.actorId));
  if (!token || (data.requiresForm && getPetForm(token.actor) !== data.requiresForm)) {
    ui.notifications.warn(game.i18n.localize("FFXIV.Abilities.PetUnavailable"));
    return false;
  }
  let form = data.transform;
  if (Array.isArray(form)) {
    form = await foundry.applications.api.DialogV2.prompt({
      window: { title: item.name },
      content: `<select name="form">${form.map((name) =>
        `<option value="${foundry.utils.escapeHTML(name)}">${foundry.utils.escapeHTML(name)}</option>`,
      ).join("")}</select>`,
      ok: { callback: (_event, button) => button.form.elements.form.value },
      rejectClose: false,
    });
    if (!data.transform.includes(form)) return false;
  }
  const actor = form ? pets.find((pet) => getPetForm(pet) === form) : null;
  if (form && !actor) {
    ui.notifications.warn(game.i18n.localize("FFXIV.Abilities.PetUnavailable"));
    return false;
  }
  return { token, actor, data };
}

export async function applyPetAction(item, action) {
  if (!action) return;
  const { token, actor, data } = action;
  if (actor || data.hide) {
    const combat = game.combat;
    const previous = token.flags?.ffxiv?.petTransformation;
    const state = previous ? foundry.utils.deepClone(previous) : {
      actorId: token.actorId,
      actorLink: token.actorLink,
      name: token.name,
      texture: token.texture.src,
      hidden: token.hidden,
      ownerActorUuid: item.parent.uuid,
    };
    state.combatId = combat?.id ?? null;
    state.round = combat?.round ?? 0;
    state.turn = combat?.turn ?? 0;
    state.timing = data.hide ? "turnEnd" : "turnStart";
    const updates = { "flags.ffxiv.petTransformation": state };
    if (actor) Object.assign(updates, {
      actorId: actor.id,
      actorLink: true,
      name: actor.name,
      "texture.src": actor.prototypeToken?.texture?.src || actor.img,
    });
    if (data.hide) updates.hidden = true;
    await token.update(updates);
    const combatant = combat?.combatants?.find((entry) => entry.tokenId === token.id);
    if (actor && combatant) await combatant.update({ actorId: actor.id });
  }
  if (data.useAbility) {
    const ability = token.actor?.items?.find((entry) => matchesContentKey(entry, data.useAbility));
    if (ability) await ability.roll();
  }
}

export async function restorePetForms(combat, combatant = null, timing = "phaseEnd", context = {}) {
  if (!isCombatAutomationEnabled()) return;
  const scene = combat?.scene ?? globalThis.canvas?.scene;
  for (const token of Array.from(scene?.tokens ?? [])) {
    const data = token.flags?.ffxiv?.petTransformation;
    if (!data || (data.combatId && data.combatId !== combat?.id)) continue;
    if (timing !== "phaseEnd") {
      if (data.timing !== timing) continue;
      if (timing === "turnEnd" && data.ownerActorUuid !== combatant?.actor?.uuid) continue;
      if (timing === "turnStart") {
        if (combatant?.tokenId !== token.id) continue;
        const round = Number(context.round ?? combat.round);
        const turn = Number(context.turn ?? combat.turn);
        if (round < data.round || (round === data.round && turn <= data.turn)) continue;
      }
    }
    await token.update({
      actorId: data.actorId,
      actorLink: data.actorLink,
      name: data.name,
      "texture.src": data.texture,
      hidden: data.hidden,
      "flags.ffxiv.-=petTransformation": null,
    });
    const petCombatant = combat?.combatants?.find((entry) => entry.tokenId === token.id);
    if (petCombatant) await petCombatant.update({ actorId: data.actorId });
  }
}
