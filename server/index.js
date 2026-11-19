// Servidor de juego de Ecos de Valdoria.
//
// Ejecuta la misma simulación que el juego (juego/src/sim.js) para todos los jugadores
// conectados. Es autoritativo: los clientes solo envían intenciones ("moverme aquí",
// "usar habilidad 2") y el servidor decide el resultado. Cada cliente recibe, 10 veces
// por segundo, el estado de lo que tiene cerca, más los eventos que le corresponden.
//
// Protocolo v2 (JSON por WebSocket en /ws):
//   cuenta:     register, login, resume, logout → auth | authError
//   personajes: createChar, deleteChar → chars | charError · play → welcome + estado
//   juego:      dir, move, target, attack, skill, potion, use, sell, buy, unequip, talk,
//               respawn, chat, invite, inviteAnswer, partyLeave, partyKick, ping
//   servidor:   s (estado), e (eventos), chat, error, kicked, pong
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const DB = require('./db.js');
const { createAdmin } = require('./admin.js');
const { filterChat } = require('./chatfilter.js');

const SRC = process.env.GAME_SRC || path.join(__dirname, '..', 'juego', 'src');
const Data = require(path.join(SRC, 'data.js'));
const Sim = require(path.join(SRC, 'sim.js'));
const Terrain = require(path.join(SRC, 'terrain.js'));
const { VERSION } = require(path.join(SRC, 'version.js'));
const C = Sim.cmd;

const PORT = +process.env.PORT || 8080;
const PROTOCOL = 3; // v3: razas, cambios de clase y grados de equipo (v0.7)
const TICK_MS = 50; // 20 pasos de simulación por segundo
const DT = TICK_MS / 1000;
const SNAP_EVERY = 2; // estado a 10 Hz
const SAVE_EVERY = 600; // guarda los personajes cada 30 s
const VIEW_R = 72; // distancia a la que ves a otros jugadores y monstruos
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 100;
const MAX_MSGS_PER_SEC = 60;
const CHAT_MAX = 160;
const started = Date.now();

// Un error inesperado no debe tumbar el servidor (y desconectar a todos): se registra y sigue
process.on('uncaughtException', (e) => console.error('[error]', e && e.stack));
process.on('unhandledRejection', (e) => console.error('[error]', e));

// ---------- Mundo ----------

// Personajes de versiones anteriores (Guerrero, Arquera, Mago) → nuevas razas
const migrated = DB.migrateChars((cls, data) => Data.migrateCharacter(cls, data));
if (migrated) console.log(`[migración] ${migrated} personajes convertidos a las nuevas razas`);

const world = Sim.createWorld();
Sim.spawnMobs(world);
// Gremios guardados; los miembros cuyo personaje ya no existe salen del gremio
Sim.loadGuilds(world, DB.loadGuilds());
for (const g of [...world.guilds.values()]) for (const m of [...g.members]) if (!DB.hasName(m.name)) Sim.forgetMember(world, m.name);
if (world.guildsDirty) DB.saveGuilds(Sim.exportGuilds(world));
world.guildsDirty = false;
Sim.drainEvents(world);
const mobsById = new Map(world.mobs.map((m) => [m.id, m]));
const clients = new Set();

// ---------- Utilidades ----------

const r2 = (v) => Math.round(v * 100) / 100;
const int = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, Math.floor(+v))) : d);
const send = (c, msg) => {
  if (c.ws.readyState !== 1) return;
  try {
    c.ws.send(JSON.stringify(msg));
  } catch (e) {
    console.error('[envío]', e.message);
  }
};
const near = (a, b, r = VIEW_R) => Math.abs(a.x - b.x) < r && Math.abs(a.z - b.z) < r;
const isItem = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(Data.ITEMS, id);
const isClass = (id) => Data.isArchetype(id);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanText(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, CHAT_MAX);
}

function broadcastChat(msg) {
  for (const c of clients) if (c.p) send(c, msg);
}

