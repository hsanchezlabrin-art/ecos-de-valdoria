// Simulación del juego, sin gráficos ni interfaz: jugadores, monstruos, combate,
// habilidades, objetos y progresión. Es la misma lógica que correrá el servidor online
// (Node), por eso no usa THREE, document ni window.
//
// Modelo: un "mundo" con varios jugadores. Los comandos (moverse, atacar, usar
// habilidad…) cambian el estado; step(world, dt) avanza el tiempo; todo lo que ocurre
// se anota como eventos (daño, botín, mensajes, efectos) que el cliente dibuja y que el
// servidor reenviará a cada jugador. Los eventos con `to` son solo para ese jugador.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'), require('./terrain.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    V.Sim = factory(V.Data, V.Terrain);
  }
})(function (Data, Terrain) {
  const { CLASSES, MOBS, ITEMS, ZONES, NPCS, MAX_LEVEL, xpToNext, mobStats, playerBaseStats, sellPrice, resolveDrop, shopFor } = Data;
  const { heightAt, inVillage, WORLD_LIMIT } = Terrain;

  const SPEED = 7.2;
  const AGGRO_R = 9;
  const LEASH_R = 34;
  const ACTIVE_R = 90; // los monstruos lejos de todo jugador no se simulan
  const INV_SLOTS = 30;
  const TALK_R = 4;
  const SHOP_R = 8;
  const SPAWN = { x: 0, z: 5 };
  const PROJ_SPEED = { arrow: 38, fire: 24, arcane: 26 };

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const bodyR = (m) => (m.def.scale || 1) * 0.45;

  // ---------- Mundo y eventos ----------

  function createWorld() {
    return { time: 0, nextId: 1, players: new Map(), mobs: [], projectiles: [], timers: [], events: [] };
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
  const alivePlayers = (w) => [...w.players.values()].filter((p) => !p.dead);

  // ---------- Jugadores ----------

  function newCharacter(name, cls) {
    const c = CLASSES[cls];
    return {
      name,
      cls,
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
      cdef,
      skills: cdef.skills,
      level: data.level,
      xp: data.xp,
      gold: data.gold,
      inv: data.inv.map((s) => ({ ...s })),
      equip: { ...data.equip },
      pos: { x: data.pos.x, y: heightAt(data.pos.x, data.pos.z), z: data.pos.z },
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
      buffName: '',
      shield: 0,
      shieldT: 0,
      leap: null,
      combatT: 0,
      queued: null,
      interact: null,
      dead: false,
      hp: 0,
      mp: 0,
    };
    w.players.set(id, p);
    recalcStats(w, p);
    p.hp = Math.min(data.hp ?? p.stats.maxHp, p.stats.maxHp);
    p.mp = Math.min(data.mp ?? p.stats.maxMp, p.stats.maxMp);
    return p;
  }

  function removePlayer(w, id) {
    const p = w.players.get(id);
    if (!p) return;
    w.players.delete(id);
    for (const m of w.mobs) if (m.aggro === p) dropAggro(m);
  }

  function serialize(p) {
    const alive = !p.dead;
    return {
      v: 2,
      name: p.name,
      cls: p.cls,
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
    };
    if (p.hp > p.stats.maxHp) p.hp = p.stats.maxHp;
    emit(w, { type: 'equip', ent: p });
  }

  const playerAtk = (p) => p.stats.atk * (1 + (p.buffT > 0 ? p.buffPct : 0));
  const reachTo = (p, m) => p.cdef.range + bodyR(m);

  // ---------- Monstruos ----------

  const zoneById = (id) => ZONES.find((z) => z.id === id);
  function randomPointInZone(z, f = 0.85) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * z.r * f;
    return { x: z.x + Math.cos(a) * r, z: z.z + Math.sin(a) * r };
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
    m.pos.y = heightAt(sp.x, sp.z);
    m.dead = false;
    m.aggro = null;
    m.state = 'idle';
    m.wanderT = rand(0, 4);
    m.wanderTo = null;
    m.atkTimer = rand(0.6, 1.4);
    m.slowT = 0;
    m.deadT = 0;
    emit(w, { type: 'mobSpawn', ent: m });
  }

  function dropAggro(m) {
    m.aggro = null;
    m.state = 'return';
  }

  // ---------- Movimiento ----------

  function face(ent, tx, tz, dt) {
    const target = Math.atan2(tx - ent.pos.x, tz - ent.pos.z);
    const diff = Math.atan2(Math.sin(target - ent.facing), Math.cos(target - ent.facing));
    ent.facing += diff * Math.min(1, dt * 14);
  }

  function stepToward(ent, target, speed, dt, stopDist) {
    const dx = target.x - ent.pos.x;
    const dz = target.z - ent.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= stopDist) return false;
    const step = Math.min(speed * dt, dist - stopDist);
    ent.pos.x += (dx / dist) * step;
    ent.pos.z += (dz / dist) * step;
    ent.pos.y = heightAt(ent.pos.x, ent.pos.z);
    face(ent, target.x, target.z, dt);
    return true;
  }

  // ---------- Combate ----------

  function calcDamage(atk, def, mult = 1) {
    let dmg = atk * mult * (0.85 + Math.random() * 0.3) - def * 0.5;
    const crit = Math.random() < 0.1;
    if (crit) dmg *= 1.8;
    return { dmg: Math.max(1, Math.round(dmg)), crit };
  }

  function damageMob(w, p, m, mult) {
    if (!m || m.dead) return;
    const r = calcDamage(playerAtk(p), m.armor, mult);
    m.hp -= r.dmg;
    p.combatT = 6;
    float(w, m, r.crit ? `${r.dmg}!` : `${r.dmg}`, r.crit ? 'crit' : 'dmg');
    if (m.state === 'return') m.state = 'idle';
    if (!m.aggro || m.aggro.dead) m.aggro = p;
    if (m.hp <= 0) killMob(w, p, m);
  }

  function killMob(w, p, m) {
    m.hp = 0;
    m.dead = true;
    m.aggro = null;
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
    const diff = m.lvl - p.level;
    let xp = m.xp;
    if (diff <= -6) xp *= 0.1;
    else if (diff <= -4) xp *= 0.4;
    else if (diff >= 3) xp *= 1.2;
    xp = Math.max(1, Math.round(xp));
    const gold = randInt(m.gold[0], m.gold[1]);
    p.gold += gold;
    log(w, p, `${m.def.name} ha caído. +${xp} XP · +${gold} oro`, 'sys');
    float(w, m, `+${xp} XP`, 'xp', 0.6);
    for (const [raw, chance] of m.def.drops) {
      if (Math.random() >= chance) continue;
      const id = resolveDrop(raw, p.cls);
      if (addItem(p, id, 1)) emit(w, { type: 'loot', to: p.id, id, qty: 1, verb: 'Obtienes' });
      else log(w, p, 'Tu inventario está lleno.', 'warn');
    }
    if (m.def.boss) emit(w, { type: 'banner', to: null, title: `${m.def.name} ha sido derrotado`, sub: 'Vuelve a aparecer en 3 minutos' });
    gainXp(w, p, xp);
    emit(w, { type: 'inventory', to: p.id });
  }

  function mobHitsPlayer(w, m, p) {
    if (p.dead || p.leap) return;
    const r = calcDamage(m.atk, p.stats.def);
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
    if (p.hp <= 0) killPlayer(w, p, m);
  }

  function killPlayer(w, p, m) {
    p.hp = 0;
    p.dead = true;
    p.autoAttack = false;
    p.queued = null;
    p.moveTarget = null;
    p.shield = 0;
    p.target = null;
    p.leap = null;
    for (const mob of w.mobs) if (mob.aggro === p) dropAggro(mob);
    log(w, p, `Has caído ante ${m.def.name}.`, 'warn');
    emit(w, { type: 'playerDeath', to: p.id, ent: p });
  }

  function respawn(w, p) {
    if (!p.dead) return;
    const loss = p.level >= MAX_LEVEL ? 0 : Math.floor(xpToNext(p.level) * 0.05);
    p.xp = Math.max(0, p.xp - loss);
    p.dead = false;
    p.pos.x = SPAWN.x;
    p.pos.z = SPAWN.z;
    p.pos.y = heightAt(SPAWN.x, SPAWN.z);
    p.hp = Math.round(p.stats.maxHp * 0.7);
    p.mp = Math.round(p.stats.maxMp * 0.7);
    emit(w, { type: 'playerRespawn', to: p.id, ent: p });
    log(w, p, loss ? `Despiertas en la aldea. Pierdes ${loss} XP.` : 'Despiertas en la aldea.', 'sys');
  }

  function gainXp(w, p, xp) {
    if (p.level >= MAX_LEVEL) return;
    p.xp += xp;
    while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      recalcStats(w, p);
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      ring(w, p.pos, 0xffd36b, 4, 1.2);
      const unlocked = p.skills.find((s) => s.lvl === p.level);
      emit(w, { type: 'banner', to: p.id, title: `Nivel ${p.level}`, sub: unlocked ? `Nueva habilidad: ${unlocked.name}` : 'Tus fuerzas aumentan' });
      log(w, p, `Has alcanzado el nivel ${p.level}.`, 'lvl');
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
  }

  // Dirección de caminar con teclado (ya en coordenadas del mundo) o null.
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
      log(w, p, `Brisa: «A tu nivel te recomiendo ${rec.name} (nivel ${rec.lvl}). ${tips[p.cls]}»`, 'npc');
    }
  }

  const nearMerchant = (p) => d2(p.pos, npcById('mercader')) < SHOP_R;

  // ---------- Habilidades ----------

  function useSkill(w, p, i) {
    const s = p.skills[i];
    if (p.dead || !s || p.leap) return;
    if (p.level < s.lvl) return log(w, p, `${s.name} se desbloquea en el nivel ${s.lvl}.`, 'warn');
    if ((p.cds[s.id] || 0) > 0) return;
    if (p.mp < s.mp) return log(w, p, 'No tienes suficiente maná.', 'warn');
    if (s.type === 'dmg' || s.type === 'area' || s.type === 'leap') {
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
      if (s.proj) spawnProjectile(w, p, s.proj, t, s.mult, true);
      else {
        ring(w, t.pos, 0xffc46b, 1.8, 0.4);
        damageMob(w, p, t, s.mult);
      }
      if (p.target) p.autoAttack = true;
    } else if (s.type === 'area') {
      const at = { x: t.pos.x, y: t.pos.y, z: t.pos.z };
      emit(w, { type: 'faller', fx: s.fx, at, r: s.radius, dur: s.delay });
      later(w, s.delay, () => {
        ring(w, at, s.fx === 'meteor' ? 0xff6a2a : 0xe8dcc2, s.radius, 0.6);
        for (const m of w.mobs) if (!m.dead && d2(m.pos, at) <= s.radius + bodyR(m)) damageMob(w, p, m, s.mult);
      });
      if (p.target) p.autoAttack = true;
    } else if (s.type === 'aoe') {
      ring(w, p.pos, s.slow ? 0x9fd8ff : 0xff8a3d, s.radius, 0.5);
      for (const m of w.mobs) {
        if (m.dead || d2(m.pos, p.pos) > s.radius + bodyR(m)) continue;
        damageMob(w, p, m, s.mult);
        if (s.slow) m.slowT = s.slow;
      }
    } else if (s.type === 'heal') {
      const amt = Math.round(p.stats.maxHp * s.amount);
      p.hp = Math.min(p.stats.maxHp, p.hp + amt);
      float(w, p, `+${amt}`, 'heal');
      ring(w, p.pos, 0x7fe08a, 2.4, 0.7);
    } else if (s.type === 'buff') {
      p.buffT = s.dur;
      p.buffPct = s.pct;
      p.buffName = s.name;
      ring(w, p.pos, 0xffd36b, 3, 0.8);
      log(w, p, `${s.name}: +${Math.round(s.pct * 100)}% de ataque durante ${s.dur} s.`, 'sys');
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
      p.leap = { fx: p.pos.x, fz: p.pos.z, tx: p.pos.x + (ax / len) * s.dist, tz: p.pos.z + (az / len) * s.dist, t: 0, dur: 0.35 };
      t.slowT = s.slow;
      ring(w, p.pos, 0xb6e08a, 1.8, 0.5);
      p.moveTarget = null;
    }
  }

  // ---------- Proyectiles y temporizadores ----------

  function spawnProjectile(w, p, kind, target, mult, big = false) {
    w.projectiles.push({
      id: `j${w.nextId++}`,
      kind,
      big,
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

  function sellItem(w, p, index) {
    const slot = p.inv[index];
    if (!slot) return;
    if (!nearMerchant(p)) return log(w, p, 'Acércate al Mercader Orlen para vender.', 'warn');
    const it = ITEMS[slot.id];
    const price = sellPrice(it);
    p.gold += price;
    removeAt(p, index);
    log(w, p, `Vendes ${it.name} por ${price} oro.`, 'sys');
    emit(w, { type: 'inventory', to: p.id });
  }

  function buyItem(w, p, id) {
    const it = ITEMS[id];
    if (!it || !shopFor(p.cls).includes(id)) return;
    if (!nearMerchant(p)) return log(w, p, 'Acércate al Mercader Orlen para comprar.', 'warn');
    if (p.gold < it.price) return log(w, p, 'No tienes oro suficiente.', 'warn');
    if (!addItem(p, id, 1)) return log(w, p, 'No hay espacio en el inventario.', 'warn');
    p.gold -= it.price;
    emit(w, { type: 'loot', to: p.id, id, qty: 1, verb: 'Compras' });
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

    const t = p.target && !p.target.dead ? p.target : null;

    if (p.leap) {
      // Salto de retirada: arco corto hacia atrás, sin control durante el salto.
      const L = p.leap;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      p.pos.x = L.fx + (L.tx - L.fx) * k;
      p.pos.z = L.fz + (L.tz - L.fz) * k;
      p.pos.y = heightAt(p.pos.x, p.pos.z) + Math.sin(Math.PI * k) * 1.4;
      if (t) face(p, t.pos.x, t.pos.z, dt);
      if (k >= 1) p.leap = null;
    } else if (p.moveDir) {
      p.moveTarget = null;
      p.autoAttack = false;
      p.queued = null;
      p.interact = null;
      p.moving = stepToward(p, { x: p.pos.x + p.moveDir.x * 5, z: p.pos.z + p.moveDir.z * 5 }, SPEED, dt, 0);
    } else if (p.autoAttack && t) {
      const want = p.queued != null ? p.skills[p.queued].range + bodyR(t) : reachTo(p, t);
      if (d2(p.pos, t.pos) > want) {
        p.moving = stepToward(p, t.pos, SPEED, dt, want * 0.85);
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
      p.moving = stepToward(p, p.moveTarget, SPEED, dt, 0.15);
      if (!p.moving) {
        p.moveTarget = null;
        const npc = p.interact && npcById(p.interact);
        p.interact = null;
        if (npc) interactWith(w, p, npc);
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
      p.pos.y = heightAt(p.pos.x, p.pos.z);
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
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.5 * dt);
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
    createWorld,
    drainEvents,
    newCharacter,
    addPlayer,
    removePlayer,
    serialize,
    spawnMobs,
    step,
    countItem,
    cmd: { setTarget, attack, targetNearest, moveTo, setMoveDir, talkTo, useSkill, usePotion, useItem, sellItem, buyItem, unequip, respawn },
  };
});
