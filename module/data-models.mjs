const fields = foundry.data.fields;

function buildAbilityFields() {
  return {
    cost: new fields.StringField({ required: false, blank: true, initial: "" }),
    target: new fields.StringField({ required: false, blank: true, initial: "" }),
    range: new fields.StringField({ required: false, blank: true, initial: "" }),
    check: new fields.StringField({ required: false, blank: true, initial: "None" }),
    challenge: new fields.StringField({ required: false, blank: true, initial: "" }),
    trigger: new fields.StringField({ required: false, blank: true, initial: "" }),
    base_effect: new fields.StringField({ required: false, blank: true, initial: "" }),
    combo: new fields.StringField({ required: false, blank: true, initial: "" }),
    condition: new fields.StringField({ required: false, blank: true, initial: "" }),
    direct_hit: new fields.StringField({ required: false, blank: true, initial: "" }),
    status_effect: new fields.StringField({ required: false, blank: true, initial: "" }),
    status_action: new fields.BooleanField({ required: false, initial: true }),
    marker_area: new fields.StringField({ required: false, blank: true, initial: "" }),
    marker_trigger: new fields.StringField({ required: false, blank: true, initial: "" }),
    marker_effect: new fields.StringField({ required: false, blank: true, initial: "" }),
    limitations: new fields.StringField({ required: false, blank: true, initial: "" }),
    limitations_status: new fields.ArrayField(
      new fields.StringField({ required: false, blank: true, initial: "" })
    ),
    limitations_max: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
    hit_formula: new fields.StringField({ required: false, blank: true, initial: "" }),
    direct_formula: new fields.StringField({ required: false, blank: true, initial: "" }),
    base_formula: new fields.StringField({ required: false, blank: true, initial: "" }),
    alternate_formula: new fields.StringField({ required: false, blank: true, initial: "" }),
    alternate_formula_critical: new fields.StringField({ required: false, blank: true, initial: "" }),
    hpcost: new fields.StringField({ required: false, blank: true, initial: "" }),
    origin: new fields.StringField({ required: false, blank: true, initial: "" })
  };
}

function buildItemFields() {
  return {
    description: new fields.HTMLField({ required: false, blank: true, initial: "" }),
    rarity: new fields.StringField({ required: false, blank: true, initial: "" }),
    tags: new fields.ArrayField(
      new fields.StringField({ required: false, blank: true, initial: "" })
    ),
    source: new fields.StringField({ required: false, blank: true, initial: "" }),
    level: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 })
  };
}

function buildPriceField() {
  return new fields.SchemaField({
    buy: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
    sell: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
    denomination: new fields.StringField({ required: false, blank: true, initial: "FFXIV.Item.Fortune" })
  });
}

function buildInventoryFields() {
  return {
    quantity: new fields.NumberField({ required: false, integer: true, min: 0, initial: 1 }),
    weight: new fields.StringField({ required: false, blank: true, initial: "" }),
    price: buildPriceField(),
    equipped: new fields.BooleanField({ required: false, initial: false }),
    position: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
    stack: new fields.BooleanField({ required: false, initial: false }),
    level: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
    craft_level: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
    craft_job: new fields.StringField({ required: false, blank: true, initial: "" }),
    shop_tier: new fields.StringField({ required: false, blank: true, initial: "" })
  };
}

function buildModifierFields() {
  return {
    modifiers: new fields.ArrayField(new fields.AnyField({ required: false }))
  };
}

function buildResourceField(maxInitial = null) {
  return new fields.SchemaField({
    value: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
    max: new fields.NumberField({ required: false, nullable: true, integer: true, initial: maxInitial })
  });
}

function buildPrimaryAttributesField() {
  return new fields.SchemaField({
    strength: new fields.SchemaField({
      value: new fields.NumberField({ required: false, integer: true, initial: 0 }),
      label: new fields.StringField({ required: false, blank: true, initial: "FFXIV.Attributes.Strength.long" })
    }),
    dexterity: new fields.SchemaField({
      value: new fields.NumberField({ required: false, integer: true, initial: 0 }),
      label: new fields.StringField({ required: false, blank: true, initial: "FFXIV.Attributes.Dexterity.long" })
    }),
    vitality: new fields.SchemaField({
      value: new fields.NumberField({ required: false, integer: true, initial: 0 }),
      label: new fields.StringField({ required: false, blank: true, initial: "FFXIV.Attributes.Vitality.long" })
    }),
    intelligence: new fields.SchemaField({
      value: new fields.NumberField({ required: false, integer: true, initial: 0 }),
      label: new fields.StringField({ required: false, blank: true, initial: "FFXIV.Attributes.Intelligence.long" })
    }),
    mind: new fields.SchemaField({
      value: new fields.NumberField({ required: false, integer: true, initial: 0 }),
      label: new fields.StringField({ required: false, blank: true, initial: "FFXIV.Attributes.Mind.long" })
    })
  });
}

