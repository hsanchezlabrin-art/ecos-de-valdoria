// Simulación del juego, sin gráficos ni interfaz: jugadores, monstruos, combate,
// habilidades, objetos, grupos y progresión. Es la misma lógica que corre el servidor
// en línea (Node), por eso no usa THREE, document ni window.
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
  const { CLASSES, MOBS, ITEMS, ZONES, NPCS, MAX_LEVEL, xpToNext, mobStats, playerBaseStats, sellPrice, resolveDrop, shopFor, CRIT_MULT, MOVE_SPEED } = Data;
  const { heightAt, inVillage, WORLD_LIMIT, collide, waterDepth, SWIM_DEPTH, DEEP_DEPTH, SWIM_Y } = Terrain;

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
  const PARTY_MAX = 7;
  const PARTY_R = 45; // distancia para compartir experiencia
  const PLAYER_R = 0.45;
  const SPAWN = { x: 0, z: 5 };
  const PROJ_SPEED = { arrow: 38, fire: 24, arcane: 26 };

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const bodyR = (m) => (m.def.scale || 1) * 0.45;
  const entR = (e) => (e.kind === 'mob' ? 0.4 * (e.def.scale || 1) : PLAYER_R);

  // ---------- Mundo y eventos ----------

  function createWorld() {
    return { time: 0, nextId: 1, players: new Map(), mobs: [], projectiles: [], timers: [], events: [], parties: new Map() };
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
    const c = CLASSES[cls];
    return {
      name,
      cls,
      sex: sex === 'f' ? 'f' : 'm',
      level: 1,
      xp: 0,
      gold: 40,
      inv: [
        { id: 'pocion_vida', qty: 4 },
        { id: 'pocion_mana', qty: cls === 'mago' ? 4 : 2 },
      ],
      equip: { weapon: c.start, armor: null },
      pos: { ...SPAWN },
    };
  }

  function addPlayer(w, data, id = `p${w.nextId++}`) {
    const cls = CLASSES[data.cls] ? data.cls : 'guerrero';
    const cdef = CLASSES[cls];
    const p = {
      id,
      kind: 'player',
      name: data.name,
      cls,
      sex: data.sex === 'f' ? 'f' : 'm',
      cdef,
      skills: cdef.skills,
      level: data.level,
      xp: data.xp,
      gold: data.gold,
      inv: data.inv.map((s) => ({ ...s })),
      equip: { ...data.equip },
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
      buffT: 0,
      buffPct: 0,
      buffCrit: 0,
      buffName: '',
      shield: 0,
      shieldT: 0,
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
      hp: 0,
      mp: 0,
    };
    collide(p.pos, PLAYER_R);
    p.pos.y = groundY(p.pos.x, p.pos.z);
    w.players.set(id, p);
    recalcStats(w, p);
    p.hp = Math.min(data.hp ?? p.stats.maxHp, p.stats.maxHp);
    p.mp = Math.min(data.mp ?? p.stats.maxMp, p.stats.maxMp);
    if (p.hp <= 0) p.hp = Math.round(p.stats.maxHp * 0.7);
    return p;
  }

  function removePlayer(w, id) {
    const p = w.players.get(id);
    if (!p) return;
    partyLeave(w, p, true);
    w.players.delete(id);
    for (const m of w.mobs) if (m.aggro === p) dropAggro(m);
  }

  function serialize(p) {
    const alive = !p.dead;
    return {
      v: 3,
      name: p.name,
      cls: p.cls,
      sex: p.sex,
      level: p.level,
      xp: p.xp,
      gold: p.gold,
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
    p.stats = {
      maxHp: b.maxHp + (arm ? arm.hp : 0),
      maxMp: b.maxMp,
      atk: b.atk + (wpn ? wpn.atk : 0),
      def: b.def + (arm ? arm.def : 0),
      crit: b.crit + (wpn && wpn.crit ? wpn.crit : 0),
      critMult: CRIT_MULT,
      atkSpeed: p.cdef.atkSpeed, // segundos entre ataques básicos
      speed: SPEED,
      range: p.cdef.range,
    };
    if (p.hp > p.stats.maxHp) p.hp = p.stats.maxHp;
    emit(w, { type: 'equip', ent: p });
  }

  const playerAtk = (p) => p.stats.atk * (1 + (p.buffT > 0 ? p.buffPct : 0));
  const playerCrit = (p) => p.stats.crit + (p.buffT > 0 ? p.buffCrit : 0);
  const reachTo = (p, m) => p.cdef.range + bodyR(m);

  // ---------- Monstruos ----------

  const zoneById = (id) => ZONES.find((z) => z.id === id);
  function randomPointInZone(z, f = 0.85) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * z.r * f;
      const pt = { x: z.x + Math.cos(a) * r, z: z.z + Math.sin(a) * r };
      // Evita aparecer dentro de un árbol o en aguas profundas
      const c = { x: pt.x, z: pt.z };
      if (!collide(c, 0.6) && waterDepth(pt.x, pt.z) < SWIM_DEPTH) return pt;
    }
    return { x: z.x, z: z.z };
  }

  function spawnMobs(w) {
    for (const [key, def] of Object.entries(MOBS)) {
      const zone = zoneById(def.zone);
      for (let i = 0; i < def.count; i++) {
        const sp = def.boss ? { x: zone.x + 4, z: zone.z + 4 } : randomPointInZone(zone);
        const m = {
          id: `m${w.nextId++}`,
          kind: 'mob',
          key,
          def,
          zone,
          pos: { x: 0, y: 0, z: 0 },
          spawn: { x: 0, z: 0 },
          facing: Math.random() * Math.PI * 2,
          height: (def.kind === 'quad' ? 1.5 : 2.5) * (def.scale || 1),
          moving: false,
          slowT: 0,
          stunT: 0,
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
    m.dots = [];
    m.deadT = 0;
    emit(w, { type: 'mobSpawn', ent: m });
  }

  function dropAggro(m) {
    m.aggro = null;
    m.state = 'return';
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
  function stepToward(ent, target, speed, dt, stopDist) {
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
    if (best.moved > 0.0005) face(ent, ent.pos.x + mx, ent.pos.z + mz, dt); // mira hacia donde camina
    return best.moved > 0.0005;
  }

  // ---------- Combate ----------

  function calcDamage(atk, def, mult = 1, critChance = 0.1, critMult = CRIT_MULT) {
    let dmg = atk * mult * (0.85 + Math.random() * 0.3) - def * 0.5;
    const crit = Math.random() < critChance;
    if (crit) dmg *= critMult;
    return { dmg: Math.max(1, Math.round(dmg)), crit };
  }

  function damageMob(w, p, m, mult, opts = {}) {
    if (!m || m.dead) return;
    const r = opts.noCrit ? calcDamage(playerAtk(p), m.armor, mult, 0) : calcDamage(playerAtk(p), m.armor, mult, playerCrit(p), p.stats.critMult);
    m.hp -= r.dmg;
    p.combatT = 6;
    float(w, m, r.crit ? `¡${r.dmg}!` : `${r.dmg}`, opts.cls || (r.crit ? 'crit' : 'dmg'));
    // Si estaba volviendo a su sitio y lo atacan, vuelve a pelear (sin haberse curado)
    if (m.state === 'return') m.state = 'idle';
    if (!m.aggro || m.aggro.dead) m.aggro = p;
    if (m.hp <= 0) killMob(w, p, m);
  }

  // Reparte la experiencia entre el grupo cercano: más miembros, más bonificación
  function shareXp(w, killer, m, xp) {
    const party = killer.party ? w.parties.get(killer.party) : null;
    const members = party
      ? party.members.map((id) => w.players.get(id)).filter((q) => q && !q.dead && d2(q.pos, m.pos) <= PARTY_R)
      : [killer];
    if (!members.includes(killer)) members.push(killer);
    const bonus = 1 + 0.1 * (members.length - 1);
    const levels = members.reduce((a, q) => a + q.level, 0);
    for (const q of members) {
      const diff = m.lvl - q.level;
      let share = (xp * bonus * q.level) / levels;
      if (diff <= -6) share *= 0.1;
      else if (diff <= -4) share *= 0.4;
      else if (diff >= 3) share *= 1.2;
      share = Math.max(1, Math.round(share));
      if (q !== killer) log(w, q, `Experiencia de grupo: +${share} XP`, 'sys');
      else killer.lastXp = share;
      gainXp(w, q, share);
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
    const gold = randInt(m.gold[0], m.gold[1]);
    p.gold += gold;
    shareXp(w, p, m, m.xp);
    const xp = p.lastXp || 0;
    log(w, p, `${m.def.name} ha caído. +${xp} XP · +${gold} oro`, 'sys');
    float(w, m, `+${xp} XP`, 'xp', 0.6);
    for (const [raw, chance] of m.def.drops) {
      if (Math.random() >= chance) continue;
      const id = resolveDrop(raw, p.cls);
      if (addItem(p, id, 1)) emit(w, { type: 'loot', to: p.id, id, qty: 1, verb: 'Obtienes' });
      else log(w, p, 'Tu inventario está lleno.', 'warn');
    }
    if (m.def.boss) emit(w, { type: 'banner', to: null, title: `${m.def.name} ha sido derrotado`, sub: 'Vuelve a aparecer en 3 minutos' });
    emit(w, { type: 'inventory', to: p.id });
  }

  function mobHitsPlayer(w, m, p) {
    if (p.dead || p.leap) return;
    const r = calcDamage(m.atk, p.stats.def, 1, 0.05);
    let dmg = r.dmg;
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg -= absorbed;
      if (p.shield <= 0) p.shieldT = 0;
      if (absorbed) float(w, p, `(${absorbed})`, 'mana');
    }
    p.combatT = 6;
    if (dmg <= 0) return;
    p.hp -= dmg;
    float(w, p, `-${dmg}`, 'hurt');
    if (!p.target) p.target = m;
    if (p.hp <= 0) killPlayer(w, p, m.def.name);
  }

  function killPlayer(w, p, cause) {
    p.hp = 0;
    p.dead = true;
    p.autoAttack = false;
    p.queued = null;
    p.moveTarget = null;
    p.shield = 0;
    p.target = null;
    p.leap = null;
    for (const mob of w.mobs) if (mob.aggro === p) dropAggro(mob);
    log(w, p, cause === 'agua' ? 'Te has ahogado.' : `Has caído ante ${cause}.`, 'warn');
    emit(w, { type: 'playerDeath', to: p.id, ent: p });
  }

  function respawn(w, p) {
    if (!p.dead) return;
    const loss = p.level >= MAX_LEVEL ? 0 : Math.floor(xpToNext(p.level) * 0.05);
    p.xp = Math.max(0, p.xp - loss);
    p.dead = false;
    p.pos.x = SPAWN.x + rand(-1.5, 1.5);
    p.pos.z = SPAWN.z + rand(-1, 1);
    collide(p.pos, PLAYER_R);
    p.pos.y = groundY(p.pos.x, p.pos.z);
    p.hp = Math.round(p.stats.maxHp * 0.7);
    p.mp = Math.round(p.stats.maxMp * 0.7);
    p.breath = BREATH_MAX;
    emit(w, { type: 'playerRespawn', to: p.id, ent: p });
    log(w, p, loss ? `Despiertas en la aldea. Pierdes ${loss} XP.` : 'Despiertas en la aldea.', 'sys');
  }

  function gainXp(w, p, xp) {
    if (p.level >= MAX_LEVEL) return;
    p.xp += xp;
    let up = false;
    while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      up = true;
      recalcStats(w, p);
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      const unlocked = p.skills.find((s) => s.lvl === p.level);
      emit(w, { type: 'banner', to: p.id, title: `Nivel ${p.level}`, sub: unlocked ? `Nueva habilidad: ${unlocked.name}` : 'Tus fuerzas aumentan' });
      log(w, p, `Has alcanzado el nivel ${p.level}.`, 'lvl');
    }
    if (up) {
      emit(w, { type: 'levelUp', ent: p, level: p.level }); // columna de luz visible para todos
      emit(w, { type: 'inventory', to: p.id });
    }
    if (p.level >= MAX_LEVEL) p.xp = 0;
  }

  // ---------- Comandos del jugador ----------

  function setTarget(w, p, m) {
    p.target = m && !m.dead ? m : null;
    if (!p.target) {
      p.autoAttack = false;
      p.queued = null;
    }
  }

  function attack(w, p) {
    if (p.dead || !p.target || p.target.dead) return;
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

  function interactWith(w, p, npc) {
    if (npc.id === 'mercader') {
      emit(w, { type: 'openShop', to: p.id });
      return log(w, p, 'Orlen: «Pociones frescas y acero honrado. ¿Qué necesitas?»', 'npc');
    }
    if (npc.id === 'sanadora') {
      if (p.combatT > 0) return log(w, p, 'Ilwen: «Primero aléjate del peligro, viajero.»', 'npc');
      const full = p.hp >= p.stats.maxHp && p.mp >= p.stats.maxMp;
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      ring(w, p.pos, 0x7fe0b0, 3, 0.9);
      return log(w, p, full ? 'Ilwen: «Tu luz ya está completa. Ve con cuidado.»' : 'Ilwen: «Que la luz del cristal cierre tus heridas.» Vida y maná restaurados.', 'npc');
    }
    if (npc.id === 'capitana') {
      const field = ZONES.filter((z) => !z.safe);
      const rec =
        field.find((z) => {
          const [a, b] = z.lvl.split(' ')[0].split('–').map(Number);
          return p.level >= a - 1 && p.level <= b;
        }) || field[field.length - 1];
      const tips = {
        guerrero: 'Usa Torbellino cuando te rodeen y guarda Segundo Aliento para los apuros.',
        arquera: 'Dispara desde lejos y usa Salto de Retirada si algo te alcanza. Nunca dejes que te rodeen.',
        mago: 'Lanza el Escudo Arcano antes de atacar y congela a los grupos con la Nova de Escarcha.',
      };
      log(w, p, `Brisa: «A tu nivel te recomiendo ${rec.name} (nivel ${rec.lvl}). ${tips[p.cls]} Cazar en grupo da más experiencia.»`, 'npc');
    }
  }

  const nearMerchant = (p) => d2(p.pos, npcById('mercader')) < SHOP_R;

  // ---------- Habilidades ----------

  const TARGETED = ['dmg', 'area', 'leap', 'charge', 'chain'];

  function useSkill(w, p, i) {
    const s = p.skills[i];
    if (p.dead || !s || p.leap) return;
    if (p.level < s.lvl) return log(w, p, `${s.name} se desbloquea en el nivel ${s.lvl}.`, 'warn');
    if ((p.cds[s.id] || 0) > 0) return;
    if (p.mp < s.mp) return log(w, p, 'No tienes suficiente maná.', 'warn');
    if (TARGETED.includes(s.type)) {
      const t = p.target;
      if (!t || t.dead) return log(w, p, 'Primero elige un objetivo.', 'warn');
      if (s.range && d2(p.pos, t.pos) > s.range + bodyR(t)) {
        p.queued = i;
        p.autoAttack = true;
        p.moveTarget = null;
        return;
      }
    }
    castSkill(w, p, i);
  }

  function castSkill(w, p, i) {
    const s = p.skills[i];
    if (p.mp < s.mp) return;
    p.mp -= s.mp;
    p.cds[s.id] = s.cd;
    emit(w, { type: 'swing', ent: p });
    const t = p.target;
    if (s.type === 'dmg') {
      if (s.proj) spawnProjectile(w, p, s.proj, t, s.mult, true, s.dot);
      else {
        ring(w, t.pos, 0xffc46b, 1.8, 0.4);
        damageMob(w, p, t, s.mult);
      }
      if (p.target) p.autoAttack = true;
    } else if (s.type === 'area') {
      const at = { x: t.pos.x, y: t.pos.y, z: t.pos.z };
      emit(w, { type: 'faller', fx: s.fx, at, r: s.radius, dur: s.delay });
      later(w, s.delay, () => {
        const color = s.fx === 'meteor' ? 0xff6a2a : s.fx === 'frost' ? 0x9fd8ff : 0xe8dcc2;
        ring(w, at, color, s.radius, 0.6);
        for (const m of w.mobs) {
          if (m.dead || d2(m.pos, at) > s.radius + bodyR(m)) continue;
          damageMob(w, p, m, s.mult);
          if (s.slow) m.slowT = s.slow;
        }
      });
      if (p.target) p.autoAttack = true;
    } else if (s.type === 'aoe') {
      ring(w, p.pos, s.slow ? 0x9fd8ff : 0xff8a3d, s.radius, 0.5);
      for (const m of w.mobs) {
        if (m.dead || d2(m.pos, p.pos) > s.radius + bodyR(m)) continue;
        damageMob(w, p, m, s.mult);
        if (s.slow) m.slowT = s.slow;
      }
    } else if (s.type === 'chain') {
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
      if (p.target) p.autoAttack = true;
    } else if (s.type === 'charge') {
      // Embestida: corre hasta el objetivo, lo golpea y lo aturde
      const dx = t.pos.x - p.pos.x;
      const dz = t.pos.z - p.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const stop = Math.max(0, len - (1.2 + bodyR(t)));
      p.leap = { fx: p.pos.x, fz: p.pos.z, tx: p.pos.x + (dx / len) * stop, tz: p.pos.z + (dz / len) * stop, t: 0, dur: 0.28, hop: 0.4, hit: { m: t, mult: s.mult, stun: s.stun } };
      p.moveTarget = null;
    } else if (s.type === 'heal') {
      const amt = Math.round(p.stats.maxHp * s.amount);
      p.hp = Math.min(p.stats.maxHp, p.hp + amt);
      float(w, p, `+${amt}`, 'heal');
      ring(w, p.pos, 0x7fe08a, 2.4, 0.7);
    } else if (s.type === 'buff') {
      p.buffT = s.dur;
      p.buffPct = s.pct;
      p.buffCrit = s.crit || 0;
      p.buffName = s.name;
      ring(w, p.pos, 0xffd36b, 3, 0.8);
      log(w, p, `${s.name}: +${Math.round(s.pct * 100)}% de ataque${s.crit ? ` y +${Math.round(s.crit * 100)}% de crítico` : ''} durante ${s.dur} s.`, 'sys');
    } else if (s.type === 'shield') {
      p.shield = Math.round(p.stats.maxHp * s.amount);
      p.shieldT = s.dur;
      ring(w, p.pos, 0x8fb8ff, 2.6, 0.8);
      log(w, p, `${s.name}: absorbe ${p.shield} de daño durante ${s.dur} s.`, 'sys');
    } else if (s.type === 'leap') {
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
      t.slowT = s.slow;
      ring(w, p.pos, 0xb6e08a, 1.8, 0.5);
      p.moveTarget = null;
    }
  }

  // ---------- Proyectiles y temporizadores ----------

  function spawnProjectile(w, p, kind, target, mult, big = false, dot = null) {
    w.projectiles.push({
      id: `j${w.nextId++}`,
      kind,
      big,
      dot,
      owner: p,
      target,
      mult,
      speed: PROJ_SPEED[kind] || 26,
      pos: { x: p.pos.x + Math.sin(p.facing) * 0.7, y: p.pos.y + 1.7, z: p.pos.z + Math.cos(p.facing) * 0.7 },
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
        if (pr.kind === 'fire') ring(w, t.pos, 0xff7a2a, 1.6, 0.4);
        damageMob(w, pr.owner, t, pr.mult);
        if (pr.dot && !t.dead) {
          // Veneno: daño repartido en el tiempo (ataque del jugador × mult total)
          const total = playerAtk(pr.owner) * pr.dot.mult;
          t.dots.push({ owner: pr.owner, perSec: total / pr.dot.dur, left: pr.dot.dur, tick: 1 });
          float(w, t, 'Envenenado', 'poison', 0.3);
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
    float(w, p, `+${amt}`, it.stat === 'hp' ? 'heal' : 'mana');
    emit(w, { type: 'inventory', to: p.id });
  }

  // Usar o equipar el objeto de una casilla del inventario.
  function useItem(w, p, index) {
    const slot = p.inv[index];
    if (!slot) return;
    const it = ITEMS[slot.id];
    if (it.type === 'potion') return usePotion(w, p, slot.id);
    if (it.type !== 'weapon' && it.type !== 'armor') return log(w, p, `${it.name}: ${it.desc}`, 'sys');
    if (it.cls && it.cls !== p.cls) return log(w, p, `${it.name} solo puede usarlo la clase ${CLASSES[it.cls].name}.`, 'warn');
    if (p.level < it.lvl) return log(w, p, `Necesitas nivel ${it.lvl} para equipar ${it.name}.`, 'warn');
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
    if (!nearMerchant(p)) return log(w, p, 'Acércate al Mercader Orlen para vender.', 'warn');
    const it = ITEMS[slot.id];
    const n = tradeQty(qty, slot.qty);
    const total = sellPrice(it) * n;
    p.gold += total;
    removeAt(p, index, n);
    log(w, p, `Vendes ${it.name}${n > 1 ? ` ×${n}` : ''} por ${total} oro.`, 'sys');
    emit(w, { type: 'inventory', to: p.id });
  }

  function buyItem(w, p, id, qty = 1) {
    const it = ITEMS[id];
    if (!it || !shopFor(p.cls).includes(id)) return;
    if (!nearMerchant(p)) return log(w, p, 'Acércate al Mercader Orlen para comprar.', 'warn');
    const n = it.stack ? tradeQty(qty, MAX_TRADE) : 1;
    const total = it.price * n;
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
        .map((q) => ({ id: q.id, name: q.name, cls: q.cls, sex: q.sex, level: q.level, hp: Math.round(q.hp), maxHp: q.stats.maxHp, mp: Math.round(q.mp), maxMp: q.stats.maxMp, dead: q.dead, x: Math.round(q.pos.x), z: Math.round(q.pos.z) })),
    };
  }

  // ---------- Paso de simulación ----------

  function step(w, dt) {
    w.time += dt;
    for (const p of w.players.values()) updatePlayer(w, p, dt);
    for (const m of w.mobs) updateMob(w, m, dt);
    updateProjectiles(w, dt);
    updateTimers(w, dt);
  }

  function updatePlayer(w, p, dt) {
    p.moving = false;
    if (p.invite && (p.invite.t -= dt) <= 0) p.invite = null;
    if (p.dead) return;
    for (const k in p.cds) p.cds[k] = Math.max(0, p.cds[k] - dt);
    p.buffT = Math.max(0, p.buffT - dt);
    p.shieldT = Math.max(0, p.shieldT - dt);
    if (p.shieldT <= 0) p.shield = 0;
    p.combatT = Math.max(0, p.combatT - dt);
    p.atkTimer = Math.max(0, p.atkTimer - dt);

    const rate = p.combatT > 0 ? 0.004 : inVillage(p.pos) ? 0.08 : 0.025;
    p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * rate * dt);
    p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.maxMp * rate * 1.4 * p.cdef.mpRegen * dt);

    // Agua: nadar es más lento; en aguas profundas se gasta el aire
    const depth = waterDepth(p.pos.x, p.pos.z);
    const wasDeep = p.deep;
    p.swimming = depth > SWIM_DEPTH;
    p.deep = depth > DEEP_DEPTH;
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
    const speed = SPEED * (p.swimming ? SWIM_SPEED : 1);

    const t = p.target && !p.target.dead ? p.target : null;
    if (!p.leap) p.pos.y = groundY(p.pos.x, p.pos.z); // sobre el suelo o flotando en el agua

    if (p.leap) {
      // Salto de retirada o embestida: trayecto corto sin control
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
          if (!L.hit.m.dead) {
            L.hit.m.stunT = L.hit.stun;
            float(w, L.hit.m, 'Aturdido', 'stun', 0.3);
          }
          p.autoAttack = true;
        }
      }
    } else if (p.moveDir) {
      p.moveTarget = null;
      p.autoAttack = false;
      p.queued = null;
      p.interact = null;
      p.moving = stepToward(p, { x: p.pos.x + p.moveDir.x * 5, z: p.pos.z + p.moveDir.z * 5 }, speed, dt, 0);
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
          p.atkTimer = p.cdef.atkSpeed;
          p.pendingHit = p.cdef.projectile ? 0.3 : 0.22;
          emit(w, { type: 'swing', ent: p });
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
      if (p.pendingHit <= 0 && tt && !tt.dead && d2(p.pos, tt.pos) <= reachTo(p, tt) + 0.6) {
        if (p.cdef.projectile) spawnProjectile(w, p, p.cdef.projectile, tt, 1);
        else damageMob(w, p, tt, 1);
      }
    }

    const r = Math.hypot(p.pos.x, p.pos.z);
    if (r > WORLD_LIMIT) {
      p.pos.x *= WORLD_LIMIT / r;
      p.pos.z *= WORLD_LIMIT / r;
      p.pos.y = groundY(p.pos.x, p.pos.z);
    }
  }

  function updateMob(w, m, dt) {
    m.moving = false;
    if (m.dead) {
      m.deadT -= dt;
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

    // Veneno: un golpe por segundo
    for (let i = m.dots.length - 1; i >= 0; i--) {
      const d = m.dots[i];
      d.left -= dt;
      d.tick -= dt;
      if (d.tick <= 0) {
        d.tick += 1;
        const dmg = Math.max(1, Math.round(d.perSec));
        m.hp -= dmg;
        float(w, m, `${dmg}`, 'poison');
        if (m.hp <= 0 && w.players.has(d.owner.id)) {
          killMob(w, d.owner, m);
          return;
        }
      }
      if (d.left <= 0) m.dots.splice(i, 1);
    }

    // Aturdido: no se mueve ni ataca
    if (m.stunT > 0) {
      m.stunT -= dt;
      return;
    }

    const fromHome = d2(m.pos, m.spawn);
    if (m.state !== 'return') {
      const a = m.aggro;
      if (a && (a.dead || !w.players.has(a.id) || fromHome > LEASH_R || inVillage(a.pos))) {
        dropAggro(m);
      } else if (!a && m.def.aggressive && near && nearD < AGGRO_R && !inVillage(near.pos) && m.lvl >= near.level - 8) {
        m.aggro = near;
      }
    }

    const spd = (m.def.speed || 5) * (m.slowT > 0 ? 0.45 : 1);
    if (m.state === 'return') {
      m.moving = stepToward(m, m.spawn, (m.def.speed || 5) * 1.4, dt, 0.8);
      // Recupera vida de a poco mientras vuelve; completa solo al llegar
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * RETURN_HEAL * dt);
      if (!m.moving) {
        m.state = 'idle';
        m.hp = m.maxHp;
      }
    } else if (m.aggro) {
      const p = m.aggro;
      const reach = 1.5 + (m.def.scale || 1) * 0.6;
      if (d2(m.pos, p.pos) > reach) {
        m.moving = stepToward(m, p.pos, spd, dt, reach * 0.9);
      } else {
        face(m, p.pos.x, p.pos.z, dt);
        m.atkTimer -= dt;
        if (m.atkTimer <= 0) {
          m.atkTimer = m.def.boss ? 1.8 : 1.6;
          emit(w, { type: 'swing', ent: m });
          mobHitsPlayer(w, m, p);
        }
      }
    } else {
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
    cmd: {
      setTarget, attack, targetNearest, moveTo, setMoveDir, talkTo, useSkill, usePotion, useItem, sellItem, buyItem, unequip, respawn,
      partyInvite, partyAnswer, partyLeave, partyKick,
    },
  };
});
