function getTurnStep(combatant) {
  const actorType = combatant?.actor?.type;
  const disposition = combatant?.token?.disposition;
  if (actorType === "character" || actorType === "pet") return 0;
  if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return 0;
  return 1;
}

export class FFXIVCombat extends Combat {
  /** @override */
  async startCombat() {
    return this._withActorSheetScroll(async () => {
      await this._confirmResetLimitations();
      const startedCombat = await super.startCombat();
      await this._applyStartingMpOverrides();
      return startedCombat;
    });
  }

  /** @override */
  _sortCombatants(a, b) {
    const stepDifference = getTurnStep(a) - getTurnStep(b);
    if (stepDifference !== 0) return stepDifference;

    const orderA = Number(a.initiative);
    const orderB = Number(b.initiative);
    const hasOrderA = Number.isFinite(orderA);
    const hasOrderB = Number.isFinite(orderB);
    if (hasOrderA && hasOrderB && orderA !== orderB) return orderA - orderB;
    if (hasOrderA !== hasOrderB) return hasOrderA ? -1 : 1;

    return String(a.name ?? "").localeCompare(
      String(b.name ?? ""),
      game.i18n.lang,
    );
  }

  /** @override */
  async rollInitiative(ids, options = {}) {
    const requested = new Set(Array.isArray(ids) ? ids : [ids]);
    const combatants = this.combatants
      .filter((combatant) => requested.has(combatant.id))
      .sort(this._sortCombatants.bind(this));
    if (!combatants.length) return this;

    const nextOrder = new Map();
    const updates = combatants.map((combatant) => {
      const step = getTurnStep(combatant);
      if (!nextOrder.has(step)) {
        nextOrder.set(step, this._getNextTurnOrder(step, requested));
      }
      const initiative = nextOrder.get(step);
      nextOrder.set(step, initiative + 1);
      return { _id: combatant.id, initiative };
    });

    await this.updateEmbeddedDocuments("Combatant", updates, options);
    return this;
  }

  /** @override */
  async nextTurn() {
    return this._withActorSheetScroll(() => super.nextTurn());
  }

  /** @override */
  async previousTurn() {
    return this._withActorSheetScroll(() => super.previousTurn());
  }

  /** @override */
  async nextRound() {
    return this._withActorSheetScroll(() => super.nextRound());
  }

  /** @override */
  async previousRound() {
    return this._withActorSheetScroll(() => super.previousRound());
  }

  /** @override */
  async _onEndTurn(combatant, context) {
    return this._withActorSheetScroll(async () => {
      await super._onEndTurn(combatant, context);
      if (combatant?.actor?.type !== "character") return;
      await this._removeInvokingStatus(combatant.actor);
    });
  }

  /** @override */
  async _onStartTurn(combatant, context) {
    return this._withActorSheetScroll(async () => {
      await super._onStartTurn(combatant, context);
      if (combatant?.actor?.type !== "npc") return;
      await this._removeInvokingStatus(combatant.actor);
    });
  }

  async _removeInvokingStatus(actor) {
    if (!actor.statuses?.has("invoking")) return;
    await actor.toggleStatusEffect("invoking", { active: false });
  }

  _getNextTurnOrder(step, excludedIds) {
    const used = this.combatants
      .filter(
        (combatant) =>
          getTurnStep(combatant) === step && !excludedIds.has(combatant.id),
      )
      .map((combatant) => Number(combatant.initiative))
      .filter(Number.isFinite);
    return used.length ? Math.max(...used) + 1 : 1;
  }

  async _applyStartingMpOverrides() {
    const characterActors = new Map();
    for (const combatant of this.combatants) {
      const actor = combatant?.actor;
      if (!actor || actor.type !== "character" || characterActors.has(actor.id))
        continue;
      characterActors.set(actor.id, actor);
    }

    for (const actor of characterActors.values()) {
      const override = this._getStartingMpOverride(actor);
      if (!Number.isFinite(override)) continue;
      await actor.update({ "system.mana.value": override });
    }
  }

  _getStartingMpOverride(actor) {
    let highestOverride = null;
    for (const item of actor.items) {
      if (item.type !== "augment") continue;
      if (item.system.equipped !== true) continue;

      const overrideValue = item.system.starting_mp_override;
      if (
        overrideValue === null ||
        overrideValue === undefined ||
        overrideValue === ""
      )
        continue;
        
      const numericOverride = Number(overrideValue);
      if (!Number.isFinite(numericOverride)) continue;

      highestOverride =
        highestOverride === null
          ? numericOverride
          : Math.max(highestOverride, numericOverride);
    }
    return highestOverride;
  }

