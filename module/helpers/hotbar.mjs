import { getAbilitySubtype } from "./ability-subtype.mjs";

const HOTBAR_STACK_CLASS = "ffxiv-hotbar-bars";
const EXTRA_BAR_CLASS = "ffxiv-extra-action-bar";
const HOTBAR_PAGES = [1, 2, 3, 4, 5];
const HOTBAR_COLLISION_OFFSCREEN_TOLERANCE = 60;
const HOTBAR_ABILITY_TOOLTIP_DELAY = 500;
let hotbarCollisionObserver = null;
let hotbarCollisionMutationObserver = null;
let hotbarCollisionObservedElements = new WeakSet();
let hotbarCollisionFrame = null;
let hotbarCollisionTarget = null;
let hotbarContextMenu = null;
let hotbarAbilityTooltip = null;
let hotbarAbilityTooltipTimer = null;
let hotbarAbilityTooltipSlot = null;
let suppressHotbarRender = false;
const HOTBAR_COLLISION_SELECTORS = [
  "#overflow",
  ".overflow",
  "div[id='overflow']",
  "div[class~='overflow']",
  "[data-application-part='overflow']",
  "input[placeholder*='message' i]",
  "textarea[placeholder*='message' i]",
  "[contenteditable='true']",
];
const HOTBAR_VISUAL_RECT_SELECTORS = [
  `.${HOTBAR_STACK_CLASS}`,
  "#action-bar",
  `.${EXTRA_BAR_CLASS}`,
  "#hotbar-page-controls",
  "#hotbar-controls-right",
  "#ffxiv-hotbar-actor-controls",
  ".slot",
  ".macro",
  "button",
  "a.control",
  ".control",
].join(",");
const HOTBAR_CONTROL_BUTTON_STYLE =
  "width: 22px; height: 22px; min-width: 22px; max-width: 22px; flex: 0 0 auto;";
const HOTBAR_KEYS = [
  { label: "1", code: "Digit1" },
  { label: "2", code: "Digit2" },
  { label: "3", code: "Digit3" },
  { label: "4", code: "Digit4" },
  { label: "5", code: "Digit5" },
  { label: "6", code: "Digit6" },
  { label: "7", code: "Digit7" },
  { label: "8", code: "Digit8" },
  { label: "9", code: "Digit9" },
  { label: "0", code: "Digit0" },
  { label: "-", code: "Minus" },
  { label: "=", code: "Equal" },
];

function getHotbarElement(app, html) {
  if (app?.id === "hotbar" && app?.element instanceof HTMLElement) {
    return app.element;
  }

  const root =
    html instanceof HTMLElement
      ? html
      : html?.[0] instanceof HTMLElement
        ? html[0]
        : app?.element instanceof HTMLElement
          ? app.element
          : app?.element?.[0] instanceof HTMLElement
            ? app.element[0]
            : null;

  if (root?.matches?.("#hotbar, .hotbar")) return root;
  return (
    root?.querySelector?.("#hotbar, .hotbar") ??
    document.querySelector("#hotbar, .hotbar")
  );
}

function actorUpdateAffectsHotbar(changes) {
  const keys = Object.keys(foundry.utils.flattenObject(changes ?? {}));
  if (!keys.length) return true;
  return keys.some((key) => (
    key === "name" ||
    key === "img" ||
    key.startsWith("flags.ffxiv.hotbar") ||
    key.startsWith("system.ability_order")
  ));
}

function itemUpdateAffectsHotbar(changes) {
  const keys = Object.keys(foundry.utils.flattenObject(changes ?? {}));
  if (!keys.length) return true;
  return keys.some((key) => (
    key === "name" ||
    key === "img" ||
    key === "type" ||
    key.startsWith("system.tags")
  ));
}

function getHotbarSlots(hotbar) {
  return Array.from(
    hotbar.querySelectorAll(
      "#action-bar .slot, .ffxiv-extra-action-bar .slot, #macro-list .macro, #macro-list li, .macro-list .macro, .macro-list li, .hotbar-page .macro, .hotbar-page li, .slot",
    ),
  );
}

function getPageNumber(hotbar, app) {
  const page = Number(app?.page);
  if (Number.isInteger(page) && page > 0) return page;

  const label = hotbar?.querySelector(".hotbar-page-number");
  const labelPage = Number(label?.textContent?.trim());
  return Number.isInteger(labelPage) && labelPage > 0 ? labelPage : 1;
}

function getHotbarCollisionElements(hotbar) {
  const elements = new Set();
  for (const selector of HOTBAR_COLLISION_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      const container =
        element.matches("input, textarea, [contenteditable='true']")
          ? (element.closest(".overflow, #overflow, [data-application-part='overflow']") ??
            element.closest("form, footer, .chat-form") ??
            element)
          : element;
      if (
        container === hotbar ||
        container.contains(hotbar) ||
        hotbar.contains(container)
      )
        continue;
      elements.add(container);
    }
  }
  return elements;
}

function getHotbarVisualRect(hotbar) {
  const rects = [hotbar.getBoundingClientRect()];

  for (const element of hotbar.querySelectorAll(HOTBAR_VISUAL_RECT_SELECTORS)) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;

    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) rects.push(rect);
  }

  return rects.reduce((bounds, rect) => ({
    left: Math.min(bounds.left, rect.left),
    top: Math.min(bounds.top, rect.top),
    right: Math.max(bounds.right, rect.right),
    bottom: Math.max(bounds.bottom, rect.bottom),
    width: Math.max(bounds.right, rect.right) - Math.min(bounds.left, rect.left),
    height: Math.max(bounds.bottom, rect.bottom) - Math.min(bounds.top, rect.top),
  }));
}

function getOverlappingPanelRects(hotbar) {
  const hotbarRect = getHotbarVisualRect(hotbar);
  const rects = [];

  for (const element of getHotbarCollisionElements(hotbar)) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (style.pointerEvents === "none" && style.opacity === "0") continue;

    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (rect.width < 120 || rect.width < rect.height * 1.5) continue;
    if (rect.bottom < hotbarRect.top || rect.top > hotbarRect.bottom) continue;
    if (rect.right < hotbarRect.left || rect.left > hotbarRect.right) continue;
    rects.push(rect);
  }

  return { hotbarRect, rects };
}

function updateHotbarCollisionOffset(hotbar) {
  hotbar.style.removeProperty("--ffxiv-hotbar-left");
  hotbar.style.removeProperty("--ffxiv-hotbar-bottom");

  const { hotbarRect, rects } = getOverlappingPanelRects(hotbar);
  if (!rects.length) {
    return;
  }

  const margin = 0;
  const viewportCenter = window.innerWidth / 2;
  const elementRect = hotbar.getBoundingClientRect();
  const visualCenterOffset =
    hotbarRect.left + hotbarRect.width / 2 -
    (elementRect.left + elementRect.width / 2);
  const width = hotbarRect.width;
  const halfWidth = width / 2;
  const minCenter =
    margin + halfWidth - visualCenterOffset - HOTBAR_COLLISION_OFFSCREEN_TOLERANCE;
  const maxCenter =
    window.innerWidth -
    margin -
    halfWidth -
    visualCenterOffset +
    HOTBAR_COLLISION_OFFSCREEN_TOLERANCE;
  const moveLeft = rects.some((rect) => rect.left + rect.width / 2 > viewportCenter);
  const edgeCenter = moveLeft ? minCenter : maxCenter;
  const candidates = new Set([viewportCenter]);

  for (const rect of rects) {
    candidates.add(rect.left - margin - halfWidth);
    candidates.add(rect.right + margin + halfWidth);
  }

  const scoreCandidate = (center) => {
    const clampedCenter = Math.min(Math.max(center, minCenter), maxCenter);
    const visualCenter = clampedCenter + visualCenterOffset;
    const left = visualCenter - halfWidth;
    const right = visualCenter + halfWidth;
    let overlap = 0;

    for (const rect of rects) {
      const overlapWidth = Math.max(
        0,
        Math.min(right, rect.right) - Math.max(left, rect.left),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(hotbarRect.bottom, rect.bottom) -
          Math.max(hotbarRect.top, rect.top),
      );
      overlap += overlapWidth * overlapHeight;
    }

    return {
      center: clampedCenter,
      overlap,
      distance: Math.abs(clampedCenter - viewportCenter),
    };
  };

  const current = scoreCandidate(viewportCenter);
  const best = Array.from(candidates)
    .map(scoreCandidate)
    .sort((a, b) => a.overlap - b.overlap || a.distance - b.distance)[0];

  if (!best || best.overlap >= current.overlap) return;
  const edge = scoreCandidate(edgeCenter);
  const center = edge.overlap <= best.overlap ? edge.center : best.center;
  hotbar.style.setProperty("--ffxiv-hotbar-left", `${Math.round(center)}px`);
}

function queueHotbarCollisionOffset(hotbar = getHotbarElement(ui.hotbar)) {
  if (!hotbar) return;
  hotbarCollisionTarget = hotbar;
  if (hotbarCollisionFrame) return;
  hotbarCollisionFrame = requestAnimationFrame(() => {
    const target = hotbarCollisionTarget;
    hotbarCollisionFrame = null;
    hotbarCollisionTarget = null;
    if (target) updateHotbarCollisionOffset(target);
  });
}

function isPointInRect(point, rect) {
  return (
    point.clientX >= rect.left &&
    point.clientX <= rect.right &&
    point.clientY >= rect.top &&
    point.clientY <= rect.bottom
  );
}

