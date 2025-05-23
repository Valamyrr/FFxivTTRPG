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
      Object.assign(rollData,this.parent.getRollData())
    }

    return rollData;
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  async roll(event) {
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id
    let content = await renderTemplate("systems/ffxiv/templates/chat/ability-chat-card.hbs", { item: this });
    if (this.system.granted_ability){ //For augment granting abilities
      if (game.items.get(this.system.granted_ability)){
        content = content + await renderTemplate("systems/ffxiv/templates/chat/ability-chat-card.hbs", { item: game.items.get(this.system.granted_ability) });
      }else{
        console.error("Granted ability must be a valid ID. Use `game.items.get(INSERT_ID)` to check your item's data.")
      }
    }
    content = content + this._getRollButtons()
    ChatMessage.create({
      user: user,
      content: content,
      speaker: speaker,
      flags: { core: { canParseHTML: true } },
      flavor: game.i18n.format("FFXIV.ItemType."+this.type)
    });
  }

  async _rollHit(){
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id
    const rollData = this.getRollData()
    const roll = new Roll(rollData.hit_formula, rollData);
    await roll.evaluate();


      if(!this.parent.system.criticalRange){
        this.parent.update({"system.criticalRange":20})
      }
      console.log("critrange",this.parent.system.criticalRange)
      const d20 = roll.dice.find(die => die.faces === 20);
      console.log("d20",d20)
      const isCritical = d20?.results?.[0]?.result >= this.parent.system.criticalRange;
      const isCriticalFailure = d20?.results?.[0]?.result === 1;
      console.log("crit",isCritical)
      console.log("critfail",isCriticalFailure)
      if(isCritical && game.settings.get('ffxiv', 'soundNotificationFFxiv') && game.settings.get('ffxiv', 'soundNotificationFFxiv_critical')){
        foundry.audio.AudioHelper.play({
          src: game.settings.get('ffxiv', 'soundNotificationFFxiv_critical'),
          volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
          autoplay: true,
          loop: false
        });
      }

    let content = "<div style='display:flex'>"
    if(this.system.base_formula) content += `<button class="ffxiv-roll-base" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollBaseEffectFormula")}</button>`
    content += `<button class="ffxiv-roll-direct" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollDirectHitFormula")}</button>`
    content += `<button class="ffxiv-roll-critical" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollCriticalHitFormula")}</button>`
    if(this.system.alternate_formula_critical) content += `<button class="ffxiv-roll-critical-alternate" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollAlternateCriticalHitFormula")}</button>`
    content += "</div>"

    let rollJquery = $("<div>"+await roll.render()+"</div>")
    if(isCritical){
      rollJquery.find(".dice-total").css({"color":"blue"})
    }
    if(isCriticalFailure){
      rollJquery.find(".dice-total").css({"color":"red"})
    }

    ChatMessage.create({
      user: user,
      speaker: speaker,
      flavor: game.i18n.format("FFXIV.Abilities.HitRoll"),
      content: `${rollJquery.html()} ${content}`
    });
  }

  async _rollDirect(){
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id
    const rollData = this.getRollData()
    const roll = new Roll(rollData.direct_formula, rollData);
    console.log(roll)
    await roll.evaluate();
    ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [roll],
      flavor: game.i18n.format("FFXIV.Abilities.DirectHitRoll")
    });
  }

  async _rollCritical(){
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id
    const rollData = this.getRollData()
    let roll = new Roll(rollData.direct_formula, rollData);
    roll = new Roll(this._doubleDiceCounts(roll._formula), rollData);
    await roll.evaluate();
    ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [roll],
      flavor: game.i18n.format("FFXIV.Abilities.CriticalHitRoll")
    });
  }

  async _rollCriticalAlternate(){
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id
    const rollData = this.getRollData()
    let roll = new Roll(rollData.alternate_formula_critical, rollData);
    await roll.evaluate();
    ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [roll],
      flavor: game.i18n.format("FFXIV.Abilities.CriticalHitRoll")
    });
  }

  async _rollBase(){
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id
    const rollData = this.getRollData()
    const roll = new Roll(rollData.base_formula, rollData);
    await roll.evaluate();
    ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [roll],
      flavor: game.i18n.format("FFXIV.Abilities.BaseEffectRoll")
    });
  }

  async _rollAlternate(){
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id
    const rollData = this.getRollData()
    const roll = new Roll(rollData.alternate_formula, rollData);
    await roll.evaluate();
    ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [roll],
      flavor: game.i18n.format("FFXIV.Abilities.BaseEffectRoll")
    });
  }

  _getRollButtons(){
    let buttons = "<div style='display:flex'>"
    if(this.system.base_formula) buttons += `<button class="ffxiv-roll-base" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollBaseEffectFormula")}</button>`
    if(this.system.alternate_formula) buttons += `<button class="ffxiv-roll-alternate" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollAlternateFormula")}</button>`
    if(this.system.status_effect) buttons += `<button class="ffxiv-apply-status" data-item-id="${this._id}" data-actor-id="${this.parent._id}" data-effect-id="${this.system.status_effect}" data-action="${this.system.status_action}">${game.i18n.localize("FFXIV.Abilities.StatusEffect")}</button>`
    if(this.system.hit_formula) buttons += `<button class="ffxiv-roll-hit" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollHitFormula")}</button>`
    if(this.type !="trait" && this.parent.system.showModifiers) buttons += `<button class="ffxiv-show-modifiers" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.ShowModifiers")}</button>`
    return buttons+"</div>"
  }

  _doubleDiceCounts(input) {
    return input.replace(/(\d+)(?=[dD])/g, (match) => {
      return String(Number(match) * 2);
    });
  }
}
