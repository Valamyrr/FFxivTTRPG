import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';

import PopoutEditor from "../popout-editor.js";

/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {ItemSheet}
 */
export class FfxivItemSheet extends ItemSheet {
  /** @override */
  static get defaultOptions() {
    let options = foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['ffxiv', 'sheet', 'item',  CONFIG.theme+'_theme'],
      width: 520,
      height: 480,
      tabs: [
        {
          navSelector: '.sheet-tabs',
          contentSelector: '.sheet-body',
          initial: 'description',
        },
      ]
    });

    return options;
  }

  /** @override */
  get template() {
    const path = 'systems/ffxiv/templates/item';

    // Return a single sheet for all item types.
    // return `${path}/item-sheet.hbs`;

    // Alternatively, you could use the following return statement to do a
    // unique item sheet by type, like `weapon-sheet.hbs`.
    if (this.item.type == "consumable"){
      if (game.settings.get('ffxiv', 'limitedPhysicalItemsDialog') && this.item.parent != null){
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
  async getData() {
    // Retrieve base data structure.
    const context = super.getData();

    // Use a safe clone of the item data for further operations.
    const itemData = this.document.toObject(false);

    const fieldsToEnrich = {
        description: this.item.system.description || "",
        traits: this.item.system.traits || "", // Add other fields here
    };

    // Enrich each field separately
    for (const [key, value] of Object.entries(fieldsToEnrich)) {
        context[`enriched${key.charAt(0).toUpperCase() + key.slice(1)}`] =
            await TextEditor.enrichHTML(value, {
                secrets: this.document.isOwner,
                async: true,
                rollData: this.item.getRollData(),
                relativeTo: this.item,
            });
    }

    context.settings = {
      "useRarity": game.settings.get('ffxiv','useRarity'),
      "jobsAbbrv": game.settings.get('ffxiv','jobsAbbrv')
    }

    // Add the item's data to context.data for easier access, as well as flags.
    context.system = itemData.system;
    context.flags = itemData.flags;

    // Adding a pointer to CONFIG.FF_XIV
    context.config = CONFIG.FF_XIV;
    context.statusEffects = CONFIG.statusEffects
    // Prepare active effects for easier access
    context.effects = prepareActiveEffectCategories(this.item.effects);
    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  render(force, options={}) {
    super.render(force, options);
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);


    Hooks.once("renderItemSheet", (app, html, data) => {
      this.setPosition({ height: $(html).find('.limited-display').height() + 30 });
      const limitedDisplay = game.settings.get('ffxiv', 'limitedPhysicalItemsDialog') && this.item.parent != null;
      if(this.item.type=="gear" && limitedDisplay) this.setPosition({ width: 340 });
    });

    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;

    // hidden here instead of css to prevent non-editable display of edit button
    html.find(".popout-editor").on("mouseover", (event) => {
      $(event.currentTarget).find(".popout-editor-button").show();
    });
    html.find(".popout-editor").on("mouseout", (event) => {
      $(event.currentTarget).find(".popout-editor-button").hide();
    });
    html.find(".popout-editor .popout-editor-button").on("click", this._onPopoutEditor.bind(this));


    //Tags
    html.on('change', '.select-tags', (event) => {
      const index = $(event.currentTarget).closest('li').index(); // Find the index of the current item
      const value = $(event.currentTarget).val(); // Get the selected value
      const tags = this.item.system.tags || []; // Ensure tags is initialized
      tags[index] = value; // Update the correct index in the array
      this.item.update({ "system.tags": tags }); // Update the item with the new tags array
    });
    html.on('click', '.remove-tag', (event) => {
      const index = event.currentTarget.dataset.index;
      const tags = this.item.system.tags || [];
      tags.splice(index, 1); // Remove the tag at the specified index
      this.item.update({ "system.tags": tags });
      this.render(); // Re-render to show the updated fields
    });
    html.on('click', '.add-tag', () => {
      const tags = this.item.system.tags || [];
      if(this.item.type == "trait"){
        tags.push("FFXIV.Tags.Default")
      }else{
        tags.push("FFXIV.Tags.Default")
      };
      this.item.update({ "system.tags": tags });
      this.render(); // Re-render to show the new field
    });

    //Gear Classes, similar as tags
    if(this.item.type=="gear"){
      html.on('change', '.select-classes', (event) => {
        const index = $(event.currentTarget).closest('li').index();
        const value = $(event.currentTarget).val();
        const classes = this.item.system.classes || [];
        classes[index] = value;
        this.item.update({ "system.classes": classes });
      });
      html.on('click', '.remove-class', (event) => {
        const index = event.currentTarget.dataset.index;
        const classes = this.item.system.classes || [];
        classes.splice(index, 1);
        this.item.update({ "system.classes": classes });
        this.render();
      });
      html.on('click', '.add-class', () => {
        const classes = this.item.system.classes || [];
        classes.push("FFXIV.Classes.WarriorShort");
        this.item.update({ "system.classes": classes });
        this.render();
      });
    }



    // Modifiers, similar as tags
    html.on('change', '.modifier-name', (event) => {
      const index = event.currentTarget.dataset.index;
      const value = event.currentTarget.value;
      const modifiers = this.item.system.modifiers || [];
      if (modifiers[index]) {
        modifiers[index][0] = value; // Update name
        this.item.update({ "system.modifiers": modifiers });
      }
    });
    html.on('change', '.modifier-value', (event) => {
      const index = event.currentTarget.dataset.index;
      const value = parseInt(event.currentTarget.value) || 0;
      const modifiers = this.item.system.modifiers || [];
      if (modifiers[index]) {
        modifiers[index][1] = value; // Update value
        this.item.update({ "system.modifiers": modifiers });
      }
    });
    html.on('click', '.add-modifier', () => {
      const modifiers = this.item.system.modifiers || [];
      modifiers.push(["FFXIV.Attributes.Strength.long", 0]);
      this.item.update({ "system.modifiers": modifiers });
    });
    html.on('click', '.remove-modifier', (event) => {
      const index = event.currentTarget.dataset.index;
      const modifiers = this.item.system.modifiers || [];
      modifiers.splice(index, 1);
      this.item.update({ "system.modifiers": modifiers });
      this.render();
    });





    html.on('click', '.item-delete', this._deleteItem.bind(this));
    html.on('click', '.quantity-form .delete', this._deleteItem.bind(this));
    html.on('click', '.quantity-form .item-qty-btn-rm', this._decreaseQuantity.bind(this));
    html.on('click', '.quantity-form .item-qty-btn-add', this._increaseQuantity.bind(this));
    html.on('click', '.item-qty-btn.gear-equip', this._toggleEquip.bind(this))

    html.on('click', '.item-roll-button', this._rollItem.bind(this));

    html.on("keydown", (event) => {
      if (event.key === "Enter") {
          event.preventDefault(); // Prevent the Enter key from triggering the button
      }
    });

  }

  async _rollItem(event){
    if (this.item.type=="gear"){
      var templatePath = "systems/ffxiv/templates/chat/gear-chat-card.hbs"
    }else {
      var templatePath = "systems/ffxiv/templates/chat/item-chat-card.hbs"
    }
    ChatMessage.create({
      content: await renderTemplate(templatePath, { item: this.item, useRarity: game.settings.get('ffxiv','useRarity')}),
      flags: { core: { canParseHTML: true } },
      flavor: game.i18n.format("FFXIV.ItemType."+this.item.type)
    });
    this.item.roll(event);
  }

  _decreaseQuantity(event){
    const newQuantity = this.item.system.quantity - 1;
      if (newQuantity < 1){
        this._deleteItem(event)
        if(game.settings.get('ffxiv', 'soundNotificationFFxiv') && game.settings.get('ffxiv', 'soundNotificationFFxiv_deleteItem')){
          foundry.audio.AudioHelper.play({
            src: game.settings.get('ffxiv', 'soundNotificationFFxiv_deleteItem'),
            volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
            autoplay: true,
            loop: false
          });
        }
      } else {
          this.item.update({ 'system.quantity': newQuantity });
      }
  }
  _increaseQuantity(event){
    this.item.update({ 'system.quantity': this.item.system.quantity + 1 });
  }

  _deleteItem(event) {
    Dialog.confirm({
      title: game.i18n.format("FFXIV.Dialogs.DialogTitleConfirmation"),
      content: game.i18n.format("FFXIV.Dialogs.ItemDelete", {itemName: this.item.name}),
      yes: () => {
        ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", {itemName: this.item.name}));
        this.item.delete();
        this.render(false)
      },
      no: () => {},
      defaultYes: false
    });
  }

  _toggleEquip(event) {
    let actor = game.actors.get(this.item.parent._id);

    // Ensure equippedGear is initialized with category keys, not localized labels
    let equippedGear = actor.system.equippedGear || Object.fromEntries(
      Object.keys(CONFIG.FF_XIV.gear_subcategories).map(k => [k, ""])
    );

    console.log("Before:", equippedGear);

    // Find the category key corresponding to this item's category (localized label)
    let categoryKey = Object.keys(CONFIG.FF_XIV.gear_subcategories).find(
      key => CONFIG.FF_XIV.gear_subcategories[key].label === this.item.system.category
    );

    if (!categoryKey) {
      console.error(`Category not found for ${this.item.system.category}`);
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

    console.log("After:", equippedGear);
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

    const title = a.dataset.label ? `Editor for ${this.object.name}: ${label}` : `Editor for ${this.object.name}`;

    new PopoutEditor(this.object, {
      name: key,
      title: title,
      height: windowHeight,
      width: windowWidth,
      left: windowLeft,
      top: windowTop,
    }).render(true);
  }
}
