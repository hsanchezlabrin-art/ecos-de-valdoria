// Arranque, entrada (ratón/teclado/toque), cámara y bucle principal.
import { G } from './state.js';
import { ZONES } from './data.js';
import { buildWorld, heightAt } from './world.js';
import * as Game from './game.js';
import * as UI from './ui.js';

const THREE = window.THREE;
const SAVE_KEY = 'valdoria-save-v1';

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeSave() {
  if (!G.started) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(Game.serialize()));
  } catch {
    /* almacenamiento no disponible */
  }
}

// ---------- Escena ----------

const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.append(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcdb898, 70, 270);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1400);
G.scene = scene;
G.camera = camera;
G.renderer = renderer;

scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a3b28, 0.62));
const sun = new THREE.DirectionalLight(0xffe0b0, 1.25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

G.world = buildWorld(scene);
G.world.zones = ZONES.filter((z) => !z.safe);

// ---------- Cámara ----------

const look = new THREE.Vector3();
function updateCamera(dt) {
  const c = G.cam;
  if (!G.started) c.yaw += dt * 0.05;
  const t = G.player ? G.player.pos : new THREE.Vector3(0, 0, 0);
  const cp = Math.cos(c.pitch);
  camera.position.set(t.x + Math.sin(c.yaw) * cp * c.dist, t.y + 1.4 + Math.sin(c.pitch) * c.dist, t.z + Math.cos(c.yaw) * cp * c.dist);
  const gy = heightAt(camera.position.x, camera.position.z) + 0.8;
  if (camera.position.y < gy) camera.position.y = gy;
  look.set(t.x, t.y + 1.6, t.z);
  camera.lookAt(look);
  G.world.sky.position.copy(camera.position);
  sun.position.set(t.x + 45, t.y + 80, t.z + 30);
  sun.target.position.set(t.x, t.y, t.z);
}

// ---------- Entrada ----------

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;

function pick(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const mobRoots = G.mobs.filter((m) => !m.dead && m.model.root.visible).map((m) => m.model.root);
  const hit = ray.intersectObjects([...mobRoots, G.world.merchant.root, G.world.terrain], true)[0];
  if (!hit) return;
  const ud = hit.object.userData;
  if (ud.mob) {
    Game.setTarget(ud.mob);
    Game.attackTarget();
  } else if (ud.npc === 'merchant') {
    Game.talkToMerchant();
  } else {
    Game.moveTo(hit.point);
  }
}

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  drag.moved = true;
  G.cam.yaw -= dx * 0.006;
  G.cam.pitch = Math.min(1.3, Math.max(0.12, G.cam.pitch + dy * 0.004));
  drag.x = e.clientX;
  drag.y = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  if (drag && !drag.moved && drag.button === 0 && G.started) pick(e.clientX, e.clientY);
  drag = null;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    G.cam.dist = Math.min(32, Math.max(5, G.cam.dist * (1 + e.deltaY * 0.001)));
  },
  { passive: false }
);

addEventListener('keydown', (e) => {
  if (!G.started || e.target.tagName === 'INPUT') return;
  G.keys[e.code] = true;
  switch (e.code) {
    case 'Tab':
      e.preventDefault();
      Game.targetNearest();
      break;
    case 'Escape':
      if (!UI.closeAll()) Game.setTarget(null);
      break;
    case 'KeyI':
      UI.togglePanel('inv');
      break;
    case 'KeyH':
      UI.togglePanel('help');
      break;
    case 'KeyF':
      Game.attackTarget();
      break;
    case 'KeyQ':
      G.cam.yaw += 0.25;
      break;
    case 'KeyE':
      G.cam.yaw -= 0.25;
      break;
    case 'Digit1':
    case 'Digit2':
    case 'Digit3':
    case 'Digit4':
      Game.useSkill(+e.code.slice(-1) - 1);
      break;
    case 'Digit5':
      Game.usePotion('pocion_vida');
      break;
    case 'Digit6':
      Game.usePotion('pocion_mana');
      break;
  }
});
addEventListener('keyup', (e) => (G.keys[e.code] = false));
addEventListener('blur', () => (G.keys = {}));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Pantalla de inicio ----------

const save = loadSave();
const nameInput = document.getElementById('nameInput');
const btnStart = document.getElementById('btnStart');
const btnReset = document.getElementById('btnReset');
if (save) {
  nameInput.value = save.name;
  btnStart.textContent = 'Continuar aventura';
  btnReset.hidden = false;
  document.getElementById('saveInfo').textContent = `${save.name} · Guerrero de nivel ${save.level}`;
}
let resetArmed = false;
btnReset.addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    btnReset.textContent = 'Pulsa otra vez para borrarlo';
    return;
  }
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nada */
  }
  location.reload();
});

function start() {
  const name = (nameInput.value || '').trim().slice(0, 16) || 'Viajero';
  const data = save ? { ...save, name } : Game.newCharacter(name);
  Game.createPlayer(data);
  UI.initUI();
  Game.spawnMobs();
  G.cam.dist = 15;
  G.cam.pitch = 0.6;
  G.started = true;
  document.getElementById('start').hidden = true;
  UI.log(`Bienvenido a Valdoria, ${name}.`, 'sys');
  UI.log('Clic en el suelo para moverte, clic en un monstruo para atacar. Pulsa H para ver los controles.', 'sys');
  UI.banner('Aldea de Brezal', 'Zona segura');
  setInterval(writeSave, 8000);
  addEventListener('beforeunload', writeSave);
  addEventListener('visibilitychange', () => document.hidden && writeSave());
}
btnStart.addEventListener('click', start);
nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && start());
document.getElementById('btnRespawn').addEventListener('click', () => Game.respawnPlayer());

// ---------- App de escritorio (Electron) ----------

if (window.desktop) {
  window.desktop.getVersion().then((ver) => {
    document.getElementById('versionTag').textContent = `Versión de escritorio · v${ver}`;
  });
  const box = document.getElementById('updateStatus');
  window.desktop.onUpdateStatus((text) => {
    box.textContent = text;
    box.hidden = !text;
  });
}

// ---------- Bucle ----------

const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  G.time += dt;
  if (G.started) Game.update(dt);
  updateCamera(dt);
  for (const f of G.world.fires) {
    f.light.intensity = f.base * (0.85 + Math.sin(G.time * 13) * 0.08 + Math.random() * 0.07);
    f.flame.scale.y = 0.9 + Math.sin(G.time * 17) * 0.12;
  }
  if (G.started) UI.updateUI();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
window.__valdoria = G;
G.debug = { Game, UI };
