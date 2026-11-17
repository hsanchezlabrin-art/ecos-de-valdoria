// Geometría lógica del mundo: alturas del terreno, límites, aldea y zonas.
// Sin gráficos: lo usan el cliente (para dibujar) y el servidor (para simular).
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    V.Terrain = factory(V.Data);
  }
})(function (Data) {
  const { ZONES } = Data;

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

  const FIELD_ZONES = ZONES.filter((z) => !z.safe);

  function distSeg(px, pz, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  }
  function pathDist(x, z) {
    let d = Infinity;
    for (const zn of FIELD_ZONES) d = Math.min(d, distSeg(x, z, 0, 0, zn.x, zn.z));
    return d;
  }

  function heightAt(x, z) {
    let h =
      Math.sin(x * 0.021 + 0.4) * Math.cos(z * 0.018) * 5.5 +
      Math.sin(x * 0.055 + 1.3) * Math.sin(z * 0.049 + 0.7) * 1.8 +
      Math.sin((x - z) * 0.012) * 3.5 +
      Math.cos(z * 0.09 + x * 0.03) * 0.6;
    for (const zn of FIELD_ZONES) {
      const w = 1 - ss(zn.r * 0.6, zn.r * 1.35, Math.hypot(x - zn.x, z - zn.z));
      if (w > 0) h = lerp(h, zn.ground + h * 0.12, w * 0.85);
    }
    const pd = pathDist(x, z);
    if (pd < 6) h = lerp(h, Math.max(h * 0.4, 0.2), (1 - ss(2, 6, pd)) * 0.7);
    const d = Math.hypot(x, z);
    h *= ss(VILLAGE_R * 0.8, VILLAGE_R + 20, d);
    h += Math.max(0, d - 168) * 0.6;
    return h;
  }

  const inVillage = (p) => Math.hypot(p.x, p.z) < VILLAGE_R;

  function zoneAt(p) {
    if (inVillage(p)) return ZONES[0];
    for (const z of FIELD_ZONES) if (Math.hypot(p.x - z.x, p.z - z.z) < z.r * 1.1) return z;
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
    const L = { trunks: [], pines: [], rounds: [], rocks: [], lava: [], houses: [], tents: [], logs: [], fires: [], obstacles: [] };
    const block = (x, z, r) => L.obstacles.push({ x, z, r });

    // Vegetación
    const r = rng(42);
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
        L.trunks.push({ x, y: h, z, s, rot, c: 0x4a3626, tall: 1 });
        L.pines.push({ x, y: h + 2.0 * s, z, s: s * 1.25, rot, c: r() < 0.5 ? 0x2d4a2a : 0x34552e });
        L.pines.push({ x, y: h + 3.4 * s, z, s: s * 0.9, rot, c: 0x3a5e33 });
      } else if (type === 'round') {
        L.trunks.push({ x, y: h, z, s, rot, c: 0x5a4130, tall: 1 });
        L.rounds.push({ x, y: h + 2.6 * s, z, s: s * 1.5, rot, c: r() < 0.5 ? 0x4f7a34 : 0x5e8a3a });
      } else if (type === 'swamp') {
        L.trunks.push({ x, y: h, z, s, rot, c: 0x3a3226, tall: 1.3 });
        L.rounds.push({ x, y: h + 3.1 * s, z, s: s * 1.2, rot, c: 0x324a2a });
      } else {
        L.trunks.push({ x, y: h, z, s: s * 0.8, rot, c: 0x3d3835, tall: 1.6 });
      }
      block(x, z, 0.3 * s + 0.12);
    }
    // Rocas: solo las grandes bloquean el paso
    for (let i = 0; i < 420; i++) {
      const x = (r() - 0.5) * 2 * 182;
      const z = (r() - 0.5) * 2 * 182;
      const d = Math.hypot(x, z);
      if (d < VILLAGE_R + 3 || pathDist(x, z) < 3) continue;
      const zn = FIELD_ZONES.find((zz) => Math.hypot(x - zz.x, z - zz.z) < zz.r);
      const s = 0.4 + r() * (d > 150 ? 3 : 1.2);
      L.rocks.push({ x, y: heightAt(x, z), z, s, rot: r() * 6, c: zn && zn.id === 'ceniza' ? 0x2f2c2a : 0x77716a });
      if (s > 0.75) block(x, z, s * 0.85);
    }
    // Grietas de lava (decorativas)
    const cz = ZONES.find((z) => z.id === 'ceniza');
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * cz.r;
      const x = cz.x + Math.cos(a) * rr;
      const z = cz.z + Math.sin(a) * rr;
      L.lava.push({ x, y: heightAt(x, z) + 0.04, z, s: 1 + r() * 2.5, rot: r() * 6 });
    }

    // Aldea: casas alrededor de la plaza, sin tapar los caminos
    const rv = rng(5);
    const pathAngles = FIELD_ZONES.map((zn) => Math.atan2(zn.z, zn.x));
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

    // Campamento goblin: tiendas y fogata
    const gz = ZONES.find((z) => z.id === 'goblin');
    L.fires.push({ x: gz.x, z: gz.z, big: false });
    block(gz.x, gz.z, 0.9);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const x = gz.x + Math.cos(a) * 9;
      const z = gz.z + Math.sin(a) * 9;
      L.tents.push({ x, z, c: i % 2 ? 0x7d6440 : 0x6a5233 });
      block(x, z, 1.75);
    }
    // Fuerte orco: empalizada circular con dos entradas
    const fz = ZONES.find((z) => z.id === 'fuerte');
    L.fires.push({ x: fz.x, z: fz.z, big: true });
    block(fz.x, fz.z, 0.9);
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      if (Math.abs(Math.sin(a - 0.6)) < 0.12) continue;
      const x = fz.x + Math.cos(a) * 21;
      const z = fz.z + Math.sin(a) * 21;
      L.logs.push({ x, z, a });
      block(x, z, 0.42);
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
    WORLD, WORLD_LIMIT, VILLAGE_R, WATER_Y, FIELD_ZONES, ss, lerp, rng, pathDist, heightAt, inVillage, zoneAt,
    waterDepth, SWIM_DEPTH, DEEP_DEPTH, SWIM_Y, layout, collide,
  };
});
