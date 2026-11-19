// Simulación del juego, sin gráficos ni interfaz: jugadores, monstruos, combate,
// habilidades, objetos, grupos, progresión y cambios de clase. Es la misma lógica que corre
// el servidor en línea (Node), por eso no usa THREE, document ni window.
//
// Modelo: un "mundo" con varios jugadores. Los comandos (moverse, atacar, usar
// habilidad…) cambian el estado; step(world, dt) avanza el tiempo; todo lo que ocurre
// se anota como eventos (daño, botín, mensajes, efectos) que el cliente dibuja y que el
// servidor reenvía a cada jugador. Los eventos con `to` son solo para ese jugador.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'), require('./terrain.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    V.Sim = factory(V.Data, V.Terrain);
  }
})(function (Data, Terrain) {
  const { ARCHETYPES, isArchetype, MOBS, ITEMS, ZONES, NPCS, MAX_LEVEL, STAGES, GRADES, ARMOR_TYPES, xpToNext, mobStats, playerBaseStats, sellPrice, resolveDrop, shopFor, CRIT_MULT, MOVE_SPEED } = Data;
  const { skillsFor, passiveFor, equipProblem, startGear, questFor, weaponFor, className, raceName, GEM_MULT } = Data;
  const { heightAt, inVillage, inSafe, zoneAt, WORLD_LIMIT, collide, waterDepth, SWIM_DEPTH, DEEP_DEPTH, SWIM_Y, WATER_Y, layout } = Terrain;
  const { ARENAS, shopItems, SHOPS, mobHeight } = Data;
  const { PETS, isPet, PET_LVL, MOUNT_LVL, MOUNT_SPEED, PET_FETCH_R, mountKind, petName } = Data;
  const { GUILD_LVL, GUILD_COST, GUILD_MAX, GUILD_RANKS, GUILD_EMBLEMS, GUILD_COLORS } = Data;
  const LOOT_LIFE = 30; // segundos: luego el botín llega solo a la mochila (nunca se pierde)
  const PICK_R = 1.8;

  const SPEED = MOVE_SPEED;
  const SWIM_SPEED = 0.6; // nadar es más lento
  const BREATH_MAX = 30; // segundos de aire
  const AGGRO_R = 9;
  const LEASH_R = 50; // distancia desde su sitio a la que un monstruo deja de perseguir
  const RETURN_HEAL = 0.1; // al volver a su sitio recupera un 10% de vida por segundo (no al instante)
  const ACTIVE_R = 90; // los monstruos lejos de todo jugador no se simulan
  const INV_SLOTS = 30;
  const TALK_R = 4;
  const SHOP_R = 8;
  const MASTER_R = 7;
  const PARTY_MAX = 7;
  const PARTY_R = 45; // distancia para compartir experiencia, botín y misiones
  const PLAYER_R = 0.45;
  const SPAWN = { x: 0, z: 5 };
  const PROJ_SPEED = { arrow: 38, fire: 24, arcane: 26 };
  // PvP y PK (como en Lineage 2): atacar a un jugador "blanco" exige forzar el ataque (Ctrl) y deja
  // tu nombre morado un rato; derrotar a un jugador blanco te hace PK (karma y nombre rojo).
  const PVP_MIN_LEVEL = 10; // los aventureros por debajo de este nivel no pueden pelear ni ser atacados
  const FLAG_T = 30; // segundos con el nombre morado tras atacar a un jugador
  const PVP_DMG = 0.6; // el daño entre jugadores se reduce para que las peleas duren más
  const KARMA_PCT = 0.2; // karma por PK: parte de la experiencia de un nivel (crece con cada PK, hasta x3)

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const bodyR = (m) => (m.def ? (m.def.scale || 1) * 0.45 : PLAYER_R);
  const entR = (e) => (e.kind === 'mob' ? 0.4 * (e.def.scale || 1) : PLAYER_R);
  const clampStage = (s) => Math.max(0, Math.min(3, Math.floor(+s) || 0));

  // ---------- Mundo y eventos ----------

  function createWorld() {
    return { time: 0, nextId: 1, players: new Map(), mobs: [], projectiles: [], timers: [], events: [], parties: new Map(), summons: [], loot: [], guilds: new Map(), guildsDirty: false, bus: createBus(), systems: [], api: null };
  }

  // ---------- Bus de eventos de dominio y sistemas (módulos desacoplados) ----------
  // Los sistemas (emotes, mentor, combos…) viven en juego/src/systems/ y NUNCA tocan el interior del
  // combate: escuchan eventos del bus y actúan con la API pequeña de apiFor(w). Un error dentro de
  // un sistema se registra y no detiene la simulación.
  function createBus() {
    const subs = new Map();
    return {
      on(type, fn) {
        if (!subs.has(type)) subs.set(type, []);
        subs.get(type).push(fn);
      },
      emit(type, e) {
        for (const fn of subs.get(type) || []) {
          try {
            fn(e);
          } catch (err) {
            console.error(`[bus] ${type}:`, err && err.stack ? err.stack : err);
          }
        }
      },
    };
  }
  const fire = (w, type, e) => w.bus.emit(type, e);

  // Lo único que un sistema puede usar del núcleo
  function apiFor(w) {
    if (w.api) return w.api;
    w.api = {
      bus: w.bus,
      Data,
      now: () => w.time,
      day: () => Math.floor(Date.now() / 864e5),
      log: (p, text, cls = 'sys') => log(w, p, text, cls),
      float: (ent, text, cls, dh = 0) => float(w, ent, text, cls, dh),
      ring: (pos, color, r, life) => ring(w, pos, color, r, life),
      banner: (p, title, sub) => emit(w, { type: 'banner', to: p.id, title, sub }),
      fx: (ev) => emit(w, ev), // evento de red (con ent o pos: llega a quien esté cerca)
      damageArea: (p, at, radius, mult) => hitCircle(w, p, at, radius, mult, {}),
      damageOne: (p, target, mult) => damageMob(w, p, target, mult),
      push: (target, from, dist) => target.kind === 'mob' && knockBack(target, from, dist),
      addItem: (p, id, qty = 1) => {
        const okAdd = addItem(p, id, qty);
        if (okAdd) emit(w, { type: 'inventory', to: p.id });
        return okAdd;
      },
      playerById: (id) => w.players.get(id) || null,
      players: () => [...w.players.values()],
      partyOf: (p) => partyOf(w, p),
      zoneAt,
      inSafe,
      dist: d2,
    };
    return w.api;
  }

  // Registrar un sistema en un mundo (el servidor y las pruebas lo hacen al crear el mundo)
  function useSystem(w, sys) {
    if (!sys || !sys.id || w.systems.some((s) => s.id === sys.id)) return;
    w.systems.push(sys);
    if (sys.init) sys.init(w, apiFor(w));
    for (const p of w.players.values()) loadExt(w, p, sys);
  }
  // Datos propios de cada sistema por jugador: p.ext[id] (se guardan con el personaje)
  function loadExt(w, p, sys) {
    if (!sys.load) return;
    try {
      p.ext[sys.id] = sys.load(p.ext[sys.id], p, apiFor(w)) || {};
    } catch (err) {
      console.error(`[sistema ${sys.id}] load:`, err);
      p.ext[sys.id] = {};
    }
  }
  function cleanExt(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    try {
      const txt = JSON.stringify(raw);
      return txt.length > 16000 ? {} : JSON.parse(txt); // límite de tamaño por si acaso
    } catch {
      return {};
    }
  }
  // Comando del cliente para un sistema: { sys, cmd, arg }
  function systemCommand(w, p, sysId, cmd, arg) {
    const sys = w.systems.find((s) => s.id === sysId);
    const fn = sys && sys.commands && Object.prototype.hasOwnProperty.call(sys.commands, cmd) ? sys.commands[cmd] : null;
    if (!fn) return;
    try {
      fn(w, p, arg, apiFor(w));
    } catch (err) {
      console.error(`[sistema ${sysId}] ${cmd}:`, err);
    }
  }
  // Lo que cada sistema muestra en los paneles de este jugador
  function systemViews(w, p) {
    const out = {};
    for (const s of w.systems) if (s.view) out[s.id] = s.view(w, p, apiFor(w));
    return out;
  }
  const emit = (w, ev) => w.events.push(ev);
  function drainEvents(w) {
    const out = w.events;
    w.events = [];
    return out;
  }
  const log = (w, p, text, cls = '') => emit(w, { type: 'log', to: p.id, text, cls });
  const float = (w, ent, text, cls, dh = 0) => emit(w, { type: 'float', ent, text, cls, dh });
  const ring = (w, pos, color, r, life) => emit(w, { type: 'ring', pos: { x: pos.x, y: pos.y, z: pos.z }, color, r, life });

  // ---------- Jugadores ----------

  function newCharacter(name, cls, sex = 'm') {
    const id = isArchetype(cls) ? cls : 'lagarto';
    const magic = ARCHETYPES[id].combat === 'magic';
    return {
      v: 4,
      name,
      cls: id,
      sex: sex === 'f' ? 'f' : 'm',
      level: 1,
      xp: 0,
      gold: 40,
      stage: 0,
      branch: null,
      quest: null,
      inv: [
        { id: 'pocion_vida', qty: 4 },
        { id: 'pocion_mana', qty: magic ? 4 : 2 },
        { id: 'gema_poder', qty: 20 },
      ],
      equip: startGear(id),
      pos: { ...SPAWN },
    };
  }

  function addPlayer(w, data, id = `p${w.nextId++}`) {
    const cls = isArchetype(data.cls) ? data.cls : 'lagarto';
    const cdef = ARCHETYPES[cls];
    const stage = clampStage(data.stage);
    const branch = stage >= 2 && (data.branch === 'a' || data.branch === 'b') ? data.branch : null;
    const p = {
      id,
      kind: 'player',
      name: data.name,
      cls,
      sex: data.sex === 'f' ? 'f' : 'm',
      cdef,
      stage: branch || stage < 2 ? stage : 1,
      branch,
      quest: validQuest(data.quest),
      skills: null,
      passive: null,
      level: data.level,
      xp: data.xp,
      gold: data.gold,
      inv: data.inv.map((s) => ({ ...s })),
      equip: { weapon: null, armor: null, ...data.equip },
      pos: { x: data.pos.x, y: 0, z: data.pos.z },
      facing: Math.PI,
      height: 2.5,
      moving: false,
      moveDir: null,
      moveTarget: null,
      target: null,
      autoAttack: false,
      atkTimer: 0,
      pendingHit: 0,
      cds: {},
      buffs: {},
      shield: 0,
      shieldT: 0,
      bubble: 0,
      leap: null,
      combatT: 0,
      queued: null,
      interact: null,
      dead: false,
      swimming: false,
      deep: false,
      breath: BREATH_MAX,
      party: null,
      invite: null,
      slide: null,
      spells: 0,
      freeNext: false,
      basics: 0,
      frenzy: 0,
      frenzyT: 0,
      aura: null,
      debuffs: {},
      gemsOn: !!data.gemsOn,
      pet: data.pet && isPet(data.pet.type) ? { type: data.pet.type } : null,
      mounted: 0,
      ext: cleanExt(data.ext),
      zoneId: null,
      karma: Math.max(0, Math.floor(+data.karma) || 0),
      pvp: Math.max(0, Math.floor(+data.pvp) || 0),
      pk: Math.max(0, Math.floor(+data.pk) || 0),
      flagT: 0,
      force: false,
      hp: 0,
      mp: 0,
    };
    refreshKit(p);
    // Equipo que ya no corresponde (otra raza, grado bloqueado…): vuelve al inventario
    for (const key of ['weapon', 'armor']) {
      const it = ITEMS[p.equip[key]];
      if (p.equip[key] && (!it || it.type !== key || equipProblem(p, it))) {
        if (it && p.inv.length < INV_SLOTS) p.inv.push({ id: p.equip[key], qty: 1 });
        p.equip[key] = null;
      }
    }
    // Personajes que ya pasaron el nivel 5 sin mascota: reciben su huevo
    if (p.level >= PET_LVL && !p.pet && !p.inv.some((x) => x.id === 'huevo_mascota') && p.inv.length < INV_SLOTS) p.inv.push({ id: 'huevo_mascota', qty: 1 });
    collide(p.pos, PLAYER_R);
    p.pos.y = groundY(p.pos.x, p.pos.z);
    w.players.set(id, p);
    attachGuild(w, p);
    for (const s of w.systems) loadExt(w, p, s);
    recalcStats(w, p);
    p.hp = Math.min(data.hp ?? p.stats.maxHp, p.stats.maxHp);
    p.mp = Math.min(data.mp ?? p.stats.maxMp, p.stats.maxMp);
    if (p.hp <= 0) p.hp = Math.round(p.stats.maxHp * 0.7);
    return p;
  }

  // Habilidades y pasiva según raza, etapa y rama
  function refreshKit(p) {
    p.skills = skillsFor(p.cls, p.stage, p.branch);
    p.passive = passiveFor(p.cls, p.stage, p.branch) || {};
  }

  function validQuest(q) {
    if (!q || typeof q !== 'object') return null;
    const st = clampStage(q.stage);
    const def = questFor(st);
    if (!def) return null;
    return { stage: st, kills: Math.max(0, Math.min(def.need, Math.floor(+q.kills) || 0)), branch: q.branch === 'a' || q.branch === 'b' ? q.branch : null };
  }

  function removePlayer(w, id) {
    const p = w.players.get(id);
    if (!p) return;
    partyLeave(w, p, true);
    w.players.delete(id);
    forgetTarget(w, p);
    if (guildOf(w, p)) guildOf(w, p).ver++; // cambia quién está conectado
    for (const m of w.mobs) if (m.aggro === p) dropAggro(m);
    for (const su of w.summons) if (su.owner === p) su.dead = true;
  }

  function serialize(p) {
    const alive = !p.dead;
    return {
      v: 4,
      name: p.name,
      cls: p.cls,
      sex: p.sex,
      level: p.level,
      xp: p.xp,
      gold: p.gold,
      stage: p.stage,
      branch: p.branch,
      quest: p.quest ? { ...p.quest } : null,
      gemsOn: !!p.gemsOn,
      pet: p.pet ? { ...p.pet } : null,
      karma: p.karma,
      pvp: p.pvp,
      pk: p.pk,
      ext: cleanExt(p.ext),
      inv: p.inv.map((s) => ({ ...s })),
      equip: { ...p.equip },
      pos: alive ? { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2) } : { ...SPAWN },
      hp: alive ? Math.round(p.hp) : null,
      mp: alive ? Math.round(p.mp) : null,
    };
  }

  function recalcStats(w, p) {
    const b = playerBaseStats(p.cls, p.level);
    const wpn = ITEMS[p.equip.weapon];
    const arm = ITEMS[p.equip.armor];
    const pas = p.passive || {};
    p.stats = {
      maxHp: Math.round((b.maxHp + (arm ? arm.hp : 0)) * (1 + (pas.hpPct || 0))),
      maxMp: b.maxMp + (arm ? arm.mp || 0 : 0),
      atk: b.atk + (wpn ? wpn.atk : 0),
      def: b.def + (arm ? arm.def : 0),
      crit: b.crit + (wpn && wpn.crit ? wpn.crit : 0),
      critMult: CRIT_MULT,
      atkSpeed: p.cdef.atkSpeed, // segundos entre ataques básicos (sin bonificaciones)
      speed: SPEED * (1 + (pas.speedPct || 0)),
      range: Math.round(p.cdef.range * (1 + (pas.rangePct || 0)) * 10) / 10,
      evade: arm ? arm.evade || 0 : 0,
      heal: 1 + (arm ? arm.heal || 0 : 0) + (pas.healPct || 0),
      block: pas.block || 0,
    };
    if (p.hp > p.stats.maxHp) p.hp = p.stats.maxHp;
    if (p.mp > p.stats.maxMp) p.mp = p.stats.maxMp;
    emit(w, { type: 'equip', ent: p });
  }

  // ---------- Bonificaciones temporales (buffs) ----------

  const BUFF_KEYS = ['atk', 'crit', 'speed', 'haste', 'dr', 'evade', 'thorns', 'cdr'];
  function addBuff(w, p, key, name, b) {
    const old = p.buffs[key];
    p.buffs[key] = { name, t: b.dur, ccImmune: !!b.ccImmune };
    for (const k of BUFF_KEYS) if (b[k]) p.buffs[key][k] = b[k];
    if (!old) emit(w, { type: 'buff', to: p.id, name, dur: b.dur });
  }
  const buffSum = (p, k) => {
    let s = 0;
    for (const id in p.buffs) s += p.buffs[id][k] || 0;
    if (p.aura && p.aura[k]) s += p.aura[k];
    return s;
  };
  const playerAtk = (p) => p.stats.atk * (1 + buffSum(p, 'atk'));
  const playerCrit = (p) => p.stats.crit + buffSum(p, 'crit');
  const moveSpeed = (p) => (p.debuffs.root ? 0 : p.stats.speed * (1 + buffSum(p, 'speed') + (MOUNT_SPEED[p.mounted] || 0)) * (p.debuffs.slow ? 0.6 : 1));
  const attackInterval = (p) => p.stats.atkSpeed / (1 + buffSum(p, 'haste') + p.frenzy * (p.passive.frenzy || 0));
  const reachTo = (p, m) => p.stats.range + bodyR(m);

  // Aliados: tú y los miembros de tu grupo vivos a menos de r metros (de un punto)
  function alliesNear(w, p, r, at = p.pos, includeDead = false) {
    const party = p.party ? w.parties.get(p.party) : null;
    const ids = party ? party.members : [p.id];
    const out = [];
    for (const id of ids) {
      const q = w.players.get(id);
      if (q && (includeDead || !q.dead) && d2(q.pos, at) <= r) out.push(q);
    }
    if (!out.includes(p) && (includeDead || !p.dead) && d2(p.pos, at) <= r) out.push(p);
    return out;
  }

  function healPlayer(w, healer, q, amount) {
    if (q.dead || amount <= 0) return 0;
    const amt = Math.round(amount);
    const before = q.hp;
    q.hp = Math.min(q.stats.maxHp, q.hp + amt);
    const done = Math.round(q.hp - before);
    if (done > 0) float(w, q, `+${done}`, 'heal');
    return done;
  }

  // ---------- Monstruos ----------

  const zoneById = (id) => ZONES.find((z) => z.id === id);
  function randomPointInZone(z, f = 0.85) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * z.r * f;
      const pt = { x: z.x + Math.cos(a) * r, z: z.z + Math.sin(a) * r };
      // Evita aparecer dentro de un árbol o en aguas profundas
      const c = { x: pt.x, z: pt.z };
      const arena = Object.values(ARENAS).some((a) => Math.hypot(pt.x - a.x, pt.z - a.z) < a.r + 3);
      if (!arena && !inSafe(pt) && !collide(c, 0.6) && waterDepth(pt.x, pt.z) < SWIM_DEPTH) return pt;
    }
    return { x: z.x, z: z.z };
  }

  function spawnMobs(w) {
    for (const [key, def] of Object.entries(MOBS)) {
      const zone = zoneById(def.zone);
      for (let i = 0; i < def.count; i++) {
        const sp = def.at ? { ...def.at } : def.boss ? { x: zone.x + 4, z: zone.z + 4 } : randomPointInZone(zone);
        const m = {
          id: `m${w.nextId++}`,
          kind: 'mob',
          key,
          def,
          zone,
          pos: { x: 0, y: 0, z: 0 },
          spawn: { x: 0, z: 0 },
          facing: Math.random() * Math.PI * 2,
          height: mobHeight(def),
          moving: false,
          slowT: 0,
          stunT: 0,
          rootT: 0,
          polyT: 0,
          markT: 0,
          markPct: 0,
          dots: [],
          slide: null,
        };
        rollMob(w, m, sp);
        w.mobs.push(m);
      }
    }
    return w.mobs;
  }

  function rollMob(w, m, sp) {
    m.lvl = randInt(m.def.lvl[0], m.def.lvl[1]);
    Object.assign(m, mobStats(m.def, m.lvl));
    m.hp = m.maxHp;
    m.spawn.x = sp.x;
    m.spawn.z = sp.z;
    m.pos.x = sp.x;
    m.pos.z = sp.z;
    m.pos.y = groundY(sp.x, sp.z);
    m.dead = false;
    m.aggro = null;
    m.state = 'idle';
    m.wanderT = rand(0, 4);
    m.wanderTo = null;
    m.atkTimer = rand(0.6, 1.4);
    m.slowT = 0;
    m.stunT = 0;
    m.rootT = 0;
    m.polyT = 0;
    m.markT = 0;
    m.dots = [];
    m.deadT = 0;
    m.hitBy = new Set();
    // Estado de la mecánica de jefe
    m.mechT = m.def.mech ? m.def.mech.every || 0 : 0;
    m.shieldDownT = 0;
    m.plateT = [0, 0, 0];
    m.addsDone = false;
    if (m.def.boss && w.time > 5 && (m.def.world || m.def.raid)) emit(w, { type: 'banner', to: null, title: `¡${m.def.name} despertó!`, sub: `${m.zone.name} · nivel ${m.lvl}${m.def.raid ? ' · ¡Lleva un grupo!' : ''}` });
    emit(w, { type: 'mobSpawn', ent: m });
  }

  function dropAggro(m) {
    m.aggro = null;
    m.state = 'return';
  }

  const isBurning = (m) => m.dots.some((d) => d.kind === 'burn');
  function stunMob(w, m, dur, label = 'Aturdido') {
    if (m.dead || !dur) return;
    m.stunT = Math.max(m.stunT, dur);
    float(w, m, label, 'stun', 0.3);
  }
  function addDot(w, p, m, dot, kind) {
    if (m.dead || !dot) return;
    const total = playerAtk(p) * dot.mult;
    m.dots.push({ owner: p, perSec: total / dot.dur, left: dot.dur, tick: 1, kind });
    float(w, m, kind === 'burn' ? 'Quemado' : 'Envenenado', kind === 'burn' ? 'burn' : 'poison', 0.3);
  }
  function knockBack(m, from, dist) {
    if (m.def.boss) return;
    const dx = m.pos.x - from.x;
    const dz = m.pos.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    m.pos.x += (dx / len) * dist;
    m.pos.z += (dz / len) * dist;
    collide(m.pos, entR(m));
    m.pos.y = groundY(m.pos.x, m.pos.z);
  }

  // ---------- Movimiento, colisiones y agua ----------

  // Altura del cuerpo: el terreno, o la superficie del agua si es profunda (nadando)
  const groundY = (x, z) => Math.max(heightAt(x, z), waterDepth(x, z) > SWIM_DEPTH ? SWIM_Y : -Infinity);

  function face(ent, tx, tz, dt) {
    const target = Math.atan2(tx - ent.pos.x, tz - ent.pos.z);
    const diff = Math.atan2(Math.sin(target - ent.facing), Math.cos(target - ent.facing));
    ent.facing += diff * Math.min(1, dt * 14);
  }

  // Avanza hacia un punto rodeando obstáculos: si el camino directo está bloqueado,
  // prueba desviarse siempre hacia el mismo lado (seguir la pared) hasta despejarlo.
  const TRIES = [0.5, 1, 1.45, 1.9, 2.4];
  function stepToward(ent, target, speed, dt, stopDist, turn = true) {
    const dx = target.x - ent.pos.x;
    const dz = target.z - ent.pos.z;
    const dist = Math.hypot(dx, dz);
    // Margen de 1 cm: sin él, el redondeo deja al personaje "casi llegando" para siempre
    if (dist <= stopDist + 0.01) return false;
    const step = Math.min(speed * dt, dist - stopDist);
    const ux = dx / dist;
    const uz = dz / dist;
    const rad = entR(ent);
    const tryDir = (a) => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const vx = ux * c - uz * s;
      const vz = ux * s + uz * c;
      const pos = { x: ent.pos.x + vx * step, z: ent.pos.z + vz * step };
      collide(pos, rad);
      const moved = Math.hypot(pos.x - ent.pos.x, pos.z - ent.pos.z);
      return { pos, moved, a };
    };
    let best = tryDir(0);
    if (best.moved < step * 0.7) {
      if (!ent.slide || ent.slide.t <= 0) ent.slide = { sign: Math.random() < 0.5 ? 1 : -1, t: 1.2 };
      for (const k of TRIES) {
        const cand = tryDir(k * ent.slide.sign);
        if (cand.moved >= step * 0.7) {
          best = cand;
          break;
        }
        const alt = tryDir(-k * ent.slide.sign);
        if (alt.moved >= step * 0.7) {
          best = alt;
          ent.slide.sign *= -1;
          break;
        }
      }
    }
    if (ent.slide) ent.slide.t -= dt;
    const mx = best.pos.x - ent.pos.x;
    const mz = best.pos.z - ent.pos.z;
    ent.pos.x = best.pos.x;
    ent.pos.z = best.pos.z;
    ent.pos.y = groundY(ent.pos.x, ent.pos.z);
    if (turn && best.moved > 0.0005) face(ent, ent.pos.x + mx, ent.pos.z + mz, dt); // mira hacia donde camina
    return best.moved > 0.0005;
  }

  // ---------- Combate ----------

  function calcDamage(atk, def, mult = 1, critChance = 0.1, critMult = CRIT_MULT) {
    let dmg = atk * mult * (0.85 + Math.random() * 0.3) - def * 0.5;
    const crit = Math.random() < critChance;
    if (crit) dmg *= critMult;
    return { dmg: Math.max(1, Math.round(dmg)), crit };
  }

  // ---------- PvP y PK ----------

  // 0 = blanco, 1 = morado (atacó a alguien hace poco), 2 = rojo (PK con karma)
  const pvpState = (q) => (q.karma > 0 ? 2 : q.flagT > 0 ? 1 : 0);
  const sameParty = (a, b) => !!a.party && a.party === b.party;

  // ¿Puede p atacar a q? Devuelve el motivo si no puede, o null. Sin forzar (Ctrl) solo se puede
  // atacar a jugadores morados o rojos.
  function pvpBlock(p, q, force) {
    if (!q || q === p || q.dead) return 'nada';
    if (inSafe(p.pos) || inSafe(q.pos)) return 'No se puede pelear contra otros jugadores en una zona segura.';
    if (p.level < PVP_MIN_LEVEL) return `Podrás pelear contra otros jugadores desde el nivel ${PVP_MIN_LEVEL}.`;
    if (q.level < PVP_MIN_LEVEL) return `${q.name} está protegido: los aventureros de nivel menor a ${PVP_MIN_LEVEL} no pueden ser atacados.`;
    if (sameParty(p, q)) return 'No puedes atacar a alguien de tu grupo.';
    if (p.guild && p.guild === q.guild) return 'No puedes atacar a alguien de tu gremio.';
    if (!force && pvpState(q) === 0) return `Para atacar a ${q.name} usa «Forzar ataque» en su ficha (o Ctrl + clic). Si lo derrotas te volverás PK.`;
    return null;
  }
  const canHit = (p, q) => !pvpBlock(p, q, p.force && p.target === q);

  // Deja de apuntar a un jugador que cayó o se fue
  function forgetTarget(w, q) {
    for (const o of w.players.values()) {
      if (o.target !== q) continue;
      o.target = null;
      o.autoAttack = false;
      o.queued = null;
      o.force = false;
    }
  }

  // Daño de un jugador a otro (ataques básicos, habilidades y proyectiles)
  function damagePlayer(w, p, q, mult, opts = {}) {
    if (!q || q.dead || q.leap) return;
    const why = pvpBlock(p, q, p.force && p.target === q);
    if (why) {
      if (p.target === q) {
        p.autoAttack = false;
        p.queued = null;
        if ((p.pvpMsgT || 0) <= w.time) {
          p.pvpMsgT = w.time + 2;
          log(w, p, why, 'warn');
        }
      }
      return;
    }
    // Atacar a un jugador que no es PK deja tu nombre morado
    if (q.karma <= 0) {
      if (p.flagT <= 0 && p.karma <= 0) log(w, p, 'Atacaste a otro jugador: tu nombre queda morado durante 30 segundos y cualquiera puede atacarte.', 'warn');
      p.flagT = FLAG_T;
    }
    p.combatT = 6;
    q.combatT = 6;
    if (Math.random() < Math.min(0.6, q.stats.evade + buffSum(q, 'evade'))) return float(w, q, 'Esquiva', 'mana');
    if (q.bubble > 0) {
      q.bubble = 0;
      return float(w, q, 'Burbuja', 'mana');
    }
    const chance = opts.noCrit ? 0 : opts.forceCrit ? 1 : playerCrit(p);
    const r = calcDamage(playerAtk(p), q.stats.def, mult * PVP_DMG, chance, p.stats.critMult);
    let dmg = r.dmg * (1 - Math.min(0.7, buffSum(q, 'dr')));
    if (q.stats.block && Math.random() < q.stats.block) dmg *= 0.5;
    dmg = Math.max(1, Math.round(dmg));
    if (q.shield > 0) {
      const ab = Math.min(q.shield, dmg);
      q.shield -= ab;
      dmg -= ab;
      if (q.shield <= 0) q.shieldT = 0;
      if (ab) float(w, q, `(${ab})`, 'mana');
    }
    if (dmg <= 0) return;
    q.hp -= dmg;
    float(w, q, r.crit ? `¡${dmg}!` : `-${dmg}`, 'hurt');
    if (!q.target) q.target = p; // quien recibe el golpe apunta a su atacante (puede defenderse sin Ctrl)
    if (q.hp <= 0) pvpKill(w, p, q);
  }

  function pvpKill(w, p, q) {
    const state = pvpState(q);
    if (state === 2) {
      log(w, p, `Derrotaste a ${q.name}, que era PK. No ganas karma.`, 'sys');
    } else if (state === 1) {
      p.pvp++;
      log(w, p, `¡Ganaste un combate PvP contra ${q.name}! (PvP: ${p.pvp})`, 'lvl');
    } else {
      p.pk++;
      const add = Math.round(xpToNext(p.level) * KARMA_PCT * Math.min(3, p.pk));
      p.karma += add;
      p.flagT = 0;
      emit(w, { type: 'banner', to: p.id, title: '¡Ahora eres PK!', sub: `Derrotaste a ${q.name}, que no quería pelear. Karma +${add}: tu nombre es rojo.` });
      log(w, p, `Tu nombre es rojo: cualquiera puede atacarte sin Ctrl. Mientras tengas karma, la experiencia de los monstruos solo lo irá bajando.`, 'warn');
    }
    q.flagT = 0;
    killPlayer(w, q, p.name, p);
  }

  // El karma baja con la experiencia de los monstruos (que no se gana mientras se es PK)
  function burnKarma(w, p, xp) {
    const was = p.karma;
    p.karma = Math.max(0, p.karma - xp);
    if (p.karma > 0) log(w, p, `Karma -${was - p.karma} (te quedan ${p.karma}).`, 'sys');
    else log(w, p, 'Tu karma llegó a cero: tu nombre vuelve a ser blanco.', 'lvl');
  }

  function damageMob(w, p, m, mult, opts = {}) {
    if (!m || m.dead) return;
    if (m.kind === 'player') return damagePlayer(w, p, m, mult, opts);
    if (m.def.mech && m.def.mech.type === 'plates' && !(m.shieldDownT > 0)) {
      if (!m.aggro || m.aggro.dead) m.aggro = p;
      if ((m.shieldMsgT || 0) <= w.time) {
        m.shieldMsgT = w.time + 1.2;
        float(w, m, 'Escudo', 'mana', 0.3);
      }
      if ((p.plateHintT || 0) <= w.time) {
        p.plateHintT = w.time + 15;
        log(w, p, '¡El Mega-Autómata tiene un escudo! Pisen a la vez los 3 botones de la Fábrica para apagarlo.', 'warn');
      }
      return;
    }
    let critMult = p.stats.critMult;
    // Ojo del Sol: el crítico pega más cuanto más lejos está el objetivo
    if (p.passive.farCrit) critMult += p.passive.farCrit * Math.min(1, d2(p.pos, m.pos) / p.stats.range);
    const chance = opts.noCrit ? 0 : opts.forceCrit ? 1 : playerCrit(p);
    const r = calcDamage(playerAtk(p), m.armor, mult * (m.markT > 0 ? 1 + m.markPct : 1), chance, critMult);
    m.hp -= r.dmg;
    p.combatT = 6;
    m.hitBy.add(p.id);
    float(w, m, r.crit ? `¡${r.dmg}!` : `${r.dmg}`, opts.cls || (r.crit ? 'crit' : 'dmg'));
    // La polimorfia se rompe al recibir daño
    if (m.polyT > 0) {
      m.polyT = 0;
      m.stunT = 0;
    }
    // Si estaba volviendo a su sitio y lo atacan, vuelve a pelear (sin haberse curado)
    if (m.state === 'return') m.state = 'idle';
    if (!m.aggro || m.aggro.dead) m.aggro = opts.aggroTo || p;
    if (m.hp <= 0) killMob(w, p, m);
  }

  // Jugadores que reciben experiencia, botín y progreso de misión por una muerte:
  // el que la causó y su grupo vivo cercano
  function creditedFor(w, killer, m) {
    const party = killer.party ? w.parties.get(killer.party) : null;
    const members = party ? party.members.map((id) => w.players.get(id)).filter((q) => q && !q.dead && d2(q.pos, m.pos) <= PARTY_R) : [killer];
    if (!members.includes(killer)) members.push(killer);
    return members;
  }

  // Reparte la experiencia entre el grupo cercano: más miembros, más bonificación
  function shareXp(w, killer, m, xp, members) {
    const bonus = 1 + 0.1 * (members.length - 1);
    const levels = members.reduce((a, q) => a + q.level, 0);
    for (const q of members) {
      const diff = m.lvl - q.level;
      let share = (xp * bonus * q.level) / levels;
      if (diff <= -6) share *= 0.1;
      else if (diff <= -4) share *= 0.4;
      else if (diff >= 3) share *= 1.2;
      share = Math.max(1, Math.round(share));
      q.lastXp = share;
      if (q.karma > 0) {
        q.lastXp = 0;
        burnKarma(w, q, share);
      } else gainXp(w, q, share);
    }
  }

  function killMob(w, p, m) {
    m.hp = 0;
    m.dead = true;
    m.aggro = null;
    m.dots = [];
    m.respawnTime = m.def.respawn || 22;
    m.deadT = m.respawnTime;
    emit(w, { type: 'mobDeath', ent: m });
    for (const pl of w.players.values()) {
      if (pl.target === m) {
        pl.target = null;
        pl.autoAttack = false;
        pl.queued = null;
      }
    }
    const members = creditedFor(w, p, m);
    shareXp(w, p, m, m.xp, members);
    // Botín personal: cada miembro tira su propio botín (adaptado a su raza) y su oro
    for (const q of members) {
      const gold = randInt(m.gold[0], m.gold[1]);
      q.gold += gold;
      log(w, q, `${m.def.name} ha caído. +${q.lastXp || 0} XP · +${gold} oro`, 'sys');
      if (q === p) float(w, m, `+${q.lastXp || 0} XP`, 'xp', 0.6);
      for (const [raw, chance, range] of m.def.drops) {
        if (Math.random() >= chance) continue;
        const id = resolveDrop(raw, q.cls);
        const qty = range ? randInt(range[0], range[1]) : 1;
        dropBag(w, q, m.pos, id, qty);
      }
      questProgress(w, q, m);
      emit(w, { type: 'inventory', to: q.id });
    }
    if (m.def.boss) emit(w, { type: 'banner', to: null, title: `${m.def.name} ha sido derrotado`, sub: `Vuelve a aparecer en ${Math.round(m.respawnTime / 60)} minutos` });
    fire(w, 'mob:killed', { killer: p, mob: m, members });
    if (m.def.boss) fire(w, 'boss:defeated', { killer: p, mob: m, members });
  }

  // ---------- Botín en el suelo y mascotas ----------

  function dropBag(w, q, at, item, qty) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.6 + Math.random() * 1.2;
    const pos = { x: at.x + Math.cos(a) * r, y: 0, z: at.z + Math.sin(a) * r };
    collide(pos, 0.3);
    pos.y = Math.max(heightAt(pos.x, pos.z), WATER_Y);
    w.loot.push({ id: `b${w.nextId++}`, owner: q.id, item, qty, pos, t: LOOT_LIFE, fetching: false });
  }

  // Recoger una bolsa: devuelve false si no cabe en el inventario
  function collectBag(w, p, bag, verb) {
    if (!addItem(p, bag.item, bag.qty)) {
      if (!bag.warned) log(w, p, 'Tu inventario está lleno: el botín te espera en el suelo.', 'warn');
      bag.warned = true;
      bag.fetching = false;
      return false;
    }
    const i = w.loot.indexOf(bag);
    if (i >= 0) w.loot.splice(i, 1);
    fire(w, 'item:gained', { p, id: bag.item, qty: bag.qty });
    emit(w, { type: 'loot', to: p.id, id: bag.item, qty: bag.qty, verb });
    emit(w, { type: 'inventory', to: p.id });
    return true;
  }

  function updateLoot(w, dt) {
    for (let i = w.loot.length - 1; i >= 0; i--) {
      const bag = w.loot[i];
      const p = w.players.get(bag.owner);
      if (!p) {
        w.loot.splice(i, 1);
        continue;
      }
      bag.t -= dt;
      if (bag.fetching) continue;
      const d = d2(p.pos, bag.pos);
      if (!p.dead && d <= PICK_R) collectBag(w, p, bag, 'Recoges');
      else if (!p.dead && p.pet && d <= PET_FETCH_R) {
        // La mascota corre a buscarlo y lo trae
        bag.fetching = true;
        emit(w, { type: 'petFetch', ent: p, at: { ...bag.pos }, bag: bag.id });
        later(w, 0.35 + d / 14, () => {
          if (w.loot.includes(bag) && w.players.has(p.id)) collectBag(w, p, bag, `${petName(p.pet.type)} te trae`);
        });
      } else if (bag.t <= 0) collectBag(w, p, bag, 'Llega a tu mochila');
    }
  }

  // Al salir del juego, el botín pendiente pasa a la mochila
  function collectAllLoot(w, p) {
    for (const bag of w.loot.filter((b) => b.owner === p.id)) addItem(p, bag.item, bag.qty);
    w.loot = w.loot.filter((b) => b.owner !== p.id);
  }

  function hatchPet(w, p, type) {
    if (p.pet) return log(w, p, 'Ya tienes una mascota.', 'warn');
    if (!isPet(type)) return;
    const i = p.inv.findIndex((x) => x.id === 'huevo_mascota');
    if (i < 0) return log(w, p, 'Necesitas un Huevo de Mascota.', 'warn');
    removeAt(p, i, 1);
    p.pet = { type };
    emit(w, { type: 'banner', to: p.id, title: `¡Nació tu ${PETS[type].name}!`, sub: 'Te seguirá y recogerá el botín por ti' });
    emit(w, { type: 'petHatch', ent: p });
    log(w, p, `${PETS[type].name}: ${PETS[type].desc}`, 'lvl');
    emit(w, { type: 'inventory', to: p.id });
  }

  // Montar o bajar (tecla 0). Atacar o usar una habilidad te baja.
  function toggleMount(w, p) {
    if (p.dead) return;
    if (p.mounted) return dismount(w, p);
    const kind = mountKind(p);
    if (!p.pet) return log(w, p, 'Primero necesitas una mascota (Huevo de Mascota, nivel 5).', 'warn');
    if (!kind) return log(w, p, `Tu mascota podrá llevarte desde el nivel ${MOUNT_LVL}.`, 'warn');
    if (p.combatT > 0) return log(w, p, 'No puedes montar en pleno combate.', 'warn');
    if (p.swimming && kind < 2) return log(w, p, 'No puedes montar en el agua.', 'warn');
    p.mounted = kind;
    p.autoAttack = false;
    p.queued = null;
    emit(w, { type: 'mount', ent: p, on: kind });
    log(w, p, `Montas a ${petName(p.pet.type, kind)}: +${Math.round(MOUNT_SPEED[kind] * 100)}% de velocidad${kind === 2 ? ' y planeas sobre el agua' : ''}.`, 'sys');
  }
  function dismount(w, p) {
    if (!p.mounted) return;
    p.mounted = 0;
    emit(w, { type: 'mount', ent: p, on: 0 });
  }

  function mobHitsPlayer(w, m, p) {
    if (p.kind === 'summon') return hitSummon(w, m, p);
    if (p.dead || p.leap) return;
    // Esquivar (armadura ligera, Paso Veloz)
    if (Math.random() < Math.min(0.6, p.stats.evade + buffSum(p, 'evade'))) {
      float(w, p, 'Esquiva', 'mana');
      return;
    }
    // Burbuja Estelar: bloquea el golpe entero
    if (p.bubble > 0) {
      p.bubble = 0;
      float(w, p, 'Burbuja', 'mana');
      emit(w, { type: 'ring', pos: { ...p.pos }, color: 0xbfe6ff, r: 1.6, life: 0.4 });
      return;
    }
    const r = calcDamage(m.atk, p.stats.def, 1, 0.05);
    let dmg = r.dmg * (1 - Math.min(0.7, buffSum(p, 'dr')));
    if (p.stats.block && Math.random() < p.stats.block) {
      dmg *= 0.5;
      float(w, p, 'Bloqueo', 'mana', 0.3);
    }
    dmg = Math.max(1, Math.round(dmg));
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg -= absorbed;
      if (p.shield <= 0) p.shieldT = 0;
      if (absorbed) float(w, p, `(${absorbed})`, 'mana');
    }
    p.combatT = 6;
    // Escudo de Brasas / Fortaleza Maestra: devuelve daño a quien golpea
    const thorns = buffSum(p, 'thorns');
    if (thorns > 0) damageMob(w, p, m, thorns, { noCrit: true, cls: 'burn' });
    if (dmg <= 0) return;
    p.hp -= dmg;
    float(w, p, `-${dmg}`, 'hurt');
    if (!p.target) p.target = m;
    if (p.hp <= 0) return killPlayer(w, p, m.def.name);
    applyOnHit(w, m, p);
  }

  // Estados que causan algunos monstruos al golpear: veneno, quemadura y lentitud
  function applyOnHit(w, m, p) {
    const o = m.def.onHit;
    if (!o || Math.random() >= o.chance) return;
    if (o.poison) {
      p.debuffs.poison = { t: o.poison.dur, perSec: m.atk * o.poison.pct, tick: 1, src: m.def.name };
      float(w, p, 'Envenenado', 'poison', 0.3);
    }
    if (o.burn) {
      p.debuffs.burn = { t: o.burn.dur, perSec: m.atk * o.burn.pct, tick: 1, src: m.def.name };
      float(w, p, 'Quemado', 'burn', 0.3);
    }
    if (o.slow && !Object.values(p.buffs).some((b) => b.ccImmune)) {
      p.debuffs.slow = { t: o.slow };
      float(w, p, 'Lento', 'stun', 0.5);
    }
  }

  function updateDebuffs(w, p, dt) {
    for (const k in p.debuffs) {
      const d = p.debuffs[k];
      d.t -= dt;
      if (d.perSec && (d.tick -= dt) <= 0) {
        d.tick += 1;
        const dmg = Math.max(1, Math.round(d.perSec));
        p.hp -= dmg;
        float(w, p, `-${dmg}`, k === 'burn' ? 'burn' : 'poison');
        if (p.hp <= 0) return killPlayer(w, p, d.src || 'el veneno');
      }
      if (d.t <= 0) delete p.debuffs[k];
    }
  }

  // ---------- Invocaciones: torretas, Mecha-Gólem y clones de viento ----------

  function spawnSummon(w, p, type, o) {
    const su = {
      id: `s${w.nextId++}`,
      kind: 'summon',
      type,
      owner: p,
      pos: { x: o.at.x, y: groundY(o.at.x, o.at.z), z: o.at.z },
      facing: p.facing,
      height: type === 'mecha' ? 4.2 : type === 'turret' ? 1.8 : 2.5,
      def: { scale: type === 'mecha' ? 1.6 : 1, name: o.name },
      maxHp: Math.round(p.stats.maxHp * (type === 'mecha' ? 1.5 : 0.5)),
      armor: p.stats.def * 1.5,
      dead: false,
      moving: false,
      life: o.dur,
      every: o.every || 1,
      atkT: o.every || 1,
      mult: o.mult || 0,
      reach: o.reach || 12,
      ride: !!o.ride,
      side: o.side || 0,
      taunt: !!o.taunt,
      slide: null,
    };
    su.hp = su.maxHp;
    w.summons.push(su);
    return su;
  }

  const aggroAlive = (w, a) => (a.kind === 'summon' ? !a.dead && w.summons.includes(a) : !a.dead && w.players.has(a.id));

  function hitSummon(w, m, su) {
    if (su.dead) return;
    const r = calcDamage(m.atk, su.armor, 1, 0.05);
    su.hp -= r.dmg;
    float(w, su, `-${r.dmg}`, 'hurt');
    if (su.hp <= 0) killSummon(w, su);
  }

  function killSummon(w, su) {
    if (su.dead) return;
    su.dead = true;
    if (su.type === 'mecha') ring(w, su.pos, 0xff9a4a, 3, 0.6);
    // Los monstruos que lo atacaban vuelven contra su dueño
    for (const m of w.mobs) if (m.aggro === su) m.aggro = w.players.has(su.owner.id) && !su.owner.dead ? su.owner : null;
  }

  function nearestMob(w, at, r) {
    let best = null;
    let bd = r;
    for (const m of w.mobs) {
      if (m.dead) continue;
      const d = d2(m.pos, at);
      if (d <= bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  // Láser en línea recta desde un punto (Mecha-Gólem Pilotado)
  function laser(w, p, from, target, length, mult) {
    const dx = target.pos.x - from.x;
    const dz = target.pos.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const dir = { x: dx / len, z: dz / len };
    emit(w, { type: 'beam', at: { ...from }, from: { x: from.x, y: from.y + 3.2, z: from.z }, to: { x: from.x + dir.x * length, y: from.y + 1.2, z: from.z + dir.z * length }, w: 0.7, color: 0xff5a5a });
    for (const m of w.mobs) {
      if (m.dead) continue;
      const ox = m.pos.x - from.x;
      const oz = m.pos.z - from.z;
      const along = ox * dir.x + oz * dir.z;
      if (along < 0 || along > length || Math.abs(ox * dir.z - oz * dir.x) > 1.2 + bodyR(m)) continue;
      damageMob(w, p, m, mult);
    }
  }

  function updateSummons(w, dt) {
    for (let i = w.summons.length - 1; i >= 0; i--) {
      const su = w.summons[i];
      const p = su.owner;
      if (!su.dead && (!w.players.has(p.id) || p.dead || (su.life -= dt) <= 0)) killSummon(w, su);
      if (su.dead) {
        w.summons.splice(i, 1);
        continue;
      }
      su.moving = false;
      su.atkT -= dt;
      if (su.type === 'turret') {
        if (su.atkT <= 0) {
          su.atkT = su.every;
          const m = nearestMob(w, su.pos, su.reach);
          if (m) spawnProjectile(w, p, 'arcane', m, su.mult, { from: { x: su.pos.x, y: su.pos.y + 1.6, z: su.pos.z } });
        }
      } else if (su.type === 'clone') {
        // Clon de viento: gira al lado de su dueño
        const a = p.facing + (su.side * Math.PI) / 2;
        su.pos.x = p.pos.x + Math.sin(a) * 1.8;
        su.pos.z = p.pos.z + Math.cos(a) * 1.8;
        su.pos.y = groundY(su.pos.x, su.pos.z);
        su.facing += dt * 14;
        su.moving = true;
      } else if (su.ride) {
        // Mecha pilotado: va con el jugador y dispara láseres
        su.pos.x = p.pos.x;
        su.pos.y = p.pos.y;
        su.pos.z = p.pos.z;
        su.facing = p.facing;
        su.moving = p.moving;
        if (su.atkT <= 0) {
          const t = p.target && p.target.kind === 'mob' && !p.target.dead && d2(p.target.pos, p.pos) <= su.reach ? p.target : nearestMob(w, p.pos, su.reach);
          if (t) {
            su.atkT = su.every;
            laser(w, p, su.pos, t, su.reach, su.mult);
          }
        }
      } else {
        // Mecha-Gólem: atrae a los monstruos cercanos, camina hacia ellos y golpea
        su.tauntT = (su.tauntT || 0) - dt;
        if (su.tauntT <= 0) {
          su.tauntT = 1;
          for (const m of w.mobs) if (!m.dead && m.state !== 'return' && d2(m.pos, su.pos) <= 9) m.aggro = su;
        }
        const t = nearestMob(w, su.pos, 16);
        if (t) {
          const reach = 2.2 + bodyR(t);
          if (d2(su.pos, t.pos) > reach) su.moving = stepToward(su, t.pos, 6, dt, reach * 0.9);
          else {
            face(su, t.pos.x, t.pos.z, dt);
            if (su.atkT <= 0) {
              su.atkT = su.every;
              emit(w, { type: 'swing', ent: su });
              ring(w, t.pos, 0xff9a4a, 2, 0.4);
              damageMob(w, p, t, su.mult, { aggroTo: su });
            }
          }
        } else if (d2(su.pos, p.pos) > 3.5) su.moving = stepToward(su, p.pos, 7, dt, 3);
      }
    }
  }

  function killPlayer(w, p, cause, by = null) {
    p.hp = 0;
    p.flagT = 0;
    p.force = false;
    p.dead = true;
    p.mounted = 0;
    p.autoAttack = false;
    p.queued = null;
    p.moveTarget = null;
    p.shield = 0;
    p.bubble = 0;
    p.buffs = {};
    p.debuffs = {};
    p.target = null;
    p.leap = null;
    p.diedAt = { x: p.pos.x, z: p.pos.z };
    for (const mob of w.mobs) if (mob.aggro === p) dropAggro(mob);
    forgetTarget(w, p);
    fire(w, 'player:died', { p, by, cause });
    log(w, p, cause === 'agua' ? 'Te has mareado en el agua.' : by ? `${cause} te ha derrotado. No pierdes nada: descansa y vuelve.` : `Te has mareado ante ${cause}. No pierdes nada: descansa y vuelve.`, 'warn');
    emit(w, { type: 'playerDeath', to: p.id, ent: p });
  }

  // Punto seguro cercano: en el camino entre la aldea y la zona donde caíste (fuera de ella)
  function safePointNear(pos) {
    const z = pos && zoneAt(pos);
    if (!z || z.safe) return { x: SPAWN.x, z: SPAWN.z };
    const dist = Math.hypot(z.x, z.z);
    const k = Math.max(0, dist - z.r - 7) / dist;
    const pt = { x: z.x * k, z: z.z * k };
    collide(pt, PLAYER_R);
    return waterDepth(pt.x, pt.z) > SWIM_DEPTH ? { x: SPAWN.x, z: SPAWN.z } : pt;
  }

  function revivePlayer(w, p, at, pct) {
    p.dead = false;
    p.pos.x = at.x + rand(-1.2, 1.2);
    p.pos.z = at.z + rand(-1, 1);
    collide(p.pos, PLAYER_R);
    p.pos.y = groundY(p.pos.x, p.pos.z);
    p.hp = Math.round(p.stats.maxHp * pct);
    p.mp = Math.max(p.mp, Math.round(p.stats.maxMp * pct));
    p.breath = BREATH_MAX;
    emit(w, { type: 'playerRespawn', to: p.id, ent: p });
  }

  // Sin castigo: no se pierde experiencia ni objetos al caer
  function respawn(w, p) {
    if (!p.dead) return;
    const at = safePointNear(p.diedAt);
    revivePlayer(w, p, at, 0.7);
    fire(w, 'player:respawn', { p });
    log(w, p, at.x === SPAWN.x && at.z === SPAWN.z ? 'Despiertas en la aldea, sano y salvo.' : 'Despiertas en un lugar seguro, cerca de donde estabas.', 'sys');
  }

  function gainXp(w, p, xp) {
    if (p.level >= MAX_LEVEL) return;
    p.xp += xp;
    let up = false;
    while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      const before = p.skills.map((sk) => Data.skillLevel(p, sk));
      p.level++;
      // Habilidades que subieron de nivel con este nivel del personaje
      p.skills.forEach((sk, i) => {
        const now = Data.skillLevel(p, sk);
        if (now > before[i] && before[i] > 0) log(w, p, `¡${sk.name} sube a Nv ${now}! Ahora es más fuerte.`, 'lvl');
      });
      up = true;
      recalcStats(w, p);
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      const st = STAGES.find((s) => s.lvl === p.level && s.stage > p.stage);
      const grade = Object.values(GRADES).find((g) => g.lvl === p.level && g.stage <= p.stage);
      const sub = st ? `Habla con el Maestro de Clase: ¡ya puedes hacer el ${st.name}!` : grade ? `Ya puedes usar equipo de grado ${grade.name}` : 'Tus fuerzas aumentan';
      emit(w, { type: 'banner', to: p.id, title: `Nivel ${p.level}`, sub });
      log(w, p, `Has alcanzado el nivel ${p.level}.`, 'lvl');
      if (st) log(w, p, `Nuevo cambio de clase disponible: ${st.name}. Ve con el Maestro Aldric en la aldea.`, 'lvl');
      if (p.level === PET_LVL && !p.pet && !p.inv.some((x) => x.id === 'huevo_mascota') && addItem(p, 'huevo_mascota', 1)) {
        emit(w, { type: 'banner', to: p.id, title: '¡Recibiste un Huevo de Mascota!', sub: 'Úsalo desde tu inventario para que nazca' });
        emit(w, { type: 'loot', to: p.id, id: 'huevo_mascota', qty: 1, verb: 'Recibes' });
      }
      if (p.level === MOUNT_LVL && p.pet) log(w, p, `¡Tu ${PETS[p.pet.type].name} creció y ahora es un ${PETS[p.pet.type].mount}! Pulsa 0 para montarlo.`, 'lvl');
    }
    if (up) {
      fire(w, 'player:levelUp', { p, level: p.level });
      syncMember(w, p);
      emit(w, { type: 'levelUp', ent: p, level: p.level }); // columna de luz visible para todos
      emit(w, { type: 'inventory', to: p.id });
    }
    if (p.level >= MAX_LEVEL) p.xp = 0;
  }

  // ---------- Cambios de clase (Maestro de Clase) ----------

  function questProgress(w, p, m) {
    const q = p.quest;
    if (!q) return;
    const def = questFor(q.stage);
    if (!def || q.kills >= def.need) return;
    const counts = def.boss ? m.key === def.boss : m.lvl >= def.minLvl;
    if (!counts) return;
    q.kills++;
    if (q.kills >= def.need) {
      emit(w, { type: 'banner', to: p.id, title: '¡Misión cumplida!', sub: 'Vuelve con el Maestro Aldric en la aldea' });
      log(w, p, `${def.title}: ¡completada! Vuelve con el Maestro Aldric.`, 'lvl');
    } else if (q.kills % 3 === 0 || def.need - q.kills <= 2) {
      log(w, p, `${def.title}: ${q.kills}/${def.need}`, 'quest');
    }
    emit(w, { type: 'quest', to: p.id });
  }

  const nearMaster = (p) => NPCS.some((n) => n.role === 'master' && d2(p.pos, n) < MASTER_R);

  // action: 'accept' (branch: 'a' | 'b' en el nivel 25), 'complete' o 'abandon'
  function classQuest(w, p, action, branch) {
    if (p.dead) return;
    if (!nearMaster(p)) return log(w, p, 'Acércate al Maestro Aldric para hablar de tu clase.', 'warn');
    const next = p.stage + 1;
    const st = STAGES[next];
    if (action === 'abandon') {
      if (!p.quest) return;
      p.quest = null;
      log(w, p, 'Aldric: «Vuelve cuando estés listo.»', 'npc');
      return emit(w, { type: 'quest', to: p.id });
    }
    if (action === 'accept') {
      if (!st) return log(w, p, 'Aldric: «Ya alcanzaste la maestría. No hay nada más que pueda enseñarte.»', 'npc');
      if (p.quest) return log(w, p, 'Ya tienes una misión de cambio de clase en curso.', 'warn');
      if (p.level < st.lvl) return log(w, p, `Aldric: «Vuelve cuando seas nivel ${st.lvl}.»`, 'npc');
      if (st.branch && branch !== 'a' && branch !== 'b') return log(w, p, 'Primero elige tu especialización.', 'warn');
      const def = questFor(next);
      p.quest = { stage: next, kills: 0, branch: st.branch ? branch : null };
      const bname = st.branch ? ` como ${p.cdef.branches[branch].name}` : '';
      log(w, p, `Aldric: «${def.title}${bname}. ${def.text}»`, 'npc');
      emit(w, { type: 'banner', to: p.id, title: def.title, sub: def.text });
      return emit(w, { type: 'quest', to: p.id });
    }
    if (action === 'complete') {
      const q = p.quest;
      const def = q && questFor(q.stage);
      if (!def || q.stage !== next) return log(w, p, 'No tienes ninguna misión de cambio de clase.', 'warn');
      if (q.kills < def.need) return log(w, p, `Aún te falta: ${q.kills}/${def.need}. ${def.text}`, 'warn');
      p.stage = q.stage;
      if (q.branch) p.branch = q.branch;
      p.quest = null;
      fire(w, 'quest:done', { p, stage: p.stage, members: creditedFor(w, p, p) });
      refreshKit(p);
      recalcStats(w, p);
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      const title = className(p.cls, p.sex, p.stage, p.branch);
      // Regalo del gremio: un arma del grado que se acaba de desbloquear
      const gift = weaponFor(p.cls, ['madera', 'azul', 'dorado', 'arcoiris'][p.stage]);
      if (gift && addItem(p, gift, 1)) emit(w, { type: 'loot', to: p.id, id: gift, qty: 1, verb: 'El gremio te regala' });
      emit(w, { type: 'banner', to: p.id, title: `¡Ahora eres ${title}!`, sub: STAGES[p.stage].unlocks });
      if (p.stage === 3 && p.pet && mountKind(p) === 2) log(w, p, `¡Tu ${PETS[p.pet.type].glider} puede planear! Con él cruzas el agua sin nadar. Además brilla tu Aura de Héroe.`, 'lvl');
      if (p.mounted) p.mounted = mountKind(p);
      emit(w, { type: 'classChange', ent: p, stage: p.stage, branch: p.branch });
      emit(w, { type: 'levelUp', ent: p, level: p.level });
      log(w, p, `Has completado el ${STAGES[p.stage].name}: ahora eres ${title}.`, 'lvl');
      emit(w, { type: 'inventory', to: p.id });
      emit(w, { type: 'quest', to: p.id });
    }
  }

  // ---------- Gemas de Poder ----------

  // Gasta una gema si están activas: devuelve el multiplicador de daño (1 o 1,25)
  function useGem(w, p) {
    if (!p.gemsOn) return 1;
    const i = p.inv.findIndex((x) => x.id === 'gema_poder');
    if (i < 0) {
      p.gemsOn = false;
      log(w, p, 'Te quedaste sin Gemas de Poder. Cómpralas al Mercader Orlen o consíguelas cazando.', 'warn');
      emit(w, { type: 'inventory', to: p.id });
      return 1;
    }
    removeAt(p, i, 1);
    emit(w, { type: 'inventory', to: p.id });
    return GEM_MULT;
  }

  function setGems(w, p, on) {
    if (on && countItem(p, 'gema_poder') <= 0) return log(w, p, 'No tienes Gemas de Poder.', 'warn');
    p.gemsOn = !!on;
    log(w, p, on ? 'Gemas de Poder activadas: +25% de daño (gasta una por ataque).' : 'Gemas de Poder desactivadas.', 'sys');
  }

  // ---------- Comandos del jugador ----------

  function setTarget(w, p, m) {
    if (m === p) m = null;
    if (p.target !== m) p.force = false;
    p.target = m && !m.dead ? m : null;
    if (!p.target) {
      p.autoAttack = false;
      p.queued = null;
    }
  }

  // Revisa si se puede atacar al jugador elegido; "force" = Ctrl pulsado (ataque forzado)
  function pvpReady(w, p, force) {
    const t = p.target;
    if (!t || t.kind !== 'player') return true;
    if (force) p.force = true;
    const why = pvpBlock(p, t, p.force);
    if (why) {
      p.autoAttack = false;
      p.queued = null;
      log(w, p, why, 'warn');
      return false;
    }
    return true;
  }

  function attack(w, p, force = false) {
    if (p.dead || !p.target || p.target.dead) return;
    if (!pvpReady(w, p, force)) return;
    dismount(w, p);
    p.autoAttack = true;
    p.moveTarget = null;
    p.interact = null;
  }

  function targetNearest(w, p) {
    const list = w.mobs.filter((m) => !m.dead && d2(m.pos, p.pos) < 26).sort((a, b) => d2(a.pos, p.pos) - d2(b.pos, p.pos));
    if (!list.length) return null;
    const i = list.indexOf(p.target);
    setTarget(w, p, list[(i + 1) % list.length]);
    return p.target;
  }

  function moveTo(w, p, point, interact = null) {
    if (p.dead || p.leap) return;
    p.moveTarget = { x: point.x, z: point.z };
    p.autoAttack = false;
    p.queued = null;
    p.interact = interact;
    p.slide = null;
    p.mtBest = undefined;
    p.mtStall = 0;
  }

  // Dirección de caminar con teclado o joystick (ya en coordenadas del mundo) o null.
  function setMoveDir(w, p, dir) {
    p.moveDir = dir && (dir.x || dir.z) ? dir : null;
  }

  // ---------- NPCs ----------

  const npcById = (id) => NPCS.find((n) => n.id === id);

  function talkTo(w, p, id) {
    const npc = npcById(id);
    if (!npc || p.dead) return;
    if (d2(p.pos, npc) < TALK_R) {
      p.moveTarget = null;
      face(p, npc.x, npc.z, 1);
      interactWith(w, p, npc);
    } else {
      const dx = p.pos.x - npc.x;
      const dz = p.pos.z - npc.z;
      const len = Math.hypot(dx, dz) || 1;
      moveTo(w, p, { x: npc.x + (dx / len) * 2.6, z: npc.z + (dz / len) * 2.6 }, id);
    }
  }

  const TIPS = {
    oso: 'Usa el Rugido Protector para que los monstruos te ataquen a ti y no a tus amigos.',
    elfo: 'Marca al enemigo con tu halcón y dispara desde lejos. Si te alcanzan, ¡Salto de Copa!',
    gnomo: 'Pon una Torreta de Chispas antes de pelear y convierte en oveja al enemigo más peligroso.',
    hada: 'Quédate detrás de tus amigos y cúralos con la Canción de Corazones.',
    lagarto: 'Quema a los enemigos con el Aliento de Chispa y remata con Corte Cruzado: ¡críticos seguros!',
  };

  // Zona recomendada para un nivel
  function zoneFor(level) {
    const field = ZONES.filter((z) => !z.safe);
    return (
      field.find((z) => {
        const [a, b] = z.lvl.split(' ')[0].split('–').map((v) => parseInt(v, 10));
        return level >= a - 1 && level <= (b || 99);
      }) || field[field.length - 1]
    );
  }

  function interactWith(w, p, npc) {
    const first = npc.name.split(' ').pop();
    if (npc.role === 'shop') {
      emit(w, { type: 'openShop', to: p.id, shop: npc.shop });
      const line = npc.shop === 'herrero' ? '«Tráeme Polvo de Arcoíris y forjaré tu equipo celestial.»' : '«Pociones, gemas y equipo para tu raza. ¿Qué necesitas?»';
      return log(w, p, `${first}: ${line}`, 'npc');
    }
    if (npc.role === 'heal') {
      if (p.combatT > 0) return log(w, p, `${first}: «Primero aléjate del peligro, viajero.»`, 'npc');
      const full = p.hp >= p.stats.maxHp && p.mp >= p.stats.maxMp;
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      p.debuffs = {};
      ring(w, p.pos, 0x7fe0b0, 3, 0.9);
      return log(w, p, full ? `${first}: «Tu luz ya está completa. Ve con cuidado.»` : `${first}: «Que la luz cierre tus heridas.» Vida y maná restaurados.`, 'npc');
    }
    if (npc.role === 'master') {
      emit(w, { type: 'openMaster', to: p.id });
      const st = STAGES[p.stage + 1];
      if (p.quest) return log(w, p, `${first}: «¿Cómo va tu misión?»`, 'npc');
      if (st && p.level >= st.lvl) return log(w, p, `${first}: «Estás listo para el ${st.name}.»`, 'npc');
      return log(w, p, st ? `${first}: «Vuelve en el nivel ${st.lvl} para el ${st.name}.»` : `${first}: «Eres un verdadero maestro.»`, 'npc');
    }
    if (npc.role === 'guide') {
      const rec = zoneFor(p.level);
      return log(w, p, `${first}: «A tu nivel te recomiendo ${rec.name} (nivel ${rec.lvl}). ${TIPS[p.cls]} Cazar en grupo da más experiencia.»`, 'npc');
    }
    if (npc.role === 'travel') {
      if (npc.minLvl && p.level < npc.minLvl) return log(w, p, `${npc.name}: necesitas nivel ${npc.minLvl}.`, 'warn');
      if (p.combatT > 0) return log(w, p, 'No puedes viajar en pleno combate.', 'warn');
      const to = npcById(npc.to);
      // Aparece un poco al lado del destino, hacia el centro de su zona
      const z = zoneAt(to) || ZONES[0];
      const dx = z.x - to.x;
      const dz = z.z - to.z;
      const len = Math.hypot(dx, dz) || 1;
      p.pos.x = to.x + (dx / len) * 3;
      p.pos.z = to.z + (dz / len) * 3;
      collide(p.pos, PLAYER_R);
      p.pos.y = groundY(p.pos.x, p.pos.z);
      p.moveTarget = null;
      p.autoAttack = false;
      p.target = null;
      for (const m of w.mobs) if (m.aggro === p) dropAggro(m);
      emit(w, { type: 'teleport', to: p.id, ent: p, title: zoneAt(p.pos) ? zoneAt(p.pos).name : to.name });
      return log(w, p, npc.prop === 'cart' ? '¡La vagoneta corre por las vías!' : 'Cruzas el portal entre destellos.', 'sys');
    }
    if (npc.role === 'guild') {
      emit(w, { type: 'openGuild', to: p.id, found: true });
      if (p.guild) return log(w, p, `${first}: «Larga vida a ${guildOf(w, p).name}. Invita a tus amigos con la tecla G.»`, 'npc');
      return log(w, p, `${first}: «¿Quieres fundar un gremio? Necesitas nivel ${GUILD_LVL} y ${GUILD_COST.toLocaleString('es')} de oro.»`, 'npc');
    }
    if (npc.role === 'info') return log(w, p, `${npc.name}: «${npc.text}»`, 'npc');
  }

  // ---------- Gremios ----------
  // Se guardan aparte de los personajes (el servidor los escribe en disco cuando w.guildsDirty).
  // Cada miembro se identifica por su nombre (único en el servidor), así se ven también los
  // desconectados. Rangos: 0 Miembro · 1 Oficial (puede invitar y expulsar) · 2 Líder.

  const keyOf = (name) => String(name || '').toLowerCase();
  const guildOf = (w, p) => (p && p.guild ? w.guilds.get(p.guild) || null : null);
  const memberIn = (g, p) => (g ? g.members.find((m) => m.key === keyOf(p.name)) || null : null);
  const onlineByKey = (w, key) => [...w.players.values()].find((q) => keyOf(q.name) === key) || null;
  const guildName = (s) =>
    String(s || '')
      .replace(/[\u0000-\u001f<>"'`\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 18);

  function guildChanged(w, g) {
    g.ver = (g.ver || 0) + 1;
    w.guildsDirty = true;
  }
  const guildLog = (w, g, text, cls = 'sys', except = null) => {
    for (const m of g.members) {
      const q = onlineByKey(w, m.key);
      if (q && q !== except) log(w, q, text, cls);
    }
  };

  // Al entrar: busca su gremio por nombre y actualiza su ficha (nivel, raza)
  function attachGuild(w, p) {
    p.guild = null;
    p.guildInvite = null;
    for (const g of w.guilds.values()) {
      const m = memberIn(g, p);
      if (!m) continue;
      p.guild = g.id;
      m.name = p.name;
      m.cls = p.cls;
      m.sex = p.sex;
      m.level = p.level;
      g.ver = (g.ver || 0) + 1;
      return;
    }
  }
  function syncMember(w, p) {
    const g = guildOf(w, p);
    const m = memberIn(g, p);
    if (!m) return;
    m.level = p.level;
    guildChanged(w, g);
  }

  // Fundar un gremio junto al Maestro del Gremio. check(name) = filtro de palabras del servidor
  function guildCreate(w, p, rawName, emblem, color, check = null) {
    if (p.dead) return;
    if (p.guild) return log(w, p, 'Ya perteneces a un gremio.', 'warn');
    const master = npcById('gremio');
    if (!master || d2(p.pos, master) > TALK_R + 3) return log(w, p, 'Los gremios se fundan con el Maestro del Gremio, en la Ciudadela.', 'warn');
    if (p.level < GUILD_LVL) return log(w, p, `Necesitas nivel ${GUILD_LVL} para fundar un gremio.`, 'warn');
    if (p.gold < GUILD_COST) return log(w, p, `Fundar un gremio cuesta ${GUILD_COST.toLocaleString('es')} de oro.`, 'warn');
    const name = guildName(rawName);
    if (name.length < 3) return log(w, p, 'El nombre del gremio debe tener al menos 3 letras.', 'warn');
    if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ]*$/.test(name)) return log(w, p, 'El nombre del gremio solo puede tener letras, números y espacios.', 'warn');
    const bad = check ? check(name) : null;
    if (bad) return log(w, p, bad, 'warn');
    if ([...w.guilds.values()].some((g) => keyOf(g.name) === keyOf(name))) return log(w, p, `Ya existe un gremio llamado «${name}».`, 'warn');
    const e = Math.floor(+emblem);
    const c = Math.floor(+color);
    if (!(e >= 0 && e < GUILD_EMBLEMS.length) || !(c >= 0 && c < GUILD_COLORS.length)) return;
    p.gold -= GUILD_COST;
    const g = { id: `G${Date.now().toString(36)}${w.nextId++}`, name, emblem: e, color: c, notice: '', created: Date.now(), members: [], ver: 1 };
    g.members.push({ key: keyOf(p.name), name: p.name, cls: p.cls, sex: p.sex, level: p.level, rank: 2 });
    w.guilds.set(g.id, g);
    p.guild = g.id;
    guildChanged(w, g);
    emit(w, { type: 'inventory', to: p.id });
    emit(w, { type: 'banner', to: p.id, title: `${GUILD_EMBLEMS[e]} ${name}`, sub: '¡Fundaste tu gremio! Invita a tus amigos con la tecla G.' });
    log(w, p, `Fundaste el gremio ${name} (-${GUILD_COST.toLocaleString('es')} oro). Escribe @ antes de un mensaje para hablar con tu gremio.`, 'sys');
  }

  function guildInvite(w, p, targetId) {
    const g = guildOf(w, p);
    const me = memberIn(g, p);
    const t = w.players.get(targetId);
    if (!g || !me) return log(w, p, 'No perteneces a ningún gremio.', 'warn');
    if (me.rank < 1) return log(w, p, 'Solo el líder y los oficiales pueden invitar.', 'warn');
    if (!t || t === p) return;
    if (t.guild) return log(w, p, `${t.name} ya pertenece a un gremio.`, 'warn');
    if (g.members.length >= GUILD_MAX) return log(w, p, `El gremio está completo (${GUILD_MAX} miembros).`, 'warn');
    if (t.guildInvite && t.guildInvite.t > 0) return log(w, p, `${t.name} ya tiene una invitación pendiente.`, 'warn');
    t.guildInvite = { gid: g.id, from: p.id, t: 30 };
    emit(w, { type: 'guildInvite', to: t.id, name: p.name, guild: g.name, emblem: GUILD_EMBLEMS[g.emblem], color: GUILD_COLORS[g.color] });
    log(w, p, `Invitaste a ${t.name} a ${g.name}.`, 'sys');
  }

  function guildAnswer(w, p, accept) {
    const inv = p.guildInvite;
    p.guildInvite = null;
    if (!inv) return;
    const g = w.guilds.get(inv.gid);
    const from = w.players.get(inv.from);
    if (!g) return log(w, p, 'Ese gremio ya no existe.', 'warn');
    if (!accept) {
      if (from) log(w, from, `${p.name} rechazó la invitación al gremio.`, 'sys');
      return;
    }
    if (p.guild) return;
    if (g.members.length >= GUILD_MAX) return log(w, p, 'El gremio ya está completo.', 'warn');
    g.members.push({ key: keyOf(p.name), name: p.name, cls: p.cls, sex: p.sex, level: p.level, rank: 0 });
    p.guild = g.id;
    guildChanged(w, g);
    guildLog(w, g, `${p.name} se unió al gremio.`, 'sys', p);
    emit(w, { type: 'banner', to: p.id, title: `${GUILD_EMBLEMS[g.emblem]} ${g.name}`, sub: 'Te uniste al gremio. Escribe @ antes de un mensaje para hablar con ellos.' });
  }

  // Quita a un miembro (también desconectado). Si era el líder, pasa al de más rango.
  function dropMember(w, g, key) {
    const i = g.members.findIndex((m) => m.key === key);
    if (i < 0) return;
    const [m] = g.members.splice(i, 1);
    const q = onlineByKey(w, key);
    if (q && q.guild === g.id) q.guild = null;
    if (!g.members.length) {
      w.guilds.delete(g.id);
      w.guildsDirty = true;
      return;
    }
    if (m.rank === 2) {
      const next = [...g.members].sort((a, b) => b.rank - a.rank || b.level - a.level)[0];
      next.rank = 2;
      guildLog(w, g, `${next.name} es el nuevo líder del gremio.`, 'sys');
    }
    guildChanged(w, g);
  }

  function guildLeave(w, p) {
    const g = guildOf(w, p);
    const me = memberIn(g, p);
    if (!me) return;
    if (me.rank === 2 && g.members.length > 1) return log(w, p, 'Eres el líder: antes de salir nombra a otro líder, o disuelve el gremio.', 'warn');
    dropMember(w, g, me.key);
    log(w, p, `Saliste de ${g.name}.`, 'sys');
    if (w.guilds.has(g.id)) guildLog(w, g, `${p.name} salió del gremio.`);
  }

  function guildKick(w, p, key) {
    const g = guildOf(w, p);
    const me = memberIn(g, p);
    const m = g && g.members.find((x) => x.key === keyOf(key));
    if (!me || !m || m === me) return;
    if (me.rank < 1 || m.rank >= me.rank) return log(w, p, 'No puedes expulsar a alguien de tu mismo rango o mayor.', 'warn');
    const q = onlineByKey(w, m.key);
    dropMember(w, g, m.key);
    if (q) log(w, q, `Te expulsaron de ${g.name}.`, 'warn');
    guildLog(w, g, `${m.name} fue expulsado del gremio por ${p.name}.`);
  }

  // Líder: nombrar oficial (1) o volver a miembro (0)
  function guildRank(w, p, key, rank) {
    const g = guildOf(w, p);
    const me = memberIn(g, p);
    const m = g && g.members.find((x) => x.key === keyOf(key));
    if (!me || !m || m === me || me.rank !== 2) return;
    const r = rank ? 1 : 0;
    if (m.rank === r) return;
    m.rank = r;
    guildChanged(w, g);
    guildLog(w, g, r ? `${m.name} ahora es Oficial del gremio.` : `${m.name} vuelve a ser Miembro del gremio.`);
  }

  function guildLeader(w, p, key) {
    const g = guildOf(w, p);
    const me = memberIn(g, p);
    const m = g && g.members.find((x) => x.key === keyOf(key));
    if (!me || !m || m === me || me.rank !== 2) return;
    m.rank = 2;
    me.rank = 1;
    guildChanged(w, g);
    guildLog(w, g, `${m.name} es el nuevo líder de ${g.name}.`, 'lvl');
  }

  function guildDisband(w, p) {
    const g = guildOf(w, p);
    const me = memberIn(g, p);
    if (!me || me.rank !== 2) return;
    guildLog(w, g, `${p.name} disolvió el gremio ${g.name}.`, 'warn');
    for (const m of g.members) {
      const q = onlineByKey(w, m.key);
      if (q) q.guild = null;
    }
    w.guilds.delete(g.id);
    w.guildsDirty = true;
  }

  // Mensaje del gremio (ya filtrado por el servidor)
  function guildNotice(w, p, text) {
    const g = guildOf(w, p);
    const me = memberIn(g, p);
    if (!me || me.rank < 1) return;
    g.notice = String(text || '').slice(0, 140);
    guildChanged(w, g);
  }

  // Lo que ve un miembro en su panel
  function guildView(w, p) {
    const g = guildOf(w, p);
    const me = memberIn(g, p);
    if (!g || !me) return null;
    return {
      id: g.id,
      ver: g.ver || 0,
      name: g.name,
      emblem: g.emblem,
      color: g.color,
      notice: g.notice || '',
      rank: me.rank,
      max: GUILD_MAX,
      members: g.members.map((m) => ({ key: m.key, name: m.name, cls: m.cls, sex: m.sex, level: m.level, rank: m.rank, online: !!onlineByKey(w, m.key) })),
    };
  }

  // Etiqueta sobre la cabeza: "emblema|color|nombre"
  const guildTag = (w, p) => {
    const g = guildOf(w, p);
    return g ? `${g.emblem}|${g.color}|${g.name}` : '';
  };

  // Guardar y cargar (el servidor los escribe en su archivo)
  const exportGuilds = (w) => [...w.guilds.values()].map((g) => ({ id: g.id, name: g.name, emblem: g.emblem, color: g.color, notice: g.notice || '', created: g.created, members: g.members.map((m) => ({ ...m })) }));
  function loadGuilds(w, list) {
    w.guilds.clear();
    for (const g of Array.isArray(list) ? list : []) {
      if (!g || typeof g.id !== 'string' || !Array.isArray(g.members) || !g.members.length) continue;
      w.guilds.set(g.id, { ...g, ver: 1, members: g.members.map((m) => ({ ...m, key: keyOf(m.name) })) });
    }
  }
  // Un personaje borrado sale de su gremio
  function forgetMember(w, name) {
    for (const g of [...w.guilds.values()]) if (g.members.some((m) => m.key === keyOf(name))) dropMember(w, g, keyOf(name));
  }

  // Tienda junto a la que está el jugador (o null)
  const nearShop = (p) => NPCS.find((n) => n.role === 'shop' && d2(p.pos, n) < SHOP_R) || null;

  // ---------- Habilidades ----------

  const NEEDS_TARGET = ['dmg', 'area', 'leap', 'charge', 'chain', 'mark', 'poly', 'dance'];
  const skillReady = (p, s) => !s.locked && p.level >= s.lvl && p.stage >= s.stage;

  function useSkill(w, p, i, force = false) {
    const s = p.skills[i];
    if (p.dead || !s || p.leap || p.dancing) return;
    if (!skillReady(p, s)) {
      if (s.locked) return log(w, p, s.desc, 'warn');
      if (p.level < s.lvl) return log(w, p, `${s.name} se desbloquea en el nivel ${s.lvl}.`, 'warn');
      return log(w, p, `${s.name} se desbloquea con el ${STAGES[s.stage].name}. Habla con el Maestro Aldric.`, 'warn');
    }
    if ((p.cds[s.id] || 0) > 0) return;
    dismount(w, p);
    const cost = p.freeNext ? 0 : Data.skillMp(s, Data.skillLevel(p, s));
    if (p.mp < cost) return log(w, p, 'No tienes suficiente maná.', 'warn');
    if (NEEDS_TARGET.includes(s.type)) {
      const t = p.target;
      if (!t || t.dead) return log(w, p, 'Primero elige un objetivo.', 'warn');
      if (!pvpReady(w, p, force)) return;
      if (s.type === 'poly' && t.def && t.def.boss) return log(w, p, 'Los jefes son demasiado fuertes para la polimorfia.', 'warn');
      if (s.range && d2(p.pos, t.pos) > s.range + bodyR(t)) {
        p.queued = i;
        p.autoAttack = true;
        p.moveTarget = null;
        return;
      }
    }
    castSkill(w, p, i);
  }

  // Dirección de una habilidad: hacia el objetivo si hay, si no hacia donde miras
  function aimDir(p) {
    const t = p.target && !p.target.dead ? p.target : null;
    if (t) {
      const dx = t.pos.x - p.pos.x;
      const dz = t.pos.z - p.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.1) return { x: dx / len, z: dz / len };
    }
    return { x: Math.sin(p.facing), z: Math.cos(p.facing) };
  }

  function castSkill(w, p, i) {
    const base = p.skills[i];
    // Nivel de la habilidad (sube con el nivel del personaje): más poder y algo más de maná
    const slvl = Data.skillLevel(p, base);
    const pw = Data.skillPower(slvl);
    const cost = p.freeNext ? 0 : Data.skillMp(base, slvl);
    if (p.mp < cost || !skillReady(p, base)) return;
    // Resonancia Prismática: cada 3 hechizos, el siguiente gratis y con daño doble
    const boost = p.freeNext ? 2 : 1;
    p.freeNext = false;
    const pas = p.passive;
    if (pas.freeEvery) {
      p.spells++;
      if (p.spells >= pas.freeEvery) {
        p.spells = 0;
        p.freeNext = true;
        float(w, p, 'Resonancia', 'mana', 0.4);
      }
    }
    // Gemas de Poder: solo en habilidades que hacen daño
    const k = boost * pw * (base.mult || base.tick || base.shot ? useGem(w, p) : 1);
    const s =
      k === 1
        ? base
        : {
            ...base,
            mult: (base.mult || 0) * k,
            tick: base.tick && base.tick * k,
            shot: base.shot && base.shot * k,
            lightning: base.lightning && base.lightning * k,
            // El nivel también mejora curaciones y escudos (las gemas no)
            amount: base.amount && base.amount * pw,
            heal: base.heal && base.heal * pw,
            selfShield: base.selfShield && base.selfShield * pw,
          };
    p.mp -= cost;
    p.cds[s.id] = s.cd * (1 - Math.min(0.5, buffSum(p, 'cdr')));
    if (pas.cdRefund) for (const k in p.cds) if (k !== s.id && k !== 'pot') p.cds[k] = Math.max(0, p.cds[k] - pas.cdRefund);
    emit(w, { type: 'swing', ent: p });
    const t = p.target && !p.target.dead ? p.target : null;
    if (t) face(p, t.pos.x, t.pos.z, 1);
    if (s.selfShield) {
      p.shield = Math.max(p.shield, Math.round(p.stats.maxHp * s.selfShield));
      p.shieldT = Math.max(p.shieldT, s.dur || 10);
    }
    if (s.selfBuff) addBuff(w, p, `${s.id}_self`, s.name, s.selfBuff);
    if (s.aura) emit(w, { type: 'aura', ent: p, kind: s.aura, dur: s.auraDur || (s.type === 'pulse' ? s.count * s.every : s.dur) || 4 });
    fire(w, 'skill:cast', { p, skill: s, target: t, level: slvl });
    if (t && t.kind === 'player') {
      if (NEEDS_TARGET.includes(s.type)) castOnPlayer(w, p, s, t);
      else CAST[s.type](w, p, s, null);
    } else CAST[s.type](w, p, s, t);
    if (NEEDS_TARGET.includes(s.type) && p.target && s.type !== 'poly') p.autoAttack = true;
  }

  // Habilidad de ataque contra otro jugador: el daño de la habilidad en un solo golpe, y los efectos
  // de control se vuelven lentitud o enraizado cortos (nada de aturdir a otros jugadores)
  function castOnPlayer(w, p, s, q) {
    if (s.type === 'poly' || s.type === 'mark') {
      if (!canHit(p, q)) return damagePlayer(w, p, q, 0); // muestra el motivo
      if (s.type === 'poly' && !Object.values(q.buffs).some((b) => b.ccImmune)) {
        q.debuffs.slow = { t: 3 };
        float(w, q, 'Lento', 'stun', 0.5);
      }
      return;
    }
    const mult = Math.max(1, (s.mult || 1) * (s.hits || 1));
    ring(w, q.pos, 0xff7a6a, 1.6, 0.4);
    damagePlayer(w, p, q, mult);
    if (q.dead || !canHit(p, q) || Object.values(q.buffs).some((b) => b.ccImmune)) return;
    if (s.stun || s.root) {
      q.debuffs.root = { t: Math.min(1.5, s.stun || s.root) };
      float(w, q, 'Enraizado', 'stun', 0.5);
    } else if (s.slow) {
      q.debuffs.slow = { t: Math.min(3, s.slow) };
      float(w, q, 'Lento', 'stun', 0.5);
    }
  }

  // Daño en un círculo (a monstruos vivos)
  function hitCircle(w, p, at, radius, mult, s, fn) {
    for (const m of w.mobs) {
      if (m.dead || d2(m.pos, at) > radius + bodyR(m)) continue;
      damageMob(w, p, m, mult);
      if (m.dead) continue;
      if (s.slow) m.slowT = Math.max(m.slowT, s.slow);
      if (s.stun) stunMob(w, m, s.stun);
      if (s.burn) addDot(w, p, m, s.burn, 'burn');
      if (fn) fn(m);
    }
  }

  function healAllies(w, p, at, radius, pct) {
    for (const q of alliesNear(w, p, radius, at)) healPlayer(w, p, q, q.stats.maxHp * pct * p.stats.heal);
  }

  const CAST = {
    none() {},
    dmg(w, p, s, t) {
      const hits = s.hits || 1;
      if (s.proj) {
        spawnProjectile(w, p, s.proj, t, s.mult, { big: true, dot: s.dot, root: s.root, stun: s.stun, healAlly: s.healAlly });
        return;
      }
      ring(w, t.pos, 0xffc46b, 1.8, 0.4);
      const forceCrit = s.critIfBurning && isBurning(t);
      for (let k = 0; k < hits; k++) {
        if (k === 0) damageMob(w, p, t, s.mult, { forceCrit });
        else later(w, 0.18 * k, () => damageMob(w, p, t, s.mult, { forceCrit }));
      }
      if (s.stun) stunMob(w, t, s.stun);
    },
    area(w, p, s, t) {
      const n = s.count || 1;
      for (let k = 0; k < n; k++) {
        const ang = Math.random() * Math.PI * 2;
        const rr = n > 1 ? Math.sqrt(Math.random()) * (s.spread || 0) : 0;
        const at = { x: t.pos.x + Math.cos(ang) * rr, y: t.pos.y, z: t.pos.z + Math.sin(ang) * rr };
        const delay = s.delay + k * 0.22;
        emit(w, { type: 'faller', fx: s.fx, at, r: s.radius, dur: delay });
        later(w, delay, () => {
          const color = s.fx === 'meteor' ? 0xff6a2a : s.fx === 'frost' ? 0x9fd8ff : s.fx === 'glue' ? 0xf2b13a : s.fx === 'sword' ? 0xffe9a0 : 0xe8dcc2;
          ring(w, at, color, s.radius, 0.6);
          hitCircle(w, p, at, s.radius, s.mult, s);
          if (s.healAllies) healAllies(w, p, at, s.radius + 4, s.healAllies);
        });
      }
    },
    aoe(w, p, s) {
      ring(w, p.pos, s.taunt ? 0xffd36b : s.slow ? 0x9fd8ff : 0xff8a3d, s.radius, 0.5);
      hitCircle(w, p, p.pos, s.radius, s.mult, s, (m) => {
        if (s.taunt) {
          m.aggro = p;
          m.state = 'idle';
        }
      });
      if (s.allyShield) {
        for (const q of alliesNear(w, p, s.radius + 3)) {
          q.shield = Math.max(q.shield, Math.round(q.stats.maxHp * s.allyShield));
          q.shieldT = Math.max(q.shieldT, s.shieldDur || 6);
          if (q !== p) float(w, q, 'Escudo', 'mana', 0.3);
        }
      }
    },
    cone(w, p, s) {
      const dir = aimDir(p);
      const cosA = Math.cos(((s.angle || 70) * Math.PI) / 360);
      emit(w, { type: 'cone', at: { ...p.pos }, dir, r: s.radius, color: 0xff7a2a });
      for (const m of w.mobs) {
        if (m.dead) continue;
        const dx = m.pos.x - p.pos.x;
        const dz = m.pos.z - p.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > s.radius + bodyR(m) || (dist > 1 && (dx * dir.x + dz * dir.z) / dist < cosA)) continue;
        damageMob(w, p, m, s.mult);
        if (!m.dead && s.burn) addDot(w, p, m, s.burn, 'burn');
      }
    },
    line(w, p, s) {
      const dir = aimDir(p);
      const from = { x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z };
      const to = { x: p.pos.x + dir.x * s.length, y: p.pos.y + 1.2, z: p.pos.z + dir.z * s.length };
      emit(w, { type: 'beam', at: from, from, to, w: s.width, color: s.id === 'tronco' ? 0x8a5a34 : 0xfff0a0 });
      for (const m of w.mobs) {
        if (m.dead) continue;
        const dx = m.pos.x - p.pos.x;
        const dz = m.pos.z - p.pos.z;
        const along = dx * dir.x + dz * dir.z;
        const side = Math.abs(dx * dir.z - dz * dir.x);
        if (along < -0.5 || along > s.length || side > s.width / 2 + bodyR(m)) continue;
        damageMob(w, p, m, s.mult);
        if (!m.dead && s.stun) stunMob(w, m, s.stun, 'Derribado');
      }
      // Maestra: rastro de luz que quema y acelera aliados
      if (s.trail) {
        for (let k = 3; k < s.length; k += 5) {
          const at = { x: p.pos.x + dir.x * k, y: p.pos.y, z: p.pos.z + dir.z * k };
          groundZone(w, p, at, 2.6, s.trail.dur, { tick: 0.8, color: 0xffd36b });
        }
      }
      if (s.allyBuff) for (const q of alliesNear(w, p, 14)) addBuff(w, q, `${s.id}_ally`, s.name, s.allyBuff);
    },
    chain(w, p, s, t) {
      // Rayo que salta al enemigo más cercano que aún no recibió el golpe
      const hit = [t];
      let last = t;
      for (let k = 0; k < s.jumps; k++) {
        const next = w.mobs
          .filter((m) => !m.dead && !hit.includes(m) && d2(m.pos, last.pos) <= s.jumpR)
          .sort((a, b) => d2(a.pos, last.pos) - d2(b.pos, last.pos))[0];
        if (!next) break;
        hit.push(next);
        last = next;
      }
      const pts = [{ x: p.pos.x, y: p.pos.y + 1.8, z: p.pos.z }, ...hit.map((m) => ({ x: m.pos.x, y: m.pos.y + m.height * 0.55, z: m.pos.z }))];
      emit(w, { type: 'chain', pts });
      for (const m of hit) damageMob(w, p, m, s.mult);
    },
    charge(w, p, s, t) {
      // Carga: corre hasta el objetivo, lo golpea y lo aturde
      const dx = t.pos.x - p.pos.x;
      const dz = t.pos.z - p.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const stop = Math.max(0, len - (1.2 + bodyR(t)));
      p.leap = { fx: p.pos.x, fz: p.pos.z, tx: p.pos.x + (dx / len) * stop, tz: p.pos.z + (dz / len) * stop, t: 0, dur: 0.28, hop: 0.4, hit: { m: t, mult: s.mult, stun: s.stun } };
      p.moveTarget = null;
    },
    leap(w, p, s, t) {
      let ax = p.pos.x - t.pos.x;
      let az = p.pos.z - t.pos.z;
      let len = Math.hypot(ax, az);
      if (len < 0.1) {
        ax = -Math.sin(p.facing);
        az = -Math.cos(p.facing);
        len = 1;
      }
      const to = { x: p.pos.x + (ax / len) * s.dist, z: p.pos.z + (az / len) * s.dist };
      collide(to, PLAYER_R);
      p.leap = { fx: p.pos.x, fz: p.pos.z, tx: to.x, tz: to.z, t: 0, dur: 0.35, hop: 1.4 };
      if (s.shot) spawnProjectile(w, p, p.cdef.projectile || 'arrow', t, s.shot, { knock: s.knock });
      if (s.slow) t.slowT = s.slow;
      ring(w, p.pos, 0xb6e08a, 1.8, 0.5);
      p.moveTarget = null;
    },
    blink(w, p, s) {
      const dir = p.moveDir || aimDir(p);
      const to = { x: p.pos.x + dir.x * s.dist, z: p.pos.z + dir.z * s.dist };
      collide(to, PLAYER_R);
      ring(w, p.pos, 0xb9b2a4, 2.2, 0.8);
      p.leap = { fx: p.pos.x, fz: p.pos.z, tx: to.x, tz: to.z, t: 0, dur: 0.25, hop: 0.9 };
      p.facing = Math.atan2(dir.x, dir.z);
      p.moveTarget = null;
    },
    buff(w, p, s) {
      const targets = s.group ? alliesNear(w, p, s.radius || 12) : [p];
      for (const q of targets) {
        addBuff(w, q, s.id, s.name, s);
        ring(w, q.pos, 0xffd36b, 2.6, 0.7);
      }
      const parts = [];
      if (s.atk) parts.push(`+${Math.round(s.atk * 100)}% de ataque`);
      if (s.speed) parts.push(`+${Math.round(s.speed * 100)}% de velocidad`);
      if (s.haste) parts.push(`+${Math.round(s.haste * 100)}% de velocidad de ataque`);
      if (s.dr) parts.push(`${Math.round(s.dr * 100)}% menos daño recibido`);
      if (s.evade) parts.push(`+${Math.round(s.evade * 100)}% de esquivar`);
      if (s.thorns) parts.push('quemas a quien te golpee');
      if (s.cdr) parts.push(`habilidades un ${Math.round(s.cdr * 100)}% más rápidas`);
      log(w, p, `${s.name}: ${parts.join(', ')} durante ${s.dur} s${s.group && targets.length > 1 ? ` (${targets.length} aliados)` : ''}.`, 'sys');
      // Sinfonía Cósmica: los enemigos cercanos bailan sin poder atacar
      if (s.danceStun) for (const m of w.mobs) if (!m.dead && !m.def.boss && d2(m.pos, p.pos) <= s.danceStun.radius) stunMob(w, m, s.danceStun.dur, '¡A bailar!');
    },
    heal(w, p, s) {
      const targets = s.group ? alliesNear(w, p, s.radius || 9) : [p];
      // Revivir: aliados caídos en el área vuelven al instante
      if (s.revive) {
        for (const q of alliesNear(w, p, s.radius || 9, p.pos, true)) {
          if (!q.dead) continue;
          revivePlayer(w, q, q.pos, 0.6);
          log(w, q, `${p.name} te ha revivido.`, 'sys');
          targets.push(q);
        }
      }
      for (const q of targets) {
        if (s.amount) healPlayer(w, p, q, q.stats.maxHp * s.amount * p.stats.heal);
        if (s.shield) {
          q.shield = Math.max(q.shield, Math.round(q.stats.maxHp * s.shield));
          q.shieldT = Math.max(q.shieldT, s.shieldDur || 6);
        }
        if (s.thorns) addBuff(w, q, `${s.id}_thorns`, s.name, { thorns: s.thorns, dur: s.shieldDur || 6 });
        if (s.cleanse) {
          if (Object.keys(q.debuffs).length) float(w, q, 'Purificado', 'heal', 0.4);
          q.debuffs = {};
        }
        ring(w, q.pos, s.shield && !s.amount ? 0xc9b48a : 0x7fe08a, 2.4, 0.7);
      }
      if (s.dome) {
        // Cúpula: los aliados dentro reciben menos daño (y se curan en la versión Maestra)
        const at = { ...p.pos };
        const r = (s.radius || 9) * 0.75;
        const dur = s.shieldDur || 6;
        emit(w, { type: 'dome', at, r: s.radius || 9, dur });
        for (let k = 0; k <= Math.round(dur / 0.5); k++) {
          later(w, k * 0.5, () => {
            if (!w.players.has(p.id)) return;
            for (const q of alliesNear(w, p, r, at)) {
              q.buffs.dome = { name: 'Fortaleza Cubo', t: 0.6, dr: s.dome.dr };
              if (s.dome.heal && k % 2 === 0) healPlayer(w, p, q, q.stats.maxHp * s.dome.heal * p.stats.heal);
            }
          });
        }
      } else if (s.shield && s.group) emit(w, { type: 'dome', at: { ...p.pos }, r: s.radius || 9, dur: s.shieldDur || 6 });
    },
    bubble(w, p, s) {
      const list = alliesNear(w, p, s.reach || 16).sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp);
      const q = list[0] || p;
      q.bubble = 1;
      q.bubbleT = s.dur;
      float(w, q, 'Burbuja Estelar', 'mana', 0.4);
      ring(w, q.pos, 0xbfe6ff, 1.6, 0.8);
      if (q !== p) log(w, q, `${p.name} te protege con una Burbuja Estelar.`, 'sys');
    },
    mark(w, p, s, t) {
      t.markT = s.dur;
      t.markPct = s.pct;
      if (s.hawk) emit(w, { type: 'hawk', ent: p, target: t.id, dur: s.dur });
      float(w, t, 'Marcado', 'crit', 0.5);
      ring(w, t.pos, 0xffd36b, 1.6, 0.6);
    },
    zone(w, p, s, t) {
      const dir = aimDir(p);
      const at = t ? { ...t.pos } : { x: p.pos.x + dir.x * 3, y: p.pos.y, z: p.pos.z + dir.z * 3 };
      groundZone(w, p, at, s.radius, s.dur, { tick: s.tick, slow: s.slow, color: s.fx });
    },
    turret(w, p, s) {
      const dir = aimDir(p);
      const at = s.ride ? { x: p.pos.x, z: p.pos.z } : { x: p.pos.x + dir.x * 1.8, z: p.pos.z + dir.z * 1.8 };
      collide(at, 0.5);
      const type = s.summon === 'mecha' ? 'mecha' : 'turret';
      // Inventor de Autómatas: hasta 2 a la vez; si no, la nueva reemplaza a la anterior
      const max = p.passive.turretMax || 1;
      const mine = w.summons.filter((x) => x.owner === p && !x.dead && (x.type === 'turret' || x.type === 'mecha'));
      while (mine.length >= max) killSummon(w, mine.shift());
      const mult = s.mult * (1 + (p.passive.turretPct || 0));
      const su = spawnSummon(w, p, type, { at, dur: s.dur, every: s.every, mult, reach: s.reach, ride: s.ride, name: s.name });
      ring(w, su.pos, type === 'mecha' ? 0xff9a4a : 0x9fd8ff, type === 'mecha' ? 3.2 : 1.6, 0.6);
      if (type === 'mecha' && !s.ride) for (const m of w.mobs) if (!m.dead && d2(m.pos, su.pos) <= 9) m.aggro = su;
    },
    poly(w, p, s, t) {
      t.polyT = s.dur;
      t.stunT = Math.max(t.stunT, s.dur);
      if (t.aggro === p) dropAggro(t);
      const form = Math.random() < 0.5 ? 'sheep' : 'chicken';
      float(w, t, form === 'sheep' ? '¡Beee!' : '¡Cocó!', 'stun', 0.4);
      emit(w, { type: 'poly', ent: t, dur: s.dur, form });
    },
    pulse(w, p, s) {
      // Tornado Maestro: clones de viento que giran al lado e imitan los golpes
      const clones = [];
      for (let c = 0; c < (s.clones || 0); c++) clones.push(spawnSummon(w, p, 'clone', { at: p.pos, dur: s.count * s.every + 0.2, side: c % 2 ? -1 : 1, name: 'Clon de viento' }));
      for (let k = 0; k < s.count; k++) {
        later(w, k * s.every, () => {
          if (p.dead || !w.players.has(p.id)) return;
          ring(w, p.pos, s.id === 'tornado' ? 0xb6e08a : 0xffc46b, s.radius, 0.45);
          const struck = [];
          hitCircle(w, p, p.pos, s.radius, s.mult, s, (m) => struck.push(m));
          for (const cl of clones) {
            if (cl.dead) continue;
            ring(w, cl.pos, 0xb6e08a, s.radius * 0.8, 0.4);
            hitCircle(w, p, cl.pos, s.radius * 0.8, s.mult * 0.5, {});
          }
          // Maestro: rayos sobre los enemigos golpeados
          if (s.lightning && struck.length) {
            for (const m of struck) {
              emit(w, { type: 'chain', pts: [{ x: m.pos.x, y: m.pos.y + 9, z: m.pos.z }, { x: m.pos.x, y: m.pos.y + 0.5, z: m.pos.z }] });
              damageMob(w, p, m, s.lightning);
            }
          }
        });
      }
    },
    dance(w, p, s, t) {
      // Cortes saltando de enemigo en enemigo; el personaje se teletransporta junto a cada uno
      p.dancing = true;
      let cur = t;
      const hitOnce = (k) => {
        if (p.dead || !w.players.has(p.id)) return (p.dancing = false);
        if (!cur || cur.dead) cur = w.mobs.filter((m) => !m.dead && d2(m.pos, p.pos) <= s.jumpR).sort((a, b) => d2(a.pos, p.pos) - d2(b.pos, p.pos))[0];
        if (cur) {
          const ang = Math.random() * Math.PI * 2;
          const r = bodyR(cur) + 1;
          p.pos.x = cur.pos.x + Math.cos(ang) * r;
          p.pos.z = cur.pos.z + Math.sin(ang) * r;
          collide(p.pos, PLAYER_R);
          p.pos.y = groundY(p.pos.x, p.pos.z);
          face(p, cur.pos.x, cur.pos.z, 1);
          emit(w, { type: 'swing', ent: p });
          ring(w, cur.pos, 0xff7a2a, 1.4, 0.3);
          damageMob(w, p, cur, s.mult);
          // El siguiente corte va a otro enemigo cercano si lo hay
          const others = w.mobs.filter((m) => !m.dead && m !== cur && d2(m.pos, p.pos) <= s.jumpR);
          if (others.length) cur = others[Math.floor(Math.random() * others.length)];
        }
        if (k + 1 < s.hits) later(w, 0.14, () => hitOnce(k + 1));
        else {
          p.dancing = false;
          if (s.finale) {
            ring(w, p.pos, 0xff4a1a, s.finale.radius, 0.8);
            emit(w, { type: 'faller', fx: 'meteor', at: { ...p.pos }, r: s.finale.radius, dur: 0.01 });
            hitCircle(w, p, p.pos, s.finale.radius, s.finale.mult, { burn: s.finale.burn });
          }
        }
      };
      hitOnce(0);
    },
  };

  // Zona en el suelo: daña (tick = % de ataque por segundo) y/o ralentiza cada medio segundo
  function groundZone(w, p, at, radius, dur, o) {
    emit(w, { type: 'zone', at, r: radius, dur, color: o.color || 0xf2b13a });
    const n = Math.round(dur / 0.5);
    for (let k = 1; k <= n; k++) {
      later(w, k * 0.5, () => {
        if (!w.players.has(p.id)) return;
        for (const m of w.mobs) {
          if (m.dead || d2(m.pos, at) > radius + bodyR(m)) continue;
          if (o.slow) m.slowT = Math.max(m.slowT, 0.7);
          if (o.tick && k % 2 === 0) damageMob(w, p, m, o.tick, { noCrit: true, cls: 'burn' });
        }
      });
    }
  }

  // ---------- Proyectiles y temporizadores ----------

  function spawnProjectile(w, p, kind, target, mult, o = {}) {
    w.projectiles.push({
      id: `j${w.nextId++}`,
      kind,
      big: !!o.big,
      o,
      owner: p,
      target,
      mult,
      speed: PROJ_SPEED[kind] || 26,
      pos: o.from ? { ...o.from } : { x: p.pos.x + Math.sin(p.facing) * 0.7, y: p.pos.y + 1.7, z: p.pos.z + Math.cos(p.facing) * 0.7 },
    });
  }

  function later(w, t, fn) {
    w.timers.push({ t, fn });
  }

  function updateProjectiles(w, dt) {
    for (let i = w.projectiles.length - 1; i >= 0; i--) {
      const pr = w.projectiles[i];
      const t = pr.target;
      if (!t || t.dead || !w.players.has(pr.owner.id)) {
        w.projectiles.splice(i, 1);
        continue;
      }
      const tx = t.pos.x;
      const ty = t.pos.y + t.height * 0.5;
      const tz = t.pos.z;
      const dx = tx - pr.pos.x;
      const dy = ty - pr.pos.y;
      const dz = tz - pr.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      const step = pr.speed * dt;
      if (dist <= step + 0.3) {
        w.projectiles.splice(i, 1);
        const o = pr.o;
        const p = pr.owner;
        if (pr.kind === 'fire') ring(w, t.pos, 0xff7a2a, 1.6, 0.4);
        damageMob(w, p, t, pr.mult);
        if (!t.dead && t.kind !== 'player') {
          if (o.dot) addDot(w, p, t, o.dot, 'poison');
          if (o.root) {
            t.rootT = Math.max(t.rootT, o.root);
            float(w, t, 'Enredado', 'stun', 0.3);
          }
          if (o.stun) stunMob(w, t, o.stun);
          if (o.knock) knockBack(t, p.pos, o.knock);
        }
        // Ola de Notas: rebota y cura al aliado más herido
        if (o.healAlly) {
          const list = alliesNear(w, p, 18).sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp);
          if (list[0]) {
            emit(w, { type: 'chain', pts: [{ x: t.pos.x, y: t.pos.y + 1.2, z: t.pos.z }, { x: list[0].pos.x, y: list[0].pos.y + 1.4, z: list[0].pos.z }] });
            healPlayer(w, p, list[0], list[0].stats.maxHp * o.healAlly * p.stats.heal);
          }
        }
        continue;
      }
      pr.pos.x += (dx / dist) * step;
      pr.pos.y += (dy / dist) * step;
      pr.pos.z += (dz / dist) * step;
    }
  }

  function updateTimers(w, dt) {
    for (let i = w.timers.length - 1; i >= 0; i--) {
      w.timers[i].t -= dt;
      if (w.timers[i].t <= 0) {
        const fn = w.timers[i].fn;
        w.timers.splice(i, 1);
        fn();
      }
    }
  }

  // ---------- Inventario y tienda ----------

  const countItem = (p, id) => p.inv.filter((s) => s.id === id).reduce((a, s) => a + s.qty, 0);

  function addItem(p, id, qty = 1) {
    const it = ITEMS[id];
    if (!it) return false;
    if (it.stack) {
      const slot = p.inv.find((s) => s.id === id);
      if (slot) {
        slot.qty += qty;
        return true;
      }
    }
    if (p.inv.length >= INV_SLOTS) return false;
    p.inv.push({ id, qty: it.stack ? qty : 1 });
    return true;
  }

  function removeAt(p, index, qty = 1) {
    const slot = p.inv[index];
    slot.qty -= qty;
    if (slot.qty <= 0) p.inv.splice(index, 1);
  }

  function usePotion(w, p, id) {
    if (p.dead || (p.cds.pot || 0) > 0) return;
    const i = p.inv.findIndex((s) => s.id === id);
    if (i < 0) return log(w, p, `No te quedan ${ITEMS[id].name.toLowerCase()}s.`, 'warn');
    const it = ITEMS[id];
    const max = it.stat === 'hp' ? p.stats.maxHp : p.stats.maxMp;
    const amt = Math.round(max * it.amount);
    p[it.stat] = Math.min(max, p[it.stat] + amt);
    p.cds.pot = 1;
    removeAt(p, i);
    fire(w, 'item:used', { p, id });
    float(w, p, `+${amt}`, it.stat === 'hp' ? 'heal' : 'mana');
    emit(w, { type: 'inventory', to: p.id });
  }

  // Usar o equipar el objeto de una casilla del inventario.
  // El servidor valida raza, tipo de armadura y arma, nivel y grado (cambio de clase).
  function useItem(w, p, index) {
    const slot = p.inv[index];
    if (!slot) return;
    const it = ITEMS[slot.id];
    if (it.type === 'potion') return usePotion(w, p, slot.id);
    if (it.type === 'gem') return setGems(w, p, !p.gemsOn);
    if (it.type === 'egg') return p.pet ? log(w, p, 'Ya tienes una mascota.', 'warn') : emit(w, { type: 'hatchChoose', to: p.id });
    if (it.type !== 'weapon' && it.type !== 'armor') return log(w, p, `${it.name}: ${it.desc}`, 'sys');
    const problem = equipProblem(p, it);
    if (problem) return log(w, p, `No puedes equipar ${it.name}: ${problem}`, 'warn');
    const key = it.type;
    const prev = p.equip[key];
    p.inv.splice(index, 1);
    if (prev) p.inv.splice(index, 0, { id: prev, qty: 1 });
    p.equip[key] = slot.id;
    recalcStats(w, p);
    log(w, p, `Te equipas ${it.name}.`, 'sys');
    emit(w, { type: 'inventory', to: p.id });
  }

  const MAX_TRADE = 99;
  const tradeQty = (q, max) => Math.max(1, Math.min(max, Math.floor(Number(q)) || 1));

  function sellItem(w, p, index, qty = 1) {
    const slot = p.inv[index];
    if (!slot) return;
    if (!nearShop(p)) return log(w, p, 'Acércate a un mercader para vender.', 'warn');
    const it = ITEMS[slot.id];
    if (it.type === 'egg') return log(w, p, 'El Huevo de Mascota no se puede vender.', 'warn');
    const n = tradeQty(qty, slot.qty);
    const total = sellPrice(it) * n;
    p.gold += total;
    removeAt(p, index, n);
    log(w, p, `Vendes ${it.name}${n > 1 ? ` ×${n}` : ''} por ${total} oro.`, 'sys');
    emit(w, { type: 'inventory', to: p.id });
  }

  // Destruir objetos del inventario (para hacer espacio). Los objetos de misión y el huevo no se pueden.
  function destroyItem(w, p, index, qty = 1) {
    const slot = p.inv[index];
    if (!slot || p.dead) return;
    const it = ITEMS[slot.id];
    if (Data.isKeyItem(it)) return log(w, p, `${it.name} no se puede destruir.`, 'warn');
    const n = tradeQty(qty, slot.qty);
    removeAt(p, index, n);
    log(w, p, `Destruyes ${it.name}${n > 1 ? ` ×${n}` : ''}.`, 'sys');
    emit(w, { type: 'inventory', to: p.id });
  }

  function buyItem(w, p, id, qty = 1) {
    const it = ITEMS[id];
    const npc = nearShop(p);
    if (!it) return;
    if (!npc) return log(w, p, 'Acércate a un mercader para comprar.', 'warn');
    const entry = shopItems(npc.shop, p.cls).find((x) => x.id === id);
    if (!entry) return;
    const n = it.stack ? tradeQty(qty, MAX_TRADE) : 1;
    const total = entry.price * n;
    if (entry.currency) {
      // Se paga con un material (Polvo de Arcoíris en el Herrero Celestial)
      if (countItem(p, entry.currency) < total) return log(w, p, `Necesitas ${total} ${ITEMS[entry.currency].name}.`, 'warn');
      if (!addItem(p, id, n)) return log(w, p, 'No hay espacio en el inventario.', 'warn');
      let left = total;
      for (let i = p.inv.length - 1; i >= 0 && left > 0; i--) {
        if (p.inv[i].id !== entry.currency) continue;
        const k = Math.min(left, p.inv[i].qty);
        removeAt(p, i, k);
        left -= k;
      }
      emit(w, { type: 'loot', to: p.id, id, qty: n, verb: 'Forjas' });
      return emit(w, { type: 'inventory', to: p.id });
    }
    if (p.gold < total) return log(w, p, 'No tienes oro suficiente.', 'warn');
    if (!addItem(p, id, n)) return log(w, p, 'No hay espacio en el inventario.', 'warn');
    p.gold -= total;
    emit(w, { type: 'loot', to: p.id, id, qty: n, verb: 'Compras' });
    emit(w, { type: 'inventory', to: p.id });
  }

  function unequip(w, p, key) {
    const id = p.equip[key];
    if (!id) return;
    if (!addItem(p, id, 1)) return log(w, p, 'No hay espacio en el inventario.', 'warn');
    p.equip[key] = null;
    recalcStats(w, p);
    emit(w, { type: 'inventory', to: p.id });
  }

  // ---------- Grupos (party) ----------

  const partyOf = (w, p) => (p.party ? w.parties.get(p.party) || null : null);
  function partyNotify(w, party) {
    for (const id of party.members) emit(w, { type: 'party', to: id });
  }

  function partyInvite(w, p, targetId) {
    const t = w.players.get(targetId);
    if (!t || t === p || p.dead) return;
    const party = partyOf(w, p);
    if (party && party.leader !== p.id) return log(w, p, 'Solo el líder del grupo puede invitar.', 'warn');
    if (party && party.members.length >= PARTY_MAX) return log(w, p, `El grupo está completo (${PARTY_MAX} miembros).`, 'warn');
    if (t.party) return log(w, p, `${t.name} ya está en un grupo.`, 'warn');
    if (t.invite && t.invite.t > 0) return log(w, p, `${t.name} ya tiene una invitación pendiente.`, 'warn');
    t.invite = { from: p.id, t: 30 };
    emit(w, { type: 'partyInvite', to: t.id, from: p.id, name: p.name });
    log(w, p, `Has invitado a ${t.name} a tu grupo.`, 'sys');
  }

  function partyAnswer(w, p, accept) {
    const inv = p.invite;
    p.invite = null;
    if (!inv) return;
    const from = w.players.get(inv.from);
    if (!from) return log(w, p, 'Quien te invitó ya no está conectado.', 'warn');
    if (!accept) return log(w, from, `${p.name} rechazó tu invitación.`, 'sys');
    if (p.party) return;
    let party = partyOf(w, from);
    if (!party) {
      party = { id: `g${w.nextId++}`, leader: from.id, members: [from.id] };
      w.parties.set(party.id, party);
      from.party = party.id;
    }
    if (party.members.length >= PARTY_MAX) return log(w, p, 'El grupo ya está completo.', 'warn');
    party.members.push(p.id);
    p.party = party.id;
    for (const id of party.members) {
      const q = w.players.get(id);
      if (q) log(w, q, q === p ? `Te uniste al grupo de ${from.name}.` : `${p.name} se unió al grupo.`, 'sys');
    }
    partyNotify(w, party);
  }

  function partyLeave(w, p, silent = false) {
    const party = partyOf(w, p);
    p.party = null;
    if (!party) return;
    party.members = party.members.filter((id) => id !== p.id);
    emit(w, { type: 'party', to: p.id });
    if (!silent) log(w, p, 'Has dejado el grupo.', 'sys');
    if (party.members.length < 2) {
      for (const id of party.members) {
        const q = w.players.get(id);
        if (!q) continue;
        q.party = null;
        log(w, q, 'El grupo se ha disuelto.', 'sys');
        emit(w, { type: 'party', to: id });
      }
      w.parties.delete(party.id);
      return;
    }
    if (party.leader === p.id) party.leader = party.members[0];
    for (const id of party.members) {
      const q = w.players.get(id);
      if (q) log(w, q, `${p.name} dejó el grupo.${party.leader === id && p.id !== id ? ' Ahora eres el líder.' : ''}`, 'sys');
    }
    partyNotify(w, party);
  }

  function partyKick(w, p, targetId) {
    const party = partyOf(w, p);
    if (!party || party.leader !== p.id || targetId === p.id || !party.members.includes(targetId)) return;
    const t = w.players.get(targetId);
    if (!t) return;
    log(w, t, 'El líder te ha expulsado del grupo.', 'warn');
    partyLeave(w, t, true);
  }

  // Lista de miembros para mostrar en pantalla
  function partyView(w, p) {
    const party = partyOf(w, p);
    if (!party) return null;
    return {
      leader: party.leader,
      members: party.members
        .map((id) => w.players.get(id))
        .filter(Boolean)
        .map((q) => ({ id: q.id, name: q.name, cls: q.cls, sex: q.sex, stage: q.stage, branch: q.branch, level: q.level, hp: Math.round(q.hp), maxHp: q.stats.maxHp, mp: Math.round(q.mp), maxMp: q.stats.maxMp, dead: q.dead, x: Math.round(q.pos.x), z: Math.round(q.pos.z) })),
    };
  }

  // ---------- Paso de simulación ----------

  function step(w, dt) {
    w.time += dt;
    updateAuras(w);
    for (const p of w.players.values()) updatePlayer(w, p, dt);
    for (const m of w.mobs) updateMob(w, m, dt);
    if (w.mobs.some((m) => m.remove)) w.mobs = w.mobs.filter((m) => !m.remove);
    updateSummons(w, dt);
    updateLoot(w, dt);
    updateProjectiles(w, dt);
    updateTimers(w, dt);
    for (const s of w.systems) {
      if (!s.step) continue;
      try {
        s.step(w, dt, apiFor(w));
      } catch (err) {
        console.error(`[sistema ${s.id}] step:`, err);
      }
    }
  }

  // Auras pasivas (Bardo Melódico, Oráculo Estelar): afectan al grupo cercano
  function updateAuras(w) {
    for (const p of w.players.values()) p.aura = null;
    for (const p of w.players.values()) {
      if (p.dead) continue;
      const pas = p.passive;
      if (!pas.aura && !pas.partyMp) continue;
      for (const q of alliesNear(w, p, pas.aura ? pas.aura.radius : 12)) {
        const a = q.aura || (q.aura = {});
        if (pas.aura) {
          a.atk = Math.max(a.atk || 0, pas.aura.atk);
          a.speed = Math.max(a.speed || 0, pas.aura.speed);
        }
        if (pas.partyMp) a.mp = Math.max(a.mp || 0, pas.partyMp);
      }
    }
  }

  function updatePlayer(w, p, dt) {
    p.moving = false;
    if (p.invite && (p.invite.t -= dt) <= 0) p.invite = null;
    if (p.guildInvite && (p.guildInvite.t -= dt) <= 0) p.guildInvite = null;
    if (p.dead) return;
    for (const k in p.cds) p.cds[k] = Math.max(0, p.cds[k] - dt);
    for (const k in p.buffs) if ((p.buffs[k].t -= dt) <= 0) delete p.buffs[k];
    p.shieldT = Math.max(0, p.shieldT - dt);
    if (p.shieldT <= 0) p.shield = 0;
    if (p.bubble && (p.bubbleT -= dt) <= 0) p.bubble = 0;
    if (p.frenzy && (p.frenzyT -= dt) <= 0) p.frenzy = 0;
    p.combatT = Math.max(0, p.combatT - dt);
    p.atkTimer = Math.max(0, p.atkTimer - dt);
    const zone = zoneAt(p.pos);
    if ((zone ? zone.id : null) !== p.zoneId) {
      p.zoneId = zone ? zone.id : null;
      if (zone) fire(w, 'zone:entered', { p, zone });
    }
    if (p.flagT > 0 && (p.flagT -= dt) <= 0) {
      p.flagT = 0;
      if (p.karma <= 0) log(w, p, 'Tu nombre vuelve a ser blanco.', 'sys');
    }
    updateDebuffs(w, p, dt);
    if (p.dead) return;

    const rate = p.combatT > 0 ? 0.004 : inSafe(p.pos) ? 0.08 : 0.025;
    p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * rate * dt);
    p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.maxMp * rate * 1.4 * p.cdef.mpRegen * (1 + (p.aura && p.aura.mp ? p.aura.mp : 0)) * dt);

    // Agua: nadar es más lento; en aguas profundas se gasta el aire
    const depth = waterDepth(p.pos.x, p.pos.z);
    const wasDeep = p.deep;
    const gliding = p.mounted === 2;
    p.swimming = !gliding && depth > SWIM_DEPTH;
    p.deep = !gliding && depth > DEEP_DEPTH;
    if (p.mounted === 1 && depth > SWIM_DEPTH) dismount(w, p); // la montura terrestre no entra al agua profunda
    if (p.deep) {
      p.breath = Math.max(0, p.breath - dt);
      if (!wasDeep) log(w, p, 'Aguas profundas: te queda poco aire. Vuelve a la orilla.', 'warn');
      if (p.breath <= 0) {
        const dmg = p.stats.maxHp * 0.08 * dt;
        p.hp -= dmg;
        p.drownT = (p.drownT || 0) + dt;
        if (p.drownT >= 1) {
          p.drownT = 0;
          float(w, p, '¡Sin aire!', 'hurt');
        }
        if (p.hp <= 0) return killPlayer(w, p, 'agua');
      }
    } else {
      p.breath = Math.min(BREATH_MAX, p.breath + dt * 10);
    }
    const speed = moveSpeed(p) * (p.swimming ? SWIM_SPEED : 1);

    const t = p.target && !p.target.dead ? p.target : null;
    const bodyY = (x, z) => (gliding ? Math.max(heightAt(x, z), WATER_Y + 0.25) : groundY(x, z));
    if (!p.leap) p.pos.y = bodyY(p.pos.x, p.pos.z); // sobre el suelo, flotando en el agua o planeando

    if (p.dancing) {
      // Danza del Dragón: los cortes mueven al personaje
    } else if (p.leap) {
      // Salto, carga o propulsores: trayecto corto sin control
      const L = p.leap;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      p.pos.x = L.fx + (L.tx - L.fx) * k;
      p.pos.z = L.fz + (L.tz - L.fz) * k;
      collide(p.pos, PLAYER_R);
      p.pos.y = groundY(p.pos.x, p.pos.z) + Math.sin(Math.PI * k) * L.hop;
      if (t) face(p, t.pos.x, t.pos.z, dt);
      if (k >= 1) {
        p.leap = null;
        if (L.hit && !L.hit.m.dead) {
          ring(w, L.hit.m.pos, 0xffc46b, 2.2, 0.45);
          damageMob(w, p, L.hit.m, L.hit.mult);
          if (!L.hit.m.dead) stunMob(w, L.hit.m, L.hit.stun);
          p.autoAttack = true;
        }
      }
    } else if (p.moveDir) {
      p.moveTarget = null;
      p.interact = null;
      // Danza del Viento: se puede atacar mientras se camina
      const fire = p.passive.moveAttack && p.autoAttack && t;
      if (!fire) {
        p.autoAttack = false;
        p.queued = null;
      }
      p.moving = stepToward(p, { x: p.pos.x + p.moveDir.x * 5, z: p.pos.z + p.moveDir.z * 5 }, speed, dt, 0, !fire);
      if (fire) {
        face(p, t.pos.x, t.pos.z, dt);
        if (d2(p.pos, t.pos) <= reachTo(p, t) && p.atkTimer <= 0 && p.pendingHit <= 0) startBasic(w, p);
      }
    } else if (p.autoAttack && t) {
      const want = p.queued != null ? p.skills[p.queued].range + bodyR(t) : reachTo(p, t);
      if (d2(p.pos, t.pos) > want) {
        p.moving = stepToward(p, t.pos, speed, dt, want * 0.85);
      } else {
        face(p, t.pos.x, t.pos.z, dt);
        if (p.queued != null) {
          const q = p.queued;
          p.queued = null;
          castSkill(w, p, q);
        } else if (p.atkTimer <= 0 && p.pendingHit <= 0) {
          startBasic(w, p);
        }
      }
    } else if (p.moveTarget) {
      const npcGoal = p.interact && npcById(p.interact);
      const left = d2(p.pos, p.moveTarget);
      // Sin avanzar hacia el destino durante 3 s (p. ej. está dentro de un obstáculo): se detiene
      if (left < (p.mtBest ?? Infinity) - 0.05) {
        p.mtBest = left;
        p.mtStall = 0;
      } else p.mtStall = (p.mtStall || 0) + dt;
      if ((npcGoal && d2(p.pos, npcGoal) < TALK_R - 0.3) || p.mtStall > 3) {
        p.moving = false;
      } else {
        p.moving = stepToward(p, p.moveTarget, speed, dt, 0.15);
      }
      if (!p.moving) {
        p.mtBest = undefined;
        p.mtStall = 0;
        p.moveTarget = null;
        const npc = p.interact && npcById(p.interact);
        p.interact = null;
        if (npc) {
          if (d2(p.pos, npc) < TALK_R + 1) interactWith(w, p, npc);
          else log(w, p, `No puedes llegar hasta ${npc.name} por aquí.`, 'warn');
        }
      }
    }

    if (p.pendingHit > 0) {
      p.pendingHit -= dt;
      const tt = p.target;
      if (p.pendingHit <= 0 && tt && !tt.dead && d2(p.pos, tt.pos) <= reachTo(p, tt) + 0.6) basicHit(w, p, tt);
    }

    if (gliding && !p.leap) p.pos.y = bodyY(p.pos.x, p.pos.z);
    // Géiseres del Valle: al pisarlos te lanzan hacia adelante
    p.geyserCd = Math.max(0, (p.geyserCd || 0) - dt);
    if (!p.leap && !p.geyserCd && !p.mounted) {
      for (const g of layout().geysers) {
        if (Math.hypot(p.pos.x - g.x, p.pos.z - g.z) > 1.3) continue;
        const to = { x: p.pos.x + Math.sin(p.facing) * 12, z: p.pos.z + Math.cos(p.facing) * 12 };
        collide(to, PLAYER_R);
        p.leap = { fx: p.pos.x, fz: p.pos.z, tx: to.x, tz: to.z, t: 0, dur: 1, hop: 7 };
        p.geyserCd = 2;
        p.moveTarget = null;
        emit(w, { type: 'geyser', at: { x: g.x, y: g.y, z: g.z } });
        break;
      }
    }
    const r = Math.hypot(p.pos.x, p.pos.z);
    if (r > WORLD_LIMIT) {
      p.pos.x *= WORLD_LIMIT / r;
      p.pos.z *= WORLD_LIMIT / r;
      p.pos.y = groundY(p.pos.x, p.pos.z);
    }
  }

  function startBasic(w, p) {
    p.atkTimer = attackInterval(p);
    p.pendingHit = p.cdef.projectile ? 0.3 : 0.22;
    emit(w, { type: 'swing', ent: p });
  }

  function basicHit(w, p, t) {
    const g = useGem(w, p);
    if (p.cdef.projectile) spawnProjectile(w, p, p.cdef.projectile, t, g, { gem: g > 1 });
    else damageMob(w, p, t, g);
    const pas = p.passive;
    // Furia Creciente: cada golpe acelera el siguiente
    if (pas.frenzy) {
      p.frenzy = Math.min(5, p.frenzy + 1);
      p.frenzyT = 3;
    }
    // Escama Dorada: cada 3er golpe cura a ti y al aliado más cercano
    if (pas.healEvery && ++p.basics % pas.healEvery === 0) {
      healPlayer(w, p, p, p.stats.maxHp * pas.healPct);
      const ally = alliesNear(w, p, 12)
        .filter((q) => q !== p)
        .sort((a, b) => d2(a.pos, p.pos) - d2(b.pos, p.pos))[0];
      if (ally) healPlayer(w, p, ally, ally.stats.maxHp * pas.healPct);
    }
  }

  // ---------- Mecánicas de jefes ----------

  // Daño especial de un jefe (no se esquiva; la burbuja, los escudos y la reducción sí cuentan)
  function bossHit(w, m, p, pct) {
    if (p.dead) return;
    if (p.bubble > 0) {
      p.bubble = 0;
      return float(w, p, 'Burbuja', 'mana');
    }
    let dmg = Math.round(p.stats.maxHp * pct * (1 - Math.min(0.7, buffSum(p, 'dr'))));
    if (p.shield > 0) {
      const ab = Math.min(p.shield, dmg);
      p.shield -= ab;
      dmg -= ab;
    }
    p.combatT = 6;
    if (dmg <= 0) return;
    p.hp -= dmg;
    float(w, p, `-${dmg}`, 'hurt');
    if (p.hp <= 0) killPlayer(w, p, m.def.name);
  }

  const playersNear = (w, at, r) => [...w.players.values()].filter((p) => !p.dead && d2(p.pos, at) <= r);

  // Círculos marcados en el suelo que explotan al rato (raíces del Rey Tronco, estrellas del Guardián)
  function marks(w, m, mech, color, onHit) {
    const near = playersNear(w, m.pos, 26);
    const spots = near.slice(0, mech.count).map((p) => ({ x: p.pos.x, z: p.pos.z }));
    while (spots.length < mech.count) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 10;
      spots.push({ x: m.pos.x + Math.cos(a) * r, z: m.pos.z + Math.sin(a) * r });
    }
    for (const at of spots) {
      at.y = heightAt(at.x, at.z);
      emit(w, { type: 'telegraph', at, r: mech.r, dur: mech.delay, color });
      later(w, mech.delay, () => {
        if (m.dead) return;
        ring(w, at, color, mech.r, 0.6);
        for (const p of playersNear(w, at, mech.r)) onHit(p);
      });
    }
  }

  // ¿Hay una roca entre Ignis y el jugador?
  function sheltered(m, p) {
    const ax = m.pos.x;
    const az = m.pos.z;
    const bx = p.pos.x;
    const bz = p.pos.z;
    const len2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    return ARENAS.ignis.shelters.some((r) => {
      const t = ((r.x - ax) * (bx - ax) + (r.z - az) * (bz - az)) / len2;
      if (t <= 0 || t >= 1) return false;
      return Math.hypot(r.x - (ax + (bx - ax) * t), r.z - (az + (bz - az) * t)) < 1.9;
    });
  }

  function spawnAdds(w, m, adds) {
    const def = MOBS[adds.key];
    for (let i = 0; i < adds.count; i++) {
      const a = (i / adds.count) * Math.PI * 2;
      const sp = { x: m.pos.x + Math.cos(a) * 4, z: m.pos.z + Math.sin(a) * 4 };
      const add = { id: `m${w.nextId++}`, kind: 'mob', key: adds.key, def, zone: m.zone, pos: { x: 0, y: 0, z: 0 }, spawn: { x: 0, z: 0 }, facing: 0, height: mobHeight(def), moving: false, slowT: 0, stunT: 0, rootT: 0, polyT: 0, markT: 0, markPct: 0, dots: [], slide: null, temp: true };
      rollMob(w, add, sp);
      add.aggro = m.aggro && m.aggro.kind === 'player' ? m.aggro : null;
      w.mobs.push(add);
    }
  }

  function bossMech(w, m, dt) {
    const mech = m.def.mech;
    if (mech.type === 'plates') {
      // Botones de la Fábrica: se encienden al pisarlos y duran unos segundos
      const plates = ARENAS.fabrica.plates;
      plates.forEach((pl, i) => {
        const was = m.plateT[i] > 0;
        m.plateT[i] = Math.max(0, m.plateT[i] - dt);
        if (playersNear(w, pl, 1.6).length) {
          m.plateT[i] = mech.lit;
          if (!was) emit(w, { type: 'plate', i, at: { x: pl.x, y: heightAt(pl.x, pl.z), z: pl.z }, dur: mech.lit });
        }
      });
      const wasDown = m.shieldDownT > 0;
      m.shieldDownT = Math.max(0, m.shieldDownT - dt);
      if (!wasDown && m.plateT.every((t) => t > 0)) {
        m.shieldDownT = mech.open;
        m.plateT = [0, 0, 0];
        emit(w, { type: 'shield', ent: m, down: true, dur: mech.open });
        for (const p of playersNear(w, m.pos, 30)) emit(w, { type: 'banner', to: p.id, title: '¡Escudo desactivado!', sub: `¡Ataquen al Mega-Autómata! ${mech.open} segundos` });
      } else if (wasDown && !m.shieldDownT) {
        emit(w, { type: 'shield', ent: m, down: false });
        float(w, m, 'Escudo activado', 'mana', 0.5);
      }
      return;
    }
    if (!m.aggro || m.dead) {
      m.mechT = mech.every || 0;
      return;
    }
    m.mechT -= dt;
    if (mech.adds && !m.addsDone && m.hp <= m.maxHp * mech.adds.at) {
      m.addsDone = true;
      spawnAdds(w, m, mech.adds);
      for (const p of playersNear(w, m.pos, 30)) emit(w, { type: 'banner', to: p.id, title: `¡${m.def.name} llama refuerzos!`, sub: `Aparecen ${mech.adds.count} ${MOBS[mech.adds.key].name}` });
    }
    if (m.mechT > 0) return;
    m.mechT = mech.every;
    if (mech.type === 'roots') {
      marks(w, m, mech, 0x8a5a34, (p) => {
        bossHit(w, m, p, mech.dmg);
        if (!p.dead && !Object.values(p.buffs).some((b) => b.ccImmune)) {
          p.debuffs.root = { t: mech.root };
          float(w, p, 'Enraizado', 'stun', 0.5);
        }
      });
      for (const p of playersNear(w, m.pos, 26)) log(w, p, '¡Raíces en el suelo! Sal de los círculos marcados.', 'warn');
    } else if (mech.type === 'stars') {
      marks(w, m, mech, 0xffe08a, (p) => bossHit(w, m, p, mech.dmg));
    } else if (mech.type === 'yawn') {
      // Ignis bosteza fuego: solo se salvan los que estén escondidos detrás de una roca
      const at = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
      emit(w, { type: 'telegraph', at, r: mech.r, dur: mech.warn, color: 0xff5a1a });
      for (const p of playersNear(w, at, mech.r + 6)) emit(w, { type: 'banner', to: p.id, title: '¡Ignis está bostezando!', sub: 'Escóndete detrás de una roca' });
      m.stunT = Math.max(m.stunT, mech.warn + 0.6); // se queda quieto mientras bosteza
      later(w, mech.warn, () => {
        if (m.dead) return;
        emit(w, { type: 'firewave', at, r: mech.r });
        for (const p of playersNear(w, at, mech.r)) {
          if (sheltered(m, p)) {
            float(w, p, '¡A salvo!', 'heal', 0.5);
            continue;
          }
          bossHit(w, m, p, mech.dmg);
          if (!p.dead) p.debuffs.burn = { t: mech.burn.dur, perSec: m.atk * mech.burn.pct, tick: 1, src: m.def.name };
        }
      });
    }
  }

  function updateMob(w, m, dt) {
    m.moving = false;
    if (m.dead) {
      m.deadT -= dt;
      if (m.temp) {
        // Refuerzos de un jefe: no reaparecen
        if (m.deadT < m.respawnTime - 3) m.remove = true;
        return;
      }
      if (m.deadT <= 0) rollMob(w, m, m.def.boss ? m.spawn : randomPointInZone(m.zone));
      return;
    }

    // Jugador vivo más cercano (para agresividad y para decidir si simular)
    let near = null;
    let nearD = Infinity;
    for (const p of w.players.values()) {
      if (p.dead) continue;
      const d = d2(m.pos, p.pos);
      if (d < nearD) {
        nearD = d;
        near = p;
      }
    }
    if (nearD > ACTIVE_R && !m.aggro && m.state !== 'return') return;
    m.slowT = Math.max(0, m.slowT - dt);
    m.rootT = Math.max(0, m.rootT - dt);
    m.markT = Math.max(0, m.markT - dt);
    if (m.polyT > 0) m.polyT = Math.max(0, m.polyT - dt);

    // Veneno y quemaduras: un golpe por segundo
    for (let i = m.dots.length - 1; i >= 0; i--) {
      const d = m.dots[i];
      d.left -= dt;
      d.tick -= dt;
      if (d.tick <= 0) {
        d.tick += 1;
        const dmg = Math.max(1, Math.round(d.perSec));
        m.hp -= dmg;
        float(w, m, `${dmg}`, d.kind === 'burn' ? 'burn' : 'poison');
        if (m.hp <= 0 && w.players.has(d.owner.id)) {
          killMob(w, d.owner, m);
          return;
        }
      }
      if (d.left <= 0) m.dots.splice(i, 1);
    }

    if (m.def.mech) bossMech(w, m, dt);
    if (m.remove) return;

    // Aturdido u oveja: no se mueve ni ataca
    if (m.stunT > 0) {
      m.stunT -= dt;
      return;
    }

    const fromHome = d2(m.pos, m.spawn);
    if (m.state !== 'return') {
      const a = m.aggro;
      if (a && (!aggroAlive(w, a) || fromHome > LEASH_R || inSafe(a.pos))) {
        dropAggro(m);
      } else if (!a && m.def.aggressive && near && nearD < AGGRO_R && !inSafe(near.pos) && m.lvl >= near.level - 8) {
        m.aggro = near;
      }
    }

    const spd = (m.def.speed || 5) * (m.slowT > 0 ? 0.45 : 1);
    const rooted = m.rootT > 0;
    if (m.state === 'return') {
      if (!rooted) m.moving = stepToward(m, m.spawn, (m.def.speed || 5) * 1.4, dt, 0.8);
      // Recupera vida de a poco mientras vuelve; completa solo al llegar
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * RETURN_HEAL * dt);
      if (!m.moving && !rooted) {
        m.state = 'idle';
        m.hp = m.maxHp;
      }
    } else if (m.aggro) {
      const p = m.aggro;
      const reach = 1.5 + (m.def.scale || 1) * 0.6;
      if (d2(m.pos, p.pos) > reach) {
        if (!rooted) m.moving = stepToward(m, p.pos, spd, dt, reach * 0.9);
      } else {
        face(m, p.pos.x, p.pos.z, dt);
        m.atkTimer -= dt;
        if (m.atkTimer <= 0) {
          m.atkTimer = m.def.boss ? 1.8 : 1.6;
          emit(w, { type: 'swing', ent: m });
          mobHitsPlayer(w, m, p);
        }
      }
    } else if (!rooted) {
      m.wanderT -= dt;
      if (m.wanderT <= 0) {
        m.wanderT = rand(3, 8);
        const a = rand(0, Math.PI * 2);
        const r = rand(0, 7);
        m.wanderTo = { x: m.spawn.x + Math.cos(a) * r, z: m.spawn.z + Math.sin(a) * r };
      }
      if (m.wanderTo) {
        m.moving = stepToward(m, m.wanderTo, spd * 0.35, dt, 0.3);
        if (!m.moving) m.wanderTo = null;
      }
    }
  }

  // Bonificaciones activas para mostrar en pantalla
  const buffList = (p) => Object.entries(p.buffs).filter(([k]) => k !== 'dome').map(([, b]) => ({ name: b.name, t: Math.round(b.t * 10) / 10 })).concat(p.buffs.dome ? [{ name: 'Dentro de la cúpula', t: 0 }] : []);
  const DEBUFF_NAMES = { poison: 'Envenenado', burn: 'Quemado', slow: 'Lento', root: 'Enraizado' };
  const debuffList = (p) => Object.entries(p.debuffs).map(([k, d]) => ({ name: DEBUFF_NAMES[k] || k, t: Math.round(d.t * 10) / 10 }));
  const liveStats = (p) => ({
    ...p.stats,
    atk: Math.round(playerAtk(p) * 10) / 10,
    crit: Math.round(playerCrit(p) * 1000) / 1000,
    atkSpeed: Math.round(attackInterval(p) * 100) / 100,
    speed: Math.round(moveSpeed(p) * 10) / 10,
    dr: Math.min(0.7, buffSum(p, 'dr')),
    evade: Math.min(0.6, p.stats.evade + buffSum(p, 'evade')),
  });

  return {
    SPAWN,
    MAX_TRADE,
    BREATH_MAX,
    PARTY_MAX,
    createWorld,
    drainEvents,
    newCharacter,
    addPlayer,
    removePlayer,
    serialize,
    spawnMobs,
    step,
    countItem,
    partyView,
    buffList,
    debuffList,
    collectAllLoot,
    liveStats,
    skillReady,
    pvpState,
    PVP_MIN_LEVEL,
    createBus,
    useSystem,
    systemCommand,
    systemViews,
    guildView,
    guildTag,
    exportGuilds,
    loadGuilds,
    forgetMember,
    cmd: {
      setTarget, attack, targetNearest, moveTo, setMoveDir, talkTo, useSkill, usePotion, useItem, sellItem, destroyItem, buyItem, unequip, respawn,
      partyInvite, partyAnswer, partyLeave, partyKick, classQuest, setGems, hatchPet, toggleMount,
      guildCreate, guildInvite, guildAnswer, guildLeave, guildKick, guildRank, guildLeader, guildDisband, guildNotice,
    },
  };
});
