import { getTurnStep } from "../combat.mjs";
import {
  applyStatusEffectChange,
  getStatusStackCount,
  hasStatus,
  isStackableStatusEffect,
} from "./status-effects.mjs";
import { getSummonerCombatant } from "./summons.mjs";
import { getHookHTMLElement } from "./ui.mjs";

export function renderCombatStepIndicators(app, html) {
  const element = getHookHTMLElement(html, app);
  if (!element) return;

  element
    .querySelectorAll(".ffxiv-combat-step-indicator")
    .forEach((indicator) => indicator.remove());

  const combat = app?.viewed ?? app?.combat ?? game.combat;
  const turns = combat?.turns ?? [];
  if (!turns.length) return;

  const combatantElements = new Map();
  const combatantRows = element.querySelectorAll("[data-combatant-id]");
  for (const combatantElement of combatantRows) {
    const combatantId = combatantElement.dataset.combatantId;
    if (combatantId) combatantElements.set(combatantId, combatantElement);
  }
  if (!combatantElements.size) return;

  let currentStep = null;
  let previousElement = null;
  for (const combatant of turns) {
    const combatantElement = combatantElements.get(combatant.id);
    if (!combatantElement) continue;

    const step = getTurnStep(combatant);
    if (step !== currentStep) {
      if (previousElement) {
        previousElement.after(createCombatStepIndicator(
          currentStep,
          "end",
          previousElement,
        ));
      }
      combatantElement.before(createCombatStepIndicator(
        step,
        "start",
        combatantElement,
      ));
      currentStep = step;
    }
    previousElement = combatantElement;
  }

  if (previousElement) {
    previousElement.after(createCombatStepIndicator(
      currentStep,
      "end",
      previousElement,
    ));
  }
}

export function renderCombatTrackerStatusStacks(app, html) {
  const element = getHookHTMLElement(html, app);
  if (!element) return;

  const combat = app?.viewed ?? app?.combat ?? game.combat;
  if (!combat?.combatants?.size) return;

  const statusEffects = new Map(
    (CONFIG.statusEffects ?? []).map((effect) => [effect.id, effect]),
  );
  const combatantElements = element.querySelectorAll("[data-combatant-id]");
  for (const combatantElement of combatantElements) {
    const combatant = combat.combatants.get(
      combatantElement.dataset.combatantId,
    );
    if (!combatant?.actor) continue;
    decorateCombatantStatusStacks(combatantElement, combatant.actor, statusEffects);
  }
}

function decorateCombatantStatusStacks(combatantElement, actor, statusEffects) {
  const effects = combatantElement.querySelector(
    ".token-effects, .combatant-effects, .effects",
  );
  if (!(effects instanceof HTMLElement)) return;

  effects
    .querySelectorAll(".ffxiv-combat-status-stack")
    .forEach((counter) => counter.remove());

  const icons = Array.from(effects.querySelectorAll("img"));
  for (const statusId of actor.statuses ?? []) {
    if (!isStackableStatusEffect(statusId)) continue;
    const status = statusEffects.get(statusId);
    const icon = getCombatTrackerStatusIcon(icons, statusId, status);
    if (!(icon instanceof HTMLImageElement)) continue;
    const label = game.i18n.localize(status?.name ?? status?.label ?? statusId);
    const count = getStatusStackCount(actor, statusId);
    if (count <= 1) {
      icon.title = label;
      icon.setAttribute("data-tooltip", label);
      continue;
    }

    const wrapper =
      icon.parentElement?.classList.contains("ffxiv-combat-status")
        ? icon.parentElement
        : document.createElement("span");
    if (wrapper !== icon.parentElement) {
      wrapper.className = "ffxiv-combat-status";
      icon.before(wrapper);
      wrapper.appendChild(icon);
    }

    const counter = document.createElement("span");
    counter.className = "ffxiv-combat-status-stack";
    counter.textContent = String(count);
    wrapper.appendChild(counter);

    icon.title = `${label} (x${count})`;
    icon.setAttribute("data-tooltip", `${label} (x${count})`);
  }
}

