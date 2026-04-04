export const updateStatusEffects = () => {
  const createStatusEffect = (id, labelKey, icon) => ({
    id,
    name: game.i18n.localize(labelKey),
    label: labelKey,
    img: icon,
    icon
  });

  CONFIG.statusEffects = [
    createStatusEffect("ascendent", "FFXIV.Effects.Ascendent", "systems/ffxiv/assets/effects/Ascendent.png"),
    createStatusEffect("bind", "FFXIV.Effects.Bind", "systems/ffxiv/assets/effects/Bind.png"),
    createStatusEffect("blind", "FFXIV.Effects.Blind", "systems/ffxiv/assets/effects/Blind.png"),
    createStatusEffect("brink_death", "FFXIV.Effects.BrinkDeath", "systems/ffxiv/assets/effects/Brink of Death.png"),
    createStatusEffect("comatose", "FFXIV.Effects.Comatose", "systems/ffxiv/assets/effects/Comatose.png"),
    createStatusEffect("critical_up", "FFXIV.Effects.CriticalUp", "systems/ffxiv/assets/effects/Critical Up.png"),
    createStatusEffect("death", "FFXIV.Effects.Death", "systems/ffxiv/assets/effects/Death.png"),
    createStatusEffect("dot", "FFXIV.Effects.DOT", "systems/ffxiv/assets/effects/DOT.png"),
    createStatusEffect("drain", "FFXIV.Effects.Drain", "systems/ffxiv/assets/effects/Drain.png"),
    createStatusEffect("enmity", "FFXIV.Effects.Enmity", "systems/ffxiv/assets/effects/Enmity.png"),
    createStatusEffect("heavy", "FFXIV.Effects.Heavy", "systems/ffxiv/assets/effects/Heavy.png"),
    createStatusEffect("invoking", "FFXIV.Effects.Invoking", "systems/ffxiv/assets/effects/Invoking.png"),
    createStatusEffect("knocked_out", "FFXIV.Effects.KnockedOut", "systems/ffxiv/assets/effects/Knocked Out.png"),
    createStatusEffect("paralysis", "FFXIV.Effects.Paralysis", "systems/ffxiv/assets/effects/Paralysis.png"),
    createStatusEffect("petrified", "FFXIV.Effects.Petrified", "systems/ffxiv/assets/effects/Petrified.png"),
    createStatusEffect("prone", "FFXIV.Effects.Prone", "systems/ffxiv/assets/effects/Prone.png"),
    createStatusEffect("ready", "FFXIV.Effects.Ready", "systems/ffxiv/assets/effects/Ready.png"),
    createStatusEffect("revivify", "FFXIV.Effects.Revivify", "systems/ffxiv/assets/effects/Revivify.png"),
    createStatusEffect("silence", "FFXIV.Effects.Silence", "systems/ffxiv/assets/effects/Silence.png"),
    createStatusEffect("sleep", "FFXIV.Effects.Sleep", "systems/ffxiv/assets/effects/Sleep.png"),
    createStatusEffect("stun", "FFXIV.Effects.Stun", "systems/ffxiv/assets/effects/Stun.png"),
    createStatusEffect("weakness", "FFXIV.Effects.Weakness", "systems/ffxiv/assets/effects/Weakness.png")
  ];
}
