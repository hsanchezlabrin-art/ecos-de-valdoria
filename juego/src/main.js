// Arranque por etapas (informa el progreso al splash de la app), pantalla de cuenta,
// selector y creador de personajes, entrada, cámara y bucle principal.
(function () {
  const G = V.G;
  const { ZONES, CLASSES, ARCHETYPE_IDS, ITEMS, RARITY, className, lookFor, startGear } = V.Data;
  const { buildWorld, heightAt } = V.World;
  const Game = V.Game;
  const UI = V.UI;

  const THREE = window.THREE;
  const desktop = window.desktop || null;
  const VERSION = V.VERSION;
  const $ = (id) => document.getElementById(id);

  // Al estrenar las cuentas se borran los personajes guardados en este equipo (v0.3 y anteriores)
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('valdoria-save') || k === 'valdoria-mode' || k === 'valdoria-last-class') localStorage.removeItem(k);
  } catch {
    /* almacenamiento no disponible */
  }
  const SESSION_KEY = 'valdoria-session';
  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k) || sessionStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v, remember) => {
      try {
        (remember ? localStorage : sessionStorage).setItem(k, v);
      } catch {
        /* nada */
      }
    },
    del: (k) => {
      try {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      } catch {
        /* nada */
      }
    },
  };

  // ---------- Pantalla de carga ----------
  const loadEl = $('loading');
  const loadBar = $('loadBar');
  const loadTxt = $('loadTxt');
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

    const container = $('game');
    // Suavizado de bordes del lienzo solo si no hay efectos de cámara: con ellos el dibujo pasa por
    // una imagen intermedia (con su propio suavizado según el perfil) y el del lienzo no se usaría
    renderer = new THREE.WebGLRenderer({ antialias: !V.Gfx.preset().post, powerPreference: 'high-performance' });
    const touch = V.Mobile && V.Mobile.isTouch;
    renderer.setPixelRatio(V.Gfx.pixelRatio());
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = V.Gfx.preset().shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(renderer.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcdb898, 70, 270);
    camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1400);
    G.scene = scene;
    G.camera = camera;
    G.renderer = renderer;

    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x4a3b28, 0.62);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffe0b0, 1.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(V.Gfx.preset().shadowSize, V.Gfx.preset().shadowSize);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    progress('Dando forma a los héroes…', 0.16);
    await V.Actors.preload((k) => progress('Dando forma a los héroes…', 0.16 + k * 0.12));
    progress('Moldeando las tierras de Valdoria…', 0.3);
    await frame();
    G.world = buildWorld(scene);
    G.world.zones = ZONES.filter((z) => z.id !== 'aldea'); // todas las zonas fuera de la aldea (con camino)
    V.Gfx.attach({ renderer, scene, sun, hemi, skyMesh: G.world.sky, water: G.world.water });
    V.Gfx.update(0, new THREE.Vector3(), null);

    progress('Despertando a los habitantes de la aldea…', 0.62);
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
    startScreen();
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
    V.Gfx.update(dt, t, G.player ? G.player.pos : null);
  }

  // ---------- Entrada ----------

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let drag = null;

  function pick(x, y, shift, ctrl) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const mobRoots = G.mobs.filter((m) => !m.dead && !m.hidden && m.model.root.visible).map((m) => m.model.root);
    const npcRoots = G.world.npcs.map((n) => n.root);
    const others = G.otherRoots();
    const hit = ray.intersectObjects([...mobRoots, ...npcRoots, ...others, G.world.terrain], true)[0];
    if (!hit) return;
    const ud = hit.object.userData;
    if (ud.mob) {
      if (shift) return UI.openDrops(ud.mob); // Shift + clic: botín posible
      Game.setTarget(ud.mob);
      Game.attackTarget();
    } else if (ud.npc) {
      Game.selectNpc(ud.npc);
    } else if (ud.player) {
      Game.selectPlayer(ud.player, ctrl || G.ctrl); // Ctrl + clic: ataque forzado
    } else {
      Game.moveTo(hit.point);
    }
  }
  G.otherRoots = () => {
    const out = [];
    G.scene.traverse((o) => {
      if (o.userData.player && o.parent && !o.parent.userData.player) out.push(o);
    });
    return out;
  };

  function bindInput() {
    const canvas = renderer.domElement;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
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
      if (drag && !drag.moved && drag.button === 0 && G.started && !G.pinching) pick(e.clientX, e.clientY, drag.shift || e.shiftKey, drag.ctrl || e.ctrlKey || e.metaKey);
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
        case 'KeyC':
          UI.togglePanel('stats');
          break;
        case 'KeyJ':
          UI.togglePanel('quests');
          break;
        case 'KeyG':
          UI.togglePanel('guild');
          break;
        case 'KeyO':
          V.Settings.toggle();
          break;
        case 'KeyM':
          UI.togglePanel('map');
          break;
        case 'KeyH':
          UI.togglePanel('help');
          break;
        case 'KeyT':
          UI.toggleEmotes();
          break;
        case 'KeyK':
          UI.togglePanel('album');
          break;
        case 'KeyB':
          UI.togglePanel('friend');
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
        case 'Digit5':
        case 'Digit6':
          Game.useSkill(+e.code.slice(-1) - 1);
          break;
        case 'Digit7':
          Game.usePotion('pocion_vida');
          break;
        case 'Digit8':
          Game.usePotion('pocion_mana');
          break;
        case 'Digit9':
          Game.toggleGems();
          break;
        case 'Digit0':
          Game.toggleMount();
          break;
      }
    });
    addEventListener('keyup', (e) => (G.keys[e.code] = false));
    addEventListener('blur', () => {
      G.keys = {};
      G.ctrl = false;
    });
    // Ctrl pulsado = ataque forzado (para atacar a otros jugadores)
    const ctrlTrack = (e) => (G.ctrl = e.ctrlKey || e.metaKey);
    addEventListener('keydown', ctrlTrack, true);
    addEventListener('keyup', ctrlTrack, true);
    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      V.Gfx.resize();
    });
  }

  // ---------- Vista previa 3D del personaje (selector y creador) ----------

  const pv = { renderer: null, scene: null, camera: null, model: null, yaw: 0.5, key: '' };
  function initPreview() {
    const canvas = $('previewCanvas');
    pv.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    pv.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    pv.scene = new THREE.Scene();
    pv.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    pv.camera.position.set(0, 2.2, 7.6);
    pv.camera.lookAt(0, 1.3, 0);
    pv.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a2e22, 0.95));
    const key = new THREE.DirectionalLight(0xffe0b0, 1.5);
    key.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0xd9b56a, 1);
    rim.position.set(-4, 3, -4);
    pv.scene.add(key, rim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.12, 40), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9 }));
    disc.position.y = -0.06;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.025, 6, 64), new THREE.MeshBasicMaterial({ color: 0x8a6d3b }));
    ring.rotation.x = Math.PI / 2;
    pv.scene.add(disc, ring);
    let dragX = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      dragX = e.clientX;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragX === null) return;
      pv.yaw += (e.clientX - dragX) * 0.012;
      dragX = e.clientX;
    });
    canvas.addEventListener('pointerup', () => (dragX = null));
  }

  // Muestra un personaje (clase, sexo y equipo) en la vista previa
  function showPreview(info) {
    const box = $('preview');
    if (!info) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (!pv.renderer) initPreview();
    pv.info = info;
    const key = `${info.cls}|${info.sex}|${info.equip.weapon}|${info.equip.armor}`;
    if (key !== pv.key) {
      pv.key = key;
      if (pv.model) pv.scene.remove(pv.model.root);
      pv.model = V.Actors.buildHero(info.cls, info.sex);
      V.Models.setWeaponLook(pv.model, ITEMS[info.equip.weapon]);
      V.Models.setArmorLook(pv.model, ITEMS[info.equip.armor]);
      pv.scene.add(pv.model.root);
    }
    $('pvName').textContent = info.name || 'Sin nombre';
    $('pvClass').textContent = `${className(info.cls, info.sex, info.stage || 0, info.branch || null)}${info.level ? ` · Nivel ${info.level}` : ''}`;
    const gear = $('pvGear');
    gear.innerHTML = '';
    for (const id of [info.equip.weapon, info.equip.armor]) {
      if (!id) continue;
      const li = document.createElement('li');
      li.textContent = ITEMS[id].name;
      li.style.color = RARITY[ITEMS[id].rarity].color;
      gear.append(li);
    }
  }

  function renderPreview(dt) {
    if (!pv.renderer || $('preview').hidden || !pv.model) return;
    // Llegó el modelo 3D de la vista previa: se redibuja
    if (pv.model.pending3d && pv.info && V.Actors.has(pv.info.cls, pv.info.sex)) {
      pv.key = null;
      showPreview(pv.info);
    }
    const c = pv.renderer.domElement;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w && h && (c.width !== Math.round(w * pv.renderer.getPixelRatio()) || c.height !== Math.round(h * pv.renderer.getPixelRatio()))) {
      pv.renderer.setSize(w, h, false);
      pv.camera.aspect = w / h;
      pv.camera.updateProjectionMatrix();
    }
    pv.yaw += dt * 0.35;
    pv.model.root.rotation.y = pv.yaw;
    const k = G.time % 3.2;
    V.Models.animateModel(pv.model, G.time, 0, k < 0.45 ? 1 - k / 0.45 : 0);
    pv.renderer.render(pv.scene, pv.camera);
  }

  // ---------- Pantalla de inicio: cuenta → personajes → mundo ----------

  const views = { auth: $('viewAuth'), chars: $('viewChars'), create: $('viewCreate') };
  function show(view) {
    for (const [k, el] of Object.entries(views)) el.hidden = k !== view;
    if (view === 'auth') showPreview(null);
  }
  const msg = (id, text, ok = false) => {
    const el = $(id);
    el.className = ok ? 'net-msg ok' : 'net-msg';
    el.textContent = text || '';
  };

  let account = null;
  let chars = [];
  let selected = null;
  let tab = 'login';

  $('versionTag').textContent = `${desktop ? 'Versión de escritorio' : 'Prototipo jugable'} · v${VERSION}`;

  // Novedades (registro de cambios)
  (function renderNews() {
    const box = $('newsBody');
    for (const entry of (V.CHANGELOG || []).slice(0, 2)) {
      const h = document.createElement('h3');
      h.textContent = `v${entry.version} · ${entry.title}`;
      const ul = document.createElement('ul');
      for (const it of entry.items.slice(0, 8)) {
        const li = document.createElement('li');
        li.textContent = it;
        ul.append(li);
      }
      box.append(h, ul);
    }
  })();

  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.reg-only').forEach((el) => (el.hidden = t !== 'register'));
    $('authPass').autocomplete = t === 'register' ? 'new-password' : 'current-password';
    $('btnAuth').textContent = t === 'register' ? 'Crear cuenta y entrar' : 'Entrar';
    msg('authMsg', t === 'register' ? 'Elige un ID (3 a 16 letras o números), tu correo y una contraseña de al menos 6 caracteres.' : '', true);
  }
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  async function ensureConnected() {
    if (Game.connected) return;
    await Game.connect(V.Config.SERVER_URL);
    // Conexión nueva (p. ej. el servidor se reinició): hay que volver a identificarse
    const saved = store.get(SESSION_KEY);
    if (account && saved) {
      const auth = await Game.resume(saved);
      if (auth.chars) chars = auth.chars;
    }
  }

  function gotAuth(auth, remember) {
    account = auth.user;
    if (auth.session) store.set(SESSION_KEY, auth.session, remember);
    chars = auth.chars || [];
    $('acctName').textContent = `Cuenta: ${account}`;
    if (!chars.length) openCreate();
    else openChars();
  }

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = $('authUser').value.trim();
    const pass = $('authPass').value;
    const email = $('authEmail').value.trim();
    const btn = $('btnAuth');
    btn.disabled = true;
    msg('authMsg', 'Conectando con el servidor de Valdoria…', true);
    try {
      await ensureConnected();
      const auth = tab === 'register' ? await Game.register(user, email, pass) : await Game.login(user, pass);
      $('authPass').value = '';
      msg('authMsg', '');
      gotAuth(auth, $('authRemember').checked);
    } catch (err) {
      msg('authMsg', err.message);
    }
    btn.disabled = false;
  });

  function openChars(selectId) {
    show('chars');
    msg('charMsg', '');
    const list = $('charList');
    list.innerHTML = '';
    if (!chars.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Todavía no tienes personajes.';
      list.append(li);
    }
    for (const ch of chars) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = ch.id;
      b.innerHTML = '<span class="cg"></span><span><strong></strong><small></small></span><span class="lv"></span>';
      b.querySelector('.cg').textContent = CLASSES[ch.cls] ? CLASSES[ch.cls].glyph : '?';
      b.querySelector('strong').textContent = ch.name;
      b.querySelector('small').textContent = className(ch.cls, ch.sex, ch.stage, ch.branch);
      b.querySelector('.lv').textContent = `Nv ${ch.level}`;
      b.addEventListener('click', () => selectChar(ch.id));
      b.addEventListener('dblclick', () => enterWorld());
      li.append(b);
      list.append(li);
    }
    $('btnPlay').disabled = !chars.length;
    $('btnDelChar').hidden = !chars.length;
    $('btnNewChar').disabled = chars.length >= 7;
    const want = selectId || (selected && chars.some((c) => c.id === selected) ? selected : chars[0] && chars[0].id);
    if (want) selectChar(want);
    else showPreview(null);
  }

  function selectChar(id) {
    selected = id;
    document.querySelectorAll('#charList button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    const ch = chars.find((c) => c.id === id);
    showPreview(ch && { name: ch.name, cls: ch.cls, sex: ch.sex, level: ch.level, stage: ch.stage, branch: ch.branch, equip: ch.equip || {} });
    delArmed = false;
    $('btnDelChar').textContent = 'Borrar';
  }

  let delArmed = false;
  $('btnDelChar').addEventListener('click', async () => {
    const ch = chars.find((c) => c.id === selected);
    if (!ch) return;
    if (!delArmed) {
      delArmed = true;
      $('btnDelChar').textContent = `¿Borrar a ${ch.name}? Pulsa otra vez`;
      return;
    }
    try {
      chars = (await Game.deleteChar(ch.id)).chars;
      selected = null;
      openChars();
      msg('charMsg', `${ch.name} fue borrado.`, true);
    } catch (err) {
      msg('charMsg', err.message);
    }
  });

  $('btnLogout').addEventListener('click', () => {
    Game.logout();
    store.del(SESSION_KEY);
    account = null;
    chars = [];
    setTab('login');
    show('auth');
  });

  // ---------- Creador de personaje ----------

  const SYL_A = ['Ael', 'Bran', 'Cael', 'Dor', 'Eld', 'Fen', 'Gal', 'Hal', 'Ith', 'Kael', 'Lor', 'Mor', 'Nym', 'Or', 'Ryn', 'Syl', 'Thal', 'Val', 'Wyn', 'Zar', 'Ar', 'Bel', 'Cor', 'Dra', 'Eri', 'Gor', 'Ily', 'Jor', 'Lys', 'Mae', 'Nor', 'Per', 'Ser', 'Tor', 'Ul', 'Vey'];
  const SYL_B = { m: ['dor', 'ion', 'ius', 'mir', 'os', 'gar', 'is', 'an', 'rak', 'thas', 'orn', 'ric', 'mar'], f: ['wyn', 'ara', 'iel', 'ra', 'wen', 'ia', 'elle', 'una', 'ys', 'ira', 'ess', 'ana', 'eth'] };
  const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
  const randomName = (sex) => pickOne(SYL_A) + pickOne(SYL_B[sex] || SYL_B.m);

  // Propone un nombre que no esté ocupado en el servidor
  async function suggestName(sex) {
    const base = V.Config.SERVER_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
    let name = randomName(sex);
    for (let i = 0; i < 6; i++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch(`${base}/name-available?name=${encodeURIComponent(name)}`, { signal: ctrl.signal });
        clearTimeout(t);
        if ((await res.json()).available) return name;
      } catch {
        return name;
      }
      name = randomName(sex);
    }
    return name;
  }

  const nameInput = $('nameInput');
  const creator = { cls: ARCHETYPE_IDS[0], sex: 'm' };
  let nameReq = 0;
  function newRandomName() {
    const req = ++nameReq;
    nameInput.value = randomName(creator.sex);
    delete nameInput.dataset.touched;
    updateCreatePreview();
    suggestName(creator.sex).then((n) => {
      if (req === nameReq && !nameInput.dataset.touched) {
        nameInput.value = n;
        updateCreatePreview();
      }
    });
  }
  function updateCreatePreview() {
    const c = CLASSES[creator.cls];
    document.querySelectorAll('.class-pick button').forEach((b) => {
      const on = b.dataset.cls === creator.cls;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      b.querySelector('span').textContent = CLASSES[b.dataset.cls].short[creator.sex];
    });
    document.querySelectorAll('.sex-pick button').forEach((b) => {
      const on = b.dataset.sex === creator.sex;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    $('classDesc').textContent = `${className(creator.cls, creator.sex)} · ${c.role}. ${c.desc}`;
    showPreview({ name: nameInput.value.trim(), cls: creator.cls, sex: creator.sex, level: 1, equip: startGear(creator.cls) });
  }
  document.querySelectorAll('.class-pick button').forEach((b) =>
    b.addEventListener('click', () => {
      creator.cls = b.dataset.cls;
      updateCreatePreview();
    })
  );
  document.querySelectorAll('.sex-pick button').forEach((b) =>
    b.addEventListener('click', () => {
      const changed = creator.sex !== b.dataset.sex;
      creator.sex = b.dataset.sex;
      if (changed && !nameInput.dataset.touched) newRandomName();
      else updateCreatePreview();
    })
  );
  nameInput.addEventListener('input', () => {
    nameInput.dataset.touched = '1';
    updateCreatePreview();
  });
  $('btnDice').addEventListener('click', newRandomName);

  function openCreate() {
    show('create');
    msg('createMsg', chars.length ? '' : 'Crea tu primer personaje para entrar a Valdoria.', true);
    $('btnBack').hidden = !chars.length;
    newRandomName();
  }
  $('btnNewChar').addEventListener('click', openCreate);
  $('btnBack').addEventListener('click', () => openChars());

  $('btnCreate').addEventListener('click', async () => {
    const btn = $('btnCreate');
    btn.disabled = true;
    msg('createMsg', 'Creando personaje…', true);
    try {
      await ensureConnected();
      const r = await Game.createChar(nameInput.value.trim(), creator.cls, creator.sex);
      chars = r.chars;
      openChars(r.created);
      msg('charMsg', '¡Personaje creado! Pulsa «Entrar al mundo».', true);
    } catch (err) {
      msg('createMsg', err.message);
    }
    btn.disabled = false;
  });

  // ---------- Entrar al mundo ----------

  let entering = false;
  async function enterWorld() {
    if (G.started || entering || !selected) return;
    // Pantalla completa en el mismo toque: después de conectar el navegador ya no lo permite
    if (V.Mobile.isTouch) V.Mobile.enterFullscreen();
    entering = true;
    const btn = $('btnPlay');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      await ensureConnected();
      await Game.play(selected, {
        onLost: (text) => {
          G.keys = {};
          $('reconnecting').hidden = true;
          $('netLostMsg').textContent = text || 'No se pudo recuperar la conexión con el servidor. Tu personaje quedó guardado.';
          $('netLost').hidden = false;
        },
        onReconnect: (state) => {
          $('reconnecting').hidden = state !== 'start';
          if (state === 'ok') UI.log('Conexión recuperada.', 'sys');
        },
      });
    } catch (err) {
      entering = false;
      btn.disabled = false;
      btn.textContent = 'Entrar al mundo';
      msg('charMsg', err.message);
      return;
    }
    showPreview(null);
    UI.initUI();
    V.Mobile.onStart(renderer.domElement);
    G.cam.dist = 15;
    G.cam.pitch = 0.6;
    G.started = true;
    $('start').hidden = true;
    const p = G.player;
    UI.log(`Bienvenido a Valdoria, ${p.name}.`, 'sys');
    UI.log('Pulsa Enter para hablar. Empieza con # para hablar con tu grupo. Pulsa H para ver los controles.', 'sys');
    UI.log('Habla con la Capitana Brisa si no sabes a dónde ir.', 'sys');
    UI.banner('Aldea de los Bloques', 'En línea · Zona segura');
  }
  $('btnPlay').addEventListener('click', enterWorld);
  document.getElementById('btnRespawn').addEventListener('click', () => Game.respawnPlayer());
  document.getElementById('btnReconnect').addEventListener('click', () => location.reload());
  // Salir: confirma, el servidor guarda al personaje y se vuelve al selector (la sesión sigue abierta)
  const exitAsk = $('exitAsk');
  $('btnExit').addEventListener('click', () => (exitAsk.hidden = false));
  $('btnExitNo').addEventListener('click', () => (exitAsk.hidden = true));
  $('btnExitYes').addEventListener('click', async () => {
    $('btnExitYes').disabled = true;
    $('btnExitYes').textContent = 'Guardando…';
    await Game.exitWorld();
    location.reload(); // al abrir de nuevo, la sesión guardada lleva directo al selector
  });
  document.getElementById('btnFull').addEventListener('click', () => V.Mobile.toggleFullscreen());
  // Ajustes: abre el panel de Configuración (gráficos, imagen y sonido)
  document.getElementById('hudVer').textContent = `v${V.VERSION}`;
  addEventListener('valdoria-gfx', (e) => {
    const up = e.detail && e.detail.dir > 0;
    UI.log(
      up
        ? `Tu equipo va holgado: calidad gráfica subida a ${V.Gfx.preset().label}. Puedes cambiarla en Ajustes.`
        : `El juego iba lento: calidad gráfica ajustada a ${V.Gfx.preset().label}. Puedes cambiarla en Ajustes.`,
      'sys'
    );
  });
  document.getElementById('btnGfx').addEventListener('click', () => V.Settings.toggle());

  // Al abrir: si hay una sesión guardada, entra directo al selector de personajes
  async function startScreen() {
    setTab('login');
    const saved = store.get(SESSION_KEY);
    show('auth');
    if (!saved) return;
    msg('authMsg', 'Recuperando tu sesión…', true);
    try {
      await ensureConnected();
      const auth = await Game.resume(saved);
      msg('authMsg', '');
      gotAuth(auth, !!localStorage.getItem(SESSION_KEY));
    } catch (err) {
      store.del(SESSION_KEY);
      msg('authMsg', err.code === 'session' ? 'Tu sesión expiró. Vuelve a entrar.' : err.message);
    }
  }

  // ---------- App de escritorio ----------

  if (desktop) {
    desktop.getVersion().then((ver) => {
      $('versionTag').textContent = `Versión de escritorio · v${ver}`;
    });
  }

  // ---------- Bucle ----------

  // NPC lejanos: igual que los demás personajes, se dejan de dibujar más allá de la distancia de
  // vista del perfil gráfico y solo los cercanos proyectan sombra (se revisa cada 10 cuadros)
  let npcTick = 0;
  function cullNpcs() {
    const Q = V.Gfx.preset();
    const cam = camera.position;
    for (const n of G.world.npcs) {
      const r = n.root;
      const d2 = (r.position.x - cam.x) ** 2 + (r.position.z - cam.z) ** 2;
      const vis = d2 < Q.viewDist * Q.viewDist;
      if (r.visible !== vis) r.visible = vis;
      const cast = vis && Q.shadows && d2 < Q.shadowDist * Q.shadowDist;
      if (r.userData.cast !== cast) {
        r.userData.cast = cast;
        r.traverse((o) => {
          if (!o.isMesh) return;
          if (o.userData.cs0 === undefined) o.userData.cs0 = o.castShadow;
          o.castShadow = cast && o.userData.cs0;
        });
      }
    }
  }

  const clock = new THREE.Clock();
  function loop(now = performance.now()) {
    // Tope de cuadros (pantallas de 90/120 Hz en celulares): este cuadro se salta
    if (!V.Gfx.frameBegin(now)) {
      requestAnimationFrame(loop);
      return;
    }
    const t0 = performance.now();
    const dt = Math.min(clock.getDelta(), 0.05);
    G.time += dt;
    if (G.started) Game.update(dt);
    updateCamera(dt);
    for (const f of G.world.fires) {
      f.light.intensity = f.base * (0.4 + V.Gfx.sky.night * 0.6) * (0.85 + Math.sin(G.time * 13) * 0.08 + Math.random() * 0.07);
      f.flame.scale.y = 0.9 + Math.sin(G.time * 17) * 0.12;
    }
    // Decorado animado: molinos, géiseres, islotes, botones de la Fábrica y portales
    const A = G.world.anim;
    if (A) {
      for (const hub of A.mills) hub.rotation.z += dt * 0.9;
      for (const g of A.geysers) {
        const k = (Math.sin(G.time * 1.3 + g.phase) + 1) / 2;
        g.steam.scale.set(1, 0.2 + k * k * 1.2, 1);
        g.steam.position.y = 0.6 + 3 * (0.2 + k * k * 1.2);
        g.steam.material.opacity = 0.15 + k * 0.3;
      }
      for (const t of A.islets) t.g.position.y = t.y + Math.sin(G.time * 0.6 + t.phase) * 0.6;
      for (const pl of A.plates) {
        const lit = (pl.userData.litUntil || 0) > G.time;
        pl.material.color.setHex(lit ? 0x3ad85a : 0x8a2a1a);
        pl.material.emissive.setHex(lit ? 0x1a8a2a : 0x401008);
      }
    }
    for (const n of G.world.npcs) if (n.model && n.model.root.userData.veil) n.model.root.userData.veil.material.opacity = 0.4 + Math.sin(G.time * 3) * 0.15;
    if (++npcTick % 10 === 0) cullNpcs();
    if (G.world.crystal) {
      G.world.crystal.rotation.y += dt * 0.8;
      G.world.crystal.position.y = 1.45 + Math.sin(G.time * 1.6) * 0.08;
    }
    if (G.started) UI.updateUI();
    else renderPreview(dt);
    const t1 = performance.now();
    V.Gfx.render(scene, camera);
    V.Gfx.frameEnd(t1, t1 - t0, performance.now() - t1);
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
