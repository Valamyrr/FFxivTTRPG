const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class FFXIVSettingsSubmenu extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    options.id ??= `ffxiv-${new.target.menuId}`;
    options.window ??= {};
    options.window.title ??= game.i18n.localize(new.target.titleKey);
    super(options);
  }

  static DEFAULT_OPTIONS = {
    classes: ["ffxiv", "settings-submenu"],
    position: {
      width: 560,
      height: 640,
    },
    window: {
      resizable: true,
    },
  };

  static PARTS = {
    sheet: {
      template: "systems/ffxiv/templates/settings-submenu.hbs",
      scrollable: [".settings-list"],
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const placeholders = this.constructor.placeholders ?? {};
    context.settings = this.constructor.settingKeys.map((key) => {
      const config = game.settings.settings.get(`ffxiv.${key}`);
      const value = game.settings.get("ffxiv", key);
      const type = config?.type;
      return {
        key,
        name: this._localize(config?.name ?? key),
        hint: this._localize(config?.hint ?? ""),
        value,
        disabled: config?.scope === "world" && !game.user.isGM,
        isBoolean: type === Boolean,
        isNumber: type === Number,
        isString: type === String,
        pickerType: config?.filePicker,
        min: config?.range?.min,
        max: config?.range?.max,
        step: config?.range?.step,
        hasMin: config?.range?.min !== undefined,
        hasMax: config?.range?.max !== undefined,
        hasStep: config?.range?.step !== undefined,
        placeholder: placeholders[key] ?? "",
      };
    });
    return context;
  }

  _localize(value) {
    if (!value) return "";
    return game.i18n.localize(value);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._settingsController?.abort();
    this._settingsController = new AbortController();
    const { signal } = this._settingsController;

    this.element.querySelectorAll("[data-file-picker]").forEach((button) => {
      button.addEventListener("click", (event) => this._onFilePicker(event), {
        signal,
      });
    });

    const form = this.element.querySelector("form");
    form?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
      },
      { capture: true, signal },
    );

    this.element
      .querySelector("[data-action='save-settings']")
      ?.addEventListener(
        "click",
        async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const reload = await this._saveSettings();
          await this.close();
          if (reload.required) {
            await foundry.applications.settings.SettingsConfig.reloadConfirm({
              world: reload.world,
            });
          }
        },
        { signal },
      );
  }

  async _onClose(options) {
    this._settingsController?.abort();
    this._settingsController = null;
    await super._onClose(options);
  }

  _onFilePicker(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const input = this.element.querySelector(
      `[name="${button.dataset.target}"]`,
    );
    if (!input) return;

    const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
    new FilePickerImpl({
      type: button.dataset.filePicker,
      current: input.value,
      callback: (path) => (input.value = path),
    }).render(true);
  }

  async _saveSettings() {
    const form = this.element.querySelector("form");
    if (!form) return { required: false, world: false };

    const changedScopes = new Set();
    const updates = this.constructor.settingKeys.map(async (key) => {
      const config = game.settings.settings.get(`ffxiv.${key}`);
      const input = form.elements[key];
      if (!config || !input) return;
      if (config.scope === "world" && !game.user.isGM) return;

      let value = input.value;
      if (config.type === Boolean) value = input.checked;
      else if (config.type === Number) value = Number(value);

      const current = game.settings.get("ffxiv", key);
      if (current === value) return;

      changedScopes.add(config.scope);
      await game.settings.set("ffxiv", key, value);
    });
    await Promise.all(updates);
    return {
      required: changedScopes.size > 0,
      world: changedScopes.has("world"),
    };
  }
}

class FFXIVSoundSettingsMenu extends FFXIVSettingsSubmenu {
  static menuId = "sound-settings";
  static titleKey = "FFXIV.Settings.SoundSettingsMenu";
  static settingKeys = [
    "soundNotificationFFXIV_critical",
    "soundNotificationFFXIV_deleteItem",
    "soundNotificationFFXIV_moveItem",
    "soundNotificationFFXIV_enterChat",
    "soundNotificationFFXIV_openSheet",
    "soundNotificationFFXIV_closeSheet",
  ];
}

