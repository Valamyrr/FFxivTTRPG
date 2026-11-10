import { hasStatus } from "./status-effects.mjs";
import { maintainChatScroll, prepareChatRolls } from "./chat-message.mjs";

export function getAbilityDamageResolution(message) {
  const resolution = message?.getFlag("ffxiv", "damageResolution");
  if (!resolution || resolution.hasDirectRoll !== undefined) return resolution;
  let item;
  try {
    item = fromUuidSync(resolution.sourceItemUuid);
  } catch {
    return resolution;
  }
  if (!item?.getRollData) return resolution;
  const rollData = item.getRollData();
  const options = { effectSnapshot: resolution.effectSnapshot };
  return {
    ...resolution,
    automaticDirectHit: Number.isFinite(resolution.checkTotal) && game.settings.get("ffxiv", "autoRollDirectHitDamage"),
    hasDirectRoll: item._hasDirectRoll(),
    defenseType: item._getDirectHitDefenseType(),
    useLowerDefense: item._usesLowerTargetDefense(options),
    directFormula: Roll.replaceFormulaData(item._getDirectFormula(rollData, options), rollData, { missing: "0", warn: true }),
    effectSnapshot: resolution.effectSnapshot ?? item._getEffectSnapshotData(),
  };
}

export function getAbilityDamageTargets(resolution, tokens = game.user.targets) {
  if (resolution.pendingTargets?.length) return resolution.targets;

  const targets = new Map();
  const automatic = resolution.automaticDirectHit ?? (
    Number.isFinite(resolution.checkTotal) && game.settings.get("ffxiv", "autoRollDirectHitDamage")
  );
  for (const token of tokens ?? []) {
    const actor = token.actor;
    if (!actor) continue;
    const rollData = actor.getRollData?.() ?? {};
    let defense = Number(rollData[resolution.defenseType === "magic" ? "mdef" : "def"]);
    if (resolution.useLowerDefense && Number.isFinite(Number(rollData.def)) && Number.isFinite(Number(rollData.mdef)))
      defense = Math.min(Number(rollData.def), Number(rollData.mdef));
    const recorded = resolution.targets.find((target) => target.actorUuid === actor.uuid);
    const direct = automatic || (!resolution.directRoll && hasStatus(actor, "heavy"))
      ? Boolean(resolution.hasDirectRoll ?? resolution.directRoll) && (
        resolution.critical || hasStatus(actor, "heavy") ||
        (resolution.defenseType && Number.isFinite(resolution.checkTotal) && Number.isFinite(defense) && resolution.checkTotal > defense)
      )
      : Boolean(resolution.directRoll) && (recorded?.direct ?? true);
    targets.set(actor.uuid, {
      actorUuid: actor.uuid,
      tokenUuid: token.document?.uuid ?? "",
      name: token.name,
      direct: Boolean(direct),
    });
  }
  return Array.from(targets.values());
}

export function renderAbilityDamageTargets(resolution, targets = getAbilityDamageTargets(resolution)) {
  const escape = foundry.utils.escapeHTML;
  const groups = targets.length
    ? [false, true].map((direct) => ({ direct, targets: targets.filter((target) => target.direct === direct) }))
      .filter((group) => group.targets.length)
    : [{ direct: Boolean(resolution.directRoll), targets: [] }];
  const buttonData = `data-item-uuid="${escape(resolution.sourceItemUuid)}" data-actor-uuid="${escape(resolution.sourceActorUuid)}"`;
  let content = "<hr>";
  for (const group of groups) {
    const refs = group.targets.map((target) => target.actorUuid);
    const base = Number(resolution.baseRoll?.total ?? 0);
    const total = group.direct && !resolution.directRoll
      ? `${base} + ${resolution.directFormula}`
      : base + (group.direct ? Number(resolution.directRoll?.total ?? 0) : 0);
    const targetData = encodeURIComponent(JSON.stringify(refs));
    const disabled = !refs.length || resolution.pendingTargets?.length ? "disabled" : "";
    const names = group.targets.length
      ? group.targets.map((target) => escape(target.name)).join(", ")
      : game.i18n.localize("FFXIV.Chat.NoTargets");
    const formula = group.direct
      ? `${base} + ${resolution.directRoll?.total ?? resolution.directFormula}`
      : resolution.baseRoll?.formula ?? String(base);
    content += `<div class="ffxiv-ability-target-list"><strong>${game.i18n.localize("FFXIV.Chat.Targeting")}</strong> ${names}</div>`;
    content += `<div><strong>${game.i18n.localize("FFXIV.Chat.TotalEffect")}</strong></div><div class="dice-roll" data-action="expandRoll" data-direct="${group.direct}"><div class="dice-result"><div class="dice-formula">${escape(formula)}</div><div class="dice-total">${escape(String(total))}</div></div></div>`;
    content += `<div class="ffxiv-chat-buttons"><button class="ffxiv-apply-ability-damage" data-damage-targets="${targetData}" data-direct="${group.direct}" ${buttonData} ${disabled}>${game.i18n.localize("FFXIV.Chat.Damage")}</button>`;
    content += `<button class="ffxiv-apply-heal" data-damage-targets="${targetData}" data-direct="${group.direct}" data-heal="${escape(String(total))}" ${buttonData} ${disabled}>${game.i18n.localize("FFXIV.Chat.Heal")}</button></div>`;
  }
  return content + renderAbilityApplications(resolution.applications ?? [], { pending: Boolean(resolution.pendingTargets?.length) });
}

