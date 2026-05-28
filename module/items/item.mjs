import { debugLog } from "../helpers/debug.mjs";
import { normalizeShopTier } from "../helpers/shop-tier.mjs";
import {
  ABILITY_SUBTYPE_TYPES,
  ensureAbilitySubtypeTags,
  getAbilitySubtype,
  getSubtypeTagLabel,
} from "../helpers/ability-subtype.mjs";

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

    const renderOptions = options.render === false ? { render: false } : {};
    const otherJobs = this.parent.items.filter(
      (item) => item.type === "job" && item.id !== this.id,
    );
    if (otherJobs.length) {
      await this._deleteJobsWithGrantedAbilities(otherJobs, renderOptions);
    }

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
        "system.showPets": this.system.has_pets ? "true" : "false",
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
      renderOptions,
    );
    await this._grantJobAbilities(renderOptions);
    ui.notifications.info(
      `${this.name} assigned as ${this.parent.name}'s job.`,
    );
  }

  _getNormalizedAbilityGrants(rawGrants) {
    return (
      Array.isArray(rawGrants) ? rawGrants : Object.values(rawGrants || {})
    ).filter((grant) => grant?.uuid);
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

    if (itemsToCreate.length)
      await this.parent.createEmbeddedDocuments("Item", itemsToCreate, options);
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
    const grantedItems = this.parent.items.filter(
      (item) =>
        jobIds.has(item.flags?.ffxiv?.jobId) ||
        grantedUuids.has(item.flags?.ffxiv?.jobSourceUuid),
    );
    const idsToDelete = [...jobs, ...grantedItems].map((item) => item.id);
    if (idsToDelete.length)
      await this.parent.deleteEmbeddedDocuments("Item", idsToDelete, options);
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
      rollData.target = game.actors.get(target.document.actorId).getRollData(); //Adds the target's RollData
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
    if (!(await this._spendHPCostIfNeeded())) return;

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

    await this._applyInvokingStatus();

    const checkResult = this._shouldAutoCheckBeforeBase()
      ? await this._rollHit({ auto: true })
      : null;
    await this._rollBase({
      critical: checkResult?.isCritical ?? false,
      autoFromHit: Boolean(checkResult),
    });
    if (checkResult && this._shouldAutoRollDirectHit(checkResult.roll)) {
      await this._rollDirect({
        critical: checkResult.isCritical,
        autoFromHit: true,
      });
    }

    await this._consumeFromInventoryIfNeeded();
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
    let result = { advantageDice: 0, flatModifier: 0 };

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
            <input type="number" name="advantageDice" value="0" min="0" style="flex: 1; height: 24px; font-size: 0.9em;" />
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

            if (flatModifier !== 0) {
              previewFormula +=
                flatModifier > 0
                  ? ` + ${flatModifier}`
                  : ` - ${Math.abs(flatModifier)}`;
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
    const criticalRange = Number(this.parent?.system?.criticalRange) || 20;
    const isCritical = d20Result !== null && d20Result >= criticalRange;
    const isCriticalFailure = false;

    if (
      isCritical &&
      game.settings.get("ffxiv", "soundNotificationFFXIV") &&
      game.settings.get("ffxiv", "soundNotificationFFXIV_critical")
    ) {
      foundry.audio.AudioHelper.play({
        src: game.settings.get("ffxiv", "soundNotificationFFXIV_critical"),
        volume: 1,
        autoplay: true,
        loop: false,
      });
    }

    let extraButtons = "<div style='display:flex;flex-wrap: wrap;'>";
    if (this._hasDirectRoll()) {
      extraButtons += `<button class="ffxiv-roll-direct" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollDirectHitFormula")}</button>`;
      extraButtons += `<button class="ffxiv-roll-critical" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollCriticalHitFormula")}</button>`;
    }
    if (this._hasFormula(this.system.alternate_formula_critical))
      extraButtons += `<button class="ffxiv-roll-critical-alternate" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollAlternateCriticalHitFormula")}</button>`;
    extraButtons += "</div>";

    const rollHTML = $("<div>" + (await roll.render()) + "</div>");
    if (isCritical) rollHTML.find(".dice-total").css({ color: "blue" });
    if (isCriticalFailure) rollHTML.find(".dice-total").css({ color: "red" });

    await ChatMessage.create({
      user,
      speaker,
      flavor: this._hasCheck()
        ? game.i18n.localize("FFXIV.Abilities.Check")
        : game.i18n.format("FFXIV.Abilities.HitRoll"),
      rolls: [roll],
      content: `${rollHTML.html()} ${extraButtons}`,
    });

    if (!options.auto && this._shouldAutoRollDirectHit(roll)) {
      await this._rollDirect({ critical: isCritical, autoFromHit: true });
    }

    return { roll, isCritical, isCriticalFailure };
  }

  async _rollDirect(options = {}) {
    if (options instanceof Event) options = {};
    if (!this._hasDirectRoll()) return;
    const speaker = ChatMessage.getSpeaker({ actor: this.parent });
    const user = game.user.id;
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
    await ChatMessage.create({
      user: user,
      speaker: speaker,
      rolls: [roll],
      flavor: this._getDirectRollFlavor({
        critical: options.critical,
        autoFromHit: options.autoFromHit,
      }),
      content: `${rollHTML.html()} ${this._getApplyButton(roll.result)}`,
    });
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
    if (this._hasFormula(this.system.alternate_formula))
      buttons += `<button class="ffxiv-roll-alternate" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.RollAlternateFormula")}</button>`;
    if (this._getStatusEffectEntries().length)
      buttons += `<button class="ffxiv-apply-status" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Abilities.StatusEffect")}</button>`;
    if (this._hasHitRoll() && !this._shouldAutoCheckBeforeBase()) {
      const hitLabel =
        !this._hasDirectRoll() && this._hasCheck()
          ? game.i18n.localize("FFXIV.Abilities.Check")
          : game.i18n.localize("FFXIV.Chat.RollHitFormula");
      buttons += `<button class="ffxiv-roll-hit" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${hitLabel}</button>`;
    }
    if (
      this.type != "trait" &&
      this.parent?.system?.showModifiers == "true" &&
      this._hasDisplayableModifiers()
    ) {
      buttons += `<button class="ffxiv-show-modifiers" data-item-id="${this._id}" data-actor-id="${this.parent._id}">${game.i18n.localize("FFXIV.Chat.ShowModifiers")}</button>`;
    }
    return buttons + "</div>";
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
        }))
        .filter((entry) => entry.id);
    }
    if (!this.system.status_effect) return [];
    return [
      {
        id: this.system.status_effect,
        action: this.system.status_action !== false,
      },
    ];
  }

  async _applyInvokingStatus() {
    const isInvoked = (this.system.tags || []).some(
      (tag) => FFXIVItem._tagMatches(tag, ["Invoked", "FFXIV.Tags.Invoked"]),
    );
    if (!isInvoked || !this.parent?.toggleStatusEffect) return;

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
      CONFIG.FF_XIV.attributes || {},
    )) {
      if (attribute.label !== check) continue;
      const abbreviation =
        CONFIG.FF_XIV.attributesAbbreviations?.[key]?.value ||
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
    if (!game.settings.get("ffxiv", "autoRollDirectHitDamage")) return false;
    if (!this._hasDirectRoll()) return false;

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
    buttons += `<button class="ffxiv-apply-dmg" data-item-id="${this._id}" data-actor-id="${this.parent._id}" data-damage="${result}">${game.i18n.localize("FFXIV.Chat.Damage")}</button>`;
    buttons += `<button class="ffxiv-apply-heal" data-item-id="${this._id}" data-actor-id="${this.parent._id}" data-heal="${result}">${game.i18n.localize("FFXIV.Chat.Heal")}</button>`;
    return buttons + "</div>";
  }

  _doubleDiceCounts(input) {
    return input.replace(/(\d*)[dD](\d+)/g, (match, count, faces) => {
      return `${(Number(count) || 1) * 2}d${faces}`;
    });
  }
}
