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
| **Passes** | Consecutive passes, so the chain closes when both players decline |
| **Action chains** | Who initiated, who is acting, who is targeted, whether the chain is still alive |
| **Turn machine** | Start → Action → End phase, whose AP forces whose activation, when the turn passes |
| **Effects** | Reaction modifiers, ability modifiers, their durations and expiry |
| **Tokens** | Overwatch, mines, traps, ambushes — persistent buttons you press yourself |

## What it deliberately does not do

Range, line of sight, movement legality, charge legality, whether an overwatch
trigger occurred, and dice rolls. You decide all of that on the table and tell
the app the outcome. It never asks "is the target in range?".

## Playing

1. **Setup** is a wizard, one slide at a time: both players' names → which of the
   six Mission Cards → one slide per army → a briefing slide if the mission needs
   one → review.
2. **ACTION LIST** — pick a Standard Action; the app walks the bookkeeping:
   attacker → defender → weapon → reaction → hit → wound → damage.
3. The app shows the **target number** for every roll (weapon Hit value and the
   S-vs-T wound table, with every modifier already folded in). You roll the dice
   and press HIT / MISS, WOUND / FAILED.
4. **Persistent buttons live on the unit that owns them.** OVERWATCH puts a
   **⌖ FIRE OVERWATCH** button on that unit's card, so with several units ready
   at once you can always see who is firing and who is still waiting. You press
   it when the trigger happens on the table.
5. Every End Phase runs END: abilities → the mission's scoring → any other VP.

Every number can be corrected by hand (±AP, ±VP, ±wounds), and **UNDO** rolls
back the last 40 changes.

## Victory Points are always yours to enter

Missions vary too much for the app to guess. Anything that *might* score — a
kill, a mission objective, anything you agree on — opens a keypad asking how many
VP that is worth to that player, pre-filled with a sensible default you can
override or zero out. The app adds up what you tell it and nothing else.

## Mission Cards

All six printed cards are built in, and the app owns as much of each as it
honestly can:

| Card | What the app tracks for you |
|---|---|
| **Sabotage** | Places an OBJECTIVE (5W, T4, no RP) per player as a real, shootable unit; destroying one suggests 3 VP and ends the game |
| **King of the Hill** | Mark a unit as being on the HIGH GROUND and killing it suggests 2 VP; asks the end-of-turn VP question |
| **Ambush** | Attacker and defender chosen at setup, a BAIT marker (3W, T4, no RP) for the defender worth 4 VP to the attacker, -1 Wound across every roster, and the game ends when a player is wiped out |
| **Assassination** | Each player names a TARGET at setup; it gains +1 Wound and killing an enemy TARGET suggests 3 VP |
| **Secure the Area** | Three markers whose controller it remembers, a SECURE action, and an end-of-turn VP total it counts itself |
| **The Relic** | Who is carrying it, blocks OVERWATCH for the carrier, and drops it where the carrier died |

Everything above still asks before it scores — the app suggests the card's
number and you confirm or change it.

## Datasheets

Units carry exactly what the card carries: **MOV, W, T, OC**, then ranged and
melee weapons with **RANGE, HIT, STRENGTH, DAMAGE**. There is no saving throw in
this game. Range is stored as a reminder and never checked. Damage may be written
as `D3` or `D6` — the app shows the card's wording and takes your roll rather than
pre-filling a guess.

## It remembers what you typed

Every unit is saved to this browser's library when a game starts, and
**+ ADD UNIT** offers them back to you instead of a blank form. There is a
**SAVE** button for saving mid-edit, whole-roster save/load for a full team at
once, and JSON export/import to move everything to another device.

## Interrupted actions

If something stops an action being performed at all — a DIVE that goes out of
sight, a unit shot off the board mid-move — **COULD NOT BE PERFORMED** is one tap
away throughout the attack flow and on a simple action's confirm screen. The
action ends, the chain carries on, and nothing it would have produced happens:
no damage, no VP, and **not even the AP** the target would have gained. The
weapon is not spent either, since it was never used.

## Auras — "+1 to hit within 6\""

The app cannot measure 6", so it does not try. An aura is declared once on a
passive ability — what it modifies, by how much, whose attack, within or beyond
how many inches, and for ranged, melee or any attack — and from then on **every
attack it could possibly bear on shows it as a tick-box next to the roll it
would change**, naming the unit it comes from. You look at the table and tick it
or don't. Modifiers, the wound table, capping at the edge of the die: all handled
from there.

The same mechanism carries `Cloaked`-style defensive auras (enemies attacking
*this* unit) via the "only when this unit is the one being attacked" switch, and
an aura may modify the attacking weapon's **Strength**, which moves the whole
wound table. An aura with no radius at all — *Small: enemy units have -1 to hit
this unit* — is applied automatically and shown as **ALWAYS ON**, because there
is nothing for you to judge.

Related escape hatches on the same effect list: **make a free attack** (no AP,
optionally no RP and no wound roll, for "make an attack with this unit's …"
abilities), **change a stat permanently**, **redirect the attack to another
unit** on an RP reaction, **stop friends using a Reaction** — struck through with
the reason, but still tappable if you both agree it doesn't apply — **mark a
unit** with a reminder chip for the rest of the game, and **modify Strength**.

A free attack used *as an RP reaction* interrupts: the counter resolves first and
the original attack is parked, then either resumes or is dropped if its attacker
was killed.

## Preset factions

Both official line-ups ship with every ability wired up, not just written out.

