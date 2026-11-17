// Arranque por etapas (informa el progreso al splash de la app), entrada, cámara y bucle principal.
(function () {
  const G = V.G;
  const { ZONES, CLASSES, CLASS_IDS } = V.Data;
  const { buildWorld, heightAt } = V.World;
  const Game = V.Game;
  const UI = V.UI;

  const THREE = window.THREE;
  const desktop = window.desktop || null;

  // ---------- Partidas guardadas: una por clase ----------
  const saveKey = (cls) => (cls === 'guerrero' ? 'valdoria-save-v1' : `valdoria-save-v1-${cls}`);

  function loadSave(cls) {
    try {
      const raw = localStorage.getItem(saveKey(cls));
      if (!raw) return null;
      const s = JSON.parse(raw);
      s.cls = s.cls || 'guerrero';
      return s.cls === cls ? s : null;
    } catch {
      return null;
    }
  }
  function storeSave(cls, data) {
    if (!data) return;
    try {
      localStorage.setItem(saveKey(cls), JSON.stringify(data));
    } catch {
      /* almacenamiento no disponible */
    }
  }
  function writeSave() {
    if (G.started) storeSave(G.player.cls, Game.serialize());
  }

  // ---------- Pantalla de carga ----------
  const loadEl = document.getElementById('loading');
  const loadBar = document.getElementById('loadBar');
  const loadTxt = document.getElementById('loadTxt');
  function progress(text, pct) {
    if (loadTxt) loadTxt.textContent = text;
    if (loadBar) loadBar.style.transform = `scaleX(${pct})`;
    if (desktop && desktop.progress) desktop.progress(text, pct);
  }
  const frame = () => new Promise((r) => setTimeout(r, 30));

  let renderer, scene, camera, sun;

  async function boot() {
    progress('Encendiendo las fogatas…', 0.08);
    await frame();

    const container = document.getElementById('game');
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(renderer.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcdb898, 70, 270);
    camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1400);
    G.scene = scene;
    G.camera = camera;
    G.renderer = renderer;

    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a3b28, 0.62));
    sun = new THREE.DirectionalLight(0xffe0b0, 1.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);

    progress('Moldeando las tierras de Valdoria…', 0.3);
    await frame();
    G.world = buildWorld(scene);
    G.world.zones = ZONES.filter((z) => !z.safe);

    progress('Despertando a los habitantes de Brezal…', 0.62);
    await frame();
    updateCamera(0);
    renderer.compile(scene, camera);

    progress('Afilando espadas…', 0.85);
    await frame();
    renderer.render(scene, camera);

    progress('Todo listo', 1);
    await frame();
    if (loadEl) loadEl.classList.add('done');
    setTimeout(() => loadEl && (loadEl.hidden = true), 700);
    if (desktop && desktop.ready) desktop.ready();

    bindInput();
    loop();
  }

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
    const npcRoots = G.world.npcs.map((n) => n.root);
    const hit = ray.intersectObjects([...mobRoots, ...npcRoots, G.world.terrain], true)[0];
    if (!hit) return;
    const ud = hit.object.userData;
    if (ud.mob) {
      Game.setTarget(ud.mob);
      Game.attackTarget();
    } else if (ud.npc) {
      Game.talkTo(ud.npc);
    } else {
      Game.moveTo(hit.point);
    }
  }

  function bindInput() {
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
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (UI.focusChat()) {
          e.preventDefault();
          G.keys = {};
        }
        return;
      }
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
  }

  // ---------- Pantalla de inicio: elegir clase ----------

  const nameInput = document.getElementById('nameInput');
  const btnStart = document.getElementById('btnStart');
  const btnReset = document.getElementById('btnReset');
  const saveInfo = document.getElementById('saveInfo');
  const classDesc = document.getElementById('classDesc');
  const classBtns = [...document.querySelectorAll('.class-pick button')];
  let cls = 'guerrero';
  let save = null;
  let resetArmed = false;

  function lastClass() {
    try {
      const c = localStorage.getItem('valdoria-last-class');
      return CLASSES[c] ? c : null;
    } catch {
      return null;
    }
  }

  function selectClass(c) {
    cls = c;
    save = loadSave(c);
    resetArmed = false;
    btnReset.textContent = 'Borrar personaje';
    for (const b of classBtns) {
      const on = b.dataset.cls === c;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    }
    const def = CLASSES[c];
    classDesc.textContent = `${def.role}. ${def.desc}`;
    if (save) {
      nameInput.value = save.name;
      btnStart.textContent = 'Continuar aventura';
      btnReset.hidden = false;
      saveInfo.textContent = `${save.name} · ${def.name} de nivel ${save.level}`;
    } else {
      if (!nameInput.dataset.touched) nameInput.value = 'Viajero';
      btnStart.textContent = 'Crear personaje';
      btnReset.hidden = true;
      saveInfo.textContent = '';
    }
  }
  classBtns.forEach((b) => b.addEventListener('click', () => selectClass(b.dataset.cls)));
  nameInput.addEventListener('input', () => (nameInput.dataset.touched = '1'));
  selectClass(lastClass() || CLASS_IDS.find((c) => loadSave(c)) || 'guerrero');

  btnReset.addEventListener('click', () => {
    if (!resetArmed) {
      resetArmed = true;
      btnReset.textContent = 'Pulsa otra vez para borrarlo';
      return;
    }
    try {
      localStorage.removeItem(saveKey(cls));
    } catch {
      /* nada */
    }
    selectClass(cls);
  });

  // ---------- Modo: en línea o un jugador ----------
  const modeBtns = [...document.querySelectorAll('.mode-pick button')];
  const netMsg = document.getElementById('netMsg');
  let mode = 'online';
  try {
    if (localStorage.getItem('valdoria-mode') === 'offline') mode = 'offline';
  } catch {
    /* nada */
  }
  function selectMode(m) {
    mode = m;
    for (const b of modeBtns) {
      const on = b.dataset.mode === m;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    }
    netMsg.className = 'net-msg ok';
    netMsg.textContent = m === 'online' ? 'Juega con otros viajeros en el mismo mundo.' : 'Partida solo en tu equipo, sin conexión.';
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => selectMode(b.dataset.mode)));
  selectMode(mode);

  let starting = false;
  async function start() {
    if (G.started || starting || !G.world) return;
    const name = (nameInput.value || '').trim().slice(0, 16) || 'Viajero';
    const data = save ? { ...save, name } : Game.newCharacter(name, cls);
    try {
      localStorage.setItem('valdoria-last-class', cls);
      localStorage.setItem('valdoria-mode', mode);
    } catch {
      /* nada */
    }

    if (mode === 'online') {
      starting = true;
      btnStart.disabled = true;
      const label = btnStart.textContent;
      btnStart.textContent = 'Conectando…';
      netMsg.className = 'net-msg ok';
      netMsg.textContent = 'Conectando con el servidor de Valdoria…';
      try {
        await Game.startOnline({
          url: V.Config.SERVER_URL,
          name,
          cls,
          save: data,
          onSave: (d) => storeSave(d.cls, d),
          onLost: () => {
            G.keys = {};
            document.getElementById('netLost').hidden = false;
          },
        });
      } catch (err) {
        starting = false;
        btnStart.disabled = false;
        btnStart.textContent = label;
        netMsg.className = 'net-msg';
        netMsg.textContent = `${err.message} Puedes jugar en modo «Un jugador» mientras tanto.`;
        return;
      }
    } else {
      Game.createPlayer(data);
    }

    UI.initUI();
    Game.spawnMobs();
    G.cam.dist = 15;
    G.cam.pitch = 0.6;
    G.started = true;
    document.getElementById('start').hidden = true;
    UI.log(`Bienvenido a Valdoria, ${name}.`, 'sys');
    if (mode === 'online') UI.log('Estás en línea. Pulsa Enter para hablar con los demás jugadores.', 'sys');
    UI.log('Clic en el suelo para moverte, clic en un monstruo para atacar. Pulsa H para ver los controles.', 'sys');
    UI.log('Habla con la Capitana Brisa si no sabes a dónde ir.', 'sys');
    UI.banner('Aldea de Brezal', mode === 'online' ? 'En línea · Zona segura' : 'Zona segura');
    if (mode === 'offline') {
      setInterval(writeSave, 8000);
      addEventListener('beforeunload', writeSave);
      addEventListener('visibilitychange', () => document.hidden && writeSave());
    }
  }
  btnStart.addEventListener('click', start);
  document.getElementById('btnReconnect').addEventListener('click', () => location.reload());
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && start());
  document.getElementById('btnRespawn').addEventListener('click', () => Game.respawnPlayer());

  // ---------- App de escritorio ----------

  if (desktop) {
    desktop.getVersion().then((ver) => {
      document.getElementById('versionTag').textContent = `Versión de escritorio · v${ver}`;
    });
    if (desktop.onBeforeQuit) desktop.onBeforeQuit(writeSave);
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
    if (G.world.crystal) {
      G.world.crystal.rotation.y += dt * 0.8;
      G.world.crystal.position.y = 1.45 + Math.sin(G.time * 1.6) * 0.08;
    }
    if (G.started) UI.updateUI();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  window.__valdoria = G;
  G.debug = { Game, UI };
  boot().catch((err) => {
    console.error(err);
    progress('No se pudo iniciar el juego. ' + err.message, 1);
    if (desktop && desktop.ready) desktop.ready();
  });
})();
