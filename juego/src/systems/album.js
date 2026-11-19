// Álbum de coleccionables: anota las criaturas derrotadas, las tierras visitadas, el botín
// encontrado y los gestos usados. Al completar una colección entrega oro, objetos y un título.
// Módulo desacoplado: solo escucha eventos del bus.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../data.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    (V.Systems = V.Systems || {}).album = factory(V.Data);
  }
})(function (Data) {
  const CATS = ['mobs', 'zones', 'items', 'emotes'];
  const NAMES = {
    mobs: (id) => (Data.MOBS[id] ? Data.MOBS[id].name : id),
    zones: (id) => (Data.ZONES.find((z) => z.id === id) || { name: id }).name,
    items: (id) => (Data.ITEMS[id] ? Data.ITEMS[id].name : id),
    emotes: (id) => (Data.EMOTES.find((e) => e.id === id) || { name: id }).name,
  };
  const LABEL = { mobs: 'criatura', zones: 'tierra', items: 'objeto', emotes: 'gesto' };
  // Solo cuentan las entradas que existen en alguna colección
  const valid = (cat, id) => Data.albumData().sets.some((s) => s.cat === cat && s.items.includes(id));

  function note(api, p, cat, id) {
    const a = p.ext.album;
    if (!a || !valid(cat, id)) return;
    const book = a[cat];
    const first = !book[id];
    book[id] = (book[id] || 0) + 1;
    if (!first) return;
    if (cat !== 'zones') api.log(p, `📖 Nueva ${LABEL[cat]} en tu álbum: ${NAMES[cat](id)}.`, cat === 'mobs' ? 'quest' : 'sys');
    checkSets(api, p, cat);
  }

  function checkSets(api, p, cat) {
    const a = p.ext.album;
    for (const s of Data.albumData().sets) {
      if (s.cat !== cat || a.sets[s.id] || !s.items.every((id) => a[cat][id])) continue;
      a.sets[s.id] = 1;
      p.gold += s.gold;
      for (const [id, qty] of s.give) api.addItem(p, id, qty);
      api.banner(p, `📖 ${s.name}`, `¡Colección completa! +${s.gold.toLocaleString('es')} oro · Título: «${s.title}»`);
      api.log(p, `Completaste la colección ${s.name}: +${s.gold.toLocaleString('es')} oro y el título «${s.title}».`, 'sys');
    }
  }

  return {
    id: 'album',
    load(raw) {
      const src = raw && typeof raw === 'object' ? raw : {};
      const out = { sets: {} };
      for (const c of CATS) {
        out[c] = {};
        for (const [k, v] of Object.entries(src[c] || {})) if (valid(c, k)) out[c][k] = Math.max(1, Math.floor(+v) || 1);
      }
      for (const s of Data.albumData().sets) if (src.sets && src.sets[s.id]) out.sets[s.id] = 1;
      return out;
    },
    init(w, api) {
      api.bus.on('mob:killed', ({ mob, members }) => {
        for (const q of members) note(api, q, 'mobs', mob.key);
      });
      api.bus.on('zone:entered', ({ p, zone }) => note(api, p, 'zones', zone.id));
      api.bus.on('item:gained', ({ p, id }) => note(api, p, 'items', id));
      api.bus.on('emote:played', ({ p, id }) => note(api, p, 'emotes', id));
    },
    view(w, p) {
      const a = p.ext.album || {};
      return { mobs: a.mobs || {}, zones: a.zones || {}, items: a.items || {}, emotes: a.emotes || {}, sets: a.sets || {} };
    },
  };
});