class FFXIVIconSettingsMenu extends FFXIVSettingsSubmenu {
  static menuId = "icon-settings";
  static titleKey = "FFXIV.Settings.IconSettingsMenu";
  static settingKeys = [
    "attributesImgDefense",
    "attributesImgMagicDefense",
    "attributesImgVigilance",
    "attributesImgSpeed",
  ];
  static placeholders = {
    attributesImgDefense: "systems/ffxiv/assets/attribute-icons/rampart.webp",
    attributesImgMagicDefense: "systems/ffxiv/assets/attribute-icons/dark-mind.webp",
    attributesImgVigilance: "systems/ffxiv/assets/attribute-icons/duty-finder.webp",
    attributesImgSpeed: "systems/ffxiv/assets/attribute-icons/sightseeing-log.webp",
  };
}

class FFXIVTabIconSettingsMenu extends FFXIVSettingsSubmenu {
  static menuId = "tab-icon-settings";
  static titleKey = "FFXIV.Settings.TabIconSettingsMenu";
  static settingKeys = [
    "hueTabsIcons",
    "imgTabAbilities",
    "imgTabAttributes",
    "imgTabRoleplay",
    "imgTabItems",
    "imgTabCompanions",
    "imgTabSettings",
  ];
  static placeholders = {
    imgTabAbilities: "systems/ffxiv/assets/tab-icons/actions-and-traits.webp",
    imgTabAttributes: "systems/ffxiv/assets/tab-icons/pvp-profile.webp",
    imgTabRoleplay: "systems/ffxiv/assets/tab-icons/character.webp",
    imgTabItems: "systems/ffxiv/assets/tab-icons/inventory.webp",
    imgTabCompanions: "systems/ffxiv/assets/tab-icons/companions.webp",
    imgTabSettings: "systems/ffxiv/assets/tab-icons/system-configuration.webp",
  };
}

class FFXIVCustomTagsSettingsMenu extends FFXIVSettingsSubmenu {
  static menuId = "custom-tags-settings";
  static titleKey = "FFXIV.Settings.CustomTagsSettingsMenu";
  static settingKeys = [
    "customAbilityTags",
    "customTraitTags",
    "customConsumableTags",
  ];
  static placeholders = {
    customAbilityTags: "Arcane, Bleed, Teleport",
    customTraitTags: "Passive, Stance, Combo",
    customConsumableTags: "Elixir, Tonic, Field Kit",
  };
}

class FFXIVMigrationToolsMenu extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static menuId = "migration-tools";
  static DEFAULT_OPTIONS = {
    id: "ffxiv-migration-tools",
    classes: ["ffxiv", "settings-submenu"],
    position: {
      width: 520,
      height: "auto",
    },
    window: {
      title: "FFXIV Migration Tools",
      resizable: false,
    },
  };

  static PARTS = {
    sheet: {
      template: "systems/ffxiv/templates/migration-tools.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.currentVersion =
      game.settings.get("ffxiv", "itemMigrationVersion") || "(none)";
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._controller?.abort();
    this._controller = new AbortController();
    const { signal } = this._controller;

    this.element
      .querySelector("[data-action='run-item-migration']")
      ?.addEventListener(
        "click",
        async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!game.user.isGM) {
            ui.notifications.warn("Only a GM can run item migration.");
            return;
          }

          const runButton = event.currentTarget;
          runButton.disabled = true;
          try {
            await game.ffxivttrpg?.runItemMigration?.(true);
          } finally {
            runButton.disabled = false;
            this.render({ force: true });
          }
        },
        { signal },
      );
  }

  async _onClose(options) {
    this._controller?.abort();
    this._controller = null;
    await super._onClose(options);
  }
}

