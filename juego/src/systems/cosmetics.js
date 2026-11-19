// Cosméticos: estela al caminar, poción cosmética activa (color, tamaño o aura, con caducidad),
// títulos conseguidos y título elegido. Solo adorno: no toca estadísticas ni combate.
// Los títulos salen de dos sitios: las colecciones del álbum (p.ext.album.sets) y la tienda de
// Amistad (los entrega el sistema `amistad` por el bus con el evento `cosmetic:granted`).
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../data.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    (V.Systems = V.Systems || {}).cosmetics = factory(V.Data);
  }
})(function (Data) {
  const { friendItem } = Data;

  // Títulos que este jugador puede ponerse: [{ id, text, src }]
  function titlesOf(p) {
    const out = [];
    const sets = (p.ext.album && p.ext.album.sets) || {};
    for (const s of Data.albumData().sets) if (sets[s.id]) out.push({ id: `album:${s.id}`, text: s.title, src: s.name });
    const own = p.ext.cosmetics ? p.ext.cosmetics.own : {};
    for (const id of Object.keys(own)) {
      const it = friendItem(id);
      if (it && it.kind === 'title') out.push({ id: `shop:${id}`, text: it.text, src: 'Tienda de Amistad' });
    }
    return out;
  }
  const titleText = (p, id) => {
    const t = titlesOf(p).find((x) => x.id === id);
    return t ? t.text : '';
  };

  return {
    id: 'cosmetics',
    titlesOf,
    load(raw) {
      const s = raw && typeof raw === 'object' ? raw : {};
      const own = {};
      for (const id of Object.keys(s.own || {})) {
        const it = friendItem(id);
        if (it && (it.kind === 'trail' || it.kind === 'title') && s.own[id]) own[id] = 1;
      }
      const pt = s.potion && typeof s.potion === 'object' ? s.potion : null;
      const pit = pt ? friendItem(pt.id) : null;
      const left = pt ? Math.floor(+pt.left) || 0 : 0;
      return {
        own,
        trail: typeof s.trail === 'string' && own[s.trail] ? s.trail : '',
        potion: pit && pit.kind === 'potion' && left > 0 ? { id: pit.id, left: Math.min(left, pit.dur) } : null,
        title: typeof s.title === 'string' ? s.title : '', // se valida al mostrarse (el álbum se carga aparte)
      };
    },
    init(w, api) {
      // La tienda entrega aquí lo comprado. `ev.ok` avisa a la tienda de que se recibió.
      api.bus.on('cosmetic:granted', (ev) => {
        const s = ev.p.ext.cosmetics;
        const it = friendItem(ev.item);
        if (!s || !it) return;
        if (it.kind === 'potion') {
          s.potion = { id: it.id, left: it.dur };
        } else if (it.kind === 'trail' || it.kind === 'title') {
          if (s.own[it.id]) return;
          s.own[it.id] = 1;
          if (it.kind === 'trail' && !s.trail) s.trail = it.id;
          if (it.kind === 'title' && !s.title) s.title = `shop:${it.id}`;
        } else return;
        ev.ok = true;
      });
    },
    step(w, dt, api) {
      for (const p of api.players()) {
        const s = p.ext.cosmetics;
        if (!s || !s.potion) continue;
        s.potion.left -= dt;
        if (s.potion.left <= 0) {
          const it = friendItem(s.potion.id);
          s.potion = null;
          api.log(p, `Se acabó el efecto de ${it ? it.name : 'tu poción'}.`, 'sys');
        }
      }
    },
    commands: {
      // arg = id de título («album:praderas», «shop:tit_amigo») o vacío para quitarlo
      title(w, p, arg, api) {
        const s = p.ext.cosmetics;
        if (!s) return;
        if (!arg) {
          s.title = '';
          return;
        }
        if (!titlesOf(p).some((t) => t.id === arg)) return api.log(p, 'Todavía no tienes ese título.', 'warn');
        s.title = arg;
      },
      // arg = id de estela o vacío para quitarla
      trail(w, p, arg, api) {
        const s = p.ext.cosmetics;
        if (!s) return;
        if (!arg) {
          s.trail = '';
          return;
        }
        if (!s.own[arg] || !friendItem(arg) || friendItem(arg).kind !== 'trail') return api.log(p, 'Todavía no tienes esa estela.', 'warn');
        s.trail = arg;
      },
      // Quitarse el efecto de la poción antes de que acabe
      clearPotion(w, p) {
        const s = p.ext.cosmetics;
        if (s) s.potion = null;
      },
    },
    // Apariencia que ven los demás jugadores: "estela|poción|título" (texto corto para la red)
    look(p) {
      const s = p.ext.cosmetics;
      if (!s) return '';
      const text = s.title ? titleText(p, s.title) : '';
      if (!s.trail && !s.potion && !text) return '';
      return `${s.trail}|${s.potion ? s.potion.id : ''}|${text}`;
    },
    view(w, p) {
      const s = p.ext.cosmetics || { own: {}, trail: '', potion: null, title: '' };
      const valid = s.title && titleText(p, s.title) ? s.title : '';
      return { own: s.own, trail: s.trail, potion: s.potion ? { id: s.potion.id, left: Math.ceil(s.potion.left / 10) * 10 } : null, title: valid, titles: titlesOf(p) };
    },
  };
});
