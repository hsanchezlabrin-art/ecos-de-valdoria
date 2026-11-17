// Estado compartido del cliente. Cuando haya servidor, gran parte de esto vendrá de la red.
// Los archivos usan scripts clásicos (sin módulos ES) para que el juego funcione abriéndolo
// desde el disco, dentro de la app de escritorio. Cada archivo publica su parte en window.V.
window.V = window.V || {};

V.G = {
  started: false,
  scene: null,
  camera: null,
  renderer: null,
  world: null,
  player: null,
  mobs: [],
  target: null,
  time: 0,
  keys: {},
  cam: { yaw: 0.7, pitch: 0.6, dist: 15 },
};