function updateHotbarHoverState(hotbar, event) {
  hotbar.classList.toggle(
    "ffxiv-hotbar-hover",
    isPointInRect(event, getHotbarVisualRect(hotbar)),
  );
}

function queueHotbarHoverState(hotbar, event) {
  hotbar._ffxivHotbarHoverPoint = {
    clientX: event.clientX,
    clientY: event.clientY,
  };
  if (hotbar._ffxivHotbarHoverFrame) return;

  hotbar._ffxivHotbarHoverFrame = requestAnimationFrame(() => {
    const point = hotbar._ffxivHotbarHoverPoint;
    hotbar._ffxivHotbarHoverFrame = null;
    hotbar._ffxivHotbarHoverPoint = null;
    if (point) updateHotbarHoverState(hotbar, point);
  });
}

function observeHotbarCollisionMutations() {
  if (hotbarCollisionMutationObserver || typeof MutationObserver !== "function")
    return;

  hotbarCollisionMutationObserver = new MutationObserver((mutations) => {
    const changedOutsideHotbar = mutations.some(
      (mutation) =>
        !mutation.target.closest?.("#hotbar") &&
        !mutation.target.closest?.(".ffxiv-hotbar-ability-tooltip") &&
        !Array.from(mutation.addedNodes).some((node) =>
          node instanceof Element &&
          node.matches(".ffxiv-hotbar-ability-tooltip")
        ) &&
        !Array.from(mutation.removedNodes).some((node) =>
          node instanceof Element &&
          node.matches(".ffxiv-hotbar-ability-tooltip")
        ) &&
        !mutation.target.closest?.(".ffxiv-window-dragging"),
    );
    if (!changedOutsideHotbar) return;
    observeHotbarCollisions();
    queueHotbarCollisionOffset();
  });
  hotbarCollisionMutationObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
    childList: true,
    subtree: true,
  });
}

function observeHotbarCollisions() {
  const hotbar = getHotbarElement(ui.hotbar);
  if (!hotbar) return;

  observeHotbarCollisionMutations();
  if (typeof ResizeObserver !== "function") return;

  if (!hotbarCollisionObserver) {
    hotbarCollisionObserver = new ResizeObserver(() => queueHotbarCollisionOffset());
    hotbarCollisionObservedElements = new WeakSet();
  }
  for (const element of getHotbarCollisionElements(hotbar)) {
    if (hotbarCollisionObservedElements.has(element)) continue;
    hotbarCollisionObserver.observe(element);
    hotbarCollisionObservedElements.add(element);
  }
}

function normalizePage(page) {
  return ((page - 1) % 5) + 1;
}

function getSelectedActor() {
  const token = canvas?.tokens?.controlled?.[0];
  return token?.actor ?? null;
}

function getActiveHotbarActor() {
  const actor = getSelectedActor();
  return actor?.isOwner ? actor : null;
}

function isActiveHotbarActor(actor) {
  const activeActor = getActiveHotbarActor();
  return Boolean(
    actor &&
    activeActor &&
    (
      actor === activeActor ||
      actor.uuid === activeActor.uuid ||
      actor.id === activeActor.id
    ),
  );
}

function itemBelongsToActiveHotbarActor(item) {
  return item?.parent?.documentName === "Actor" && isActiveHotbarActor(item.parent);
}

function getHotbarFlagDocument() {
  return getActiveHotbarActor() ?? game.user;
}

function getHotbarSettingsDocument() {
  return getActiveHotbarActor() ?? game.user;
}

function getHotbarFlagKey(document = getHotbarFlagDocument()) {
  return document?.documentName === "Actor" ? "hotbar" : "hotbarExtra";
}

function getVisibleHotbarsCount() {
  const document = getHotbarSettingsDocument();
  const settings = document.getFlag("ffxiv", "hotbarSettings") ?? {};
  const actorType = getActiveHotbarActor()?.type;
  const settingType = {
    character: "Character",
    npc: "Npc",
    pet: "Pet",
  }[actorType] ?? "User";
  const defaultVisibleHotbars = game.settings.get(
    "ffxiv",
    `defaultHotbarRows${settingType}`,
  );
  return settings.visibleHotbars ?? defaultVisibleHotbars;
}

async function setVisibleHotbarsCount(count) {
  const document = getHotbarSettingsDocument();
  const settings = document.getFlag("ffxiv", "hotbarSettings") ?? {};
  settings.visibleHotbars = Math.max(1, Math.min(5, count));
  await document.setFlag("ffxiv", "hotbarSettings", settings);
  refreshHotbar();
}

function getHotbarFlagStorageKey(slot) {
  let key = String(slot);
  while (key.startsWith("slot-slot-")) key = key.slice("slot-".length);
  if (key.startsWith("slot-")) return key;
  return `slot-${key.replaceAll(".", "-")}`;
}

function normalizeHotbarFlag(rawHotbar) {
  const normalized = {};
  if (!rawHotbar || typeof rawHotbar !== "object") return normalized;

  for (const [key, value] of Object.entries(rawHotbar)) {
    if (typeof value === "string") normalized[getHotbarFlagStorageKey(key)] = value;
    else if (value && typeof value === "object") {
      if (typeof value.type === "string") {
        normalized[getHotbarFlagStorageKey(key)] = foundry.utils.deepClone(value);
        continue;
      }

      for (const [subKey, subValue] of Object.entries(value)) {
        if (typeof subValue === "string")
          normalized[getHotbarFlagStorageKey(`${key}.${subKey}`)] = subValue;
        else if (subValue && typeof subValue === "object")
          normalized[getHotbarFlagStorageKey(`${key}.${subKey}`)] =
            foundry.utils.deepClone(subValue);
      }
    }
  }
  return normalized;
}

function refreshHotbar() {
  ui.hotbar?.render?.({ force: true });
  queueMicrotask(() => renderFFXIVHotbar(ui.hotbar));
  requestAnimationFrame(() => renderFFXIVHotbar(ui.hotbar));
}

function getHotbarFlag(
  document = getHotbarFlagDocument(),
  key = getHotbarFlagKey(document),
) {
  return normalizeHotbarFlag(
    foundry.utils.deepClone(
      document.getFlag("ffxiv", key) ?? {},
    ),
  );
}

async function setHotbarFlag(
  hotbar,
  document = getHotbarFlagDocument(),
  key = getHotbarFlagKey(document),
  { refresh = true, suppressRender = false } = {},
) {
  const value = normalizeHotbarFlag(hotbar);
  const wasSuppressingRender = suppressHotbarRender;
  suppressHotbarRender = suppressHotbarRender || suppressRender;
  try {
    await document.unsetFlag("ffxiv", key);
    if (Object.keys(value).length) await document.setFlag("ffxiv", key, value);
  } finally {
    suppressHotbarRender = wasSuppressingRender;
  }
  if (refresh) refreshHotbar();
}

function getExtraHotbar() {
  return getHotbarFlag();
}

function getMacroForSlot(slot, document = getHotbarFlagDocument(), forceFlag = false) {
  const isActor = document?.documentName === "Actor";
  if (!forceFlag && !isActor && !String(slot).includes("."))
    return game.macros.get(game.user.hotbar[slot]);

  const hotbar = getHotbarFlag(document);
  const macroRef = hotbar[getHotbarFlagStorageKey(slot)];
  return getMacroFromRef(macroRef);
}

function getMacroForSlotFromHotbar(slot, hotbar) {
  const macroRef = getMacroRefFromHotbarEntry(
    hotbar?.[getHotbarFlagStorageKey(slot)],
  );
  const macro = getMacroFromRef(macroRef);
  return macro;
}

function getMacroFromRef(ref) {
  if (!ref) return null;
  const value = String(ref);
  const direct = game.macros.get(value);
  if (direct) return direct;

  const uuid = value.startsWith("Macro.") ? value : `Macro.${value}`;
  if (typeof fromUuidSync === "function") {
    const macro = fromUuidSync(uuid);
    if (macro?.documentName === "Macro") return macro;
  }

  return (
    game.macros.find(
      (macro) => macro.id === value || macro.uuid === value || macro.uuid === uuid,
    ) ?? null
  );
}

function getMacroRef(macro) {
  return macro?.uuid ?? macro?.id ?? null;
}

function getDocumentFromUuidSync(uuid) {
  if (!uuid) return null;
  if (typeof fromUuidSync === "function") return fromUuidSync(uuid);
  if (typeof foundry.utils.fromUuidSync === "function")
    return foundry.utils.fromUuidSync(uuid);
  return null;
}

function getMacroRefFromHotbarEntry(entry) {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return null;
  if (entry.type !== "Macro") return null;
  return entry.uuid ?? entry.id ?? entry.macro ?? null;
}

function getItemFromHotbarEntry(entry) {
  if (!entry || typeof entry !== "object" || entry.type !== "Item") return null;
  const item = getDocumentFromUuidSync(entry.uuid);
  return item?.documentName === "Item" ? item : null;
}

function getActorItemFromHotbarEntry(entry, actor) {
  if (typeof entry !== "string" || actor?.documentName !== "Actor") return null;
  return actor.items.get(entry) ?? null;
}

function getItemForImportedSlot(slot, actor) {
  if (actor?.documentName !== "Actor") return null;
  const slotId = String(slot);
  let index;
  if (slotId.includes(".")) {
    const [page, key] = slotId.split(".").map(Number);
    if (!Number.isInteger(page) || !Number.isInteger(key)) return null;
    index = (page - 1) * HOTBAR_KEYS.length + key - 1;
  } else {
    const slotNumber = Number(slotId);
    if (!Number.isInteger(slotNumber) || slotNumber < 1) return null;
    const page = Math.floor((slotNumber - 1) / 10) + 1;
    const key = ((slotNumber - 1) % 10) + 1;
    index = (page - 1) * HOTBAR_KEYS.length + key - 1;
  }
  return getImportableActorItems(actor)[index] ?? null;
}

