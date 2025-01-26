# FFXIV TTRPG System

This is an unofficial implementation of [Square Enix's FFXIV TTRPG](https://www.square-enix-shop.com/ffxivttrpg/en/index.html) for Foundry VTT. It has been developed on top of [asacolips's boilerplate](https://github.com/asacolips-projects/boilerplate).
There is a "[FFXIV TTRPG Fan](https://discord.gg/6EghsJdCbS)" Discord server which you can join if you want to talk about this TTRPG system.

## Known Issues

### Inventory Glitchs
When moving around items in the inventory, they may returns to the first position. There could be multiple items in the same slot too. It happens when moving an item before the callback to render the sheet happens. If it happens, closing the sheet and reopening (or any other action forcing the sheet to re-render) should fix the issue.

## Contributing
This project is opened to PR. I am the only maintainer of this project, so please understand that you might need to send me messages on Discord if your PR does not get attention. It's entirely possible I miss notifications.

## Roadmap
This is what is currently planned. Feel free to ask me for any other feature you would like to see on this project.

### CSS for item Sheets (done on last commits)
Re-design item sheets. There are currently two kind of sheets: editable and non-editable. The non-editable one has ugly buttons and could use tabs for descriptions, specific information or later attached bonus for characters' DerivedData.

### Handle rolls
Making roll buttons on abilities and items clickable, as well as cleaning the animation. Roll must use the correct attribute if specified.

### Variablize css
Clean CSS files to use variables defined in `vars.css`, which are not always used, thus making dark/light themes usable (currently, only the dark theme is really supported).

### Attributes from Items
Making items (titles, consumables, any homebrew) have a list of attached bonuses. For example, an equipped title "Vigilant" could give +3 Viligance to a character and making it visible on the sheet (kind of "11 | 3" in two separate cells).

### French translation
Cocorico ! Actually, any string is already translated from labels to English, so it should be easy to do so in any language. French has already been started.

### Sounds
Adding a soundboard to the gamemaster's tools.

## Attributions
- game icons from [ffxiv's fan kit](https://fr.finalfantasyxiv.com/lodestone/special/fankit/icon/)
- game icons from [gamerescape's dictionary](https://ffxiv.gamerescape.com/wiki/Dictionary_of_Icons#Player_Icons)
- banner.jpg is the official artwork by Sqare Enix for FFXIV TTRPG
- anvil-impact.png by Lorc under CC BY 3.0 from game-icons.net
- meteor.png by Doctor-Cool from deviantart.com
