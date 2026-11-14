import { matchesContentKey } from "../helpers/content-keys.mjs";
import { FFXIV } from "../helpers/config.mjs";
import { debugLog } from "../helpers/debug.mjs";
import {
  getLegacyActiveEffectChangeMode,
  isLegacySubtractActiveEffectChangeMode,
  isLegacySubtractActiveEffectChangeType,
} from "../helpers/effect-utils.mjs";
import { getMigratableActorCompendiumPacks } from "./utils.mjs";
import { normalizeTagValue, parseTagSetting } from "../helpers/ability-subtype.mjs";

export function normalizeLegacySubtractActiveEffectChangeModes(effect) {
  const normalized = normalizeLegacySubtractActiveEffectChangeArray(
    effect?.system?.changes ??
    effect?.changes ??
    effect?._source?.system?.changes ??
    effect?._source?.changes,
  );
  if (!normalized) return false;
  if (typeof effect.updateSource === "function") {
    effect.updateSource({ "system.changes": normalized });
  }
  return true;
}

export function normalizeLegacySubtractActiveEffectUpdate(changes) {
  if (!changes || typeof changes !== "object") return false;

  let updated = false;
  for (const path of ["system.changes", "changes"]) {
    const normalized = normalizeLegacySubtractActiveEffectChangeArray(
      foundry.utils.getProperty(changes, path),
    );
    if (!normalized) continue;
    foundry.utils.setProperty(changes, path, normalized);
    updated = true;
  }

  for (const [key, value] of Object.entries(changes)) {
    const modeMatch = key.match(/^((?:system\.)?changes\.\d+)\.mode$/);
    if (modeMatch && isLegacySubtractActiveEffectChangeMode(value)) {
      delete changes[key];
      changes[`${modeMatch[1]}.type`] = "subtract";
      updated = true;
      continue;
    }

    const typeMatch = key.match(/^((?:system\.)?changes\.\d+)\.type$/);
    if (typeMatch && isLegacySubtractActiveEffectChangeType(value)) {
      changes[key] = "subtract";
      updated = true;
    }
  }

  return updated;
}

function normalizeLegacySubtractActiveEffectChangeArray(changes) {
  if (!Array.isArray(changes)) return null;

  let normalized = null;
  changes.forEach((change, index) => {
    if (!change || typeof change !== "object") return;
    const legacyMode = getLegacyActiveEffectChangeMode(change);
    if (
      !isLegacySubtractActiveEffectChangeMode(legacyMode) &&
      !isLegacySubtractActiveEffectChangeType(change.type)
    )
      return;

    normalized ??= foundry.utils.deepClone(changes);
    normalized[index].type = "subtract";
    delete normalized[index].mode;
  });
  return normalized;
}

export async function migrateLegacySubtractActiveEffectChangeModes() {
  if (!game.user?.isGM) return;

  let migrated = 0;
  for (const owner of getLegacySubtractActiveEffectOwners()) {
    const updates = [];
    for (const effect of owner.effects ?? []) {
      const normalized = normalizeLegacySubtractActiveEffectChangeArray(
        effect.system?.changes ?? effect.changes,
      );
      if (!normalized) continue;
      updates.push({ _id: effect.id, "system.changes": normalized });
    }
    if (!updates.length) continue;

    await owner.updateEmbeddedDocuments("ActiveEffect", updates, {
      render: false,
    });
    migrated += updates.length;
  }

  if (migrated) {
    console.log(`FFXIV | Migrated ${migrated} legacy subtract active effect changes.`);
  }
}

function getLegacySubtractActiveEffectOwners() {
  const owners = new Set();
  const addOwner = (owner) => {
    if (owner?.effects?.size) owners.add(owner);
  };
  for (const actor of game.actors ?? []) {
    addOwner(actor);
    for (const item of actor.items ?? []) addOwner(item);
  }
  for (const item of game.items ?? []) addOwner(item);
  return owners;
}

