import { migrateDataToSystem } from "./helpers/migration.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A specialized form used to pop out the editor.
 * @extends {ApplicationV2}
 */
export default class PopoutEditor extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  constructor(object, options = {}) {
    options.position ??= {};
    for (const key of ["width", "height", "left", "top"]) {
      if (key in options) {
        options.position[key] = options[key];
        delete options[key];
      }
    }
    super(options);
    this.object = object;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "popout-editor",
    classes: ["ffxiv", "sheet"],
    window: {
      title: "Pop-out Editor",
      resizable: true,
    },
    form: {
      handler: PopoutEditor._onSubmit,
      closeOnSubmit: true,
    },
    position: {
      width: 320,
      height: 320,
    },
  };

  /** @override */
  static PARTS = {
    sheet: {
      template: "systems/ffxiv/templates/popout-editor.html",
      scrollable: [".sheet-body"],
    },
  };

  /**
   * Return a reference to the target attribute
   * @type {String}
   */
  get attribute() {
    return this.options.name;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // Get current value
    const systemPath = this.attribute.replace(/^(data|system)\./, "");
    let attr = foundry.utils.getProperty(this.object.system, systemPath);

    // Return data
    context.value = attr;
    context.cssClass = "editable popout-editor-window";
    return context;
  }

  /* -------------------------------------------- */

  static async _onSubmit(event, form, formData) {
    const updateData = {};
    updateData[`${this.attribute}`] = formData.object.value;

    // Update the object
    await this.object.update(migrateDataToSystem(updateData));
  }
}
