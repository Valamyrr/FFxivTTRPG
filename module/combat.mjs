import {
  applyStatusEffectChange,
  canActorRecover,
  getHighestStatusStackCount,
} from "./helpers/status-effects.mjs";

const STEP_END_STATUS_ICONS = {
  dot: "systems/ffxiv/assets/effects/dot.webp",
  revivify: "systems/ffxiv/assets/effects/revivify.webp",
};

export function getTurnStep(combatant) {
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
      this._ffxivResolvedStepEnds = new Set();
      await this._confirmResetLimitations();
      await this._resetEncounterStatusFlags();
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

  async reorderCombatant(combatantId, direction) {
    const combatant = this.combatants.get(combatantId);
    if (!combatant) return this;

    const step = getTurnStep(combatant);
    const stepCombatants = this.turns.filter(
      (entry) => getTurnStep(entry) === step,
    );
    const currentIndex = stepCombatants.findIndex(
      (entry) => entry.id === combatant.id,
    );
    const targetIndex = currentIndex + Math.sign(Number(direction));
    if (
      currentIndex === -1 ||
      targetIndex < 0 ||
      targetIndex >= stepCombatants.length
    )
      return this;

    const reordered = stepCombatants.slice();
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];

    const usedOrders = stepCombatants
      .map((entry) => Number(entry.initiative))
      .filter(Number.isFinite);
    const firstOrder = usedOrders.length ? Math.min(...usedOrders) : 1;
    const updates = reordered.map((entry, index) => ({
      _id: entry.id,
      initiative: firstOrder + index,
    }));

    await this.updateEmbeddedDocuments("Combatant", updates);
    return this;
  }

  /** @override */
  async nextTurn() {
    return this._withActorSheetScroll(async () => {
      await this._resolveCurrentStepEnd();
      this._ffxivAdvancingTurn = true;
      try {
        return await super.nextTurn();
      } finally {
        this._ffxivAdvancingTurn = false;
      }
    });
  }

  /** @override */
  async previousTurn() {
    return this._withActorSheetScroll(() => super.previousTurn());
  }

  /** @override */
  async nextRound() {
    return this._withActorSheetScroll(async () => {
      if (!this._ffxivAdvancingTurn) await this._resolveRemainingStepEnds();
      return super.nextRound();
    });
  }

  /** @override */
  async previousRound() {
    return this._withActorSheetScroll(() => super.previousRound());
  }

  /** @override */
  async _onEndTurn(combatant, context) {
    return this._withActorSheetScroll(async () => {
      await super._onEndTurn(combatant, context);
      if (combatant?.actor) await this._removeTurnEndStatuses(combatant.actor);
      if (combatant?.actor?.type !== "character") return;
      await this._removeInvokingStatus(combatant.actor);
    });
  }

  /** @override */
  async _onStartTurn(combatant, context) {
    return this._withActorSheetScroll(async () => {
      await super._onStartTurn(combatant, context);
      if (combatant?.actor) await this._removeTurnStartStatuses(combatant.actor);
      if (combatant?.actor?.type !== "npc") return;
      await this._removeInvokingStatus(combatant.actor);
    });
  }

  async _removeInvokingStatus(actor) {
    if (!actor.statuses?.has("invoking")) return;
    await actor.toggleStatusEffect("invoking", { active: false });
  }

  async _removeTurnStartStatuses(actor) {
    await applyStatusEffectChange(actor, "transcendent", false);
  }

  async _removeTurnEndStatuses(actor) {
    await this._deleteStatuses(actor, [
      "drain",
      "enmity",
      "heavy",
      "paralysis",
      "silence",
    ]);
  }

  async _resolveCurrentStepEnd() {
    const combatant = this.combatant;
    if (!combatant || !this._isLastCombatantInStep(combatant)) return;
    await this._resolveStepEndOnce(getTurnStep(combatant));
  }

  async _resolveRemainingStepEnds() {
    const round = this.round;
    const steps = this._getCombatSteps();
    const currentStep = this.combatant ? getTurnStep(this.combatant) : steps[0];
    for (const step of steps) {
      if (step < currentStep) continue;
      await this._resolveStepEndOnce(step, round);
    }
  }

  _getCombatSteps() {
    return Array.from(
      new Set(this.combatants.map((combatant) => getTurnStep(combatant))),
    ).sort((a, b) => a - b);
  }

  _isLastCombatantInStep(combatant) {
    const step = getTurnStep(combatant);
    const stepCombatants = this.turns.filter(
      (entry) => getTurnStep(entry) === step,
    );
    return stepCombatants[stepCombatants.length - 1]?.id === combatant.id;
  }

  async _resolveStepEnd(step) {
    const actors = this._getStepActors(step);
    if (!actors.length) return;

    const updates = [];
    const messages = [];
    const updatedActorIds = new Set();
    for (const actor of actors) {
      const result = this._getStepEndHealthResult(actor, step);
      if (!result.changed && !result.statusEffectsResolved) continue;
      if (result.changed) {
        updatedActorIds.add(actor.id);
        const updateData = {
          "system.health.value": result.nextHealth,
        };
        if (result.nextBarrier !== result.currentBarrier) {
          updateData["system.barrier.value"] = result.nextBarrier;
        }
        updates.push((async () => {
          await actor.update(updateData, {
            render: false,
            ffxivSkipActorSheetRefresh: true,
            ffxivSkipKnockedOutSync: true,
          });
          if (result.currentHealth > 0 && result.nextHealth <= 0) {
            await applyStatusEffectChange(actor, "knocked_out", true);
          }
        })());
      }
      if (this._shouldReportStepEndResult(result)) {
        messages.push({ actor, ...result });
      }
    }

    await this._removeStepEndStatuses();
    if (!updates.length && !messages.length) return;
    if (updates.length) {
      await Promise.all(updates);
      await this._refreshActorSheets(
        this._captureActorSheetScroll(),
        updatedActorIds,
      );
    }
    await this._createStepEndStatusMessage(step, messages);
  }

  async _resolveStepEndOnce(step, round = this.round) {
    this._ffxivResolvedStepEnds ??= new Set();
    const key = this._getResolvedStepEndKey(step, round);
    if (this._ffxivResolvedStepEnds.has(key)) return;
    this._ffxivResolvedStepEnds.add(key);
    try {
      await this._resolveStepEnd(step);
    } catch (error) {
      this._ffxivResolvedStepEnds.delete(key);
      throw error;
    }
  }

  _getResolvedStepEndKey(step, round = this.round) {
    return `${this.id ?? this.uuid ?? "combat"}:${round ?? 0}:${step}`;
  }

  _shouldReportStepEndResult(result) {
    if (result.currentHealth <= 0 && result.nextHealth <= 0) return false;
    return result.statusEffectsResolved;
  }

  _getStepActors(step) {
    const actors = new Map();
    for (const combatant of this.combatants) {
      if (getTurnStep(combatant) !== step) continue;
      const actor = combatant.actor;
      const actorRef = actor?.uuid ?? actor?.id;
      if (!actor || actors.has(actorRef)) continue;
      actors.set(actorRef, actor);
    }
    return Array.from(actors.values());
  }

  _getStepEndHealthResult(actor, step) {
    const currentHealth = Number(actor.system?.health?.value ?? 0);
    const currentBarrier = Math.max(Number(actor.system?.barrier?.value) || 0, 0);
    const maxHealth = Number(actor.system?.health?.max);
    const healthCap = Number.isFinite(maxHealth) && maxHealth > 0
      ? maxHealth
      : Number.POSITIVE_INFINITY;
    const dotDamage = getHighestStatusStackCount(actor, "dot");
    const revivifyHealing = getHighestStatusStackCount(actor, "revivify");
    const availableRevivifyHealing = canActorRecover(actor)
      ? revivifyHealing
      : 0;
    const dotFirstResult = this._applyStepEndDOT(
      currentHealth,
      currentBarrier,
      dotDamage,
    );
    const isAdventurerStep = step === 0;
    const dotWouldKnockOut = dotFirstResult.nextHealth <= 0 &&
      dotFirstResult.healthDamage > 0;
    const revivifyWouldFill = availableRevivifyHealing > 0 &&
      currentHealth + availableRevivifyHealing >= healthCap;
    const dotAfterRevivify = isAdventurerStep
      ? dotWouldKnockOut
      : revivifyWouldFill;

    let nextHealth = currentHealth;
    let nextBarrier = currentBarrier;
    let resolvedRevivifyHealing = 0;

    if (dotAfterRevivify) {
      if (availableRevivifyHealing > 0) {
        nextHealth = this._applyStepEndRevivify(
          nextHealth,
          availableRevivifyHealing,
          healthCap,
        );
        resolvedRevivifyHealing = availableRevivifyHealing;
      }
      const dotResult = this._applyStepEndDOT(nextHealth, nextBarrier, dotDamage);
      nextHealth = dotResult.nextHealth;
      nextBarrier = dotResult.nextBarrier;
    } else {
      nextHealth = dotFirstResult.nextHealth;
      nextBarrier = dotFirstResult.nextBarrier;
      if (availableRevivifyHealing > 0 && !dotWouldKnockOut) {
        nextHealth = this._applyStepEndRevivify(
          nextHealth,
          availableRevivifyHealing,
          healthCap,
        );
        resolvedRevivifyHealing = availableRevivifyHealing;
      }
    }

    const changed = nextHealth !== currentHealth || nextBarrier !== currentBarrier;
    const statusEffectsResolved = changed ||
      (dotDamage > 0 && resolvedRevivifyHealing > 0);

    return {
      changed,
      statusEffectsResolved,
      currentHealth,
      nextHealth,
      currentBarrier,
      nextBarrier,
      dotDamage,
      revivifyHealing: resolvedRevivifyHealing,
      dotAfterRevivify,
    };
  }

  _applyStepEndDOT(health, barrier, damage) {
    const barrierDamage = Math.min(barrier, damage);
    const healthDamage = Math.max(damage - barrier, 0);
    return {
      nextHealth: Math.max(health - healthDamage, 0),
      nextBarrier: barrier - barrierDamage,
      healthDamage,
    };
  }

  _applyStepEndRevivify(health, healing, healthCap) {
    return Math.max(0, Math.min(health + healing, healthCap));
  }

  async _removeStepEndStatuses() {
    const actors = this._getStepActors(0).concat(this._getStepActors(1));
    for (const actor of actors) {
      await this._deleteStatuses(actor, ["enmity"]);
    }
  }

  async _deleteStatuses(actor, statusIds) {
    if (!actor?.effects?.size) return;
    const statusSet = new Set(statusIds);
    const ids = actor.effects
      .filter((effect) => {
        const statuses = effect?.statuses;
        return (
          statuses instanceof Set &&
          Array.from(statuses).some((statusId) => statusSet.has(statusId))
        );
      })
      .map((effect) => effect.id)
      .filter(Boolean);
    if (ids.length) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
    }
  }

  async _createStepEndStatusMessage(step, results) {
    if (!results.length) return;
    const stepLabel = step === 0
      ? game.i18n.localize("FFXIV.Combat.AdventurerStep")
      : game.i18n.localize("FFXIV.Combat.EnemyStep");
    const rows = results.map((result) => {
      const parts = [];
      if (result.revivifyHealing > 0 && result.dotAfterRevivify) {
        parts.push(
          this._formatStepEndStatusEffect("revivify", result.revivifyHealing),
        );
      }
      if (result.dotDamage > 0) {
        parts.push(this._formatStepEndStatusEffect("dot", result.dotDamage));
      }
      if (result.revivifyHealing > 0 && !result.dotAfterRevivify) {
        parts.push(
          this._formatStepEndStatusEffect("revivify", result.revivifyHealing),
        );
      }
      const resourceChanges = [`${result.currentHealth} -> ${result.nextHealth}`];
      if (result.nextBarrier !== result.currentBarrier) {
        resourceChanges.push(`${game.i18n.localize("FFXIV.Health.barrier")} ${result.currentBarrier} -> ${result.nextBarrier}`);
      }
      return `<li><strong>${result.actor.name}</strong>: ${parts.join(", ")} (${resourceChanges.join(", ")})</li>`;
    }).join("");

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ scene: canvas?.scene }),
      flavor: game.i18n.format("FFXIV.Combat.StepEndStatusEffects", {
        step: stepLabel,
      }),
      content: `<ul class="ffxiv-step-status-results">${rows}</ul>`,
    });
  }

  _formatStepEndStatusEffect(statusId, amount) {
    const icon = STEP_END_STATUS_ICONS[statusId];
    const labelKey = statusId === "revivify"
      ? "FFXIV.Effects.Revivify"
      : "FFXIV.Effects.DOT";
    const label = game.i18n.localize(labelKey);
    const classes = `ffxiv-step-status-effect ffxiv-step-status-${statusId}`;
    return `<span class="${classes}"><img src="${icon}" alt="${label}" title="${label}" />${amount}</span>`;
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

  async _resetEncounterStatusFlags() {
    const actors = new Map();
    for (const combatant of this.combatants) {
      const actor = combatant?.actor;
      const actorRef = actor?.uuid ?? actor?.id;
      if (!actor || actors.has(actorRef)) continue;
      actors.set(actorRef, actor);
    }
    for (const actor of actors.values()) {
      if (actor.getFlag("ffxiv", "stunnedInEncounter") !== undefined) {
        await actor.unsetFlag("ffxiv", "stunnedInEncounter");
      }
    }
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
