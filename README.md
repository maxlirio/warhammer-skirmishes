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
| **VP** | Scored from the card — kills, objectives and mission scoring are worked out and applied, never typed |
| **Wounds** | Damage applied automatically; a unit at 0 W is removed and its killer scores whatever the card says it was worth |
| **Passes** | Consecutive passes, so the chain closes when both players decline |
| **Action chains** | Who initiated, who is acting, who is targeted, whether the chain is still alive |
| **Turn machine** | Start → Action → End phase, whose AP forces whose activation, when the turn passes |
| **Effects** | Reaction modifiers, ability modifiers, their durations and expiry |
| **Tokens** | Overwatch, mines, traps, ambushes — persistent buttons you press yourself |

## What it deliberately does not do

Range, line of sight, movement legality, charge legality, whether an overwatch
trigger occurred, and dice rolls. You decide all of that on the table and tell
the app the outcome. It never asks "is the target in range?".

## Walkthrough or experienced

The first thing setup asks is how much the app should explain.

**Walkthrough** spells out what every action, reaction and screen does — for your
first games. **Experienced** shows names, costs, keywords and flavour only. It
never hides anything the app is *tracking*: dice targets, modifier breakdowns,
aura tick-boxes, whose AP is whose, the action chain. Only the teaching goes.
Switchable mid-game from the menu.

## One way up, or across the table

The same slide asks how the two of you are sitting.

**ONE WAY UP** is the normal phone layout: both rosters upright, passed back and
forth. **ACROSS THE TABLE** is for a phone or tablet lying flat between you —
each player's half of the board is rotated to face them, so you read your own
units the right way up from your own side and nobody has to turn the device
around.

**Every window turns to whoever it is talking to.** Open an action list and it
faces the player acting; reach the reaction step and it turns to face the
defender; the roll turns it back. Phase screens face the player whose phase it
is, a faction card's powers face its owner, and the movement check faces the
player whose triggers are waiting. Only the shared furniture — the phase bar,
the action chain — stays put. Switchable mid-game from the menu.

## Playing

1. **Setup** is a wizard, one slide at a time: how much it explains and how you
   are sitting → both players' names → which of the six Mission Cards (each
   printed verbatim, and each bringing its own win condition — only a card-less
   game asks you to agree a VP target) → one slide per army → a briefing slide if
   the mission needs one → review.
2. **Tap the unit you want to act with.** Every unit that can do something right
   now glows and says *TAP TO ACT*; tapping it lists only what **that** unit can
   do, with what each costs and what it hands the opponent — its Standard
   Actions and **its own Special Abilities by name**, in one list. There is no
   action list to open first, no "which unit?" step afterwards, and no SPECIAL
   ABILITY button to go through.
3. The app walks the bookkeeping from there: defender → weapon → reaction → hit →
   wound → damage.
4. The app shows the **target number** for every roll (weapon Hit value and the
   S-vs-T wound table, with every modifier already folded in). You roll the dice
   and press HIT / MISS, WOUND / FAILED. **Damage, VP and AP then follow from the
   card without being asked for** — the only time the app takes a number from you
   is when the card itself says to roll one (a `D3` or `D6` weapon).
5. **PASS is a card between the two rosters**, not an action buried in a list. It
   tells you what it will do before you touch it — *ends the chain*, *ends
   Player 1's turn* — and just does it. You are only asked to confirm when there
   is a genuine choice to make between ending the chain and ending your turn.
6. Every End Phase runs END: abilities, then the mission's scoring — which the
   app works out and applies itself.

Every number can be corrected by hand (±AP, ±VP, ±wounds), and **UNDO** rolls
back the last 40 changes.

## Victory Points score themselves

The app knows what everything is worth, so it applies it. A kill scores the
number on the datasheet — 1 by default, 2 for a Grey Knight, 3 for an
Assassination TARGET, 4 for the Ambush BAIT — and the mission's end-of-turn
scoring resolves the moment you end the turn. Nothing asks you to type a
figure, and nothing waits for confirmation.

