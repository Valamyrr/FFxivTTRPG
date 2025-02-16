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
  }
}

FF_XIV.attributesAbbreviations = {
  "Strength":{
    "value":"STR",
    "label":"FFXIV.CharacterSheet.Attributes.Strength.abbrv"
  },
  "Dexterity":{
    "value":"DEX",
    "label":"FFXIV.CharacterSheet.Attributes.Dexterity.abbrv"
  },
  "Vitality":{
    "value":"VIT",
    "label":"FFXIV.CharacterSheet.Attributes.Vitality.abbrv"
  },
  "Intelligence":{
    "value":"INT",
    "label":"FFXIV.CharacterSheet.Attributes.Intelligence.abbrv"
  },
  "Mind":{
      "value":"MND",
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

FF_XIV.classes = {
  "warrior": {
    "value":"warrior",
    "label":"FFXIV.Classes.Warrior",
    "role": "tank",
    "role_label": "FFXIV.Roles.Tank"
  },
  "whitemage":{
    "value":"whitemage",
    "label":"FFXIV.Classes.WhiteMage",
    "role":"healer",
    "role_label": "FFXIV.Roles.Healer"
  },
  "dragoon":{
    "value":"dragoon",
    "label":"FFXIV.Classes.Dragoon",
    "role":"dps",
    "role_label": "FFXIV.Roles.DPS"
  },
  "blackmage":{
    "value":"blackmage",
    "label":"FFXIV.Classes.BlackMage",
    "role":"dps",
    "role_label": "FFXIV.Roles.DPS"
  }
}

FF_XIV.inventory_items = [
  "consumable",
]

FF_XIV.tags_abilities = {
  "primary":{
    "value":"primary",
    "label":"FFXIV.Tags.Primary"
  },
  "secondary":{
    "value":"secondary",
    "label":"FFXIV.Tags.Secondary"
  },
  "instant":{
    "value":"instant",
    "label":"FFXIV.Tags.Instant"
  },
  "limitbreak":{
    "value":"limitbreak",
    "label":"FFXIV.Tags.LimitBreak"
  },
  "invoked":{
    "value":"invoked",
    "label":"FFXIV.Tags.Invoked"
  },
  "magic":{
    "value":"magic",
    "label":"FFXIV.Tags.Magic"
  },
  "physical":{
    "value":"physical",
    "label":"FFXIV.Tags.Physical"
  },
  "earthaspected":{
    "value":"earthaspected",
    "label":"FFXIV.Tags.EarthAspected"
  },
  "windaspected":{
    "value":"windaspected",
    "label":"FFXIV.Tags.WindAspected"
  },
  "fireaspected":{
    "value":"fireaspected",
    "label":"FFXIV.Tags.FireAspected"
  },
  "iceaspected":{
    "value":"iceaspected",
    "label":"FFXIV.Tags.IceAspected"
  },
  "lightningaspected":{
    "value":"lightningaspected",
    "label":"FFXIV.Tags.LightningAspected"
  },
  "stationarymarker":{
    "value":"stationarymarker",
    "label":"FFXIV.Tags.StationaryMarker"
  }
}

FF_XIV.tags_traits = {
  "trait":{
    "value":"trait",
    "label":"FFXIV.Tags.Trait"
  },
  "enhancement":{
    "value":"enhancement",
    "label":"FFXIV.Tags.Enhancement"
  },
  "enfeeblement":{
    "value":"enfeeblement",
    "label":"FFXIV.Tags.Enfeeblement"
  }
}

FF_XIV.tags_consumables = {
  "primary":{
    "value":"primary",
    "label":"FFXIV.Tags.Primary"
  },
  "secondary":{
    "value":"enhancement",
    "label":"FFXIV.Tags.Secondary"
  },
  "instant":{
    "value":"instant",
    "label":"FFXIV.Tags.Instant"
  },
  "medicine":{
    "value":"medicine",
    "label":"FFXIV.Tags.Medicine"
  },
  "meal":{
    "value":"meal",
    "label":"FFXIV.Tags.Meal"
  },
  "other":{
    "value":"other",
    "label":"FFXIV.Tags.Other"
  }
}
