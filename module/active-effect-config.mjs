import { toArray } from "./helpers/collections.mjs";

const { ActiveEffectConfig } = foundry.applications.sheets;
const { footer, ...effectParts } = ActiveEffectConfig.PARTS;
const EXPIRY_FLAGS = [
  "expireAtTurnStart",
  "expireAtTurnEnd",
  "expireAtRoundEnd",
  "expireAtCombatantTurnEnd",
];

export class FFXIVActiveEffectConfig extends ActiveEffectConfig {
  static DEFAULT_OPTIONS = {
    actions: {
      addModifier: FFXIVActiveEffectConfig._onAddModifier,
      removeModifier: FFXIVActiveEffectConfig._onRemoveModifier,
    },
  };

  static PARTS = {
    ...effectParts,
    automation: {
      template: "systems/ffxiv/templates/effect/automation.hbs",
      scrollable: [""],
    },
    footer,
  };

  static TABS = {
    sheet: {
      ...ActiveEffectConfig.TABS.sheet,
      tabs: [
        ...ActiveEffectConfig.TABS.sheet.tabs,
        { id: "automation", icon: "fa-solid fa-wand-magic-sparkles", label: "FFXIV.EffectAutomation.Title" },
      ],
    },
  };

  _getModifierEntries(path) {
    return toArray(this.document.getFlag("ffxiv", path))
      .map((entry) => path === "check.advantage" && Number.isFinite(Number(entry))
        ? { amount: Number(entry) }
        : entry)
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => foundry.utils.deepClone(entry));
  }

  async _preparePartContext(partId, context) {
    const partContext = await super._preparePartContext(partId, context);
    if (partId !== "automation") return partContext;
    partContext.tab = partContext.tabs.automation;
    const flags = this.document.flags.ffxiv ?? {};
    const listText = (value) => toArray(value).join(", ");
    partContext.modifierGroups = [
      { path: "damageFormula", label: "FFXIV.EffectAutomation.DamageBonus", formula: true },
      { path: "damageDice.minimum", label: "FFXIV.EffectAutomation.DiceMinimum", minimum: true },
      { path: "check.advantage", label: "FFXIV.EffectAutomation.Advantage", advantage: true },
    ].map((group) => ({
      ...group,
      entries: this._getModifierEntries(group.path).map((entry) => ({
        ...entry,
        amount: entry.amount ?? entry.value,
        minimum: entry.minimum ?? entry.value,
        rollsText: listText(entry.rolls ?? entry.rollTypes ?? entry.appliesTo),
        abilitiesText: listText(entry.abilities ?? entry.abilityKeys),
        tagsText: listText(entry.tags ?? entry.tag),
      })),
    }));
    partContext.expiry = EXPIRY_FLAGS.find((key) => flags[key]) ?? "";
    const bypass = flags.requirementBypass;
    partContext.requirementBypass = listText(bypass && typeof bypass === "object" && !Array.isArray(bypass)
      ? bypass.keys ?? bypass.requirements ?? bypass.effects
      : bypass);
    partContext.mpRecovery = flags.mpRecovery?.flat ?? "";
    partContext.enmityPenalty = flags.enmity?.checkPenalty ?? "";
    partContext.effectKey = flags.effectKey ?? "";
    return partContext;
  }

  _processFormData(event, form, formData) {
    const submitData = super._processFormData(event, form, formData);
    const data = submitData.automation;
    if (!data) return submitData;
    delete submitData.automation;
    submitData.flags ??= {};
    submitData.flags.ffxiv ??= {};
    const flags = submitData.flags.ffxiv;
    const list = (value) => String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
    for (const path of ["damageFormula", "damageDice.minimum", "check.advantage"]) {
      const current = this._getModifierEntries(path);
      const entries = Object.values(foundry.utils.getProperty(data, path) ?? {}).map((fields, index) => {
        const entry = current[index] ?? {};
        for (const field of ["formula", "flat", "minimum", "amount", "rolls", "abilities", "tags"]) {
          if (!(field in fields)) continue;
          const value = fields[field];
          if (["rolls", "abilities", "tags"].includes(field)) entry[field] = list(value);
          else if (["flat", "minimum", "amount"].includes(field)) {
            if (value !== "" && Number.isFinite(Number(value))) entry[field] = Number(value);
            else delete entry[field];
          } else entry[field] = String(value ?? "").trim();
        }
        for (const [field, aliases] of Object.entries({
          rolls: ["rollTypes", "appliesTo"],
          abilities: ["abilityKeys"],
          tags: ["tag"],
        })) {
          if (field in fields) for (const alias of aliases) delete entry[alias];
        }
        if (path === "check.advantage" && "amount" in fields) delete entry.value;
        if (path === "damageDice.minimum" && "minimum" in fields) delete entry.value;
        return entry;
      });
      foundry.utils.setProperty(flags, path, entries);
    }
    const currentExpiry = EXPIRY_FLAGS.find((key) => this.document.getFlag("ffxiv", key)) ?? "";
    if (data.expiry !== currentExpiry) {
      for (const key of EXPIRY_FLAGS) {
        if (data.expiry === key) flags[key] = true;
        else if (this.document.getFlag("ffxiv", key) !== undefined) flags[key] = false;
      }
    }
    flags.requirementBypass = list(data.requirementBypass);
    flags.effectKey = String(data.effectKey ?? "").trim();
    if (data.enmityPenalty !== undefined && (data.enmityPenalty !== "" || this.document.getFlag("ffxiv", "enmity.checkPenalty") !== undefined)) {
      flags.enmity = data.enmityPenalty === ""
        ? { "-=checkPenalty": null }
        : { checkPenalty: Number(data.enmityPenalty) || 0 };
    }
    if (data.mpRecovery !== "" || this.document.getFlag("ffxiv", "mpRecovery.flat") !== undefined) {
      flags.mpRecovery = { flat: Number(data.mpRecovery) || 0 };
    }
    return submitData;
  }

  async _editModifier(target, remove) {
    if (!this.isEditable) return;
    const path = target.dataset.flag;
    if (!["damageFormula", "damageDice.minimum", "check.advantage"].includes(path)) return;
    const formData = new foundry.applications.ux.FormDataExtended(this.form);
    const data = this._processFormData(null, this.form, formData);
    const entries = foundry.utils.getProperty(data, `flags.ffxiv.${path}`) ?? [];
    if (remove) entries.splice(Number(target.dataset.index), 1);
    else entries.push(path === "damageFormula"
      ? { formula: "", rolls: ["base"] }
      : path === "check.advantage" ? { amount: 1 } : { minimum: 1, rolls: ["base"] });
    const updateData = {};
    foundry.utils.setProperty(updateData, `flags.ffxiv.${path}`, entries);
    await this.submit({ updateData });
    await this.render({ force: true });
  }

  static _onAddModifier(_event, target) {
    return this._editModifier(target, false);
  }

  static _onRemoveModifier(_event, target) {
    return this._editModifier(target, true);
  }
}
