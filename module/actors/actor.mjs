import { debugError, debugLog } from "../helpers/debug.mjs";

/**
 * Extend the base Actor document by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */
export class FfxivActor extends Actor {

  _ensureResource(resource, { max = null } = {}) {
    const normalized = resource && typeof resource === "object" ? resource : {};
    return {
      value: Number.isFinite(normalized.value) ? normalized.value : 0,
      max: Number.isFinite(normalized.max) ? normalized.max : max
    };
  }

  _ensureCharacterSystemDefaults() {
    if (this.type !== "character") return;

    this.system.health = this._ensureResource(this.system.health);
    this.system.barrier = this._ensureResource(this.system.barrier);
    this.system.mana = this._ensureResource(this.system.mana, { max: 5 });

    const currentClass = this.system.class && typeof this.system.class === "object" ? this.system.class : {};
    this.system.class = {
      name: typeof currentClass.name === "string" && currentClass.name.trim() ? currentClass.name : "custom",
      role: typeof currentClass.role === "string" ? currentClass.role : "",
      customIcon: typeof currentClass.customIcon === "string" ? currentClass.customIcon : "",
      name_custom: typeof currentClass.name_custom === "string" ? currentClass.name_custom : ""
    };

    if (!Array.isArray(this.system.pets)) this.system.pets = [];
    if (!Array.isArray(this.system.pet_order)) this.system.pet_order = [];
    if (!this.system.ability_order || typeof this.system.ability_order !== "object" || Array.isArray(this.system.ability_order)) {
      this.system.ability_order = {};
    }
  }

  //The ensure and reset methods exist to fix issues spawned in V14 with active effects.
  _ensureActiveEffectState() {
    this.overrides ??= {};
    this.statuses ??= new Set();
    this._completedActiveEffectPhases ??= new Set();
    this.tokenActiveEffectChanges ??= {};
  }

  _resetActiveEffectState() {
    this._ensureActiveEffectState();
    this.overrides = {};
    this.tokenActiveEffectChanges = {};
    this.statuses.clear();
    this._completedActiveEffectPhases.clear();
  }

  // Reset effect bookkeeping before each prep pass; otherwise token actors can
  // think "initial" / "final" already ran and throw on subsequent updates.
  /** @override */
  prepareData() {
    this._resetActiveEffectState();
    return super.prepareData();
  }

  /** @override */
  prepareBaseData() {
    // Data modifications in this step occur before processing embedded
    // documents or derived data.
    if (!Array.isArray(this.system.tags)) {
      this.system.tags = [];
    }

    this._ensureCharacterSystemDefaults();

    if (this.type === "npc") {
      const currentSize = this.system.size;
      if (currentSize && typeof currentSize === "object" && !Array.isArray(currentSize)) {
        this.system.size = typeof currentSize.text === "string" ? currentSize.text : "";
      } else if (typeof currentSize !== "string") {
        this.system.size = "";
      }
    }

    if (this.type === "pet" && typeof this.system.description !== "string") {
      this.system.description = "";
    }
  }

  /**
   * @override
   * Augment the actor source data with additional dynamic data. Typically,
   * you'll want to handle most of your calculated/derived data in this step.
   * Data calculated in this step should generally not exist in template.json
   * (such as ability modifiers rather than ability scores) and should be
   * available both inside and outside of character sheets (such as if an actor
   * is queried and has a roll executed directly from it).
   */
  prepareDerivedData() {
    const systemData = this.system;
    const flags = this.flags.ffxivttrpg || {};

    // Make separate methods for each Actor type (character, npc, etc.) to keep
    // things organized.
    this._prepareSharedData(this)
    this._prepareCharacterData(this);
    this._prepareNpcData(this);
    this._preparePetData(this);
  }

  /**
   * Prepare shared data
   */
  _prepareSharedData(actorData) {
    return;
  }


  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    if (actorData.type !== 'character') return;
    const className = actorData.system?.class?.name;
    const classConfig = CONFIG.FF_XIV?.classes?.[className];

