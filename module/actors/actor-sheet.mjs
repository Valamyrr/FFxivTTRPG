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
    this._applySidebarPreference();

    if(this.actor.type == "character"){
      Hooks.once('renderActorSheet', () => {
        this._updateManaBar();
        this._updateHealthBar();
        this._applyStoredAbilityTab();
        this._applyStoredCompanionTab();
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
      "showExperience": game.settings.get('ffxiv','toggleExperience'),
      "useRarity": game.settings.get('ffxiv','useRarity'),
      "showGear": game.settings.get('ffxiv','toggleGear')
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
    const biography = this.actor.system.biography || "";
    context.enrichedBiography = await TextEditor.enrichHTML(
      biography,
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
    if (this.actor.system.profile_trait){
      const effect = this.actor.system.profile_trait.effect || "";
      context.enrichedProfileTrait = await TextEditor.enrichHTML(
        effect,
        {
          secrets: this.document.isOwner,
          async: true,
          rollData: this.actor.getRollData(),
          relativeTo: this.actor,
        }
      );
    }


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
    console.log("Listeners activated for:", this.actor.name);
    console.log(html)

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

    html.on('click', '.inventory-item', this._renderItem.bind(this));

    html.on('click', '.abilities-sub-tabs .sub-tab', this._displayAbilityTab.bind(this))
    html.on('click', '.companions-sub-tabs .companions-sub-tab', this._displayCompanionTab.bind(this))

    html.on('mousedown', '.mana-bar', this._onClickManaBar.bind(this));

    html.on('change', '.currency-quantity', this._updateCurrency.bind(this));

    html.on('click', '.ability-icon', this._renderItem.bind(this));
    html.on('click', '.augment-icon', this._renderItem.bind(this));
    html.on('click', '.ability-roll-button', this._rollItem.bind(this));
    html.on('click', '.roll-attribute', this._rollAttribute.bind(this));

    html.on('click', '.arrow-sidebar', this._toggleSidebar.bind(this))

    html.on('change', '.ability-limitations .limitation', this._onChangeLimitations.bind(this))

    html.on('change', '.ability-limitations .job_resource', this._onChangeJobResource.bind(this))

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

  async _rollItem(event){
    const itemId = event.currentTarget.dataset.itemId
    const item = this.actor.items.get(itemId);
    if(item){

      let content = await renderTemplate("systems/ffxiv/templates/chat/ability-chat-card.hbs", { item: item });
      if (item.system.granted_ability){ //For augment granting abilities
        if (game.items.get(item.system.granted_ability)){
          content = content + await renderTemplate("systems/ffxiv/templates/chat/ability-chat-card.hbs", { item: game.items.get(item.system.granted_ability) });
        }else{
          console.error("Granted ability must be a valid ID. Use `game.items.get(INSERT_ID)` to check your item's data.")
        }
      }
      ChatMessage.create({
        content: content,
        flags: { core: { canParseHTML: true } },
        flavor: game.i18n.format("FFXIV.ItemType."+item.type)
      });
      if(item.type !="trait" && this.actor.system.showModifiers){

        if (this.actor.items.some(item => item.system.active == true)){
          ChatMessage.create({
            content: await renderTemplate("systems/ffxiv/templates/chat/modifiers-chat-card.hbs", { items: this.actor.items }),
            flags: { core: { canParseHTML: true } },
            flavor: game.i18n.localize("FFXIV.Traits.Modifiers") + " | " + game.i18n.localize("FFXIV.Traits.TraitsOnly")
          });
        }
      }
      item.roll(event);
    }else{
      console.error("Roll Error : No item found.")
      console.error(event.currentTarget)
    }

  }

  async _rollAttribute(event){
    const attribute = event.currentTarget.dataset.attribute
    if (!attribute) {
      ui.notifications.error("No attribute specified to roll for.");
      return;
    }
    const attributeValue = foundry.utils.getProperty(this.actor.system, `primary_attributes.${attribute}.value`) || 0
    const attributeString = attribute.charAt(0).toUpperCase() + attribute.slice(1)
    let roll = new Roll(`1d20 + ${attributeValue}`);
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `<i class="fa-solid fa-dice-d20"></i> ${game.i18n.localize(`FFXIV.Attributes.${attributeString}.long`) || attribute}`,
      content: `${roll.total} (${roll.formula})`,
      rollMode: game.settings.get('core', 'rollMode'),
      flags: { core: { canParseHTML: true } }
    });
    return roll;
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
      let characterSheet;
      if (this.token){
        characterSheet =  document.getElementById(`FfxivActorSheet-Scene-${this.token.parent.id}-Token-${this.token.id}-Actor-${this.actor.id}`);
      }else{
        characterSheet = document.getElementById(`FfxivActorSheet-Actor-${this.actor._id}`);
      }


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
    let characterSheet;
    if (this.token){
      characterSheet =  document.getElementById(`FfxivActorSheet-Scene-${this.token.parent.id}-Token-${this.token.id}-Actor-${this.actor.id}`);
    }else{
      characterSheet = document.getElementById(`FfxivActorSheet-Actor-${this.actor._id}`);
    }

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
        Dialog.confirm({
          title: game.i18n.format("FFXIV.Dialogs.DialogTitleConfirmation"),
          content: game.i18n.format("FFXIV.Dialogs.ItemDelete", {itemName: this.item.name}),
          yes: () => {
            ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", {itemName: this.item.name}));
            this.item.delete();
            if(game.settings.get('ffxiv', 'soundNotificationFFxiv')){
              foundry.audio.AudioHelper.play({
                src: "systems/ffxiv/assets/sounds/delete_item.wav", // Ensure this path is valid
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
    let characterSheet;
    if (this.token){
      characterSheet = `FfxivActorSheet-Scene-${this.token.parent.id}-Token-${this.token.id}-Actor-${this.actor.id}`;
    }else{
      characterSheet = `FfxivActorSheet-Actor-${this.actor._id}`;
    }
    $(`#${characterSheet} .abilities-sub-tabs .sub-tab`).removeClass("active");
    $(`#${characterSheet} .sub-tab-content`).removeClass('active').hide();
    $(`#${characterSheet} .abilities-sub-tabs .sub-tab[data-tab=${tab}]`).addClass("active");
    $(`#${characterSheet} .sub-tab-content[data-tab=${tab}]`).addClass('active').show();
  }
  _switchCompanionTab(tab){
    let characterSheet;
    if (this.token){
      characterSheet = `FfxivActorSheet-Scene-${this.token.parent.id}-Token-${this.token.id}-Actor-${this.actor.id}`;
    }else{
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
      characterSheet = `FfxivActorSheet-Scene-${this.token.parent.id}-Token-${this.token.id}-Actor-${this.actor.id}`;
    }else{
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
        ui.notifications.info(game.i18n.format("FFXIV.Notifications.ItemDelete", {itemName: this.item.name}));
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


}
