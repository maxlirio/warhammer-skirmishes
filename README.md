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

## The video game

`game/` is the same rules played on a screen instead of a table:
**https://maxlirio.github.io/warhammer-skirmishes/game/**

It is the companion app's opposite by design. The companion has no eyes and so
must ask; the video game has a table, so it measures its own ranges, traces its
own line of sight and rolls its own dice. Because it can see, it can answer the
questions the companion has to put to you — whether a DUCK broke line of sight,
whether a DIVE has anywhere to go that actually ends the attack.

Both load the same `js/rules.js`, so costs, the wound table, the reaction lists
and the elevation bonuses can never drift apart between them. House-rule the
game by editing that one file and both change together.

### There is no grid

Nothing is measured in squares. A model stands at a pair of floats on a base
half an inch across; a range is the straight line between two of them; a move is
the length of tape it takes to walk there, **around** terrain if terrain is in
the way — a shortest path through the plane, computed on a visibility graph over
the corners of the scenery. Walking round a 8"-wide trench wall to reach a point
6" away costs 12.6", and the game charges you for every inch of it.

Terrain is boxes with real heights. You see over anything that does not stand
higher than the higher of the two of you, so a 3.4" trench wall stops mattering
the moment you climb the 2.2" redoubt — and two models on the floor still cannot
see each other across it.

### All terrain is climbable

Walk your base into a piece of scenery and you go up it: you end on the lowest
part you can balance on, nearest to where you touched, and that is the end of
your move. So the trench wall in your way is not only an obstacle to walk round
— it is a firing position, if you are willing to spend the move getting onto it.
Line of sight follows from where you end up, so taking the high ground is worth
the inch it costs.

### In three dimensions

The table is a three.js scene where one world unit is one inch, so nothing is
converted anywhere: a model at (22, 15) stands at (22, ground, 15). Drag with
shift or the right button to move the camera, wheel to zoom, or jump to either
player's end of the table.

| | |
|---|---|
| **MOVE** | Shades every point you can reach and runs a tape measure to the cursor, reading the real walked distance |
| **SHOOT** | Shades everything the model can see, with the shadows terrain casts cut out of it, and measures the range to the target |
| **OVERWATCH** | Place the token anywhere within 12"; its 3" trigger circle is drawn before you commit, and it fires mid-move, interrupting the walk |
| **CHARGE** | Rolls the 1D6 on the table, finds the closest legal spot that puts a blade on the target, and declines gracefully if it cannot reach |
| **Every attack** | The camera cuts to the shot, the weapon goes off, and a round crosses the table. Where it ends up **is** the roll — no dice are ever shown |
| **A miss** | The round goes past him into the rockcrete: a metallic clang, sparks, and a scorch where it struck |
| **A hit that does not wound** | It rings off his armour — the same clang and sparks, and he reels |
| **A wound** | Blood, and a mark on the ground under him. Blood only ever means a wound |
| **Scenery** | Real models — Kenney's Space Kit, CC0. The mass of a piece is the rules box exactly, so nothing on the table is cover the rules do not know about; the models are what make it worth looking at |
| **Sound** | Synthesised in the browser rather than sampled: nothing to download and nothing to licence |

### Reactions move where you say

DODGE, DIVE and WITHDRAW all move the model, and **you choose where**. The table
leans in, shades the ground that is legal, and runs the tape to wherever you are
pointing. For DIVE that ground is only the places that genuinely end the attack —
out of sight of the shooter, or out of the weapon's reach — which the game can
work out because it can see the table.

### Playing somebody else

One of you hosts a room and reads out a four-letter code; the other types it in.
It is peer to peer over PeerJS's public broker: there is no server of ours in the
middle and nothing to deploy.

What crosses the wire is the **decision**, never the board. Both ends run the
same rules over the same seeded dice in the same order, so both arrive at the
same table. `node tools/checklockstep.js` runs two independent games through 300+
identical decisions and compares the entire table after every one.

### Checking it

| | |
|---|---|
| `node tools/checkmaps.js` | The tables: symmetry, that nothing is walled off, sight-lines between markers, that neither side gets two objectives it can hold uncontested — and the geometry itself, that a move round a wall costs more than the straight line and that you cannot stand with your base inside one |
| `node tools/checklockstep.js` | That two games fed the same decisions stay identical, which is what multiplayer rests on |
| `node tools/buildthree.js` | Rebuilds `game/vendor/three.global.js` from the three.js module — see below |

