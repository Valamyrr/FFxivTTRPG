let registered = false;
let closingApp = null;
let activeApp = null;

export function registerEscapeHandler() {
  if (registered) return;
  window.addEventListener("pointerdown", onActivate, true);
  window.addEventListener("focusin", onActivate, true);
  window.addEventListener("keydown", onEscape, true);
  registered = true;
}

function onActivate(event) {
  activeApp = getEventApp(event) ?? activeApp;
}

function onEscape(event) {
  if (event.key !== "Escape") return;
  if (event.repeat) return;

  const apps = getOpenAppsSortedByZIndex();

  if (blurFocusedElement(event)) {
    consumeEvent(event);
    return;
  }

  if (closeContextMenu(event, apps)) {
    consumeEvent(event);
    return;
  }

  if (!apps.length) return;

  consumeEvent(event);
  closeTopmostApp(apps);
}

function getActiveApp(event, apps = getOpenAppsSortedByZIndex()) {
  const targeted = getEventApp(event, apps);
  if (targeted) return targeted;

  const topmost = getTopmostApp(apps);
  if (topmost) return topmost;

  if (activeApp && apps.includes(activeApp)) return activeApp;

  return null;
}

function blurFocusedElement(event) {
  const element = getFocusedElement(event);
  if (!element) return false;
  element.blur();
  return true;
}

function getFocusedElement(event) {
  const target =
    event.composedPath?.().find((node) => node instanceof HTMLElement) ??
    event.target;
  const focused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const element = focused && isFormField(focused) ? focused : target;
  if (!(element instanceof HTMLElement) || !isFormField(element)) return null;
  return element;
}

function isFormField(element) {
  if (element.isContentEditable) return true;
  return ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName);
}

function closeContextMenu(event, apps) {
  if (closeFoundryContextMenu(event, apps)) return true;

  const active = getActiveApp(event, apps);
  if (active && closeAppContextMenu(active)) return true;
  return apps.some((app) => app !== active && closeAppContextMenu(app));
}

function closeFoundryContextMenu(event, apps) {
  const element = getElement(ui.context?.element);
  if (!element) return false;
  if (!getContainingApp(element, apps)) return false;
  ui.context.close();
  return true;
}

function closeAppContextMenu(app) {
  if (typeof app?._closeInventoryContextMenu !== "function") return false;
  if (!app._inventoryContextMenu?.element) return false;
  app._closeInventoryContextMenu();
  return true;
}

function getTopmostApp(apps) {
  return (
    apps
      .map((app) => ({ app, element: getAppElement(app) }))
      .filter(({ element }) => element)
      .sort((a, b) => getZIndex(b.element) - getZIndex(a.element))[0]?.app ??
    null
  );
}

async function closeTopmostApp(apps) {
  while (apps.length) {
    const app = apps.pop();
    if (closingApp === app) return;
    closingApp = app;

    try {
      const closed = await app.close({ closeKey: true });
      if (closed || !isAppRendered(app)) return;
    } catch (err) {
      console.error("FFXIV | Failed to close active window with Escape", err);
      return;
    } finally {
      if (closingApp === app) closingApp = null;
    }
  }
}

function getEventApp(event, apps = getOpenAppsSortedByZIndex()) {
  const target =
    event.composedPath?.().find((node) => node instanceof HTMLElement) ??
    event.target;
  if (!(target instanceof Node)) return null;

  return getContainingApp(target, apps);
}

function getContainingApp(target, apps) {
  return (
    apps
      .map((app) => ({ app, element: getAppElement(app) }))
      .filter(({ element }) => element?.contains(target))
      .sort((a, b) => getZIndex(b.element) - getZIndex(a.element))[0]?.app ??
    null
  );
}

function getOpenAppsSortedByZIndex() {
  const windows = Object.values(ui.windows ?? {});
  const instances = Array.from(foundry.applications.instances?.values?.() ?? [])
    .filter((app) => app.hasFrame !== false);

  return [...new Set([...windows, ...instances])]
    .map((app) => ({ app, element: getAppElement(app) }))
    .filter(({ app, element }) => {
      if (typeof app?.close !== "function") return false;
      if (app.isEscapeable === false) return false;
      if (!element || !document.body.contains(element)) return false;
      if (!isAppRendered(app)) return false;
      return Number.isFinite(getZIndex(element));
    })
    .sort((a, b) => getZIndex(a.element) - getZIndex(b.element))
    .map(({ app }) => app);
}

function isAppRendered(app) {
  if (typeof app?.rendered === "boolean") return app.rendered;
  if (typeof app?._state === "number") {
    const states = foundry.applications.api.ApplicationV2.RENDER_STATES;
    return app._state >= states.RENDERED;
  }
  return true;
}

function getAppElement(app) {
  const element = getElement(app?.element);
  if (element) return element;
  if (app?.id) {
    const byId = document.getElementById(app.id);
    if (byId) return byId;
  }
  if (Number.isFinite(app?.appId)) {
    return document.querySelector(`[data-appid="${app.appId}"]`);
  }
  return null;
}

function getElement(element) {
  if (element instanceof HTMLElement) return element;
  if (element?.[0] instanceof HTMLElement) return element[0];
  return null;
}

function getZIndex(element) {
  const z = Number.parseInt(getComputedStyle(element).zIndex, 10);
  return Number.isFinite(z) ? z : 0;
}

function consumeEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}
