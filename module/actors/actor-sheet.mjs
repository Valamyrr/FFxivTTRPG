import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';
import { debugError, debugLog } from "../helpers/debug.mjs";
import { getAbilitySubtype, getSubtypeTagLabel, ensureAbilitySubtypeTags } from "../helpers/ability-subtype.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

let isDraggingItem = false;
let draggedItem = null;

const NUMERIC_ACTOR_FIELD = /^(?:system\.(?:primary_attributes\.[^.]+\.value|secondary_attributes\.[^.]+\.value|adventuring_rank\.[^.]+|health\.(?:value|max)|barrier\.(?:value|max)|mana\.(?:value|max)|experience\.level\.(?:value|max)|criticalRange)|prototypeToken\.(?:width|height))$/;
const CHARACTER_LOCK_ALLOWED_FIELDS = new Set([
  "system.health.value",
  "system.barrier.value",
  "system.barrier.max",
  "system.fortune",
]);
const NPC_LOCK_ALLOWED_FIELDS = new Set([
  "system.health.value",
  "system.barrier.value",
]);
const ENTER_COMMIT_FIELDS = new Set([
  "system.health.value",
  "system.health.max",
  "system.barrier.value",
  "system.barrier.max",
]);
const EDIT_MODE_ACTOR_TYPES = new Set(["character", "npc", "pet"]);

const DEFAULT_SOUNDS = {
  soundNotificationFFXIV_deleteItem: "systems/ffxiv/assets/sfx/ffxiv-close-window.mp3",
  soundNotificationFFXIV_moveItem: "systems/ffxiv/assets/sfx/ffxiv-obtain-item.mp3",
  soundNotificationFFXIV_openSheet: "systems/ffxiv/assets/sfx/ffxiv-switch-target.mp3",
  soundNotificationFFXIV_closeSheet: "systems/ffxiv/assets/sfx/ffxiv-untarget.mp3",
};

const DEFAULT_ATTRIBUTE_ICONS = {
  attributesImgDefense: "systems/ffxiv/assets/attribute-icons/rampart.webp",
  attributesImgMagicDefense: "systems/ffxiv/assets/attribute-icons/dark-mind.webp",
  attributesImgVigilance: "systems/ffxiv/assets/attribute-icons/duty-finder.webp",
  attributesImgSpeed: "systems/ffxiv/assets/attribute-icons/sightseeing-log.webp",
};

const CHARACTER_TAB_PARTIALS = {
  abilities: "systems/ffxiv/templates/actor/parts/actor-abilities.hbs",
  attributes: "systems/ffxiv/templates/actor/parts/actor-attributes.hbs",
  roleplay: "systems/ffxiv/templates/actor/parts/actor-profile.hbs",
  items: "systems/ffxiv/templates/actor/parts/actor-items.hbs",
  companions: "systems/ffxiv/templates/actor/parts/actor-companions.hbs",
  effects: "systems/ffxiv/templates/actor/parts/actor-effects.hbs",
  settings: "systems/ffxiv/templates/actor/parts/actor-settings.hbs",
};

const CHARACTER_TABS = Object.keys(CHARACTER_TAB_PARTIALS);

const ACTOR_ENRICHED_FIELDS = {
  roleplay: ["profile_trait.effect", "biography"],
  companions: ["traits"],
};

const ITEM_ENRICHED_FIELDS = {
  ability: ["base_effect", "direct_hit", "limitations", "marker_area", "origin", "marker_trigger", "marker_effect", "description"],
  trait: ["description"],
  limit_break: ["description"],
  augment: ["base_effect"],
  minion: ["traits", "description"],
  title: ["description"],
};

/**
 * ApplicationV2 implementation of the FFXIV actor sheet.
 * @extends {ActorSheetV2}
 */
