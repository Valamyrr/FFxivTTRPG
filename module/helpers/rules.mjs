import { RULE_PAGE_TYPE } from "../journal/rule-page.mjs";
import { emitToActiveGM, getActiveGM } from "./socket.mjs";

export const RULE_SOCKET_TYPE = "ffxivRules";

const NO_MATCH = /(?!)/gu;
const TOOLTIP_DELAY = 500;
const REQUEST_TIMEOUT = 5000;

const isRulePage = (page) => page?.type === RULE_PAGE_TYPE;

function termsOf(page) {
  return String(page.system.aliases ?? "")
    .split(/[;,\n]/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
}

function* rulePagesOf(journals) {
  for (const journal of journals) {
    for (const page of journal.pages) {
      if (isRulePage(page)) yield page;
    }
  }
}

function canReadRule(page) {
  return isRulePage(page)
    && page.testUserPermission(game.user, "OBSERVER")
    && (!page.pack || isRulePack(game.packs.get(page.pack)));
}

function isRulePack(pack) {
  return pack?.documentName === "JournalEntry"
    && pack.visible
    && (pack.metadata.flags?.ffxiv?.rules === true || CONFIG.FFXIV.rules.packs.has(pack.collection));
}

const packRules = new Map();
let rulePages = new Map();
let localRuleTerms = new Map();
let localRuleIndex = [];
let localIndexSignature = "";
let gmRules = new Map();
let gmIndexSignature = "";
let rulesGMId = null;
let publishedIndex = "";
let initialized = false;
let ruleHoverEnabled = true;
let cancelRuleHover = null;
const requests = new Map();

function loadPackRulePages() {
  const packs = game.packs.filter(isRulePack);
  const active = new Set(packs.map((pack) => pack.collection));
  for (const id of packRules.keys()) {
    if (!active.has(id)) packRules.delete(id);
  }
  return Promise.all(packs.map((pack) => {
    let entry = packRules.get(pack.collection);
    if (!entry) {
      entry = { journals: new Map(), loading: null };
      packRules.set(pack.collection, entry);
      entry.loading = pack.getDocuments().then((journals) => {
        entry.journals = new Map(journals.map((journal) => [journal.uuid, journal]));
      }).catch((error) => {
        console.warn(`FFXIV | Unable to load Rules from ${pack.collection}`, error);
        if (packRules.get(pack.collection) === entry) packRules.delete(pack.collection);
      });
    }
    return entry.loading;
  }));
}

async function refreshRules(changed, event, changes) {
  const pages = changed.documentName === "JournalEntry" ? [...changed.pages] : [changed];
  if (!changed.pack && !pages.some((page) => isRulePage(page) || rulePages.has(page.uuid))) return;
  if (changed.pack) {
    let entry = packRules.get(changed.pack);
    if (!entry && isRulePack(game.packs.get(changed.pack))) {
      await loadPackRulePages();
      entry = packRules.get(changed.pack);
    }
    if (!entry) return;
    await entry.loading;
    if (packRules.get(changed.pack) !== entry) return;
    const journal = changed.documentName === "JournalEntry" ? changed : changed.parent;
    if (event === "delete" && journal === changed) entry.journals.delete(journal.uuid);
    else entry.journals.set(journal.uuid, journal);
  }
  if (event === "update" && changes && !Object.hasOwn(changes.system ?? {}, "aliases")
    && !Object.keys(changes).some((key) => ["type", "pages", "system.aliases", "ownership"].includes(key)
      || key.startsWith("ownership."))) {
    if (rulePages.has(changed.uuid)) rulePages.set(changed.uuid, changed);
    return;
  }
  updateLocalRules();
}

async function refreshRulePacks() {
  await loadPackRulePages();
  updateLocalRules();
}

function findRule(uuid) {
  const page = rulePages.get(uuid);
  return canReadRule(page) ? page : null;
}

function canReferenceRule(uuid) {
  return Boolean(findRule(uuid) || (gmRules.has(uuid) && rulesGMId === getActiveGM()?.id));
}

function publishRuleIndex(force = false) {
  if (!game.ready) return;
  if (getActiveGM()?.id !== game.user.id) {
    publishedIndex = "";
    return;
  }
  if (!force && localIndexSignature === publishedIndex) return;
  publishedIndex = localIndexSignature;
  game.socket.emit("system.ffxiv", { type: RULE_SOCKET_TYPE, action: "index", data: localRuleIndex });
}

function finishRequest(id, data) {
  const request = requests.get(id);
  if (!request) return;
  clearTimeout(request.timer);
  requests.delete(id);
  request.resolve(data);
}

function requestGMRule(action, uuid = null) {
  const gm = getActiveGM();
  if (!gm || gm.id === game.user.id) return Promise.resolve(null);
  for (const request of requests.values()) {
    if (request.gmId === gm.id && request.action === action && request.uuid === uuid) return request.promise;
  }

  const id = foundry.utils.randomID();
  const request = { gmId: gm.id, action, uuid };
  request.promise = new Promise((resolve) => { request.resolve = resolve; });
  request.timer = setTimeout(() => finishRequest(id, null), REQUEST_TIMEOUT);
  requests.set(id, request);
  if (!emitToActiveGM({ type: RULE_SOCKET_TYPE, action, requestId: id, uuid }, { recipients: [gm.id] })) {
    finishRequest(id, null);
  }
  return request.promise;
}

function applyGMRuleIndex(index, gmId) {
  if (!Array.isArray(index) || !gmId || gmId !== getActiveGM()?.id || game.user.isGM) return false;
  const signature = JSON.stringify(index);
  if (rulesGMId === gmId && signature === gmIndexSignature) return false;
  rulesGMId = gmId;
  gmIndexSignature = signature;
  gmRules = new Map(index.filter((entry) => typeof entry?.uuid === "string" && Array.isArray(entry.aliases))
    .map((entry) => [entry.uuid, entry.aliases.filter((alias) => typeof alias === "string" && alias.length > 1)]));
  updateRuleTerms();
  return true;
}

async function syncGMRuleIndex() {
  const gm = getActiveGM();
  let changed = false;
  if (rulesGMId !== (gm?.id ?? null)) {
    changed = gmRules.size > 0;
    gmRules.clear();
    gmIndexSignature = "";
    rulesGMId = gm?.id ?? null;
    for (const [id, request] of requests) {
      if (request.gmId !== rulesGMId) finishRequest(id, null);
    }
    updateRuleTerms();
  }
  if (game.user.isGM) publishRuleIndex();
  else if (gm) changed = applyGMRuleIndex(await requestGMRule("getIndex"), gm.id) || changed;
  return changed;
}

function registerRuleSockets() {
  game.socket.on("system.ffxiv", async (payload, senderId) => {
    if (payload?.type !== RULE_SOCKET_TYPE) return;
    const { action, requestId, data } = payload;
    if (action === "response") {
      if (senderId === requests.get(requestId)?.gmId && senderId === getActiveGM()?.id) {
        finishRequest(requestId, data);
      }
      return;
    }
    if (action === "index") {
      if (!senderId || senderId !== getActiveGM()?.id) return;
      const changed = applyGMRuleIndex(data, senderId);
      for (const [id, request] of requests) {
        if (request.gmId === senderId && request.action === "getIndex") finishRequest(id, data);
      }
      if (initialized && changed) await refreshChatRules();
      return;
    }
    if (!game.user.isGM || getActiveGM()?.id !== game.user.id || payload.gmUserId !== game.user.id) return;
    if (!requestId || !game.users.get(senderId)?.active || !["getIndex", "getTooltip"].includes(action)) return;
    try {
      if (!initialized) await refreshRulePacks();
      const page = findRule(payload.uuid);
      const response = action === "getIndex" ? localRuleIndex : page ? await renderRuleTooltip(page, false) : null;
      game.socket.emit("system.ffxiv", {
        type: RULE_SOCKET_TYPE, action: "response", requestId, data: response,
      }, { recipients: [senderId] });
    } catch (error) {
      console.error("FFXIV | Failed to serve rule request", error);
    }
  });
}

const ruleEnricher = {
  id: "ffxiv-rule",
  pattern: NO_MATCH,
  enricher: enrichRuleMatch,
};

let ruleTerms = new Map();
let ruleMatchers = [];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function ruleTermPattern(term) {
  return term.split(/(\([XY]\)|(?<![\p{L}\p{N}_])[XY](?![\p{L}\p{N}_]))/u)
    .map((part) => {
      if (/^\([XY]\)$/u.test(part)) return String.raw`\(\d+\)`;
      if (/^[XY]$/u.test(part)) {
        return String.raw`(?:[\p{Lu}\p{Lt}][\p{L}\p{N}'-]*[ \t]+)*[\p{L}\p{N}][\p{L}\p{N}'-]*`;
      }
      return escapeRegExp(part);
    }).join("");
}

function updateLocalRules() {
  rulePages = new Map([...rulePagesOf(game.journal)].filter(canReadRule).map((page) => [page.uuid, page]));
  for (const entry of packRules.values()) {
    for (const page of rulePagesOf(entry.journals.values())) {
      if (canReadRule(page)) rulePages.set(page.uuid, page);
    }
  }
  localRuleTerms = new Map();
  localRuleIndex = [];
  for (const page of rulePages.values()) {
    const aliases = termsOf(page);
    localRuleIndex.push({ uuid: page.uuid, aliases });
    for (const term of aliases) {
      if (!localRuleTerms.has(term)) localRuleTerms.set(term, page.uuid);
    }
  }
  localIndexSignature = JSON.stringify(localRuleIndex);
  updateRuleTerms();
  publishRuleIndex();
}

function updateRuleTerms() {
  const next = new Map(localRuleTerms);
  if (rulesGMId === getActiveGM()?.id) {
    for (const [uuid, aliases] of gmRules) {
      for (const term of aliases) {
        if (!next.has(term)) next.set(term, uuid);
      }
    }
  }
  const unchanged = next.size === ruleTerms.size && [...next].every(([term, uuid]) => ruleTerms.get(term) === uuid);
  ruleTerms = next;
  if (unchanged) return;
  const terms = [...ruleTerms.keys()].sort((a, b) => b.length - a.length).map(ruleTermPattern);
  ruleMatchers = [...ruleTerms.entries()]
    .filter(([term]) => ruleTermPattern(term) !== escapeRegExp(term))
    .sort(([a], [b]) => b.length - a.length)
    .map(([term, uuid]) => ({ pattern: new RegExp(`^(?:${ruleTermPattern(term)})$`, "u"), uuid }));
  const pattern = terms.length
    ? String.raw`(?<![\p{L}\p{N}_])(${terms.join("|")})(?![\p{L}\p{N}_])`
    : NO_MATCH.source;
  if (ruleEnricher.pattern.source !== pattern) ruleEnricher.pattern = new RegExp(pattern, "gu");
}

function enrichRuleMatch([text], options = {}) {
  const uuid = ruleTerms.get(text) ?? ruleMatchers.find(({ pattern }) => pattern.test(text))?.uuid;
  if (!uuid || uuid === options.relativeTo?.uuid || !canReferenceRule(uuid)) return null;

  const reference = document.createElement("span");
  reference.className = "ffxiv-rule-reference";
  reference.dataset.ruleUuid = uuid;
  reference.dataset.ffxivTooltip = "";
  reference.textContent = text;
  return reference;
}

async function ruleTooltipHTML(reference) {
  const page = findRule(reference.dataset.ruleUuid);
  if (page) return renderRuleTooltip(page);
  if (canReferenceRule(reference.dataset.ruleUuid)) {
    const html = await requestGMRule("getTooltip", reference.dataset.ruleUuid);
    if (typeof html === "string") return html;
  }
  return `<p>${foundry.utils.escapeHTML(game.i18n.format("FFXIV.Rules.NotFound", { term: reference.textContent }))}</p>`;
}

async function renderRuleTooltip(page, secrets = page.isOwner) {
  const escape = foundry.utils.escapeHTML;
  const content = await foundry.applications.ux.TextEditor.implementation.enrichHTML(page.system.content, {
    relativeTo: page,
    secrets,
  });
  return `<p><strong>${escape(page.name)}</strong></p>${content}`;
}

function registerRuleTooltips() {
  ruleHoverEnabled = game.settings.get("ffxiv", "ruleHoverTooltips");
  let pending = null;
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    pending = null;
  };
  cancelRuleHover = cancel;
  document.addEventListener("pointerover", (event) => {
    if (!ruleHoverEnabled) return;
    const reference = event.target.closest?.(".ffxiv-rule-reference");
    if (!reference || reference.contains(event.relatedTarget)) return;

    cancel();
    const request = {};
    pending = request;
    const stillHovered = () => pending === request && ruleHoverEnabled
      && reference.isConnected && reference.matches(":hover");

    timer = setTimeout(async () => {
      timer = null;
      try {
        if (!stillHovered()) return;
        const html = await ruleTooltipHTML(reference);
        if (!stillHovered() || !canReferenceRule(reference.dataset.ruleUuid)) return;
        game.tooltip.activate(reference, { html, direction: "UP", cssClass: "ffxiv-rule-tooltip ffxiv-enriched-tooltip" });
      } catch (error) {
        console.error("FFXIV | Failed to create rule tooltip", error);
      }
    }, TOOLTIP_DELAY);
  });
  document.addEventListener("pointerout", (event) => {
    const reference = event.target.closest?.(".ffxiv-rule-reference");
    if (reference && !reference.contains(event.relatedTarget)) cancel();
  });
}

