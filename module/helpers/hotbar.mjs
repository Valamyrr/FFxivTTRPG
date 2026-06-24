import { getAbilitySubtype } from "./ability-subtype.mjs";

const HOTBAR_CLASS = "ffxiv-hotbar";
const HOTBAR_STACK_CLASS = "ffxiv-hotbar-bars";
const EXTRA_BAR_CLASS = "ffxiv-extra-action-bar";
const ACTOR_CONTROLS_ID = "ffxiv-hotbar-actor-controls";
const IMPORT_ACTION = "ffxiv-import-actions";
const CLEAR_ACTION = "clear";
const ACTOR_CLEAR_ACTION = "ffxiv-clear-hotbar";
const FIXED_HOTBAR_PAGES = [3, 2];
const CYCLE_HOTBAR_PAGES = [1, 4, 5];
const HOTBAR_COLLISION_OFFSCREEN_TOLERANCE = 60;
let hotbarCollisionObserver = null;
let hotbarCollisionMutationObserver = null;
let hotbarContextMenu = null;
let suppressHotbarRender = false;
const HOTBAR_DEBUG = true;
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
  const selectors = [
    `.${HOTBAR_STACK_CLASS}`,
    "#action-bar",
    `.${EXTRA_BAR_CLASS}`,
    "#hotbar-page-controls",
    "#hotbar-controls-right",
    `#${ACTOR_CONTROLS_ID}`,
    ".slot",
    ".macro",
    "button",
    "a.control",
    ".control",
  ];

  for (const element of hotbar.querySelectorAll(selectors.join(","))) {
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
  requestAnimationFrame(() => updateHotbarCollisionOffset(hotbar));
}

