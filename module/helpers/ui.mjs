export function getHookHTMLElement(html, app) {
  return html instanceof HTMLElement
    ? html
    : html?.[0] instanceof HTMLElement
      ? html[0]
      : html?.element instanceof HTMLElement
        ? html.element
        : html?.element?.[0] instanceof HTMLElement
          ? html.element[0]
          : app?.element instanceof HTMLElement
            ? app.element
            : app?.element?.[0] instanceof HTMLElement
              ? app.element[0]
              : null;
}

export function captureSheetScroll(sheet, selectors) {
  const root = sheet.element;
  if (!root) return;

  sheet._pendingSheetScrollPositions = selectors.flatMap((selector) => {
    const element = root.matches?.(selector) ? root : root.querySelector(selector);
    if (!element) return [];
    return [{
      selector,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
    }];
  });
}

export function restoreSheetScroll(sheet) {
  const positions = sheet._pendingSheetScrollPositions;
  if (!positions?.length) return;
  const restore = () => {
    for (const position of positions) {
      const root = sheet.element;
      const element = root?.matches?.(position.selector) ? root : root?.querySelector(position.selector);
      if (!element) continue;
      element.scrollTop = position.scrollTop;
      element.scrollLeft = position.scrollLeft;
    }
    if (sheet._pendingSheetScrollPositions === positions) {
      sheet._pendingSheetScrollPositions = null;
    }
  };

  requestAnimationFrame(() => {
    restore();
    setTimeout(() => {
      if (sheet._pendingSheetScrollPositions === positions) restore();
    }, 50);
  });
}

export function getFFXIVTheme() {
  if (game.settings.get("ffxiv", "overrideColorScheme")) return "blue";
  return (
    game.settings.get("core", "uiConfig").colorScheme.applications ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light")
  );
}

export function applyFFXIVChatTheme(element) {
  const chatElement = element instanceof HTMLElement ? element : element?.[0];
  if (!chatElement) return;

  const theme = getFFXIVTheme();
  chatElement.classList.add("chat-ffxiv", `${theme}_theme`);
}

const DEFAULT_SOUNDS = {
  soundNotificationFFXIV_moveItem:
    "systems/ffxiv/assets/sfx/ffxiv-obtain-item.ogg",
  soundNotificationFFXIV_enterChat:
    "systems/ffxiv/assets/sfx/ffxiv-full-party.ogg",
  soundNotificationFFXIV_openSheet:
    "systems/ffxiv/assets/sfx/ffxiv-switch-target.ogg",
  soundNotificationFFXIV_closeSheet:
    "systems/ffxiv/assets/sfx/ffxiv-untarget.ogg",
  soundNotificationFFXIV_enmity:
    "systems/ffxiv/assets/sfx/ffxiv-aggro.ogg",
};

export function playConfiguredSound(setting) {
  playInterfaceSound(settingOrDefault(setting, DEFAULT_SOUNDS));
}

export function settingOrDefault(setting, defaults) {
  const configured = game.settings.get("ffxiv", setting);
  const fallback = defaults[setting] || "";
  if (configured && fallback.endsWith(".ogg") && configured === fallback.replace(/\.ogg$/, ".mp3")) return fallback;
  return configured || fallback;
}

export function playInterfaceSound(src, { volume = 1, socketOptions } = {}) {
  if (!game.settings.get("ffxiv", "soundNotificationFFXIV") || !src) return;
  const data = {
    src,
    channel: "interface",
    volume,
    autoplay: true,
    loop: false,
  };
  if (socketOptions === undefined) foundry.audio.AudioHelper.play(data);
  else foundry.audio.AudioHelper.play(data, socketOptions);
}

export function createHotbarObserver(onChange) {
  let resizeObserver = null;
  let mutationObserver = null;
  let currentObservedHotbar = null;
  let hotbarTransitionListener = null;

  return function observeHotbar(hotbar) {
    if (!hotbar || typeof ResizeObserver === "undefined") return;
    if (currentObservedHotbar === hotbar) return;
    if (currentObservedHotbar && currentObservedHotbar !== hotbar) {
      if (hotbarTransitionListener) {
        currentObservedHotbar.removeEventListener("transitionend", hotbarTransitionListener, true);
        hotbarTransitionListener = null;
      }
    }
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => onChange());
    resizeObserver.observe(hotbar);
    mutationObserver = new MutationObserver(() => onChange());
    mutationObserver.observe(hotbar, { attributes: true, childList: true, subtree: true });
    hotbarTransitionListener = () => onChange();
    hotbar.addEventListener("transitionend", hotbarTransitionListener, true);
    currentObservedHotbar = hotbar;
  };
}