export class FFXIVActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  tabGroups = {
    primary: "abilities",
  };

  /** @override */
  constructor(...args) {
    super(...args);
    this.currentAbilityTab = "primary";
    this.actorEditMode = false;
    this._enrichedCache = null;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['ffxiv', 'sheet', 'actor'],
    position: {
      width: 840,
      height: 735,
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
      template: "systems/ffxiv/templates/actor/actor-character-sheet.hbs",
      scrollable: [".window-content", ".sheet-body"],
    },
  };

  /** @override */
  get template() {
    const actorType = this.actor?.type || "character";
    return `systems/ffxiv/templates/actor/actor-${actorType}-sheet.hbs`;
  }

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.sheet.template = this.template;
    return parts;
  }

  /** @override */
  setPosition(position = {}) {
    if (this.actor?.type === "character" && Number.isFinite(position.width)) {
      position = {
        ...position,
        width: Math.min(840, Math.max(782, position.width)),
      };
    }
    if (this.actor?.type === "npc" && Number.isFinite(position.width)) {
      position = {
        ...position,
        width: Math.min(920, Math.max(730, position.width)),
      };
    }
    if (this.actor?.type === "pet" && Number.isFinite(position.width)) {
      position = {
        ...position,
        width: Math.min(920, Math.max(650, position.width)),
      };
    }
    return super.setPosition(position);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const skipEnrichment = options?.ffxivSkipEnrichment === true;
    const renderedTabs = this._getRenderedActorTabs(options);

    const actorData = this.document.toObject(false);
    context.actor = this.actor;
    context.items = actorData.items ?? [];
    context.system = actorData.system;
    context.source = this.actor._source.system;
    context.flags = actorData.flags;
    context.config = CONFIG.FFXIV;
    context.cssClass = this._getSheetClasses().join(" ");
    context.editable = this.document.isOwner;
    context.actorEditMode = this._isActorEditMode();
    context.limited = this.actor.limited;
    context.renderedActorTabs = Object.fromEntries(CHARACTER_TABS.map(tab => [tab, renderedTabs.has(tab)]));
    context.currentAbilityTab = this._getCurrentAbilityTab();

    context.settings = {
      "showGear": game.settings.get('ffxiv', 'toggleGear'),
      "tabHue": game.settings.get('ffxiv', 'hueTabsIcons'),
      "attributesImgSpeed": this._settingOrDefault("attributesImgSpeed", DEFAULT_ATTRIBUTE_ICONS),
      "attributesImgDefense": this._settingOrDefault("attributesImgDefense", DEFAULT_ATTRIBUTE_ICONS),
      "attributesImgMagicDefense": this._settingOrDefault("attributesImgMagicDefense", DEFAULT_ATTRIBUTE_ICONS),
      "attributesImgVigilance": this._settingOrDefault("attributesImgVigilance", DEFAULT_ATTRIBUTE_ICONS)
    }
    context.npcHeaderDisposition = this._getNpcHeaderDisposition();

    if (actorData.type === 'character') {
      this._prepareItems(context);
      this._prepareSharedData(context);
      this._prepareCharacterData(context);

      const petIds = actorData.system.pets || [];
      context.pets = [];

      for (const id of petIds) {
        const pet = game.actors.get(id);
        if (!pet) continue;

        const petData = pet.toObject();
        context.pets.push(petData);
      }
    }

    if (actorData.type === 'npc' || actorData.type === 'pet') {
      this._prepareItems(context);
      this._prepareSharedData(context);
      const fightAbilityTypes = new Set(["primary_ability", "secondary_ability", "instant_ability"]);
      const hasFightAbilities = (context.items || []).some((item) => fightAbilityTypes.has(getAbilitySubtype(item)));
      const hasTraits = (context.items || []).some((item) => item.type === "trait");
      const hasLimitBreak = (context.items || []).some((item) => getAbilitySubtype(item) === "limit_break");

      if (actorData.type === "npc") {
        context.hasNpcFightAbilities = hasFightAbilities;
        context.hasNpcTraitAbilities = hasTraits || hasLimitBreak;
      } else {
        context.hasPetFightAbilities = hasFightAbilities;
        context.hasPetTraitAbilities = hasTraits;
      }
    }

    if (!skipEnrichment) {
      await this._prepareEnrichedContext(context, renderedTabs);
      this._cacheEnrichedContext(context);
    } else {
      this._applyCachedEnrichment(context);
    }

    context.effects = prepareActiveEffectCategories(this.actor.effects.contents);
    this._effectsPanelSignature = this._getEffectsPanelSignature(context.effects);
    return context;
  }

  _getRenderedActorTabs(options = {}) {
    if (this.actor?.type !== "character") return new Set(CHARACTER_TABS);
    if (options?.ffxivRenderAllTabs === true) return new Set(CHARACTER_TABS);
    const requested = Array.isArray(options?.ffxivRenderTabs) ? options.ffxivRenderTabs : null;
    if (requested?.length) return new Set(requested.filter(tab => CHARACTER_TABS.includes(tab)));
    const tab = this.tabGroups?.primary || "abilities";
    return new Set([CHARACTER_TABS.includes(tab) ? tab : "abilities"]);
  }

  async _prepareEnrichedContext(context, renderedTabs) {
    context.enriched = {};

    const rollData = this.actor.getRollData();
    const actorTabs = this.actor.type === "character" ? renderedTabs : new Set(CHARACTER_TABS);

    if (actorTabs.has("roleplay")) {
      context.enriched = {
        ...context.enriched,
        ...await this.constructor.enrichStringFields(this.actor.system, ACTOR_ENRICHED_FIELDS.roleplay, rollData, this.actor),
      };
    }

    const itemTabs = this.actor.type === "character" ? actorTabs : new Set(["abilities", "items", "companions", "roleplay"]);
    const abilityTypes = this.actor.type === "character" && itemTabs.has("abilities")
      ? this._getRenderedAbilityTypes()
      : null;
    for (const item of context.items || []) {
      item.enriched = await this._enrichItemForTabs(item, itemTabs, null, {
        abilityTypes,
      });
    }

    if (this.actor.type !== "character" && ACTOR_ENRICHED_FIELDS.companions?.length) {
      context.enriched = {
        ...context.enriched,
        ...await this.constructor.enrichStringFields(this.actor.system, ACTOR_ENRICHED_FIELDS.companions, rollData, this.actor),
      };
    }

    if (!actorTabs.has("companions")) return;

    for (const pet of context.pets || []) {
      const petDocument = game.actors.get(pet._id);
      pet.enriched = await this.constructor.enrichStringFields(
        pet.system,
        ACTOR_ENRICHED_FIELDS.companions,
        petDocument?.getRollData?.() ?? rollData,
        petDocument ?? this.actor,
      );
      for (const item of pet.items || []) {
        item.enriched = await this._enrichItemForTabs(item, new Set(["abilities"]), petDocument ?? this.actor);
      }
    }
  }

  async _enrichItemForTabs(item, renderedTabs, relativeTo = null, options = {}) {
    const fields = new Set();
    const subtype = getAbilitySubtype(item);

    if (renderedTabs.has("abilities")) {
      const abilityTypes = options.abilityTypes;
      const canRenderAbility = !abilityTypes || abilityTypes.has(subtype || item.type);
      if (canRenderAbility && item.type === "ability") ITEM_ENRICHED_FIELDS.ability.forEach(field => fields.add(field));
      if (canRenderAbility && item.type === "trait") ITEM_ENRICHED_FIELDS.trait.forEach(field => fields.add(field));
      if (canRenderAbility && subtype === "limit_break") ITEM_ENRICHED_FIELDS.limit_break.forEach(field => fields.add(field));
    }
    if (renderedTabs.has("items") && item.type === "augment") {
      ITEM_ENRICHED_FIELDS.augment.forEach(field => fields.add(field));
    }
    if (renderedTabs.has("companions") && item.type === "minion") {
      ITEM_ENRICHED_FIELDS.minion.forEach(field => fields.add(field));
    }
    if (renderedTabs.has("roleplay") && item.type === "title") {
      ITEM_ENRICHED_FIELDS.title.forEach(field => fields.add(field));
    }

    if (!fields.size) return {};
    const document = relativeTo?.items?.get?.(item._id) ?? this.actor.items.get(item._id) ?? relativeTo ?? this.actor;
    return this.constructor.enrichStringFields(item.system, Array.from(fields), this.actor.getRollData(), document);
  }

  _getNpcHeaderDisposition() {
    if (this.actor?.type !== "npc") return "secret";
    const disposition = Number(this.token?.disposition ?? this.actor?.prototypeToken?.disposition);
    const tokenDispositions = CONST?.TOKEN_DISPOSITIONS ?? {};
    if (disposition === Number(tokenDispositions.FRIENDLY)) return "friendly";
    if (disposition === Number(tokenDispositions.HOSTILE)) return "hostile";
    if (disposition === Number(tokenDispositions.SECRET)) return "secret";
    return "secret";
  }

  _cacheEnrichedContext(context) {
    const existing = this._enrichedCache;
    const itemMap = new Map(existing?.items ?? []);
    for (const item of context.items || []) {
      if (item.enriched) itemMap.set(item._id, foundry.utils.deepClone({
        ...(itemMap.get(item._id) || {}),
        ...item.enriched,
      }));
    }

    const petMap = new Map(existing?.pets ?? []);
    for (const pet of context.pets || []) {
      const existingPet = petMap.get(pet._id) || {};
      const petItems = new Map(existingPet.items ?? []);
      for (const item of pet.items || []) {
        if (item.enriched) petItems.set(item._id, foundry.utils.deepClone({
          ...(petItems.get(item._id) || {}),
          ...item.enriched,
        }));
      }
      petMap.set(pet._id, {
        enriched: foundry.utils.deepClone({
          ...(existingPet.enriched || {}),
          ...(pet.enriched || {}),
        }),
        items: petItems
      });
    }

    this._enrichedCache = {
      actor: foundry.utils.deepClone({
        ...(existing?.actor || {}),
        ...(context.enriched || {}),
      }),
      items: itemMap,
      pets: petMap
    };
  }

  _applyCachedEnrichment(context) {
    const cache = this._enrichedCache;
    if (!cache) {
      context.enriched = {};
      return;
    }
    context.enriched = foundry.utils.deepClone(cache.actor || {});
    for (const item of context.items || []) {
      item.enriched = foundry.utils.deepClone(cache.items?.get(item._id) || {});
    }
    for (const pet of context.pets || []) {
      const petCache = cache.pets?.get(pet._id);
      pet.enriched = foundry.utils.deepClone(petCache?.enriched || {});
      for (const item of pet.items || []) {
        item.enriched = foundry.utils.deepClone(petCache?.items?.get(item._id) || {});
      }
    }
  }

  _getEffectsPanelSignature(effects = null) {
    const categories = effects ?? prepareActiveEffectCategories(this.actor.effects.contents);
    return JSON.stringify(categories.all.map((effect) => [
      effect.id,
      effect.type,
      effect.disabled,
      effect.ffxivStackCount,
      effect.img || effect.icon || "",
      effect.name,
    ]));
  }

  async _refreshEffectsPanel(effects = null, signature = null) {
    const root = this.element;
    if (!root) return;
    const current = root.querySelector(".actor-effects");
    if (!current) return;
    effects ??= prepareActiveEffectCategories(this.actor.effects.contents);
    signature ??= this._getEffectsPanelSignature(effects);
    const html = await foundry.applications.handlebars.renderTemplate("systems/ffxiv/templates/actor/parts/actor-effects.hbs", { effects });
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
    const replacement = wrapper.firstElementChild;
    if (!replacement) return;
    current.replaceWith(replacement);
    this._effectsPanelSignature = signature;
  }

  async _refreshEffectsPanelIfChanged() {
    const effects = prepareActiveEffectCategories(this.actor.effects.contents);
    const signature = this._getEffectsPanelSignature(effects);
    if (signature === this._effectsPanelSignature) return;
    await this._refreshEffectsPanel(effects, signature);
  }

  async _refreshCompanionsPanel() {
    const root = this.element;
    if (!root) return;
    const tab = root.querySelector('.tab[data-tab="companions"]');
    const current = tab?.querySelector(".actor-companions");
    if (!current) return;

    const context = await this._prepareContext({
      ffxivRenderTabs: ["companions"],
    });
    const html = await foundry.applications.handlebars.renderTemplate("systems/ffxiv/templates/actor/parts/actor-companions.hbs", context);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
    const replacement = wrapper.firstElementChild;
    if (!replacement) return;
    current.replaceWith(replacement);
    this._applyStoredCompanionTab();
  }

  async _refreshAbilitiesPanel() {
    if (this.actor?.type !== "character") return;
    const root = this.element;
    if (!root) return;
    const current = root.querySelector(".actor-abilities");
    if (!current) return;

    const context = await this._prepareContext({
      ffxivRenderTabs: ["abilities"],
    });
    const html = await foundry.applications.handlebars.renderTemplate("systems/ffxiv/templates/actor/parts/actor-abilities.hbs", context);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
    const replacement = wrapper.firstElementChild;
    if (!replacement) return;
    current.replaceWith(replacement);
    this._applyActorEditMode();
    this._applyStoredAbilityTab();
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    this.element.classList.add(`${CONFIG.theme}_theme`);
    this._setCharacterSheetId();
    this._activateProseMirrorEditors();
    this._activatePrimaryTabs();
    await this._relocateInventoryItems();
    this._activateInventoryDragDrop();
    this._activateJobDropZone();
    this.activateListeners($(this.element));
    this._applyActorEditMode();
    this._updateHeaderBanner(this.actor.system?.banner || "");

    if (this.actor.type == "character") {
      this._updateManaBar();
      this._applyStoredAbilityTab();
      this._applyStoredCompanionTab();
    }

    if (this.actor.type === "character" || this.actor.type === "npc") {
      this._updateHealthBar();
    }

    this._restoreSheetScroll();

  }

  /** @override */
  _onChangeForm(formConfig, event) {
    if (!formConfig.submitOnChange) return super._onChangeForm(formConfig, event);
    if (!this.isEditable) return;
    if (!event.target?.name) return;
    if (EDIT_MODE_ACTOR_TYPES.has(this.actor.type) && !this._isActorEditMode() && !this._isActorLockAllowedField(event.target.name)) {
      this._notifyActorSheetLocked();
      return;
    }

    event.preventDefault();
    const updateValue = this._getChangedFieldValue(event.target);
    const updateData = { [event.target.name]: updateValue };
    if (event.target.name === "system.health.max") {
      const nextMax = Number(updateValue);
      const currentValue = Number(this.actor.system?.health?.value ?? 0);
      if (Number.isFinite(nextMax) && Number.isFinite(currentValue) && currentValue > nextMax) {
        updateData["system.health.value"] = Math.max(0, nextMax);
      }
    }
    if (this.actor.type === "npc" && event.target.name === "system.size") {
      const SIZE_DIMENSIONS = {
        Small: [1, 1],
        Medium: [1, 1],
        Large: [2, 2],
        Huge: [3, 3],
        Colossal: [4, 4]
      };
      const [width, height] = SIZE_DIMENSIONS[String(updateValue)] || [1, 1];
      updateData["prototypeToken.width"] = width;
      updateData["prototypeToken.height"] = height;
    }
    this.document.update(updateData, { render: false }).then(() => {
      this._syncResourceInputValue(event.target);
      if (event.target.name === "system.health.max") {
        const healthInput = this.element.querySelector('input[name="system.health.value"]');
        if (healthInput) healthInput.value = Number(this.actor.system?.health?.value ?? 0);
      }
      if (event.target.name === "system.size" && this.actor.type === "npc") {
        const widthInput = this.element.querySelector('input[name="prototypeToken.width"]');
        const heightInput = this.element.querySelector('input[name="prototypeToken.height"]');
        if (widthInput) widthInput.value = Number(this.actor.prototypeToken?.width ?? 1);
        if (heightInput) heightInput.value = Number(this.actor.prototypeToken?.height ?? 1);
      }
      this._updateSecondaryAttributeModifierFields();
      if (this.actor.type === "character") this._updateManaBar();
      if (this.actor.type === "character" || this.actor.type === "npc") this._updateHealthBar();
      if (event.target.name === "system.banner") this._updateHeaderBanner(event.target.value);
    }).catch(err => ui.notifications.error(err, { console: true }));
  }

  _getChangedFieldValue(target) {
    if (target.type === "checkbox") return target.checked;
    if (target.multiple) return Array.from(target.selectedOptions).map(option => option.value);

    const dtype = target.dataset?.dtype;
    if (target.type === "number" || dtype === "Number" || NUMERIC_ACTOR_FIELD.test(target.name)) {
      const delta = this._getSignedDeltaValue(target);
      if (delta !== null) return delta;
      const value = Number(target.value);
      if (!Number.isFinite(value)) return 0;
      return this._normalizeNumericActorField(target.name, value);
    }
    if (dtype === "Boolean") return target.value === "true";

    return target.value;
  }

  _normalizeNumericActorField(name, value) {
    if (!Number.isFinite(value)) return 0;

    if (name === "system.health.value") {
      const max = Number(this.actor.system?.health?.max);
      if (Number.isFinite(max) && max >= 0) return Math.max(0, Math.min(value, max));
      return Math.max(0, value);
    }

    if (name === "system.health.max") return Math.max(0, value);
    if (name === "system.barrier.value" || name === "system.barrier.max") return Math.max(0, value);
    return value;
  }

  _syncResourceInputValue(target) {
    if (!["system.health.value", "system.barrier.value"].includes(target.name)) return;
    const value = foundry.utils.getProperty(this.actor.system, target.name.replace(/^system\./, ""));
    const number = Number(value);
    target.value = Number.isFinite(number) ? number : 0;
  }

  _getSignedDeltaValue(target) {
    if (!["system.health.value", "system.barrier.value"].includes(target.name)) return null;
    const raw = String(target.value ?? "").trim();
    if (!/^[+-]\d+$/.test(raw)) return null;

    const current = Number(foundry.utils.getProperty(this.actor.system, target.name.replace(/^system\./, ""))) || 0;
    const next = current + Number(raw);
    if (target.name === "system.health.value") {
      const max = Number(this.actor.system.health?.max);
      return Math.max(0, Number.isFinite(max) && max >= 0 ? Math.min(next, max) : next);
    }
    return Math.max(0, next);
  }

  _updateSecondaryAttributeModifierFields() {
    const fields = this.element.querySelectorAll(".secondary-attribute-modifier[data-modifier-for]");
    if (!fields.length) return;

    let rollData = {};
    try {
      rollData = this.actor.getRollData() || {};
    } catch (error) {
      debugError("FFXIV | Failed to read roll data for secondary attribute modifiers:", error);
    }
    const modifiers = {
      defense: this._secondaryAttributeModifier(rollData.def, this.actor.system?.secondary_attributes?.defense?.value),
      magic_defense: this._secondaryAttributeModifier(rollData.mdef, this.actor.system?.secondary_attributes?.magic_defense?.value),
      vigilance: this._secondaryAttributeModifier(rollData.vigilance, this.actor.system?.secondary_attributes?.vigilance?.value),
    };

    fields.forEach(field => {
      const value = modifiers[field.dataset.modifierFor] ?? 0;
      field.value = value >= 0 ? `+${value}` : String(value);
    });
  }

  _secondaryAttributeModifier(total, base) {
    const totalNumber = Number(total);
    const baseNumber = Number(base);
    return (Number.isFinite(totalNumber) ? totalNumber : 0) - (Number.isFinite(baseNumber) ? baseNumber : 0);
  }

  /** @override */
  async _onFirstRender(context, options) {
    if (typeof super._onFirstRender === "function") await super._onFirstRender(context, options);
    if (this.actor?.type === "npc") {
      const defaultHeight = Number(this.constructor.DEFAULT_OPTIONS?.position?.height ?? 735);
      const currentHeight = Number(this.position?.height);
      if (Number.isFinite(currentHeight) && Math.abs(currentHeight - defaultHeight) < 1) {
        this.setPosition({ height: 830 });
      }
    }
    this._playConfiguredSound("soundNotificationFFXIV_openSheet");
  }

  _playConfiguredSound(setting) {
    const src = this._settingOrDefault(setting, DEFAULT_SOUNDS);
    if (game.settings.get('ffxiv', 'soundNotificationFFXIV') && src) {
      foundry.audio.AudioHelper.play({
        src,
        volume: 1,
        autoplay: true,
        loop: false
      });
    }
  }

  _settingOrDefault(setting, defaults) {
    return game.settings.get("ffxiv", setting) || defaults[setting] || "";
  }

  /** @override */
  async _onClose(options) {
    this._exitActorEditMode();
    this._playConfiguredSound("soundNotificationFFXIV_closeSheet");
    this._closeInventoryContextMenu();
    this._closeInventoryItemTooltip();

    await super._onClose(options);
  }

  _getSheetClasses() {
    return ['ffxiv', 'sheet', 'actor', `${CONFIG.theme}_theme`];
  }

  _isActorEditMode() {
    return !EDIT_MODE_ACTOR_TYPES.has(this.actor?.type) || (this.document.isOwner && this.actorEditMode);
  }

  _isSheetEditLocked() {
    return EDIT_MODE_ACTOR_TYPES.has(this.actor?.type) && !this._isActorEditMode();
  }

  _exitActorEditMode() {
    if (!EDIT_MODE_ACTOR_TYPES.has(this.actor?.type) || !this.actorEditMode)
      return;
    this.actorEditMode = false;
    this._applyActorEditMode();
  }

  _isActorLockAllowedField(name) {
    if (this.actor?.type === "character") return CHARACTER_LOCK_ALLOWED_FIELDS.has(name);
    if (this.actor?.type === "npc") return NPC_LOCK_ALLOWED_FIELDS.has(name);
    return false;
  }

  _isActorLockAllowedControl(control) {
    if (!control) return false;
    if (control.name && this._isActorLockAllowedField(control.name)) return true;
    return control.matches?.(
      ".ability-limitations input.limitation, .ability-limitations input.job_resource, .ability-limitations input.active"
    ) ?? false;
  }

  _toggleActorEditMode(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!EDIT_MODE_ACTOR_TYPES.has(this.actor.type) || !this.document.isOwner) return;
    if (!this._pendingSheetScrollPositions?.length) this._captureSheetScroll();
    this.actorEditMode = !this.actorEditMode;
    this.render({ force: true, ffxivSkipEnrichment: true });
    this._restoreSheetScroll();
  }

  _renderWithoutEnrichment(options = {}) {
    return this.render({ force: true, ffxivSkipEnrichment: true, ...options });
  }

  _warnActorSheetLocked(event) {
    if (!EDIT_MODE_ACTOR_TYPES.has(this.actor.type) || this._isActorEditMode()) return;

    let target = event.target;
    if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;

    if (target?.closest?.(
      '.inventory-item, .inventory-list, .inventory-slot, .inventory-header, .item-icon, .item-shadow, .item-tooltip, .item-quantity'
    )) return;
    if (target?.closest?.(".actor-avatar")) return;

    const allowedControl = target.closest?.("input, select, textarea, prose-mirror");
    if (this._isActorLockAllowedControl(allowedControl)) return;

    const lockedControl = target.closest?.(
      "input, select, textarea, prose-mirror, [data-edit], .profile-field-value, .profile-paragraph-block, .file-picker, .item-create, .npc-add-ability, .job-delete, .ability-delete, .item-delete, .title-delete, .move-up, .move-down, .pet-move-up, .pet-move-down, .pet-remove"
    );
    if (!lockedControl || lockedControl.closest(".actor-edit-toggle")) return;

    event.preventDefault();
    event.stopPropagation();
    this._notifyActorSheetLocked();
  }

  _notifyActorSheetLocked() {
    const now = Date.now();
    if ((now - (this._lastActorSheetLockedWarning ?? 0)) < 1000) return;
    this._lastActorSheetLockedWarning = now;
    this._playConfiguredSound("soundNotificationFFXIV_closeSheet");
    ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.CharacterSheetLocked"));
  }

  _applyActorEditMode() {
    if (!EDIT_MODE_ACTOR_TYPES.has(this.actor.type)) return;

    const editing = this._isActorEditMode();
    const rootSelector = `.ffxiv.actor.${this.actor.type}`;
    const root = this.element.matches(rootSelector)
      ? this.element
      : this.element.querySelector(rootSelector);
    if (!root) return;

    root.classList.toggle("actor-editing", editing);
    root.classList.toggle("actor-locked", !editing);
    root.dataset.actorEditMode = editing ? "editing" : "locked";

    const toggle = root.querySelector(".actor-edit-toggle");
    if (toggle) {
      toggle.classList.toggle("active", editing);
      toggle.setAttribute("aria-pressed", String(editing));
      toggle.title = game.i18n.localize(editing ? "FFXIV.CharacterSheet.LockSheet" : "FFXIV.CharacterSheet.EditSheet");
      toggle.setAttribute("aria-label", toggle.title);
      const icon = toggle.querySelector("i");
      icon?.classList.toggle("fa-lock", !editing);
      icon?.classList.toggle("fa-lock-open", editing);
    }
  }

  _setCharacterSheetId() {
    let characterSheet;
    if (this.token && !this.token.actorLink) {
      characterSheet = `FFXIVActorSheet-Scene-${this.token.parent.id}-Token-${this.token.id}-Actor-${this.actor.id}`;
    }
    if (!characterSheet) {
      characterSheet = `FFXIVActorSheet-Actor-${this.actor._id}`;
    }
    this.characterSheet = characterSheet;

    const form = this.element.matches("form") ? this.element : this.element.querySelector("form");
    if (form) form.id = characterSheet;
  }

  _activatePrimaryTabs() {
    const nav = this.element.querySelector(".sheet-tabs");
    if (!nav) return;

    const tabs = Array.from(this.element.querySelectorAll(".sheet-body .tab[data-tab]"));
    const links = Array.from(nav.querySelectorAll("[data-tab]"));
    let initial = this.tabGroups?.primary || links.find(link => link.classList.contains("active"))?.dataset.tab
      || links[0]?.dataset.tab || tabs[0]?.dataset.tab;
    if (!tabs.some(panel => panel.dataset.tab === initial)) initial = links[0]?.dataset.tab || tabs[0]?.dataset.tab;

    const activate = async (tab, { playSound = false } = {}) => {
      const changed = this.tabGroups.primary !== tab;
      this.tabGroups.primary = tab;
      const panel = tabs.find(panel => panel.dataset.tab === tab);
      if (panel && !panel.childElementCount) await this._renderLazyActorTab(tab, panel);
      if (this.tabGroups.primary !== tab) return;
      links.forEach(link => link.classList.toggle("active", link.dataset.tab === tab));
      tabs.forEach(panel => {
        const active = panel.dataset.tab === tab;
        panel.classList.toggle("active", active);
        panel.style.display = active ? "" : "none";
      });
      if (playSound && changed) this._playConfiguredSound("soundNotificationFFXIV_openSheet");
    };

    this._tabController?.abort();
    this._tabController = new AbortController();
    links.forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        activate(link.dataset.tab, { playSound: true });
      }, { capture: true, signal: this._tabController.signal });
    });

    activate(initial);
  }

  async _renderLazyActorTab(tab, panel) {
    const template = CHARACTER_TAB_PARTIALS[tab];
    if (!template) return;

    this._lazyTabRender ??= new Map();
    if (this._lazyTabRender.has(tab)) {
      await this._lazyTabRender.get(tab);
      return;
    }

    const render = (async () => {
      const context = await this._prepareContext({
        ffxivRenderTabs: [tab],
      });
      panel.innerHTML = await foundry.applications.handlebars.renderTemplate(template, context);
      this._activateProseMirrorEditors();
      this.activateListeners($(this.element));
      this._applyActorEditMode();
      if (tab === "abilities") this._applyStoredAbilityTab();
      if (tab === "companions") this._applyStoredCompanionTab();
      if (tab === "attributes") this._updateSecondaryAttributeModifierFields();
      if (this.actor.type === "character") this._updateManaBar();
      if (this.actor.type === "character" || this.actor.type === "npc") this._updateHealthBar();
    })().finally(() => this._lazyTabRender.delete(tab));

    this._lazyTabRender.set(tab, render);
    await render;
  }

  async _relocateInventoryItems() {
    const isOwner = this.actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
    if (!isOwner || isDraggingItem) return;

    const occupiedPositions = new Set();
    const itemsToUpdate = [];

    this.actor.items.contents.forEach(item => {
      if (CONFIG.FFXIV.inventory_items.indexOf(item.type) > -1) {
        const position = Number(item.system.position) || 0;
        if (occupiedPositions.has(position) || position === 0) {
          itemsToUpdate.push(item);
        } else {
          occupiedPositions.add(position);
        }
      }
    });

    let nextFreePosition = 1;
    const updates = [];
    itemsToUpdate.forEach(item => {
      if (CONFIG.FFXIV.inventory_items.indexOf(item.type) > -1) {
        while (occupiedPositions.has(nextFreePosition)) {
          nextFreePosition++;
        }

        updates.push(item.update({ 'system.position': nextFreePosition }));
        occupiedPositions.add(nextFreePosition);
      }
    });

    await Promise.all(updates);
  }

  _activateInventoryDragDrop() {
    this._inventoryDragController?.abort();

    const actor = this.actor;
    const isOwner = actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
    if (!isOwner) return;

    this._inventoryDragController = new AbortController();
    const { signal } = this._inventoryDragController;

    this.element.querySelectorAll(".inventory-item").forEach(element => {
      element.addEventListener("dragstart", event => {
        debugLog('Drag started:', event.currentTarget.dataset.itemId);
        draggedItem = {
          id: event.currentTarget.dataset.itemId,
          position: event.currentTarget.dataset.itemPosition
        };
        isDraggingItem = true;

        const dragGhost = event.currentTarget.cloneNode(true);
        dragGhost.querySelector('.item-tooltip')?.style.setProperty('display', 'none');
        dragGhost.querySelector('.item-quantity')?.style.setProperty('display', 'none');

        dragGhost.style.position = 'absolute';
        dragGhost.style.top = '-1000px';
        document.body.appendChild(dragGhost);

        event.dataTransfer.setDragImage(dragGhost, 0, 0);

        setTimeout(() => {
          document.body.removeChild(dragGhost);
        }, 0);

        const item = actor.items.get(event.currentTarget.dataset.itemId);
        event.dataTransfer.setData("text/plain", JSON.stringify({
          type: "Item",
          uuid: item.uuid
        }));
      }, { signal });

      element.addEventListener("dragover", event => {
        event.preventDefault();
        debugLog('Drag over:', event.currentTarget.dataset.itemId || 'empty slot');
      }, { signal });

      element.addEventListener("drop", async event => {
        event.preventDefault();
        event.stopPropagation();
        debugLog(event);

        const dropTarget = event.currentTarget;
        if (!dropTarget) {
          isDraggingItem = false;
          return this._renderWithoutEnrichment();
        }

        const targetPosition = dropTarget.dataset.itemPosition;
        debugLog('Dropped on:', targetPosition || 'empty slot');
        const targetItemId = dropTarget.dataset.itemId;

        const dragData = await foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        const sourceItem = dragData?.uuid ? await fromUuid(dragData.uuid) : null;

        if (!sourceItem || sourceItem.documentName !== "Item") {
          isDraggingItem = false;
          return this._renderWithoutEnrichment();
        }

        const sourceActor = sourceItem.parent;
        const targetActor = actor;
        const sourceIsActorItem = sourceActor?.documentName === "Actor";
        const targetPositionNumber = Number(targetPosition) || 0;

        if (sourceActor?.id === targetActor.id) {
          const draggedItemData = targetActor.items.get(sourceItem.id) || targetActor.items.get(draggedItem?.id);
          if (!draggedItemData) {
            isDraggingItem = false;
            return this._renderWithoutEnrichment();
          }

          if (targetItemId) {
            const targetItemData = targetActor.items.get(targetItemId);
            await draggedItemData.update({ 'system.position': targetPosition });
            await targetItemData.update({ 'system.position': draggedItem.position });
          } else {
            await draggedItemData.update({ 'system.position': targetPosition });
          }

          this._playConfiguredSound("soundNotificationFFXIV_moveItem");

          isDraggingItem = false;
          return this._renderWithoutEnrichment();
        }

        const sourceData = sourceItem.toObject();
        delete sourceData._id;
        sourceData.system = sourceData.system || {};
        sourceData.system.position = targetPositionNumber;

        try {
          if (!sourceIsActorItem) {
            if (targetItemId) {
              const occupied = targetActor.items.get(targetItemId);
              if (occupied) {
                const fallbackPosition = this._findNextFreeInventoryPosition(targetActor, { reserved: [targetPositionNumber] });
                if (!fallbackPosition) {
                  ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.InventoryFull"));
                  isDraggingItem = false;
                  return this._renderWithoutEnrichment();
                }
                await occupied.update({ "system.position": fallbackPosition }, { render: false });
              }
            }

            const [copiedItem] = await targetActor.createEmbeddedDocuments("Item", [sourceData], { render: false });
            if (!copiedItem) throw new Error("Failed to copy item on target actor");

            this._playConfiguredSound("soundNotificationFFXIV_moveItem");

            isDraggingItem = false;
            targetActor?.sheet?.render?.({ force: true, ffxivSkipEnrichment: true }).catch(() => { });
            return;
          }

          const [movedItem] = await targetActor.createEmbeddedDocuments("Item", [sourceData], { render: false });
          if (!movedItem) throw new Error("Failed to create item on target actor");

          if (targetItemId) {
            const occupied = targetActor.items.get(targetItemId);
            if (occupied) {
              const occupiedData = occupied.toObject();
              delete occupiedData._id;
              occupiedData.system = occupiedData.system || {};
              const sourcePosition = draggedItem?.position ?? 0;
              occupiedData.system.position = sourcePosition;
              const [swappedItem] = await sourceActor.createEmbeddedDocuments("Item", [occupiedData], { render: false });
              if (!swappedItem) {
                await targetActor.deleteEmbeddedDocuments("Item", [movedItem.id]);
                throw new Error("Failed to move occupied target item back to source actor; rollback applied");
              }

              await sourceItem.delete();
              await occupied.delete();
            } else {
              await sourceItem.delete();
            }
          } else {
            await sourceItem.delete();
          }

          this._playConfiguredSound("soundNotificationFFXIV_moveItem");

          isDraggingItem = false;
          targetActor?.sheet?.render?.({ force: true, ffxivSkipEnrichment: true }).catch(() => { });
          sourceActor?.sheet?.render?.({ force: true, ffxivSkipEnrichment: true }).catch(() => { });
        } catch (err) {
          console.error(err);
          ui.notifications.error(err.message || "Item move failed");
          isDraggingItem = false;
          this._renderWithoutEnrichment();
        }
      }, { signal });
    });
  }

  _findNextFreeInventoryPosition(actor, { reserved = [] } = {}) {
    const occupied = new Set(reserved.map(value => Number(value) || 0));
    for (const item of actor.items) {
      if (!CONFIG.FFXIV.inventory_items.includes(item.type)) continue;
      const position = Number(item.system.position) || 0;
      if (position > 0) occupied.add(position);
    }

    const gridSize = 27;
    for (let i = 1; i <= gridSize; i++) {
      if (!occupied.has(i)) return i;
    }
    return null;
  }

  static async enrichStringFields(target, fields, rollData, relativeTo) {
    const enriched = {};

    for (const key of fields) {
      const value = foundry.utils.getProperty(target, key);
      if (typeof value === "string" && value.trim()) {
        const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
          value,
          {
            secrets: true,
            async: true,
            rollData,
            relativeTo,
          }
        );

        foundry.utils.setProperty(enriched, key, html?.trim() ? html : value);
      }
    }
    return enriched;
  }

  /**
   * Shared context modifications for all actor sheet types.
   *
   * @param {object} context The context object to mutate
   */
  _prepareSharedData(context) {
    context.rollData = this.actor.getRollData();
    context.dtypes = ["String", "Number", "Boolean"];
    context.owner = this.document.isOwner;
    context.isGM = game.user?.isGM ?? false;
  }

  /**
   * Character-specific context modifications
   *
   * @param {object} context The context object to mutate
   */
  _prepareCharacterData(context) {
    context.rollData = this.actor.getRollData()
    context.job = context.items.find(item => item.type === "job");

    let pets = this.actor.system.pets || [];
    const validIds = pets.filter(id => game.actors.get(id));
    if (validIds.length !== pets.length && !this._cleaningInvalidPets) {
      this._cleaningInvalidPets = true;
      this.actor.update({ "system.pets": validIds })
        .finally(() => this._cleaningInvalidPets = false);
    }
  }

  _getCurrentAbilityTab() {
    return ["primary", "secondary", "instant", "traits"].includes(this.currentAbilityTab)
      ? this.currentAbilityTab
      : "primary";
  }

  _getRenderedAbilityTypes() {
    const tab = this._getCurrentAbilityTab();
    if (tab === "primary") return new Set(["primary_ability"]);
    if (tab === "secondary") return new Set(["secondary_ability"]);
    if (tab === "instant") return new Set(["instant_ability"]);
    return new Set(["trait", "limit_break"]);
  }

  _sortItemsByAbilityOrder(items, order, type) {
    if (!order?.[type] || !Array.isArray(order[type])) return items;
    const positions = new Map(order[type].map((id, index) => [id, index]));
    return items.slice().sort((a, b) => {
      const indexA = positions.get(a._id) ?? 9999;
      const indexB = positions.get(b._id) ?? 9999;
      return indexA - indexB;
    });
  }

  /**
   * Organize and classify Items for Actor sheets.
   *
   * @param {object} context The context object to mutate
   */
  _prepareItems(context) {
    const consumables = [];
    const primary_abilities = [];
    const secondary_abilities = [];
    const instant_abilities = [];
    const limit_break = [];
    const traits = [];

    for (let i of context.items) {
      i.img = i.img || Item.DEFAULT_ICON;
      const abilitySubtype = getAbilitySubtype(i);

      if (i.type === "consumable") {
        consumables.push(i);
      }
      if (abilitySubtype === "primary_ability") {
        primary_abilities.push(i);
      }
      if (abilitySubtype === "secondary_ability") {
        secondary_abilities.push(i);
      }
      if (abilitySubtype === "instant_ability") {
        instant_abilities.push(i);
      }
      if (abilitySubtype === "limit_break") {
        limit_break.push(i);
      }
      if (i.type === "trait") {
        traits.push(i);
      }
    }

    context.consumables = consumables;
    context.primary_abilities = this._sortItemsByAbilityOrder(
      primary_abilities,
      context.system.ability_order,
      "primary_ability",
    );
    context.secondary_abilities = this._sortItemsByAbilityOrder(
      secondary_abilities,
      context.system.ability_order,
      "secondary_ability",
    );
    context.instant_abilities = this._sortItemsByAbilityOrder(
      instant_abilities,
      context.system.ability_order,
      "instant_ability",
    );
    context.limit_break = limit_break;
    context.traits = this._sortItemsByAbilityOrder(
      traits,
      context.system.ability_order,
      "trait",
    );
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    debugLog("Listeners activated for:", this.actor.name);
    html.off(".ffxivActorSheet");

    html.find("input, textarea").off("keydown.ffxivActorSheet").on("keydown.ffxivActorSheet", (event) => {
      if (event.key === "Enter") {
        const target = event.currentTarget;
        if (target instanceof HTMLInputElement && ENTER_COMMIT_FIELDS.has(target.name)) {
          event.preventDefault();
          event.stopPropagation();
          target.blur();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      }
    });

    // Render the item sheet for viewing/editing prior to the editable check.
    html.on('click.ffxivActorSheet', '.item-edit', (ev) => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data('itemId'));
      item.sheet.render({ force: true });
    });

    html.on('pointerdown.ffxivActorSheet', this._warnActorSheetLocked.bind(this));
    html.on('focusin.ffxivActorSheet', this._warnActorSheetLocked.bind(this));
    html.on('click.ffxivActorSheet', '.abilities-sub-tabs .sub-tab', this._displayAbilityTab.bind(this));
    html.on('click.ffxivActorSheet', '.companions-sub-tabs .companions-sub-tab', this._displayCompanionTab.bind(this));
    html.on('click.ffxivActorSheet', '.actor-edit-toggle', this._toggleActorEditMode.bind(this));
    html.on('click.ffxivActorSheet', '.actor-avatar', this._onActorAvatarClick.bind(this));

    if (!this.document.isOwner) return;

    // Add Inventory Item
    html.on('click.ffxivActorSheet', '.item-create', this._onItemCreate.bind(this));
    html.on('click.ffxivActorSheet', '.npc-add-ability', this._onNpcAbilityCreate.bind(this));
    html.on('click.ffxivActorSheet', '.job-delete', this._onDeleteJob.bind(this));
    html.on('click.ffxivActorSheet', '.ability-delete', this._onDeleteAbility.bind(this));
    html.on('click.ffxivActorSheet', '.file-picker', this._onFilePicker.bind(this));

    // Delete Inventory Item
    html.on('click.ffxivActorSheet', '.item-delete', (ev) => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data('itemId'));
      item.delete();
      li.slideUp(200, () => this.render());
    });

    // Active Effect management
    html.on('click.ffxivActorSheet', '.effect-control', async (ev) => {
      const action = String(ev.currentTarget?.dataset?.action ?? "");
      const row = ev.currentTarget.closest('li');
      const parentId = String(row?.dataset?.parentId ?? "");
      const document = !parentId
        ? this.actor
        : parentId === this.actor.id
          ? this.actor
          : this.actor.items.get(parentId);
      if (!document) return;
      await onManageActiveEffect(ev, document, { render: false });
      if (["create", "delete", "toggle", "stack-increase", "stack-decrease"].includes(action)) {
        await this._refreshEffectsPanel();
      }
    });

    // Rollable abilities.
    html.on('click.ffxivActorSheet', '.rollable', this._onRoll.bind(this));

    // Drag events for macros.
    if (this.actor.isOwner) {
      const handler = (ev) => this._onDragStart(ev);
      html.find('li.item').each((i, li) => {
        if (li.classList.contains('inventory-header')) return;
        if (li.dataset.ffxivMacroDragBound === "true") return;
        li.dataset.ffxivMacroDragBound = "true";
        li.setAttribute('draggable', true);
        li.addEventListener('dragstart', handler, false);
      });

      this.element.querySelectorAll('.ability-card[data-item-id]').forEach(card => {
        if (card.dataset.ffxivMacroDragBound === "true") return;
        card.dataset.ffxivMacroDragBound = "true";
        card.setAttribute('draggable', true);
        card.addEventListener('dragstart', this._onAbilityDragStart.bind(this), false);
      });

      this.element.querySelectorAll('.ability-card .ability-icon[data-item-id]').forEach(icon => {
        if (icon.dataset.ffxivMacroDragBound === "true") return;
        icon.dataset.ffxivMacroDragBound = "true";
        icon.setAttribute('draggable', true);
        icon.addEventListener('dragstart', this._onAbilityDragStart.bind(this), false);
      });
    }

    if (this.actor.type == "pet") { //Pet ability's tags
      html.on('change.ffxivActorSheet', '.select-tags', (event) => {
        const index = $(event.currentTarget).closest('li').index();
        const value = $(event.currentTarget).val();
        const tags = this.actor.system.tags || [];
        tags[index] = value;
        this.actor.update({ "system.tags": tags });
      });
      html.on('click.ffxivActorSheet', '.remove-tag', (event) => {
        const index = event.currentTarget.dataset.index;
        const tags = this.actor.system.tags || [];
        tags.splice(index, 1);
        this.actor.update({ "system.tags": tags });
        this.render();
      });
      html.on('click.ffxivActorSheet', '.add-tag', () => {
        const tags = this.item.system.tags || [];

        const configMap = {
          primary_ability: "tags_abilities",
          secondary_ability: "tags_abilities",
          instant_ability: "tags_abilities",
          trait: "tags_traits",
          consumable: "tags_consumables"
        };

        const configKey = configMap[this.item.type];
        const tagPool = CONFIG.FFXIV[configKey] || {};
        const defaultTag = Object.values(tagPool)[0]?.label || "";

        if (defaultTag) {
          tags.push(defaultTag);
          this.item.update({ "system.tags": tags });
          this.render();
        }
      });
    }

    html.find(".ability-description p:not(:last-of-type)").each(function () {
      $(this).after("<br>");
    });


    html.on('click.ffxivActorSheet', '.inventory-item', this._renderItem.bind(this));
    html.on('contextmenu.ffxivActorSheet', '.inventory-item[data-item-id]', this._onInventoryItemContextMenu.bind(this));
    html.on('mouseenter.ffxivActorSheet', '.inventory-item[data-item-id]', this._showInventoryItemTooltip.bind(this));
    html.on('mouseleave.ffxivActorSheet', '.inventory-item[data-item-id]', this._closeInventoryItemTooltip.bind(this));


    html.on('mousedown.ffxivActorSheet', '.mana-bar', this._onClickManaBar.bind(this));

    html.on('click.ffxivActorSheet', '.ability-icon', this._renderItem.bind(this));
    html.on('click.ffxivActorSheet', '.augment-icon', this._renderItem.bind(this));
    html.on('click.ffxivActorSheet', '.ability-roll-button', this._rollItem.bind(this));
    html.on('click.ffxivActorSheet', '.pet-ability-roll-button', this._rollPet.bind(this));

    html.on('click.ffxivActorSheet', '.roll-attribute', this._rollAttribute.bind(this));

    html.on('change.ffxivActorSheet', '.ability-limitations .limitation', this._onChangeLimitations.bind(this))

    html.on('change.ffxivActorSheet', '.ability-limitations .job_resource', this._onChangeJobResource.bind(this))

    html.on('change.ffxivActorSheet', '.ability-limitations .active', this._onChangeActiveTrait.bind(this))

    html.on('click.ffxivActorSheet', '.actor-titles .title-delete', this._onDeleteTitle.bind(this))

    html.on('click.ffxivActorSheet', '.move-up', this._moveAbility.bind(this, -1));
    html.on('click.ffxivActorSheet', '.move-down', this._moveAbility.bind(this, 1))
    html.on('click.ffxivActorSheet', '.pet-move-up', this._movePet.bind(this, -1));
    html.on('click.ffxivActorSheet', '.pet-move-down', this._movePet.bind(this, 1))
    html.on('click.ffxivActorSheet', '.pet-remove', this._removePet.bind(this))

    html.on('click.ffxivActorSheet', '.pet-name', this._openPet.bind(this))


  }

  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
   * @param {Event} event   The originating click event
   * @private
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    return this._createEmbeddedItem(foundry.utils.duplicate(header.dataset));
  }

  async _createEmbeddedItem(data) {
    const type = data.type;
    if (!type) return;
    const preserveScroll = data.preserveScroll === true || data.preserveScroll === "true";
    if (!preserveScroll || !this._pendingSheetScrollPositions?.length) this._captureSheetScroll();
    const name = data.name || `New ${type.capitalize()}`;
    const itemData = {
      name: name,
      type: type,
      system: data,
    };

    delete itemData.system['type'];
    delete itemData.system['name'];
    delete itemData.system['openSheet'];
    delete itemData.system['preserveScroll'];

    const [item] = await this.actor.createEmbeddedDocuments("Item", [itemData], { render: false });
    await this.render({ force: true });
    if (data.openSheet === "true" || data.openSheet === true) {
      await item?.sheet?.render({ force: true });
      await new Promise((r) => setTimeout(r, 20));
    }
    this._restoreSheetScroll();
    return item;
  }

  _onNpcAbilityCreate(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!this._isActorEditMode()) {
      this._notifyActorSheetLocked();
      return;
    }

    this._captureSheetScroll();

    if (this.tabGroups?.primary === "traits") {
      const label = game.i18n.localize("FFXIV.ItemType.trait");
      return this._createEmbeddedItem({
        type: "trait",
        name: `New ${label}`,
        openSheet: true,
        preserveScroll: true
      });
    }

    const abilityTypes = ["primary_ability", "secondary_ability", "instant_ability"];
    const createAbility = async (type) => {
      const label = game.i18n.localize(`FFXIV.ItemType.${type}`);
      await this._createEmbeddedItem({
        type: "ability",
        name: `New ${label}`,
        tags: [getSubtypeTagLabel(type)],
        openSheet: true,
        preserveScroll: true
      });
    };

    new foundry.applications.api.DialogV2({
      id: `ffxiv-${this.actor.type}-add-ability-${this.actor.id}`,
      window: { title: "Add Ability" },
      content: "<p>Select the type of ability to add.</p>",
      buttons: abilityTypes.map(type => ({
        label: game.i18n.localize(`FFXIV.ItemType.${type}`).replace(/\s+Ability$/u, ""),
        action: type,
        type: "submit",
        callback: () => createAbility(type)
      })).concat([{
        label: game.i18n.localize("FFXIV.Dialogs.Cancel"),
        action: "cancel",
        type: "cancel",
        callback: () => {
          this._pendingSheetScrollPositions = null;
        }
      }])
    }).render(true);
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  _onRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;

    // Handle item rolls.
    if (dataset.rollType) {
      if (dataset.rollType == 'item') {
        const itemId = element.closest('.item').dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (item) return item.roll();
      }
    }

    // Handle rolls that supply the formula directly.
    if (dataset.roll) {
      let label = dataset.label ? `[ability] ${dataset.label}` : '';
      let roll = new Roll(dataset.roll, this.actor.getRollData());
      roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: label,
        rollMode: game.settings.get('core', 'rollMode'),
      });
      return roll;
    }
  }

  async _rollItem(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = event.currentTarget.dataset.itemId
    const item = this.actor.items.get(itemId);
    if (item) {
      await item.roll(event);
    } else {
      debugError("Roll Error : No item found.");
      debugError(event.currentTarget);
    }

  }

  async _rollPet(event) {
    event.preventDefault();
    event.stopPropagation();
    const petId = event.currentTarget.dataset.petId
    const itemId = event.currentTarget.dataset.itemId
    const pet = game.actors.get(petId);
    const item = pet.items.get(itemId);
    if (pet && item) {
      item.roll(event);
    } else {
      debugError("Roll Error : No pet found.");
      debugError(event.currentTarget);
    }
  }

  async _rollAttribute(event) {
    const attribute = event.currentTarget.dataset.attribute
    if (!attribute) {
      ui.notifications.error("No attribute specified to roll for.");
      return;
    }
    this.actor._rollAttribute(attribute);
  }

  async _renderItem(event) {
    this._closeInventoryItemTooltip();
    const itemId = event.currentTarget.dataset.itemId
    const item = this.actor.items.get(itemId);

    if (item) {
      item.sheet.render({ force: true });
    } else {
      debugError(`Item with ID ${itemId} not found. Cannot open empty inventory cells.`);
    }
  };

  _onInventoryItemContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();

    const itemId = event.currentTarget?.dataset?.itemId;
    if (!itemId) return;
    const item = this.actor.items.get(itemId);
    if (!item) return;

    this._closeInventoryItemTooltip();
    this._closeInventoryContextMenu();

    const menu = document.createElement("div");
    menu.className = "ffxiv-inventory-context-menu";

    const openFull = document.createElement("button");
    openFull.type = "button";
    openFull.className = "ffxiv-inventory-context-option";
    openFull.textContent = game.i18n.localize("FFXIV.Item.EditItem");
    openFull.addEventListener("click", (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      this._closeInventoryContextMenu();
      new item.sheet.constructor({
        document: item,
        ffxivForceFullSheet: true
      }).render({ force: true });
    });

    const useItem = document.createElement("button");
    useItem.type = "button";
    useItem.className = "ffxiv-inventory-context-option";
    const isGear = item.type === "gear";
    useItem.textContent = isGear
      ? game.i18n.localize(
          item.system.equipped
            ? "FFXIV.CharacterSheet.Unequip"
            : "FFXIV.CharacterSheet.Equip",
        )
      : game.i18n.localize("FFXIV.Item.UseItem");
    useItem.addEventListener("click", async (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      this._closeInventoryContextMenu();
      if (isGear) {
        await this._toggleInventoryGear(item);
      } else {
        await item.roll();
      }
    });

    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "ffxiv-inventory-context-option discard";
    discard.textContent = game.i18n.localize("FFXIV.Item.DiscardItem");
    discard.addEventListener("click", (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      this._closeInventoryContextMenu();
      this._confirmDiscardInventoryItem(item);
    });

    menu.appendChild(useItem);
    menu.appendChild(openFull);
    menu.appendChild(discard);
    document.body.appendChild(menu);

    const margin = 8;
    const { clientX, clientY } = event;
    const width = menu.offsetWidth || 160;
    const height = menu.offsetHeight || 40;
    const left = Math.min(clientX, window.innerWidth - width - margin);
    const top = Math.min(clientY, window.innerHeight - height - margin);
    menu.style.left = `${Math.max(margin, left)}px`;
    menu.style.top = `${Math.max(margin, top)}px`;

    const closeMenu = () => this._closeInventoryContextMenu();
    const onKeyDown = (keyEvent) => {
      if (keyEvent.key === "Escape") closeMenu();
    };

    this._inventoryContextMenu = {
      element: menu,
      closeMenu,
      onKeyDown
    };

    setTimeout(() => {
      document.addEventListener("click", closeMenu, { once: true });
      document.addEventListener("contextmenu", closeMenu, { once: true });
      document.addEventListener("keydown", onKeyDown, { once: true });
    }, 0);
  }

  _closeInventoryContextMenu() {
    const menu = this._inventoryContextMenu;
    if (!menu) return;
    menu.element?.remove();
    this._inventoryContextMenu = null;
  }

  _showInventoryItemTooltip(event) {
    const source = event.currentTarget?.querySelector?.(".item-tooltip");
    if (!source?.textContent?.trim()) return;

    this._closeInventoryItemTooltip();
    const tooltip = source.cloneNode(true);
    tooltip.classList.add("inventory-floating-tooltip", `${CONFIG.theme}_theme`);
    document.body.appendChild(tooltip);

    const itemRect = event.currentTarget.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, itemRect.left + ((itemRect.width - tooltipRect.width) / 2)),
      window.innerWidth - tooltipRect.width - margin,
    );
    const top = Math.max(margin, itemRect.top - tooltipRect.height - 4);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    this._inventoryItemTooltip = tooltip;
  }

  _closeInventoryItemTooltip() {
    this._inventoryItemTooltip?.remove();
    this._inventoryItemTooltip = null;
  }

  async _toggleInventoryGear(item) {
    const equippedGear = {
      ...Object.fromEntries(
        Object.keys(CONFIG.FFXIV.gear_subcategories).map((key) => [key, ""]),
      ),
      ...foundry.utils.deepClone(this.actor.system.equippedGear || {}),
    };

    const defaultCategory =
      CONFIG.FFXIV.gear_subcategories.Arms?.label ??
      Object.values(CONFIG.FFXIV.gear_subcategories)[0]?.label ??
      "";
    const selectedCategory = item.system.category || defaultCategory;
    const categoryKey = Object.keys(CONFIG.FFXIV.gear_subcategories).find(
      (key) => CONFIG.FFXIV.gear_subcategories[key].label === selectedCategory,
    );

    if (!categoryKey) {
      debugError(`Category not found for ${selectedCategory}`);
      ui.notifications.warn("Choose a gear category before equipping this item.");
      return;
    }

    const itemUpdate = {};
    if (!item.system.category) itemUpdate["system.category"] = selectedCategory;

    if (item.system.equipped) {
      equippedGear[categoryKey] = "";
      itemUpdate["system.equipped"] = false;
    } else {
      const currentEquipped = equippedGear[categoryKey];
      if (currentEquipped) {
        const oldItem = this.actor.items.get(currentEquipped);
        if (oldItem) {
          await oldItem.update({ "system.equipped": false }, { render: false });
          ui.notifications.info(
            game.i18n.format("FFXIV.Notifications.ReplaceGear", {
              oldGear: oldItem.name,
              newGear: item.name,
            }),
          );
        }
      }
      equippedGear[categoryKey] = item.id;
      itemUpdate["system.equipped"] = true;
    }

    await item.update(itemUpdate, { render: false });
    await this.actor.update({ "system.equippedGear": equippedGear }, { render: false });
    this._playConfiguredSound("soundNotificationFFXIV_moveItem");
    await this.render({ force: true });
  }

  _confirmDiscardInventoryItem(item) {
    new foundry.applications.api.DialogV2({
      id: "ffxiv-discard-inventory-item",
      window: { title: game.i18n.localize("FFXIV.Dialogs.DialogTitleConfirmation") },
      form: {
        submitOnChange: false,
        closeOnSubmit: true
      },
      content: game.i18n.format("FFXIV.Dialogs.ItemDelete", { itemName: item.name }),
      buttons: [
        {
          label: game.i18n.localize("FFXIV.Dialogs.Yes"),
          action: "discard",
          type: "submit",
          callback: async () => {
            ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", { itemName: item.name }));
            await item.delete();
            this.render();
          }
        },
        {
          label: game.i18n.localize("FFXIV.Dialogs.No"),
          action: "cancel",
          type: "submit",
          callback: () => { }
        }
      ]
    }).render({ force: true });
  }

  _onDeleteAbility(event) {
    event.preventDefault();
    event.stopPropagation();

    if (this._isSheetEditLocked()) {
      this._notifyActorSheetLocked();
      return;
    }

    const button = event.currentTarget;
    const actor = button.dataset.petId ? game.actors.get(button.dataset.petId) : this.actor;
    const item = actor?.items?.get(button.dataset.itemId);
    if (!item) return;

    new foundry.applications.api.DialogV2({
      id: `ffxiv-confirm-ability-deletion-${item.id}`,
      window: { title: game.i18n.localize("FFXIV.Dialogs.DialogTitleConfirmation") },
      form: {
        submitOnChange: false,
        closeOnSubmit: true
      },
      content: game.i18n.format("FFXIV.Dialogs.ItemDelete", { itemName: item.name }),
      buttons: [
        {
          label: game.i18n.localize("FFXIV.Dialogs.Yes"),
          action: "delete",
          type: "submit",
          callback: async () => {
            this._captureSheetScroll();
            await item.delete();
            ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", { itemName: item.name }));
            if (game.settings.get('ffxiv', 'soundNotificationFFXIV') && game.settings.get('ffxiv', 'soundNotificationFFXIV_deleteItem')) {
              foundry.audio.AudioHelper.play({
                src: game.settings.get('ffxiv', 'soundNotificationFFXIV_deleteItem'),
                volume: 1,
                autoplay: true,
                loop: false
              });
            }
            await this.render({ force: true });
            this._restoreSheetScroll();
          }
        },
        {
          label: game.i18n.localize("FFXIV.Dialogs.No"),
          action: "keep",
          type: "submit"
        }
      ]
    }).render({ force: true });
  }

  _onAbilityDragStart(event) {
    const element = event.currentTarget;
    const itemId = element.dataset.itemId || element.closest(".ability-card")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;

    const dragData = JSON.stringify({
      type: "Item",
      uuid: item.uuid
    });
    event.dataTransfer.setData("text/plain", dragData);
    event.dataTransfer.setData("application/json", dragData);
    event.dataTransfer.effectAllowed = "copy";
  }

  _captureSheetScroll() {
    const root = this.element;
    if (!root) return;

    const selectors = [
      ".window-content",
      ".sheet-body",
      ".sheet-body .tab.active",
      ".sub-tab-content.active"
    ];

    this._pendingSheetScrollPositions = selectors.flatMap(selector => {
      const element = root.matches?.(selector) ? root : root.querySelector(selector);
      if (!element) return [];
      return [{
        selector,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft
      }];
    });
  }

  _restoreSheetScroll() {
    const positions = this._pendingSheetScrollPositions;
    if (!positions?.length) return;
    const restore = () => {
      for (const position of positions) {
        const root = this.element;
        const element = root?.matches?.(position.selector) ? root : root?.querySelector(position.selector);
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

  _activateProseMirrorEditors() {
    this.element.querySelectorAll(".editor-content[data-edit]").forEach(div => this._activateEditor?.(div));
  }

  _updateHeaderBanner(path) {
    const header = this.element.querySelector(".sheet-header");
    if (!header) return;

    const role = this.actor.system.class?.role || "dps";
    const image = path ? `, url("${path}")` : "";
    header.style.background = `linear-gradient(90deg, var(--${role}) 0%, rgba(255,255,255,0) 100%)${image}`;
    header.style.backgroundSize = "cover";
    header.style.backgroundPosition = "top 20% left 40%";
  }

  _onFilePicker(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const target = button.dataset.target;
    if (!target) return;

    const input = this.element.querySelector(`[name="${target}"]`);
    const current = input?.value || foundry.utils.getProperty(this.actor, target) || "";
    const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;

    new FilePickerImpl({
      type: button.dataset.type || "imagevideo",
      current,
      callback: async path => {
        if (input) input.value = path;
        await this.actor.update({ [target]: path }, { render: false });
        if (target === "system.banner") this._updateHeaderBanner(path);
      }
    }).render(true);
  }

  _onActorAvatarClick(event) {
    event.preventDefault();
    event.stopPropagation();

    if (this._isActorEditMode() && this.document.isOwner) {
      return this._pickActorAvatar();
    }

    const ImagePopoutImpl = foundry.applications.apps.ImagePopout?.implementation
      ?? foundry.applications.apps.ImagePopout
      ?? ImagePopout;
    new ImagePopoutImpl(this.actor.img, {
      title: this.actor.name,
      uuid: this.actor.uuid
    }).render(true);
  }

  _pickActorAvatar() {
    const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
    new FilePickerImpl({
      type: "imagevideo",
      current: this.actor.img || "",
      callback: async path => {
        await this.actor.update({ img: path });
      }
    }).render(true);
  }

  _activateJobDropZone() {
    this._jobDropController?.abort();
    if (this.actor.type !== "character" || !this.document.isOwner) return;
    if (!this._isActorEditMode()) return;

    const dropZone = this.element.querySelector(".actor-job-slot");
    if (!dropZone) return;

    this._jobDropController = new AbortController();
    const { signal } = this._jobDropController;

    const allowDrop = event => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      dropZone.classList.add("drag-over");
    };

    dropZone.addEventListener("dragenter", allowDrop, { signal });
    dropZone.addEventListener("dragover", allowDrop, { signal });
    dropZone.addEventListener("dragleave", event => {
      if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("drag-over");
    }, { signal });
    dropZone.addEventListener("drop", event => {
      dropZone.classList.remove("drag-over");
      this._onDropJob(event);
    }, { signal });
  }

  async _onDropJob(event) {
    event.preventDefault();
    event.stopPropagation();

    const data = await foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const item = data?.uuid ? await fromUuid(data.uuid) : null;
    if (!item || item.documentName !== "Item" || item.type !== "job") {
      ui.notifications.warn("Drop a Job item here.");
      return;
    }

    await this._replaceJob(item);
  }

  async _replaceJob(sourceItem) {
    this._captureSheetScroll();
    const itemData = sourceItem.toObject();
    delete itemData._id;

    const existingJobs = this.actor.items.filter(item => item.type === "job");
    if (existingJobs.length) await this._deleteJobsWithGrantedAbilities(existingJobs, { render: false });

    const [job] = await this.actor.createEmbeddedDocuments("Item", [itemData], {
      render: false,
      ffxivSkipAutoJobAssignment: true
    });
    await job?._assignJob?.({ render: false });
    this._enrichedCache = null;
    await this.render({ force: true });
    await this._refreshAbilitiesPanel();
    this._restoreSheetScroll();
  }

  async _deleteJobsWithGrantedAbilities(jobs, options = {}) {
    const jobIds = new Set(jobs.map(job => job.id));
    const grantedUuids = new Set(jobs.flatMap(job => {
      const rawGrants = job.system?.ability_grants;
      const grants = Array.isArray(rawGrants) ? rawGrants : Object.values(rawGrants || {});
      return grants.map(grant => grant.uuid).filter(Boolean);
    }));
    const grantedItems = this.actor.items.filter(item =>
      jobIds.has(item.flags?.ffxiv?.jobId)
      || grantedUuids.has(item.flags?.ffxiv?.jobSourceUuid)
    );
    const idsToDelete = [...jobs, ...grantedItems].map(item => item.id);
    if (idsToDelete.length) await this.actor.deleteEmbeddedDocuments("Item", idsToDelete, options);
  }

  async _onDeleteJob(event) {
    event.preventDefault();
    event.stopPropagation();

    const itemId = event.currentTarget.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item || item.type !== "job") return;

    this._captureSheetScroll();
    await this._deleteJobsWithGrantedAbilities([item], { render: false });
    await this.actor.update({
      "system.class.name": "custom",
      "system.class.name_custom": "",
      "system.class.role": "",
      "system.class.customIcon": "",
      "system.showPets": "false"
    }, { render: false });
    await this.render({ force: true });
    this._restoreSheetScroll();
  }

  async _refreshDialogContent(dialog, item) {
    const newHtml = await foundry.applications.handlebars.renderTemplate("systems/ffxiv/templates/item/item-sheet-dialog.hbs", item);
    dialog.data.content = newHtml;
    dialog.render(true);
  };


  _updateManaBar() {
    const currentMana = Number(this.actor.system?.mana?.value ?? 0);
    const maxMana = Number(this.actor.system?.mana?.max ?? 5);
    const manaCurrentValue = Math.max(0, Number.isFinite(currentMana) ? currentMana : 0);
    const manaMaxValue = Math.max(1, Number.isFinite(maxMana) ? maxMana : 5);
    const manaPercent = Math.min(100, Math.max(0, (manaCurrentValue / manaMaxValue) * 100));

    let cs = document.getElementById(this.characterSheet)
    if (cs) {
      const manaFill = cs.querySelector('.mana-fill');
      if (manaFill) manaFill.style.width = `${manaPercent}%`;

      const manaCurrent = cs.querySelector('.mana-value-current');
      if (manaCurrent) manaCurrent.textContent = String(manaCurrentValue);

      const manaMax = cs.querySelector('.mana-value-max');
      if (manaMax) manaMax.textContent = String(manaMaxValue);
    }
  }
  async _onClickManaBar(event) {
    let currentMana = Number(this.actor.system?.mana?.value ?? 0);
    const previousMana = currentMana;
    const maxMana = Math.max(1, Number(this.actor.system?.mana?.max ?? 5) || 5);
    const useLegacyBehavior = game.settings.get("ffxiv", "legacyManaClickBehavior");

    if (event.which === 1) {
      currentMana = useLegacyBehavior
        ? Math.max(0, currentMana - 1)
        : Math.min(maxMana, currentMana + 1);
    } else if (event.which === 3) {
      event.preventDefault()
      currentMana = useLegacyBehavior
        ? Math.min(maxMana, currentMana + 1)
        : Math.max(0, currentMana - 1);
    }

    if (currentMana === previousMana) return;
    await this.actor.update({ "system.mana.value": currentMana }, { render: false });
    this._updateManaBar();

  }

  _updateHealthBar() {
    const currentHealth = Number(this.actor.system?.health?.value ?? 0);
    const maxHealth = Number(this.actor.system?.health?.max ?? 0);
    const barrierValue = Number(this.actor.system?.barrier?.value ?? 0);
    const healthPercentage = maxHealth > 0 ? Math.min(100, Math.max(0, (currentHealth / maxHealth) * 100)) : 0;
    const normalizedHealth = Math.max(0, Math.min(currentHealth, maxHealth || 0));
    const normalizedBarrier = Math.max(0, barrierValue);
    const barrierStartPercentage = maxHealth > 0 ? (normalizedHealth / maxHealth) * 100 : 0;
    const barrierInsidePercentage = maxHealth > 0
      ? Math.max(0, Math.min((normalizedBarrier / maxHealth) * 100, 100 - barrierStartPercentage))
      : 0;
    const barrierOverflowPercentage = maxHealth > 0
      ? Math.max(0, Math.min(((normalizedBarrier - Math.max(0, maxHealth - normalizedHealth)) / maxHealth) * 100, 100))
      : 0;
    let cs = document.getElementById(this.characterSheet);
    if (cs) {
      const healthBar = cs.querySelectorAll('.health-bar');
      if (healthBar.length > 0) {
        healthBar[0].style.width = `${healthPercentage}%`
        healthBar[0].classList.remove('health-good', 'health-bad', 'health-danger')
        if (healthPercentage >= 30) {
          healthBar[0].classList.add('health-good')
        } else {
          healthBar[0].classList.add('health-danger')
        }
      }

      const barrierOverlay = cs.querySelector('.barrier-overlay');
      if (barrierOverlay) {
        barrierOverlay.style.left = `${barrierStartPercentage}%`;
        barrierOverlay.style.width = `${barrierInsidePercentage}%`;
        barrierOverlay.style.display = barrierInsidePercentage > 0 ? "" : "none";
      }

      const barrierOverflow = cs.querySelector('.barrier-overflow');
      if (barrierOverflow) {
        barrierOverflow.style.width = `${barrierOverflowPercentage}%`;
        barrierOverflow.style.display = barrierOverflowPercentage > 0 ? "" : "none";
      }
    }
  }

  async _displayAbilityTab(event) {
    event.preventDefault();
    event.stopPropagation();
    const tab = $(event.currentTarget).data('tab');
    const changed = this.currentAbilityTab !== tab;
    this.currentAbilityTab = tab
    if (this.actor?.type === "character") {
      await this._refreshAbilitiesPanel();
    } else {
      this._switchAbilityTab(tab)
    }
    if (changed) this._playConfiguredSound("soundNotificationFFXIV_openSheet");
  }
  _displayCompanionTab(event) {
    event.preventDefault();
    event.stopPropagation();
    const tab = $(event.currentTarget).data('tab');
    const changed = this.currentCompanionTab !== tab;
    this.currentCompanionTab = tab
    this._switchCompanionTab(tab)
    if (changed) this._playConfiguredSound("soundNotificationFFXIV_openSheet");
  }
  _applyStoredAbilityTab() {
    const tab = this.currentAbilityTab || 'primary';  // Default to primary if no tab is stored
    this._switchAbilityTab(tab)
  }
  _applyStoredCompanionTab() {
    const hasPetsTab = this.actor?.system?.showPets === "true";
    const tab = (!hasPetsTab || this.currentCompanionTab === "pets")
      ? (hasPetsTab ? (this.currentCompanionTab || "minions") : "minions")
      : (this.currentCompanionTab || "minions");
    this._switchCompanionTab(tab)
  }
  _switchAbilityTab(tab) {
    $(`#${this.characterSheet} .abilities-sub-tabs .sub-tab`).removeClass("active");
    $(`#${this.characterSheet} .sub-tab-content`).removeClass('active').prop("hidden", true).hide();
    $(`#${this.characterSheet} .abilities-sub-tabs .sub-tab[data-tab=${tab}]`).addClass("active");
    $(`#${this.characterSheet} .sub-tab-content[data-tab=${tab}]`).prop("hidden", false).addClass('active').show();
  }
  _switchCompanionTab(tab) {
    const characterSheet = this.characterSheet;
    const hasPetsTab = this.actor?.system?.showPets === "true";
    const resolvedTab = (!hasPetsTab && tab === "pets") ? "minions" : (tab || "minions");
    this.currentCompanionTab = resolvedTab;

    $(`#${characterSheet} .companions-sub-tabs .companions-sub-tab`).removeClass("active");
    $(`#${characterSheet} .companions-sub-tab-content`).removeClass('active').prop("hidden", true).hide();
    $(`#${characterSheet} .companions-sub-tabs .companions-sub-tab[data-tab=${resolvedTab}]`).addClass("active");
    $(`#${characterSheet} .companions-sub-tab-content[data-tab=${resolvedTab}]`).prop("hidden", false).addClass('active').show();
  }

  async _onChangeLimitations(event) {
    event.preventDefault();
    event.stopPropagation();
    const checkbox = event.currentTarget
    const index = parseInt(checkbox.dataset.index, 10);
    const itemId = checkbox.dataset.itemId;

    const item = this.actor.items.get(itemId)
    if (!item) return;

    var limitations_status;
    if (item.system.limitations_status) {
      limitations_status = item.system.limitations_status.slice(0, item.system.limitations_max);
    } else {
      limitations_status = new Array(item.system.limitations_max).fill(false)
    }
    limitations_status[index] = checkbox.checked;

    await this._updateAbilityCheckboxState(item, { 'system.limitations_status': limitations_status });

  }

  async _onChangeJobResource(event) {
    event.preventDefault();
    event.stopPropagation();
    const checkbox = event.currentTarget
    const index = parseInt(checkbox.dataset.index, 10);
    const itemId = checkbox.dataset.itemId;
    const item = this.actor.items.get(itemId)
    if (!item) return;

    var job_resource_status;
    if (item.system.job_resource_status) {
      job_resource_status = item.system.job_resource_status.slice(0, item.system.job_resources_max);
    } else {
      job_resource_status = new Array(item.system.job_resources_max).fill(false)
    }
    job_resource_status[index] = checkbox.checked;
    await this._updateAbilityCheckboxState(item, { 'system.job_resource_status': job_resource_status });
  }

  async _onChangeActiveTrait(event) {
    event.preventDefault();
    event.stopPropagation();
    const checkbox = event.currentTarget
    const itemId = checkbox.dataset.itemId;

    const item = this.actor.items.get(itemId)
    if (!item) return;

    await this._updateAbilityCheckboxState(item, { 'system.active': checkbox.checked });
  }

  async _updateAbilityCheckboxState(item, updateData) {
    this._captureSheetScroll();
    await item.update(updateData, { render: false });
    await this.render({ force: true });
    this._restoreSheetScroll();
  }

  _onDeleteTitle(event) {
    event.preventDefault();
    event.stopPropagation();
    new foundry.applications.api.DialogV2({
      id: "delete-title",
      window: { title: game.i18n.localize("FFXIV.Dialogs.DialogTitleConfirmation") },
      buttons: [
        {
          label: game.i18n.localize("FFXIV.Dialogs.Yes"),
          action: "delete",
          type: "submit",
          callback: (event) => {
            const button = event.currentTarget
            const itemId = button.dataset.itemId
            const item = this.actor.items.get(itemId)
            item.delete();
            ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", { itemName: item.name }));
          }
        },
        {
          label: game.i18n.localize("FFXIV.Dialogs.No"),
          action: "keep",
          type: "submit"
        }
      ]

    }).render({ force: true })
  }

  async _moveAbility(direction, event) {
    event.preventDefault();
    event.stopPropagation();

    if (this._isSheetEditLocked()) {
      this._notifyActorSheetLocked();
      return;
    }

    const actor = this.actor;
    const abilityType = event.currentTarget.dataset.type;
    const itemId = event.currentTarget.dataset.itemId;
    if (!actor || !abilityType || !itemId || !direction) return;

    let abilityOrder = foundry.utils.deepClone(actor.system.ability_order || {});
    if (abilityOrder.constructor.name == "Array") abilityOrder = {} //Before 1.4, there was an issue with template.json creating arrays instead of objects
    if (!abilityOrder[abilityType]) abilityOrder[abilityType] = [];

    const allAbilities = actor.items
      .filter(i => {
        if (abilityType === "minion") return i.type === "minion";
        if (abilityType === "trait") return i.type === "trait";
        return getAbilitySubtype(i) === abilityType;
      })
      .map(i => i.id);

    abilityOrder[abilityType] = abilityOrder[abilityType].filter(id => allAbilities.includes(id)); //redefinition to avoid issues with deleted abilities

    allAbilities.forEach(id => { // add new items
      if (!abilityOrder[abilityType].includes(id)) {
        abilityOrder[abilityType].push(id);
      }
    });

    const index = abilityOrder[abilityType].indexOf(itemId);
    if (index === -1) return; // Fail if item not found

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= abilityOrder[abilityType].length) return; //fail if out of bounds

    [abilityOrder[abilityType][index], abilityOrder[abilityType][newIndex]] =
      [abilityOrder[abilityType][newIndex], abilityOrder[abilityType][index]];
    await actor.update({ "system.ability_order": abilityOrder }, { render: false });
    await this._renderWithoutEnrichment();
  }


  async _movePet(direction, event) {
    event.preventDefault();
    event.stopPropagation();
    const actor = this.actor;
    const petId = event.currentTarget.dataset.itemId;
    if (!actor || !petId || !direction) return;
    let petOrder = foundry.utils.deepClone(actor.system.pet_order || []);
    if (petOrder.constructor.name == "Object") petOrder = []

    const allPets = actor.system.pets;
    petOrder = petOrder.filter(id => allPets.includes(id));

    allPets.forEach(id => { // add new items
      if (!petOrder.includes(id)) {
        petOrder.push(id);
      }
    });

    const index = petOrder.indexOf(petId);
    if (index === -1) return;

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= petOrder.length) return; //fail if out of bounds

    [petOrder[index], petOrder[newIndex]] =
      [petOrder[newIndex], petOrder[index]];
    await actor.update({ "system.pet_order": petOrder });
  }


  async _onDrop(event) {
    event.preventDefault();
    event.stopPropagation();

    const data = await foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    // Handle dropping an Actor
    if (data?.type === "Actor") {
      const droppedActor = game.actors.get(data.uuid.split(".")[1]);
      if (!droppedActor || droppedActor.type !== "pet") return;

      const pets = foundry.utils.duplicate(this.actor.system.pets || []);
      if (!pets.includes(droppedActor.id)) {
        this._captureSheetScroll();
        pets.push(droppedActor.id);
        await this.actor.update({ "system.pets": pets }, { render: false });
        await this._refreshCompanionsPanel();
        this._restoreSheetScroll();
        this._playConfiguredSound("soundNotificationFFXIV_moveItem");
      }
      return;
    }

    if (data?.type === "Item") {
      const item = data.uuid ? await fromUuid(data.uuid) : null;
      const allowLockedAugmentDrop = this.actor.type === "character"
        && !this._isActorEditMode()
        && item?.documentName === "Item"
        && item.type === "augment";
      if (item?.documentName === "Item" && item.parent?.id === this.actor.id && this._isCompanionItemDrop(item)) {
        debugLog('Ignored intra-actor companion drop for item', item.id);
        return;
      }
      if (item?.documentName === "Item" && item.parent?.id === this.actor.id && this._isManualAbilityDrop(item)) {
        debugLog('Ignored intra-actor ability drop for item', item.id);
        return;
      }

      if (item && this.actor.type === "character" && !this._isActorEditMode()) {
        const inventoryTypes = CONFIG.FFXIV?.inventory_items || [];
        if (inventoryTypes.includes(item.type) && !allowLockedAugmentDrop) return;
      }

      const characterLocked = this.actor.type === "character" && !this._isActorEditMode();
      const sheetLocked = EDIT_MODE_ACTOR_TYPES.has(this.actor.type) && !this._isActorEditMode();

      if (this.actor.type === "character" && item?.documentName === "Item" && item.type === "job") {
        if (characterLocked) {
          this._notifyActorSheetLocked();
          return;
        }
        await this._replaceJob(item);
        return;
      }

      if (this._isManualAbilityDrop(item)) {
        if (sheetLocked && !characterLocked) {
          this._notifyActorSheetLocked();
          return;
        }
        await this._equipDroppedAbility(item);
        return;
      }

      if (this._isCompanionItemDrop(item)) {
        if (sheetLocked && !characterLocked) {
          this._notifyActorSheetLocked();
          return;
        }
        await this._equipDroppedCompanion(item);
        return;
      }

      if (sheetLocked && !allowLockedAugmentDrop) {
        this._notifyActorSheetLocked();
        return;
      }
    }

    // Default behavior for other drops (like items)
    return super._onDrop(event);
  }

  _isManualAbilityDrop(item) {
    const isAbility = item?.type === "ability"
      || ["primary_ability", "secondary_ability", "instant_ability", "limit_break"].includes(item?.type);
    return item?.documentName === "Item" && (isAbility || item.type === "trait");
  }

  _isCompanionItemDrop(item) {
    return item?.documentName === "Item" && item?.type === "minion";
  }

  async _equipDroppedAbility(sourceItem) {
    this._captureSheetScroll();
    const itemData = sourceItem.toObject();
    delete itemData._id;
    if (["primary_ability", "secondary_ability", "instant_ability", "limit_break"].includes(itemData.type)) {
      itemData.type = "ability";
      const existingTags = Array.isArray(itemData.system?.tags) ? itemData.system.tags : [];
      itemData.system = itemData.system || {};
      itemData.system.tags = ensureAbilitySubtypeTags(
        [getSubtypeTagLabel(getAbilitySubtype(sourceItem)), ...existingTags],
        "primary_ability"
      );
    }

    await this.actor.createEmbeddedDocuments("Item", [itemData], { render: false });
    this._enrichedCache = null;
    await this.render({ force: true });
    await this._refreshAbilitiesPanel();
    this._restoreSheetScroll();
    this._playConfiguredSound("soundNotificationFFXIV_moveItem");
  }

  async _equipDroppedCompanion(sourceItem) {
    this._captureSheetScroll();
    const itemData = sourceItem.toObject();
    delete itemData._id;
    await this.actor.createEmbeddedDocuments("Item", [itemData], { render: false });
    await this._refreshCompanionsPanel();
    this._restoreSheetScroll();
    this._playConfiguredSound("soundNotificationFFXIV_moveItem");
  }

  async _removePet(event) {
    const petId = event.currentTarget.dataset.itemId;
    let pets = foundry.utils.duplicate(this.actor.system.pets || []);
    const index = pets.indexOf(petId)
    if (index == -1) {
      debugError(`No pet "${petId}" in pets array from:`, this.actor.system.pets);
      return;
    }
    pets.splice(index, 1);
    await this.actor.update({ "system.pets": pets })


  }

  async _openPet(event) {
    const petId = event.currentTarget.dataset.petId;
    const pet = game.actors.get(petId)
    if (pet) {
      pet.sheet.render({ force: true });
    } else {
      debugError(`No pet found for ${petId}`);
    }
  }
}