// Partida guardada → datos válidos para la simulación
function charData(ch) {
  const d = Data.migrateCharacter(ch.cls, ch.data || {}).data;
  const base = Sim.newCharacter(ch.name, d.cls, ch.sex);
  const pos = d.pos && Number.isFinite(+d.pos.x) && Number.isFinite(+d.pos.z) && Math.hypot(d.pos.x, d.pos.z) < 185 ? { x: +d.pos.x, z: +d.pos.z } : base.pos;
  return {
    ...base,
    level: int(d.level, 1, Data.MAX_LEVEL, 1),
    xp: int(d.xp, 0, 1e9, 0),
    gold: int(d.gold, 0, 1e9, base.gold),
    inv: Array.isArray(d.inv) ? d.inv.filter((s) => s && isItem(s.id)).slice(0, 30) : base.inv,
    equip: d.equip && typeof d.equip === 'object' ? { weapon: isItem(d.equip.weapon) ? d.equip.weapon : null, armor: isItem(d.equip.armor) ? d.equip.armor : null } : base.equip,
    stage: int(d.stage, 0, 3, 0),
    branch: d.branch === 'a' || d.branch === 'b' ? d.branch : null,
    quest: d.quest || null,
    gemsOn: !!d.gemsOn,
    pet: d.pet && Data.isPet(d.pet.type) ? { type: d.pet.type } : null,
    karma: int(d.karma, 0, 1e9, 0),
    pvp: int(d.pvp, 0, 1e6, 0),
    pk: int(d.pk, 0, 1e6, 0),
    pos,
    hp: Number.isFinite(+d.hp) ? +d.hp : null,
    mp: Number.isFinite(+d.mp) ? +d.mp : null,
  };
}

function savePlayer(c) {
  if (c.p && c.charId) DB.saveChar(c.charId, Sim.serialize(c.p));
}

// ---------- Estado que se envía a cada jugador ----------

function playerRow(q) {
  return [q.id, r2(q.pos.x), r2(q.pos.y), r2(q.pos.z), r2(q.facing), q.moving ? 1 : 0, q.dead ? 1 : 0, Math.round(q.hp), q.stats.maxHp, q.level, q.cls, q.name, q.equip.weapon, q.equip.armor, q.leap ? 1 : 0, q.sex, q.party || 0, q.swimming ? 1 : 0, q.stage, q.branch || 0, q.gemsOn && Sim.countItem(q, 'gema_poder') > 0 ? 1 : 0, q.pet ? q.pet.type : 0, q.mounted || 0, Sim.pvpState(q), Sim.guildTag(world, q)];
}

function mobRow(m) {
  return [m.id, m.key, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.facing), m.moving ? 1 : 0, m.dead ? 1 : 0, Math.max(0, Math.round(m.hp)), m.maxHp, m.lvl, m.aggro ? 1 : 0, r2(m.deadT || 0), m.respawnTime || 0, m.stunT > 0 ? 1 : 0, m.slowT > 0 ? 1 : 0, m.dots.length ? 1 : 0, m.def.mech && m.def.mech.type === 'plates' && !(m.shieldDownT > 0) ? 1 : 0];
}

function meData(c) {
  const p = c.p;
  const d = {
    hp: r2(p.hp),
    mp: r2(p.mp),
    xp: p.xp,
    level: p.level,
    gold: p.gold,
    stats: Sim.liveStats(p),
    cds: p.cds,
    buffs: Sim.buffList(p),
    debuffs: Sim.debuffList(p),
    gemsOn: p.gemsOn ? 1 : 0,
    gems: Sim.countItem(p, 'gema_poder'),
    pet: p.pet ? p.pet.type : null,
    mounted: p.mounted || 0,
    mountKind: Data.mountKind(p),
    // Botín en el suelo (solo lo ve su dueño): [id, x, y, z, objeto, cantidad]
    loot: world.loot.filter((b) => b.owner === p.id && near(b.pos, p.pos)).map((b) => [b.id, r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), b.item, b.qty]),
    stage: p.stage,
    branch: p.branch,
    quest: p.quest,
    bubble: p.bubble ? 1 : 0,
    freeNext: p.freeNext ? 1 : 0,
    shield: Math.round(p.shield),
    shieldT: r2(p.shieldT),
    combatT: r2(p.combatT),
    target: p.target ? p.target.id : null,
    dead: p.dead,
    breath: r2(p.breath),
    swimming: p.swimming,
    deep: p.deep,
    party: Sim.partyView(world, p),
    karma: p.karma,
    pvp: p.pvp,
    pk: p.pk,
    flagT: Math.ceil(p.flagT),
  };
  const g = p.guild ? world.guilds.get(p.guild) : null;
  const gKey = g ? `${g.id}:${g.ver}` : '';
  if (gKey !== c.guildKey) {
    c.guildKey = gKey;
    d.guild = Sim.guildView(world, p) || 0;
  }
  if (c.invDirty) {
    d.inv = p.inv;
    d.equip = p.equip;
    c.invDirty = false;
  }
  return d;
}

