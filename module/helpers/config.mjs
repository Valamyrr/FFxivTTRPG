export const FF_XIV = {};

/**
 * The set of Ability Scores used within the system.
 * @type {Object}
 */
FF_XIV.attributes = {
  "Strength":{
    "value":"Strength",
    "label":"FFXIV.Attributes.Strength.long"
  },
  "Dexterity":{
    "value":"Dexterity",
    "label":"FFXIV.Attributes.Dexterity.long"
  },
  "Vitality":{
    "value":"Vitality",
    "label":"FFXIV.Attributes.Vitality.long"
  },
  "Intelligence":{
    "value":"Intelligence",
    "label":"FFXIV.Attributes.Intelligence.long"
  },
  "Mind":{
    "value":"Mind",
    "label":"FFXIV.Attributes.Mind.long"
  },
  "Defense":{
    "label":"FFXIV.Attributes.Defense"
  },
  "MagicDefense":{
    "label":"FFXIV.Attributes.MagicDefense"
  },
  "Vigilance":{
    "label":"FFXIV.Attributes.Vigilance"
  },
  "Speed":{
    "label":"FFXIV.Attributes.Speed"
  }
};

FF_XIV.characteristics = {
  "Health":{
    "label": "FFXIV.Health.long"
  },
  "Damages":{
    "label": "FFXIV.Damages"
  },
  "CriticalDamage":{
    "label": "FFXIV.CriticalDamage"
  },
  "BonusToHit": {
    "label": "FFXIV.BonusToHit"
  }
}

FF_XIV.attributesAbbreviations = {
  "Strength":{
    "value":"str",
    "label":"FFXIV.CharacterSheet.Attributes.Strength.abbrv"
  },
  "Dexterity":{
    "value":"dex",
    "label":"FFXIV.CharacterSheet.Attributes.Dexterity.abbrv"
  },
  "Vitality":{
    "value":"vit",
    "label":"FFXIV.CharacterSheet.Attributes.Vitality.abbrv"
  },
  "Intelligence":{
    "value":"int",
    "label":"FFXIV.CharacterSheet.Attributes.Intelligence.abbrv"
  },
  "Mind":{
    "value":"mnd",
    "label":"FFXIV.CharacterSheet.Attributes.Mind.abbrv"
  }
};


FF_XIV.rarities = {
    "basic": {
      "value": "basic",
      "label": "FFXIV.Rarities.Basic",
      "color": "#FFFFFF"
    },
    "aetherial": {
      "value": "aetherial",
      "label": "FFXIV.Rarities.Aetherial",
      "color": "#FF337F"
    },
    "green": {
      "value": "green",
      "label": "FFXIV.Rarities.Green",
      "color": "#44EE44"
    },
    "blue": {
      "value": "blue",
      "label": "FFXIV.Rarities.Blue",
      "color": "#7777EE"
    },
    "relic": {
      "value": "relic",
      "label": "FFXIV.Rarities.Relic",
      "color": "#800880"
    },
    "Unique": {
      "value": "unique",
      "label": "FFXIV.Rarities.Unique",
      "color": "#CD3131"
    }
};

FF_XIV.gear_categories = {
  "Arms": { "label": "FFXIV.GearCategories.Arms" },
  "Armor": { "label": "FFXIV.GearCategories.Armor" },
  "Accessories": { "label": "FFXIV.GearCategories.Accessories" }
}

FF_XIV.gear_subcategories = {
  "Arms":{
    "category": "Arms",
    "label": "FFXIV.GearCategories.Arms"
  },
  "Shield":{
    "category": "Armor",
    "label": "FFXIV.GearCategories.Shield"
  },
  "Head":{
    "category": "Armor",
    "label": "FFXIV.GearCategories.Head"
  },
  "Body":{
    "category": "Armor",
    "label": "FFXIV.GearCategories.Body"
  },
  "Ring":{
    "category": "Accessories",
    "label": "FFXIV.GearCategories.Ring"
  },
  "Necklace":{
    "category": "Accessories",
    "label": "FFXIV.GearCategories.Necklace"
  }
};

FF_XIV.roles = {
  "tank": {
    "value":"tank",
    "label":"FFXIV.Roles.Tank"
  },
  "healer":{
    "value":"healer",
    "label":"FFXIV.Roles.Healer"
  },
  "dps":{
    "value":"dps",
    "label":"FFXIV.Roles.DPS"
  }
}

FF_XIV.inventory_items = [
  "consumable",
  "gear"
]

FF_XIV.minion_types = [
  "FFXIV.Tags.Minion",
  "FFXIV.Tags.Mount"
]
