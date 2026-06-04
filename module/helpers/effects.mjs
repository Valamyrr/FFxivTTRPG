import {
  applyStatusEffectStackDelta,
  getStatusStackValue,
  isStackableStatusEffect,
} from "./status-effects.mjs";

/**
 * Manage Active Effect instances through an Actor or Item Sheet via effect control buttons.
 * @param {MouseEvent} event      The left-click event on the effect control
 * @param {Actor|Item} owner      The owning document which manages this effect
 */
export function onManageActiveEffect(event, owner, options = {}) {
  const render = options.render ?? true;
  event.preventDefault();
  const a = event.currentTarget;
  const li = a.closest("li");
  const effectType =
    li?.dataset?.effectType
    || a.closest("[data-effect-type]")?.dataset?.effectType;
  const effect = li?.dataset?.effectId
    ? owner.effects.get(li.dataset.effectId)
    : null;
  switch (a.dataset.action) {
    case "create": {
      const effectData = {
        name: game.i18n.format("DOCUMENT.New", {
          type: game.i18n.localize("DOCUMENT.ActiveEffect"),
        }),
        icon: "icons/svg/aura.svg",
        origin: owner.uuid,
        "duration.rounds":
          effectType === "temporary" ? 1 : undefined,
        disabled: effectType === "inactive",
      };
      if (owner?.documentName === "Item" && owner?.type === "ability") {
        effectData.name = owner.name;
        effectData.img = owner.img;
        effectData.icon = owner.img;
        effectData.transfer = false;
        effectData["flags.ffxiv.applyTo"] = "target";
        effectData["flags.ffxiv.applyAction"] = "add";
      }
      return owner.createEmbeddedDocuments("ActiveEffect", [
        effectData,
      ], { render });
    }
    case "edit":
      return effect.sheet.render({ force: true, focus: true });
    case "delete":
      return effect.delete({ render });
    case "toggle":
      return effect.update({ disabled: !effect.disabled }, { render });
    case "stack-increase":
    case "stack-decrease": {
      if (!effect || owner?.documentName !== "Actor") return;
      const statusId = getStackableStatusId(effect);
      if (!statusId) return;
      const delta = a.dataset.action === "stack-increase" ? 1 : -1;
      return applyStatusEffectStackDelta(owner, statusId, delta, {
        origin: effect.origin,
        sourceEffect: effect,
      });
    }
  }
}

/**
 * Prepare the data structure for Active Effects which are currently embedded in an Actor or Item.
 * @param {ActiveEffect[]} effects    A collection or generator of Active Effect documents to prepare sheet data for
 * @return {object}                   Data for rendering
 */
export function prepareActiveEffectCategories(effects) {
  const categories = {
    temporary: {
      type: "temporary",
      label: "FFXIV.CharacterSheet.EffectsTemporary",
      effects: [],
    },
    passive: {
      type: "passive",
      label: "FFXIV.CharacterSheet.EffectsPassive",
      effects: [],
    },
    inactive: {
      type: "inactive",
      label: "FFXIV.CharacterSheet.EffectsInactive",
      effects: [],
    },
    all: [],
  };

  for (let e of effects) {
    const statusId = getStackableStatusId(e);
    const stackable = Boolean(statusId);
    let effectType = "passive";
    let effectTypeLabel = categories.passive.label;
    if (e.disabled) {
      effectType = "inactive";
      effectTypeLabel = categories.inactive.label;
    } else if (e.isTemporary) {
      effectType = "temporary";
      effectTypeLabel = categories.temporary.label;
    }
    const viewEffect = {
      id: e.id,
      parent: e.parent,
      parentId: e.parent?.id ?? null,
      parentType: e.parent?.documentName ?? "",
      actorOwned: e.parent?.documentName === "Actor",
      icon: e.icon,
      img: e.img,
      name: e.name,
      sourceName: e.sourceName,
      duration: e.duration,
      disabled: e.disabled,
      type: effectType,
      typeLabel: effectTypeLabel,
      ffxivStackable: stackable,
      ffxivStackCount: stackable ? getStatusStackValue(e, 1, statusId) : 1,
      ffxivStatusId: statusId,
    };
    categories.all.push(viewEffect);
    if (effectType === "inactive") categories.inactive.effects.push(viewEffect);
    else if (effectType === "temporary") categories.temporary.effects.push(viewEffect);
    else categories.passive.effects.push(viewEffect);
  }
  return categories;
}

function getStackableStatusId(effect) {
  const statuses = effect?.statuses;
  if (!(statuses instanceof Set) || statuses.size !== 1) return null;
  const [statusId] = statuses;
  return isStackableStatusEffect(statusId) ? statusId : null;
}