function snapshot(c) {
  const p = c.p;
  const players = [];
  for (const q of world.players.values()) if (q === p || near(q.pos, p.pos) || (p.party && q.party === p.party)) players.push(playerRow(q));
  const mobs = [];
  for (const m of world.mobs) if (near(m.pos, p.pos)) mobs.push(mobRow(m));
  const proj = [];
  for (const j of world.projectiles) if (near(j.pos, p.pos)) proj.push([j.id, j.kind, r2(j.pos.x), r2(j.pos.y), r2(j.pos.z), j.target.id, j.big ? 1 : 0]);
  // Invocaciones: [id, tipo, x, y, z, giro, vida, vida máx., dueño, moviéndose, pilotado]
  const sums = [];
  for (const u of world.summons) if (!u.dead && near(u.pos, p.pos)) sums.push([u.id, u.type, r2(u.pos.x), r2(u.pos.y), r2(u.pos.z), r2(u.facing), Math.max(0, Math.round(u.hp)), u.maxHp, u.owner.id, u.moving ? 1 : 0, u.ride ? 1 : 0]);
  send(c, { t: 's', T: r2(world.time), p: players, m: mobs, j: proj, u: sums, me: meData(c), n: world.players.size });
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
    if (ev.type === 'levelUp') for (const c of clients) if (c.p === ev.ent) savePlayer(c);
    const w = wire(ev);
    if (ev.to) {
      for (const c of clients) if (c.p && c.p.id === ev.to) push(c, w);
      continue;
    }
    const at = ev.pos || ev.at || (ev.pts && ev.pts[0]) || (ev.ent && ev.ent.pos);
    for (const c of clients) {
      if (!c.p) continue;
      if (!at || near(at, c.p.pos, VIEW_R + 10)) push(c, w);
    }
  }
  for (const [c, list] of out) send(c, { t: 'e', e: list });
}

// ---------- Cuenta y personajes ----------

function authOk(c, acc, session) {
  // Si la cuenta ya tenía una conexión jugando, se cierra (no puede estar dos veces)
  for (const o of clients) {
    if (o !== c && o.acc === acc) {
      send(o, { t: 'kicked', msg: 'Se inició sesión con tu cuenta en otro lugar.' });
      o.ws.close();
    }
  }
  c.acc = acc;
  c.session = session || c.session;
  send(c, { t: 'auth', user: acc.user, session: session || null, chars: DB.listChars(acc), maxChars: DB.MAX_CHARS });
}

function authFail(c, msg) {
  c.fails = (c.fails || 0) + 1;
  send(c, { t: 'authError', msg });
  if (c.fails >= 8) c.ws.close(); // demasiados intentos fallidos en esta conexión
}