three.js and PeerJS are **committed, not fetched**, so the game still opens from
`file://` with the network off (only playing somebody else needs to be online).
three.js ships as an ES module, and a module cannot be imported from a `file://`
page, so `tools/buildthree.js` wraps it into a plain script that hangs `THREE` on
the window. The transform refuses to run if a future three.js stops being a
single `export {…}` with no imports of its own.

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
each player's half of the board turns to face them, so you read your own units
the right way up from your own side and nobody has to turn the device around.

**It arranges itself from the shape of the device**, and re-arranges the moment
you turn it. The two of you always sit at the two ends of the long axis:

- **Held tall** — a phone lying between you — the halves stack **end to end**,
  each getting the full width of the screen, and the far player's half is turned
  upside down.
- **Held wide** — a tablet on its side — the halves sit **side by side**, each
  taking a quarter turn. On a device this shape the running commentary and the
  token tray step aside so the units get the height.

Each half keeps its own scroll position, so a tap at one end of the table never
loses the other player's place.

**Every window turns to whoever it is talking to**, the same way round as their
half of the board. Open an action list and it faces the player acting; reach the
reaction step and it turns to face the defender; the roll turns it back. Phase screens face the player whose phase it
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
3. The app walks the bookkeeping from there: defender → weapon → **the dice the
   action calls for** → reaction → hit → wound → damage. A weapon is never spent
   — the same one can be used as often as you like in a chain.
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

## Dice the app stops for

The app never rolls, but it will not pretend a roll did not happen either.
Anything whose card says to roll gets its own screen — what die, what it is for,
and what to do with the result — and a keypad to tap what you got, which goes
into the chain log.

**CHARGE** stops for its 1D6" before the attack begins, and offers
**COULD NOT REACH** if the distance falls short: the AP is spent, nothing else
comes of it, and the chain carries on. Any ability can do the same — Snitcherz's
*Unpredictable* asks for its D6 before it moves him, and a Smoke Bomb asks for 2D6" — by setting the die and
what it is for in the unit editor.

## The chain log folds away

The running commentary sits at the bottom as a single line — the last thing that
happened — and opens to the full history on a tap. It was taking a quarter of
the screen before.

## The end of it

When somebody wins, the board goes behind a curtain: sparks are thrown, the
skull rises, the wings unfold, and **VICTORY** is struck across the screen in
brass with a sheen dragged over it.

Underneath it, the app writes a short report — and it is **assembled from what
actually happened**, so it can never congratulate you on a rout you did not
achieve. It knows whether anything of theirs was left standing, which mission
you were playing and how it ended, what the win cost you, whether it was a
one-point thing or a foregone conclusion, and **which of your units did the most
killing** — because the app has been counting since the first blow.

*"Not one of Player 2's number answers the muster. The line did not bend; it
ended. 1 of 5 will not be answering the next muster. Guardsman "Fred" 434-436
accounted for 3 of them. Record the name."*

**KEEP PLAYING** puts it away if you agreed a higher target.

## When a blow lands

The app never rolls, but it does react. A hit throws **sparks** from where your
finger was and gives the board a short jolt; a wound throws **blood** and leaves
a real splatter at the point of impact; a kill flashes the whole screen red and
shakes it hard. A miss gets a puff of dust and almost nothing else, which is the
point.

The effects are drawn straight onto the document and never touch the game state,
so nothing replays when a screen redraws or when you UNDO. **Menu → EFFECTS OFF**
turns the lot off, and anyone whose device asks for reduced motion gets none of
it without having to ask.

## Victory Points score themselves

**Only the player whose turn is ending scores from objectives.** Kills and
anything that pays out the moment it happens are unaffected — they land whenever
they happen, on anybody's turn. The End Phase shows what each side would take
and greys out the one that does not count today, so an objective the enemy holds
is visible without quietly paying them.

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
| **Secure the Area** | SECURE needs you within 3" of the marker **and** holding the most OC within 3" of it — the app puts both in front of you and then remembers who holds what, paying out 1 VP per marker with nobody touching anything |
| **The Relic** | A 10 VP race, not a dash: it pays the carrier 1 VP a turn by itself, knows carrying it costs 2" of Move and rules out OVERWATCH and CHARGE, drops it the moment the carrier takes a wound, and asks each End Phase whether the carrier got home — worth 3 VP, after which the RELIC goes back to the centre |

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
the shot, checks for that unit once you have chosen them (and is only offered
against shooting, since it needs a line of fire).

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

