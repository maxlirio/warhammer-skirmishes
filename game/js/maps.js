/* =========================================================================
   BATTLEFIELDS
   One per Mission Card, built for what that card asks of the ground. You do
   not choose a table and a card separately — the card brings its own, because
   a table that suits KING OF THE HILL is the wrong shape for SABOTAGE.

   Measured in inches. Terrain is boxes:

     blocks: true    a ruin or blockhouse. You cannot walk through it, and you
                     cannot see past it unless you are standing higher than
                     `top` — so a 4" wall stops mattering from a 5" gantry.
     blocks: false   a platform. You walk onto it and it puts your eye at
                     `top`, which is what the elevation rules are about.

   All terrain is climbable either way; `blocks` is about sight and about
   whether you can walk THROUGH it, not whether you can get on top.

   Every table is symmetric left to right so neither player starts ahead, and
   carries exactly the objective markers its card calls for.
   `node tools/checkmaps.js` enforces both.
   ========================================================================= */

const MAPS = (function () {

  /* ------------------------------------------------------------- BIOMES
     What the ground is made of, what the sky is doing, and what grows on it.
     None of this touches a rule — the boxes are still the boxes — but a snow
     field and an ash waste should not look like the same table repainted.

       ground     the floor: base colour, the grit thrown over it, and the
                  colour of the cracks between slabs
       sky        top, middle and horizon of the dome
       fog        colour and how quickly it closes in
       key/hemi   the sun and the bounce, so the light matches the sky
       mass       what a piece of blocking terrain is built from
       deck       what a platform is built from
       scatter    ground clutter, none of it tall enough to be mistaken for
                  cover the rules do not know about
       clumps     what grows ON a piece of terrain — the trees and rocks that
                  make the piece what it is */
  const BIOMES = {
    rockcrete: {
      ground: { base: '#6a6b66', grit: '#4a483f', crack: '#241f19', wet: 0.06 },
      sky: ['#070a14', '#25272e', '#4a4038', '#6d5540'],
      expose: 1.25,
      fog: 0x2f3138, fogD: 0.0052,
      key: { colour: 0xffe8c4, power: 3.1 }, hemi: { sky: 0xbcd0e8, gnd: 0x4a3a26, power: 1.45 },
      mass: 'panel', deck: 'panel',
      scatter: ['debris', 'rock_smallA', 'metal_panel'],
      clumps: []
    },
    ash: {
      ground: { base: '#5a534d', grit: '#2e2823', crack: '#15100c', wet: 0.02, ember: true },
      sky: ['#0a0708', '#2a1c17', '#5c2f1c', '#8a4520'],
      expose: 1.15,
      fog: 0x3a2a22, fogD: 0.0088,
      key: { colour: 0xffb070, power: 3.0 }, hemi: { sky: 0x6b4436, gnd: 0x2a1a12, power: 1.2 },
      mass: 'panel', deck: 'panel',
      scatter: ['debris', 'rock_smallC', 'stump_old', 'stump_round'],
      clumps: ['tree_trunk', 'stump_old', 'rock_tallC']
    },
    snow: {
      ground: { base: '#dde5ec', grit: '#c3d0dc', crack: '#8fa3b4', wet: 0.16 },
      sky: ['#0b1626', '#3c556e', '#8fa8bd', '#cddae4'],
      expose: 0.82,
      fog: 0xb9cad8, fogD: 0.0075,
      key: { colour: 0xdfeaff, power: 3.4 }, hemi: { sky: 0xd6e6f5, gnd: 0x9fb2c2, power: 1.05},
      mass: 'rock', deck: 'rock',
      scatter: ['rock_smallA', 'rock_smallC', 'tree_pineSmallA', 'stone_tallB'],
      clumps: ['tree_pineTallA', 'tree_pineRoundC', 'tree_pineSmallA', 'rock_largeA']
    },
    desert: {
      ground: { base: '#c9a86e', grit: '#b08f57', crack: '#7d6238', wet: 0.03, ripple: true },
      sky: ['#1a2438', '#6a6a5c', '#c3a068', '#e3c893'],
      expose: 0.95,
      fog: 0xd8bd8e, fogD: 0.0060,
      key: { colour: 0xfff0cc, power: 3.6 }, hemi: { sky: 0xcfd8e8, gnd: 0xa87f4a, power: 1.15},
      mass: 'sandstone', deck: 'sandstone',
      scatter: ['rock_sandA', 'rock_sandC', 'cactus_short', 'plant_bush', 'rock_smallA'],
      clumps: ['cactus_tall', 'tree_palmTall', 'rock_sandB', 'cactus_short']
    },
    forest: {
      ground: { base: '#4e5637', grit: '#3a4227', crack: '#232815', wet: 0.10, litter: true },
      sky: ['#08111a', '#2a3a2c', '#556b41', '#8a9a63'],
      expose: 1.2,
      fog: 0x3f4c36, fogD: 0.0090,
      key: { colour: 0xfff2c8, power: 2.9 }, hemi: { sky: 0x9fc0d8, gnd: 0x3c4a24, power: 1.5 },
      mass: 'stone', deck: 'wood',
      scatter: ['grass', 'grass_large', 'plant_bush', 'mushroom_red', 'flower_redA', 'log'],
      clumps: ['tree_oak', 'tree_detailed', 'tree_thin', 'tree_pineTallA']
    },
    graveyard: {
      ground: { base: '#59564c', grit: '#3d3a32', crack: '#1e1b16', wet: 0.12 },
      sky: ['#05070d', '#1b2029', '#3a3f44', '#5b5a52'],
      expose: 1.3,
      fog: 0x2c3138, fogD: 0.0105,
      key: { colour: 0xcfd8f0, power: 2.2 }, hemi: { sky: 0x8fa0bc, gnd: 0x2c2a26, power: 1.35 },
      mass: 'stone', deck: 'stone',
      scatter: ['gravestone_broken', 'gravestone_round', 'debris', 'rock_smallC', 'grass', 'plant_bush'],
      clumps: ['pillar_obelisk', 'gravestone_cross', 'column_large', 'gravestone_round']
    },
    wasteland: {
      ground: { base: '#7a6a52', grit: '#574b39', crack: '#2b2318', wet: 0.04, crackle: true },
      sky: ['#0d0f16', '#33302c', '#6b5a41', '#9a7c52'],
      expose: 1.15,
      fog: 0x50463a, fogD: 0.0068,
      key: { colour: 0xffdfae, power: 3.0 }, hemi: { sky: 0xaab6c6, gnd: 0x5a4a34, power: 1.4 },
      mass: 'stone', deck: 'panel',
      scatter: ['debris', 'rock_smallA', 'stump_round', 'tree_deadlog', 'plant_bush'],
      /* Nothing grows out here. A blocking piece on a wasteland is a ruin,
         not a copse — and the kit's dead trunks were reading as a row of red
         tents pitched across the table. */
      clumps: []
    }
  };


  /* A box and, unless it already straddles the centre line, its mirror. */
  function mirrored(terrain, w) {
    const out = [];
    terrain.forEach(function (t) {
      out.push(t);
      if (Math.abs((t.x + t.w / 2) - w / 2) > 0.01) {
        out.push(Object.assign({}, t, { x: w - t.x - t.w }));
      }
    });
    return out;
  }

  /* ----------------------------------------------------------- no card at all
     Objectives all over, because holding them is the only thing to do. */
  function openGround() {
    const w = 44, h = 30;
    return {
      id: 'open', missionId: null, biome: 'rockcrete', name: 'RUINED MANUFACTORUM',
      blurb: 'A killing floor straight down the middle with three markers on it, ' +
             'and a gantry north and south that shoots down into everything.',
      w: w, h: h,
      deploy: [{ x: 0, y: 0, w: 7, h: h }, { x: w - 7, y: 0, w: 7, h: h }],
      /* A STREET, with a manufactory either side of it. Two ranks of buildings
         separated by cross-alleys, a gantry bridging the road, and the road
         itself choked with what came off the roofs. The middle lane stays
         open, because the card puts three markers down it. */
      terrain: mirrored([
        /* the north terrace: a block of works with an alley through it */
        { x: 9,  y: 2,  w: 6, h: 5,   top: 4.6, blocks: true,  kind: 'blockhouse' },
        { x: 9,  y: 8,  w: 6, h: 3.5, top: 3.0, blocks: true,  kind: 'annexe' },
        { x: 16, y: 2,  w: 5, h: 4,   top: 5.2, blocks: true,  kind: 'blockhouse' },
        { x: 16, y: 7,  w: 5, h: 3,   top: 2.2, blocks: false, kind: 'gantry' },
        /* the south terrace mirrors it across the street */
        { x: 9,  y: 23, w: 6, h: 5,   top: 4.6, blocks: true,  kind: 'blockhouse' },
        { x: 9,  y: 18.5, w: 6, h: 3.5, top: 3.0, blocks: true, kind: 'annexe' },
        { x: 16, y: 24, w: 5, h: 4,   top: 5.2, blocks: true,  kind: 'blockhouse' },
        { x: 16, y: 20, w: 5, h: 3,   top: 2.2, blocks: false, kind: 'gantry' },
        /* the gatehouse pillars where the street narrows */
        { x: 6,  y: 9,  w: 2, h: 4,   top: 3.2, blocks: true,  kind: 'pillar' },
        { x: 6,  y: 17, w: 2, h: 4,   top: 3.2, blocks: true,  kind: 'pillar' },
        /* a walkway across the road, high enough to shoot down it */
        { x: 20, y: 12, w: 2.5, h: 6, top: 3.4, blocks: false, kind: 'gantry' },
        /* and the roadway itself, half blocked with fallen masonry */
        { x: 12, y: 12.5, w: 5, h: 1.6, top: 1.1, blocks: false, kind: 'rubble' },
        { x: 12, y: 15.9, w: 5, h: 1.6, top: 1.1, blocks: false, kind: 'rubble' },
        { x: 17, y: 11,   w: 2, h: 2,   top: 1.4, blocks: false, kind: 'rubble' },
        { x: 17, y: 17,   w: 2, h: 2,   top: 1.4, blocks: false, kind: 'rubble' }
      ], w),
      /* ONE, in the middle. Five markers on a table with five models a side
         means nobody can contest anything — you spread out to hold them and
         then there is nothing left to fight with. */
      objectives: [{ x: w / 2, y: h / 2 }]
    };
  }

  /* --------------------------------------------------------------- SABOTAGE
     Each side has something in its own deployment zone that the other has to
     reach and destroy. So: covered lanes down both flanks to get across, an
     open middle that punishes the short route, and a blockhouse at each end to
     put the thing behind. No objective markers — the target IS the objective. */
  function supplyLines() {
    const w = 46, h = 30;
    return {
      id: 'supply', missionId: 'sabotage', biome: 'ash', name: 'SUPPLY LINES',
      blurb: 'Covered lanes down both flanks and a wide open middle. There is a ' +
             'quick way to their objective and a way you might survive.',
      w: w, h: h,
      deploy: [{ x: 0, y: 0, w: 7, h: h }, { x: w - 7, y: 0, w: 7, h: h }],
      /* A RAIL YARD. A control bunker at each end with the target behind it,
         loading platforms down both flanks to move under, ranks of containers
         to weave between — and a bare marshalling yard through the middle
         that anybody in a hurry has to cross in the open. */
      terrain: mirrored([
        { x: 8,  y: 11, w: 4, h: 8,   top: 4.6, blocks: true,  kind: 'bunker' },
        { x: 7,  y: 4,  w: 5, h: 4,   top: 3.4, blocks: true,  kind: 'annexe' },
        { x: 7,  y: 22, w: 5, h: 4,   top: 3.4, blocks: true,  kind: 'annexe' },
        /* loading platforms, long and low, running with the tracks */
        { x: 13, y: 2.5, w: 9, h: 3,  top: 2.0, blocks: false, kind: 'gantry' },
        { x: 13, y: 24.5, w: 9, h: 3, top: 2.0, blocks: false, kind: 'gantry' },
        /* container ranks — staggered, so a lane is never straight */
        { x: 14, y: 6.5, w: 6, h: 2,  top: 3.6, blocks: true,  kind: 'wall' },
        { x: 14, y: 21.5, w: 6, h: 2, top: 3.6, blocks: true,  kind: 'wall' },
        { x: 21, y: 9,   w: 5, h: 2,  top: 3.6, blocks: true,  kind: 'wall' },
        { x: 21, y: 19,  w: 5, h: 2,  top: 3.6, blocks: true,  kind: 'wall' },
        { x: 16, y: 11,  w: 2, h: 3,  top: 3.0, blocks: true,  kind: 'pillar' },
        { x: 16, y: 16,  w: 2, h: 3,  top: 3.0, blocks: true,  kind: 'pillar' },
        /* a signal gantry over the yard */
        { x: 20.5, y: 3.5, w: 3, h: 3, top: 4.0, blocks: false, kind: 'gantry' },
        { x: 20.5, y: 23.5, w: 3, h: 3, top: 4.0, blocks: false, kind: 'gantry' },
        /* and almost nothing in the middle of it */
        { x: 21, y: 13.5, w: 4, h: 3, top: 1.1, blocks: false, kind: 'rubble' }
      ], w),
      objectives: []
    };
  }

  /* ----------------------------------------------------------- KING OF THE HILL
     The card says the tallest terrain near the centre is the HIGH GROUND, so
     the table has to make that obvious: one massif, far taller than anything
     else, with more than one way up and open ground around it. */
  function pinnacle() {
    const w = 42, h = 30;
    return {
      id: 'pinnacle', missionId: 'hill', biome: 'snow', name: 'THE PINNACLE',
      blurb: 'One massif in the middle, taller than anything else on the table, ' +
             'with three ways up it and nowhere to hide at its foot.',
      w: w, h: h,
      deploy: [{ x: 0, y: 0, w: 6, h: h }, { x: w - 6, y: 0, w: 6, h: h }],
      /* A BASTION on three terraces, with a village of outbuildings round its
         foot. The massif still towers over everything — the card needs that to
         be unmistakable — but the ground at the bottom is now a place you fight
         through rather than a field you walk across. */
      terrain: mirrored([
        { x: 13, y: 8,  w: 16, h: 14, top: 1.6, blocks: false, kind: 'nave' },
        { x: 15, y: 9.5, w: 12, h: 11, top: 3.0, blocks: false, kind: 'nave' },
        { x: 17.5, y: 11, w: 7, h: 8,  top: 6.2, blocks: false, kind: 'sanctum' },
        /* The outbuildings at its foot — deliberately OFF the axes. The card
           wants the massif to command the table, and now that sight is a real
           line rather than "taller than the wall wins", anything left standing
           on the lane out from the peak genuinely blocks it. Cover goes in the
           quadrants; the approaches stay open. */
        { x: 8,  y: 2.5, w: 4.5, h: 4, top: 3.8, blocks: true,  kind: 'blockhouse' },
        { x: 8,  y: 23.5, w: 4.5, h: 4, top: 3.8, blocks: true, kind: 'blockhouse' },
        { x: 7,  y: 8,  w: 3, h: 3.4, top: 3.2, blocks: true,  kind: 'annexe' },
        { x: 7,  y: 18.6, w: 3, h: 3.4, top: 3.2, blocks: true, kind: 'annexe' },
        { x: 10.5, y: 7.5, w: 2.5, h: 3, top: 2.8, blocks: true, kind: 'pillar' },
        { x: 10.5, y: 19.5, w: 2.5, h: 3, top: 2.8, blocks: true, kind: 'pillar' },
        /* a walled approach on each side of the hill */
        { x: 14, y: 3,  w: 6, h: 2, top: 2.6, blocks: true,  kind: 'wall' },
        { x: 14, y: 25, w: 6, h: 2, top: 2.6, blocks: true,  kind: 'wall' },
        { x: 12, y: 5,  w: 2, h: 2.5, top: 2.2, blocks: false, kind: 'step' },
        { x: 12, y: 22.5, w: 2, h: 2.5, top: 2.2, blocks: false, kind: 'step' },
        { x: 11.5, y: 4,  w: 2, h: 4, top: 1.2, blocks: false, kind: 'rubble' },
        { x: 11.5, y: 22, w: 2, h: 4, top: 1.2, blocks: false, kind: 'rubble' }
      ], w),
      objectives: []
    };
  }

  /* ----------------------------------------------------------------- AMBUSH
     One side is dug in with the BAIT and the other has to come and get it, so
     the ground that matters is the ground in between: both ends are a nest of
     cover and the middle is bare. */
  function killZone() {
    const w = 46, h = 28;
    return {
      id: 'killzone', missionId: 'ambush', biome: 'desert', name: 'THE KILL ZONE',
      blurb: 'A nest of cover at either end and nothing worth the name in ' +
             'between. Whoever crosses first is the one in the open.',
      w: w, h: h,
      deploy: [{ x: 0, y: 0, w: 8, h: h }, { x: w - 8, y: 0, w: 8, h: h }],
      /* A DEFILE. Both ends are a warren of dug-in positions and the road
         between them runs bare down the middle — the card is about who has to
         cross it. The ridges are stepped, so a firing position on one is worth
         holding and can be taken off you. */
      terrain: mirrored([
        { x: 4,  y: 3,  w: 4.5, h: 4.5, top: 4.2, blocks: true,  kind: 'bunker' },
        { x: 4,  y: 20.5, w: 4.5, h: 4.5, top: 4.2, blocks: true, kind: 'bunker' },
        { x: 9.5, y: 2,  w: 5, h: 3,   top: 3.6, blocks: true,  kind: 'wall' },
        { x: 9.5, y: 23, w: 5, h: 3,   top: 3.6, blocks: true,  kind: 'wall' },
        { x: 9,  y: 11, w: 3, h: 6,   top: 3.4, blocks: true,  kind: 'wall' },
        { x: 12.5, y: 6,  w: 5, h: 3, top: 2.2, blocks: false, kind: 'gantry' },
        { x: 12.5, y: 19, w: 5, h: 3, top: 2.2, blocks: false, kind: 'gantry' },
        { x: 13, y: 12,  w: 3, h: 4,  top: 4.6, blocks: true,  kind: 'blockhouse' },
        /* the crossing: two thin things and a great deal of nothing */
        { x: 19.5, y: 2,  w: 2, h: 5, top: 3.0, blocks: true,  kind: 'pillar' },
        { x: 19.5, y: 21, w: 2, h: 5, top: 3.0, blocks: true,  kind: 'pillar' },
        { x: 21.5, y: 12.5, w: 3, h: 3, top: 1.1, blocks: false, kind: 'rubble' }
      ], w),
      objectives: []
    };
  }

  /* ---------------------------------------------------------- ASSASSINATION
     One marker in the middle and a named head on each side, so the table wants
     long lanes onto the centre and corners deep enough to keep a TARGET out of
     sight until it matters. */
  function crossroads() {
    const w = 40, h = 28;
    return {
      id: 'crossroads', missionId: 'assassination', biome: 'forest', name: 'THE CROSSROADS',
      blurb: 'Four lanes meeting on one marker, and a blockhouse in each corner ' +
             'deep enough to keep a name out of sight.',
      w: w, h: h,
      deploy: [{ x: 0, y: 0, w: 6, h: h }, { x: w - 6, y: 0, w: 6, h: h }],
      /* A CROSSROADS with a shrine at the junction, and woods you go INTO. Four corner holdings deep
         enough to keep a named head out of sight, walled yards behind them,
         and four clear lanes running onto the marker in the middle. */
      terrain: mirrored([
        { x: 8,  y: 2,  w: 6, h: 6,   top: 4.4, blocks: true,  kind: 'blockhouse' },
        { x: 8,  y: 20, w: 6, h: 6,   top: 4.4, blocks: true,  kind: 'blockhouse' },
        { x: 14.5, y: 3, w: 3, h: 3.5, top: 3.0, blocks: true, kind: 'annexe' },
        { x: 14.5, y: 21.5, w: 3, h: 3.5, top: 3.0, blocks: true, kind: 'annexe' },
        /* the yard walls, which make the corners into places */
        { x: 8,  y: 8.5, w: 6, h: 1.6, top: 2.4, blocks: true,  kind: 'wall' },
        { x: 8,  y: 17.9, w: 6, h: 1.6, top: 2.4, blocks: true, kind: 'wall' },
        { x: 7,  y: 12, w: 2, h: 4,   top: 3.0, blocks: true,  kind: 'pillar' },
        /* the steps up onto the junction itself */
        { x: 16, y: 9,  w: 3, h: 3,   top: 2.2, blocks: false, kind: 'step' },
        { x: 16, y: 16, w: 3, h: 3,   top: 2.2, blocks: false, kind: 'step' },
        { x: 16.5, y: 12.5, w: 3, h: 3, top: 1.2, blocks: false, kind: 'rubble' },
        /* stands of trees: they hide you and you walk in among them */
        { x: 15, y: 2,  w: 5, h: 4, top: 3.4, blocks: true, soft: true, kind: 'wood' },
        { x: 15, y: 22, w: 5, h: 4, top: 3.4, blocks: true, soft: true, kind: 'wood' },
        { x: 9,  y: 10, w: 4, h: 3, top: 3.2, blocks: true, soft: true, kind: 'wood' },
        { x: 9,  y: 15, w: 4, h: 3, top: 3.2, blocks: true, soft: true, kind: 'wood' }
      ], w),
      objectives: [{ x: 20, y: 14 }]
    };
  }

  /* -------------------------------------------------------- SECURE THE AREA
     Three markers, one in the middle and one to each flank, and each of them
     wants to be somewhere worth standing rather than a spot on bare floor. */
  function threeStations() {
    const w = 46, h = 28;
    return {
      id: 'stations', missionId: 'secure', biome: 'graveyard', name: 'THREE STATIONS',
      blurb: 'Three raised stations — one to each flank and one in the middle. ' +
             'Holding two means standing where the third can see you.',
      w: w, h: h,
      deploy: [{ x: 0, y: 0, w: 6, h: h }, { x: w - 6, y: 0, w: 6, h: h }],
      /* THREE WALLED COMPOUNDS. Each station is a raised court inside its own
         wall, with a mausoleum at the corner and a gate you have to come
         through — holding one is standing somewhere, not on a spot of floor. */
      terrain: mirrored([
        { x: 9,  y: 10, w: 7, h: 8,   top: 2.2, blocks: false, kind: 'redoubt' },
        { x: 8,  y: 8.4, w: 9, h: 1.4, top: 3.0, blocks: true, kind: 'wall' },
        { x: 8,  y: 18.2, w: 9, h: 1.4, top: 3.0, blocks: true, kind: 'wall' },
        { x: 7,  y: 11, w: 1.6, h: 3, top: 3.4, blocks: true,  kind: 'pillar' },
        { x: 7,  y: 16, w: 1.6, h: 3, top: 3.4, blocks: true,  kind: 'pillar' },
        /* the middle station, higher, so it overlooks both */
        { x: 19, y: 10, w: 8, h: 8,   top: 3.2, blocks: false, kind: 'nave' },
        { x: 18.5, y: 8.2, w: 9, h: 1.5, top: 4.0, blocks: true, kind: 'wall' },
        { x: 18.5, y: 18.3, w: 9, h: 1.5, top: 4.0, blocks: true, kind: 'wall' },
        /* mausolea between the compounds */
        { x: 8,  y: 3,  w: 5, h: 3,   top: 3.8, blocks: true,  kind: 'blockhouse' },
        { x: 8,  y: 22, w: 5, h: 3,   top: 3.8, blocks: true,  kind: 'blockhouse' },
        { x: 16, y: 3.5, w: 3, h: 3,  top: 3.4, blocks: true,  kind: 'annexe' },
        { x: 16, y: 21.5, w: 3, h: 3, top: 3.4, blocks: true,  kind: 'annexe' },
        { x: 15, y: 12.5, w: 2.5, h: 3, top: 1.2, blocks: false, kind: 'rubble' }
      ], w),
      objectives: [{ x: 12.5, y: 14 }, { x: 33.5, y: 14 }, { x: 23, y: 14 }]
    };
  }

  /* -------------------------------------------------------------- THE RELIC
     Picked up in the middle and carried home, so what matters is the run back:
     a plaza to fight over and a gauntlet of half-cover each way. */
  function longWalk() {
    const w = 46, h = 30;
    return {
      id: 'longwalk', missionId: 'relic', biome: 'wasteland', name: 'THE LONG WALK',
      blurb: 'A plaza in the middle worth fighting over, and a gauntlet of ' +
             'half-cover between it and either end. Carrying it is the hard part.',
      w: w, h: h,
      deploy: [{ x: 0, y: 0, w: 7, h: h }, { x: w - 7, y: 0, w: 7, h: h }],
      /* A PROCESSIONAL WAY. The reliquary stands on a plaza at the centre; a
         colonnade runs down each side of the avenue, with side chapels behind
         it, and there are galleries overlooking the whole run. Carrying it
         home means going the length of that under everybody's guns. */
      terrain: mirrored([
        { x: 19, y: 11, w: 8, h: 8,   top: 1.8, blocks: false, kind: 'redoubt' },
        /* the colonnade: a rank of piers each side of the avenue */
        { x: 12, y: 9,  w: 1.8, h: 3, top: 3.4, blocks: true,  kind: 'pillar' },
        { x: 12, y: 18, w: 1.8, h: 3, top: 3.4, blocks: true,  kind: 'pillar' },
        { x: 16, y: 6.5, w: 1.8, h: 3, top: 3.4, blocks: true, kind: 'pillar' },
        { x: 16, y: 20.5, w: 1.8, h: 3, top: 3.4, blocks: true, kind: 'pillar' },
        /* side chapels behind the colonnade */
        { x: 8,  y: 5,  w: 5, h: 4,   top: 4.2, blocks: true,  kind: 'blockhouse' },
        { x: 8,  y: 21, w: 5, h: 4,   top: 4.2, blocks: true,  kind: 'blockhouse' },
        { x: 8,  y: 13, w: 2, h: 4,   top: 2.6, blocks: true,  kind: 'pillar' },
        { x: 13.5, y: 13, w: 3, h: 4, top: 3.2, blocks: true,  kind: 'slab' },
        /* galleries over the walk */
        { x: 14, y: 2,  w: 6, h: 3,   top: 2.6, blocks: false, kind: 'gantry' },
        { x: 14, y: 25, w: 6, h: 3,   top: 2.6, blocks: false, kind: 'gantry' },
        { x: 21, y: 4,  w: 4, h: 3,   top: 3.6, blocks: false, kind: 'gantry' },
        { x: 21, y: 23, w: 4, h: 3,   top: 3.6, blocks: false, kind: 'gantry' }
      ], w),
      objectives: []
    };
  }

  const list = [openGround(), supplyLines(), pinnacle(), killZone(),
                crossroads(), threeStations(), longWalk()];

  const byId = id => list.find(m => m.id === id) || list[0];
  const forMission = missionId =>
    list.find(m => m.missionId === (missionId || null)) || list[0];

  return { list, byId, forMission, BIOMES, biomeOf: m => BIOMES[m.biome] || BIOMES.rockcrete };
})();