Where a card names a price on a unit's head, that number lives on its datasheet
(**WORTH THIS MANY VP WHEN DESTROYED**) and shows as a chip on its card, so the
VP that lands is never a surprise.

The ± buttons on the score plates are still there for anything you want to
correct by hand.

## Mission Cards

All six printed cards are built in and fully implemented. Each is reproduced
**verbatim** — battlefield, objective and special rules, line for line — and the
app resolves its scoring on its own. Where it genuinely cannot see the table, it
asks about **the table**, never about the score:

| Card | How it scores |
|---|---|
| **Sabotage** | The OBJECTIVE is a real 5 W / T4 unit with no RP. Destroy the enemy's and 3 VP land and the game ends — no confirmation |
| **King of the Hill** | Mark whoever is standing up there; at the end of every turn the app awards the 1 VP itself, and that unit is worth 2 VP when killed |
| **Ambush** | Attacker and defender chosen at setup, a BAIT worth 4 VP to the attacker, -1 Wound across both rosters, and the game ends when one side is wiped out. The defender's kills ask **one** question — *was it in your deployment zone?* — because that is 2 VP instead of 1 and only you can see where it happened |
| **Assassination** | Each TARGET gains +1 Wound and is worth 3 VP. At the end of the turn the app asks who has the most OC at the centre objective and awards the 1 VP itself |
| **Secure the Area** | It watched every SECURE, so it knows who holds what and pays out 1 VP per marker with nobody touching anything |
| **The Relic** | It knows who is carrying it and blocks their OVERWATCH; each End Phase it asks whether the carrier got home, and awards the 3 VP and ends the game if so |

Each carries its own win condition: 10 VP for Sabotage, King of the Hill,
Assassination and Secure the Area; last one standing for Ambush; relic carried
home for The Relic.

## Datasheets

Units carry exactly what the card carries: **MOV, W, T, OC**, then ranged and
melee weapons with **RANGE, HIT, STRENGTH, DAMAGE**. There is no saving throw in
this game. Range is stored as a reminder and never checked. A fixed damage value
is applied without asking; only `D3` or `D6` still opens a pad, because that is
the card telling you to roll.

## It remembers what you typed

Every unit is saved to this browser's library when a game starts, and
**+ ADD UNIT** offers them back to you instead of a blank form. There is a
**SAVE** button for saving mid-edit, whole-roster save/load for a full team at
once, and JSON export/import to move everything to another device.

## What a unit card tells you

Under the name sit small chips: **wounds**, weapons, and every ability the unit
has. A passive shows its full text **when you hover over it** and opens it in a
window when you tap — nothing about a unit is more than one press away, and in
Experienced mode that is where the explanation lives instead of on screen.

A unit that has placed an overwatch is simply tagged **⌖ OVERWATCHING**. There is
no button to hunt for, because you never fire it by hand — see below.

## Overwatch fires on movement

Overwatch triggers on a unit *moving*, so the app asks at exactly the moments a
unit moves — you never have to close a window and hunt for the button yourself.
It offers two kinds of waiting trigger: an **overwatch token**, and any ability
whose trigger is **WHEN AN ENEMY MOVES NEARBY** — Fred's *Snap Shot* is an
overwatch in everything but name, so it is offered from the same window, spends
its once-per-game use when it fires, and is wasted the same way if the mover
dies before its turn in the queue.

That covers **MOVE**, a **CHARGE**'s 1D6", the reactions that shift the defender
(**DODGE**, **DIVE**, **WITHDRAW**), a teleport, and **any ability whose card
says move**:
tick *"This moves a unit"* when you build it and the check runs afterwards,
whether it fires from an AP action, a card button, a START:/END: phase, or an RP
reaction. Something like *Get In Front of Me*, which moves whoever it shoves into
the shot, checks for that unit once you have chosen them.

