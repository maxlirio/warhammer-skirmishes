# Warhammer Skirmishes — Game Assistant

Bookkeeping companion for the Warhammer Skirmishes variant. It is the game's
**memory, not its eyes**: the tabletop decides what happened, the app tracks the
consequences.

**Play it: https://maxlirio.github.io/warhammer-skirmishes/**

Or open `index.html` in any browser — no build step, no server, no network. It
runs straight off the filesystem and saves to `localStorage`, so a refresh
mid-game loses nothing. On a phone, use *Add to Home Screen* for a fullscreen
launcher.

## What it tracks

| | |
|---|---|
| **AP** | Start-phase AP, action costs, survivor AP, reaction AP, ability AP, carry-over between turns |
| **RP** | Granted per attack, spent on a reaction, cleared when the attack ends |
| **VP** | Never assumed — anything that could score asks you for the number, and the running totals are always on screen |
| **Wounds** | Damage applied automatically; a unit at 0 W is removed and its killer is asked what that was worth |
| **Action chains** | Who initiated, who is acting, who is targeted, whether the chain is still alive |
| **Turn machine** | Start → Action → End phase, whose AP forces whose activation, when the turn passes |
| **Effects** | Reaction modifiers, ability modifiers, their durations and expiry |
| **Tokens** | Overwatch, mines, traps, ambushes — persistent buttons you press yourself |

## What it deliberately does not do

Range, line of sight, movement legality, charge legality, whether an overwatch
trigger occurred, and dice rolls. You decide all of that on the table and tell
the app the outcome. It never asks "is the target in range?".

## Playing

1. **Setup** — name both players, optionally add a Mission Card and each
   faction's Special Objective, then build both rosters. Rosters can be saved,
   duplicated and exported to JSON.
2. **ACTION LIST** — pick a Standard Action; the app walks the bookkeeping:
   attacker → defender → weapon → reaction → hit → wound → damage.
3. The app shows the **target number** for every roll (weapon Hit value and the
   S-vs-T wound table, with every modifier already folded in). You roll the dice
   and press HIT / MISS, WOUND / FAILED.
4. **Persistent buttons** appear for OVERWATCH and any ability that places a
   token. You press them when the trigger happens on the table.
5. Every End Phase runs END: abilities → mission objectives → special objectives
   → any other VP. For each objective it simply reads the text back to you and
   asks who scored it and for how much — it works nothing out itself.

Every number can be corrected by hand (±AP, ±VP, ±wounds), and **UNDO** rolls
back the last 40 changes.

## Victory Points are always yours to enter

Missions vary too much for the app to guess. Anything that *might* score — a
kill, a mission objective, a Special Objective — opens a keypad asking how many
VP that is worth to that player, pre-filled with a sensible default you can
override or zero out. The app adds up what you tell it and nothing else.

## Datasheets

Units carry exactly what the card carries: **MOV, W, T, OC**, then ranged and
melee weapons with **RANGE, HIT, STRENGTH, DAMAGE**. There is no saving throw in
this game. Range is stored as a reminder and never checked.

## It remembers what you typed

Every unit, mission and Special Objective is saved to this browser's library when
a game starts, and **+ ADD UNIT** offers them back to you instead of a blank
form. There are **SAVE TO LIBRARY** buttons for saving mid-edit, whole-roster
save/load for a full team at once, and JSON export/import to move everything to
another device.

## Custom abilities

Abilities are mechanical, not natural language. For each one you specify when it
fires (`[X] AP`, `[X] RP`, `START:`, `END:`, passive, or a free button) and a list
of effects the app applies: gain/lose AP, RP or VP, deal or heal damage, modify
Hit or Wound rolls for a chosen duration, place a token with its own trigger
effects, or just print a reminder.

## Rules choices worth knowing

- **Overwatch expiry.** The card says "until the end of this action chain", but a
  chain closes as soon as the opponent has no AP to respond with, which would
  delete the token before anyone could walk into it. The default is the practical
  reading — the token lives until its unit moves or attacks. Menu → *Overwatch
  ends with the chain* switches to the strict wording.
- **Overwatch AP.** An overwatch shot is an interrupt: the defender gains no RP
  (per the card) and no survivor AP, and control does not change hands unless the
  target dies.
- **Chain continuation.** A chain ends when the action says it ends, or when
  either player's AP pool is empty at the moment they are owed a response. The
  *turn* is separate: it keeps going as long as the current player still has AP
  to open a new chain with, and only passes when they hit 0.
- **DISTRACT** grants its 1 AP immediately, on top of the standard survivor AP.
- **Elevation.** Shooting from higher ground is +1 to Hit; charging from higher
  ground is +1 to Wound and +1 Damage. Both are a checkbox in the attack flow
  because only you can see the terrain.

## Layout

```
index.html        entry point, loads six classic scripts
css/app.css       dark, mobile-first, touch-sized
js/rules.js       actions, reactions, wound table — edit here to house-rule
js/state.js       game state, persistence, undo, roster storage
js/engine.js      turn machine, chains, attacks, effects, tokens, objectives
js/setup.js       pre-game roster and ability builder
js/ui.js          play screen and guided flows
js/main.js        bootstrap and event routing
tools/simulate.js headless rules harness — `node tools/simulate.js`
```

`node tools/simulate.js` plays a scripted game with no browser and asserts the
AP economy, chain hand-offs, wound table, reactions, tokens and objectives.
