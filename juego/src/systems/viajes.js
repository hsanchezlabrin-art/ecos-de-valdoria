// Red de portales: el Portal de los Viajeros (uno en cada aldea) lleva a cualquier aldea o zona que
// el jugador ya haya visitado, a cambio de oro. Lo visitado se aprende con el evento zone:entered y se
// guarda en p.ext.viajes.known. Todo se valida aquí, en la simulación del servidor: estar junto a un
// portal, conocer el destino, no estar en combate y tener el oro.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../data.js'), require('../terrain.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    (V.Systems = V.Systems || {}).viajes = factory(V.Data, V.Terrain);
  }
})(function (Data, Terrain) {
  const { ZONES, NPCS, portalDest } = Data;
  const ALWAYS = ['aldea']; // la aldea de inicio siempre se conoce
  const zoneById = (id) => ZONES.find((z) => z.id === id) || null;

  // Punto de llegada: junto al portal de la aldea, o en el borde de la zona que mira a su aldea
  function arrival(id) {
    const z = zoneById(id);
    if (!z) return null;
    if (id === 'aldea' || z.safe) {
      const portal = NPCS.find((n) => n.role === 'portal' && Terrain.zoneAt(n) && Terrain.zoneAt(n).id === id);
      const cx = id === 'aldea' ? 0 : z.x;
      const cz = id === 'aldea' ? 0 : z.z;
      if (!portal) return { x: cx, z: cz + 4 };
      const dx = cx - portal.x;
      const dz = cz - portal.z;
      const len = Math.hypot(dx, dz) || 1;
      return { x: portal.x + (dx / len) * 3, z: portal.z + (dz / len) * 3 };
    }
    const home = Terrain.nearestHome(z);
    const dx = home.x - z.x;
    const dz = home.z - z.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: z.x + (dx / len) * z.r * 0.8, z: z.z + (dz / len) * z.r * 0.8 };
  }

  const learn = (e, id) => {
    if (!portalDest(id) || e.known.includes(id)) return false;
    e.known.push(id);
    return true;
  };

  return {
    id: 'viajes',
    arrival,
    init(w, api) {
      api.bus.on('zone:entered', ({ p, zone }) => {
        const e = p.ext.viajes;
        if (e && learn(e, zone.id)) api.log(p, `Nuevo destino en la Red de Portales: ${zone.name}.`, 'quest');
      });
    },
    load(raw) {
      const known = raw && Array.isArray(raw.known) ? raw.known.filter((id) => typeof id === 'string' && portalDest(id)) : [];
      const e = { known: [...new Set(known)] };
      for (const id of ALWAYS) learn(e, id);
      return e;
    },
    commands: {
      // Viajar a un destino (id de zona)
      go(w, p, id, api) {
        if (p.dead || typeof id !== 'string') return;
        const e = p.ext.viajes;
        const dest = portalDest(id);
        const z = zoneById(id);
        if (!e || !dest || !z) return;
        const npc = api.nearNpc(p, 'portal');
        if (!npc) return api.log(p, 'Acércate a un Portal de los Viajeros (hay uno en cada aldea).', 'warn');
        if (!e.known.includes(id)) return api.log(p, `Aún no conoces ${z.name}: tienes que llegar caminando al menos una vez.`, 'warn');
        const here = Terrain.zoneAt(npc);
        if (here && here.id === id) return api.log(p, `Ya estás en ${z.name}.`, 'warn');
        if (api.inCombat(p)) return api.log(p, 'No puedes viajar en pleno combate. Espera unos segundos.', 'warn');
        if (!api.spendGold(p, dest.price)) return api.log(p, `Te falta oro: el viaje a ${z.name} cuesta ${dest.price.toLocaleString('es')}.`, 'warn');
        const to = arrival(id);
        api.ring({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, 0x7dffc0, 2.4, 0.7);
        api.teleport(p, to, z.name);
        api.ring({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, 0x7dffc0, 2.4, 0.7);
        api.log(p, `Cruzas el portal hacia ${z.name} (−${dest.price.toLocaleString('es')} de oro).`, 'sys');
      },
    },
    view(w, p) {
      const e = p.ext.viajes;
      return { known: e ? e.known : [...ALWAYS] };
    },
  };
});
