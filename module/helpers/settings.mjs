export class SettingsHelpers {

  static initSettings(){

    game.settings.register("ffxiv", "toggleExperience", {
      name: game.i18n.localize("FFXIV.Settings.ToggleExperience"),
      hint: game.i18n.localize("FFXIV.Settings.ToggleExperienceHint"),
      scope: "world",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false
    });

    game.settings.register("ffxiv", "toggleGear", {
      name: game.i18n.localize("FFXIV.Settings.ToggleGear"),
      hint: game.i18n.localize("FFXIV.Settings.ToggleGearHint"),
      scope: "world",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    game.settings.register("ffxiv", "useRarity", {
      name: game.i18n.localize("FFXIV.Settings.UseRarity"),
      hint: game.i18n.localize("FFXIV.Settings.UseRarityHint"),
      scope: "world",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false
    });

    game.settings.register("ffxiv", "customAbilityTags", {
      name: game.i18n.localize("FFXIV.Settings.CustomAbilityTags"),
      hint: game.i18n.localize("FFXIV.Settings.CustomTagsHint"),
      scope: "world",
      config: true,
      type: String,
      default: "",
      requiresReload: true
    });

    game.settings.register("ffxiv", "customTraitTags", {
      name: game.i18n.localize("FFXIV.Settings.CustomTraitTags"),
      hint: game.i18n.localize("FFXIV.Settings.CustomTagsHint"),
      scope: "world",
      config: true,
      type: String,
      default: "",
      requiresReload: true
    });

    game.settings.register("ffxiv", "customConsumableTags", {
      name: game.i18n.localize("FFXIV.Settings.CustomConsumableTags"),
      hint: game.i18n.localize("FFXIV.Settings.CustomTagsHint"),
      scope: "world",
      config: true,
      type: String,
      default: "",
      requiresReload: true
    });


    game.settings.register("ffxiv", "limitedPhysicalItemsDialog", {
      name: game.i18n.localize("FFXIV.Settings.LimitedPhysicalItemsDialog"),
      hint: game.i18n.localize("FFXIV.Settings.LimitedPhysicalItemsDialogHint"),
      scope: "client",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false
    });

    game.settings.register("ffxiv", "soundNotificationFFxiv", {
      name: game.i18n.localize("FFXIV.Settings.SoundNotificationFFxiv"),
      hint: game.i18n.localize("FFXIV.Settings.SoundNotificationFFxivHint"),
      scope: "client",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false
    });

    game.settings.register("ffxiv", "soundNotificationFFxivVolume", {
      name: game.i18n.localize("FFXIV.Settings.SoundNotificationFFxivVolume"),
      hint: game.i18n.localize("FFXIV.Settings.SoundNotificationFFxivHintVolume"),
      scope: "client",
      config: true,
      type: Number,
      default: 0.5,
      range: {min: 0, max: 1, step: 0.01},
      requiresReload: false
    });

  }

}
