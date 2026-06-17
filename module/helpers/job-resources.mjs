export function normalizeJobResourceName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getActorLevel(actor) {
  const value =
    actor?.system?.experience?.level?.value ??
    actor?.system?.level ??
    actor?.system?.level?.value;
  const level = Number.parseInt(value, 10);
  return Number.isFinite(level) ? level : 0;
}

export function findActorTrait(actor, name) {
  const key = normalizeJobResourceName(name);
  if (!actor || !key) return null;
  return actor.items?.find(
    (item) =>
      item?.type === "trait" &&
      normalizeJobResourceName(item.name) === key,
  ) ?? null;
}

export function findActorJobResource(actor, name) {
  const key = normalizeJobResourceName(name);
  if (!actor || !key) return null;
  const keys = new Set([
    key,
    ...getJobResourceAliases(key),
  ]);
  return actor.items?.find((item) => {
    if (item?.type !== "trait") return false;
    if (!keys.has(normalizeJobResourceName(item.name))) return false;
    const max = Number.parseInt(item.system?.job_resources_max, 10);
    return Number.isFinite(max) && max > 0;
  }) ?? null;
}

function getJobResourceAliases(key) {
  const aliases = {
    chakra: ["deep_meditation"],
    beast_chakra: ["enhanced_perfect_balance"],
    nadi: ["solar_and_lunar_mastery"],
  };
  return aliases[key] ?? [];
}

export function getJobResourceCount(item) {
  const max = Math.max(Number.parseInt(item?.system?.job_resources_max, 10) || 0, 0);
  const status = Array.isArray(item?.system?.job_resource_status)
    ? item.system.job_resource_status.slice(0, max)
    : [];
  while (status.length < max) status.push(false);
  return status.filter(Boolean).length;
}

export function getActorJobResourceCount(actor, name) {
  return getJobResourceCount(findActorJobResource(actor, name));
}

export async function setActorJobResourceCount(actor, name, count, options = {}) {
  const item = findActorJobResource(actor, name);
  if (!item) {
    return {
      changed: false,
      current: 0,
      next: 0,
      delta: 0,
      item: null,
    };
  }

  const max = Math.max(Number.parseInt(item.system?.job_resources_max, 10) || 0, 0);
  const current = getJobResourceCount(item);
  const next = Math.max(Math.min(Number.parseInt(count, 10) || 0, max), 0);
  if (next === current) {
    return {
      changed: false,
      current,
      next,
      delta: 0,
      item,
    };
  }

  await item.update(
    { "system.job_resource_status": Array.from({ length: max }, (_v, index) => index < next) },
    { render: options.render ?? false },
  );
  return {
    changed: true,
    current,
    next,
    delta: next - current,
    item,
  };
}

export async function applyActorJobResourceDelta(actor, name, delta, options = {}) {
  const item = findActorJobResource(actor, name);
  const current = getJobResourceCount(item);
  return setActorJobResourceCount(actor, name, current + delta, options);
}

export async function fillActorJobResource(actor, name, options = {}) {
  const item = findActorJobResource(actor, name);
  const max = Number.parseInt(item?.system?.job_resources_max, 10) || 0;
  return setActorJobResourceCount(actor, name, max, options);
}

export function hasActorJobResource(actor, name, amount = 1) {
  const count = getActorJobResourceCount(actor, name);
  return count >= Math.max(Number.parseInt(amount, 10) || 0, 0);
}