function getCombatTrackerStatusIcon(icons, statusId, status) {
  return icons.find((icon) => {
    const iconStatusId = String(
      icon.dataset.statusId ?? icon.dataset.status ?? "",
    );
    if (iconStatusId === statusId) return true;
    const src = String(icon.getAttribute("src") ?? icon.src ?? "");
    return Boolean(status?.img && src.includes(status.img)) ||
      Boolean(status?.icon && src.includes(status.icon));
  });
}

export function renderCombatTrackerOrderControls(app, html) {
  const element = getHookHTMLElement(html, app);
  if (!element) return;

  const combat = app?.viewed ?? app?.combat ?? game.combat;
  const turns = combat?.turns ?? [];
  if (!turns.length) return;

  const stepIndexes = new Map();
  for (const combatant of turns) {
    if (getSummonerCombatant(combatant)) continue;
    const step = getTurnStep(combatant);
    if (!stepIndexes.has(step)) stepIndexes.set(step, []);
    stepIndexes.get(step).push(combatant.id);
  }

  const combatantElements = element.querySelectorAll("[data-combatant-id]");
  for (const combatantElement of combatantElements) {
    const combatantId = combatantElement.dataset.combatantId;
    const combatant = combat.combatants.get(combatantId);
    if (!combatant) continue;

    const controls = getCombatTrackerInitiativeElement(combatantElement);
    if (!(controls instanceof HTMLElement)) continue;

    if (getSummonerCombatant(combatant)) {
      controls.replaceChildren();
      controls.classList.remove("ffxiv-combat-order-controls");
      continue;
    }

    const stepIds = stepIndexes.get(getTurnStep(combatant)) ?? [];
    const index = stepIds.indexOf(combatant.id);
    controls.replaceChildren(
      createCombatOrderButton(combat, combatant, -1, index <= 0),
      createCombatOrderButton(
        combat,
        combatant,
        1,
        index === -1 || index >= stepIds.length - 1,
      ),
    );
    controls.classList.add("ffxiv-combat-order-controls");
  }
}

export function renderCombatTrackerSummonGroups(app, html) {
  const element = getHookHTMLElement(html, app);
  if (!element) return;

  const combat = app?.viewed ?? app?.combat ?? game.combat;
  const rows = new Map();
  for (const row of element.querySelectorAll("[data-combatant-id]")) {
    row.classList.remove(
      "ffxiv-combat-summon",
      "ffxiv-combat-summoner",
      "ffxiv-combat-summon-start",
    );
    row.querySelectorAll(".ffxiv-combat-summon-link").forEach((link) => link.remove());
    rows.set(row.dataset.combatantId, row);
  }

  const groups = new Map();
  for (const combatant of combat?.turns ?? []) {
    if (!rows.has(combatant.id)) continue;
    let summoner = getSummonerCombatant(combatant);
    if (!summoner) continue;

    const seen = new Set([combatant.id]);
    while (summoner) {
      if (seen.has(summoner.id)) {
        summoner = null;
        break;
      }
      seen.add(summoner.id);
      const parent = getSummonerCombatant(summoner);
      if (!parent) break;
      summoner = parent;
    }
    if (!summoner || !rows.has(summoner.id)) continue;
    if (!groups.has(summoner.id)) groups.set(summoner.id, []);
    groups.get(summoner.id).push(combatant.id);
  }

  for (const [summonerId, summonIds] of groups) {
    const groupIds = [...summonIds, summonerId];
    for (const [index, id] of groupIds.entries()) {
      const row = rows.get(id);
      row.classList.add(id === summonerId ? "ffxiv-combat-summoner" : "ffxiv-combat-summon");
      if (index === 0) row.classList.add("ffxiv-combat-summon-start");
      const link = document.createElement("span");
      link.className = "ffxiv-combat-summon-link fa-solid fa-link";
      link.setAttribute("aria-hidden", "true");
      row.appendChild(link);
    }
  }
}

