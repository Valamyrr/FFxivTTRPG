import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from "../helpers/effects.mjs";
import { debugError, debugLog } from "../helpers/debug.mjs";
import { normalizeShopTier } from "../helpers/shop-tier.mjs";
import {
  getAbilitySubtype,
  ensureAbilitySubtypeTags,
  getSubtypeTagLabel,
} from "../helpers/ability-subtype.mjs";
import { isStackableStatusEffect } from "../helpers/status-effects.mjs";

const DEFAULT_SOUNDS = {
  soundNotificationFFXIV_deleteItem:
    "systems/ffxiv/assets/sfx/ffxiv-close-window.ogg",
  soundNotificationFFXIV_moveItem:
    "systems/ffxiv/assets/sfx/ffxiv-obtain-item.ogg",
  soundNotificationFFXIV_openSheet:
    "systems/ffxiv/assets/sfx/ffxiv-switch-target.ogg",
  soundNotificationFFXIV_closeSheet:
    "systems/ffxiv/assets/sfx/ffxiv-untarget.ogg",
};

import PopoutEditor from "../popout-editor.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const EDIT_MODE_ITEM_TYPES = new Set([
  "ability",
  "primary_ability",
  "secondary_ability",
  "instant_ability",
  "trait",
  "limit_break",
  "title",
]);

/**
 * ApplicationV2 implementation of the FFXIV item sheet.
 * @extends {ItemSheetV2}
 */