export function normalizeDashDirectHitText(item) {
  if (!item || typeof item !== "object") return false;
  const updates = getDashDirectHitTextUpdates(item);
  if (!Object.keys(updates).length) return false;
  if (typeof item.updateSource === "function") item.updateSource(updates);
  return true;
}

export function normalizeDashDirectHitTextUpdate(changes) {
  if (!changes || typeof changes !== "object") return false;

  let updated = false;
  for (const path of ["system.direct_hit", "system.pet_ability.direct_hit"]) {
    if (!isDashDirectHitText(foundry.utils.getProperty(changes, path))) continue;
    foundry.utils.setProperty(changes, path, "");
    updated = true;
  }
  for (const [key, value] of Object.entries(changes)) {
    if (
      (key === "system.direct_hit" || key === "system.pet_ability.direct_hit") &&
      isDashDirectHitText(value)
    ) {
      changes[key] = "";
      updated = true;
    }
  }
  return updated;
}

export async function migrateDashDirectHitText() {
  if (!game.user?.isGM) return;

  let migrated = 0;
  for (const item of game.items ?? []) {
    const patch = getDashDirectHitTextUpdates(item);
    if (!Object.keys(patch).length) continue;
    await item.update(patch, { render: false });
    migrated += 1;
  }

  for (const actor of game.actors ?? []) {
    const updates = [];
    for (const item of actor.items ?? []) {
      const patch = getDashDirectHitTextUpdates(item);
      if (!Object.keys(patch).length) continue;
      updates.push({ _id: item.id, ...patch });
    }
    if (!updates.length) continue;
    await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    migrated += updates.length;
  }

  if (migrated) {
    console.log(`FFXIV | Cleared ${migrated} dash-only direct hit text field(s).`);
  }
}

function getDashDirectHitTextUpdates(item) {
  const updates = {};
  if (isDashDirectHitText(item?.system?.direct_hit)) {
    updates["system.direct_hit"] = "";
  }
  if (isDashDirectHitText(item?.system?.pet_ability?.direct_hit)) {
    updates["system.pet_ability.direct_hit"] = "";
  }
  return updates;
}

function isDashDirectHitText(value) {
  return String(value ?? "").trim() === "-";
}

const BOOTSHINE_CRITICAL_FORCE_RULE = {
  requiresAny: [
    { key: "opo_opo_form", name: "Opo-Opo Form" },
    { key: "formless_fist", name: "Formless Fist" },
  ],
  rolls: ["direct"],
};

export async function migrateBootshineCriticalFlags() {
  if (!game.user?.isGM) return;

  let migrated = 0;
  for (const item of game.items ?? []) {
    const patch = getBootshineCriticalFlagPatch(item);
    if (!patch) continue;
    await item.update(patch, { render: false });
    migrated += 1;
  }

  for (const actor of game.actors ?? []) {
    const updates = [];
    for (const item of actor.items ?? []) {
      const patch = getBootshineCriticalFlagPatch(item);
      if (!patch) continue;
      updates.push({ _id: item.id, ...patch });
    }
    if (!updates.length) continue;
    await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    migrated += updates.length;
  }

  if (migrated) {
    console.log(`FFXIV | Migrated ${migrated} Bootshine critical flag(s).`);
  }
}

export async function migrateEssentialDignityHealingFlags() {
  if (!game.user?.isGM) return;

  let migrated = 0;
  for (const item of game.items ?? []) {
    const patch = getEssentialDignityHealingFlagPatch(item);
    if (!patch) continue;
    await item.update(patch, { render: false });
    migrated += 1;
  }

  for (const actor of game.actors ?? []) {
    const updates = [];
    for (const item of actor.items ?? []) {
      const patch = getEssentialDignityHealingFlagPatch(item);
      if (!patch) continue;
      updates.push({ _id: item.id, ...patch });
    }
    if (!updates.length) continue;
    await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    migrated += updates.length;
  }

  if (migrated) {
    console.log(`FFXIV | Migrated ${migrated} Essential Dignity healing flag(s).`);
  }
}

