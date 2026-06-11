import { debugError, debugLog } from "../helpers/debug.mjs";
import {
  getActorCheckPenalty,
  hasStatus,
} from "../helpers/status-effects.mjs";

/**
 * Extend the base Actor document by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */
export class FFXIVActor extends Actor {
  _toFiniteNumber(value, fallback = 0) {
    if (Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  _ensureResource(resource, { value = 0, max = null } = {}) {
    const normalized = resource && typeof resource === "object" ? resource : {};
    const normalizedValue = this._toFiniteNumber(normalized.value, value);
    const normalizedMax = (max === null)
      ? this._toFiniteNumber(normalized.max, null)
      : this._toFiniteNumber(normalized.max, max);
    return {
      value: normalizedValue,
      max: normalizedMax
    };
  }

  _ensureAttributeValue(attribute, defaultLabel = "") {
    const normalized = attribute && typeof attribute === "object" ? attribute : {};
    return {
      value: this._toFiniteNumber(normalized.value, 0),
      label: typeof normalized.label === "string" ? normalized.label : defaultLabel
    };
  }

  _ensurePrimaryAttributes(primaryAttributes) {
    const normalized = primaryAttributes && typeof primaryAttributes === "object" ? primaryAttributes : {};
    return {
      strength: this._ensureAttributeValue(normalized.strength, "FFXIV.Attributes.Strength.long"),
      dexterity: this._ensureAttributeValue(normalized.dexterity, "FFXIV.Attributes.Dexterity.long"),
      vitality: this._ensureAttributeValue(normalized.vitality, "FFXIV.Attributes.Vitality.long"),
      intelligence: this._ensureAttributeValue(normalized.intelligence, "FFXIV.Attributes.Intelligence.long"),
      mind: this._ensureAttributeValue(normalized.mind, "FFXIV.Attributes.Mind.long")
    };
  }

  _ensureSecondaryAttributes(secondaryAttributes) {
    const normalized = secondaryAttributes && typeof secondaryAttributes === "object" ? secondaryAttributes : {};
    const speed = normalized.speed && typeof normalized.speed === "object" ? normalized.speed : {};
    return {
      defense: this._ensureAttributeValue(normalized.defense, "FFXIV.Attributes.Defense"),
      magic_defense: this._ensureAttributeValue(normalized.magic_defense, "FFXIV.Attributes.MagicDefense"),
      vigilance: this._ensureAttributeValue(normalized.vigilance, "FFXIV.Attributes.Vigilance"),
      speed: {
        value: this._toFiniteNumber(speed.value, 0),
        unit: typeof speed.unit === "string" ? speed.unit : "squares",
        label: typeof speed.label === "string" ? speed.label : "FFXIV.Attributes.Speed"
      }
    };
  }

  _ensureCharacterSystemDefaults() {
    if (!["character", "npc"].includes(this.type)) return;

    this.system.primary_attributes = this._ensurePrimaryAttributes(this.system.primary_attributes);
    this.system.secondary_attributes = this._ensureSecondaryAttributes(this.system.secondary_attributes);
    if (this.type !== "character") return;

    this.system.health = this._ensureResource(this.system.health);
    this.system.barrier = this._ensureResource(this.system.barrier);
    this.system.mana = this._ensureResource(this.system.mana, { value: 5, max: 5 });

    const currentClass = this.system.class && typeof this.system.class === "object" ? this.system.class : {};
    this.system.class = {
      name: typeof currentClass.name === "string" && currentClass.name.trim() ? currentClass.name : "custom",
      role: typeof currentClass.role === "string" ? currentClass.role : "",
      customIcon: typeof currentClass.customIcon === "string" ? currentClass.customIcon : "",
      name_custom: typeof currentClass.name_custom === "string" ? currentClass.name_custom : ""
    };

    if (!Array.isArray(this.system.pets)) this.system.pets = [];
    if (!Array.isArray(this.system.pet_order)) this.system.pet_order = [];
    if (!["true", "false"].includes(this.system.showPets)) this.system.showPets = "false";
    if (!this.system.ability_order || typeof this.system.ability_order !== "object" || Array.isArray(this.system.ability_order)) {
      this.system.ability_order = {};
    }

    const profileTrait = this.system.profile_trait;
    if (!profileTrait || typeof profileTrait !== "object" || Array.isArray(profileTrait)) {
      this.system.profile_trait = { name: "", effect: "" };
    } else {
      this.system.profile_trait = {
        name: typeof profileTrait.name === "string" ? profileTrait.name : "",
        effect: typeof profileTrait.effect === "string" ? profileTrait.effect : ""
      };
    }

    const appearance = this.system.appearance;
    if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) {
      this.system.appearance = {
        race: "",
        size: "",
        age: "",
        gender: "",
        weight: "",
        hair: "",
        eyes: "",
        skin: ""
      };
    } else {
      this.system.appearance = {
        race: typeof appearance.race === "string" ? appearance.race : "",
        size: typeof appearance.size === "string" ? appearance.size : "",
        age: typeof appearance.age === "string" ? appearance.age : "",
        gender: typeof appearance.gender === "string" ? appearance.gender : "",
        weight: typeof appearance.weight === "string" ? appearance.weight : "",
        hair: typeof appearance.hair === "string" ? appearance.hair : "",
        eyes: typeof appearance.eyes === "string" ? appearance.eyes : "",
        skin: typeof appearance.skin === "string" ? appearance.skin : ""
      };
    }
  }

  // The ensure and reset methods exist to fix issues spawned in V14 with active effects.
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
  async _preCreate(data, options, user) {
    if (await super._preCreate(data, options, user) === false) return false;

    const prototypeToken = {};
    const lockArtworkRotationGlobal = game.settings.get("ffxiv", "lockArtworkRotationGlobal");
    if (lockArtworkRotationGlobal && foundry.utils.getProperty(data, "prototypeToken.lockRotation") !== true) {
      prototypeToken["prototypeToken.lockRotation"] = true;
    }

    if (this.type === "character") {
      if (foundry.utils.getProperty(data, "prototypeToken.actorLink") !== true) {
        prototypeToken["prototypeToken.actorLink"] = true;
      }
      if (!foundry.utils.hasProperty(data, "prototypeToken.disposition")) {
        prototypeToken["prototypeToken.disposition"] = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      }
      if (!foundry.utils.hasProperty(data, "prototypeToken.displayBars")) {
        prototypeToken["prototypeToken.displayBars"] = CONST.TOKEN_DISPLAY_MODES.OWNER;
      }
      if (!foundry.utils.hasProperty(data, "prototypeToken.bar1.attribute")) {
        prototypeToken["prototypeToken.bar1.attribute"] = "health";
      }
      if (!foundry.utils.hasProperty(data, "prototypeToken.bar2.attribute")) {
        prototypeToken["prototypeToken.bar2.attribute"] = "barrier";
      }
    }
    if (this.type === "npc") {
      if (!foundry.utils.hasProperty(data, "prototypeToken.displayBars")) {
        prototypeToken["prototypeToken.displayBars"] = CONST.TOKEN_DISPLAY_MODES.OWNER;
      }
      if (!foundry.utils.hasProperty(data, "prototypeToken.bar1.attribute")) {
        prototypeToken["prototypeToken.bar1.attribute"] = "health";
      }
      if (!foundry.utils.hasProperty(data, "prototypeToken.bar2.attribute")) {
        prototypeToken["prototypeToken.bar2.attribute"] = "barrier";
      }
    }

    if (!foundry.utils.isEmpty(prototypeToken)) this.updateSource(prototypeToken);
  }

  /** @override */
  async _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    if (game.user.id !== userId || this.type !== "character") return;
    await this.update({
      "system.mana.value": 5,
      "system.mana.max": 5
    }, { render: false });
  }