**Astra Militarum** — Guardsmen "Alfred", "Al", "Fred" and "Nick", and Commissar
Briant. The Commissar's 6" aura and his WITHDRAW ban, Nick's Cloaked and Grenade,
Fred's Snap Shot and Choke Hold, Al's Kill Count, Alfred's unlimited dagger.

**Orks** — Boss Nob Blikker, Da Hunta, Mikaaaaghhh, Snitcherz and Riksnik. The
Boss's +1 Strength aura moves the wound table for anyone who ticks it; *Small* is
an always-on aura that needs no tick at all; Snitcherz's Klaw is D3, so the app
asks for the roll instead of assuming; Da Hunta chips his quarry for the whole
game; *Kwik Dakka* genuinely interrupts — the counter-attack resolves first, and
if it kills the attacker their attack never happens.

Space Marines are included as a clearly-labelled example.

## Area effects

*Spin an' spray* and *Grenade* both work the same way: everyone in range rolls,
and the app shows the whole board so you **tick the ones that failed** and apply
the damage to all of them at once. Any custom ability can do this — set a damage
or heal effect to "Ask me — several units at once".

## When the app cannot model an ability

Make it a button. Three ways, in increasing order of automation:

- **+ ADD PLAIN BUTTON** in the unit editor — a named button on the unit card
  that shows your text when pressed. No cost, no rules, no arguments.
- **+ BUTTON ON THE TABLE** on any ability — a persistent token (a mine, a trap,
  an ambush) that sits on screen until you trigger or dismiss it, optionally
  carrying damage or modifiers.
- **+ BUTTON** in the on-the-table tray — invent one mid-game and hang it on any
  unit, for the thing nobody anticipated.

## Custom abilities

Abilities are mechanical, not natural language. For each one you specify when it
fires (`[X] AP`, `[X] RP`, `START:`, `END:`, passive, or a free button), whether
your opponent gets to react to it, and a list of effects the app applies: gain/lose AP, RP or VP, deal or heal damage, modify
Hit or Wound rolls for a chosen duration, place a token with its own trigger
effects, or just print a reminder.

## Turn or reaction?

The app is explicit about which of the two is happening, because they feel the
same on the table but mean different things. The player plates read
`PLAYER 1 · TURN` and `PLAYER 2 · REACTING`, and the control bar carries a
badge — gold **THEIR TURN** / **THEIR TURN · IN CHAIN**, or blue
**REACTING TO PLAYER 1** with a blue edge on the bar.

## Which actions hand over AP

Every action in the ACTION LIST says so in colour, so you never have to
remember: green *"Your opponent gains no AP"*, amber *"Your opponent gains 1
AP"*, grey *"The target gains 1 AP if it survives — nothing otherwise"* for the
Aggressive ones.

No Standard Action hands over a flat AP. Attacks pay through the survivor rule,
and a **Special Ability states for itself** whether the opponent gets to react —
if it should also hand over AP, that is an explicit *"Opponent gains AP"* effect
on that ability. If any of it is wrong for your table, Menu → **ACTIONS & AP**
lets you change the cost and the AP consequence of every action mid-game, and
marks what you changed.

**PASS** (0 AP) does nothing on its own but decline to act. On your own turn it
offers to end the turn — nothing else ever will. **Two passes in a row, one from
each player, end the action chain.**

When you have no AP, the app says so rather than skipping you: a red
**NO AP — MUST PASS** badge, the main button becomes **NO AP — PASS**, and PASS
is tagged *YOUR ONLY MOVE* in the action list.

## Rules choices worth knowing

- **Overwatch.** Place a token within 12" of the unit. When an enemy moves within
  3" of it you interrupt and resolve a shoot sequence at **-1 to hit**, skipping
  steps 2 and 3 — so no RP for the defender. Any of the unit's ranged weapons may
  be used. The token lives until its unit moves or attacks.
- **Overwatch AP.** An overwatch shot is an interrupt: the defender gains no RP
  (per the card) and no survivor AP, and control does not change hands unless the
  target dies.
- **Chain continuation.** A chain ends in exactly two ways: an action says "End
  the Action Chain" (MOVE, WITHDRAW, a kill), or both players pass consecutively.
  Running out of AP does not end it — you are handed the chain anyway and must
  PASS out of it, which matters because you can still fire an overwatch token or
  a card button first.
- **DISTRACT** grants its 1 AP immediately, on top of the standard survivor AP,
  and **PARRY** likewise grants its own AP on top.
- **CHARGE** hands the opponent 1 AP in its own right, on top of the survivor AP
  from the fight sequence — both are stated explicitly, and the golden rule says
  do what is written.
- **Elevation.** Shooting from higher ground is +1 to Hit; charging from higher
  ground is +1 to Wound and +1 Damage. Both are a checkbox in the attack flow
  because only you can see the terrain.

## Layout

```
index.html        entry point, loads six classic scripts
css/app.css       dark, mobile-first, touch-sized
js/rules.js       actions, reactions, mission cards, wound table — house-rule here
js/state.js       game state, persistence, undo, roster storage
js/engine.js      turn machine, chains, attacks, effects, tokens, objectives
js/setup.js       the setup wizard: players, mission, armies, briefing, review
js/ui.js          play screen and guided flows
js/main.js        bootstrap and event routing
tools/simulate.js headless rules harness — `node tools/simulate.js`
```

`node tools/simulate.js` plays a scripted game with no browser and asserts the
AP economy, chain hand-offs, wound table, reactions, tokens and objectives.
