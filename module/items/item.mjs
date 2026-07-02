import { debugError, debugLog } from "../helpers/debug.mjs";
import {
  applyStatusEffectChange,
  applyStatusEffectStackDelta,
  applyStatusEffectStackValue,
  getActorCheckPenalty,
  getActorCriticalRange,
  getLargestCheckPenalty,
  getStatusStackTotal,
  getTargetStatusAdvantage,
  hasStatus,
  isAdditiveStackableStatusEffect,
  isStackableStatusEffect,
} from "../helpers/status-effects.mjs";
import { normalizeShopTier } from "../helpers/shop-tier.mjs";
import {
  ABILITY_SUBTYPE_TYPES,
  ensureAbilitySubtypeTags,
  getAbilitySubtype,
  getSubtypeTagLabel,
} from "../helpers/ability-subtype.mjs";
import {
  getLimitBreakValue,
  isLimitBreakActive,
  playLimitBreakActivatedSound,
} from "../helpers/limit-break-hud.mjs";
import {
  applyActorJobResourceDelta,
  fillActorJobResource,
  getActorJobResourceCount,
  getActorLevel,
  hasActorJobResource,
  normalizeJobResourceName,
  setActorJobResourceCount,
} from "../helpers/job-resources.mjs";
import {
  createSummonTokenFromRequest,
  FFXIV_SUMMON_SOCKET_TYPE,
} from "../helpers/summons.mjs";
import {
  clearUserTargetsForTiming,
  TARGET_CLEAR_TIMINGS,
} from "../helpers/target-selection.mjs";
import { isAbilityAutomationEnabled } from "../helpers/automation.mjs";
import { emitToActiveGM, getActiveGM } from "../helpers/socket.mjs";

const SHOP_TIER_ITEM_TYPES = new Set([
  "consumable",
  "gear",
  "augment",
  "minion",
]);
const INVENTORY_ITEM_TYPES = new Set(["consumable", "gear", "augment"]);