function getBootshineCriticalFlagPatch(item) {
  if (!item || item.type !== "ability" || !matchesContentKey(item, "bootshine")) return null;
  const current = foundry.utils.getProperty(item, "flags.ffxiv.critical.force");
  if (current !== undefined && current !== null && current !== "") return null;

  return {
    "flags.ffxiv.critical.force": [
      foundry.utils.deepClone(BOOTSHINE_CRITICAL_FORCE_RULE),
    ],
  };
}

function getEssentialDignityHealingFlagPatch(item) {
  if (!item || item.type !== "ability" || !matchesContentKey(item, "essential_dignity")) return null;
  const directFormula = String(item.system?.direct_formula ?? "").trim();
  const currentHealing = foundry.utils.getProperty(item, "flags.ffxiv.healing.application");
  const currentOverride = foundry.utils.getProperty(item, "flags.ffxiv.baseFormula.override");
  const currentEntries = Array.isArray(currentHealing)
    ? currentHealing
    : currentHealing
      ? [currentHealing]
      : [];
  const overrideEntries = Array.isArray(currentOverride)
    ? currentOverride
    : currentOverride
      ? [currentOverride]
      : [];
  const currentFormula = String(currentEntries[0]?.formula ?? "").trim();
  const overrideFormula = String(overrideEntries[0]?.formula ?? "").trim();
  const formula = isSimpleRollFormula(directFormula)
    ? directFormula
    : isSimpleRollFormula(overrideFormula)
      ? overrideFormula
      : isSimpleRollFormula(currentFormula)
        ? currentFormula
        : "";
  if (!formula) return null;

  const patch = {};
  let changed = false;
  if (directFormula) {
    patch["system.direct_formula"] = "";
    changed = true;
  }
  if (String(item.system?.direct_hit ?? "").trim() === "-") {
    patch["system.direct_hit"] = "";
    changed = true;
  }

  const nextOverride = [
    {
      operation: "replace",
      formula,
      when: {
        targetHp: {
          lte: "halfMax",
        },
      },
    },
  ];
  if (JSON.stringify(currentOverride) !== JSON.stringify(nextOverride)) {
    patch["flags.ffxiv.baseFormula.override"] = nextOverride;
    changed = true;
  }
  if (currentHealing !== undefined && currentHealing !== null) {
    patch["flags.ffxiv.-=healing"] = null;
    changed = true;
  }

  return changed ? patch : null;
}

function isSimpleRollFormula(value) {
  const formula = String(value ?? "").trim();
  return Boolean(formula && /^[\dd+\-*/ ().@a-z_]+$/i.test(formula) && /\d*d\d+/i.test(formula));
}

function hasStringContent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value !== "string") return false;
  const text = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return text.length > 0;
}

function getLegacyPetTraitsSource(pet) {
  return (
    pet._source?.system?.traits ??
    pet.toObject?.(false)?.system?.traits ??
    pet.system?.traits
  );
}

function buildMigratedPetTraitItemData(traits) {
  return {
    _id: foundry.utils.randomID(),
    name: "Migrated Trait",
    type: "trait",
    img: "icons/svg/aura.svg",
    system: {
      description: traits,
      tags: [],
      activable: false,
      modifiers: [],
      source: "",
    },
    flags: {
      ffxiv: {
        migratedTrait: true,
      },
    },
  };
}

function hasMigratedPetTraitItem(items) {
  return Array.from(items ?? []).some(
    (item) =>
      item.type === "trait" &&
      (item.flags?.ffxiv?.migratedTrait || item.name === "Migrated Trait"),
  );
}

function hasAnyPetTraitItem(items) {
  return Array.from(items ?? []).some((item) => item.type === "trait");
}

