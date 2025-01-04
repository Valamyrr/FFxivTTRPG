import {migrateDataToSystem} from "./helpers/migration.js";

/**
 * A specialized form used to pop out the editor.
 * @extends {FormApplication}
 */
export default class PopoutEditor extends FormApplication {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "popout-editor",
      classes: ["ffxiv", "sheet"],
      title: "Pop-out Editor",
      template: "systems/ffxiv/templates/popout-editor.html",
      width: 320,
      height: 320,
      resizable:true,
    });
  }

  /**
   * Return a reference to the target attribute
   * @type {String}
   */
  get attribute() {
    return this.options.name;
  }

  /** @override */
  getData() {
    // Get current value
    let attr = foundry.utils.getProperty(this.object.system, this.attribute.replace('data.', ''));

    // Return data
    return {
      value: attr,
      cssClass: "editable popout-editor-window",
    };
  }

  /* -------------------------------------------- */

  /** @override */
  _updateObject(event, formData) {
    const updateData = {};
    updateData[`${this.attribute}`] = formData.value;

    // Update the object
    this.object.update(
        migrateDataToSystem(updateData)
    );

    this.close();
  }


}
