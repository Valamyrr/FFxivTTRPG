const observers = new WeakMap();

function fitTitle(title) {
  if (!title.isConnected || !title.clientWidth) return;
  title.style.removeProperty("--compendium-title-size");
  const size = Number.parseFloat(getComputedStyle(title).fontSize);
  if (title.scrollWidth > title.clientWidth) {
    const fitted = Math.max(10, Math.floor(size * title.clientWidth / title.scrollWidth * 10) / 10);
    title.style.setProperty("--compendium-title-size", `${fitted}px`);
  }
}

export function registerCompactCompendiumSizing() {
  Hooks.on("renderCompendiumDirectory", app => {
    observers.get(app)?.disconnect();
    observers.delete(app);
    if (!document.body.classList.contains("ffxiv-compact-directories")) return;

    const titles = app.element.querySelectorAll(".compendium-name strong");
    const widths = new WeakMap();
    const observer = new ResizeObserver(entries => {
      for (const { target, contentRect } of entries) {
        if (widths.get(target) === contentRect.width) continue;
        widths.set(target, contentRect.width);
        fitTitle(target);
      }
    });
    observers.set(app, observer);
    for (const title of titles) {
      title.title = title.textContent.trim();
      observer.observe(title);
    }
    document.fonts.ready.then(() => {
      if (observers.get(app) === observer) titles.forEach(fitTitle);
    });
  });

  Hooks.on("closeCompendiumDirectory", app => {
    observers.get(app)?.disconnect();
    observers.delete(app);
  });
}
