import {
  applyStatusEffectChange,
  canActorRecover,
  getHighestStatusStackCount,
  getStatusStackTotal,
  hasStatus,
  wasPetrifiedAppliedThisTurn,
} from "./helpers/status-effects.mjs";
import {
  applyActorJobResourceDelta,
  fillActorJobResource,
  normalizeJobResourceName,
  setActorJobResourceCount,
} from "./helpers/job-resources.mjs";
import {
  clearUserTargetsForTiming,
  TARGET_CLEAR_TIMINGS,
} from "./helpers/target-selection.mjs";

const ADVENTURER_STEP_MP_RECOVERY = 2;

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
      await this._resetActorLimitations();
      await this._resetEncounterStatusFlags();
      const startedCombat = await super.startCombat();
      await this._applyStartingMpOverrides();
      await this._applyEncounterStartJobAutomation();
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
      clearUserTargetsForTiming(TARGET_CLEAR_TIMINGS.TURN_END);
      const actor = combatant?.actor;
      if (!actor) return;
      await this._applyTurnEndJobAutomation(actor);
      await this._removeTurnEndStatuses(actor);
      if (actor.type !== "character") return;
      await this._removeInvokingStatus(actor);
    });
  }

  /** @override */
  async _onStartTurn(combatant, context) {
    return this._withActorSheetScroll(async () => {
      await super._onStartTurn(combatant, context);
      const actor = combatant?.actor;
      if (!actor) return;
      await this._removeTurnStartStatuses(actor);
      await this._applyTurnStartJobAutomation(actor);
      if (actor.type !== "npc") return;
      await this._removeInvokingStatus(actor);
    });
  }

  async _removeInvokingStatus(actor) {
    if (!actor.statuses?.has("invoking")) return;
    await actor.toggleStatusEffect("invoking", {
      active: false,
      render: false,
    });
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
    await this._removePetrifiedStatus(actor);
  }

  async _removePetrifiedStatus(actor) {
    if (!actor.statuses?.has("petrified")) return;
    if (wasPetrifiedAppliedThisTurn(actor, this)) return;
    await applyStatusEffectChange(actor, "petrified", false);
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
        const updateData = {};
        if (result.nextHealth !== result.currentHealth) {
          updateData["system.health.value"] = result.nextHealth;
        }
        if (result.nextBarrier !== result.currentBarrier) {
          updateData["system.barrier.value"] = result.nextBarrier;
        }
        if (result.nextMana !== result.currentMana) {
          updateData["system.mana.value"] = result.nextMana;
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
    const currentMana = Number(actor.system?.mana?.value ?? 0);
    const maxMana = Number(actor.system?.mana?.max);
    const manaCap = Number.isFinite(maxMana) && maxMana > 0 ? maxMana : 5;
    const maxHealth = Number(actor.system?.health?.max);
    const healthCap = Number.isFinite(maxHealth) && maxHealth > 0
      ? maxHealth
      : Number.POSITIVE_INFINITY;
    const dotDamage = getStatusStackTotal(actor, "dot");
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
    let nextMana = currentMana;
    let manaRecovery = 0;

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

    if (isAdventurerStep && actor.type === "character" && canActorRecover(actor)) {
      manaRecovery = this._getAdventurerStepMpRecovery(actor);
      if (manaRecovery > 0) nextMana = Math.min(currentMana + manaRecovery, manaCap);
      manaRecovery = Math.max(nextMana - currentMana, 0);
    }

    const changed =
      nextHealth !== currentHealth ||
      nextBarrier !== currentBarrier ||
      nextMana !== currentMana;
    const statusEffectsResolved = changed ||
      (dotDamage > 0 && resolvedRevivifyHealing > 0);

    return {
      changed,
      statusEffectsResolved,
      currentHealth,
      nextHealth,
      currentBarrier,
      nextBarrier,
      currentMana,
      nextMana,
      dotDamage,
      revivifyHealing: resolvedRevivifyHealing,
      manaRecovery,
      dotAfterRevivify,
    };
  }

  _getAdventurerStepMpRecovery(actor) {
    let recovery = ADVENTURER_STEP_MP_RECOVERY;
    let multiplier = 1;
    let override = null;
    let suppressed = false;

    for (const entry of this._getMpRecoveryEntries(actor)) {
      const data = entry.data;
      if (!this._mpRecoveryEntryApplies(data)) continue;
      if (data.suppress === true) suppressed = true;
      const flat = Number(data.flat);
      if (Number.isFinite(flat)) recovery += flat;
      const mult = Number(data.mult);
      if (Number.isFinite(mult)) multiplier *= mult;
      const overrideValue = Number(data.override);
      if (Number.isFinite(overrideValue)) override = overrideValue;

      for (const change of entry.changes ?? []) {
        const key = String(change?.key ?? "").trim().toLowerCase();
        if (!key.startsWith("flags.ffxiv.mprecovery.")) continue;

        const mode = this._normalizeActiveEffectChangeMode(change?.mode);
        const rawValue = String(change?.value ?? "").trim();
        const value = Number(rawValue);
        if (key === "flags.ffxiv.mprecovery.suppress") {
          suppressed ||= ["true", "1", "yes"].includes(rawValue.toLowerCase());
          continue;
        }
        if (!Number.isFinite(value)) continue;

        if (key === "flags.ffxiv.mprecovery.flat") {
          if (mode === "multiply") recovery *= value;
          else if (mode === "override") recovery = value;
          else if (mode === "subtract") recovery -= value;
          else recovery += value;
        }
        if (key === "flags.ffxiv.mprecovery.mult") {
          if (mode === "add") multiplier += value;
          else if (mode === "override") multiplier = value;
          else if (mode === "subtract") multiplier -= value;
          else multiplier *= value;
        }
        if (key === "flags.ffxiv.mprecovery.override") {
          override = value;
        }
      }
    }

    if (suppressed) return 0;
    const total = override === null ? recovery * multiplier : override;
    return Math.max(Math.floor(total), 0);
  }

  _getMpRecoveryEntries(actor) {
    const entries = [];
    for (const effect of actor?.allApplicableEffects?.() ?? []) {
      if (!effect || effect.disabled) continue;
      entries.push({
        data: foundry.utils.getProperty(effect, "flags.ffxiv.mpRecovery") ?? {},
        changes: effect.changes ?? [],
      });
    }
    for (const item of actor?.items ?? []) {
      const data = foundry.utils.getProperty(item, "flags.ffxiv.mpRecovery");
      if (!data) continue;
      entries.push({ data, changes: [] });
    }
    return entries;
  }

  _mpRecoveryEntryApplies(data) {
    if (!data || typeof data !== "object") return true;
    const round = Number(this.round ?? 0);
    const exactRound = Number(data.round);
    if (Number.isFinite(exactRound) && round !== exactRound) return false;
    const minRound = Number(data.minRound);
    if (Number.isFinite(minRound) && round < minRound) return false;
    const maxRound = Number(data.maxRound);
    if (Number.isFinite(maxRound) && round > maxRound) return false;
    return true;
  }

  _normalizeActiveEffectChangeMode(mode) {
    if (typeof mode === "string" && mode) return mode.toLowerCase();
    const legacy = Number.parseInt(mode, 10);
    switch (legacy) {
      case 1:
        return "multiply";
      case 2:
        return "add";
      case 5:
        return "override";
      default:
        return "add";
    }
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
      const resourceChanges = [];
      if (result.nextHealth !== result.currentHealth) {
        resourceChanges.push(`${result.currentHealth} -> ${result.nextHealth}`);
      }
      if (result.nextBarrier !== result.currentBarrier) {
        resourceChanges.push(`${game.i18n.localize("FFXIV.Health.barrier")} ${result.currentBarrier} -> ${result.nextBarrier}`);
      }
      if (result.nextMana !== result.currentMana) {
        resourceChanges.push(`${game.i18n.localize("FFXIV.Mana.long")} ${result.currentMana} -> ${result.nextMana}`);
      }
      if (!resourceChanges.length) {
        resourceChanges.push(`${result.currentHealth} -> ${result.nextHealth}`);
      }
      const effectsText = parts.length ? `${parts.join(", ")} ` : "";
      return `<li><strong>${result.actor.name}</strong>: ${effectsText}(${resourceChanges.join(", ")})</li>`;
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

  async _applyEncounterStartJobAutomation() {
    const actors = this._getUniqueCombatActors();
    for (const actor of actors.values()) {
      for (const item of actor.items ?? []) {
        for (const rule of this._getEncounterStartRules(item)) {
          if (!this._canApplyEncounterStartRule(actor, rule)) continue;
          await this._applyEncounterStartRule(actor, item, rule);
        }
      }
    }
  }

  _getEncounterStartRules(item) {
    return this._getJobAutomationRules(item, "encounterStart");
  }

  async _applyTurnStartJobAutomation(actor) {
    if (
      hasStatus(actor, "knocked_out") ||
      hasStatus(actor, "comatose") ||
      hasStatus(actor, "death")
    )
      return;

    for (const item of actor.items ?? []) {
      for (const rule of this._getTurnStartRules(item)) {
        if (!this._canApplyEncounterStartRule(actor, rule)) continue;
        await this._applyEncounterStartRule(actor, item, rule);
      }
    }
  }

  _getTurnStartRules(item) {
    return this._getJobAutomationRules(item, "turnStart");
  }

  async _applyTurnEndJobAutomation(actor) {
    if (
      hasStatus(actor, "knocked_out") ||
      hasStatus(actor, "comatose") ||
      hasStatus(actor, "death")
    )
      return;

    for (const item of actor.items ?? []) {
      for (const rule of this._getTurnEndRules(item)) {
        if (!this._canApplyEncounterStartRule(actor, rule)) continue;
        await this._applyEncounterStartRule(actor, item, rule);
      }
    }
  }

  _getTurnEndRules(item) {
    return this._getJobAutomationRules(item, "turnEnd");
  }

  _getJobAutomationRules(item, flag) {
    const data = foundry.utils.getProperty(item, `flags.ffxiv.${flag}`);
    const entries = Array.isArray(data)
      ? data
      : Array.isArray(data?.rules)
        ? data.rules
        : data
          ? [data]
          : [];
    return entries
      .map((entry) => ({
        action: String(entry?.action ?? "grant").trim().toLowerCase() || "grant",
        key: this._normalizeEffectKey(entry?.key ?? entry?.name),
        name: String(entry?.name ?? entry?.key ?? "").trim(),
        iconOverride: String(entry?.iconOverride ?? "").trim(),
        icon: String(entry?.icon ?? "").trim(),
        operation: String(entry?.operation ?? entry?.resourceAction ?? "grant")
          .trim()
          .toLowerCase(),
        resource: String(entry?.resource ?? entry?.resourceName ?? "").trim(),
        amount: entry?.amount ?? 1,
        remove: this._normalizeEffectRefs(entry?.remove),
        removeOnEmpty: this._normalizeEffectRefs(
          entry?.removeOnEmpty ?? entry?.removeWhenEmpty ?? entry?.removeOnZero,
        ),
        requires: this._normalizeEffectRefs(entry?.requires),
        requiresAny: this._normalizeEffectRefs(entry?.requiresAny),
        forbids: this._normalizeEffectRefs(entry?.forbids),
        flags: foundry.utils.deepClone(entry?.flags ?? {}),
        duration: entry?.duration,
      }))
      .filter(
        (rule) =>
          rule.key ||
          rule.action === "remove" ||
          (rule.action === "resource" && rule.resource),
      );
  }

  _canApplyEncounterStartRule(actor, rule) {
    if (rule.requires.some((entry) => !this._hasActorNamedEffect(actor, entry.key)))
      return false;
    if (
      rule.requiresAny.length &&
      !rule.requiresAny.some((entry) => this._hasActorNamedEffect(actor, entry.key))
    )
      return false;
    if (rule.forbids.some((entry) => this._hasActorNamedEffect(actor, entry.key)))
      return false;
    return true;
  }

  async _applyEncounterStartRule(actor, item, rule) {
    if (rule.action === "resource") {
      await this._applyEncounterStartResourceRule(actor, rule);
      return;
    }
    if (rule.action === "remove") {
      await this._removeActorNamedEffects(actor, rule.remove.length ? rule.remove : [rule]);
      return;
    }
    await this._grantEncounterStartEffect(actor, item, rule);
  }

  async _applyEncounterStartResourceRule(actor, rule) {
    if (rule.operation === "fill") {
      await fillActorJobResource(actor, rule.resource, { render: false });
      return;
    }
    if (rule.operation === "clear") {
      const result = await setActorJobResourceCount(actor, rule.resource, 0, {
        render: false,
      });
      await this._applyResourceEmptyEffects(actor, rule, result);
      return;
    }
    if (rule.operation === "set") {
      const amount = Math.max(Number.parseInt(rule.amount, 10) || 0, 0);
      const result = await setActorJobResourceCount(actor, rule.resource, amount, {
        render: false,
      });
      await this._applyResourceEmptyEffects(actor, rule, result);
      return;
    }

    const amount = Math.max(Number.parseInt(rule.amount, 10) || 1, 1);
    const delta = rule.operation === "consume" ? -amount : amount;
    const result = await applyActorJobResourceDelta(actor, rule.resource, delta, {
      render: false,
    });
    await this._applyResourceEmptyEffects(actor, rule, result);
  }

  async _applyResourceEmptyEffects(actor, rule, result) {
    if (!rule.removeOnEmpty?.length) return;
    if (!result?.item || result.next > 0) return;
    await this._removeActorNamedEffects(actor, rule.removeOnEmpty);
  }

  _getUniqueCombatActors() {
    const actors = new Map();
    for (const combatant of this.combatants) {
      const actor = combatant?.actor;
      const actorRef = actor?.uuid ?? actor?.id;
      if (!actor || actors.has(actorRef)) continue;
      actors.set(actorRef, actor);
    }
    return actors;
  }

  async _grantEncounterStartEffect(actor, item, rule) {
    const key = this._normalizeEffectKey(rule?.key ?? rule?.name);
    if (!key) return;
    if (this._isStatusEffectId(key)) {
      await applyStatusEffectChange(actor, key, true, { origin: item?.uuid });
      return;
    }
    await this._removeActorNamedEffects(actor, [
      ...rule.remove,
      { key },
    ]);

    const icon =
      this._getAutomationIcon(rule.iconOverride) ||
      this._getAutomationIcon(rule.icon) ||
      this._getAutomationIcon(item?.img) ||
      "icons/svg/aura.svg";
    const showAlways = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;
    const effectData = {
      name: String(rule?.name ?? key).trim() || key,
      img: icon,
      icon,
      origin: item?.uuid ?? "",
      disabled: false,
      transfer: false,
      statuses: [],
      displayStatusIcon: false,
      showIcon: showAlways,
      flags: {
        ffxiv: {
          abilityEffectRule: true,
          effectKey: key,
          sourceItemUuid: item?.uuid ?? "",
        },
      },
      duration: this._prepareEncounterEffectDuration(rule.duration),
    };
    if (rule.flags && typeof rule.flags === "object") {
      effectData.flags = foundry.utils.mergeObject(
        effectData.flags || {},
        foundry.utils.deepClone(rule.flags),
      );
    }
    await actor.createEmbeddedDocuments("ActiveEffect", [effectData], {
      render: false,
    });
  }

  _prepareEncounterEffectDuration(sourceDuration) {
    if (!sourceDuration || typeof sourceDuration !== "object") return {};
    const duration = {
      startTime: game.time?.worldTime ?? null,
      combat: this.id,
      startRound: this.round ?? null,
      startTurn: this.turn ?? null,
    };
    for (const key of ["rounds", "turns"]) {
      const value = Number(sourceDuration[key]);
      if (Number.isFinite(value) && value > 0) duration[key] = value;
    }
    return duration;
  }

  _getAutomationIcon(icon) {
    const value = String(icon ?? "").trim();
    if (!value) return "";
    const normalized = value.toLowerCase().replace(/\\/g, "/").split(/[?#]/)[0];
    return normalized === "ready.webp" || normalized.endsWith("/ready.webp")
      ? ""
      : value;
  }

  async _removeActorNamedEffects(actor, keys) {
    if (!actor?.effects?.size) return;
    const normalizedKeys = new Set(
      keys
        .map((key) => this._normalizeEffectKey(key?.key ?? key?.name ?? key))
        .filter(Boolean),
    );
    const ids = actor.effects
      .filter((effect) => {
        if (!effect || effect.disabled) return false;
        return Array.from(normalizedKeys).some((key) =>
          this._actorEffectMatchesKey(effect, key),
        );
      })
      .map((effect) => effect.id)
      .filter(Boolean);
    if (ids.length)
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids, {
        render: false,
        ffxivSuppressRemovalText: true,
      });
  }

  _hasActorNamedEffect(actor, key) {
    const normalizedKey = this._normalizeEffectKey(key);
    if (!actor || !normalizedKey) return false;
    if (this._isStatusEffectId(normalizedKey) && actor.statuses?.has(normalizedKey))
      return true;
    return actor.effects?.some((effect) =>
      this._actorEffectSatisfiesKey(effect, normalizedKey),
    ) ?? false;
  }

  _actorEffectSatisfiesKey(effect, key) {
    const normalizedKey = this._normalizeEffectKey(key);
    if (!effect || !normalizedKey) return false;
    if (this._actorEffectMatchesKey(effect, normalizedKey)) return true;
    return this._getActorEffectCountsAsKeys(effect).includes(normalizedKey);
  }

  _actorEffectMatchesKey(effect, key) {
    const normalizedKey = this._normalizeEffectKey(key);
    if (!effect || !normalizedKey) return false;
    const flagKey = this._normalizeEffectKey(
      effect.getFlag?.("ffxiv", "effectKey") ??
      foundry.utils.getProperty(effect, "flags.ffxiv.effectKey"),
    );
    if (flagKey && flagKey === normalizedKey) return true;
    return this._normalizeEffectKey(effect.name) === normalizedKey;
  }

  _getActorEffectCountsAsKeys(effect) {
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
    };
  }

  _normalizeEffectKey(value) {
    return normalizeJobResourceName(value);
  }

  async _resetEncounterStatusFlags() {
    const actors = this._getUniqueCombatActors();
    for (const actor of actors.values()) {
      if (actor.getFlag("ffxiv", "stunnedInEncounter") !== undefined) {
        await actor.unsetFlag("ffxiv", "stunnedInEncounter");
      }
    }
  }

  async _resetActorLimitations() {
    const sheets = this._captureActorSheetScroll();
    const updatedActors = new Set();
    for (const actor of this._getUniqueCombatActors().values()) {
      const updates = [];
      for (const item of actor.items) {
        if (!this._hasLimitations(item)) continue;

        const max = Number.parseInt(item.system.job_resources_max, 10);
        const resourceStatus = new Array(max).fill(false);
        const currentStatus = Array.isArray(item.system.job_resource_status)
          ? item.system.job_resource_status.slice(0, max)
          : [];
        while (currentStatus.length < max) currentStatus.push(false);
        if (currentStatus.every((status) => !status)) continue;

        updates.push({
          _id: item.id,
          "system.job_resource_status": resourceStatus,
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
    if (!String(item.system?.limitations ?? "").trim()) return false;
    const max = Number.parseInt(item.system?.job_resources_max, 10);
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
