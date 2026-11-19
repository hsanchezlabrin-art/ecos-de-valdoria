// Ayudante de Novatos: cuando un aventurero veterano y uno novato (10 niveles o más de diferencia)
// cumplen un objetivo juntos en grupo, ambos ganan Puntos de Amistad. No cambia el combate ni la
// experiencia: los puntos se canjearán por cosméticos y estelas.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../data.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    (V.Systems = V.Systems || {}).mentor = factory(V.Data);
  }
})(function (Data) {
  const { MENTOR } = Data;
  const num = (v) => Math.max(0, Math.floor(+v) || 0);

  // Miembros que forman pareja veterano-novato con alguien del grupo
  const eligible = (members) => (members.length < 2 ? [] : members.filter((q) => members.some((o) => o !== q && Math.abs(o.level - q.level) >= MENTOR.gap)));

  function give(api, q, pts, members, loud) {
    const s = q.ext.mentor;
    if (!s) return 0;
    const day = api.day();
    if (s.day !== day) {
      s.day = day;
      s.today = 0;
    }
    const add = Math.min(pts, MENTOR.dailyCap - s.today);
    if (add <= 0) return 0;
    s.today += add;
    s.pts += add;
    s.total += add;
    const veteran = members.some((o) => o.level <= q.level - MENTOR.gap);
    const why = veteran ? 'por ayudar a un aventurero novato' : 'por aventurarte con un veterano';
    api.log(q, `+${add} ${add === 1 ? 'Punto' : 'Puntos'} de Amistad ${why}.${s.today >= MENTOR.dailyCap ? ' (Llegaste al máximo de hoy.)' : ''}`, loud ? 'quest' : 'sys');
    return add;
  }

  return {
    id: 'mentor',
    load(raw) {
      const s = raw && typeof raw === 'object' ? raw : {};
      return { pts: num(s.pts), total: num(s.total), day: num(s.day), today: num(s.today), kills: num(s.kills) };
    },
    init(w, api) {
      api.bus.on('boss:defeated', ({ members }) => {
        for (const q of eligible(members)) give(api, q, MENTOR.boss, members, true);
      });
      api.bus.on('quest:done', ({ p, members }) => {
        const list = eligible(members);
        if (!list.includes(p)) return;
        for (const q of list) give(api, q, MENTOR.quest, members, true);
      });
      api.bus.on('mob:killed', ({ mob, members }) => {
        if (mob.def.boss) return;
        for (const q of eligible(members)) {
          const s = q.ext.mentor;
          if (!s) continue;
          s.kills = (s.kills || 0) + 1;
          if (s.kills >= MENTOR.killsPerPoint) {
            s.kills = 0;
            give(api, q, 1, members, false);
          }
        }
      });
    },
    view(w, p, api) {
      const s = p.ext.mentor || {};
      return { pts: s.pts || 0, total: s.total || 0, today: s.day === api.day() ? s.today || 0 : 0, cap: MENTOR.dailyCap };
    },
  };
});