function buildSecondaryAttributesField() {
  return new fields.SchemaField({
    defense: new fields.SchemaField({
      value: new fields.NumberField({ required: false, integer: true, initial: 0 }),
      label: new fields.StringField({ required: false, blank: true, initial: "FFXIV.Attributes.Defense" })
    }),
    magic_defense: new fields.SchemaField({
      value: new fields.NumberField({ required: false, integer: true, initial: 0 }),
      label: new fields.StringField({ required: false, blank: true, initial: "FFXIV.Attributes.MagicDefense" })
    }),
    vigilance: new fields.SchemaField({
      value: new fields.NumberField({ required: false, integer: true, initial: 0 }),
      label: new fields.StringField({ required: false, blank: true, initial: "FFXIV.Attributes.Vigilance" })
    }),
    speed: new fields.SchemaField({
      value: new fields.NumberField({ required: false, integer: true, initial: 0 }),
      unit: new fields.StringField({ required: false, blank: true, initial: "squares" }),
      label: new fields.StringField({ required: false, blank: true, initial: "FFXIV.Attributes.Speed" })
    })
  });
}

class CharacterActorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      biography: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      tags: new fields.ArrayField(
        new fields.StringField({ required: false, blank: true, initial: "" })
      ),
      origin: new fields.StringField({ required: false, blank: true, initial: "" }),
      motive: new fields.StringField({ required: false, blank: true, initial: "" }),
      bond: new fields.StringField({ required: false, blank: true, initial: "" }),
      deity: new fields.StringField({ required: false, blank: true, initial: "" }),
      adventuring_rank: new fields.SchemaField({
        miner: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
        botanist: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
        fisher: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
        carpenter: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
        blacksmith: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
        armorer: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
        goldsmith: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
        leatherworker: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
        weaver: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
        alchemist: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
        culinarian: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 })
      }),
      health: buildResourceField(),
      barrier: buildResourceField(),
      mana: buildResourceField(5),
      ability_order: new fields.ObjectField({ required: false, initial: {} }),
      pet_order: new fields.ArrayField(
        new fields.StringField({ required: false, blank: true, initial: "" })
      ),
      primary_attributes: buildPrimaryAttributesField(),
      secondary_attributes: buildSecondaryAttributesField(),
      experience: new fields.SchemaField({
        level: new fields.SchemaField({
          value: new fields.NumberField({ required: false, integer: true, min: 1, initial: 1 }),
          max: new fields.NumberField({ required: false, integer: true, min: 1, initial: 100 })
        })
      }),
      class: new fields.SchemaField({
        name: new fields.StringField({ required: false, blank: true, initial: "Custom" }),
        role: new fields.StringField({ required: false, blank: true, initial: "" }),
        customIcon: new fields.StringField({ required: false, blank: true, initial: "" }),
        name_custom: new fields.StringField({ required: false, blank: true, initial: "" })
      }),
      activeTitle: new fields.StringField({ required: false, blank: true, initial: "" }),
      showModifiers: new fields.StringField({ required: false, blank: true, initial: "true" }),
      profile_trait: new fields.SchemaField({
        name: new fields.StringField({ required: false, blank: true, initial: "" }),
        effect: new fields.HTMLField({ required: false, blank: true, initial: "" })
      }),
      appearance: new fields.SchemaField({
        race: new fields.StringField({ required: false, blank: true, initial: "" }),
        size: new fields.StringField({ required: false, blank: true, initial: "" }),
        age: new fields.StringField({ required: false, blank: true, initial: "" }),
        gender: new fields.StringField({ required: false, blank: true, initial: "" }),
        weight: new fields.StringField({ required: false, blank: true, initial: "" }),
        hair: new fields.StringField({ required: false, blank: true, initial: "" }),
        eyes: new fields.StringField({ required: false, blank: true, initial: "" }),
        skin: new fields.StringField({ required: false, blank: true, initial: "" })
      }),
      pets: new fields.ArrayField(
        new fields.StringField({ required: false, blank: true, initial: "" })
      ),
      showPets: new fields.StringField({ required: false, blank: true, initial: "true" }),
      banner: new fields.StringField({ required: false, blank: true, initial: "" }),
      criticalRange: new fields.NumberField({ required: false, integer: true, min: 1, initial: 20 }),
      equippedGear: new fields.ObjectField({ required: false, initial: {} })
    };
  }
}

class NpcActorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      biography: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      tags: new fields.ArrayField(
        new fields.StringField({ required: false, blank: true, initial: "" })
      ),
      origin: new fields.StringField({ required: false, blank: true, initial: "" }),
      motive: new fields.StringField({ required: false, blank: true, initial: "" }),
      bond: new fields.StringField({ required: false, blank: true, initial: "" }),
      deity: new fields.StringField({ required: false, blank: true, initial: "" }),
      health: buildResourceField(),
      barrier: buildResourceField(),
      ability_order: new fields.ObjectField({ required: false, initial: {} }),
      pet_order: new fields.ArrayField(
        new fields.StringField({ required: false, blank: true, initial: "" })
      ),
      primary_attributes: buildPrimaryAttributesField(),
      secondary_attributes: buildSecondaryAttributesField(),
      size: new fields.StringField({ required: false, blank: true, initial: "" }),
      specie: new fields.StringField({ required: false, blank: true, initial: "" })
    };
  }
}

class PetActorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      traits: new fields.StringField({ required: false, blank: true, initial: "" }),
      tags: new fields.ArrayField(
        new fields.StringField({ required: false, blank: true, initial: "" })
      ),
      pet_ability: new fields.SchemaField({
        ability_name: new fields.StringField({ required: false, blank: true, initial: "" }),
        ...buildAbilityFields()
      }),
      speed: new fields.SchemaField({
        value: new fields.NumberField({ required: false, integer: true, min: 0, initial: 5 }),
        unit: new fields.StringField({ required: false, blank: true, initial: "squares" })
      }),
      ability_order: new fields.ObjectField({ required: false, initial: {} }),
      abilities: new fields.ArrayField(new fields.AnyField({ required: false }))
    };
  }
}

class ConsumableItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...buildItemFields(),
      ...buildInventoryFields(),
      ...buildAbilityFields()
    };
  }
}

class LimitBreakItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...buildItemFields(),
      ...buildAbilityFields()
    };
  }
}

class AbilityItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...buildItemFields(),
      ...buildAbilityFields()
    };
  }
}

class TraitItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...buildItemFields(),
      ...buildModifierFields(),
      activable: new fields.BooleanField({ required: false, initial: false }),
      active: new fields.BooleanField({ required: false, initial: false }),
      limitations_status: new fields.ArrayField(
        new fields.StringField({ required: false, blank: true, initial: "" })
      ),
      limitations_max: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
      job_resources_max: new fields.NumberField({ required: false, integer: true, min: 0, initial: 0 }),
      job_resource_status: new fields.ArrayField(
        new fields.BooleanField({ required: false, initial: false })
      )
    };
  }
}

class CurrencyItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...buildItemFields(),
      quantity: new fields.NumberField({ required: false, integer: true, min: 0, initial: 1 })
    };
  }
}

class TitleItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...buildItemFields(),
      ...buildModifierFields()
    };
  }
}

class GearItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...buildItemFields(),
      ...buildInventoryFields(),
      ...buildModifierFields(),
      classes: new fields.ArrayField(
        new fields.StringField({ required: false, blank: true, initial: "" })
      ),
      category: new fields.StringField({ required: false, blank: true, initial: "" }),
      subcategory: new fields.StringField({ required: false, blank: true, initial: "" })
    };
  }
}

class MinionItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...buildItemFields(),
      ...buildAbilityFields(),
      traits: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      shop_tier: new fields.StringField({ required: false, blank: true, initial: "" }),
      minion_type: new fields.StringField({ required: false, blank: true, initial: "" }),
      price: buildPriceField()
    };
  }
}

class AugmentItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...buildItemFields(),
      ...buildInventoryFields(),
      ...buildAbilityFields(),
      granted_ability: new fields.StringField({ required: false, blank: true, initial: "" })
    };
  }
}

export function registerDataModels() {
  Object.assign(CONFIG.Actor.dataModels, {
    "ffxiv.character": CharacterActorData,
    "ffxiv.npc": NpcActorData,
    "ffxiv.pet": PetActorData
  });

  Object.assign(CONFIG.Item.dataModels, {
    "ffxiv.consumable": ConsumableItemData,
    "ffxiv.limit_break": LimitBreakItemData,
    "ffxiv.primary_ability": AbilityItemData,
    "ffxiv.secondary_ability": AbilityItemData,
    "ffxiv.instant_ability": AbilityItemData,
    "ffxiv.trait": TraitItemData,
    "ffxiv.currency": CurrencyItemData,
    "ffxiv.title": TitleItemData,
    "ffxiv.gear": GearItemData,
    "ffxiv.minion": MinionItemData,
    "ffxiv.augment": AugmentItemData
  });
}