An action can fail to happen at all, and when it does nothing it would have
produced happens — no damage, no VP, and **not even the AP** the target would
have gained. The weapon is not spent either, since it was never used, and the
chain carries on.

There is no button for this; the app deals with it at exactly the moments it can
arise. A unit **shot off the board mid-move** is closed out automatically, because
the app is already watching the overwatch check. **DODGE** and **DUCK** stop and
ask the one thing the app cannot see — *can the attack still be resolved?* — and
**DIVE** does not need asking, because a DIVE that leaves the attack resolvable
is not a legal DIVE.

## Which attacks a reaction answers

An RP reaction can be limited to **one kind of incoming attack** — *any*, *only
when shot at*, or *only when fought in melee* — and one that does not apply
simply does not appear in the list. Both of Mikaaaaghhh's answer shooting only:
**Kwik Dakka** shoots back, which is no use against an enemy already in melee
with him, and **Get In Front of Me** needs a line of fire to step into. It is a
dropdown on any RP ability you build yourself.

**MOVE** may be taken on anybody's turn now, not only your own.

**WITHDRAW**'s 3" is taken *after* the attack and only if the unit survived, so
it is never asked the line-of-sight question — the attack is already over by
then, and a unit that died never withdrew at all. That pull-back is what a
waiting enemy overwatch gets to shoot at.

**DIVE** is only available when it *ends* the attack: "you may not do this
Reaction if it still allows your opponent to resolve the attack." So taking it at
all means the attack produces nothing — though the 3" is still walked first, and
can be shot at on the way. **DODGE** and **DUCK** are the softer versions: both
stop and ask *can the attack still be resolved?*, because a 1" step or a duck
behind cover might end it and only you can see whether it did.

## Auras — "+1 to hit within 6\""

The app cannot measure 6", so it does not try. An aura is declared once on a
passive ability — what it modifies, by how much, whose attack, within or beyond
how many inches, and for ranged, melee or any attack — and from then on **every
attack it could possibly bear on shows it as a tick-box next to the roll it
would change**, naming the unit it comes from. You look at the table and tick it
or don't. Modifiers, the wound table, capping at the edge of the die: all handled
from there.

An aura does not have to belong to a unit at all: a **token can carry one**, and
it need not be a radius either — Alfred's SMOKE BOMB asks *"does the line of
sight pass through it?"*, hampers *anyone* who shoots through it (his own side
included), and clears itself at the end of the turn. A marker like
that shows as a chip rather than a button, because there is nothing to press.

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
Fred's Modded Lasgun (12" / 4+ / S4 / D2 after playtesting), his Choke Hold and
his *Snap Shot* (which the app treats as an overwatch),
Alfred's **Smoke Bomb** — 2D6" to throw it, then a marker
that makes any shot whose line of sight passes through it 2 harder until the end
of the turn — and Al's **Kill Count**, which the app fires by itself the moment his Bayonet
finishes somebody.

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

No Standard Action hands over a flat AP at all. Attacks pay through the survivor
rule,
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
- **CHARGE** hands over nothing of its own. Its card is "move up to 1D6\" toward
  an enemy unit, you must end within range of at least one of your melee weapons
  or not make the move at all, resolve the fight sequence against that unit" —
  so the only AP that changes hands is the fight sequence's survivor rule.
- **Elevation.** Shooting from higher ground is +1 to Hit; charging from higher
  ground is +1 to Wound and +1 Damage. Both are a checkbox in the attack flow
  because only you can see the terrain.

## How it looks

Cold stone and soot, tarnished brass and dried blood — a reliquary rather than a
readout. The panels are **photographed corroded steel**, the header and footer
are riveted deck plate, and real blood is soaked into the corner of every unit's
plate and down the head of every window. A skull-and-wings device hangs behind
the board and presides over the score plates. Panels are bolted down with corner
brackets, rosters are headed like a chapel roll, and section rules are broken by
an Imperial cross.

Candlelight pools at the bottom of the screen, a fine mist of blood and grime
lies over everything, wounds are wax and blood instead of a battery gauge, and a
destroyed unit is not greyed out so much as bled out. The unit waiting to act
breathes rather than blinks.

The textures are **CC0** — ambientCG for the metal, OpenGameArt for the blood —
downscaled, darkened and committed to the repository rather than fetched, so the
app still opens from `file://` with the network switched off. All five come to
132 KB. See `assets/CREDITS.md` for sources and what was done to them.

## Layout

```
index.html        entry point, loads six classic scripts
assets/           CC0 textures — see assets/CREDITS.md
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
