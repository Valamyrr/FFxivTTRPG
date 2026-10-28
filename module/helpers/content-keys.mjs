export function normalizeContentKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

export function getSourceText(document, field) {
  const value = field === "name" ? document?.name : document?.system?.[field];
  const source = document?.flags?.babele?.sourceText?.[field];
  if (source && value === source.translated) return source.original;
  return value;
}

export function getContentKey(document) {
  return normalizeContentKey(getSourceText(document, "name"));
}

export function getTranslationKey(document, folders = null) {
  const findFolder = (id) => {
    if (typeof id === "object") return id;
    if (folders) return folders.get(id);
    for (const pack of globalThis.game?.packs?.values?.() ?? []) {
      const folder = pack.folders?.get(id);
      if (folder) return folder;
    }
    return globalThis.game?.folders?.get(id);
  };
  const names = [];
  const visited = new Set();
  let folder = findFolder(document?.folder);
  while (folder && !visited.has(folder.id ?? folder._id)) {
    visited.add(folder.id ?? folder._id);
    names.unshift(folder.originalName ?? getSourceText(folder, "name"));
    folder = findFolder(folder.folder);
  }
  return normalizeContentKey([...names, getSourceText(document, "name")].join(" "));
}

export function getContentKeys(document) {
  return [...new Set([getContentKey(document), normalizeContentKey(document?.name)].filter(Boolean))];
}

export function matchesContentKey(document, reference) {
  const key = normalizeContentKey(reference);
  return Boolean(key && getContentKeys(document).includes(key));
}

export async function resolveContentReference(reference, documentType = "Item") {
  const uuid = String(reference?.uuid ?? "");
  if (uuid) {
    let document;
    try {
      document = await fromUuid(uuid);
    } catch (_error) {
      document = null;
    }
    if (document?.documentName === documentType) return document;
  }
  const source = reference?.item ?? reference?.actor ?? reference;
  const key = getContentKey(source);
  if (!key) return null;
  if (uuid.startsWith("Compendium.")) {
    const collection = uuid.split(".").slice(1, 3).join(".");
    const pack = game.packs.get(collection);
    if (pack?.documentName !== documentType) return null;
    const index = await pack.getIndex();
    let matches = index.filter((entry) => matchesContentKey(entry, key));
    if (source.folder) {
      const translationKey = getTranslationKey(source);
      matches = matches.filter((entry) => getTranslationKey(entry) === translationKey);
    }
    return matches.length === 1 ? pack.getDocument(matches[0]._id) : null;
  }
  const collection = documentType === "Actor" ? game.actors : game.items;
  const matches = collection.filter((entry) => matchesContentKey(entry, key));
  return matches.length === 1 ? matches[0] : null;
}
