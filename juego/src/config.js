// Configuración del cliente.
// SERVER_URL: servidor online (Fly.io). Para pruebas se puede cambiar con ?server=ws://127.0.0.1:8080/ws
(function () {
  const V = (globalThis.V = globalThis.V || {});
  let url = 'wss://ecos-de-valdoria.fly.dev/ws';
  try {
    const q = new URLSearchParams(location.search).get('server');
    if (q && /^wss?:\/\//.test(q)) url = q;
  } catch {
    /* sin location (Node) */
  }
  V.Config = { SERVER_URL: url, PROTOCOL: 3 };
})();
