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
  if (hasNativeAppPriority(event)) return;

  const app = getActiveApp(event);
  if (!app) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (closingApp === app) return;
  closingApp = app;

  Promise.resolve(app.close())
    .catch((err) =>
      console.error("FFXIV | Failed to close active window with Escape", err),
    )
    .finally(() => {
      if (closingApp === app) closingApp = null;
    });
}

function getActiveApp(event) {
  const apps = getOpenApps({ ffxivOnly: true });
  if (!apps.length) return null;

  const targeted = getEventApp(event, apps);
  if (targeted) return targeted;

  const topmost = getTopmostApp(apps);
  if (topmost) return topmost;

  if (activeApp && apps.includes(activeApp)) return activeApp;

  return null;
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

function getEventApp(event, apps = getOpenApps()) {
  const target =
    event.composedPath?.().find((node) => node instanceof HTMLElement) ??
    event.target;
  if (!(target instanceof Node)) return null;

  return (
    apps
      .map((app) => ({ app, element: getAppElement(app) }))
      .filter(({ element }) => element?.contains(target))
      .sort((a, b) => getZIndex(b.element) - getZIndex(a.element))[0]?.app ??
    null
  );
}

function getOpenApps({ ffxivOnly = false } = {}) {
  const apps = [
    ...Object.values(ui.windows ?? {}),
    ...Array.from(foundry.applications.instances?.values?.() ?? []),
  ];

  return [...new Set(apps)].filter((app) => {
    if (typeof app?.close !== "function") return false;
    const element = getAppElement(app);
    if (!element || !document.body.contains(element)) return false;
    if (ffxivOnly && !isFFXIVApp(app, element)) return false;
    return app.rendered ?? true;
  });
}

function hasNativeAppPriority(event) {
  const apps = getOpenApps({ ffxivOnly: false });
  if (!apps.length) return false;

  const topmost = getTopmostApp(apps);
  if (topmost) {
    const element = getAppElement(topmost);
    if (element && !isFFXIVApp(topmost, element)) return true;
  }

  const targeted = getEventApp(event, apps);
  if (!targeted) return false;
  const element = getAppElement(targeted);
  if (!element) return false;
  return !isFFXIVApp(targeted, element);
}

function isFFXIVApp(app, element) {
  if (element?.classList?.contains("ffxiv")) return true;
  if (typeof app?.id === "string" && app.id.startsWith("FFXIV")) return true;
  if (
    typeof app?.constructor?.name === "string" &&
    app.constructor.name.startsWith("FFXIV")
  )
    return true;
  return false;
}

function getAppElement(app) {
  if (app?.element instanceof HTMLElement) return app.element;
  if (app?.element?.[0] instanceof HTMLElement) return app.element[0];
  if (app?.id) {
    const byId = document.getElementById(app.id);
    if (byId) return byId;
  }
  if (Number.isFinite(app?.appId)) {
    return document.querySelector(`[data-appid="${app.appId}"]`);
  }
  return null;
}

function getZIndex(element) {
  const z = Number.parseInt(getComputedStyle(element).zIndex, 10);
  return Number.isFinite(z) ? z : 0;
}
