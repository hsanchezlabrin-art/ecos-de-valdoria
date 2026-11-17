// Estado compartido del cliente. Cuando haya servidor, gran parte de esto vendrá de la red.
export const G = {
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
