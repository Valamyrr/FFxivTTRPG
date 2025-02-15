import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class FfxivActorSheet extends ActorSheet {
  /** @override */
  constructor(...args) {
    super(...args);
    this.hidingSidebar = false;
    this.currentAbilityTab = "primary";
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['ffxiv', 'sheet', 'actor', CONFIG.theme+'_theme'],
      width: 780,
      height: 700,
      tabs: [
        {
          navSelector: '.sheet-tabs',
          contentSelector: '.sheet-body',
          initial: 'fight',
        },
      ],
    });
  }

  /** @override */
  get template() {
    const actorType = this.actor?.type || "simple";
    return `systems/ffxiv/templates/actor/actor-${this.actor.type}-sheet.hbs`;
  }
  /** @override */
  render(force, options) {
    super.render(force, options);
    this._applySidebarPreference();

    if(this.actor.type == "character"){
      Hooks.once('renderActorSheet', () => {
        this._updateManaBar();
        this._updateHealthBar();
        if(game.settings.get('ffxiv', 'toggleExperience')){
          this._updateExperienceBar();
        }
        this._applyStoredAbilityTab();
      });
    };
  }

  /* -------------------------------------------- */

  /** @override */
  async getData() {
    // Retrieve the data structure from the base sheet. You can inspect or log
    // the context variable to see the structure, but some key properties for
    // sheets are the actor object, the data object, whether or not it's
    // editable, the items array, and the effects array.
    const context = super.getData();

    // Use a safe clone of the actor data for further operations.
    const actorData = this.document.toObject(false);

    // Add the actor's data to context.data for easier access, as well as flags.
    context.system = actorData.system;
    context.flags = actorData.flags;

    // Adding a pointer to CONFIG.FF_XIV
    context.config = CONFIG.FF_XIV;

    context.settings = {
      "showExperience": game.settings.get('ffxiv','toggleExperience')
    }

    // Prepare character data and items.
    if (actorData.type == 'character') {
      this._prepareItems(context);
      this._prepareSharedData(context);
      this._prepareCharacterData(context);
    }

    // Prepare NPC data and items.
    if (actorData.type == 'simple') {
      this._prepareItems(context);
      this._prepareSharedData(context);
    }

    // Enrich biography info for display
    // Enrichment turns text like `[[/r 1d20]]` into buttons
    context.enrichedBiography = await TextEditor.enrichHTML(
      this.actor.system.biography,
      {
        // Whether to show secret blocks in the finished html
        secrets: this.document.isOwner,
        // Necessary in v11, can be removed in v12
        async: true,
        // Data to fill in for inline rolls
        rollData: this.actor.getRollData(),
        // Relative UUID resolution
        relativeTo: this.actor,
      }
    );

    // Prepare active effects
    context.effects = prepareActiveEffectCategories(
      // A generator that returns all effects stored on the actor
      // as well as any items
      this.actor.allApplicableEffects()
    );

    context.hidingSidebar = this.hidingSidebar;

    return context;
  }

  /**
   * Non-specific context modifications
   *
   * @param {object} context The context object to mutate
   */
  _prepareSharedData(context) {

  }

  /**
   * Character-specific context modifications
   *
   * @param {object} context The context object to mutate
   */
  _prepareCharacterData(context) {

  }




  /**
   * Organize and classify Items for Actor sheets.
   *
   * @param {object} context The context object to mutate
   */
  _prepareItems(context) {
    // Initialize containers.
    const consumables = [];
    const primary_abilities = [];
    const secondary_abilities = [];
    const instant_abilities = [];
    const limit_break = [];
    const currency = [];
    const traits = [];

    for (let i of context.items) {
      /*
      if (['instant_ability','secondary_ability','primary_ability'].indexOf(i.type)){
        if (!Array.isArray(i.system.limitation_status) || i.limitation_status.length !== data.limitation_max) {
          i.limitation_status = Array(i.limitation_max).fill(false);
        }
      }*/

      i.img = i.img || Item.DEFAULT_ICON;

      if (i.type === 'consumables') {
        consumables.push(i);
      }
      if (i.type === 'primary_ability') {
        primary_abilities.push(i);
      }
      if (i.type === 'secondary_ability') {
        secondary_abilities.push(i);
      }
      if (i.type === 'instant_ability') {
        instant_abilities.push(i);
      }
      if (i.type === 'limit_break') {
        limit_break.push(i);
      }
      if (i.type === 'currency') {
        currency.push(i);
      }
      if (i.type === 'traits') {
        traits.push(i);
      }

    }

    // Assign and return
    context.consumables = consumables;
    context.primary_abilities = primary_abilities;
    context.secondary_abilities = secondary_abilities;
    context.instant_abilities = instant_abilities;
    context.limit_break = limit_break;
    context.currency = currency;
    context.traits = traits;
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Render the item sheet for viewing/editing prior to the editable check.
    html.on('click', '.item-edit', (ev) => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data('itemId'));
      item.sheet.render(true);
    });

    // -------------------------------------------------------------
    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;

    // Add Inventory Item
    html.on('click', '.item-create', this._onItemCreate.bind(this));

    // Delete Inventory Item
    html.on('click', '.item-delete', (ev) => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.items.get(li.data('itemId'));
      item.delete();
      li.slideUp(200, () => this.render(false));
    });

    // Active Effect management
    html.on('click', '.effect-control', (ev) => {
      const row = ev.currentTarget.closest('li');
      const document =
        row.dataset.parentId === this.actor.id
          ? this.actor
          : this.actor.items.get(row.dataset.parentId);
      onManageActiveEffect(ev, document);
    });

    // Rollable abilities.
    html.on('click', '.rollable', this._onRoll.bind(this));

    // Drag events for macros.
    if (this.actor.isOwner) {
      let handler = (ev) => this._onDragStart(ev);
      html.find('li.item').each((i, li) => {
        if (li.classList.contains('inventory-header')) return;
        li.setAttribute('draggable', true);
        li.addEventListener('dragstart', handler, false);
      });
    }

    /*Size for different actor types*//*
    if(this.actor.type == "npc"){
      console.log("test")
      Hooks.once("renderActorSheet", (app, html, data) => {
        this.setPosition({ width: 430, height: 725 });
        console.log("render")
      });
    }*/


    html.on('click', '.inventory-item', this._renderItem.bind(this));

    html.on('click', '.abilities-sub-tabs .sub-tab', this._displayAbilityTab.bind(this))

    html.on('mousedown', '.mana-bar', this._onClickManaBar.bind(this));

    html.on('change', '.currency-quantity', this._updateCurrency.bind(this));

    html.on('click', '.ability-icon', this._renderItem.bind(this));
    html.on('click', '.ability-roll-button', this._rollItem.bind(this));

    html.on('click', '.arrow-sidebar', this._toggleSidebar.bind(this))

    html.on('change', '.ability-limitations .limitation', this._onChangeLimitations.bind(this))

    html.on('change', '.ability-limitations .active', this._onChangeActiveTrait.bind(this))

    html.on('click', '.actor-titles .title-delete', this._onDeleteTitle.bind(this))

    html.on('click', '.move-up', this._moveAbility.bind(this, -1));
    html.on('click', '.move-down', this._moveAbility.bind(this, 1))

  }

  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
   * @param {Event} event   The originating click event
   * @private
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    // Get the type of item to create.
    const type = header.dataset.type;
    // Grab any data associated with this control.
    const data = duplicate(header.dataset);
    // Initialize a default name.
    const name = `New ${type.capitalize()}`;
    // Prepare the item object.
    const itemData = {
      name: name,
      type: type,
      system: data,
    };
    // Remove the type from the dataset since it's in the itemData.type prop.
    delete itemData.system['type'];

    // Finally, create the item!
    return await Item.create(itemData, { parent: this.actor });
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

  async _renderItemSimple(event) {
    const itemId = event.currentTarget.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) {
      // Render the custom template
      const simplifiedHtml = await renderTemplate("systems/ffxiv/templates/item/item-sheet-dialog.hbs", item);

      // Create a pop-up or modal to show the simplified template
      const dialog = new Dialog({
        title: item.name,
        content: simplifiedHtml,
        buttons: {},
        render: (html) => {
          html.find('.quantity-control.up').on('click', async () => {
            const newQuantity = item.system.quantity + 1;
            await item.update({ 'system.quantity': newQuantity });
            this._refreshDialogContent(dialog, item);
          });

          // Handle quantity decrease
          html.find('.quantity-control.down').on('click', async () => {
            const newQuantity = Math.max(1, item.system.quantity - 1);
            await item.update({ 'system.quantity': newQuantity });
            this._refreshDialogContent(dialog, item);
          });


          html.find('.delete-item-btn').on('click', async () => {
            const confirmDelete = confirm(`Are you sure you want to delete ${item.name}?`);
            if (confirmDelete) {
              await item.delete();
              ui.notifications.info(`${item.name} has been deleted.`);
              dialog.close();
            }
          });
        }
      });

      dialog.render(true);
    }
  };

  async _rollItem(event){
    const itemId = event.currentTarget.dataset.itemId
    const item = this.actor.items.get(itemId);
    if(item){
      ChatMessage.create({
        content: await renderTemplate("systems/ffxiv/templates/chat/ability-chat-card.hbs", { item: item }),
        flags: { core: { canParseHTML: true } },
        flavor: game.i18n.format("FFXIV.ItemType."+item.type)
      });
      console.log(item)
      item.roll(event);
    }else{
      console.error("Roll Error : No item found.")
      console.error(event.currentTarget)
    }

  }

  async _renderItem(event){
    const itemId = event.currentTarget.dataset.itemId
    const item = this.actor.items.get(itemId);

    if (item) {
      item.sheet.render(true);
    } else {
      console.error(`Item with ID ${itemId} not found. Cannot open empty inventory cells.`);
    }
  };

  async _refreshDialogContent(dialog, item) {
    const newHtml = await renderTemplate("systems/ffxiv/templates/item/item-sheet-dialog.hbs", item);
    dialog.data.content = newHtml;
    dialog.render(true);
  };


  _updateManaBar() {
      const currentMana = this.actor.system.mana.value;
      const characterSheet = document.getElementById(`FfxivActorSheet-Actor-${this.actor._id}`);

      if (characterSheet) {
          const manaBarSlots = characterSheet.querySelectorAll('.mana-slot');
          // Update each slot based on the current mana value
          manaBarSlots.forEach((slot, index) => {
              if (index < currentMana) {
                  slot.classList.add('mana-filled');
              } else {
                  slot.classList.remove('mana-filled');
              }
          });
      }
  }
  _onClickManaBar(event) {
    let currentMana = this.actor.system.mana.value;

    if (event.which === 1) {
        currentMana = Math.max(0, currentMana - 1);
    } else if (event.which === 3) {
      event.preventDefault()
      currentMana = Math.min(5, currentMana + 1);
    }

    this.actor.update({ "system.mana.value": currentMana });
    this._updateManaBar()

  }

  _updateHealthBar() {
    const currentHealth = this.actor.system.health.value;
    const maxHealth = this.actor.system.health.max;
    const characterSheet = document.getElementById(`FfxivActorSheet-Actor-${this.actor._id}`);
    const healthPercentage = Math.min(100,Math.max(0,(currentHealth / maxHealth) * 100));
    if (characterSheet) {

      const healthBar = characterSheet.querySelectorAll('.health-bar');
      if(healthBar.length > 0){
        healthBar[0].style.width = `${healthPercentage}%`
        if (healthPercentage >= 70) {
          healthBar[0].classList.add('health-good')
        } else if (healthPercentage >= 30) {
          healthBar[0].classList.add('health-bad')
        } else {
          healthBar[0].classList.add('health-danger')
        }
      }
    }
  }

  _updateCurrency(event){
    const itemId = event.currentTarget.dataset.itemId;
    const newQuantity = event.currentTarget.value;
    const item = this.actor.items.get(itemId);

    if (item) {
      if (newQuantity < 0){
        let confirmDelete = confirm(game.i18n.format("FFXIV.Dialogs.ItemDelete", {itemName: item.name}));
        if (confirmDelete) {
          item.delete();
          ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", {itemName: item.name}));
        }
      } else {
          item.update({ 'system.quantity': newQuantity });
      }
    }
  }

  _updateExperienceBar(){
    const characterSheet = document.getElementById(`FfxivActorSheet-Actor-${this.actor._id}`);
    const experiencePercentage = Math.min(100,Math.max(0,100 * this.actor.system.experience.experience.value / CONFIG.LEVELS[this.actor.system.experience.level.value]["experience"]))
    if (characterSheet) {
      const experienceBar = characterSheet.querySelectorAll('.experience-bar');
      if(experienceBar.length > 0){
        experienceBar[0].style.width = `${experiencePercentage}%`
      }
    }
  }

  _displayAbilityTab(event){
    const tab = $(event.currentTarget).data('tab');
    this.currentAbilityTab = tab
    this._switchAbilityTab(tab)
  }
  _applyStoredAbilityTab() {
    const tab = this.currentAbilityTab || 'primary';  // Default to primary if no tab is stored
    this._switchAbilityTab(tab)
  }
  _switchAbilityTab(tab){
    $(`#FfxivActorSheet-Actor-${this.actor._id} .abilities-sub-tabs .sub-tab`).removeClass("active");
    $(`#FfxivActorSheet-Actor-${this.actor._id} .sub-tab-content`).removeClass('active').hide();
    $(`#FfxivActorSheet-Actor-${this.actor._id} .abilities-sub-tabs .sub-tab[data-tab=${tab}]`).addClass("active");
    $(`#FfxivActorSheet-Actor-${this.actor._id} .sub-tab-content[data-tab=${tab}]`).addClass('active').show();
  }

  _toggleSidebar(event){
    this.hidingSidebar = !this.hidingSidebar
    this._applySidebarPreference()
  }
  _applySidebarPreference(){
    const wrapper = $(`#FfxivActorSheet-Actor-${this.actor._id} .sheet-body-wrapper`);
    const arrow = $(`#FfxivActorSheet-Actor-${this.actor._id} .arrow-sidebar .fa`);
    if (this.hidingSidebar) {
        wrapper.addClass("full-width");
        arrow.removeClass("fa-left").addClass("fa-right");
    } else {
        wrapper.removeClass("full-width");
        arrow.removeClass("fa-right").addClass("fa-left");
    }
  }

  _onChangeLimitations(event){
    const checkbox = event.currentTarget
    const index = parseInt(checkbox.dataset.index, 10);
    const itemId = checkbox.dataset.itemId;

    const item = this.actor.items.get(itemId)


    if (item.system.limitations_status){
      var limitations_status = item.system.limitations_status.slice(0, item.system.limitations_max);
    }else{
      var limitations_status = new Array(item.system.limitations_max).fill(false)
    }
    limitations_status[index] = checkbox.checked;

    item.update({ 'system.limitations_status': limitations_status });

  }

  _onChangeActiveTrait(event){
    console.log("test")
    const checkbox = event.currentTarget
    const itemId = checkbox.dataset.itemId;

    const item = this.actor.items.get(itemId)

    item.update({ 'system.active':  checkbox.checked});
  }

  _onDeleteTitle(event){
    if(confirm(game.i18n.localize("FFXIV.Confirm"))){
      const button = event.currentTarget
      const itemId = button.dataset.itemId
      const item = this.actor.items.get(itemId)
      item.delete();
      ui.notifications.info(`Item with ID ${itemId} has been removed.`);
    }
  }

  async _moveAbility(direction, event){
    const actor = this.actor;
    const abilityType = event.currentTarget.dataset.type;
    const itemId = event.currentTarget.dataset.itemId;
    if (!actor || !abilityType || !itemId || !direction) return;

    let abilityOrder = foundry.utils.deepClone(actor.system.ability_order || {});
    if (!abilityOrder[abilityType]) abilityOrder[abilityType] = [];

    const allAbilities = actor.items.filter(i => i.type === abilityType).map(i => i.id);

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
    await actor.update({ "system.ability_order": abilityOrder });
  }


}
