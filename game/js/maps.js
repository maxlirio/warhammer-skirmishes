/* =========================================================================
   BATTLEFIELDS
   Measured in inches, like the table they stand in for. Terrain is boxes:

     blocks: true    a ruin or blockhouse. You cannot walk through it, and you
                     cannot see past it unless you are standing higher than
                     `top` — so a 4" wall stops mattering from a 5" gantry.
     blocks: false   a platform. You walk onto it and it puts your eye at
                     `top`, which is what the elevation rules are about.

   Every table is symmetric left to right, gives each player exactly one
   objective they can hold cheaply, and puts the rest where holding them means
   standing in somebody's line of fire. `node tools/checkmaps.js` enforces it.
   ========================================================================= */

const MAPS = (function () {

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

  function manufactorum() {
    const w = 44, h = 30;
    return {
      id: 'manufactorum', name: 'RUINED MANUFACTORUM',
      blurb: 'A killing floor straight down the middle with three markers on it, ' +
             'and a gantry north and south that shoots down into everything.',
      w: w, h: h,
      deploy: [{ x: 0, y: 0, w: 7, h: h }, { x: w - 7, y: 0, w: 7, h: h }],
      terrain: mirrored([
        /* the gantries that overlook the killing floor */
        { x: 17, y: 3,  w: 10, h: 6, top: 1.6, blocks: false, kind: 'gantry' },
        { x: 17, y: 21, w: 10, h: 6, top: 1.6, blocks: false, kind: 'gantry' },
        /* blockhouses in the four quadrants, clear of every firing lane */
        { x: 12, y: 4,  w: 4, h: 5, top: 4.5, blocks: true, kind: 'blockhouse' },
        { x: 12, y: 21, w: 4, h: 5, top: 4.5, blocks: true, kind: 'blockhouse' },
        /* slabs to cross the open ground behind */
        { x: 6,  y: 9,  w: 2, h: 4, top: 3.2, blocks: true, kind: 'slab' },
        { x: 6,  y: 17, w: 2, h: 4, top: 3.2, blocks: true, kind: 'slab' },
        /* spoil heaps flanking the centre marker — cover, not a wall */
        { x: 19, y: 12,   w: 6, h: 1.5, top: 1.1, blocks: false, kind: 'rubble' },
        { x: 19, y: 16.5, w: 6, h: 1.5, top: 1.1, blocks: false, kind: 'rubble' }
      ], w),
      objectives: [
        { x: 9,  y: 15 }, { x: 35, y: 15 },     /* one home marker each */
        { x: 22, y: 15 },                        /* the middle of the floor */
        { x: 22, y: 6 },  { x: 22, y: 24 }       /* up on the gantries */
      ]
    };
  }

  function trenchline() {
    const w = 40, h = 28;
    return {
      id: 'trenchline', name: 'THE TRENCH LINE',
      blurb: 'One long open lane between the two home markers, and a redoubt in ' +
             'the middle of it that you cannot see across from the floor.',
      w: w, h: h,
      deploy: [{ x: 0, y: 0, w: 6, h: h }, { x: w - 6, y: 0, w: 6, h: h }],
      terrain: mirrored([
        { x: 16, y: 10, w: 8, h: 8, top: 2.2, blocks: false, kind: 'redoubt' },
        /* the trench walls, with the centre left open to cross */
        { x: 10, y: 6,  w: 8, h: 2, top: 3.4, blocks: true, kind: 'trench' },
        { x: 10, y: 20, w: 8, h: 2, top: 3.4, blocks: true, kind: 'trench' },
        /* bunkers back near the deployment lines */
        { x: 5,  y: 2,  w: 3, h: 4, top: 4.2, blocks: true, kind: 'bunker' },
        { x: 5,  y: 22, w: 3, h: 4, top: 4.2, blocks: true, kind: 'bunker' },
        /* a firing step to either flank of the redoubt */
        { x: 12, y: 13, w: 2, h: 2, top: 1.4, blocks: false, kind: 'step' }
      ], w),
      objectives: [
        { x: 8,  y: 14 }, { x: 32, y: 14 },
        { x: 20, y: 14 },
        { x: 20, y: 5 },  { x: 20, y: 23 }
      ]
    };
  }

  function shrine() {
    const w = 40, h = 28;
    return {
      id: 'shrine', name: 'SHRINE OF THE SILENT SAINT',
      blurb: 'A raised nave you cannot see across from the floor, and from the top ' +
             'of which you can see the whole shrine. Everything else is open ground.',
      w: w, h: h,
      deploy: [{ x: 0, y: 0, w: 6, h: h }, { x: w - 6, y: 0, w: 6, h: h }],
      terrain: mirrored([
        /* the nave, and the sanctum standing higher again at the middle of it */
        { x: 14, y: 8,  w: 12, h: 12, top: 2.4, blocks: false, kind: 'nave' },
        { x: 17, y: 11, w: 6,  h: 6,  top: 3.6, blocks: false, kind: 'sanctum' },
        /* the reliquary walls, open to north and south */
        { x: 14, y: 4,  w: 3, h: 2, top: 4.6, blocks: true, kind: 'wall' },
        { x: 14, y: 22, w: 3, h: 2, top: 4.6, blocks: true, kind: 'wall' },
        /* cloister pillars */
        { x: 11, y: 5,  w: 2,   h: 2, top: 5.2, blocks: true, kind: 'pillar' },
        { x: 11, y: 21, w: 2,   h: 2, top: 5.2, blocks: true, kind: 'pillar' },
        /* kept clear of the y=14 lane, so the nave can still see the home markers */
        { x: 10, y: 9,  w: 1.6, h: 3, top: 5.2, blocks: true, kind: 'pillar' },
        { x: 10, y: 16, w: 1.6, h: 3, top: 5.2, blocks: true, kind: 'pillar' }
      ], w),
      objectives: [
        { x: 8,  y: 14 }, { x: 32, y: 14 },
        { x: 20, y: 14 },
        { x: 20, y: 5 },  { x: 20, y: 23 }
      ]
    };
  }

  const list = [manufactorum(), trenchline(), shrine()];
  const byId = id => list.find(m => m.id === id) || list[0];

  return { list, byId };
})();