function onAccount(c, msg) {
  switch (msg.t) {
    case 'register': {
      if (msg.v !== PROTOCOL) return send(c, { t: 'authError', code: 'version', msg: 'Tu versión del juego es antigua. Actualízala para jugar en línea.' });
      const r = DB.register(str(msg.user, 32), str(msg.email, 140), str(msg.pass, 100));
      if (!r.ok) return authFail(c, r.error);
      console.log(`[cuenta nueva] ${r.acc.user}`);
      return authOk(c, r.acc, r.session);
    }
    case 'login': {
      if (msg.v !== PROTOCOL) return send(c, { t: 'authError', code: 'version', msg: 'Tu versión del juego es antigua. Actualízala para jugar en línea.' });
      const r = DB.login(str(msg.user, 32), str(msg.pass, 100));
      if (!r.ok) return authFail(c, r.error);
      return authOk(c, r.acc, r.session);
    }
    case 'resume': {
      if (msg.v !== PROTOCOL) return send(c, { t: 'authError', code: 'version', msg: 'Tu versión del juego es antigua. Actualízala para jugar en línea.' });
      const acc = DB.resume(str(msg.session, 100));
      if (!acc) return send(c, { t: 'authError', code: 'session', msg: 'Tu sesión expiró. Vuelve a entrar.' });
      c.session = str(msg.session, 100);
      return authOk(c, acc, null);
    }
    case 'logout':
      if (c.acc) DB.logout(c.acc, c.session);
      c.acc = null;
      return send(c, { t: 'loggedOut' });
  }
  if (!c.acc) return;
  switch (msg.t) {
    case 'createChar': {
      if (c.p) return;
      const cls = isClass(msg.cls) ? msg.cls : 'lagarto';
      const sex = msg.sex === 'f' ? 'f' : 'm';
      const r = DB.createChar(c.acc, str(msg.name, 40), cls, sex, Sim.newCharacter('', cls, sex));
      if (!r.ok) return send(c, { t: 'charError', msg: r.error });
      return send(c, { t: 'chars', chars: DB.listChars(c.acc), created: r.char.id });
    }
    case 'deleteChar': {
      if (c.p) return;
      const gone = DB.getChar(c.acc, str(msg.id, 20));
      const r = DB.deleteChar(c.acc, str(msg.id, 20));
      if (r.ok && gone) Sim.forgetMember(world, gone.name);
      if (!r.ok) return send(c, { t: 'charError', msg: r.error });
      return send(c, { t: 'chars', chars: DB.listChars(c.acc) });
    }
    case 'play': {
      if (c.p) return;
      if (world.players.size >= MAX_PLAYERS) return send(c, { t: 'charError', msg: 'El servidor está lleno. Inténtalo en unos minutos.' });
      const ch = DB.getChar(c.acc, str(msg.id, 20));
      if (!ch) return send(c, { t: 'charError', msg: 'Ese personaje no existe.' });
      c.charId = ch.id;
      c.joinedAt = Date.now();
      c.p = Sim.addPlayer(world, charData(ch));
      c.invDirty = true;
      send(c, { t: 'welcome', id: c.p.id, protocol: PROTOCOL, version: VERSION, players: world.players.size });
      snapshot(c);
      broadcastChat({ t: 'chat', kind: 'sys', text: `${ch.name} ha llegado a Valdoria.` });
      console.log(`[entra] ${ch.name} (${c.acc.user}) · ${world.players.size} en línea`);
    }
  }
}

// ---------- Chat seguro ----------

const warn = (c, p, text) => send(c, { t: 'e', e: [{ type: 'log', to: p.id, text, cls: 'warn' }] });
const reports = []; // reportes de jugadores (los ve el panel de control)

