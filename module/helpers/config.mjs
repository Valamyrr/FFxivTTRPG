import { getShopTierChoices } from "./shop-tier.mjs";

export const FFXIV = {};

/**
 * The set of Ability Scores used within the system.
 * @type {Object}
 */
FFXIV.attributes = {
  Strength: {
    value: "Strength",
    label: "FFXIV.Attributes.Strength.long",
  },
  Dexterity: {
    value: "Dexterity",
    label: "FFXIV.Attributes.Dexterity.long",
  },
  Vitality: {
    value: "Vitality",
    label: "FFXIV.Attributes.Vitality.long",
  },
  Intelligence: {
    value: "Intelligence",
    label: "FFXIV.Attributes.Intelligence.long",
  },
  Mind: {
    value: "Mind",
    label: "FFXIV.Attributes.Mind.long",
  },
  Defense: {
    label: "FFXIV.Attributes.Defense",
  },
  MagicDefense: {
    label: "FFXIV.Attributes.MagicDefense",
  },
  Vigilance: {
    label: "FFXIV.Attributes.Vigilance",
  },
  Speed: {
    label: "FFXIV.Attributes.Speed",
  },
};

FFXIV.characteristics = {
  Health: {
    label: "FFXIV.Health.long",
  },
  Damages: {
    label: "FFXIV.Damages",
  },
  CriticalDamage: {
    label: "FFXIV.CriticalDamage",
  },
  BonusToHit: {
    label: "FFXIV.BonusToHit",
  },
};

FFXIV.attributesAbbreviations = {
  Strength: {
    value: "str",
    label: "FFXIV.CharacterSheet.Attributes.Strength.abbrv",
  },
  Dexterity: {
    value: "dex",
    label: "FFXIV.CharacterSheet.Attributes.Dexterity.abbrv",
  },
  Vitality: {
    value: "vit",
    label: "FFXIV.CharacterSheet.Attributes.Vitality.abbrv",
  },
  Intelligence: {
    value: "int",
    label: "FFXIV.CharacterSheet.Attributes.Intelligence.abbrv",
  },
  Mind: {
    value: "mnd",
    label: "FFXIV.CharacterSheet.Attributes.Mind.abbrv",
  },
};

FFXIV.gear_categories = {
  Arms: { label: "FFXIV.GearCategories.Arms" },
  Armor: { label: "FFXIV.GearCategories.Armor" },
  Accessories: { label: "FFXIV.GearCategories.Accessories" },
};

FFXIV.gear_subcategories = {
  Arms: {
    category: "Arms",
    label: "FFXIV.GearCategories.Arms",
  },
  Shield: {
    category: "Armor",
    label: "FFXIV.GearCategories.Shield",
  },
  Head: {
    category: "Armor",
    label: "FFXIV.GearCategories.Head",
  },
  Body: {
    category: "Armor",
    label: "FFXIV.GearCategories.Body",
  },
  Ring: {
    category: "Accessories",
    label: "FFXIV.GearCategories.Ring",
  },
  Necklace: {
    category: "Accessories",
    label: "FFXIV.GearCategories.Necklace",
  },
};

FFXIV.roles = {
  tank: {
    value: "tank",
    label: "FFXIV.Roles.Tank",
  },
  healer: {
    value: "healer",
    label: "FFXIV.Roles.Healer",
  },
  dps: {
    value: "dps",
    label: "FFXIV.Roles.DPS",
  },
};

FFXIV.inventory_items = ["consumable", "gear"];

FFXIV.minion_types = ["FFXIV.Tags.Minion", "FFXIV.Tags.Mount"];

FFXIV.rarities = {
  basic: { value: "basic", label: "FFXIV.Rarities.Basic" },
  green: { value: "green", label: "FFXIV.Rarities.Green" },
  aetherial: { value: "aetherial", label: "FFXIV.Rarities.Aetherial" },
  blue: { value: "blue", label: "FFXIV.Rarities.Blue" },
  relic: { value: "relic", label: "FFXIV.Rarities.Relic" },
  unique: { value: "unique", label: "FFXIV.Rarities.Unique" },
};

FFXIV.formula_attributes = {
  str: { value: "str", label: "FFXIV.Attributes.Strength.long" },
  dex: { value: "dex", label: "FFXIV.Attributes.Dexterity.long" },
  vit: { value: "vit", label: "FFXIV.Attributes.Vitality.long" },
  int: { value: "int", label: "FFXIV.Attributes.Intelligence.long" },
  mnd: { value: "mnd", label: "FFXIV.Attributes.Mind.long" },
};

FFXIV.base_tags_abilities = [
  "FFXIV.Tags.Physical",
  "FFXIV.Tags.Ranged",
  "FFXIV.Tags.Magic",
  "FFXIV.Tags.Unique",
  "FFXIV.Tags.Invoked",
  "FFXIV.Tags.Gem",
  "FFXIV.Tags.WindAspected",
  "FFXIV.Tags.FireAspected",
  "FFXIV.Tags.EarthAspected",
  "FFXIV.Tags.WaterAspected",
  "FFXIV.Tags.LightningAspected",
  "FFXIV.Tags.IceAspected",
  "FFXIV.Tags.ThunderSpell",
  "FFXIV.Tags.Flurry",
  "FFXIV.Tags.Poison",
  "FFXIV.Tags.Song",
  "FFXIV.Tags.Ninjutsu",
  "FFXIV.Tags.Technique",
  "FFXIV.Tags.Pet",
  "FFXIV.Tags.StationaryMarker",
  "FFXIV.Tags.MobileMarker",
];

FFXIV.base_tags_traits = [
  "FFXIV.Tags.Trait",
  "FFXIV.Tags.Enhancement",
  "FFXIV.Tags.JobResource",
  "FFXIV.Tags.Machine",
];

FFXIV.base_tags_consumables = [
  "FFXIV.Tags.Primary",
  "FFXIV.Tags.Secondary",
  "FFXIV.Tags.Instant",
  "FFXIV.Tags.Physical",
  "FFXIV.Tags.Consumable",
  "FFXIV.Tags.Meal",
  "FFXIV.Tags.Rest",
  "FFXIV.Tags.Utility",
  "FFXIV.Tags.WindAspected",
  "FFXIV.Tags.FireAspected",
  "FFXIV.Tags.EarthAspected",
  "FFXIV.Tags.WaterAspected",
  "FFXIV.Tags.LightningAspected",
  "FFXIV.Tags.IceAspected",
];

FFXIV.shop_tiers = getShopTierChoices();
