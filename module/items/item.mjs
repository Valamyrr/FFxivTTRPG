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
    // Identify the actor and user performing the roll
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;

    // Get the roll data, including the base formula
    const rollData = this.getRollData();
    const baseFormula = rollData.hit_formula || "1d20";

    // Display a DialogV2 for roll options and wait for user input
    const result = await foundry.applications.api.DialogV2.wait({
      id: "ffxiv-hit-roll-dialog",
      window: { title: game.i18n.localize("FFXIV.RollDialog.HitRollOptions") },
      form: {
        submitOnChange: false,
        closeOnSubmit: true
      },
      // Content: Advantage and Modifier inputs with preview display
      content: `
        <div class="form-group" style="display: flex; align-items: center; margin-bottom: 6px;">
          <label style="font-weight: bold; width: 110px;">${game.i18n.localize("FFXIV.RollDialog.AdvantageDice")}</label>
          <div style="display: flex; flex: 1; align-items: center; gap: 4px;">
            <input type="number" name="advantageDice" value="0" min="0" style="flex: 1; height: 24px; font-size: 0.9em;" />
            <button type="button" class="btn-adjust" data-target="advantageDice" data-step="-1" style="width: 24px; height: 24px;">−</button>
            <button type="button" class="btn-adjust" data-target="advantageDice" data-step="1" style="width: 24px; height: 24px;">+</button>
          </div>
        </div>
        <div class="form-group" style="display: flex; align-items: center; margin-bottom: 6px;">
          <label style="font-weight: bold; width: 110px;">${game.i18n.localize("FFXIV.RollDialog.FlatModifier")}</label>
          <div style="display: flex; flex: 1; align-items: center; gap: 4px;">
            <input type="number" name="flatModifier" value="0" style="flex: 1; height: 24px; font-size: 0.9em;" />
            <button type="button" class="btn-adjust" data-target="flatModifier" data-step="-1" style="width: 24px; height: 24px;">−</button>
            <button type="button" class="btn-adjust" data-target="flatModifier" data-step="1" style="width: 24px; height: 24px;">+</button>
          </div>
        </div>
        <hr />
        <div style="font-size: 0.9em; color: #777777; margin-bottom: 5px;">
          <strong>${game.i18n.localize("FFXIV.RollDialog.Preview")}:</strong> <span id="roll-preview">...</span>
        </div>
      `,
      // Buttons with i18n and form value capture
      buttons: [
        {
          label: game.i18n.localize("FFXIV.RollDialog.ButtonRoll"),
          action: "roll",
          type: "submit",
          callback: (event, button) => {
            // Extract advantage and modifier values from form
            const form = button.form;
            const advantageDice = parseInt(form.elements.advantageDice.value) || 0;
            const flatModifier = parseInt(form.elements.flatModifier.value) || 0;
            return { advantageDice, flatModifier };
          }
        },
        {
          label: game.i18n.localize("FFXIV.Dialogs.Cancel"),
          action: null,
          type: "cancel"
        }
      ],
      // Update roll preview dynamically as inputs change
      render: (_event, dialog) => {
        const html = dialog.element;
        const advInput = html.querySelector('input[name="advantageDice"]');
        const modInput = html.querySelector('input[name="flatModifier"]');
        const preview = html.querySelector('#roll-preview');

        const updatePreview = () => {
          const advantageDice = parseInt(advInput?.value) || 0;
          const flatModifier = parseInt(modInput?.value) || 0;
          let previewFormula = baseFormula;

          const d20Pattern = /(\d*)d20/i;
          if (d20Pattern.test(previewFormula)) {
            const match = previewFormula.match(d20Pattern);
            const count = parseInt(match[1]) || 1;
            previewFormula = previewFormula.replace(d20Pattern, `${count + advantageDice}d20kh1`);
          } else if (advantageDice > 0) {
            previewFormula += " (" + game.i18n.localize("FFXIV.RollDialog.Warning.NoD20AdvantageIgnored") + ")";
          }

          if (flatModifier !== 0) {
            previewFormula += flatModifier > 0 ? ` + ${flatModifier}` : ` - ${Math.abs(flatModifier)}`;
          }

          preview.textContent = previewFormula;
        };

        // Bind plus/minus buttons to adjust input values
        html.querySelectorAll('.btn-adjust').forEach(btn =>
          btn.addEventListener('click', (event) => {
            const target = event.currentTarget.dataset.target;
            const step = parseInt(event.currentTarget.dataset.step);
            const input = html.querySelector(`input[name="${target}"]`);
            const current = parseInt(input.value) || 0;
            const next = target === "advantageDice" ? Math.max(0, current + step) : current + step;
            input.value = next;
            input.dispatchEvent(new Event('input'));
          })
        );

        advInput?.addEventListener('input', updatePreview);
        modInput?.addEventListener('input', updatePreview);
        updatePreview();
      },
      width: 360
    });

    // Cancelled or closed dialog
    if (!result || typeof result !== "object") return;

    const { advantageDice, flatModifier } = result;

    // Build final roll formula based on inputs
    let formula = baseFormula;
    const d20Pattern = /(\d*)d20/i;
    if (d20Pattern.test(formula)) {
      const match = formula.match(d20Pattern);
      const count = parseInt(match[1]) || 1;
      formula = formula.replace(d20Pattern, `${count + advantageDice}d20kh1`);
    } else if (advantageDice > 0) {
      ui.notifications.warn(game.i18n.localize("FFXIV.RollDialog.Warning.NoD20AdvantageIgnored"));
    }

    if (flatModifier !== 0) {
      formula += flatModifier > 0 ? ` + ${flatModifier}` : ` - ${Math.abs(flatModifier)}`;
    }

    // Roll the formula
    const roll = new Roll(formula, rollData);
    await roll.evaluate();

    // Ensure actor has critical range set
    if (!this.parent.system.criticalRange) {
      this.parent.update({ "system.criticalRange": 20 });
    }

    // Determine if the roll is a critical hit or failure
    const d20 = roll.dice.find(die => die.faces === 20);
    const isCritical = d20?.results?.[0]?.result >= this.parent.system.criticalRange;
    const isCriticalFailure = d20?.results?.[0]?.result === 1;

    // Play sound for critical hits
    if (isCritical && game.settings.get('ffxiv', 'soundNotificationFFxiv') && game.settings.get('ffxiv', 'soundNotificationFFxiv_critical')) {
      foundry.audio.AudioHelper.play({
        src: game.settings.get('ffxiv', 'soundNotificationFFxiv_critical'),
        volume: game.settings.get('ffxiv', 'soundNotificationFFxivVolume'),
        autoplay: true,
        loop: false
      });
    }

    // Prepare additional roll buttons for follow-up actions
    let extraButtons = "<div style='display:flex;flex-wrap: wrap;'>";
    if (this.system.base_formula) extraButtons += `<button class="ffxiv-roll-base" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollBaseEffectFormula")}</button>`;
    extraButtons += `<button class="ffxiv-roll-direct" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollDirectHitFormula")}</button>`;
    extraButtons += `<button class="ffxiv-roll-critical" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollCriticalHitFormula")}</button>`;
    if (this.system.alternate_formula_critical) extraButtons += `<button class="ffxiv-roll-critical-alternate" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollAlternateCriticalHitFormula")}</button>`;
    extraButtons += "</div>";

    // Render the roll result
    const rollHTML = $("<div>" + await roll.render() + "</div>");
    if (isCritical) rollHTML.find(".dice-total").css({ "color": "blue" });
    if (isCriticalFailure) rollHTML.find(".dice-total").css({ "color": "red" });

    // Post the final chat message
    ChatMessage.create({
      user,
      speaker,
      flavor: game.i18n.format("FFXIV.Abilities.HitRoll"),
      content: `${rollHTML.html()} ${extraButtons}`
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
    let buttons = "<div style='display:flex;flex-wrap: wrap;'>"
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
