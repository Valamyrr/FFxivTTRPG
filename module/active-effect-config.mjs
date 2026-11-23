import { toArray } from "./helpers/collections.mjs";
import { editAutomationData } from "./helpers/automation-editor.mjs";

const { ActiveEffectConfig } = foundry.applications.sheets;
const { footer, ...effectParts } = ActiveEffectConfig.PARTS;
const EXPIRY_FLAGS = [
  "expireAtTurnStart",
  "expireAtTurnEnd",
  "expireAtRoundEnd",
  "expireAtCombatantTurnEnd",
  "expireAtCombatantTurnStart",
];

const AUTOMATION_FIELDS = [
  { path: "expireAtSourceTurnStart", label: "SourceTurnStart", type: "checkbox" },
  { path: "expireAtPhaseEnd", label: "PhaseEnd", type: "checkbox" },
  { path: "expireOnAbilityUse", label: "AbilityUse", type: "checkbox" },
  { path: "damage.reroll", label: "DamageReroll", type: "checkbox" },
  { path: "check.rerollMax", label: "CheckRerollMax", type: "number" },
  { path: "critical.targetReduction", label: "TargetCriticalReduction", type: "number" },
  { path: "critical.alliesOnly", label: "AlliesOnly", type: "checkbox" },
  { path: "healing.convertBarrier", label: "ConvertBarrier", type: "checkbox" },
  { path: "healing.dice.count", label: "HealingDiceCount", type: "number", clearPath: "healing.dice" },
  { path: "healing.dice.range", label: "HealingDiceRange", type: "number" },
  { path: "healing.trigger.formula", label: "TriggeredHealing", type: "text", clearPath: "healing.trigger" },
  { path: "mpRecovery.mult", label: "MPRecoveryMultiplier", type: "number" },
  { path: "mpRecovery.override", label: "MPRecoveryOverride", type: "number" },
  { path: "mpRecovery.suppress", label: "SuppressMPRecovery", type: "checkbox" },
  { path: "mpRecovery.firstRoundOfPhase", label: "FirstRoundOfPhase", type: "checkbox" },
  { path: "status.preventEnfeeblement", label: "PreventEnfeeblement", type: "checkbox" },
];

const AUTOMATION_RULE_GROUPS = [
  {
    path: "damage.application", label: "DamageApplication", initial: { operation: "subtract", amount: 1 },
    fields: [
      { path: "operation", label: "Operation" },
      { path: "amount", label: "Amount", type: "number" },
      { path: "formula", label: "Formula" },
      { path: "percent", label: "Percent", type: "number" },
      { path: "fraction", label: "Fraction", type: "number" },
      { path: "sourceNames", label: "SourceAbilities", list: true },
      { path: "sourceActorNames", label: "SourceActors", list: true },
      { path: "sourceTags", label: "Tags", list: true },
      { path: "reflect.fraction", label: "ReflectFraction", type: "number" },
      { path: "reflect.sourceTags", label: "ReflectTags", list: true },
      { path: "consume", label: "Consume", type: "checkbox" },
    ],
  },
  ...["outgoing", "incoming"].map((channel) => ({
    path: `healing.${channel}`, label: channel === "outgoing" ? "OutgoingHealing" : "IncomingHealing", initial: { flat: 1 },
    fields: [
      { path: "flat", label: "FlatBonus", type: "number" },
      { path: "abilities", label: "Abilities", list: true },
      { path: "consume", label: "Consume", type: "checkbox" },
    ],
  })),
  {
    path: "mpCost.reductions", label: "MPCostReductions", initial: { override: 0 },
    fields: [
      { path: "override", label: "MPCostOverride", type: "number" },
      { path: "abilityNames", label: "Abilities", list: true },
      { path: "tags", label: "Tags", list: true },
      { path: "resource", label: "Resource" },
      { path: "amount", label: "Amount", type: "number" },
      { path: "reduction", label: "MPCostReduction", type: "number" },
      { path: "minCost", label: "MinimumMPCost", type: "number" },
      { path: "maxApplications", label: "MaxApplications", type: "number" },
      { path: "consume", label: "Consume", type: "checkbox" },
    ],
  },
  {
    path: "critical.force", label: "ForcedCriticals", initial: { always: true, rolls: ["base"] },
    fields: [
      { path: "always", label: "Always", type: "checkbox" },
      { path: "rolls", label: "Rolls", list: true },
      { path: "abilityNames", label: "Abilities", list: true },
      { path: "tags", label: "Tags", list: true },
      { path: "requires", label: "Requires", list: true },
      { path: "requiresAny", label: "RequiresAny", list: true },
      { path: "forbids", label: "Forbids", list: true },
      { path: "consume", label: "Consume", type: "checkbox" },
    ],
  },
  {
    path: "mpRecovery.onDamage", label: "MPRecoveryOnDamage", initial: { amount: 1 },
    fields: [
      { path: "amount", label: "Amount", type: "number" },
      { path: "tags", label: "Tags", list: true },
    ],
  },
];

