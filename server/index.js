// Servidor de juego de Ecos de Valdoria.
//
// Ejecuta la misma simulación que el juego (juego/src/sim.js) para todos los jugadores
// conectados. Es autoritativo: los clientes solo envían intenciones ("moverme aquí",
// "usar habilidad 2") y el servidor decide el resultado. Cada cliente recibe, 10 veces
// por segundo, el estado de lo que tiene cerca, más los eventos que le corresponden.
//
// Protocolo (JSON por WebSocket en /ws):
//   cliente → servidor: join, dir, move, target, attack, skill, potion, use, sell, buy,
//                       unequip, talk, respawn, chat
//   servidor → cliente: welcome, s (estado), e (eventos), chat, save, error
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const Names = require('./names.js');

const SRC = process.env.GAME_SRC || path.join(__dirname, '..', 'juego', 'src');
const Data = require(path.join(SRC, 'data.js'));
const Sim = require(path.join(SRC, 'sim.js'));
const C = Sim.cmd;

const PORT = +process.env.PORT || 8080;
const PROTOCOL = 1;
const TICK_MS = 50; // 20 pasos de simulación por segundo
const DT = TICK_MS / 1000;
const SNAP_EVERY = 2; // estado a 10 Hz
const VIEW_R = 72; // distancia a la que ves a otros jugadores y monstruos
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 100;
const MAX_MSGS_PER_SEC = 40;
const CHAT_MAX = 160;
const started = Date.now();

// ---------- Mundo ----------

const world = Sim.createWorld();
Sim.spawnMobs(world);
Sim.drainEvents(world);
const mobsById = new Map(world.mobs.map((m) => [m.id, m]));
const clients = new Set();

// ---------- Utilidades ----------

const r2 = (v) => Math.round(v * 100) / 100;
// Solo claves propias: evita que "__proto__" o "constructor" pasen como objetos o clases
const isItem = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(Data.ITEMS, id);
const isClass = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(Data.CLASSES, id);
const int = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, Math.floor(+v))) : d);
const send = (c, msg) => c.ws.readyState === 1 && c.ws.send(JSON.stringify(msg));
const near = (a, b, r = VIEW_R) => Math.abs(a.x - b.x) < r && Math.abs(a.z - b.z) < r;

function cleanName(s) {
  const n = String(s || '')
    .replace(/[\u0000-\u001f<>"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return n.length >= 2 ? n : 'Viajero';
}

function cleanText(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, CHAT_MAX);
}

// Valida la partida que trae el cliente. Fase 1: aún no hay cuentas, así que se acepta la
// partida local pero dentro de límites razonables. En la Fase 3 vivirá en la base de datos.
function cleanSave(save, name, cls) {
  const base = Sim.newCharacter(name, cls);
  if (!save || typeof save !== 'object' || save.cls !== cls) return base;
  const level = int(save.level, 1, Data.MAX_LEVEL, 1);
  const inv = Array.isArray(save.inv)
    ? save.inv
        .filter((s) => s && isItem(s.id))
        .slice(0, 30)
        .map((s) => ({ id: s.id, qty: Data.ITEMS[s.id].stack ? int(s.qty, 1, 999, 1) : 1 }))
    : base.inv;
  const eq = save.equip || {};
  const okEquip = (id, type) => {
    if (!isItem(id)) return null;
    const it = Data.ITEMS[id];
    return it.type === type && (!it.cls || it.cls === cls) && it.lvl <= level ? id : null;
  };
  let pos = { x: (Math.random() - 0.5) * 6, z: 5 + (Math.random() - 0.5) * 4 };
  if (save.pos && Number.isFinite(+save.pos.x) && Number.isFinite(+save.pos.z) && Math.hypot(save.pos.x, save.pos.z) < 185) {
    pos = { x: +save.pos.x, z: +save.pos.z };
  }
  return {
    name,
    cls,
    level,
    xp: int(save.xp, 0, Data.xpToNext(level), 0),
    gold: int(save.gold, 0, 1e7, 0),
    inv,
    equip: { weapon: okEquip(eq.weapon, 'weapon') || base.equip.weapon, armor: okEquip(eq.armor, 'armor') },
    pos,
    hp: Number.isFinite(+save.hp) ? +save.hp : null,
    mp: Number.isFinite(+save.mp) ? +save.mp : null,
  };
}

function broadcastChat(msg) {
  for (const c of clients) if (c.p) send(c, msg);
}

// ---------- Estado que se envía a cada jugador ----------

function playerRow(q) {
  return [q.id, r2(q.pos.x), r2(q.pos.y), r2(q.pos.z), r2(q.facing), q.moving ? 1 : 0, q.dead ? 1 : 0, Math.round(q.hp), q.stats.maxHp, q.level, q.cls, q.name, q.equip.weapon, q.equip.armor, q.leap ? 1 : 0];
}

function mobRow(m) {
  return [m.id, m.key, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.facing), m.moving ? 1 : 0, m.dead ? 1 : 0, Math.max(0, Math.round(m.hp)), m.maxHp, m.lvl, m.aggro ? 1 : 0, r2(m.deadT || 0), m.respawnTime || 0];
}

