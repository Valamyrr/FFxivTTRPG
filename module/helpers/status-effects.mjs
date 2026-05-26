export const updateStatusEffects = () => {
  const createStatusEffect = (id, labelKey, icon) => ({
    id,
    name: game.i18n.localize(labelKey),
    label: labelKey,
    img: icon,
    icon
  });

  CONFIG.statusEffects = [
    createStatusEffect("ascendent", "FFXIV.Effects.Ascendent", "systems/ffxiv/assets/effects/ascendent.webp"),
    createStatusEffect("bind", "FFXIV.Effects.Bind", "systems/ffxiv/assets/effects/bind.webp"),
    createStatusEffect("blind", "FFXIV.Effects.Blind", "systems/ffxiv/assets/effects/blind.webp"),
    createStatusEffect("brink_death", "FFXIV.Effects.BrinkDeath", "systems/ffxiv/assets/effects/brink-of-death.webp"),
    createStatusEffect("comatose", "FFXIV.Effects.Comatose", "systems/ffxiv/assets/effects/comatose.webp"),
    createStatusEffect("critical_up", "FFXIV.Effects.CriticalUp", "systems/ffxiv/assets/effects/critical-up.webp"),
    createStatusEffect("death", "FFXIV.Effects.Death", "systems/ffxiv/assets/effects/death.webp"),
    createStatusEffect("dot", "FFXIV.Effects.DOT", "systems/ffxiv/assets/effects/dot.webp"),
    createStatusEffect("drain", "FFXIV.Effects.Drain", "systems/ffxiv/assets/effects/drain.webp"),
    createStatusEffect("enmity", "FFXIV.Effects.Enmity", "systems/ffxiv/assets/effects/enmity.webp"),
    createStatusEffect("heavy", "FFXIV.Effects.Heavy", "systems/ffxiv/assets/effects/heavy.webp"),
    createStatusEffect("invoking", "FFXIV.Effects.Invoking", "systems/ffxiv/assets/effects/invoking.webp"),
    createStatusEffect("knocked_out", "FFXIV.Effects.KnockedOut", "systems/ffxiv/assets/effects/knocked-out.webp"),
    createStatusEffect("paralysis", "FFXIV.Effects.Paralysis", "systems/ffxiv/assets/effects/paralysis.webp"),
    createStatusEffect("petrified", "FFXIV.Effects.Petrified", "systems/ffxiv/assets/effects/petrified.webp"),
    createStatusEffect("prone", "FFXIV.Effects.Prone", "systems/ffxiv/assets/effects/prone.webp"),
    createStatusEffect("ready", "FFXIV.Effects.Ready", "systems/ffxiv/assets/effects/ready.webp"),
    createStatusEffect("revivify", "FFXIV.Effects.Revivify", "systems/ffxiv/assets/effects/revivify.webp"),
    createStatusEffect("silence", "FFXIV.Effects.Silence", "systems/ffxiv/assets/effects/silence.webp"),
    createStatusEffect("sleep", "FFXIV.Effects.Sleep", "systems/ffxiv/assets/effects/sleep.webp"),
    createStatusEffect("slow", "FFXIV.Effects.Slow", "systems/ffxiv/assets/effects/slow.webp"),
    createStatusEffect("stun", "FFXIV.Effects.Stun", "systems/ffxiv/assets/effects/stun.webp"),
    createStatusEffect("weakness", "FFXIV.Effects.Weakness", "systems/ffxiv/assets/effects/weakness.webp")
  ];
}