export async function migrateLegacyPetTraits({
  includeWorld = true,
  includeCompendiums = false,
} = {}) {
  if (includeWorld) {
    for (const pet of game.actors.filter((actor) => actor.type === "pet")) {
      const sourceTraits = getLegacyPetTraitsSource(pet);
      const traits = typeof sourceTraits === "string" ? sourceTraits : "";
      if (!hasStringContent(traits)) continue;
      const hasMigrated = hasMigratedPetTraitItem(pet.items);
      if (hasMigrated) continue;

      try {
        await pet.createEmbeddedDocuments("Item", [
          buildMigratedPetTraitItemData(traits),
        ]);
        await pet.update({ "system.traits": "" });
        debugLog(`FFXIV | Migrated traits for pet ${pet.name}`);
      } catch (error) {
        console.error(
          "FFXIV | Pet trait migration failed for",
          pet.name,
          error,
        );
      }
    }
  }

  if (!includeCompendiums) return;

  for (const pack of getMigratableActorCompendiumPacks()) {
    const updates = [];
    const pets = (await pack.getDocuments()).filter(
      (actor) => actor.type === "pet",
    );
    for (const pet of pets) {
      const sourceTraits = getLegacyPetTraitsSource(pet);
      const traits = typeof sourceTraits === "string" ? sourceTraits : "";
      if (!hasStringContent(traits)) continue;

      const itemData = Array.from(pet.items ?? []);
      if (hasMigratedPetTraitItem(itemData) || hasAnyPetTraitItem(itemData))
        continue;

      const source = pet.toObject(false);
      const items = Array.isArray(source.items) ? source.items : [];
      updates.push({
        _id: pet.id,
        "system.traits": "",
        items: [...items, buildMigratedPetTraitItemData(traits)],
      });
    }

    if (!updates.length) continue;
    try {
      await pack.documentClass.updateDocuments(updates, {
        pack: pack.collection,
        render: false,
      });
      debugLog(
        `FFXIV | Migrated traits for ${updates.length} compendium pet(s) in ${pack.collection}`,
      );
    } catch (error) {
      console.error(
        `FFXIV | Pet trait migration failed for compendium ${pack.collection}`,
        error,
      );
    }
  }
}

export async function migrateActorCurrencyToFortune() {
  for (const actor of game.actors.filter(
    (entry) => entry.type === "character",
  )) {
    const currencyItems = actor.items.filter(
      (item) => item.type === "currency",
    );
    if (!currencyItems.length) continue;

    const migratedFortune = currencyItems.reduce((total, item) => {
      const quantity = Number.parseInt(item.system?.quantity, 10);
      return total + (Number.isFinite(quantity) ? quantity : 0);
    }, 0);

    const currentFortune = Number.parseInt(actor.system?.fortune, 10);
    const nextFortune = Math.max(
      (Number.isFinite(currentFortune) ? currentFortune : 0) + migratedFortune,
      0,
    );

    try {
      await actor.update({ "system.fortune": nextFortune });
      await actor.deleteEmbeddedDocuments(
        "Item",
        currencyItems.map((item) => item.id),
      );
      debugLog(
        `FFXIV | Migrated ${currencyItems.length} currency item(s) to Fortune for ${actor.name}`,
      );
    } catch (error) {
      console.error("FFXIV | Currency migration failed for", actor.name, error);
    }
  }
}

function remapLegacyAscendentStatusIds(statuses) {
  const source = Array.isArray(statuses)
    ? statuses
    : statuses instanceof Set
      ? Array.from(statuses)
      : [];
  if (!source.includes("ascendent")) return null;
  return Array.from(
    new Set(
      source.map((statusId) => (statusId === "ascendent" ? "transcendent" : statusId)),
    ),
  );
}

function getStatusEffectConfig(statusId) {
  return CONFIG.statusEffects?.find((status) => status.id === statusId);
}