export class FFXIVItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  tabGroups = {
    primary: "description",
  };

  constructor(...args) {
    super(...args);
    this.options.window ??= {};
    this.options.window.resizable = !this._isLimitedDisplayMode();
    this.itemEditMode = false;
    this._expandedEffectRequirements = new Set();
    this._expandedEffectRules = new Set();
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["ffxiv", "sheet", "item"],
    position: {
      width: 520,
      height: 480,
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    window: {
      resizable: true,
    },
  };

  /** @override */
  static PARTS = {
    sheet: {
      template: "systems/ffxiv/templates/item/item-sheet.hbs",
      scrollable: [".sheet-body"],
    },
  };

  /** @override */
  get template() {
    const path = "systems/ffxiv/templates/item";
    const forceFullSheet = this.options?.ffxivForceFullSheet === true;
    if (this.item.type == "consumable") {
      if (
        !forceFullSheet &&
        (this.item.parent != null || this.item.flags["item-piles"])
      ) {
        return `${path}/item-sheet-dialog.hbs`;
      } else {
        return `${path}/item-consumable-sheet.hbs`;
      }
    }

    if (this.item.type == "ability") {
      const subtype = getAbilitySubtype(this.item);
      if (subtype === "limit_break") return `${path}/item-limitbreak-sheet.hbs`;
      return `${path}/item-ability-sheet.hbs`;
    }
    if (
      this.item.type == "primary_ability" ||
      this.item.type == "secondary_ability" ||
      this.item.type == "instant_ability"
    ) {
      return `${path}/item-ability-sheet.hbs`;
    }
    if (this.item.type == "trait") {
      return `${path}/item-trait-sheet.hbs`;
    }
    if (this.item.type == "limit_break") {
      return `${path}/item-limitbreak-sheet.hbs`;
    }
    if (this.item.type == "title") {
      return `${path}/item-title-sheet.hbs`;
    }
    if (this.item.type == "minion") {
      return `${path}/item-minion-sheet.hbs`;
    }
    if (this.item.type == "pet") {
      return `${path}/item-pet-sheet.hbs`;
    }
    if (this.item.type == "augment") {
      return `${path}/item-augment-sheet.hbs`;
    }
    if (this.item.type == "job") {
      return `${path}/item-job-sheet.hbs`;
    }
    if (this.item.type == "gear") {
      if (
        !forceFullSheet &&
        this.item.parent != null
      ) {
        return `${path}/item-sheet-dialog-gear.hbs`;
      } else {
        return `${path}/item-gear-sheet.hbs`;
      }
    }

    return `${path}/item-sheet.hbs`;
  }

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.sheet.template = this.template;
    return parts;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    if (
      this.item.type === "minion" &&
      this.tabGroups?.primary === "description"
    ) {
      this.tabGroups.primary = "details";
    }

    // Use a safe clone of the item data for further operations.
    const itemData = this.document.toObject(false);
    context.item = this.item;
    context.system = itemData.system;
    context.source = this.item._source.system;
    context.flags = itemData.flags;
    context.config = CONFIG.FFXIV;
    context.statusEffects = CONFIG.statusEffects;
    context.itemStatusEffects = this._getStatusEffectEntries(itemData.system);
    context.effectRequirementEntries = this._getEffectRequirementEntries(itemData.system);
    context.effectRuleEntries = this._getEffectRuleEntries(itemData.system);
    context.cssClass = this._getSheetClasses().join(" ");
    context.editable = this.document.isOwner;
    context.itemEditMode = this._isItemEditMode();
    const actionType =
      this.item.type === "ability"
        ? getAbilitySubtype(this.item)
        : this.item.type;
    context.bakedActionTag = this._getBakedActionTag(actionType);
    context.customTags = this._getCustomActionTags(itemData.system.tags);
    if (this._hasSummonActorSupport()) {
      context.system.summon_actors = this._getSummonActorEntries(
        itemData.system.summon_actors,
      );
    }
    context.hasMarkerTag = this._hasMarkerTag(itemData.system.tags);
    context.hasCheck = this._hasCheck(itemData.system.check);
    if (Object.hasOwn(context.system, "shop_tier")) {
      const normalizedShopTier = normalizeShopTier(
        context.system.shop_tier,
        context.system.shop_tier_custom,
      );
      context.system.shop_tier = normalizedShopTier.shop_tier;
      context.system.shop_tier_custom = normalizedShopTier.shop_tier_custom;
    }
    if (Object.hasOwn(context.system, "max_stack")) {
      const sourceHasMaxStack = foundry.utils.hasProperty(
        this.item._source?.system ?? {},
        "max_stack",
      );
      const hasMaxStack =
        context.system.max_stack !== null &&
        context.system.max_stack !== undefined &&
        String(context.system.max_stack).trim() !== "";
      context.system.max_stack =
        !sourceHasMaxStack && context.system.stack
          ? 99
          : hasMaxStack
            ? Math.max(1, Number.parseInt(context.system.max_stack, 10) || 1)
            : context.system.stack
              ? 99
              : 1;
    }
    if (this.item.type === "job") {
      context.system.job_name = this._getJobBaseName(
        context.system.job_name,
        this.item.name,
      );
      context.system.ability_grants = this._normalizeJobAbilityGrants(
        context.system.ability_grants,
      ).map((grant) => ({
        ...grant,
        typeLabel: this._getJobGrantTypeLabel(grant),
      }));
      context.system.pet_grants = this._normalizeJobPetGrants(
        context.system.pet_grants,
      ).map((grant) => ({
        ...grant,
        typeLabel: this._getJobPetGrantTypeLabel(grant),
      }));
      context.system.has_pets =
        context.system.pet_grants.length > 0 || context.system.has_pets === true;
    }
    if (this.item.type === "augment") {
      context.system.ability_grants = this._getJobAbilityGrants().map(
        (grant) => ({
          ...grant,
          typeLabel: this._getJobGrantTypeLabel(grant),
        }),
      );
    }

    if (this.item.type === "job" || this.item.type === "augment") {
      context.enrichedDescription = await this.constructor.enrichAllStrings(
        context.system?.description ?? "",
        this.item.getRollData(),
        this.item,
        this.document.isOwner,
      );
      context.enrichedTraits = await this.constructor.enrichAllStrings(
        context.system?.traits ?? "",
        this.item.getRollData(),
        this.item,
        this.document.isOwner,
      );
      context.enriched = {
        description: context.enrichedDescription,
        traits: context.enrichedTraits,
      };
    } else {
      context.enriched = await this.constructor.enrichAllStrings(
        context.system ?? {},
        this.item.getRollData(),
        this.item,
        this.document.isOwner,
      );
      context.enrichedDescription = context.enriched?.description ?? "";
      context.enrichedTraits = context.enriched?.traits ?? "";
    }

    context.settings = {
      jobsAbbrv: game.settings.get("ffxiv", "jobsAbbrv").split(","),
    };

    // Prepare active effects for easier access
    context.effects = prepareActiveEffectCategories(this.item.effects);
    context.abilityLinkedEffects = Array.from(this.item.effects ?? []).map((effect) => {
      const applyTo = this._getAbilityEffectApplyTo(effect);
      return {
        id: effect.id,
        name: effect.name,
        icon: effect.img || effect.icon || "icons/svg/aura.svg",
        sourceName: effect.sourceName,
        duration: effect.duration,
        disabled: effect.disabled,
        applyTo,
        isAutomation: applyTo === "automation",
        applyAction: String(effect.getFlag("ffxiv", "applyAction") || "add"),
      };
    });
    return context;
  }

  static async enrichAllStrings(target, rollData, relativeTo, secrets = true) {
    if (typeof target === "string") {
      const html =
        await foundry.applications.ux.TextEditor.implementation.enrichHTML(
          target,
          {
            secrets,
            async: true,
            rollData,
            relativeTo,
          },
        );
      return html?.trim() ? html : target;
    }

    if (Array.isArray(target)) {
      const enriched = [];
      for (const value of target) {
        enriched.push(
          await this.enrichAllStrings(value, rollData, relativeTo, secrets),
        );
      }
      return enriched;
    }

    if (target && typeof target === "object") {
      const enriched = {};
      for (const [key, value] of Object.entries(target)) {
        enriched[key] = await this.enrichAllStrings(
          value,
          rollData,
          relativeTo,
          secrets,
        );
      }
      return enriched;
    }

    return target;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    this.element.classList.add(`${CONFIG.theme}_theme`);
    this._activateProseMirrorEditors();
    this._activatePrimaryTabs();

    const limited = this.element.querySelector(".limited-display");
    if (limited) {
      this.options.window.resizable = false;
      this._fitLimitedDisplayToContent();
    }

    this.activateListeners($(this.element));
    this._activateJobDropZone();
    this._activateJobGrantReorder();
    this._activateSummonDropZone();
    this._activateFormulaFieldVisibility();
    this._applyItemEditMode();
    this._restoreSheetScroll();
  }

  /** @override */
  async _onFirstRender(context, options) {
    if (typeof super._onFirstRender === "function")
      await super._onFirstRender(context, options);
    await this._enforceAbilitySubtypeTag();
    this._playConfiguredSound("soundNotificationFFXIV_openSheet");
  }

  /** @override */
  async _onClose(options) {
    await super._onClose(options);
    this._playConfiguredSound("soundNotificationFFXIV_closeSheet");
  }

  _playConfiguredSound(setting) {
    const src = this._settingOrDefault(setting, DEFAULT_SOUNDS);
    if (game.settings.get("ffxiv", "soundNotificationFFXIV") && src) {
      foundry.audio.AudioHelper.play({
        src,
        channel: "interface",
        volume: 1,
        autoplay: true,
        loop: false,
      });
    }
  }

  _settingOrDefault(setting, defaults) {
    const configured = game.settings.get("ffxiv", setting);
    const fallback = defaults[setting] || "";
    if (configured && fallback.endsWith(".ogg") && configured === fallback.replace(/\.ogg$/, ".mp3")) return fallback;
    return configured || fallback;
  }

  _isItemEditMode() {
    return !EDIT_MODE_ITEM_TYPES.has(this.item.type) || (this.document.isOwner && this.itemEditMode);
  }

  _toggleItemEditMode(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!EDIT_MODE_ITEM_TYPES.has(this.item.type) || !this.document.isOwner) return;
    this.itemEditMode = !this.itemEditMode;
    this.render({ force: true });
  }

  _applyItemEditMode() {
    if (!EDIT_MODE_ITEM_TYPES.has(this.item.type)) return;
    const editing = this._isItemEditMode();
    this.element.classList.toggle("item-editing", editing);
    this.element.classList.toggle("item-locked", !editing);
    const sheet = this.element.querySelector(".item-modern-sheet") ?? this.element.querySelector(".window-content") ?? this.element;

    const toggle = sheet.querySelector(".item-edit-toggle");
    if (toggle) {
      toggle.classList.toggle("active", editing);
      toggle.setAttribute("aria-pressed", editing ? "true" : "false");
      toggle.title = game.i18n.localize(editing ? "FFXIV.CharacterSheet.LockSheet" : "FFXIV.CharacterSheet.EditSheet");
      toggle.setAttribute("aria-label", toggle.title);
      const icon = toggle.querySelector("i");
      if (icon) {
        icon.classList.toggle("fa-lock-open", editing);
        icon.classList.toggle("fa-lock", !editing);
      }
    }

    if (editing) return;
    sheet
      .querySelectorAll("input, select, textarea")
      .forEach((control) => this._replaceLockedItemField(control));
    sheet
      .querySelectorAll("button")
      .forEach((control) => {
        if (control.closest(".item-edit-toggle")) return;
        control.disabled = true;
      });
  }

  _replaceLockedItemField(control) {
    if (control.closest(".item-edit-toggle")) return;
    if (control.type === "hidden" || control.classList.contains("ffxiv-hidden") || control.closest(".ffxiv-hidden")) {
      control.disabled = true;
      return;
    }

    let display;
    if (control.name === "system.combo") {
      const resource = control.closest(".combo-resource");
      const preview = resource?.querySelector(":scope > .combo-chain");
      display = preview?.cloneNode(true);
      preview?.remove();
    }
    display ??= document.createElement(control instanceof HTMLTextAreaElement ? "div" : "span");
    display.classList.add("item-locked-field");
    if (control instanceof HTMLTextAreaElement) display.classList.add("item-locked-field-block");
    if (!display.textContent?.trim()) display.textContent = this._getLockedItemFieldText(control);
    control.replaceWith(display);
  }

  _getLockedItemFieldText(control) {
    if (control instanceof HTMLSelectElement) {
      const values = Array.from(control.selectedOptions)
        .map((option) => option.textContent?.trim().replace(/\s+/g, " "))
        .filter(Boolean);
      return values.join(", ") || game.i18n.localize("FFXIV.None");
    }
    if (control.type === "checkbox") {
      return game.i18n.localize(control.checked ? "FFXIV.Dialogs.Yes" : "FFXIV.Dialogs.No");
    }
    const value = String(control.value ?? "").trim();
    return value || game.i18n.localize("FFXIV.None");
  }

  /** @override */
  _onChangeForm(formConfig, event) {
    if (!formConfig.submitOnChange)
      return super._onChangeForm(formConfig, event);
    if (!this.isEditable) return;
    if (!this._isItemEditMode()) return;
    if (!event.target?.name) return;

    event.preventDefault();
    const updateData = {
      [event.target.name]: this._getChangedFieldValue(event.target),
    };
    const render =
      event.target.name === "name" ||
      (this.item.type === "job" &&
        ["system.job_name", "system.level"].includes(event.target.name)) ||
      [
        "system.shop_tier",
        "system.max_stack",
        "system.hit_formula",
        "system.hit_formula_attribute",
        "system.direct_formula",
        "system.direct_formula_attribute",
        "system.direct_hit",
        "system.combo",
        "system.alternate_formula",
        "system.alternate_formula_attribute",
        "system.alternate_formula_critical",
        "system.alternate_formula_critical_attribute",
        "system.check",
        "system.origin",
      ].includes(event.target.name);
    if (render) this._captureSheetScroll();
    this.document
      .update(updateData, { render })
      .then(async () => {
        await this._syncJobPetVisibility(
          event.target.name,
          updateData[event.target.name],
        );
        await this._syncJobItemName(event.target.name);
      })
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  async _syncJobItemName(fieldName) {
    if (this.item.type !== "job") return;
    if (!["system.job_name", "system.level"].includes(fieldName)) return;

    const name = this._formatJobItemName(
      this.item.system.job_name,
      this.item.system.level,
    );
    if (this.item.name === name) return;
    await this.item.update({ name });
  }

  _getJobBaseName(jobName, itemName = this.item.name) {
    const name = String(jobName ?? "").trim();
    if (name) return name;
    return String(itemName ?? "")
      .replace(/\s*\(LV\s*(?:\d+|\?\?)\)\s*$/i, "")
      .trim();
  }

  _formatJobItemName(jobName, level) {
    const name =
      this._getJobBaseName(jobName) || game.i18n.localize("FFXIV.ItemType.job");
    const levelNumber = Number(level);
    const levelText =
      Number.isFinite(levelNumber) && levelNumber > 0
        ? String(levelNumber)
        : "??";
    return `${name} (LV ${levelText})`;
  }

  async _syncJobPetVisibility(fieldName, value) {
    if (fieldName !== "system.has_pets") return;
    if (this.item.type !== "job") return;
    if (
      this.item.parent?.documentName !== "Actor" ||
      this.item.parent.type !== "character"
    )
      return;
    await this.item.parent.update(
      { "system.showPets": value ? "true" : "false" },
      { render: false },
    );
  }

  _getChangedFieldValue(target) {
    if (target.type === "checkbox") return target.checked;
    if (target.multiple)
      return Array.from(target.selectedOptions).map((option) => option.value);

    const dtype = target.dataset?.dtype;
    if (target.type === "number" || dtype === "Number") {
      return target.value === "" ? null : Number(target.value);
    }
    if (dtype === "Boolean") return target.value === "true";

    return target.value;
  }

  _getBakedActionTag(type) {
    const bakedTags = {
      primary_ability: "FFXIV.Tags.Primary",
      secondary_ability: "FFXIV.Tags.Secondary",
      instant_ability: "FFXIV.Tags.Instant",
      limit_break: "FFXIV.ItemType.limit_break",
    };
    return bakedTags[type] ?? "";
  }

  _getCustomActionTags(tags) {
    const bakedTagNames = [
      "Primary",
      "Secondary",
      "Instant",
      "Limit Break",
      "Limit-Break",
      "FFXIV.Tags.Primary",
      "FFXIV.Tags.Secondary",
      "FFXIV.Tags.Instant",
      "FFXIV.ItemType.limit_break",
    ];
    const normalize = (value) =>
      String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const isBakedTag = (tag) => {
      const normalized = normalize(tag);
      const localized = normalize(game.i18n.localize(String(tag ?? "")));
      return bakedTagNames.some((name) => {
        const expected = normalize(name);
        const expectedLocalized = normalize(game.i18n.localize(name));
        return (
          normalized === expected ||
          normalized === expectedLocalized ||
          localized === expected ||
          localized === expectedLocalized
        );
      });
    };
    return (Array.isArray(tags) ? tags : [])
      .map((tag, index) => ({ tag, index }))
      .filter(({ tag }) => !isBakedTag(tag));
  }

  async _enforceAbilitySubtypeTag() {
    if (this.item.type !== "ability") return;
    const normalizedTags = ensureAbilitySubtypeTags(
      this.item.system?.tags,
      "primary_ability",
    );
    const currentTags = Array.isArray(this.item.system?.tags)
      ? this.item.system.tags
      : [];
    if (JSON.stringify(normalizedTags) === JSON.stringify(currentTags)) return;
    await this.item.update(
      { "system.tags": normalizedTags },
      { render: false },
    );
  }

  _hasMarkerTag(tags) {
    return (Array.isArray(tags) ? tags : []).some((tag) =>
      [
        tag,
        game.i18n.localize(String(tag ?? "")),
        "FFXIV.Tags.StationaryMarker",
        "FFXIV.Tags.MobileMarker",
      ]
        .flatMap((value) => [
          String(value ?? "").toLowerCase(),
          game.i18n.localize(String(value ?? "")).toLowerCase(),
        ])
        .some(
          (value) => value.includes("marker") || value.includes("marqueur"),
        ),
    );
  }

  _hasCheck(check) {
    const none = game.i18n.localize("FFXIV.None");
    return Boolean(check) && check !== "FFXIV.None" && check !== none;
  }

  _hasSummonActorSupport() {
    return [
      "ability",
      "primary_ability",
      "secondary_ability",
      "instant_ability",
      "trait",
    ].includes(this.item.type);
  }

  _getSummonActorEntries(
    entries = this.item.system?.summon_actors,
    { includeLabels = true } = {},
  ) {
    const grants = Array.isArray(entries)
      ? foundry.utils.deepClone(entries)
      : entries && typeof entries === "object"
        ? foundry.utils.deepClone(Object.values(entries))
        : [];
    return grants
      .map((grant) => {
        const entry = {
          uuid: String(grant?.uuid ?? "").trim(),
          name: String(grant?.name ?? "").trim(),
          type: String(grant?.type ?? "").trim(),
        };
        if (includeLabels)
          entry.typeLabel = this._getSummonActorTypeLabel(entry);
        return entry;
      })
      .filter((grant) => grant.uuid);
  }

  _getSummonActorGrants() {
    return this._getSummonActorEntries(this.item.system?.summon_actors, {
      includeLabels: false,
    });
  }

  _getSummonActorTypeLabel(grant) {
    const type = String(grant?.type ?? "").trim();
    if (!type) return game.i18n.localize("FFXIV.ItemType.ItemType");
    const label = game.i18n.localize(`FFXIV.ActorType.${type}`);
    return label === `FFXIV.ActorType.${type}` ? type : label;
  }

  _getEffectRequirementEntries(system) {
    const requirements = Array.isArray(system.effect_requirements)
      ? system.effect_requirements
      : [];
    return requirements.map((requirement, index) => ({
      name:
        String(requirement?.name ?? "").trim() ||
        this._titleizeEffectKey(requirement?.key),
      mode: requirement?.mode === "forbidden" ? "forbidden" : "required",
      consume: requirement?.consume === true,
      bypassText: this._getEffectRefListInput(requirement?.bypass),
      resourceSpent: String(requirement?.resourceSpent ?? "").trim(),
      resourceSpentMin: Number.isFinite(Number.parseInt(
        requirement?.resourceSpentMin ?? requirement?.spentMin ?? requirement?.min,
        10,
      ))
        ? Number.parseInt(
          requirement?.resourceSpentMin ?? requirement?.spentMin ?? requirement?.min,
          10,
        )
        : "",
      resourceSpentMax: Number.isFinite(Number.parseInt(
        requirement?.resourceSpentMax ?? requirement?.spentMax ?? requirement?.max,
        10,
      ))
        ? Number.parseInt(
          requirement?.resourceSpentMax ?? requirement?.spentMax ?? requirement?.max,
          10,
        )
        : "",
      open: this._expandedEffectRequirements.has(index),
      text: this._formatEffectRequirement(requirement),
    }));
  }

  _getEffectRuleEntries(system) {
    const rules = this._getEffectRulesFrom(system, { includeDrafts: true });
    return rules.map((rule, index) => ({
      action: this._normalizeEffectRuleAction(rule?.action),
      trigger: this._normalizeEffectRuleTrigger(rule?.trigger),
      name: String(rule?.name ?? "").trim() || this._titleizeEffectKey(rule?.key),
      isResource: this._normalizeEffectRuleAction(rule?.action) === "resource",
      isToggle: this._normalizeEffectRuleAction(rule?.action) === "toggle",
      iconOverride: String(rule?.iconOverride ?? rule?.icon ?? "").trim(),
      threshold: Number.isFinite(Number.parseInt(rule?.threshold, 10))
        ? Number.parseInt(rule.threshold, 10)
        : "",
      operation: this._normalizeEffectRuleOperation(
        rule?.operation ?? rule?.resourceAction,
      ),
      resource: String(rule?.resource ?? rule?.resourceName ?? "").trim(),
      amount: String(rule?.amount ?? "").trim() || "1",
      min: Number.isFinite(Number.parseInt(rule?.min, 10))
        ? Number.parseInt(rule.min, 10)
        : "",
      spentResource: String(rule?.spentResource ?? rule?.amountResource ?? "").trim(),
      requiresResourceSpent: String(rule?.requiresResourceSpent ?? "").trim(),
      requiresResourceSpentMin: Number.isFinite(Number.parseInt(
        rule?.requiresResourceSpentMin ?? rule?.spentMin,
        10,
      ))
        ? Number.parseInt(rule?.requiresResourceSpentMin ?? rule?.spentMin, 10)
        : "",
      requiresResourceSpentMax: Number.isFinite(Number.parseInt(
        rule?.requiresResourceSpentMax ?? rule?.spentMax,
        10,
      ))
        ? Number.parseInt(rule?.requiresResourceSpentMax ?? rule?.spentMax, 10)
        : "",
      removeText: this._getEffectRefListInput(rule?.remove),
      requiresText: this._getEffectRefListInput(rule?.requires),
      forbidsText: this._getEffectRefListInput(rule?.forbids),
      toggle1Name: this._getEffectRefName(rule?.toggle1),
      toggle2Name: this._getEffectRefName(rule?.toggle2),
      open: this._expandedEffectRules.has(index),
      text: this._formatEffectRule(rule),
    }));
  }

  _normalizeEffectRuleAction(value) {
    const action = String(value ?? "grant").trim().toLowerCase();
    return ["grant", "remove", "toggle", "resource"].includes(action)
      ? action
      : "grant";
  }

  _normalizeEffectRuleTrigger(value) {
    const trigger = String(value ?? "use").trim();
    if (trigger === "cost") return "cost";
    return trigger === "hitThreshold" ? "hitThreshold" : "use";
  }

  _normalizeEffectRuleOperation(value) {
    const operation = String(value ?? "grant").trim().toLowerCase();
    return ["grant", "consume", "fill", "clear", "set"].includes(operation)
      ? operation
      : "grant";
  }

  _getEffectRefListInput(value) {
    const entries = Array.isArray(value) ? value : value ? [value] : [];
    return entries
      .map((entry) => {
        if (typeof entry === "string") return entry;
        return String(entry?.name ?? entry?.key ?? "").trim();
      })
      .filter(Boolean)
      .join(", ");
  }

  _getEffectRefName(value) {
    if (typeof value === "string") return value;
    return (
      String(value?.name ?? "").trim() ||
      this._titleizeEffectKey(value?.key)
    );
  }

  _formatEffectRequirement(requirement) {
    const name = this._formatEffectRef(requirement);
    if (!name) return "";

    const parts = [
      requirement?.mode === "forbidden"
        ? `Forbids ${name}`
        : `Requires ${name}`,
    ];
    if (requirement?.consume === true) parts.push("consume after use");

    const bypass = this._formatEffectRefList(requirement?.bypass);
    if (bypass) parts.push(`bypassed by ${bypass}`);
    const resourceSpent = String(requirement?.resourceSpent ?? "").trim();
    if (resourceSpent) {
      const min = Number.parseInt(
        requirement?.resourceSpentMin ?? requirement?.spentMin ?? requirement?.min,
        10,
      );
      const max = Number.parseInt(
        requirement?.resourceSpentMax ?? requirement?.spentMax ?? requirement?.max,
        10,
      );
      const range = [
        Number.isFinite(min) ? `min ${min}` : "",
        Number.isFinite(max) ? `max ${max}` : "",
      ].filter(Boolean).join(", ");
      parts.push(`spent ${resourceSpent}${range ? ` (${range})` : ""}`);
    }
    return parts.join("; ");
  }

  _formatEffectRule(rule) {
    const trigger = this._formatEffectRuleTrigger(rule);
    const action = String(rule?.action ?? "grant").trim().toLowerCase();
    const parts = [];

    if (action === "resource") {
      const resource = String(rule?.resource ?? rule?.resourceName ?? "").trim();
      if (!resource) return "";
      const operation = this._normalizeEffectRuleOperation(
        rule?.operation ?? rule?.resourceAction,
      );
      const amount = String(rule?.amount ?? "").trim() || "1";
      const min = Number.parseInt(rule?.min, 10);
      const verb =
        operation === "consume"
          ? "consume"
          : operation === "fill"
            ? "fill"
            : operation === "clear"
              ? "clear"
              : operation === "set"
                ? "set"
                : "grant";
      const quantity = ["fill", "clear"].includes(operation) ? "" : `${amount} `;
      parts.push(`${trigger}: ${verb} ${quantity}${resource}`);
      if (Number.isFinite(min) && min > 0) parts.push(`minimum ${min}`);
      const spentResource = String(rule?.spentResource ?? "").trim();
      if (spentResource) parts.push(`from spent ${spentResource}`);
    } else if (action === "toggle") {
      const toggle1 = this._formatEffectRef(rule?.toggle1);
      const toggle2 = this._formatEffectRef(rule?.toggle2);
      if (!toggle1 || !toggle2) return "";
      parts.push(`${trigger}: toggle ${toggle1} / ${toggle2}`);
    } else {
      const name = this._formatEffectRef(rule);
      if (!name) return "";
      const verb = action === "remove" ? "remove" : "grant";
      parts.push(`${trigger}: ${verb} ${name}`);
    }

    const remove = this._formatEffectRefList(rule?.remove);
    if (remove) parts.push(`remove ${remove} first`);

    const requires = this._formatEffectRefList(rule?.requires);
    if (requires) parts.push(`requires ${requires}`);

    const forbids = this._formatEffectRefList(rule?.forbids);
    if (forbids) parts.push(`not while under ${forbids}`);

    const spent = String(rule?.requiresResourceSpent ?? "").trim();
    if (spent) {
      const min = Number.parseInt(rule?.requiresResourceSpentMin, 10);
      const max = Number.parseInt(rule?.requiresResourceSpentMax, 10);
      const range = [
        Number.isFinite(min) ? `min ${min}` : "",
        Number.isFinite(max) ? `max ${max}` : "",
      ].filter(Boolean).join(", ");
      parts.push(`spent ${spent}${range ? ` (${range})` : ""}`);
    }

    const duration = this._formatEffectDuration(rule?.duration);
    if (duration) parts.push(`duration ${duration}`);

    return parts.join("; ");
  }

  _formatEffectRuleTrigger(rule) {
    const trigger = String(rule?.trigger ?? "use").trim();
    if (trigger === "hitThreshold") {
      const threshold = Number.parseInt(rule?.threshold, 10);
      return Number.isFinite(threshold)
        ? `On hit/check d20 ${threshold}+`
        : "On hit/check";
    }
    if (trigger === "cost") return "On cost";
    if (!trigger || trigger === "use") return "On use";
    return `On ${trigger}`;
  }

  _formatEffectRefList(value) {
    const entries = Array.isArray(value) ? value : value ? [value] : [];
    return entries
      .map((entry) => this._formatEffectRef(entry))
      .filter(Boolean)
      .join(", ");
  }

  _formatEffectRef(value) {
    if (!value) return "";
    if (typeof value === "string") return this._titleizeEffectKey(value);
    const name = String(value.name ?? "").trim();
    if (name) return name;
    return this._titleizeEffectKey(value.key);
  }

  _titleizeEffectKey(value) {
    return String(value ?? "")
      .trim()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  _normalizeEffectKey(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  _formatEffectDuration(duration) {
    if (!duration || typeof duration !== "object") return "";
    for (const unit of ["turns", "rounds", "seconds"]) {
      const value = Number.parseInt(duration[unit], 10);
      if (!Number.isFinite(value) || value <= 0) continue;
      const label = value === 1 ? unit.slice(0, -1) : unit;
      return `${value} ${label}`;
    }
    return "";
  }

  _getStatusEffectEntries(system) {
    const entries = Array.isArray(system.status_effects)
      ? foundry.utils.deepClone(system.status_effects)
      : [];
    if (!entries.length && system.status_effect) {
      entries.push({
        id: system.status_effect,
        action: system.status_action !== false,
        applyMode: system.status_apply_mode || "manual",
      });
    }
    return entries.map((entry) => ({
      id: entry?.id ?? "",
      action: entry?.action !== false,
      applyMode: entry?.applyMode === "auto" ? "auto" : "manual",
      applyTo: this._normalizeStatusApplyTo(entry?.applyTo),
      allSources: entry?.allSources === true,
      stacks: this._normalizeStatusStacks(entry?.stacks),
      stackable: isStackableStatusEffect(entry?.id ?? ""),
    }));
  }

  _normalizeStatusApplyTo(value) {
    return String(value ?? "").trim().toLowerCase() === "self"
      ? "self"
      : "target";
  }

  _normalizeStatusStacks(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  _getCurrentStatusEffectEntries() {
    return this._getStatusEffectEntries(this.item.system);
  }

  _getCurrentEffectRequirements() {
    return Array.isArray(this.item.system.effect_requirements)
      ? foundry.utils.deepClone(this.item.system.effect_requirements)
      : [];
  }

  _getCurrentEffectRules() {
    return this._getEffectRulesFrom(this.item.system, { includeDrafts: true });
  }

  _getEffectRulesFrom(system, { includeDrafts = false } = {}) {
    const rules = Array.isArray(system.effect_rules)
      ? foundry.utils.deepClone(system.effect_rules)
      : [];
    return rules.filter(
      (rule, index) =>
        (includeDrafts && this._expandedEffectRules.has(index)) ||
        this._isUsableEffectRule(rule),
    );
  }

  _isUsableEffectRule(rule) {
    if (!rule || typeof rule !== "object") return false;
    const action = this._normalizeEffectRuleAction(rule?.action);
    if (action === "toggle")
      return Boolean(
        this._getEffectRefName(rule?.toggle1) &&
        this._getEffectRefName(rule?.toggle2),
      );
    if (action === "resource")
      return Boolean(String(rule?.resource ?? rule?.resourceName ?? "").trim());
    return Boolean(this._formatEffectRef(rule));
  }

  _getAutomationFieldValue(target) {
    if (target.type === "checkbox") return target.checked;
    if (target.type === "number")
      return target.value === "" ? "" : Number.parseInt(target.value, 10);
    return String(target.value ?? "").trim();
  }

  _onChangeEffectRequirement(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    const field = String(event.currentTarget.dataset.field ?? "");
    if (!field) return;

    const requirements = this._getCurrentEffectRequirements();
    requirements[index] ??= {
      name: "",
      mode: "required",
      consume: false,
    };
    const value = this._getAutomationFieldValue(event.currentTarget);

    if (field === "bypass") {
      requirements[index].bypass = this._parseEffectRefList(value);
      if (!requirements[index].bypass.length) delete requirements[index].bypass;
    } else if (field === "consume") {
      requirements[index].consume = value === true;
    } else if (field === "mode") {
      requirements[index].mode = value === "forbidden" ? "forbidden" : "required";
    } else if (field === "name") {
      requirements[index].name = value;
      delete requirements[index].key;
    } else if (field === "resourceSpent") {
      if (value) requirements[index].resourceSpent = value;
      else delete requirements[index].resourceSpent;
    } else if (["resourceSpentMin", "resourceSpentMax"].includes(field)) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) requirements[index][field] = parsed;
      else delete requirements[index][field];
    } else {
      requirements[index][field] = value;
    }

    this._captureSheetScroll();
    this.item
      .update({ "system.effect_requirements": requirements }, { render: false })
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  _onChangeEffectRule(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    const field = String(event.currentTarget.dataset.field ?? "");
    if (!field) return;

    const rules = this._getCurrentEffectRules();
    rules[index] ??= {
      trigger: "use",
      action: "grant",
      name: "",
    };
    const value = this._getAutomationFieldValue(event.currentTarget);

    this._setEffectRuleField(rules[index], field, value);
    this._captureSheetScroll();
    this.item
      .update({ "system.effect_rules": rules }, { render: false })
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  _setEffectRuleField(rule, field, value) {
    if (["remove", "requires", "forbids"].includes(field)) {
      rule[field] = this._parseEffectRefList(value);
      if (!rule[field].length) delete rule[field];
      return;
    }

    if (["rounds", "turns", "seconds"].includes(field)) {
      rule.duration ??= {};
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        rule.duration[field] = parsed;
      } else {
        delete rule.duration[field];
      }
      if (!Object.keys(rule.duration).length) delete rule.duration;
      return;
    }

    if (field === "toggle1Name") {
      rule.toggle1 ??= {};
      rule.toggle1.name = value;
      delete rule.toggle1.key;
      this._cleanEffectRef(rule, "toggle1");
      return;
    }

    if (field === "toggle2Name") {
      rule.toggle2 ??= {};
      rule.toggle2.name = value;
      delete rule.toggle2.key;
      this._cleanEffectRef(rule, "toggle2");
      return;
    }

    if (field === "action") {
      rule.action = this._normalizeEffectRuleAction(value);
      if (rule.action === "resource") {
        rule.operation ??= "grant";
        rule.amount ??= 1;
      }
      return;
    }

    if (field === "trigger") {
      rule.trigger = this._normalizeEffectRuleTrigger(value);
      return;
    }

    if (field === "threshold") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) rule.threshold = parsed;
      else delete rule.threshold;
      return;
    }

    if (field === "operation") {
      rule.operation = this._normalizeEffectRuleOperation(value);
      delete rule.resourceAction;
      return;
    }

    if (field === "resource") {
      if (value) rule.resource = value;
      else delete rule.resource;
      delete rule.resourceName;
      return;
    }

    if (field === "amount") {
      const amount = String(value ?? "").trim();
      if (amount)
        rule.amount = amount.toLowerCase() === "all" ? "all" : amount;
      else delete rule.amount;
      return;
    }

    if (field === "min") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) rule.min = parsed;
      else delete rule.min;
      return;
    }

    if (field === "spentResource") {
      if (value) rule.spentResource = value;
      else delete rule.spentResource;
      delete rule.amountResource;
      return;
    }

    if (field === "requiresResourceSpent") {
      if (value) rule.requiresResourceSpent = value;
      else delete rule.requiresResourceSpent;
      return;
    }

    if (["requiresResourceSpentMin", "requiresResourceSpentMax"].includes(field)) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) rule[field] = parsed;
      else delete rule[field];
      return;
    }

    if (field === "iconOverride") {
      if (value) rule.iconOverride = value;
      else delete rule.iconOverride;
      delete rule.icon;
      return;
    }

    rule[field] = value;
    if (field === "name") delete rule.key;
  }

  _cleanEffectRef(rule, field) {
    if (rule[field]?.key || rule[field]?.name) return;
    delete rule[field];
  }

  _parseEffectRefList(value) {
    return String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  _onAddEffectRequirement(event) {
    event.preventDefault();
    event.stopPropagation();
    this._playConfiguredSound("soundNotificationFFXIV_moveItem");
    this._captureSheetScroll();

    const requirements = this._getCurrentEffectRequirements();
    requirements.push({
      name: "",
      mode: "required",
      consume: false,
    });
    this._expandedEffectRequirements.add(requirements.length - 1);
    this.item
      .update({ "system.effect_requirements": requirements }, { render: false })
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  _onAddEffectRule(event) {
    event.preventDefault();
    event.stopPropagation();
    this._playConfiguredSound("soundNotificationFFXIV_moveItem");
    this._captureSheetScroll();

    const rules = this._getCurrentEffectRules();
    rules.push({
      trigger: "use",
      action: "grant",
      name: "",
    });
    this._expandedEffectRules.add(rules.length - 1);
    this.item
      .update({ "system.effect_rules": rules }, { render: false })
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  _onRemoveEffectRequirement(event) {
    event.preventDefault();
    event.stopPropagation();
    this._playConfiguredSound("soundNotificationFFXIV_deleteItem");
    this._captureSheetScroll();

    const index = Number(event.currentTarget.dataset.index);
    const requirements = this._getCurrentEffectRequirements();
    requirements.splice(index, 1);
    this.item
      .update({ "system.effect_requirements": requirements }, { render: false })
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  _onRemoveEffectRule(event) {
    event.preventDefault();
    event.stopPropagation();
    this._playConfiguredSound("soundNotificationFFXIV_deleteItem");
    this._captureSheetScroll();

    const index = Number(event.currentTarget.dataset.index);
    const rules = this._getCurrentEffectRules();
    rules.splice(index, 1);
    this.item
      .update({ "system.effect_rules": rules }, { render: false })
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  _onChangeStatusEffect(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;

    const entries = this._getCurrentStatusEffectEntries();
    entries[index] ??= {
      id: "",
      action: true,
      applyMode: "manual",
      applyTo: "target",
      stacks: 1,
      stackable: false,
    };
    if (event.currentTarget.classList.contains("status-effect-id")) {
      entries[index].id = event.currentTarget.value;
      entries[index].stackable = isStackableStatusEffect(entries[index].id);
      entries[index].stacks = this._normalizeStatusStacks(entries[index].stacks);
    } else if (event.currentTarget.classList.contains("status-effect-stacks")) {
      entries[index].stacks = this._normalizeStatusStacks(event.currentTarget.value);
    } else if (event.currentTarget.classList.contains("status-effect-apply-mode")) {
      entries[index].applyMode = event.currentTarget.value === "auto" ? "auto" : "manual";
    } else if (event.currentTarget.classList.contains("status-effect-apply-to")) {
      entries[index].applyTo = this._normalizeStatusApplyTo(event.currentTarget.value);
    } else {
      entries[index].action = event.currentTarget.value === "true";
    }
    this._captureSheetScroll();
    this.item
      .update(
        {
          "system.status_effects": entries,
          "system.status_effect": "",
          "system.status_action": true,
          "system.status_apply_mode": "manual",
        },
        { render: false },
      )
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  _onAddStatusEffect(event) {
    event.preventDefault();
    event.stopPropagation();
    this._playConfiguredSound("soundNotificationFFXIV_moveItem");
    this._captureSheetScroll();

    const entries = this._getCurrentStatusEffectEntries();
    const defaultEffect = CONFIG.statusEffects?.[0]?.id ?? "";
    entries.push({
      id: defaultEffect,
      action: true,
      applyMode: "manual",
      applyTo: "target",
      stacks: 1,
      stackable: isStackableStatusEffect(defaultEffect),
    });
    this.item
      .update(
        {
          "system.status_effects": entries,
          "system.status_effect": "",
          "system.status_action": true,
          "system.status_apply_mode": "manual",
        },
        { render: false },
      )
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  _onRemoveStatusEffect(event) {
    event.preventDefault();
    event.stopPropagation();
    this._playConfiguredSound("soundNotificationFFXIV_deleteItem");
    this._captureSheetScroll();

    const index = Number(event.currentTarget.dataset.index);
    const entries = this._getCurrentStatusEffectEntries();
    entries.splice(index, 1);
    this.item
      .update(
        {
          "system.status_effects": entries,
          "system.status_effect": "",
          "system.status_action": true,
          "system.status_apply_mode": "manual",
        },
        { render: false },
      )
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  _onChangeAbilityEffectScope(event) {
    event.preventDefault();
    event.stopPropagation();
    const effectId = String(event.currentTarget.dataset.effectId ?? "");
    const applyTo = String(event.currentTarget.value ?? "target");
    const effect = this.item.effects.get(effectId);
    if (!effect) return;
    this._captureSheetScroll();
    const updateData = {
      "flags.ffxiv.applyTo": applyTo,
      transfer: applyTo === "self",
    };
    if (applyTo === "automation") {
      updateData["flags.ffxiv.effectKey"] = this._normalizeEffectKey(effect.name);
    }
    effect
      .update(updateData, { render: false, ffxivSyncApplyTo: true })
      .then(() => this._ensureAutomationRuleForEffect(effect, applyTo))
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  async _ensureAutomationRuleForEffect(effect, applyTo) {
    if (applyTo !== "automation") return;

    const name = String(effect?.name ?? "").trim();
    const key = this._normalizeEffectKey(
      effect?.getFlag?.("ffxiv", "effectKey") ?? name,
    );
    if (!name || !key) return;

    const rules = this._getCurrentEffectRules();
    const hasRule = rules.some((rule) => {
      if (String(rule?.action ?? "grant").trim().toLowerCase() !== "grant")
        return false;
      const ruleKey = this._normalizeEffectKey(rule?.key ?? rule?.name);
      return ruleKey === key;
    });
    if (hasRule) return;

    rules.push({
      trigger: "use",
      action: "grant",
      name,
    });
    await this.item.update({ "system.effect_rules": rules }, { render: false });
  }

  _onChangeAbilityEffectAction(event) {
    event.preventDefault();
    event.stopPropagation();
    const effectId = String(event.currentTarget.dataset.effectId ?? "");
    const applyAction = String(event.currentTarget.value ?? "add");
    const effect = this.item.effects.get(effectId);
    if (!effect) return;
    this._captureSheetScroll();
    effect
      .setFlag("ffxiv", "applyAction", applyAction)
      .then(() => this.render({ force: true }))
      .catch((err) => ui.notifications.error(err, { console: true }));
  }

  _getAbilityEffectApplyTo(effect) {
    const flagged = String(effect?.getFlag("ffxiv", "applyTo") || "").trim().toLowerCase();
    if (flagged === "self" || flagged === "target" || flagged === "self_auto" || flagged === "automation") return flagged;
    return "target";
  }

  /** @override */
  activateListeners(html) {
    html.off(".ffxivItemSheet");

    // Everything below here is only needed if the sheet is editable
    if (!this.document.isOwner) return;

    html.on(
      "click.ffxivItemSheet",
      ".item-edit-toggle",
      this._toggleItemEditMode.bind(this),
    );

    if (!this._isItemEditMode()) return;

    // hidden here instead of css to prevent non-editable display of edit button
    html
      .find(".popout-editor")
      .off("mouseover.ffxivItemSheet")
      .on("mouseover.ffxivItemSheet", (event) => {
        $(event.currentTarget).find(".popout-editor-button").show();
      });
    html
      .find(".popout-editor")
      .off("mouseout.ffxivItemSheet")
      .on("mouseout.ffxivItemSheet", (event) => {
        $(event.currentTarget).find(".popout-editor-button").hide();
      });
    html
      .find(".popout-editor .popout-editor-button")
      .off("click.ffxivItemSheet")
      .on("click.ffxivItemSheet", this._onPopoutEditor.bind(this));
    html.on(
      "click.ffxivItemSheet",
      '.profile-img[data-edit="img"]',
      this._onPickItemIcon.bind(this),
    );

    //Tags
    html.on("change.ffxivItemSheet", ".select-tags", (event) => {
      const index = Number(
        event.currentTarget.dataset.index ??
          $(event.currentTarget).closest("li").index(),
      );
      const value = $(event.currentTarget).val(); // Get the selected value
      const tags = this.item.system.tags || [];
      tags[index] = value; // Update the correct index in the array
      this.item.update({ "system.tags": tags }); // Update the item with the new tags array
    });
    html.on("change.ffxivItemSheet", ".select-subtype-tag", (event) => {
      const value = $(event.currentTarget).val();
      const tags = Array.isArray(this.item.system.tags)
        ? [...this.item.system.tags]
        : [];
      tags[0] = value;
      const fallbackSubtype =
        getAbilitySubtype({ type: "ability", system: { tags } }) ||
        "primary_ability";
      const normalized = ensureAbilitySubtypeTags(tags, fallbackSubtype);
      this.item
        .update({ "system.tags": normalized }, { render: false })
        .then(() => this.render({ force: true }));
    });
    html.on("click.ffxivItemSheet", ".remove-tag", (event) => {
      const index = event.currentTarget.dataset.index;
      const tags = this.item.system.tags || [];
      tags.splice(index, 1); // Remove the tag at the specified index
      this.item.update({ "system.tags": tags });
      this.render(); // Re-render to show the updated fields
    });
    html.on("click.ffxivItemSheet", ".add-tag", () => {
      const tags = this.item.system.tags || [];

      const configMap = {
        ability: "tags_abilities",
        primary_ability: "tags_abilities",
        secondary_ability: "tags_abilities",
        instant_ability: "tags_abilities",
        limit_break: "tags_abilities",
        trait: "tags_traits",
        consumable: "tags_consumables",
      };

      const configKey = configMap[this.item.type];
      const tagPool = CONFIG.FFXIV[configKey] || {};
      const defaultTag = Object.values(tagPool)[0]?.label || "";
      debugLog(defaultTag + " : " + tags);
      if (defaultTag) {
        tags.push(defaultTag);
        this.item.update({ "system.tags": tags });
        this.render();
      }
    });

    html.on(
      "change.ffxivItemSheet",
      ".status-effect-id, .status-effect-action, .status-effect-apply-mode, .status-effect-apply-to, .status-effect-stacks",
      this._onChangeStatusEffect.bind(this),
    );
    html.on(
      "change.ffxivItemSheet",
      ".effect-requirement-field",
      this._onChangeEffectRequirement.bind(this),
    );
    html.on(
      "change.ffxivItemSheet",
      ".effect-rule-field",
      this._onChangeEffectRule.bind(this),
    );
    html.on(
      "change.ffxivItemSheet",
      ".ability-effect-scope",
      this._onChangeAbilityEffectScope.bind(this),
    );
    html.on(
      "change.ffxivItemSheet",
      ".ability-effect-action",
      this._onChangeAbilityEffectAction.bind(this),
    );
    html.on("click.ffxivItemSheet", ".sheet-tabs.tabs .item", (ev) => {
      const nextTab = String(ev.currentTarget.dataset.tab ?? "");
      const currentTab = String(this.tabGroups?.primary ?? "");
      if (nextTab && nextTab !== currentTab) {
        this._playConfiguredSound("soundNotificationFFXIV_openSheet");
      }
    });
    html.on("click.ffxivItemSheet", ".effect-control", async (ev) => {
      const action = ev.currentTarget.dataset.action;
      if (action === "create") {
        this._playConfiguredSound("soundNotificationFFXIV_moveItem");
      } else if (action === "delete") {
        this._playConfiguredSound("soundNotificationFFXIV_deleteItem");
      }
      await onManageActiveEffect(ev, this.item, { render: false });
      if (action !== "edit") {
        this._captureSheetScroll();
        this.render({ force: true });
      }
    });
    html.on(
      "click.ffxivItemSheet",
      ".add-status-effect",
      this._onAddStatusEffect.bind(this),
    );
    html.on(
      "click.ffxivItemSheet",
      ".remove-status-effect",
      this._onRemoveStatusEffect.bind(this),
    );
    html.on(
      "click.ffxivItemSheet",
      ".add-effect-requirement",
      this._onAddEffectRequirement.bind(this),
    );
    html.on(
      "click.ffxivItemSheet",
      ".add-effect-rule",
      this._onAddEffectRule.bind(this),
    );
    html.on(
      "click.ffxivItemSheet",
      ".effect-rule-icon-picker",
      this._onPickEffectRuleIcon.bind(this),
    );
    html.on(
      "click.ffxivItemSheet",
      ".remove-effect-requirement",
      this._onRemoveEffectRequirement.bind(this),
    );
    html.on(
      "click.ffxivItemSheet",
      ".remove-effect-rule",
      this._onRemoveEffectRule.bind(this),
    );

    //Gear Classes, similar as tags
    if (this.item.type == "gear") {
      html.on("change.ffxivItemSheet", ".select-classes", (event) => {
        const index = $(event.currentTarget).closest("li").index();
        const value = $(event.currentTarget).val();
        const classes = this.item.system.classes || [];
        classes[index] = value;
        this.item.update({ "system.classes": classes });
      });
      html.on("click.ffxivItemSheet", ".remove-class", (event) => {
        const index = event.currentTarget.dataset.index;
        const classes = this.item.system.classes || [];
        classes.splice(index, 1);
        this.item.update({ "system.classes": classes });
        this.render();
      });
      html.on("click.ffxivItemSheet", ".add-class", () => {
        const classes = this.item.system.classes || [];
        classes.push("");
        this.item.update({ "system.classes": classes });
        this.render();
      });
    }

    if (this.item.type == "job") {
      html.on(
        "click.ffxivItemSheet",
        ".job-ability-edit",
        this._onEditJobAbility.bind(this),
      );
      html.on(
        "click.ffxivItemSheet",
        ".move-job-ability-up",
        this._moveJobAbility.bind(this, -1),
      );
      html.on(
        "click.ffxivItemSheet",
        ".move-job-ability-down",
        this._moveJobAbility.bind(this, 1),
      );
      html.on("click.ffxivItemSheet", ".remove-job-ability", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(event.currentTarget.dataset.index);
        const grants = this._getJobAbilityGrants();
        grants.splice(index, 1);
        this.item.update({ "system.ability_grants": grants });
        this.render();
      });
      html.on(
        "click.ffxivItemSheet",
        ".job-pet-edit",
        this._onEditJobPet.bind(this),
      );
      html.on(
        "click.ffxivItemSheet",
        ".move-job-pet-up",
        this._moveJobPet.bind(this, -1),
      );
      html.on(
        "click.ffxivItemSheet",
        ".move-job-pet-down",
        this._moveJobPet.bind(this, 1),
      );
      html.on("click.ffxivItemSheet", ".remove-job-pet", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(event.currentTarget.dataset.index);
        const grants = this._getJobPetGrants();
        grants.splice(index, 1);
        this.item.update({
          "system.pet_grants": grants,
          "system.has_pets": grants.length > 0,
        });
        this.render();
      });
    }
    if (this.item.type === "augment") {
      html.on(
        "click.ffxivItemSheet",
        ".augment-ability-edit",
        this._onEditJobAbility.bind(this),
      );
      html.on("click.ffxivItemSheet", ".remove-augment-ability", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(event.currentTarget.dataset.index);
        const grants = this._getJobAbilityGrants();
        grants.splice(index, 1);
        this.item.update({
          "system.ability_grants": grants,
          "system.granted_ability": "",
        });
        this.render();
      });
    }
    if (this._hasSummonActorSupport()) {
      html.on(
        "click.ffxivItemSheet",
        ".summon-actor-edit",
        this._onEditSummonActor.bind(this),
      );
      html.on(
        "click.ffxivItemSheet",
        ".move-summon-actor-up",
        this._moveSummonActor.bind(this, -1),
      );
      html.on(
        "click.ffxivItemSheet",
        ".move-summon-actor-down",
        this._moveSummonActor.bind(this, 1),
      );
      html.on("click.ffxivItemSheet", ".remove-summon-actor", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(event.currentTarget.dataset.index);
        const summons = this._getSummonActorGrants();
        summons.splice(index, 1);
        this.item.update({ "system.summon_actors": summons });
        this.render();
      });
    }

    // Modifiers, similar as tags
    html.on("change.ffxivItemSheet", ".modifier-name", (event) => {
      const index = event.currentTarget.dataset.index;
      const value = event.currentTarget.value;
      const modifiers = this.item.system.modifiers || [];
      if (modifiers[index]) {
        modifiers[index][0] = value; // Update name
        this.item.update({ "system.modifiers": modifiers });
      }
    });
    html.on("change.ffxivItemSheet", ".modifier-value", (event) => {
      const index = event.currentTarget.dataset.index;
      let value = event.currentTarget.value || 0;
      const modifiers = this.item.system.modifiers || [];
      if (modifiers[index]) {
        if (modifiers[index][0] != "FFXIV.Damages") {
          value = parseInt(value);
        }
        modifiers[index][1] = value; // Update value
        this.item.update({ "system.modifiers": modifiers });
      }
    });
    html.on("click.ffxivItemSheet", ".add-modifier", () => {
      const modifiers = this.item.system.modifiers || [];
      modifiers.push(["FFXIV.Attributes.Strength.long", 0]);
      this.item.update({ "system.modifiers": modifiers });
    });
    html.on("click.ffxivItemSheet", ".remove-modifier", (event) => {
      const index = event.currentTarget.dataset.index;
      const modifiers = this.item.system.modifiers || [];
      modifiers.splice(index, 1);
      this.item.update({ "system.modifiers": modifiers });
      this.render();
    });

    html.on(
      "click.ffxivItemSheet",
      ".item-delete",
      this._deleteItem.bind(this),
    );
    html.on(
      "click.ffxivItemSheet",
      ".quantity-form .delete",
      this._deleteItem.bind(this),
    );
    html.on(
      "click.ffxivItemSheet",
      ".quantity-form .item-qty-btn-rm",
      this._decreaseQuantity.bind(this),
    );
    html.on(
      "click.ffxivItemSheet",
      ".quantity-form .item-qty-btn-add",
      this._increaseQuantity.bind(this),
    );
    html.on(
      "click.ffxivItemSheet",
      ".item-qty-btn.gear-equip",
      this._toggleEquip.bind(this),
    );

    html.on(
      "click.ffxivItemSheet",
      ".item-roll-button",
      this._rollItem.bind(this),
    );

    html.on("keydown.ffxivItemSheet", (event) => {
      if (event.key === "Enter") {
        event.preventDefault(); // Prevent the Enter key from triggering the button
      }
    });
  }

  _getSheetClasses() {
    return ["ffxiv", "sheet", "item", `${CONFIG.theme}_theme`];
  }

  _activatePrimaryTabs() {
    const nav = this.element.querySelector(".sheet-tabs");
    if (!nav) return;

    const tabs = Array.from(
      this.element.querySelectorAll(".sheet-body .tab[data-tab]"),
    );
    const links = Array.from(nav.querySelectorAll("[data-tab]"));
    if (!tabs.length || !links.length) return;

    let initial =
      this.tabGroups?.primary ||
      links.find((link) => link.classList.contains("active"))?.dataset.tab ||
      links[0]?.dataset.tab ||
      tabs[0]?.dataset.tab;
    if (!tabs.some((panel) => panel.dataset.tab === initial))
      initial = links[0]?.dataset.tab || tabs[0]?.dataset.tab;

    const activate = (tab) => {
      this.tabGroups.primary = tab;
      links.forEach((link) =>
        link.classList.toggle("active", link.dataset.tab === tab),
      );
      tabs.forEach((panel) => {
        const active = panel.dataset.tab === tab;
        panel.classList.toggle("active", active);
        panel.style.display = active ? "" : "none";
      });
    };

    this._tabController?.abort();
    this._tabController = new AbortController();
    links.forEach((link) => {
      link.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          activate(link.dataset.tab);
        },
        { capture: true, signal: this._tabController.signal },
      );
    });

    activate(initial);
  }

  async _rollItem(event) {
    event.preventDefault();
    event.stopPropagation();
    const templatePath =
      this.item.type == "gear"
        ? "systems/ffxiv/templates/chat/gear-chat-card.hbs"
        : "systems/ffxiv/templates/chat/item-chat-card.hbs";
    const enriched = await this.constructor.enrichAllStrings(
      this.item.system ?? {},
      this.item.getRollData(),
      this.item,
      true,
    );
    await ChatMessage.create({
      content: await foundry.applications.handlebars.renderTemplate(
        templatePath,
        {
          item: this.item,
          enriched,
        },
      ),
      flags: { core: { canParseHTML: true } },
      flavor: game.i18n.format("FFXIV.ItemType." + this.item.type),
    });

    if (typeof this.item._consumeFromInventoryIfNeeded === "function") {
      await this.item._consumeFromInventoryIfNeeded();
      if (!this.item?.parent && this.rendered) this.close();
    }
  }

  _decreaseQuantity(event) {
    event.preventDefault();
    event.stopPropagation();
    const newQuantity = this.item.system.quantity - 1;
    if (newQuantity < 1) {
      this._deleteItem(event);
      this._playConfiguredSound("soundNotificationFFXIV_deleteItem");
    } else {
      this.item.update({ "system.quantity": parseInt(newQuantity) });
    }
  }
  _increaseQuantity(event) {
    event.preventDefault();
    event.stopPropagation();
    this.item.update({
      "system.quantity": parseInt(this.item.system.quantity + 1),
    });
  }

  _deleteItem(event) {
    event.preventDefault();
    event.stopPropagation();
    new foundry.applications.api.DialogV2({
      id: "ffxiv-confirm-item-deletion",
      window: {
        title: game.i18n.localize("FFXIV.Dialogs.DialogTitleConfirmation"),
      },
      form: {
        submitOnChange: false,
        closeOnSubmit: true,
      },
      content: game.i18n.format("FFXIV.Dialogs.ItemDelete", {
        itemName: this.item.name,
      }),
      buttons: [
        {
          label: game.i18n.localize("FFXIV.Dialogs.Yes"),
          action: "delete",
          type: "submit",
          callback: () => {
            ui.notifications.info(
              game.i18n.format("FFXIV.Notifications.ItemDelete", {
                itemName: this.item.name,
              }),
            );
            this.item.delete();
            this.render();
          },
        },
        {
          label: game.i18n.localize("FFXIV.Dialogs.No"),
          action: "keep",
          type: "submit",
          callback: () => {},
        },
      ],
    }).render({ force: true });
  }

  async _toggleEquip(event) {
    event.preventDefault();
    event.stopPropagation();
    const actor = this.item.parent;
    if (actor?.documentName !== "Actor") return;

    const equippedGear = {
      ...Object.fromEntries(
        Object.keys(CONFIG.FFXIV.gear_subcategories).map((k) => [k, ""]),
      ),
      ...foundry.utils.deepClone(actor.system.equippedGear || {}),
    };

    debugLog("Before:", equippedGear);

    // Blank stored categories represent the default Arms option.
    const defaultCategory =
      CONFIG.FFXIV.gear_subcategories.Arms?.label ??
      Object.values(CONFIG.FFXIV.gear_subcategories)[0]?.label ??
      "";
    const selectedCategory = this.item.system.category || defaultCategory;
    const categoryKey = Object.keys(CONFIG.FFXIV.gear_subcategories).find(
      (key) =>
        CONFIG.FFXIV.gear_subcategories[key].label ===
        selectedCategory,
    );

    if (!categoryKey) {
      debugError(`Category not found for ${selectedCategory}`);
      ui.notifications.warn("Choose a gear category before equipping this item.");
      return;
    }

    const itemUpdate = {};
    if (!this.item.system.category) itemUpdate["system.category"] = selectedCategory;

    if (this.item.system.equipped) {
      equippedGear[categoryKey] = "";
      itemUpdate["system.equipped"] = false;
    } else {
      const currentEquipped = equippedGear[categoryKey];
      if (currentEquipped) {
        let oldItem = actor.items.get(currentEquipped);
        if (oldItem) {
          await oldItem.update({ "system.equipped": false }, { render: false });
          ui.notifications.info(
            game.i18n.format("FFXIV.Notifications.ReplaceGear", {
              oldGear: oldItem.name,
              newGear: this.item.name,
            }),
          );
        }
      }
      equippedGear[categoryKey] = this.item._id;
      itemUpdate["system.equipped"] = true;
    }

    await this.item.update(itemUpdate, { render: false });
    debugLog("After:", equippedGear);
    await actor.update({ "system.equippedGear": equippedGear }, { render: false });
    this._playConfiguredSound("soundNotificationFFXIV_moveItem");
    await this.render({ force: true });
    actor.sheet?.render?.({ force: true });
  }

  _onPopoutEditor(event) {
    event.preventDefault();
    const a = event.currentTarget.parentElement;
    const label = a.dataset.label;
    const key = a.dataset.target;

    const parent = $(a.parentElement);
    const parentPosition = $(parent).offset();

    const windowHeight =
      parseInt($(parent).height(), 10) + 100 < 400
        ? 400
        : parseInt($(parent).height(), 10) + 100;
    const windowWidth =
      parseInt($(parent).width(), 10) < 320
        ? 320
        : parseInt($(parent).width(), 10);
    const windowLeft = parseInt(parentPosition.left, 10);
    const windowTop = parseInt(parentPosition.top, 10);

    const title = a.dataset.label
      ? `Editor for ${this.item.name}: ${label}`
      : `Editor for ${this.item.name}`;

    new PopoutEditor(this.item, {
      name: key,
      window: { title },
      height: windowHeight,
      width: windowWidth,
      left: windowLeft,
      top: windowTop,
    }).render({ force: true });
  }

  _activateProseMirrorEditors() {
    this.element
      .querySelectorAll(".editor-content[data-edit]")
      .forEach((div) => this._activateEditor?.(div));
  }

  _captureSheetScroll() {
    const root = this.element;
    if (!root) return;

    const selectors = [
      ".window-content",
      ".sheet-body",
      ".sheet-body .tab.active",
    ];

    this._pendingSheetScrollPositions = selectors.flatMap((selector) => {
      const element = root.matches?.(selector)
        ? root
        : root.querySelector(selector);
      if (!element) return [];
      return [
        {
          selector,
          scrollTop: element.scrollTop,
          scrollLeft: element.scrollLeft,
        },
      ];
    });
  }

  _restoreSheetScroll() {
    const positions = this._pendingSheetScrollPositions;
    if (!positions?.length) return;
    const restore = () => {
      for (const position of positions) {
        const root = this.element;
        const element = root?.matches?.(position.selector)
          ? root
          : root?.querySelector(position.selector);
        if (!element) continue;
        element.scrollTop = position.scrollTop;
        element.scrollLeft = position.scrollLeft;
      }
      if (this._pendingSheetScrollPositions === positions) {
        this._pendingSheetScrollPositions = null;
      }
    };

    requestAnimationFrame(() => {
      restore();
      setTimeout(() => {
        if (this._pendingSheetScrollPositions === positions) restore();
      }, 50);
    });
  }

  _activateFormulaFieldVisibility() {
    const updateVisibility = () => {
      const hasText = (value) => String(value ?? "").trim().length > 0;
      this.element
        .querySelectorAll("[data-formula-source]")
        .forEach((input) => {
          const key = input.dataset.formulaSource;
          const target = this.element.querySelector(
            `[data-formula-target="${key}"]`,
          );
          if (!target) return;
          target.style.display = hasText(input.value) ? "" : "none";
        });

      const directHitInput = this.element.querySelector(
        'input[name="system.direct_hit"]',
      );
      const gate = this.element.querySelector("[data-direct-hit-gate]");
      if (gate && directHitInput) {
        gate.style.display = hasText(directHitInput.value) ? "" : "none";
      }
    };

    this._formulaVisibilityController?.abort();
    this._formulaVisibilityController = new AbortController();
    const { signal } = this._formulaVisibilityController;
    const formulaInputs = this.element.querySelectorAll(
      '[data-formula-source], input[name="system.direct_hit"]',
    );
    formulaInputs.forEach((input) =>
      input.addEventListener("input", updateVisibility, { signal }),
    );
    updateVisibility();
  }

  _isLimitedDisplayMode() {
    if (this.options?.ffxivForceFullSheet) return false;
    if (this.item.type === "consumable") {
      return (
        this.item.parent != null || Boolean(this.item.flags?.["item-piles"])
      );
    }
    if (this.item.type === "gear") return this.item.parent != null;
    return false;
  }

  _fitLimitedDisplayToContent() {
    const fit = () =>
      requestAnimationFrame(() => {
        const limited = this.element.querySelector(".limited-display");
        if (!limited) return;

        const windowContent = this.element.querySelector(".window-content");
        if (!windowContent) return;
        const itemCard = limited.querySelector(".item-card") ?? limited;

        const elementRect = this.element.getBoundingClientRect();
        const contentRect = windowContent.getBoundingClientRect();
        const horizontalChrome = Math.max(
          0,
          Math.ceil(elementRect.width - contentRect.width),
        );
        const verticalChrome = Math.max(
          0,
          Math.ceil(elementRect.height - contentRect.height),
        );

        const cardRect = itemCard.getBoundingClientRect();
        const contentWidth = Math.ceil(cardRect.width);
        const contentHeight = Math.ceil(cardRect.height);

        const defaultWidth =
          Number(this.constructor.DEFAULT_OPTIONS?.position?.width) || 520;
        const viewportWidth = Math.max(280, window.innerWidth - 24);
        const maxWidth = Math.min(defaultWidth, viewportWidth);
        const maxHeight = Math.max(260, window.innerHeight - 24);

        const targetWidth = Math.min(
          maxWidth,
          contentWidth + horizontalChrome + 8,
        );
        const baseHeight = Math.min(
          maxHeight,
          contentHeight + verticalChrome + 4,
        );
        this.setPosition({ width: targetWidth, height: baseHeight });

        requestAnimationFrame(() => {
          const liveContentRect = windowContent.getBoundingClientRect();
          const liveCardRect = itemCard.getBoundingClientRect();
          const cardOverflow = Math.ceil(
            liveCardRect.bottom - liveContentRect.bottom,
          );
          const actionEl =
            limited.querySelector(".item-roll-button") ??
            limited.querySelector(".quantity-form");
          const actionRect = actionEl?.getBoundingClientRect();
          const actionOverflow = actionRect
            ? Math.ceil(actionRect.bottom - liveContentRect.bottom)
            : 0;
          const overflow = Math.max(cardOverflow, actionOverflow);

          if (overflow > 0) {
            const correctedHeight = Math.min(
              maxHeight,
              baseHeight + overflow + 8,
            );
            this.setPosition({ width: targetWidth, height: correctedHeight });
          }
        });
      });

    fit();

    const images = this.element.querySelectorAll(".limited-display img");
    for (const image of images) {
      if (image.complete) continue;
      image.addEventListener("load", fit, { once: true });
      image.addEventListener("error", fit, { once: true });
    }
    setTimeout(fit, 60);
    setTimeout(fit, 180);
    setTimeout(fit, 360);
  }

  setPosition(position = {}) {
    if (this._isLimitedDisplayMode()) {
      const defaultWidth =
        Number(this.constructor.DEFAULT_OPTIONS?.position?.width) || 520;
      const viewportWidth = Math.max(280, window.innerWidth - 24);
      const maxWidth = Math.min(defaultWidth, viewportWidth);
      const maxHeight = Math.max(260, window.innerHeight - 24);
      if (Number.isFinite(position.width))
        position.width = Math.min(position.width, maxWidth);
      if (Number.isFinite(position.height))
        position.height = Math.min(position.height, maxHeight);
    }
    return super.setPosition(position);
  }

  _activateJobDropZone() {
    this._jobDropController?.abort();
    if (!["job", "augment"].includes(this.item.type) || !this.document.isOwner)
      return;

    const dropZoneSelector =
      this.item.type === "augment"
        ? ".augment-grants-dropzone"
        : ".job-progression-tab, .job-pets-tab";
    const dropZones = this.element.querySelectorAll(dropZoneSelector);
    if (!dropZones.length) return;

    this._jobDropController = new AbortController();
    const { signal } = this._jobDropController;

    const allowDrop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      event.currentTarget.classList.add("drag-over");
    };

    for (const dropZone of dropZones) {
      dropZone.addEventListener("dragenter", allowDrop, { signal });
      dropZone.addEventListener("dragover", allowDrop, { signal });
      dropZone.addEventListener(
        "dragleave",
        (event) => {
          if (!dropZone.contains(event.relatedTarget))
            dropZone.classList.remove("drag-over");
        },
        { signal },
      );
      dropZone.addEventListener(
        "drop",
        (event) => {
          dropZone.classList.remove("drag-over");
          if (dropZone.classList.contains("job-pets-tab")) {
            this._onDropJobPet(event);
            return;
          }
          this._onDropJobAbility(event);
        },
        { signal },
      );
    }
  }

  _activateJobGrantReorder() {
    this._jobGrantReorderController?.abort();
    if (this.item.type !== "job" || !this.document.isOwner) return;

    const list = this.element.querySelector(".job-progression-tab .job-ability-list");
    if (!list) return;

    this._jobGrantReorderController = new AbortController();
    const { signal } = this._jobGrantReorderController;
    const rows = Array.from(list.querySelectorAll(".job-ability-row"));

    for (const row of rows) {
      row.draggable = true;
      row.addEventListener(
        "dragstart",
        (event) => this._onJobGrantDragStart(event),
        { signal },
      );
      row.addEventListener(
        "dragover",
        (event) => this._onJobGrantDragOver(event),
        { signal },
      );
      row.addEventListener(
        "dragleave",
        (event) => this._onJobGrantDragLeave(event),
        { signal },
      );
      row.addEventListener(
        "drop",
        (event) => this._onJobGrantDrop(event),
        { signal },
      );
      row.addEventListener(
        "dragend",
        () => this._clearJobGrantDragState(),
        { signal },
      );
    }

    list.addEventListener(
      "dragover",
      (event) => {
        if (!Number.isInteger(this._getJobGrantDragIndex(event))) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      },
      { signal },
    );
  }

  _onJobGrantDragStart(event) {
    if (event.target?.closest?.("button")) {
      event.preventDefault();
      return;
    }

    const row = event.currentTarget;
    const index = Number(row?.dataset?.index);
    if (!Number.isInteger(index)) return;

    this._jobGrantDragIndex = index;
    this._jobGrantDragInProgress = true;
    event.dataTransfer?.setData("application/x-ffxiv-job-grant-index", String(index));
    event.dataTransfer?.setData("text/plain", `ffxiv-job-grant:${index}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    row.classList.add("dragging");
  }

  _onJobGrantDragOver(event) {
    const sourceIndex = this._getJobGrantDragIndex(event);
    if (!Number.isInteger(sourceIndex)) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

    const row = event.currentTarget;
    const targetIndex = Number(row?.dataset?.index);
    if (!Number.isInteger(targetIndex) || targetIndex === sourceIndex) {
      this._clearJobGrantDropTargets();
      return;
    }

    this._clearJobGrantDropTargets(row);
    row.classList.toggle("drop-before", sourceIndex > targetIndex);
    row.classList.toggle("drop-after", sourceIndex < targetIndex);
  }

  _onJobGrantDragLeave(event) {
    const row = event.currentTarget;
    if (row.contains(event.relatedTarget)) return;
    row.classList.remove("drop-before", "drop-after");
  }

  async _onJobGrantDrop(event) {
    const sourceIndex = this._getJobGrantDragIndex(event);
    if (!Number.isInteger(sourceIndex)) return;

    event.preventDefault();
    event.stopPropagation();
    const targetIndex = Number(event.currentTarget?.dataset?.index);
    if (!Number.isInteger(targetIndex) || targetIndex === sourceIndex) {
      this._clearJobGrantDragState();
      return;
    }

    await this._moveJobGrantToIndex(sourceIndex, targetIndex);
    this._clearJobGrantDragState();
  }

  _getJobGrantDragIndex(event) {
    const raw =
      event?.dataTransfer?.getData("application/x-ffxiv-job-grant-index") ??
      "";
    const index = raw === "" ? this._jobGrantDragIndex : Number(raw);
    return Number.isInteger(index) ? index : null;
  }

  _clearJobGrantDropTargets(except = null) {
    this.element
      .querySelectorAll(".job-ability-row.drop-before, .job-ability-row.drop-after")
      .forEach((row) => {
        if (row === except) return;
        row.classList.remove("drop-before", "drop-after");
      });
  }

  _clearJobGrantDragState() {
    if (this._jobGrantDragInProgress) {
      this._jobGrantDragJustEnded = true;
      setTimeout(() => {
        this._jobGrantDragJustEnded = false;
      }, 100);
    }
    this._jobGrantDragIndex = null;
    this._jobGrantDragInProgress = false;
    this.element
      .querySelectorAll(".job-ability-row.dragging, .job-ability-row.drop-before, .job-ability-row.drop-after")
      .forEach((row) =>
        row.classList.remove("dragging", "drop-before", "drop-after"),
      );
  }

  async _moveJobGrantToIndex(sourceIndex, targetIndex) {
    const grants = this._getJobAbilityGrants();
    if (!grants[sourceIndex] || !grants[targetIndex]) return;

    const [grant] = grants.splice(sourceIndex, 1);
    grants.splice(targetIndex, 0, grant);
    this._captureSheetScroll();
    await this.item.update(
      { "system.ability_grants": grants },
      { render: false },
    );
    this.render({ force: true });
  }

  _activateSummonDropZone() {
    this._summonDropController?.abort();
    if (
      !this._hasSummonActorSupport() ||
      !this.document.isOwner ||
      !this._isItemEditMode()
    )
      return;

    const dropZones = this.element.querySelectorAll(".summon-actors-dropzone");
    if (!dropZones.length) return;

    this._summonDropController = new AbortController();
    const { signal } = this._summonDropController;

    const allowDrop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      event.currentTarget.classList.add("drag-over");
    };

    for (const dropZone of dropZones) {
      dropZone.addEventListener("dragenter", allowDrop, { signal });
      dropZone.addEventListener("dragover", allowDrop, { signal });
      dropZone.addEventListener(
        "dragleave",
        (event) => {
          if (!dropZone.contains(event.relatedTarget))
            dropZone.classList.remove("drag-over");
        },
        { signal },
      );
      dropZone.addEventListener(
        "drop",
        (event) => {
          dropZone.classList.remove("drag-over");
          this._onDropSummonActor(event);
        },
        { signal },
      );
    }
  }

  async _onEditSummonActor(event) {
    event.preventDefault();
    event.stopPropagation();

    const index = Number(event.currentTarget.dataset.index);
    const summon = this._getSummonActorEntries()[index];
    if (!summon?.uuid) return;

    try {
      const actor = await fromUuid(summon.uuid);
      if (actor?.documentName === "Actor") {
        actor.sheet.render({ force: true });
        return;
      }
    } catch (_error) { }
    ui.notifications.warn(
      game.i18n.format("FFXIV.Notifications.SummonActorMissing", {
        actor: summon.name || game.i18n.localize("FFXIV.ItemType.ability"),
      }),
    );
  }

  async _moveSummonActor(direction, event) {
    event.preventDefault();
    event.stopPropagation();

    const index = Number(event.currentTarget.dataset.index);
    const summons = this._getSummonActorGrants();
    const target = index + direction;
    if (!summons[index] || !summons[target]) return;

    [summons[index], summons[target]] = [summons[target], summons[index]];
    await this.item.update(
      { "system.summon_actors": summons },
      { render: false },
    );
    this.render({ force: true });
  }

  _onPickItemIcon(event) {
    event.preventDefault();
    event.stopPropagation();

    const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
    new FilePickerImpl({
      type: "imagevideo",
      current: this.item.img,
      callback: (path) => this.item.update({ img: path }),
    }).render(true);
  }

  _onPickEffectRuleIcon(event) {
    event.preventDefault();
    event.stopPropagation();

    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;

    const rules = this._getCurrentEffectRules();
    const rule = rules[index];
    if (!rule) return;

    const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
    new FilePickerImpl({
      type: "imagevideo",
      current: String(rule.iconOverride ?? rule.icon ?? "").trim(),
      callback: (path) => {
        rules[index].iconOverride = path;
        delete rules[index].icon;
        this._captureSheetScroll();
        this.item
          .update({ "system.effect_rules": rules }, { render: false })
          .then(() => this.render({ force: true }))
          .catch((err) => ui.notifications.error(err, { console: true }));
      },
    }).render(true);
  }

  _getDropData(event) {
    const dataTransfer =
      event.originalEvent?.dataTransfer || event.dataTransfer;
    if (!dataTransfer) return {};

    const formats = ["text/plain", "application/json", "text/json"];
    for (const format of formats) {
      const raw = dataTransfer.getData(format);
      if (!raw) continue;
      try {
        return JSON.parse(raw);
      } catch {
        if (raw.includes(".") || raw.length > 12) return { uuid: raw };
      }
    }

    return {};
  }

  _normalizeJobAbilityGrants(grants) {
    const entries = Array.isArray(grants)
      ? foundry.utils.deepClone(grants)
      : grants && typeof grants === "object"
        ? foundry.utils.deepClone(Object.values(grants))
        : [];
    return entries.map((entry) => this._normalizeJobGrantEntry(entry));
  }

  _normalizeJobPetGrants(grants) {
    return Array.isArray(grants)
      ? foundry.utils.deepClone(grants)
      : grants && typeof grants === "object"
        ? foundry.utils.deepClone(Object.values(grants))
        : [];
  }

  _getJobAbilityGrants() {
    const grants = this._normalizeJobAbilityGrants(
      this.item.system.ability_grants,
    );
    if (grants.length || this.item.type !== "augment") return grants;

    const legacyId = String(this.item.system?.granted_ability ?? "").trim();
    if (!legacyId) return grants;
    const legacyItem = game.items.get(legacyId);
    if (!legacyItem) return grants;

    const legacyData = legacyItem.toObject();
    delete legacyData._id;
    let legacyType = legacyItem.type;
    if (
      [
        "primary_ability",
        "secondary_ability",
        "instant_ability",
        "limit_break",
      ].includes(legacyType)
    ) {
      legacyType = "ability";
      legacyData.type = "ability";
      legacyData.system = legacyData.system || {};
      legacyData.system.tags = ensureAbilitySubtypeTags(
        [
          getSubtypeTagLabel(getAbilitySubtype(legacyItem)),
          ...(Array.isArray(legacyData.system.tags)
            ? legacyData.system.tags
            : []),
        ],
        "primary_ability",
      );
    }

    return [
      {
        uuid: legacyItem.uuid,
        name: legacyItem.name,
        type: legacyType,
        item: legacyData,
      },
    ];
  }

  _getJobPetGrants() {
    return this._normalizeJobPetGrants(this.item.system.pet_grants);
  }

  _getJobGrantTypeLabel(grantOrType) {
    // Accept either a grant object or a type string. Prefer to derive the
    // subtype from the grant's item (tags) when available so we can display
    // "Primary", "Secondary", "Instant", "Trait", or "Limit Break".
    let type = typeof grantOrType === "string" ? grantOrType : String(grantOrType?.type ?? "");
    const item = typeof grantOrType === "object" ? grantOrType.item : null;

    const legacyTypes = new Set([
      "primary_ability",
      "secondary_ability",
      "instant_ability",
      "limit_break",
    ]);

    if (type === "ability" || legacyTypes.has(type)) {
      // Try to detect the specific ability subtype from the provided item.
      const subtype = getAbilitySubtype(item) || (legacyTypes.has(type) ? type : "");
      if (subtype) {
        const localized = game.i18n.localize(`FFXIV.ItemType.${subtype}`);
        return localized.replace(/\s+Ability$/i, "");
      }
      return game.i18n.localize("FFXIV.ItemType.ability");
    }

    const label = game.i18n.localize(`FFXIV.ItemType.${type}`);
    return label.replace(/\s+Ability$/i, "");
  }

  _getJobPetGrantTypeLabel() {
    return game.i18n.localize("FFXIV.ItemType.pet");
  }

  _normalizeJobGrantEntry(grant) {
    if (!grant || typeof grant !== "object") return grant;
    const nextGrant = foundry.utils.deepClone(grant);
    const legacyTypes = new Set([
      "primary_ability",
      "secondary_ability",
      "instant_ability",
      "limit_break",
    ]);
    const grantType = String(nextGrant.type ?? "");
    const itemType = String(nextGrant.item?.type ?? "");
    const fallbackSubtype = legacyTypes.has(grantType)
      ? grantType
      : legacyTypes.has(itemType)
        ? itemType
        : getAbilitySubtype(nextGrant.item);

    if (grantType === "ability" || legacyTypes.has(grantType)) {
      nextGrant.type = "ability";
    }

    if (
      nextGrant.item &&
      typeof nextGrant.item === "object" &&
      (itemType === "ability" || legacyTypes.has(itemType))
    ) {
      nextGrant.item.type = "ability";
      nextGrant.item.system = nextGrant.item.system || {};
      nextGrant.item.system.tags = ensureAbilitySubtypeTags(
        nextGrant.item.system.tags,
        fallbackSubtype || "primary_ability",
      );
    }
    return nextGrant;
  }

  async _getJobGrantItemData(grant) {
    if (grant.item)
      return foundry.utils.deepClone(this._normalizeJobGrantEntry(grant).item);

    const sourceItem = grant.uuid ? await fromUuid(grant.uuid) : null;
    if (!sourceItem) return null;

    const itemData = sourceItem.toObject();
    delete itemData._id;
    return itemData;
  }

  async _getJobGrantActorData(grant) {
    if (grant.uuid) {
      const sourceActor = await fromUuid(grant.uuid).catch(() => null);
      if (sourceActor) {
        const actorData = sourceActor.toObject();
        delete actorData._id;
        return actorData;
      }
    }

    if (grant.actor) return foundry.utils.deepClone(grant.actor);
    return null;
  }

  async _onEditJobAbility(event) {
    event.preventDefault();
    event.stopPropagation();
    if (this._jobGrantDragJustEnded) return;

    const index = Number(event.currentTarget.dataset.index);
    const grants = this._getJobAbilityGrants();
    const grant = grants[index];
    if (!grant) return;

    const itemData = await this._getJobGrantItemData(grant);
    if (!itemData) {
      ui.notifications.warn("Could not find the mapped item to edit.");
      return;
    }

    const tempItem = new CONFIG.Item.documentClass(itemData, {
      temporary: true,
    });
    const persistGrant = async (changes) => {
      const update = foundry.utils.expandObject(changes);
      const nextData = foundry.utils.mergeObject(
        foundry.utils.deepClone(itemData),
        update,
        {
          inplace: false,
          overwrite: true,
        },
      );
      delete nextData._id;

      grants[index] = {
        ...grants[index],
        name: nextData.name,
        type: nextData.type,
        item: nextData,
      };
      const updateData = { "system.ability_grants": grants };
      if (this.item.type === "augment")
        updateData["system.granted_ability"] = "";
      await this.item.update(updateData, { render: false });

      foundry.utils.mergeObject(itemData, nextData, {
        inplace: true,
        overwrite: true,
      });
      tempItem.updateSource(update);
      this.render({ force: true });
      return tempItem;
    };

    tempItem.update = persistGrant;
    tempItem.sheet.render({ force: true });
  }

  async _onEditJobPet(event) {
    event.preventDefault();
    event.stopPropagation();

    const index = Number(event.currentTarget.dataset.index);
    const grants = this._getJobPetGrants();
    const grant = grants[index];
    if (!grant) return;

    const actorData = await this._getJobGrantActorData(grant);
    if (!actorData) {
      ui.notifications.warn("Could not find the mapped pet to edit.");
      return;
    }

    const tempActor = new CONFIG.Actor.documentClass(actorData, {
      temporary: true,
    });
    const persistGrant = async (changes) => {
      const update = foundry.utils.expandObject(changes);
      const nextData = foundry.utils.mergeObject(
        foundry.utils.deepClone(actorData),
        update,
        {
          inplace: false,
          overwrite: true,
        },
      );
      delete nextData._id;

      grants[index] = {
        ...grants[index],
        name: nextData.name,
        type: nextData.type,
        actor: nextData,
      };
      await this.item.update(
        {
          "system.pet_grants": grants,
          "system.has_pets": grants.length > 0,
        },
        { render: false },
      );

      foundry.utils.mergeObject(actorData, nextData, {
        inplace: true,
        overwrite: true,
      });
      tempActor.updateSource(update);
      this.render({ force: true });
      return tempActor;
    };

    tempActor.update = persistGrant;
    tempActor.sheet.render({ force: true });
  }

  async _moveJobAbility(direction, event) {
    event.preventDefault();
    event.stopPropagation();

    const index = Number(event.currentTarget.dataset.index);
    const grants = this._getJobAbilityGrants();
    const target = index + direction;
    if (!grants[index] || !grants[target]) return;

    [grants[index], grants[target]] = [grants[target], grants[index]];
    this._captureSheetScroll();
    await this.item.update(
      { "system.ability_grants": grants },
      { render: false },
    );
    this.render({ force: true });
  }

  async _moveJobPet(direction, event) {
    event.preventDefault();
    event.stopPropagation();

    const index = Number(event.currentTarget.dataset.index);
    const grants = this._getJobPetGrants();
    const target = index + direction;
    if (!grants[index] || !grants[target]) return;

    [grants[index], grants[target]] = [grants[target], grants[index]];
    this._captureSheetScroll();
    await this.item.update(
      { "system.pet_grants": grants },
      { render: false },
    );
    this.render({ force: true });
  }

  async _onDropJobAbility(event) {
    event.preventDefault();
    event.stopPropagation();

    const data = this._getDropData(event);
    let item = data.uuid ? await fromUuid(data.uuid) : null;
    if (!item && typeof Item.implementation.fromDropData === "function") {
      item = await Item.implementation.fromDropData(data);
    }
    const validTypes = [
      "ability",
      "primary_ability",
      "secondary_ability",
      "instant_ability",
      "limit_break",
      "trait",
    ];
    if (!item || !validTypes.includes(item.type)) {
      ui.notifications.warn(
        this.item.type === "augment"
          ? game.i18n.localize("FFXIV.Augment.DropAbilities")
          : game.i18n.localize("FFXIV.Job.DropAbilities"),
      );
      return;
    }

    const grants = this._getJobAbilityGrants();
    if (grants.some((grant) => grant.uuid === item.uuid)) return;
    const itemData = item.toObject();
    delete itemData._id;
    let itemType = item.type;
    if (
      [
        "primary_ability",
        "secondary_ability",
        "instant_ability",
        "limit_break",
      ].includes(itemType)
    ) {
      itemType = "ability";
      itemData.type = "ability";
      itemData.system = itemData.system || {};
      itemData.system.tags = ensureAbilitySubtypeTags(
        [
          getSubtypeTagLabel(getAbilitySubtype(item)),
          ...(Array.isArray(itemData.system.tags) ? itemData.system.tags : []),
        ],
        "primary_ability",
      );
    }
    grants.push({
      uuid: item.uuid,
      name: item.name,
      type: itemType,
      item: itemData,
    });
    const updateData = { "system.ability_grants": grants };
    if (this.item.type === "augment") updateData["system.granted_ability"] = "";
    await this.item.update(updateData, { render: false });
    this.render({ force: true });
  }

  async _onDropJobPet(event) {
    event.preventDefault();
    event.stopPropagation();

    const data = this._getDropData(event);
    let actor = data.uuid ? await fromUuid(data.uuid) : null;
    if (!actor && typeof Actor.implementation.fromDropData === "function") {
      actor = await Actor.implementation.fromDropData(data);
    }
    if (!actor || actor.documentName !== "Actor" || actor.type !== "pet") {
      ui.notifications.warn(game.i18n.localize("FFXIV.Job.DropPets"));
      return;
    }

    const grants = this._getJobPetGrants();
    if (grants.some((grant) => grant.uuid === actor.uuid)) return;
    const actorData = actor.toObject();
    delete actorData._id;
    grants.push({
      uuid: actor.uuid,
      name: actor.name,
      type: actor.type,
      actor: actorData,
    });
    await this.item.update(
      {
        "system.pet_grants": grants,
        "system.has_pets": true,
      },
      { render: false },
    );
    this.render({ force: true });
  }

  async _onDropSummonActor(event) {
    event.preventDefault();
    event.stopPropagation();

    const data = this._getDropData(event);
    let actor = data.uuid ? await fromUuid(data.uuid) : null;
    if (!actor && typeof Actor.implementation.fromDropData === "function") {
      actor = await Actor.implementation.fromDropData(data);
    }
    if (!actor || actor.documentName !== "Actor") {
      ui.notifications.warn(game.i18n.localize("FFXIV.Abilities.DropSummons"));
      return;
    }

    const summons = this._getSummonActorGrants();
    if (summons.some((summon) => summon.uuid === actor.uuid)) return;

    summons.push({
      uuid: actor.uuid,
      name: actor.name,
      type: actor.type,
    });
    await this.item.update(
      { "system.summon_actors": summons },
      { render: false },
    );
    this.render({ force: true });
  }
}
