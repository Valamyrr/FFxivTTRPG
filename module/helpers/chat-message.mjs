export function createChatMessage(data) {
  return ChatMessage.create(data, {
    chatBubble: false,
    messageMode: game.settings.get("core", "messageMode"),
  });
}

export function maintainChatScroll(messageId, { roll = null } = {}) {
  const chatLogs = [ui.chat, ui.chat?.popout].filter((chat) => {
    const scroll = chat?.element?.querySelector(".chat-scroll");
    return scroll && (!roll || chat.element.contains(roll)) &&
      scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 10;
  });
  if (!chatLogs.length) return;
  requestAnimationFrame(() => {
    const animations = roll?.querySelector(".ffxiv-roll-details")?.getAnimations() ?? [];
    const controller = new AbortController();
    for (const chat of chatLogs) {
      const scroll = chat.element?.querySelector(".chat-scroll");
      if (!scroll) continue;
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
        scroll.addEventListener(event, () => controller.abort(), { signal: controller.signal, once: true, passive: true });
    }
    const follow = () => {
      if (controller.signal.aborted) return;
      for (const chat of chatLogs) {
        if (chat.element?.querySelector(`.chat-scroll .message[data-message-id="${messageId}"]`))
          chat.scrollBottom({ waitImages: !roll });
      }
      if (animations.some((animation) => animation.playState === "running" || animation.pending))
        requestAnimationFrame(follow);
      else controller.abort();
    };
    follow();
  });
}

export function prepareChatRolls(message, html) {
  const resolution = message?.getFlag("ffxiv", "damageResolution");
  if (resolution?.critical) {
    const marker = game.i18n.localize("FFXIV.Chat.AutoCriticalDamageFromHit");
    for (const heading of html.querySelectorAll(".ffxiv-ability-damage > div > strong")) {
      if (heading.textContent !== resolution.baseFlavor && heading.textContent !== resolution.directFlavor) continue;
      heading.textContent = `${heading.textContent.replace(/\s+\([^()]*\)$/, "")} (${marker})`;
    }
  }
  for (const roll of html.querySelectorAll(".dice-roll")) {
    const total = roll.querySelector(".dice-total");
    if (total?.style.color === "blue") {
      total.style.removeProperty("color");
      total.classList.add("critical");
    }
    if (roll.dataset.action !== "expandRoll") continue;
    const result = roll.querySelector(".dice-result");
    if (result && !result.querySelector(".ffxiv-roll-details")) {
      const details = document.createElement("div");
      details.className = "ffxiv-roll-details";
      const wrapper = document.createElement("div");
      wrapper.className = "wrapper";
      for (const element of result.querySelectorAll(":scope > .dice-formula, :scope > .dice-tooltip"))
        wrapper.append(element);
      details.append(wrapper);
      result.insertBefore(details, total);
    }
    roll.setAttribute("role", "button");
    roll.tabIndex = 0;
    roll.setAttribute("aria-expanded", String(roll.classList.contains("expanded")));
    roll.setAttribute("aria-label", game.i18n.format("FFXIV.Chat.RollDetails", { total: total?.textContent.trim() ?? "" }));
  }
  requestAnimationFrame(() => {
    if (!html.isConnected) return;
    for (const roll of html.querySelectorAll('.dice-roll[data-action="expandRoll"]'))
      roll.setAttribute("aria-expanded", String(roll.classList.contains("expanded")));
  });
}