function observeHotbarCollisionMutations() {
  if (hotbarCollisionMutationObserver || typeof MutationObserver !== "function")
    return;

  hotbarCollisionMutationObserver = new MutationObserver((mutations) => {
    const changedOutsideHotbar = mutations.some(
      (mutation) => !mutation.target.closest?.("#hotbar"),
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

  hotbarCollisionObserver ??= new ResizeObserver(() => queueHotbarCollisionOffset());
  for (const element of getHotbarCollisionElements(hotbar))
    hotbarCollisionObserver.observe(element);
}

function normalizePage(page) {
  return ((page - 1) % 5) + 1;
}

function debugHotbar(message, data = null) {
  if (!HOTBAR_DEBUG) return;
  const style = "color: #7dd3fc; font-weight: 700;";
  if (data === null) console.debug(`%cFFXIV Hotbar | ${message}`, style);
  else console.debug(`%cFFXIV Hotbar | ${message}`, style, data);
}

function getSelectedActor() {
  const token = canvas?.tokens?.controlled?.[0];
  return token?.actor ?? null;
}

function getActiveHotbarActor() {
  const actor = getSelectedActor();
  return actor?.isOwner ? actor : null;
}

function getHotbarFlagDocument() {
  return getActiveHotbarActor() ?? game.user;
}

function getHotbarFlagKey(document = getHotbarFlagDocument()) {
  return document?.documentName === "Actor" ? "hotbar" : "hotbarExtra";
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
  debugHotbar("saving flag", { document: document?.uuid, key, value });
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
  if (macroRef && !macro) debugHotbar("macro ref not found", { slot, macroRef });
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
    (typeof entry === "string" ? getItemForImportedSlot(slotId, actor) : null) ??
    getMacroForSlotFromHotbar(slotId, hotbar)
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
    (typeof entry === "string" ? getItemForImportedSlot(slot, document) : null);
  if (entry && !documentEntry)
    debugHotbar("hotbar ref not found", { slot, entry });
  return documentEntry;
}

function getItemHotbarEntry(item) {
  return {
    type: "Item",
    uuid: item.uuid,
  };
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
  debugHotbar("assigning macro", {
    slot,
    macro: macro?.id ?? null,
    document: document?.uuid,
    isActor,
    forceFlag,
  });
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

async function moveItemBetweenHotbarSlots(
  targetSlot,
  sourceSlot,
  item,
  document = getHotbarFlagDocument(),
  forceFlag = false,
) {
  const hotbar = getHotbarFlag(document);
  hotbar[getHotbarFlagStorageKey(targetSlot)] = getItemHotbarEntry(item);
  delete hotbar[getHotbarFlagStorageKey(sourceSlot)];
  await setHotbarFlag(hotbar, document, getHotbarFlagKey(document), {
    refresh: false,
    suppressRender: true,
  });
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
      createHotbarContextButton("MACRO.Edit", "", () =>
        renderMacroSheet(macro),
        "Edit",
      ),
    );
  }

  if (item) {
    menu.append(
      createHotbarContextButton("DOCUMENT.View", "", () =>
        renderDocumentSheet(item),
        "View",
      ),
    );
  }

  menu.append(
    createHotbarContextButton("MACRO.Remove", "", () =>
      assignMacroToSlot(slotId, null, hotbarDocument, forceFlag),
    ),
  );

  if (macro?.isOwner) {
    menu.append(
      createHotbarContextButton("MACRO.Delete", "delete", () =>
        macro.deleteDialog(),
      ),
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
  if (subtype === "secondary_ability") return 2;
  if (subtype === "instant_ability") return 3;
  return null;
}

function getFirstOpenImportSlot(occupied, page = null) {
  const pages = page ? [page] : [1, 2, 3];
  for (const currentPage of pages) {
    for (const keyIndex of HOTBAR_KEYS.keys()) {
      const slot = getSlotForPageKey(currentPage, keyIndex);
      const storageKey = getHotbarFlagStorageKey(slot);
      if (!occupied.has(storageKey)) return { slot, storageKey };
    }
  }
  return null;
}

function buildImportedActorHotbar(items) {
  const hotbar = {};
  const occupied = new Set();
  const pending = [];

  const placeItem = (item, page = null) => {
    const slot = getFirstOpenImportSlot(occupied, page);
    if (!slot) return false;

    occupied.add(slot.storageKey);
    hotbar[slot.storageKey] = getItemHotbarEntry(item);
    return true;
  };

  for (const item of items) {
    const preferredPage = getPreferredImportPage(item);
    if (!preferredPage || !placeItem(item, preferredPage)) pending.push(item);
  }

  for (const item of pending) {
    placeItem(item);
  }

  return hotbar;
}

async function importSelectedActorHotbar(actor = getActiveHotbarActor()) {
  if (!actor) {
    ui.notifications.warn("No owned actor is selected for hotbar import.");
    return 0;
  }

  const hotbar = {};
  const items = getImportableActorItems(actor).slice(0, 36);
  debugHotbar("importing actor hotbar", {
    actor: actor.uuid,
    itemCount: items.length,
    itemTypes: items.map((item) => item.type),
  });
  if (!items.length) {
    ui.notifications.warn(`${actor.name} has no actions to import.`);
    return 0;
  }

  Object.assign(hotbar, buildImportedActorHotbar(items));
  const imported = Object.keys(hotbar).length;

  if (!imported) {
    ui.notifications.warn(`No actions could be imported for ${actor.name}.`);
    return 0;
  }

  await setHotbarFlag(hotbar, actor, "hotbar");
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
  if (slot.tooltip) li.dataset.tooltipText = slot.tooltip;

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
  debugHotbar("rendering extra bar", {
    actor: actor?.uuid ?? null,
    page,
    hotbar: actorHotbar,
  });
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
  debugHotbar("rendering actor slots", {
    actor: actor.uuid,
    page,
    hotbar: actorHotbar,
  });
  for (const slot of getPageSlots(page, actorHotbar)) {
    const element = createSlot(slot);
    element.classList.add("ffxiv-actor-slot");
    actionBar.append(element);
  }
}

function getCyclePage(current, direction) {
  const currentIndex = CYCLE_HOTBAR_PAGES.includes(current)
    ? CYCLE_HOTBAR_PAGES.indexOf(current)
    : 0;
  const step = Math.sign(Number(direction) || 1);
  const nextIndex =
    (currentIndex + step + CYCLE_HOTBAR_PAGES.length) % CYCLE_HOTBAR_PAGES.length;
  return CYCLE_HOTBAR_PAGES[nextIndex];
}

function getSlotForPageKey(page, keyIndex) {
  if (keyIndex < 10) return (page - 1) * 10 + keyIndex + 1;
  return `${page}.${keyIndex + 1}`;
}

function executePageKey(page, keyIndex) {
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
  if (!actionBar) {
    debugHotbar("action bar not found", { hotbar });
    return;
  }
  const actor = getActiveHotbarActor();
  debugHotbar("updating stack", {
    actor: actor?.uuid ?? null,
    appId: app?.id,
    page: getPageNumber(hotbar, app),
  });
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

  for (const page of FIXED_HOTBAR_PAGES) {
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
    setKeyLabel(label, binding, HOTBAR_KEYS[keyIndex]?.label ?? "");
  }
}

function updateHotbarControls(hotbar) {
  let actorControls = hotbar.querySelector(`#${ACTOR_CONTROLS_ID}`);
  if (!actorControls) {
    actorControls = document.createElement("div");
    actorControls.id = ACTOR_CONTROLS_ID;
    actorControls.className = "hotbar-controls flexcol";
    hotbar.prepend(actorControls);
  }

  actorControls.replaceChildren();
  const actor = getActiveHotbarActor();
  if (actor) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-control fa-solid fa-file-import icon";
    button.dataset.action = IMPORT_ACTION;
    button.dataset.actorId = actor.id;
    button.dataset.actorUuid = actor.uuid;
    button.dataset.tooltip = "Import selected token actions";
    button.setAttribute("aria-label", "Import selected token actions");
    actorControls.append(button);
  }

  const clearButton = hotbar.querySelector(
    `[data-action='${CLEAR_ACTION}'], [data-action='${ACTOR_CLEAR_ACTION}']`,
  );
  if (clearButton) clearButton.dataset.action = actor ? ACTOR_CLEAR_ACTION : CLEAR_ACTION;

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
}

function ensureCyclingPage(hotbar, app) {
  const currentPage = getPageNumber(hotbar, app);
  if (CYCLE_HOTBAR_PAGES.includes(currentPage)) return true;

  queueMicrotask(() => ui.hotbar?.changePage(CYCLE_HOTBAR_PAGES[0]));
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
      slot?.closest?.(`.${HOTBAR_CLASS}`)?.classList?.contains("ffxiv-actor-hotbar-active"))
  )
    return activeActor;

  const uuidActor =
    slot?.dataset.actorUuid && typeof fromUuidSync === "function"
      ? fromUuidSync(slot.dataset.actorUuid)
      : null;
  const hotbar = slot?.closest?.(`.${HOTBAR_CLASS}`);
  const actor =
    uuidActor ||
    (slot?.dataset.actorId && game.actors.get(slot.dataset.actorId)) ||
    (hotbar?.dataset.actorId && game.actors.get(hotbar.dataset.actorId)) ||
    activeActor;
  const resolved = actor?.isOwner ? actor : null;
  debugHotbar("resolved slot actor", {
    slot: slot?.dataset?.slot,
    slotActorUuid: slot?.dataset?.actorUuid,
    hotbarActorUuid: hotbar?.dataset?.actorUuid,
    activeActorUuid: activeActor?.uuid,
    resolvedActorUuid: resolved?.uuid,
  });
  return resolved;
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
    `[data-action='${CLEAR_ACTION}'], [data-action='${ACTOR_CLEAR_ACTION}']`,
  );
  if (clearButton) return handleClearHotbarClick(event);

  const importButton = event.target.closest(`[data-action='${IMPORT_ACTION}']`);
  if (importButton) return handleImportHotbarClick(event, importButton);

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

  if (actor || String(dropSlot).includes(".")) {
    await assignMacroToSlot(dropSlot, macro, actor ?? getHotbarFlagDocument(), !!actor);
    return;
  }

  await assignMacroToSlot(dropSlot, macro, game.user, false, {
    fromSlot: data.slot,
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
    sourceSlot !== undefined && String(sourceSlot) !== String(dropSlot);
  const isFlagOnlyMove =
    isMove &&
    (actor || (String(sourceSlot).includes(".") && String(dropSlot).includes(".")));

  if (isFlagOnlyMove) {
    await moveItemBetweenHotbarSlots(dropSlot, sourceSlot, item, document, !!actor);
    return;
  }

  await assignItemToSlot(dropSlot, item, document, !!actor);

  if (isMove && (actor || String(sourceSlot).includes("."))) {
    await assignItemToSlot(sourceSlot, null, document, !!actor);
  }
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
  debugHotbar("drop", {
    slot: slot.dataset.slot,
    dropSlot,
    actor: actor?.uuid ?? null,
    type: data?.type,
    data,
  });
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
    getExtraSlot(event)?.classList.add("hover");
  }, { signal });

  hotbar.addEventListener("pointerout", (event) => {
    getExtraSlot(event)?.classList.remove("hover");
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
  debugHotbar("render requested", {
    appId: app?.id,
    hasHotbar: !!hotbar,
    actor: getActiveHotbarActor()?.uuid ?? null,
  });
  if (!hotbar) return;

  hotbar.classList.add(HOTBAR_CLASS);
  if (!ensureCyclingPage(hotbar, app)) return;
  updateHotbarStack(hotbar, app);
  updateHotbarSlotLabels(hotbar, app);
  updateHotbarControls(hotbar);
  installExtraBarHandlers(hotbar, app);
  observeHotbarCollisions();
  queueHotbarCollisionOffset(hotbar);
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
  Hooks.on("updateActor", (actor) => {
    if (suppressHotbarRender) return;
    if (actor === getActiveHotbarActor()) renderFFXIVHotbar(ui.hotbar);
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