export class SettingsHelpers {
  static initSettings() {
    game.settings.register("ffxiv", "debugLogging", {
      name: game.i18n.localize("FFXIV.Settings.DebugLogging"),
      hint: game.i18n.localize("FFXIV.Settings.DebugLoggingHint"),
      scope: "client",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false,
    });

    game.settings.registerMenu("ffxiv", "soundSettingsMenu", {
      name: game.i18n.localize("FFXIV.Settings.SoundSettingsMenu"),
      label: game.i18n.localize("FFXIV.Settings.OpenSettingsMenu"),
      hint: game.i18n.localize("FFXIV.Settings.SoundSettingsMenuHint"),
      icon: "fas fa-volume-high",
      type: FFXIVSoundSettingsMenu,
      restricted: true,
    });

    game.settings.registerMenu("ffxiv", "iconSettingsMenu", {
      name: game.i18n.localize("FFXIV.Settings.IconSettingsMenu"),
      label: game.i18n.localize("FFXIV.Settings.OpenSettingsMenu"),
      hint: game.i18n.localize("FFXIV.Settings.IconSettingsMenuHint"),
      icon: "fas fa-icons",
      type: FFXIVIconSettingsMenu,
      restricted: true,
    });

    game.settings.registerMenu("ffxiv", "tabIconSettingsMenu", {
      name: game.i18n.localize("FFXIV.Settings.TabIconSettingsMenu"),
      label: game.i18n.localize("FFXIV.Settings.OpenSettingsMenu"),
      hint: game.i18n.localize("FFXIV.Settings.TabIconSettingsMenuHint"),
      icon: "fas fa-table-cells-large",
      type: FFXIVTabIconSettingsMenu,
      restricted: false,
    });

    game.settings.registerMenu("ffxiv", "customTagsSettingsMenu", {
      name: game.i18n.localize("FFXIV.Settings.CustomTagsSettingsMenu"),
      label: game.i18n.localize("FFXIV.Settings.OpenSettingsMenu"),
      hint: game.i18n.localize("FFXIV.Settings.CustomTagsSettingsMenuHint"),
      icon: "fas fa-tags",
      type: FFXIVCustomTagsSettingsMenu,
      restricted: true,
    });

    game.settings.registerMenu("ffxiv", "migrationToolsMenu", {
      name: "Migration Tools",
      label: "Open Tools",
      hint: "Run system item-data migration on demand.",
      icon: "fas fa-arrows-rotate",
      type: FFXIVMigrationToolsMenu,
      restricted: true,
    });

    game.settings.register("ffxiv", "overrideColorScheme", {
      name: game.i18n.localize("FFXIV.Settings.OverrideColorScheme"),
      hint: game.i18n.localize("FFXIV.Settings.OverrideColorSchemeHint"),
      scope: "client",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: true,
    });

    game.settings.register("ffxiv", "soundNotificationFFXIV", {
      name: "FFXIV.Settings.SoundNotificationFFXIV",
      hint: "FFXIV.Settings.SoundNotificationFFXIVHint",
      scope: "client",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false,
    });
    game.settings.register("ffxiv", "hueTabsIcons", {
      name: "FFXIV.Settings.HueTabsIcons",
      hint: "FFXIV.Settings.HueTabsIconsHint",
      scope: "client",
      config: false,
      default: false,
      type: Boolean,
      requiresReload: true,
    });

    game.settings.register("ffxiv", "toggleGear", {
      name: game.i18n.localize("FFXIV.Settings.ToggleGear"),
      hint: game.i18n.localize("FFXIV.Settings.ToggleGearHint"),
      scope: "world",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: true,
    });

    game.settings.register("ffxiv", "lockArtworkRotationGlobal", {
      name: game.i18n.localize("FFXIV.Settings.LockArtworkRotationGlobal"),
      hint: game.i18n.localize("FFXIV.Settings.LockArtworkRotationGlobalHint"),
      scope: "world",
      config: true,
      default: true,
      type: Boolean,
      onChange: (value) => {
        if (!value || !game.user?.isGM) return;
        Promise.resolve(
          game.ffxivttrpg?.applyGlobalArtworkRotationLock?.(),
        ).catch((error) =>
          console.error(
            "FFXIV | Failed to apply global artwork rotation lock",
            error,
          ),
        );
      },
      requiresReload: false,
    });

    game.settings.register("ffxiv", "legacyManaClickBehavior", {
      name: game.i18n.localize("FFXIV.Settings.LegacyManaClickBehavior"),
      hint: game.i18n.localize("FFXIV.Settings.LegacyManaClickBehaviorHint"),
      scope: "client",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: true,
    });

    game.settings.register("ffxiv", "autoRollDirectHitDamage", {
      name: game.i18n.localize("FFXIV.Settings.AutoRollDirectHitDamage"),
      hint: game.i18n.localize("FFXIV.Settings.AutoRollDirectHitDamageHint"),
      scope: "client",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false,
    });

    game.settings.register("ffxiv", "floatingDamageNumbers", {
      name: game.i18n.localize("FFXIV.Settings.FloatingDamageNumbers"),
      hint: game.i18n.localize("FFXIV.Settings.FloatingDamageNumbersHint"),
      scope: "world",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false,
    });

    game.settings.register("ffxiv", "autoApplySocketRequests", {
      name: game.i18n.localize("FFXIV.Settings.AutoApplySocketRequests"),
      hint: game.i18n.localize("FFXIV.Settings.AutoApplySocketRequestsHint"),
      scope: "world",
      config: true,
      default: false,
      type: Boolean,
      requiresReload: false,
    });

    game.settings.register("ffxiv", "customAbilityTags", {
      name: "FFXIV.Settings.CustomAbilityTags",
      hint: "FFXIV.Settings.CustomTagsHint",
      scope: "world",
      config: false,
      type: String,
      default: "",
      requiresReload: true,
    });

    game.settings.register("ffxiv", "customTraitTags", {
      name: "FFXIV.Settings.CustomTraitTags",
      hint: "FFXIV.Settings.CustomTagsHint",
      scope: "world",
      config: false,
      type: String,
      default: "",
      requiresReload: true,
    });

    game.settings.register("ffxiv", "customConsumableTags", {
      name: "FFXIV.Settings.CustomConsumableTags",
      hint: "FFXIV.Settings.CustomTagsHint",
      scope: "world",
      config: false,
      type: String,
      default: "",
      requiresReload: true,
    });

    game.settings.register("ffxiv", "itemMigrationVersion", {
      name: "Item migration version",
      hint: "Internal setting used to track one-time item data migration progress.",
      scope: "world",
      config: false,
      default: "",
      type: String,
      requiresReload: false,
    });

    game.settings.register("ffxiv", "jobsAbbrv", {
      name: game.i18n.localize("FFXIV.Settings.JobsAbbrv"),
      hint: game.i18n.localize("FFXIV.Settings.JobsAbbrvHint"),
      scope: "world",
      config: true,
      default: "MNK,DRG,NIN,BRD,MCH,BLM,SMN,WHM,SCH,AST,DRK,WAR,PLD",
      type: String,
      requiresReload: true,
    });

    game.settings.register("ffxiv", "soundNotificationFFXIV_critical", {
      name: "FFXIV.Settings.soundNotificationFFXIV_critical",
      hint: "FFXIV.Settings.soundNotificationFFXIV_Hint",
      scope: "world",
      config: false,
      default: "",
      type: String,
      requiresReload: false,
      filePicker: "media",
    });
    game.settings.register("ffxiv", "soundNotificationFFXIV_deleteItem", {
      name: "FFXIV.Settings.soundNotificationFFXIV_deleteItem",
      hint: "FFXIV.Settings.soundNotificationFFXIV_Hint",
      scope: "world",
      config: false,
      default: "systems/ffxiv/assets/sfx/ffxiv-close-window.mp3",
      type: String,
      requiresReload: false,
      filePicker: "media",
    });
    game.settings.register("ffxiv", "soundNotificationFFXIV_moveItem", {
      name: "FFXIV.Settings.soundNotificationFFXIV_moveItem",
      hint: "FFXIV.Settings.soundNotificationFFXIV_Hint",
      scope: "world",
      config: false,
      default: "systems/ffxiv/assets/sfx/ffxiv-obtain-item.mp3",
      type: String,
      requiresReload: false,
      filePicker: "media",
    });
    game.settings.register("ffxiv", "soundNotificationFFXIV_enterChat", {
      name: "FFXIV.Settings.soundNotificationFFXIV_enterChat",
      hint: "FFXIV.Settings.soundNotificationFFXIV_Hint",
      scope: "world",
      config: false,
      default: "systems/ffxiv/assets/sfx/ffxiv-full-party.mp3",
      type: String,
      requiresReload: false,
      filePicker: "media",
    });
    game.settings.register("ffxiv", "soundNotificationFFXIV_openSheet", {
      name: "FFXIV.Settings.soundNotificationFFXIV_openSheet",
      hint: "FFXIV.Settings.soundNotificationFFXIV_Hint",
      scope: "world",
      config: false,
      default: "systems/ffxiv/assets/sfx/ffxiv-switch-target.mp3",
      type: String,
      requiresReload: false,
      filePicker: "media",
    });
    game.settings.register("ffxiv", "soundNotificationFFXIV_closeSheet", {
      name: "FFXIV.Settings.soundNotificationFFXIV_closeSheet",
      hint: "FFXIV.Settings.soundNotificationFFXIV_Hint",
      scope: "world",
      config: false,
      default: "systems/ffxiv/assets/sfx/ffxiv-untarget.mp3",
      type: String,
      requiresReload: false,
      filePicker: "media",
    });

    game.settings.register("ffxiv", "attributesImgDefense", {
      name: "FFXIV.Settings.AttributesImgDefense",
      hint: "",
      scope: "world",
      config: false,
      default: "",
      type: String,
      requiresReload: true,
      filePicker: "image",
    });
    game.settings.register("ffxiv", "attributesImgMagicDefense", {
      name: "FFXIV.Settings.AttributesImgMagicDefense",
      hint: "",
      scope: "world",
      config: false,
      default: "",
      type: String,
      requiresReload: true,
      filePicker: "image",
    });
    game.settings.register("ffxiv", "attributesImgVigilance", {
      name: "FFXIV.Settings.AttributesImgVigilance",
      hint: "",
      scope: "world",
      config: false,
      default: "",
      type: String,
      requiresReload: true,
      filePicker: "image",
    });
    game.settings.register("ffxiv", "attributesImgSpeed", {
      name: "FFXIV.Settings.AttributesImgSpeed",
      hint: "",
      scope: "world",
      config: false,
      default: "",
      type: String,
      requiresReload: true,
      filePicker: "image",
    });

    game.settings.register("ffxiv", "imgTabAbilities", {
      name: "FFXIV.Settings.TabAbilitiesImg",
      hint: "FFXIV.Settings.TabAbilitiesImgHint",
      scope: "world",
      config: false,
      type: String,
      default: "",
      requiresReload: true,
      filePicker: "image",
    });
    game.settings.register("ffxiv", "imgTabAttributes", {
      name: "FFXIV.Settings.TabAttributesImg",
      hint: "FFXIV.Settings.TabAttributesImgHint",
      scope: "world",
      config: false,
      type: String,
      default: "",
      requiresReload: true,
      filePicker: "image",
    });
    game.settings.register("ffxiv", "imgTabGear", {
      name: "FFXIV.Settings.TabGearImg",
      hint: "FFXIV.Settings.TabGearImgHint",
      scope: "world",
      config: false,
      type: String,
      default: "",
      requiresReload: true,
      filePicker: "image",
    });
    game.settings.register("ffxiv", "imgTabRoleplay", {
      name: "FFXIV.Settings.TabRoleplayImg",
      hint: "FFXIV.Settings.TabRoleplayImgHint",
      scope: "world",
      config: false,
      type: String,
      default: "",
      requiresReload: true,
      filePicker: "image",
    });
    game.settings.register("ffxiv", "imgTabItems", {
      name: "FFXIV.Settings.TabItemsImg",
      hint: "FFXIV.Settings.TabItemsImgHint",
      scope: "world",
      config: false,
      type: String,
      default: "",
      requiresReload: true,
      filePicker: "image",
    });
    game.settings.register("ffxiv", "imgTabCompanions", {
      name: "FFXIV.Settings.TabCompanionsImg",
      hint: "FFXIV.Settings.TabCompanionsImgHint",
      scope: "world",
      config: false,
      type: String,
      default: "",
      requiresReload: true,
      filePicker: "image",
    });
    game.settings.register("ffxiv", "imgTabSettings", {
      name: "FFXIV.Settings.TabSettingsImg",
      hint: "FFXIV.Settings.TabSettingsImgHint",
      scope: "world",
      config: false,
      type: String,
      default: "",
      requiresReload: true,
      filePicker: "image",
    });
  }
}