function dismissRuleTooltips() {
  cancelRuleHover?.();
  if (game.tooltip?.element?.matches(".ffxiv-rule-reference")) game.tooltip.deactivate();
  for (const tooltip of document.querySelectorAll(".locked-tooltip.ffxiv-rule-tooltip")) {
    tooltip.dispatchEvent(new Event("contextmenu", { cancelable: true }));
  }
}

async function refreshChatRules() {
  await ui.chat.render();
  const elements = [ui.chat.element, ui.chat.popout?.element].filter(Boolean);
  const ids = new Set();
  for (const element of elements) {
    for (const message of element.querySelectorAll(".message[data-message-id]")) {
      ruleEnricher.pattern.lastIndex = 0;
      const matches = ruleEnricher.pattern.test(message.textContent);
      ruleEnricher.pattern.lastIndex = 0;
      if (matches || message.querySelector(".ffxiv-rule-reference")) ids.add(message.dataset.messageId);
    }
  }
  for (const id of ids) {
    const message = game.messages.get(id);
    if (message) await ui.chat.updateMessage(message);
  }
}

function registerBabeleMapping(babele) {
  if (typeof babele?.registerMapping !== "function") return;
  try {
    babele.registerMapping({
      JournalEntryPage: {
        _variants: [{
          _when: { path: "type", equals: RULE_PAGE_TYPE },
          content: "system.content",
          aliases: "system.aliases",
        }],
      },
    });
  } catch (error) {
    console.warn("FFXIV | Unable to register Babele rule translations", error);
  }
}