function getCombatTrackerInitiativeElement(combatantElement) {
  const element = combatantElement.querySelector(
    ".token-initiative, .combatant-initiative, .initiative",
  );
  if (element instanceof HTMLElement) return element;

  const controls = document.createElement("div");
  controls.className = "token-initiative";
  combatantElement.appendChild(controls);
  return controls;
}

function createCombatOrderButton(combat, combatant, direction, unavailable) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ffxiv-combat-order-button";
  button.disabled = unavailable || !game.user.isGM;
  button.dataset.direction = String(direction);
  button.title = game.i18n.localize(
    direction < 0 ? "FFXIV.Combat.MoveUp" : "FFXIV.Combat.MoveDown",
  );

  const icon = document.createElement("i");
  icon.className = direction < 0 ? "fas fa-chevron-up" : "fas fa-chevron-down";
  button.appendChild(icon);

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    await combat.reorderCombatant(combatant.id, direction);
  });

  return button;
}

export function installCarouselCombatTrackerStepIndicators(api = null) {
  if (globalThis.__ffxivCarouselCombatStepIndicatorsInstalled) return;
  if (game.modules.get("combat-tracker-dock")?.active !== true) return;

  const CombatDockClass = api?.CombatDock ?? CONFIG.combatTrackerDock?.CombatDock;
  if (!CombatDockClass?.prototype) return;
  globalThis.__ffxivCarouselCombatStepIndicatorsInstalled = true;

  const render = (dock) => renderCarouselCombatStepIndicators(dock);
  for (const method of ["setupCombatants", "updateOrder", "updateCombatant"]) {
    const original = CombatDockClass.prototype[method];
    if (typeof original !== "function") continue;
    CombatDockClass.prototype[method] = function ffxivWrappedCombatDockMethod(
      ...args
    ) {
      const result = original.apply(this, args);
      render(this);
      return result;
    };
  }
  renderCarouselCombatStepIndicators(ui.combatDock);
}

