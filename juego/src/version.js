// Versión del juego (una sola fuente para el juego, la web, el servidor y la app de escritorio).
// Al publicar: cambiar aquí, agregar la entrada en changelog.js y crear la etiqueta git vX.Y.Z.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const V = (globalThis.V = globalThis.V || {});
    V.VERSION = factory().VERSION;
  }
})(function () {
  return { VERSION: '0.5.6' };
});
