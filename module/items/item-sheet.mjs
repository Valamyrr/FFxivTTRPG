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
    return `${path}/item-sheet.hbs`;
  }

  /* -------------------------------------------- */

  /** @override */
  async getData() {
    // Retrieve base data structure.
    const context = super.getData();

    // Use a safe clone of the item data for further operations.
    const itemData = this.document.toObject(false);

    // Enrich description info for display
    // Enrichment turns text like `[[/r 1d20]]` into buttons
    context.enrichedDescription = await TextEditor.enrichHTML(
      this.item.system.description,
      {
        // Whether to show secret blocks in the finished html
        secrets: this.document.isOwner,
        // Necessary in v11, can be removed in v12
        async: true,
        // Data to fill in for inline rolls
        rollData: this.item.getRollData(),
        // Relative UUID resolution
        relativeTo: this.item,
      }
    );

    // Add the item's data to context.data for easier access, as well as flags.
    context.system = itemData.system;
    context.flags = itemData.flags;

    // Adding a pointer to CONFIG.FF_XIV
    context.config = CONFIG.FF_XIV;
    // Prepare active effects for easier access
    context.effects = prepareActiveEffectCategories(this.item.effects);

    return context;
  }

  /* -------------------------------------------- */


  /** @override */
  activateListeners(html) {
    super.activateListeners(html);


    Hooks.once("renderItemSheet", (app, html, data) => {
      this.setPosition({ height: $(html).find('.limited-display').height() + 30 });
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

    // Active Effect management
    html.find('.inventory-item, .empty-slot').on('drop', async event => {
      event.preventDefault();

      const targetPosition = event.currentTarget.dataset.itemPosition;
      const targetItemId = event.currentTarget.dataset.itemId;

      const draggedItemData = actor.items.get(draggedItem.id);

      if (targetItemId) {
        // Swap items if dropping on another item
        const targetItemData = actor.items.get(targetItemId);
        await draggedItemData.update({ 'system.position': targetPosition });
        await targetItemData.update({ 'system.position': draggedItem.position });
      } else {
        // Move item to an empty slot
        await draggedItemData.update({ 'system.position': targetPosition });
      }

      // Re-render the inventory after moving
      app.render();
    });

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
      tags.push("FFXIV.Tags.Primary"); // Add an empty tag
      this.item.update({ "system.tags": tags });
      this.render(); // Re-render to show the new field
    });



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

    html.on('click', '.item-roll-button', this._rollItem.bind(this));

    html.on("keydown", (event) => {
      if (event.key === "Enter") {
          event.preventDefault(); // Prevent the Enter key from triggering the button
      }
    });

  }

  async _rollItem(event){
    ChatMessage.create({
      content: await renderTemplate("systems/ffxiv/templates/chat/item-chat-card.hbs", { item: this.item }),
      flags: { core: { canParseHTML: true } },
      flavor: game.i18n.format("FFXIV.ItemType."+this.item.type)
    });
    this.item.roll(event);
  }

  _decreaseQuantity(event){
    const newQuantity = this.item.system.quantity - 1;
      if (newQuantity < 1){
        this._deleteItem(event)
      } else {
          this.item.update({ 'system.quantity': newQuantity });
      }
  }
  _increaseQuantity(event){
    this.item.update({ 'system.quantity': this.item.system.quantity + 1 });
  }

  _deleteItem(event) {
    if(confirm(game.i18n.format("FFXIV.Dialogs.ItemDelete", {itemName: this.item.name}))){
      this.item.delete();
      ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", {itemName: this.item.name}));
      if(game.settings.get('ffxiv', 'soundNotificationFFxiv')){
        foundry.audio.AudioHelper.play({
            src: "systems/ffxiv/assets/sounds/delete_item.wav", // Ensure this path is valid
            volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
            autoplay: true,
            loop: false
        });
      }
      this.render(false);
    }
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
