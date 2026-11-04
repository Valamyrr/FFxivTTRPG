const { DocumentSheetConfig } = foundry.applications.apps;
const { JournalEntryPageHandlebarsSheet } = foundry.applications.sheets.journal;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export const RULE_PAGE_TYPE = "rule";

export class RulePageData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      aliases: new fields.StringField({ required: true, blank: true, initial: "" }),
      content: new fields.HTMLField({ required: true, blank: true, initial: "" }),
    };
  }
}

function withCoreEditParts(parts, content) {
  const { header, footer } = parts ?? {};
  return { ...(header && { header }), content, ...(footer && { footer }) };
}

export class FFXIVRulePageSheet extends JournalEntryPageHandlebarsSheet {
  static VIEW_PARTS = {
    content: { template: "systems/ffxiv/templates/journal/rule-page-view.hbs", root: true },
  };

  static EDIT_PARTS = withCoreEditParts(super.EDIT_PARTS, {
    template: "systems/ffxiv/templates/journal/rule-page-edit.hbs",
    classes: ["standard-form"],
  });

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const page = this.page;

    context.rule = {
      uuid: page.uuid,
      name: page.name,
      aliases: page.system.aliases,
      showTitle: page.title.show,
      titleLevel: page.title.level,
    };

    if (this.isView) {
      context.rule.content = await TextEditor.enrichHTML(page.system.content, {
        relativeTo: page,
        secrets: page.isOwner,
      });
    } else {
      context.rule.source = page._source.system.content;
    }

    return context;
  }
}

export function registerRulePages() {
  CONFIG.JournalEntryPage.dataModels[RULE_PAGE_TYPE] = RulePageData;
  CONFIG.JournalEntryPage.typeIcons ??= {};
  CONFIG.JournalEntryPage.typeIcons[RULE_PAGE_TYPE] = "fa-solid fa-book-open";

  DocumentSheetConfig.registerSheet(JournalEntryPage, "ffxiv", FFXIVRulePageSheet, {
    types: [RULE_PAGE_TYPE],
    makeDefault: true,
    label: "TYPES.JournalEntryPage.rule",
  });
}
