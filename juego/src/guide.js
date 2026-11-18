// Navegación asistida: partículas doradas que marcan el camino hacia tu próximo objetivo.
// Objetivo: tu misión de cambio de clase (zona o jefe), el Maestro Aldric cuando toca
// cambiar de clase o la zona recomendada para tu nivel. Siguen los caminos: si estás lejos
// del camino hacia el objetivo, primero te llevan de vuelta a la aldea.
(function () {
  const THREE = window.THREE;
  const G = V.G;
  const D = V.Data;
  const { heightAt, zoneAt } = V.Terrain;
  const KEY = 'valdoria-guia';
  const N = 12; // partículas
  const STEP = 2.2; // metros entre partículas

  let enabled = true;
  try {
    enabled = localStorage.getItem(KEY) !== '0';
  } catch {
    /* sin almacenamiento */
  }

  let sparks = null;
  let label = '';
  let goalCache = null;
  let recalc = 0;

  function build() {
    sparks = [];
    const geo = new THREE.OctahedronGeometry(0.16, 0);
    for (let i = 0; i < N; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: V.Gfx.hot(0xffe08a, 1.5), transparent: true, opacity: 0.85, depthWrite: false }));
      m.raycast = () => {};
      m.visible = false;
      G.scene.add(m);
      sparks.push(m);
    }
  }

  const fieldZones = () => D.ZONES.filter((z) => !z.safe);
  const lvRange = (z) => z.lvl.split(' ')[0].split('–').map(Number);

  // Zona con monstruos de al menos ese nivel (la más fácil que cumpla)
  function zoneWithMobs(minLvl) {
    const mobs = Object.values(D.MOBS)
      .filter((m) => !m.boss && m.lvl[1] >= minLvl)
      .sort((a, b) => a.lvl[0] - b.lvl[0]);
    return mobs.length ? D.ZONES.find((z) => z.id === mobs[0].zone) : null;
  }

  // Calcula el objetivo actual: { x, z, r, text }
  function objective(p) {
    const npc = (id) => D.NPCS.find((n) => n.id === id);
    const master = npc('maestro');
    const toMaster = (why) => ({ x: master.x, z: master.z, r: 5, text: `Maestro Aldric (${why})` });
    const q = p.quest;
    if (q) {
      const def = D.questFor(q.stage);
      if (def && q.kills >= def.need) return toMaster('misión cumplida');
      if (def && def.boss) {
        const z = D.ZONES.find((zz) => zz.id === D.MOBS[def.boss].zone);
        return { x: z.x, z: z.z, r: z.r * 0.6, text: `${z.name} (${D.MOBS[def.boss].name})` };
      }
      if (def) {
        const z = zoneWithMobs(def.minLvl);
        if (z) return { x: z.x, z: z.z, r: z.r * 0.7, text: `${z.name} (misión ${q.kills}/${def.need})` };
      }
    }
    const next = D.STAGES[(p.stage || 0) + 1];
    if (next && p.level >= next.lvl) return toMaster(next.name);
    const field = fieldZones();
    const z = field.find((zz) => {
      const [a, b] = lvRange(zz);
      return p.level >= a - 1 && p.level <= b;
    }) || field[field.length - 1];
    return { x: z.x, z: z.z, r: z.r * 0.7, text: `${z.name} (nivel ${z.lvl})` };
  }

  const distSeg = (px, pz, ax, az, bx, bz) => {
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
    return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
  };

  // Camino: por el sendero de la aldea hacia el objetivo
  function route(p, goal) {
    const here = zoneAt(p.pos);
    const inVillage = here && here.safe;
    const onRoad = distSeg(p.pos.x, p.pos.z, 0, 0, goal.x, goal.z) < 9;
    if (inVillage || onRoad) return [goal];
    return [{ x: 0, z: 0 }, goal];
  }

  function update(dt) {
    const p = G.player;
    if (!p || !G.scene) return;
    if (!sparks) build();
    const txt = document.getElementById('guideTxt');
    recalc -= dt;
    if (recalc <= 0) {
      recalc = 0.5;
      goalCache = enabled && !p.dead ? objective(p) : null;
    }
    const goal = goalCache;
    const far = goal && Math.hypot(goal.x - p.pos.x, goal.z - p.pos.z) > goal.r;
    if (txt) {
      const t = goal ? `➜ ${goal.text}` : '';
      if (t !== label) {
        label = t;
        txt.textContent = t;
      }
      txt.hidden = !goal;
    }
    if (!goal || !far) {
      for (const s of sparks) s.visible = false;
      return;
    }
    // Recorre la ruta y coloca las partículas a lo largo de ella, avanzando con el tiempo
    const pts = [{ x: p.pos.x, z: p.pos.z }, ...route(p, goal)];
    const shift = (G.time * 3) % STEP;
    let seg = 0;
    let segPos = 1.5 + shift;
    for (let i = 0; i < N; i++) {
      let ax = pts[seg].x;
      let az = pts[seg].z;
      let len = Math.hypot(pts[seg + 1].x - ax, pts[seg + 1].z - az);
      while (segPos > len && seg < pts.length - 2) {
        segPos -= len;
        seg++;
        ax = pts[seg].x;
        az = pts[seg].z;
        len = Math.hypot(pts[seg + 1].x - ax, pts[seg + 1].z - az);
      }
      const s = sparks[i];
      if (segPos > len) {
        s.visible = false;
        continue;
      }
      const k = segPos / (len || 1);
      const x = ax + (pts[seg + 1].x - ax) * k;
      const z = az + (pts[seg + 1].z - az) * k;
      s.visible = true;
      s.position.set(x, Math.max(heightAt(x, z), -1.7) + 0.6 + Math.sin(G.time * 4 + i) * 0.12, z);
      s.rotation.y += dt * 3;
      // Las más lejanas se desvanecen
      s.material.opacity = 0.85 * (1 - i / N) + 0.1;
      segPos += STEP;
    }
  }

  function toggle() {
    enabled = !enabled;
    recalc = 0;
    try {
      localStorage.setItem(KEY, enabled ? '1' : '0');
    } catch {
      /* nada */
    }
  }

  V.Guide = {
    update,
    toggle,
    objective,
    get enabled() {
      return enabled;
    },
  };
})();
