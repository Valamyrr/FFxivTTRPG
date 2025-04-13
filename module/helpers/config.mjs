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

FF_XIV.classes = {
  "paladin": {
    "value":"paladin",
    "label":"FFXIV.Classes.Paladin",
    "labelShort":"FFXIV.Classes.PaladinShort",
    "role":"tank",
    "role_label":"FFXIV.Roles.Tank",
  },
  "warrior": {
    "value":"warrior",
    "label":"FFXIV.Classes.Warrior",
    "labelshort": "FFXIV.Classes.WarriorShort",
    "role": "tank",
    "role_label": "FFXIV.Roles.Tank"
  },
  "darkknight": {
    "value":"darkknight",
    "label":"FFXIV.Classes.DarkKnight",
    "labelShort":"FFXIV.Classes.DarkKnightShort",
    "role":"tank",
    "role_label":"FFXIV.Roles.Tank",
  },
  "whitemage":{
    "value":"whitemage",
    "label":"FFXIV.Classes.WhiteMage",
    "labelshort": "FFXIV.Classes.WhiteMageShort",
    "role":"healer",
    "role_label": "FFXIV.Roles.Healer"
  },
  "scholar": {
    "value":"scholar",
    "label":"FFXIV.Classes.Scholar",
    "labelShort":"FFXIV.Classes.ScholarShort",
    "role":"healer",
    "role_label":"FFXIV.Roles.Healer",
  },
  "astrologian": {
    "value":"astrologian",
    "label":"FFXIV.Classes.Astrologian",
    "labelShort":"FFXIV.Classes.Astrologian",
    "role":"healer",
    "role_label":"FFXIV.Roles.Healer",
  },
  "monk": {
    "value":"monk",
    "label":"FFXIV.Classes.Monk",
    "labelShort":"FFXIV.Classes.MonkShort",
    "role":"dps",
    "role_label":"FFXIV.Roles.DPS",
  },
  "dragoon":{
    "value":"dragoon",
    "label":"FFXIV.Classes.Dragoon",
    "labelshort": "FFXIV.Classes.DragoonShort",
    "role":"dps",
    "role_label": "FFXIV.Roles.DPS"
  },
  "ninja": {
    "value":"ninja",
    "label":"FFXIV.Classes.Ninja",
    "labelShort":"FFXIV.Classes.NinjaShort",
    "role":"dps",
    "role_label":"FFXIV.Roles.DPS",
  },
  "bard": {
    "value":"bard",
    "label":"FFXIV.Classes.Bard",
    "labelShort":"FFXIV.Classes.BardShort",
    "role":"dps",
    "role_label":"FFXIV.Roles.DPS",
  },
  "machinist": {
    "value":"machinist",
    "label":"FFXIV.Classes.Machinist",
    "labelShort":"FFXIV.Classes.MachinistShort",
    "role":"dps",
    "role_label":"FFXIV.Roles.DPS",
  },
  "blackmage":{
    "value":"blackmage",
    "label":"FFXIV.Classes.BlackMage",
    "labelshort": "FFXIV.Classes.BlackMageShort",
    "role":"dps",
    "role_label": "FFXIV.Roles.DPS"
  },
  "summoner": {
    "value":"summoner",
    "label":"FFXIV.Classes.Summoner",
    "labelShort":"FFXIV.Classes.SummonerShort",
    "role":"dps",
    "role_label":"FFXIV.Roles.DPS",
  }
}

