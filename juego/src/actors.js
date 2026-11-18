// Personajes con modelos 3D animados (archivos .glb en assets/models).
// Si una combinación de raza y sexo no tiene modelo, o el archivo no carga, se usa la figura
// hecha por código de models.js. Las funciones de animación de V.Models aceptan ambos tipos.
//
// Todos los modelos usan el mismo esqueleto (el de Meshy), así que las animaciones viven en un solo
// archivo compartido (animaciones.glb) y sirven para cualquier raza: cada animación se crea una vez.
// Si el archivo de un personaje trae sus propias idle/walk/die, esas tienen prioridad.
//
// Para que encajen con la identidad visual del juego (fantasía voxel y low-poly infantil) los
// modelos se dibujan con caras planas y una paleta de colores reducida y viva.
(function () {
  const THREE = window.THREE;
  const M = V.Models;
  const { lookFor } = V.Data;

  // Modelo disponible por raza y sexo
  const FILES = {
    elfo_m: 'assets/models/elfo_m.glb',
    elfo_f: 'assets/models/elfo_f.glb',
  };
  const LIBRARY = 'assets/models/animaciones.glb';

  // Ataque según el arma. range: [inicio, fin] en segundos del clip que se usa (solo el golpe);
  // time: segundos que dura en pantalla; aim: giro del cuerpo durante el ataque (el arquero dispara
  // de lado: se gira para que la flecha salga hacia el objetivo).
  const ATTACKS = {
    sword: { clip: 'atk_sword', range: [0.15, 1.35], time: 0.75 },
    dagger: { clip: 'atk_dagger', range: [0.15, 1.6], time: 0.85 },
    spear: { clip: 'atk_spear', range: [0.45, 1.3], time: 0.7 },
    staff: { clip: 'atk_staff', range: [0.1, 1.3], time: 0.9 },
    bow: { clip: 'atk_bow', range: [2.0, 4.3], time: 1.0, aim: -1.1 },
  };
  const ATTACK_OF_SHAPE = {
    sword: 'sword', club: 'sword', hammer: 'sword', mace: 'sword', hammer2h: 'sword',
    dual: 'dagger', daggers: 'dagger',
    spear: 'spear',
    bow: 'bow',
    crossbow: 'staff', staff: 'staff', wand: 'staff', launcher: 'staff', bell: 'staff', scepter: 'staff', book: 'staff',
  };
  const CELEBRATE = [0.2, 3.9]; // la parte de saltos y brazos arriba del festejo

  const HEIGHT = 2.45; // altura en el mundo (igual que las figuras de código)
  const POSTERIZE = 9; // niveles por canal de color: tonos planos, sin degradados realistas

  const assets = {};
  let library = null; // { clips: {nombre: clip}, hipLen }

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
        const l = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
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
    to = Math.min(to, clip.duration);
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

  // Sin desplazamiento propio: el juego mueve al personaje; la animación solo lo mueve en el sitio
  // (al morir o saltar sí sube y baja: solo se fija el avance horizontal). scale ajusta la altura de
  // la cadera cuando el clip viene de otro personaje.
  // La cadera queda fija en su posición de reposo (rest): algunos clips empiezan desplazados.
  function fitClip(clip, scale, rest) {
    const out = clip.clone();
    for (const tr of out.tracks) {
      if (!/Hips\.position$/.test(tr.name)) continue;
      const v = (tr.values = Float32Array.from(tr.values));
      for (let i = 0; i < v.length; i += 3) {
        v[i] = rest.x;
        v[i + 1] *= scale;
        v[i + 2] = rest.z;
      }
    }
    return out;
  }

  const hipRest = (scene) => {
    let p = new THREE.Vector3(0, 1, 0);
    scene.traverse((o) => {
      if (o.name === 'Hips') p = o.position.clone(); // en animaciones.glb no hay malla: no son "huesos"
    });
    return p;
  };
  const hipLength = (scene) => hipRest(scene).length();

  function prepare(gltf) {
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
    const clips = {};
    // Animaciones compartidas, con la cadera a la altura de este personaje
    const rest = hipRest(gltf.scene);
    if (library) {
      const k = library.hipLen ? rest.length() / library.hipLen || 1 : 1;
      for (const [name, clip] of Object.entries(library.clips)) clips[name] = fitClip(clip, k, rest);
    }
    // Las propias del personaje (si las trae) tienen prioridad
    for (const clip of gltf.animations) if (['idle', 'walk', 'die'].includes(clip.name)) clips[clip.name] = fitClip(clip, 1, rest);
    for (const def of Object.values(ATTACKS)) if (clips[def.clip]) clips[def.clip] = subclip(clips[def.clip], def.range[0], def.range[1]);
    if (clips.celebrate) clips.celebrate = subclip(clips.celebrate, CELEBRATE[0], CELEBRATE[1]);
    return { gltf, scale: HEIGHT / h, clips };
  }

  async function preload(onProgress) {
    if (!THREE.GLTFLoader) return;
    const loader = new THREE.GLTFLoader();
    const keys = Object.keys(FILES);
    let done = 0;
    const total = keys.length + 1;
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
    // Primero las animaciones compartidas (los modelos las necesitan al prepararse)
    try {
      const lib = await load(LIBRARY);
      library = { clips: Object.fromEntries(lib.animations.map((c) => [c.name, c])), hipLen: hipLength(lib.scene) };
    } catch (e) {
      console.warn('No se pudieron cargar las animaciones compartidas', e);
    }
    if (onProgress) onProgress(++done / total);
    await Promise.all(
      keys.map((k) =>
        load(FILES[k])
          .then((g) => (assets[k] = prepare(g)))
          .catch((e) => console.warn('No se pudo cargar el modelo', k, e))
          .finally(() => onProgress && onProgress(++done / total))
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
  const UPRIGHT = { staff: true, scepter: true }; // armas largas que se sostienen derechas
  const _q = new THREE.Quaternion();
  const _qr = new THREE.Quaternion();

  // Orientación "de brazo de código" calculada solo con el antebrazo (posición ya en _p, codo en _e)
  function forearmFrame(pr, m) {
    if (pr.upright) {
      // Arco, báculo y cetro van siempre derechos y miran hacia donde apunta el brazo (al frente si cuelga)
      const w = Math.min(1, Math.hypot(_e.x, _e.z) * 1.4);
      _z.set(-_e.x * w, 0, (1 - w) - _e.z * w);
      if (_z.lengthSq() < 1e-4) _z.set(0, 0, 1);
      _z.normalize();
      _e.set(0, 1, 0);
    } else if (Math.abs(_e.x) < 0.85) {
      // Como el brazo de código: Z = lado × Y (hacia el frente con el brazo abajo)
      _z.crossVectors(_side, _e).normalize();
    } else _z.set(0, 0, 1).addScaledVector(_e, -_e.z).normalize(); // brazo hacia el lado
    _x.crossVectors(_e, _z);
    return _q.setFromRotationMatrix(_m.makeBasis(_x, _e, _z));
  }

  // Giro de la mano respecto al personaje (sin la rotación del mundo)
  function handQuat(pr, m, out) {
    m.rig.getWorldQuaternion(_qr).invert();
    pr.hand.getWorldQuaternion(out);
    return out.premultiply(_qr);
  }

  // Pie más bajo, en coordenadas del personaje
  function lowestFoot(m) {
    let y = Infinity;
    for (const f of m.feet) {
      f.getWorldPosition(_p);
      y = Math.min(y, m.rig.worldToLocal(_p).y);
    }
    return y;
  }

  // Calibra el agarre en la pose quieta: desde ahí el arma sigue el giro real de la muñeca
  function calibrate(m) {
    m.rig.updateMatrixWorld(true);
    m.footRest = m.feet.length ? lowestFoot(m) : 0;
    for (const pr of m.proxies) {
      pr.hand.getWorldPosition(_p);
      pr.hand.parent.getWorldPosition(_e);
      m.rig.worldToLocal(_p);
      m.rig.worldToLocal(_e);
      _e.sub(_p).normalize();
      pr.upright = false;
      const want = forearmFrame(pr, m).clone();
      pr.grip = handQuat(pr, m, new THREE.Quaternion()).invert().multiply(want);
    }
  }

  function syncArms(m) {
    m.rig.updateMatrixWorld(true);
    if (m.hips) {
      m.hips.getWorldPosition(_p);
      m.curHipY = m.rig.worldToLocal(_p).y; // altura actual de la cadera (para la montura)
    }
    for (const pr of m.proxies) {
      pr.bow = m.weaponShape === 'bow' && pr.arm === m.lArm;
      pr.upright = pr.bow || (UPRIGHT[m.weaponShape] && pr.arm === m.rArm);
      pr.hand.getWorldPosition(_p);
      pr.hand.parent.getWorldPosition(_e);
      m.rig.worldToLocal(_p);
      m.rig.worldToLocal(_e);
      _e.sub(_p).normalize(); // hacia el codo
      if (pr.upright || !pr.grip) pr.holder.quaternion.copy(forearmFrame(pr, m));
      else pr.holder.quaternion.copy(handQuat(pr, m, _q).multiply(pr.grip)); // sigue la muñeca
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
      if (name.startsWith('atk_') || name === 'die' || name === 'celebrate') {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
      }
      actions[name] = act;
    }
    const bones = {};
    scene.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
    });
    // Altura de la cadera de pie (para sentarse en la montura si no hay animación de sentado)
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
      body: scene,
      mixer,
      actions,
      hips: bones.Hips || null,
      hipY,
      curHipY: hipY,
      hand: bones.RightHand || null,
      lArm: left && left.arm,
      rArm: right && right.arm,
      proxies: [left, right].filter(Boolean),
      weapon: null,
      weaponParts: [],
      weaponType: null,
      weaponShape: null,
      bladeMat: null,
      torsoMat: null,
      height: HEIGHT + 0.05,
      lastT: null,
      prevAtk: 0,
      atkLeft: 0,
      atk: null, // ataque en curso (de ATTACKS)
      celebLeft: 0,
      sitting: false,
      dying: false,
      feet: ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map((n) => bones[n]).filter(Boolean),
      footRest: 0,
    };
    // Pose quieta (primer cuadro) para calibrar cómo se sujetan las armas
    mixer.update(0);
    calibrate(m);
    return m;
  }

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  const attackFor = (m) => ATTACKS[ATTACK_OF_SHAPE[m.weaponShape] || 'sword'];

  // Festejo (al subir de nivel): se corta si el personaje se mueve o ataca
  function celebrate(m) {
    if (!m || !m.skinned || !m.actions.celebrate || m.dying) return;
    const A = m.actions.celebrate;
    A.reset();
    A.play();
    m.celebLeft = A.getClip().duration;
  }

  // Animación de los modelos con huesos: mezcla quieto/correr/sentado, dispara el ataque del arma
  // equipada y el festejo
  function animateSkinned(m, t, walk, atk, swim) {
    const dt = m.lastT == null ? 0 : Math.min(0.1, Math.max(0, t - m.lastT));
    m.lastT = t;
    const A = m.actions;
    if (atk > m.prevAtk + 0.2) {
      const def = attackFor(m);
      const act = A[def.clip];
      if (act) {
        if (m.atk && m.atk !== def && A[m.atk.clip]) A[m.atk.clip].setEffectiveWeight(0);
        act.reset();
        act.timeScale = act.getClip().duration / def.time;
        act.play();
        m.atk = def;
        m.atkLeft = def.time;
        m.celebLeft = 0;
      }
    }
    m.prevAtk = atk;
    m.atkLeft = Math.max(0, m.atkLeft - dt);
    const def = m.atk;
    const wa = def ? Math.min(1, m.atkLeft / 0.12, (def.time - m.atkLeft) / 0.08 + 0.2) : 0;
    if (def && m.atkLeft <= 0) m.atk = null;
    const moving = Math.max(walk, swim > 0.01 ? 1 : 0);
    if (moving > 0.3) m.celebLeft = 0;
    m.celebLeft = Math.max(0, m.celebLeft - dt);
    const wc = A.celebrate ? Math.min(1, m.celebLeft / 0.25) * (1 - wa) : 0;
    const sit = m.sitting && A.sit ? 1 : 0;
    const rest = (1 - wa) * (1 - wc);
    if (A.sit) A.sit.setEffectiveWeight(sit * rest);
    if (A.idle) A.idle.setEffectiveWeight((1 - sit) * (1 - moving) * rest);
    if (A.walk) {
      A.walk.setEffectiveWeight((1 - sit) * moving * rest);
      A.walk.timeScale = swim > 0.01 ? 0.6 : 1;
    }
    for (const d of Object.values(ATTACKS)) if (A[d.clip]) A[d.clip].setEffectiveWeight(def === d ? wa : 0);
    if (A.celebrate) A.celebrate.setEffectiveWeight(wc);
    if (A.die) A.die.setEffectiveWeight(0);
    m.body.rotation.y = (def && def.aim ? def.aim : 0) * Math.min(1, wa * 1.2);
    m.rig.rotation.x = swim > 0.01 ? -1.1 * swim : 0;
    m.rig.position.y = swim > 0.01 ? 1.0 * swim : 0;
    m.body.position.y = 0;
    m.mixer.update(dt);
    // Pies en el suelo: las animaciones compartidas vienen de otro cuerpo y pueden dejarlo flotando
    // (no al saltar de alegría, al nadar ni sentado en la montura)
    if (m.feet.length && wc < 0.3 && !sit && swim <= 0.01) {
      m.rig.updateMatrixWorld(true);
      const lift = lowestFoot(m) - m.footRest;
      if (lift > 0.005) m.body.position.y = -Math.min(0.4, lift);
    }
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
      m.celebLeft = 0;
      m.atk = null;
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

  V.Actors = { preload, buildHero, celebrate, has: (cls, sex) => !!assets[`${cls}_${sex}`] };
})();
