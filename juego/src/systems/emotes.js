// Sistema de gestos (emotes): saludar, aplaudir, animar, bailar, celebrar y sentarse.
// Módulo desacoplado: no toca el combate; solo valida el gesto, aplica un enfriamiento anti-spam
// y avisa a quienes están cerca (el cliente anima al personaje y muestra el emoji).
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../data.js'));
  else {
    const V = (globalThis.V = globalThis.V || {});
    (V.Systems = V.Systems || {}).emotes = factory(V.Data);
  }
})(function (Data) {
  const { EMOTES, EMOTE_CD } = Data;

  return {
    id: 'emotes',
    commands: {
      play(w, p, id, api) {
        const e = EMOTES.find((x) => x.id === id);
        if (!e || p.dead || p.leap) return;
        if (e.id === 'sentarse' && p.mounted) return api.log(p, 'Baja de tu montura para sentarte.', 'warn');
        const now = api.now();
        if ((p.emoteReady || 0) > now) return; // anti-spam: se ignora en silencio
        p.emoteReady = now + EMOTE_CD;
        api.fx({ type: 'emote', ent: p, id: e.id });
        api.bus.emit('emote:played', { p, id: e.id });
      },
    },
  };
});