function meData(c) {
  const p = c.p;
  const d = {
    hp: r2(p.hp),
    mp: r2(p.mp),
    xp: p.xp,
    level: p.level,
    gold: p.gold,
    stats: p.stats,
    cds: p.cds,
    buffT: r2(p.buffT),
    buffPct: p.buffPct,
    buffName: p.buffName,
    shield: Math.round(p.shield),
    shieldT: r2(p.shieldT),
    combatT: r2(p.combatT),
    target: p.target ? p.target.id : null,
    dead: p.dead,
  };
  if (c.invDirty) {
    d.inv = p.inv;
    d.equip = p.equip;
    d.save = Sim.serialize(p); // el cliente guarda una copia local al cambiar el inventario
    c.invDirty = false;
  }
  return d;
}

function snapshot(c) {
  const p = c.p;
  const players = [];
  for (const q of world.players.values()) if (q === p || near(q.pos, p.pos)) players.push(playerRow(q));
  const mobs = [];
  for (const m of world.mobs) if (near(m.pos, p.pos)) mobs.push(mobRow(m));
  const proj = [];
  for (const j of world.projectiles) if (near(j.pos, p.pos)) proj.push([j.id, j.kind, r2(j.pos.x), r2(j.pos.y), r2(j.pos.z), j.target.id, j.big ? 1 : 0]);
  send(c, { t: 's', T: r2(world.time), p: players, m: mobs, j: proj, me: meData(c), n: world.players.size });
}

// ---------- Eventos de la simulación → jugadores ----------

function wire(ev) {
  const o = { ...ev };
  if (ev.ent) {
    o.ent = ev.ent.id;
    if (ev.type === 'equip') {
      o.weapon = ev.ent.equip.weapon;
      o.armor = ev.ent.equip.armor;
    }
  }
  return o;
}

function routeEvents(events) {
  if (!events.length) return;
  const out = new Map();
  const push = (c, ev) => {
    if (!out.has(c)) out.set(c, []);
    out.get(c).push(ev);
  };
  for (const ev of events) {
    if (ev.type === 'inventory' || ev.type === 'equip') {
      for (const c of clients) if (c.p && (ev.to === c.p.id || ev.ent === c.p)) c.invDirty = true;
    }
    const w = wire(ev);
    if (ev.to) {
      for (const c of clients) if (c.p && c.p.id === ev.to) push(c, w);
      continue;
    }
    const at = ev.pos || ev.at || (ev.ent && ev.ent.pos);
    for (const c of clients) {
      if (!c.p) continue;
      if (!at || near(at, c.p.pos, VIEW_R + 10)) push(c, w);
    }
  }
  for (const [c, list] of out) send(c, { t: 'e', e: list });
}

// ---------- Mensajes de los clientes ----------

function onJoin(c, msg) {
  if (c.p) return;
  if (msg.v !== PROTOCOL) return send(c, { t: 'error', msg: 'Tu versión del juego no es compatible con el servidor. Descarga la última versión.' }), c.ws.close();
  if (world.players.size >= MAX_PLAYERS) return send(c, { t: 'error', msg: 'El servidor está lleno. Inténtalo en unos minutos.' }), c.ws.close();
  const cls = isClass(msg.cls) ? msg.cls : 'guerrero';
  const name = cleanName(msg.name);
  const online = [...world.players.values()].some((q) => q.name.toLowerCase() === name.toLowerCase());
  if (online) {
    send(c, { t: 'error', code: 'name_taken', msg: `Ya hay un jugador conectado con el nombre «${name}». Elige otro nombre.` });
    return c.ws.close();
  }
  // El nombre pertenece a quien lo registró primero: se necesita su llave
  const token = msg.save && typeof msg.save.token === 'string' ? msg.save.token : null;
  const claim = Names.claim(name, token, cls);
  if (!claim.ok) {
    send(c, { t: 'error', code: 'name_taken', msg: `El nombre «${name}» ya pertenece a otro personaje. Elige otro nombre.` });
    return c.ws.close();
  }
  c.p = Sim.addPlayer(world, cleanSave(msg.save, name, cls));
  if (claim.token) send(c, { t: 'token', name, token: claim.token });
  c.invDirty = true;
  send(c, { t: 'welcome', id: c.p.id, protocol: PROTOCOL, players: world.players.size });
  snapshot(c);
  broadcastChat({ t: 'chat', kind: 'sys', text: `${name} ha llegado a Valdoria.` });
  console.log(`[entra] ${name} (${cls}, nv ${c.p.level}) · ${world.players.size} en línea`);
}

