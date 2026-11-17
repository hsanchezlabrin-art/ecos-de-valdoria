// Mundo visible: terreno, vegetación, aldea, campamentos y cielo.
// La forma del terreno (alturas, zonas) vive en terrain.js, que también usa el servidor.
(function () {
const { ZONES, NPCS } = V.Data;
const { buildHumanoid, mat } = V.Models;
const { WORLD, WORLD_LIMIT, VILLAGE_R, WATER_Y, FIELD_ZONES, ss, lerp, rng, pathDist, heightAt, inVillage, zoneAt } = V.Terrain;

const THREE = window.THREE;

function buildTerrain() {
  const seg = 200;
  const g = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
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
    for (const zn of FIELD_ZONES) {
      const w = 1 - ss(zn.r * 0.55, zn.r * 1.35, Math.hypot(x - zn.x, z - zn.z));
      if (w > 0) mix(zn.tint.map((v) => v + n), w * 0.85);
    }
    const d = Math.hypot(x, z);
    mix(dirt, (1 - ss(9, 17, d)) * 0.75);
    mix(dirt, (1 - ss(1.2, 3.2, pathDist(x, z))) * 0.8);
    mix(rock, ss(7, 15, h));
    mix(mud, 1 - ss(WATER_Y - 0.4, WATER_Y + 0.9, h));
    colors.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  m.receiveShadow = true;
  m.name = 'terrain';
  return m;
}

function buildSky(scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x3a5a86) },
        horizon: { value: new THREE.Color(0xe6c597) },
        bottom: { value: new THREE.Color(0x7d6d5a) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.5)) : mix(horizon, bottom, min(1.0, -h * 4.0)); gl_FragColor = vec4(c, 1.0); }',
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

