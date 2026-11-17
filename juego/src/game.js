// Lógica del juego: jugador, clases, monstruos, combate, objetos y progresión.
// En la versión online esta lógica pasará al servidor (autoritativo) y el cliente solo la mostrará.
(function () {
  const G = V.G;
  const { CLASSES, MOBS, ITEMS, ZONES, MAX_LEVEL, xpToNext, mobStats, playerBaseStats, sellPrice, resolveDrop } = V.Data;
  const { heightAt, inVillage, WORLD_LIMIT } = V.World;
  const { buildHumanoid, buildQuadruped, animateModel, animateDeath, setWeaponLook, setArmorLook } = V.Models;
  const UI = new Proxy({}, { get: (_, k) => V.UI[k] }); // ui.js se carga después

  const THREE = window.THREE;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  const SPEED = 7.2;
  const AGGRO_R = 9;
  const LEASH_R = 34;
  const INV_SLOTS = 30;
  const SPAWN = { x: 0, z: 5 };

  // ---------- Personaje ----------

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

  function createPlayer(data) {
    const cls = CLASSES[data.cls] ? data.cls : 'guerrero';
    const cdef = CLASSES[cls];
    const model = buildHumanoid(cdef.look);
    G.scene.add(model.root);
    const p = {
      name: data.name,
      cls,
      cdef,
      skills: cdef.skills,
      level: data.level,
      xp: data.xp,
      gold: data.gold,
      inv: data.inv.map((s) => ({ ...s })),
      equip: { ...data.equip },
      model,
      pos: model.root.position,
      facing: Math.PI,
      moveTarget: null,
      autoAttack: false,
      atkTimer: 0,
      atkAnim: 0,
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
      walkBlend: 0,
      dead: false,
      deathK: 0,
    };
    p.pos.set(data.pos.x, heightAt(data.pos.x, data.pos.z), data.pos.z);
    G.player = p;
    recalcStats();
    p.hp = Math.min(data.hp ?? p.stats.maxHp, p.stats.maxHp);
    p.mp = Math.min(data.mp ?? p.stats.maxMp, p.stats.maxMp);
    return p;
  }

  function serialize() {
    const p = G.player;
    const alive = !p.dead;
    return {
      v: 2,
      name: p.name,
      cls: p.cls,
      level: p.level,
      xp: p.xp,
      gold: p.gold,
      inv: p.inv,
      equip: p.equip,
      pos: alive ? { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2) } : { ...SPAWN },
      hp: alive ? Math.round(p.hp) : null,
      mp: alive ? Math.round(p.mp) : null,
    };
  }

  function recalcStats() {
    const p = G.player;
    const b = playerBaseStats(p.cls, p.level);
    const w = ITEMS[p.equip.weapon];
    const a = ITEMS[p.equip.armor];
    p.stats = {
      maxHp: b.maxHp + (a ? a.hp : 0),
      maxMp: b.maxMp,
      atk: b.atk + (w ? w.atk : 0),
      def: b.def + (a ? a.def : 0),
    };
    if (p.hp > p.stats.maxHp) p.hp = p.stats.maxHp;
    setWeaponLook(p.model, w);
    setArmorLook(p.model, a);
  }

  const playerAtk = () => G.player.stats.atk * (1 + (G.player.buffT > 0 ? G.player.buffPct : 0));

  // ---------- Monstruos ----------

  const zoneById = (id) => ZONES.find((z) => z.id === id);
  function randomPointInZone(z, f = 0.85) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * z.r * f;
    return { x: z.x + Math.cos(a) * r, z: z.z + Math.sin(a) * r };
  }

  function spawnMobs() {
    for (const [key, def] of Object.entries(MOBS)) {
      const z = zoneById(def.zone);
      for (let i = 0; i < def.count; i++) {
        const sp = def.boss ? { x: z.x + 4, z: z.z + 4 } : randomPointInZone(z);
        G.mobs.push(createMob(key, def, z, sp));
      }
    }
  }

  function createMob(key, def, zone, sp) {
    const model = def.kind === 'quad' ? buildQuadruped(def) : buildHumanoid(def);
    G.scene.add(model.root);
    const m = {
      key,
      def,
      zone,
      model,
      pos: model.root.position,
      spawn: new THREE.Vector3(),
      phase: Math.random() * 10,
      facing: Math.random() * Math.PI * 2,
      walkBlend: 0,
      atkAnim: 0,
      slowT: 0,
    };
    model.root.traverse((o) => (o.userData.mob = m));
    rollMob(m, sp);
    UI.createNameplate(m);
    return m;
  }

  function rollMob(m, sp) {
    m.lvl = randInt(m.def.lvl[0], m.def.lvl[1]);
    Object.assign(m, mobStats(m.def, m.lvl));
    m.hp = m.maxHp;
    m.spawn.set(sp.x, 0, sp.z);
    m.pos.set(sp.x, heightAt(sp.x, sp.z), sp.z);
    m.model.root.rotation.y = m.facing;
    m.dead = false;
    m.aggro = false;
    m.state = 'idle';
    m.wanderT = rand(0, 4);
    m.wanderTo = null;
    m.atkTimer = rand(0.6, 1.4);
    m.deathK = 0;
    m.slowT = 0;
    m.model.root.visible = true;
    m.model.rig.rotation.set(0, 0, 0);
    animateDeath(m.model, 0);
    if (m.np) UI.refreshNameplate(m);
  }

  // ---------- Movimiento ----------

  function face(ent, tx, tz, dt) {
    const target = Math.atan2(tx - ent.pos.x, tz - ent.pos.z);
    const diff = Math.atan2(Math.sin(target - ent.facing), Math.cos(target - ent.facing));
    ent.facing += diff * Math.min(1, dt * 14);
    ent.model.root.rotation.y = ent.facing;
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

  const bodyR = (m) => (m.def.scale || 1) * 0.45;
  // Distancia a la que el jugador ataca: cuerpo a cuerpo o el alcance de su arma.
  const reachTo = (m) => G.player.cdef.range + bodyR(m);

  function damageMob(m, mult) {
    const p = G.player;
    if (!m || m.dead) return;
    const r = calcDamage(playerAtk(), m.armor, mult);
    m.hp -= r.dmg;
    p.combatT = 6;
    UI.floatText(m.pos, m.model.height, r.crit ? `${r.dmg}!` : `${r.dmg}`, r.crit ? 'crit' : 'dmg');
    if (m.state === 'return') m.state = 'idle';
    m.aggro = true;
    if (m.hp <= 0) killMob(m);
  }

  function killMob(m) {
    const p = G.player;
    m.hp = 0;
    m.dead = true;
    m.aggro = false;
    m.deathK = 0;
    m.respawnTime = m.def.respawn || 22;
    m.deadT = m.respawnTime;
    if (G.target === m) {
      G.target = null;
      p.autoAttack = false;
      p.queued = null;
    }
    const diff = m.lvl - p.level;
    let xp = m.xp;
    if (diff <= -6) xp *= 0.1;
    else if (diff <= -4) xp *= 0.4;
    else if (diff >= 3) xp *= 1.2;
    xp = Math.max(1, Math.round(xp));
    const gold = randInt(m.gold[0], m.gold[1]);
    p.gold += gold;
    UI.log(`${m.def.name} ha caído. +${xp} XP · +${gold} oro`, 'sys');
    UI.floatText(m.pos, m.model.height + 0.6, `+${xp} XP`, 'xp');
    for (const [raw, chance] of m.def.drops) {
      if (Math.random() < chance) {
        const id = resolveDrop(raw, p.cls);
        if (addItem(id, 1)) UI.logLoot(id, 1);
        else UI.log('Tu inventario está lleno.', 'warn');
      }
    }
    if (m.def.boss) UI.banner(`${m.def.name} ha sido derrotado`, 'Vuelve a aparecer en 3 minutos');
    gainXp(xp);
    UI.refreshPanels();
  }

  function mobHitsPlayer(m) {
    const p = G.player;
    if (p.dead || p.leap) return;
    const r = calcDamage(m.atk, p.stats.def);
    let dmg = r.dmg;
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg -= absorbed;
      if (p.shield <= 0) p.shieldT = 0;
      if (absorbed) UI.floatText(p.pos, p.model.height, `(${absorbed})`, 'mana');
    }
    p.combatT = 6;
    if (dmg <= 0) return;
    p.hp -= dmg;
    UI.floatText(p.pos, p.model.height, `-${dmg}`, 'hurt');
    if (!G.target) setTarget(m);
    if (p.hp <= 0) killPlayer(m);
  }

  function killPlayer(m) {
    const p = G.player;
    p.hp = 0;
    p.dead = true;
    p.deathK = 0;
    p.autoAttack = false;
    p.queued = null;
    p.moveTarget = null;
    p.shield = 0;
    G.target = null;
    for (const mob of G.mobs) {
      if (mob.aggro) {
        mob.aggro = false;
        mob.state = 'return';
      }
    }
    UI.log(`Has caído ante ${m.def.name}.`, 'warn');
    UI.showDeath(true);
  }

  function respawnPlayer() {
    const p = G.player;
    const loss = p.level >= MAX_LEVEL ? 0 : Math.floor(xpToNext(p.level) * 0.05);
    p.xp = Math.max(0, p.xp - loss);
    p.dead = false;
    p.deathK = 0;
    animateDeath(p.model, 0);
    p.pos.set(SPAWN.x, heightAt(SPAWN.x, SPAWN.z), SPAWN.z);
    p.hp = Math.round(p.stats.maxHp * 0.7);
    p.mp = Math.round(p.stats.maxMp * 0.7);
    UI.showDeath(false);
    UI.log(loss ? `Despiertas en la aldea. Pierdes ${loss} XP.` : 'Despiertas en la aldea.', 'sys');
  }

  function gainXp(xp) {
    const p = G.player;
    if (p.level >= MAX_LEVEL) return;
    p.xp += xp;
    while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      recalcStats();
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      spawnRing(p.pos, 0xffd36b, 4, 1.2);
      const unlocked = p.skills.find((s) => s.lvl === p.level);
      UI.banner(`Nivel ${p.level}`, unlocked ? `Nueva habilidad: ${unlocked.name}` : 'Tus fuerzas aumentan');
      UI.log(`Has alcanzado el nivel ${p.level}.`, 'lvl');
    }
    if (p.level >= MAX_LEVEL) p.xp = 0;
  }

  // ---------- Objetivo y acciones ----------

  function setTarget(m) {
    G.target = m;
    if (!m) {
      G.player.autoAttack = false;
      G.player.queued = null;
    }
  }

  function attackTarget() {
    const p = G.player;
    if (p.dead || !G.target || G.target.dead) return;
    p.autoAttack = true;
    p.moveTarget = null;
    p.interact = null;
  }

  function targetNearest() {
    const p = G.player;
    const list = G.mobs
      .filter((m) => !m.dead && d2(m.pos, p.pos) < 26)
      .sort((a, b) => d2(a.pos, p.pos) - d2(b.pos, p.pos));
    if (!list.length) return;
    const i = list.indexOf(G.target);
    setTarget(list[(i + 1) % list.length]);
  }

  function moveTo(point, interact = null) {
    const p = G.player;
    if (p.dead || p.leap) return;
    p.moveTarget = new THREE.Vector3(point.x, 0, point.z);
    p.autoAttack = false;
    p.queued = null;
    p.interact = interact;
    if (!interact) showMarker(point);
  }

  // ---------- NPCs ----------

  const npcById = (id) => G.world.npcs.find((n) => n.id === id);

  function talkTo(id) {
    const p = G.player;
    const npc = npcById(id);
    if (!npc || p.dead) return;
    const np = npc.root.position;
    if (d2(p.pos, np) < 4) {
      p.moveTarget = null;
      face(p, np.x, np.z, 1);
      interactWith(npc);
    } else {
      const dir = new THREE.Vector3(p.pos.x - np.x, 0, p.pos.z - np.z).normalize().multiplyScalar(2.6);
      moveTo({ x: np.x + dir.x, z: np.z + dir.z }, id);
    }
  }

  function interactWith(npc) {
    const p = G.player;
    if (npc.id === 'mercader') return UI.openShop();
    if (npc.id === 'sanadora') {
      if (p.combatT > 0) return UI.log('Ilwen: «Primero aléjate del peligro, viajero.»', 'npc');
      const full = p.hp >= p.stats.maxHp && p.mp >= p.stats.maxMp;
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      spawnRing(p.pos, 0x7fe0b0, 3, 0.9);
      return UI.log(full ? 'Ilwen: «Tu luz ya está completa. Ve con cuidado.»' : 'Ilwen: «Que la luz del cristal cierre tus heridas.» Vida y maná restaurados.', 'npc');
    }
    if (npc.id === 'capitana') {
      const field = ZONES.filter((z) => !z.safe);
      const lv = p.level;
      const rec = field.find((z) => {
        const [a, b] = z.lvl.split(' ')[0].split('–').map(Number);
        return lv >= a - 1 && lv <= b;
      }) || field[field.length - 1];
      const tips = {
        guerrero: 'Usa Torbellino cuando te rodeen y guarda Segundo Aliento para los apuros.',
        arquera: 'Dispara desde lejos y usa Salto de Retirada si algo te alcanza. Nunca dejes que te rodeen.',
        mago: 'Lanza el Escudo Arcano antes de atacar y congela a los grupos con la Nova de Escarcha.',
      };
      UI.log(`Brisa: «A tu nivel te recomiendo ${rec.name} (nivel ${rec.lvl}). ${tips[p.cls]}»`, 'npc');
    }
  }

  // ---------- Habilidades ----------

  function useSkill(i) {
    const p = G.player;
    const s = p.skills[i];
    if (p.dead || !s || p.leap) return;
    if (p.level < s.lvl) return UI.log(`${s.name} se desbloquea en el nivel ${s.lvl}.`, 'warn');
    if ((p.cds[s.id] || 0) > 0) return;
    if (p.mp < s.mp) return UI.log('No tienes suficiente maná.', 'warn');
    if (s.type === 'dmg' || s.type === 'area' || s.type === 'leap') {
      const t = G.target;
      if (!t || t.dead) return UI.log('Primero elige un objetivo.', 'warn');
      if (s.range && d2(p.pos, t.pos) > s.range + bodyR(t)) {
        p.queued = i;
        p.autoAttack = true;
        p.moveTarget = null;
        return;
      }
    }
    castSkill(i);
  }

  function castSkill(i) {
    const p = G.player;
    const s = p.skills[i];
    if (p.mp < s.mp) return;
    p.mp -= s.mp;
    p.cds[s.id] = s.cd;
    p.atkAnim = 1;
    const t = G.target;
    if (s.type === 'dmg') {
      if (s.proj) {
        spawnProjectile(s.proj, t, s.mult, true);
      } else {
        spawnRing(t.pos, 0xffc46b, 1.8, 0.4);
        damageMob(t, s.mult);
      }
      if (G.target) p.autoAttack = true;
    } else if (s.type === 'area') {
      const at = { x: t.pos.x, y: t.pos.y, z: t.pos.z };
      if (s.fx === 'meteor') spawnFaller('meteor', at, s.delay);
      else for (let k = 0; k < 14; k++) spawnFaller('arrow', { x: at.x + rand(-1, 1) * s.radius * 0.8, y: at.y, z: at.z + rand(-1, 1) * s.radius * 0.8 }, s.delay * rand(0.7, 1));
      later(s.delay, () => {
        spawnRing(at, s.fx === 'meteor' ? 0xff6a2a : 0xe8dcc2, s.radius, 0.6);
        for (const m of G.mobs) if (!m.dead && d2(m.pos, at) <= s.radius + bodyR(m)) damageMob(m, s.mult);
      });
      if (G.target) p.autoAttack = true;
    } else if (s.type === 'aoe') {
      spawnRing(p.pos, s.slow ? 0x9fd8ff : 0xff8a3d, s.radius, 0.5);
      for (const m of G.mobs) {
        if (m.dead || d2(m.pos, p.pos) > s.radius + bodyR(m)) continue;
        damageMob(m, s.mult);
        if (s.slow) m.slowT = s.slow;
      }
    } else if (s.type === 'heal') {
      const amt = Math.round(p.stats.maxHp * s.amount);
      p.hp = Math.min(p.stats.maxHp, p.hp + amt);
      UI.floatText(p.pos, p.model.height, `+${amt}`, 'heal');
      spawnRing(p.pos, 0x7fe08a, 2.4, 0.7);
    } else if (s.type === 'buff') {
      p.buffT = s.dur;
      p.buffPct = s.pct;
      p.buffName = s.name;
      spawnRing(p.pos, 0xffd36b, 3, 0.8);
      UI.log(`${s.name}: +${Math.round(s.pct * 100)}% de ataque durante ${s.dur} s.`, 'sys');
    } else if (s.type === 'shield') {
      p.shield = Math.round(p.stats.maxHp * s.amount);
      p.shieldT = s.dur;
      spawnRing(p.pos, 0x8fb8ff, 2.6, 0.8);
      UI.log(`${s.name}: absorbe ${p.shield} de daño durante ${s.dur} s.`, 'sys');
    } else if (s.type === 'leap') {
      const away = new THREE.Vector3(p.pos.x - t.pos.x, 0, p.pos.z - t.pos.z);
      if (away.lengthSq() < 0.01) away.set(-Math.sin(p.facing), 0, -Math.cos(p.facing));
      away.normalize().multiplyScalar(s.dist);
      p.leap = { fx: p.pos.x, fz: p.pos.z, tx: p.pos.x + away.x, tz: p.pos.z + away.z, t: 0, dur: 0.35 };
      t.slowT = s.slow;
      spawnRing(p.pos, 0xb6e08a, 1.8, 0.5);
      p.moveTarget = null;
    }
  }

  // ---------- Inventario y tienda ----------

  const countItem = (id) => G.player.inv.filter((s) => s.id === id).reduce((a, s) => a + s.qty, 0);

  function addItem(id, qty = 1) {
    const p = G.player;
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

  function removeAt(index, qty = 1) {
    const p = G.player;
    const slot = p.inv[index];
    slot.qty -= qty;
    if (slot.qty <= 0) p.inv.splice(index, 1);
  }

  function usePotion(id) {
    const p = G.player;
    if (p.dead || (p.cds.pot || 0) > 0) return;
    const i = p.inv.findIndex((s) => s.id === id);
    if (i < 0) return UI.log(`No te quedan ${ITEMS[id].name.toLowerCase()}s.`, 'warn');
    const it = ITEMS[id];
    const max = it.stat === 'hp' ? p.stats.maxHp : p.stats.maxMp;
    const amt = Math.round(max * it.amount);
    p[it.stat] = Math.min(max, p[it.stat] + amt);
    p.cds.pot = 1;
    removeAt(i);
    UI.floatText(p.pos, p.model.height, `+${amt}`, it.stat === 'hp' ? 'heal' : 'mana');
    UI.refreshPanels();
  }

  function clickInventory(index) {
    const p = G.player;
    const slot = p.inv[index];
    if (!slot) return;
    const it = ITEMS[slot.id];
    if (UI.shopOpen()) {
      const price = sellPrice(it);
      p.gold += price;
      removeAt(index);
      UI.log(`Vendes ${it.name} por ${price} oro.`, 'sys');
    } else if (it.type === 'potion') {
      usePotion(slot.id);
    } else if (it.type === 'weapon' || it.type === 'armor') {
      if (it.cls && it.cls !== p.cls) return UI.log(`${it.name} solo puede usarlo la clase ${CLASSES[it.cls].name}.`, 'warn');
      if (p.level < it.lvl) return UI.log(`Necesitas nivel ${it.lvl} para equipar ${it.name}.`, 'warn');
      const key = it.type;
      const prev = p.equip[key];
      p.inv.splice(index, 1);
      if (prev) p.inv.splice(index, 0, { id: prev, qty: 1 });
      p.equip[key] = slot.id;
      recalcStats();
      UI.log(`Te equipas ${it.name}.`, 'sys');
    }
    UI.refreshPanels();
  }

  function unequip(key) {
    const p = G.player;
    const id = p.equip[key];
    if (!id) return;
    if (!addItem(id, 1)) return UI.log('No hay espacio en el inventario.', 'warn');
    p.equip[key] = null;
    recalcStats();
    UI.refreshPanels();
  }

  function buyItem(id) {
    const p = G.player;
    const it = ITEMS[id];
    if (p.gold < it.price) return UI.log('No tienes oro suficiente.', 'warn');
    if (!addItem(id, 1)) return UI.log('No hay espacio en el inventario.', 'warn');
    p.gold -= it.price;
    UI.logLoot(id, 1, 'Compras');
    UI.refreshPanels();
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

  // Temporizadores sencillos (daño retardado de Lluvia de Flechas y Meteoro)
  const timers = [];
  const later = (t, fn) => timers.push({ t, fn });

  // Proyectiles: flechas, bolas de fuego y proyectiles arcanos
  const PROJ = {
    arrow: { speed: 38, make: () => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 4), new THREE.MeshBasicMaterial({ color: 0x8a6a44 }));
      shaft.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), new THREE.MeshBasicMaterial({ color: 0xd8dde4 }));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.55;
      g.add(shaft, tip);
      return g;
    } },
    fire: { speed: 24, make: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb04a })));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.4, depthWrite: false }));
      g.add(halo);
      return g;
    } },
    arcane: { speed: 26, make: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xe6d0ff })));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9a6aff, transparent: true, opacity: 0.45, depthWrite: false })));
      return g;
    } },
  };
  const projectiles = [];

  function spawnProjectile(kind, target, mult, big = false) {
    const p = G.player;
    const def = PROJ[kind];
    const mesh = def.make();
    if (big) mesh.scale.setScalar(1.35);
    mesh.position.set(p.pos.x + Math.sin(p.facing) * 0.7, p.pos.y + 1.7, p.pos.z + Math.cos(p.facing) * 0.7);
    G.scene.add(mesh);
    projectiles.push({ mesh, target, mult, kind, speed: def.speed });
  }

  // Objetos que caen del cielo: flechas de la lluvia o el meteoro
  const fallers = [];
  function spawnFaller(kind, at, dur) {
    let mesh;
    if (kind === 'meteor') {
      mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: 0x3a2a20, emissive: 0xff5a1a, emissiveIntensity: 1.3, flatShading: true })));
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.35, depthWrite: false })));
    } else {
      mesh = PROJ.arrow.make();
      mesh.rotation.x = Math.PI / 2;
    }
    const h = kind === 'meteor' ? 22 : 12;
    const off = kind === 'meteor' ? 8 : 0;
    G.scene.add(mesh);
    fallers.push({ mesh, from: new THREE.Vector3(at.x - off, at.y + h, at.z - off), to: new THREE.Vector3(at.x, at.y, at.z), t: 0, dur });
  }

  const tmp = new THREE.Vector3();
  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.t += dt;
      const k = e.t / e.life;
      e.m.scale.setScalar(0.3 + e.maxR * k);
      e.m.material.opacity = 0.9 * (1 - k);
      if (k >= 1) {
        G.scene.remove(e.m);
        e.m.material.dispose();
        effects.splice(i, 1);
      }
    }
    for (let i = timers.length - 1; i >= 0; i--) {
      timers[i].t -= dt;
      if (timers[i].t <= 0) {
        const fn = timers[i].fn;
        timers.splice(i, 1);
        fn();
      }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      const t = pr.target;
      if (!t || t.dead) {
        G.scene.remove(pr.mesh);
        projectiles.splice(i, 1);
        continue;
      }
      tmp.set(t.pos.x, t.pos.y + t.model.height * 0.5, t.pos.z);
      const dist = pr.mesh.position.distanceTo(tmp);
      const step = pr.speed * dt;
      if (dist <= step + 0.3) {
        G.scene.remove(pr.mesh);
        projectiles.splice(i, 1);
        if (pr.kind === 'fire') spawnRing(t.pos, 0xff7a2a, 1.6, 0.4);
        damageMob(t, pr.mult);
        continue;
      }
      pr.mesh.lookAt(tmp);
      pr.mesh.position.addScaledVector(tmp.sub(pr.mesh.position).normalize(), step);
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
    targetRing.visible = !!t && !t.dead;
    if (targetRing.visible) {
      targetRing.position.set(t.pos.x, t.pos.y + 0.1, t.pos.z);
      targetRing.scale.setScalar(0.9 + (t.def.scale || 1) * 0.6);
      targetRing.material.color.setHex(t.def.aggressive ? 0xff5a4a : 0xf2cf5b);
    }
    const p = G.player;
    if (!shieldBubble) {
      shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0.18, depthWrite: false }));
      G.scene.add(shieldBubble);
    }
    shieldBubble.visible = p.shield > 0 && !p.dead;
    if (shieldBubble.visible) {
      shieldBubble.position.set(p.pos.x, p.pos.y + 1.3, p.pos.z);
      shieldBubble.material.opacity = 0.14 + Math.sin(G.time * 5) * 0.05;
    }
  }

  // ---------- Bucle ----------

  function update(dt) {
    updatePlayer(dt);
    for (const m of G.mobs) updateMob(m, dt);
    updateEffects(dt);
  }

  function updatePlayer(dt) {
    const p = G.player;
    if (p.dead) {
      p.deathK = Math.min(1, p.deathK + dt * 2.5);
      animateDeath(p.model, p.deathK);
      return;
    }
    for (const k in p.cds) p.cds[k] = Math.max(0, p.cds[k] - dt);
    p.buffT = Math.max(0, p.buffT - dt);
    p.shieldT = Math.max(0, p.shieldT - dt);
    if (p.shieldT <= 0) p.shield = 0;
    p.combatT = Math.max(0, p.combatT - dt);
    p.atkTimer = Math.max(0, p.atkTimer - dt);

    const village = inVillage(p.pos);
    const rate = p.combatT > 0 ? 0.004 : village ? 0.08 : 0.025;
    p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * rate * dt);
    p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.maxMp * rate * 1.4 * p.cdef.mpRegen * dt);

    let moving = false;
    const t = G.target;

    if (p.leap) {
      // Salto de retirada: arco corto hacia atrás, sin control durante el salto.
      const L = p.leap;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      p.pos.x = L.fx + (L.tx - L.fx) * k;
      p.pos.z = L.fz + (L.tz - L.fz) * k;
      p.pos.y = heightAt(p.pos.x, p.pos.z) + Math.sin(Math.PI * k) * 1.4;
      if (t && !t.dead) face(p, t.pos.x, t.pos.z, dt);
      if (k >= 1) p.leap = null;
    } else {
      const k = G.keys;
      const ix = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      const iz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);

      if (ix || iz) {
        p.moveTarget = null;
        p.autoAttack = false;
        p.queued = null;
        p.interact = null;
        const yaw = G.cam.yaw;
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        let dx = fx * iz - fz * ix;
        let dz = fz * iz + fx * ix;
        const len = Math.hypot(dx, dz);
        dx /= len;
        dz /= len;
        stepToward(p, { x: p.pos.x + dx * 5, z: p.pos.z + dz * 5 }, SPEED, dt, 0);
        moving = true;
      } else if (p.autoAttack && t && !t.dead) {
        const want = p.queued != null ? p.skills[p.queued].range + bodyR(t) : reachTo(t);
        if (d2(p.pos, t.pos) > want) {
          moving = stepToward(p, t.pos, SPEED, dt, want * 0.85);
        } else {
          face(p, t.pos.x, t.pos.z, dt);
          if (p.queued != null) {
            const q = p.queued;
            p.queued = null;
            castSkill(q);
          } else if (p.atkTimer <= 0 && p.pendingHit <= 0) {
            p.atkTimer = p.cdef.atkSpeed;
            p.atkAnim = 1;
            p.pendingHit = p.cdef.projectile ? 0.3 : 0.22;
          }
        }
      } else if (p.moveTarget) {
        moving = stepToward(p, p.moveTarget, SPEED, dt, 0.15);
        if (!moving) {
          p.moveTarget = null;
          if (p.interact) {
            const npc = npcById(p.interact);
            if (npc) interactWith(npc);
          }
          p.interact = null;
        }
      }
    }

    if (p.pendingHit > 0) {
      p.pendingHit -= dt;
      const tt = G.target;
      if (p.pendingHit <= 0 && tt && !tt.dead && d2(p.pos, tt.pos) <= reachTo(tt) + 0.6) {
        if (p.cdef.projectile) spawnProjectile(p.cdef.projectile, tt, 1);
        else damageMob(tt, 1);
      }
    }

    const r = Math.hypot(p.pos.x, p.pos.z);
    if (r > WORLD_LIMIT) {
      p.pos.x *= WORLD_LIMIT / r;
      p.pos.z *= WORLD_LIMIT / r;
      p.pos.y = heightAt(p.pos.x, p.pos.z);
    }

    p.atkAnim = Math.max(0, p.atkAnim - dt * 2.4);
    p.walkBlend += ((moving ? 1 : 0) - p.walkBlend) * Math.min(1, dt * 10);
    animateModel(p.model, G.time, p.walkBlend, p.atkAnim);
  }

  function updateMob(m, dt) {
    const p = G.player;
    if (m.dead) {
      m.deathK = Math.min(1, m.deathK + dt * 2.5);
      animateDeath(m.model, m.deathK);
      m.deadT -= dt;
      if (m.model.root.visible && m.deadT < m.respawnTime - 4) m.model.root.visible = false;
      if (m.deadT <= 0) rollMob(m, m.def.boss ? m.spawn : randomPointInZone(m.zone));
      return;
    }

    const dp = d2(m.pos, p.pos);
    if (dp > 90 && !m.aggro && m.state !== 'return') return; // lejos: no simular
    m.slowT = Math.max(0, m.slowT - dt);

    const fromHome = d2(m.pos, m.spawn);
    if (m.state !== 'return') {
      if (m.aggro && (p.dead || fromHome > LEASH_R || inVillage(p.pos))) {
        m.aggro = false;
        m.state = 'return';
      } else if (!m.aggro && m.def.aggressive && !p.dead && dp < AGGRO_R && !inVillage(p.pos) && m.lvl >= p.level - 8) {
        m.aggro = true;
      }
    }

    let moving = false;
    const spd = (m.def.speed || 5) * (m.slowT > 0 ? 0.45 : 1);
    if (m.state === 'return') {
      moving = stepToward(m, m.spawn, (m.def.speed || 5) * 1.4, dt, 0.8);
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.5 * dt);
      if (!moving) {
        m.state = 'idle';
        m.hp = m.maxHp;
      }
    } else if (m.aggro) {
      const reach = 1.5 + (m.def.scale || 1) * 0.6;
      if (dp > reach) {
        moving = stepToward(m, p.pos, spd, dt, reach * 0.9);
      } else {
        face(m, p.pos.x, p.pos.z, dt);
        m.atkTimer -= dt;
        if (m.atkTimer <= 0) {
          m.atkTimer = m.def.boss ? 1.8 : 1.6;
          m.atkAnim = 1;
          mobHitsPlayer(m);
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
        moving = stepToward(m, m.wanderTo, spd * 0.35, dt, 0.3);
        if (!moving) m.wanderTo = null;
      }
    }

    m.atkAnim = Math.max(0, m.atkAnim - dt * 2.2);
    m.walkBlend += ((moving ? 1 : 0) - m.walkBlend) * Math.min(1, dt * 8);
    animateModel(m.model, G.time + m.phase, m.walkBlend, m.atkAnim);
  }

  V.Game = {
    newCharacter, createPlayer, serialize, recalcStats, spawnMobs, setTarget, attackTarget, targetNearest, moveTo,
    talkTo, useSkill, countItem, addItem, usePotion, clickInventory, unequip, buyItem, respawnPlayer, update,
  };
})();
