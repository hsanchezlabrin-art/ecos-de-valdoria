// Personajes con modelos 3D animados (archivos .glb en assets/models).
// Si una combinación de clase y sexo no tiene modelo, o el archivo no carga, se usa la figura
// hecha por código de models.js. Las funciones de animación de V.Models aceptan ambos tipos.
(function () {
  const THREE = window.THREE;
  const M = V.Models;
  const { lookFor } = V.Data;

  // Modelo disponible por clase y sexo
  // Vacío: el Guerrero volvió a su figura original (el modelo guerrero_m.glb queda guardado sin usar)
  const FILES = {};
  const HEIGHT = 2.45; // altura en el mundo (igual que las figuras de código)
  const ATTACK_TIME = 0.75; // segundos que dura el golpe en pantalla

  const assets = {};

  function prepare(gltf) {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // la malla con huesos se mueve fuera de su caja original
      const mt = o.material;
      // El juego trabaja en espacio lineal: la textura se usa tal cual
      if (mt.map) {
        mt.map.encoding = THREE.LinearEncoding;
        mt.map.anisotropy = 4;
      }
      mt.side = THREE.FrontSide;
      mt.roughness = 0.72;
      mt.metalness = 0.12;
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
    return { gltf, scale: HEIGHT / h, clips: Object.fromEntries(gltf.animations.map((c) => [c.name, c])) };
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
        load(FILES[k])
          .then((g) => (assets[k] = prepare(g)))
          .catch((e) => console.warn('No se pudo cargar el modelo', k, e))
          .finally(() => onProgress && onProgress(++done / keys.length))
      )
    );
  }

  // Espada sujeta al hueso de la mano derecha
  function buildSword(hand, scaleToWorld) {
    const g = new THREE.Group();
    const blade = M.mat(0xc9ccd2, { metalness: 0.3, roughness: 0.62, flatShading: false });
    const part = (geo, m, y) => {
      const o = new THREE.Mesh(geo, m);
      o.position.y = y;
      o.castShadow = true;
      g.add(o);
      return o;
    };
    part(new THREE.BoxGeometry(0.035, 0.16, 0.035), M.mat(0x3a2a1c), 0);
    part(new THREE.BoxGeometry(0.2, 0.035, 0.05), M.mat(0x8a6d3b, { metalness: 0.25, roughness: 0.6 }), 0.09);
    part(new THREE.BoxGeometry(0.03, 0.8, 0.075), blade, 0.5);
    part(new THREE.ConeGeometry(0.038, 0.1, 4), blade, 0.95).rotation.y = Math.PI / 4;
    g.scale.setScalar(1 / scaleToWorld);
    hand.add(g);
    return { group: g, bladeMat: blade };
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
    if (actions.attack) {
      actions.attack.setLoop(THREE.LoopOnce, 1);
      actions.attack.clampWhenFinished = true;
    }
    // Escala acumulada del hueso hasta el mundo (la armadura viene en centímetros)
    let hand = null;
    scene.traverse((o) => {
      if (o.isBone && o.name === 'RightHand') hand = o;
    });
    let weapon = null;
    let bladeMat = null;
    if (hand && cls === 'guerrero') {
      scene.updateMatrixWorld(true);
      const s = new THREE.Vector3();
      hand.getWorldScale(s);
      const sw = buildSword(hand, s.x / a.scale);
      weapon = sw.group;
      bladeMat = sw.bladeMat;
      weapon.userData.fit = true;
    }
    return {
      kind: 'hum',
      skinned: true,
      root,
      rig,
      mixer,
      actions,
      hand,
      weapon,
      weaponType: 'sword',
      bladeMat,
      torsoMat: null,
      height: HEIGHT + 0.05,
      lastT: null,
      prevAtk: 0,
      atkLeft: 0,
    };
  }

  // Animación de los modelos con huesos: mezcla quieto/caminar y dispara el golpe
  function animateSkinned(m, t, walk, atk, swim) {
    const dt = m.lastT == null ? 0 : Math.min(0.1, Math.max(0, t - m.lastT));
    m.lastT = t;
    const A = m.actions;
    if (atk > m.prevAtk + 0.2 && A.attack) {
      const d = A.attack.getClip().duration;
      A.attack.reset();
      A.attack.timeScale = d / ATTACK_TIME;
      A.attack.play();
      m.atkLeft = ATTACK_TIME;
    }
    m.prevAtk = atk;
    m.atkLeft = Math.max(0, m.atkLeft - dt);
    const wa = A.attack ? Math.min(1, m.atkLeft / 0.12, (ATTACK_TIME - m.atkLeft) / 0.08 + 0.2) : 0;
    const moving = Math.max(walk, swim > 0.01 ? 1 : 0);
    if (A.idle) A.idle.setEffectiveWeight((1 - moving) * (1 - wa));
    if (A.walk) {
      A.walk.setEffectiveWeight(moving * (1 - wa));
      A.walk.timeScale = swim > 0.01 ? 0.6 : 1.15;
    }
    if (A.attack) A.attack.setEffectiveWeight(wa);
    if (!m.dying) {
      m.rig.rotation.x = swim > 0.01 ? -1.1 * swim : 0;
      m.rig.position.y = swim > 0.01 ? 1.0 * swim : 0;
    }
    m.mixer.update(dt);
  }

  // Se envuelven las funciones de V.Models para que acepten ambos tipos de modelo
  const baseAnimate = M.animateModel;
  M.animateModel = (m, t, walk, atk, swim = 0) => (m.skinned ? animateSkinned(m, t, walk, atk, swim) : baseAnimate(m, t, walk, atk, swim));
  const baseArmor = M.setArmorLook;
  M.setArmorLook = (m, item) => (m.skinned ? null : baseArmor(m, item));

  V.Actors = { preload, buildHero, has: (cls, sex) => !!assets[`${cls}_${sex}`] };
})();
