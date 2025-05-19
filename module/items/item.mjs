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
    let content = await foundry.applications.handlebars.renderTemplate("systems/ffxiv/templates/chat/ability-chat-card.hbs", { item: this });
    if (this.system.granted_ability){ //For augment granting abilities
      if (game.items.get(this.system.granted_ability)){
        content = content + await foundry.applications.handlebars.renderTemplate("systems/ffxiv/templates/chat/ability-chat-card.hbs", { item: game.items.get(this.system.granted_ability) });
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
  
  async _rollHit() {
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    const rollData = this.getRollData();
    const baseFormula = rollData.hit_formula || "1d20";

    const content = `
      <form style="margin: 0; padding: 0; max-width: 340px;">
        <div class="form-group" style="display: flex; align-items: center; margin-bottom: 6px;">
          <label style="font-weight: bold; width: 110px;">${game.i18n.localize("FFXIV.RollDialog.AdvantageDice")}</label>
          <div style="display: flex; flex: 1; align-items: center; gap: 4px;">
            <input type="number" name="advantage" value="0" min="0" style="flex: 1; height: 24px; font-size: 0.9em;" />
            <button type="button" class="btn-adjust" data-target="advantage" data-step="-1" style="width: 24px; height: 24px;">−</button>
            <button type="button" class="btn-adjust" data-target="advantage" data-step="1" style="width: 24px; height: 24px;">+</button>
          </div>
        </div>
        <div class="form-group" style="display: flex; align-items: center; margin-bottom: 6px;">
          <label style="font-weight: bold; width: 110px;">${game.i18n.localize("FFXIV.RollDialog.FlatModifier")}</label>
          <div style="display: flex; flex: 1; align-items: center; gap: 4px;">
            <input type="number" name="modifier" value="0" style="flex: 1; height: 24px; font-size: 0.9em;" />
            <button type="button" class="btn-adjust" data-target="modifier" data-step="-1" style="width: 24px; height: 24px;">−</button>
            <button type="button" class="btn-adjust" data-target="modifier" data-step="1" style="width: 24px; height: 24px;">+</button>
          </div>
        </div>
        <hr />
        <div style="font-size: 0.9em; color: #555; margin-bottom: 5px;">
          <strong>${game.i18n.localize("FFXIV.RollDialog.Preview")}:</strong> <span id="roll-preview">...</span>
        </div>
      </form>
    `;

    const dialog = new Dialog({
      title: `${game.i18n.localize("FFXIV.RollDialog.HitRollOptions")}`,
      content,
      buttons: {
        roll: {
          label: "Roll",
          callback: async (html) => {
            const adv = parseInt(html.find('[name="advantage"]').val()) || 0;
            const mod = parseInt(html.find('[name="modifier"]').val()) || 0;

            let formula = baseFormula;
            const d20Pattern = /(\d*)d20/i;
            if (d20Pattern.test(formula)) {
              const match = formula.match(d20Pattern);
              const count = parseInt(match[1]) || 1;
              formula = formula.replace(d20Pattern, `${count + adv}d20kh1`);
            } else if (adv > 0) {
              ui.notifications.warn("No d20 in formula — advantage dice ignored.");
            }

            if (mod !== 0) {
              formula += mod > 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`;
            }

            const roll = new Roll(formula, rollData);
            await roll.evaluate();

            if (!this.parent.system.criticalRange) {
              this.parent.update({ "system.criticalRange": 20 });
            }

            const d20 = roll.dice.find(die => die.faces === 20);
            const isCritical = d20?.results?.[0]?.result >= this.parent.system.criticalRange;
            const isCriticalFailure = d20?.results?.[0]?.result === 1;

            if (isCritical && game.settings.get('ffxiv', 'soundNotificationFFxiv') && game.settings.get('ffxiv', 'soundNotificationFFxiv_critical')) {
              foundry.audio.AudioHelper.play({
                src: game.settings.get('ffxiv', 'soundNotificationFFxiv_critical'),
                volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
                autoplay: true,
                loop: false
              });
            }

            let content = "<div style='display:flex'>";
            if (this.system.base_formula) content += `<button class="ffxiv-roll-base" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollBaseEffectFormula")}</button>`;
            content += `<button class="ffxiv-roll-direct" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollDirectHitFormula")}</button>`;
            content += `<button class="ffxiv-roll-critical" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollCriticalHitFormula")}</button>`;
            if (this.system.alternate_formula_critical) content += `<button class="ffxiv-roll-critical-alternate" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollAlternateCriticalHitFormula")}</button>`;
            content += "</div>";

            let rollJquery = $("<div>" + await roll.render() + "</div>");
            if (isCritical) rollJquery.find(".dice-total").css({ "color": "blue" });
            if (isCriticalFailure) rollJquery.find(".dice-total").css({ "color": "red" });

            ChatMessage.create({
              user: user,
              speaker: speaker,
              flavor: game.i18n.format("FFXIV.Abilities.HitRoll"),
              content: `${rollJquery.html()} ${content}`
            });
          }
        },
        cancel: { label: "Cancel" }
      },
      default: "roll"
    });

    dialog.render(true, { width: 360 });

    Hooks.once("renderDialog", (_app, html) => {
      const advInput = html.find('input[name="advantage"]');
      const modInput = html.find('input[name="modifier"]');
      const preview = html.find('#roll-preview');

      function updatePreview() {
        const adv = parseInt(advInput.val(), 10) || 0;
        const mod = parseInt(modInput.val(), 10) || 0;
        let previewFormula = baseFormula;

        const d20Pattern = /(\d*)d20/i;
        if (d20Pattern.test(previewFormula)) {
          const match = previewFormula.match(d20Pattern);
          const count = parseInt(match[1]) || 1;
          previewFormula = previewFormula.replace(d20Pattern, `${count + adv}d20kh1`);
        } else if (adv > 0) {
          previewFormula += "  (Advantage ignored)";
        }

        if (mod !== 0) {
          previewFormula += mod > 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`;
        }

        preview.text(previewFormula);
      }

      html.find('.btn-adjust').on('click', (event) => {
        const target = event.currentTarget.dataset.target;
        const step = parseInt(event.currentTarget.dataset.step);
        const input = html.find(`input[name="${target}"]`);
        const current = parseInt(input.val()) || 0;
        const next = target === "advantage" ? Math.max(0, current + step) : current + step;
        input.val(next).trigger('input');
      });

      advInput.on('input', updatePreview);
      modInput.on('input', updatePreview);
      updatePreview();
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