  /** @override */
  async modifyTokenAttribute(attribute, value, isDelta = false, isBar = true) {
    if (isBar && ["health", "barrier"].includes(attribute)) {
      const attr = foundry.utils.getProperty(this.system, attribute);
      if (!attr || typeof attr !== "object" || !("value" in attr)) return super.modifyTokenAttribute(attribute, value, isDelta, isBar);

      const current = Number(attr.value) || 0;
      const numericValue = Number(value) || 0;
      const update = isDelta ? current + numericValue : numericValue;
      let next = Math.max(0, update);
      const max = Number(attr.max);
      if (attribute === "health" && Number.isFinite(max) && max > 0) next = Math.min(next, max);

      const updates = { [`system.${attribute}.value`]: next };
      const allowed = Hooks.call("modifyTokenAttribute", { attribute, value, isDelta, isBar }, updates, this);
      return allowed !== false ? this.update(updates) : this;
    }

    return super.modifyTokenAttribute(attribute, value, isDelta, isBar);
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
      if (typeof this.system.elite_foe !== "boolean") {
        this.system.elite_foe = false;
      }
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
    this._prepareSharedData(this)
    this._prepareCharacterData(this);
    this._prepareNpcData(this);
    this._preparePetData(this);
  }

  /**
   * Prepare shared data
   */
  _prepareSharedData() {
    return;
  }


  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    if (actorData.type !== 'character') return;
    const className = actorData.system?.class?.name;
    const classConfig = CONFIG.FFXIV?.classes?.[className];

