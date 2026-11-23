export function editAutomationData(document, { systemFields = [] } = {}) {
  if (!document.isOwner || document.compendium?.locked) return;
  const original = { flags: foundry.utils.deepClone(document.flags.ffxiv ?? {}) };
  for (const field of systemFields) original[field] = foundry.utils.deepClone(document.system[field] ?? []);
  const content = foundry.utils.escapeHTML(JSON.stringify(original, null, 2));
  const localize = (key) => game.i18n.localize(`FFXIV.EffectAutomation.${key}`);
  return new foundry.applications.api.DialogV2({
    window: { title: `${document.name}: ${localize("AdvancedData")}` },
    position: { width: 640 },
    form: { closeOnSubmit: false },
    content: `<div class="form-group stacked">
      <label>${localize("AdvancedData")}</label>
      <textarea name="automationData" rows="20" spellcheck="false">${content}</textarea>
      <p class="hint">${localize("AdvancedDataHint")}</p>
    </div>`,
    buttons: [
      {
        action: "save",
        label: "COMMON.Save",
        default: true,
        callback: async (_event, button, dialog) => {
          if (!document.isOwner || document.compendium?.locked) return;
          try {
            const data = JSON.parse(button.form.elements.automationData.value);
            if (!foundry.utils.isPlainObject(data) || !foundry.utils.isPlainObject(data.flags) ||
              Object.keys(data).some((key) => key !== "flags" && !systemFields.includes(key)) ||
              systemFields.some((field) => data[field] !== undefined && !Array.isArray(data[field]))) {
              throw new Error(localize("AdvancedDataShape"));
            }
            const update = {
              "flags.ffxiv": foundry.utils.diffObject(original.flags, data.flags, { bidirectional: true }),
            };
            for (const field of systemFields) {
              if (!foundry.utils.equals(original[field], data[field] ?? [])) update[`system.${field}`] = data[field] ?? [];
            }
            await document.update(update);
            await dialog.close();
          } catch (error) {
            ui.notifications.error(game.i18n.format("FFXIV.EffectAutomation.InvalidData", { error: error.message }));
          }
        },
      },
      { action: "cancel", label: "COMMON.Cancel", callback: (_event, _button, dialog) => dialog.close() },
    ],
  }).render({ force: true });
}
