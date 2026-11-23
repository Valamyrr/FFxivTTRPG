export function getEffectStackCount(effect) {
  return Math.max(Number.parseInt(effect?.flags?.ffxiv?.stackCount, 10) || 1, 1);
}

export function getEffectStackKey(effect) {
  return String(effect?.flags?.ffxiv?.stacking?.key ?? "").trim();
}

export function getEffectiveStackedEffects(effects) {
  const resolved = [];
  const highest = new Map();
  for (const effect of effects) {
    if (!effect || effect.disabled || effect.active === false) continue;
    const key = getEffectStackKey(effect);
    if (!key || effect.flags.ffxiv.stacking.cumulative === true) {
      resolved.push(effect);
      continue;
    }
    if (!highest.has(key) || getEffectStackCount(effect) > getEffectStackCount(highest.get(key))) {
      highest.set(key, effect);
    }
  }
  return [...resolved, ...highest.values()];
}

export async function prepareCumulativeEffects(actor, docs) {
  const prepared = [];
  for (const doc of docs) {
    const key = getEffectStackKey(doc);
    if (!key || doc.flags.ffxiv.stacking.cumulative !== true) {
      prepared.push(doc);
      continue;
    }
    const existing = Array.from(actor.effects ?? []).filter((effect) =>
      getEffectStackKey(effect) === key && effect.flags?.ffxiv?.stacking?.cumulative === true,
    );
    const pending = prepared.filter((effect) => getEffectStackKey(effect) === key);
    const count = [...existing, ...pending, doc].reduce((total, effect) => total + getEffectStackCount(effect), 0);
    const caps = [...existing, ...pending, doc].map((effect) => Number(effect.flags?.ffxiv?.stacking?.max))
      .filter((max) => Number.isFinite(max) && max > 0);
    doc.flags.ffxiv.stackCount = Math.min(count, ...caps);
    const ids = existing.map((effect) => effect.id).filter(Boolean);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
    for (const effect of pending) prepared.splice(prepared.indexOf(effect), 1);
    prepared.push(doc);
  }
  return prepared;
}
