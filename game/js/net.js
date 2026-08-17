/* =========================================================================
   PLAYING SOMEBODY ELSE
   One player hosts a room and reads out a four-letter code; the other types it
   in. The connection is peer to peer over PeerJS's public broker — there is no
   server of ours in the middle, and nothing to deploy.

   What crosses the wire is the DECISION, never the board: "Fred shoots
   Snitcherz with the Modded Lasgun", not "Snitcherz is now on 1 wound". Both
   ends run the same rules over the same seeded dice in the same order, so both
   arrive at the same table. It is a fraction of the traffic, and it means a
   desync is a bug in the rules rather than something the network papers over.
   ========================================================================= */

const Net = (function () {

  const PREFIX = 'whsk-';
  let peer = null, conn = null;
  let seat = 0;                  // 0 if you host, 1 if you join
  let live = false;
  let code = null;
  let onReady = null;            // called with the agreed config when both are in
  let status = 'offline';
  const listeners = [];

  const active = () => live;
  const mySeat = () => seat;
  const roomCode = () => code;
  const state = () => status;
  const onChange = fn => listeners.push(fn);
  const changed = () => listeners.forEach(f => f(status, code, seat));

  function newCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   /* no I/O/0/1 to read out loud */
    let s = '';
    for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  function fail(msg) {
    status = 'error:' + msg;
    live = false;
    changed();
  }

  function ensurePeerLib() {
    if (window.Peer) return true;
    fail('the multiplayer library did not load');
    return false;
  }

  /* ------------------------------------------------------------------ host */

  function host(cfg, ready) {
    if (!ensurePeerLib()) return;
    onReady = ready;
    seat = 0;
    code = newCode();
    status = 'hosting';
    changed();

    peer = new Peer(PREFIX + code, { debug: 0 });
    peer.on('error', function (e) {
      /* the code was taken — try another rather than making them retype it */
      if (e && /unavailable|taken/i.test(String(e.type || e))) { host(cfg, ready); return; }
      fail(String(e && e.type ? e.type : e));
    });
    peer.on('open', function () { status = 'waiting'; changed(); });
    peer.on('connection', function (c) {
      if (conn) { c.close(); return; }
      conn = c;
      wireConn();
      c.on('open', function () {
        /* the host decides the game, including the seed the dice run on */
        const deal = Object.assign({}, cfg, { seed: (Math.random() * 1e9) | 0 });
        c.send({ t: 'hello', cfg: deal });
        live = true;
        status = 'playing';
        changed();
        if (onReady) onReady(deal, 0);
      });
    });
  }

  /* ------------------------------------------------------------------ join */

  function join(theirCode, ready) {
    if (!ensurePeerLib()) return;
    onReady = ready;
    seat = 1;
    code = String(theirCode || '').trim().toUpperCase();
    status = 'joining';
    changed();

    peer = new Peer(null, { debug: 0 });
    peer.on('error', e => fail(String(e && e.type ? e.type : e)));
    peer.on('open', function () {
      conn = peer.connect(PREFIX + code, { reliable: true });
      wireConn();
      conn.on('open', function () { status = 'handshake'; changed(); });
    });
  }

  function wireConn() {
    conn.on('data', function (msg) {
      if (!msg) return;
      if (msg.t === 'hello') {
        live = true;
        status = 'playing';
        changed();
        if (onReady) onReady(msg.cfg, 1);
        return;
      }
      if (msg.t === 'chat') { return; }
      /* everything else is a decision to replay */
      GameUI.apply(msg);
    });
    conn.on('close', function () { live = false; status = 'dropped'; changed(); });
    conn.on('error', e => fail(String(e && e.type ? e.type : e)));
  }

  function send(msg) {
    if (!live || !conn || !conn.open) return;
    try { conn.send(msg); } catch (e) { /* the close handler reports it */ }
  }

  function hangUp() {
    try { if (conn) conn.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    conn = peer = null;
    live = false;
    status = 'offline';
    changed();
  }

  /* Nothing to do on these yet — the hooks exist so the UI can stay dumb. */
  function onStart() {}
  function onState() {}

  return {
    host, join, send, hangUp, active, onChange,
    seat: mySeat, code: roomCode, status: state,
    onStart, onState
  };
})();