function onChat(c, p, msg) {
  const nowMs = Date.now();
  if (nowMs - (c.chatAt || 0) < 700) return;
  c.chatAt = nowMs;
  const muted = c.acc && c.acc.mutedUntil > nowMs;
  if (muted) return warn(c, p, `Estás silenciado ${Math.ceil((c.acc.mutedUntil - nowMs) / 60000)} min. Puedes usar las frases rápidas.`);
  let text;
  let phrase = false;
  let toParty = false;
  let toGuild = false;
  if (typeof msg.phrase === 'string') {
    // Frase rápida: texto fijo, siempre seguro
    const ph = Data.PHRASES.find((x) => x.id === msg.phrase);
    if (!ph) return;
    text = ph.text;
    phrase = true;
    toParty = !!msg.party && !!p.party;
    toGuild = !toParty && !!msg.guild && !!p.guild;
  } else {
    let raw = cleanText(msg.text);
    if (!raw) return;
    if (raw.startsWith('#') && p.party) {
      toParty = true;
      raw = raw.slice(1).trim();
    } else if (raw.startsWith('@')) {
      if (!p.guild) return warn(c, p, 'No perteneces a ningún gremio. Los mensajes con @ son para tu gremio.');
      toGuild = true;
      raw = raw.slice(1).trim();
      if (!raw) return;
    }
    // Mismo mensaje repetido: no se reenvía
    if (raw === c.lastChat && nowMs - (c.lastChatAt || 0) < 20000) return warn(c, p, 'No repitas el mismo mensaje.');
    c.lastChat = raw;
    c.lastChatAt = nowMs;
    const f = filterChat(raw);
    if (!f.ok) {
      if (f.reason === 'personal') {
        strike(c, p);
        return warn(c, p, 'Por tu seguridad, no compartas datos personales: teléfono, dirección, correo, redes sociales ni contraseñas. El mensaje no se envió.');
      }
      return;
    }
    if (f.censored) strike(c, p);
    text = f.text;
  }
  // Historial corto de cada jugador (para los reportes)
  c.history = [...(c.history || []), { at: nowMs, text }].slice(-12);
  const out = { t: 'chat', kind: toParty ? 'party' : toGuild ? 'guild' : 'player', id: p.id, name: p.name, cls: p.cls, text, phrase };
  if (toGuild) {
    for (const o of clients) if (o.p && o.p.guild === p.guild) send(o, out);
    return;
  }
  if (toParty) {
    const party = world.parties.get(p.party);
    for (const o of clients) if (o.p && party && party.members.includes(o.p.id)) send(o, out);
    return;
  }
  broadcastChat(out);
}

// Avisos acumulados: 3 en 10 minutos = 5 minutos sin chat libre
function strike(c, p) {
  const nowMs = Date.now();
  c.strikes = (c.strikes || []).filter((t) => nowMs - t < 600000);
  c.strikes.push(nowMs);
  if (c.strikes.length >= 3 && c.acc) {
    c.strikes = [];
    const until = nowMs + 5 * 60000;
    c.acc.mutedUntil = until;
    DB.setMute(c.acc.user, until);
    warn(c, p, 'Has recibido varios avisos: tu chat libre queda en pausa 5 minutos. Puedes seguir usando las frases rápidas.');
    console.log(`[chat] silenciado 5 min por avisos: ${p.name} (${c.acc.user})`);
  }
}

function onReport(c, p, msg) {
  const nowMs = Date.now();
  if (nowMs - (c.reportAt || 0) < 30000) return warn(c, p, 'Espera un poco antes de enviar otro reporte.');
  const target = [...clients].find((o) => o.p && o.p.id === msg.id);
  if (!target || target === c) return;
  c.reportAt = nowMs;
  const reason = ['insultos', 'datos', 'molesta', 'otro'].includes(msg.reason) ? msg.reason : 'otro';
  reports.unshift({ at: nowMs, from: c.acc ? c.acc.user : '?', fromName: p.name, account: target.acc ? target.acc.user : '?', name: target.p.name, reason, history: target.history || [] });
  reports.length = Math.min(reports.length, 100);
  console.warn(`[reporte] ${p.name} reportó a ${target.p.name} (${reason})`);
  send(c, { t: 'e', e: [{ type: 'log', to: p.id, text: `Gracias. Un adulto revisará el reporte sobre ${target.p.name}. También puedes silenciarlo para no ver sus mensajes.`, cls: 'sys' }] });
}

// ---------- Comandos de juego ----------

