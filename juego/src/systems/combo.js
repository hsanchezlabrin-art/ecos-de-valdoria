// Combos elementales entre clases: algunas habilidades (campo `applies` en data.js) dejan una
// etiqueta en el monstruo durante unos segundos. Si OTRO jugador le pone una etiqueta que hace
// pareja (Data.COMBOS) antes de que caduque, estalla un combo: daño en área, empuje y un efecto de
// colores. Las dos etiquetas se consumen.
// Módulo desacoplado: escucha `skill:cast` y actúa solo con la API del núcleo (damageArea, push,
// mobsNear, fx, float, log). No cambia el combate base.
// PvP: los combos solo existen contra monstruos. Una habilidad lanzada contra otro jugador no deja
// etiqueta y el daño del combo (damageArea) nunca alcanza a jugadores.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../data.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    (V.Systems = V.Systems || {}).combo = factory(V.Data);
  }
})(function (Data) {
  const { COMBO_TAGS, comboFor } = Data;
  // Combos pendientes por mundo: se resuelven en el siguiente paso, cuando la habilidad que los
  // completó ya hizo su propio efecto (así nunca interrumpen el combate a mitad de un lanzamiento)
  const STATE = new WeakMap();
  const stateOf = (w) => {
    if (!STATE.has(w)) STATE.set(w, { queue: [], sweep: 0 });
    return STATE.get(w);
  };

  // ¿La habilidad llega al objetivo? Las que salen desde el lanzador (alrededor, cono, línea) solo
  // etiquetan si el objetivo está a su alcance; las que apuntan al objetivo, siempre.
  function reaches(api, s, p, t) {
    const d = api.dist(p.pos, t.pos);
    if (s.type === 'aoe' || s.type === 'cone' || s.type === 'pulse') return d <= (s.radius || 0) + 1.5;
    if (s.type === 'line') return d <= (s.length || 0) + 1;
    return true;
  }

  const live = (m, now) => {
    const tags = m.comboTags;
    if (!tags) return [];
    for (const k of Object.keys(tags)) if (tags[k].until <= now) delete tags[k];
    return Object.keys(tags);
  };

  function tag(api, w, p, m, tagId) {
    const now = api.now();
    const def = COMBO_TAGS[tagId];
    const current = live(m, now);
    // ¿Hace pareja con una etiqueta que puso otro jugador?
    for (const other of current) {
      const c = comboFor(other, tagId);
      const by = m.comboTags[other].by;
      if (!c || by === p.id) continue;
      delete m.comboTags[other]; // se consumen las dos (la nueva ni se guarda)
      stateOf(w).queue.push({ combo: c, p, m, partner: by });
      return;
    }
    m.comboTags = m.comboTags || {};
    m.comboTags[tagId] = { until: now + def.dur, by: p.id };
    api.fx({ type: 'comboTag', ent: m, tag: tagId, dur: def.dur });
  }

  function explode(api, { combo: c, p, m, partner }) {
    if (!m || m.dead) return;
    const at = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
    const hit = api.mobsNear(at, c.radius);
    api.damageArea(p, at, c.radius, c.mult);
    if (c.push) for (const x of hit) if (!x.dead && x !== m) api.push(x, at, c.push);
    api.fx({ type: 'combo', pos: at, id: c.id, name: c.name, color: c.fx, r: c.radius, hop: c.bounce ? hit.filter((x) => !x.dead).map((x) => x.id) : [] });
    if (!m.dead) api.float(m, `¡${c.name}!`, 'combo', 0.9);
    const mate = api.playerById(partner);
    api.log(p, `✨ ¡Combo! ${c.name}${mate ? ` con ${mate.name}` : ''}.`, 'quest');
    if (mate && mate !== p) api.log(mate, `✨ ¡Combo! ${c.name} con ${p.name}.`, 'quest');
  }

  return {
    id: 'combo',
    init(w, api) {
      stateOf(w);
      api.bus.on('skill:cast', ({ p, skill, target }) => {
        const tagId = skill && skill.applies;
        if (!tagId || !COMBO_TAGS[tagId] || !target || target.kind !== 'mob' || target.dead) return;
        if (!reaches(api, skill, p, target)) return;
        tag(api, w, p, target, tagId);
      });
      api.bus.on('mob:killed', ({ mob }) => {
        if (mob) mob.comboTags = null;
      });
    },
    step(w, dt, api) {
      const st = stateOf(w);
      if (st.queue.length) {
        const list = st.queue;
        st.queue = [];
        for (const job of list) explode(api, job);
      }
      // Limpieza ocasional de etiquetas caducadas
      st.sweep -= dt;
      if (st.sweep <= 0) {
        st.sweep = 2;
        for (const m of api.mobsNear({ x: 0, z: 0 }, Infinity)) if (m.comboTags && !live(m, api.now()).length) m.comboTags = null;
      }
    },
  };
});
