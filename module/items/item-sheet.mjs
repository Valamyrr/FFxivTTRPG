import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';
import { debugError, debugLog } from "../helpers/debug.mjs";
import { normalizeShopTier } from "../helpers/shop-tier.mjs";

const DEFAULT_SOUNDS = {
  soundNotificationFFXIV_deleteItem: "systems/ffxiv/assets/sfx/ffxiv-close-window.mp3",
  soundNotificationFFXIV_openSheet: "systems/ffxiv/assets/sfx/ffxiv-switch-target.mp3",
  soundNotificationFFXIV_closeSheet: "systems/ffxiv/assets/sfx/ffxiv-untarget.mp3",
};

const SOUND_ITEM_TYPES = new Set([
  "primary_ability",
  "secondary_ability",
  "instant_ability",
  "trait",
  "limit_break",
  "job",
]);

import PopoutEditor from "../popout-editor.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

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
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['ffxiv', 'sheet', 'item'],
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
    const path = 'systems/ffxiv/templates/item';

    // Return a single sheet for all item types.
    // return `${path}/item-sheet.hbs`;

    // Alternatively, you could use the following return statement to do a
    // unique item sheet by type, like `weapon-sheet.hbs`.
    if (this.item.type == "consumable"){
      if (game.settings.get('ffxiv', 'limitedPhysicalItemsDialog') && (this.item.parent != null || this.item.flags["item-piles"])){
        return `${path}/item-sheet-dialog.hbs`;
      }else{
        return `${path}/item-consumable-sheet.hbs`;
      }
    }

    if (this.item.type == "primary_ability"){
      return `${path}/item-ability-sheet.hbs`;
    }
    if (this.item.type == "secondary_ability"){
      return `${path}/item-ability-sheet.hbs`;
    }
    if (this.item.type == "instant_ability"){
      return `${path}/item-ability-sheet.hbs`;
    }
    if (this.item.type == "trait"){
      return `${path}/item-trait-sheet.hbs`;
    }
    if (this.item.type == "limit_break"){
      return `${path}/item-limitbreak-sheet.hbs`;
    }
    if (this.item.type == "title"){
      return `${path}/item-title-sheet.hbs`;
    }
    if (this.item.type == "minion"){
      return `${path}/item-minion-sheet.hbs`;
    }
    if (this.item.type == "pet"){
      return `${path}/item-pet-sheet.hbs`;
    }
    if (this.item.type == "augment"){
      return `${path}/item-augment-sheet.hbs`;
    }
    if (this.item.type == "job"){
      return `${path}/item-job-sheet.hbs`;
    }
    if (this.item.type == "gear"){
      if (game.settings.get('ffxiv', 'limitedPhysicalItemsDialog') && this.item.parent != null){
        return `${path}/item-sheet-dialog-gear.hbs`;
      }else{
        return `${path}/item-gear-sheet.hbs`;
      }
    }

    if (this.item.type == "currency"){
      return `${path}/item-currency-sheet.hbs`;
    }

    return `${path}/item-sheet.hbs`;

  }

  /* -------------------------------------------- */

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.sheet.template = this.template;
    return parts;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    if (this.item.type === "minion" && this.tabGroups?.primary === "description") {
      this.tabGroups.primary = "details";
    }

    // Use a safe clone of the item data for further operations.
    const itemData = this.document.toObject(false);
    context.item = this.item;
    context.system = itemData.system;
    context.source = this.item._source.system;
    context.flags = itemData.flags;
    context.config = CONFIG.FF_XIV;
    context.statusEffects = CONFIG.statusEffects;
    context.itemStatusEffects = this._getStatusEffectEntries(itemData.system);
    context.cssClass = this._getSheetClasses().join(" ");
    context.editable = this.document.isOwner;
    context.bakedActionTag = this._getBakedActionTag(this.item.type);
    context.customTags = this._getCustomActionTags(itemData.system.tags);
    context.hasMarkerTag = this._hasMarkerTag(itemData.system.tags);
    context.hasCheck = this._hasCheck(itemData.system.check);
    if (Object.hasOwn(context.system, "shop_tier")) {
      const normalizedShopTier = normalizeShopTier(context.system.shop_tier, context.system.shop_tier_custom);
      context.system.shop_tier = normalizedShopTier.shop_tier;
      context.system.shop_tier_custom = normalizedShopTier.shop_tier_custom;
    }
    if (Object.hasOwn(context.system, "max_stack")) {
      const sourceHasMaxStack = foundry.utils.hasProperty(this.item._source?.system ?? {}, "max_stack");
      const hasMaxStack = context.system.max_stack !== null && context.system.max_stack !== undefined && String(context.system.max_stack).trim() !== "";
      context.system.max_stack = (!sourceHasMaxStack && context.system.stack)
        ? 99
        : (hasMaxStack
        ? Math.max(1, Number.parseInt(context.system.max_stack, 10) || 1)
        : (context.system.stack ? 99 : 1));
    }
    if (this.item.type === "job") {
      context.system.job_name = this._getJobBaseName(context.system.job_name, this.item.name);
      context.system.ability_grants = this._normalizeJobAbilityGrants(context.system.ability_grants)
        .map(grant => ({
          ...grant,
          typeLabel: this._getJobGrantTypeLabel(grant.type)
        }));
    }

    context.enriched = await this.constructor.enrichAllStrings(
      context.system ?? {},
      this.item.getRollData(),
      this.item,
      this.document.isOwner
    );
    context.enrichedDescription = context.enriched?.description ?? "";
    context.enrichedTraits = context.enriched?.traits ?? "";

    context.settings = {
      "jobsAbbrv": game.settings.get('ffxiv','jobsAbbrv').split(",")
    }

    // Prepare active effects for easier access
    context.effects = prepareActiveEffectCategories(this.item.effects);
    return context;
  }

  static async enrichAllStrings(target, rollData, relativeTo, secrets=true) {
    if (typeof target === "string") {
      const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(target, {
        secrets,
        async: true,
        rollData,
        relativeTo,
      });
      return html?.trim() ? html : target;
    }

    if (Array.isArray(target)) {
      const enriched = [];
      for (const value of target) {
        enriched.push(await this.enrichAllStrings(value, rollData, relativeTo, secrets));
      }
      return enriched;
    }

    if (target && typeof target === "object") {
      const enriched = {};
      for (const [key, value] of Object.entries(target)) {
        enriched[key] = await this.enrichAllStrings(value, rollData, relativeTo, secrets);
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

    const limited = this.element.querySelector('.limited-display');
    if (limited) {
      this.options.window.resizable = false;
      this._fitLimitedDisplayToContent();
    }

    this.activateListeners($(this.element));
    this._activateJobDropZone();
  }

  /** @override */
  async _onFirstRender(context, options) {
    if (typeof super._onFirstRender === "function") await super._onFirstRender(context, options);
    if (SOUND_ITEM_TYPES.has(this.item.type)) this._playConfiguredSound("soundNotificationFFXIV_openSheet");
  }

  /** @override */
  async _onClose(options) {
    await super._onClose(options);
    if (SOUND_ITEM_TYPES.has(this.item.type)) this._playConfiguredSound("soundNotificationFFXIV_closeSheet");
  }

  _playConfiguredSound(setting) {
    const src = game.settings.get('ffxiv', setting) || DEFAULT_SOUNDS[setting];
    if(game.settings.get('ffxiv', 'soundNotificationFFXIV') && src){
      foundry.audio.AudioHelper.play({
        src,
        volume: 1,
        autoplay: true,
        loop: false
      });
    }
  }

  /** @override */
  _onChangeForm(formConfig, event) {
    if (!formConfig.submitOnChange) return super._onChangeForm(formConfig, event);
    if (!this.isEditable) return;
    if (!event.target?.name) return;

    event.preventDefault();
    const updateData = { [event.target.name]: this._getChangedFieldValue(event.target) };
    const render = (this.item.type === "job" && ["system.job_name", "system.level"].includes(event.target.name))
      || ["system.shop_tier", "system.max_stack", "system.direct_formula", "system.check", "system.origin"].includes(event.target.name);
    this.document.update(updateData, { render })
      .then(async () => {
        await this._syncJobPetVisibility(event.target.name, updateData[event.target.name]);
        await this._syncJobItemName(event.target.name);
      })
      .catch(err => ui.notifications.error(err, { console: true }));
  }

  async _syncJobItemName(fieldName) {
    if (this.item.type !== "job") return;
    if (!["system.job_name", "system.level"].includes(fieldName)) return;

    const name = this._formatJobItemName(this.item.system.job_name, this.item.system.level);
    if (this.item.name === name) return;
    await this.item.update({ name });
  }

  _getJobBaseName(jobName, itemName=this.item.name) {
    const name = String(jobName ?? "").trim();
    if (name) return name;
    return String(itemName ?? "").replace(/\s*\(LV\s*(?:\d+|\?\?)\)\s*$/i, "").trim();
  }

  _formatJobItemName(jobName, level) {
    const name = this._getJobBaseName(jobName) || game.i18n.localize("FFXIV.ItemType.job");
    const levelNumber = Number(level);
    const levelText = Number.isFinite(levelNumber) && levelNumber > 0 ? String(levelNumber) : "??";
    return `${name} (LV ${levelText})`;
  }

  async _syncJobPetVisibility(fieldName, value) {
    if (fieldName !== "system.has_pets") return;
    if (this.item.type !== "job") return;
    if (this.item.parent?.documentName !== "Actor" || this.item.parent.type !== "character") return;
    await this.item.parent.update({ "system.showPets": value ? "true" : "false" }, { render: false });
  }

  _getChangedFieldValue(target) {
    if (target.type === "checkbox") return target.checked;
    if (target.multiple) return Array.from(target.selectedOptions).map(option => option.value);

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
    const bakedTagNames = new Set(["primary", "secondary", "instant", "limit break", "limit-break"]);
    return (Array.isArray(tags) ? tags : [])
      .map((tag, index) => ({ tag, index }))
      .filter(({ tag }) => !bakedTagNames.has(String(tag ?? "").trim().toLowerCase()));
  }

  _hasMarkerTag(tags) {
    return (Array.isArray(tags) ? tags : [])
      .some(tag => String(tag ?? "").toLowerCase().includes("marker"));
  }

  _hasCheck(check) {
    const none = game.i18n.localize("FFXIV.None");
    return Boolean(check) && check !== "FFXIV.None" && check !== none;
  }

  _getStatusEffectEntries(system) {
    const entries = Array.isArray(system.status_effects) ? foundry.utils.deepClone(system.status_effects) : [];
    if (!entries.length && system.status_effect) {
      entries.push({
        id: system.status_effect,
        action: system.status_action !== false
      });
    }
    return entries.map(entry => ({
      id: entry?.id ?? "",
      action: entry?.action !== false
    }));
  }

  _getCurrentStatusEffectEntries() {
    return this._getStatusEffectEntries(this.item.system);
  }

  _onChangeStatusEffect(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;

    const entries = this._getCurrentStatusEffectEntries();
    entries[index] ??= { id: "", action: true };
    if (event.currentTarget.classList.contains("status-effect-id")) {
      entries[index].id = event.currentTarget.value;
    } else {
      entries[index].action = event.currentTarget.value === "true";
    }
    this.item.update({
      "system.status_effects": entries,
      "system.status_effect": "",
      "system.status_action": true
    }, { render: false })
      .then(() => this.render({ force: true }))
      .catch(err => ui.notifications.error(err, { console: true }));
  }

  _onAddStatusEffect(event) {
    event.preventDefault();
    event.stopPropagation();

    const entries = this._getCurrentStatusEffectEntries();
    const defaultEffect = CONFIG.statusEffects?.[0]?.id ?? "";
    entries.push({ id: defaultEffect, action: true });
    this.item.update({
      "system.status_effects": entries,
      "system.status_effect": "",
      "system.status_action": true
    }, { render: false })
      .then(() => this.render({ force: true }))
      .catch(err => ui.notifications.error(err, { console: true }));
  }

  _onRemoveStatusEffect(event) {
    event.preventDefault();
    event.stopPropagation();

    const index = Number(event.currentTarget.dataset.index);
    const entries = this._getCurrentStatusEffectEntries();
    entries.splice(index, 1);
    this.item.update({
      "system.status_effects": entries,
      "system.status_effect": "",
      "system.status_action": true
    }, { render: false })
      .then(() => this.render({ force: true }))
      .catch(err => ui.notifications.error(err, { console: true }));
  }

  /** @override */
  activateListeners(html) {
    html.off(".ffxivItemSheet");

    // Everything below here is only needed if the sheet is editable
    if (!this.document.isOwner) return;

    // hidden here instead of css to prevent non-editable display of edit button
    html.find(".popout-editor").off("mouseover.ffxivItemSheet").on("mouseover.ffxivItemSheet", (event) => {
      $(event.currentTarget).find(".popout-editor-button").show();
    });
    html.find(".popout-editor").off("mouseout.ffxivItemSheet").on("mouseout.ffxivItemSheet", (event) => {
      $(event.currentTarget).find(".popout-editor-button").hide();
    });
    html.find(".popout-editor .popout-editor-button").off("click.ffxivItemSheet").on("click.ffxivItemSheet", this._onPopoutEditor.bind(this));
    html.on('click.ffxivItemSheet', '.profile-img[data-edit="img"]', this._onPickItemIcon.bind(this));


    //Tags
    html.on('change.ffxivItemSheet', '.select-tags', (event) => {
      const index = Number(event.currentTarget.dataset.index ?? $(event.currentTarget).closest('li').index());
      const value = $(event.currentTarget).val(); // Get the selected value
      const tags = this.item.system.tags || []; // Ensure tags is initialized
      tags[index] = value; // Update the correct index in the array
      this.item.update({ "system.tags": tags }); // Update the item with the new tags array
    });
    html.on('click.ffxivItemSheet', '.remove-tag', (event) => {
      const index = event.currentTarget.dataset.index;
      const tags = this.item.system.tags || [];
      tags.splice(index, 1); // Remove the tag at the specified index
      this.item.update({ "system.tags": tags });
      this.render(); // Re-render to show the updated fields
    });
    html.on('click.ffxivItemSheet', '.add-tag', () => {
      const tags = this.item.system.tags || [];

      const configMap = {
        primary_ability: "tags_abilities",
        secondary_ability: "tags_abilities",
        instant_ability: "tags_abilities",
        limit_break: "tags_abilities",
        trait: "tags_traits",
        consumable: "tags_consumables"
      };

      const configKey = configMap[this.item.type];
      const tagPool = CONFIG.FF_XIV[configKey] || {};
      const defaultTag = Object.values(tagPool)[0]?.label || "";
      debugLog(defaultTag + " : " + tags);
      if (defaultTag) {
        tags.push(defaultTag);
        this.item.update({ "system.tags": tags });
        this.render();
      }
    });

    html.on('change.ffxivItemSheet', '.status-effect-id, .status-effect-action', this._onChangeStatusEffect.bind(this));
    html.on('click.ffxivItemSheet', '.add-status-effect', this._onAddStatusEffect.bind(this));
    html.on('click.ffxivItemSheet', '.remove-status-effect', this._onRemoveStatusEffect.bind(this));


    //Gear Classes, similar as tags
    if(this.item.type=="gear"){
      html.on('change.ffxivItemSheet', '.select-classes', (event) => {
        const index = $(event.currentTarget).closest('li').index();
        const value = $(event.currentTarget).val();
        const classes = this.item.system.classes || [];
        classes[index] = value;
        this.item.update({ "system.classes": classes });
      });
      html.on('click.ffxivItemSheet', '.remove-class', (event) => {
        const index = event.currentTarget.dataset.index;
        const classes = this.item.system.classes || [];
        classes.splice(index, 1);
        this.item.update({ "system.classes": classes });
        this.render();
      });
      html.on('click.ffxivItemSheet', '.add-class', () => {
        const classes = this.item.system.classes || [];
        classes.push("");
        this.item.update({ "system.classes": classes });
        this.render();
      });
    }

    if(this.item.type=="job"){
      html.on('click.ffxivItemSheet', '.job-ability-edit', this._onEditJobAbility.bind(this));
      html.on('click.ffxivItemSheet', '.remove-job-ability', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(event.currentTarget.dataset.index);
        const grants = this._getJobAbilityGrants();
        grants.splice(index, 1);
        this.item.update({ "system.ability_grants": grants });
        this.render();
      });
    }



    // Modifiers, similar as tags
    html.on('change.ffxivItemSheet', '.modifier-name', (event) => {
      const index = event.currentTarget.dataset.index;
      const value = event.currentTarget.value;
      const modifiers = this.item.system.modifiers || [];
      if (modifiers[index]) {
        modifiers[index][0] = value; // Update name
        this.item.update({ "system.modifiers": modifiers });
      }
    });
    html.on('change.ffxivItemSheet', '.modifier-value', (event) => {
      const index = event.currentTarget.dataset.index;
      let value = event.currentTarget.value || 0;
      const modifiers = this.item.system.modifiers || [];
      if (modifiers[index]) {
        if (modifiers[index][0] != "FFXIV.Damages"){
          value = parseInt(value)
        }
        modifiers[index][1] = value; // Update value
        this.item.update({ "system.modifiers": modifiers });
      }
    });
    html.on('click.ffxivItemSheet', '.add-modifier', () => {
      const modifiers = this.item.system.modifiers || [];
      modifiers.push(["FFXIV.Attributes.Strength.long", 0]);
      this.item.update({ "system.modifiers": modifiers });
    });
    html.on('click.ffxivItemSheet', '.remove-modifier', (event) => {
      const index = event.currentTarget.dataset.index;
      const modifiers = this.item.system.modifiers || [];
      modifiers.splice(index, 1);
      this.item.update({ "system.modifiers": modifiers });
      this.render();
    });





    html.on('click.ffxivItemSheet', '.item-delete', this._deleteItem.bind(this));
    html.on('click.ffxivItemSheet', '.quantity-form .delete', this._deleteItem.bind(this));
    html.on('click.ffxivItemSheet', '.quantity-form .item-qty-btn-rm', this._decreaseQuantity.bind(this));
    html.on('click.ffxivItemSheet', '.quantity-form .item-qty-btn-add', this._increaseQuantity.bind(this));
    html.on('click.ffxivItemSheet', '.item-qty-btn.gear-equip', this._toggleEquip.bind(this))

    html.on('click.ffxivItemSheet', '.item-roll-button', this._rollItem.bind(this));

    html.on("keydown.ffxivItemSheet", (event) => {
      if (event.key === "Enter") {
          event.preventDefault(); // Prevent the Enter key from triggering the button
      }
    });

  }

  _getSheetClasses() {
    return ['ffxiv', 'sheet', 'item', `${CONFIG.theme}_theme`];
  }

  _activatePrimaryTabs() {
    const nav = this.element.querySelector(".sheet-tabs");
    if (!nav) return;

    const tabs = Array.from(this.element.querySelectorAll(".sheet-body .tab[data-tab]"));
    const links = Array.from(nav.querySelectorAll("[data-tab]"));
    if (!tabs.length || !links.length) return;

    let initial = this.tabGroups?.primary || links.find(link => link.classList.contains("active"))?.dataset.tab
      || links[0]?.dataset.tab || tabs[0]?.dataset.tab;
    if (!tabs.some(panel => panel.dataset.tab === initial)) initial = links[0]?.dataset.tab || tabs[0]?.dataset.tab;

    const activate = (tab) => {
      this.tabGroups.primary = tab;
      links.forEach(link => link.classList.toggle("active", link.dataset.tab === tab));
      tabs.forEach(panel => {
        const active = panel.dataset.tab === tab;
        panel.classList.toggle("active", active);
        panel.style.display = active ? "" : "none";
      });
    };

    this._tabController?.abort();
    this._tabController = new AbortController();
    links.forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        activate(link.dataset.tab);
      }, { capture: true, signal: this._tabController.signal });
    });

    activate(initial);
  }

  async _rollItem(event){
    event.preventDefault();
    event.stopPropagation();
    if (this.item.type=="gear"){
      var templatePath = "systems/ffxiv/templates/chat/gear-chat-card.hbs"
    }else {
      var templatePath = "systems/ffxiv/templates/chat/item-chat-card.hbs"
    }
    const enriched = await this.constructor.enrichAllStrings(
      this.item.system ?? {},
      this.item.getRollData(),
      this.item,
      true
    );
    await ChatMessage.create({
      content: await foundry.applications.handlebars.renderTemplate(templatePath, {
        item: this.item,
        enriched
      }),
      flags: { core: { canParseHTML: true } },
      flavor: game.i18n.format("FFXIV.ItemType."+this.item.type)
    });

    if (typeof this.item._consumeFromInventoryIfNeeded === "function") {
      await this.item._consumeFromInventoryIfNeeded();
      if (!this.item?.parent && this.rendered) this.close();
    }
  }

  _decreaseQuantity(event){
    event.preventDefault();
    event.stopPropagation();
    const newQuantity = this.item.system.quantity - 1;
      if (newQuantity < 1){
        this._deleteItem(event)
        const deleteSound = game.settings.get('ffxiv', 'soundNotificationFFXIV_deleteItem') || DEFAULT_SOUNDS.soundNotificationFFXIV_deleteItem;
        if(game.settings.get('ffxiv', 'soundNotificationFFXIV') && deleteSound){
          foundry.audio.AudioHelper.play({
            src: deleteSound,
            volume: 1,
            autoplay: true,
            loop: false
          });
        }
      } else {
          this.item.update({ 'system.quantity': parseInt(newQuantity) });
      }
  }
  _increaseQuantity(event){
    event.preventDefault();
    event.stopPropagation();
    this.item.update({ 'system.quantity': parseInt(this.item.system.quantity + 1) });
  }

  _deleteItem(event) {
    event.preventDefault();
    event.stopPropagation();
    new foundry.applications.api.DialogV2({
      id: "ffxiv-confirm-item-deletion",
      window: { title: game.i18n.localize("FFXIV.Dialogs.DialogTitleConfirmation") },
      form: {
        submitOnChange: false,
        closeOnSubmit: true
      },
      content: game.i18n.format("FFXIV.Dialogs.ItemDelete", {itemName: this.item.name}),
      buttons: [
        {
          label: game.i18n.localize("FFXIV.Dialogs.Yes"),
          action: "delete",
          type: "submit",
          callback: (event, button) => {
            ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", {itemName: this.item.name}));
            this.item.delete();
            this.render()
          }
        },
        {
          label: game.i18n.localize("FFXIV.Dialogs.No"),
          action: "keep",
          type: "submit",
          callback: (event, button) => {}
        }
      ]
    }).render({force:true})
  }

  _toggleEquip(event) {
    event.preventDefault();
    event.stopPropagation();
    let actor = game.actors.get(this.item.parent._id);

    // Ensure equippedGear is initialized with category keys, not localized labels
    let equippedGear = actor.system.equippedGear || Object.fromEntries(
      Object.keys(CONFIG.FF_XIV.gear_subcategories).map(k => [k, ""])
    );

    debugLog("Before:", equippedGear);

    // Find the category key corresponding to this item's category (localized label)
    let categoryKey = Object.keys(CONFIG.FF_XIV.gear_subcategories).find(
      key => CONFIG.FF_XIV.gear_subcategories[key].label === this.item.system.category
    );

    if (!categoryKey) {
      debugError(`Category not found for ${this.item.system.category}`);
      return;
    }

    if (this.item.system.equipped) {
      // Unequip item
      equippedGear[categoryKey] = "";
      this.item.update({ "system.equipped": false });
    } else {
      // Replace currently equipped gear in this category
      const currentEquipped = equippedGear[categoryKey];
      if (currentEquipped) {
        let oldItem = actor.items.get(currentEquipped);
        if (oldItem) {
          oldItem.update({ "system.equipped": false });
          ui.notifications.info(game.i18n.format("FFXIV.Notifications.ReplaceGear", { oldGear: oldItem.name, newGear: this.item.name }));
        }
      }
      equippedGear[categoryKey] = this.item._id;
      this.item.update({ "system.equipped": true });
    }

    debugLog("After:", equippedGear);
    actor.update({ "system.equippedGear": equippedGear });
  }


  _onPopoutEditor(event) {
    event.preventDefault();
    const a = event.currentTarget.parentElement;
    const label = a.dataset.label;
    const key = a.dataset.target;

    const parent = $(a.parentElement);
    const parentPosition = $(parent).offset();

    const windowHeight = parseInt($(parent).height(), 10) + 100 < 400 ? 400 : parseInt($(parent).height(), 10) + 100;
    const windowWidth = parseInt($(parent).width(), 10) < 320 ? 320 : parseInt($(parent).width(), 10);
    const windowLeft = parseInt(parentPosition.left, 10);
    const windowTop = parseInt(parentPosition.top, 10);

    const title = a.dataset.label ? `Editor for ${this.item.name}: ${label}` : `Editor for ${this.item.name}`;

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
    this.element.querySelectorAll(".editor-content[data-edit]").forEach(div => this._activateEditor?.(div));
  }

  _isLimitedDisplayMode() {
    if (!game.settings.get('ffxiv', 'limitedPhysicalItemsDialog')) return false;
    if (this.item.type === "consumable") {
      return this.item.parent != null || Boolean(this.item.flags?.["item-piles"]);
    }
    if (this.item.type === "gear") return this.item.parent != null;
    return false;
  }

  _fitLimitedDisplayToContent() {
    const fit = () => requestAnimationFrame(() => {
      const limited = this.element.querySelector(".limited-display");
      if (!limited) return;

      const windowContent = this.element.querySelector(".window-content");
      if (!windowContent) return;
      const itemCard = limited.querySelector(".item-card") ?? limited;

      const elementRect = this.element.getBoundingClientRect();
      const contentRect = windowContent.getBoundingClientRect();
      const horizontalChrome = Math.max(0, Math.ceil(elementRect.width - contentRect.width));
      const verticalChrome = Math.max(0, Math.ceil(elementRect.height - contentRect.height));

      const cardRect = itemCard.getBoundingClientRect();
      const contentWidth = Math.ceil(cardRect.width);
      const contentHeight = Math.ceil(cardRect.height);

      const defaultWidth = Number(this.constructor.DEFAULT_OPTIONS?.position?.width) || 520;
      const viewportWidth = Math.max(280, window.innerWidth - 24);
      const maxWidth = Math.min(defaultWidth, viewportWidth);
      const maxHeight = Math.max(260, window.innerHeight - 24);

      const targetWidth = Math.min(maxWidth, contentWidth + horizontalChrome + 8);
      const baseHeight = Math.min(maxHeight, contentHeight + verticalChrome + 4);
      this.setPosition({ width: targetWidth, height: baseHeight });

      requestAnimationFrame(() => {
        const liveContentRect = windowContent.getBoundingClientRect();
        const liveCardRect = itemCard.getBoundingClientRect();
        const cardOverflow = Math.ceil(liveCardRect.bottom - liveContentRect.bottom);
        const actionEl = limited.querySelector(".item-roll-button") ?? limited.querySelector(".quantity-form");
        const actionRect = actionEl?.getBoundingClientRect();
        const actionOverflow = actionRect ? Math.ceil(actionRect.bottom - liveContentRect.bottom) : 0;
        const overflow = Math.max(cardOverflow, actionOverflow);

        if (overflow > 0) {
          const correctedHeight = Math.min(maxHeight, baseHeight + overflow + 8);
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

  setPosition(position={}) {
    if (this._isLimitedDisplayMode()) {
      const defaultWidth = Number(this.constructor.DEFAULT_OPTIONS?.position?.width) || 520;
      const viewportWidth = Math.max(280, window.innerWidth - 24);
      const maxWidth = Math.min(defaultWidth, viewportWidth);
      const maxHeight = Math.max(260, window.innerHeight - 24);
      if (Number.isFinite(position.width)) position.width = Math.min(position.width, maxWidth);
      if (Number.isFinite(position.height)) position.height = Math.min(position.height, maxHeight);
    }
    return super.setPosition(position);
  }

  _activateJobDropZone() {
    this._jobDropController?.abort();
    if (this.item.type !== "job" || !this.document.isOwner) return;

    const dropZone = this.element.querySelector(".job-progression-tab");
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
      this._onDropJobAbility(event);
    }, { signal });
  }

  _onPickItemIcon(event) {
    event.preventDefault();
    event.stopPropagation();

    const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
    new FilePickerImpl({
      type: "imagevideo",
      current: this.item.img,
      callback: path => this.item.update({ img: path })
    }).render(true);
  }

  _getDropData(event) {
    const dataTransfer = event.originalEvent?.dataTransfer || event.dataTransfer;
    if (!dataTransfer) return {};

    const formats = ["text/plain", "application/json", "text/json"];
    for (const format of formats) {
      const raw = dataTransfer.getData(format);
      if (!raw) continue;
      try {
        return JSON.parse(raw);
      } catch (_err) {
        if (raw.includes(".") || raw.length > 12) return { uuid: raw };
      }
    }

    return {};
  }

  _normalizeJobAbilityGrants(grants) {
    if (Array.isArray(grants)) return foundry.utils.deepClone(grants);
    if (grants && typeof grants === "object") return foundry.utils.deepClone(Object.values(grants));
    return [];
  }

  _getJobAbilityGrants() {
    return this._normalizeJobAbilityGrants(this.item.system.ability_grants);
  }

  _getJobGrantTypeLabel(type) {
    const label = game.i18n.localize(`FFXIV.ItemType.${type}`);
    return label.replace(/\s+Ability$/i, "");
  }

  async _getJobGrantItemData(grant) {
    if (grant.item) return foundry.utils.deepClone(grant.item);

    const sourceItem = grant.uuid ? await fromUuid(grant.uuid) : null;
    if (!sourceItem) return null;

    const itemData = sourceItem.toObject();
    delete itemData._id;
    return itemData;
  }

  async _onEditJobAbility(event) {
    event.preventDefault();
    event.stopPropagation();

    const index = Number(event.currentTarget.dataset.index);
    const grants = this._getJobAbilityGrants();
    const grant = grants[index];
    if (!grant) return;

    const itemData = await this._getJobGrantItemData(grant);
    if (!itemData) {
      ui.notifications.warn("Could not find the mapped item to edit.");
      return;
    }

    const tempItem = new CONFIG.Item.documentClass(itemData, { temporary: true });
    const persistGrant = async changes => {
      const update = foundry.utils.expandObject(changes);
      const nextData = foundry.utils.mergeObject(foundry.utils.deepClone(itemData), update, {
        inplace: false,
        overwrite: true
      });
      delete nextData._id;

      grants[index] = {
        ...grants[index],
        name: nextData.name,
        type: nextData.type,
        item: nextData
      };
      await this.item.update({ "system.ability_grants": grants }, { render: false });

      foundry.utils.mergeObject(itemData, nextData, { inplace: true, overwrite: true });
      tempItem.updateSource(update);
      this.render({ force: true });
      return tempItem;
    };

    tempItem.update = persistGrant;
    tempItem.sheet.render({ force: true });
  }

  async _onDropJobAbility(event) {
    event.preventDefault();
    event.stopPropagation();

    const data = this._getDropData(event);
    let item = data.uuid ? await fromUuid(data.uuid) : null;
    if (!item && typeof Item.implementation.fromDropData === "function") {
      item = await Item.implementation.fromDropData(data);
    }
    const validTypes = ["primary_ability", "secondary_ability", "instant_ability", "limit_break", "trait"];
    if (!item || !validTypes.includes(item.type)) {
      ui.notifications.warn("Drop an ability, limit break, or trait item onto the job ability list.");
      return;
    }

    const grants = this._getJobAbilityGrants();
    if (grants.some(grant => grant.uuid === item.uuid)) return;
    const itemData = item.toObject();
    delete itemData._id;
    grants.push({
      uuid: item.uuid,
      name: item.name,
      type: item.type,
      item: itemData
    });
    await this.item.update({ "system.ability_grants": grants }, { render: false });
    this.render({ force: true });
  }
}