/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class FFXIVItem extends Item {
  static _normalizeTag(tag) {
    return String(tag ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  static _tagMatches(tag, aliases) {
    const normalize = FFXIVItem._normalizeTag;
    const values = [tag, game.i18n.localize(String(tag ?? ""))].map(normalize);
    return aliases.some((alias) => {
      const expected = normalize(alias);
      const localized = normalize(game.i18n.localize(String(alias)));
      return values.includes(expected) || values.includes(localized);
    });
  }

  _hasConsumableTag() {
    const tags = Array.isArray(this.system?.tags) ? this.system.tags : [];
    if (!tags.length) return false;

    const normalize = FFXIVItem._normalizeTag;
    const localizedConsumable = game.i18n.localize("FFXIV.Tags.Consumable");
    const expected = new Set([
      normalize("FFXIV.Tags.Consumable"),
      normalize("Consumable"),
      normalize(localizedConsumable),
    ]);

    for (const tag of tags) {
      const raw = normalize(tag);
      if (expected.has(raw)) return true;

      const localized = normalize(game.i18n.localize(String(tag)));
      if (expected.has(localized)) return true;
    }
    return false;
  }

  async _consumeFromInventoryIfNeeded() {
    if (!this._hasConsumableTag()) return;
    if (this.parent?.documentName !== "Actor") return;
    if (!foundry.utils.hasProperty(this.system ?? {}, "quantity")) return;

    const quantity = Number.parseInt(this.system?.quantity, 10);
    const currentQuantity = Number.isFinite(quantity) ? quantity : 1;

    if (currentQuantity > 1) {
      await this.update({ "system.quantity": currentQuantity - 1 });
      return;
    }
    await this.delete();
  }

  /** @override */
  async _preCreate(data, options, userId) {
    const result = await super._preCreate(data, options, userId);
    if (result === false) return false;
    this._normalizeShopTierOnCreate(data);
    this._normalizeStackConfigOnCreate(data);
    this._normalizeAbilitySubtypeOnCreate(data);
    if (this.type === "job")
      this.updateSource({
        name: this._formatJobName(
          data.system?.job_name,
          data.system?.level,
          data.name,
        ),
      });
    return result;
  }

  /** @override */
  async _preUpdate(changed, options, userId) {
    const result = await super._preUpdate(changed, options, userId);
    if (result === false) return false;
    this._normalizeShopTierOnUpdate(changed);
    this._normalizeStackConfigOnUpdate(changed);
    this._normalizeAbilitySubtypeOnUpdate(changed);
    this._normalizeTagsOnUpdate(changed);
    if (this.type !== "job") return result;

    const jobName =
      foundry.utils.getProperty(changed, "system.job_name") ??
      this.system.job_name;
    const level =
      foundry.utils.getProperty(changed, "system.level") ?? this.system.level;
    if (
      foundry.utils.hasProperty(changed, "system.job_name") ||
      foundry.utils.hasProperty(changed, "system.level")
    ) {
      changed.name = this._formatJobName(jobName, level, this.name);
    }
    return result;
  }

  _hasShopTier() {
    return SHOP_TIER_ITEM_TYPES.has(this.type);
  }

  _normalizeShopTierOnCreate(data) {
    if (!this._hasShopTier()) return;
    const normalized = normalizeShopTier(
      data?.system?.shop_tier,
      data?.system?.shop_tier_custom,
    );
    this.updateSource({
      "system.shop_tier": normalized.shop_tier,
      "system.shop_tier_custom": normalized.shop_tier_custom,
    });
  }

  _normalizeShopTierOnUpdate(changed) {
    if (!this._hasShopTier()) return;
    const hasShopTierChange =
      foundry.utils.hasProperty(changed, "system.shop_tier") ||
      foundry.utils.hasProperty(changed, "system.shop_tier_custom");
    if (!hasShopTierChange) return;

    const nextShopTier = foundry.utils.hasProperty(changed, "system.shop_tier")
      ? foundry.utils.getProperty(changed, "system.shop_tier")
      : this.system.shop_tier;
    const nextShopTierCustom = foundry.utils.hasProperty(
      changed,
      "system.shop_tier_custom",
    )
      ? foundry.utils.getProperty(changed, "system.shop_tier_custom")
      : this.system.shop_tier_custom;
    const normalized = normalizeShopTier(nextShopTier, nextShopTierCustom);

    foundry.utils.setProperty(
      changed,
      "system.shop_tier",
      normalized.shop_tier,
    );
    foundry.utils.setProperty(
      changed,
      "system.shop_tier_custom",
      normalized.shop_tier_custom,
    );
  }

  _hasInventoryData() {
    return INVENTORY_ITEM_TYPES.has(this.type);
  }

  _normalizeAbilitySubtypeOnCreate(data) {
    if (this.type !== "ability") return;
    const normalizedTags = ensureAbilitySubtypeTags(
      data?.system?.tags,
      "primary_ability",
    );
    this.updateSource({ "system.tags": normalizedTags });
  }

  _normalizeAbilitySubtypeOnUpdate(changed) {
    if (this.type !== "ability") return;
    if (!foundry.utils.hasProperty(changed, "system.tags")) return;
    const incomingTags = foundry.utils.getProperty(changed, "system.tags");
    foundry.utils.setProperty(
      changed,
      "system.tags",
      ensureAbilitySubtypeTags(incomingTags, "primary_ability"),
    );
  }

  _normalizeTagsOnUpdate(changed) {
    if (!foundry.utils.hasProperty(changed, "system.tags")) return;
    const tags = foundry.utils.getProperty(changed, "system.tags");
    if (!Array.isArray(tags)) return;

    const seen = new Set();
    const normalizedTags = tags.filter((tag) => {
      const value = String(tag ?? "").trim();
      const localized = game.i18n.localize(value);
      const key = String(localized || value)
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^\p{Letter}\p{Number}]/gu, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    foundry.utils.setProperty(changed, "system.tags", normalizedTags);
  }

  _normalizeStackConfigOnCreate(data) {
    if (!this._hasInventoryData()) return;

    const maxStackRaw = data?.system?.max_stack;
    const hasMaxStack =
      maxStackRaw !== null &&
      maxStackRaw !== undefined &&
      String(maxStackRaw).trim() !== "";
    const stackFlag = data?.system?.stack === true;
    const maxStack = hasMaxStack
      ? Math.max(1, Number.parseInt(maxStackRaw, 10) || 1)
      : stackFlag
        ? 99
        : 1;

    this.updateSource({
      "system.max_stack": maxStack,
      "system.stack": maxStack > 1,
    });
  }

  _normalizeStackConfigOnUpdate(changed) {
    if (!this._hasInventoryData()) return;
    const hasStackChange =
      foundry.utils.hasProperty(changed, "system.max_stack") ||
      foundry.utils.hasProperty(changed, "system.stack");
    if (!hasStackChange) return;

    const incomingMaxStack = foundry.utils.hasProperty(
      changed,
      "system.max_stack",
    )
      ? foundry.utils.getProperty(changed, "system.max_stack")
      : this.system.max_stack;
    const incomingStack = foundry.utils.hasProperty(changed, "system.stack")
      ? foundry.utils.getProperty(changed, "system.stack")
      : this.system.stack;

    const hasMaxStack =
      incomingMaxStack !== null &&
      incomingMaxStack !== undefined &&
      String(incomingMaxStack).trim() !== "";
    const maxStack = hasMaxStack
      ? Math.max(1, Number.parseInt(incomingMaxStack, 10) || 1)
      : incomingStack
        ? 99
        : 1;

    foundry.utils.setProperty(changed, "system.max_stack", maxStack);
    foundry.utils.setProperty(changed, "system.stack", maxStack > 1);

    const quantity = foundry.utils.hasProperty(changed, "system.quantity")
      ? Number.parseInt(
          foundry.utils.getProperty(changed, "system.quantity"),
          10,
        ) || 0
      : Number.parseInt(this.system.quantity, 10) || 0;
    if (quantity > maxStack) {
      foundry.utils.setProperty(changed, "system.quantity", maxStack);
    }
  }

  _formatJobName(jobName, level, fallbackName = this.name) {
    const baseName =
      String(jobName ?? "").trim() ||
      String(fallbackName ?? "")
        .replace(/\s*\(LV\s*(?:\d+|\?\?)\)\s*$/i, "")
        .trim() ||
      game.i18n.localize("FFXIV.ItemType.job");
    const levelNumber = Number(level);
    const levelText =
      Number.isFinite(levelNumber) && levelNumber > 0
        ? String(levelNumber)
        : "??";
    return `${baseName} (LV ${levelText})`;
  }

  /** @override */
  _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    if (game.user.id !== userId) return;
    if (options.ffxivSkipAutoJobAssignment) return;
    this._assignJob(options).catch((err) =>
      ui.notifications.error(err, { console: true }),
    );
    this._assignAugmentGrantedAbilities(options).catch((err) =>
      ui.notifications.error(err, { console: true }),
    );
  }

  /** @override */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (game.user.id !== userId) return;
    if (this.type !== "augment") return;
    if (
      this.parent?.documentName !== "Actor" ||
      this.parent.type !== "character"
    )
      return;
    if (
      !foundry.utils.hasProperty(changed, "system.ability_grants") &&
      !foundry.utils.hasProperty(changed, "system.granted_ability")
    )
      return;
    this._grantAugmentAbilities({ render: false }).catch((err) =>
      ui.notifications.error(err, { console: true }),
    );
  }

  async _assignJob(options = {}) {
    if (this.type !== "job") return;
    if (
      this.parent?.documentName !== "Actor" ||
      this.parent.type !== "character"
    )
      return;

    const renderOptions = () =>
      options.render === false ? { render: false } : {};
    const otherJobs = this.parent.items.filter(
      (item) => item.type === "job" && item.id !== this.id,
    );
    if (otherJobs.length) {
      await this._deleteJobsWithGrantedAbilities(otherJobs, renderOptions());
    }
    await this._promptDeleteManualAbilitiesForJobAssignment(renderOptions());

    const maxHP = Number(this.system.health?.max) || 0;
    const jobName =
      String(this.system.job_name ?? "").trim() ||
      this.name.replace(/\s*\(LV\s*(?:\d+|\?\?)\)\s*$/i, "").trim();
    await this.parent.update(
      {
        "system.class.name": "custom",
        "system.class.name_custom": jobName || this.name,
        "system.class.role": this.system.role || "dps",
        "system.class.customIcon": this.img,
        "system.showPets": this._jobHasPets() ? "true" : "false",
        "system.experience.level.value": Number(this.system.level) || 30,
        "system.health.value": maxHP,
        "system.health.max": maxHP,
        "system.primary_attributes.strength.value":
          Number(this.system.primary_attributes?.strength?.value) || 0,
        "system.primary_attributes.dexterity.value":
          Number(this.system.primary_attributes?.dexterity?.value) || 0,
        "system.primary_attributes.vitality.value":
          Number(this.system.primary_attributes?.vitality?.value) || 0,
        "system.primary_attributes.intelligence.value":
          Number(this.system.primary_attributes?.intelligence?.value) || 0,
        "system.primary_attributes.mind.value":
          Number(this.system.primary_attributes?.mind?.value) || 0,
        "system.secondary_attributes.defense.value":
          Number(this.system.secondary_attributes?.defense?.value) || 0,
        "system.secondary_attributes.magic_defense.value":
          Number(this.system.secondary_attributes?.magic_defense?.value) || 0,
        "system.secondary_attributes.vigilance.value":
          Number(this.system.secondary_attributes?.vigilance?.value) || 0,
        "system.secondary_attributes.speed.value":
          Number(this.system.secondary_attributes?.speed?.value) || 0,
      },
      renderOptions(),
    );
    await this._grantJobAbilities(renderOptions());
    await this._grantJobPets(renderOptions());
    await this._stripEmbeddedJobAbilityGrantItems(renderOptions());
    ui.notifications.info(
      `${this.name} assigned as ${this.parent.name}'s job.`,
    );
  }

  async _stripEmbeddedJobAbilityGrantItems(options = {}) {
    if (this.type !== "job") return;
    if (
      this.parent?.documentName !== "Actor" ||
      this.parent.type !== "character"
    )
      return;

    const abilityGrants = Array.isArray(this.system.ability_grants)
      ? this.system.ability_grants
      : Object.values(this.system.ability_grants || {});
    const petGrants = Array.isArray(this.system.pet_grants)
      ? this.system.pet_grants
      : Object.values(this.system.pet_grants || {});
    let changed = false;
    const lightweightAbilityGrants = abilityGrants.map((grant) => {
      if (!grant || typeof grant !== "object" || !Object.hasOwn(grant, "item"))
        return grant;
      changed = true;
      const { item, ...rest } = grant;
      return rest;
    });
    const lightweightPetGrants = petGrants.map((grant) => {
      if (!grant || typeof grant !== "object" || !Object.hasOwn(grant, "actor"))
        return grant;
      changed = true;
      const { actor, ...rest } = grant;
      return rest;
    });
    if (!changed) return;

    await this.update(
      {
        "system.ability_grants": lightweightAbilityGrants,
        "system.pet_grants": lightweightPetGrants,
        "system.has_pets":
          lightweightPetGrants.length > 0 || this.system.has_pets === true,
      },
      {
        ...options,
        render: false,
        ffxivSkipActorSheetRefresh: true,
      },
    );
  }

  _getNormalizedAbilityGrants(rawGrants) {
    return (
      Array.isArray(rawGrants) ? rawGrants : Object.values(rawGrants || {})
    ).filter((grant) => grant?.uuid);
  }

  _getNormalizedPetGrants(rawGrants) {
    return (
      Array.isArray(rawGrants) ? rawGrants : Object.values(rawGrants || {})
    ).filter((grant) => grant?.uuid);
  }

  _jobHasPets() {
    if (this.type !== "job") return false;
    return (
      this._getNormalizedPetGrants(this.system.pet_grants).length > 0 ||
      this.system.has_pets === true
    );
  }

  _getLegacyAugmentGrant() {
    if (this.type !== "augment") return null;
    const legacyId = String(this.system?.granted_ability ?? "").trim();
    if (!legacyId) return null;
    const sourceItem = game.items.get(legacyId);
    if (!sourceItem) return null;
    return {
      uuid: sourceItem.uuid,
      name: sourceItem.name,
      type: sourceItem.type,
      item: sourceItem.toObject(),
    };
  }

  _getAugmentAbilityGrants() {
    const grants = this._getNormalizedAbilityGrants(this.system.ability_grants);
    if (grants.length) return grants;
    const legacyGrant = this._getLegacyAugmentGrant();
    return legacyGrant ? [legacyGrant] : [];
  }

  async _grantJobAbilities(options = {}) {
    const grants = this._getNormalizedAbilityGrants(this.system.ability_grants);
    if (!grants.length) return;

    const jobSources = new Set(
      this.parent.items
        .map((item) => item.flags?.ffxiv?.jobSourceUuid)
        .filter(Boolean),
    );
    const itemsToCreate = [];

    for (const grant of grants) {
      if (jobSources.has(grant.uuid)) continue;

      let itemData = grant.item ? foundry.utils.deepClone(grant.item) : null;
      if (!itemData) {
        const sourceItem = await fromUuid(grant.uuid);
        if (!sourceItem) continue;
        itemData = sourceItem.toObject();
      }
      if (ABILITY_SUBTYPE_TYPES.includes(itemData.type)) {
        const legacySubtype =
          getAbilitySubtype(itemData) || itemData.type || "primary_ability";
        const existingTags = Array.isArray(itemData?.system?.tags)
          ? itemData.system.tags
          : [];
        itemData.type = "ability";
        itemData.system = itemData.system || {};
        itemData.system.tags = ensureAbilitySubtypeTags(
          [getSubtypeTagLabel(legacySubtype), ...existingTags],
          legacySubtype,
        );
      }
      delete itemData._id;
      itemData.flags = foundry.utils.mergeObject(itemData.flags || {}, {
        ffxiv: {
          jobId: this.id,
          jobSourceUuid: grant.uuid,
        },
      });
      itemsToCreate.push(itemData);
    }

    if (itemsToCreate.length) {
      const created = await this.parent.createEmbeddedDocuments(
        "Item",
        itemsToCreate,
        options,
      );
      await this._syncJobAbilityOrder(created, options);
    }
  }

  async _grantJobPets(options = {}) {
    const grants = this._getNormalizedPetGrants(this.system.pet_grants);
    if (!grants.length) return;

    const actorPetIds = Array.isArray(this.parent.system?.pets)
      ? foundry.utils.deepClone(this.parent.system.pets)
      : [];
    const actorPetOrder = Array.isArray(this.parent.system?.pet_order)
      ? foundry.utils.deepClone(this.parent.system.pet_order)
      : [];
    const petSources = new Set(
      actorPetIds
        .map((id) => game.actors.get(id)?.flags?.ffxiv?.jobSourceUuid)
        .filter(Boolean),
    );
    const actorsToCreate = [];

    for (const grant of grants) {
      if (petSources.has(grant.uuid)) continue;

      let actorData = grant.actor ? foundry.utils.deepClone(grant.actor) : null;
      if (!actorData) {
        const sourceActor = await fromUuid(grant.uuid);
        if (!sourceActor || sourceActor.documentName !== "Actor") continue;
        actorData = sourceActor.toObject();
      }
      if (actorData.type !== "pet") continue;
      delete actorData._id;
      actorData.flags = foundry.utils.mergeObject(actorData.flags || {}, {
        ffxiv: {
          jobId: this.id,
          jobSourceUuid: grant.uuid,
          jobOwnerId: this.parent.id,
        },
      });
      actorsToCreate.push(actorData);
    }

    if (!actorsToCreate.length) return;

    const created = await Actor.createDocuments(actorsToCreate, options);
    const nextPets = [...actorPetIds];
    const nextPetOrder = actorPetOrder.filter((id) => actorPetIds.includes(id));
    for (const actor of created) {
      if (!nextPets.includes(actor.id)) nextPets.push(actor.id);
      if (!nextPetOrder.includes(actor.id)) nextPetOrder.push(actor.id);
    }
    await this.parent.update(
      {
        "system.pets": nextPets,
        "system.pet_order": nextPetOrder,
        "system.showPets": "true",
      },
      { render: options.render ?? false },
    );
  }

  _getAbilityOrderType(item) {
    if (item?.type === "trait") return "trait";
    const subtype = getAbilitySubtype(item);
    return ["primary_ability", "secondary_ability", "instant_ability"].includes(
      subtype,
    )
      ? subtype
      : "";
  }

  async _syncJobAbilityOrder(createdItems, options = {}) {

    const createdById = new Map(createdItems.map((it) => [it.id, it]));
    const uuidToCreatedId = new Map();
    for (const it of createdItems) {
      const src = it.flags?.ffxiv?.jobSourceUuid;
      if (src) uuidToCreatedId.set(src, it.id);
    }

    const createdByType = new Map();

    const grants = this._getNormalizedAbilityGrants(this.system?.ability_grants);
    for (const grant of grants) {
      if (!grant?.uuid) continue;
      const createdId = uuidToCreatedId.get(grant.uuid);
      if (!createdId) continue;
      const item = createdById.get(createdId);
      const type = this._getAbilityOrderType(item);
      if (!type) continue;
      if (!createdByType.has(type)) createdByType.set(type, []);
      createdByType.get(type).push(createdId);
    }
    if (!createdByType.size) return;

    let abilityOrder = foundry.utils.deepClone(
      this.parent.system?.ability_order || {},
    );
    if (
      !abilityOrder ||
      typeof abilityOrder !== "object" ||
      Array.isArray(abilityOrder)
    )
      abilityOrder = {};

    let changed = false;
    for (const [type, ids] of createdByType.entries()) {
      const allIds = this.parent.items
        .filter((item) => this._getAbilityOrderType(item) === type)
        .map((item) => item.id);
      const jobIds = this.parent.items
        .filter(
          (item) =>
            this._getAbilityOrderType(item) === type &&
            item.flags?.ffxiv?.jobId === this.id,
        )
        .map((item) => item.id);
      const remaining = Array.isArray(abilityOrder[type])
        ? abilityOrder[type].filter(
          (id) => allIds.includes(id) && !jobIds.includes(id),
        )
        : allIds.filter((id) => !jobIds.includes(id));
      abilityOrder[type] = [...ids, ...remaining];
      changed = true;
    }

    if (changed) {
      await this.parent.update(
        { "system.ability_order": abilityOrder },
        { render: options.render ?? false },
      );
    }
  }

  _normalizeAbilityName(name) {
    return String(name ?? "").trim().toLocaleLowerCase();
  }

  _isAbilityOrTraitItem(item) {
    return (
      item?.type === "ability" ||
      item?.type === "trait" ||
      ABILITY_SUBTYPE_TYPES.includes(item?.type)
    );
  }

  async _getAugmentGrantedAbilityNames() {
    const names = new Set();
    const augments = this.parent.items.filter((item) => item.type === "augment");

    for (const augment of augments) {
      const grants = augment._getAugmentAbilityGrants?.() ?? [];
      for (const grant of grants) {
        const grantName = this._normalizeAbilityName(grant?.name);
        if (grantName) names.add(grantName);
        if (grant?.item?.name) {
          names.add(this._normalizeAbilityName(grant.item.name));
        } else if (grant?.uuid) {
          const sourceItem = await fromUuid(grant.uuid);
          const sourceName = this._normalizeAbilityName(sourceItem?.name);
          if (sourceName) names.add(sourceName);
        }
      }
    }

    return names;
  }

  async _getManualAbilityItems() {
    const augmentGrantedNames = await this._getAugmentGrantedAbilityNames();
    return this.parent.items.filter(
      (item) =>
        this._isAbilityOrTraitItem(item) &&
        !item.flags?.ffxiv?.augmentId &&
        !item.flags?.ffxiv?.augmentSourceUuid &&
        !item.flags?.ffxiv?.jobId &&
        !item.flags?.ffxiv?.jobSourceUuid &&
        !augmentGrantedNames.has(this._normalizeAbilityName(item.name)),
    );
  }

  async _promptDeleteManualAbilitiesForJobAssignment(options = {}) {
    const abilities = await this._getManualAbilityItems();
    if (!abilities.length) return;

    const confirmed = await foundry.applications.api.DialogV2.wait({
      id: `ffxiv-remove-existing-abilities-${this.parent.id}`,
      window: {
        title: game.i18n.localize(
          "FFXIV.Dialogs.RemoveExistingAbilitiesTitle",
        ),
      },
      content: `<p>${game.i18n.format("FFXIV.Dialogs.RemoveExistingAbilitiesForJob", {
        actor: this.parent.name,
        count: abilities.length,
        job: this.name,
      })}</p>`,
      buttons: [
        {
          label: game.i18n.localize("FFXIV.Dialogs.Yes"),
          action: "yes",
          type: "submit",
          default: true,
          callback: () => true,
        },
        {
          label: game.i18n.localize("FFXIV.Dialogs.No"),
          action: "no",
          type: "cancel",
          callback: () => false,
        },
      ],
    });
    if (!confirmed) return;

    const idsToDelete = abilities.map((item) => item.id);
    if (idsToDelete.length)
      await this.parent.deleteEmbeddedDocuments("Item", idsToDelete, options);
  }

  async _assignAugmentGrantedAbilities(options = {}) {
    if (this.type !== "augment") return;
    if (
      this.parent?.documentName !== "Actor" ||
      this.parent.type !== "character"
    )
      return;
    const renderOptions = options.render === false ? { render: false } : {};
    await this._grantAugmentAbilities(renderOptions);
  }

  async _grantAugmentAbilities(options = {}) {
    const grants = this._getAugmentAbilityGrants();
    if (!grants.length) return;

    const augmentSources = new Set(
      this.parent.items
        .map((item) => item.flags?.ffxiv?.augmentSourceUuid)
        .filter(Boolean),
    );
    const itemsToCreate = [];

    for (const grant of grants) {
      if (!grant?.uuid || augmentSources.has(grant.uuid)) continue;

      let itemData = grant.item ? foundry.utils.deepClone(grant.item) : null;
      if (!itemData) {
        const sourceItem = await fromUuid(grant.uuid);
        if (!sourceItem) continue;
        itemData = sourceItem.toObject();
      }
      if (ABILITY_SUBTYPE_TYPES.includes(itemData.type)) {
        const legacySubtype =
          getAbilitySubtype(itemData) || itemData.type || "primary_ability";
        const existingTags = Array.isArray(itemData?.system?.tags)
          ? itemData.system.tags
          : [];
        itemData.type = "ability";
        itemData.system = itemData.system || {};
        itemData.system.tags = ensureAbilitySubtypeTags(
          [getSubtypeTagLabel(legacySubtype), ...existingTags],
          legacySubtype,
        );
      }
      delete itemData._id;
      itemData.flags = foundry.utils.mergeObject(itemData.flags || {}, {
        ffxiv: {
          augmentId: this.id,
          augmentSourceUuid: grant.uuid,
        },
      });
      itemsToCreate.push(itemData);
    }

    if (itemsToCreate.length)
      await this.parent.createEmbeddedDocuments("Item", itemsToCreate, options);
  }

  async _deleteAugmentWithGrantedAbilities(options = {}) {
    if (!this.parent || this.type !== "augment") return;
    const grants = this._getAugmentAbilityGrants();
    const grantedUuids = new Set(
      grants.map((grant) => grant.uuid).filter(Boolean),
    );
    const otherAugmentGrantUuids = new Set(
      this.parent.items
        .filter((item) => item.type === "augment" && item.id !== this.id)
        .flatMap((item) => {
          const raw = Array.isArray(item.system?.ability_grants)
            ? item.system.ability_grants
            : Object.values(item.system?.ability_grants || {});
          const uuids = raw.map((grant) => grant?.uuid).filter(Boolean);
          if (uuids.length) return uuids;
          const legacyId = String(item.system?.granted_ability ?? "").trim();
          if (!legacyId) return [];
          const legacyItem = game.items.get(legacyId);
          return legacyItem?.uuid ? [legacyItem.uuid] : [];
        }),
    );
    const grantedItems = this.parent.items.filter(
      (item) =>
        item.flags?.ffxiv?.augmentId === this.id ||
        (grantedUuids.has(item.flags?.ffxiv?.augmentSourceUuid) &&
          !otherAugmentGrantUuids.has(item.flags?.ffxiv?.augmentSourceUuid)),
    );
    const idsToDelete = grantedItems.map((item) => item.id);
    if (idsToDelete.length)
      await this.parent.deleteEmbeddedDocuments("Item", idsToDelete, options);
  }

  /** @override */
  async _preDelete(options, user) {
    const result = await super._preDelete(options, user);
    if (result === false) return false;
    if (this.type === "augment" && this.parent?.documentName === "Actor") {
      await this._deleteAugmentWithGrantedAbilities({ render: false });
    }
    return result;
  }

  async _deleteJobsWithGrantedAbilities(jobs, options = {}) {
    const jobIds = new Set(jobs.map((job) => job.id));
    const grantedUuids = new Set(
      jobs.flatMap((job) => {
        const rawGrants = job.system?.ability_grants;
        const grants = Array.isArray(rawGrants)
          ? rawGrants
          : Object.values(rawGrants || {});
        return grants.map((grant) => grant.uuid).filter(Boolean);
      }),
    );
    const grantedPetUuids = new Set(
      jobs.flatMap((job) => {
        const rawGrants = job.system?.pet_grants;
        const grants = Array.isArray(rawGrants)
          ? rawGrants
          : Object.values(rawGrants || {});
        return grants.map((grant) => grant.uuid).filter(Boolean);
      }),
    );
    const grantedItems = this.parent.items.filter(
      (item) =>
        jobIds.has(item.flags?.ffxiv?.jobId) ||
        grantedUuids.has(item.flags?.ffxiv?.jobSourceUuid),
    );
    const idsToDelete = [...jobs, ...grantedItems].map((item) => item.id);
    if (idsToDelete.length)
      await this.parent.deleteEmbeddedDocuments("Item", idsToDelete, options);

    const actorPetIds = Array.isArray(this.parent.system?.pets)
      ? this.parent.system.pets
      : [];
    const grantedPets = actorPetIds
      .map((id) => game.actors.get(id))
      .filter(
        (actor) =>
          actor &&
          (jobIds.has(actor.flags?.ffxiv?.jobId) ||
            grantedPetUuids.has(actor.flags?.ffxiv?.jobSourceUuid)),
      );
    if (!grantedPets.length) return;

    const grantedPetIds = new Set(grantedPets.map((actor) => actor.id));
    const nextPets = actorPetIds.filter((id) => !grantedPetIds.has(id));
    const nextPetOrder = Array.isArray(this.parent.system?.pet_order)
      ? this.parent.system.pet_order.filter((id) => !grantedPetIds.has(id))
      : [];
    await this.parent.update(
      {
        "system.pets": nextPets,
        "system.pet_order": nextPetOrder,
      },
      { render: false },
    );
    await Actor.deleteDocuments([...grantedPetIds], options);
  }

  /**
   * Augment the basic Item data model with additional dynamic data.
   */
  prepareData() {
    debugLog("FFXIV | Item ", this);
    super.prepareData();
  }

  /**
   * Prepare a data object which defines the data schema used by dice roll commands against this Item
   * @override
   */
  getRollData() {
    const rollData = { ...this.system };

    const target = game.user.targets.first();
    if (target) {
      const targetActor = target.actor ?? game.actors.get(target.document.actorId);
      if (targetActor?.getRollData) rollData.target = targetActor.getRollData();
    }

    if (this.parent) {
      Object.assign(rollData, this.parent.getRollData());
    }
    return rollData;
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  async roll() {
    this._ffxivJobResourceCostResult = {};
    if (!(await this._confirmTargetSelection())) return;
    if (!this._canUseAbility()) return this._playErrorSound();
    if (!this._canUseLimitBreak()) return this._playErrorSound();
    if (!(await this._consumeJobResourceCostsIfNeeded())) {
      return this._playErrorSound();
    }
    if (!(await this._spendMPCostIfNeeded())) return this._playErrorSound();
    if (!(await this._spendHPCostIfNeeded())) return this._playErrorSound();
    if (!(await this._consumeLimitationIfNeeded())) return this._playErrorSound();
    if (!(await this._consumeLimitBreakIfNeeded())) return this._playErrorSound();
    await this._clearVolatileJobResourcesIfNeeded();
    if (getAbilitySubtype(this) === "limit_break") playLimitBreakActivatedSound();
    await this._removeTranscendentStatus();

    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    let content = await foundry.applications.handlebars.renderTemplate(
      "systems/ffxiv/templates/chat/ability-chat-card.hbs",
      {
        item: this,
      },
    );

    if (this.type === "minion") {
      await ChatMessage.create({
        user,
        content,
        speaker,
        flags: { core: { canParseHTML: true } },
        flavor: game.i18n.format("FFXIV.ItemType." + this.type),
      });
      return;
    }

    if (this.type === "augment") {
      const grants = this._getAugmentAbilityGrants();
      for (const grant of grants) {
        let grantedItem = null;
        if (grant?.item) {
          grantedItem = new CONFIG.Item.documentClass(
            foundry.utils.deepClone(grant.item),
            { temporary: true },
          );
        } else if (grant?.uuid) {
          grantedItem = await fromUuid(grant.uuid);
        }
        if (!grantedItem) continue;
        content =
          content +
          (await foundry.applications.handlebars.renderTemplate(
            "systems/ffxiv/templates/chat/ability-chat-card.hbs",
            {
              item: grantedItem,
            },
          ));
      }
    }
    content = content + this._getRollButtons();
    const chatMessage = await ChatMessage.create({
      user: user,
      content: content,
      speaker: speaker,
      flags: { core: { canParseHTML: true } },
      flavor: game.i18n.format("FFXIV.ItemType." + this.type),
    });

    const checkResult = this._shouldAutoCheckBeforeBase()
      ? await this._rollHit({ auto: true, deferHitThresholdRules: true })
      : null;
    if (checkResult?.interrupted) {
      this._clearTargetsAfterAbilityUse();
      return;
    }

    await this._rollBase({
      critical: checkResult?.isCritical ?? false,
      autoFromHit: Boolean(checkResult),
    });
    await this._applyEffectRules("use", {
      jobResourceCosts: this._ffxivJobResourceCostResult,
    });
    await this._consumeEffectRequirements();
    await this._applyDeferredHitThresholdRules(checkResult);
    await this._autoApplyStatusEffects(chatMessage);
    await this._applyInvokingStatus();
    await this._summonActorsIfNeeded();

    await this._consumeFromInventoryIfNeeded();
    const markers = Array.isArray(this.system.markers) && this.system.markers.length
      ? this.system.markers
      : this.system.marker
        ? [this.system.marker]
        : [];
    for (const marker of markers) {
      await game.ffxivttrpg.placeMarker(foundry.utils.deepClone(marker));
    }
    this._clearTargetsAfterAbilityUse();
  }

  _playErrorSound() {
    const configured = game.settings.get(
      "ffxiv",
      "soundNotificationFFXIV_error",
    );
    const src = configured || "systems/ffxiv/assets/sfx/ffxiv-error.ogg";
    foundry.audio.AudioHelper.play(
      {
        src,
        channel: "interface",
        volume: 0.8,
        autoplay: true,
        loop: false,
      },
      false,
    );
  }

  _clearTargetsAfterAbilityUse() {
    if (
      this.type !== "ability" &&
      !ABILITY_SUBTYPE_TYPES.includes(this.type)
    ) return;
    clearUserTargetsForTiming(TARGET_CLEAR_TIMINGS.ABILITY);
  }

  _canUseAbility() {
    const subtype = getAbilitySubtype(this);
    const isAbility = this.type === "ability" || ABILITY_SUBTYPE_TYPES.includes(this.type);
    if (!isAbility) return true;
    if (hasStatus(this.parent, "knocked_out") || hasStatus(this.parent, "comatose")) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.Incapacitated"));
      return false;
    }
    const blockedByStun =
      hasStatus(this.parent, "stun") &&
      !this._ignoresCheckPenaltyStatus("stun");
    const blockedByPetrified =
      hasStatus(this.parent, "petrified") &&
      !this._ignoresCheckPenaltyStatus("petrified");
    if (subtype !== "limit_break" && (blockedByStun || blockedByPetrified)) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.CannotAct"));
      return false;
    }
    if (hasStatus(this.parent, "silence") && this._isInvokedAbility()) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.Silenced"));
      return false;
    }
    return (
      this._canSatisfyEffectRequirements() &&
      this._canSatisfyJobResourceCosts() &&
      this._canSatisfyMPCost()
    );
  }

  _canUseLimitBreak() {
    if (getAbilitySubtype(this) !== "limit_break") return true;
    if (!isLimitBreakActive()) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.LimitBreakDisabled"));
      return false;
    }

    const value = getLimitBreakValue();
    if (!game.user?.isGM && !game.users.find((user) => user.isGM && user.active)) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.LimitBreakNoGM"));
      return false;
    }
    if (value > 0) return true;
    ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.LimitBreakEmpty"));
    return false;
  }

  async _consumeLimitBreakIfNeeded() {
    if (getAbilitySubtype(this) !== "limit_break") return true;
    if (!isLimitBreakActive()) return false;

    const value = getLimitBreakValue();
    if (value <= 0) return false;

    if (game.user?.isGM) {
      await game.settings.set("ffxiv", "limitBreakValue", value - 1);
    } else {
      const gm = getActiveGM();
      if (!gm) {
        ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.LimitBreakNoGM"));
        return false;
      }
      emitToActiveGM({
        type: "limitBreakSpend",
        data: {
          actorId: this.parent?.id ?? null,
          actorUuid: this.parent?.uuid ?? null,
          itemId: this.id,
          itemUuid: this.uuid,
        },
        userName: game.user.name,
        gmUserId: gm.id,
      });
    }
    return true;
  }

  _isInvokedAbility() {
    return (this.system.tags || []).some((tag) =>
      FFXIVItem._tagMatches(tag, ["Invoked", "FFXIV.Tags.Invoked"]),
    );
  }

  async _removeTranscendentStatus() {
    if (this.type !== "ability") return;
    if (!hasStatus(this.parent, "transcendent")) return;
    await applyStatusEffectChange(this.parent, "transcendent", false);
  }

  _getSummonActorEntries() {
    const entries = Array.isArray(this.system?.summon_actors)
      ? this.system.summon_actors
      : Object.values(this.system?.summon_actors || {});
    return entries.filter((entry) =>
      String(entry?.uuid ?? "").trim(),
    );
  }

  async _summonActorsIfNeeded() {
    const summons = this._getSummonActorEntries();
    if (!summons.length) return;

    if (!canvas?.scene) {
      ui.notifications.warn(
        game.i18n.localize("FFXIV.Notifications.SummonNoScene"),
      );
      return;
    }

    const sourceToken = this._getSummonSourceToken();
    if (!sourceToken) {
      ui.notifications.warn(
        game.i18n.localize("FFXIV.Notifications.SummonNoToken"),
      );
      return;
    }

    const position = this._getSummonPosition(sourceToken);
    if (!position) {
      ui.notifications.warn(
        game.i18n.localize("FFXIV.Notifications.SummonNoToken"),
      );
      return;
    }

    for (const summon of summons) {
      await this._summonActor(summon, sourceToken, position);
    }
  }

  _getSummonSourceToken() {
    const actor = this.parent?.documentName === "Actor" ? this.parent : null;
    if (!actor) return null;

    const controlled = canvas?.tokens?.controlled?.find((token) =>
      this._isSummonSourceTokenForActor(token, actor),
    );
    if (controlled?.document) return controlled.document;

    const tokens =
      typeof actor.getActiveTokens === "function"
        ? actor.getActiveTokens(false, true)
        : [];
    return (
      tokens.find((token) => token?.parent?.id === canvas?.scene?.id) ??
      tokens[0] ??
      null
    );
  }

  _isSummonSourceTokenForActor(token, actor) {
    if (!token || !actor) return false;
    const tokenActor = token.actor ?? token.document?.actor;
    if (tokenActor === actor) return true;
    if (String(tokenActor?.uuid ?? "") === String(actor.uuid ?? "")) return true;
    const tokenActorId = String(token.document?.actorId ?? token.actorId ?? "");
    return tokenActorId && tokenActorId === String(actor.id ?? "");
  }

  _getSummonPosition(sourceToken) {
    const x = Number(sourceToken?.x ?? sourceToken?.object?.x);
    const y = Number(sourceToken?.y ?? sourceToken?.object?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const position = { x, y };
    for (const key of ["elevation", "level"]) {
      const value = sourceToken?.[key] ?? sourceToken?.object?.document?.[key];
      if (value !== undefined && value !== null) position[key] = value;
    }
    return position;
  }

  async _summonActor(summon, sourceToken, position) {
    const actor = await this._resolveSummonActor(summon);
    if (!actor) {
      ui.notifications.warn(
        game.i18n.format("FFXIV.Notifications.SummonActorMissing", {
          actor: summon?.name || game.i18n.localize("FFXIV.ItemType.ability"),
        }),
      );
      return;
    }

    try {
      const tokenData = await this._getSummonTokenData(actor, position);
      tokenData.flags = foundry.utils.mergeObject(tokenData.flags || {}, {
        ffxiv: {
          summoned: true,
          summon: {
            actorUuid: actor.uuid,
            sourceActorUuid: this.parent?.uuid ?? "",
            sourceItemUuid: this.uuid,
            sourceItemName: this.name,
            sourceTokenId: sourceToken.id ?? sourceToken._id ?? "",
          },
        },
      });
      const combatData = this._getSummonCombatData(sourceToken);

      if (game.user?.isGM) {
        await this._createSummonToken(tokenData, combatData);
        return;
      }

      const gm = getActiveGM();
      if (!gm) {
        ui.notifications.warn(
          game.i18n.localize("FFXIV.Notifications.SummonNoGM"),
        );
        return;
      }

      emitToActiveGM({
        type: FFXIV_SUMMON_SOCKET_TYPE,
        userName: game.user.name,
        gmUserId: gm.id,
        data: {
          sceneId: canvas.scene.id,
          tokenData,
          combatData,
        },
      });
      ui.notifications.info(
        game.i18n.localize("FFXIV.Notifications.SummonRequestSent"),
      );
    } catch (error) {
      debugError("FFXIV | Failed to summon actor:", error);
      ui.notifications.error(
        game.i18n.localize("FFXIV.Notifications.SummonFailed"),
      );
    }
  }

  async _getSummonTokenData(actor, position) {
    const tokenDocument = await actor.getTokenDocument(position);
    const tokenData = tokenDocument.toObject();
    const actorData = this._getSummonActorData(actor);

    tokenData.actorLink = false;
    tokenData.actorId = null;
    tokenData.delta = foundry.utils.deepClone(actorData);
    return tokenData;
  }

  _getSummonActorData(actor) {
    const source = actor.toObject();
    return {
      name: source.name,
      type: source.type,
      img: source.img,
      system: foundry.utils.deepClone(source.system ?? {}),
      items: foundry.utils.deepClone(source.items ?? []),
      effects: foundry.utils.deepClone(source.effects ?? []),
      flags: foundry.utils.deepClone(source.flags ?? {}),
    };
  }

  _getSummonCombatData(sourceToken) {
    const actor = this.parent?.documentName === "Actor" ? this.parent : null;
    return {
      sourceActorId: actor?.id ?? "",
      sourceActorUuid: actor?.uuid ?? "",
      sourceTokenId: sourceToken?.id ?? sourceToken?._id ?? "",
    };
  }

  async _resolveSummonActor(summon) {
    const uuid = String(summon?.uuid ?? "").trim();
    if (!uuid) return null;

    try {
      const actor = await fromUuid(uuid);
      return actor?.documentName === "Actor" ? actor : null;
    } catch (_error) {
      return null;
    }
  }

  async _createSummonToken(tokenData, combatData = null) {
    try {
      const token = await createSummonTokenFromRequest({
        sceneId: canvas.scene.id,
        tokenData,
        combatData,
      });
      if (token) {
        ui.notifications.info(
          game.i18n.format("FFXIV.Notifications.SummonCreated", {
            actor: token.name,
          }),
        );
      }
    } catch (error) {
      debugError("FFXIV | Failed to create summon token:", error);
      ui.notifications.error(
        game.i18n.localize("FFXIV.Notifications.SummonFailed"),
      );
    }
  }

  async _confirmTargetSelection() {
    const target = this._getNormalizedTargetText();
    if (
      !this._requiresSelectedTarget(target) ||
      (game.user.targets?.size ?? 0) > 0
    ) return true;

    const getContent = () => {
      const targets = Array.from(game.user.targets ?? []);
      const message = game.i18n.format("FFXIV.Notifications.NoTargetWithKeybind", {
        singleKeybind: this._getTargetKeybindText("target", "T"),
        multipleKeybind: this._getMultipleTargetKeybindText(),
      });
      const [warning, ...instructions] = message.split("\n");
      const targetContent = targets.length
        ? `<p>${game.i18n.localize("FFXIV.Notifications.SelectedTargets")}</p><ul>${targets
          .map((token) => `<li>${foundry.utils.escapeHTML(token.name)}</li>`)
          .join("")}</ul>`
        : `<p style="text-align: center;">${warning}</p>`;
      return `${targetContent}<p>${instructions.join("<br>")}</p>`;
    };

    const updateContent = () => {
      const contentElement = document
        .getElementById("ffxiv-target-warning-dialog")
        ?.querySelector(".ffxiv-target-warning-content");
      if (contentElement) contentElement.innerHTML = getContent();
    };
    const targetTokenHook = Hooks.on("targetToken", (user) => {
      if (user.id === game.user.id) updateContent();
    });

    try {
      return await foundry.applications.api.DialogV2.wait({
        id: "ffxiv-target-warning-dialog",
        window: {
          title: game.i18n.localize("FFXIV.Notifications.TargetWarningTitle"),
        },
        content: `<div class="ffxiv-target-warning-content">${getContent()}</div>`,
        buttons: [
          {
            label: game.i18n.localize("FFXIV.Dialogs.OK"),
            action: "ok",
            type: "submit",
            callback: () => true,
          },
          {
            label: game.i18n.localize("FFXIV.Dialogs.Cancel"),
            action: "cancel",
            type: "cancel",
            callback: () => false,
          },
        ],
        render: (_event, dialog) => {
          dialog.element.querySelector("[autofocus]")?.removeAttribute("autofocus");
          if (dialog.element.contains(document.activeElement)) {
            document.activeElement.blur();
          }
        },
      }).catch(() => false);
    } finally {
      Hooks.off("targetToken", targetTokenHook);
    }
  }

  _getNormalizedTargetText() {
    return String(this.system?.target ?? "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim()
      .toLowerCase();
  }

  _requiresSelectedTarget(target = this._getNormalizedTargetText()) {
    if (this.type !== "ability") return false;
    if (!target) return false;
    return !["none", "self", game.i18n.localize("FFXIV.None").toLowerCase()].includes(target);
  }

  _getTargetKeybindText(actionName, fallback) {
    const bindings = this._getTargetKeybindings(actionName);
    if (!bindings.length) return fallback;
    return bindings.map((binding) => this._formatKeybinding(binding)).join(" / ");
  }

  _getMultipleTargetKeybindText() {
    const bindings = this._getTargetKeybindings("target");
    if (!bindings.length) return "Shift+T";

    const reservedModifiers = this._getTargetReservedModifiers();
    const modifiers = reservedModifiers.length ? reservedModifiers : ["Shift"];
    return bindings
      .map((binding) => this._formatKeybinding({
        ...binding,
        modifiers: Array.from(new Set([
          ...modifiers,
          ...(Array.isArray(binding.modifiers) ? binding.modifiers : []),
        ])),
      }))
      .join(" / ");
  }

  _getTargetReservedModifiers() {
    const action = this._getTargetKeybindingAction("target");
    return Array.isArray(action?.reservedModifiers) ? action.reservedModifiers : [];
  }

  _getTargetKeybindingAction(actionName) {
    const actions = game.keybindings?.actions;
    if (!(actions instanceof Map)) return null;
    return actions.get(`core.${actionName}`) ?? actions.get(actionName) ?? null;
  }

  _getTargetKeybindings(actionName) {
    let directBindings = [];
    try {
      directBindings = game.keybindings?.get?.("core", actionName) ?? [];
    } catch (_error) {}
    if (Array.isArray(directBindings) && directBindings.length) {
      return directBindings;
    }

    const actions = game.keybindings?.actions;
    if (!(actions instanceof Map)) return [];

    for (const [id, action] of actions) {
      const key = String(id ?? "").toLowerCase();
      const name = String(action?.name ?? action?.label ?? "").toLowerCase();
      const targetAction = actionName.toLowerCase();
      if (!key.includes(targetAction) && !name.includes(targetAction)) continue;
      const namespace = String(action?.namespace ?? id?.split?.(".")?.[0] ?? "");
      const keybindingAction = String(action?.action ?? id?.split?.(".")?.[1] ?? "");
      let bindings = [];
      try {
        bindings = game.keybindings?.get?.(namespace, keybindingAction) ?? [];
      } catch (_error) {}
      if (Array.isArray(bindings) && bindings.length) return bindings;
    }

    return [];
  }

  _formatKeybinding(binding) {
    try {
      return foundry.helpers.interaction.KeyboardManager.getKeycodeDisplayString(binding);
    } catch (_error) {}

    const modifiers = Array.isArray(binding?.modifiers)
      ? binding.modifiers
      : [];
    const key = String(binding?.logicalKey ?? binding?.key ?? "").trim();
    return [...modifiers, this._formatKeycode(key)]
      .filter(Boolean)
      .join("+");
  }

  _formatKeycode(key) {
    if (!key) return "";
    if (key.length === 1) return key.toUpperCase();
    if (key.startsWith("Key")) return key.slice(3);
    if (key.startsWith("Digit")) return key.slice(5);
    if (key.startsWith("Numpad")) return `Numpad ${key.slice(6)}`;
    if (key.startsWith("Arrow")) return key.slice(5);
    return key.replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  async _consumeLimitationIfNeeded() {
    if (this.type !== "ability") return true;
    if (this.parent?.documentName !== "Actor") return true;
    if (!String(this.system?.limitations ?? "").trim()) return true;

    const max = Number.parseInt(this.system?.job_resources_max, 10);
    if (!Number.isFinite(max) || max <= 0) return true;

    const resourceStatus = Array.isArray(this.system?.job_resource_status)
      ? this.system.job_resource_status.slice(0, max)
      : [];
    while (resourceStatus.length < max) resourceStatus.push(false);

    const index = resourceStatus.findIndex((status) => !status);
    if (index === -1) {
      ui.notifications.warn(
        game.i18n.localize("FFXIV.Notifications.LimitationsConsumed"),
      );
      return false;
    }

    resourceStatus[index] = true;
    await this.update(
      { "system.job_resource_status": resourceStatus },
      { render: false },
    );
    return true;
  }

  async _spendHPCostIfNeeded() {
    if (this.parent?.documentName !== "Actor") return true;
    const hpCost = Number.parseInt(this.system?.hpcost, 10);
    if (!Number.isFinite(hpCost) || hpCost <= 0) return true;

    const currentHP =
      Number.parseInt(this.parent.system?.health?.value, 10) || 0;
    const nextHP = currentHP - hpCost;
    if (nextHP < 1) {
      ui.notifications.warn(
        game.i18n.localize("FFXIV.Notifications.NotEnoughHP"),
      );
      return false;
    }

    // HP cost always drains HP directly and never consumes Barrier.
    await this.parent.update(
      { "system.health.value": nextHP },
      { render: false },
    );
    return true;
  }

  _canSatisfyMPCost() {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return true;

    const cost = this._getResolvedMPCost(actor);
    if (cost.amount <= 0) return true;
    const currentMana = Number(actor.system?.mana?.value ?? 0);
    if (currentMana >= cost.amount) return true;
    ui.notifications.warn(`${this.name}: requires ${cost.amount} MP.`);
    return false;
  }

  async _spendMPCostIfNeeded() {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return true;

    const cost = this._getResolvedMPCost(actor);
    if (cost.amount <= 0) return true;
    const currentMana = Number(actor.system?.mana?.value ?? 0);
    if (currentMana < cost.amount) {
      ui.notifications.warn(`${this.name}: requires ${cost.amount} MP.`);
      return false;
    }

    for (const reduction of cost.reductions) {
      await applyActorJobResourceDelta(
        actor,
        reduction.resource,
        -reduction.amount,
        { render: false },
      );
    }
    await actor.update(
      { "system.mana.value": Math.max(currentMana - cost.amount, 0) },
      { render: false },
    );
    return true;
  }

  _getResolvedMPCost(actor) {
    const baseCost = this._getBaseMPCost(actor);
    if (baseCost <= 0) return { amount: 0, baseCost: 0, reductions: [] };

    let amount = baseCost;
    const reductions = [];
    for (const entry of this._getMPCostReductionEntries(actor)) {
      if (!this._mpCostReductionApplies(entry)) continue;
      const override = Number.parseInt(entry.override, 10);
      if (Number.isFinite(override)) {
        amount = Math.max(override, 0);
        continue;
      }
      const resource = String(entry.resource ?? entry.resourceName ?? "").trim();
      if (!resource) continue;
      const resourceAmount = Math.max(
        Number.parseInt(entry.amount ?? entry.resourceAmount, 10) || 1,
        1,
      );
      if (getActorJobResourceCount(actor, resource) < resourceAmount) continue;

      const minCost = Math.max(Number.parseInt(entry.minCost, 10) || 0, 0);
      if (amount <= minCost) continue;
      const reductionAmount = Math.max(
        Number.parseInt(entry.reduction ?? entry.mp ?? entry.value, 10) || 1,
        1,
      );
      const nextAmount = Math.max(amount - reductionAmount, minCost);
      if (nextAmount >= amount) continue;
      reductions.push({ resource, amount: resourceAmount });
      amount = nextAmount;

      const maxApplications = Number.parseInt(entry.maxApplications, 10);
      if (!Number.isFinite(maxApplications) || maxApplications <= 1) continue;
      for (let index = 1; index < maxApplications; index += 1) {
        if (amount <= minCost) break;
        if (getActorJobResourceCount(actor, resource) < resourceAmount * (index + 1))
          break;
        const repeatedAmount = Math.max(amount - reductionAmount, minCost);
        if (repeatedAmount >= amount) break;
        reductions.push({ resource, amount: resourceAmount });
        amount = repeatedAmount;
      }
    }
    return { amount, baseCost, reductions };
  }

  _getBaseMPCost(actor) {
    const explicitCost = Number.parseInt(this.system?.mpcost, 10);
    if (Number.isFinite(explicitCost) && explicitCost > 0) return explicitCost;

    const costText = String(this.system?.cost ?? "").trim();
    if (!costText) return 0;
    if (/\ball\s*mp\b/i.test(costText)) {
      return Math.max(Number(actor?.system?.mana?.value ?? 0) || 0, 0);
    }
    const match = costText.match(/(\d+)\s*MP\b/i);
    return match ? Math.max(Number.parseInt(match[1], 10) || 0, 0) : 0;
  }

  _getMPCostReductionEntries(actor) {
    const entries = [];
    for (const item of actor?.items ?? []) {
      entries.push(...this._getMPCostReductionEntriesFrom(item));
    }
    for (const effect of actor?.allApplicableEffects?.() ?? []) {
      if (!effect || effect.disabled) continue;
      entries.push(...this._getMPCostReductionEntriesFrom(effect));
    }
    return entries;
  }

  _getMPCostReductionEntriesFrom(document) {
    const data =
      foundry.utils.getProperty(document, "flags.ffxiv.mpCost.reductions") ??
      foundry.utils.getProperty(document, "flags.ffxiv.mpCost.reduction");
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data !== "object") return [];
    if (data.resource || data.resourceName) return [data];
    return Object.values(data);
  }

  _mpCostReductionApplies(entry) {
    const names = this._toArray(
      entry.abilityNames ?? entry.abilityName ?? entry.items ?? entry.item,
    );
    if (
      names.length &&
      !names.some((name) =>
        this._normalizeEffectKey(name) === this._normalizeEffectKey(this.name),
      )
    )
      return false;

    const requiredTags = this._toArray(
      entry.tags ?? entry.tag ?? entry.requiresTags ?? entry.requiresTag,
    );
    if (!requiredTags.length) return true;
    const tags = new Set(
      (Array.isArray(this.system?.tags) ? this.system.tags : []).map((tag) =>
        this._normalizeTag(tag),
      ),
    );
    return requiredTags.every((tag) => tags.has(this._normalizeTag(tag)));
  }

  _normalizeTag(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  async _clearVolatileJobResourcesIfNeeded() {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return;
    if (!this._isAbilityLikeItem()) return;

    for (const entry of this._getVolatileJobResourceEntries(actor)) {
      const resource = String(entry.resource ?? entry.name ?? "").trim();
      if (!resource) continue;
      if (getActorJobResourceCount(actor, resource) <= 0) continue;
      if (this._preservesVolatileJobResource(resource, entry)) continue;
      await setActorJobResourceCount(actor, resource, 0, { render: false });
    }
  }

  _isAbilityLikeItem() {
    return (
      this.type === "ability" ||
      ABILITY_SUBTYPE_TYPES.includes(this.type) ||
      getAbilitySubtype(this) === "limit_break"
    );
  }

  _getVolatileJobResourceEntries(actor) {
    const entries = [];
    for (const item of actor?.items ?? []) {
      if (item?.type !== "trait") continue;
      const data = foundry.utils.getProperty(
        item,
        "flags.ffxiv.jobResource.clearOnAction",
      );
      for (const entry of this._toArray(data)) {
        if (!entry) continue;
        entries.push(typeof entry === "string" ? { resource: entry } : entry);
      }
    }
    return entries;
  }

  _preservesVolatileJobResource(resource, entry) {
    if (this._costRulesConsumeResource(resource)) return true;
    const preserveResources = this._toArray(
      foundry.utils.getProperty(this, "flags.ffxiv.jobResource.preserveOnAction"),
    );
    if (preserveResources.some((value) =>
      normalizeJobResourceName(value) === normalizeJobResourceName(resource),
    ))
      return true;

    const actionNames = this._toArray(
      entry.preserveActions ??
      entry.exceptActions ??
      entry.exceptions ??
      entry.except,
    );
    const currentName = this._normalizeEffectKey(this.name);
    return actionNames.some((name) => this._normalizeEffectKey(name) === currentName);
  }

  _costRulesConsumeResource(resource) {
    const key = normalizeJobResourceName(resource);
    return this._getJobResourceCostRules().some(
      (rule) => normalizeJobResourceName(rule.resource) === key,
    );
  }

  async _rollHit(options = {}) {
    options = this._normalizeRollOptions(options);
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;

    const rollData = this.getRollData();
    const baseFormula = this._getHitBaseFormula(rollData);
    const resolveFormula = (formula) => {
      return Roll.replaceFormulaData(formula, rollData, {
        missing: "0",
        warn: true,
      });
    };
    const appendFormulaModifier = (formula, modifier) => {
      const value = Number(modifier);
      if (!Number.isFinite(value) || value === 0) return formula;
      return formula + (value > 0 ? ` + ${value}` : ` - ${Math.abs(value)}`);
    };
    const enmityPenaltyInfo = this._hasCheck() && this.parent?._getEnmityCheckPenaltyInfo
      ? await this.parent._getEnmityCheckPenaltyInfo()
      : { penalty: 0, sourceActor: null };
    const enmityPenalty = enmityPenaltyInfo.penalty;
    const ignoredStatuses = this._getIgnoredCheckPenaltyStatuses(options);
    const statusPenalty = getActorCheckPenalty(this.parent, {
      ignoredStatuses,
    });
    const checkPenalty = getLargestCheckPenalty(enmityPenalty, statusPenalty);
    const enmityPenaltyApplies =
      checkPenalty && enmityPenalty && Math.abs(enmityPenalty) >= Math.abs(statusPenalty);
    const statusPenaltyApplies =
      checkPenalty && statusPenalty && !enmityPenaltyApplies;
    const targetAdvantageDice =
      this._getTargetStatusAdvantageDice() +
      this._getActiveEffectCheckAdvantageDice(options);
    let result = { advantageDice: targetAdvantageDice, flatModifier: 0 };

    if (!options.auto)
      result = await foundry.applications.api.DialogV2.wait({
        id: "ffxiv-hit-roll-dialog",
        window: {
          title: game.i18n.localize("FFXIV.RollDialog.HitRollOptions"),
        },
        form: {
          submitOnChange: false,
          closeOnSubmit: true,
        },
        content: `
        <div class="form-group" style="display: flex; align-items: center; margin-bottom: 6px;">
          <label style="font-weight: bold; width: 110px;">${game.i18n.localize("FFXIV.RollDialog.AdvantageDice")}</label>
          <div style="display: flex; flex: 1; align-items: center; gap: 4px;">
            <input type="number" name="advantageDice" value="${targetAdvantageDice}" min="0" style="flex: 1; height: 24px; font-size: 0.9em;" />
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
          <div id="status-penalty-preview"></div>
          <div id="enmity-penalty-preview"></div>
        </div>
      `,
        buttons: [
          {
            label: game.i18n.localize("FFXIV.RollDialog.ButtonRoll"),
            action: "roll",
            type: "submit",
            callback: (_event, button) => {
              const form = button.form;
              const advantageDice =
                parseInt(form.elements.advantageDice.value) || 0;
              const flatModifier =
                parseInt(form.elements.flatModifier.value) || 0;
              return { advantageDice, flatModifier };
            },
          },
          {
            label: game.i18n.localize("FFXIV.Dialogs.Cancel"),
            action: null,
            type: "cancel",
          },
        ],
        render: (_event, dialog) => {
          const html = dialog.element;
          const advInput = html.querySelector('input[name="advantageDice"]');
          const modInput = html.querySelector('input[name="flatModifier"]');
          const preview = html.querySelector("#roll-preview");
          const statusPenaltyPreview = html.querySelector("#status-penalty-preview");
          const enmityPreview = html.querySelector("#enmity-penalty-preview");

          const updatePreview = () => {
            const advantageDice = parseInt(advInput?.value) || 0;
            const flatModifier = parseInt(modInput?.value) || 0;
            let previewFormula = resolveFormula(baseFormula);

            const d20Pattern = /(\d*)d20/i;
            if (d20Pattern.test(previewFormula)) {
              const match = previewFormula.match(d20Pattern);
              const count = parseInt(match[1]) || 1;
              previewFormula = previewFormula.replace(
                d20Pattern,
                `${count + advantageDice}d20kh1`,
              );
            } else if (advantageDice > 0) {
              previewFormula +=
                " (" +
                game.i18n.localize(
                  "FFXIV.RollDialog.Warning.NoD20AdvantageIgnored",
                ) +
                ")";
            }

            previewFormula = appendFormulaModifier(previewFormula, checkPenalty);
            if (statusPenaltyPreview) {
              statusPenaltyPreview.textContent = statusPenaltyApplies
                ? `${game.i18n.localize("FFXIV.RollDialog.StatusPenalty")}: ${statusPenalty}`
                : "";
            }
            if (enmityPreview) {
              enmityPreview.textContent = enmityPenaltyApplies
                ? `${game.i18n.localize("FFXIV.Effects.Enmity")}: ${enmityPenalty} (${enmityPenaltyInfo.sourceActor.name} not targeted)`
                : "";
            }

            if (flatModifier !== 0) {
              previewFormula = appendFormulaModifier(previewFormula, flatModifier);
            }

            preview.textContent = previewFormula;
          };

          html.querySelectorAll(".btn-adjust").forEach((btn) =>
            btn.addEventListener("click", (event) => {
              const target = event.currentTarget.dataset.target;
              const step = parseInt(event.currentTarget.dataset.step);
              const input = html.querySelector(`input[name="${target}"]`);
              const current = parseInt(input.value) || 0;
              const next =
                target === "advantageDice"
                  ? Math.max(0, current + step)
                  : current + step;
              input.value = next;
              input.dispatchEvent(new Event("input"));
            }),
          );

          advInput?.addEventListener("input", updatePreview);
          modInput?.addEventListener("input", updatePreview);
          updatePreview();
        },
        width: 360,
      });

    if (!result || typeof result !== "object") return;

    const { advantageDice, flatModifier } = result;

    let formula = resolveFormula(baseFormula);
    const d20Pattern = /(\d*)d20/i;
    if (d20Pattern.test(formula)) {
      const match = formula.match(d20Pattern);
      const count = parseInt(match[1]) || 1;
      formula = formula.replace(d20Pattern, `${count + advantageDice}d20kh1`);
    } else if (advantageDice > 0) {
      ui.notifications.warn(
        game.i18n.localize("FFXIV.RollDialog.Warning.NoD20AdvantageIgnored"),
      );
    }

    formula = appendFormulaModifier(formula, checkPenalty);

    if (flatModifier !== 0) {
      formula +=
        rollData.hit +
        (flatModifier > 0
          ? ` + ${flatModifier}`
          : ` - ${Math.abs(flatModifier)}`);
    }

    const roll = new Roll(formula, rollData);
    await roll.evaluate();

    const d20 = roll.dice.find((die) => die.faces === 20);
    const activeD20Results =
      d20?.results?.filter((result) => result.active !== false) ||
      d20?.results ||
      [];
    const d20Result = activeD20Results.length
      ? Math.max(...activeD20Results.map((result) => result.result))
      : null;
    const criticalRange = getActorCriticalRange(
      this.parent,
      this.parent?.system?.criticalRange,
    );
    const isCritical = d20Result !== null && d20Result >= criticalRange;
    const isCriticalFailure = false;
    const isInterrupted = this._isInterruptedByParalysis(d20Result);

    if (
      isCritical &&
      game.settings.get("ffxiv", "soundNotificationFFXIV") &&
      game.settings.get("ffxiv", "soundNotificationFFXIV_critical")
    ) {
      foundry.audio.AudioHelper.play({
        src: game.settings.get("ffxiv", "soundNotificationFFXIV_critical"),
        channel: "interface",
        volume: 1,
        autoplay: true,
        loop: false,
      });
    }

    const autoDirectHit =
      !isInterrupted && this._shouldAutoRollDirectHit(roll, options);
    const directHitResult = autoDirectHit
      ? await this._evaluateDirectHitRoll({
          critical: isCritical,
          autoFromHit: true,
          effectSnapshot: options.effectSnapshot,
        })
      : null;
    const buttonData = this._getChatButtonData();

    let extraButtons = "<div style='display:flex;flex-wrap: wrap;'>";
    if (this._hasDirectRoll() && !autoDirectHit) {
      extraButtons += `<button class="ffxiv-roll-direct" ${buttonData}>${game.i18n.localize("FFXIV.Chat.RollDirectHitFormula")}</button>`;
      extraButtons += `<button class="ffxiv-roll-critical" ${buttonData}>${game.i18n.localize("FFXIV.Chat.RollCriticalHitFormula")}</button>`;
      for (const option of this._getDirectHitOptions({ checkMana: false }, options)) {
        const critical = isCritical ? "true" : "false";
        const label = isCritical
          ? this._getDirectHitOptionCriticalButtonLabel(option)
          : this._getDirectHitOptionButtonLabel(option);
        extraButtons += `<button class="ffxiv-roll-option-direct" data-critical="${critical}" data-direct-hit-option="${option.key}" ${buttonData}>${label}</button>`;
      }
    }
    if (!autoDirectHit && this._hasFormula(this.system.alternate_formula_critical))
      extraButtons += `<button class="ffxiv-roll-critical-alternate" ${buttonData}>${game.i18n.localize("FFXIV.Chat.RollAlternateCriticalHitFormula")}</button>`;
    extraButtons += "</div>";

    const rollHTML = $("<div>" + (await roll.render()) + "</div>");
    if (isCritical) rollHTML.find(".dice-total").css({ color: "blue" });
    if (isCriticalFailure) rollHTML.find(".dice-total").css({ color: "red" });
    if (enmityPenaltyApplies) {
      rollHTML.append(
        `<div>${game.i18n.localize("FFXIV.Effects.Enmity")}: ${enmityPenalty} (${enmityPenaltyInfo.sourceActor.name} not targeted)</div>`,
      );
    }
    if (statusPenaltyApplies) {
      rollHTML.append(
        `<div>${game.i18n.localize("FFXIV.RollDialog.StatusPenalty")}: ${statusPenalty}</div>`,
      );
    }
    const criticalUp = getStatusStackTotal(this.parent, "critical_up");
    if (criticalUp) {
      rollHTML.append(
        `<div>${game.i18n.localize("FFXIV.Effects.CriticalUp")}: ${criticalRange}</div>`,
      );
    }
    if (isInterrupted) {
      await this._restoreLimitationUseIfNeeded();
      rollHTML.append(
        `<div>${game.i18n.localize("FFXIV.Notifications.ParalysisInterrupted")}</div>`,
      );
    }
    if (directHitResult) {
      rollHTML.append(
        `<hr><div style="font-weight: 700; margin: 4px 0;">${directHitResult.flavor}</div>`,
      );
      rollHTML.append(directHitResult.html.html());
      rollHTML.append(this._getApplyButton(directHitResult.roll.result));
    }

    await ChatMessage.create({
      user,
      speaker,
      flavor: this._hasCheck()
        ? game.i18n.localize("FFXIV.Abilities.Check")
        : game.i18n.format("FFXIV.Abilities.HitRoll"),
      rolls: directHitResult ? [roll, directHitResult.roll] : [roll],
      content: `${rollHTML.html()} ${isInterrupted ? "" : extraButtons}`,
    });

    if (!isInterrupted && !options.deferHitThresholdRules) {
      await this._applyEffectRules("hitThreshold", {
        d20Result,
        roll,
        directHitRoll: directHitResult?.roll ?? null,
      });
    }
    if (!isInterrupted) await this._applyCriticalJobResourceAutomation(isCritical);

    return {
      roll,
      d20Result,
      isCritical,
      isCriticalFailure,
      interrupted: isInterrupted,
      directHitRoll: directHitResult?.roll ?? null,
      deferredHitThresholdRules: options.deferHitThresholdRules === true,
    };
  }

  async _rollDirect(options = {}) {
    options = this._normalizeRollOptions(options);
    const directHitResult = await this._evaluateDirectHitRoll(options);
    if (!directHitResult) return;
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    await ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [directHitResult.roll],
      flavor: directHitResult.flavor,
      content: `${directHitResult.html.html()} ${this._getApplyButton(directHitResult.roll.result)}`,
    });
  }

  async _evaluateDirectHitRoll(options = {}) {
    options = this._normalizeRollOptions(options);
    if (!this._hasDirectRoll()) return null;
    const critical = options.critical || this._shouldForceDirectHitCritical(options);
    const rollData = this.getRollData();
    const formula = critical
      ? await this._getCriticalDirectFormula(rollData, options)
      : this._getDirectFormula(rollData, options);
    const directHitOption = this._getDirectHitOption(
      options.directHitOption,
      options,
    );
    const resolvedFormula = directHitOption
      ? this._applyDirectHitOptionFormula(formula, directHitOption)
      : formula;
    const roll = new Roll(resolvedFormula, rollData);
    await roll.evaluate();
    const rollHTML = $("<div>" + (await roll.render()) + "</div>");
    return {
      roll,
      html: rollHTML,
      flavor: this._getDirectRollFlavor({
        critical,
        autoFromHit: options.autoFromHit,
        directHitOption,
      }),
    };
  }

  async _rollOptionDirect(options = {}) {
    options = this._normalizeRollOptions(options);
    const directHitOption = this._getDirectHitOption(
      options.directHitOption,
      options,
    );
    if (!directHitOption) {
      ui.notifications.warn(`${this.name}: direct hit option unavailable.`);
      return;
    }
    if (!this._canUseDirectHitOption(directHitOption)) {
      ui.notifications.warn(
        `${this.name}: ${directHitOption.name} requires ${directHitOption.mpCost} MP.`,
      );
      return;
    }

    const currentMana = Number(this.parent?.system?.mana?.value ?? 0);
    await this.parent.update(
      { "system.mana.value": Math.max(currentMana - directHitOption.mpCost, 0) },
      { render: false },
    );
    await this._rollDirect({
      ...options,
      directHitOption: directHitOption.key,
    });
  }

  _getDirectHitOption(key, options = {}) {
    const normalizedKey = this._normalizeEffectKey(key);
    if (!normalizedKey) return null;
    return this._getDirectHitOptions({ checkMana: false }, options).find(
      (option) => option.key === normalizedKey,
    ) ?? null;
  }

  _getJobResourceBonusOption(key, { checkResource = true } = {}) {
    const normalizedKey = this._normalizeEffectKey(key);
    if (!normalizedKey) return null;
    return this._getJobResourceBonusOptions({ checkResource }).find(
      (option) => option.key === normalizedKey,
    ) ?? null;
  }

  _getJobResourceBonusOptions({ checkResource = true } = {}) {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return [];

    return this._getJobResourceBonusEntries()
      .map((entry) => this._prepareJobResourceBonusOption(entry, actor))
      .filter((option) => {
        if (!option?.key || !option.resource || !option.formula) return false;
        if (checkResource && getActorJobResourceCount(actor, option.resource) < option.amount)
          return false;
        return true;
      });
  }

  _getJobResourceBonusEntries() {
    const data =
      foundry.utils.getProperty(this, "flags.ffxiv.jobResource.bonus") ??
      foundry.utils.getProperty(this, "flags.ffxiv.jobResource.bonuses");
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data !== "object") return [];
    if (data.resource || data.formula || data.name) return [data];
    return Object.values(data);
  }

  _prepareJobResourceBonusOption(entry, actor) {
    const resource = String(entry?.resource ?? entry?.resourceName ?? "").trim();
    const name = String(entry?.name ?? resource).trim();
    const key =
      this._normalizeEffectKey(entry?.key) ||
      this._normalizeEffectKey(name) ||
      this._normalizeEffectKey(resource);
    return {
      key,
      name,
      resource,
      amount: Math.max(Number.parseInt(entry?.amount ?? entry?.cost, 10) || 1, 1),
      formula: this._getJobResourceBonusFormula(entry, actor),
      buttonLabel: String(entry?.buttonLabel ?? name).trim() || name,
    };
  }

  _getJobResourceBonusFormula(entry, actor) {
    let formula = String(entry?.formula ?? entry?.rollFormula ?? "").trim();
    const level = getActorLevel(actor);
    let selectedMinLevel = -Infinity;
    const upgrades = [
      ...this._toArray(entry?.formulaByLevel),
      ...this._toArray(entry?.formulaUpgrades),
    ];
    for (const upgrade of upgrades) {
      const minLevel = Number.parseInt(upgrade?.minLevel, 10);
      if (!Number.isFinite(minLevel) || level < minLevel) continue;
      if (minLevel < selectedMinLevel) continue;
      const upgradeFormula = String(upgrade?.formula ?? upgrade?.rollFormula ?? "").trim();
      if (!upgradeFormula) continue;
      formula = upgradeFormula;
      selectedMinLevel = minLevel;
    }
    return formula;
  }

  async _rollJobResourceBonus(options = {}) {
    options = this._normalizeRollOptions(options);
    const bonus = this._getJobResourceBonusOption(options.resourceBonus, {
      checkResource: false,
    });
    if (!bonus) return;
    if (getActorJobResourceCount(this.parent, bonus.resource) < bonus.amount) {
      ui.notifications.warn(`${this.name}: requires ${bonus.amount} ${bonus.resource}.`);
      return;
    }

    await applyActorJobResourceDelta(this.parent, bonus.resource, -bonus.amount, {
      render: false,
    });

    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    const roll = new Roll(bonus.formula, this.getRollData());
    await roll.evaluate();
    const rollHTML = $("<div>" + (await roll.render()) + "</div>");
    await ChatMessage.create({
      user,
      speaker,
      rolls: [roll],
      flavor: bonus.name,
      content: `${rollHTML.html()} ${this._getApplyButton(roll.result)}`,
    });
  }

  _getDirectHitOptions({ checkMana = true } = {}, options = {}) {
    const optionsByKey = new Map();
    for (const effect of this._getApplicableEffects(options)) {
      if (!effect || effect.disabled) continue;
      for (const entry of this._getDirectHitOptionEntries(effect)) {
        if (!this._traitModifierEntryApplies(entry)) continue;
        const option = this._prepareDirectHitOption(effect, entry);
        if (!this._canUseDirectHitOption(option, { checkMana })) continue;
        if (!optionsByKey.has(option.key)) optionsByKey.set(option.key, option);
      }
    }
    return Array.from(optionsByKey.values());
  }

  _getDirectHitOptionEntries(effect) {
    const data = foundry.utils.getProperty(effect, "flags.ffxiv.directHit.options");
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === "object") return Object.values(data);
    return [];
  }

  _prepareDirectHitOption(effect, entry) {
    const name = String(entry.name ?? effect.name ?? "").trim();
    const key =
      this._normalizeEffectKey(entry.key) ||
      this._normalizeEffectKey(name) ||
      this._normalizeEffectKey(effect.getFlag?.("ffxiv", "effectKey"));
    const mpCost = Number(entry.mpCost ?? entry.cost ?? 0);
    return {
      key,
      name: name || key,
      buttonLabel: String(entry.buttonLabel ?? "").trim(),
      criticalButtonLabel: String(entry.criticalButtonLabel ?? "").trim(),
      flavorLabel: String(entry.flavorLabel ?? entry.name ?? "").trim(),
      mpCost: Number.isFinite(mpCost) ? Math.max(Math.floor(mpCost), 0) : 0,
      diceTransform: entry.diceTransform ?? entry.formulaTransform ?? null,
    };
  }

  _canUseDirectHitOption(option, { checkMana = true } = {}) {
    if (!option?.key) return false;
    if (!this._hasDirectRoll()) return false;
    if (!this._isSingleTargetAbility()) return false;
    if (!checkMana) return true;
    return Number(this.parent?.system?.mana?.value ?? 0) >= option.mpCost;
  }

  _getDirectHitOptionButtonLabel(option) {
    if (option.buttonLabel) return option.buttonLabel;
    return `${option.name} ${game.i18n.localize("FFXIV.Abilities.DirectHitRoll")}`;
  }

  _getDirectHitOptionCriticalButtonLabel(option) {
    if (option.criticalButtonLabel) return option.criticalButtonLabel;
    return `${option.name} ${game.i18n.localize("FFXIV.Abilities.CriticalHitRoll")}`;
  }

  _applyDirectHitOptionFormula(formula, option) {
    let resolved = String(formula ?? "");
    for (const transform of this._toArray(option.diceTransform)) {
      resolved = this._applyDirectHitDiceTransform(resolved, transform);
    }
    return resolved;
  }

  _applyDirectHitDiceTransform(formula, transform) {
    if (!transform || typeof transform !== "object") return formula;

    const faces = Number.parseInt(transform.faces ?? transform.dieFaces, 10);
    const failureFaces = Number.parseInt(
      transform.failureFaces ?? transform.zeroFaces,
      10,
    );
    const successValue = Number(transform.successValue ?? transform.value);
    if (
      !Number.isFinite(faces) ||
      faces <= 0 ||
      !Number.isFinite(failureFaces) ||
      failureFaces <= 0 ||
      !Number.isFinite(successValue)
    )
      return formula;

    const successFaces = faces - failureFaces;
    if (successFaces !== failureFaces) return formula;

    const pattern = new RegExp(`\\b(\\d*)d${faces}\\b(?![a-z])`, "gi");
    return String(formula ?? "").replace(pattern, (_match, countText) => {
      const count = Math.max(Number.parseInt(countText, 10) || 1, 1);
      return `(${count}d2 * ${successValue} - ${count * successValue})`;
    });
  }

  _isSingleTargetAbility() {
    const target = String(this.system?.target ?? "").trim().toLowerCase();
    return target === "single" || target.startsWith("single ");
  }

  _getDirectFormula(rollData, options = {}) {
    return this._applyDamageDiceModifiers(
      this._appendDamageFormulaModifiers(
        this._composeFormulaWithAttribute(
          rollData.direct_formula,
          rollData.direct_formula_attribute,
        ),
        "direct",
        options,
      ),
      "direct",
      options,
    );
  }

  _shouldForceDirectHitCritical(options = {}) {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return false;
    return this._getDirectHitForceCriticalRules().some((rule) => {
      if (!this._traitModifierEntryApplies(rule)) return false;
      if (rule.requires.some((entry) => !this._hasNamedApplicableEffect(actor, entry.key, options)))
        return false;
      if (
        rule.requiresAny.length &&
        !rule.requiresAny.some((entry) =>
          this._hasNamedApplicableEffect(actor, entry.key, options),
        )
      )
        return false;
      if (rule.forbids.some((entry) => this._hasNamedApplicableEffect(actor, entry.key, options)))
        return false;
      return true;
    });
  }

  _getDirectHitForceCriticalRules() {
    const data = foundry.utils.getProperty(this, "flags.ffxiv.directHit.forceCritical");
    const entries = this._toArray(data);
    return entries
      .map((entry) => {
        const rule = entry === true ? { always: true } : entry;
        return {
          always: rule?.always === true,
          tags: rule?.tags,
          tag: rule?.tag,
          requires: this._normalizeEffectRefs(rule?.requires),
          requiresAny: this._normalizeEffectRefs(rule?.requiresAny),
          forbids: this._normalizeEffectRefs(rule?.forbids),
        };
      })
      .filter(
        (entry) =>
          entry.always ||
          entry.requires.length ||
          entry.requiresAny.length ||
          entry.forbids.length,
      );
  }

  async _rollCritical(options = {}) {
    options = this._normalizeRollOptions(options);
    if (!this._hasDirectRoll()) return;
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    const rollData = this.getRollData();

    let roll = new Roll(
      await this._getCriticalDirectFormula(rollData, options),
      rollData,
    );
    await roll.evaluate();
    const rollHTML = $("<div>" + (await roll.render()) + "</div>");
    await ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [roll],
      flavor: game.i18n.format("FFXIV.Abilities.CriticalHitRoll"),
      content: `${rollHTML.html()} ${this._getApplyButton(roll.result)}`,
    });
  }

  async _rollCriticalAlternate(options = {}) {
    options = this._normalizeRollOptions(options);
    if (!this._hasFormula(this.system.alternate_formula_critical)) return;
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    const rollData = this.getRollData();
    let roll = new Roll(
      this._applyDamageDiceModifiers(
        this._appendDamageFormulaModifiers(
          this._composeFormulaWithAttribute(
            rollData.alternate_formula_critical,
            rollData.alternate_formula_critical_attribute,
          ),
          "alternate",
          options,
        ),
        "alternate",
        options,
      ),
      rollData,
    );
    await roll.evaluate();
    const rollHTML = $("<div>" + (await roll.render()) + "</div>");
    await ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [roll],
      flavor: game.i18n.format("FFXIV.Abilities.CriticalHitRoll"),
      content: `${rollHTML.html()} ${this._getApplyButton(roll.result)}`,
    });
  }

  async _rollBase(options = {}) {
    options = this._normalizeRollOptions(options);
    const { critical = false, autoFromHit = false } = options;
    if (!this._hasFormula(this.system.base_formula)) return;
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    const rollData = this.getRollData();
    const baseFormula = this._appendDamageFormulaModifiers(
      rollData.base_formula,
      "base",
      options,
    );
    const formula = this._applyDamageDiceModifiers(
      critical ? this._doubleDiceCounts(baseFormula) : baseFormula,
      "base",
      options,
    );
    const roll = new Roll(formula, rollData);
    await roll.evaluate();

    const rollHTML = $("<div>" + (await roll.render()) + "</div>");
    await ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [roll],
      flavor: this._getBaseRollFlavor({ critical, autoFromHit }),
      content: `${rollHTML.html()} ${this._getApplyButton(roll.result)}`,
    });
  }

  async _rollAlternate(options = {}) {
    options = this._normalizeRollOptions(options);
    if (!this._hasFormula(this.system.alternate_formula)) return;
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    const rollData = this.getRollData();
    const roll = new Roll(
      this._applyDamageDiceModifiers(
        this._appendDamageFormulaModifiers(
          this._composeFormulaWithAttribute(
            rollData.alternate_formula,
            rollData.alternate_formula_attribute,
          ),
          "alternate",
          options,
        ),
        "alternate",
        options,
      ),
      rollData,
    );
    await roll.evaluate();
    const rollHTML = $("<div>" + (await roll.render()) + "</div>");
    await ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [roll],
      flavor: game.i18n.format("FFXIV.Abilities.BaseEffectRoll"),
      content: `${rollHTML.html()} ${this._getApplyButton(roll.result)}`,
    });
  }

  _getRollButtons() {
    let buttons = "<div style='display:flex;flex-wrap: wrap;'>";
    const buttonData = this._getChatButtonData();
    if (this._hasFormula(this.system.alternate_formula))
      buttons += `<button class="ffxiv-roll-alternate" ${buttonData}>${game.i18n.localize("FFXIV.Chat.RollAlternateFormula")}</button>`;
    const statusEntries = this._getStatusEffectEntries().filter(
      (entry) => entry.applyMode !== "auto",
    );
    if (statusEntries.length) {
      const encodedStatusEntries = encodeURIComponent(
        JSON.stringify(statusEntries),
      );
      buttons += `<button class="ffxiv-apply-status" data-item-id="${this._id}" data-item-uuid="${this.uuid}" data-actor-id="${this.parent._id}" data-actor-uuid="${this.parent?.uuid ?? ""}" data-source-uuid="${this.uuid}" data-status-entries="${encodedStatusEntries}">${game.i18n.localize("FFXIV.Abilities.StatusEffect")}</button>`;
    }
    const manuallyAppliedEffects = Array.from(this.effects ?? []).filter((effect) => {
      const applyTo = String(effect.getFlag("ffxiv", "applyTo") || "target").trim().toLowerCase();
      return !effect.disabled && applyTo !== "self_auto" && applyTo !== "automation";
    });
    if (manuallyAppliedEffects.length) {
      buttons += `<button class="ffxiv-apply-active-effects" data-item-id="${this._id}" data-item-uuid="${this.uuid}" data-actor-id="${this.parent._id}" data-actor-uuid="${this.parent?.uuid ?? ""}">${game.i18n.localize("FFXIV.Abilities.ApplyActiveEffects")}</button>`;
    }
    if (this._hasHitRoll() && !this._shouldAutoCheckBeforeBase()) {
      const hitLabel =
        !this._hasDirectRoll() && this._hasCheck()
          ? game.i18n.localize("FFXIV.Abilities.Check")
          : game.i18n.localize("FFXIV.Chat.RollHitFormula");
      buttons += `<button class="ffxiv-roll-hit" ${buttonData}>${hitLabel}</button>`;
    }
    for (const option of this._getJobResourceBonusOptions()) {
      buttons += `<button class="ffxiv-roll-resource-bonus" data-resource-bonus="${option.key}" ${buttonData}>${option.buttonLabel}</button>`;
    }
    if (
      this.type != "trait" &&
      this.parent?.system?.showModifiers == "true" &&
      this._hasDisplayableModifiers()
    ) {
      buttons += `<button class="ffxiv-show-modifiers" ${buttonData}>${game.i18n.localize("FFXIV.Chat.ShowModifiers")}</button>`;
    }
    return buttons + "</div>";
  }

  _getChatButtonData() {
    return `data-item-id="${this._id}" data-item-uuid="${this.uuid}" data-actor-id="${this.parent?._id ?? ""}" data-actor-uuid="${this.parent?.uuid ?? ""}" data-effect-snapshot="${this._encodeEffectSnapshotData()}"`;
  }

  _normalizeRollOptions(options = {}) {
    const isEvent = typeof Event !== "undefined" && options instanceof Event;
    const dataset = isEvent ? options.currentTarget?.dataset : null;
    const normalized =
      options && typeof options === "object" && !isEvent ? { ...options } : {};

    if (dataset?.critical !== undefined)
      normalized.critical = dataset.critical === "true";
    if (dataset?.directHitOption !== undefined)
      normalized.directHitOption = dataset.directHitOption;
    if (dataset?.resourceBonus !== undefined)
      normalized.resourceBonus = dataset.resourceBonus;

    const snapshot =
      dataset?.effectSnapshot ?? normalized.effectSnapshot ?? null;
    if (snapshot !== null) {
      const parsed = this._parseEffectSnapshotData(snapshot);
      if (parsed) normalized.effectSnapshot = parsed;
    }

    return normalized;
  }

  _getEffectSnapshotData() {
    return Array.from(this.parent?.allApplicableEffects?.() ?? [])
      .filter((effect) => effect && !effect.disabled)
      .map((effect) => ({
        id: effect.id ?? effect._id ?? "",
        name: effect.name ?? "",
        flags: foundry.utils.deepClone(effect.flags ?? {}),
        changes: foundry.utils.deepClone(effect.changes ?? []),
        statuses: Array.from(effect.statuses ?? []),
        disabled: false,
      }));
  }

  _encodeEffectSnapshotData() {
    return encodeURIComponent(JSON.stringify(this._getEffectSnapshotData()));
  }

  _parseEffectSnapshotData(value) {
    if (Array.isArray(value)) return value;
    if (!value) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(String(value)));
      return Array.isArray(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  _getApplicableEffects(options = {}) {
    if (Array.isArray(options?.effectSnapshot)) return options.effectSnapshot;
    return Array.from(this.parent?.allApplicableEffects?.() ?? []);
  }

  _hasDisplayableModifiers() {
    return (
      this.parent?.items?.some(
        (item) => item?.type === "trait" && item?.system?.active === true,
      ) ?? false
    );
  }

  _getStatusEffectEntries() {
    const entries = Array.isArray(this.system.status_effects)
      ? this.system.status_effects
      : [];
    if (entries.length) {
      return entries
        .map((entry) => ({
          id: entry?.id ?? "",
          action: entry?.action !== false,
          applyMode: entry?.applyMode === "auto" ? "auto" : "manual",
          applyTo: this._normalizeStatusApplyTo(entry?.applyTo),
          allSources: entry?.allSources === true,
          stacks: Math.max(1, Number.parseInt(entry?.stacks, 10) || 1),
          duration: entry?.duration,
        }))
        .filter((entry) => entry.id);
    }
    if (!this.system.status_effect) return [];
    return [
      {
        id: this.system.status_effect,
        action: this.system.status_action !== false,
        applyMode: this.system.status_apply_mode === "auto" ? "auto" : "manual",
        applyTo: "target",
        stacks: 1,
        duration: null,
      },
    ];
  }

  _normalizeStatusApplyTo(value) {
    return String(value ?? "").trim().toLowerCase() === "self"
      ? "self"
      : "target";
  }

  _getAutoStatusEffectEntries() {
    return this._getStatusEffectEntries()
      .filter((entry) => entry.applyMode === "auto")
      .map((entry) => ({
        ...entry,
        statusId: entry.id,
        active: entry.action,
        sourceUuid: this.uuid,
      }));
  }

  async _autoApplyStatusEffects(chatMessage = null) {
    const statusEntries = this._getAutoStatusEffectEntries();
    if (!statusEntries.length) return;

    const appliedEffects = [];

    const selfEntries = statusEntries.filter((entry) => entry.applyTo === "self");
    const targetEntries = statusEntries.filter((entry) => entry.applyTo !== "self");
    const socketApplications = [];
    const sendSocketApplications = () => {
      if (!socketApplications.length) return;
      const sent = emitToActiveGM({
        type: "applyEffect",
        data: { applications: socketApplications },
        userName: game.user.name,
      });
      if (sent) {
        ui.notifications.info(
          game.i18n.localize("FFXIV.Notifications.SendSocket"),
        );
      }
    };

    if (selfEntries.length && this.parent?.documentName === "Actor") {
      if (this.parent.testUserPermission(game.user, "OWNER")) {
        for (const entry of selfEntries) {
          const applied = await this._applyStatusEntryToActor(this.parent, entry);
          if (applied) {
            const stacks = entry?.stacks ? Number.parseInt(entry.stacks, 10) : 1;
            const effectLabel = stacks > 1 ? `${this._getStatusLabelById(entry.statusId)} (${stacks})` : this._getStatusLabelById(entry.statusId);
            appliedEffects.push({
              effect: effectLabel,
              actor: this.parent.name,
              statusId: entry.statusId,
              actorId: this.parent.uuid,
              sourceUuid: this.uuid,
              stacks: stacks,
              applyTo: entry.applyTo,
            });
          }
        }
      } else {
        socketApplications.push({
          actorId: this.parent.id,
          actorRef: String(this.parent.uuid ?? this.parent.id ?? "").trim(),
          effects: selfEntries,
        });
      }
    }

    if (!targetEntries.length) {
      sendSocketApplications();
    } else {
      const targets = Array.from(game.user.targets ?? []);
      if (targets.length === 0) {
        sendSocketApplications();
        ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
      } else {
        const ownActors = [];
        const actorsNeedingGM = [];
        for (const token of targets) {
          const actor = token.actor;
          if (!actor) continue;
          if (actor.testUserPermission(game.user, "OWNER")) ownActors.push(actor);
          else actorsNeedingGM.push(actor);
        }

        for (const actor of ownActors) {
          for (const entry of targetEntries) {
            const applied = await this._applyStatusEntryToActor(actor, entry);
            if (applied) {
              const stacks = entry?.stacks ? Number.parseInt(entry.stacks, 10) : 1;
              const effectLabel = stacks > 1 ? `${this._getStatusLabelById(entry.statusId)} (${stacks})` : this._getStatusLabelById(entry.statusId);
              appliedEffects.push({
                effect: effectLabel,
                actor: actor.name,
                statusId: entry.statusId,
                actorId: actor.uuid,
                sourceUuid: this.uuid,
                stacks: stacks,
                applyTo: entry.applyTo,
              });
            }
          }
        }

        if (actorsNeedingGM.length > 0) {
          for (const actor of actorsNeedingGM) {
            socketApplications.push({
              actorId: actor.id,
              actorRef: String(actor?.uuid ?? actor?.id ?? "").trim(),
              effects: targetEntries,
            });
          }
        }
        sendSocketApplications();
      }
    }

    if (appliedEffects.length && chatMessage) {
      const effectText = appliedEffects
        .map(({ effect, actor, statusId, actorId, sourceUuid, stacks, applyTo }, index) => 
          `<div class="effect fxiv-status-effect-applied" data-undo-id="${chatMessage.id}-${index}" data-undo-status='{"statusId":"${statusId}","actorId":"${actorId}","sourceUuid":"${sourceUuid}","stacks":${stacks},"applyTo":"${applyTo}"}'>
            <span class="fxiv-status-effect-text"><strong>${effect}</strong> applied to ${actor}.</span>
            <button class="ffxiv-undo-status-effect">
              <i class="fas fa-undo"></i>
            </button>
          </div>`
        )
        .join("");
      
      await chatMessage.update({
        content: chatMessage.content + `<div class="item-dialog-effects fxiv-status-effects">${effectText}</div>`
      });
      
      // Wait for DOM to update then adjust scroll
      setTimeout(() => {
        const chatCardElement = document.querySelector(`[data-message-id="${chatMessage.id}"]`);
        const scrollContainer = chatCardElement?.closest('.chat-log') || 
                                chatCardElement?.closest('#chat-log') ||
                                document.querySelector('.chat-log') ||
                                document.querySelector('#chat-log');
        
        if (scrollContainer) {
          const previousScrollTop = scrollContainer.scrollTop;
          const previousScrollHeight = scrollContainer.scrollHeight;
          const wasNearBottom = previousScrollTop + scrollContainer.clientHeight >= previousScrollHeight - 10;
          
          if (wasNearBottom) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
          }
        }
      }, 50);
    } else if (appliedEffects.length) {
      for (const { effect, actor } of appliedEffects) {
        ui.notifications.info(
          game.i18n.format("FFXIV.Notifications.EffectApplied", {
            effect,
            actor,
          }),
        );
      }
    }
  }

  async _applyStatusEntryToActor(actor, entry) {
    const statusId = String(entry?.statusId ?? entry?.id ?? "").trim();
    if (!actor || !statusId) return;
    const stacks = Math.max(1, Number.parseInt(entry?.stacks, 10) || 1);
    const origin = String(entry?.sourceUuid ?? "").trim() || null;
    const duration = entry?.duration ?? null;

    if (isStackableStatusEffect(statusId)) {
      let result;
      if (isAdditiveStackableStatusEffect(statusId)) {
        result = await applyStatusEffectStackDelta(
          actor,
          statusId,
          entry.active === false ? -stacks : stacks,
          { origin, duration },
        );
      } else {
        result = await applyStatusEffectStackValue(
          actor,
          statusId,
          entry.active === false ? 0 : stacks,
          { origin, duration },
        );
      }
      return result !== false;
    }

    const result = await applyStatusEffectChange(actor, statusId, entry.active !== false, {
      origin,
      duration,
    });
    return result !== false;
  }

  _getEffectRules() {
    if (!isAbilityAutomationEnabled()) return [];
    const entries = Array.isArray(this.system.effect_rules)
      ? this.system.effect_rules
      : [];
    return entries
      .map((entry) => this._normalizeEffectRule(entry))
      .filter((entry) => this._isUsableEffectRule(entry));
  }

  _normalizeEffectRule(entry) {
    return {
      action: String(entry?.action ?? "grant").trim().toLowerCase() || "grant",
      trigger: String(entry?.trigger ?? "use").trim() || "use",
      key: this._normalizeEffectKey(entry?.key ?? entry?.name),
      name: String(entry?.name ?? entry?.key ?? "").trim(),
      iconOverride: String(entry?.iconOverride ?? "").trim(),
      icon: String(entry?.icon ?? "").trim(),
      applyTo: String(entry?.applyTo ?? "self").trim().toLowerCase(),
      threshold: Number.parseInt(entry?.threshold, 10),
      remove: this._normalizeEffectRefs(entry?.remove),
      requires: this._normalizeEffectRefs(entry?.requires),
      requiresAny: this._normalizeEffectRefs(entry?.requiresAny),
      forbids: this._normalizeEffectRefs(entry?.forbids),
      requiresResourceSpent: String(entry?.requiresResourceSpent ?? "").trim(),
      requiresResourceSpentMin: entry?.requiresResourceSpentMin ?? entry?.spentMin,
      requiresResourceSpentMax: entry?.requiresResourceSpentMax ?? entry?.spentMax,
      operation: String(entry?.operation ?? entry?.resourceAction ?? "grant")
        .trim()
        .toLowerCase(),
      resource: String(entry?.resource ?? entry?.resourceName ?? "").trim(),
      amount: entry?.amount ?? 1,
      min: entry?.min,
      spentResource: String(entry?.spentResource ?? entry?.amountResource ?? "").trim(),
      storeResourceCosts:
        entry?.storeResourceCosts === true ||
        entry?.storeJobResourceCosts === true,
      flags: foundry.utils.deepClone(entry?.flags ?? {}),
      toggle1: this._normalizeEffectRef(entry?.toggle1),
      toggle2: this._normalizeEffectRef(entry?.toggle2),
      duration: entry?.duration,
      onGrant: this._normalizeEffectRuleEntries(entry?.onGrant),
    };
  }

  _normalizeEffectRuleEntries(entries) {
    return this._toArray(entries)
      .map((entry) => this._normalizeEffectRule(entry))
      .filter((entry) => this._isUsableEffectRule(entry));
  }

  _isUsableEffectRule(entry) {
    return (
      entry.key ||
      entry.action === "toggle" ||
      (entry.action === "resource" && entry.resource)
    );
  }

  _getEffectRequirements() {
    if (!isAbilityAutomationEnabled()) return [];
    const entries = Array.isArray(this.system.effect_requirements)
      ? this.system.effect_requirements
      : [];
    return entries
      .map((entry) => ({
        key: this._normalizeEffectKey(entry?.key ?? entry?.name),
        name: String(entry?.name ?? entry?.key ?? "").trim(),
        mode: entry?.mode === "forbidden" ? "forbidden" : "required",
        consume: entry?.consume === true,
        bypass: this._normalizeEffectRefs(entry?.bypass),
        resourceSpent: String(entry?.resourceSpent ?? "").trim(),
        resourceSpentMin: entry?.resourceSpentMin ?? entry?.spentMin ?? entry?.min,
        resourceSpentMax: entry?.resourceSpentMax ?? entry?.spentMax ?? entry?.max,
      }))
      .filter((entry) => entry.key || entry.resourceSpent);
  }

  _canSatisfyEffectRequirements() {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return true;

    const missing = [];
    const blocked = [];
    for (const requirement of this._getEffectRequirements()) {
      const hasEffect = requirement.key
        ? this._hasNamedEffect(actor, requirement.key)
        : true;
      const hasResourceSpent = this._requirementResourceSpentSatisfied(
        actor,
        requirement,
      );
      if (requirement.mode === "forbidden") {
        if (hasEffect && hasResourceSpent)
          blocked.push(requirement.name || requirement.key || requirement.resourceSpent);
        continue;
      }

      const bypassed =
        (requirement.key && this._hasRequirementBypass(actor, requirement)) ||
        requirement.bypass.some((entry) =>
          this._hasNamedEffect(actor, entry.key),
        );
      if ((!hasEffect || !hasResourceSpent) && !bypassed)
        missing.push(requirement.name || requirement.key || requirement.resourceSpent);
    }

    if (!missing.length && !blocked.length) return true;

    const messages = [];
    if (missing.length) messages.push(`requires ${missing.join(", ")}`);
    if (blocked.length) messages.push(`cannot be used while under ${blocked.join(", ")}`);
    ui.notifications.warn(`${this.name}: ${messages.join("; ")}.`);
    return false;
  }

  async _consumeEffectRequirements() {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return;

    for (const requirement of this._getEffectRequirements()) {
      if (requirement.mode !== "required" || !requirement.consume) continue;
      await this._removeNamedEffects(actor, [requirement]);
    }
  }

  _hasRequirementBypass(actor, requirement) {
    const requirementKey = this._normalizeEffectKey(requirement?.key);
    if (!requirementKey) return false;
    return Array.from(actor?.effects ?? []).some((effect) => {
      if (!effect || effect.disabled) return false;
      return this._getRequirementBypassRefs(effect).some(
        (entry) => entry.key === requirementKey,
      );
    });
  }

  _requirementResourceSpentSatisfied(actor, requirement) {
    const resource = String(requirement?.resourceSpent ?? "").trim();
    if (!resource) return true;
    const key = normalizeJobResourceName(resource);
    const spent = Math.max(
      ...Array.from(actor?.effects ?? []).map((effect) => {
        if (!effect || effect.disabled) return 0;
        if (
          requirement.key &&
          !this._effectMatchesKey(effect, requirement.key)
        )
          return 0;
        return Number(foundry.utils.getProperty(
          effect,
          `flags.ffxiv.jobResourceCosts.${key}`,
        )) || 0;
      }),
      0,
    );
    const min = Number.parseInt(requirement.resourceSpentMin, 10);
    if (Number.isFinite(min) && spent < min) return false;
    const max = Number.parseInt(requirement.resourceSpentMax, 10);
    if (Number.isFinite(max) && spent > max) return false;
    return spent > 0;
  }

  _getRequirementBypassRefs(effect) {
    const data = foundry.utils.getProperty(effect, "flags.ffxiv.requirementBypass");
    if (!data) return [];
    if (Array.isArray(data)) return this._normalizeEffectRefs(data);
    if (typeof data === "string") return this._normalizeEffectRefs([data]);
    if (typeof data !== "object") return [];
    const refs = data.keys ?? data.requirements ?? data.effects ?? data;
    return this._normalizeEffectRefs(refs);
  }

  _getJobResourceCostRules() {
    return this._getEffectRules().filter(
      (rule) =>
        rule.action === "resource" &&
        rule.trigger === "cost" &&
        rule.operation === "consume",
    );
  }

  _canSatisfyJobResourceCosts() {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return true;

    const missing = [];
    for (const rule of this._getJobResourceCostRules()) {
      const required = this._getJobResourceRequiredAmount(actor, rule);
      if (required <= 0) continue;
      if (!hasActorJobResource(actor, rule.resource, required)) {
        missing.push(`${required} ${rule.resource}`);
      }
    }

    if (!missing.length) return true;
    ui.notifications.warn(`${this.name}: requires ${missing.join(", ")}.`);
    return false;
  }

  async _consumeJobResourceCostsIfNeeded() {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return true;

    const costRules = this._getJobResourceCostRules();
    if (!costRules.length) return true;
    if (!this._canSatisfyJobResourceCosts()) return false;

    const spent = {};
    for (const rule of costRules) {
      const amount = this._getJobResourceSpendAmount(actor, rule);
      if (amount <= 0) continue;
      const result = await applyActorJobResourceDelta(
        actor,
        rule.resource,
        -amount,
        { render: false },
      );
      if (result.item) {
        const key = normalizeJobResourceName(rule.resource);
        spent[key] = (spent[key] ?? 0) + Math.max(result.current - result.next, 0);
      }
    }
    this._ffxivJobResourceCostResult = spent;
    return true;
  }

  _getJobResourceRequiredAmount(actor, rule) {
    const min = Number.parseInt(rule?.min, 10);
    if (Number.isFinite(min)) return Math.max(min, 0);
    if (String(rule?.amount ?? "").trim().toLowerCase() === "all")
      return 0;
    return Math.max(Number.parseInt(rule?.amount, 10) || 0, 0);
  }

  _getJobResourceSpendAmount(actor, rule) {
    if (String(rule?.amount ?? "").trim().toLowerCase() === "all")
      return getActorJobResourceCount(actor, rule.resource);
    return Math.max(Number.parseInt(rule?.amount, 10) || 0, 0);
  }

  async _applyEffectRules(trigger, context = {}) {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return;

    for (const rule of this._getEffectRules()) {
      if (rule.trigger !== trigger) continue;
      if (!this._canApplyEffectRule(actor, rule, context)) continue;
      await this._applyEffectRule(actor, rule, context);
    }
  }

  async _applyDeferredHitThresholdRules(checkResult) {
    if (!checkResult?.deferredHitThresholdRules || checkResult.interrupted)
      return;
    await this._applyEffectRules("hitThreshold", {
      d20Result: checkResult.d20Result,
      roll: checkResult.roll,
      directHitRoll: checkResult.directHitRoll,
    });
  }

  async _applyCriticalJobResourceAutomation(isCritical) {
    const actor = this.parent;
    if (
      !isAbilityAutomationEnabled() ||
      !isCritical ||
      actor?.documentName !== "Actor"
    )
      return;

    for (const trait of actor.items ?? []) {
      if (trait?.type !== "trait") continue;
      const data = foundry.utils.getProperty(
        trait,
        "flags.ffxiv.jobResource.onCritical",
      );
      const entries = Array.isArray(data) ? data : data ? [data] : [];
      for (const entry of entries) {
        const minLevel = Number.parseInt(entry?.minLevel, 10);
        if (Number.isFinite(minLevel) && getActorLevel(actor) < minLevel)
          continue;
        const resource = String(entry?.resource ?? entry?.name ?? "").trim();
        if (!resource) continue;
        const amount = Math.max(Number.parseInt(entry?.amount, 10) || 1, 1);
        await applyActorJobResourceDelta(actor, resource, amount, {
          render: false,
        });
      }
    }
  }

  _canApplyEffectRule(actor, rule, context) {
    if (rule.trigger === "hitThreshold") {
      const threshold = Number.parseInt(rule.threshold, 10);
      const d20Result = Number.parseInt(context?.d20Result, 10);
      if (!Number.isFinite(threshold) || !Number.isFinite(d20Result))
        return false;
      if (d20Result < threshold) return false;
    }

    if (rule.requires.some((entry) => !this._hasNamedEffect(actor, entry.key)))
      return false;
    if (
      rule.requiresAny.length &&
      !rule.requiresAny.some((entry) => this._hasNamedEffect(actor, entry.key))
    )
      return false;
    if (rule.forbids.some((entry) => this._hasNamedEffect(actor, entry.key)))
      return false;
    if (rule.requiresResourceSpent) {
      const key = normalizeJobResourceName(rule.requiresResourceSpent);
      const spent = Number(context?.jobResourceCosts?.[key] ?? 0);
      if (!Number.isFinite(spent) || spent <= 0) return false;
      const min = Number.parseInt(rule.requiresResourceSpentMin, 10);
      if (Number.isFinite(min) && spent < min) return false;
      const max = Number.parseInt(rule.requiresResourceSpentMax, 10);
      if (Number.isFinite(max) && spent > max) return false;
    }
    return true;
  }

  async _applyEffectRule(actor, rule, context = {}) {
    if (rule.action === "resource") {
      await this._applyJobResourceRule(actor, rule, context);
      return;
    }
    if (rule.action === "remove") {
      await this._removeNamedEffects(actor, [rule]);
      return;
    }
    if (rule.action === "toggle") {
      await this._toggleNamedEffects(actor, rule);
      return;
    }

    await this._removeNamedEffects(actor, rule.remove);
    await this._grantNamedEffect(actor, rule, context);
  }

  async _applyJobResourceRule(actor, rule, context = {}) {
    const resource = String(rule?.resource ?? "").trim();
    if (!resource) return;

    if (rule.operation === "fill") {
      await fillActorJobResource(actor, resource, { render: false });
      return;
    }
    if (rule.operation === "clear") {
      await setActorJobResourceCount(actor, resource, 0, { render: false });
      return;
    }
    if (rule.operation === "set") {
      const amount = this._resolveJobResourceRuleAmount(rule, context, 0);
      await setActorJobResourceCount(actor, resource, amount, { render: false });
      return;
    }

    const amount = this._resolveJobResourceRuleAmount(rule, context, 1);
    if (amount <= 0) return;
    if (rule.operation === "consume") {
      await applyActorJobResourceDelta(actor, resource, -amount, { render: false });
      return;
    }
    await applyActorJobResourceDelta(actor, resource, amount, { render: false });
  }

  _resolveJobResourceRuleAmount(rule, context, fallback) {
    const amountText = String(rule?.amount ?? "").trim().toLowerCase();
    if (amountText === "spent") {
      const resource = String(rule?.spentResource || rule?.resource || "").trim();
      const key = normalizeJobResourceName(resource);
      return Math.max(Number(context?.jobResourceCosts?.[key] ?? 0) || 0, 0);
    }
    return Math.max(Number.parseInt(rule?.amount, 10) || fallback, 0);
  }

  async _toggleNamedEffects(actor, rule) {
    if (!rule.toggle1?.key || !rule.toggle2?.key) return;
    if (this._hasNamedEffect(actor, rule.toggle1.key)) {
      await this._removeNamedEffects(actor, [rule.toggle1]);
      await this._grantNamedEffect(actor, rule.toggle2);
      return;
    }
    if (this._hasNamedEffect(actor, rule.toggle2.key)) {
      await this._removeNamedEffects(actor, [rule.toggle2]);
      await this._grantNamedEffect(actor, rule.toggle1);
    }
  }

  async _grantNamedEffect(actor, rule, context = {}) {
    const key = this._normalizeEffectKey(rule?.key ?? rule?.name);
    if (!actor || !key) return;
    if (this._isStatusEffectId(key)) {
      await applyStatusEffectChange(actor, key, true, { origin: this.uuid });
      return;
    }

    await this._removeNamedEffects(actor, [{ key }], {
      suppressRemovalText: true,
    });

    const template = this._getLinkedAutomationEffectTemplate(rule);
    const effectData = template
      ? this._buildLinkedAutomationEffectData(template, rule, key, context)
      : this._buildNamedAutomationEffectData(rule, key, context);
    await actor.createEmbeddedDocuments("ActiveEffect", [effectData], {
      render: false,
    });
    for (const nestedRule of rule.onGrant ?? []) {
      if (!this._canApplyEffectRule(actor, nestedRule, {
        ...context,
        grantedKey: key,
      }))
        continue;
      await this._applyEffectRule(actor, nestedRule, context);
    }
  }

  _getLinkedAutomationEffectTemplate(rule) {
    const key = this._normalizeEffectKey(rule?.key ?? rule?.name);
    if (!key) return null;

    const effects = Array.from(this.effects ?? []).filter((effect) =>
      this._effectMatchesKey(effect, key),
    );
    return (
      effects.find((effect) => this._getLinkedAutomationEffectScope(effect) === "automation") ??
      effects[0] ??
      null
    );
  }

  _getLinkedAutomationEffectScope(effect) {
    return String(effect?.getFlag?.("ffxiv", "applyTo") ?? "")
      .trim()
      .toLowerCase();
  }

  _buildLinkedAutomationEffectData(effect, rule, key, context = {}) {
    const effectData = foundry.utils.deepClone(effect.toObject());
    delete effectData._id;

    const name = String(rule?.name ?? effect.name ?? key).trim() || key;
    const icon =
      this._getAutomationIconOverride(rule) ||
      this._getAutomationIcon(effectData.img) ||
      this._getAutomationIcon(effectData.icon) ||
      this._getAutomationIcon(this.img) ||
      "icons/svg/aura.svg";
    const showAlways = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;

    effectData.name = name;
    effectData.img = icon;
    effectData.icon = icon;
    effectData.origin = this.uuid;
    effectData.disabled = false;
    effectData.transfer = false;
    effectData.statuses = [];
    effectData.displayStatusIcon = false;
    effectData.showIcon = showAlways;
    effectData.flags = foundry.utils.mergeObject(effectData.flags || {}, {
      ffxiv: {
        abilityEffectRule: true,
        effectKey: key,
        sourceItemUuid: this.uuid,
        linkedAutomationTemplate: true,
        linkedSourceEffectId: effect.id,
        linkedSourceItemId: this.id,
        linkedSourceItemUuid: this.uuid,
      },
    });
    if (rule?.flags && typeof rule.flags === "object") {
      effectData.flags = foundry.utils.mergeObject(
        effectData.flags || {},
        foundry.utils.deepClone(rule.flags),
      );
    }
    this._applyRuleContextFlags(effectData, rule, context);

    const duration = this._prepareEffectRuleDuration(
      rule?.duration ?? effectData.duration,
    );
    if (duration) effectData.duration = duration;
    else delete effectData.duration;
    return effectData;
  }

  _buildNamedAutomationEffectData(rule, key, context = {}) {
    const name = String(rule?.name ?? rule?.key ?? key).trim() || key;
    const icon =
      this._getAutomationIconOverride(rule) ||
      this._getAutomationIcon(this.img) ||
      "icons/svg/aura.svg";
    const showAlways = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;
    const effectData = {
      name,
      img: icon,
      icon,
      origin: this.uuid,
      disabled: false,
      transfer: false,
      statuses: [],
      displayStatusIcon: false,
      showIcon: showAlways,
      flags: {
        ffxiv: {
          abilityEffectRule: true,
          effectKey: key,
          sourceItemUuid: this.uuid,
        },
      },
    };
    if (rule?.flags && typeof rule.flags === "object") {
      effectData.flags = foundry.utils.mergeObject(
        effectData.flags || {},
        foundry.utils.deepClone(rule.flags),
      );
    }
    this._applyRuleContextFlags(effectData, rule, context);
    const duration = this._prepareEffectRuleDuration(rule?.duration);
    if (duration) effectData.duration = duration;
    return effectData;
  }

  _applyRuleContextFlags(effectData, rule, context = {}) {
    if (rule?.storeResourceCosts !== true) return;
    const costs = context?.jobResourceCosts;
    if (!costs || typeof costs !== "object" || !Object.keys(costs).length)
      return;
    effectData.flags = foundry.utils.mergeObject(effectData.flags || {}, {
      ffxiv: {
        jobResourceCosts: foundry.utils.deepClone(costs),
      },
    });
  }

  _getAutomationIconOverride(rule) {
    return (
      this._getAutomationIcon(rule?.iconOverride) ||
      this._getAutomationIcon(rule?.icon)
    );
  }

  _getAutomationIcon(icon) {
    const value = String(icon ?? "").trim();
    if (!value) return "";
    const normalized = value.toLowerCase().replace(/\\/g, "/").split(/[?#]/)[0];
    return normalized === "ready.webp" || normalized.endsWith("/ready.webp")
      ? ""
      : value;
  }

  async _removeNamedEffects(actor, refs, options = {}) {
    if (!actor?.effects?.size) return;
    const keys = this._normalizeEffectRefs(refs).map((entry) => entry.key);
    if (!keys.length) return;

    for (const key of keys) {
      if (this._isStatusEffectId(key))
        await applyStatusEffectChange(actor, key, false);
    }

    const ids = actor.effects
      .filter((effect) =>
        keys.some((key) => this._effectMatchesKey(effect, key)),
      )
      .map((effect) => effect.id)
      .filter(Boolean);
    if (ids.length)
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids, {
        render: false,
        ffxivSuppressRemovalText: options.suppressRemovalText === true,
      });
  }

  _hasNamedEffect(actor, key) {
    const normalizedKey = this._normalizeEffectKey(key);
    if (!actor?.effects?.size || !normalizedKey) return false;
    if (this._isStatusEffectId(normalizedKey) && hasStatus(actor, normalizedKey))
      return true;

    return actor.effects.some((effect) => {
      if (!effect || effect.disabled) return false;
      return this._effectSatisfiesKey(effect, normalizedKey);
    });
  }

  _hasNamedApplicableEffect(actor, key, options = {}) {
    const normalizedKey = this._normalizeEffectKey(key);
    if (!normalizedKey) return false;
    if (Array.isArray(options?.effectSnapshot)) {
      return options.effectSnapshot.some((effect) => {
        if (!effect || effect.disabled) return false;
        return this._effectSatisfiesKey(effect, normalizedKey);
      });
    }
    return this._hasNamedEffect(actor, normalizedKey);
  }

  _effectSatisfiesKey(effect, key) {
    const normalizedKey = this._normalizeEffectKey(key);
    if (!effect || !normalizedKey) return false;
    if (this._effectMatchesKey(effect, normalizedKey)) return true;
    return this._getEffectCountsAsKeys(effect).includes(normalizedKey);
  }

  _effectMatchesKey(effect, key) {
    const normalizedKey = this._normalizeEffectKey(key);
    if (!effect || !normalizedKey) return false;

    const flagKey = this._normalizeEffectKey(
      effect.getFlag?.("ffxiv", "effectKey") ??
      foundry.utils.getProperty(effect, "flags.ffxiv.effectKey"),
    );
    if (flagKey && flagKey === normalizedKey) return true;
    return this._normalizeEffectKey(effect.name) === normalizedKey;
  }

  _getEffectCountsAsKeys(effect) {
    const refs = [];
    for (const value of [
      foundry.utils.getProperty(effect, "flags.ffxiv.countsAs"),
      foundry.utils.getProperty(effect, "flags.ffxiv.equivalentEffects"),
      foundry.utils.getProperty(effect, "flags.ffxiv.effectAliases"),
    ]) {
      refs.push(...this._normalizeEffectRefs(value).map((entry) => entry.key));
    }
    return Array.from(new Set(refs.filter(Boolean)));
  }

  _isStatusEffectId(key) {
    const normalizedKey = this._normalizeEffectKey(key);
    return (CONFIG.statusEffects ?? []).some((effect) =>
      this._normalizeEffectKey(effect?.id) === normalizedKey,
    );
  }

  _normalizeEffectRefs(value) {
    const entries = Array.isArray(value)
      ? value
      : value
        ? [value]
        : [];
    return entries
      .map((entry) => this._normalizeEffectRef(entry))
      .filter((entry) => entry.key);
  }

  _normalizeEffectRef(value) {
    if (!value) return { key: "", name: "" };
    if (typeof value === "string") {
      return {
        key: this._normalizeEffectKey(value),
        name: value.trim(),
      };
    }
    const name = String(value.name ?? value.key ?? "").trim();
    return {
      key: this._normalizeEffectKey(value.key ?? name),
      name,
      iconOverride: String(value.iconOverride ?? "").trim(),
      icon: String(value.icon ?? "").trim(),
      duration: value.duration,
    };
  }

  _normalizeEffectKey(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  _prepareEffectRuleDuration(duration) {
    if (!duration || typeof duration !== "object") return null;

    const prepared = {};
    for (const key of ["rounds", "turns"]) {
      const value = Number(duration[key]);
      if (Number.isFinite(value) && value > 0) prepared[key] = value;
    }
    if (!Object.keys(prepared).length) return null;

    prepared.startTime = game.time?.worldTime ?? null;
    const combat = game.combat;
    if (combat?.started && combat.turns?.length) {
      prepared.combat = combat.id;
      prepared.startRound = combat.round ?? null;
      prepared.startTurn = combat.turn ?? null;
    } else {
      prepared.startRound = null;
      prepared.startTurn = null;
    }
    return prepared;
  }

  _getStatusLabelById(statusId) {
    const effect = CONFIG.statusEffects?.find((entry) => entry.id === statusId);
    if (!effect) return statusId;
    return game.i18n.localize(effect.label ?? effect.name ?? statusId);
  }

  async _applyInvokingStatus() {
    if (!this._isInvokedAbility() || !this.parent?.toggleStatusEffect) return;

    await this.parent.toggleStatusEffect("invoking", {
      active: true,
      render: false,
    });
  }

  _hasFormula(formula) {
    return typeof formula === "string" && formula.trim() !== "";
  }

  _hasDirectRoll() {
    return this._hasFormula(
      this._composeFormulaWithAttribute(
        this.system.direct_formula,
        this.system.direct_formula_attribute,
      ),
    );
  }

  _hasHitRoll() {
    return (
      this._hasFormula(
        this._composeFormulaWithAttribute(
          this.system.hit_formula,
          this.system.hit_formula_attribute,
        ),
      ) || this._hasCheck()
    );
  }

  _hasCheck() {
    const check = this.system.check;
    if (typeof check !== "string") return false;
    const normalized = check.trim();
    if (!normalized) return false;
    return !["None", "FFXIV.None", game.i18n.localize("FFXIV.None")].includes(
      normalized,
    );
  }

  _getHitBaseFormula(rollData = this.getRollData()) {
    if (this._hasFormula(this.system.hit_formula)) {
      return this._composeFormulaWithAttribute(
        rollData.hit_formula,
        rollData.hit_formula_attribute,
      );
    }
    return this._getCheckFormula() || "1d20";
  }

  _getCheckFormula() {
    if (!this._hasCheck()) return null;

    const check = this.system.check.trim();
    const aliases = {
      "FFXIV.Attributes.Defense": "def",
      "FFXIV.Attributes.MagicDefense": "mdef",
      "FFXIV.Attributes.Vigilance": "vigilance",
      "FFXIV.Attributes.Speed": "speed",
    };

    for (const [key, attribute] of Object.entries(
      CONFIG.FFXIV.attributes || {},
    )) {
      if (attribute.label !== check) continue;
      const abbreviation =
        CONFIG.FFXIV.attributesAbbreviations?.[key]?.value ||
        aliases[attribute.label];
      if (abbreviation) return `1d20 + @${abbreviation}`;
    }

    return "1d20";
  }

  _shouldAutoCheckBeforeBase() {
    return (
      this._hasCheck() &&
      this._hasFormula(this.system.base_formula) &&
      this._formulaHasDice(
        this._appendDamageFormulaModifiers(this.system.base_formula, "base"),
      )
    );
  }

  _getBaseRollFlavor({ critical = false, autoFromHit = false } = {}) {
    const baseFlavor = game.i18n.format("FFXIV.Abilities.BaseEffectRoll");
    if (autoFromHit && critical)
      return `${baseFlavor} (${game.i18n.localize("FFXIV.Chat.AutoCriticalDamageFromHit")})`;
    if (autoFromHit)
      return `${baseFlavor} (${game.i18n.localize("FFXIV.Chat.AutoDamageFromHit")})`;
    if (critical)
      return `${baseFlavor} (${game.i18n.format("FFXIV.Chat.RollCriticalHitFormula")})`;
    return baseFlavor;
  }

  _getDirectRollFlavor({
    critical = false,
    autoFromHit = false,
    directHitOption = null,
  } = {}) {
    const baseFlavor = game.i18n.format(
      critical
        ? "FFXIV.Abilities.CriticalHitRoll"
        : "FFXIV.Abilities.DirectHitRoll",
    );
    const prefix = directHitOption
      ? `${directHitOption.flavorLabel || directHitOption.name} `
      : "";
    if (autoFromHit && critical)
      return `${prefix}${baseFlavor} (${game.i18n.localize(
        "FFXIV.Chat.AutoCriticalDamageFromHit",
      )})`;
    if (autoFromHit)
      return `${prefix}${baseFlavor} (${game.i18n.localize(
        "FFXIV.Chat.AutoDamageFromHit",
      )})`;
    return `${prefix}${baseFlavor}`;
  }

  async _getCriticalDirectFormula(rollData = this.getRollData(), options = {}) {
    let formula = this._composeFormulaWithAttribute(
      rollData.direct_formula,
      rollData.direct_formula_attribute,
    );
    formula = this._appendDamageFormulaModifiers(formula, "direct", options);
    const criticalDamage = Number(
      (await new Roll("@cdmg", rollData).evaluate()).result,
    );
    if (criticalDamage > 0) formula += " + @cdmg";
    return this._applyDamageDiceModifiers(
      this._doubleDiceCounts(formula),
      "direct",
      options,
    );
  }

  _shouldAutoRollDirectHit(roll, options = {}) {
    if (!this._hasDirectRoll()) return false;
    if (this._targetsHaveStatus("heavy")) return true;
    if (!game.settings.get("ffxiv", "autoRollDirectHitDamage")) return false;

    const defenseType = this._getDirectHitDefenseType();
    if (!defenseType) return false;

    const target = game.user.targets.first();
    if (!target?.actor) return false;

    const total = Number(roll.total);
    const defense = this._getTargetDefense(target.actor, defenseType, options);
    return (
      Number.isFinite(total) && Number.isFinite(defense) && total > defense
    );
  }

  _getDirectHitDefenseType() {
    const tags = this.system.tags || [];
    if (
      tags.some((tag) =>
        FFXIVItem._tagMatches(tag, ["Magic", "FFXIV.Tags.Magic"]),
      )
    )
      return "magic";
    if (
      tags.some((tag) =>
        FFXIVItem._tagMatches(tag, ["Physical", "FFXIV.Tags.Physical"]),
      )
    )
      return "physical";
    return null;
  }

  _getTargetDefense(actor, defenseType, options = {}) {
    const rollData = actor.getRollData?.();
    if (this._usesLowerTargetDefense(options)) {
      const def = Number(rollData?.def);
      const mdef = Number(rollData?.mdef);
      if (Number.isFinite(def) && Number.isFinite(mdef))
        return Math.min(def, mdef);
    }
    const value = defenseType === "magic" ? rollData?.mdef : rollData?.def;
    return Number(value);
  }

  _targetsHaveStatus(statusId) {
    return Array.from(game.user.targets ?? []).some((token) =>
      hasStatus(token.actor, statusId),
    );
  }

  _getTargetStatusAdvantageDice() {
    return Array.from(game.user.targets ?? [])
      .map((token) => token.actor)
      .filter(Boolean)
      .reduce(
        (highest, actor) =>
          Math.max(highest, getTargetStatusAdvantage(actor)),
        0,
      );
  }

  _usesLowerTargetDefense(options = {}) {
    for (const effect of this._getApplicableEffects(options)) {
      if (!effect || effect.disabled) continue;
      const data = foundry.utils.getProperty(
        effect,
        "flags.ffxiv.targetDefense.useLower",
      );
      const entries = Array.isArray(data) ? data : data ? [data] : [];
      for (const entry of entries) {
        if (entry === true) return true;
        if (!this._traitModifierEntryApplies(entry)) continue;
        const enabled = entry.enabled ?? entry.value ?? true;
        if (enabled === true || String(enabled).toLowerCase() === "true")
          return true;
      }
    }
    return false;
  }

  _getIgnoredCheckPenaltyStatuses(options = {}) {
    const ignored = new Set();
    for (const effect of this._getApplicableEffects(options)) {
      if (!effect || effect.disabled) continue;

      const data = foundry.utils.getProperty(
        effect,
        "flags.ffxiv.check.ignoreStatuses",
      );
      const entries = Array.isArray(data) ? data : data ? [data] : [];
      for (const entry of entries) {
        if (!this._statusIgnoreEntryApplies(entry)) continue;
        for (const statusId of this._getStatusIgnoreEntryStatuses(entry)) {
          ignored.add(statusId);
        }
      }
    }
    return Array.from(ignored);
  }

  _statusIgnoreEntryApplies(entry) {
    if (!entry) return false;
    if (typeof entry === "string") return true;
    if (!this._traitModifierEntryApplies(entry)) return false;

    const keys = this._toArray(
      entry.abilities ?? entry.abilityKeys ?? entry.items ?? entry.itemKeys,
    )
      .map((value) => this._normalizeEffectKey(value))
      .filter(Boolean);
    return !keys.length || keys.includes(this._normalizeEffectKey(this.name));
  }

  _getStatusIgnoreEntryStatuses(entry) {
    const statuses =
      typeof entry === "string"
        ? [entry]
        : this._toArray(entry.statuses ?? entry.status ?? entry.ids ?? entry.id);
    return statuses
      .map((statusId) => String(statusId ?? "").trim())
      .filter(Boolean);
  }

  _ignoresCheckPenaltyStatus(statusId) {
    const normalizedStatusId = String(statusId ?? "").trim();
    if (!normalizedStatusId) return false;
    return this._getIgnoredCheckPenaltyStatuses().includes(normalizedStatusId);
  }

  _matchesAnyEffectKey(keys) {
    const nameKey = this._normalizeEffectKey(this.name);
    return keys.some((key) => this._normalizeEffectKey(key) === nameKey);
  }

  _getActiveEffectCheckAdvantageDice(options = {}) {
    let dice = 0;
    for (const effect of this._getApplicableEffects(options)) {
      if (!effect || effect.disabled) continue;

      const data = foundry.utils.getProperty(
        effect,
        "flags.ffxiv.check.advantage",
      );
      const entries = Array.isArray(data) ? data : data ? [data] : [];
      for (const entry of entries) {
        if (entry && typeof entry === "object") {
          if (!this._traitModifierEntryApplies(entry)) continue;
        }
        const amount = Number(entry?.amount ?? entry?.value ?? entry);
        if (Number.isFinite(amount)) dice += amount;
      }

      for (const change of effect.changes ?? []) {
        const key = String(change?.key ?? "").trim().toLowerCase();
        if (key !== "flags.ffxiv.check.advantage") continue;
        const amount = Number(change?.value);
        if (Number.isFinite(amount)) dice += amount;
      }
    }
    return Math.max(Math.floor(dice), 0);
  }

  _appendDamageFormulaModifiers(formula, rollType, options = {}) {
    const base = String(formula ?? "").trim();
    if (!base) return base;

    const terms = this._getDamageFormulaModifierTerms(rollType, options);
    if (!terms.length) return base;
    return [base, ...terms].join(" + ");
  }

  _applyDamageDiceModifiers(formula, rollType, options = {}) {
    const base = String(formula ?? "").trim();
    if (!base) return base;

    const minimum = this._getDamageDiceMinimum(rollType, options);
    return minimum > 1 ? this._applyDiceMinimumToFormula(base, minimum) : base;
  }

  _getDamageDiceMinimum(rollType, options = {}) {
    let minimum = 0;
    for (const effect of this._getApplicableEffects(options)) {
      if (!effect || effect.disabled) continue;

      const data = foundry.utils.getProperty(
        effect,
        "flags.ffxiv.damageDice.minimum",
      );
      const entries = Array.isArray(data) ? data : data ? [data] : [];
      for (const entry of entries) {
        if (!this._damageFormulaEntryApplies(entry, rollType)) continue;
        const value = Number(entry.minimum ?? entry.value ?? entry);
        if (Number.isFinite(value)) minimum = Math.max(minimum, value);
      }

      for (const change of effect.changes ?? []) {
        const key = String(change?.key ?? "").trim().toLowerCase();
        if (
          key !== "flags.ffxiv.damagedice.minimum" &&
          key !== `flags.ffxiv.damagedice.${rollType}.minimum`
        )
          continue;
        const value = Number(change?.value);
        if (Number.isFinite(value)) minimum = Math.max(minimum, value);
      }
    }
    return Math.max(Math.floor(minimum), 0);
  }

  _applyDiceMinimumToFormula(formula, minimum) {
    return String(formula ?? "").replace(
      /\b(\d*d\d+)\b(?!\s*(?:min|max|kh|kl|dh|dl|r|rr|x|xo|cs|cf))/gi,
      `$1min${minimum}`,
    );
  }

  _getDamageFormulaModifierTerms(rollType, options = {}) {
    const terms = [];
    for (const effect of this._getApplicableEffects(options)) {
      if (!effect || effect.disabled) continue;
      this._collectDamageFormulaFlagTerms(effect, rollType, terms);
      this._collectDamageFormulaChangeTerms(effect, rollType, terms);
    }
    return terms;
  }

  _collectDamageFormulaFlagTerms(effect, rollType, terms) {
    const data = foundry.utils.getProperty(effect, "flags.ffxiv.damageFormula");
    if (!data || typeof data !== "object") return;

    const entries = Array.isArray(data) ? data : [data];
    for (const entry of entries) {
      if (!this._damageFormulaEntryApplies(entry, rollType)) continue;

      const formula = this._getDamageFormulaEntryFormula(effect, entry);
      if (formula) terms.push(formula);
      const flat = Number(entry.flat);
      if (Number.isFinite(flat) && flat !== 0) terms.push(String(flat));
    }
  }

  _collectDamageFormulaChangeTerms(effect, rollType, terms) {
    for (const change of effect.changes ?? []) {
      const key = String(change?.key ?? "").trim().toLowerCase();
      if (
        key !== "flags.ffxiv.damageformula.formula" &&
        key !== `flags.ffxiv.damageformula.${rollType}.formula` &&
        key !== "flags.ffxiv.damageformula.flat" &&
        key !== `flags.ffxiv.damageformula.${rollType}.flat`
      )
        continue;

      const value = String(change?.value ?? "").trim();
      if (!value) continue;
      if (key.endsWith(".flat")) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric !== 0)
          terms.push(String(numeric));
        continue;
      }
      terms.push(value);
    }
  }

  _damageFormulaEntryApplies(entry, rollType) {
    if (!entry || typeof entry !== "object") return false;

    const rollTypes = this._toArray(
      entry.rolls ?? entry.rollTypes ?? entry.appliesTo,
    )
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean);
    if (rollTypes.length && !rollTypes.includes(String(rollType).toLowerCase()))
      return false;

    const tags = this._toArray(entry.tags ?? entry.tag).filter(Boolean);
    if (!tags.length) return true;
    const itemTags = Array.isArray(this.system?.tags) ? this.system.tags : [];
    return tags.some((tag) =>
      itemTags.some((itemTag) => FFXIVItem._tagMatches(itemTag, [tag])),
    );
  }

  _traitModifierEntryApplies(entry) {
    if (!entry || typeof entry !== "object") return false;

    const tags = this._toArray(entry.tags ?? entry.tag).filter(Boolean);
    if (!tags.length) return true;
    const itemTags = Array.isArray(this.system?.tags) ? this.system.tags : [];
    return tags.some((tag) =>
      itemTags.some((itemTag) => FFXIVItem._tagMatches(itemTag, [tag])),
    );
  }

  _getDamageFormulaEntryFormula(effect, entry) {
    if (this._effectMatchesKey(effect, "astral_fire"))
      return (
        this._getAstralFireDamageFormula() ||
        String(entry.formula ?? "").trim()
      );
    return String(entry.formula ?? "").trim();
  }

  _getAstralFireDamageFormula() {
    const trait = this.parent?.items?.find((item) =>
      item?.type === "trait" &&
      this._normalizeEffectKey(item.name) === "astral_fire",
    );
    const description = String(trait?.system?.description ?? "").toLowerCase();
    if (description.includes("2d6")) return "2d6";
    if (description.includes("1d6")) return "1d6";
    return "";
  }

  _toArray(value) {
    if (Array.isArray(value)) return value;
    return value === undefined || value === null || value === ""
      ? []
      : [value];
  }

  _isInterruptedByParalysis(d20Result) {
    return (
      d20Result !== null &&
      Number(d20Result) <= 5 &&
      hasStatus(this.parent, "paralysis") &&
      !this._ignoresCheckPenaltyStatus("paralysis") &&
      getAbilitySubtype(this) === "primary_ability"
    );
  }

  async _restoreLimitationUseIfNeeded() {
    if (this.type !== "ability") return;
    if (this.parent?.documentName !== "Actor") return;
    if (!String(this.system?.limitations ?? "").trim()) return;

    const max = Number.parseInt(this.system?.job_resources_max, 10);
    if (!Number.isFinite(max) || max <= 0) return;

    const resourceStatus = Array.isArray(this.system?.job_resource_status)
      ? this.system.job_resource_status.slice(0, max)
      : [];
    while (resourceStatus.length < max) resourceStatus.push(false);

    const index = resourceStatus.lastIndexOf(true);
    if (index === -1) return;
    resourceStatus[index] = false;
    await this.update(
      { "system.job_resource_status": resourceStatus },
      { render: false },
    );
  }

  _formulaHasDice(formula) {
    return /\d*d\d+/i.test(String(formula || ""));
  }

  _composeFormulaWithAttribute(formula, attributeKey) {
    const base = String(formula ?? "").trim();
    if (!base) return "";
    const token = this._formulaAttributeToken(attributeKey);
    if (!token) return base;
    return `${base} + ${token}`;
  }

  _formulaAttributeToken(attributeKey) {
    const normalized = String(attributeKey ?? "")
      .trim()
      .toLowerCase();
    if (!normalized) return "";
    const supported = new Set(["str", "dex", "vit", "int", "mnd"]);
    if (!supported.has(normalized)) return "";
    return `@${normalized}`;
  }

  _getApplyButton(result) {
    let buttons = "<div style='display:flex;flex-wrap: wrap;'>";
    const buttonData = this._getChatButtonData();
    buttons += `<button class="ffxiv-apply-dmg" ${buttonData} data-damage="${result}">${game.i18n.localize("FFXIV.Chat.Damage")}</button>`;
    buttons += `<button class="ffxiv-apply-heal" ${buttonData} data-heal="${result}">${game.i18n.localize("FFXIV.Chat.Heal")}</button>`;
    return buttons + "</div>";
  }

  _doubleDiceCounts(input) {
    return input.replace(/(\d*)[dD](\d+)/g, (match, count, faces) => {
      return `${(Number(count) || 1) * 2}d${faces}`;
    });
  }
}
