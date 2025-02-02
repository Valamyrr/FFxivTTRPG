/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class FfxivItem extends Item {
  /**
   * Augment the basic Item data model with additional dynamic data.
   */
  prepareData() {
    // As with the actor class, items are documents that can have their data
    // preparation methods overridden (such as prepareBaseData()).
    console.log("FFXIV | Item ", this)
    super.prepareData();

  }

  /**
   * Prepare a data object which defines the data schema used by dice roll commands against this Item
   * @override
   */
  getRollData() {
    // Starts off by populating the roll data with a shallow copy of `this.system`
    const rollData = { ...this.system };

    const target = game.user.targets.first()
    if (target){ //If player has selected any target
      rollData.target = game.actors.get(target.document.actorId).getRollData() //Adds the target's RollData
    }

    if (this.parent){ //If an actor is present
      rollData.actor = this.parent.getRollData(); // If present, add the actor's roll data
    }

    return rollData;
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  async roll(event) {
    const rollData = this.getRollData();
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const rollMode = game.settings.get('core', 'rollMode');
    const label = `[${this.type}] ${this.name}`;
    const user = game.user.id
    console.log(rollData)
    //Hit roll
    if(rollData.hit_formula){
      console.log(rollData.hit_formula)
      const roll = new Roll(rollData.hit_formula, rollData);
      await roll.evaluate();
      ChatMessage.create({
        user: user,
        speaker: speaker,
        rolls: [roll],
        flavor: game.i18n.format("FFXIV.Abilities.HitRoll")
      });
    }
    //Base damage roll
    if(rollData.base_formula){
      console.log(rollData.base_formula)
      const roll = new Roll(rollData.base_formula, rollData);
      await roll.evaluate();
      ChatMessage.create({
        user: user,
        speaker: speaker,
        rolls: [roll],
        flavor: game.i18n.format("FFXIV.Abilities.BaseEffectRoll")
      });
    }
    //Direct damage roll
    if(rollData.direct_formula){
      console.log(rollData.direct_formula)
      const roll = new Roll(rollData.direct_formula, rollData);
      await roll.evaluate();
      ChatMessage.create({
        user: user,
        speaker: speaker,
        rolls: [roll],
        flavor: game.i18n.format("FFXIV.Abilities.DirectHitRoll")
      });
    }

  }
}
