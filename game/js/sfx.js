/* =========================================================================
   NOISE
   Synthesised rather than sampled: nothing to download, nothing to licence,
   and it still opens from a disc with the network off.

   The browser will not let audio start before the player touches something,
   which is fine — the first thing they touch is DEPLOY.
   ========================================================================= */

const Sfx = (function () {

  let ctx = null, master = null;
  let on = true;

  function wake() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    return ctx;
  }

  const enabled = v => { if (v !== undefined) on = v; return on; };
  const now = () => ctx.currentTime;

  /* A burst of noise, shaped. The backbone of most of these. */
  function noise(dur, opts) {
    opts = opts || {};
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      /* a touch of brown makes it read as impact rather than hiss */
      last = (last + 0.02 * white) / 1.02;
      d[i] = white * (1 - (opts.brown || 0)) + last * 12 * (opts.brown || 0);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function env(node, t0, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    return g;
  }

  function ping(freq, t0, dur, peak, type) {
    const o = ctx.createOscillator();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.82, t0 + dur);
    const g = env(o, t0, peak, 0.004, dur);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return g;
  }

  /* ---------------------------------------------------------------- the kit */

  /* A round striking armour or rockcrete and going away sideways. */
  function clang(vol) {
    if (!on || !wake()) return;
    const t = now(), v = (vol === undefined ? 1 : vol);
    /* the strike itself */
    const n = noise(0.16);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.1;
    n.connect(bp);
    env(bp, t, 0.5 * v, 0.002, 0.13).connect(master);
    n.start(t);
    /* the ring afterwards — two detuned partials, metal never rings clean */
    [1840, 2790, 4310].forEach(function (f, i) {
      ping(f * (1 + (i - 1) * 0.004), t + 0.004, 0.42 - i * 0.09, 0.20 * v / (i + 1))
        .connect(master);
    });
    const ric = ctx.createOscillator();
    ric.type = 'sawtooth';
    ric.frequency.setValueAtTime(1500, t + 0.01);
    ric.frequency.exponentialRampToValueAtTime(420, t + 0.3);
    const rg = env(ric, t + 0.01, 0.07 * v, 0.01, 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200;
    rg.connect(lp); lp.connect(master);
    ric.start(t + 0.01); ric.stop(t + 0.4);
  }

  /* The weapon going off. */
  function shot(vol) {
    if (!on || !wake()) return;
    const t = now(), v = (vol === undefined ? 1 : vol);
    const n = noise(0.13, { brown: 0.35 });
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 700;
    n.connect(hp);
    env(hp, t, 0.55 * v, 0.001, 0.11).connect(master);
    n.start(t);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const g = env(o, t, 0.3 * v, 0.002, 0.13);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    g.connect(lp); lp.connect(master);
    o.start(t); o.stop(t + 0.2);
  }

  /* A blade or fist landing on somebody. */
  function swing(vol) {
    if (!on || !wake()) return;
    const t = now(), v = (vol === undefined ? 1 : vol);
    const n = noise(0.3, { brown: 0.6 });
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.22);
    bp.Q.value = 2.2;
    n.connect(bp);
    env(bp, t, 0.30 * v, 0.09, 0.16).connect(master);
    n.start(t);
  }

  /* It got through. Wet, low, and not much of it. */
  function wound(vol) {
    if (!on || !wake()) return;
    const t = now(), v = (vol === undefined ? 1 : vol);
    const n = noise(0.22, { brown: 0.8 });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.2);
    n.connect(lp);
    env(lp, t, 0.75 * v, 0.004, 0.2).connect(master);
    n.start(t);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.24);
    env(o, t, 0.4 * v, 0.005, 0.26).connect(master);
    o.start(t); o.stop(t + 0.32);
  }

  /* A model going down. */
  function down() {
    if (!on || !wake()) return;
    wound(1.1);
    const t = now() + 0.16;
    const n = noise(0.5, { brown: 0.9 });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 340;
    n.connect(lp);
    env(lp, t, 0.6, 0.02, 0.44).connect(master);
    n.start(t);
    [110, 74].forEach((f, i) => ping(f, t + i * 0.05, 0.5, 0.22, 'sine').connect(master));
  }

  /* Boots on rockcrete, and hauling yourself up something. */
  function step(vol) {
    if (!on || !wake()) return;
    const t = now();
    const n = noise(0.07, { brown: 0.5 });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1300;
    n.connect(lp);
    env(lp, t, 0.10 * (vol === undefined ? 1 : vol), 0.003, 0.06).connect(master);
    n.start(t);
  }

  function climb() {
    if (!on || !wake()) return;
    const t = now();
    const n = noise(0.42, { brown: 0.7 });
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.34);
    bp.Q.value = 1.4;
    n.connect(bp);
    env(bp, t, 0.24, 0.06, 0.34).connect(master);
    n.start(t);
    ping(220, t + 0.3, 0.16, 0.12, 'triangle').connect(master);
  }

  /* A marker being taken, and the low note under a victory. */
  function chime(freq, vol) {
    if (!on || !wake()) return;
    const t = now();
    [1, 1.5, 2].forEach((m, i) =>
      ping((freq || 520) * m, t + i * 0.05, 1.1 - i * 0.2, (vol || 0.2) / (i + 1), 'sine')
        .connect(master));
  }

  const ui = () => { if (on && wake()) ping(720, now(), 0.07, 0.06, 'sine').connect(master); };

  return { wake, enabled, clang, shot, swing, wound, down, step, climb, chime, ui };
})();
