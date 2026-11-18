// Geometría lógica del mundo: alturas del terreno, límites, aldea y zonas.
// Sin gráficos: lo usan el cliente (para dibujar) y el servidor (para simular).
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    V.Terrain = factory(V.Data);
  }
})(function (Data) {
  const { ZONES, ARENAS } = Data;

  const WORLD = 440;
  const WORLD_LIMIT = 188;
  const VILLAGE_R = 22;
  const WATER_Y = -1.7;

  const ss = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  // Números pseudoaleatorios con semilla: el mundo es idéntico en todos los equipos.
  function rng(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Zonas fuera de la aldea (todas tienen camino); las de combate no son seguras
  const OUTER_ZONES = ZONES.filter((z) => z.id !== 'aldea');
  const FIELD_ZONES = OUTER_ZONES.filter((z) => !z.safe);

  function distSeg(px, pz, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  }
  function pathDist(x, z) {
    let d = Infinity;
    for (const zn of OUTER_ZONES) d = Math.min(d, distSeg(x, z, 0, 0, zn.x, zn.z));
    return d;
  }

  function heightAt(x, z) {
    let h =
      Math.sin(x * 0.021 + 0.4) * Math.cos(z * 0.018) * 5.5 +
      Math.sin(x * 0.055 + 1.3) * Math.sin(z * 0.049 + 0.7) * 1.8 +
      Math.sin((x - z) * 0.012) * 3.5 +
      Math.cos(z * 0.09 + x * 0.03) * 0.6;
    for (const zn of OUTER_ZONES) {
      // Las Islas (zona alta) tienen una subida larga y suave
      const hi = zn.ground > 10;
      const dz = Math.hypot(x - zn.x, z - zn.z);
      // La Ciudadela se aplana por completo (sin lagos dentro de las murallas)
      const w = hi ? 1 - Math.min(1, Math.max(0, (dz - zn.r * 0.75) / (zn.r * 1.4))) : zn.hub ? 1 - ss(zn.r * 1.05, zn.r * 1.6, dz) : 1 - ss(zn.r * 0.6, zn.r * 1.35, dz);
      if (w > 0) h = lerp(h, zn.ground + h * (hi ? 0.05 : zn.hub ? 0 : 0.12), w * (hi || zn.hub ? 0.98 : 0.85));
    }
    // Caminos más llanos (salvo la subida a las Islas, que no se hunde)
    const pd = pathDist(x, z);
    if (pd < 6 && h < 6) h = lerp(h, Math.max(h * 0.4, 0.2), (1 - ss(2, 6, pd)) * 0.7);
    const d = Math.hypot(x, z);
    h *= ss(VILLAGE_R * 0.8, VILLAGE_R + 20, d);
    h += Math.max(0, d - 168) * 0.6;
    return h;
  }

  const inVillage = (p) => Math.hypot(p.x, p.z) < VILLAGE_R;
  const SAFE_ZONES = OUTER_ZONES.filter((z) => z.safe);
  // Zonas seguras: la aldea y la Ciudadela (los monstruos no entran)
  const inSafe = (p) => inVillage(p) || SAFE_ZONES.some((z) => Math.hypot(p.x - z.x, p.z - z.z) < z.r);

  function zoneAt(p) {
    if (inVillage(p)) return ZONES[0];
    for (const z of OUTER_ZONES) if (Math.hypot(p.x - z.x, p.z - z.z) < z.r * 1.1) return z;
    return null;
  }

  // ---------- Agua ----------
  // Profundidad del agua en un punto (0 si es tierra firme).
  const waterDepth = (x, z) => Math.max(0, WATER_Y - heightAt(x, z));
  const SWIM_DEPTH = 1.3; // a partir de aquí se nada
  const DEEP_DEPTH = 3.5; // aguas profundas: se gasta el aire
  const SWIM_Y = WATER_Y - 1.35; // altura del cuerpo al nadar (la cabeza queda fuera)

  // ---------- Disposición del mundo (árboles, rocas, edificios) ----------
  // La calcula una sola vez con semillas fijas: el servidor la usa para las colisiones
  // y el cliente para dibujar exactamente lo mismo.
  let LAYOUT = null;
  function layout() {
    if (LAYOUT) return LAYOUT;
    const { NPCS } = Data;
    const L = {
      trunks: [], pines: [], rounds: [], rocks: [], lava: [], houses: [], fires: [], obstacles: [],
      windmills: [], shrooms: [], crystals: [], rails: [], walls: [], cityHouses: [], geysers: [], jelly: [], clouds: [], islets: [], bridges: [], pillars: [],
    };
    const block = (x, z, r) => L.obstacles.push({ x, z, r });
    const zoneById = (id) => ZONES.find((z) => z.id === id);
    // Sin árboles ni rocas en las arenas de jefes ni junto a los NPCs
    const inArena = (x, z) => Object.values(ARENAS).some((a) => Math.hypot(x - a.x, z - a.z) < a.r + 2) || NPCS.some((n) => Math.hypot(x - n.x, z - n.z) < 4);

    // Vegetación
    const r = rng(42);
    for (let i = 0; i < 5200; i++) {
      const x = (r() - 0.5) * 2 * 182;
      const z = (r() - 0.5) * 2 * 182;
      const d = Math.hypot(x, z);
      if (d > 182 || d < VILLAGE_R + 5) continue;
      if (pathDist(x, z) < 4 || inArena(x, z)) continue;
      const h = heightAt(x, z);
      if (h < WATER_Y + 0.2) continue;
      const zn = OUTER_ZONES.find((zz) => Math.hypot(x - zz.x, z - zz.z) < zz.r * 1.15);
      if (zn && zn.safe) continue;
      let density = zn ? zn.trees : 0.16;
      if (zn && zn.treeType !== 'giant' && Math.hypot(x - zn.x, z - zn.z) < zn.r * 0.5) density *= 0.2;
      if (d > 150) density = 0.45;
      if (r() > density) continue;
      const type = zn ? zn.treeType : r() < 0.5 ? 'pine' : 'round';
      const s = 0.8 + r() * 0.7;
      const rot = r() * Math.PI * 2;
      if (type === 'none') continue;
      if (type === 'giant') {
        // Árbol colosal del bosque: tronco enorme y copa muy ancha
        const g = 2.2 + r() * 1.2;
        L.trunks.push({ x, y: h, z, s: g, rot, c: 0x5a4130, tall: 1.4 });
        L.rounds.push({ x, y: h + 3.4 * g, z, s: g * 1.9, rot, c: r() < 0.5 ? 0x3f6a2c : 0x4f7a34 });
        block(x, z, 0.3 * g + 0.15);
        // Setas brillantes al pie
        if (r() < 0.5) L.shrooms.push({ x: x + 1.2 * g, y: heightAt(x + 1.2 * g, z), z, s: 0.6 + r() * 0.6, c: r() < 0.5 ? 0x7fe0ff : 0xc895ff });
        continue;
      }
      if (type === 'pine') {
        L.trunks.push({ x, y: h, z, s, rot, c: 0x4a3626, tall: 1 });
        L.pines.push({ x, y: h + 2.0 * s, z, s: s * 1.25, rot, c: r() < 0.5 ? 0x2d4a2a : 0x34552e });
        L.pines.push({ x, y: h + 3.4 * s, z, s: s * 0.9, rot, c: 0x3a5e33 });
      } else if (type === 'round') {
        L.trunks.push({ x, y: h, z, s, rot, c: 0x5a4130, tall: 1 });
        L.rounds.push({ x, y: h + 2.6 * s, z, s: s * 1.5, rot, c: zn && zn.id === 'islas' ? 0x7fb84a : r() < 0.5 ? 0x4f7a34 : 0x5e8a3a });
      } else {
        L.trunks.push({ x, y: h, z, s: s * 0.8, rot, c: 0x3d3835, tall: 1.6 });
      }
      block(x, z, 0.3 * s + 0.12);
    }
    // Rocas: solo las grandes bloquean el paso. Naranjas en las minas, oscuras en el valle.
    for (let i = 0; i < 520; i++) {
      const x = (r() - 0.5) * 2 * 182;
      const z = (r() - 0.5) * 2 * 182;
      const d = Math.hypot(x, z);
      if (d < VILLAGE_R + 3 || pathDist(x, z) < 3 || inArena(x, z)) continue;
      const zn = OUTER_ZONES.find((zz) => Math.hypot(x - zz.x, z - zz.z) < zz.r);
      if (zn && zn.safe) continue;
      const big = zn && zn.id === 'minas';
      const s = 0.4 + r() * (d > 150 || big ? 2.6 : 1.2);
      const c = !zn ? 0x77716a : zn.id === 'minas' ? 0xb5703f : zn.id === 'valle' ? 0x2f2c2a : zn.id === 'islas' ? 0xd8d4cc : 0x77716a;
      L.rocks.push({ x, y: heightAt(x, z), z, s, rot: r() * 6, c });
      if (s > 0.75) block(x, z, s * 0.85);
    }

    // ---------- Aldea de los Bloques: cabañas alrededor de la plaza, sin tapar los caminos ----------
    const rv = rng(5);
    const pathAngles = OUTER_ZONES.map((zn) => Math.atan2(zn.z, zn.x));
    const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    let placed = 0;
    for (let i = 0; i < 24 && placed < 8; i++) {
      const a = (i / 24) * Math.PI * 2;
      if (pathAngles.some((pa) => angDiff(a, pa) < 0.38)) continue;
      if (i % 2) continue;
      const rr = 15 + rv() * 2;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const w = 4.5 + rv() * 2;
      const dd = 4 + rv() * 1.5;
      const roof = rv() < 0.5 ? 0x8a3b2b : 0x5d4a3a;
      L.houses.push({ x, z, rot: Math.atan2(-x, -z), w, d: dd, roof });
      block(x, z, (w + dd) / 4 + 0.35);
      placed++;
    }
    L.fires.push({ x: 0, z: 0, big: true });
    block(0, 0, 0.9);
    // Puesto del mercader (la mesa está delante del mercader)
    const mc = NPCS.find((n) => n.id === 'mercader');
    const srot = Math.atan2(-mc.x, -mc.z);
    block(mc.x + Math.sin(srot) * 1.3, mc.z + Math.cos(srot) * 1.3, 1.45);
    // Santuario de la sanadora
    const sn = NPCS.find((n) => n.id === 'sanadora');
    L.shrine = { x: sn.x * 1.22, z: sn.z * 1.22 };
    block(L.shrine.x, L.shrine.z, 0.95);

    // ---------- Praderas: molinos ----------
    const pz = zoneById('praderas');
    for (const [dx, dz] of [[-6, -14], [10, 12], [20, -6]]) {
      const x = pz.x + dx;
      const z = pz.z + dz;
      L.windmills.push({ x, y: heightAt(x, z), z, rot: rv() * 6 });
      block(x, z, 1.8);
    }

    // ---------- Minas: cristales, vías de vagonetas y La Fábrica ----------
    const mz = zoneById('minas');
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2;
      const rr = 6 + Math.sqrt(r()) * (mz.r - 6);
      const x = mz.x + Math.cos(a) * rr;
      const z = mz.z + Math.sin(a) * rr;
      if (pathDist(x, z) < 3 || inArena(x, z)) continue;
      const s = 0.5 + r() * 1.1;
      L.crystals.push({ x, y: heightAt(x, z), z, s, rot: r() * 6, c: r() < 0.5 ? 0x7fd0ff : 0xc895ff });
      if (s > 0.9) block(x, z, s * 0.5);
    }
    // Vías desde la aldea hasta las minas (decorativas, junto al camino)
    const va = NPCS.find((n) => n.id === 'vagoneta_aldea');
    const vm = NPCS.find((n) => n.id === 'vagoneta_minas');
    const railLen = Math.hypot(vm.x - va.x, vm.z - va.z);
    for (let k = 0; k <= railLen; k += 2.5) {
      const t = k / railLen;
      const x = va.x + (vm.x - va.x) * t;
      const z = va.z + (vm.z - va.z) * t;
      L.rails.push({ x, y: heightAt(x, z), z, rot: Math.atan2(vm.x - va.x, vm.z - va.z) });
    }
    // Paredes de la Fábrica Descontrolada (con entrada hacia el norte)
    const fa = ARENAS.fabrica;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))) < 0.35) continue;
      const x = fa.x + Math.cos(a) * fa.r;
      const z = fa.z + Math.sin(a) * fa.r;
      L.walls.push({ x, y: heightAt(x, z), z, rot: -a, h: 3.2, c: 0x6a6460 });
      block(x, z, 1.15);
    }

    // ---------- Ciudadela de Gludio-Cubo: murallas blancas, casas de colores y fuente ----------
    const cz = zoneById('ciudadela');
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      // Cuatro puertas (una mira a la aldea)
      const toVillage = Math.atan2(-cz.z, -cz.x);
      if ([0, Math.PI / 2, Math.PI, -Math.PI / 2].some((g) => angDiff(a, toVillage + g) < 0.16)) continue;
      const x = cz.x + Math.cos(a) * (cz.r - 1);
      const z = cz.z + Math.sin(a) * (cz.r - 1);
      L.walls.push({ x, y: heightAt(x, z), z, rot: -a, h: 4.2, c: 0xf2efe6 });
      block(x, z, 1.4);
    }
    const roofs = [0xd84a3a, 0x3a7ad8, 0xf2c13a, 0x5ab06a, 0xc895ff];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      const x = cz.x + Math.cos(a) * 19;
      const z = cz.z + Math.sin(a) * 19;
      if (angDiff(a, Math.atan2(-cz.z, -cz.x)) < 0.4) continue;
      L.cityHouses.push({ x, z, rot: Math.atan2(cz.x - x, cz.z - z), w: 5, d: 4.5, roof: roofs[i % roofs.length] });
      block(x, z, 2.6);
    }
    L.fountain = { x: cz.x, z: cz.z };
    block(cz.x, cz.z, 2);

    // ---------- Valle: lava de gelatina, géiseres y rocas del nido de Ignis ----------
    const vz = zoneById('valle');
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const rr = 6 + Math.sqrt(r()) * (vz.r - 8);
      const x = vz.x + Math.cos(a) * rr;
      const z = vz.z + Math.sin(a) * rr;
      if (pathDist(x, z) < 5 || inArena(x, z)) continue;
      const s = 1.5 + r() * 2;
      L.jelly.push({ x, y: heightAt(x, z) + 0.05, z, s });
      block(x, z, s * 0.9);
    }
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * vz.r;
      const x = vz.x + Math.cos(a) * rr;
      const z = vz.z + Math.sin(a) * rr;
      L.lava.push({ x, y: heightAt(x, z) + 0.04, z, s: 1 + r() * 2.5, rot: r() * 6 });
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4;
      const x = vz.x + Math.cos(a) * (vz.r * 0.55);
      const z = vz.z + Math.sin(a) * (vz.r * 0.55);
      if (inArena(x, z)) continue;
      L.geysers.push({ x, y: heightAt(x, z), z });
    }
    for (const sh of ARENAS.ignis.shelters) {
      L.rocks.push({ x: sh.x, y: heightAt(sh.x, sh.z), z: sh.z, s: 2, rot: 0.5, c: 0x3a3532, shelter: true });
      block(sh.x, sh.z, 1.6);
    }

    // ---------- Islas Flotantes: nubes, islotes, puentes de arcoíris y templo ----------
    const iz = zoneById('islas');
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rr = iz.r * (1.05 + r() * 0.35);
      L.clouds.push({ x: iz.x + Math.cos(a) * rr, y: iz.ground - 6 + r() * 4, z: iz.z + Math.sin(a) * rr, s: 4 + r() * 4 });
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      const rr = iz.r + 10 + r() * 10;
      L.islets.push({ x: iz.x + Math.cos(a) * rr, y: iz.ground + 4 + r() * 10, z: iz.z + Math.sin(a) * rr, s: 3 + r() * 3 });
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.9;
      L.bridges.push({ x: iz.x + Math.cos(a) * (iz.r * 0.7), z: iz.z + Math.sin(a) * (iz.r * 0.7), rot: a, y: iz.ground });
    }
    const ga = ARENAS.guardian;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = ga.x + Math.cos(a) * ga.r;
      const z = ga.z + Math.sin(a) * ga.r;
      L.pillars.push({ x, y: heightAt(x, z), z });
      block(x, z, 0.8);
    }

    // Rejilla espacial para consultar obstáculos cercanos rápido
    const CELL = 8;
    const grid = new Map();
    for (const o of L.obstacles) {
      for (let gx = Math.floor((o.x - o.r) / CELL); gx <= Math.floor((o.x + o.r) / CELL); gx++) {
        for (let gz2 = Math.floor((o.z - o.r) / CELL); gz2 <= Math.floor((o.z + o.r) / CELL); gz2++) {
          const k = gx * 10007 + gz2;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(o);
        }
      }
    }
    L.near = (x, z) => grid.get(Math.floor(x / CELL) * 10007 + Math.floor(z / CELL)) || [];
    LAYOUT = L;
    return L;
  }

  // Empuja un punto fuera de los obstáculos (círculos). Devuelve true si chocó.
  function collide(pos, radius) {
    const L = layout();
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const o of L.near(pos.x, pos.z)) {
        const dx = pos.x - o.x;
        const dz = pos.z - o.z;
        const min = o.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.0001;
        pos.x = o.x + (dx / d) * min;
        pos.z = o.z + (dz / d) * min;
        hit = true;
      }
    }
    return hit;
  }

  return {
    WORLD, WORLD_LIMIT, VILLAGE_R, WATER_Y, FIELD_ZONES, OUTER_ZONES, ss, lerp, rng, pathDist, heightAt, inVillage, inSafe, zoneAt,
    waterDepth, SWIM_DEPTH, DEEP_DEPTH, SWIM_Y, layout, collide,
  };
});
