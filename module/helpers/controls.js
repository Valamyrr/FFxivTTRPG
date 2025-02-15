export const register_controls = (controls) => {
  console.log("FF XIV Controls | Initializing");
  if (canvas === null) {
    return;
  }

  const ffxiv_controls = {
    name: "ffxiv-controls",
    title: game.i18n.localize("FFXIV.Controls.FFXIVTools"),
    icon: "fa-solid fa-scroll",
    layer: "controls",
    visible: game.user.isGM,
    tools:[
      {
        name: "soundboard",
        title: game.i18n.localize("FFXIV.Controls.Soundboard"),
        icon: "fas fa-music",
        onClick: () => FFXIVSoundboard.showWindow(),
        button: true,
      }
    ]

  }
  console.log(controls)
  controls.push(ffxiv_controls)
  console.log(controls)

}

class FFXIVSoundboard {
    static async showWindow() {
        // Fetch available tracks
        const soundFiles = await FilePicker.browse("data", "systems/ffxiv/assets/sounds/soundboard");

        if (!soundFiles || !soundFiles.files.length) {
            ui.notifications.warn(game.i18n.localize("FFXIV.Notifications.NoSoundAvailable"));
            return;
        }

        let content = `<div style="max-height: 450px; overflow-y: auto;overflow-x:none">`;
        soundFiles.files.forEach((file) => {
            const fileName = file.split("/").pop();
            content += `
                <div class="sound-entry">
                    <strong>${fileName}</strong>
                    <button class="play-sound" data-src="${file}">
                        <i class="fas fa-play"></i> Play
                    </button>
                </div>
            `;
        });
        content += `</div>`;

        new Dialog({
            title: "FF XIV Soundboard",
            content: content,
            buttons: {
                close: {
                    label: "Close",
                    callback: () => {},
                },
            },
            render: (html) => {
                html.find(".play-sound").on("click", (event) => {
                    const soundSrc = event.currentTarget.dataset.src;
                    AudioHelper.play({ src: soundSrc, volume: 1.0, autoplay: true, loop: false }, true);
                });
            },
        }).render(true);
    }
}
