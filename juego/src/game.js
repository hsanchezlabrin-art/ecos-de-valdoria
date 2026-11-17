// Cliente del juego: conecta la simulación con lo que se ve.
//
// Dos modos:
//  · Un jugador: la simulación (sim.js) corre aquí mismo.
//  · En línea: la simulación corre en el servidor. Este archivo envía las acciones del
//    jugador, recibe el estado de lo que tiene cerca 10 veces por segundo, lo suaviza
//    (interpolación) y dibuja los eventos (daño, botín, efectos) igual que en un jugador.
(function () {
  const G = V.G;
  const Sim = V.Sim;
  const { buildHumanoid, buildQuadruped, animateModel, animateDeath, setWeaponLook, setArmorLook } = V.Models;
  const { heightAt } = V.Terrain;
  const { ITEMS, CLASSES, MOBS } = V.Data;
  const UI = new Proxy({}, { get: (_, k) => V.UI[k] }); // ui.js se carga después

  const THREE = window.THREE;
  const C = Sim.cmd;
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  let online = false;
  let P = null; // jugador local (en línea: su reflejo)

  // Un jugador
  const W = Sim.createWorld();
  G.sim = W;

  // En línea
  const net = {
    ws: null,
    myId: null,
    players: new Map(),
    mobs: new Map(),
    projectiles: new Map(),
    queue: [],
    count: 0,
    lastSave: null,
    sentDir: null,
    onSave: null,
    onLost: null,
  };
  const PROJ_SPEED = { arrow: 38, fire: 24, arcane: 26 };

  // ---------- Vistas (modelo 3D + estado de animación) ----------

  function attachView(ent, model) {
    ent.model = model;
    ent.view = { walkBlend: 0, atkAnim: 0, deathK: 0, phase: Math.random() * 10 };
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

  // ---------- Un jugador ----------

  const newCharacter = (name, cls) => Sim.newCharacter(name, cls);

  function createPlayer(data) {
    online = false;
    P = Sim.addPlayer(W, data, 'local');
    attachView(P, buildHumanoid(CLASSES[P.cls].look));
    applyEquip(P);
    G.player = P;
    return P;
  }

  function spawnMobs() {
    if (online) return;
    Sim.spawnMobs(W);
    for (const m of W.mobs) {
      attachView(m, m.def.kind === 'quad' ? buildQuadruped(m.def) : buildHumanoid(m.def));
      m.model.root.traverse((o) => (o.userData.mob = m));
      UI.createNameplate(m);
    }
    G.mobs = W.mobs;
  }

  const serialize = () => (online ? net.lastSave : Sim.serialize(P));

  // ---------- En línea: conexión ----------

  function send(msg) {
    if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(msg));
  }

  function startOnline({ url, name, cls, save, onSave, onLost }) {
    online = true;
    net.onSave = onSave;
    net.onLost = onLost;
    G.mobs = [];
    return new Promise((resolve, reject) => {
      let ready = false;
      const fail = (msg, code) => {
        if (ready) return;
        ready = true;
        online = false;
        try {
          net.ws.close();
        } catch {
          /* nada */
        }
        const err = new Error(msg);
        err.code = code;
        reject(err);
      };
      const timer = setTimeout(() => fail('El servidor no responde. Inténtalo más tarde.'), 12000);
      let ws;
      try {
        ws = net.ws = new WebSocket(url);
      } catch {
        return fail('No se pudo conectar con el servidor.');
      }
      ws.onopen = () => send({ t: 'join', v: V.Config.PROTOCOL, name, cls, save });
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        switch (msg.t) {
          case 'welcome':
            net.myId = msg.id;
            break;
          case 'error':
            clearTimeout(timer);
            fail(msg.msg, msg.code);
            break;
          case 's':
            applySnapshot(msg);
            if (!ready && P) {
              ready = true;
              clearTimeout(timer);
              resolve(P);
            }
            break;
          case 'e':
            net.queue.push(...msg.e);
            break;
          case 'chat':
            UI.chat(msg);
            break;
          case 'save':
            gotSave(msg.d);
            break;
        }
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!ready) fail('No se pudo conectar con el servidor.');
        else if (net.onLost) net.onLost();
      };
    });
  }

  function gotSave(d) {
    net.lastSave = d;
    if (net.onSave) net.onSave(d);
  }

  // ---------- En línea: estado recibido ----------

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

  function makeMe(row, me) {
    const cls = row[10];
    const cdef = CLASSES[cls];
    P = {
      id: row[0],
      kind: 'player',
      name: row[11],
      cls,
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
      stats: { maxHp: row[8], maxMp: 1, atk: 0, def: 0 },
      buffT: 0,
      buffPct: 0,
      buffName: '',
      shield: 0,
      shieldT: 0,
      dead: false,
    };
    attachView(P, buildHumanoid(cdef.look));
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
      if (id === net.myId && !P) makeMe(row, s.me);
      let q = net.players.get(id);
      if (!q) {
        const cdef = CLASSES[row[10]];
        q = { id, kind: 'player', name: row[11], cls: row[10], cdef, pos: { x: 0, y: 0, z: 0 }, facing: 0, height: 2.5, equip: { weapon: null, armor: null }, stats: { maxHp: row[8] } };
        net.players.set(id, q);
        attachView(q, buildHumanoid(cdef.look));
        UI.addPlayerPlate(q);
      }
      setNet(q, row[1], row[2], row[3], row[4]);
      q.moving = !!row[5];
      if (q !== P) {
        q.dead = !!row[6];
        q.hp = row[7];
        q.stats.maxHp = row[8];
        q.level = row[9];
      }
      q.leap = !!row[14];
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
      m.hidden = false;
    }
    for (const [id, m] of net.mobs) if (!seenM.has(id)) m.hidden = true;
    if (added) G.mobs = [...net.mobs.values()];

    const seenJ = new Set();
    for (const row of s.j) {
      const target = net.mobs.get(row[5]);
      if (!target) continue;
      seenJ.add(row[0]);
      let j = net.projectiles.get(row[0]);
      if (!j) {
        j = { id: row[0], kind: row[1], big: !!row[6], pos: { x: row[2], y: row[3], z: row[4] }, target };
        net.projectiles.set(j.id, j);
      }
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
      buffName: d.buffName,
      shield: d.shield,
      shieldT: d.shieldT,
      combatT: d.combatT,
    });
    if (d.dead !== P.dead) P.dead = d.dead;
    P.target = d.target ? net.mobs.get(d.target) || null : null;
    if (d.inv) {
      P.inv = d.inv;
      P.equip = d.equip;
      applyEquip(P);
      UI.refreshPanels();
    }
    if (d.save) gotSave(d.save);
    else if (wasLevel !== P.level) UI.refreshPanels();
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

  function setTarget(m) {
    if (online) {
      P.target = m && !m.dead ? m : null;
      send({ t: 'target', id: P.target ? P.target.id : null });
    } else C.setTarget(W, P, m);
    sync();
  }
  function attackTarget() {
    if (online) send({ t: 'attack' });
    else C.attack(W, P);
  }
  function targetNearest() {
    if (!online) {
      C.targetNearest(W, P);
      return sync();
    }
    const list = G.mobs.filter((m) => !m.dead && !m.hidden && d2(m.pos, P.pos) < 26).sort((a, b) => d2(a.pos, P.pos) - d2(b.pos, P.pos));
    if (!list.length) return;
    const i = list.indexOf(P.target);
    setTarget(list[(i + 1) % list.length]);
  }
  function moveTo(point) {
    if (P.dead || P.leap) return;
    if (online) send({ t: 'move', x: point.x, z: point.z });
    else C.moveTo(W, P, point);
    showMarker(point);
  }
  const act = (local, msg) => (online ? send(msg) : local());
  const talkTo = (id) => act(() => C.talkTo(W, P, id), { t: 'talk', id });
  const useSkill = (i) => act(() => C.useSkill(W, P, i), { t: 'skill', i });
  const usePotion = (id) => act(() => C.usePotion(W, P, id), { t: 'potion', id });
  const countItem = (id) => Sim.countItem(P, id);
  const clickInventory = (i) => (UI.shopOpen() ? act(() => C.sellItem(W, P, i), { t: 'sell', i }) : act(() => C.useItem(W, P, i), { t: 'use', i }));
  const unequip = (k) => act(() => C.unequip(W, P, k), { t: 'unequip', k });
  const buyItem = (id) => act(() => C.buyItem(W, P, id), { t: 'buy', id });
  const respawnPlayer = () => act(() => C.respawn(W, P), { t: 'respawn' });
  const sendChat = (text) => online && send({ t: 'chat', text });

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
        else for (let k = 0; k < 14; k++) spawnFaller('arrow', { x: ev.at.x + (Math.random() * 2 - 1) * ev.r * 0.8, y: ev.at.y, z: ev.at.z + (Math.random() * 2 - 1) * ev.r * 0.8 }, ev.dur * (0.7 + Math.random() * 0.3));
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
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb04a })));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.4, depthWrite: false })));
      return g;
    },
    arcane: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xe6d0ff })));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9a6aff, transparent: true, opacity: 0.45, depthWrite: false })));
      return g;
    },
  };
  const projMeshes = new Map();
  const tmp = new THREE.Vector3();

  function syncProjectiles() {
    const list = online ? net.projectiles.values() : W.projectiles;
    const alive = new Set();
    for (const pr of list) {
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
      mesh.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: 0x3a2a20, emissive: 0xff5a1a, emissiveIntensity: 1.3, flatShading: true })));
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.35, depthWrite: false })));
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
      e.m.scale.setScalar(0.3 + e.maxR * k);
      e.m.material.opacity = 0.9 * (1 - k);
      if (k >= 1) {
        G.scene.remove(e.m);
        e.m.material.dispose();
        effects.splice(i, 1);
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
    targetRing.visible = !!t && !t.dead && !t.hidden;
    if (targetRing.visible) {
      targetRing.position.set(t.pos.x, t.pos.y + 0.1, t.pos.z);
      targetRing.scale.setScalar(0.9 + (t.def.scale || 1) * 0.6);
      targetRing.material.color.setHex(t.def.aggressive ? 0xff5a4a : 0xf2cf5b);
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
    animateModel(ent.model, G.time + (ent.kind === 'mob' ? v.phase : 0), v.walkBlend, v.atkAnim);
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
    if (online) {
      // Solo se envía la dirección cuando cambia (redondeada) para no saturar la red
      const key = dir ? `${dir.x.toFixed(2)},${dir.z.toFixed(2)}` : '';
      if (key !== net.sentDir) {
        net.sentDir = key;
        send({ t: 'dir', d: dir });
      }
      interpolate(dt);
      const evs = net.queue.splice(0);
      for (const raw of evs) {
        const ev = resolveEvent(raw);
        if (ev) handleEvent(ev);
      }
      for (const q of net.players.values()) if (q.model) drawEntity(q, dt);
      for (const m of net.mobs.values()) if (m.model) drawEntity(m, dt);
    } else {
      C.setMoveDir(W, P, dir);
      Sim.step(W, dt);
      for (const ev of Sim.drainEvents(W)) handleEvent(ev);
      for (const p of W.players.values()) if (p.model) drawEntity(p, dt);
      for (const m of W.mobs) if (m.model) drawEntity(m, dt);
    }
    sync();
    syncProjectiles();
    updateEffects(dt);
  }

  V.Game = {
    newCharacter, createPlayer, serialize, spawnMobs, startOnline, sendChat,
    setTarget, attackTarget, targetNearest, moveTo, talkTo, useSkill, countItem, usePotion,
    clickInventory, unequip, buyItem, respawnPlayer, update,
    get online() {
      return online;
    },
    get onlineCount() {
      return net.count;
    },
  };
})();
