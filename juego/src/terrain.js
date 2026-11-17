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

  return { WORLD, WORLD_LIMIT, VILLAGE_R, WATER_Y, FIELD_ZONES, ss, lerp, rng, pathDist, heightAt, inVillage, zoneAt };
});
