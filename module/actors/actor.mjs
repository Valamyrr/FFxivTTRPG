/**
 * Extend the base Actor document by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */
export class FfxivActor extends Actor {
  /** @override */
  prepareData() {
    // Prepare data for the actor. Calling the super version of this executes
    // the following, in order: data reset (to clear active effects),
    // prepareBaseData(), prepareEmbeddedDocuments() (including active effects),
    // prepareDerivedData().
    console.log("FFXIV | Actor ",this)
    super.prepareData();
  }

  /** @override */
  prepareBaseData() {
    // Data modifications in this step occur before processing embedded
    // documents or derived data.
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
    this._prepareSimpleData(this);
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
    if (actorData.system.class.name != ""){
      actorData.system.class.role = CONFIG.FF_XIV.classes[actorData.system.class.name].role
    }

  }

  _prepareSimpleData(actorData) {
    if (actorData.type !== 'simple') return;
  }


  /**
   * Override getRollData() that's supplied to rolls.
   */
  getRollData() {
    // Starts off by populating the roll data with a shallow copy of `this.system`

    const data = { ...this };
    // Prepare character roll data.
    this._getCharacterRollData({ ...this });

    return data;
  }

  /**
   * Prepare character roll data.
   */
  _getCharacterRollData(data) {
    if (data.type !== 'character') return;

    // Copy the ability scores to the top level, so that rolls can use
    // formulas like `@str.mod + 4`.
    if (data.system.primary_attributes) {
      for (let [k, v] of Object.entries(data.system.primary_attributes)) {
        data[k] = foundry.utils.deepClone(v);
      }
      data.str = data.system.primary_attributes.strength ?? 0
      data.dex = data.system.primary_attributes.dexterity ?? 0
      data.vit = data.system.primary_attributes.vitality ?? 0
      data.int = data.system.primary_attributes.intelligence ?? 0
      data.mnd = data.system.primary_attributes.mind ?? 0
    }
    if (data.system.secondary_attributes) {
      for (let [k, v] of Object.entries(data.system.secondary_attributes)) {
        data[k] = foundry.utils.deepClone(v);
      }
      data.def = data.system.secondary_attributes.defense ?? 0
      data.mdef = data.system.secondary_attributes.magic_defense ?? 0
      data.vigilance = data.system.secondary_attributes.vigilance ?? 0
    }
    return data
  }

}
