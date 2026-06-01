import { FFXIV } from "./config.mjs";

export const ABILITY_SUBTYPE_TYPES = [
  "primary_ability",
  "secondary_ability",
  "instant_ability",
  "limit_break",
];

const ABILITY_SUBTYPE_TAGS = {
  primary_ability: "FFXIV.Tags.Primary",
  secondary_ability: "FFXIV.Tags.Secondary",
  instant_ability: "FFXIV.Tags.Instant",
  limit_break: "FFXIV.ItemType.limit_break",
};

const ABILITY_SUBTYPE_ALIASES = {
  primary_ability: ["Primary", "FFXIV.Tags.Primary"],
  secondary_ability: ["Secondary", "FFXIV.Tags.Secondary"],
  instant_ability: ["Instant", "FFXIV.Tags.Instant"],
  limit_break: ["Limit Break", "Limit-Break", "FFXIV.ItemType.limit_break"],
};

let subtypeAliasCache = null;
let bakedTagAliasCache = null;

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function localize(value) {
  const text = String(value ?? "");
  return globalThis.game?.i18n?.localize(text) ?? text;
}

function keyTailAliases(key) {
  const tail = String(key ?? "").split(".").pop() ?? "";
  const spaced = tail.replace(/([a-z])([A-Z])/g, "$1 $2");
  const underscored = tail.replace(/_/g, " ");

  return [
    tail,
    spaced,
    spaced.replace(/\s+/g, "-"),
    underscored,
    underscored.replace(/\s+/g, "-"),
  ];
}

function getSubtypeAliasLookup() {
  const language = globalThis.game?.i18n?.lang ?? "";
  if (subtypeAliasCache?.language === language) return subtypeAliasCache.lookup;

  const lookup = new Map();

  for (const [subtype, aliases] of Object.entries(ABILITY_SUBTYPE_ALIASES)) {
    for (const alias of aliases) {
      lookup.set(normalize(alias), subtype);
      lookup.set(normalize(localize(alias)), subtype);
    }
  }

  subtypeAliasCache = { language, lookup };
  return lookup;
}

function getBakedTagKeys() {
  return new Set([
    ...Object.values(ABILITY_SUBTYPE_TAGS),
    ...(Array.isArray(FFXIV.base_tags_abilities)
      ? FFXIV.base_tags_abilities
      : []),
    ...(Array.isArray(FFXIV.base_tags_traits)
      ? FFXIV.base_tags_traits
      : []),
    ...(Array.isArray(FFXIV.base_tags_consumables)
      ? FFXIV.base_tags_consumables
      : []),
  ]);
}

function getBakedTagAliasLookup() {
  const language = globalThis.game?.i18n?.lang ?? "";
  if (bakedTagAliasCache?.language === language)
    return bakedTagAliasCache.lookup;

  const lookup = new Map();

  for (const key of getBakedTagKeys()) {
    lookup.set(normalize(key), key);
    lookup.set(normalize(localize(key)), key);

    for (const alias of keyTailAliases(key)) {
      lookup.set(normalize(alias), key);
      lookup.set(normalize(localize(alias)), key);
    }
  }

  bakedTagAliasCache = { language, lookup };
  return lookup;
}

function legacyTypeToSubtype(type) {
  if (ABILITY_SUBTYPE_TYPES.includes(type)) return type;
  return "";
}

function tagToSubtype(tag) {
  const normalized = normalize(tag);
  if (!normalized) return "";
  const lookup = getSubtypeAliasLookup();
  return lookup.get(normalized) ?? lookup.get(normalize(localize(tag))) ?? "";
}

export function canonicalizeBakedTag(tag) {
  const normalized = normalize(tag);
  if (!normalized) return tag;

  const lookup = getBakedTagAliasLookup();
  return lookup.get(normalized) ?? lookup.get(normalize(localize(tag))) ?? tag;
}

export function canonicalizeBakedTags(tags) {
  if (!Array.isArray(tags)) return [];

  const next = [];
  const seen = new Set();

  for (const tag of tags) {
    const canonicalTag = canonicalizeBakedTag(tag);
    const normalized = normalize(canonicalTag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(canonicalTag);
  }

  return next;
}

export function getAbilitySubtype(itemLike) {
  const directType = legacyTypeToSubtype(itemLike?.type);
  if (directType) return directType;
  if (itemLike?.type !== "ability") return "";

  const tags = Array.isArray(itemLike?.system?.tags)
    ? itemLike.system.tags
    : [];

  for (const tag of tags) {
    const subtype = tagToSubtype(tag);
    if (subtype) return subtype;
  }

  return "";
}

export function getSubtypeTagLabel(subtype) {
  return ABILITY_SUBTYPE_TAGS[subtype] ?? ABILITY_SUBTYPE_TAGS.primary_ability;
}

export function ensureAbilitySubtypeTags(
  tags,
  fallbackSubtype = "primary_ability",
  {
    canonicalizeSubtypeTag = false,
    canonicalizeBakedTags: shouldCanonicalizeBakedTags = false,
  } = {},
) {
  const source = Array.isArray(tags) ? tags : [];
  const next = [];
  let chosenSubtype = fallbackSubtype;
  let chosenTag = "";
  let chosen = false;

  for (const tag of source) {
    const subtype = tagToSubtype(tag);

    if (!subtype) {
      next.push(shouldCanonicalizeBakedTags ? canonicalizeBakedTag(tag) : tag);
      continue;
    }

    if (!chosen) {
      chosenSubtype = subtype;
      chosenTag = tag;
      chosen = true;
    }
  }

  next.unshift(
    canonicalizeSubtypeTag || !chosenTag
      ? getSubtypeTagLabel(chosenSubtype)
      : chosenTag,
  );

  return shouldCanonicalizeBakedTags ? canonicalizeBakedTags(next) : next;
}