function onCommand(c, msg) {
  const p = c.p;
  if (!p) return;
  switch (msg.t) {
    case 'dir': {
      const d = msg.d;
      if (!d) return C.setMoveDir(world, p, null);
      const x = +d.x;
      const z = +d.z;
      const len = Math.hypot(x, z);
      if (!Number.isFinite(len) || len < 0.01) return C.setMoveDir(world, p, null);
      return C.setMoveDir(world, p, { x: x / len, z: z / len });
    }
    case 'move':
      if (Number.isFinite(+msg.x) && Number.isFinite(+msg.z)) C.moveTo(world, p, { x: +msg.x, z: +msg.z });
      return;
    case 'target': {
      const m = typeof msg.id === 'string' ? mobsById.get(msg.id) : null;
      if (m && !near(m.pos, p.pos, 40)) return;
      return C.setTarget(world, p, m);
    }
    case 'attack':
      return C.attack(world, p);
    case 'skill':
      return C.useSkill(world, p, int(msg.i, 0, 3, 0));
    case 'potion':
      if (msg.id === 'pocion_vida' || msg.id === 'pocion_mana') C.usePotion(world, p, msg.id);
      return;
    case 'use':
      return C.useItem(world, p, int(msg.i, 0, 29, 0));
    case 'sell':
      return C.sellItem(world, p, int(msg.i, 0, 29, 0), int(msg.q, 1, 999, 1));
    case 'buy':
      if (isItem(msg.id)) C.buyItem(world, p, msg.id, int(msg.q, 1, Sim.MAX_TRADE, 1));
      return;
    case 'unequip':
      if (msg.k === 'weapon' || msg.k === 'armor') C.unequip(world, p, msg.k);
      return;
    case 'talk':
      if (typeof msg.id === 'string') C.talkTo(world, p, msg.id);
      return;
    case 'respawn':
      return C.respawn(world, p);
    case 'chat': {
      const text = cleanText(msg.text);
      const now = Date.now();
      if (!text || now - (c.chatAt || 0) < 800) return;
      c.chatAt = now;
      return broadcastChat({ t: 'chat', kind: 'player', id: p.id, name: p.name, cls: p.cls, text });
    }
  }
}

// ---------- Red ----------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/name-available') {
    const name = cleanName(url.searchParams.get('name'));
    const free = !Names.isTaken(name) && ![...world.players.values()].some((q) => q.name.toLowerCase() === name.toLowerCase());
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ name, available: free }));
  }
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: true, players: world.players.size, characters: Names.count(), protocol: PROTOCOL, uptime: Math.round((Date.now() - started) / 1000) }));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Servidor de Ecos de Valdoria en funcionamiento.\n');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  const c = { ws, p: null, msgs: 0, window: Date.now(), invDirty: false, chatAt: 0 };
  clients.add(c);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - c.window > 1000) {
      c.window = now;
      c.msgs = 0;
    }
    if (++c.msgs > MAX_MSGS_PER_SEC) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'join') onJoin(c, msg);
    else onCommand(c, msg);
  });

  ws.on('close', () => {
    clients.delete(c);
    if (!c.p) return;
    const name = c.p.name;
    Sim.removePlayer(world, c.p.id);
    broadcastChat({ t: 'chat', kind: 'sys', text: `${name} ha dejado Valdoria.` });
    console.log(`[sale] ${name} · ${world.players.size} en línea`);
  });
});

// Conexiones colgadas: ping cada 20 s
setInterval(() => {
  for (const c of clients) {
    if (!c.ws.isAlive) {
      c.ws.terminate();
      continue;
    }
    c.ws.isAlive = false;
    c.ws.ping();
  }
}, 20000);

// ---------- Bucle de simulación ----------

let frame = 0;
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  // Si el proceso se retrasa, recupera hasta 4 pasos para mantener el tiempo real
  let steps = Math.min(4, Math.max(1, Math.round((now - last) / TICK_MS)));
  last = now;
  while (steps--) {
    Sim.step(world, DT);
    routeEvents(Sim.drainEvents(world));
  }
  frame++;
  if (frame % SNAP_EVERY === 0) for (const c of clients) if (c.p) snapshot(c);
  if (frame % 200 === 0) for (const c of clients) if (c.p) send(c, { t: 'save', d: Sim.serialize(c.p) });
}, TICK_MS);

server.listen(PORT, () => console.log(`Ecos de Valdoria · servidor en el puerto ${PORT} · ${world.mobs.length} monstruos`));

module.exports = { server, world };
