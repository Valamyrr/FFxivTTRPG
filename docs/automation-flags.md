# Ability Automation Reference

Use this reference when building or changing an ability's automation in FFXIV 5.5.0. Configure abilities through their sheets and linked effect editors. Direct flag edits and Script macros are a last resort for settings that have no editor yet.

Flag tables omit the `flags.ffxiv.` prefix unless they list full Active Effect change keys. For example, `critical.force` means `flags.ffxiv.critical.force`.

## Contents

- [Flag index](#flag-index)
- [Building an ability](#building-an-ability)
- [Choosing where to put the automation](#choosing-where-to-put-the-automation)
- [Checks and roll formulas](#checks-and-roll-formulas)
- [Criticals and direct-hit options](#criticals-and-direct-hit-options)
- [Damage and healing application](#damage-and-healing-application)
- [MP costs and recovery](#mp-costs-and-recovery)
- [Job resources and ability branches](#job-resources-and-ability-branches)
- [Effect identity, application, and expiration](#effect-identity-application-and-expiration)
- [Active Effect change keys](#active-effect-change-keys)
- [Encounter and turn rules](#encounter-and-turn-rules)
- [System-managed flags](#system-managed-flags)
- [Troubleshooting and source map](#troubleshooting-and-source-map)
- [Advanced: setting flags with macros](#advanced-setting-flags-with-macros)

## Flag index

Use Find (`Ctrl+F`) to search a full path, a short flag name, or a behavior such as "barrier" or "MP". Each row links to the relevant section.

Sheet means there is a control on the ability or trait sheet. Change means an Active Effect change row. Advanced means the data is supported but has no dedicated sheet control. Internal flags are maintained by the system; UI flags belong to hotbar controls. Form only entries are input names, not stored flags.

This index covers the system-owned `flags.ffxiv` paths read or written by the current source, including aliases and expanded change keys. Object and array flags are indexed by their root; fields within rule entries are described in the linked sections. `<statusId>` and `<normalizedResourceKey>` stand for dynamic keys. Foundry core flags and flags owned by other modules are outside this reference.

| Full path | Stored on | Editor / use | Purpose |
| --- | --- | --- | --- |
| `flags.ffxiv.abilityBranches` | Ability | Advanced | [Alias for branches.](#job-resources-and-ability-branches) |
| `flags.ffxiv.abilityEffectRule` | Active Effect | Internal | [Effect created by an automation rule.](#system-managed-flags) |
| `flags.ffxiv.activeEffectLinked` | Trait Item | Internal | [Marks an effect-linked trait Item; stored on the Item.](#system-managed-flags) |
| `flags.ffxiv.applyAction` | Linked effect | Sheet | [Add or remove the linked effect.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.applyTo` | Linked effect | Sheet | [Application scope: self, self_auto, target, or automation.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.augmentId` | Granted Item | Internal | [Augment that granted the Item.](#system-managed-flags) |
| `flags.ffxiv.augmentSourceUuid` | Granted Item | Internal | [Original augment grant UUID.](#system-managed-flags) |
| `flags.ffxiv.barrier` | Ability | Sheet | [Barrier configuration object.](#barriers) |
| `flags.ffxiv.barrier.applyTo` | Ability | Sheet | [Healing barrier recipient: self or target. Fixed grants also save their recipient in the resource rule.](#barriers) |
| `flags.ffxiv.barrier.expireAtSourceTurnStart` | Ability | Sheet | [Expire a locked barrier at the source actor's next turn start.](#barriers) |
| `flags.ffxiv.barrier.lock` | Ability | Sheet | [Block new barrier grants while the tracking effect exists.](#barriers) |
| `flags.ffxiv.barrier.onDepleted` | Ability | Sheet | [Resource grants when a locked barrier reaches zero.](#barriers) |
| `flags.ffxiv.barrier.onHealing` | Ability | Sheet | [Also grant a barrier when applying healing.](#barriers) |
| `flags.ffxiv.barrier.operation` | Ability | Sheet | [Grant, replace, or keep the larger barrier.](#barriers) |
| `flags.ffxiv.barrierLock` | Active Effect | Internal | [Barrier tracking data; deleting this effect can clear the barrier.](#system-managed-flags) |
| `flags.ffxiv.barrierLock.onDepleted` | Active Effect | Internal | [Resource grants copied from the source ability.](#system-managed-flags) |
| `flags.ffxiv.barrierLock.sourceActorUuid` | Active Effect | Internal | [Actor that granted the locked barrier.](#system-managed-flags) |
| `flags.ffxiv.baseFormula.override` | Ability | Sheet | [Conditional base roll formula replacement.](#baseformulaoverride) |
| `flags.ffxiv.baseFormula.override.formula` | Ability sheet | Form only | [Form input saved inside a baseFormula.override rule.](#baseformulaoverride) |
| `flags.ffxiv.baseFormula.override.threshold` | Ability sheet | Form only | [Form input saved as a target HP condition, not as a threshold flag.](#baseformulaoverride) |
| `flags.ffxiv.branch` | Linked effect | Advanced | [Ability branch that uses this effect.](#job-resources-and-ability-branches) |
| `flags.ffxiv.branches` | Ability | Advanced | [Additional ability branch buttons.](#job-resources-and-ability-branches) |
| `flags.ffxiv.branchKey` | Linked effect | Advanced | [Alias for branch.](#job-resources-and-ability-branches) |
| `flags.ffxiv.check.advantage` | Applicable effect | Advanced | [Additional advantage dice; also supported as a change row.](#checks-and-roll-formulas) |
| `flags.ffxiv.check.ignoreStatuses` | Applicable effect | Advanced | [Ignore specified status check penalties and supported interruption checks.](#checks-and-roll-formulas) |
| `flags.ffxiv.check.penalty` | Actor effect | Advanced | [Check penalty; the largest absolute penalty applies.](#checks-and-roll-formulas) |
| `flags.ffxiv.comboFromMigration20` | Item | Internal / Legacy | [Older combo conversion marker.](#system-managed-flags) |
| `flags.ffxiv.comboFromMigration22` | Item | Internal / Legacy | [Combo conversion marker.](#system-managed-flags) |
| `flags.ffxiv.countsAs` | Active Effect | Advanced | [Additional effect identities.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.critical.force` | Ability or applicable effect | Sheet / Advanced | [Force a critical, optionally with conditions. Ability rules have sheet controls.](#criticalforce) |
| `flags.ffxiv.damage.application` | Target applicable effect | Advanced | [Rules modifying applied incoming damage.](#damageapplication) |
| `flags.ffxiv.damage.incoming.flat` | Applicable effect | Advanced / Change | [Flat adjustment to incoming damage.](#numeric-damage-channels) |
| `flags.ffxiv.damage.incoming.mult` | Applicable effect | Advanced / Change | [Multiplier for incoming damage.](#numeric-damage-channels) |
| `flags.ffxiv.damage.outgoing.flat` | Applicable effect | Advanced / Change | [Flat adjustment to outgoing damage.](#numeric-damage-channels) |
| `flags.ffxiv.damage.outgoing.mult` | Applicable effect | Advanced / Change | [Multiplier for outgoing damage.](#numeric-damage-channels) |
| `flags.ffxiv.damage.self.flat` | Applicable effect | Advanced / Change | [Flat adjustment to self damage.](#numeric-damage-channels) |
| `flags.ffxiv.damage.self.mult` | Applicable effect | Advanced / Change | [Multiplier for self damage.](#numeric-damage-channels) |
| `flags.ffxiv.damageDice.alternate.minimum` | Effect change row | Change | [Minimum per die for alternate rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageDice.base.minimum` | Effect change row | Change | [Minimum per die for base rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageDice.direct.minimum` | Effect change row | Change | [Minimum per die for direct rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageDice.minimum` | Applicable effect | Advanced | [Highest qualifying minimum per die; also a change key.](#checks-and-roll-formulas) |
| `flags.ffxiv.damageFormula` | Applicable effect | Advanced | [Additional formula and flat terms, with optional roll/tag filters.](#checks-and-roll-formulas) |
| `flags.ffxiv.damageFormula.alternate.flat` | Effect change row | Change | [Additional flat term for alternate rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.alternate.formula` | Effect change row | Change | [Additional formula term for alternate rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.alternate.requiredTags` | Effect change row | Change | [Any matching tag enables the corresponding formula/flat rows.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.alternate.tags` | Effect change row | Change | [Alias for the corresponding requiredTags change key.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.base.flat` | Effect change row | Change | [Additional flat term for base rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.base.formula` | Effect change row | Change | [Additional formula term for base rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.base.requiredTags` | Effect change row | Change | [Any matching tag enables the corresponding formula/flat rows.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.base.tags` | Effect change row | Change | [Alias for the corresponding requiredTags change key.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.direct.flat` | Effect change row | Change | [Additional flat term for direct rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.direct.formula` | Effect change row | Change | [Additional formula term for direct rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.direct.requiredTags` | Effect change row | Change | [Any matching tag enables the corresponding formula/flat rows.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.direct.tags` | Effect change row | Change | [Alias for the corresponding requiredTags change key.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.flat` | Effect change row | Change | [Additional flat term for supported rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.formula` | Effect change row | Change | [Additional formula term for supported rolls.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.requiredTags` | Effect change row | Change | [Any matching tag enables the corresponding formula/flat rows.](#active-effect-change-keys) |
| `flags.ffxiv.damageFormula.tags` | Effect change row | Change | [Alias for the corresponding requiredTags change key.](#active-effect-change-keys) |
| `flags.ffxiv.directHit.options` | Applicable effect | Advanced | [Additional named direct-hit roll options.](#directhitoptions) |
| `flags.ffxiv.effectAliases` | Active Effect | Advanced | [Additional effect identities, read alongside countsAs.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.effectKey` | Active Effect | Advanced | [Stable effect matching key.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.eliteFoeEffect` | Active Effect | Internal | [System-maintained elite foe effect marker.](#system-managed-flags) |
| `flags.ffxiv.encounterStart` | Owned Item | Advanced | [Rules at encounter start; requires Full automation.](#encounter-and-turn-rules) |
| `flags.ffxiv.enmity.checkPenalty` | Active Effect | Advanced | [Enmity check penalty; normally assigned by status application.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.enmity.sourceActorUuid` | Active Effect | Advanced | [Actor that applied enmity; normally assigned by status application.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.enmityPhase` | Active Effect | Internal | [Combat, round, and phase in which enmity was applied.](#system-managed-flags) |
| `flags.ffxiv.equivalentEffects` | Active Effect | Advanced | [Additional effect identities, read alongside countsAs.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.expireAtCombatantTurnEnd` | Active Effect | Advanced | [Remove at a specified combatant turn end; see descriptor format.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.expireAtCombatantTurnStart` | Active Effect | Advanced | [Remove at a specified combatant's later turn start; see descriptor format.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.expireAtRoundEnd` | Active Effect | Advanced | [Remove at round end.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.expireAtTurnEnd` | Active Effect | Advanced | [Remove at the affected actor's turn end.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.expireAtTurnStart` | Active Effect | Advanced | [Remove at the affected actor's turn start.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.healing.application` | Source ability | Compatibility | [Older healing application rules; conditional formula replacements use baseFormula.override.](#healingapplication-compatibility) |
| `flags.ffxiv.hotbar` | Actor | UI | [Actor hotbar slot assignments; edit through the hotbar.](#system-managed-flags) |
| `flags.ffxiv.hotbarExtra` | User | UI | [Extra hotbar slot assignments when no actor is active.](#system-managed-flags) |
| `flags.ffxiv.hotbarSettings` | Actor or User | UI | [Hotbar display settings; edit through the hotbar.](#system-managed-flags) |
| `flags.ffxiv.hotbarSettings.visibleHotbars` | Actor or User | UI | [Visible hotbar rows, from 1 to 5.](#system-managed-flags) |
| `flags.ffxiv.jobId` | Granted Item or pet Actor | Internal | [Job Item that granted the document.](#system-managed-flags) |
| `flags.ffxiv.jobOwnerId` | Granted pet Actor | Internal | [Actor owning the job that granted this pet.](#system-managed-flags) |
| `flags.ffxiv.jobResource` | Resource Item | Sheet / Advanced | [Resource lookup names and display metadata.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.bonus` | Ability | Sheet | [Optional resource-spending bonus rolls.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.bonuses` | Ability | Sheet | [Compatibility alias for jobResource.bonus.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.clearOnAction` | Owned trait | Advanced | [Clear a volatile resource unless the action preserves or consumes it.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.key` | Resource Item | Sheet / Advanced | [Additional resource lookup key.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.keys` | Resource Item | Sheet / Advanced | [Additional resource keys.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.label` | Resource Item | Sheet / Advanced | [Preferred display label.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.name` | Resource Item | Sheet / Advanced | [Resource name; editable on the trait sheet.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.names` | Resource Item | Sheet / Advanced | [Additional resource names.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.onCritical` | Owned trait | Advanced | [Resource grants after critical checks.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.preserveOnAction` | Ability | Advanced | [Resource names preserved by this action.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.resource` | Resource Item | Sheet / Advanced | [Additional resource lookup name.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResource.resources` | Resource Item | Sheet / Advanced | [Additional resource lookup names.](#job-resources-and-ability-branches) |
| `flags.ffxiv.jobResourceCosts` | Active Effect | Internal | [Resource costs recorded by an automation rule.](#system-managed-flags) |
| `flags.ffxiv.jobResourceCosts.<normalizedResourceKey>` | Active Effect | Internal | [Recorded expenditure for a particular resource.](#system-managed-flags) |
| `flags.ffxiv.jobSourceUuid` | Granted Item or pet Actor | Internal | [Original job grant UUID.](#system-managed-flags) |
| `flags.ffxiv.knockedOutFromDefeated` | Combatant | Internal | [Knocked out status added by the defeated toggle.](#system-managed-flags) |
| `flags.ffxiv.linkedAutoApply` | Active Effect | Internal | [Whether this linked effect was automatically applied.](#system-managed-flags) |
| `flags.ffxiv.linkedAutomationTemplate` | Active Effect | Internal | [Effect copied from a linked automation template.](#system-managed-flags) |
| `flags.ffxiv.linkedSourceActorUuid` | Active Effect | Internal | [Source actor UUID.](#system-managed-flags) |
| `flags.ffxiv.linkedSourceEffectId` | Active Effect | Internal | [Original linked effect ID.](#system-managed-flags) |
| `flags.ffxiv.linkedSourceItemId` | Active Effect | Internal | [Source Item ID.](#system-managed-flags) |
| `flags.ffxiv.linkedSourceItemUuid` | Active Effect | Internal | [Source Item UUID.](#system-managed-flags) |
| `flags.ffxiv.linkedTraitId` | Active Effect | Internal | [Linked trait Item ID.](#system-managed-flags) |
| `flags.ffxiv.linkedTraitName` | Active Effect | Internal | [Linked trait display name.](#system-managed-flags) |
| `flags.ffxiv.linkedTraitUuid` | Active Effect | Internal | [Linked trait Item UUID.](#system-managed-flags) |
| `flags.ffxiv.markerPlacement` | Region or Tile | Internal | [Ability marker placement and rendering data.](#system-managed-flags) |
| `flags.ffxiv.markerPlacement.followRotation` | Region or Tile | Internal | [Marker placement setting: followRotation.](#system-managed-flags) |
| `flags.ffxiv.markerPlacement.mode` | Region or Tile | Internal | [Marker placement setting: mode.](#system-managed-flags) |
| `flags.ffxiv.markerPlacement.opacity` | Region or Tile | Internal | [Marker placement setting: opacity.](#system-managed-flags) |
| `flags.ffxiv.markerPlacement.targeted` | Region or Tile | Internal | [Marker placement setting: targeted.](#system-managed-flags) |
| `flags.ffxiv.markerPlacement.tokenId` | Tile | Internal | [Marker placement setting: tokenId.](#system-managed-flags) |
| `flags.ffxiv.migratedTrait` | Item | Internal / Legacy | [Trait created by a legacy conversion.](#system-managed-flags) |
| `flags.ffxiv.mpCost.reduction` | Owned Item or applicable effect | Advanced | [Compatibility alias for mpCost.reductions.](#mpcostreductions) |
| `flags.ffxiv.mpCost.reduction.abilityName` | Effect change row | Change | [Ability name/key filter for the MP cost override.](#active-effect-change-keys) |
| `flags.ffxiv.mpCost.reduction.abilityNames` | Effect change row | Change | [Ability name/key filter for the MP cost override.](#active-effect-change-keys) |
| `flags.ffxiv.mpCost.reduction.item` | Effect change row | Change | [Ability name/key filter for the MP cost override.](#active-effect-change-keys) |
| `flags.ffxiv.mpCost.reduction.items` | Effect change row | Change | [Ability name/key filter for the MP cost override.](#active-effect-change-keys) |
| `flags.ffxiv.mpCost.reduction.override` | Effect change row | Change | [Override MP cost for matching abilities.](#active-effect-change-keys) |
| `flags.ffxiv.mpCost.reductions` | Owned Item or applicable effect | Advanced | [MP overrides or resource-spending cost reductions.](#mpcostreductions) |
| `flags.ffxiv.mpRecovery` | Owned Item or applicable effect | Advanced | [Adventurer Step MP recovery settings.](#mprecovery) |
| `flags.ffxiv.mpRecovery.flat` | Owned Item or applicable effect | Advanced / Change | [Flat recovery adjustment.](#mprecovery) |
| `flags.ffxiv.mpRecovery.maxRound` | Owned Item or applicable effect | Advanced | [Round condition on recovery settings and their change rows.](#mprecovery) |
| `flags.ffxiv.mpRecovery.minRound` | Owned Item or applicable effect | Advanced | [Round condition on recovery settings and their change rows.](#mprecovery) |
| `flags.ffxiv.mpRecovery.mult` | Owned Item or applicable effect | Advanced / Change | [Recovery multiplier.](#mprecovery) |
| `flags.ffxiv.mpRecovery.onDamage` | Applicable effect | Advanced | [MP recovery per positive target damage result, with optional tags.](#mprecoveryondamage) |
| `flags.ffxiv.mpRecovery.onDamage.amount` | Effect change row | Change | [MP recovered per positive target damage result.](#active-effect-change-keys) |
| `flags.ffxiv.mpRecovery.override` | Owned Item or applicable effect | Advanced / Change | [Override final recovery.](#mprecovery) |
| `flags.ffxiv.mpRecovery.round` | Owned Item or applicable effect | Advanced | [Round condition on recovery settings and their change rows.](#mprecovery) |
| `flags.ffxiv.mpRecovery.suppress` | Owned Item or applicable effect | Advanced / Change | [Suppress recovery.](#mprecovery) |
| `flags.ffxiv.petrifiedAppliedTurn` | Actor | Internal | [Turn in which petrified was applied.](#system-managed-flags) |
| `flags.ffxiv.requirementBypass` | Actor effect | Advanced | [Bypass specified named-effect requirements.](#job-resources-and-ability-branches) |
| `flags.ffxiv.selfAutoLinkedEffectsApplied` | Chat message | Internal | [Prevents repeated self-effect application.](#system-managed-flags) |
| `flags.ffxiv.sourceItemUuid` | Active Effect | Internal | [Item that created the automation effect.](#system-managed-flags) |
| `flags.ffxiv.stackCount` | Active Effect | Advanced | [Legacy fallback status stack count.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.statusStacks.<statusId>` | Active Effect | Advanced | [Stack count for the specified status; prefer status controls.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.stunnedInEncounter` | Actor | Internal | [Encounter stun tracking.](#system-managed-flags) |
| `flags.ffxiv.summon` | Token | Internal | [Summon source and actor links.](#system-managed-flags) |
| `flags.ffxiv.summon.actorUuid` | Token | Internal | [Summon linkage: actorUuid.](#system-managed-flags) |
| `flags.ffxiv.summon.sourceActorUuid` | Token | Internal | [Summon linkage: sourceActorUuid.](#system-managed-flags) |
| `flags.ffxiv.summon.sourceItemName` | Token | Internal | [Summon linkage: sourceItemName.](#system-managed-flags) |
| `flags.ffxiv.summon.sourceItemUuid` | Token | Internal | [Summon linkage: sourceItemUuid.](#system-managed-flags) |
| `flags.ffxiv.summon.sourceTokenId` | Token | Internal | [Summon linkage: sourceTokenId.](#system-managed-flags) |
| `flags.ffxiv.summoned` | Token | Internal | [Token created by an ability summon.](#system-managed-flags) |
| `flags.ffxiv.target.check.advantage` | Target actor effect | Advanced | [Advantage granted to checks against this target.](#checks-and-roll-formulas) |
| `flags.ffxiv.targetDefense.useLower` | Applicable effect | Advanced | [Use the lower target defense.](#checks-and-roll-formulas) |
| `flags.ffxiv.thunderSpell` | Active Effect | Advanced | [Thunder-tagged effect identity used in source-based DoT handling.](#effect-identity-application-and-expiration) |
| `flags.ffxiv.turnEnd` | Owned Item | Advanced | [Rules at turn end; requires Full automation.](#encounter-and-turn-rules) |
| `flags.ffxiv.turnStart` | Owned Item | Advanced | [Rules at turn start; requires Full automation.](#encounter-and-turn-rules) |

## Building an ability

1. Set the ability's check, target, MP cost, and roll formulas on its sheet. Keep damage and healing descriptions alongside the formulas they describe.
2. Configure statuses, linked Active Effects, resource costs, and effect requirements using the sheet's automation controls. These cover much of an ability's normal behavior without macros.
3. Configure conditional base formulas, forced criticals, barrier behavior, and resource bonus rolls on the ability sheet. Use the linked effect editor for buff and debuff modifiers. The flag tables describe the stored data and settings that do not have sheet controls yet.
4. Test the ability from an owned actor with the intended targets selected. Check its cost, check roll, damage or healing roll, Apply buttons, and any effects it grants or consumes.

The sheet saves automation rules, requirements, and flags for you. You do not need to run commands to configure the controls described below.

| What the ability needs to do | Where to look |
| --- | --- |
| Roll a check, damage, or healing | Ability sheet check and formula fields |
| Apply a status, grant or remove an effect, spend a resource, or require an effect | Ability sheet automation controls |
| Force a critical | Rolls tab: Critical Hits |
| Offer another direct-hit option | [Direct-hit options](#directhitoptions), advanced configuration without a sheet editor |
| Replace a base formula depending on the target's HP | Ability sheet: conditional base formula and HP threshold |
| Grant a barrier when healing, lock a barrier, or grant a resource when it breaks | Resources tab: Barrier |
| Reduce an MP cost or recover MP after damage | [MP costs and recovery](#mp-costs-and-recovery) |
| Add a resource-spending roll or an alternate branch button | [Job resources and ability branches](#job-resources-and-ability-branches) |
| Grant a buff that changes later checks or damage rolls | [Checks and roll formulas](#checks-and-roll-formulas) |
| Grant a defensive effect that changes incoming damage | [Damage and healing application](#damage-and-healing-application) |
| Choose who receives a linked effect or when it expires | [Effect identity, application, and expiration](#effect-identity-application-and-expiration) |

## Choosing where to put the automation

An ability can have its own flags and also grant effects with different flags. The location determines when the behavior applies.

- Flags such as `critical.force`, `baseFormula.override`, `branches`, and `barrier.onHealing` can configure the ability Item itself.
- A buff that grants advantage or extra damage needs those modifiers on an applicable Active Effect. Configure the ability to grant that effect to the intended recipient. The modifier then affects that recipient's rolls while the effect applies.
- A defensive effect belongs on the actor receiving the protection. For example, `damage.application` changes damage taken by the actor carrying the effect.
- Trait flags provide ongoing resource rules or bonuses. Encounter and turn flags handle combat timing rather than an individual ability use.

### Example: an ability that always critically hits

Open the Rolls tab in edit mode. Under Critical Hits, choose Automated. Choose which roll it applies to. Leave Active Effect blank for an unconditional critical.

For a conditional critical, select effects under Active Effect. Selected effects appear as tags; at least one must be active. Available choices include statuses and effects on the actor, its abilities, and world Items. Existing saved references remain selectable. Advanced contains Required Effects, Blocking Effects, Ability Tags, and Ability Names; these text fields accept comma-separated names. All supplied filters must pass. Use Add Case for an alternative condition or Remove Case inside Advanced to delete one. Choose Normal to remove the override entirely.

### Example: an ability that grants a damage buff

Create a linked Active Effect on the ability and configure it to be granted to self or target through the ability's effect controls. Add this change row to the effect:

| Key | Mode | Value |
| --- | --- | --- |
| `flags.ffxiv.damageFormula.base.formula` | Custom | `1d6` |

Once the effect is applied, it adds `1d6` to the recipient's base damage rolls. Set the effect's duration or expiration to match the ability. It applies to qualifying rolls while active, so use the tag filters in [Active Effect change keys](#active-effect-change-keys) if the bonus should only affect certain abilities.

## Checks and roll formulas

Set the following flags directly on the effect. Supported change-row equivalents are listed under [Active Effect change keys](#active-effect-change-keys).

| Flag | Put it on | Value and behavior |
| --- | --- | --- |
| `check.advantage` | Applicable effect | Number or object/array of objects such as `{ "amount": 1, "tags": ["spell"] }`. Adds qualifying amounts. `value` aliases `amount`. |
| `check.penalty` | Actor effect | Number. Uses the largest absolute penalty across effects, normalized negative; penalties do not sum. |
| `target.check.advantage` | Target's actor effect | Number. Sums on each target; the ability uses the highest target total. |
| `check.ignoreStatuses` | Applicable effect | Status ID string, object, or array, e.g. `["paralysis"]` or `[{ "statuses": ["paralysis"], "abilities": ["My Ability"] }]`. Ignores matching status check penalties; paralysis also has an interruption check that consults this flag. Does not remove the status. |
| `targetDefense.useLower` | Applicable effect | `true`, or object/array such as `{ "enabled": true, "tags": ["spell"] }`. Uses the lower target defense. `value` aliases `enabled`. |
| `damageDice.minimum` | Applicable effect | Object/array, e.g. `[{ "minimum": 3, "rolls": ["base"] }]`. Takes the highest qualifying minimum. A bare numeric direct flag is not accepted by the object filter; use an object or a change row. |
| `damageFormula` | Applicable effect | Object/array, e.g. `[{ "formula": "1d6", "flat": 2, "rolls": ["base"] }]`. Appends both formula and flat terms. |

For `damageFormula` and `damageDice.minimum`, optional `rolls` (aliases `rollTypes`, `appliesTo`) restrict to `base`, `direct`, or `alternate`. Omit to apply to all supported roll types. Optional `tags`/`tag` accepts a string or array and requires any matching ability tag. Dice minimums add Foundry's `minN` modifier to simple dice terms; terms already using certain dice modifiers are skipped.

For `check.ignoreStatuses`, an object can use `statuses`/`status`/`ids`/`id`, optional `tags`/`tag`, and optional ability restrictions `abilities`/`abilityKeys`/`items`/`itemKeys`. Status IDs must match the system's IDs exactly.

## Criticals and direct-hit options

### `critical.force`

For rules on the ability itself, use Critical Hits on the Rolls tab. The fields below describe what those controls save. Rules carried by an Active Effect use the same format; effect consumption only applies to a rule on an actor effect.

Set this on the ability Item or an applicable effect. Use `true` to always force a critical, or an object or array to add conditions. This example forces a critical base roll and consumes the effect afterward:

```json
[{ "always": true, "rolls": ["base"], "consume": true }]
```

| Field | Meaning |
| --- | --- |
| `always` | Makes an unconditional rule usable. |
| `rolls` | Roll type restriction. Aliases: `rollTypes`, `appliesTo`, `roll`. `all`/`any` also qualify. |
| `abilityNames` | One or more matching ability names/content keys. Aliases: `abilityName`, `items`, `item`. |
| `tags` / `tag` | Optional ability tag filter. |
| `requires` | All named effects must be present. |
| `requiresAny` | At least one named effect must be present when supplied. |
| `forbids` | None of these named effects may be present. |
| `consume` / `remove` | If `true`, consumes the originating actor effect when the critical base-roll path resolves. Does not delete an ability Item or a transferred effect that is not in `actor.effects`. |

A rule needs `always`, an effect condition, a roll restriction, or an ability restriction to be usable; tags alone do not make it usable. The first matching rule is selected.

### `directHit.options`

Adds named direct-hit options to single-target abilities that have a direct roll. Set it on an applicable effect as an array or a keyed object of options. A single option still needs the surrounding array:

```json
[{ "key": "empowered", "name": "Empowered", "mpCost": 1,
   "diceTransform": { "faces": 6, "failureFaces": 3, "successValue": 6 } }]
```

Entries support `key`, `name`, `buttonLabel`, `criticalButtonLabel`, `flavorLabel`, `mpCost` (alias `cost`), and optional `tags`/`tag`. `diceTransform` (alias `formulaTransform`) accepts an object or array. Each transform uses `faces`/`dieFaces`, `failureFaces`/`zeroFaces`, and `successValue`/`value`. Only an equal split between success and failure faces is supported; matching plain dice become a binary zero-or-success-value roll. Options require sufficient MP when offered.

## Damage and healing application

### Numeric damage channels

On applicable effects, `damage.incoming.flat` / `.mult`, `damage.outgoing.flat` / `.mult`, and `damage.self.flat` / `.mult` accept numbers. Flat flags sum and multiplier flags multiply. `incoming` belongs to the damaged actor, `outgoing` to the source, and `self` is consulted for self-damage. These modify applied damage, separately from dice/formula modifiers. They do not take tag-filter objects.

### `damage.application`

Set this on an applicable effect belonging to the actor taking damage. Each rule changes the damage left after the previous rule. This example prevents half the damage, rounded up, and consumes the effect:

```json
[{ "operation": "subtract", "percent": 50, "consume": true }]
```

Amount priority is `percent` (percentage of current damage, rounded up), `fraction` (fraction of current damage, rounded up), `formula`, then `amount`/`flat`/`value`. Formulas receive `@damage` plus source Item, source Actor, or target Actor roll data, in that priority. Operation defaults to `subtract`; also supports `override`/`replace`/`set`, `multiply`, and `add`/`grant`. `consume`/`remove: true` schedules the originating actor effect for deletion through damage application.

Optional filters: `sourceNames` (aliases `sourceName`, `sourceAbilities`, `sourceAbility`) matches the source Item; `sourceActorNames` (aliases `sourceActorName`, `sourceActors`, `sourceActor`) matches its actor; `sourceTags` (aliases `tags`, `tag`) requires any matching source Item tag. Name filters accept a string or array.

### `baseFormula.override`

Use the conditional base formula and HP threshold fields on the ability sheet for the common case of replacing a formula at or below a target HP threshold. The structure below is for inspecting saved data or configuring conditions the sheet does not yet expose.

Set this on the ability Item to replace its base roll formula under certain conditions. It accepts an object or array and requires exactly one targeted actor. Set `operation` to `override`, `replace`, or `set`; leaving it out won't replace the formula. The first matching entry wins, before critical dice doubling and dice minimums are applied.

This replaces the formula when the target is at half HP or below:

```json
[{ "operation": "override", "formula": "2d6 + @mnd",
   "when": { "targetHp": { "lte": "half" } } }]
```

HP conditions accept `lte`, `lt`, `gte`, `gt`, and `eq`; thresholds accept whole-number HP, percentage strings such as `"50%"`, or `"half"`/`"halfmax"/`"bloodied"`. Relative thresholds round up. Conditions can be under `when.targetHp`, `when.health`, or directly under `targetHp`/`health`; `condition`/`conditions` alias `when`. Multiple supplied comparisons must all pass. This reader does not apply source-name filters.

### `healing.application` (compatibility)

The source Item can also hold object/array healing-application rules. The system contains a migration from this older configuration to `baseFormula.override`; prefer the latter for new conditional formula replacements.

The application reader supports `formula` or `amount`/`flat`/`value`, and `operation`/`mode`: default `add`, `override`/`replace`/`set`, `multiply`, or `subtract`/`consume`. It supports the HP conditions above and source Actor filters `sourceNames`/`sourceName`/`sourceActors`/`sourceActor`. Unlike the base-formula reader, its HP threshold parser also accepts numeric fractions such as `0.5`. Healing-application changes happen when applying healing, not when displaying the original roll.

### Barriers

Use Barrier on the Resources tab. Under Grant Barrier, choose Fixed HP or Healing Roll, then choose who to Protect. For Fixed HP, enter the barrier HP or formula. The sheet saves a resource rule that runs when the ability is used. This simple grant appears only in the Barrier panel, so it is not listed twice. Conditional or timed barrier rules remain in Advanced Automation.

For Healing Roll, Protect chooses who receives the barrier from each healing application. Yourself grants it to the ability's user; Selected Target grants it to the healed actor. This setting does not change who receives the healing.

Existing Barrier chooses whether to Add, Replace, or Keep Stronger. Block Other Barriers enables the expiry and On Break resource rewards for reaching 0 HP. These rewards do not trigger on expiration or manual removal. Choosing None under Grant Barrier removes simple fixed grants and disables its healing barrier option. Conditional or timed barrier rules and other resource rules remain unchanged.

| Flag | Put it on | Behavior |
| --- | --- | --- |
| `barrier.onHealing` | Source ability Item | `true` also grants a barrier equal to the resolved healing roll when ability automation is enabled, including at full HP. The healing still happens. |
| `barrier.applyTo` | Source ability Item | Healing barrier recipient: `self` grants it to the ability's user; `target` (default) grants it to the healed actor. Fixed barrier grants use their resource rule's `applyTo`. The sheet keeps both settings aligned. |
| `barrier.operation` | Source Item | `grant` adds to the current barrier, `set` replaces it, and `max` keeps the higher amount. Overrides the operation supplied by the resource rule. |
| `barrier.lock` | Source Item | `true` creates a tracking effect that blocks further barrier grants while active. Removing the effect clears the remaining barrier. |
| `barrier.expireAtSourceTurnStart` | Source Item | With `barrier.lock`, `true` expires the tracking effect at the source actor's next turn start. Requires that actor to have a combatant in the current combat. |
| `barrier.onDepleted` | Source Item | With `barrier.lock`, an object or array of resource grants to run when the barrier reaches zero. Each entry has `resource`, a positive `amount` (default 1), and `recipient`: `source` (default) or `target`. |

The sheet stores those choices in `flags.ffxiv.barrier`. A replacement barrier with a lock, source-turn expiration, and one resource grant is stored as:

```json
{
  "operation": "set",
  "lock": true,
  "expireAtSourceTurnStart": true,
  "onDepleted": [
    { "resource": "My Resource", "amount": 1, "recipient": "source" }
  ]
}
```

This replaces the recipient's barrier and prevents further barrier grants until the tracking effect ends. Depleting the barrier grants the configured resource; expiring or manually deleting the effect clears the barrier without granting the resource. The ability still needs a barrier resource rule or `barrier.onHealing` to grant the barrier.

## MP costs and recovery

### `mpCost.reductions`

Set this on an owned Item or applicable effect to change ability MP costs. Use an array of rules, a single rule object, or an object whose keys hold rules. The older name `mpCost.reduction` also works; `mpCost.reductions` takes precedence if both are set.

This rule spends one resource point to reduce the cost by one MP, up to twice:

```json
[{ "resource": "My Resource", "amount": 1, "reduction": 1,
   "minCost": 0, "maxApplications": 2, "abilityNames": ["My Spell"] }]
```

Rules either set `override` to a nonnegative MP cost, or spend a job resource to reduce cost. Resource rules use `resource`/`resourceName`, `amount`/`resourceAmount` (default 1), `reduction`/`mp`/`value` (default 1), `minCost` (default 0), and `maxApplications` (default one application). Resource availability limits repeated applications. `abilityNames`/`abilityName`/`items`/`item` filters abilities. `tags`/`tag`/`requiresTags`/`requiresTag` requires **all** listed tags. Rules run in order and do not affect abilities with a base MP cost of zero.

### `mpRecovery`

Set this on an owned Item or applicable effect to change Adventurer Step MP recovery. For example, this adds one to normal recovery and doubles the result from round two onward:

```json
{ "flat": 1, "mult": 2, "minRound": 2 }
```

Fields: `flat`, `mult`, `override`, `suppress: true`, and optional `round`, `minRound`, `maxRound`. This modifies Adventurer Step MP recovery. Starting from normal recovery, flats add and multipliers multiply; a final override takes precedence; suppression wins over everything. Final recovery is floored and clamped to zero. Last encountered override wins. Round filters on an effect also gate its recovery change rows.

### `mpRecovery.onDamage`

Put an object or array on an applicable effect, e.g. `[{ "amount": 1, "tags": ["spell"] }]`. `flat` aliases `amount`; `tags`/`tag` optionally restricts to any matching ability tag. Recovers MP for the source actor once per target damage result with positive resolved damage, subject to normal recovery restrictions and MP limits.

## Job resources and ability branches

| Flag | Put it on | Format and behavior |
| --- | --- | --- |
| `jobResource` | Resource-bearing owned Item | Metadata object. `name`, `key`, `resource`, and plural arrays `names`, `keys`, `resources` add lookup names. `label` controls the displayed resource label before name/resource fallbacks. The Item still needs `system.job_resources_max > 0`. |
| `jobResource.bonus` | Ability Item | Object, array, or keyed entries defining optional resource-spending bonus rolls. Alias: `jobResource.bonuses`. |
| `jobResource.clearOnAction` | Owned trait Item | Resource string, rule object, or array. Clears the resource after an ability-like action unless preserved or consumed by its cost rules. Object fields: `resource`/`name`, and `preserveActions`/`exceptActions`/`exceptions`/`except` for action names. |
| `jobResource.preserveOnAction` | Ability Item | Resource string or array of resource names that this action preserves. |
| `jobResource.onCritical` | Owned trait Item | Object or array, e.g. `[{ "resource": "My Resource", "amount": 1, "minLevel": 30 }]`. Grants resource on a critical check through ability automation. `name` aliases `resource`; amount defaults to 1 and must be positive. |
| `branches` | Ability Item | Object, array, or keyed entries defining extra ability branch buttons. Alias: `abilityBranches`. |
| `branch` | Item-linked Active Effect | Branch key selecting which branch uses this effect. Alias: `branchKey`. |
| `requirementBypass` | Actor effect | Effect key string or array, e.g. `["My Required Effect"]`. Also accepts a wrapper with `keys`, `requirements`, or `effects`. Bypasses matching named-effect requirements. |

Resource quantities are stored in `system.job_resource_status` on the resource Item. The `flags.ffxiv.jobResource` object only holds metadata; editing it does not grant resource points.

This bonus costs one resource point and rolls `1d6`, increasing to `2d6` at level 50:

```json
[{ "key": "extra", "name": "Extra Damage", "resource": "My Resource",
   "amount": 1, "formula": "1d6", "buttonLabel": "Spend resource",
   "formulaByLevel": [{ "minLevel": 50, "formula": "2d6" }] }]
```

Bonus entries use `resource`/`resourceName`, `name`, `key`, `amount`/`cost`, `formula`/`rollFormula`, and `buttonLabel`. Amount defaults to one and is at least one. The highest eligible `minLevel` in `formulaByLevel` or `formulaUpgrades` replaces the formula. Resources are spent when the bonus roll is used.

An ability branch with a separate roll:

```json
[{ "key": "alternate", "name": "Alternate outcome", "formula": "1d6",
   "description": "Describe the outcome here.", "applyEffects": true }]
```

Branches use `key`, `name`/`label`, `buttonLabel`, `formula`/`rollFormula`, `description`/`text`, `applyEffects`, and the same level-based formula fields as bonus entries. A branch without a formula posts its description. A matching enabled branch-linked effect also enables branch effect application.

## Effect identity, application, and expiration

All flags in this section live on Active Effects.

| Flag | Value and behavior |
| --- | --- |
| `effectKey` | Stable matching key. Matching also considers the effect name. |
| `countsAs` | Extra matching identities; string or array of effect references. Aliases: `equivalentEffects`, `effectAliases`. |
| `applyTo` | Application scope for Item-linked effects: `self`, `self_auto`, `target`, or `automation`. Default `target`. Use the Item sheet control to keep the associated application rules consistent. |
| `applyAction` | `add` or `remove` for Item-linked effect application; default `add`. |
| `expireAtTurnStart` | `true`: delete at the affected actor's turn start. |
| `expireAtTurnEnd` | `true`: delete at the affected actor's turn end. |
| `expireAtRoundEnd` | `true`: delete at round end. |
| `expireAtCombatantTurnEnd` | Combat/turn descriptor below. In the linked-effect application path, `true` is converted to the current combatant descriptor. A raw `true` left on an actor effect expires at the next processed combatant turn end, regardless of its owner. |
| `expireAtCombatantTurnStart` | Combat/turn descriptor below. In the linked-effect application path, `true` is converted to the current combatant descriptor. A raw `true` directly set on an actor effect is not enough for the turn-start reader. |
| `statusStacks.<statusId>` | Positive stack count for a stackable status carried by the effect. Use the status controls where available; stacking semantics vary by status. |
| `stackCount` | Legacy fallback stack count. Prefer `statusStacks.<statusId>` for new content. |
| `enmity.sourceActorUuid` | Source actor UUID used by enmity targeting/check penalties; normally generated by status application. |
| `enmity.checkPenalty` | Numeric enmity check penalty; normally generated by status application. |
| `thunderSpell` | `true` identifies a Thunder Spell effect for source-based DoT handling. Normal ability-tag application sets this automatically; source linkage still matters. |

Combatant expiration descriptor:

```json
{ "combatId": "COMBAT_ID", "combatantId": "COMBATANT_ID", "round": 1, "turn": 0 }
```

Turn end requires an exact combat, combatant, round, and turn match. Turn start matches that combat/combatant on a later round/turn than the stored application position. These expiration readers skip disabled effects.

## Active Effect change keys

Enter the full path in the change row's key field. Mode handling is listed below.

| Change key | Value | Behavior |
| --- | --- | --- |
| `flags.ffxiv.check.advantage` | Number, e.g. `1` | Adds advantage dice. Mode is ignored. Total is floored and cannot be negative. |
| `flags.ffxiv.damageDice.minimum` | Integer, e.g. `3` | Takes the highest configured minimum. Mode is ignored. |
| `flags.ffxiv.damageDice.<roll>.minimum` | Integer | As above, restricted to `base`, `direct`, or `alternate`. |
| `flags.ffxiv.damageFormula.formula` | Roll formula, e.g. `1d6` | Appends a formula term. Mode is ignored. |
| `flags.ffxiv.damageFormula.flat` | Number | Appends a flat term. Mode is ignored. |
| `flags.ffxiv.damageFormula.<roll>.formula` | Roll formula | Restricts the term to `base`, `direct`, or `alternate`. |
| `flags.ffxiv.damageFormula.<roll>.flat` | Number | Restricts the flat term to that roll type. |
| `flags.ffxiv.damageFormula.requiredTags` | Comma- or semicolon-separated tags | Filters the unscoped formula/flat change rows on this effect; any matching tag qualifies. Alias: `.tags`. |
| `flags.ffxiv.damageFormula.<roll>.requiredTags` | Comma- or semicolon-separated tags | Filters only the corresponding roll-specific change rows. Alias: `.tags`. |
| `flags.ffxiv.damage.<channel>.flat` | Number | Changes the flat damage adjustment. Replace `<channel>` with `incoming`, `outgoing`, or `self`. |
| `flags.ffxiv.damage.<channel>.mult` | Number, e.g. `0.5` | Changes the damage multiplier for that channel. |
| `flags.ffxiv.mpRecovery.flat` | Number | Changes Adventurer Step MP recovery before its multiplier. |
| `flags.ffxiv.mpRecovery.mult` | Number | Changes the recovery multiplier. |
| `flags.ffxiv.mpRecovery.override` | Number | Sets final recovery, ignoring flat/mult. Last encountered override wins. |
| `flags.ffxiv.mpRecovery.suppress` | `true`, `1`, or `yes` | Suppresses recovery regardless of other modifiers. Mode is ignored. |
| `flags.ffxiv.mpRecovery.onDamage.amount` | Number | Changes MP recovered per target damage result with positive resolved damage. |
| `flags.ffxiv.mpCost.reduction.override` | Integer | Overrides the MP cost of matching abilities. Mode is ignored. |
| `flags.ffxiv.mpCost.reduction.abilityNames` | One ability key/name | Filters that override. Also accepts suffixes `.abilityName`, `.items`, or `.item`. A comma-separated value is not parsed as a list here; use a direct flag array for multiple names. |

The numeric damage and MP recovery rows support Add, Multiply, Subtract, and Override. Flat values normally add together; multipliers normally multiply together. A `.mult` row with mode Multiply and value `0.5` halves the multiplier. Override replaces the running value, which later rows can still change. Other modes use the key's default arithmetic.

Choose Custom where mode is ignored. MP cost change keys are case-sensitive; use the exact paths above.

## Encounter and turn rules

Owned Items can hold `encounterStart`, `turnStart`, and `turnEnd`. Each accepts a rule object, an array, or `{ "rules": [...] }`. These require **Full** automation. Turn rules skip actors with knocked out, comatose, or death statuses.

```json
[{ "action": "resource", "resource": "My Resource",
   "operation": "grant", "amount": 1 }]
```

| Field | Meaning |
| --- | --- |
| `action` | `grant` (default) creates a named effect; `remove` removes named effects; `resource` changes a resource. |
| `key`, `name` | Effect identity/display name for grant/remove rules. |
| `resource` / `resourceName` | Resource name for resource rules. |
| `operation` / `resourceAction` | `grant` (default) adds points; `consume` subtracts; `fill` fills to maximum; `clear` sets zero; `set` sets the supplied amount. Grant/consume use a positive integer amount (default 1). Set permits zero. |
| `amount` | Resource amount, default 1. |
| `requires`, `requiresAny`, `forbids` | Named-effect conditions. |
| `remove` | Effects to remove. |
| `removeOnEmpty` | Effects to remove when the resource is empty. Aliases: `removeWhenEmpty`, `removeOnZero`. |
| `flags`, `duration` | Flags and duration for generated effects. `flags` is the full flags object, e.g. `{ "ffxiv": { "expireAtRoundEnd": true } }`. |
| `iconOverride`, `icon` | Icon configuration for generated effects. |

Effect references accept names or keys. Use an array for multiple references. The rule handling is in [combat.mjs](../module/combat.mjs), under `_getJobAutomationRules` and `_applyEncounterStartResourceRule`.

## System-managed flags

These flags track source documents, linked effects, and previous actions. The system sets them automatically.

- `linkedSourceEffectId`, `linkedSourceItemId`, `linkedSourceItemUuid`, `linkedSourceActorUuid`, `linkedAutoApply`: copied effect/source tracking and cleanup.
- `linkedAutomationTemplate`: marks effects copied from a linked automation template.
- `linkedTraitId`, `linkedTraitUuid`, `linkedTraitName`, `activeEffectLinked`, `eliteFoeEffect`, `abilityEffectRule`, `sourceItemUuid`: generated or linked trait/effect management.
- `jobId`, `jobSourceUuid`, `augmentId`, `augmentSourceUuid`: which job or augment granted the content.
- `jobOwnerId`: owner of the job that granted a pet actor.
- `jobResourceCosts.<normalizedResourceKey>`: recorded resource expenditure used by later requirements; setting this does not spend a resource.
- `barrierLock`: generated barrier tracking effect, source actor, and configured depletion rules. Deleting the effect clears the barrier; depletion runs its resource grants.
- `enmityPhase`, `stunnedInEncounter`, petrified turn bookkeeping: status lifecycle state.
- `petrifiedAppliedTurn`: turn descriptor recorded when petrified is applied.
- `knockedOutFromDefeated`: combatant marker used to undo a knocked out status added by the defeated toggle.
- `markerPlacement`: generated region/tile placement state.
- `summoned`, `summon`: generated token marker and links to the summoned actor, source actor, source ability, and source token.
- `selfAutoLinkedEffectsApplied`: chat-message duplicate-application guard.
- Migration markers, including `migratedTrait` and `comboFromMigration*`.
- `hotbar`, `hotbarExtra`, `hotbarSettings`: actor/user hotbar assignments and display settings. `hotbarSettings.visibleHotbars` stores the number of visible rows, from 1 to 5. Slot assignments use dynamic keys such as `slot-1` and are managed by drag and drop on the hotbar.

## Troubleshooting and source map

If a flag has no effect, check where it's saved. Foundry will save a flag on an Item even if the feature only reads it from an Active Effect. Check that the effect is enabled, the automation setting allows the feature, and its tag, name, and target conditions are met.

A modifier to applied damage or healing may leave the original chat roll unchanged. Use the appropriate Apply button to apply the modifier. A macro that updates HP or MP directly skips that processing.

The examples were checked against the source, without live-world testing.

| Source file | Relevant functions |
| --- | --- |
| [Item automation](../module/items/item.mjs) | `_getApplicableEffects`, `_getActiveEffectCheckAdvantageDice`, `_getDamageDiceMinimum`, `_collectDamageFormulaFlagTerms`, `_collectDamageFormulaChangeTerms`, `_getDocumentForceCriticalRules`, `_getDirectHitOptionEntries`, `_getMPCostReductionEntriesFrom`, `_getBaseRollFormulaOverride`, `_getRequirementBypassRefs` |
| [Damage/healing and linked effects](../module/ffxiv.mjs) | `getActorDamageEffectModifiers`, `applyDamageApplicationModifiers`, `getHealingWithEffects`, `getActorDamageMpRecovery`, `prepareLinkedActiveEffectDuration` |
| [Combat](../module/combat.mjs) | `_getAdventurerStepMpRecovery`, `_getJobAutomationRules`, combatant expiration readers |
| [Status effects](../module/helpers/status-effects.mjs) | `getActorCheckPenalty`, `getTargetStatusAdvantage`, status stack readers |
| [Job resources](../module/helpers/job-resources.mjs) | Resource matching, labels, and resource count updates |
| [Barriers](../module/helpers/barrier.mjs) | `applyBarrier`, `initBarrierAutomation` |
| [Automation levels](../module/helpers/automation.mjs) | Ability and combat automation gates |

## Advanced: setting flags with macros

Use this only when a setting has no sheet or effect editor control. Check the relevant section first. These examples are for advanced content authoring, not routine ability setup.

All flags use the `ffxiv` namespace. Most tables omit the prefix (i.e. `check.advantage` is stored at `flags.ffxiv.check.advantage`). The change-key table gives full paths for use in the effect editor.

Document flags are saved directly on an Item or Active Effect through a macro, import, or sheet control. The object and array examples in this reference use this format.

Change rows are the key/value entries in the Active Effect editor. Only the keys listed under [Active Effect change keys](#active-effect-change-keys) are supported there. Pasting JSON into a change row won't create a document flag.

Most roll modifiers use the actor's enabled, applicable effects (`allApplicableEffects()`). Setting one of those flags on an ability Item won't give the actor the modifier. An effect linked to an Item must be applied or otherwise become applicable first.

In the tables, "actor effect" means an Active Effect belonging directly to the actor. Transferred Item effects aren't included by those checks.

### Macro examples

Select a token and create an Active Effect named "My Buff" on its actor. This Script macro gives the effect one advantage die. It requires permission to edit the effect.

```js
const actor = canvas.tokens.controlled[0]?.actor;
if (!actor) throw new Error("Select a token first.");
const effect = actor.effects.find(e => e.name === "My Buff");
if (!effect) throw new Error("Create an Active Effect named My Buff first.");
await effect.setFlag("ffxiv", "check.advantage", 1);
```

To add `1d6` to base damage rolls:

```js
const actor = canvas.tokens.controlled[0]?.actor;
const effect = actor?.effects.find(e => e.name === "My Buff");
if (!effect) throw new Error("Select a token with an effect named My Buff.");
await effect.setFlag("ffxiv", "damageFormula", [
  { rolls: ["base"], formula: "1d6" }
]);
```

To read or remove the flag, using the same `effect` variable:

```js
console.log(effect.getFlag("ffxiv", "damageFormula"));
await effect.unsetFlag("ffxiv", "damageFormula");
```

Use the value types shown in the examples: `true` is a boolean, while `"true"` is a string. Flag names are case-sensitive, so keep their spelling and capitalization. Set a modifier either as a document flag or as a change row; using both can count the modifier twice.

The world's automation setting accepts `disabled`, `ability`, and `full`. Encounter and turn rules require Full automation; resource grants on criticals require ability automation. Some flags are still read when automation is disabled, depending on the action. Use existing sheet controls where available.