    if (className && className !== "custom" && classConfig?.role) {
      actorData.system.class.role = classConfig.role;
    }

  }

  _prepareNpcData(actorData) {
    if (actorData.type !== 'npc') return;
    const speed = actorData.system?.secondary_attributes?.speed;
    if (!speed || typeof speed !== "object") return;
    if (!Number.isFinite(speed.value)) speed.value = 5;
  }

  _preparePetData(actorData) {
    if (actorData.type !== 'pet') return;
    const speed = actorData.system?.speed;
    if (!speed || typeof speed !== "object") {
      actorData.system.speed = { value: 5, unit: "squares" };
      return;
    }
    if (!Number.isFinite(speed.value)) speed.value = 5;
    if (typeof speed.unit !== "string") speed.unit = "squares";
  }


  /**
   * Override getRollData() that's supplied to rolls.
   */
  getRollData() {
    const data = { ...this.system };

    data.str = 0;
    data.dex = 0;
    data.vit = 0;
    data.int = 0;
    data.mnd = 0;
    data.def = 0;
    data.mdef = 0;
    data.vigilance = 0;

    const primaryAttributes = data.primary_attributes && typeof data.primary_attributes === "object"
      ? data.primary_attributes
      : {};
    if (Object.keys(primaryAttributes).length) {
      for (let [k, v] of Object.entries(primaryAttributes)) {
        data[k] = foundry.utils.deepClone(v);
      }
      data.str = Number(primaryAttributes?.strength?.value) || 0;
      data.dex = Number(primaryAttributes?.dexterity?.value) || 0;
      data.vit = Number(primaryAttributes?.vitality?.value) || 0;
      data.int = Number(primaryAttributes?.intelligence?.value) || 0;
      data.mnd = Number(primaryAttributes?.mind?.value) || 0;
    }
    const secondaryAttributes = data.secondary_attributes && typeof data.secondary_attributes === "object"
      ? data.secondary_attributes
      : {};
    if (Object.keys(secondaryAttributes).length) {
      for (let [k, v] of Object.entries(secondaryAttributes)) {
        data[k] = foundry.utils.deepClone(v);
      }
      data.def = Number(secondaryAttributes?.defense?.value) || 0;
      data.mdef = Number(secondaryAttributes?.magic_defense?.value) || 0;
      data.vigilance = Number(secondaryAttributes?.vigilance?.value) || 0;
      data.speed = this._getStatusAdjustedSpeed(
        Number(secondaryAttributes?.speed?.value) || 0,
      );
    }
    if (this.type === "pet") {
      data.speed = this._getStatusAdjustedSpeed(Number(data.speed?.value ?? data.speed) || 0);
    }
    for (let item of this.items) {
      if (!Array.isArray(item.system.modifiers)) continue; // Skip if item has no modifiers
      if (item.system.activable) {
        if (!item.system.active) continue; // Skip if activable but not active
      }
      if (Object.prototype.hasOwnProperty.call(item.system, "equipped")) {
        if (!item.system.equipped) continue; // Skip if equipped exists but is false
      }
      if (item.type === "title") {
        if (item.name != data.activeTitle) continue; //Skip titles if not active one
      }

      for (const modifier of item.system.modifiers) {
        const [modName, modValue] = modifier;
        const numericModifier = Number(modValue);
        const modifierValue = Number.isFinite(numericModifier) ? numericModifier : 0;
        if (Object.keys(primaryAttributes).length) {
          if (modName == CONFIG.FFXIV.attributes.Strength.label) data.str += modifierValue;
          if (modName == CONFIG.FFXIV.attributes.Dexterity.label) data.dex += modifierValue;
          if (modName == CONFIG.FFXIV.attributes.Vitality.label) data.vit += modifierValue;
          if (modName == CONFIG.FFXIV.attributes.Intelligence.label) data.int += modifierValue;
          if (modName == CONFIG.FFXIV.attributes.Mind.label) data.mnd += modifierValue;
        }
        if (Object.keys(secondaryAttributes).length) {
          if (modName == CONFIG.FFXIV.attributes.Defense.label) data.def += modifierValue;
          if (modName == CONFIG.FFXIV.attributes.MagicDefense.label) data.mdef += modifierValue;
          if (modName == CONFIG.FFXIV.attributes.Vigilance.label) data.vigilance += modifierValue;
        }
        data.dmg = data.dmg || "";
        if (modName == CONFIG.FFXIV.characteristics.Damages.label) data.dmg += "+" + modifierValue;

        data.cdmg = data.cdmg || "";
        if (modName == CONFIG.FFXIV.characteristics.CriticalDamage.label) data.cdmg += "+" + modifierValue;

        data.hit = data.hit || "";
        if (modName == CONFIG.FFXIV.characteristics.BonusToHit.label) data.hit += "+" + modifierValue;

      }
    }
    if (data.dmg == "") data.dmg = "0"
    if (data.cdmg == "") data.cdmg = "0"
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

  _getStatusAdjustedSpeed(baseSpeed) {
    let speed = Math.max(Number(baseSpeed) || 0, 0);
    if (hasStatus(this, "bind")) {
      speed = this._isSmallOrMedium() ? 0 : Math.max(speed - 2, 0);
    }
    if (hasStatus(this, "heavy")) {
      speed = Math.ceil(speed / 2);
    }
    if (hasStatus(this, "slow")) {
      speed = Math.ceil(speed / 2);
    }
    return speed;
  }

  _isSmallOrMedium() {
    const size = String(
      this.type === "npc"
        ? this.system?.size
        : this.system?.appearance?.size,
    ).toLowerCase();
    if (!size) return true;
    return size.includes("small") || size.includes("medium");
  }

  async _showModifiers() {
    debugLog("showModifiers");
    if (this.items.some(item => item.system.active == true)) {
      ChatMessage.create({
        content: await foundry.applications.handlebars.renderTemplate("systems/ffxiv/templates/chat/modifiers-chat-card.hbs", { items: this.items }),
        flags: { core: { canParseHTML: true } },
        flavor: game.i18n.localize("FFXIV.Traits.Modifiers") + " | " + game.i18n.localize("FFXIV.Traits.TraitsOnly")
      });
    } else {
      debugError("No modifier to display", this.items);
      ui.notifications.warn(game.i18n.localize("FFXIV.Chat.NoModifiers"));
    }
  }

  _getEnmityEffects() {
    return this.effects.filter((effect) => {
      if (effect.disabled) return false;
      const statuses = Array.from(effect.statuses ?? []);
      return statuses.includes("enmity");
    });
  }

  async _getEnmitySourceActor(effect) {
    const origin = String(effect?.origin ?? "").trim();
    if (!origin || origin.toLowerCase() === "none") return null;

    let source = null;
    try {
      source = await fromUuid(origin);
    } catch (_error) {
      return null;
    }

    if (source?.documentName === "Actor") return source;
    if (source?.parent?.documentName === "Actor") return source.parent;
    if (source?.actor?.documentName === "Actor") return source.actor;
    return null;
  }

  _targetsIncludeActor(actor) {
    if (!actor) return false;
    return Array.from(game.user.targets ?? []).some((token) => {
      const targetActor = token.actor;
      return targetActor && (
        targetActor === actor ||
        targetActor.uuid === actor.uuid ||
        targetActor.id === actor.id
      );
    });
  }

  async _getEnmityCheckPenaltyInfo() {
    for (const effect of this._getEnmityEffects()) {
      const sourceActor = await this._getEnmitySourceActor(effect);
      if (sourceActor && !this._targetsIncludeActor(sourceActor)) {
        return { penalty: -5, sourceActor };
      }
    }
    return { penalty: 0, sourceActor: null };
  }

  async _getEnmityCheckPenalty() {
    return (await this._getEnmityCheckPenaltyInfo()).penalty;
  }

  async _rollAttribute(attribute) {
    const attributeCapitalized = attribute.charAt(0).toUpperCase() + attribute.slice(1);
    const abbreviationEntry = CONFIG.FFXIV.attributesAbbreviations[attributeCapitalized];

    if (!abbreviationEntry) {
      ui.notifications.warn(`Unknown attribute: ${attribute}`);
      return;
    }

    const attrKey = abbreviationEntry.value;
    const rollData = this.getRollData();
    const modifiers = rollData[attrKey] ?? 0;
    const enmityPenaltyInfo = await this._getEnmityCheckPenaltyInfo();
    const enmityPenalty = enmityPenaltyInfo.penalty;
    const checkPenalty = getActorCheckPenalty(this);
    let formula = `1d20 + ${modifiers}`;
    if (enmityPenalty) formula += ` - ${Math.abs(enmityPenalty)}`;
    if (checkPenalty) formula += ` - ${Math.abs(checkPenalty)}`;
    const roll = new Roll(formula, rollData);
    await roll.evaluate();
    const enmityNote = enmityPenalty
      ? `<br>${game.i18n.localize("FFXIV.Effects.Enmity")}: ${enmityPenalty} (${enmityPenaltyInfo.sourceActor.name} not targeted)`
      : "";
    const checkPenaltyNote = checkPenalty
      ? `<br>${game.i18n.localize("FFXIV.RollDialog.StatusPenalty")}: ${checkPenalty}`
      : "";

    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `<i class="fa-solid fa-dice-d20"></i> ${game.i18n.localize(`FFXIV.Attributes.${attributeCapitalized}.long`) || attribute}`,
      content: `${roll.total} (${roll.formula})${enmityNote}${checkPenaltyNote}`,
      rollMode: game.settings.get('core', 'rollMode'),
      flags: { core: { canParseHTML: true } }
    });

    return roll;
  }
}
