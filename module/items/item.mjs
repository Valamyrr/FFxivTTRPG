import { debugLog } from "../helpers/debug.mjs";
import {
  applyStatusEffectChange,
  applyStatusEffectStackDelta,
  applyStatusEffectStackValue,
  getActorCheckPenalty,
  getActorCriticalRange,
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
    if (!(await this._confirmTargetSelection())) return;
    if (!this._canUseAbility()) return;
    if (!this._canUseLimitBreak()) return;
    if (!(await this._spendHPCostIfNeeded())) return;
    if (!(await this._consumeLimitationIfNeeded())) return;
    if (!(await this._consumeLimitBreakIfNeeded())) return;
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
    await ChatMessage.create({
      user: user,
      content: content,
      speaker: speaker,
      flags: { core: { canParseHTML: true } },
      flavor: game.i18n.format("FFXIV.ItemType." + this.type),
    });

    const checkResult = this._shouldAutoCheckBeforeBase()
      ? await this._rollHit({ auto: true })
      : null;
    if (checkResult?.interrupted) return;

    await this._applyEffectRules("use");
    await this._consumeEffectRequirements();
    await this._autoApplyStatusEffects();
    await this._applyInvokingStatus();
    await this._rollBase({
      critical: checkResult?.isCritical ?? false,
      autoFromHit: Boolean(checkResult),
    });

    await this._consumeFromInventoryIfNeeded();
  }

  _canUseAbility() {
    const subtype = getAbilitySubtype(this);
    const isAbility = this.type === "ability" || ABILITY_SUBTYPE_TYPES.includes(this.type);
    if (!isAbility) return true;
    if (hasStatus(this.parent, "knocked_out") || hasStatus(this.parent, "comatose")) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.Incapacitated"));
      return false;
    }
    if (
      subtype !== "limit_break" &&
      (hasStatus(this.parent, "stun") || hasStatus(this.parent, "petrified"))
    ) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.CannotAct"));
      return false;
    }
    if (hasStatus(this.parent, "silence") && this._isInvokedAbility()) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.Silenced"));
      return false;
    }
    return this._canSatisfyEffectRequirements();
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
      const gm = game.users.find((user) => user.isGM && user.active);
      if (!gm) {
        ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.LimitBreakNoGM"));
        return false;
      }
      game.socket.emit("system.ffxiv", {
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

  async _confirmTargetSelection() {
    const target = this._getNormalizedTargetText();
    const targetCount = game.user.targets?.size ?? 0;
    let message = "";

    if (this._requiresSelectedTarget(target) && targetCount === 0) {
      message = game.i18n.format("FFXIV.Notifications.NoTargetWithKeybind", {
        singleKeybind: this._getTargetKeybindText("target", "T"),
        multipleKeybind: this._getMultipleTargetKeybindText(),
      });
    } else if (target === "single" && targetCount > 1) {
      message = game.i18n.format("FFXIV.Notifications.SingleTargetMultipleSelected", {
        singleKeybind: this._getTargetKeybindText("target", "T"),
      });
    }

    if (!message) return true;

    const [warning, ...instructions] = message.split("\n");
    const instructionContent = instructions.length
      ? `<p>${instructions.join("<br>")}</p>`
      : "";

    return foundry.applications.api.DialogV2.wait({
      id: "ffxiv-target-warning-dialog",
      window: {
        title: game.i18n.localize("FFXIV.Notifications.TargetWarningTitle"),
      },
      content: `<p style="text-align: center;">${warning}</p>${instructionContent}`,
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
    }).catch(() => false);
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

    const max = Number.parseInt(this.system?.limitations_max, 10);
    if (!Number.isFinite(max) || max <= 0) return true;

    const limitationsStatus = Array.isArray(this.system?.limitations_status)
      ? this.system.limitations_status.slice(0, max)
      : [];
    while (limitationsStatus.length < max) limitationsStatus.push(false);

    const index = limitationsStatus.findIndex((status) => !status);
    if (index === -1) {
      ui.notifications.warn(
        game.i18n.localize("FFXIV.Notifications.LimitationsConsumed"),
      );
      return false;
    }

    limitationsStatus[index] = true;
    await this.update(
      { "system.limitations_status": limitationsStatus },
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

  async _rollHit(options = {}) {
    if (options instanceof Event) options = {};
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
    const statusPenalty = getActorCheckPenalty(this.parent);
    const targetAdvantageDice = this._getTargetStatusAdvantageDice();
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

            previewFormula = appendFormulaModifier(previewFormula, statusPenalty);
            if (statusPenaltyPreview) {
              statusPenaltyPreview.textContent = statusPenalty
                ? `${game.i18n.localize("FFXIV.RollDialog.StatusPenalty")}: ${statusPenalty}`
                : "";
            }
            previewFormula = appendFormulaModifier(previewFormula, enmityPenalty);
            if (enmityPreview) {
              enmityPreview.textContent = enmityPenalty
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

    formula = appendFormulaModifier(formula, statusPenalty);
    formula = appendFormulaModifier(formula, enmityPenalty);

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

    const autoDirectHit = !isInterrupted && this._shouldAutoRollDirectHit(roll);
    const directHitResult = autoDirectHit
      ? await this._evaluateDirectHitRoll({
          critical: isCritical,
          autoFromHit: true,
        })
      : null;
    const buttonData = this._getChatButtonData();

    let extraButtons = "<div style='display:flex;flex-wrap: wrap;'>";
    if (this._hasDirectRoll() && !autoDirectHit) {
      extraButtons += `<button class="ffxiv-roll-direct" ${buttonData}>${game.i18n.localize("FFXIV.Chat.RollDirectHitFormula")}</button>`;
      extraButtons += `<button class="ffxiv-roll-critical" ${buttonData}>${game.i18n.localize("FFXIV.Chat.RollCriticalHitFormula")}</button>`;
    }
    if (!autoDirectHit && this._hasFormula(this.system.alternate_formula_critical))
      extraButtons += `<button class="ffxiv-roll-critical-alternate" ${buttonData}>${game.i18n.localize("FFXIV.Chat.RollAlternateCriticalHitFormula")}</button>`;
    extraButtons += "</div>";

    const rollHTML = $("<div>" + (await roll.render()) + "</div>");
    if (isCritical) rollHTML.find(".dice-total").css({ color: "blue" });
    if (isCriticalFailure) rollHTML.find(".dice-total").css({ color: "red" });
    if (enmityPenalty) {
      rollHTML.append(
        `<div>${game.i18n.localize("FFXIV.Effects.Enmity")}: ${enmityPenalty} (${enmityPenaltyInfo.sourceActor.name} not targeted)</div>`,
      );
    }
    if (statusPenalty) {
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

    if (!isInterrupted) {
      await this._applyEffectRules("hitThreshold", {
        d20Result,
        roll,
        directHitRoll: directHitResult?.roll ?? null,
      });
    }

    return {
      roll,
      d20Result,
      isCritical,
      isCriticalFailure,
      interrupted: isInterrupted,
      directHitRoll: directHitResult?.roll ?? null,
    };
  }

  async _rollDirect(options = {}) {
    if (options instanceof Event) options = {};
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
    if (!this._hasDirectRoll()) return null;
    const rollData = this.getRollData();
    const formula = options.critical
      ? await this._getCriticalDirectFormula(rollData)
      : this._composeFormulaWithAttribute(
          rollData.direct_formula,
          rollData.direct_formula_attribute,
        );
    const roll = new Roll(formula, rollData);
    await roll.evaluate();
    const rollHTML = $("<div>" + (await roll.render()) + "</div>");
    return {
      roll,
      html: rollHTML,
      flavor: this._getDirectRollFlavor({
        critical: options.critical,
        autoFromHit: options.autoFromHit,
      }),
    };
  }

  async _rollCritical() {
    if (!this._hasDirectRoll()) return;
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    const rollData = this.getRollData();

    let roll = new Roll(
      await this._getCriticalDirectFormula(rollData),
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

  async _rollCriticalAlternate() {
    if (!this._hasFormula(this.system.alternate_formula_critical)) return;
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    const rollData = this.getRollData();
    let roll = new Roll(
      this._composeFormulaWithAttribute(
        rollData.alternate_formula_critical,
        rollData.alternate_formula_critical_attribute,
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

  async _rollBase({ critical = false, autoFromHit = false } = {}) {
    if (!this._hasFormula(this.system.base_formula)) return;
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    const rollData = this.getRollData();
    const formula = critical
      ? this._doubleDiceCounts(rollData.base_formula)
      : rollData.base_formula;
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

  async _rollAlternate() {
    if (!this._hasFormula(this.system.alternate_formula)) return;
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
    const rollData = this.getRollData();
    const roll = new Roll(
      this._composeFormulaWithAttribute(
        rollData.alternate_formula,
        rollData.alternate_formula_attribute,
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
      return applyTo !== "self_auto";
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
    return `data-item-id="${this._id}" data-item-uuid="${this.uuid}" data-actor-id="${this.parent?._id ?? ""}" data-actor-uuid="${this.parent?.uuid ?? ""}"`;
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

  async _autoApplyStatusEffects() {
    const statusEntries = this._getAutoStatusEffectEntries();
    if (!statusEntries.length) return;

    const selfEntries = statusEntries.filter((entry) => entry.applyTo === "self");
    const targetEntries = statusEntries.filter((entry) => entry.applyTo !== "self");

    if (selfEntries.length && this.parent?.documentName === "Actor") {
      if (this.parent.testUserPermission(game.user, "OWNER")) {
        for (const entry of selfEntries) {
          const applied = await this._applyStatusEntryToActor(this.parent, entry);
          if (applied) {
            ui.notifications.info(
              game.i18n.format("FFXIV.Notifications.EffectApplied", {
                effect: this._getStatusLabelById(entry.statusId),
                actor: this.parent.name,
              }),
            );
          }
        }
      } else {
        game.socket.emit("system.ffxiv", {
          type: "applyEffect",
          data: {
            actorIds: [this.parent.id],
            actorRefs: [
              String(this.parent.uuid ?? this.parent.id ?? "").trim(),
            ].filter(Boolean),
            effects: selfEntries,
          },
          userName: game.user.name,
        });
        ui.notifications.info(
          game.i18n.localize("FFXIV.Notifications.SendSocket"),
        );
      }
    }

    if (!targetEntries.length) return;

    const targets = Array.from(game.user.targets ?? []);
    if (targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoTarget"));
      return;
    }

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
          ui.notifications.info(
            game.i18n.format("FFXIV.Notifications.EffectApplied", {
              effect: this._getStatusLabelById(entry.statusId),
              actor: actor.name,
            }),
          );
        }
      }
    }

    if (actorsNeedingGM.length > 0) {
      game.socket.emit("system.ffxiv", {
        type: "applyEffect",
        data: {
          actorIds: actorsNeedingGM.map((actor) => actor.id),
          actorRefs: actorsNeedingGM
            .map((actor) => String(actor?.uuid ?? actor?.id ?? "").trim())
            .filter(Boolean),
          effects: targetEntries,
        },
        userName: game.user.name,
      });
      ui.notifications.info(
        game.i18n.localize("FFXIV.Notifications.SendSocket"),
      );
    }
  }

  async _applyStatusEntryToActor(actor, entry) {
    const statusId = String(entry?.statusId ?? entry?.id ?? "").trim();
    if (!actor || !statusId) return;
    const stacks = Math.max(1, Number.parseInt(entry?.stacks, 10) || 1);
    const origin = String(entry?.sourceUuid ?? "").trim() || null;

    if (isStackableStatusEffect(statusId)) {
      let result;
      if (isAdditiveStackableStatusEffect(statusId)) {
        result = await applyStatusEffectStackDelta(
          actor,
          statusId,
          entry.active === false ? -stacks : stacks,
          { origin },
        );
      } else {
        result = await applyStatusEffectStackValue(
          actor,
          statusId,
          entry.active === false ? 0 : stacks,
          { origin },
        );
      }
      return result !== false;
    }

    const result = await applyStatusEffectChange(actor, statusId, entry.active !== false, {
      origin,
    });
    return result !== false;
  }

  _getEffectRules() {
    const entries = Array.isArray(this.system.effect_rules)
      ? this.system.effect_rules
      : [];
    return entries
      .map((entry) => ({
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
        forbids: this._normalizeEffectRefs(entry?.forbids),
        toggle1: this._normalizeEffectRef(entry?.toggle1),
        toggle2: this._normalizeEffectRef(entry?.toggle2),
        duration: entry?.duration,
      }))
      .filter((entry) => entry.key || entry.action === "toggle");
  }

  _getEffectRequirements() {
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
      }))
      .filter((entry) => entry.key);
  }

  _canSatisfyEffectRequirements() {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return true;

    const missing = [];
    const blocked = [];
    for (const requirement of this._getEffectRequirements()) {
      const hasEffect = this._hasNamedEffect(actor, requirement.key);
      if (requirement.mode === "forbidden") {
        if (hasEffect) blocked.push(requirement.name || requirement.key);
        continue;
      }

      const bypassed = requirement.bypass.some((entry) =>
        this._hasNamedEffect(actor, entry.key),
      );
      if (!hasEffect && !bypassed)
        missing.push(requirement.name || requirement.key);
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

  async _applyEffectRules(trigger, context = {}) {
    const actor = this.parent;
    if (actor?.documentName !== "Actor") return;

    for (const rule of this._getEffectRules()) {
      if (rule.trigger !== trigger) continue;
      if (!this._canApplyEffectRule(actor, rule, context)) continue;
      await this._applyEffectRule(actor, rule);
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
    if (rule.forbids.some((entry) => this._hasNamedEffect(actor, entry.key)))
      return false;
    return true;
  }

  async _applyEffectRule(actor, rule) {
    if (rule.action === "remove") {
      await this._removeNamedEffects(actor, [rule]);
      return;
    }
    if (rule.action === "toggle") {
      await this._toggleNamedEffects(actor, rule);
      return;
    }

    await this._removeNamedEffects(actor, rule.remove);
    await this._grantNamedEffect(actor, rule);
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

  async _grantNamedEffect(actor, rule) {
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
      ? this._buildLinkedAutomationEffectData(template, rule, key)
      : this._buildNamedAutomationEffectData(rule, key);
    await actor.createEmbeddedDocuments("ActiveEffect", [effectData], {
      render: false,
    });
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

  _buildLinkedAutomationEffectData(effect, rule, key) {
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

    const duration = this._prepareEffectRuleDuration(
      rule?.duration ?? effectData.duration,
    );
    if (duration) effectData.duration = duration;
    else delete effectData.duration;
    return effectData;
  }

  _buildNamedAutomationEffectData(rule, key) {
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
    const duration = this._prepareEffectRuleDuration(rule?.duration);
    if (duration) effectData.duration = duration;
    return effectData;
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
      return this._effectMatchesKey(effect, normalizedKey);
    });
  }

  _effectMatchesKey(effect, key) {
    const normalizedKey = this._normalizeEffectKey(key);
    if (!effect || !normalizedKey) return false;

    const flagKey = this._normalizeEffectKey(
      effect.getFlag?.("ffxiv", "effectKey"),
    );
    if (flagKey && flagKey === normalizedKey) return true;
    return this._normalizeEffectKey(effect.name) === normalizedKey;
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
    for (const key of ["seconds", "rounds", "turns"]) {
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

    await this.parent.toggleStatusEffect("invoking", { active: true });
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
      this._formulaHasDice(this.system.base_formula)
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

  _getDirectRollFlavor({ critical = false, autoFromHit = false } = {}) {
    const baseFlavor = game.i18n.format(
      critical
        ? "FFXIV.Abilities.CriticalHitRoll"
        : "FFXIV.Abilities.DirectHitRoll",
    );
    if (autoFromHit && critical)
      return `${baseFlavor} (${game.i18n.localize("FFXIV.Chat.AutoCriticalDamageFromHit")})`;
    if (autoFromHit)
      return `${baseFlavor} (${game.i18n.localize("FFXIV.Chat.AutoDamageFromHit")})`;
    return baseFlavor;
  }

  async _getCriticalDirectFormula(rollData = this.getRollData()) {
    let formula = this._composeFormulaWithAttribute(
      rollData.direct_formula,
      rollData.direct_formula_attribute,
    );
    const criticalDamage = Number(
      (await new Roll("@cdmg", rollData).evaluate()).result,
    );
    if (criticalDamage > 0) formula += " + @cdmg";
    return this._doubleDiceCounts(formula);
  }

  _shouldAutoRollDirectHit(roll) {
    if (!this._hasDirectRoll()) return false;
    if (this._targetsHaveStatus("heavy")) return true;
    if (!game.settings.get("ffxiv", "autoRollDirectHitDamage")) return false;

    const defenseType = this._getDirectHitDefenseType();
    if (!defenseType) return false;

    const target = game.user.targets.first();
    if (!target?.actor) return false;

    const total = Number(roll.total);
    const defense = this._getTargetDefense(target.actor, defenseType);
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

  _getTargetDefense(actor, defenseType) {
    const rollData = actor.getRollData?.();
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

  _isInterruptedByParalysis(d20Result) {
    return (
      d20Result !== null &&
      Number(d20Result) <= 5 &&
      hasStatus(this.parent, "paralysis") &&
      getAbilitySubtype(this) === "primary_ability"
    );
  }

  async _restoreLimitationUseIfNeeded() {
    if (this.type !== "ability") return;
    if (this.parent?.documentName !== "Actor") return;

    const max = Number.parseInt(this.system?.limitations_max, 10);
    if (!Number.isFinite(max) || max <= 0) return;

    const limitationsStatus = Array.isArray(this.system?.limitations_status)
      ? this.system.limitations_status.slice(0, max)
      : [];
    while (limitationsStatus.length < max) limitationsStatus.push(false);

    const index = limitationsStatus.lastIndexOf(true);
    if (index === -1) return;
    limitationsStatus[index] = false;
    await this.update(
      { "system.limitations_status": limitationsStatus },
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
