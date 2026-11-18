// Cliente del juego en línea: cuenta, personajes, conexión y dibujo del mundo.
//
// La simulación corre en el servidor. Este archivo envía las acciones del jugador,
// recibe el estado de lo que tiene cerca 10 veces por segundo, lo suaviza
// (interpolación) y dibuja los eventos (daño, botín, efectos). Si la conexión se corta,
// se reconecta solo y vuelve a entrar con el mismo personaje.
(function () {
  const G = V.G;
  const { buildHumanoid, buildQuadruped, buildMob, buildPet, animateModel, animateDeath, setWeaponLook, setArmorLook } = V.Models;
  const { heightAt } = V.Terrain;
  const { ITEMS, CLASSES, MOBS, lookFor, skillsFor } = V.Data;
  const UI = new Proxy({}, { get: (_, k) => V.UI[k] }); // ui.js se carga después

  const THREE = window.THREE;
  const PROTOCOL = 3;
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
    summons: new Map(),
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
    if (ent.petView) {
      G.scene.remove(ent.petView.model.root);
      ent.petView = null;
    }
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
    const stage = row[18] || 0;
    const branch = row[19] || null;
    P = {
      id: row[0],
      kind: 'player',
      name: row[11],
      cls,
      sex: row[15],
      cdef,
      stage,
      branch,
      quest: null,
      skills: skillsFor(cls, stage, branch),
      buffs: [],
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
        q = { id, kind: 'player', name: row[11], cls: row[10], sex: row[15], cdef, stage: 0, branch: null, pos: { x: 0, y: 0, z: 0 }, facing: 0, height: 2.5, equip: { weapon: null, armor: null }, stats: { maxHp: row[8] } };
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
        q.stage = row[18] || 0;
        q.branch = row[19] || null;
      }
      q.leap = !!row[14];
      q.swimming = !!row[17];
      q.gem = !!row[20];
      q.petType = row[21] || null;
      q.mounted = row[22] || 0;
      if (q !== P) q.stage = row[18] || 0;
      q.riding = false;
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
        m = { id, kind: 'mob', key: row[1], def, pos: { x: 0, y: 0, z: 0 }, facing: 0, height: V.Data.mobHeight(def) };
        net.mobs.set(id, m);
        attachView(m, buildMob(def));
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
      m.shielded = !!row[17];
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

    // Invocaciones: torretas, Mecha-Gólem y clones de viento
    const seenU = new Set();
    for (const row of s.u || []) {
      const id = row[0];
      seenU.add(id);
      let u = net.summons.get(id);
      const owner = net.players.get(row[8]) || null;
      if (!u) {
        u = { id, kind: 'summon', type: row[1], owner, pos: { x: row[2], y: row[3], z: row[4] }, facing: row[5], height: row[1] === 'mecha' ? 4.2 : 2 };
        u.model = buildSummonModel(u);
        u.view = { atkAnim: 0, walk: 0, phase: Math.random() * 10 };
        G.scene.add(u.model.root);
        net.summons.set(id, u);
      }
      setNet(u, row[2], row[3], row[4], row[5]);
      u.hp = row[6];
      u.maxHp = row[7];
      u.moving = !!row[9];
      u.ride = !!row[10];
      if (u.ride && owner) owner.riding = true;
    }
    for (const [id, u] of net.summons) {
      if (seenU.has(id)) continue;
      spawnRing(u.pos, u.type === 'clone' ? 0xb6e08a : 0x9fd8ff, 1.6, 0.4);
      G.scene.remove(u.model.root);
      net.summons.delete(id);
    }

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
      buffs: d.buffs || [],
      debuffs: d.debuffs || [],
      gemsOn: !!d.gemsOn,
      gems: d.gems || 0,
      quest: d.quest || null,
      bubble: d.bubble,
      freeNext: d.freeNext,
      shield: d.shield,
      shieldT: d.shieldT,
      combatT: d.combatT,
      breath: d.breath,
      swimming: d.swimming,
      deep: d.deep,
      party: d.party,
    });
    if (d.dead !== P.dead) P.dead = d.dead;
    // Cambio de clase: habilidades nuevas en la barra
    if (d.stage !== P.stage || (d.branch || null) !== P.branch) {
      P.stage = d.stage;
      P.branch = d.branch || null;
      P.skills = skillsFor(P.cls, P.stage, P.branch);
      UI.classChanged();
    }
    if (!G.npcSel && !G.playerSel) P.target = d.target ? net.mobs.get(d.target) || null : null;
    P.pet = d.pet || null;
    P.mountKind = d.mountKind || 0;
    syncLoot(d.loot || []);
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
    for (const u of net.summons.values()) lerpEnt(u);
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
      const ent = net.players.get(ev.ent) || net.mobs.get(ev.ent) || net.summons.get(ev.ent);
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
  const sendPhrase = (phrase, party) => send({ t: 'chat', phrase, party: !!party });
  const report = (id, reason) => send({ t: 'report', id, reason });
  const classQuest = (action, branch) => send({ t: 'classQuest', action, branch });
  const toggleGems = () => P && send({ t: 'gems', on: !P.gemsOn });
  const hatch = (type) => send({ t: 'hatch', type });
  const toggleMount = () => send({ t: 'mount' });
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
        if (ev.fx === 'meteor' || ev.fx === 'glue' || ev.fx === 'sword') spawnFaller(ev.fx, ev.at, ev.dur);
        else if (ev.fx === 'acorn') {
          const n = ev.r > 5 ? 22 : 12;
          for (let k = 0; k < n; k++) spawnFaller('acorn', { x: ev.at.x + (Math.random() * 2 - 1) * ev.r * 0.8, y: ev.at.y, z: ev.at.z + (Math.random() * 2 - 1) * ev.r * 0.8 }, ev.dur * (0.7 + Math.random() * 0.3));
        }
        else {
          const n = ev.r > 5 ? 26 : 14;
          for (let k = 0; k < n; k++) spawnFaller(ev.fx === 'frost' ? 'ice' : 'arrow', { x: ev.at.x + (Math.random() * 2 - 1) * ev.r * 0.8, y: ev.at.y, z: ev.at.z + (Math.random() * 2 - 1) * ev.r * 0.8 }, ev.dur * (0.7 + Math.random() * 0.3));
        }
        break;
      case 'chain':
        spawnLightning(ev.pts);
        break;
      case 'swing':
        if (ev.ent && ev.ent.view) ev.ent.view.atkAnim = 1;
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
        if (ev.ent.model && V.Actors) V.Actors.celebrate(ev.ent.model);
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
        if (mine(ev)) UI.openShop(ev.shop || 'orlen');
        break;
      case 'telegraph':
        spawnTelegraph(ev.at, ev.r, ev.dur, ev.color);
        break;
      case 'firewave':
        spawnZone(ev.at, ev.r, 0xff6a2a, 1.2);
        spawnRing(ev.at, 0xff4a1a, ev.r, 0.9);
        for (let k = 0; k < 10; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * ev.r;
          spawnFaller('meteor', { x: ev.at.x + Math.cos(a) * r, y: heightAt(ev.at.x + Math.cos(a) * r, ev.at.z + Math.sin(a) * r), z: ev.at.z + Math.sin(a) * r }, 0.25 + Math.random() * 0.3);
        }
        break;
      case 'plate':
        if (G.world.anim && G.world.anim.plates[ev.i]) G.world.anim.plates[ev.i].userData.litUntil = G.time + ev.dur;
        spawnRing(ev.at, 0x3ad85a, 1.6, 0.5);
        break;
      case 'shield':
        if (ev.ent) spawnRing(ev.ent.pos, ev.down ? 0x3ad85a : 0x8fb8ff, 5, 0.8);
        break;
      case 'geyser':
        spawnRing(ev.at, 0xf4f0e6, 2.4, 0.6);
        break;
      case 'teleport':
        if (ev.ent) ev.ent.seen = false; // en la próxima instantánea aparece directamente en el destino
        if (mine(ev)) UI.banner(ev.title || 'Viaje', 'Has llegado');
        break;
      case 'petFetch':
        if (ev.ent && ev.ent.petView && ev.ent.petView.form === 'pet') ev.ent.petView.fetch = { at: ev.at, t: 0 };
        break;
      case 'mount':
        if (ev.ent) spawnRing(ev.ent.pos, ev.on ? 0xd9b25f : 0xb9b2a4, 2.2, 0.5);
        break;
      case 'petHatch':
        if (ev.ent) {
          spawnRing(ev.ent.pos, 0xffd36b, 3, 0.9);
          spawnRing(ev.ent.pos, 0xffffff, 1.6, 0.6);
        }
        break;
      case 'hatchChoose':
        if (mine(ev)) UI.openHatch();
        break;
      case 'openMaster':
        if (mine(ev)) UI.openMaster();
        break;
      case 'quest':
        if (mine(ev)) setTimeout(() => UI.refreshMaster(), 150); // el estado llega en la siguiente instantánea
        break;
      case 'zone':
        spawnZone(ev.at, ev.r, ev.color, ev.dur);
        break;
      case 'aura':
        if (ev.ent && ev.ent.model) spawnAura(ev.ent, ev.kind, ev.dur);
        break;
      case 'hawk': {
        const t = net.mobs.get(ev.target);
        if (ev.ent && t) spawnHawk(ev.ent, t, ev.dur);
        break;
      }
      case 'beam':
        spawnBeam(ev.from, ev.to, ev.w, ev.color);
        break;
      case 'cone':
        spawnCone(ev.at, ev.dir, ev.r, ev.color);
        break;
      case 'dome':
        spawnDome(ev.at, ev.r, ev.dur);
        break;
      case 'poly':
        if (ev.ent && ev.ent.model) {
          ev.ent.polyUntil = G.time + ev.dur;
          ev.ent.polyForm = ev.form || 'sheep';
        }
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
    const pillar = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xffd36b, 2.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    g.add(pillar);
    const sparks = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: V.Gfx.hot(i % 3 ? 0xffe9a8 : 0xffffff, 2.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
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
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: V.Gfx.hot(0xbfe0ff, 2.6), transparent: true, blending: THREE.AdditiveBlending }));
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
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xffb04a, 2.6) })));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.4, depthWrite: false })));
      return g;
    },
    arcane: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xe6d0ff, 2.4) })));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9a6aff, transparent: true, opacity: 0.45, depthWrite: false })));
      return g;
    },
    ice: () => new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xcfeaff, 2.3), transparent: true, opacity: 0.85 })),
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
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xff7a2a, 2.3), transparent: true, opacity: 0.35, depthWrite: false })));
    } else if (kind === 'ice') {
      mesh = PROJ_MESH.ice();
    } else if (kind === 'acorn') {
      // Bellota: cuerpo marrón y gorrito oscuro
      mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xa0703a, roughness: 0.6 })));
      mesh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x5a3a1c })).translateY(0.12));
    } else if (kind === 'glue') {
      // Frasco de pegamento
      mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf2b13a, emissive: 0x5a3a08, roughness: 0.3 })));
      mesh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x8a6a44 })).translateY(0.4));
    } else if (kind === 'sword') {
      // Espada gigante de luz que cae del cielo
      mesh = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.18), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xffe9a0, 2.3), transparent: true, opacity: 0.85 }));
      blade.position.y = 2.5;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
      guard.position.y = 5.1;
      mesh.add(blade, guard);
    } else {
      mesh = PROJ_MESH.arrow();
      mesh.rotation.x = Math.PI / 2;
    }
    const h = kind === 'meteor' ? 22 : kind === 'sword' ? 16 : 12;
    const off = kind === 'meteor' ? 8 : 0;
    G.scene.add(mesh);
    fallers.push({ mesh, from: new THREE.Vector3(at.x - off, at.y + h, at.z - off), to: new THREE.Vector3(at.x, at.y, at.z), t: 0, dur });
  }

  // Objetos temporales en el mundo: charcos, torretas, rayos, conos y cúpulas
  const props = [];
  function addProp(obj, life, fade = 0.4, baseOpacity = null) {
    G.scene.add(obj);
    const mats = [];
    obj.traverse((o) => o.material && mats.push(o.material));
    props.push({ obj, mats, t: 0, life, fade, base: mats.map((m) => (baseOpacity != null ? baseOpacity : m.opacity)) });
    return obj;
  }
  const flatMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  function spawnZone(at, r, color, dur) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2), flatMat(color, 0.38));
    disc.position.set(at.x, heightAt(at.x, at.z) + 0.08, at.z);
    addProp(disc, dur, 0.6);
  }
  function turretMesh(big) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: big ? 0x8a8f9a : 0xb5703f, metalness: 0.3, roughness: 0.6 });
    const glow = new THREE.MeshBasicMaterial({ color: V.Gfx.hot(big ? 0xff9a4a : 0x9fd8ff, 2.2) });
    if (big) {
      // Mecha-Gólem: cuerpo de bloques con ojos brillantes
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 1.1), metal).translateY(2.2));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.8), metal).translateY(3.5));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.1), glow).translateY(3.6).translateZ(0.42));
      for (const x of [-0.45, 0.45]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 0.6), metal).translateX(x).translateY(0.65));
      for (const x of [-1.05, 1.05]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.4, 0.45), metal).translateX(x).translateY(2.1));
    } else {
      // Tótem de chispas: columna de cobre con un cristal arriba
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.2, 0.45), metal).translateY(0.6));
      g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glow).translateY(1.55));
      g.userData.spin = g.children[1];
    }
    g.traverse((o) => (o.castShadow = true));
    return g;
  }
  function spawnBeam(from, to, w, color) {
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    const wood = color === 0x8a5a34;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, w * 0.6, len), new THREE.MeshBasicMaterial({ color: wood ? color : V.Gfx.hot(color, 2.2), transparent: true, opacity: 0.8, depthWrite: false }));
    beam.position.set((from.x + to.x) / 2, from.y, (from.z + to.z) / 2);
    beam.lookAt(to.x, to.y, to.z);
    addProp(beam, 0.5, 0.4);
  }
  function spawnCone(at, dir, r, color) {
    const geo = new THREE.CircleGeometry(r, 20, -0.62, 1.24).rotateX(-Math.PI / 2);
    const cone = new THREE.Mesh(geo, flatMat(V.Gfx.hot(color, 1.8), 0.55));
    cone.position.set(at.x, heightAt(at.x, at.z) + 1, at.z);
    // El sector apunta a +X: se gira hacia la dirección del aliento
    cone.rotation.y = Math.atan2(-dir.z, dir.x);
    addProp(cone, 0.45, 0.4);
  }
  function spawnDome(at, r, dur) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 0.75, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), flatMat(0xc9b48a, 0.22));
    dome.position.set(at.x, heightAt(at.x, at.z), at.z);
    addProp(dome, dur, 0.6);
  }
  // Polimorfia: el monstruo se ve como una oveja o un pollo de bloques
  const polyProtos = {};
  function sheepFor(form = 'sheep') {
    if (!polyProtos[form]) {
      const g = new THREE.Group();
      const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true });
      if (form === 'chicken') {
        const white = m(0xfaf6ee);
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.75), white).translateY(0.75));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.45, 0.35), white).translateY(1.25).translateZ(0.3));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.2), m(0xf2b13a)).translateY(1.2).translateZ(0.55));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.2), m(0xd83a2a)).translateY(1.55).translateZ(0.3));
        for (const x of [-0.15, 0.15]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), m(0xf2b13a)).translateX(x).translateY(0.22));
      } else {
        const wool = m(0xf4f0e6);
        const face = m(0x3a3430);
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 1.2), wool).translateY(0.8));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.4), face).translateY(1.1).translateZ(0.75));
        for (const [x, z] of [[-0.3, 0.4], [0.3, 0.4], [-0.3, -0.4], [0.3, -0.4]]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), face).translateX(x).translateY(0.25).translateZ(z));
      }
      polyProtos[form] = g;
    }
    const s = polyProtos[form].clone();
    G.scene.add(s);
    return s;
  }

  // Chispita del equipo Arcoíris: sube despacio y se desvanece (sin brillo fuerte)
  const sparkleGeo = new THREE.OctahedronGeometry(0.07, 0);
  const _wp = new THREE.Vector3();
  function spawnSparkle(ent, hue) {
    const src = ent.model.weapon && ent.model.weapon.visible ? ent.model.weapon : ent.model.rig;
    src.getWorldPosition(_wp);
    const m = new THREE.Mesh(sparkleGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 0.8, 0.7), transparent: true, opacity: 0.85, depthWrite: false }));
    m.position.set(_wp.x + (Math.random() - 0.5) * 0.5, _wp.y + (src === ent.model.rig ? 1.2 : 0.3) + Math.random() * 0.3, _wp.z + (Math.random() - 0.5) * 0.5);
    G.scene.add(m);
    const y0 = m.position.y;
    const t0 = G.time;
    props.push({ obj: m, mats: [m.material], t: 0, life: 0.8, fade: 0.6, base: [0.85], tick: () => ((m.position.y = y0 + (G.time - t0) * 0.8), (m.rotation.y += 0.1)) });
  }

  // Aviso de un jefe: un círculo en el suelo que se va llenando hasta que explota
  function spawnTelegraph(at, r, dur, color) {
    const g = new THREE.Group();
    const y = heightAt(at.x, at.z) + 0.1;
    g.position.set(at.x, y, at.z);
    const edge = new THREE.Mesh(new THREE.RingGeometry(r * 0.92, r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    fill.scale.setScalar(0.05);
    g.add(edge, fill);
    G.scene.add(g);
    const t0 = G.time;
    props.push({
      obj: g,
      mats: [edge.material, fill.material],
      t: 0,
      life: dur + 0.15,
      fade: 0.15,
      base: [0.9, 0.35],
      tick: () => fill.scale.setScalar(Math.min(1, (G.time - t0) / dur)),
    });
  }

  // ---------- Mascotas y monturas ----------

  // Mascota que sigue a su dueño (o montura bajo el jinete). Se dibuja en cada cliente.
  function updatePet(ent, dt) {
    if (!ent.petType || ent.dead) {
      if (ent.petView && !ent.petType) {
        G.scene.remove(ent.petView.model.root);
        ent.petView = null;
      }
      if (!ent.petView) return;
    }
    const form = ent.mounted === 2 ? 'glider' : ent.mounted === 1 ? 'mount' : 'pet';
    let pv = ent.petView;
    if (!pv || pv.form !== form || pv.type !== ent.petType) {
      if (pv) G.scene.remove(pv.model.root);
      const model = buildPet(ent.petType, form);
      model.root.traverse((o) => (o.raycast = () => {}));
      G.scene.add(model.root);
      pv = ent.petView = { model, form, type: ent.petType, pos: { x: ent.pos.x - 1, y: ent.pos.y, z: ent.pos.z - 1 }, facing: ent.facing, walk: 0, fetch: null };
    }
    const m = pv.model;
    const t = G.time;
    if (form !== 'pet') {
      // Montura: va bajo el jinete
      m.root.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
      m.root.rotation.y = ent.facing;
      pv.walk += ((ent.moving ? 1 : 0) - pv.walk) * Math.min(1, dt * 8);
      animateModel(m, t, pv.walk, 0);
      if (m.wings) for (const [i, w] of m.wings.entries()) w.rotation.z = (i ? -1 : 1) * (form === 'glider' ? 0.15 + Math.sin(t * 3) * 0.12 : Math.sin(t * 8) * 0.2);
      return;
    }
    // Mascota: busca botín o sigue a su dueño por detrás
    let goal;
    if (pv.fetch) {
      pv.fetch.t += dt;
      goal = pv.fetch.t < 0.35 + Math.hypot(pv.fetch.at.x - ent.pos.x, pv.fetch.at.z - ent.pos.z) / 14 ? pv.fetch.at : null;
      if (!goal) pv.fetch = null;
    }
    if (!goal) {
      const side = ent.facing + Math.PI * 0.75;
      goal = { x: ent.pos.x + Math.sin(side) * 1.6, z: ent.pos.z + Math.cos(side) * 1.6 };
    }
    const dx = goal.x - pv.pos.x;
    const dz = goal.z - pv.pos.z;
    const d = Math.hypot(dx, dz);
    const speed = pv.fetch ? 16 : Math.min(14, 2 + d * 3);
    const moving = d > 0.25;
    if (d > 30) {
      pv.pos.x = goal.x;
      pv.pos.z = goal.z;
    } else if (moving) {
      const k = Math.min(1, (speed * dt) / d);
      pv.pos.x += dx * k;
      pv.pos.z += dz * k;
      pv.facing = Math.atan2(dx, dz);
    } else {
      pv.facing += Math.atan2(Math.sin(ent.facing - pv.facing), Math.cos(ent.facing - pv.facing)) * Math.min(1, dt * 3);
    }
    const fly = pv.type !== 'perro';
    pv.pos.y = Math.max(heightAt(pv.pos.x, pv.pos.z), -1.7) + (fly ? 1.4 + Math.sin(t * 3) * 0.15 : 0);
    m.root.position.set(pv.pos.x, pv.pos.y, pv.pos.z);
    m.root.rotation.y = pv.facing;
    pv.walk += ((moving && !fly ? 1 : 0) - pv.walk) * Math.min(1, dt * 8);
    animateModel(m, t * 1.4, pv.walk, 0);
    if (m.wings) for (const [i, w] of m.wings.entries()) w.rotation.z = (i ? -1 : 1) * Math.sin(t * (fly ? 14 : 6)) * 0.5;
  }

  // Aura de Héroe (Ascensión Maestra): anillo dorado con chispas a los pies
  function heroAura(ent, dt) {
    const want = (ent === P ? P.stage : ent.stage) >= 3 && !ent.dead;
    if (want && !ent.heroAura) {
      const g = new THREE.Group();
      const ringM = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
      ringM.position.y = 0.06;
      g.add(ringM);
      const sparks = [];
      for (let i = 0; i < 6; i++) {
        const sp = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xffe9a0, 1.6), transparent: true, opacity: 0.9, depthWrite: false }));
        sp.userData.a = (i / 6) * Math.PI * 2;
        g.add(sp);
        sparks.push(sp);
      }
      g.userData.sparks = sparks;
      g.traverse((o) => (o.raycast = () => {}));
      ent.model.root.add(g);
      ent.heroAura = g;
    } else if (!want && ent.heroAura) {
      ent.model.root.remove(ent.heroAura);
      ent.heroAura = null;
    }
    if (!ent.heroAura) return;
    ent.heroAura.rotation.y += dt * 0.8;
    for (const sp of ent.heroAura.userData.sparks) {
      sp.userData.a += dt * 1.5;
      const y = (sp.userData.a * 0.35) % 2.2;
      sp.position.set(Math.cos(sp.userData.a) * 0.95, 0.1 + y, Math.sin(sp.userData.a) * 0.95);
      sp.material.opacity = 0.9 * (1 - y / 2.2);
    }
  }

  // ---------- Botín en el suelo (solo lo ves tú) ----------

  const lootMeshes = new Map();
  function lootMesh(itemId) {
    const it = ITEMS[itemId];
    const g = new THREE.Group();
    const color = new THREE.Color(V.Data.RARITY[(it && it.rarity) || 'comun'].color);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.8, flatShading: true });
    const lid = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.25, flatShading: true });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.36), wood);
    base.position.y = 0.15;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.12, 0.4), lid);
    top.position.y = 0.36;
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xffe9a0, 1.5) }));
    spark.position.y = 0.75;
    g.add(base, top, spark);
    g.userData.spark = spark;
    g.traverse((o) => {
      o.raycast = () => {};
      o.castShadow = true;
    });
    return g;
  }
  function syncLoot(list) {
    const seen = new Set();
    for (const [id, x, y, z, item] of list) {
      seen.add(id);
      if (lootMeshes.has(id)) continue;
      const g = lootMesh(item);
      g.position.set(x, y, z);
      g.rotation.y = Math.random() * Math.PI * 2;
      g.userData.base = y;
      G.scene.add(g);
      lootMeshes.set(id, g);
    }
    for (const [id, g] of lootMeshes) {
      if (seen.has(id)) continue;
      spawnRing({ x: g.position.x, y: g.userData.base, z: g.position.z }, 0xffd36b, 0.9, 0.35);
      G.scene.remove(g);
      lootMeshes.delete(id);
    }
  }
  function animateLoot(dt) {
    for (const g of lootMeshes.values()) {
      g.position.y = g.userData.base + Math.abs(Math.sin(G.time * 2 + g.rotation.y)) * 0.08;
      g.userData.spark.rotation.y += dt * 3;
      g.userData.spark.position.y = 0.75 + Math.sin(G.time * 3) * 0.08;
    }
  }

  // ---------- Invocaciones ----------

  function mechaMesh() {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f9a, metalness: 0.3, roughness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xb5703f, metalness: 0.3, roughness: 0.6 });
    const glow = new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xff9a4a, 2.2) });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 1.1), metal);
    body.position.y = 2.2;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.8), trim);
    head.position.y = 3.5;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.1), glow);
    eyes.position.set(0, 3.6, 0.42);
    const legs = [-0.45, 0.45].map((x) => {
      const l = new THREE.Group();
      l.position.set(x, 1.3, 0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 0.6), metal);
      mesh.position.y = -0.65;
      l.add(mesh);
      return l;
    });
    const arms = [-1.05, 1.05].map((x) => {
      const a = new THREE.Group();
      a.position.set(x, 2.8, 0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.4, 0.45), trim);
      mesh.position.y = -0.7;
      a.add(mesh);
      return a;
    });
    // Cabina con cristal (se ve al piloto de la versión Maestra)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.1), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.6 }));
    cab.position.set(0, 2.5, 0.56);
    g.add(body, head, eyes, cab, ...legs, ...arms);
    g.traverse((o) => (o.castShadow = true));
    return { root: g, legs, arms };
  }

  function buildSummonModel(u) {
    if (u.type === 'mecha') return mechaMesh();
    if (u.type === 'turret') {
      const g = turretMesh(false);
      return { root: g, spin: g.userData.spin };
    }
    // Clon de viento: la figura de su dueño, verde y translúcida
    const o = u.owner;
    const m = buildHumanoid(lookFor(o ? o.cls : 'elfo', o ? o.sex : 'm'));
    m.root.traverse((x) => {
      if (!x.material) return;
      x.material = x.material.clone();
      x.material.transparent = true;
      x.material.opacity = 0.45;
      x.material.color.lerp(new THREE.Color(0x9fe08a), 0.6);
      x.material.depthWrite = false;
      x.castShadow = false;
    });
    m.clone = true;
    return m;
  }

  function drawSummon(u, dt) {
    const v = u.view;
    const root = u.model.root;
    // El mecha pilotado va donde va su piloto
    const base = u.ride && u.owner ? u.owner.pos : u.pos;
    root.position.set(base.x, base.y, base.z);
    root.rotation.y = u.ride && u.owner ? u.owner.facing : u.facing;
    v.atkAnim = Math.max(0, v.atkAnim - dt * 2.2);
    const moving = u.ride && u.owner ? u.owner.moving : u.moving;
    v.walk += ((moving ? 1 : 0) - v.walk) * Math.min(1, dt * 8);
    if (u.type === 'mecha') {
      const s = Math.sin(G.time * 6) * 0.5 * v.walk;
      u.model.legs[0].rotation.x = s;
      u.model.legs[1].rotation.x = -s;
      const swing = v.atkAnim > 0 ? Math.sin(Math.PI * (1 - v.atkAnim)) : 0;
      u.model.arms[0].rotation.x = -s * 0.6;
      u.model.arms[1].rotation.x = swing ? -swing * 2.2 : s * 0.6;
    } else if (u.type === 'turret') {
      if (u.model.spin) u.model.spin.rotation.y += dt * 3;
    } else if (u.model.clone) {
      animateModel(u.model, G.time + v.phase, 0.6, 0.5 + Math.sin(G.time * 10) * 0.5);
    }
  }

  // ---------- Auras visibles (alas de luz, escudo de brasas, corteza, viento, tornado) ----------

  const auras = [];
  function spawnAura(ent, kind, dur) {
    const g = new THREE.Group();
    const add = (geo, color, opacity, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.userData.base = opacity;
      g.add(m);
      return m;
    };
    const parts = [];
    if (kind === 'wings') {
      for (const sx of [1, -1]) {
        const wg = add(new THREE.BoxGeometry(1.5, 1.1, 0.04), V.Gfx.hot(0xffe9a0, 1.6), 0.55, 0.85 * sx, 1.9, -0.35);
        wg.rotation.set(0.15, -0.35 * sx, 0.3 * sx);
        parts.push(wg);
      }
    } else if (kind === 'fire' || kind === 'wind' || kind === 'tornado') {
      const color = kind === 'fire' ? V.Gfx.hot(0xff7a2a, 1.8) : 0xb6e08a;
      const n = kind === 'tornado' ? 18 : 8;
      for (let i = 0; i < n; i++) {
        const geo = kind === 'fire' ? new THREE.OctahedronGeometry(0.13, 0) : new THREE.BoxGeometry(0.16, 0.04, 0.24);
        const m = add(geo, color, 0.85);
        Object.assign(m.userData, { a: (i / n) * Math.PI * 2, y: kind === 'tornado' ? (i / n) * 2.6 : 0.4 + (i % 3) * 0.5, r: kind === 'tornado' ? 0.7 + (i / n) * 1.2 : 0.9 });
        parts.push(m);
      }
    } else if (kind === 'bark') {
      const shell = add(new THREE.CylinderGeometry(0.75, 0.8, 2.3, 8, 1, true), 0x8a5a34, 0.35, 0, 1.2, 0);
      parts.push(shell);
    }
    if (!parts.length) return;
    ent.model.root.add(g);
    auras.push({ ent, g, kind, parts, t: 0, life: dur });
  }

  function updateAuras(dt) {
    for (let i = auras.length - 1; i >= 0; i--) {
      const a = auras[i];
      a.t += dt;
      const fade = Math.min(1, (a.life - a.t) / 0.5);
      for (const m of a.parts) {
        const u = m.userData;
        if (u && u.a !== undefined) {
          u.a += dt * (a.kind === 'tornado' ? 9 : 4);
          m.position.set(Math.cos(u.a) * u.r, u.y + (a.kind === 'wind' ? 0 : Math.sin(u.a * 2) * 0.1), Math.sin(u.a) * u.r);
          m.rotation.y = -u.a;
        }
        if (a.kind === 'wings') m.rotation.z = (m.position.x > 0 ? 1 : -1) * (0.3 + Math.sin(G.time * 5) * 0.12);
        m.material.opacity = m.userData.base * Math.max(0, fade);
      }
      if (a.t >= a.life || !a.ent.model) {
        if (a.ent.model) a.ent.model.root.remove(a.g);
        a.g.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        auras.splice(i, 1);
      }
    }
    for (let i = hawks.length - 1; i >= 0; i--) {
      const h = hawks[i];
      h.t += dt;
      const t = h.target;
      const k = Math.min(1, h.t / 0.7);
      const circle = h.t * 3;
      const tx = t.pos.x + Math.cos(circle) * 1.6;
      const tz = t.pos.z + Math.sin(circle) * 1.6;
      const ty = t.pos.y + t.height + 1.4;
      h.g.position.set(h.from.x + (tx - h.from.x) * k, h.from.y + (ty - h.from.y) * k + Math.sin(Math.PI * k) * 2, h.from.z + (tz - h.from.z) * k);
      h.g.rotation.y = -circle;
      for (const w of h.wings) w.rotation.z = (w.position.x > 0 ? -1 : 1) * Math.sin(G.time * 18) * 0.6;
      if (h.t >= h.life || t.dead || t.hidden) {
        G.scene.remove(h.g);
        hawks.splice(i, 1);
      }
    }
  }

  // Compañero Halcón: vuela hasta el enemigo marcado y lo rodea
  const hawks = [];
  function spawnHawk(ent, target, dur) {
    const g = new THREE.Group();
    const brown = new THREE.MeshStandardMaterial({ color: 0x8a5a34, flatShading: true });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.22, 0.6), brown));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: 0xf4f0e6 })).translateZ(0.38).translateY(0.05));
    const wings = [-1, 1].map((sx) => {
      const wgt = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.32), brown);
      wgt.position.x = 0.45 * sx;
      g.add(wgt);
      return wgt;
    });
    const from = { x: ent.pos.x, y: ent.pos.y + 2.4, z: ent.pos.z };
    g.position.set(from.x, from.y, from.z);
    G.scene.add(g);
    hawks.push({ g, wings, from, target, t: 0, life: dur });
  }


  function updateEffects(dt) {
    for (let i = props.length - 1; i >= 0; i--) {
      const pr = props[i];
      pr.t += dt;
      const left = pr.life - pr.t;
      const a = left < pr.fade ? Math.max(0, left / pr.fade) : 1;
      pr.mats.forEach((m, k) => {
        if (a < 1) m.transparent = true;
        m.opacity = pr.base[k] * a;
      });
      if (pr.obj.userData.spin) pr.obj.userData.spin.rotation.y += dt * 3;
      if (pr.tick) pr.tick();
      if (left <= 0) {
        G.scene.remove(pr.obj);
        pr.obj.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        props.splice(i, 1);
      }
    }
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
    if (ent.hidden || ent.riding) {
      root.visible = false;
      return;
    }
    // Equipo de grado Arcoíris: cambia de color y deja chispitas al moverse o atacar
    const rm = ent.model.rainbowMats;
    if (rm && rm.length) {
      const h = (G.time * 0.12) % 1;
      rm.forEach((mm, i) => mm.color.setHSL((h + i * 0.13) % 1, 0.75, 0.62));
      v.trailT = (v.trailT || 0) - dt;
      if (v.trailT <= 0 && (ent.moving || v.atkAnim > 0)) {
        v.trailT = 0.12;
        spawnSparkle(ent, h);
      }
    }
    // Gemas de Poder activas: el arma brilla con luz neón (sin destellos grandes)
    if (ent.kind === 'player' && ent.model.bladeMat) {
      if (ent.gem) {
        v.gemOn = true;
        ent.model.bladeMat.emissive.setHex(0x40e0ff);
        ent.model.bladeMat.emissiveIntensity = 0.55 + Math.sin(G.time * 6 + v.phase) * 0.2;
      } else if (v.gemOn) {
        v.gemOn = false;
        setWeaponLook(ent.model, ITEMS[ent.equip.weapon]);
      }
    }
    root.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
    root.rotation.y = ent.facing;
    if (ent.dead) {
      v.deathK = Math.min(1, v.deathK + dt * 2.5);
      animateDeath(ent.model, v.deathK);
      root.visible = !(ent.kind === 'mob' && ent.deadT < ent.respawnTime - 4);
      return;
    }
    // Polimorfia: se dibuja una oveja mientras dure (o hasta que lo golpeen)
    const sheep = ent.polyUntil > G.time && ent.stunned;
    if (sheep) {
      if (!v.sheep) v.sheep = sheepFor(ent.polyForm);
      v.sheep.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
      v.sheep.rotation.y = ent.facing;
      root.visible = false;
      return;
    }
    if (v.sheep) {
      G.scene.remove(v.sheep);
      v.sheep = null;
      ent.polyUntil = 0;
    }
    if (!root.visible) root.visible = true;
    if (v.deathK) {
      v.deathK = 0;
      animateDeath(ent.model, 0);
    }
    v.atkAnim = Math.max(0, v.atkAnim - dt * (ent.kind === 'mob' ? 2.2 : 2.4));
    v.walkBlend += ((ent.moving ? 1 : 0) - v.walkBlend) * Math.min(1, dt * (ent.kind === 'mob' ? 8 : 10));
    v.swim += ((ent.swimming ? 1 : 0) - v.swim) * Math.min(1, dt * 6);
    // Jefe con escudo (Mega-Autómata): burbuja azul mientras no se pisen los botones
    if (ent.kind === 'mob' && ent.def.mech && ent.def.mech.type === 'plates') {
      if (!v.shield) {
        v.shield = new THREE.Mesh(new THREE.SphereGeometry(ent.height * 0.75, 18, 12), new THREE.MeshBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0.22, depthWrite: false }));
        v.shield.position.y = ent.height * 0.5;
        ent.model.root.add(v.shield);
      }
      v.shield.visible = !!ent.shielded;
      v.shield.material.opacity = 0.18 + Math.sin(G.time * 4) * 0.06;
    }
    // Monstruo aturdido: se tambalea quieto
    if (ent.stunned) ent.model.root.rotation.z = Math.sin(G.time * 12) * 0.08;
    else if (ent.model.root.rotation.z) ent.model.root.rotation.z = 0;
    const riding = ent.kind === 'player' && ent.mounted && ent.petView && ent.petView.model.saddle;
    if (ent.model.skinned) ent.model.sitting = !!riding;
    animateModel(ent.model, G.time + (ent.kind === 'mob' ? v.phase : 0), riding ? 0 : v.walkBlend, v.atkAnim, riding ? 0 : v.swim);
    if (riding && ent.model.lLeg) {
      // Caderas sobre la silla (la figura está escalada según la raza)
      ent.model.rig.position.y += ent.petView.model.saddle - 0.95 * ent.model.rig.scale.y;
      ent.model.lLeg.rotation.set(-1.35, 0, 0.35);
      ent.model.rLeg.rotation.set(-1.35, 0, -0.35);
    } else if (riding && ent.model.skinned) {
      // Modelo 3D: sentado, con la cadera sobre la silla
      ent.model.rig.position.y += ent.petView.model.saddle - ent.model.curHipY * ent.model.rig.scale.y;
    } else if (ent.model.lLeg && ent.model.lLeg.rotation.z) {
      ent.model.lLeg.rotation.z = 0;
      ent.model.rLeg.rotation.z = 0;
    }
    if (ent.kind === 'player') {
      updatePet(ent, dt);
      heroAura(ent, dt);
    }
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
      // Un evento con un problema no debe detener el juego: se registra y se sigue
      try {
        const ev = resolveEvent(raw);
        if (ev) handleEvent(ev);
      } catch (e) {
        console.error('[evento]', raw && raw.type, e);
      }
    }
    for (const q of net.players.values()) if (q.model) drawEntity(q, dt);
    for (const m of net.mobs.values()) if (m.model) drawEntity(m, dt);
    for (const u of net.summons.values()) drawSummon(u, dt);
    updateAuras(dt);
    animateLoot(dt);
    if (V.Guide) V.Guide.update(dt);
    if (G.playerSel && !net.players.has(G.playerSel.id)) G.playerSel = null;
    sync();
    syncProjectiles();
    updateEffects(dt);
  }

  V.Game = {
    PROTOCOL, connect, register, login, resume, logout, createChar, deleteChar, play,
    setTarget, attackTarget, targetNearest, moveTo, talkTo, selectNpc, selectPlayer, useSkill, countItem, usePotion,
    clickInventory, useItem, sellItem, unequip, buyItem, respawnPlayer, update, sendChat, sendPhrase, report, classQuest, toggleGems, hatch, toggleMount,
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