At those points a **MOVEMENT — DOES ANYTHING FIRE?** screen lists every waiting
trigger belonging to the moving unit's opponent, with its unit and owner. There
may be several, so you tap them **in the order you want them resolved** — they
number `#1`, `#2` as you go — then fire. Each resolves in turn as a full shoot
sequence at -1 to hit with no RP for the target.

When the queue is empty, whatever the unit was doing carries on: the interrupted
attack resumes at its Hit roll, or the MOVE completes. **If the moving unit is
destroyed on the way, it does not** — per the rule below, the interrupted action
produces nothing at all.

Committing more than one is a gamble. If the first kills the target, the ones
still queued are **spent anyway** — you chose them, and they fired into a corpse.
A token you did not commit stays on the table.

## Interrupted actions

If a unit is shot off the board mid-move, the action it was performing ends: the
chain carries on and nothing it would have produced happens — no damage, no VP,
and **not even the AP** the target would have gained. The weapon is not spent
either, since it was never used.

There is no button for this. The app is watching the overwatch check, so it sees
the mover die and closes the action out by itself.

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
unit** with a chip that sticks, **clear a mark** from every enemy carrying it,
**deal bonus damage against a marked unit** (applied automatically, optionally
tied to one named weapon), and **modify Strength**.

An ability can also declare that it **moves its unit**, which runs the overwatch
check afterwards just as a MOVE would.

A free attack used *as an RP reaction* interrupts: the counter resolves first and
the original attack is parked, then either resumes or is dropped if its attacker
was killed.

## Faction cards, and the pools they spend

Some factions bring a card of their own with a resource that is not AP. The card
belongs to the **player**, not to any one unit: it sits under the score plates
with its pool, its powers are listed inside it, and the pool has ± buttons like
every other number in the app.

The Grey Knights' **PSY** is the built-in example — 4 to begin with, 1 more at
the start of every turn including the first, spent on *Sanctifying Barrage*
(1), *Gate of Infinity* (2) or *Warp Charge* (3). An ability can pay into the
pool too, which is what Aurelius's *Psychic Mastery* does. Outside that phase the powers
are shown but struck out with the reason, so nobody has to remember when they
were allowed, and anything you cannot currently afford says so.

## Weapons that roll more than one dice

A weapon can throw several shots — the Psilencer's four, or a Storm Bolter's two
once *Sanctifying Barrage* has been paid for. When it does, the app changes the
question rather than making you resolve one shot at a time: **ROLL 4 DICE — EACH
NEEDS 4+**, then a keypad from 0 to 4 for how many hit, then the same again for
how many of *those* wounded, then damage already multiplied out and still
editable.

A condition attached to the extra dice — *"if this unit has not moved this
turn"* — appears as a tick-box that the app has **already answered for you**
from what it watched happen, and that you can overrule.

## Reserves and teleports

A unit can start the game **off the battlefield**. It shows as
*IN RESERVE — OFF THE BATTLEFIELD*, cannot be shot at, cannot be picked as a
target, and the only thing it can do is the ability that brings it in.

Anything that puts a unit somewhere — *Deep Strike*, *Warp Shift*, either *Gate
of Infinity* — is a **place** effect. The app never decides where it lands; it
prints the card's restriction ("more than 6\" away from an enemy unit"), records
that the unit is now on the table, counts it as having moved, and runs the
overwatch check. Place two units at once and each gets its own check, one after
the other — and one of them being shot down does not undo the other. If the card
says the unit may not MOVE afterwards, MOVE simply is not on its list until the
turn ends.

## Preset factions

The official line-ups ship with every ability wired up, not just written out.