function buildVegetation(scene) {
  const r = rng(42);
  const trunks = [];
  const pines = [];
  const rounds = [];
  for (let i = 0; i < 5200; i++) {
    const x = (r() - 0.5) * 2 * 182;
    const z = (r() - 0.5) * 2 * 182;
    const d = Math.hypot(x, z);
    if (d > 182 || d < VILLAGE_R + 5) continue;
    if (pathDist(x, z) < 4) continue;
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.2) continue;
    const zn = FIELD_ZONES.find((zz) => Math.hypot(x - zz.x, z - zz.z) < zz.r * 1.15);
    let density = zn ? zn.trees : 0.16;
    if (zn && zn.treeType !== 'pine' && Math.hypot(x - zn.x, z - zn.z) < zn.r * 0.5) density *= 0.2;
    if (d > 150) density = 0.45;
    if (r() > density) continue;
    const type = zn ? zn.treeType : r() < 0.5 ? 'pine' : 'round';
    const s = 0.8 + r() * 0.7;
    const rot = r() * Math.PI * 2;
    if (type === 'pine') {
      trunks.push({ x, y: h, z, s, rot, c: 0x4a3626, tall: 1 });
      pines.push({ x, y: h + 2.0 * s, z, s: s * 1.25, rot, c: r() < 0.5 ? 0x2d4a2a : 0x34552e });
      pines.push({ x, y: h + 3.4 * s, z, s: s * 0.9, rot, c: 0x3a5e33 });
    } else if (type === 'round') {
      trunks.push({ x, y: h, z, s, rot, c: 0x5a4130, tall: 1 });
      rounds.push({ x, y: h + 2.6 * s, z, s: s * 1.5, rot, c: r() < 0.5 ? 0x4f7a34 : 0x5e8a3a });
    } else if (type === 'swamp') {
      trunks.push({ x, y: h, z, s, rot, c: 0x3a3226, tall: 1.3 });
      rounds.push({ x, y: h + 3.1 * s, z, s: s * 1.2, rot, c: 0x324a2a });
    } else {
      trunks.push({ x, y: h, z, s: s * 0.8, rot, c: 0x3d3835, tall: 1.6 });
    }
  }
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const make = (geom, list, apply) => {
    const im = new THREE.InstancedMesh(geom, mat(0xffffff), list.length);
    list.forEach((t, i) => {
      apply(t);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      im.setColorAt(i, col.setHex(t.c));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
    return im;
  };
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6);
  trunkGeo.translate(0, 1.2, 0);
  make(trunkGeo, trunks, (t) => {
    dummy.position.set(t.x, t.y - 0.1, t.z);
    dummy.scale.set(t.s, t.s * t.tall, t.s);
    dummy.rotation.set(0, t.rot, t.tall > 1.4 ? 0.15 : 0);
  });
  make(new THREE.ConeGeometry(1.5, 2.6, 7), pines, (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.setScalar(t.s);
    dummy.rotation.set(0, t.rot, 0);
  });
  make(new THREE.IcosahedronGeometry(1.2, 0), rounds, (t) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.set(t.s, t.s * 0.85, t.s);
    dummy.rotation.set(0, t.rot, 0);
  });

  // Rocas
  const rocks = [];
  for (let i = 0; i < 420; i++) {
    const x = (r() - 0.5) * 2 * 182;
    const z = (r() - 0.5) * 2 * 182;
    const d = Math.hypot(x, z);
    if (d < VILLAGE_R + 3 || pathDist(x, z) < 3) continue;
    const zn = FIELD_ZONES.find((zz) => Math.hypot(x - zz.x, z - zz.z) < zz.r);
    const s = 0.4 + r() * (d > 150 ? 3 : 1.2);
    rocks.push({ x, y: heightAt(x, z), z, s, rot: r() * 6, c: zn && zn.id === 'ceniza' ? 0x2f2c2a : 0x77716a });
  }
  make(new THREE.DodecahedronGeometry(1, 0), rocks, (t) => {
    dummy.position.set(t.x, t.y + t.s * 0.3, t.z);
    dummy.scale.set(t.s, t.s * 0.7, t.s);
    dummy.rotation.set(t.rot, t.rot * 2, 0);
  });

  // Grietas de lava en la Llanura de Ceniza
  const cz = ZONES.find((z) => z.id === 'ceniza');
  const lava = [];
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * cz.r;
    const x = cz.x + Math.cos(a) * rr;
    const z = cz.z + Math.sin(a) * rr;
    lava.push({ x, y: heightAt(x, z) + 0.04, z, s: 1 + r() * 2.5, rot: r() * 6, c: 0xff6a22 });
  }
  const lavaMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.1, 3), new THREE.MeshBasicMaterial({ color: 0xff7a2a }), lava.length);
  lava.forEach((t, i) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.scale.set(1, 1, t.s);
    dummy.rotation.set(0, t.rot, 0);
    dummy.updateMatrix();
    lavaMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(lavaMesh);
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
  flame.position.y = 0.6;
  g.add(flame);
  const light = new THREE.PointLight(0xff9a4a, big ? 2.4 : 1.6, big ? 26 : 18, 2);
  light.position.y = 1.4;
  g.add(light);
  scene.add(g);
  return { light, flame, base: light.intensity };
}

function house(scene, x, z, rot, r) {
  const g = new THREE.Group();
  const y = heightAt(x, z);
  g.position.set(x, y, z);
  g.rotation.y = rot;
  const w = 4.5 + r() * 2;
  const d = 4 + r() * 1.5;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), mat(0xd8c9a8));
  wall.position.y = 1.5;
  wall.castShadow = wall.receiveShadow = true;
  const beams = mat(0x5a3e28);
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3, 0.22), beams);
    b.position.set((sx * w) / 2, 1.5, d / 2 + 0.02);
    g.add(b);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.8, 2.4, 4), mat(r() < 0.5 ? 0x8a3b2b : 0x5d4a3a));
  roof.position.y = 4.2;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, d / w);
  roof.castShadow = true;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1, 1.9, 0.1), beams);
  door.position.set(0, 0.95, d / 2 + 0.03);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.1), new THREE.MeshBasicMaterial({ color: 0xffc56b }));
  win.position.set(w * 0.28, 1.9, d / 2 + 0.03);
  g.add(wall, roof, door, win);
  scene.add(g);
}