function onCommand(c, msg) {
  const p = c.p;
  if (!p) return;
  switch (msg.t) {
    case 'exit': {
      // Volver al selector de personajes sin cerrar la sesión
      leaveWorld(c);
      return send(c, { t: 'chars', chars: DB.listChars(c.acc), exited: true });
    }
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
      // Los refuerzos de los jefes aparecen después: se buscan también en la lista viva. También
      // se puede elegir a otro jugador (para atacarlo hay que forzar con Ctrl, salvo morados o rojos)
      const m = typeof msg.id === 'string' ? mobsById.get(msg.id) || world.mobs.find((x) => x.id === msg.id) || world.players.get(msg.id) || null : null;
      if (m && !near(m.pos, p.pos, 40)) return;
      return C.setTarget(world, p, m);
    }
    case 'attack':
      return C.attack(world, p, msg.force === true);
    case 'skill':
      return C.useSkill(world, p, int(msg.i, 0, p.skills.length - 1, 0), msg.force === true);
    case 'potion':
      if (msg.id === 'pocion_vida' || msg.id === 'pocion_mana') C.usePotion(world, p, msg.id);
      return;
    case 'use':
      return C.useItem(world, p, int(msg.i, 0, 29, 0));
    case 'sell':
      return C.sellItem(world, p, int(msg.i, 0, 29, 0), int(msg.q, 1, 999, 1));
    case 'destroy':
      return C.destroyItem(world, p, int(msg.i, 0, 29, 0), int(msg.q, 1, 999, 1));
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
    case 'gems':
      return C.setGems(world, p, !!msg.on);
    case 'hatch':
      return C.hatchPet(world, p, str(msg.type, 12));
    case 'mount':
      return C.toggleMount(world, p);
    case 'classQuest':
      return C.classQuest(world, p, str(msg.action, 10), msg.branch === 'a' || msg.branch === 'b' ? msg.branch : null);
    case 'invite':
      if (typeof msg.id === 'string') C.partyInvite(world, p, msg.id);
      return;
    case 'inviteByName': {
      const name = str(msg.name, 20).toLowerCase();
      const t = [...world.players.values()].find((q) => q.name.toLowerCase() === name);
      if (!t) return send(c, { t: 'e', e: [{ type: 'log', to: p.id, text: `No hay ningún jugador conectado llamado «${str(msg.name, 20)}».`, cls: 'warn' }] });
      return C.partyInvite(world, p, t.id);
    }
    case 'inviteAnswer':
      return C.partyAnswer(world, p, !!msg.accept);
    case 'partyLeave':
      return C.partyLeave(world, p);
    case 'partyKick':
      if (typeof msg.id === 'string') C.partyKick(world, p, msg.id);
      return;
    case 'chat':
      return onChat(c, p, msg);
    case 'guildCreate':
      return C.guildCreate(world, p, str(msg.name, 30), int(msg.emblem, 0, 99, 0), int(msg.color, 0, 99, 0), (name) => {
        const f = filterChat(name);
        return !f.ok || f.censored ? 'Ese nombre de gremio no está permitido. Elige otro.' : null;
      });
    case 'guildInvite':
      if (typeof msg.id === 'string') C.guildInvite(world, p, msg.id);
      return;
    case 'guildInviteByName': {
      const name = str(msg.name, 20).toLowerCase();
      const t = [...world.players.values()].find((q) => q.name.toLowerCase() === name);
      if (!t) return send(c, { t: 'e', e: [{ type: 'log', to: p.id, text: `No hay ningún jugador conectado llamado «${str(msg.name, 20)}».`, cls: 'warn' }] });
      return C.guildInvite(world, p, t.id);
    }
    case 'guildAnswer':
      return C.guildAnswer(world, p, !!msg.accept);
    case 'guildLeave':
      return C.guildLeave(world, p);
    case 'guildKick':
      return C.guildKick(world, p, str(msg.key, 20));
    case 'guildRank':
      return C.guildRank(world, p, str(msg.key, 20), msg.rank ? 1 : 0);
    case 'guildLeader':
      return C.guildLeader(world, p, str(msg.key, 20));
    case 'guildDisband':
      return C.guildDisband(world, p);
    case 'guildNotice': {
      const raw = cleanText(msg.text || '').slice(0, 140);
      if (!raw) return C.guildNotice(world, p, '');
      const f = filterChat(raw);
      if (!f.ok) return warn(c, p, f.reason === 'personal' ? 'Por tu seguridad, no pongas datos personales en el mensaje del gremio.' : 'Ese mensaje no está permitido.');
      return C.guildNotice(world, p, f.text);
    }
    case 'report':
      return onReport(c, p, msg);
  }
}