export function registerRules() {
  CONFIG.FFXIV.rules = { packs: new Set() };

  game.settings.register("ffxiv", "ruleHoverTooltips", {
    name: "FFXIV.Settings.RuleHoverTooltips",
    hint: "FFXIV.Settings.RuleHoverTooltipsHint",
    scope: "user",
    config: true,
    default: true,
    type: Boolean,
    requiresReload: false,
    onChange: (enabled) => {
      ruleHoverEnabled = enabled;
      if (!enabled) dismissRuleTooltips();
    },
  });
  CONFIG.TextEditor.enrichers.push(ruleEnricher);

  Hooks.once("setup", () => {
    updateLocalRules();
    return refreshRulePacks();
  });
  Hooks.once("ready", async () => {
    registerRuleTooltips();
    registerRuleSockets();
    await refreshRulePacks();
    await syncGMRuleIndex();
    initialized = true;
    if (packRules.size || gmRules.size) await refreshChatRules();
  });
  Hooks.on("updateSetting", (setting) => {
    if (setting.key === "core.compendiumConfiguration") return refreshRulePacks();
  });
  Hooks.on("updateUser", async (user, changed) => {
    if (!("role" in changed)) return;
    if (user.id === game.user.id) {
      gmRules.clear();
      gmIndexSignature = "";
      await refreshRulePacks();
    }
    if (initialized && await syncGMRuleIndex()) await refreshChatRules();
  });
  Hooks.on("userConnected", async (user) => {
    if (!initialized) return;
    if (user.isGM) {
      if (await syncGMRuleIndex()) await refreshChatRules();
    } else if (user.active) publishRuleIndex(true);
  });
  if (game.modules.get("babele")?.active) Hooks.once("babele.init", registerBabeleMapping);
  for (const event of ["create", "update", "delete"]) {
    Hooks.on(`${event}JournalEntry`, (document, changes) => refreshRules(document, event, changes));
    Hooks.on(`${event}JournalEntryPage`, (document, changes) => refreshRules(document, event, changes));
  }
}