function buildVillage(scene) {
  const r = rng(5);
  const fires = [campfire(scene, 0, 0, true)];
  const pathAngles = FIELD_ZONES.map((zn) => Math.atan2(zn.z, zn.x));
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  let placed = 0;
  for (let i = 0; i < 24 && placed < 8; i++) {
    const a = (i / 24) * Math.PI * 2;
    if (pathAngles.some((pa) => angDiff(a, pa) < 0.38)) continue;
    if (i % 2) continue;
    const rr = 15 + r() * 2;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    house(scene, x, z, Math.atan2(-x, -z), r);
    placed++;
  }

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
  shrine.position.set(sn.x * 1.22, heightAt(sn.x, sn.z), sn.z * 1.22);
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
    const model = buildHumanoid(def.look);
    model.root.position.set(def.x, heightAt(def.x, def.z), def.z);
    model.root.rotation.y = Math.atan2(-def.x, -def.z);
    model.root.traverse((o) => (o.userData.npc = def.id));
    scene.add(model.root);
    return { ...def, model, root: model.root };
  });
  const merchant = npcs.find((n) => n.id === 'mercader');

  // Postes indicadores al inicio de cada camino
  const signs = FIELD_ZONES.map((zn) => {
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

function buildCamps(scene) {
  const fires = [];
  // Campamento goblin: tiendas y fogata
  const gz = ZONES.find((z) => z.id === 'goblin');
  fires.push(campfire(scene, gz.x, gz.z));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = gz.x + Math.cos(a) * 9;
    const z = gz.z + Math.sin(a) * 9;
    const tent = new THREE.Mesh(new THREE.ConeGeometry(2, 2.6, 5), mat(i % 2 ? 0x7d6440 : 0x6a5233));
    tent.position.set(x, heightAt(x, z) + 1.3, z);
    tent.castShadow = true;
    scene.add(tent);
  }
  // Fuerte orco: empalizada con dos entradas
  const fz = ZONES.find((z) => z.id === 'fuerte');
  fires.push(campfire(scene, fz.x, fz.z, true));
  const logs = [];
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    if (Math.abs(Math.sin(a - 0.6)) < 0.12) continue;
    logs.push(a);
  }
  const logGeo = new THREE.CylinderGeometry(0.32, 0.36, 4.4, 6);
  const im = new THREE.InstancedMesh(logGeo, mat(0x4f3a28), logs.length);
  const dummy = new THREE.Object3D();
  logs.forEach((a, i) => {
    const x = fz.x + Math.cos(a) * 21;
    const z = fz.z + Math.sin(a) * 21;
    dummy.position.set(x, heightAt(x, z) + 1.9, z);
    dummy.rotation.set((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.08);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  });
  im.castShadow = true;
  scene.add(im);
  return fires;
}

function buildWorld(scene) {
  const sky = buildSky(scene);
  const terrain = buildTerrain();
  scene.add(terrain);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD * 1.4, WORLD * 1.4),
    new THREE.MeshStandardMaterial({ color: 0x2f5866, roughness: 0.2, metalness: 0.2, transparent: true, opacity: 0.82 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);
  buildVegetation(scene);
  const village = buildVillage(scene);
  const campFires = buildCamps(scene);
  return {
    sky,
    terrain,
    merchant: village.merchant,
    npcs: village.npcs,
    crystal: village.crystal,
    signs: village.signs,
    fires: [...village.fires, ...campFires],
  };
}

V.World = { WORLD, WORLD_LIMIT, VILLAGE_R, WATER_Y, pathDist, heightAt, inVillage, zoneAt, buildWorld };
})();
