// Tienda de Amistad: canjea los Puntos de Amistad (p.ext.mentor.pts) por pociones cosméticas,
// estelas y títulos. No guarda datos propios: lo comprado se entrega al sistema `cosmetics` con el
// evento `cosmetic:granted`; si nadie lo recibe, no se cobra nada.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../data.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    (V.Systems = V.Systems || {}).amistad = factory(V.Data);
  }
})(function (Data) {
  const { friendItem } = Data;

  return {
    id: 'amistad',
    commands: {
      buy(w, p, id, api) {
        const it = typeof id === 'string' ? friendItem(id) : null;
        const m = p.ext.mentor;
        if (!it || !m) return;
        const cos = p.ext.cosmetics;
        if (cos && cos.own[it.id]) return api.log(p, `Ya tienes ${it.name}.`, 'warn');
        if (m.pts < it.price) return api.log(p, `Te faltan ${it.price - m.pts} Puntos de Amistad para ${it.name}.`, 'warn');
        const ev = { p, item: it.id, ok: false };
        api.bus.emit('cosmetic:granted', ev);
        if (!ev.ok) return api.log(p, 'No se pudo canjear ahora. Prueba de nuevo.', 'warn');
        m.pts -= it.price;
        const what = it.kind === 'potion' ? '¡Te la bebes!' : it.kind === 'trail' ? 'Ya puedes activarla.' : 'Ya puedes ponértelo.';
        api.log(p, `Canjeaste ${it.name} por ${it.price} Puntos de Amistad. ${what}`, 'quest');
      },
    },
    view(w, p) {
      const m = p.ext.mentor;
      return { pts: m ? m.pts : 0 };
    },
  };
});