async function migrateOwnerLegacyStatusEffects(owner, { refreshIcons = false } = {}) {
  const updates = [];
  for (const effect of owner?.effects ?? []) {
    const sourceStatuses = Array.isArray(effect._source?.statuses)
      ? effect._source.statuses
      : effect.statuses instanceof Set
        ? Array.from(effect.statuses)
        : [];
    const nextStatuses = remapLegacyAscendentStatusIds(sourceStatuses);
    const statusIds = nextStatuses ?? sourceStatuses;
    const update = { _id: effect.id };

    if (nextStatuses) update.statuses = nextStatuses;
    if (refreshIcons && statusIds.length === 1) {
      const status = getStatusEffectConfig(statusIds[0]);
      const img = status?.img || status?.icon || "";
      if (img && effect.img !== img) update.img = img;
    }

    if (Object.keys(update).length > 1) updates.push(update);
  }

  if (updates.length) {
    await owner.updateEmbeddedDocuments("ActiveEffect", updates, {
      render: false,
    });
  }
  return updates.length;
}

export async function migrateAscendentStatusIdToTranscendent() {
  if (!game.user?.isGM) return;

  let migratedItems = 0;
  let migratedEffects = 0;

  const remapStatusEntries = (entries) => {
    if (!Array.isArray(entries) || !entries.length) return null;
    let changed = false;
    const next = entries.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      if (entry.id !== "ascendent") return entry;
      changed = true;
      return { ...entry, id: "transcendent" };
    });
    return changed ? next : null;
  };

  const migrateItemStatusFields = async (item) => {
    const updates = {};
    if (item.system?.status_effect === "ascendent") {
      updates["system.status_effect"] = "transcendent";
    }
    const remappedEntries = remapStatusEntries(item.system?.status_effects);
    if (remappedEntries) updates["system.status_effects"] = remappedEntries;
    if (!Object.keys(updates).length) return;
    await item.update(updates, { render: false });
    migratedItems += 1;
  };

  for (const item of game.items ?? []) {
    await migrateItemStatusFields(item);
  }

  for (const actor of game.actors ?? []) {
    migratedEffects += await migrateOwnerLegacyStatusEffects(actor);
    for (const item of actor.items ?? []) {
      await migrateItemStatusFields(item);
      migratedEffects += await migrateOwnerLegacyStatusEffects(item);
    }
  }

  if (!migratedItems && !migratedEffects) return;
}

export async function refreshSceneActorStatusEffectsForLegacyIcons() {
  const processedActors = new Set();

  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens?.contents ?? []) {
      const actor = token.actor;
      if (!actor) continue;
      const key = actor.isToken ? token.uuid : actor.uuid;
      if (processedActors.has(key)) continue;
      processedActors.add(key);

      try {
        await migrateOwnerLegacyStatusEffects(actor, { refreshIcons: true });
      } catch (error) {
        console.error(
          "FFXIV | Failed to refresh legacy status icons for",
          actor.name,
          error,
        );
      }
    }
  }
}

export async function migrateCustomTagSettings() {
  const categories = [
    { configKey: "customAbilityTags", baseKey: "base_tags_abilities" },
    { configKey: "customTraitTags", baseKey: "base_tags_traits" },
    { configKey: "customConsumableTags", baseKey: "base_tags_consumables" },
  ];

  for (const { configKey, baseKey } of categories) {
    const baseTags = Array.isArray(FFXIV[baseKey]) ? FFXIV[baseKey] : [];
    const normalizedBase = new Set(baseTags.map(normalizeTagValue));
    const raw = game.settings.get("ffxiv", configKey);
    const customTags = parseTagSetting(raw);
    const filtered = customTags.filter(
      (tag) => !normalizedBase.has(normalizeTagValue(tag)),
    );
    const hasChanged =
      filtered.length !== customTags.length ||
      filtered.some((tag, idx) => tag !== customTags[idx]);
    if (!hasChanged) continue;
    await game.settings.set("ffxiv", configKey, filtered.join(","));
  }
}