function getDocumentFromHotbarEntry(entry) {
  const macro = getMacroFromRef(getMacroRefFromHotbarEntry(entry));
  if (macro) return macro;
  return getItemFromHotbarEntry(entry);
}

function getDocumentParts(document) {
  return {
    macro: document?.documentName === "Macro" ? document : null,
    item: document?.documentName === "Item" ? document : null,
  };
}

function getSlotDisplay(document) {
  return {
    img: document?.img ?? null,
    tooltip: document?.name ?? null,
    ariaLabel: document?.name ?? game.i18n.localize("HOTBAR.Empty"),
  };
}

function getDocumentFromActorHotbarEntry(entry, slotId, actor, hotbar) {
  return (
    getItemFromHotbarEntry(entry) ??
    getActorItemFromHotbarEntry(entry, actor) ??
    getMacroForSlotFromHotbar(slotId, hotbar) ??
    (typeof entry === "string" ? getItemForImportedSlot(slotId, actor) : null)
  );
}

function getDocumentForSlot(
  slot,
  document = getHotbarFlagDocument(),
  forceFlag = false,
) {
  const isActor = document?.documentName === "Actor";
  if (!forceFlag && !isActor && !String(slot).includes(".")) {
    const hotbar = getHotbarFlag(document);
    const entry = hotbar[getHotbarFlagStorageKey(slot)];
    const documentEntry = getDocumentFromHotbarEntry(entry);
    if (documentEntry) return documentEntry;
    return game.macros.get(game.user.hotbar[slot]);
  }

  const hotbar = getHotbarFlag(document);
  const entry = hotbar[getHotbarFlagStorageKey(slot)];
  const documentEntry =
    getDocumentFromHotbarEntry(entry) ??
    getActorItemFromHotbarEntry(entry, document) ??
    getMacroForSlotFromHotbar(slot, hotbar) ??
    (typeof entry === "string" ? getItemForImportedSlot(slot, document) : null);
  return documentEntry;
}

function getItemHotbarEntry(item) {
  return {
    type: "Item",
    uuid: item.uuid,
  };
}

function getDocumentHotbarEntry(document) {
  if (document?.documentName === "Macro") return getMacroRef(document);
  if (document?.documentName === "Item") return getItemHotbarEntry(document);
  return null;
}

function getItemDropUuid(data) {
  if (data?.type !== "Item") return null;
  return (
    data.uuid ||
    (data.actorId && data.itemId
      ? `Actor.${data.actorId}.Item.${data.itemId}`
      : null)
  );
}

async function assignMacroToSlot(
  slot,
  macro,
  document = getHotbarFlagDocument(),
  forceFlag = false,
  options = {},
) {
  const isActor = document?.documentName === "Actor";
  if (!forceFlag && !isActor && !String(slot).includes(".")) {
    const hotbar = getHotbarFlag(game.user, "hotbarExtra");
    delete hotbar[getHotbarFlagStorageKey(slot)];
    await setHotbarFlag(hotbar, game.user, "hotbarExtra");
    return game.user.assignHotbarMacro(macro, Number(slot), {
      fromSlot: options.fromSlot,
    });
  }

  const hotbar = getHotbarFlag(document);
  const storageKey = getHotbarFlagStorageKey(slot);
  if (macro) hotbar[storageKey] = getMacroRef(macro);
  else delete hotbar[storageKey];
  return setHotbarFlag(hotbar, document);
}

async function assignItemToSlot(
  slot,
  item,
  document = getHotbarFlagDocument(),
  forceFlag = false,
) {
  const isActor = document?.documentName === "Actor";
  if (!forceFlag && !isActor && !String(slot).includes(".")) {
    const hotbar = getHotbarFlag(game.user, "hotbarExtra");
    hotbar[getHotbarFlagStorageKey(slot)] = getItemHotbarEntry(item);
    await game.user.assignHotbarMacro(null, Number(slot));
    return setHotbarFlag(hotbar, game.user, "hotbarExtra");
  }

  const hotbar = getHotbarFlag(document);
  const storageKey = getHotbarFlagStorageKey(slot);
  if (item) hotbar[storageKey] = getItemHotbarEntry(item);
  else delete hotbar[storageKey];
  return setHotbarFlag(hotbar, document);
}

function getUserHotbarEntry(slot, extraHotbar, coreHotbar) {
  const storageKey = getHotbarFlagStorageKey(slot);
  if (Object.hasOwn(extraHotbar, storageKey)) return extraHotbar[storageKey];
  if (!String(slot).includes(".")) return coreHotbar[slot];
  return null;
}

function setUserHotbarEntry(slot, entry, extraHotbar, coreHotbar) {
  const storageKey = getHotbarFlagStorageKey(slot);
  const isCoreSlot = !String(slot).includes(".");
  delete extraHotbar[storageKey];
  if (isCoreSlot) delete coreHotbar[slot];
  if (!entry) return;

  const macroRef =
    typeof entry === "string" ? entry : getMacroRefFromHotbarEntry(entry);
  const macro = getMacroFromRef(macroRef);
  if (isCoreSlot && macro) coreHotbar[slot] = macro.id;
  else extraHotbar[storageKey] = entry;
}

async function moveDocumentBetweenHotbarSlots(
  targetSlot,
  sourceSlot,
  slotDocument,
  document = getHotbarFlagDocument(),
  forceFlag = false,
) {
  const sourceKey = getHotbarFlagStorageKey(sourceSlot);
  const targetKey = getHotbarFlagStorageKey(targetSlot);
  const fallbackEntry = getDocumentHotbarEntry(slotDocument);

  if (document?.documentName === "Actor") {
    const hotbar = getHotbarFlag(document);
    const sourceEntry = hotbar[sourceKey] ?? fallbackEntry;
    const targetEntry = hotbar[targetKey];
    hotbar[targetKey] = sourceEntry;
    if (targetEntry) hotbar[sourceKey] = targetEntry;
    else delete hotbar[sourceKey];
    await setHotbarFlag(hotbar, document, getHotbarFlagKey(document), {
      refresh: false,
      suppressRender: true,
    });
  } else {
    const extraHotbar = getHotbarFlag(game.user, "hotbarExtra");
    const coreHotbar = foundry.utils.deepClone(game.user.hotbar);
    const sourceEntry =
      getUserHotbarEntry(sourceSlot, extraHotbar, coreHotbar) ?? fallbackEntry;
    const targetEntry = getUserHotbarEntry(targetSlot, extraHotbar, coreHotbar);
    setUserHotbarEntry(targetSlot, sourceEntry, extraHotbar, coreHotbar);
    setUserHotbarEntry(sourceSlot, targetEntry, extraHotbar, coreHotbar);
    await setHotbarFlag(extraHotbar, game.user, "hotbarExtra", {
      refresh: false,
      suppressRender: true,
    });
    await game.user.update(
      { hotbar: coreHotbar },
      { recursive: false, diff: false, noHook: true },
    );
  }

  updateRenderedHotbarSlots([targetSlot, sourceSlot], document, forceFlag);
}

function confirmClearHotbar() {
  return foundry.applications.api.DialogV2.confirm({
    window: {
      title: "HOTBAR.ACTIONS.Clear",
      icon: "fa-solid fa-trash",
    },
    content: game.i18n.localize("HOTBAR.ClearConfirm"),
    modal: true,
  });
}

async function clearActorHotbar(actor) {
  const proceed = await confirmClearHotbar();
  if (!proceed) return;
  await setHotbarFlag({}, actor, "hotbar");
}

async function clearUserHotbar() {
  const proceed = await confirmClearHotbar();
  if (!proceed) return;
  await game.user.update({ hotbar: {} }, { recursive: false, diff: false, noHook: true });
  await setHotbarFlag({}, game.user, "hotbarExtra");
}

function closeHotbarContextMenu() {
  hotbarContextMenu?.element?.remove();
  hotbarContextMenu = null;
}

function positionHotbarContextMenu(menu, event) {
  const margin = 8;
  const width = menu.offsetWidth || 160;
  const height = menu.offsetHeight || 40;
  const left = Math.min(event.clientX, window.innerWidth - width - margin);
  const top = Math.min(event.clientY, window.innerHeight - height - margin);
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
}

