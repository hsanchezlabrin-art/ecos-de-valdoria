// Cliente del juego: conecta la simulación (sim.js) con lo que se ve.
// Envía los comandos del jugador local, avanza la simulación y dibuja su resultado:
// modelos, animaciones, proyectiles, efectos y textos. Cuando el juego sea online,
// la simulación correrá en el servidor y este archivo recibirá su estado por la red.
(function () {
  const G = V.G;
  const Sim = V.Sim;
  const { buildHumanoid, buildQuadruped, animateModel, animateDeath, setWeaponLook, setArmorLook } = V.Models;
  const { heightAt } = V.Terrain;
  const { ITEMS, CLASSES } = V.Data;
  const UI = new Proxy({}, { get: (_, k) => V.UI[k] }); // ui.js se carga después

  const THREE = window.THREE;
  const C = Sim.cmd;

  const W = Sim.createWorld();
  let P = null; // jugador local
  G.sim = W;

  // ---------- Vistas (modelo 3D + estado de animación) ----------

  function attachView(ent, model) {
    ent.model = model;
    ent.view = { walkBlend: 0, atkAnim: 0, deathK: 0, phase: Math.random() * 10 };
    model.root.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
    model.root.rotation.y = ent.facing;
    G.scene.add(model.root);
  }

  function applyEquip(p) {
    if (!p.model) return;
    setWeaponLook(p.model, ITEMS[p.equip.weapon]);
    setArmorLook(p.model, ITEMS[p.equip.armor]);
  }

  // ---------- Jugador y monstruos ----------

  const newCharacter = (name, cls) => Sim.newCharacter(name, cls);

  function createPlayer(data) {
    P = Sim.addPlayer(W, data, 'local');
    attachView(P, buildHumanoid(CLASSES[P.cls].look));
    applyEquip(P);
    G.player = P;
    return P;
  }

  function spawnMobs() {
    Sim.spawnMobs(W);
    for (const m of W.mobs) {
      const model = m.def.kind === 'quad' ? buildQuadruped(m.def) : buildHumanoid(m.def);
      attachView(m, model);
      model.root.traverse((o) => (o.userData.mob = m));
      UI.createNameplate(m);
    }
    G.mobs = W.mobs;
  }

  const serialize = () => Sim.serialize(P);

  // ---------- Comandos del jugador local ----------

  const sync = () => (G.target = P ? P.target : null);
  function setTarget(m) {
    C.setTarget(W, P, m);
    sync();
  }
  function attackTarget() {
    C.attack(W, P);
  }
  function targetNearest() {
    C.targetNearest(W, P);
    sync();
  }
  function moveTo(point) {
    if (P.dead || P.leap) return;
    C.moveTo(W, P, point);
    showMarker(point);
  }
  const talkTo = (id) => C.talkTo(W, P, id);
  const useSkill = (i) => C.useSkill(W, P, i);
  const usePotion = (id) => C.usePotion(W, P, id);
  const countItem = (id) => Sim.countItem(P, id);
  const clickInventory = (i) => (UI.shopOpen() ? C.sellItem(W, P, i) : C.useItem(W, P, i));
  const unequip = (key) => C.unequip(W, P, key);
  const buyItem = (id) => C.buyItem(W, P, id);
  const respawnPlayer = () => C.respawn(W, P);

  // ---------- Eventos de la simulación ----------

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
      case 'mobSpawn': {
        const m = ev.ent;
        if (!m.model) break;
        m.view.deathK = 0;
        m.model.root.visible = true;
        m.model.rig.rotation.set(0, 0, 0);
        animateDeath(m.model, 0);
        if (m.np) UI.refreshNameplate(m);
        break;
      }
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
        if (mine(ev)) UI.showDeath(true);
        break;
      case 'playerRespawn':
        if (ev.ent.view) {
          ev.ent.view.deathK = 0;
          animateDeath(ev.ent.model, 0);
        }
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

  // Mallas de proyectiles: flechas, bolas de fuego y proyectiles arcanos
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
    const alive = new Set();
    for (const pr of W.projectiles) {
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

  // Lo que cae del cielo: flechas de la Lluvia de Flechas o el Meteoro (solo visual)
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
    targetRing.visible = !!t && !t.dead;
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
    root.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
    root.rotation.y = ent.facing;
    if (ent.dead) {
      v.deathK = Math.min(1, v.deathK + dt * 2.5);
      animateDeath(ent.model, v.deathK);
      if (ent.kind === 'mob' && root.visible && ent.deadT < ent.respawnTime - 4) root.visible = false;
      return;
    }
    v.atkAnim = Math.max(0, v.atkAnim - dt * (ent.kind === 'mob' ? 2.2 : 2.4));
    v.walkBlend += ((ent.moving ? 1 : 0) - v.walkBlend) * Math.min(1, dt * (ent.kind === 'mob' ? 8 : 10));
    animateModel(ent.model, G.time + (ent.kind === 'mob' ? v.phase : 0), v.walkBlend, v.atkAnim);
  }

  // ---------- Bucle ----------

  function update(dt) {
    // Teclado: dirección relativa a la cámara convertida a dirección en el mundo
    const k = G.keys;
    const ix = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const iz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    let dir = null;
    if (ix || iz) {
      const fx = -Math.sin(G.cam.yaw);
      const fz = -Math.cos(G.cam.yaw);
      const dx = fx * iz - fz * ix;
      const dz = fz * iz + fx * ix;
      const len = Math.hypot(dx, dz);
      dir = { x: dx / len, z: dz / len };
    }
    C.setMoveDir(W, P, dir);

    Sim.step(W, dt);
    for (const ev of Sim.drainEvents(W)) handleEvent(ev);
    sync();

    for (const p of W.players.values()) if (p.model) drawEntity(p, dt);
    for (const m of W.mobs) if (m.model) drawEntity(m, dt);
    syncProjectiles();
    updateEffects(dt);
  }

  V.Game = {
    newCharacter, createPlayer, serialize, spawnMobs, setTarget, attackTarget, targetNearest, moveTo,
    talkTo, useSkill, countItem, usePotion, clickInventory, unequip, buyItem, respawnPlayer, update,
  };
})();