**Astra Militarum** — Guardsmen "Alfred", "Al", "Fred" and "Nick", and Commissar
Briant. The Commissar's 6" aura and his WITHDRAW ban, Nick's Cloaked and Grenade,
Fred's Choke Hold and his *Snap Shot* (which the app treats as an overwatch),
Alfred's unlimited dagger, and Al's **Kill
Count**, which the app fires by itself the moment his Bayonet finishes somebody.

**Orks** — Snitcherz, Boss Nob Blikker, Da Hunta, Riksnik and Mikaaaaghhh. The
Boss's *Intimidating Presence* is a +1-to-wound aura anyone in 6" can tick;
*Small* is an always-on aura that needs no tick at all; Snitcherz's Klaw is D3,
so the app asks for the roll instead of assuming; **Da Hunta MARKS** an enemy
before the first turn even starts, because his card says he does, and
his Shoota then does +1 damage to it automatically, while *Don't ya Dare* wipes
every enemy mark and pins it on whoever just shot him; *Kwik Dakka* genuinely
interrupts — the counter-attack resolves first, and if it kills the attacker
their attack never happens.

**Grey Knights** — Brother Drusius, Brother Lucius and Justicar Aurelius, plus
the GREY KNIGHTS PSYCHIC card. Each of them is worth **2 VP** when destroyed.
Aurelius's *Psychic Mastery* pays 1 AP straight back into the PSY pool. Drusius starts in reserve and *Deep Strikes* in;
his *Unescapable Wrath* strikes DIVE off the enemy's reaction list **only** when
he is firing the Purifying Flame. Lucius's *Heavy Gatling* offers four dice when
the app agrees he has not moved. Aurelius's *Into the Warp* takes the ticks for
who failed their D6, deals the damage, and hands the opponent 1 AP per unit
damaged **capped at 2**; his *Gate of Infinity* is a once-per-game END: ability
that places up to two friendlies and will not let you pick a third.

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

An `[X] AP` ability appears in its unit's action list next to MOVE and SHOOT,
tagged **SPECIAL ABILITY**, with its cost and whether the opponent gets to react.
Abilities are mechanical, not natural language. For each one you specify when it
fires, whether your opponent gets to react to it, and a list of effects the app
applies: gain/lose AP, RP or VP, deal or heal damage, modify Hit or Wound rolls
for a chosen duration, place a token with its own trigger effects, or just print
a reminder.

The triggers are `[X] AP`, `[X] RP`, `START:`, `END:`, passive, a free button —
and two the app fires for you:

- **AT THE START OF THE GAME** resolves itself before turn one. If it needs a
  choice — *Da Hunta MARKS an enemy* — the app asks for it before the first turn
  and the pick **is** the whole step: no confirmation, no talk of AP or the
  action chain, because neither exists yet.
- **WHEN THIS UNIT KILLS** fires the moment that unit destroys an enemy, and can
  be tied to one named weapon. *Kill Count* only counts kills made with Al's
  Bayonet, so shooting someone with his Lasgun does nothing — the app checks the
  weapon, you don't.

Target pickers can be limited to **enemies** or **friendlies**, so an ability
that marks an enemy never offers you your own squad.

## Turn or reaction?

The app is explicit about which of the two is happening, because they feel the
same on the table but mean different things. The player plates read
`PLAYER 1 · TURN` and `PLAYER 2 · REACTING`, and the control bar carries a
badge — gold **THEIR TURN** / **THEIR TURN · IN CHAIN**, or blue
**REACTING TO PLAYER 1** with a blue edge on the bar.

## Which actions hand over AP

Every action says so in colour on the button you press, so you never have to
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
**NO AP — MUST PASS** badge, and the PASS card turns red to tell you it is your
only move.

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

## How it looks

Gunmetal and rust, brass and bone, stencilled condensed capitals, chamfered
corners and hazard stripes — the fittings of a battered piece of Imperial
equipment rather than a phone app. It is all system fonts, CSS gradients and one
inline SVG, so there is still nothing to download and nothing to fetch: the app
runs off a memory stick with the network switched off.

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