export class FFXIVActiveEffectConfig extends ActiveEffectConfig {
  static DEFAULT_OPTIONS = {
    actions: {
      addModifier: FFXIVActiveEffectConfig._onAddModifier,
      removeModifier: FFXIVActiveEffectConfig._onRemoveModifier,
      editAutomationData: FFXIVActiveEffectConfig._onEditAutomationData,
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
    const listText = (value) => toArray(value).map((entry) =>
      typeof entry === "object" ? entry?.name ?? entry?.key ?? "" : entry,
    ).join(", ");
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
        bonusRolesText: listText(entry.bonus?.roles),
        bonusJobsText: listText(entry.bonus?.jobs),
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
    partContext.automationFields = AUTOMATION_FIELDS.map((field) => ({
      ...field,
      value: foundry.utils.getProperty(flags, field.path) ?? "",
      formula: field.path.endsWith(".formula"),
    }));
    partContext.automationRuleGroups = AUTOMATION_RULE_GROUPS.map((group) => ({
      ...group,
      entries: this._getAutomationRuleEntries(group).map((entry) => ({
        fields: group.fields.map((field) => ({
          ...field,
          type: field.type ?? "text",
          formula: field.path === "formula",
          value: field.list ? listText(foundry.utils.getProperty(entry, field.path))
            : foundry.utils.getProperty(entry, field.path) ?? "",
        })),
      })),
    }));
    return partContext;
  }

  _getAutomationRuleEntries(group) {
    let data = this.document.getFlag("ffxiv", group.path);
    if (group.path === "critical.force" && data === true) return [{ always: true }];
    if (group.path === "mpCost.reductions") data ??= this.document.getFlag("ffxiv", "mpCost.reduction");
    if (data && typeof data === "object" && !Array.isArray(data) &&
      !group.fields.some((field) => foundry.utils.hasProperty(data, field.path))) data = Object.values(data);
    return toArray(data).filter((entry) => entry && typeof entry === "object").map((entry) => foundry.utils.deepClone(entry));
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
        const entry = foundry.utils.deepClone(current[index] ?? {});
        for (const field of ["formula", "flat", "minimum", "amount", "rolls", "abilities", "tags", "consume", "damageOnly", "bonus.flat", "bonus.roles", "bonus.jobs", "bonus.companions"]) {
          const nestedValue = foundry.utils.getProperty(fields, field);
          if (nestedValue !== undefined && field.startsWith("bonus.")) {
            const value = field === "bonus.flat" ? (nestedValue === "" || nestedValue === null ? undefined : Number(nestedValue))
              : field === "bonus.companions" ? nestedValue === true : list(nestedValue);
            const currentValue = foundry.utils.getProperty(entry, field);
            if ((field === "bonus.flat" && value !== undefined) || currentValue !== undefined ||
              (Array.isArray(value) ? value.length : value)) foundry.utils.setProperty(entry, field, value);
            continue;
          }
          if (!(field in fields)) continue;
          const value = fields[field] ?? "";
          if (["consume", "damageOnly"].includes(field)) {
            if (entry[field] !== undefined || value === true) entry[field] = value === true;
          } else if (["rolls", "abilities", "tags"].includes(field)) {
            const values = list(value);
            if (entry[field] !== undefined || values.length) entry[field] = values;
          }
          else if (["flat", "minimum", "amount"].includes(field)) {
            if (value !== "" && Number.isFinite(Number(value))) entry[field] = Number(value);
            else delete entry[field];
          } else if (entry[field] !== undefined || String(value).trim()) entry[field] = String(value).trim();
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
        if (fields.bonus && (fields.bonus.flat === "" || fields.bonus.flat === null)) delete entry.bonus;
        return entry;
      });
      if (!foundry.utils.equals(current, entries)) foundry.utils.setProperty(flags, path, entries);
    }
    const currentExpiry = EXPIRY_FLAGS.find((key) => this.document.getFlag("ffxiv", key)) ?? "";
    if (data.expiry !== currentExpiry) {
      for (const key of EXPIRY_FLAGS) {
        if (data.expiry === key) flags[key] = true;
        else if (this.document.getFlag("ffxiv", key) !== undefined) flags[key] = false;
      }
    }
    const requirementBypass = list(data.requirementBypass);
    if (requirementBypass.length || this.document.getFlag("ffxiv", "requirementBypass") !== undefined) flags.requirementBypass = requirementBypass;
    const effectKey = String(data.effectKey ?? "").trim();
    if (effectKey || this.document.getFlag("ffxiv", "effectKey") !== undefined) flags.effectKey = effectKey;
    const enmityPenalty = data.enmityPenalty ?? "";
    if (data.enmityPenalty !== undefined && (enmityPenalty !== "" || this.document.getFlag("ffxiv", "enmity.checkPenalty") !== undefined)) {
      flags.enmity = enmityPenalty === ""
        ? { "-=checkPenalty": null }
        : { checkPenalty: Number(enmityPenalty) || 0 };
    }
    const mpRecovery = data.mpRecovery ?? "";
    if (data.mpRecovery !== undefined && (mpRecovery !== "" || this.document.getFlag("ffxiv", "mpRecovery.flat") !== undefined)) {
      flags.mpRecovery = mpRecovery === "" ? { "-=flat": null } : { flat: Number(mpRecovery) || 0 };
    }
    for (const field of AUTOMATION_FIELDS) {
      const rawValue = foundry.utils.getProperty(data.values, field.path);
      if (rawValue === undefined || (field.path === "healing.dice.range" &&
        ["", null].includes(foundry.utils.getProperty(data.values, "healing.dice.count")))) continue;
      const value = rawValue ?? "";
      const current = this.document.getFlag("ffxiv", field.path);
      if (field.type === "checkbox") {
        if (current !== undefined || value === true) foundry.utils.setProperty(flags, field.path, value === true);
      } else if (value !== "") {
        foundry.utils.setProperty(flags, field.path, field.type === "number" ? Number(value) : String(value).trim());
      } else if (current !== undefined) {
        const path = (field.clearPath ?? field.path).split(".");
        path[path.length - 1] = `-=${path.at(-1)}`;
        foundry.utils.setProperty(flags, path.join("."), null);
      }
    }
    for (const group of AUTOMATION_RULE_GROUPS) {
      const rows = foundry.utils.getProperty(data.rules, group.path);
      if (!rows?.present) continue;
      const current = this._getAutomationRuleEntries(group);
      const entries = Object.values(rows.entries ?? {}).map((fields, index) => {
        const entry = foundry.utils.deepClone(current[index] ?? {});
        for (const field of group.fields) {
          const rawValue = foundry.utils.getProperty(fields, field.path);
          if (rawValue === undefined) continue;
          const value = rawValue ?? "";
          const previous = foundry.utils.getProperty(entry, field.path);
          if (field.type === "checkbox") {
            if (previous !== undefined || value === true) foundry.utils.setProperty(entry, field.path, value === true);
          } else if (field.list) {
            if (toArray(previous).map((entry) => typeof entry === "object" ? entry?.name ?? entry?.key ?? "" : entry).join(", ") === String(value).trim()) continue;
            const values = list(value);
            if (previous !== undefined || values.length) foundry.utils.setProperty(entry, field.path, values);
          } else if (value !== "") {
            foundry.utils.setProperty(entry, field.path, field.type === "number" ? Number(value) : String(value).trim());
          } else if (previous !== undefined) foundry.utils.deleteProperty(entry, field.path);
        }
        return entry;
      });
      if (!foundry.utils.equals(current, entries)) foundry.utils.setProperty(flags, group.path, entries);
    }
    return submitData;
  }

  async _editModifier(target, remove) {
    if (!this.isEditable) return;
    const path = target.dataset.flag;
    const group = AUTOMATION_RULE_GROUPS.find((group) => group.path === path);
    if (!group && !["damageFormula", "damageDice.minimum", "check.advantage"].includes(path)) return;
    const formData = new foundry.applications.ux.FormDataExtended(this.form);
    const data = this._processFormData(null, this.form, formData);
    const entries = toArray(foundry.utils.getProperty(data, `flags.ffxiv.${path}`) ??
      (group ? this._getAutomationRuleEntries(group) : this._getModifierEntries(path)));
    if (remove) entries.splice(Number(target.dataset.index), 1);
    else entries.push(group ? foundry.utils.deepClone(group.initial) : path === "damageFormula"
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

  static async _onEditAutomationData() {
    if (!this.isEditable) return;
    await this.submit();
    return editAutomationData(this.document);
  }
}