    if (className && className !== "custom" && classConfig?.role) {
      actorData.system.class.role = classConfig.role;
    }

  }

  _prepareNpcData(actorData) {
    if (actorData.type !== 'npc') return;
  }

  _preparePetData(actorData) {
    if (actorData.type !== 'pet') return;
  }


  /**
   * Override getRollData() that's supplied to rolls.
   */
  getRollData() {
    // Starts off by populating the roll data with a shallow copy of `this.system`
    const data = { ...this.system };

    //Get attributes from actor
    if (data.primary_attributes) {
      for (let [k, v] of Object.entries(data.primary_attributes)) {
        data[k] = foundry.utils.deepClone(v);
      }
      data.str = data.primary_attributes.strength.value ?? 0;
      data.dex = data.primary_attributes.dexterity.value ?? 0;
      data.vit = data.primary_attributes.vitality.value ?? 0;
      data.int = data.primary_attributes.intelligence.value ?? 0;
      data.mnd = data.primary_attributes.mind.value ?? 0;
    }
    if (data.secondary_attributes) {
      for (let [k, v] of Object.entries(data.secondary_attributes)) {
        data[k] = foundry.utils.deepClone(v);
      }
      data.def = data.secondary_attributes.defense.value ?? 0;
      data.mdef = data.secondary_attributes.magic_defense.value ?? 0;
      data.vigilance = data.secondary_attributes.vigilance.value ?? 0;
    }
    // Add modifiers from items
     for (let item of this.items) {
       if (!Array.isArray(item.system.modifiers)) continue; // Skip if item has no modifiers
       if (item.system.activable){
         if (!item.system.active) continue; // Skip if activable but not active
       }
       if (item.system.hasOwnProperty("equipped")){
         if (!item.system.equipped) continue; // Skip if equipped exists but is false
       }
       if (item.type === "title"){
         if (item.name != data.activeTitle) continue; //Skip titles if not active one
       }

       for (const modifier of item.system.modifiers) {
         const [modName, modValue] = modifier;
         if (data.primary_attributes) {
           if (modName == CONFIG.FF_XIV.attributes.Strength.label) data.str += modValue;
           if (modName == CONFIG.FF_XIV.attributes.Dexterity.label) data.dex += modValue;
           if (modName == CONFIG.FF_XIV.attributes.Vitality.label) data.vit += modValue;
           if (modName == CONFIG.FF_XIV.attributes.Intelligence.label) data.int += modValue;
           if (modName == CONFIG.FF_XIV.attributes.Mind.label) data.mnd += modValue;
         }
         if (data.secondary_attributes) {
           if (modName == CONFIG.FF_XIV.attributes.Defense.label) data.def += modValue;
           if (modName == CONFIG.FF_XIV.attributes.MagicDefense.label) data.mdef += modValue;
           if (modName == CONFIG.FF_XIV.attributes.Vigilance.label) data.vigilance += modValue;
         }
         data.dmg = data.dmg || "";
         if (modName == CONFIG.FF_XIV.characteristics.Damages.label) data.dmg += "+"+modValue;

         data.cdmg = data.cdmg || "";
         if (modName == CONFIG.FF_XIV.characteristics.CriticalDamage.label) data.cdmg += "+"+modValue;

         data.hit = data.hit || "";
         if (modName == CONFIG.FF_XIV.characteristics.BonusToHit.label) data.hit += "+"+modValue;

       }
     }
     if (data.dmg=="") data.dmg="0"
     if (data.cdmg=="") data.cdmg="0"
    //Add adventuring ranks
    if (data.adventuring_rank) {
      data.arank_min = data.adventuring_rank.miner
      data.arank_bot = data.adventuring_rank.botanist
      data.arank_fis = data.adventuring_rank.fisher
      data.arank_car = data.adventuring_rank.carpenter
      data.arank_bla = data.adventuring_rank.blacksmith
      data.arank_arm = data.adventuring_rank.armorer
      data.arank_gol = data.adventuring_rank.goldsmith
      data.arank_lea = data.adventuring_rank.leatherworker
      data.arank_wea = data.adventuring_rank.weaver
      data.arank_alc = data.adventuring_rank.alchemist
      data.arank_cul = data.adventuring_rank.culinarian
    }
    return data;
  }

  async _showModifiers(){
    debugLog("showModifiers");
    if (this.items.some(item => item.system.active == true)){
      ChatMessage.create({
        content: await foundry.applications.handlebars.renderTemplate("systems/ffxiv/templates/chat/modifiers-chat-card.hbs", { items: this.items }),
        flags: { core: { canParseHTML: true } },
        flavor: game.i18n.localize("FFXIV.Traits.Modifiers") + " | " + game.i18n.localize("FFXIV.Traits.TraitsOnly")
      });
    }else{
      debugError("No modifier to display",this.items);
      ui.notifications.warn(game.i18n.localize("FFXIV.Chat.NoModifiers"));
    }
  }

  async _rollAttribute(attribute) {
    const attributeCapitalized = attribute.charAt(0).toUpperCase() + attribute.slice(1);
    const abbreviationEntry = CONFIG.FF_XIV.attributesAbbreviations[attributeCapitalized];

    if (!abbreviationEntry) {
      ui.notifications.warn(`Unknown attribute: ${attribute}`);
      return;
    }

    const attrKey = abbreviationEntry.value;
    const attributeValue = foundry.utils.getProperty(this.system, `primary_attributes.${attribute}.value`) || 0;

    const rollData = this.getRollData();
    const modifiers = rollData[attrKey] ?? 0;
    const roll = new Roll(`1d20 + ${modifiers}`, rollData);
    await roll.evaluate({ async: true });

    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `<i class="fa-solid fa-dice-d20"></i> ${game.i18n.localize(`FFXIV.Attributes.${attributeCapitalized}.long`) || attribute}`,
      content: `${roll.total} (${roll.formula})`,
      rollMode: game.settings.get('core', 'rollMode'),
      flags: { core: { canParseHTML: true } }
    });

    return roll;
  }


}