  async _confirmResetLimitations() {
    if (!game.user.isGM) return;
    if (!this._hasLimitedAbilities()) return;

    const confirmed = await foundry.applications.api.DialogV2.wait({
      id: `ffxiv-reset-limitations-${this.id}`,
      window: { title: game.i18n.localize("FFXIV.Dialogs.ResetLimitationsTitle") },
      content: `<p>${game.i18n.localize("FFXIV.Dialogs.ResetLimitations")}</p>`,
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

    if (confirmed) await this._resetActorLimitations();
  }

  _hasLimitedAbilities() {
    return game.actors.filter((actor) =>
      actor.items.filter((item) => this._hasLimitations(item)).length > 0,
    ).length > 0;
  }

  async _resetActorLimitations() {
    const sheets = this._captureActorSheetScroll();
    const updatedActors = new Set();
    for (const actor of game.actors) {
      const updates = [];
      for (const item of actor.items) {
        if (!this._hasLimitations(item)) continue;

        const max = Number.parseInt(item.system.limitations_max, 10);
        const limitationsStatus = new Array(max).fill(false);
        const currentStatus = Array.isArray(item.system.limitations_status)
          ? item.system.limitations_status.slice(0, max)
          : [];
        while (currentStatus.length < max) currentStatus.push(false);
        if (currentStatus.every((status) => !status)) continue;

        updates.push({
          _id: item.id,
          "system.limitations_status": limitationsStatus,
        });
      }

      if (updates.length) {
        updatedActors.add(actor.id);
        await actor.updateEmbeddedDocuments("Item", updates, {
          render: false,
          ffxivSkipActorSheetRefresh: true,
        });
      }
    }

    await this._refreshActorSheets(sheets, updatedActors);
  }

  _hasLimitations(item) {
    if (item.type !== "ability") return false;
    const max = Number.parseInt(item.system?.limitations_max, 10);
    return Number.isFinite(max) && max > 0;
  }

  async _withActorSheetScroll(operation) {
    const sheets = this._captureActorSheetScroll();
    try {
      return await operation();
    } finally {
      this._restoreActorSheetScroll(sheets);
    }
  }

  _captureActorSheetScroll() {
    const apps = new Set([
      ...Object.values(ui.windows ?? {}),
      ...Array.from(foundry.applications.instances?.values?.() ?? []),
    ]);
    for (const actor of game.actors) {
      for (const app of Object.values(actor.apps ?? {})) {
        apps.add(app);
      }
    }

    return Array.from(apps)
      .filter((app) => app.rendered && app.actor?.documentName === "Actor")
      .map((app) => {
        app._captureSheetScroll?.();
        return {
          sheet: app,
          scroll: foundry.utils.deepClone(app._pendingSheetScrollPositions ?? []),
        };
      });
  }

  async _refreshActorSheets(sheets, actorIds) {
    for (const { sheet, scroll } of sheets) {
      if (!actorIds.has(sheet.actor?.id)) continue;
      sheet._pendingSheetScrollPositions = foundry.utils.deepClone(scroll);
      await sheet.render({ force: true, focus: false });
      this._restoreActorSheetScroll([{ sheet, scroll }]);
    }
  }

  _restoreActorSheetScroll(sheets) {
    for (const { sheet, scroll } of sheets) {
      if (!scroll?.length) continue;
      const pending = foundry.utils.deepClone(scroll);
      sheet._pendingSheetScrollPositions = pending;
      const restore = () => {
        this._applyActorSheetScroll(sheet, scroll);
      };
      requestAnimationFrame(() => {
        restore();
        setTimeout(restore, 50);
        setTimeout(restore, 150);
        setTimeout(() => {
          restore();
          if (sheet._pendingSheetScrollPositions === pending) {
            sheet._pendingSheetScrollPositions = null;
          }
        }, 300);
      });
    }
  }

  _applyActorSheetScroll(sheet, scroll) {
    for (const position of scroll) {
      const root = sheet.element;
      const element = root?.matches?.(position.selector)
        ? root
        : root?.querySelector(position.selector);
      if (!element) continue;
      element.scrollTop = position.scrollTop;
      element.scrollLeft = position.scrollLeft;
    }
  }
}
