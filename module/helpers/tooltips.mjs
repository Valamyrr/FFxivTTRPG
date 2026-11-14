export function addTooltipLockProgress(tooltip, onLock, { reverse = false, locked = false } = {}) {
  const progress = document.createElement("span");
  progress.className = "ffxiv-tooltip-lock-progress";
  progress.classList.toggle("closing", reverse);
  progress.classList.toggle("full", locked);
  progress.style.setProperty("--tooltip-progress-duration", reverse ? "500ms" : "1000ms");
  progress.setAttribute("aria-hidden", "true");
  progress.innerHTML = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" /></svg>';
  tooltip.append(progress);
  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    progress.remove();
    onLock();
  };
  const timer = locked ? null : setTimeout(finish, reverse ? 750 : 1000);
  if (reverse) {
    progress.addEventListener("animationend", (event) => {
      if (event.animationName === "ffxiv-tooltip-lock-fill") requestAnimationFrame(finish);
    });
  }
  return () => {
    completed = true;
    clearTimeout(timer);
    progress.remove();
  };
}

export function manageTooltipDismissal(tooltip, source, onDismiss) {
  const controller = new AbortController();
  let cancelProgress = null;
  let cancelIndicator = addTooltipLockProgress(tooltip, null, { locked: true });
  let pointerFrame = null;
  let pointerPosition = null;
  const cleanup = () => {
    if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
    pointerFrame = null;
    pointerPosition = null;
    cancelProgress?.();
    cancelIndicator?.();
    controller.abort();
  };
  const dismiss = () => {
    cleanup();
    onDismiss();
  };
  const updatePosition = () => {
    pointerFrame = null;
    const event = pointerPosition;
    if (!tooltip.isConnected || !source.isConnected) {
      dismiss();
      return;
    }
    const rects = [tooltip, source, ...document.querySelectorAll(".locked-tooltip")]
      .filter((element) => element.isConnected)
      .map((element) => element.getBoundingClientRect());
    const tooltipRect = rects[0];
    const sourceRect = rects[1];
    const left = Math.max(tooltipRect.left, sourceRect.left);
    const right = Math.min(tooltipRect.right, sourceRect.right);
    const top = Math.max(tooltipRect.top, sourceRect.top);
    const bottom = Math.min(tooltipRect.bottom, sourceRect.bottom);
    if (left <= right) {
      rects.push({
        left,
        right,
        top: Math.min(tooltipRect.bottom, sourceRect.bottom),
        bottom: Math.max(tooltipRect.top, sourceRect.top),
      });
    } else if (top <= bottom) {
      rects.push({
        left: Math.min(tooltipRect.right, sourceRect.right),
        right: Math.max(tooltipRect.left, sourceRect.left),
        top,
        bottom,
      });
    }
    const nearby = rects.some((rect) => event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom);
    if (nearby) {
      if (cancelProgress) {
        cancelProgress();
        cancelProgress = null;
        cancelIndicator = addTooltipLockProgress(tooltip, null, { locked: true });
      }
    } else if (!cancelProgress) {
      cancelIndicator?.();
      cancelIndicator = null;
      cancelProgress = addTooltipLockProgress(tooltip, dismiss, { reverse: true });
    }
  };
  document.addEventListener("pointermove", (event) => {
    pointerPosition = { clientX: event.clientX, clientY: event.clientY };
    if (pointerFrame !== null) return;
    pointerFrame = requestAnimationFrame(updatePosition);
  }, { passive: true, signal: controller.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismiss();
  }, { signal: controller.signal });
  tooltip.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    dismiss();
  }, { signal: controller.signal });
  window.addEventListener("blur", dismiss, { signal: controller.signal });
  return cleanup;
}

export function initEnrichedTooltips() {
  const tooltip = game.tooltip.tooltip;
  let cancelProgress = null;
  let source = null;
  const observer = new MutationObserver(() => {
    const element = game.tooltip.element;
    if (!tooltip.classList.contains("active")) {
      cancelProgress?.();
      cancelProgress = null;
      source = null;
      return;
    }
    if (element === source && tooltip.classList.contains("ffxiv-enriched-tooltip")) return;
    cancelProgress?.();
    cancelProgress = null;
    source = null;
    if (!tooltip.classList.contains("ffxiv-enriched-tooltip")) return;
    source = element;
    cancelProgress = addTooltipLockProgress(tooltip, () => {
      if (game.tooltip.element !== element || !element.matches(":hover")) return;
      const locked = game.tooltip.lockTooltip();
      locked.classList.add("ffxiv-locked-tooltip");
      game.tooltip.dismissLockedTooltip(locked);
      document.body.append(locked);
      locked.showPopover();
      manageTooltipDismissal(locked, element, () => locked.remove());
    });
  });
  observer.observe(tooltip, { attributes: true, attributeFilter: ["class"], childList: true });

  let pending = null;
  document.addEventListener("pointerover", async (event) => {
    const link = event.target.closest?.(".content-link[data-uuid]");
    if (!link || link.contains(event.relatedTarget) || link.classList.contains("broken")) return;
    const request = {};
    pending = request;
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (pending !== request || !link.isConnected || !link.matches(":hover")) return;
      const doc = await fromUuid(link.dataset.uuid);
      if (!doc || doc.visible === false) return;
      const description = doc.system?.description;
      const content = typeof description === "string" ? description : description?.value;
      if (!content) return;
      const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(content, {
        async: true,
        secrets: doc.isOwner,
        relativeTo: doc,
        rollData: doc.getRollData?.() ?? {},
      });
      if (pending !== request || !link.isConnected || !link.matches(":hover")) return;
      game.tooltip.activate(link, { html, direction: "UP", cssClass: "ffxiv-enriched-tooltip" });
    } catch (error) {
      console.error("FFXIV | Failed to create enriched tooltip", error);
    }
  });
}
