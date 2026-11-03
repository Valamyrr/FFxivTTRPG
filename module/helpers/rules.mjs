import { RULE_PAGE_TYPE } from "../journal/rule-page.mjs";

const NO_MATCH = /(?!)/gu;
const TOOLTIP_DELAY = 500;

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

function worldRulePages() {
  const journals = game.journal.filter((journal) => journal.testUserPermission(game.user, "OBSERVER"));
  return [...rulePagesOf(journals)];
}

function rulePacks() {
  const registered = CONFIG.FFXIV.rules.packs;
  return game.packs.filter((pack) => pack.documentName === "JournalEntry"
    && pack.visible
    && (pack.metadata.flags?.ffxiv?.rules === true || registered.has(pack.collection)));
}

let packRulePages = [];
let packRulePagesLoading = null;

function loadPackRulePages() {
  packRulePagesLoading ??= Promise.all(rulePacks().map((pack) => pack.getDocuments().catch((error) => {
    console.warn(`FFXIV | Unable to load Rules from ${pack.collection}`, error);
    return [];
  }))).then((results) => {
    packRulePages = [...rulePagesOf(results.flat())];
    return packRulePages;
  });
  return packRulePagesLoading;
}

async function refreshRules(changed) {
  const pages = changed.documentName === "JournalEntry" ? [...changed.pages] : [changed];
  if (!pages.some(isRulePage)) return;
  if (changed.pack) packRulePagesLoading = null;
  await loadPackRulePages();
  updateRuleTerms();
}

function allRulePages() {
  return [...worldRulePages(), ...packRulePages];
}

function findRule(uuid) {
  return allRulePages().find((page) => page.uuid === uuid) ?? null;
}

const ruleEnricher = {
  id: "ffxiv-rule",
  pattern: NO_MATCH,
  enricher: enrichRuleMatch,
};

let ruleTerms = new Map();

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function updateRuleTerms() {
  ruleTerms = new Map();
  for (const page of allRulePages()) {
    for (const term of termsOf(page)) {
      if (!ruleTerms.has(term)) ruleTerms.set(term, page.uuid);
    }
  }

  const terms = [...ruleTerms.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  ruleEnricher.pattern = terms.length
    ? new RegExp(String.raw`(?<![\p{L}\p{N}_])(${terms.join("|")})(?![\p{L}\p{N}_])`, "gu")
    : NO_MATCH;
}

function enrichRuleMatch([text], options = {}) {
  const uuid = ruleTerms.get(text);
  if (!uuid || uuid === options.relativeTo?.uuid) return null;

  const reference = document.createElement("span");
  reference.className = "ffxiv-rule-reference";
  reference.dataset.ruleUuid = uuid;
  reference.dataset.ffxivTooltip = "";
  reference.textContent = text;
  return reference;
}

async function ruleTooltipHTML(reference) {
  const page = findRule(reference.dataset.ruleUuid);
  const escape = foundry.utils.escapeHTML;
  if (!page) {
    return `<p>${escape(game.i18n.format("FFXIV.Rules.NotFound", { term: reference.textContent }))}</p>`;
  }

  const content = await foundry.applications.ux.TextEditor.implementation.enrichHTML(page.system.content, {
    relativeTo: page,
    secrets: page.isOwner,
  });
  return `<p><strong>${escape(page.name)}</strong></p>${content}`;
}

function registerRuleTooltips() {
  let pending = null;
  document.addEventListener("pointerover", async (event) => {
    const reference = event.target.closest?.(".ffxiv-rule-reference");
    if (!reference || reference.contains(event.relatedTarget)) return;

    const request = {};
    pending = request;
    const stillHovered = () => pending === request && reference.isConnected && reference.matches(":hover");

    await new Promise((resolve) => setTimeout(resolve, TOOLTIP_DELAY));
    if (!stillHovered()) return;
    const html = await ruleTooltipHTML(reference);
    if (!stillHovered()) return;
    game.tooltip.activate(reference, { html, direction: "UP" });
  });
}

function registerBabeleMapping(babele) {
  if (typeof babele?.registerMapping !== "function") return;
  babele.registerMapping({
    JournalEntryPage: {
      _variants: [{
        _when: { path: "type", equals: RULE_PAGE_TYPE },
        content: "system.content",
        aliases: "system.aliases",
      }],
    },
  });
}

export function registerRules() {
  CONFIG.FFXIV.rules = { packs: new Set() };

  CONFIG.TextEditor.enrichers.push(ruleEnricher);

  Hooks.once("ready", async () => {
    registerRuleTooltips();
    await loadPackRulePages();
    updateRuleTerms();
  });
  Hooks.once("babele.init", registerBabeleMapping);
  for (const event of ["create", "update", "delete"]) {
    Hooks.on(`${event}JournalEntry`, refreshRules);
    Hooks.on(`${event}JournalEntryPage`, refreshRules);
  }
}
