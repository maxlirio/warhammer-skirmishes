/* =========================================================================
   SURFACES
   Procedural PBR, generated in the page. No downloads, no licences, nothing
   to go stale.

   The old table looked like a toy for one reason above all others: every
   surface on it was a flat colour under a flat light. Real materials are not
   flat — concrete has form-tie holes and pour seams and rain streaks, steel
   has rivets and rust bleeding downward, snow drifts and packs. You read all
   of that off the way light catches the SURFACE, which means a normal map,
   which is the single biggest lever between "low-poly" and "real".

   So each material here is three images built on a canvas: colour, height —
   turned into a normal map — and roughness. They are cached, because a 1K
   normal map costs about 40ms to build and there are only a dozen of them.

   Everything is tileable: the noise wraps, so a wall four inches across and
   one forty inches across use the same texture without a visible seam.
   ========================================================================= */

const Mats = (function () {

  const cache = {};
  const SIZE = 512;                 /* per side; normals are generated at 2x */

  /* ------------------------------------------------------------- plumbing */

  function surface(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size || SIZE;
    return c;
  }

  /* Value noise that WRAPS. A texture with a seam down one edge is worse than
     no texture at all, because the eye finds the repeat instantly. */
  function lattice(n, seed) {
    const g = new Float32Array(n * n);
    let t = (seed || 1) >>> 0;
    for (let i = 0; i < g.length; i++) {
      t ^= t << 13; t >>>= 0;
      t ^= t >> 17;
      t ^= t << 5; t >>>= 0;
      g[i] = (t >>> 0) / 4294967296;
    }
    return g;
  }

  const smooth = t => t * t * (3 - 2 * t);

  function sample(g, n, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const u = smooth(xf), v = smooth(yf);
    const a = g[y0 * n + x0], b = g[y0 * n + x1];
    const c = g[y1 * n + x0], d = g[y1 * n + x1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  /* Fractal noise, wrapping, in [0,1]. */
  function fbm(w, h, opts) {
    opts = opts || {};
    const oct = opts.octaves || 5;
    const base = opts.base || 4;
    const gain = opts.gain === undefined ? 0.5 : opts.gain;
    const out = new Float32Array(w * h);
    let amp = 1, total = 0;
    for (let o = 0; o < oct; o++) {
      const n = base * Math.pow(2, o);
      const g = lattice(n, (opts.seed || 7) * 131 + o * 977);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          out[y * w + x] += amp * sample(g, n, (x / w) * n, (y / h) * n);
        }
      }
      total += amp;
      amp *= gain;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }

  /* A height field becomes a normal map. This is the whole trick: the mesh
     stays flat and cheap, the light behaves as though it is not. */
  function normalFrom(height, w, h, strength) {
    const c = surface(w);
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const s = strength === undefined ? 2.4 : strength;
    const at = (x, y) => height[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        /* Sobel, wrapped */
        const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
                 - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
        const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
                 - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
        let nx = -dx * s, ny = -dy * s, nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len; ny /= len; nz /= len;
        const i = (y * w + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function greyFrom(field, w, h, lo, hi) {
    const c = surface(w);
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    for (let i = 0; i < field.length; i++) {
      const v = Math.round((lo + field[i] * (hi - lo)) * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function tex(canvas, repeat) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    return t;
  }

  /* ------------------------------------------------------------- the paint */

  const rgb = (r, g, b) => 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';

  function paintNoise(g, field, w, h, from, to, alpha) {
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < field.length; i++) {
      const v = field[i];
      const j = i * 4;
      const a = alpha === undefined ? 1 : alpha;
      img.data[j]     = img.data[j]     * (1 - a) + (from[0] + (to[0] - from[0]) * v) * a;
      img.data[j + 1] = img.data[j + 1] * (1 - a) + (from[1] + (to[1] - from[1]) * v) * a;
      img.data[j + 2] = img.data[j + 2] * (1 - a) + (from[2] + (to[2] - from[2]) * v) * a;
    }
    g.putImageData(img, 0, 0);
  }

  /* Streaks running DOWN a vertical surface. Rain and rust do not run
     sideways, and getting that one direction right is most of what makes a
     wall look weathered rather than dirty. */
  function streaks(g, w, h, colour, n, seed) {
    g.save();
    for (let i = 0; i < n; i++) {
      const s = (Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1;
      const x = Math.abs(s) * w;
      const top = Math.abs((s * 7.13) % 1) * h * 0.6;
      const len = h * (0.2 + Math.abs((s * 3.7) % 1) * 0.7);
      const wide = 1 + Math.abs((s * 11.3) % 1) * (w / 90);
      const grad = g.createLinearGradient(0, top, 0, top + len);
      grad.addColorStop(0, 'rgba(' + colour + ',' + (0.16 + Math.abs(s % 1) * 0.2) + ')');
      grad.addColorStop(1, 'rgba(' + colour + ',0)');
      g.fillStyle = grad;
      g.fillRect(x, top, wide, len);
    }
    g.restore();
  }

  function speckle(g, w, h, n, seed, colours) {
    for (let i = 0; i < n; i++) {
      const a = Math.abs((Math.sin(seed + i * 91.7) * 43758.5453) % 1);
      const b = Math.abs((Math.sin(seed + i * 37.3) * 24634.6345) % 1);
      const c = Math.abs((Math.sin(seed + i * 12.1) * 13571.1357) % 1);
      g.fillStyle = colours[Math.floor(c * colours.length) % colours.length];
      const r = 0.5 + c * (w / 220);
      g.beginPath();
      g.arc(a * w, b * h, r, 0, 6.283);
      g.fill();
    }
  }

  /* ============================================================ MATERIALS */

  /* Each returns { map, normalMap, roughnessMap } as canvases. */

  const RECIPE = {

    /* Cast rockcrete: poured in lifts, tied with form ties, stained by
       whatever has run down it since. */
    rockcrete: function () {
      const w = SIZE, h = SIZE;
      const grain = fbm(w, h, { octaves: 6, base: 6, seed: 3 });
      const blotch = fbm(w, h, { octaves: 3, base: 2, seed: 11, gain: 0.6 });
      const c = surface(w), g = c.getContext('2d');
      g.fillStyle = rgb(136, 137, 134); g.fillRect(0, 0, w, h);
      paintNoise(g, grain, w, h, [104, 106, 104], [158, 159, 156], 1);
      paintNoise(g, blotch, w, h, [86, 88, 88], [160, 160, 157], 0.34);

      /* pour seams across, form ties in a grid */
      const height = new Float32Array(grain.length);
      for (let i = 0; i < grain.length; i++) height[i] = grain[i] * 0.55;
      const lift = Math.round(h / 3);
      g.strokeStyle = 'rgba(70,68,62,.5)'; g.lineWidth = Math.max(1, w / 340);
      for (let y = lift; y < h; y += lift) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
        for (let x = 0; x < w; x++) {
          for (let d = -2; d <= 2; d++) {
            const yy = y + d;
            if (yy >= 0 && yy < h) height[yy * w + x] -= 0.4 * (1 - Math.abs(d) / 3);
          }
        }
      }
      const tie = Math.round(w / 4);
      for (let y = Math.round(lift / 2); y < h; y += lift) {
        for (let x = Math.round(tie / 2); x < w; x += tie) {
          g.fillStyle = 'rgba(58,56,50,.62)';
          g.beginPath(); g.arc(x, y, w / 150, 0, 6.283); g.fill();
          const r = Math.ceil(w / 150) + 1;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (dx * dx + dy * dy > r * r) continue;
              const xx = (x + dx + w) % w, yy = (y + dy + h) % h;
              height[yy * w + xx] -= 0.5;
            }
          }
        }
      }
      streaks(g, w, h, '54,50,42', 46, 4.2);
      speckle(g, w, h, 900, 17, ['rgba(80,78,72,.5)', 'rgba(190,186,176,.4)']);

      const rough = new Float32Array(grain.length);
      for (let i = 0; i < rough.length; i++) rough[i] = 0.82 + grain[i] * 0.16;
      return { map: c, normalMap: normalFrom(height, w, h, 3.0),
               roughnessMap: greyFrom(rough, w, h, 0, 1) };
    },

    /* Plate steel: rolled, riveted at the seams, and rusting from every edge
       downward. */
    steel: function () {
      const w = SIZE, h = SIZE;
      const grain = fbm(w, h, { octaves: 5, base: 8, seed: 23 });
      const rust = fbm(w, h, { octaves: 4, base: 3, seed: 41, gain: 0.55 });
      const c = surface(w), g = c.getContext('2d');
      g.fillStyle = rgb(96, 99, 102); g.fillRect(0, 0, w, h);
      paintNoise(g, grain, w, h, [72, 75, 79], [124, 127, 130], 1);
      /* rust wins where the blotch noise is high */
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < rust.length; i++) {
        const k = Math.max(0, (rust[i] - 0.52) / 0.48);
        const j = i * 4;
        img.data[j]     = img.data[j]     * (1 - k) + 128 * k;
        img.data[j + 1] = img.data[j + 1] * (1 - k) + 68 * k;
        img.data[j + 2] = img.data[j + 2] * (1 - k) + 38 * k;
      }
      g.putImageData(img, 0, 0);

      const height = new Float32Array(grain.length);
      for (let i = 0; i < grain.length; i++) height[i] = grain[i] * 0.3;

      /* plate seams and rivets */
      const plate = Math.round(h / 2);
      g.strokeStyle = 'rgba(44,46,48,.75)'; g.lineWidth = Math.max(1, w / 300);
      for (let y = plate; y <= h; y += plate) {
        g.beginPath(); g.moveTo(0, y % h); g.lineTo(w, y % h); g.stroke();
      }
      const rr = Math.max(1.6, w / 150);
      for (let y = plate; y <= h; y += plate) {
        for (let x = Math.round(w / 16); x < w; x += Math.round(w / 8)) {
          const yy = y % h;
          g.fillStyle = 'rgba(150,152,154,.85)';
          g.beginPath(); g.arc(x, yy, rr, 0, 6.283); g.fill();
          g.fillStyle = 'rgba(40,42,44,.5)';
          g.beginPath(); g.arc(x + rr * 0.3, yy + rr * 0.3, rr * 0.7, 0, 6.283); g.fill();
          const R = Math.ceil(rr) + 1;
          for (let dy = -R; dy <= R; dy++) {
            for (let dx = -R; dx <= R; dx++) {
              if (dx * dx + dy * dy > R * R) continue;
              const px = (x + dx + w) % w, py = (yy + dy + h) % h;
              height[py * w + px] += 0.55 * (1 - Math.hypot(dx, dy) / R);
            }
          }
        }
      }
      streaks(g, w, h, '104,54,26', 70, 9.1);

      const rough = new Float32Array(grain.length);
      for (let i = 0; i < rough.length; i++) {
        rough[i] = 0.34 + rust[i] * 0.55 + grain[i] * 0.1;
      }
      return { map: c, normalMap: normalFrom(height, w, h, 2.2),
               roughnessMap: greyFrom(rough, w, h, 0, 1), metalness: 0.85 };
    },

    /* Coursed blockwork with mortar between. */
    stone: function () {
      const w = SIZE, h = SIZE;
      const grain = fbm(w, h, { octaves: 6, base: 7, seed: 61 });
      const c = surface(w), g = c.getContext('2d');
      const height = new Float32Array(grain.length);
      for (let i = 0; i < grain.length; i++) height[i] = 0.55 + grain[i] * 0.45;

      g.fillStyle = rgb(126, 122, 114); g.fillRect(0, 0, w, h);
      const rows = 6, rowH = h / rows;
      for (let r = 0; r < rows; r++) {
        const cols = 4;
        const off = (r % 2) * (w / cols) * 0.5;
        for (let cI = -1; cI <= cols; cI++) {
          const x = cI * (w / cols) + off;
          const y = r * rowH;
          const jitter = Math.abs((Math.sin(r * 12.9 + cI * 78.2) * 43758.5) % 1);
          g.fillStyle = rgb(112 + jitter * 40, 108 + jitter * 38, 100 + jitter * 34);
          g.fillRect(x + 2, y + 2, w / cols - 4, rowH - 4);
        }
      }
      paintNoise(g, grain, w, h, [0, 0, 0], [255, 255, 255], 0.22);
      speckle(g, w, h, 700, 31, ['rgba(70,66,60,.45)', 'rgba(180,176,166,.35)']);

      /* mortar joints cut into the height */
      const cut = (x0, y0, x1, y1) => {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const xx = ((x % w) + w) % w, yy = ((y % h) + h) % h;
            height[yy * w + xx] = 0.06;
          }
        }
      };
      const j = Math.max(2, Math.round(w / 170));
      for (let r = 0; r <= rows; r++) cut(0, r * rowH - j, w, r * rowH + j);
      for (let r = 0; r < rows; r++) {
        const cols = 4, off = (r % 2) * (w / cols) * 0.5;
        for (let cI = -1; cI <= cols; cI++) {
          const x = cI * (w / cols) + off;
          cut(x - j, r * rowH, x + j, (r + 1) * rowH);
        }
      }
      const rough = new Float32Array(grain.length);
      for (let i = 0; i < rough.length; i++) rough[i] = 0.86 + grain[i] * 0.12;
      return { map: c, normalMap: normalFrom(height, w, h, 3.4),
               roughnessMap: greyFrom(rough, w, h, 0, 1) };
    },

    /* Packed snow, drifted. */
    snow: function () {
      const w = SIZE, h = SIZE;
      const drift = fbm(w, h, { octaves: 5, base: 3, seed: 83, gain: 0.55 });
      const grit = fbm(w, h, { octaves: 4, base: 24, seed: 97 });
      const c = surface(w), g = c.getContext('2d');
      g.fillStyle = rgb(226, 231, 237); g.fillRect(0, 0, w, h);
      paintNoise(g, drift, w, h, [198, 208, 220], [246, 249, 252], 1);
      paintNoise(g, grit, w, h, [214, 222, 232], [252, 253, 255], 0.3);
      const height = new Float32Array(drift.length);
      for (let i = 0; i < drift.length; i++) height[i] = drift[i] * 0.9 + grit[i] * 0.1;
      const rough = new Float32Array(drift.length);
      for (let i = 0; i < rough.length; i++) rough[i] = 0.62 + grit[i] * 0.3;
      return { map: c, normalMap: normalFrom(height, w, h, 1.5),
               roughnessMap: greyFrom(rough, w, h, 0, 1) };
    },

    /* Wind-rippled sand. */
    sand: function () {
      const w = SIZE, h = SIZE;
      const dune = fbm(w, h, { octaves: 4, base: 3, seed: 137, gain: 0.6 });
      const grit = fbm(w, h, { octaves: 4, base: 30, seed: 149 });
      const height = new Float32Array(dune.length);
      /* ripples: a sine along one axis, bent by the dune field */
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const ripple = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 18 + dune[i] * 9);
          height[i] = dune[i] * 0.6 + ripple * 0.3 + grit[i] * 0.1;
        }
      }
      const c = surface(w), g = c.getContext('2d');
      g.fillStyle = rgb(198, 168, 118); g.fillRect(0, 0, w, h);
      paintNoise(g, height, w, h, [168, 140, 94], [222, 196, 148], 1);
      speckle(g, w, h, 1200, 53, ['rgba(120,98,64,.3)', 'rgba(240,224,190,.3)']);
      const rough = new Float32Array(height.length);
      for (let i = 0; i < rough.length; i++) rough[i] = 0.9 + grit[i] * 0.08;
      return { map: c, normalMap: normalFrom(height, w, h, 1.8),
               roughnessMap: greyFrom(rough, w, h, 0, 1) };
    },

    /* Cracked ash-covered ground. */
    ash: function () {
      const w = SIZE, h = SIZE;
      const soft = fbm(w, h, { octaves: 5, base: 4, seed: 199 });
      const cell = fbm(w, h, { octaves: 2, base: 9, seed: 211, gain: 0.7 });
      const height = new Float32Array(soft.length);
      for (let i = 0; i < soft.length; i++) {
        /* ridged noise gives the polygon cracks of dried, baked ground */
        /* a hint of polygon cracking, not a field of it: at full strength the
           ridged noise reads as dried mud puddles rather than ash over
           rockcrete, which is what the floor of a manufactorum is */
        const ridge = 1 - Math.abs(cell[i] * 2 - 1);
        height[i] = soft[i] * 0.82 + Math.pow(ridge, 10) * 0.18;
      }
      const c = surface(w), g = c.getContext('2d');
      g.fillStyle = rgb(66, 63, 58); g.fillRect(0, 0, w, h);
      paintNoise(g, height, w, h, [40, 39, 37], [86, 84, 80], 1);
      speckle(g, w, h, 1600, 71, ['rgba(24,22,20,.45)', 'rgba(126,122,116,.22)']);
      const rough = new Float32Array(height.length);
      for (let i = 0; i < rough.length; i++) rough[i] = 0.92 + soft[i] * 0.06;
      return { map: c, normalMap: normalFrom(height, w, h, 2.6),
               roughnessMap: greyFrom(rough, w, h, 0, 1) };
    },

    /* Forest floor. */
    loam: function () {
      const w = SIZE, h = SIZE;
      const soft = fbm(w, h, { octaves: 6, base: 5, seed: 227 });
      const bits = fbm(w, h, { octaves: 3, base: 22, seed: 233 });
      const c = surface(w), g = c.getContext('2d');
      g.fillStyle = rgb(64, 66, 44); g.fillRect(0, 0, w, h);
      paintNoise(g, soft, w, h, [38, 42, 26], [96, 100, 62], 1);
      paintNoise(g, bits, w, h, [70, 58, 36], [104, 96, 60], 0.35);
      speckle(g, w, h, 1400, 89, ['rgba(30,34,20,.45)', 'rgba(118,112,70,.35)',
                                  'rgba(86,62,34,.4)']);
      const height = new Float32Array(soft.length);
      for (let i = 0; i < soft.length; i++) height[i] = soft[i] * 0.7 + bits[i] * 0.3;
      const rough = new Float32Array(height.length);
      for (let i = 0; i < rough.length; i++) rough[i] = 0.95;
      return { map: c, normalMap: normalFrom(height, w, h, 2.2),
               roughnessMap: greyFrom(rough, w, h, 0, 1) };
    }
  };

  /* ---------------------------------------------------------------- public */

  function build(name) {
    if (cache[name]) return cache[name];
    const make = RECIPE[name] || RECIPE.rockcrete;
    const r = make();
    cache[name] = {
      map: r.map, normalMap: r.normalMap, roughnessMap: r.roughnessMap,
      metalness: r.metalness || 0
    };
    return cache[name];
  }

  /* A three.js material for a surface of a given size in inches, so the
     texture is the same physical scale everywhere on the table. */
  function material(name, wIn, hIn, opts) {
    opts = opts || {};
    const r = build(name);
    const per = opts.inchesPerTile || 4;
    const rx = Math.max(0.35, (wIn || per) / per);
    const ry = Math.max(0.35, (hIn || per) / per);
    const m = new THREE.MeshStandardMaterial({
      map: tex(r.map, [rx, ry]),
      normalMap: tex(r.normalMap, [rx, ry]),
      roughnessMap: tex(r.roughnessMap, [rx, ry]),
      metalness: opts.metalness === undefined ? r.metalness : opts.metalness,
      roughness: 1,
      color: opts.color === undefined ? 0xffffff : opts.color
    });
    m.normalScale = new THREE.Vector2(opts.bump || 1, opts.bump || 1);
    return m;
  }

  const names = () => Object.keys(RECIPE);

  return { material, build, names, tex };
})();