FF_XIV.inventory_items = [
  "consumable",
  "gear"
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
  "ranged":{
    "value":"ranged",
    "label":"FFXIV.Tags.Ranged"
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
  "wateraspected":{
    "value":"wateraspected",
    "label":"FFXIV.Tags.WaterAspected"
  },
  "thunderspell":{
    "value":"thunderspell",
    "label":"FFXIV.Tags.ThunderSpell"
  },
  "song":{
    "value":"song",
    "label":"FFXIV.Tags.Song"
  },
  "flurry":{
    "value":"flurry",
    "label":"FFXIV.Tags.Flurry"
  },
  "poison":{
    "value":"poison",
    "label":"FFXIV.Tags.Poison"
  },
  "ninjutsu":{
    "value":"ninjutsu",
    "label":"FFXIV.Tags.Ninjutsu"
  },
  "gem":{
    "value":"gem",
    "label":"FFXIV.Tags.Gem"
  },
  "jobresource":{
    "value":"jobresource",
    "label":"FFXIV.Tags.JobResource"
  },
  "stationarymarker":{
    "value":"stationarymarker",
    "label":"FFXIV.Tags.StationaryMarker"
  },
  "pet":{
    "value":"pet",
    "label":"FFXIV.Tags.Pet"
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
  },
  "song":{
    "value":"song",
    "label":"FFXIV.Tags.Song"
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

FF_XIV.minion_types = [
  "FFXIV.Tags.Minion",
  "FFXIV.Tags.Mount"
]

 FF_XIV.levels = {
  "1": { "EXP": 0, "Total": 0 },
  "2": { "EXP": 300, "Total": 300 },
  "3": { "EXP": 450, "Total": 750 },
  "4": { "EXP": 630, "Total": 1380 },
  "5": { "EXP": 970, "Total": 2350 },
  "6": { "EXP": 1440, "Total": 3790 },
  "7": { "EXP": 1940, "Total": 5730 },
  "8": { "EXP": 3000, "Total": 8730 },
  "9": { "EXP": 3920, "Total": 12650 },
  "10": { "EXP": 4970, "Total": 17620 },
  "11": { "EXP": 5900, "Total": 23520 },
  "12": { "EXP": 7430, "Total": 30950 },
  "13": { "EXP": 8620, "Total": 39570 },
  "14": { "EXP": 10200, "Total": 49770 },
  "15": { "EXP": 11300, "Total": 61070 },
  "16": { "EXP": 13100, "Total": 74170 },
  "17": { "EXP": 15200, "Total": 89370 },
  "18": { "EXP": 17400, "Total": 106770 },
  "19": { "EXP": 19600, "Total": 126370 },
  "20": { "EXP": 21900, "Total": 148270 },
  "21": { "EXP": 24300, "Total": 172570 },
  "22": { "EXP": 27400, "Total": 199970 },
  "23": { "EXP": 30600, "Total": 230570 },
  "24": { "EXP": 33900, "Total": 264470 },
  "25": { "EXP": 37300, "Total": 301770 },
  "26": { "EXP": 40800, "Total": 342570 },
  "27": { "EXP": 49200, "Total": 391770 },
  "28": { "EXP": 54600, "Total": 446370 },
  "29": { "EXP": 61900, "Total": 508270 },
  "30": { "EXP": 65600, "Total": 573870 },
  "31": { "EXP": 68400, "Total": 642270 },
  "32": { "EXP": 74000, "Total": 716270 },
  "33": { "EXP": 82700, "Total": 798970 },
  "34": { "EXP": 88700, "Total": 887670 },
  "35": { "EXP": 95000, "Total": 982670 },
  "36": { "EXP": 102000, "Total": 1084670 },
  "37": { "EXP": 113000, "Total": 1197670 },
  "38": { "EXP": 121000, "Total": 1318670 },
  "39": { "EXP": 133000, "Total": 1451670 },
  "40": { "EXP": 142000, "Total": 1593670 },
  "41": { "EXP": 155000, "Total": 1748670 },
  "42": { "EXP": 163000, "Total": 1911670 },
  "43": { "EXP": 171000, "Total": 2082670 },
  "44": { "EXP": 179000, "Total": 2261670 },
  "45": { "EXP": 187000, "Total": 2448670 },
  "46": { "EXP": 195000, "Total": 2643670 },
  "47": { "EXP": 214000, "Total": 2857670 },
  "48": { "EXP": 229000, "Total": 3086670 },
  "49": { "EXP": 244000, "Total": 3330670 },
  "50": { "EXP": 259000, "Total": 3589670 },
  "51": { "EXP": 421000, "Total": 4010670 },
  "52": { "EXP": 500000, "Total": 4510670 },
  "53": { "EXP": 580000, "Total": 5090670 },
  "54": { "EXP": 663000, "Total": 5753670 },
  "55": { "EXP": 749000, "Total": 6502670 },
  "56": { "EXP": 837000, "Total": 7339670 },
  "57": { "EXP": 927000, "Total": 8266670 },
  "58": { "EXP": 1019000, "Total": 9285670 },
  "59": { "EXP": 1114000, "Total": 10399670 },
  "60": { "EXP": 1211000, "Total": 11610670 },
  "61": { "EXP": 1387000, "Total": 12997670 },
  "62": { "EXP": 1456000, "Total": 14453670 },
  "63": { "EXP": 1534000, "Total": 15987670 },
  "64": { "EXP": 1621000, "Total": 17608670 },
  "65": { "EXP": 1720000, "Total": 19328670 },
  "66": { "EXP": 1834000, "Total": 21162670 },
  "67": { "EXP": 1968000, "Total": 23130670 },
  "68": { "EXP": 2126000, "Total": 25256670 },
  "69": { "EXP": 2317000, "Total": 27393670 },
  "70": { "EXP": 2550000, "Total": 29943670 },
  "71": { "EXP": 2923000, "Total": 32866670 },
  "72": { "EXP": 3018000, "Total": 35884670 },
  "73": { "EXP": 3153000, "Total": 39037670 },
  "74": { "EXP": 3324000, "Total": 42361670 },
  "75": { "EXP": 3532000, "Total": 45893670 },
  "76": { "EXP": 3770600, "Total": 49664270 },
  "77": { "EXP": 4066000, "Total": 53730270 },
  "78": { "EXP": 4377000, "Total": 58107270 },
  "79": { "EXP": 4777000, "Total": 62884270 },
  "80": { "EXP": 5256000, "Total": 68140270 },
  "81": { "EXP": 5992000, "Total": 74132270 },
  "82": { "EXP": 6171000, "Total": 80303270 },
  "83": { "EXP": 6942000, "Total": 87245270 },
  "84": { "EXP": 7205000, "Total": 94450270 },
  "85": { "EXP": 7948000, "Total": 102398270 },
  "86": { "EXP": 8287000, "Total": 110685270 },
  "87": { "EXP": 9231000, "Total": 119916270 },
  "88": { "EXP": 9529000, "Total": 129445270 },
  "89": { "EXP": 10459000, "Total": 139904270 },
  "90": { "EXP": 10838000, "Total": 150742270 }
}
