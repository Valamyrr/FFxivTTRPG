export const ABILITY_SUBTYPE_TYPES = [
  "primary_ability",
  "secondary_ability",
  "instant_ability",
  "limit_break",
];

const ABILITY_SUBTYPE_TAGS = {
  primary_ability: "Primary",
  secondary_ability: "Secondary",
  instant_ability: "Instant",
  limit_break: "Limit Break",
};

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function legacyTypeToSubtype(type) {
  if (ABILITY_SUBTYPE_TYPES.includes(type)) return type;
  return "";
}

function tagToSubtype(tag) {
  const normalized = normalize(tag);
  if (!normalized) return "";
  if (normalized === "primary") return "primary_ability";
  if (normalized === "secondary") return "secondary_ability";
  if (normalized === "instant") return "instant_ability";
  if (normalized === "limitbreak") return "limit_break";
  return "";
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
) {
  const source = Array.isArray(tags) ? tags : [];
  const next = [];
  let chosenSubtype = fallbackSubtype;
  let chosen = false;

  for (const tag of source) {
    const subtype = tagToSubtype(tag);
    if (!subtype) {
      next.push(tag);
      continue;
    }
    if (!chosen) {
      chosenSubtype = subtype;
      chosen = true;
    }
  }

  next.unshift(getSubtypeTagLabel(chosenSubtype));
  return next;
}
