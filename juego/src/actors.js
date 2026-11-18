// Personajes con modelos 3D animados (archivos .glb en assets/models).
// Si una combinación de raza y sexo no tiene modelo, o el archivo no carga, se usa la figura
// hecha por código de models.js. Las funciones de animación de V.Models aceptan ambos tipos.
//
// Cada .glb trae un esqueleto y las animaciones idle, walk, attack y die. Para que encajen con la
// identidad visual del juego (fantasía voxel y low-poly infantil) se dibujan con caras planas y una
// paleta de colores reducida y viva.
(function () {
  const THREE = window.THREE;
  const M = V.Models;
  const { lookFor } = V.Data;

  // Modelo disponible por raza y sexo. attack: [inicio, fin] en segundos del clip de ataque que se usa
  // (el disparo con arco completo dura 5 s: solo se toma levantar, tensar y soltar);
  // attackTime: segundos que dura el ataque en pantalla; aimTurn: giro del cuerpo durante el ataque
  // (el arquero dispara de lado: se gira para que la flecha salga hacia el objetivo).
  const FILES = {
    elfo_m: { url: 'assets/models/elfo_m.glb', attack: [2.0, 4.3], attackTime: 1.0, aimTurn: -1.1 },
    elfo_f: { url: 'assets/models/elfo_f.glb', attack: [2.0, 4.3], attackTime: 1.0, aimTurn: -1.1 },
  };
  const HEIGHT = 2.45; // altura en el mundo (igual que las figuras de código)
  const ATTACK_TIME = 0.75; // segundos que dura el golpe en pantalla
  const POSTERIZE = 9; // niveles por canal de color: tonos planos, sin degradados realistas

  const assets = {};

  // Paleta reducida y un poco más viva (estilo low-poly infantil)
  function posterize(tex) {
    const img = tex && tex.image;
    if (!img || !img.width || typeof document === 'undefined') return tex;
    try {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      const p = d.data;
      const step = 255 / (POSTERIZE - 1);
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i];
        const gg = p[i + 1];
        const b = p[i + 2];
        const l = 0.3 * r + 0.59 * gg + 0.11 * b;
        // Un poco más de saturación antes de reducir los tonos
        for (let k = 0; k < 3; k++) {
          const v = l + (p[i + k] - l) * 1.18;
          p[i + k] = Math.round(Math.min(255, Math.max(0, v)) / step) * step;
        }
      }
      g.putImageData(d, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.flipY = tex.flipY;
      t.wrapS = tex.wrapS;
      t.wrapT = tex.wrapT;
      return t;
    } catch (e) {
      console.warn('No se pudo simplificar la textura', e);
      return tex;
    }
  }

  function subclip(clip, from, to) {
    const out = clip.clone();
    for (const tr of out.tracks) {
      const n = tr.getValueSize();
      const times = [];
      const values = [];
      for (let i = 0; i < tr.times.length; i++) {
        const tt = tr.times[i];
        if (tt < from || tt > to) continue;
        times.push(tt - from);
        for (let k = 0; k < n; k++) values.push(tr.values[i * n + k]);
      }
      if (!times.length) continue;
      tr.times = new Float32Array(times);
      tr.values = new Float32Array(values);
    }
    out.duration = to - from;
    return out;
  }

  function prepare(gltf, def) {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // la malla con huesos se mueve fuera de su caja original
      const mt = o.material;
      // El juego trabaja en espacio lineal: la textura se usa tal cual
      if (mt.map) {
        mt.map = posterize(mt.map);
        mt.map.encoding = THREE.LinearEncoding;
        mt.map.anisotropy = 4;
      }
      mt.side = THREE.FrontSide;
      mt.flatShading = true; // caras planas: aspecto low-poly
      mt.roughness = 0.85;
      mt.metalness = 0;
      mt.needsUpdate = true;
    });
    // Altura según la malla en su pose original (la escala del esqueleto engaña a Box3)
    let h = 1.7;
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.geometry.computeBoundingBox();
        h = o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y || h;
      }
    });
    // Sin desplazamiento propio: el juego mueve al personaje; la animación solo lo mueve en el sitio
    // (al morir sí se deja caer: solo se fija el avance horizontal)
    for (const clip of gltf.animations) {
      for (const tr of clip.tracks) {
        if (!/Hips\.position$/.test(tr.name)) continue;
        const v = tr.values;
        const x0 = v[0];
        const z0 = v[2];
        for (let i = 0; i < v.length; i += 3) {
          v[i] = x0;
          v[i + 2] = z0;
        }
      }
    }
    const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
    if (clips.attack && def.attack) clips.attack = subclip(clips.attack, def.attack[0], Math.min(def.attack[1], clips.attack.duration));
    return { gltf, scale: HEIGHT / h, clips, attackTime: def.attackTime || ATTACK_TIME, aimTurn: def.aimTurn || 0 };
  }

  async function preload(onProgress) {
    if (!THREE.GLTFLoader) return;
    const loader = new THREE.GLTFLoader();
    const keys = Object.keys(FILES);
    let done = 0;
    // En la app de escritorio (file://) fetch no puede leer archivos locales: se usa XHR
    const load = (url) =>
      location.protocol !== 'file:'
        ? loader.loadAsync(url)
        : new Promise((ok, fail) => {
            const x = new XMLHttpRequest();
            x.open('GET', url);
            x.responseType = 'arraybuffer';
            x.onload = () => (x.response ? loader.parse(x.response, url.replace(/[^/]*$/, ''), ok, fail) : fail(new Error('vacío')));
            x.onerror = () => fail(new Error('No se pudo leer ' + url));
            x.send();
          });
    await Promise.all(
      keys.map((k) =>
        load(FILES[k].url)
          .then((g) => (assets[k] = prepare(g, FILES[k])))
          .catch((e) => console.warn('No se pudo cargar el modelo', k, e))
          .finally(() => onProgress && onProgress(++done / keys.length))
      )
    );
  }

  // Un "brazo" invisible que sigue a la mano, con las mismas medidas que el brazo de las figuras
  // de código: así las armas de models.js (arco, ballesta, dagas…) se sujetan igual. Cada cuadro se
  // coloca en la mano con el eje Y hacia el codo y el eje Z hacia el frente del personaje (los huesos
  // de la mano vienen girados de forma distinta en cada animación).
  function armProxy(rig, hand) {
    const holder = new THREE.Group();
    rig.add(holder);
    const arm = new THREE.Group();
    arm.position.y = 0.72; // la punta del brazo de código (y = -0.8) queda en la palma
    holder.add(arm);
    return { holder, arm, hand };
  }

  const _p = new THREE.Vector3();
  const _e = new THREE.Vector3();
  const _x = new THREE.Vector3();
  const _z = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _side = new THREE.Vector3(1, 0, 0);
  function syncArms(m) {
    if (!m.proxies.length) return;
    m.rig.updateMatrixWorld(true);
    for (const pr of m.proxies) {
      pr.bow = m.weaponShape === 'bow' && pr.arm === m.lArm;
      pr.hand.getWorldPosition(_p);
      pr.hand.parent.getWorldPosition(_e);
      m.rig.worldToLocal(_p);
      m.rig.worldToLocal(_e);
      _e.sub(_p).normalize(); // hacia el codo
      if (pr.bow) {
        // El arco va siempre derecho y mira hacia donde apunta el brazo (al frente si cuelga)
        const w = Math.min(1, Math.hypot(_e.x, _e.z) * 1.4);
        _z.set(-_e.x * w, 0, (1 - w) - _e.z * w);
        if (_z.lengthSq() < 1e-4) _z.set(0, 0, 1);
        _z.normalize();
        _e.set(0, 1, 0);
      } else if (Math.abs(_e.x) < 0.85) {
        // Como el brazo de código: Z = lado × Y (hacia el frente con el brazo abajo, hacia arriba con
        // el brazo estirado al frente)
        _z.crossVectors(_side, _e).normalize();
      } else _z.set(0, 0, 1).addScaledVector(_e, -_e.z).normalize(); // brazo hacia el lado
      _x.crossVectors(_e, _z);
      pr.holder.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _e, _z));
      pr.holder.position.copy(_p);
      pr.arm.position.z = pr.bow ? -0.14 : 0; // con el arco, la empuñadura queda en la mano
    }
  }

  function buildHero(cls, sex) {
    const a = assets[`${cls}_${sex}`];
    if (!a) return M.buildHumanoid(lookFor(cls, sex));
    const scene = THREE.SkeletonUtils.clone(a.gltf.scene);
    const root = new THREE.Group();
    const rig = new THREE.Group();
    root.add(rig);
    rig.add(scene);
    scene.scale.multiplyScalar(a.scale);
    // Para seleccionar con clic: un cilindro invisible (la malla con huesos no sirve para rayos)
    scene.traverse((o) => {
      if (o.isMesh) o.raycast = () => {};
    });
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, HEIGHT, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = HEIGHT / 2;
    rig.add(hit);
    const mixer = new THREE.AnimationMixer(scene);
    const actions = {};
    for (const [name, clip] of Object.entries(a.clips)) {
      const act = mixer.clipAction(clip);
      act.play();
      act.setEffectiveWeight(name === 'idle' ? 1 : 0);
      actions[name] = act;
    }
    for (const k of ['attack', 'die']) {
      if (!actions[k]) continue;
      actions[k].setLoop(THREE.LoopOnce, 1);
      actions[k].clampWhenFinished = true;
    }
    const bones = {};
    scene.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
    });
    // Altura de la cadera (para sentarse en la montura)
    let hipY = 0.95;
    if (bones.Hips) {
      scene.updateMatrixWorld(true);
      hipY = bones.Hips.getWorldPosition(new THREE.Vector3()).y;
    }
    const left = bones.LeftHand ? armProxy(rig, bones.LeftHand) : null;
    const right = bones.RightHand ? armProxy(rig, bones.RightHand) : null;
    const m = {
      kind: 'hum',
      skinned: true,
      root,
      rig,
      mixer,
      actions,
      hand: bones.RightHand || null,
      lArm: left && left.arm,
      rArm: right && right.arm,
      proxies: [left, right].filter(Boolean),
      weapon: null,
      weaponParts: [],
      weaponType: null,
      bladeMat: null,
      torsoMat: null,
      height: HEIGHT + 0.05,
      lastT: null,
      prevAtk: 0,
      atkLeft: 0,
      attackTime: a.attackTime,
      aimTurn: a.aimTurn,
      body: scene,
      hipY,
      dying: false,
    };
    return m;
  }

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

  // Animación de los modelos con huesos: mezcla quieto/caminar y dispara el golpe
  function animateSkinned(m, t, walk, atk, swim) {
    const dt = m.lastT == null ? 0 : Math.min(0.1, Math.max(0, t - m.lastT));
    m.lastT = t;
    const A = m.actions;
    if (atk > m.prevAtk + 0.2 && A.attack) {
      const d = A.attack.getClip().duration;
      A.attack.reset();
      A.attack.timeScale = d / m.attackTime;
      A.attack.play();
      m.atkLeft = m.attackTime;
    }
    m.prevAtk = atk;
    m.atkLeft = Math.max(0, m.atkLeft - dt);
    const wa = A.attack ? Math.min(1, m.atkLeft / 0.12, (m.attackTime - m.atkLeft) / 0.08 + 0.2) : 0;
    const moving = Math.max(walk, swim > 0.01 ? 1 : 0);
    if (A.idle) A.idle.setEffectiveWeight((1 - moving) * (1 - wa));
    if (A.walk) {
      A.walk.setEffectiveWeight(moving * (1 - wa));
      A.walk.timeScale = swim > 0.01 ? 0.6 : 1;
    }
    if (A.attack) A.attack.setEffectiveWeight(wa);
    if (A.die) A.die.setEffectiveWeight(0);
    m.body.rotation.y = m.aimTurn * Math.min(1, wa * 1.2);
    m.rig.rotation.x = swim > 0.01 ? -1.1 * swim : 0;
    m.rig.position.y = swim > 0.01 ? 1.0 * swim : 0;
    m.mixer.update(dt);
    syncArms(m);
  }

  // Al morir se reproduce la animación de caída (una vez) en lugar de tumbar la figura
  function deathSkinned(m, k) {
    const A = m.actions;
    if (!A.die) {
      m.dying = k > 0;
      m.rig.rotation.x = (-Math.PI / 2) * k;
      m.rig.position.y = 0.1 * m.height * k;
      return;
    }
    const t = now();
    if (k > 0 && !m.dying) {
      m.dying = true;
      m.rig.rotation.x = 0;
      m.rig.position.y = 0;
      m.body.rotation.y = 0;
      for (const [name, act] of Object.entries(A)) act.setEffectiveWeight(name === 'die' ? 1 : 0);
      A.die.reset();
      A.die.play();
      m.dieT = t;
    } else if (k === 0 && m.dying) {
      m.dying = false;
      A.die.setEffectiveWeight(0);
      m.lastT = null;
      return;
    }
    if (m.dying) {
      m.mixer.update(Math.min(0.1, Math.max(0, t - m.dieT)));
      m.dieT = t;
      syncArms(m);
    }
  }

  // Se envuelven las funciones de V.Models para que acepten ambos tipos de modelo
  const baseAnimate = M.animateModel;
  M.animateModel = (m, t, walk, atk, swim = 0) => (m.skinned ? animateSkinned(m, t, walk, atk, swim) : baseAnimate(m, t, walk, atk, swim));
  const baseDeath = M.animateDeath;
  M.animateDeath = (m, k) => (m.skinned ? deathSkinned(m, k) : baseDeath(m, k));
  const baseArmor = M.setArmorLook;
  M.setArmorLook = (m, item) => (m.skinned ? null : baseArmor(m, item));

  V.Actors = { preload, buildHero, has: (cls, sex) => !!assets[`${cls}_${sex}`] };
})();
