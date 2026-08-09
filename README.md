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
| **VP** | Kills, mission objectives, special objectives, manual awards; game ends at the target |
| **Wounds** | Damage applied automatically; destroyed units removed, VP scored |
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
   → any other VP.

Every number can be corrected by hand (±AP, ±VP, ±wounds), and **UNDO** rolls
back the last 40 changes.

## Custom abilities

Abilities are mechanical, not natural language. For each one you specify when it
fires (`[X] AP`, `[X] RP`, `START:`, `END:`, passive, or a free button) and a list
of effects the app applies: gain/lose AP, RP or VP, deal or heal damage, modify
Hit or Wound rolls for a chosen duration, place a token with its own trigger
effects, or just print a reminder.

## Rules choices worth knowing

- **Overwatch expiry.** The card says "until the end of this action chain", but a
  chain usually closes the moment the opponent runs out of AP, which would delete
  the token before anyone could walk into it. The default is the practical
  reading — the token lives until its unit moves or attacks. Menu → *Overwatch
  ends with the chain* switches to the strict wording.
- **Overwatch AP.** An overwatch shot is an interrupt: the defender gains no RP
  (per the card) and no survivor AP, and control does not change hands unless the
  target dies.
- **Chain continuation.** A chain ends only when the action says it ends, or when
  the player whose *turn* it is runs out of AP. An opponent with an empty pool
  simply cannot respond — the chain stays open, play returns to the turn player,
  and weapon lockouts and chain-duration effects carry on.
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
