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

  const app = getActiveApp(event);
  if (!app) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (closingApp === app) return;
  closingApp = app;

  Promise.resolve(app.close())
    .catch(err => console.error("FFXIV | Failed to close active window with Escape", err))
    .finally(() => {
      if (closingApp === app) closingApp = null;
    });
}

function getActiveApp(event) {
  const apps = getOpenApps();
  if (!apps.length) return null;

  const targeted = getEventApp(event, apps);
  if (targeted) return targeted;

  if (activeApp && apps.includes(activeApp)) return activeApp;

  return apps
    .map(app => ({ app, element: getAppElement(app) }))
    .filter(({ element }) => element)
    .sort((a, b) => getZIndex(b.element) - getZIndex(a.element))[0]?.app ?? null;
}

function getEventApp(event, apps = getOpenApps()) {
  const target = event.composedPath?.().find(node => node instanceof HTMLElement) ?? event.target;
  if (!(target instanceof Node)) return null;

  return apps
    .map(app => ({ app, element: getAppElement(app) }))
    .filter(({ element }) => element?.contains(target))
    .sort((a, b) => getZIndex(b.element) - getZIndex(a.element))[0]?.app ?? null;
}

function getOpenApps() {
  const apps = [
    ...Object.values(ui.windows ?? {}),
    ...Array.from(foundry.applications.instances?.values?.() ?? []),
  ];

  return [...new Set(apps)].filter(app => {
    if (typeof app?.close !== "function") return false;
    const element = getAppElement(app);
    if (!element || !document.body.contains(element)) return false;
    return app.rendered ?? true;
  });
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