function renderCarouselCombatStepIndicators(dock) {
  const container = dock?.element?.querySelector?.("#combatants");
  if (!(container instanceof HTMLElement)) return;

  container
    .querySelectorAll(".ffxiv-carousel-combat-step-indicator")
    .forEach((indicator) => indicator.remove());

  const combatants = dock.sortedCombatants ?? dock.combat?.turns ?? [];
  if (!combatants.length) return;

  const portraitElements = new Map();
  for (const portrait of dock.portraits ?? []) {
    if (portrait?.combatant?.id && portrait.element instanceof HTMLElement) {
      portraitElements.set(portrait.combatant.id, portrait.element);
    }
  }
  for (const element of container.querySelectorAll("[data-combatant-id]")) {
    const combatantId = element.dataset.combatantId;
    if (combatantId && !portraitElements.has(combatantId)) {
      portraitElements.set(combatantId, element);
    }
  }

  const orderedEntries = combatants
    .map((combatant) => {
      const element = portraitElements.get(combatant.id);
      if (!(element instanceof HTMLElement)) return null;
      return {
        combatant,
        element,
        order: getCarouselCombatantElementOrder(element),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
  if (!orderedEntries.length) return;

  let currentStep = null;
  let previousEntry = null;
  for (const entry of orderedEntries) {
    const step = getTurnStep(entry.combatant);
    if (step !== currentStep) {
      if (previousEntry) {
        container.appendChild(createCarouselCombatStepBoundary(
          currentStep,
          step,
          previousEntry.order,
          dock,
        ));
      } else {
        container.appendChild(createCarouselCombatStepIndicator(
          step,
          "start",
          entry.order - 1,
          dock,
        ));
      }
      currentStep = step;
    }
    previousEntry = entry;
  }

  if (previousEntry) {
    container.appendChild(createCarouselCombatStepIndicator(
      currentStep,
      "end",
      previousEntry.order + 1,
      dock,
    ));
    moveCarouselRoundSeparatorAfterStepEnd(container, previousEntry.order + 2);
  }
}

function getCarouselCombatantElementOrder(element) {
  const order = Number.parseFloat(element.style.order);
  if (Number.isFinite(order)) return order;
  return Array.prototype.indexOf.call(
    element.parentElement?.children ?? [],
    element,
  );
}

function createCarouselCombatStepIndicator(step, position, order, dock) {
  const element = document.createElement("div");
  element.classList.add("separator", "ffxiv-carousel-combat-step-indicator");
  element.classList.add(`ffxiv-combat-step-${position}`);
  element.classList.add(dock?.isVertical ? "vertical" : "horizontal");
  element.dataset.step = String(step);
  element.setAttribute("role", "presentation");
  element.title = getCombatStepIndicatorLabel(step, position);
  element.style.order = String(order);
  return element;
}

function createCarouselCombatStepBoundary(previousStep, nextStep, order, dock) {
  const element = document.createElement("div");
  element.classList.add(
    "separator",
    "ffxiv-carousel-combat-step-indicator",
    "ffxiv-carousel-combat-step-boundary",
  );
  element.classList.add(dock?.isVertical ? "vertical" : "horizontal");
  element.dataset.previousStep = String(previousStep);
  element.dataset.nextStep = String(nextStep);
  element.style.setProperty(
    "--ffxiv-previous-step-color",
    getCarouselCombatStepColor(previousStep),
  );
  element.style.setProperty(
    "--ffxiv-next-step-color",
    getCarouselCombatStepColor(nextStep),
  );
  element.setAttribute("role", "presentation");
  element.title = `${getCombatStepIndicatorLabel(
    previousStep,
    "end",
  )} / ${getCombatStepIndicatorLabel(nextStep, "start")}`;
  element.style.order = String(order);
  return element;
}

function getCarouselCombatStepColor(step) {
  return step === 0 ? "#54ad24" : "#c12c2c";
}

function getCombatStepIndicatorLabel(step, position) {
  const stepLabel = step === 0
    ? game.i18n.localize("FFXIV.Combat.AdventurerStep")
    : game.i18n.localize("FFXIV.Combat.EnemyStep");
  return position === "start"
    ? stepLabel
    : game.i18n.format("FFXIV.Combat.StepEnd", { step: stepLabel });
}

function moveCarouselRoundSeparatorAfterStepEnd(container, order) {
  const separator = container.querySelector(
    ".separator:not(.ffxiv-carousel-combat-step-indicator)",
  );
  if (separator instanceof HTMLElement) {
    separator.style.order = String(order);
  }
}

export async function syncCombatantKnockedOutStatus(combatant) {
  const actor = combatant?.actor;
  if (!actor) return;

  const flagKey = "knockedOutFromDefeated";
  if (combatant.defeated) {
    if (!hasStatus(actor, "knocked_out")) {
      await applyStatusEffectChange(actor, "knocked_out", true);
      if (hasStatus(actor, "knocked_out")) {
        await combatant.setFlag("ffxiv", flagKey, true);
      }
    }
    return;
  }

  if (combatant.getFlag("ffxiv", flagKey) !== true) return;
  await combatant.unsetFlag("ffxiv", flagKey);
  if (hasStatus(actor, "knocked_out")) {
    await applyStatusEffectChange(actor, "knocked_out", false);
  }
}

function createCombatStepIndicator(step, position, combatantElement) {
  const tagName = combatantElement?.tagName === "LI" ? "li" : "div";
  const element = document.createElement(tagName);
  element.classList.add(
    "ffxiv-combat-step-indicator",
    `ffxiv-combat-step-${position}`,
  );
  element.dataset.step = String(step);
  element.setAttribute("role", "presentation");
  element.textContent = getCombatStepIndicatorLabel(step, position);
  return element;
}
