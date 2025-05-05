export class SettingsHelpers {

  static initSettings(){
    game.settings.register("ffxiv", "colorScheme", {
      name: game.i18n.localize("FFXIV.Settings.ColorScheme"),
      hint: game.i18n.localize("FFXIV.Settings.ColorSchemeHint"),
      scope: "client",
      config: true,
      default: "dark",
      type: String,
      choices: {
        dark: game.i18n.localize("FFXIV.Settings.Dark"),
        light: game.i18n.localize("FFXIV.Settings.Light"),
        blue: game.i18n.localize("FFXIV.Settings.Blue")
      },
      requiresReload: true
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

    game.settings.register("ffxiv", "limitedPhysicalItemsDialog", {
      name: game.i18n.localize("FFXIV.Settings.LimitedPhysicalItemsDialog"),
      hint: game.i18n.localize("FFXIV.Settings.LimitedPhysicalItemsDialogHint"),
      scope: "client",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false
    });

    game.settings.register("ffxiv", "hueTabsIcons", {
      name: game.i18n.localize("FFXIV.Settings.HueTabsIcons"),
      hint: game.i18n.localize("FFXIV.Settings.HueTabsIconsHint"),
      scope: "client",
      config: true,
      default: false,
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
      requiresReload: false
    });

    game.settings.register("ffxiv", "customTraitTags", {
      name: game.i18n.localize("FFXIV.Settings.CustomTraitTags"),
      hint: game.i18n.localize("FFXIV.Settings.CustomTagsHint"),
      scope: "world",
      config: true,
      type: String,
      default: "",
      requiresReload: false
    });

    game.settings.register("ffxiv", "customConsumableTags", {
      name: game.i18n.localize("FFXIV.Settings.CustomConsumableTags"),
      hint: game.i18n.localize("FFXIV.Settings.CustomTagsHint"),
      scope: "world",
      config: true,
      type: String,
      default: "",
      requiresReload: false
    });

    game.settings.register("ffxiv", "jobsAbbrv", {
      name: game.i18n.localize("FFXIV.Settings.JobsAbbrv"),
      hint: game.i18n.localize("FFXIV.Settings.JobsAbbrvHint"),
      scope: "world",
      config: true,
      default: "",
      type: String,
      requiresReload: false
    });

    game.settings.register("ffxiv", "attributesImg", {
      name: game.i18n.localize("FFXIV.Settings.AttributesImg"),
      hint: game.i18n.localize("FFXIV.Settings.AttributesImgHint"),
      scope: "world",
      config: true,
      default: "systems/ffxiv/assets/circle.png",
      type: String,
      requiresReload: false,
      filePicker: "image"
    });

    game.settings.register("ffxiv", "soundNotificationFFxiv_deleteItem", {
      name: game.i18n.localize("FFXIV.Settings.soundNotificationFFxiv_deleteItem"),
      hint: game.i18n.localize("FFXIV.Settings.soundNotificationFFxiv_Hint"),
      scope: "world",
      config: true,
      default: "",
      type: String,
      requiresReload: false,
      filePicker: "media"
    });
    game.settings.register("ffxiv", "soundNotificationFFxiv_moveItem", {
      name: game.i18n.localize("FFXIV.Settings.soundNotificationFFxiv_moveItem"),
      hint: game.i18n.localize("FFXIV.Settings.soundNotificationFFxiv_Hint"),
      scope: "world",
      config: true,
      default: "",
      type: String,
      requiresReload: false,
      filePicker: "media"
    });
    game.settings.register("ffxiv", "soundNotificationFFxiv_enterChat", {
      name: game.i18n.localize("FFXIV.Settings.soundNotificationFFxiv_enterChat"),
      hint: game.i18n.localize("FFXIV.Settings.soundNotificationFFxiv_Hint"),
      scope: "world",
      config: true,
      default: "",
      type: String,
      requiresReload: false,
      filePicker: "media"
    });
    game.settings.register("ffxiv", "soundNotificationFFxiv_openSheet", {
      name: game.i18n.localize("FFXIV.Settings.soundNotificationFFxiv_openSheet"),
      hint: game.i18n.localize("FFXIV.Settings.soundNotificationFFxiv_Hint"),
      scope: "world",
      config: true,
      default: "",
      type: String,
      requiresReload: false,
      filePicker: "media"
    });
    game.settings.register("ffxiv", "soundNotificationFFxiv_closeSheet", {
      name: game.i18n.localize("FFXIV.Settings.soundNotificationFFxiv_closeSheet"),
      hint: game.i18n.localize("FFXIV.Settings.soundNotificationFFxiv_Hint"),
      scope: "world",
      config: true,
      default: "",
      type: String,
      requiresReload: false,
      filePicker: "media"
    });

    game.settings.register("ffxiv", "attributesImg", {
      name: game.i18n.localize("FFXIV.Settings.AttributesImg"),
      hint: game.i18n.localize("FFXIV.Settings.AttributesImgHint"),
      scope: "world",
      config: true,
      default: "systems/ffxiv/assets/circle.png",
      type: String,
      requiresReload: false,
      filePicker: "image"
    });

    game.settings.register("ffxiv", "attributesImgDefense", {
      name: game.i18n.localize("FFXIV.Settings.AttributesImgDefense"),
      hint: "",
      scope: "world",
      config: true,
      default: "",
      type: String,
      requiresReload: false,
      filePicker: "image"
    });
    game.settings.register("ffxiv", "attributesImgMagicDefense", {
      name: game.i18n.localize("FFXIV.Settings.AttributesImgMagicDefense"),
      hint: "",
      scope: "world",
      config: true,
      default: "",
      type: String,
      requiresReload: false,
      filePicker: "image"
    });
    game.settings.register("ffxiv", "attributesImgVigilance", {
      name: game.i18n.localize("FFXIV.Settings.AttributesImgVigilance"),
      hint: "",
      scope: "world",
      config: true,
      default: "",
      type: String,
      requiresReload: false,
      filePicker: "image"
    });
    game.settings.register("ffxiv", "attributesImgSpeed", {
      name: game.i18n.localize("FFXIV.Settings.AttributesImgSpeed"),
      hint: "",
      scope: "world",
      config: true,
      default: "",
      type: String,
      requiresReload: false,
      filePicker: "image"
    });

    game.settings.register("ffxiv", "imgTabAbilities", {
      name: game.i18n.localize("FFXIV.Settings.TabAbilitiesImg"),
      hint: game.i18n.localize("FFXIV.Settings.TabAbilitiesImgHint"),
      scope: "world",
      config: true,
      type: String,
      default: "icons/weapons/swords/swords-short.webp",
      filePicker: "image"
    });
    game.settings.register("ffxiv", "imgTabAttributes", {
      name: game.i18n.localize("FFXIV.Settings.TabAttributesImg"),
      hint: game.i18n.localize("FFXIV.Settings.TabAttributesImgHint"),
      scope: "world",
      config: true,
      type: String,
      default: "icons/creatures/eyes/human-single-brown.webp",
      filePicker: "image"
    });
    game.settings.register("ffxiv", "imgTabGear", {
      name: game.i18n.localize("FFXIV.Settings.TabGearImg"),
      hint: game.i18n.localize("FFXIV.Settings.TabGearImgHint"),
      scope: "world",
      config: true,
      type: String,
      default: "icons/equipment/chest/breastplate-cuirass-steel-grey.webp",
      filePicker: "image"
    });
    game.settings.register("ffxiv", "imgTabRoleplay", {
      name: game.i18n.localize("FFXIV.Settings.TabRoleplayImg"),
      hint: game.i18n.localize("FFXIV.Settings.TabRoleplayImgHint"),
      scope: "world",
      config: true,
      type: String,
      default: "icons/sundries/documents/document-official-capital.webp",
      filePicker: "image"
    });
    game.settings.register("ffxiv", "imgTabItems", {
      name: game.i18n.localize("FFXIV.Settings.TabItemsImg"),
      hint: game.i18n.localize("FFXIV.Settings.TabItemsImgHint"),
      scope: "world",
      config: true,
      type: String,
      default: "icons/containers/bags/pack-leather-gold-brown.webp",
      filePicker: "image"
    });
    game.settings.register("ffxiv", "imgTabCompanions", {
      name: game.i18n.localize("FFXIV.Settings.TabCompanionsImg"),
      hint: game.i18n.localize("FFXIV.Settings.TabCompanionsImgHint"),
      scope: "world",
      config: true,
      type: String,
      default: "icons/creatures/mammals/rabbit-movement-glowing-green.webp",
      filePicker: "image"
    });
    game.settings.register("ffxiv", "imgTabSettings", {
      name: game.i18n.localize("FFXIV.Settings.TabSettingsImg"),
      hint: game.i18n.localize("FFXIV.Settings.TabSettingsImgHint"),
      scope: "world",
      config: true,
      type: String,
      default: "icons/tools/fasteners/washer-hex-copper-brown.webp",
      filePicker: "image"
    });



  }

}