export function renderAbilityApplications(applications, { pending = false } = {}) {
  const escape = foundry.utils.escapeHTML;
  let content = "";
  for (const result of applications) {
    const summaryKey = result.kind === "effects"
      ? (result.undone ? "FFXIV.Chat.ActiveEffectsUndoneTo" : "FFXIV.Chat.ActiveEffectsAppliedTo")
      : result.kind === "heal"
        ? (result.undone ? "FFXIV.Chat.HealingUndoneTo" : "FFXIV.Chat.HealingAppliedTo")
        : (result.undone ? "FFXIV.Chat.DamageUndoneTo" : "FFXIV.Chat.DamageAppliedTo");
    const summary = game.i18n.format(
      summaryKey,
      {
        amount: result.kind === "heal" ? result.resolvedHealing : result.resolvedDamage,
        target: escape(result.name),
      },
    );
    const disabled = pending ? "disabled" : "";
    const action = result.undone ? "redo" : "undo";
    const label = game.i18n.localize(result.undone ? "FFXIV.Chat.RedoApplication" : "FFXIV.Chat.UndoApplication");
    const control = game.user.isGM && result[action]
      ? `<button type="button" class="ffxiv-application-control ffxiv-${action}-application" data-kind="${escape(result.kind)}" data-application-id="${escape(result.applicationId)}" data-actor-uuid="${escape(result.actorUuid)}" title="${escape(label)}" aria-label="${escape(label)}" ${disabled}><i class="fas fa-${action}" aria-hidden="true"></i></button>`
      : "";
    content += `<div class="ffxiv-apply-result ffxiv-damage-application-summary">${control}<span>${summary}</span></div>`;
  }
  return content;
}

class FFXIVAbilityTargets extends HTMLElement {
  connectedCallback() {
    this._message = game.messages.get(this.closest("[data-message-id]")?.dataset.messageId);
    const resolution = getAbilityDamageResolution(this._message);
    if (resolution?.pendingTargets?.length) {
      this._hooks = [];
      this.render();
      return;
    }
    this._refresh = foundry.utils.debounce(() => this.render(), 50);
    this._hooks = [
      ["targetToken", Hooks.on("targetToken", (user) => {
        if (user.id === game.user.id) this._refresh();
      })],
      ["updateToken", Hooks.on("updateToken", (token) => {
        if (Array.from(game.user.targets ?? []).some((target) => target.document?.uuid === token.uuid))
          this._refresh();
      })],
      ["canvasReady", Hooks.on("canvasReady", () => this._refresh())],
    ];
    this.render();
  }

  disconnectedCallback() {
    for (const [name, id] of this._hooks ?? []) Hooks.off(name, id);
  }

  render() {
    if (!this.isConnected) return;
    const resolution = getAbilityDamageResolution(this._message);
    if (!resolution) return;
    while (this.previousElementSibling?.matches("hr"))
      this.previousElementSibling.remove();
    const expanded = new Set(Array.from(this.querySelectorAll(".dice-roll.expanded"), (roll) => roll.dataset.direct));
    maintainChatScroll(this._message.id);
    this.innerHTML = renderAbilityDamageTargets(resolution);
    for (const roll of this.querySelectorAll(".dice-roll"))
      roll.classList.toggle("expanded", expanded.has(roll.dataset.direct));
    prepareChatRolls(this._message, this);
  }
}

export function registerAbilityTargets() {
  customElements.define("ffxiv-ability-targets", FFXIVAbilityTargets);
}