// ---------- Red ----------

const admin = createAdmin({ world, clients, DB, Terrain, VERSION, started, send, broadcastChat, savePlayer, reports });

const server = http.createServer((req, res) => {
  if (admin.handle(req, res)) return;
  const url = new URL(req.url, 'http://x');
  const json = (obj) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(obj));
  };
  if (url.pathname === '/name-available') return json({ available: DB.nameAvailable(url.searchParams.get('name')) });
  if (url.pathname === '/status') return json({ ok: true, version: VERSION, protocol: PROTOCOL, players: world.players.size, ...DB.counts(), uptime: Math.round((Date.now() - started) / 1000) });
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Servidor de Ecos de Valdoria v${VERSION} en funcionamiento.\n`);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

function leave(c) {
  clients.delete(c);
  leaveWorld(c);
}

// Saca al personaje del mundo y lo guarda (al desconectarse o al volver al selector)
function leaveWorld(c) {
  if (!c.p) return;
  Sim.collectAllLoot(world, c.p); // el botín que quedó en el suelo pasa a la mochila
  savePlayer(c);
  const name = c.p.name;
  Sim.removePlayer(world, c.p.id);
  c.p = null;
  broadcastChat({ t: 'chat', kind: 'sys', text: `${name} ha dejado Valdoria.` });
  console.log(`[sale] ${name} · ${world.players.size} en línea`);
}

wss.on('connection', (ws, req) => {
  const ip = String(req.headers['fly-client-ip'] || req.socket.remoteAddress || '?');
  const c = { ws, p: null, acc: null, msgs: 0, window: Date.now(), invDirty: false, chatAt: 0, ip, rtt: null, pingAt: 0 };
  clients.add(c);
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    if (c.pingAt) c.rtt = Date.now() - c.pingAt; // latencia medida con el ping del servidor
  });
  ws.on('error', (e) => console.error('[ws]', e.message));

  ws.on('message', (raw) => {
    ws.isAlive = true;
    const nowMs = Date.now();
    if (nowMs - c.window > 1000) {
      c.window = nowMs;
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
    try {
      if (msg.t === 'ping') return send(c, { t: 'pong', at: msg.at });
      if (!c.p) onAccount(c, msg);
      else onCommand(c, msg);
    } catch (e) {
      console.error(`[mensaje ${msg.t}]`, e && e.stack);
    }
  });

  ws.on('close', () => {
    try {
      leave(c);
    } catch (e) {
      console.error('[salida]', e && e.stack);
    }
  });
});

// Conexiones muertas: ping cada 15 s
setInterval(() => {
  for (const c of clients) {
    if (!c.ws.isAlive) {
      c.ws.terminate();
      continue;
    }
    c.ws.isAlive = false;
    try {
      c.pingAt = Date.now();
      c.ws.ping();
    } catch {
      /* nada */
    }
  }
}, 15000);

// ---------- Bucle de simulación ----------

let frame = 0;
let last = Date.now();
setInterval(() => {
  try {
    const nowMs = Date.now();
    // Si el proceso se retrasa, recupera hasta 4 pasos para mantener el tiempo real
    let steps = Math.min(4, Math.max(1, Math.round((nowMs - last) / TICK_MS)));
    last = nowMs;
    while (steps--) {
      Sim.step(world, DT);
      routeEvents(Sim.drainEvents(world));
    }
    frame++;
    if (world.guildsDirty) {
      world.guildsDirty = false;
      DB.saveGuilds(Sim.exportGuilds(world));
    }
    if (frame % SNAP_EVERY === 0) for (const c of clients) if (c.p) snapshot(c);
    if (frame % SAVE_EVERY === 0) for (const c of clients) savePlayer(c);
  } catch (e) {
    console.error('[bucle]', e && e.stack);
  }
}, TICK_MS);

// Al apagar (despliegue nuevo), guardar a todos
function shutdown() {
  for (const c of clients) savePlayer(c);
  DB.flush();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`Ecos de Valdoria v${VERSION} · servidor en el puerto ${PORT} · ${world.mobs.length} monstruos`));

module.exports = { server, world };
