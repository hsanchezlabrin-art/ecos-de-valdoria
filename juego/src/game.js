// Cliente del juego en línea: cuenta, personajes, conexión y dibujo del mundo.
//
// La simulación corre en el servidor. Este archivo envía las acciones del jugador,
// recibe el estado de lo que tiene cerca 10 veces por segundo, lo suaviza
// (interpolación) y dibuja los eventos (daño, botín, efectos). Si la conexión se corta,
// se reconecta solo y vuelve a entrar con el mismo personaje.
(function () {
  const G = V.G;
  const { buildHumanoid, buildQuadruped, animateModel, animateDeath, setWeaponLook, setArmorLook } = V.Models;
  const { heightAt } = V.Terrain;
  const { ITEMS, CLASSES, MOBS, lookFor } = V.Data;
  const UI = new Proxy({}, { get: (_, k) => V.UI[k] }); // ui.js se carga después

  const THREE = window.THREE;
  const PROTOCOL = 2;
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const PROJ_SPEED = { arrow: 38, fire: 24, arcane: 26 };

  let P = null; // jugador local (reflejo del servidor)

  const net = {
    ws: null,
    url: null,
    myId: null,
    session: null,
    charId: null,
    playing: false,
    players: new Map(),
    mobs: new Map(),
    projectiles: new Map(),
    queue: [],
    waiters: [],
    count: 0,
    sentDir: '',
    dirAt: 0,
    lastMsg: 0,
    pingTimer: null,
    reconnecting: false,
    onLost: null,
    onReconnect: null,
    onKicked: null,
  };

  // ---------- Conexión ----------

  function send(msg) {
    if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(msg));
  }

  // Espera el primer mensaje de alguno de los tipos indicados
  function waitFor(types, ms = 12000) {
    return new Promise((resolve, reject) => {
      const w = { types, resolve, reject, timer: setTimeout(() => done(new Error('El servidor no responde. Inténtalo más tarde.')), ms) };
      const done = (err, msg) => {
        clearTimeout(w.timer);
        net.waiters = net.waiters.filter((x) => x !== w);
        if (err) reject(err);
        else resolve(msg);
      };
      w.done = done;
      net.waiters.push(w);
    });
  }

  function connect(url) {
    net.url = url;
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        return reject(new Error('No se pudo conectar con el servidor.'));
      }
      net.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('El servidor no responde. Inténtalo más tarde.'));
      }, 10000);
      ws.onopen = () => {
        clearTimeout(timer);
        net.lastMsg = Date.now();
        startHeartbeat();
        resolve();
      };
      ws.onmessage = onMessage;
      ws.onclose = () => {
        clearTimeout(timer);
        stopHeartbeat();
        for (const w of [...net.waiters]) w.done(new Error('Se perdió la conexión con el servidor.'));
        if (net.ws === ws) onClosed();
        reject(new Error('No se pudo conectar con el servidor.'));
      };
    });
  }

  // Latido: si no llega nada en 12 s, la conexión está muerta y se reconecta
  function startHeartbeat() {
    stopHeartbeat();
    net.pingTimer = setInterval(() => {
      send({ t: 'ping', at: Date.now() });
      if (Date.now() - net.lastMsg > 12000 && net.ws) net.ws.close();
    }, 4000);
  }
  function stopHeartbeat() {
    clearInterval(net.pingTimer);
  }

  function onMessage(e) {
    net.lastMsg = Date.now();
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const w of net.waiters) {
      if (w.types.includes(msg.t)) {
        w.done(null, msg);
        break;
      }
    }
    switch (msg.t) {
      case 'welcome':
        net.myId = msg.id;
        if (P) P.id = msg.id; // reconexión: el mismo reflejo con el id nuevo
        break;
      case 's':
        applySnapshot(msg);
        break;
      case 'e':
        net.queue.push(...msg.e);
        break;
      case 'chat':
        UI.chat(msg);
        break;
      case 'kicked':
        net.kicked = msg.msg;
        break;
    }
  }

  async function onClosed() {
    if (!net.playing) return;
    if (net.kicked) {
      if (net.onLost) net.onLost(net.kicked);
      return;
    }
    // Reconexión automática: hasta 20 intentos (unos 90 s). Si el servidor se estaba
    // reiniciando, vuelve en 2-3 s y el jugador sigue donde estaba.
    if (net.reconnecting) return;
    net.reconnecting = true;
    G.keys = {};
    G.joy = null;
    if (net.onReconnect) net.onReconnect('start');
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 400 : Math.min(6000, 700 * i)));
      try {
        await connect(net.url);
        send({ t: 'resume', v: PROTOCOL, session: net.session });
        const auth = await waitFor(['auth', 'authError']);
        if (auth.t !== 'auth') throw new Error(auth.msg);
        send({ t: 'play', id: net.charId });
        await waitFor(['welcome']);
        net.reconnecting = false;
        net.sentDir = '';
        if (net.onReconnect) net.onReconnect('ok');
        return;
      } catch {
        /* siguiente intento */
      }
    }
    net.reconnecting = false;
    if (net.onLost) net.onLost('No se pudo recuperar la conexión con el servidor.');
  }

  // ---------- Cuenta y personajes ----------

  async function authRequest(msg) {
    send({ ...msg, v: PROTOCOL });
    const r = await waitFor(['auth', 'authError']);
    if (r.t === 'authError') {
      const err = new Error(r.msg);
      err.code = r.code;
      throw err;
    }
    if (r.session) net.session = r.session;
    return r;
  }
  const register = (user, email, pass) => authRequest({ t: 'register', user, email, pass });
  const login = (user, pass) => authRequest({ t: 'login', user, pass });
  async function resume(session) {
    net.session = session;
    return authRequest({ t: 'resume', session });
  }
  function logout() {
    send({ t: 'logout' });
    net.session = null;
  }
  async function charRequest(msg) {
    send(msg);
    const r = await waitFor(['chars', 'charError']);
    if (r.t === 'charError') throw new Error(r.msg);
    return r;
  }
  const createChar = (name, cls, sex) => charRequest({ t: 'createChar', name, cls, sex });
  const deleteChar = (id) => charRequest({ t: 'deleteChar', id });

  async function play(id, { onLost, onReconnect } = {}) {
    net.onLost = onLost;
    net.onReconnect = onReconnect;
    net.charId = id;
    G.mobs = [];
    send({ t: 'play', id });
    const r = await waitFor(['welcome', 'charError']);
    if (r.t === 'charError') throw new Error(r.msg);
    net.playing = true;
    // Espera el primer estado con el propio personaje
    for (let i = 0; i < 100 && !P; i++) await new Promise((res) => setTimeout(res, 30));
    if (!P) throw new Error('El servidor no envió tu personaje.');
    return P;
  }

  // ---------- Vistas (modelo 3D + estado de animación) ----------

  function attachView(ent, model) {
    ent.model = model;
    ent.view = { walkBlend: 0, atkAnim: 0, deathK: 0, swim: 0, phase: Math.random() * 10 };
    model.root.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
    model.root.rotation.y = ent.facing;
    G.scene.add(model.root);
  }

  function detachView(ent) {
    if (ent.model) G.scene.remove(ent.model.root);
    ent.model = null;
  }

  function applyEquip(p) {
    if (!p.model) return;
    setWeaponLook(p.model, ITEMS[p.equip.weapon]);
    setArmorLook(p.model, ITEMS[p.equip.armor]);
  }

  // ---------- Estado recibido ----------

  const setNet = (ent, x, y, z, f) => {
    ent.net = { x, y, z, f };
    if (!ent.seen) {
      ent.pos.x = x;
      ent.pos.y = y;
      ent.pos.z = z;
      ent.facing = f;
      ent.seen = true;
    }
  };

  function makeMe(row) {
    const cls = row[10];
    const cdef = CLASSES[cls];
    P = {
      id: row[0],
      kind: 'player',
      name: row[11],
      cls,
      sex: row[15],
      cdef,
      skills: cdef.skills,
      pos: { x: row[1], y: row[2], z: row[3] },
      facing: row[4],
      height: 2.5,
      inv: [],
      equip: { weapon: row[12], armor: row[13] },
      cds: {},
      target: null,
      level: row[9],
      xp: 0,
      gold: 0,
      hp: row[7],
      mp: 0,
      stats: { maxHp: row[8], maxMp: 1, atk: 0, def: 0, crit: 0, critMult: 1.8, atkSpeed: cdef.atkSpeed, speed: 7.2, range: cdef.range },
      buffT: 0,
      buffPct: 0,
      buffName: '',
      shield: 0,
      shieldT: 0,
      breath: 30,
      dead: false,
      party: null,
    };
    attachView(P, V.Actors.buildHero(cls, P.sex));
    applyEquip(P);
    net.players.set(P.id, P);
    G.player = P;
  }

  function applySnapshot(s) {
    net.count = s.n;
    const seenP = new Set();
    for (const row of s.p) {
      const id = row[0];
      seenP.add(id);
      if (id === net.myId && !P) makeMe(row);
      let q = id === net.myId ? P : net.players.get(id);
      if (id === net.myId && !net.players.has(id)) net.players.set(id, P);
      if (!q) {
        const cdef = CLASSES[row[10]];
        q = { id, kind: 'player', name: row[11], cls: row[10], sex: row[15], cdef, pos: { x: 0, y: 0, z: 0 }, facing: 0, height: 2.5, equip: { weapon: null, armor: null }, stats: { maxHp: row[8] } };
        net.players.set(id, q);
        attachView(q, V.Actors.buildHero(q.cls, q.sex));
        q.model.root.traverse((o) => (o.userData.player = q));
        UI.addPlayerPlate(q);
      }
      setNet(q, row[1], row[2], row[3], row[4]);
      q.moving = !!row[5];
      if (q !== P) {
        q.dead = !!row[6];
        q.hp = row[7];
        q.stats.maxHp = row[8];
        q.level = row[9];
        q.partyId = row[16] || null;
      }
      q.leap = !!row[14];
      q.swimming = !!row[17];
      if (q.equip.weapon !== row[12] || q.equip.armor !== row[13]) {
        q.equip.weapon = row[12];
        q.equip.armor = row[13];
        applyEquip(q);
      }
    }
    for (const [id, q] of net.players) {
      if (seenP.has(id) || q === P) continue;
      UI.removePlayerPlate(q);
      detachView(q);
      net.players.delete(id);
      if (G.playerSel === q) G.playerSel = null;
    }

    const seenM = new Set();
    let added = false;
    for (const row of s.m) {
      const id = row[0];
      seenM.add(id);
      let m = net.mobs.get(id);
      if (!m) {
        const def = MOBS[row[1]];
        m = { id, kind: 'mob', key: row[1], def, pos: { x: 0, y: 0, z: 0 }, facing: 0, height: (def.kind === 'quad' ? 1.5 : 2.5) * (def.scale || 1) };
        net.mobs.set(id, m);
        attachView(m, def.kind === 'quad' ? buildQuadruped(def) : buildHumanoid(def));
        m.model.root.traverse((o) => (o.userData.mob = m));
        UI.createNameplate(m);
        added = true;
      }
      setNet(m, row[2], row[3], row[4], row[5]);
      m.moving = !!row[6];
      const wasDead = m.dead;
      m.dead = !!row[7];
      if (wasDead && !m.dead) resetMob(m);
      m.hp = row[8];
      m.maxHp = row[9];
      if (m.lvl !== row[10]) {
        m.lvl = row[10];
        UI.refreshNameplate(m);
      }
      m.aggro = !!row[11];
      m.deadT = row[12];
      m.respawnTime = row[13];
      m.stunned = !!row[14];
      m.slowed = !!row[15];
      m.poisoned = !!row[16];
      m.hidden = false;
    }
    for (const [id, m] of net.mobs) if (!seenM.has(id)) m.hidden = true;
    if (added) G.mobs = [...net.mobs.values()];

    const seenJ = new Set();
    for (const row of s.j) {
      const target = net.mobs.get(row[5]);
      if (!target) continue;
      seenJ.add(row[0]);
      if (!net.projectiles.has(row[0])) net.projectiles.set(row[0], { id: row[0], kind: row[1], big: !!row[6], pos: { x: row[2], y: row[3], z: row[4] }, target });
    }
    for (const id of net.projectiles.keys()) if (!seenJ.has(id)) net.projectiles.delete(id);

    if (P && s.me) applyMe(s.me);
  }

  function applyMe(d) {
    const wasLevel = P.level;
    Object.assign(P, {
      hp: d.hp,
      mp: d.mp,
      xp: d.xp,
      level: d.level,
      gold: d.gold,
      stats: d.stats,
      cds: d.cds,
      buffT: d.buffT,
      buffPct: d.buffPct,
      buffCrit: d.buffCrit,
      buffName: d.buffName,
      shield: d.shield,
      shieldT: d.shieldT,
      combatT: d.combatT,
      breath: d.breath,
      swimming: d.swimming,
      deep: d.deep,
      party: d.party,
    });
    if (d.dead !== P.dead) P.dead = d.dead;
    if (!G.npcSel && !G.playerSel) P.target = d.target ? net.mobs.get(d.target) || null : null;
    if (d.inv) {
      P.inv = d.inv;
      P.equip = d.equip;
      applyEquip(P);
      UI.refreshPanels();
    } else if (wasLevel !== P.level) UI.refreshPanels();
  }

  function resetMob(m) {
    if (!m.model) return;
    m.view.deathK = 0;
    m.model.root.visible = true;
    m.model.rig.rotation.set(0, 0, 0);
    animateDeath(m.model, 0);
    UI.refreshNameplate(m);
  }

  // Suaviza el movimiento entre dos estados del servidor
  function interpolate(dt) {
    const k = Math.min(1, dt * 12);
    const lerpEnt = (e) => {
      if (!e.net) return;
      e.pos.x += (e.net.x - e.pos.x) * k;
      e.pos.y += (e.net.y - e.pos.y) * k;
      e.pos.z += (e.net.z - e.pos.z) * k;
      const df = Math.atan2(Math.sin(e.net.f - e.facing), Math.cos(e.net.f - e.facing));
      e.facing += df * k;
    };
    for (const q of net.players.values()) lerpEnt(q);
    for (const m of net.mobs.values()) lerpEnt(m);
    for (const j of net.projectiles.values()) {
      const t = j.target;
      const tx = t.pos.x;
      const ty = t.pos.y + t.height * 0.5;
      const tz = t.pos.z;
      const dx = tx - j.pos.x;
      const dy = ty - j.pos.y;
      const dz = tz - j.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      const step = Math.min(dist, (PROJ_SPEED[j.kind] || 26) * dt);
      if (dist > 0.01) {
        j.pos.x += (dx / dist) * step;
        j.pos.y += (dy / dist) * step;
        j.pos.z += (dz / dist) * step;
      }
    }
  }

  // Los eventos del servidor traen identificadores: se convierten en entidades locales
  function resolveEvent(ev) {
    if (typeof ev.ent === 'string') {
      const ent = net.players.get(ev.ent) || net.mobs.get(ev.ent);
      if (!ent) return null;
      if (ev.type === 'equip' && ent.equip) {
        ent.equip.weapon = ev.weapon;
        ent.equip.armor = ev.armor;
      }
      return { ...ev, ent };
    }
    return ev;
  }

  // ---------- Comandos del jugador local ----------

  const sync = () => (G.target = P ? P.target : null);

  // NPC o jugador seleccionado (en el cliente): anillo de color y marco de objetivo
  G.npcSel = null;
  G.playerSel = null;
  function clearTarget() {
    if (P) P.target = null;
    send({ t: 'target', id: null });
    sync();
  }
  function selectNpc(id) {
    const npc = G.world.npcs.find((n) => n.id === id);
    if (!npc || P.dead) return;
    clearTarget();
    G.playerSel = null;
    G.npcSel = npc;
    send({ t: 'talk', id });
  }
  function selectPlayer(q) {
    if (!q || q === P) return;
    clearTarget();
    G.npcSel = null;
    G.playerSel = q;
  }

  function setTarget(m) {
    G.npcSel = null;
    G.playerSel = null;
    P.target = m && !m.dead ? m : null;
    send({ t: 'target', id: P.target ? P.target.id : null });
    sync();
  }
  const attackTarget = () => send({ t: 'attack' });
  function targetNearest() {
    const list = G.mobs.filter((m) => !m.dead && !m.hidden && d2(m.pos, P.pos) < 26).sort((a, b) => d2(a.pos, P.pos) - d2(b.pos, P.pos));
    if (!list.length) return;
    const i = list.indexOf(P.target);
    setTarget(list[(i + 1) % list.length]);
  }
  function moveTo(point) {
    if (P.dead || P.leap) return;
    send({ t: 'move', x: point.x, z: point.z });
    showMarker(point);
  }
  const talkTo = (id) => send({ t: 'talk', id });
  const useSkill = (i) => send({ t: 'skill', i });
  const usePotion = (id) => send({ t: 'potion', id });
  const countItem = (id) => (P ? P.inv.filter((s) => s.id === id).reduce((a, s) => a + s.qty, 0) : 0);
  // Con la tienda abierta, el clic en el inventario abre el diálogo de venta
  const clickInventory = (i) => (UI.shopOpen() ? UI.openTrade('sell', i) : send({ t: 'use', i }));
  const useItem = (i) => send({ t: 'use', i });
  const sellItem = (i, q) => send({ t: 'sell', i, q });
  const unequip = (k) => send({ t: 'unequip', k });
  const buyItem = (id, q) => send({ t: 'buy', id, q });
  const respawnPlayer = () => send({ t: 'respawn' });
  const sendChat = (text) => send({ t: 'chat', text });
  const invite = (id) => send({ t: 'invite', id });
  const inviteByName = (name) => send({ t: 'inviteByName', name });
  const answerInvite = (accept) => send({ t: 'inviteAnswer', accept });
  const leaveParty = () => send({ t: 'partyLeave' });
  const kickFromParty = (id) => send({ t: 'partyKick', id });

  // ---------- Eventos ----------

  const mine = (ev) => ev.to == null || ev.to === P.id;

  function handleEvent(ev) {
    switch (ev.type) {
      case 'float':
        UI.floatText(ev.ent.pos, ev.ent.height + ev.dh, ev.text, ev.cls);
        break;
      case 'ring':
        spawnRing(ev.pos, ev.color, ev.r, ev.life);
        break;
      case 'faller':
        if (ev.fx === 'meteor') spawnFaller('meteor', ev.at, ev.dur);
        else {
          const n = ev.r > 5 ? 26 : 14;
          for (let k = 0; k < n; k++) spawnFaller(ev.fx === 'frost' ? 'ice' : 'arrow', { x: ev.at.x + (Math.random() * 2 - 1) * ev.r * 0.8, y: ev.at.y, z: ev.at.z + (Math.random() * 2 - 1) * ev.r * 0.8 }, ev.dur * (0.7 + Math.random() * 0.3));
        }
        break;
      case 'chain':
        spawnLightning(ev.pts);
        break;
      case 'swing':
        if (ev.ent.view) ev.ent.view.atkAnim = 1;
        break;
      case 'equip':
        applyEquip(ev.ent);
        break;
      case 'mobSpawn':
        resetMob(ev.ent);
        break;
      case 'mobDeath':
        if (ev.ent.view) ev.ent.view.deathK = 0;
        break;
      case 'levelUp':
        spawnLevelUp(ev.ent);
        UI.floatText(ev.ent.pos, ev.ent.height + 1.2, `¡Nivel ${ev.level}!`, 'lvlup');
        break;
      case 'log':
        if (mine(ev)) UI.log(ev.text, ev.cls);
        break;
      case 'loot':
        if (mine(ev)) UI.logLoot(ev.id, ev.qty, ev.verb);
        break;
      case 'banner':
        if (mine(ev)) UI.banner(ev.title, ev.sub);
        break;
      case 'inventory':
        if (mine(ev)) UI.refreshPanels();
        break;
      case 'openShop':
        if (mine(ev)) UI.openShop();
        break;
      case 'partyInvite':
        if (mine(ev)) UI.showInvite(ev.name);
        break;
      case 'playerDeath':
        if (ev.ent.view) ev.ent.view.deathK = 0;
        if (ev.ent === P) P.dead = true;
        if (mine(ev)) UI.showDeath(true);
        break;
      case 'playerRespawn':
        if (ev.ent.view) {
          ev.ent.view.deathK = 0;
          animateDeath(ev.ent.model, 0);
        }
        if (ev.ent === P) P.dead = false;
        if (mine(ev)) UI.showDeath(false);
        break;
    }
  }

  // ---------- Efectos ----------

  const effects = [];
  const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);
  let marker = null;
  let targetRing = null;
  let shieldBubble = null;

  function spawnRing(pos, color, maxR, life) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    m.position.set(pos.x, pos.y + 0.15, pos.z);
    G.scene.add(m);
    effects.push({ m, maxR, life, t: 0 });
  }

  function showMarker(point) {
    if (!marker) {
      marker = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xe8dcc2, transparent: true, depthWrite: false }));
      G.scene.add(marker);
    }
    marker.position.set(point.x, heightAt(point.x, point.z) + 0.12, point.z);
    marker.userData.t = 0;
    marker.visible = true;
  }

  // Subida de nivel: columna de luz dorada, anillo y chispas que suben
  const glows = [];
  const pillarGeo = new THREE.CylinderGeometry(1.1, 1.4, 9, 24, 1, true);
  pillarGeo.translate(0, 4.5, 0);
  const sparkGeo = new THREE.OctahedronGeometry(0.09, 0);
  function spawnLevelUp(ent) {
    const g = new THREE.Group();
    const pillar = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xffd36b, 2.0), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    g.add(pillar);
    const sparks = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: V.Gfx.hot(i % 3 ? 0xffe9a8 : 0xffffff, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 1.1;
      s.userData = { a, r, v: 2 + Math.random() * 3, y: Math.random() * 1.5 };
      g.add(s);
      sparks.push(s);
    }
    const light = new THREE.PointLight(0xffd36b, 3, 14, 2);
    light.position.y = 2;
    g.add(light);
    G.scene.add(g);
    spawnRing(ent.pos, 0xffd36b, 5, 1.2);
    spawnRing(ent.pos, 0xffffff, 3, 0.7);
    glows.push({ g, pillar, sparks, light, ent, t: 0, life: 2.2 });
  }

  // Cadena de rayos: líneas quebradas entre los puntos
  function spawnLightning(pts) {
    const verts = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const segs = 6;
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs;
        const t1 = (k + 1) / segs;
        const j = (t) => (t > 0 && t < 1 ? (Math.random() - 0.5) * 0.7 : 0);
        verts.push(a.x + (b.x - a.x) * t0 + j(t0), a.y + (b.y - a.y) * t0 + j(t0), a.z + (b.z - a.z) * t0 + j(t0));
        verts.push(a.x + (b.x - a.x) * t1 + j(t1), a.y + (b.y - a.y) * t1 + j(t1), a.z + (b.z - a.z) * t1 + j(t1));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: V.Gfx.hot(0xbfe0ff, 2.0), transparent: true, blending: THREE.AdditiveBlending }));
    G.scene.add(line);
    effects.push({ line, t: 0, life: 0.35 });
    for (const p of pts.slice(1)) spawnRing({ x: p.x, y: p.y - 1, z: p.z }, 0x9fd0ff, 1.4, 0.35);
  }

  const PROJ_MESH = {
    arrow: () => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 4), new THREE.MeshBasicMaterial({ color: 0x8a6a44 }));
      shaft.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), new THREE.MeshBasicMaterial({ color: 0xd8dde4 }));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.55;
      g.add(shaft, tip);
      return g;
    },
    fire: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xffb04a, 1.9) })));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.4, depthWrite: false })));
      return g;
    },
    arcane: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xe6d0ff, 1.7) })));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9a6aff, transparent: true, opacity: 0.45, depthWrite: false })));
      return g;
    },
    ice: () => new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xcfeaff, 1.7), transparent: true, opacity: 0.85 })),
  };
  const projMeshes = new Map();
  const tmp = new THREE.Vector3();

  function syncProjectiles() {
    const alive = new Set();
    for (const pr of net.projectiles.values()) {
      alive.add(pr.id);
      let mesh = projMeshes.get(pr.id);
      if (!mesh) {
        mesh = (PROJ_MESH[pr.kind] || PROJ_MESH.arcane)();
        if (pr.big) mesh.scale.setScalar(1.35);
        G.scene.add(mesh);
        projMeshes.set(pr.id, mesh);
      }
      mesh.position.set(pr.pos.x, pr.pos.y, pr.pos.z);
      const t = pr.target;
      mesh.lookAt(tmp.set(t.pos.x, t.pos.y + t.height * 0.5, t.pos.z));
    }
    for (const [id, mesh] of projMeshes) {
      if (alive.has(id)) continue;
      G.scene.remove(mesh);
      projMeshes.delete(id);
    }
  }

  const fallers = [];
  function spawnFaller(kind, at, dur) {
    let mesh;
    if (kind === 'meteor') {
      mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: 0x3a2a20, emissive: 0xff5a1a, emissiveIntensity: 1.0, flatShading: true })));
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xff7a2a, 1.6), transparent: true, opacity: 0.35, depthWrite: false })));
    } else if (kind === 'ice') {
      mesh = PROJ_MESH.ice();
    } else {
      mesh = PROJ_MESH.arrow();
      mesh.rotation.x = Math.PI / 2;
    }
    const h = kind === 'meteor' ? 22 : 12;
    const off = kind === 'meteor' ? 8 : 0;
    G.scene.add(mesh);
    fallers.push({ mesh, from: new THREE.Vector3(at.x - off, at.y + h, at.z - off), to: new THREE.Vector3(at.x, at.y, at.z), t: 0, dur });
  }

  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.t += dt;
      const k = e.t / e.life;
      if (e.line) {
        e.line.material.opacity = 1 - k;
      } else {
        e.m.scale.setScalar(0.3 + e.maxR * k);
        e.m.material.opacity = 0.9 * (1 - k);
      }
      if (k >= 1) {
        const obj = e.line || e.m;
        G.scene.remove(obj);
        obj.material.dispose();
        if (e.line) obj.geometry.dispose();
        effects.splice(i, 1);
      }
    }
    for (let i = glows.length - 1; i >= 0; i--) {
      const gl = glows[i];
      gl.t += dt;
      const k = gl.t / gl.life;
      gl.g.position.set(gl.ent.pos.x, gl.ent.pos.y, gl.ent.pos.z);
      gl.pillar.material.opacity = 0.55 * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      gl.pillar.scale.set(1 - k * 0.4, 0.3 + Math.min(1, k * 4) * 0.7, 1 - k * 0.4);
      gl.light.intensity = 3 * (1 - k);
      for (const s of gl.sparks) {
        const u = s.userData;
        u.y += u.v * dt;
        u.a += dt * 2;
        s.position.set(Math.cos(u.a) * u.r, u.y, Math.sin(u.a) * u.r);
        s.material.opacity = Math.max(0, 1 - u.y / 8);
      }
      if (k >= 1) {
        G.scene.remove(gl.g);
        glows.splice(i, 1);
      }
    }
    for (let i = fallers.length - 1; i >= 0; i--) {
      const f = fallers[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.mesh.position.lerpVectors(f.from, f.to, k * k);
      f.mesh.rotation.y += dt * 4;
      if (k >= 1) {
        G.scene.remove(f.mesh);
        fallers.splice(i, 1);
      }
    }
    if (marker && marker.visible) {
      marker.userData.t += dt;
      const k = marker.userData.t / 0.6;
      marker.scale.setScalar(0.9 - k * 0.5);
      marker.material.opacity = 1 - k;
      if (k >= 1) marker.visible = false;
    }
    if (!targetRing) {
      targetRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.85, depthWrite: false }));
      G.scene.add(targetRing);
    }
    const t = G.target;
    const npc = G.npcSel;
    const ply = G.playerSel;
    if (npc) {
      const np = npc.root.position;
      targetRing.visible = true;
      targetRing.position.set(np.x, np.y + 0.1, np.z);
      targetRing.scale.setScalar(1.45 + Math.sin(G.time * 4) * 0.06);
      targetRing.material.color.setHex(0xd9b56a);
    } else if (ply) {
      targetRing.visible = !ply.dead;
      targetRing.position.set(ply.pos.x, ply.pos.y + 0.1, ply.pos.z);
      targetRing.scale.setScalar(1.35 + Math.sin(G.time * 4) * 0.05);
      const ally = P.party && P.party.members.some((m) => m.id === ply.id);
      targetRing.material.color.setHex(ally ? 0x7fe08a : 0x7fb6ff); // verde: de tu grupo · azul: otro jugador
    } else {
      targetRing.visible = !!t && !t.dead && !t.hidden;
      if (targetRing.visible) {
        targetRing.position.set(t.pos.x, t.pos.y + 0.1, t.pos.z);
        targetRing.scale.setScalar(0.9 + (t.def.scale || 1) * 0.6);
        targetRing.material.color.setHex(t.def.aggressive ? 0xff5a4a : 0xf2cf5b);
      }
    }
    if (!shieldBubble) {
      shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0.18, depthWrite: false }));
      G.scene.add(shieldBubble);
    }
    shieldBubble.visible = P.shield > 0 && !P.dead;
    if (shieldBubble.visible) {
      shieldBubble.position.set(P.pos.x, P.pos.y + 1.3, P.pos.z);
      shieldBubble.material.opacity = 0.14 + Math.sin(G.time * 5) * 0.05;
    }
  }

  // ---------- Dibujar entidades ----------

  function drawEntity(ent, dt) {
    const v = ent.view;
    const root = ent.model.root;
    if (ent.hidden) {
      root.visible = false;
      return;
    }
    root.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
    root.rotation.y = ent.facing;
    if (ent.dead) {
      v.deathK = Math.min(1, v.deathK + dt * 2.5);
      animateDeath(ent.model, v.deathK);
      root.visible = !(ent.kind === 'mob' && ent.deadT < ent.respawnTime - 4);
      return;
    }
    if (!root.visible) root.visible = true;
    if (v.deathK) {
      v.deathK = 0;
      animateDeath(ent.model, 0);
    }
    v.atkAnim = Math.max(0, v.atkAnim - dt * (ent.kind === 'mob' ? 2.2 : 2.4));
    v.walkBlend += ((ent.moving ? 1 : 0) - v.walkBlend) * Math.min(1, dt * (ent.kind === 'mob' ? 8 : 10));
    v.swim += ((ent.swimming ? 1 : 0) - v.swim) * Math.min(1, dt * 6);
    // Monstruo aturdido: se tambalea quieto
    if (ent.stunned) ent.model.root.rotation.z = Math.sin(G.time * 12) * 0.08;
    else if (ent.model.root.rotation.z) ent.model.root.rotation.z = 0;
    animateModel(ent.model, G.time + (ent.kind === 'mob' ? v.phase : 0), v.walkBlend, v.atkAnim, v.swim);
  }

  // ---------- Bucle ----------

  function keyDir() {
    const k = G.keys;
    let ix = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    let iz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    if (G.joy) {
      // Joystick táctil: arriba = avanzar hacia donde mira la cámara
      ix = G.joy.x;
      iz = -G.joy.y;
    }
    if (!ix && !iz) return null;
    const fx = -Math.sin(G.cam.yaw);
    const fz = -Math.cos(G.cam.yaw);
    const dx = fx * iz - fz * ix;
    const dz = fz * iz + fx * ix;
    const len = Math.hypot(dx, dz);
    return { x: dx / len, z: dz / len };
  }

  function update(dt) {
    const dir = keyDir();
    // La dirección se envía solo si cambia, como mucho 10 veces por segundo
    const key = dir ? `${dir.x.toFixed(1)},${dir.z.toFixed(1)}` : '';
    const now = performance.now();
    if (key !== net.sentDir && (now - net.dirAt > 100 || !key)) {
      net.sentDir = key;
      net.dirAt = now;
      send({ t: 'dir', d: dir });
    }
    interpolate(dt);
    for (const raw of net.queue.splice(0)) {
      const ev = resolveEvent(raw);
      if (ev) handleEvent(ev);
    }
    for (const q of net.players.values()) if (q.model) drawEntity(q, dt);
    for (const m of net.mobs.values()) if (m.model) drawEntity(m, dt);
    if (G.playerSel && !net.players.has(G.playerSel.id)) G.playerSel = null;
    sync();
    syncProjectiles();
    updateEffects(dt);
  }

  V.Game = {
    PROTOCOL, connect, register, login, resume, logout, createChar, deleteChar, play,
    setTarget, attackTarget, targetNearest, moveTo, talkTo, selectNpc, selectPlayer, useSkill, countItem, usePotion,
    clickInventory, useItem, sellItem, unequip, buyItem, respawnPlayer, update, sendChat,
    invite, inviteByName, answerInvite, leaveParty, kickFromParty,
    get online() {
      return true;
    },
    get onlineCount() {
      return net.count;
    },
    get connected() {
      return !!net.ws && net.ws.readyState === 1;
    },
    // Para pruebas: corta la conexión como si se cayera la red
    simulateDrop() {
      if (net.ws) net.ws.close();
    },
  };
})();
