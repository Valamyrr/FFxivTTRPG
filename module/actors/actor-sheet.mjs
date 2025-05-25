import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class FfxivActorSheet extends foundry.appv1.sheets.ActorSheet {
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
      height: 735,
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

    let characterSheet;
    if (this.token){
      if(!this.token.actorLink){ //If no actor data linked but token sheet is used
          characterSheet =  `FfxivActorSheet-Scene-${this.token.parent.id}-Token-${this.token.id}-Actor-${this.actor.id}`;
      }
    }
    if(!characterSheet){
       characterSheet = `FfxivActorSheet-Actor-${this.actor._id}`;
    }
    this.characterSheet = characterSheet

    this._applySidebarPreference();

    // Set up UI elements for characters only
    if(this.actor.type == "character"){
      Hooks.once('renderActorSheet', () => {
        this._updateManaBar();
        this._updateHealthBar();
        this._applyStoredAbilityTab();
        this._applyStoredCompanionTab();
      });
    };
  }

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
      "useRarity": game.settings.get('ffxiv','useRarity'),
      "showGear": game.settings.get('ffxiv','toggleGear'),
      "attributesImg": game.settings.get('ffxiv','attributesImg'),
      "tabHue": game.settings.get('ffxiv','hueTabsIcons'),
      "attributesImgSpeed": game.settings.get("ffxiv", "attributesImgSpeed")
    }

    // Prepare character data and items.
    if (actorData.type === 'character') {
      this._prepareItems(context);
      this._prepareSharedData(context);
      this._prepareCharacterData(context);

      // Enrich and inject pet data
      const petIds = actorData.system.pets || [];
      context.pets = [];

      for (const id of petIds) {
        const pet = game.actors.get(id);
        if (!pet) continue;

        const petData = pet.toObject();
        petData.enriched = await this.constructor.enrichAllStrings(petData.system, this.actor.getRollData(), pet);
        //console.log(petData.system)

        for (const item of petData.items || []) {
          item.enriched = await this.constructor.enrichAllStrings(item.system, this.actor.getRollData(), item);
        }

        context.pets.push(petData);
      }
    }

    // Prepare NPC data and items.
    if (actorData.type === 'npc' || actorData.type === 'pet') {
      this._prepareItems(context);
      this._prepareSharedData(context);
    }

    // Enrich biography info for display
    // Enrichment turns text like `[[/r 1d20]]` into buttons
    context.enriched = await this.constructor.enrichAllStrings(this.actor.system, this.actor.getRollData(), this.actor);

    if (["character", "npc", "pet"].includes(actorData.type)) {
      for (const item of context.items) {
        item.enriched = await this.constructor.enrichAllStrings(item.system, this.actor.getRollData(), item);
      }
    }

    // Prepare active effects
    context.effects = prepareActiveEffectCategories(this.actor.allApplicableEffects());
    context.hidingSidebar = this.hidingSidebar;
    return context;
  }

  /**
   * Recursively enrich all string fields in an object.
   * @param {object} target The object to enrich
   * @param {object} rollData The roll data for inline rolls
   * @param {ClientDocument} relativeTo The document context
   * @returns {Promise<object>} A new object with enriched HTML strings
   */
  static async enrichAllStrings(target, rollData, relativeTo) {
    const enriched = {};

    for (const [key, value] of Object.entries(target)) {
      if (typeof value === "string") {
        const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
          value,
          {
            secrets: true,
            async: true,
            rollData,
            relativeTo,
          }
        );

        // Use enriched if it's different and not blank, else fallback to original
        enriched[key] = html?.trim() ? html : value;
      } else if (typeof value === "object" && value !== null) {
        enriched[key] = await this.enrichAllStrings(value, rollData, relativeTo);
      }
    }
    return enriched;
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
    context.rollData = this.actor.getRollData()

    let pets = this.actor.system.pets || [];
    const validIds = pets.filter(id => game.actors.get(id));
    if (validIds.length !== pets.length) {
      this.actor.update({ "system.pets": validIds });
      this.render(true)
    }
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
    console.log("Listeners activated for:", this.actor.name);

    if(this.actor.type=="pet") this.setPosition({ width: 500, height:735 });

    html.find("input, textarea").on("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
      }
    });

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

    if (this.actor.type=="pet") { //Pet ability's tags
      html.on('change', '.select-tags', (event) => {
        const index = $(event.currentTarget).closest('li').index();
        const value = $(event.currentTarget).val();
        const tags = this.actor.system.tags || [];
        tags[index] = value;
        this.actor.update({ "system.tags": tags });
      });
      html.on('click', '.remove-tag', (event) => {
        const index = event.currentTarget.dataset.index;
        const tags = this.actor.system.tags || [];
        tags.splice(index, 1);
        this.actor.update({ "system.tags": tags });
        this.render();
      });
      html.on('click', '.add-tag', () => {
        const tags = this.item.system.tags || [];

        const configMap = {
          primary_ability: "tags_abilities",
          secondary_ability: "tags_abilities",
          instant_ability: "tags_abilities",
          trait: "tags_traits",
          consumable: "tags_consumables"
        };

        const configKey = configMap[this.item.type];
        const tagPool = CONFIG.FF_XIV[configKey] || {};
        const defaultTag = Object.values(tagPool)[0]?.label || "";

        if (defaultTag) {
          tags.push(defaultTag);
          this.item.update({ "system.tags": tags });
          this.render();
        }
      });
    }
    
    if (this.actor.type=="npc") {
      // Scale NPC tokens based on size category.
      html.find('select[name="system.size.text"]').on("change", async (event) => {
        const SIZE_DIMENSIONS = {
          "Small": [1, 1],
          "Medium": [1, 1],
          "Large": [2, 2],
          "Huge": [3, 3],
          "Colossal": [4, 4]
        };

        const newSize = event.currentTarget.value;
        const [width, height] = SIZE_DIMENSIONS[newSize] || [1, 1];

        await this.actor.update({
          "prototypeToken.width": width,
          "prototypeToken.height": height
        });
      });
    }
		
    // Add linebreaks to rich text ability descriptions.
    // Since for whatever reason, it seems to hate including those when saving the descriptions.
    // Inserts a <br> tag after every <p> except the last.
    html.find(".ability-description p:not(:last-of-type)").each(function () {
      $(this).after("<br>");
    });


    html.on('click', '.inventory-item', this._renderItem.bind(this));


    html.on('mousedown', '.mana-bar', this._onClickManaBar.bind(this));

    html.on('change', '.currency-quantity', this._updateCurrency.bind(this));

    html.on('click', '.ability-icon', this._renderItem.bind(this));
    html.on('click', '.augment-icon', this._renderItem.bind(this));
    html.on('click', '.ability-roll-button', this._rollItem.bind(this));
    html.on('click', '.pet-ability-roll-button', this._rollPet.bind(this));

    html.on('click', '.roll-attribute', this._rollAttribute.bind(this));

    html.on('click', '.arrow-sidebar', this._toggleSidebar.bind(this))

    html.on('change', '.ability-limitations .limitation', this._onChangeLimitations.bind(this))

    html.on('change', '.ability-limitations .job_resource', this._onChangeJobResource.bind(this))

    html.on('change', '.ability-limitations .active', this._onChangeActiveTrait.bind(this))

    html.on('click', '.actor-titles .title-delete', this._onDeleteTitle.bind(this))

    html.on('click', '.move-up', this._moveAbility.bind(this, -1));
    html.on('click', '.move-down', this._moveAbility.bind(this, 1))
    html.on('click', '.pet-move-up', this._movePet.bind(this, -1));
    html.on('click', '.pet-move-down', this._movePet.bind(this, 1))
    html.on('click', '.pet-remove', this._removePet.bind(this))

    html.on('click', '.pet-name', this._openPet.bind(this))


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

  async _rollItem(event){
    const itemId = event.currentTarget.dataset.itemId
    const item = this.actor.items.get(itemId);
    if(item){
      if(item.system.hpcost){
        const currentHP = this.actor.system.health.value
        if(currentHP - item.system.hpcost < 1){
          ui.notifications.warning(game.i18n.localize("FFXIV.Notifications.NotEnoughHP"))
          return;
        }
        this.actor.update({"system.health.value": currentHP - item.system.hpcost})
      }
      item.roll(event);
    }else{
      console.error("Roll Error : No item found.")
      console.error(event.currentTarget)
    }

  }

  async _rollPet(event){
    const petId = event.currentTarget.dataset.petId
    const itemId = event.currentTarget.dataset.itemId
    const pet = game.actors.get(petId);
    const item = pet.items.get(itemId);
    if(pet && item){
      item.roll(event);
    }else{
      console.error("Roll Error : No pet found.")
      console.error(event.currentTarget)
    }
  }

  async _rollAttribute(event){
    const attribute = event.currentTarget.dataset.attribute
    if (!attribute) {
      ui.notifications.error("No attribute specified to roll for.");
      return;
    }
    this.actor._rollAttribute(attribute);
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
    const newHtml = await foundry.applications.handlebars.renderTemplate("systems/ffxiv/templates/item/item-sheet-dialog.hbs", item);
    dialog.data.content = newHtml;
    dialog.render(true);
  };


  _updateManaBar() {
      const currentMana = this.actor.system.mana.value;
      let cs = document.getElementById(this.characterSheet)
      if (cs) {
          const manaBarSlots = cs.querySelectorAll('.mana-slot');
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

    const healthPercentage = Math.min(100,Math.max(0,(currentHealth / maxHealth) * 100));
    let cs = document.getElementById(this.characterSheet);
    if (cs) {

      const healthBar = cs.querySelectorAll('.health-bar');
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
        Dialog.confirm({
          title: game.i18n.format("FFXIV.Dialogs.DialogTitleConfirmation"),
          content: game.i18n.format("FFXIV.Dialogs.ItemDelete", {itemName: item.name}),
          yes: () => {
            ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", {itemName: item.name}));
            item.delete();
            if(game.settings.get('ffxiv', 'soundNotificationFFxiv') && game.settings.get('ffxiv', 'soundNotificationFFxiv_deleteItem')){
              foundry.audio.AudioHelper.play({
                src: game.settings.get('ffxiv', 'soundNotificationFFxiv_deleteItem'),
                volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
                autoplay: true,
                loop: false
              });
            }
          },
          no: () => {},
          defaultYes: false
        });
      } else {
          item.update({ 'system.quantity': newQuantity });
      }
    }
  }

  _displayAbilityTab(event){
    const tab = $(event.currentTarget).data('tab');
    this.currentAbilityTab = tab
    this._switchAbilityTab(tab)
  }
  _displayCompanionTab(event){
    const tab = $(event.currentTarget).data('tab');
    this.currentCompanionTab = tab
    this._switchCompanionTab(tab)
  }
  _applyStoredAbilityTab() {
    const tab = this.currentAbilityTab || 'primary';  // Default to primary if no tab is stored
    this._switchAbilityTab(tab)
  }
  _applyStoredCompanionTab() {
    const tab = this.currentCompanionTab || 'minions';
    this._switchCompanionTab(tab)
  }
  _switchAbilityTab(tab){
    /*let characterSheet;
    if (this.token){
      if(!this.token.actorLink){ //If no actor data linked but token sheet is used
          characterSheet =  `FfxivActorSheet-Scene-${this.token.parent.id}-Token-${this.token.id}-Actor-${this.actor.id}`;
      }
    }
    if(!characterSheet){
      characterSheet = `FfxivActorSheet-Actor-${this.actor._id}`;
    }*/
    $(`#${this.characterSheet} .abilities-sub-tabs .sub-tab`).removeClass("active");
    $(`#${this.characterSheet} .sub-tab-content`).removeClass('active').hide();
    $(`#${this.characterSheet} .abilities-sub-tabs .sub-tab[data-tab=${tab}]`).addClass("active");
    $(`#${this.characterSheet} .sub-tab-content[data-tab=${tab}]`).addClass('active').show();
  }
  _switchCompanionTab(tab){
    let characterSheet;
    if (this.token){
      if(!this.token.actorLink){ //If no actor data linked but token sheet is used
          characterSheet =  `FfxivActorSheet-Scene-${this.token.parent.id}-Token-${this.token.id}-Actor-${this.actor.id}`;
      }
    }
    if(!characterSheet){
      characterSheet = `FfxivActorSheet-Actor-${this.actor._id}`;
    }
    $(`#${characterSheet} .companions-sub-tabs .companions-sub-tab`).removeClass("active");
    $(`#${characterSheet} .companions-sub-tab-content`).removeClass('active').hide();
    $(`#${characterSheet} .companions-sub-tabs .companions-sub-tab[data-tab=${tab}]`).addClass("active");
    $(`#${characterSheet} .companions-sub-tab-content[data-tab=${tab}]`).addClass('active').show();
  }

  _toggleSidebar(event){
    this.hidingSidebar = !this.hidingSidebar
    this._applySidebarPreference()
  }
  _applySidebarPreference(){
    let characterSheet;
    if (this.token){
      if(!this.token.actorLink){ //If no actor data linked but token sheet is used
          characterSheet =  `FfxivActorSheet-Scene-${this.token.parent.id}-Token-${this.token.id}-Actor-${this.actor.id}`;
      }
    }
    if(!characterSheet){
      characterSheet = `FfxivActorSheet-Actor-${this.actor._id}`;
    }
    const wrapper = $(`#${characterSheet} .sheet-body-wrapper`);
    const arrow = $(`#${characterSheet} .arrow-sidebar .fa`);
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

  _onChangeJobResource(event){
    const checkbox = event.currentTarget
    const index = parseInt(checkbox.dataset.index, 10);
    const itemId = checkbox.dataset.itemId;
    const item = this.actor.items.get(itemId)

    if (item.system.job_resource_status){
      var job_resource_status = item.system.job_resource_status.slice(0, item.system.job_resources_max);
    }else{
      var job_resource_status = new Array(item.system.job_resources_max).fill(false)
    }
    job_resource_status[index] = checkbox.checked;
    item.update({ 'system.job_resource_status': job_resource_status });
  }

  _onChangeActiveTrait(event){
    const checkbox = event.currentTarget
    const itemId = checkbox.dataset.itemId;

    const item = this.actor.items.get(itemId)

    item.update({ 'system.active':  checkbox.checked});
  }

  _onDeleteTitle(event){
    Dialog.confirm({
      title: game.i18n.localize("FFXIV.Dialogs.DialogTitleConfirmation"),
      content: game.i18n.localize("FFXIV.Confirm"),
      yes: () => {
        const button = event.currentTarget
        const itemId = button.dataset.itemId
        const item = this.actor.items.get(itemId)
        item.delete();
        ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", {itemName: item.name}));
      },
      no: () => {},
      defaultYes: false
    });
  }

  async _moveAbility(direction, event){
    const actor = this.actor;
    const abilityType = event.currentTarget.dataset.type;
    const itemId = event.currentTarget.dataset.itemId;
    if (!actor || !abilityType || !itemId || !direction) return;

    let abilityOrder = foundry.utils.deepClone(actor.system.ability_order || {});
    if (abilityOrder.constructor.name=="Array") abilityOrder = {} //Before 1.4, there was an issue with template.json creating arrays instead of objects
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


  async _movePet(direction, event){
    const actor = this.actor;
    const petId = event.currentTarget.dataset.itemId;
    if (!actor || !petId || !direction) return;
    let petOrder = foundry.utils.deepClone(actor.system.pet_order || []);
    if (petOrder.constructor.name=="Object") petOrder = []

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
    const data = await foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    // Handle dropping an Actor
    if (data?.type === "Actor") {
      const droppedActor = game.actors.get(data.uuid.split(".")[1]);
      if (!droppedActor || droppedActor.type !== "pet") return;

      const pets = foundry.utils.duplicate(this.actor.system.pets || []);
      if (!pets.includes(droppedActor.id)) {
        pets.push(droppedActor.id);
        await this.actor.update({ "system.pets": pets });
      }
      return;
    }

    // Default behavior for other drops (like items)
    return super._onDrop(event);
  }

  async _removePet(event){
    const petId = event.currentTarget.dataset.itemId;
    let pets = foundry.utils.duplicate(this.actor.system.pets || []);
    //console.log(pets)
    const index = pets.indexOf(petId)
    //console.log(index)
    if(index==-1){
      console.error(`No pet "${petId}" in pets array from:`,this.actor.system.pets)
      return;
    }
    pets.splice(index, 1);
    await this.actor.update({"system.pets":pets})


  }

  async _openPet(event){
    const petId = event.currentTarget.dataset.petId;
    const pet = game.actors.get(petId)
    if(pet){
      pet.sheet.render(true);
    }else{
      console.error(`No pet found for ${petId}`);
    }
  }


}
