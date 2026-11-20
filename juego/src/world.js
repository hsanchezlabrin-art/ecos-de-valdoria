// Mundo visible: terreno, vegetación, aldea, campamentos y cielo.
// La forma del terreno (alturas, zonas) vive en terrain.js, que también usa el servidor.
(function () {
const { ZONES, NPCS } = V.Data;
const { buildHumanoid, mat } = V.Models;
const { WORLD, WORLD_LIMIT, VILLAGE_R, WATER_Y, FIELD_ZONES, OUTER_ZONES, ss, lerp, rng, pathDist, heightAt, inVillage, zoneAt, layout } = V.Terrain;

const THREE = window.THREE;

// ---------- Bloques de instancias (rendimiento) ----------
// Con el mundo grande, árboles, rocas y adornos se agrupan en bloques de CHUNK metros: cada bloque
// tiene su propia esfera envolvente, así la cámara descarta los que no ve y los que quedan más
// allá de la distancia de visión (cullChunks) ni se mandan a dibujar.
const CHUNK = 64;
const chunks = [];
const _dummy = new THREE.Object3D();
function chunked(scene, geo, material, list, place, shadows = true) {
  if (!list.length) return [];
  const groups = new Map();
  for (const t of list) {
    const k = `${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  geo.computeBoundingSphere();
  const pad = geo.boundingSphere.radius + geo.boundingSphere.center.length();
  const out = [];
  const col = new THREE.Color();
  for (const items of groups.values()) {
    const im = new THREE.InstancedMesh(geo.clone(), material, items.length);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    items.forEach((t, i) => {
      _dummy.position.set(0, 0, 0);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      place(t, _dummy);
      _dummy.updateMatrix();
      im.setMatrixAt(i, _dummy.matrix);
      if (t.c !== undefined) im.setColorAt(i, col.setHex(t.c));
      cx += _dummy.position.x;
      cy += _dummy.position.y;
      cz += _dummy.position.z;
    });
    cx /= items.length;
    cy /= items.length;
    cz /= items.length;
    let r = 0;
    for (const t of items) r = Math.max(r, Math.hypot(t.x - cx, (t.y || cy) - cy, t.z - cz));
    // El tamaño de cada instancia puede llegar a ~4 veces el de la figura base (árboles gigantes)
    im.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r + pad * 4 + 2);
    im.frustumCulled = true;
    im.castShadow = shadows;
    im.receiveShadow = true;
    scene.add(im);
    const c = { mesh: im, x: cx, z: cz, r: r + pad * 4 + 2 };
    chunks.push(c);
    out.push(im);
  }
  geo.dispose();
  return out;
}
// Oculta los bloques que quedan más lejos que la distancia de visión (la niebla ya los tapa)
function cullChunks(cam, far) {
  for (const c of chunks) {
    const vis = Math.hypot(c.x - cam.x, c.z - cam.z) - c.r < far;
    if (c.mesh.visible !== vis) c.mesh.visible = vis;
  }
}

function buildTerrain() {
  const seg = V.Gfx.SEG;
  const g = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const splat = new Float32Array(pos.count * 3);
  const Gfx = V.Gfx;
  const r = rng(11);
  const grass = [0.34, 0.49, 0.22];
  const dirt = [0.5, 0.41, 0.28];
  const rock = [0.46, 0.43, 0.38];
  const mud = [0.33, 0.3, 0.22];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = Math.sin(x * 0.31) * Math.sin(z * 0.27) * 0.035 + (r() - 0.5) * 0.04;
    let c = [grass[0] + n, grass[1] + n * 1.4, grass[2] + n];
    const mix = (to, t) => {
      c = [lerp(c[0], to[0], t), lerp(c[1], to[1], t), lerp(c[2], to[2], t)];
    };
    for (const zn of OUTER_ZONES) {
      const w = 1 - ss(zn.r * 0.55, zn.r * 1.35, Math.hypot(x - zn.x, z - zn.z));
      if (w > 0) mix(zn.tint.map((v) => v + n), w * 0.85);
    }
    const bm = V.Terrain.biome(x, z);
    if (bm.snow > 0) mix([0.86 + n, 0.9 + n, 0.95 + n], bm.snow * 0.9);
    if (bm.sand > 0) mix([0.84 + n, 0.72 + n, 0.46 + n], bm.sand * 0.85);
    for (const zn of OUTER_ZONES) {
      if (!zn.snow && zn.id !== 'desierto' && zn.id !== 'oasis') continue;
      const w = 1 - ss(zn.r * 0.55, zn.r * 1.35, Math.hypot(x - zn.x, z - zn.z));
      if (w > 0) mix(zn.tint.map((v) => v + n), w * 0.12);
    }
    const d = Math.hypot(x, z);
    mix(dirt, (1 - ss(9, 17, d)) * 0.75);
    mix(dirt, (1 - ss(1.2, 3.2, pathDist(x, z))) * 0.8);
    const isl = V.Data.ZONES.find((zz) => zz.ground > 10);
    const sky = isl ? 1 - ss(isl.r * 0.9, isl.r * 1.6, Math.hypot(x - isl.x, z - isl.z)) : 0;
    mix(rock, ss(7, 15, h) * (1 - sky * 0.9));
    mix(mud, 1 - ss(WATER_Y - 0.4, WATER_Y + 0.9, h));
    const ao = Gfx.groundAO(x, z);
    colors.set([c[0] * ao, c[1] * ao, c[2] * ao], i * 3);
    splat.set(Gfx.splatAt(x, z, h, zoneAt({ x, z })), i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('splat', new THREE.BufferAttribute(splat, 3));
  g.computeVertexNormals();
  Gfx.buildGroundMaps(colors, Gfx.grassDensityAt);
  const m = new THREE.Mesh(g, Gfx.terrainMaterial());
  m.receiveShadow = true;
  m.name = 'terrain';
  return m;
}

function buildSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), V.Gfx.skyMaterial());
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

function buildVegetation(scene) {
  const L = layout();
  let dummy = _dummy;
  const make = (geom, list, apply) =>
    chunked(scene, geom, mat(0xffffff), list, (t, d) => {
      dummy = d;
      apply(t);
    });
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6);
  trunkGeo.translate(0, 1.2, 0);
  make(trunkGeo, L.trunks, (t) => {
    dummy.position.set(t.x, t.y - 0.1, t.z);
    dummy.scale.set(t.s, t.s * t.tall, t.s);
    dummy.rotation.set(0, t.rot, t.tall > 1.4 ? 0.15 : 0);
  });
  make(new THREE.ConeGeometry(1.5, 2.6, 7), L.pines, (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.setScalar(t.s);
    dummy.rotation.set(0, t.rot, 0);
  });
  make(new THREE.IcosahedronGeometry(1.2, 0), L.rounds, (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.set(t.s, t.s * 0.85, t.s);
    dummy.rotation.set(0, t.rot, 0);
  });
  make(new THREE.DodecahedronGeometry(1, 0), L.rocks, (t) => {
    dummy.position.set(t.x, t.y + t.s * 0.3, t.z);
    dummy.scale.set(t.s, t.s * 0.7, t.s);
    dummy.rotation.set(t.rot, t.rot * 2, 0);
  });
  // Cactus del desierto: tronco con dos brazos (una sola figura de bloques)
  const cactus = new THREE.BoxGeometry(0.5, 2.2, 0.5).translate(0, 1.1, 0);
  const armL = new THREE.BoxGeometry(0.7, 0.35, 0.35).translate(-0.5, 1.2, 0);
  const armLu = new THREE.BoxGeometry(0.35, 0.8, 0.35).translate(-0.75, 1.6, 0);
  const armR = new THREE.BoxGeometry(0.6, 0.35, 0.35).translate(0.45, 0.9, 0);
  const armRu = new THREE.BoxGeometry(0.35, 0.6, 0.35).translate(0.65, 1.2, 0);
  make(mergeBoxes([cactus, armL, armLu, armR, armRu]), L.cacti, (t) => {
    dummy.position.set(t.x, t.y - 0.05, t.z);
    dummy.scale.setScalar(t.s);
    dummy.rotation.set(0, t.rot, 0);
  });
  // Palmeras: tronco inclinado y hojas
  const palmTrunk = new THREE.CylinderGeometry(0.16, 0.24, 4, 6).translate(0, 2, 0);
  make(palmTrunk, L.palms.map((t) => ({ ...t, c: 0x8a6a46 })), (t) => {
    dummy.position.set(t.x, t.y - 0.05, t.z);
    dummy.scale.setScalar(t.s);
    dummy.rotation.set(0.12, t.rot, 0.08);
  });
  make(new THREE.ConeGeometry(2, 0.7, 6).translate(0, 4.1, 0.3), L.palms.map((t) => ({ ...t, c: 0x4f9a3a })), (t) => {
    dummy.position.set(t.x, t.y - 0.05, t.z);
    dummy.scale.setScalar(t.s);
    dummy.rotation.set(0.12, t.rot, 0.08);
  });
}

// Une varias cajas en una sola figura (para dibujar el cactus con una instancia)
function mergeBoxes(list) {
  const pos = [];
  const nor = [];
  const idx = [];
  let off = 0;
  for (const g of list) {
    const gi = g.toNonIndexed ? g : g;
    const p = gi.attributes.position.array;
    const n = gi.attributes.normal.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < n.length; i++) nor.push(n[i]);
    const ix = gi.index ? gi.index.array : null;
    if (ix) for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
    off += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

function campfire(scene, x, z, big = false) {
  const y = heightAt(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const logM = mat(0x4a3424);
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 5), logM);
    l.rotation.z = Math.PI / 2;
    l.rotation.y = (i * Math.PI) / 4;
    l.position.y = 0.12;
    g.add(l);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 6), new THREE.MeshBasicMaterial({ color: 0xffa340 }));
  V.Gfx.glowNight(flame.material, 1.6, 0.7);
  flame.position.y = 0.6;
  g.add(flame);
  const light = new THREE.PointLight(0xff9a4a, big ? 1.8 : 1.3, big ? 24 : 17, 2);
  light.position.y = 1.4;
  g.add(light);
  scene.add(g);
  return { light, flame, base: light.intensity };
}

function house(scene, h) {
  const { x, z, rot, w, d } = h;
  const g = new THREE.Group();
  const y = heightAt(x, z);
  g.position.set(x, y, z);
  g.rotation.y = rot;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), mat(h.wall || 0xd8c9a8));
  wall.position.y = 1.5;
  wall.castShadow = wall.receiveShadow = true;
  const beams = mat(0x5a3e28);
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3, 0.22), beams);
    b.position.set((sx * w) / 2, 1.5, d / 2 + 0.02);
    g.add(b);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.8, 2.4, 4), mat(h.roof));
  roof.position.y = 4.2;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, d / w);
  roof.castShadow = true;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1, 1.9, 0.1), beams);
  door.position.set(0, 0.95, d / 2 + 0.03);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.1), new THREE.MeshBasicMaterial({ color: 0xffc56b }));
  V.Gfx.glowNight(win.material, 1.3, 1.2);
  win.position.set(w * 0.28, 1.9, d / 2 + 0.03);
  g.add(wall, roof, door, win);
  scene.add(g);
}

function buildVillage(scene) {
  const L = layout();
  const fires = [campfire(scene, 0, 0, true)];
  for (const h of L.houses) house(scene, h);

  // Puesto del mercader
  const sx = 6.5;
  const sz = -5.5;
  const stall = new THREE.Group();
  stall.position.set(sx, 0, sz);
  stall.rotation.y = Math.atan2(-sx, -sz);
  const table = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.2), mat(0x6b4a2e));
  table.position.set(0, 0.5, 1.3);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 2.6), mat(0x7a2630));
  awning.position.set(0, 2.9, 0.6);
  awning.rotation.x = 0.18;
  for (const px of [-1.6, 1.6]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 5), mat(0x4a3424));
    pole.position.set(px, 1.5, 1.8);
    stall.add(pole);
  }
  const goods = [0xc2413a, 0x3d6fc2, 0xd9b56a];
  goods.forEach((c, i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.34, 6), mat(c));
    b.position.set(-0.8 + i * 0.8, 1.17, 1.3);
    stall.add(b);
  });
  stall.add(table, awning);
  stall.traverse((o) => (o.castShadow = true));
  scene.add(stall);

  // Santuario de la sanadora: piedra con un cristal que brilla
  const sn = NPCS.find((n) => n.id === 'sanadora');
  const shrine = new THREE.Group();
  shrine.position.set(L.shrine.x, heightAt(sn.x, sn.z), L.shrine.z);
  const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.9, 7), mat(0x8a8478));
  stone.position.y = 0.45;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), mat(0xbff0d8, { emissive: 0x5ad0a0, emissiveIntensity: 1.2 }));
  crystal.position.y = 1.45;
  const glow = new THREE.PointLight(0x7fe0b0, 1.2, 10, 2);
  glow.position.y = 1.6;
  shrine.add(stone, crystal, glow);
  stone.castShadow = true;
  scene.add(shrine);

  // NPCs de la aldea
  const npcs = NPCS.map((def) => {
    const model = def.prop ? propModel(def) : buildHumanoid(def.look);
    model.root.position.set(def.x, heightAt(def.x, def.z), def.z);
    // Miran hacia el centro de su zona
    const home = zoneAt(def) || V.Data.ZONES[0];
    model.root.rotation.y = Math.atan2(home.x - def.x, home.z - def.z) || Math.atan2(-def.x, -def.z);
    model.root.traverse((o) => (o.userData.npc = def.id));
    scene.add(model.root);
    return { ...def, model, root: model.root };
  });
  const merchant = npcs.find((n) => n.id === 'mercader');

  // Postes indicadores al inicio de cada camino
  const signs = OUTER_ZONES.map((zn) => {
    const a = Math.atan2(zn.z, zn.x);
    const x = Math.cos(a) * (VILLAGE_R - 2) + Math.cos(a + Math.PI / 2) * 2.4;
    const z = Math.sin(a) * (VILLAGE_R - 2) + Math.sin(a + Math.PI / 2) * 2.4;
    const y = heightAt(x, z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 0.18), mat(0x5a3e28));
    post.position.set(x, y + 1.1, z);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 0.08), mat(0x8a6a44));
    board.position.set(x, y + 1.9, z);
    board.rotation.y = -a;
    post.castShadow = board.castShadow = true;
    scene.add(post, board);
    return { pos: new THREE.Vector3(x, y, z), height: 2.6, text: `${zn.name} · Nv ${zn.lvl}` };
  });

  return { fires, merchant, npcs, signs, crystal };
}

// Decorado de las zonas: molinos, setas, cristales, vías, murallas, Ciudadela, lava, géiseres,
// nubes, islotes, puentes de arcoíris, columnas del templo y botones de la Fábrica.
function buildZones(scene) {
  const L = layout();
  const { ARENAS } = V.Data;
  const fires = L.fires.filter((f) => f.x || f.z).map((f) => campfire(scene, f.x, f.z, f.big));
  let dummy = new THREE.Object3D();
  // Adornos de muchas piezas: en bloques (ver chunked). Los que se animan van en una sola malla.
  const many = (geo, material, list, place) =>
    chunked(scene, geo, material, list, (t, d) => {
      dummy = d;
      place(t);
    });
  const inst = (geo, material, list, place) => {
    if (!list.length) return null;
    dummy = new THREE.Object3D();
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((t, i) => {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      place(t, i);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      if (t.c !== undefined) im.setColorAt(i, new THREE.Color(t.c));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
    return im;
  };
  const anim = { mills: [], geysers: [], plates: [], portals: [], islets: [] };

  // Molinos de las Praderas
  for (const m of L.windmills) {
    const g = new THREE.Group();
    g.position.set(m.x, m.y, m.z);
    g.rotation.y = m.rot;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 6, 6), mat(0xe6dcc8));
    tower.position.y = 3;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.6, 6), mat(0x8a3b2b));
    cap.position.y = 6.8;
    const hub = new THREE.Group();
    hub.position.set(0, 5.6, 1.3);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.08), mat(0xf4f0e6));
      blade.position.y = 1.7;
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      arm.add(blade);
      hub.add(arm);
    }
    g.add(tower, cap, hub);
    g.traverse((o) => (o.castShadow = true));
    scene.add(g);
    anim.mills.push(hub);
  }

  // Setas brillantes del Bosque
  const shroomMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  V.Gfx.glowNight(shroomMat, 1.2, 0.6);
  many(new THREE.CylinderGeometry(0.5, 0.15, 0.35, 7).translate(0, 0.9, 0), shroomMat, L.shrooms, (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.setScalar(t.s);
  });
  many(new THREE.CylinderGeometry(0.1, 0.12, 0.8, 5).translate(0, 0.4, 0), mat(0xf0e6d0), L.shrooms.map((t) => ({ ...t, c: 0xf0e6d0 })), (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.setScalar(t.s);
  });

  // Cristales de las Minas
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.1, emissive: 0x3a5a8a, emissiveIntensity: 0.35, flatShading: true });
  many(new THREE.OctahedronGeometry(0.6, 0).scale(0.6, 1.6, 0.6).translate(0, 0.8, 0), crystalMat, L.crystals, (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.setScalar(t.s);
    dummy.rotation.set(0.2, t.rot, 0.15);
  });
  // Vías de vagoneta
  inst(new THREE.BoxGeometry(2.2, 0.12, 0.25), mat(0x5a3e28), L.rails.map((t) => ({ ...t, c: 0x5a3e28 })), (t) => {
    dummy.position.set(t.x, t.y + 0.06, t.z);
    dummy.rotation.set(0, t.rot + Math.PI / 2, 0);
  });
  inst(new THREE.BoxGeometry(0.08, 0.1, 2.6), mat(0x8a8f9a, { metalness: 0.4 }), L.rails.flatMap((t) => [-0.6, 0.6].map((o) => ({ ...t, o, c: 0x8a8f9a }))), (t) => {
    dummy.position.set(t.x + Math.cos(t.rot) * t.o, t.y + 0.16, t.z - Math.sin(t.rot) * t.o);
    dummy.rotation.set(0, t.rot, 0);
  });

  // Murallas (Fábrica y Ciudadela)
  many(new THREE.BoxGeometry(2.6, 1, 1.2).translate(0, 0.5, 0), mat(0xffffff), L.walls, (t) => {
    dummy.position.set(t.x, t.y - 0.2, t.z);
    dummy.rotation.set(0, t.rot + Math.PI / 2, 0);
    dummy.scale.set(1, t.h, 1);
  });

  // Casas de la Ciudadela: blancas con techos de colores
  for (const h of L.cityHouses) {
    const g = new THREE.Group();
    g.position.set(h.x, heightAt(h.x, h.z), h.z);
    g.rotation.y = h.rot;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(h.w, 4, h.d), mat(0xf6f3ea));
    wall.position.y = 2;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(h.w, h.d) * 0.78, 2.6, 4), mat(h.roof));
    roof.position.y = 5.3;
    roof.rotation.y = Math.PI / 4;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2, 0.1), mat(0x5a3e28));
    door.position.set(0, 1, h.d / 2 + 0.03);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.1), new THREE.MeshBasicMaterial({ color: 0xffc56b }));
    V.Gfx.glowNight(win.material, 1.3, 1.2);
    win.position.set(h.w * 0.28, 2.6, h.d / 2 + 0.03);
    g.add(wall, roof, door, win);
    g.traverse((o) => (o.castShadow = true));
    scene.add(g);
  }
  if (L.fountain) {
    const f = L.fountain;
    const g = new THREE.Group();
    g.position.set(f.x, heightAt(f.x, f.z), f.z);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 0.7, 12), mat(0xf2efe6));
    basin.position.y = 0.35;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0x5aa0d8, roughness: 0.1 }));
    water.position.y = 0.66;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.2, 8), mat(0xf2efe6));
    column.position.y = 1.4;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat(0xd9b25f, { metalness: 0.3 }));
    top.position.y = 2.9;
    top.rotation.set(0.6, 0.6, 0);
    g.add(basin, water, column, top);
    scene.add(g);
  }

  // Lava de gelatina del Valle (charcos que tiemblan) y grietas
  const jellyMat = new THREE.MeshStandardMaterial({ color: 0xff8a2a, roughness: 0.25, emissive: 0xc0400a, emissiveIntensity: 0.55, transparent: true, opacity: 0.92 });
  const jelly = inst(new THREE.CylinderGeometry(1, 1.1, 0.35, 10).translate(0, 0.12, 0), jellyMat, L.jelly, (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.set(t.s, 1, t.s);
  });
  const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
  V.Gfx.glowNight(lavaMat, 1.7, 0.6);
  inst(new THREE.BoxGeometry(0.3, 0.1, 3), lavaMat, L.lava, (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.set(1, 1, t.s);
    dummy.rotation.set(0, t.rot, 0);
  });
  // Géiseres: piedra con agujero y chorro de vapor que sube y baja
  for (const gz of L.geysers) {
    const g = new THREE.Group();
    g.position.set(gz.x, gz.y, gz.z);
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(1, 0.35, 6, 10), mat(0x3a3532));
    ringM.rotation.x = Math.PI / 2;
    ringM.position.y = 0.2;
    const steam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.9, 6, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xf4f0e6, transparent: true, opacity: 0.35, depthWrite: false }));
    steam.position.y = 3;
    g.add(ringM, steam);
    scene.add(g);
    anim.geysers.push({ steam, phase: gz.x });
  }

  // Islas Flotantes: nubes, islotes flotantes y puentes de arcoíris
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.88 });
  inst(new THREE.IcosahedronGeometry(1, 0), cloudMat, L.clouds, (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.set(t.s * 1.6, t.s * 0.6, t.s);
  });
  for (const t of L.islets) {
    const g = new THREE.Group();
    g.position.set(t.x, t.y, t.z);
    const rock = new THREE.Mesh(new THREE.ConeGeometry(t.s, t.s * 1.8, 6), mat(0x8a7a66));
    rock.rotation.x = Math.PI;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(t.s, t.s, 0.5, 6), mat(0x7fb84a));
    top.position.y = t.s * 0.9 + 0.25;
    rock.position.y = 0;
    g.add(rock, top);
    g.traverse((o) => (o.castShadow = true));
    scene.add(g);
    anim.islets.push({ g, y: t.y, phase: t.x });
  }
  const rainbow = [0xff5a5a, 0xffa34a, 0xffe08a, 0x7fe08a, 0x7fb6ff, 0xc895ff];
  for (const b of L.bridges) {
    const g = new THREE.Group();
    g.position.set(b.x, b.y + 1, b.z);
    g.rotation.y = -b.rot;
    rainbow.forEach((c, i) => {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(9 - i * 0.35, 0.18, 4, 24, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8 }));
      g.add(arc);
    });
    scene.add(g);
  }
  many(new THREE.CylinderGeometry(0.6, 0.7, 6, 8).translate(0, 3, 0), mat(0xf2efe6), L.pillars.map((t) => ({ ...t, c: t.c || 0xf2efe6 })), (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.set(1, t.h || 1, 1);
  });

  // Tierras lejanas: pirámides de bloques del desierto y charcos (pantano, oasis, charca de la Hidra)
  many(new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0), mat(0xe0c890, { flatShading: true }), L.pyramids.map((t) => ({ ...t, c: 0xe0c890 })), (t) => {
    dummy.position.set(t.x, t.y - 0.3, t.z);
    dummy.scale.set(t.s * 1.4, t.s, t.s * 1.4);
  });
  const pondMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, transparent: true, opacity: 0.85 });
  many(new THREE.CylinderGeometry(1, 1, 0.08, 14), pondMat, L.ponds, (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.set(t.s, 1, t.s);
  });

  // Botones de la Fábrica Descontrolada
  for (const pl of ARENAS.fabrica.plates) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x8a2a1a, emissive: 0x401008, emissiveIntensity: 0.4 }));
    m.position.set(pl.x, heightAt(pl.x, pl.z) + 0.12, pl.z);
    m.receiveShadow = true;
    scene.add(m);
    anim.plates.push(m);
  }

  return { fires, anim, jelly };
}

// Objetos que hacen de NPC: vagoneta y portales
function propModel(def) {
  const root = new THREE.Group();
  if (def.prop === 'cart') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 1.2), mat(0x6b4a2e));
    body.position.y = 0.9;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.15, 1.3), mat(0x8a8f9a, { metalness: 0.4 }));
    rim.position.y = 1.45;
    const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), mat(0xb5703f));
    ore.position.y = 1.5;
    root.add(body, rim, ore);
    for (const [x, z] of [[-0.6, 0.65], [0.6, 0.65], [-0.6, -0.65], [0.6, -0.65]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.15, 10), mat(0x3a3532));
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.3, z);
      root.add(w);
    }
  } else {
    // Portal: arco de piedra con un velo de luz
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.28, 6, 16), mat(0xf2efe6));
    arch.position.y = 1.9;
    const veil = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20), new THREE.MeshBasicMaterial({ color: V.Gfx.hot(def.portalColor || 0x9fd8ff, 1.4), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    veil.position.y = 1.9;
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 1.2), mat(0xd8d4cc));
    base.position.y = 0.15;
    root.add(arch, veil, base);
    root.userData.veil = veil;
  }
  root.traverse((o) => (o.castShadow = true));
  return { root };
}

function buildWorld(scene) {
  const sky = buildSky(scene);
  const terrain = buildTerrain();
  scene.add(terrain);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 1.4, WORLD * 1.4, 1, 1), V.Gfx.waterMaterial());
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  water.renderOrder = 1;
  scene.add(water);
  buildVegetation(scene);
  const village = buildVillage(scene);
  const zones = buildZones(scene);
  return {
    sky,
    water,
    terrain,
    merchant: village.merchant,
    npcs: village.npcs,
    crystal: village.crystal,
    signs: village.signs,
    fires: [...village.fires, ...zones.fires],
    anim: zones.anim,
    jelly: zones.jelly,
    cull: cullChunks,
  };
}

V.World = { WORLD, WORLD_LIMIT, VILLAGE_R, WATER_Y, pathDist, heightAt, inVillage, zoneAt, buildWorld };
})();