function createHotbarContextButton(label, className, callback, fallback = null) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ffxiv-hotbar-context-option ${className}`.trim();
  const text = game.i18n.localize(label);
  button.textContent = text === label && fallback ? fallback : text;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeHotbarContextMenu();
    await callback();
  });
  return button;
}

function renderMacroSheet(macro, options = {}) {
  return macro.sheet?.render?.({ force: true, ...options });
}

function renderDocumentSheet(document) {
  return document.sheet?.render?.({ force: true });
}

async function addMacroForSlot(slotId, hotbarDocument, forceFlag) {
  if (!forceFlag && hotbarDocument?.documentName !== "Actor" && !String(slotId).includes(".")) {
    await openMacroSheetForSlot(slotId);
    return;
  }

  const cls = CONFIG.Macro.documentClass;
  const macro = await cls.create({
    name: cls.defaultName({ type: "chat" }),
    type: "chat",
    scope: "global",
  });
  await assignMacroToSlot(slotId, macro, hotbarDocument, forceFlag);
  renderMacroSheet(macro);
}

function armHotbarContextMenuClose() {
  setTimeout(() => {
    document.addEventListener("click", closeHotbarContextMenu, { once: true });
    document.addEventListener("contextmenu", closeHotbarContextMenu, { once: true });
    document.addEventListener("keydown", closeHotbarContextMenu, { once: true });
  }, 0);
}

function showHotbarContextMenu(event, slot, hotbarDocument, forceFlag) {
  const slotId = slot?.dataset?.slot;
  if (!slotId || !hotbarDocument) return;

  closeHotbarContextMenu();
  const menu = document.createElement("div");
  menu.className = "ffxiv-hotbar-context-menu";

  const slotDocument = getDocumentForSlot(slotId, hotbarDocument, forceFlag);
  const macro =
    slotDocument?.documentName === "Macro"
      ? slotDocument
      : getMacroForSlot(slotId, hotbarDocument, forceFlag);
  const item = slotDocument?.documentName === "Item" ? slotDocument : null;

  if (!slotDocument) {
    menu.append(
      createHotbarContextButton("MACRO.Create", "", () =>
        addMacroForSlot(slotId, hotbarDocument, forceFlag),
        "Add",
      ),
    );
  }

  if (macro?.isOwner) {
    menu.append(
      createHotbarContextButton("MACRO.Edit", "", () => {
        const currentSlotDocument = getDocumentForSlot(slotId, hotbarDocument, forceFlag);
        const currentMacro =
          currentSlotDocument?.documentName === "Macro"
            ? currentSlotDocument
            : getMacroForSlot(slotId, hotbarDocument, forceFlag);
        if (currentMacro?.isOwner) renderMacroSheet(currentMacro);
      }),
    );
  }

  if (item) {
    menu.append(
      createHotbarContextButton("SHEET.View", "", () => {
        const currentSlotDocument = getDocumentForSlot(slotId, hotbarDocument, forceFlag);
        const currentItem = currentSlotDocument?.documentName === "Item" ? currentSlotDocument : null;
        if (currentItem) renderDocumentSheet(currentItem);
      }, "View"),
    );
  }

  menu.append(
    createHotbarContextButton("MACRO.Remove", "", () =>
      assignMacroToSlot(slotId, null, hotbarDocument, forceFlag),
    ),
  );

  if (macro?.isOwner) {
    menu.append(
      createHotbarContextButton("MACRO.Delete", "delete", async () => {
        const currentSlotDocument = getDocumentForSlot(slotId, hotbarDocument, forceFlag);
        const currentMacro =
          currentSlotDocument?.documentName === "Macro"
            ? currentSlotDocument
            : getMacroForSlot(slotId, hotbarDocument, forceFlag);
        if (currentMacro?.isOwner) {
          await currentMacro.deleteDialog();
          await assignMacroToSlot(slotId, null, hotbarDocument, forceFlag);
        }
      }),
    );
  }

  document.body.append(menu);
  positionHotbarContextMenu(menu, event);
  hotbarContextMenu = { element: menu };
  armHotbarContextMenuClose();
}

function showActorHotbarContextMenu(event, slot, actor) {
  showHotbarContextMenu(event, slot, actor, true);
}

function showUserHotbarContextMenu(event, slot) {
  showHotbarContextMenu(event, slot, game.user, false);
}

function getImportableActorItems(actor) {
  const order = actor.system?.ability_order ?? {};
  const sortByAbilityOrder = (items, type) => {
    if (!Array.isArray(order[type])) return items;
    const positions = new Map(order[type].map((id, index) => [id, index]));
    return items.slice().sort((a, b) => {
      const indexA = positions.get(a._id) ?? 9999;
      const indexB = positions.get(b._id) ?? 9999;
      return indexA - indexB;
    });
  };
  const bySubtype = (type) =>
    actor.items.filter((item) => getAbilitySubtype(item) === type);

  return [
    ...sortByAbilityOrder(bySubtype("primary_ability"), "primary_ability"),
    ...sortByAbilityOrder(bySubtype("secondary_ability"), "secondary_ability"),
    ...sortByAbilityOrder(bySubtype("instant_ability"), "instant_ability"),
    ...bySubtype("limit_break").reverse(),
  ];
}

function getPreferredImportPage(item) {
  const subtype = getAbilitySubtype(item);
  if (subtype === "primary_ability") return 1;
  if (subtype === "secondary_ability") return 2;
  if (subtype === "instant_ability") return 3;
  return null;
}

function getFirstOpenImportSlot(
  occupied,
  pages = [{ page: 1 }, { page: 2 }, { page: 3 }],
) {
  for (const { page, reverse = false } of pages) {
    const keyIndexes = [...HOTBAR_KEYS.keys()];
    if (reverse) keyIndexes.reverse();

    for (const keyIndex of keyIndexes) {
      const slot = getSlotForPageKey(page, keyIndex);
      const storageKey = getHotbarFlagStorageKey(slot);
      if (!occupied.has(storageKey))
        return { slot, storageKey, page };
    }
  }
  return null;
}

function getImportOverflowPages(page) {
  const pages = [];
  for (let currentPage = page - 1; currentPage >= 1; currentPage--) {
    pages.push({ page: currentPage, reverse: true });
  }
  for (let currentPage = page + 1; currentPage <= 3; currentPage++) {
    pages.push({ page: currentPage });
  }
  return pages;
}

function buildImportedActorHotbar(items) {
  const hotbar = {};
  const occupied = new Set();
  const pending = [];
  let requiredRows = 1;

  const placeItem = (item, pages) => {
    const slot = getFirstOpenImportSlot(occupied, pages);
    if (!slot) return false;

    occupied.add(slot.storageKey);
    hotbar[slot.storageKey] = getItemHotbarEntry(item);
    requiredRows = Math.max(requiredRows, slot.page);
    return true;
  };

  for (const item of items) {
    const preferredPage = getPreferredImportPage(item);
    if (!preferredPage || !placeItem(item, [{ page: preferredPage }])) {
      pending.push({ item, preferredPage });
    }
  }

  for (const { item, preferredPage } of pending) {
    placeItem(
      item,
      preferredPage ? getImportOverflowPages(preferredPage) : undefined,
    );
  }

  return { hotbar, requiredRows };
}

async function importSelectedActorHotbar(actor = getActiveHotbarActor()) {
  if (!actor) {
    ui.notifications.warn("No owned actor is selected for hotbar import.");
    return 0;
  }

  const hotbar = {};
  const items = getImportableActorItems(actor).slice(0, 36);
  if (!items.length) {
    ui.notifications.warn(`${actor.name} has no actions to import.`);
    return 0;
  }

  const importedHotbar = buildImportedActorHotbar(items);
  Object.assign(hotbar, importedHotbar.hotbar);
  const imported = Object.keys(hotbar).length;

  if (!imported) {
    ui.notifications.warn(`No actions could be imported for ${actor.name}.`);
    return 0;
  }

  await setHotbarFlag(hotbar, actor, "hotbar");
  if (importedHotbar.requiredRows > getVisibleHotbarsCount()) {
    await setVisibleHotbarsCount(importedHotbar.requiredRows);
  }
  return imported;
}

function createSlot(slot) {
  const slotDocument = slot.document ?? slot.macro ?? slot.item ?? null;
  const li = document.createElement("li");
  li.className = `slot ffxiv-hotbar-slot ${slotDocument ? "full" : "open"}`;
  li.role = "button";
  li.draggable = !!slotDocument;
  li.dataset.slot = String(slot.slot);
  if (slot.macroId) li.dataset.macroId = slot.macroId;
  if (slot.macro) li.dataset.macroId = getMacroRef(slot.macro);
  if (slot.item) li.dataset.itemUuid = slot.item.uuid;
  if (slotDocument) {
    li.dataset.documentUuid = slotDocument.uuid;
    li.dataset.documentType = slotDocument.documentName;
  }
  if (Number.isInteger(slot.keyIndex)) li.dataset.keyIndex = String(slot.keyIndex);
  if (slot.hotbarPage) li.dataset.hotbarPage = String(slot.hotbarPage);
  if (slot.extraKey) li.dataset.extraKey = slot.extraKey;
  if (slot.actorId) li.dataset.actorId = slot.actorId;
  if (slot.actorUuid) li.dataset.actorUuid = slot.actorUuid;
  li.style.cssText = slot.style ?? "";
  li.setAttribute("aria-label", slot.ariaLabel ?? slotDocument?.name ?? "Empty");
  const isAbility =
    slotDocument?.documentName === "Item" &&
    (slotDocument.type === "ability" || !!getAbilitySubtype(slotDocument));
  if (slot.tooltip && !isAbility) li.dataset.tooltipText = slot.tooltip;

  if (slot.img) {
    const frame = document.createElement("span");
    frame.className = "slot-icon-frame";
    const img = document.createElement("img");
    img.className = "slot-icon";
    img.src = slot.img;
    img.alt = slot.ariaLabel ?? slotDocument?.name ?? "";
    frame.append(img);
    li.append(frame);
  }

  const key = document.createElement("span");
  key.className = "key";
  key.textContent = String(slot.key);
  li.append(key);
  return li;
}

function createSlotData(base, slotDocument) {
  return {
    ...base,
    ...getDocumentParts(slotDocument),
    document: slotDocument,
    ...getSlotDisplay(slotDocument),
  };
}

function getAbilityForTooltip(slot) {
  const actor = getActorForSlot(slot);
  const item =
    getDocumentFromUuidSync(slot.dataset.documentUuid) ??
    getDocumentForSlot(slot.dataset.slot, actor ?? getHotbarFlagDocument(), !!actor);
  const subtype = getAbilitySubtype(item);
  return item?.documentName === "Item" &&
    (item.type === "ability" || !!subtype)
    ? item
    : null;
}

function createAbilityTooltip(item) {
  const tooltip = document.createElement("aside");
  tooltip.className = "ffxiv-hotbar-ability-tooltip";
  tooltip.setAttribute("role", "tooltip");

  const header = document.createElement("div");
  header.className = "ffxiv-hotbar-ability-header";

  const img = document.createElement("img");
  img.src = item.img;
  img.alt = "";
  header.append(img);

  const heading = document.createElement("div");
  const name = document.createElement("div");
  name.className = "ffxiv-hotbar-ability-name";
  name.textContent = item.name;
  heading.append(name);

  const subtype = document.createElement("div");
  subtype.className = "ffxiv-hotbar-ability-type";
  const subtypeKey = {
    primary_ability: "FFXIV.Tags.Primary",
    secondary_ability: "FFXIV.Tags.Secondary",
    instant_ability: "FFXIV.Tags.Instant",
    limit_break: "FFXIV.ItemType.limit_break",
  }[getAbilitySubtype(item)] ?? "FFXIV.ItemType.ability";
  const subtypeLabel = game.i18n.localize(subtypeKey);
  const tags = (Array.isArray(item.system.tags) ? item.system.tags : [])
    .map((tag) => game.i18n.localize(tag))
    .filter((tag) => tag.toLocaleLowerCase() !== subtypeLabel.toLocaleLowerCase());
  subtype.textContent = [subtypeLabel, ...tags].join(" · ");
  heading.append(subtype);
  header.append(heading);
  tooltip.append(header);

  const details = [
    [game.i18n.localize("FFXIV.Abilities.Range"), item.system.range],
    [game.i18n.localize("FFXIV.Abilities.Target"), item.system.target],
    [game.i18n.localize("FFXIV.Abilities.Cost"), item.system.cost],
    ["CR", item.system.challenge],
  ].filter(([, value]) => value !== "" && value !== null && value !== undefined);

  if (details.length) {
    const grid = document.createElement("dl");
    grid.className = "ffxiv-hotbar-ability-details";
    for (const [label, value] of details) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      grid.append(dt, dd);
    }
    tooltip.append(grid);
  }

  const overview = [
    [game.i18n.localize("FFXIV.Abilities.BaseEffect"), item.system.base_effect],
    [game.i18n.localize("FFXIV.Abilities.DirectHit"), item.system.direct_hit],
    [null, item.system.description],
  ].filter(([, content]) => content);
  if (overview.length) {
    const body = document.createElement("div");
    body.className = "ffxiv-hotbar-ability-overview";
    for (const [index, [label, content]] of overview.entries()) {
      if (index) body.append(document.createElement("hr"));
      const section = document.createElement("div");
      section.className = "ffxiv-hotbar-ability-section";
      if (label) {
        const heading = document.createElement("strong");
        heading.className = "ffxiv-hotbar-ability-section-label";
        heading.textContent = label;
        section.append(heading);
      }
      const text = document.createElement("div");
      text.className = "ffxiv-hotbar-ability-section-content";
      text.innerHTML = content;
      section.append(text);
      body.append(section);
    }
    tooltip.append(body);
  }

  return tooltip;
}

function positionAbilityTooltip(tooltip, slot) {
  const slotRect = slot.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const margin = 10;
  const left = Math.min(
    Math.max(margin, slotRect.left + slotRect.width / 2 - tooltipRect.width / 2),
    window.innerWidth - tooltipRect.width - margin,
  );
  const top = slotRect.top - tooltipRect.height - margin >= margin
    ? slotRect.top - tooltipRect.height - margin
    : slotRect.bottom + margin;
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function hideAbilityTooltip() {
  clearTimeout(hotbarAbilityTooltipTimer);
  hotbarAbilityTooltipTimer = null;
  hotbarAbilityTooltipSlot = null;
  document.body.classList.remove("ffxiv-hotbar-tooltip-visible");
  hotbarAbilityTooltip?.remove();
  hotbarAbilityTooltip = null;
}

function queueAbilityTooltip(slot) {
  hideAbilityTooltip();
  const item = getAbilityForTooltip(slot);
  if (!item) return;

  hotbarAbilityTooltipSlot = slot;
  hotbarAbilityTooltip = createAbilityTooltip(item);
  document.body.append(hotbarAbilityTooltip);
  positionAbilityTooltip(hotbarAbilityTooltip, slot);
  hotbarAbilityTooltipTimer = setTimeout(() => {
    if (!slot.isConnected || hotbarAbilityTooltipSlot !== slot) return;
    hotbarAbilityTooltipTimer = null;
    game.tooltip?.deactivate?.();
    document.body.classList.add("ffxiv-hotbar-tooltip-visible");
    hotbarAbilityTooltip?.classList.add("visible");
  }, HOTBAR_ABILITY_TOOLTIP_DELAY);
}

function getPageSlots(page, actorHotbar = null) {
  const actor = getActiveHotbarActor();
  if (!actor) {
    const slots = game.user.getHotbarMacros(page).map((slot, index) => {
      const slotDocument =
        getDocumentForSlot(slot.slot, game.user, true) ??
        slot.macro;
      return createSlotData({
        ...slot,
        hotbarPage: page,
        keyIndex: index,
        key: HOTBAR_KEYS[index].label,
      }, slotDocument);
    });

    for (const index of [10, 11]) {
      const extraKey = `${page}.${index + 1}`;
      const slotDocument = getDocumentForSlot(extraKey, game.user, true);
      slots.push(createSlotData({
        slot: extraKey,
        extraKey,
        hotbarPage: page,
        keyIndex: index,
        key: HOTBAR_KEYS[index].label,
      }, slotDocument));
    }
    return slots;
  }

  const slots = [];
  for (const index of HOTBAR_KEYS.keys()) {
    const slotId = getSlotForPageKey(page, index);
    const storageKey = getHotbarFlagStorageKey(slotId);
    const entry = actorHotbar?.[storageKey] ?? null;
    const slotDocument = getDocumentFromActorHotbarEntry(
      entry,
      slotId,
      actor,
      actorHotbar,
    );
    slots.push(createSlotData({
      slot: slotId,
      extraKey: String(slotId).includes(".") ? slotId : null,
      macroId: getMacroRefFromHotbarEntry(entry),
      hotbarPage: page,
      keyIndex: index,
      key: HOTBAR_KEYS[index].label,
      actorId: actor.id,
      actorUuid: actor.uuid,
    }, slotDocument));
  }
  return slots;
}

function renderExtraBar(page) {
  const menu = document.createElement("menu");
  menu.className = `${EXTRA_BAR_CLASS} flexrow`;
  menu.dataset.hotbarPage = String(page);
  menu.dataset.tooltipDirection = "UP";
  const actor = getActiveHotbarActor();
  const actorHotbar = actor ? getHotbarFlag(actor, "hotbar") : null;
  for (const slot of getPageSlots(page, actorHotbar)) menu.append(createSlot(slot));
  return menu;
}

function renderExtensionSlot(page, index) {
  const extraKey = `${page}.${index + 1}`;
  const slotDocument = getDocumentForSlot(extraKey, getHotbarFlagDocument(), true);
  const slot = createSlot(createSlotData({
    slot: extraKey,
    extraKey,
    hotbarPage: page,
    keyIndex: index,
    key: HOTBAR_KEYS[index].label,
  }, slotDocument));
  slot.classList.add("ffxiv-extension-slot");
  return slot;
}

function getSlotSelector(slot) {
  const slotId = String(slot);
  const escapedSlot = globalThis.CSS?.escape
    ? globalThis.CSS.escape(slotId)
    : slotId.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `[data-slot="${escapedSlot}"]`;
}

function getSlotDataFromElement(slot, hotbarDocument, forceFlag) {
  const slotId = slot.dataset.slot;
  const keyIndex = Number(slot.dataset.keyIndex);
  const hotbarPage = Number(slot.dataset.hotbarPage);
  const slotDocument = getDocumentForSlot(slotId, hotbarDocument, forceFlag);
  return createSlotData({
    slot: slotId,
    extraKey: slot.dataset.extraKey ?? (slotId.includes(".") ? slotId : null),
    macroId: slot.dataset.macroId,
    hotbarPage: Number.isInteger(hotbarPage) ? hotbarPage : null,
    keyIndex: Number.isInteger(keyIndex) ? keyIndex : null,
    key: HOTBAR_KEYS[keyIndex]?.label ?? "",
    actorId: slot.dataset.actorId,
    actorUuid: slot.dataset.actorUuid,
    style: slot.style.cssText,
  }, slotDocument);
}

function updateRenderedHotbarSlot(slot, hotbarDocument, forceFlag) {
  const hotbar = getHotbarElement(ui.hotbar);
  if (!hotbar) return;

  for (const currentSlot of hotbar.querySelectorAll(getSlotSelector(slot))) {
    if (
      !currentSlot.closest(`.${EXTRA_BAR_CLASS}`) &&
      !currentSlot.matches(
        ".ffxiv-actor-slot, .ffxiv-user-slot, .ffxiv-extension-slot",
      )
    )
      continue;

    const nextSlot = createSlot(
      getSlotDataFromElement(currentSlot, hotbarDocument, forceFlag),
    );
    if (currentSlot.classList.contains("ffxiv-actor-slot"))
      nextSlot.classList.add("ffxiv-actor-slot");
    if (currentSlot.classList.contains("ffxiv-user-slot"))
      nextSlot.classList.add("ffxiv-user-slot");
    if (currentSlot.classList.contains("ffxiv-extension-slot"))
      nextSlot.classList.add("ffxiv-extension-slot");
    currentSlot.replaceWith(nextSlot);
  }
}

function updateRenderedHotbarSlots(slots, hotbarDocument, forceFlag) {
  for (const slot of slots) updateRenderedHotbarSlot(slot, hotbarDocument, forceFlag);
  const hotbar = getHotbarElement(ui.hotbar);
  if (hotbar) {
    updateHotbarSlotLabels(hotbar, ui.hotbar);
    queueHotbarCollisionOffset(hotbar);
  }
}

function updateExtensionSlots(actionBar, page) {
  actionBar
    .querySelectorAll(".ffxiv-extension-slot")
    .forEach((slot) => slot.remove());
  for (const index of [10, 11]) actionBar.append(renderExtensionSlot(page, index));
}

function hideNativePrimarySlots(actionBar) {
  for (const slot of actionBar.querySelectorAll(":scope > .slot")) {
    slot.hidden = true;
  }
}

function removeRenderedPrimarySlots(actionBar) {
  actionBar
    .querySelectorAll(".ffxiv-actor-slot, .ffxiv-user-slot")
    .forEach((slot) => slot.remove());
}

function updatePrimarySlots(actionBar, page) {
  hideNativePrimarySlots(actionBar);
  removeRenderedPrimarySlots(actionBar);

  const actor = getActiveHotbarActor();
  if (!actor) {
    for (const slot of getPageSlots(page)) {
      const element = createSlot(slot);
      element.classList.add("ffxiv-user-slot");
      actionBar.append(element);
    }
    return;
  }

  const actorHotbar = getHotbarFlag(actor, "hotbar");
  for (const slot of getPageSlots(page, actorHotbar)) {
    const element = createSlot(slot);
    element.classList.add("ffxiv-actor-slot");
    actionBar.append(element);
  }
}

function getCyclePage(current, direction) {
  const currentIndex = HOTBAR_PAGES.includes(current)
    ? HOTBAR_PAGES.indexOf(current)
    : 0;
  const step = Math.sign(Number(direction) || 1);
  const nextIndex =
    (currentIndex + step + HOTBAR_PAGES.length) % HOTBAR_PAGES.length;
  return HOTBAR_PAGES[nextIndex];
}

function getSlotForPageKey(page, keyIndex) {
  if (keyIndex < 10) return (page - 1) * 10 + keyIndex + 1;
  return `${page}.${keyIndex + 1}`;
}

function isHotbarPageVisible(page) {
  const hotbar = getHotbarElement(ui.hotbar);
  if (page === getPageNumber(hotbar, ui.hotbar)) return true;

  const visibleCount = getVisibleHotbarsCount();
  return HOTBAR_PAGES.slice(1, visibleCount).includes(page);
}

function executePageKey(page, keyIndex) {
  if (!isHotbarPageVisible(page)) return false;
  executeSlot(getSlotForPageKey(page, keyIndex));
  return true;
}

function executeCyclingPageKey(keyIndex) {
  const hotbar = getHotbarElement(ui.hotbar);
  executePageKey(getPageNumber(hotbar, ui.hotbar), keyIndex);
  return true;
}

function executeActorCyclingPageKey(keyIndex) {
  if (!getActiveHotbarActor()) return false;
  return executeCyclingPageKey(keyIndex);
}

function getBinding(namespace, action) {
  try {
    return game.keybindings.get(namespace, action)?.[0] ?? null;
  } catch (_error) {
    return null;
  }
}

function getBindingForSlot(page, keyIndex, primary = false, actor = false) {
  if (actor && primary) {
    const binding = `slot${keyIndex + 1}`;
    return getBinding(
      "ffxiv",
      keyIndex < 10 ? `executeActorHotbar1${binding}` : `executeHotbar1${binding}`,
    );
  }

  if (primary && keyIndex < 10) {
    const number = HOTBAR_KEYS[keyIndex].label;
    return getBinding("core", `executeMacro${number}`);
  }

  const hotbar = primary ? 1 : page;
  const binding = `slot${keyIndex + 1}`;
  return getBinding("ffxiv", `executeHotbar${hotbar}${binding}`);
}

function getModifierLabel(modifier) {
  const modifiers = foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS;
  if (modifier === modifiers.SHIFT) return "▲";
  if (modifier === modifiers.CONTROL) return "C";
  if (modifier === modifiers.ALT) return "A";
  return "";
}

function getKeyLabel(binding, fallback) {
  const KeyboardManager = foundry.helpers.interaction.KeyboardManager;
  return binding?.key
    ? KeyboardManager.getKeycodeDisplayString(binding.key)
    : fallback;
}

function setKeyLabel(label, binding, fallback) {
  const modifierText = (binding?.modifiers ?? [])
    .map(getModifierLabel)
    .filter(Boolean)
    .join("");
  const keyText = getKeyLabel(binding, fallback);

  label.replaceChildren();
  if (modifierText) {
    const modifier = document.createElement("span");
    modifier.className = "modifier";
    modifier.textContent = modifierText;
    label.append(modifier);
  }

  const key = document.createElement("span");
  key.className = "binding";
  key.textContent = keyText;
  label.append(key);
}

function updateHotbarStack(hotbar, app) {
  const actionBar = hotbar.querySelector(":scope > #action-bar, #action-bar");
  if (!actionBar) return;
  const actor = getActiveHotbarActor();
  const visibleCount = getVisibleHotbarsCount();
  const leftControls = hotbar.querySelector("#hotbar-controls-left");
  const rightControls = hotbar.querySelector("#hotbar-controls-right");
  const pageControls = hotbar.querySelector("#hotbar-page-controls");

  let stack = hotbar.querySelector(`:scope > .${HOTBAR_STACK_CLASS}`);
  if (!stack) {
    stack = document.createElement("div");
    stack.className = HOTBAR_STACK_CLASS;
    actionBar.before(stack);
  }

  if (actionBar.parentElement !== stack) stack.append(actionBar);
  actionBar.classList.add("ffxiv-primary-action-bar");
  const currentPage = getPageNumber(hotbar, app);
  actionBar.dataset.hotbarPage = String(currentPage);
  hotbar.classList.toggle("ffxiv-actor-hotbar-active", !!actor);
  hotbar.classList.remove("ffxiv-hotbar-compact");

  if (actor) {
    hotbar.dataset.actorId = actor.id;
    hotbar.dataset.actorUuid = actor.uuid;
  } else {
    delete hotbar.dataset.actorId;
    delete hotbar.dataset.actorUuid;
  }
  for (const [index, slot] of Array.from(
    actionBar.querySelectorAll(":scope > .slot:not(.ffxiv-extension-slot)"),
  ).entries()) {
    slot.dataset.hotbarPage = String(currentPage);
    slot.dataset.keyIndex = String(index);
  }
  updatePrimarySlots(actionBar, currentPage);
  if (pageControls && pageControls.parentElement !== hotbar)
    hotbar.insertBefore(pageControls, stack);
  if (leftControls && rightControls && leftControls.parentElement !== rightControls)
    rightControls.append(leftControls);
  stack.querySelectorAll(`.${EXTRA_BAR_CLASS}`).forEach((bar) => bar.remove());

  const pagesToShow = HOTBAR_PAGES.slice(1, visibleCount).reverse();
  for (const page of pagesToShow) {
    stack.insertBefore(renderExtraBar(normalizePage(page)), actionBar);
  }
}

function updateHotbarSlotLabels(hotbar, app) {
  const currentPage = getPageNumber(hotbar, app);
  const actor = !!getActiveHotbarActor();
  for (const [index, slot] of getHotbarSlots(hotbar).entries()) {
    slot.classList.add("ffxiv-hotbar-slot");

    const keyIndex = Number(slot.dataset.keyIndex ?? (index % HOTBAR_KEYS.length));
    const page = Number(slot.dataset.hotbarPage ?? currentPage);
    const primary = !!slot.closest("#action-bar");
    let label = slot.querySelector(".key, .slot-key, .hotbar-key");
    if (!label) {
      label = document.createElement("span");
      label.className = "key";
      slot.append(label);
    }

    const binding = getBindingForSlot(page, keyIndex, primary, actor);
    const fallback = !primary && page >= 4 ? "" : HOTBAR_KEYS[keyIndex]?.label ?? "";
    setKeyLabel(label, binding, fallback);
  }
}

function updateHotbarControls(hotbar) {
  const pageControls = hotbar.querySelector("#hotbar-page-controls");
  if (!pageControls) return;

  const visibleCount = getVisibleHotbarsCount();
  const actor = getActiveHotbarActor();

  const allButtons = Array.from(pageControls.querySelectorAll("button"));
  let pageUpButton = allButtons.find(b => b.dataset.direction === "up");
  let pageDownButton = allButtons.find(b => b.dataset.direction === "down");

  pageControls.replaceChildren();

  const leftGrid = document.createElement("div");
  leftGrid.className = "ffxiv-hotbar-grid-controls";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "ui-control fa-solid fa-plus icon";
  addButton.dataset.action = "ffxiv-add-hotbar";
  addButton.dataset.tooltip = "Add hotbar";
  addButton.setAttribute("aria-label", "Add hotbar");
  addButton.disabled = visibleCount >= 5;
  addButton.style.cssText = HOTBAR_CONTROL_BUTTON_STYLE;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "ui-control fa-solid fa-minus icon";
  removeButton.dataset.action = "ffxiv-remove-hotbar";
  removeButton.dataset.tooltip = "Remove hotbar";
  removeButton.setAttribute("aria-label", "Remove hotbar");
  removeButton.disabled = visibleCount <= 1;
  removeButton.style.cssText = HOTBAR_CONTROL_BUTTON_STYLE;

  if (!pageUpButton) {
    pageUpButton = document.createElement("button");
    pageUpButton.type = "button";
    pageUpButton.className = "ui-control fa-solid fa-chevron-up icon";
    pageUpButton.dataset.tooltip = "Page Up";
    pageUpButton.setAttribute("aria-label", "Page Up");
  }
  pageUpButton.dataset.action = "page";
  pageUpButton.dataset.direction = "up";
  pageUpButton.style.cssText = HOTBAR_CONTROL_BUTTON_STYLE;

  if (!pageDownButton) {
    pageDownButton = document.createElement("button");
    pageDownButton.type = "button";
    pageDownButton.className = "ui-control fa-solid fa-chevron-down icon";
    pageDownButton.dataset.tooltip = "Page Down";
    pageDownButton.setAttribute("aria-label", "Page Down");
  }
  pageDownButton.dataset.action = "page";
  pageDownButton.dataset.direction = "down";
  pageDownButton.style.cssText = HOTBAR_CONTROL_BUTTON_STYLE;

  let importButton = null;
  if (actor) {
    importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "ui-control fa-solid fa-file-import icon ffxiv-hotbar-import-button";
    importButton.dataset.action = "ffxiv-import-actions";
    importButton.dataset.actorId = actor.id;
    importButton.dataset.actorUuid = actor.uuid;
    importButton.dataset.tooltip = "Import selected token actions";
    importButton.setAttribute("aria-label", "Import selected token actions");
    pageControls.append(importButton);
  }

  leftGrid.append(addButton);
  leftGrid.append(pageUpButton);
  leftGrid.append(removeButton);
  leftGrid.append(pageDownButton);
  pageControls.append(leftGrid);

  const clearButton = hotbar.querySelector(
    "[data-action='clear'], [data-action='ffxiv-clear-hotbar']",
  );
  if (clearButton) clearButton.dataset.action = actor ? "ffxiv-clear-hotbar" : "clear";

  const pageNumber = hotbar.querySelector(
    ".page-number, .hotbar-page-number, [data-page]",
  );
  const page = pageNumber?.textContent?.trim() || pageNumber?.dataset?.page;
  if (page) hotbar.dataset.page = page;

  for (const control of hotbar.querySelectorAll("#hotbar-page-controls button")) {
    delete control.dataset.tooltip;
    delete control.dataset.tooltipText;
    control.removeAttribute("data-tooltip");
    control.removeAttribute("data-tooltip-text");
    control.removeAttribute("title");
  }

  for (const control of hotbar.querySelectorAll("button, a, .control")) {
    if (control.closest("#hotbar-page-controls")) continue;
    const title =
      control.title || control.getAttribute("aria-label") || control.dataset.tooltip;
    if (title) control.dataset.tooltip = title;
  }

  const rightControls = hotbar.querySelector("#hotbar-controls-right");
  if (rightControls) {
    const buttons = Array.from(rightControls.querySelectorAll("button, a.control"));
    rightControls.replaceChildren();

    const rightGrid = document.createElement("div");
    rightGrid.className = "ffxiv-hotbar-grid-controls";

    const volumeButton = buttons.find(b => b.querySelector(".fa-volume-up, .fa-volume-mute, .fa-volume-high, .fa-volume-low"));
    const lockButton = buttons.find(b => b.querySelector(".fa-lock, .fa-lock-open"));
    const menuButton = buttons.find(b => b.querySelector(".fa-bars, .fa-grip-lines"));
    const clearButtonRight = buttons.find(b => b.querySelector(".fa-trash, .fa-trash-can"));

    if (volumeButton) {
      volumeButton.style.cssText = HOTBAR_CONTROL_BUTTON_STYLE;
      rightGrid.append(volumeButton);
    }
    if (lockButton) {
      lockButton.style.cssText = HOTBAR_CONTROL_BUTTON_STYLE;
      rightGrid.append(lockButton);
    }
    if (menuButton) {
      menuButton.style.cssText = HOTBAR_CONTROL_BUTTON_STYLE;
      rightGrid.append(menuButton);
    }
    if (clearButtonRight) {
      clearButtonRight.style.cssText = HOTBAR_CONTROL_BUTTON_STYLE;
      rightGrid.append(clearButtonRight);
    }

    rightControls.append(rightGrid);

    buttons.forEach(btn => {
      if (!volumeButton || !volumeButton.contains(btn)) {
        if (!lockButton || !lockButton.contains(btn)) {
          if (!menuButton || !menuButton.contains(btn)) {
            if (!clearButtonRight || !clearButtonRight.contains(btn)) {
              btn.style.cssText = HOTBAR_CONTROL_BUTTON_STYLE;
              rightGrid.append(btn);
            }
          }
        }
      }
    });
  }
}

function ensureCyclingPage(hotbar, app) {
  const currentPage = getPageNumber(hotbar, app);
  if (HOTBAR_PAGES.includes(currentPage)) return true;

  queueMicrotask(() => ui.hotbar?.changePage(HOTBAR_PAGES[0]));
  return false;
}

async function openMacroSheetForSlot(slot) {
  if (getActiveHotbarActor() || String(slot).includes(".")) return;

  const cls = CONFIG.Macro.documentClass;
  const macro = new cls({
    name: cls.defaultName({ type: "chat" }),
    type: "chat",
    scope: "global",
  });
  await macro.sheet.render({ force: true, hotbarSlot: slot });
}

async function executeSlot(
  slot,
  document = getHotbarFlagDocument(),
  forceFlag = false,
) {
  const slotDocument = getDocumentForSlot(slot, document, forceFlag);
  if (slotDocument?.documentName === "Macro") return slotDocument.execute();
  if (slotDocument?.documentName === "Item") return slotDocument.roll?.();
  if (forceFlag || document?.documentName === "Actor" || String(slot).includes("."))
    return;
  return openMacroSheetForSlot(slot);
}

function getExtraSlot(event) {
  return event.target.closest(
    `.${EXTRA_BAR_CLASS} .slot, .ffxiv-extension-slot, .ffxiv-actor-slot, .ffxiv-user-slot`,
  );
}

function getActorForSlot(slot) {
  const activeActor = getActiveHotbarActor();
  if (
    activeActor &&
    (slot?.classList?.contains("ffxiv-actor-slot") ||
      slot?.closest?.(".ffxiv-hotbar")?.classList?.contains("ffxiv-actor-hotbar-active"))
  )
    return activeActor;

  const uuidActor =
    slot?.dataset.actorUuid && typeof fromUuidSync === "function"
      ? fromUuidSync(slot.dataset.actorUuid)
      : null;
  const hotbar = slot?.closest?.(".ffxiv-hotbar");
  const actor =
    uuidActor ||
    (slot?.dataset.actorId && game.actors.get(slot.dataset.actorId)) ||
    (hotbar?.dataset.actorId && game.actors.get(hotbar.dataset.actorId)) ||
    activeActor;
  return actor?.isOwner ? actor : null;
}

function consumeHotbarEvent(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

async function handleClearHotbarClick(event) {
  const actor = getActiveHotbarActor();
  consumeHotbarEvent(event);
  try {
    if (actor) await clearActorHotbar(actor);
    else await clearUserHotbar();
  } catch (error) {
    console.error("FFXIV | Failed to clear hotbar:", error);
    ui.notifications.error("Failed to clear hotbar. See console for details.");
  }
}

async function handleImportHotbarClick(event, button) {
  consumeHotbarEvent(event);
  const actor = getActorForSlot(button);
  try {
    await importSelectedActorHotbar(actor?.isOwner ? actor : null);
  } catch (error) {
    console.error("FFXIV | Failed to import actor hotbar:", error);
    ui.notifications.error("Failed to import actor hotbar. See console for details.");
  }
}

async function handleAddHotbarClick(event) {
  consumeHotbarEvent(event);
  const currentCount = getVisibleHotbarsCount();
  if (currentCount >= 5) return;
  await setVisibleHotbarsCount(currentCount + 1);
}

async function handleRemoveHotbarClick(event) {
  consumeHotbarEvent(event);
  const currentCount = getVisibleHotbarsCount();
  if (currentCount <= 1) return;
  await setVisibleHotbarsCount(currentCount - 1);
}

function handlePageHotbarClick(event, pageControl, hotbar, app) {
  consumeHotbarEvent(event);
  const currentPage = getPageNumber(hotbar, app ?? ui.hotbar);
  ui.hotbar?.changePage(
    getCyclePage(currentPage, pageControl.dataset.direction),
  );
}

function handleSlotHotbarClick(event, slot) {
  consumeHotbarEvent(event);
  const actor = getActorForSlot(slot);
  const document = actor ?? getHotbarFlagDocument();
  const forceFlag =
    !!actor ||
    !!getDocumentForSlot(slot.dataset.slot, document, true);
  executeSlot(slot.dataset.slot, document, forceFlag);
}

async function handleHotbarClick(event, hotbar, app) {
  const clearButton = event.target.closest(
    "[data-action='clear'], [data-action='ffxiv-clear-hotbar']",
  );
  if (clearButton) return handleClearHotbarClick(event);

  const importButton = event.target.closest("[data-action='ffxiv-import-actions']");
  if (importButton) return handleImportHotbarClick(event, importButton);

  const addButton = event.target.closest("[data-action='ffxiv-add-hotbar']");
  if (addButton) return handleAddHotbarClick(event);

  const removeButton = event.target.closest("[data-action='ffxiv-remove-hotbar']");
  if (removeButton) return handleRemoveHotbarClick(event);

  const pageControl = event.target.closest("[data-action='page']");
  if (pageControl) return handlePageHotbarClick(event, pageControl, hotbar, app);

  const slot = getExtraSlot(event);
  if (slot) handleSlotHotbarClick(event, slot);
}

function handleHotbarContextMenu(event) {
  const slot = getExtraSlot(event);
  if (!slot) return;

  const actor = getActorForSlot(slot);
  consumeHotbarEvent(event);
  if (actor) showActorHotbarContextMenu(event, slot, actor);
  else showUserHotbarContextMenu(event, slot);
}

function handleHotbarDragStart(event) {
  const slot = getExtraSlot(event);
  if (!slot || !slot.classList.contains("full") || ui.hotbar?.locked) return;

  const actor = getActorForSlot(slot);
  const document = actor ?? getHotbarFlagDocument();
  const slotDocument =
    getDocumentForSlot(slot.dataset.slot, document, true) ??
    getDocumentForSlot(slot.dataset.slot, document, !!actor);
  if (!slotDocument) return;

  event.dataTransfer.setData(
    "text/plain",
    JSON.stringify(
      foundry.utils.mergeObject(slotDocument.toDragData(), {
        slot: slot.dataset.slot,
        ffxivHotbar: true,
        hotbarDocumentUuid: document.uuid,
      }),
    ),
  );
}

function handleHotbarDragOver(event) {
  const slot = getExtraSlot(event);
  if (!slot) return;
  event.preventDefault();
  slot.classList.add("drop-target");
}

async function handleMacroDrop(dropSlot, data, actor) {
  const macro = await CONFIG.Macro.documentClass.fromDropData(data);
  if (!macro) return;

  const document = actor ?? getHotbarFlagDocument();
  const sourceSlot = data.slot;
  const isMove =
    data.ffxivHotbar === true &&
    data.hotbarDocumentUuid === document.uuid &&
    sourceSlot !== undefined &&
    String(sourceSlot) !== String(dropSlot);

  if (isMove) {
    await moveDocumentBetweenHotbarSlots(
      dropSlot,
      sourceSlot,
      macro,
      document,
      !!actor,
    );
    return;
  }

  await assignMacroToSlot(dropSlot, macro, document, !!actor, {
    fromSlot: sourceSlot,
  });
}

async function handleItemDrop(dropSlot, data, actor) {
  const uuid = getItemDropUuid(data);
  if (!uuid) return;

  const item = await fromUuid(uuid);
  if (!item) return;

  const document = actor ?? getHotbarFlagDocument();
  const sourceSlot = data.slot;
  const isMove =
    data.ffxivHotbar === true &&
    data.hotbarDocumentUuid === document.uuid &&
    sourceSlot !== undefined &&
    String(sourceSlot) !== String(dropSlot);

  if (isMove) {
    await moveDocumentBetweenHotbarSlots(
      dropSlot,
      sourceSlot,
      item,
      document,
      !!actor,
    );
    return;
  }

  await assignItemToSlot(dropSlot, item, document, !!actor);
}

async function handleHotbarDrop(event) {
  const slot = getExtraSlot(event);
  if (!slot) return;

  consumeHotbarEvent(event);
  slot.classList.remove("drop-target");

  const actor = getActorForSlot(slot);
  const dropSlot =
    slot.dataset.extraKey ?? (actor ? slot.dataset.slot : Number(slot.dataset.slot));
  const data =
    foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  if (ui.hotbar?.locked) return;
  if (
    !actor &&
    !String(dropSlot).includes(".") &&
    Hooks.call("hotbarDrop", ui.hotbar, data, dropSlot) === false
  )
    return;

  if (data.type === "Macro") await handleMacroDrop(dropSlot, data, actor);
  else if (data.type === "Item") await handleItemDrop(dropSlot, data, actor);
}

function installExtraBarHandlers(hotbar, app) {
  hideAbilityTooltip();
  if (hotbar._ffxivHotbarHoverFrame) {
    cancelAnimationFrame(hotbar._ffxivHotbarHoverFrame);
    hotbar._ffxivHotbarHoverFrame = null;
  }
  hotbar._ffxivHotbarHoverPoint = null;
  hotbar._ffxivHotbarController?.abort?.();
  hotbar._ffxivHotbarController = new AbortController();
  const { signal } = hotbar._ffxivHotbarController;

  hotbar.addEventListener("click", (event) => {
    handleHotbarClick(event, hotbar, app);
  }, { capture: true, signal });

  hotbar.addEventListener("contextmenu", handleHotbarContextMenu, {
    capture: true,
    signal,
  });

  hotbar.addEventListener("pointerover", (event) => {
    const slot = getExtraSlot(event);
    slot?.classList.add("hover");
  }, { signal });

  hotbar.addEventListener("pointerout", (event) => {
    const slot = getExtraSlot(event);
    slot?.classList.remove("hover");
  }, { signal });

  for (const slot of getHotbarSlots(hotbar)) {
    slot.addEventListener("pointerenter", () => queueAbilityTooltip(slot), {
      signal,
    });
    slot.addEventListener("pointerleave", hideAbilityTooltip, { signal });
  }

  document.addEventListener("pointermove", (event) => {
    queueHotbarHoverState(hotbar, event);
  }, { passive: true, signal });

  window.addEventListener("blur", () => {
    hotbar.classList.remove("ffxiv-hotbar-hover");
    hideAbilityTooltip();
  }, { signal });

  hotbar.addEventListener("dragstart", handleHotbarDragStart, { signal });

  hotbar.addEventListener("dragover", handleHotbarDragOver, { signal });

  hotbar.addEventListener("dragleave", (event) => {
    getExtraSlot(event)?.classList.remove("drop-target");
  }, { signal });

  hotbar.addEventListener("drop", handleHotbarDrop, { capture: true, signal });
}

export function renderFFXIVHotbar(app, html) {
  const hotbar = getHotbarElement(app, html);
  if (!hotbar) return;

  hotbar.classList.add("ffxiv-hotbar");
  hotbar.classList.remove("ffxiv-hotbar-ready");
  if (!ensureCyclingPage(hotbar, app)) return;
  updateHotbarStack(hotbar, app);
  updateHotbarSlotLabels(hotbar, app);
  updateHotbarControls(hotbar);
  installExtraBarHandlers(hotbar, app);
  observeHotbarCollisions();
  queueHotbarCollisionOffset(hotbar);
  hotbar.classList.add("ffxiv-hotbar-ready");
}

export function initHotbar() {
  Hooks.on("renderHotbar", renderFFXIVHotbar);
  Hooks.on("renderApplicationV2", (app, html) => {
    if (app?.id === "hotbar") renderFFXIVHotbar(app, html);
    else {
      observeHotbarCollisions();
      queueHotbarCollisionOffset();
    }
  });
  Hooks.on("renderChatLog", () => {
    observeHotbarCollisions();
    queueHotbarCollisionOffset();
  });
  window.addEventListener("resize", () => queueHotbarCollisionOffset());
  window.addEventListener("mouseup", () => {
    observeHotbarCollisions();
    queueHotbarCollisionOffset();
  });
  Hooks.on("controlToken", () => renderFFXIVHotbar(ui.hotbar));
  Hooks.on("updateActor", (actor, changes) => {
    if (suppressHotbarRender) return;
    if (!actorUpdateAffectsHotbar(changes)) return;
    if (isActiveHotbarActor(actor)) renderFFXIVHotbar(ui.hotbar);
  });
  Hooks.on("createItem", (item) => {
    if (itemBelongsToActiveHotbarActor(item)) renderFFXIVHotbar(ui.hotbar);
  });
  Hooks.on("updateItem", (item, changes) => {
    if (!itemUpdateAffectsHotbar(changes)) return;
    if (itemBelongsToActiveHotbarActor(item)) renderFFXIVHotbar(ui.hotbar);
  });
  Hooks.on("deleteItem", (item) => {
    if (itemBelongsToActiveHotbarActor(item)) renderFFXIVHotbar(ui.hotbar);
  });
  Hooks.once("canvasReady", () => {
    renderFFXIVHotbar();
    ui.hotbar?.rendered && renderFFXIVHotbar(ui.hotbar);
  });
  renderFFXIVHotbar();
}

export function registerHotbarKeybindings() {
  const { SHIFT, CONTROL } =
    foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS;
  for (const [index, key] of HOTBAR_KEYS.entries()) {
    const binding = `slot${index + 1}`;
    game.keybindings.register("ffxiv", `executeActorHotbar1${binding}`, {
      name: `Selected Actor Hotbar 1: ${key.label}`,
      editable: index >= 10 ? [] : [{ key: key.code }],
      onDown: () => executeActorCyclingPageKey(index),
      precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
    });

    if (index >= 10)
      game.keybindings.register("ffxiv", `executeHotbar1${binding}`, {
        name: `Hotbar 1: ${key.label}`,
        editable: [{ key: key.code }],
        onDown: () => executeCyclingPageKey(index),
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
      });

    game.keybindings.register("ffxiv", `executeHotbar2${binding}`, {
      name: `Hotbar 2: ${key.label}`,
      editable: [{ key: key.code, modifiers: [CONTROL] }],
      onDown: () => executePageKey(2, index),
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    });

    game.keybindings.register("ffxiv", `executeHotbar3${binding}`, {
      name: `Hotbar 3: ${key.label}`,
      editable: [{ key: key.code, modifiers: [SHIFT] }],
      onDown: () => executePageKey(3, index),
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    });
  }
}
