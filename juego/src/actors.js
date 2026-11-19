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
    oso_m: 'assets/models/oso_m.glb',
    oso_f: 'assets/models/oso_f.glb',
    gnomo_m: 'assets/models/gnomo_m.glb',
    gnomo_f: 'assets/models/gnomo_f.glb',
    lagarto_m: 'assets/models/lagarto_m.glb',
    lagarto_f: 'assets/models/lagarto_f.glb',
    hada_m: 'assets/models/hada_m.glb',
    hada_f: 'assets/models/hada_f.glb',
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
  function fitClip(clip, scale, rest, ownBones) {
    const out = clip.clone();
    // Esqueleto con proporciones propias (hada): las animaciones solo giran los huesos; el largo de
    // cada hueso lo manda el modelo, así que se descartan sus pistas de posición y escala
    if (ownBones) out.tracks = out.tracks.filter((tr) => /Hips\.position$/.test(tr.name) || !/\.(position|scale)$/.test(tr.name));
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

  // Colas con movimiento: por raza, qué vértices son la cola (en proporción a la altura del modelo):
  // detrás de la cadera más de `back`, y entre `down` por debajo y `up` por encima de ella.
  // Razas cuyo esqueleto tiene proporciones propias (se generan con tools/make_hada.js)
  const OWN_BONES = new Set(['hada']);

  const TAILS = {
    lagarto: { back: 0.16, up: 0.1, down: 0.12 },
  };

  // Le agrega a la malla dos huesos de cola (hijos de la cadera) y le pasa esos vértices: así la cola
  // se mueve sola por código y deja de seguir a la pierna. Se hace una vez por modelo (la geometría y
  // el esqueleto los comparten todas las copias).
  function addTail(scene, cfg) {
    let mesh = null;
    scene.traverse((o) => {
      if (o.isSkinnedMesh) mesh = o;
    });
    if (!mesh) return;
    const sk = mesh.skeleton;
    const hips = sk.bones.find((b) => b.name === 'Hips');
    if (!hips) return;
    scene.updateMatrixWorld(true);
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    geo.computeBoundingBox();
    const H = geo.boundingBox.max.y - geo.boundingBox.min.y;
    const hp = hips.getWorldPosition(new THREE.Vector3());
    const zCut = hp.z - cfg.back * H;
    const idx = [];
    let zMin = Infinity;
    let ySum = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.z < zCut && v.y < hp.y + cfg.up * H && v.y > hp.y - cfg.down * H) {
        idx.push(i);
        zMin = Math.min(zMin, v.z);
        ySum += v.y;
      }
    }
    if (idx.length < 20 || zCut - zMin < 0.05 * H) return;
    const yMid = ySum / idx.length;
    // Hueso A en la raíz de la cola (con los ejes del mundo en reposo) y B a mitad de la cola
    const A = new THREE.Bone();
    A.name = 'TailA';
    hips.add(A);
    A.quaternion.copy(hips.getWorldQuaternion(new THREE.Quaternion())).invert();
    A.position.copy(hips.worldToLocal(new THREE.Vector3(hp.x, yMid, zCut)));
    A.updateMatrixWorld(true);
    const B = new THREE.Bone();
    B.name = 'TailB';
    A.add(B);
    B.position.copy(A.worldToLocal(new THREE.Vector3(hp.x, yMid, (zCut + zMin) / 2)));
    B.updateMatrixWorld(true);
    const ih = sk.bones.indexOf(hips);
    const invA = new THREE.Matrix4().copy(A.matrix).invert().multiply(sk.boneInverses[ih]);
    const invB = new THREE.Matrix4().copy(B.matrix).invert().multiply(invA);
    const bones = [...sk.bones, A, B];
    mesh.bind(new THREE.Skeleton(bones, [...sk.boneInverses, invA, invB]), mesh.bindMatrix);
    const ia = bones.length - 2;
    const ib = bones.length - 1;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    for (const i of idx) {
      v.fromBufferAttribute(pos, i);
      const t = Math.min(1, (zCut - v.z) / (zCut - zMin));
      const wh = Math.max(0, 1 - t / 0.12);
      const wb = Math.min(1, Math.max(0, (t - 0.35) / 0.4));
      const wa = Math.max(0, 1 - wh - wb);
      const sum = wh + wa + wb || 1;
      si.setXYZW(i, ih, ia, ib, 0);
      sw.setXYZW(i, wh / sum, wa / sum, wb / sum, 0);
    }
    si.needsUpdate = true;
    sw.needsUpdate = true;
  }

  // Medidas del cuerpo en reposo (pecho, cintura y cabeza), para ajustar las piezas de armadura.
  // En estos modelos la posición de cada vértice coincide con la de los huesos en la escena.
  function measureBody(scene) {
    let mesh = null;
    const B = {};
    scene.traverse((o) => {
      // Con varias mallas (cuerpo y alas de la hada) se mide la más grande: el cuerpo
      if (o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o;
      if (o.isBone) B[o.name] = o;
    });
    if (!mesh || !B.Hips || !B.Spine || !B.Head || !B.LeftArm) return null;
    scene.updateMatrixWorld(true);
    const P = (n) => B[n].getWorldPosition(new THREE.Vector3());
    const hips = P('Hips');
    const chest = P('Spine'); // en este esqueleto «Spine» es la parte alta (pecho)
    const head = P('Head');
    const pos = mesh.geometry.attributes.position;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const H = bb.max.y - bb.min.y;
    // Ancho de hombros: el hueso de hombro/brazo más alejado del centro (en algunos esqueletos el
    // primero queda casi al centro); si aun así es muy angosto, una proporción de la altura
    let armX = 0;
    for (const n of ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']) if (B[n]) armX = Math.max(armX, Math.abs(P(n).x - hips.x));
    armX = Math.min(Math.max(armX, 0.14 * H), 0.3 * H);
    const band = (y0, y1, maxX) => {
      const r = { half: 0, front: -Infinity, back: Infinity, top: -Infinity };
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (v.y < y0 || v.y > y1 || Math.abs(v.x - hips.x) > maxX) continue;
        r.half = Math.max(r.half, Math.abs(v.x - hips.x));
        r.front = Math.max(r.front, v.z);
        r.back = Math.min(r.back, v.z);
        r.top = Math.max(r.top, v.y);
      }
      return r;
    };
    const chestBand = band(chest.y - 0.1 * H, chest.y + 0.02 * H, armX * 0.9);
    const waist = band(hips.y, hips.y + 0.08 * H, armX * 0.95);
    // Cabeza: el «techo» sólido de la cabeza, sin puntas angostas (gorro de gnomo) ni orejas o
    // cuernos a los lados (para que el casco y la corona se apoyen en la cabeza y no floten)
    const headBand = (() => {
      const y0 = head.y + 0.05 * H;
      const sh = 0.02 * H;
      const sl = [];
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        // Sin los brazos (en pose T pueden quedar a la altura de la cabeza)
        if (v.y < y0 || Math.abs(v.x - hips.x) > armX * 1.3) continue;
        const k = Math.floor((v.y - y0) / sh);
        const r = (sl[k] = sl[k] || { x0: Infinity, x1: -Infinity, front: -Infinity, back: Infinity, center: false });
        r.x0 = Math.min(r.x0, v.x);
        r.x1 = Math.max(r.x1, v.x);
        r.front = Math.max(r.front, v.z);
        r.back = Math.min(r.back, v.z);
        if (Math.abs(v.x - hips.x) < 0.06 * H) r.center = true;
      }
      let maxW = 0;
      for (const r of sl) if (r) maxW = Math.max(maxW, r.x1 - r.x0);
      let top = -1;
      for (let k = sl.length - 1; k >= 0; k--) {
        const r = sl[k];
        if (r && r.center && r.x1 - r.x0 >= 0.6 * maxW) {
          top = k;
          break;
        }
      }
      if (top < 0) return { half: 0, front: -Infinity, back: Infinity, top: -Infinity };
      const out = { half: 0, front: -Infinity, back: Infinity, top: y0 + (top + 1) * sh };
      for (let k = Math.max(0, top - 5); k <= top; k++) {
        const r = sl[k];
        if (!r) continue;
        out.half = Math.max(out.half, (r.x1 - r.x0) / 2);
        out.front = Math.max(out.front, r.front);
        out.back = Math.min(out.back, r.back);
      }
      return out;
    })();
    if (!isFinite(chestBand.front) || !isFinite(waist.front) || !isFinite(headBand.front)) return null;
    return { H, hips, chest, head, chestBand, waist, headBand, top: bb.max.y };
  }

  function prepare(gltf, race) {
    if (TAILS[race]) addTail(gltf.scene, TAILS[race]);
    const body = measureBody(gltf.scene);
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
    let hv = 0;
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh && o.geometry.attributes.position.count > hv) {
        hv = o.geometry.attributes.position.count; // la malla más grande es el cuerpo (las alas son otra)
        o.geometry.computeBoundingBox();
        h = o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y || h;
      }
    });
    const clips = {};
    // Animaciones compartidas, con la cadera a la altura de este personaje
    const rest = hipRest(gltf.scene);
    if (library) {
      const k = library.hipLen ? rest.length() / library.hipLen || 1 : 1;
      for (const [name, clip] of Object.entries(library.clips)) clips[name] = fitClip(clip, k, rest, OWN_BONES.has(race));
    }
    // Las propias del personaje (si las trae) tienen prioridad
    for (const clip of gltf.animations) if (['idle', 'walk', 'die'].includes(clip.name)) clips[clip.name] = fitClip(clip, 1, rest, OWN_BONES.has(race));
    for (const def of Object.values(ATTACKS)) if (clips[def.clip]) clips[def.clip] = subclip(clips[def.clip], def.range[0], def.range[1]);
    if (clips.celebrate) clips.celebrate = subclip(clips.celebrate, CELEBRATE[0], CELEBRATE[1]);
    return { gltf, scale: HEIGHT / h, clips, body };
  }

  let loader = null;
  // En la app de escritorio (file://) fetch no puede leer archivos locales: se usa XHR
  const load = (url) => {
    loader = loader || new THREE.GLTFLoader();
    return location.protocol !== 'file:'
      ? loader.loadAsync(url)
      : new Promise((ok, fail) => {
          const x = new XMLHttpRequest();
          x.open('GET', url);
          x.responseType = 'arraybuffer';
          x.onload = () => (x.response ? loader.parse(x.response, url.replace(/[^/]*$/, ''), ok, fail) : fail(new Error('vacío')));
          x.onerror = () => fail(new Error('No se pudo leer ' + url));
          x.send();
        });
  };

  // Al iniciar solo se cargan las animaciones compartidas (1,4 MB). Cada modelo se descarga recién
  // cuando aparece en pantalla un personaje de esa raza y sexo: mientras tanto se ve su figura de
  // bloques y luego se cambia sola por la 3D.
  let libReady = null;
  function preload(onProgress) {
    if (!THREE.GLTFLoader) return Promise.resolve();
    libReady =
      libReady ||
      load(LIBRARY)
        .then((lib) => {
          library = { clips: Object.fromEntries(lib.animations.map((c) => [c.name, c])), hipLen: hipLength(lib.scene) };
        })
        .catch((e) => console.warn('No se pudieron cargar las animaciones compartidas', e))
        .finally(() => onProgress && onProgress(1));
    return libReady;
  }

  const loading = {};
  // Pide el modelo de una raza y sexo (una sola vez); devuelve una promesa
  function request(cls, sex) {
    const k = `${cls}_${sex}`;
    if (!FILES[k] || !THREE.GLTFLoader) return Promise.resolve(false);
    if (assets[k]) return Promise.resolve(true);
    if (!loading[k]) {
      loading[k] = preload()
        .then(() => load(FILES[k]))
        .then((g) => {
          assets[k] = prepare(g, cls);
          return true;
        })
        .catch((e) => {
          console.warn('No se pudo cargar el modelo', k, e);
          return false;
        });
    }
    return loading[k];
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

  // Anclas de armadura: un grupo por hueso que lo sigue; en la pose quieta sus ejes son los del
  // personaje, así las piezas se colocan con medidas simples (arriba, al frente, a los lados).
  const ANCHORS = { hips: 'Hips', chest: 'Spine', head: 'Head', lArm: 'LeftArm', rArm: 'RightArm', lFore: 'LeftForeArm', rFore: 'RightForeArm' };
  function rigQuat(m, bone, out) {
    m.rig.getWorldQuaternion(_qr).invert();
    bone.getWorldQuaternion(out);
    return out.premultiply(_qr);
  }
  function syncAnchors(m) {
    for (const an of Object.values(m.anchors)) {
      if (!an.group.children.length) continue;
      an.bone.getWorldPosition(_p);
      an.group.position.copy(m.rig.worldToLocal(_p));
      an.group.quaternion.copy(rigQuat(m, an.bone, _q)).multiply(an.calib);
    }
    if (m.cape && m.cape.pin.parent) {
      m.rig.updateMatrixWorld(true);
      m.cape.pin.getWorldPosition(_p);
      m.cape.cape.position.copy(m.rig.worldToLocal(_p));
      m.cape.cape.rotation.set(m.capeLift || 0, 0, 0);
    }
  }

  // Anclas calibradas en la pose original del modelo (la misma en que se midió el cuerpo): así cada
  // pieza queda pegada a su hueso aunque la animación gire la cabeza o el pecho
  function calibrateAnchors(m, handOf) {
    m.rig.updateMatrixWorld(true);
    for (const [key, an] of Object.entries(m.anchors)) {
      an.calib = rigQuat(m, an.bone, new THREE.Quaternion()).invert();
      an.bone.getWorldPosition(_p);
      const at = m.rig.worldToLocal(_p).clone();
      // Antebrazos: hacia dónde queda la mano (para el brazalete)
      const hand = handOf[key];
      if (hand) {
        hand.getWorldPosition(_p);
        an.toHand = m.rig.worldToLocal(_p).clone().sub(at);
      }
    }
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
    if (m.armorParts.length) syncAnchors(m);
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
    if (!a) {
      // Figura de bloques mientras llega el modelo 3D (si existe): quien la use la cambia luego
      const m = M.buildHumanoid(lookFor(cls, sex));
      if (FILES[`${cls}_${sex}`] && THREE.GLTFLoader) {
        m.pending3d = true;
        request(cls, sex);
      }
      return m;
    }
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
    const anchors = {};
    for (const [key, name] of Object.entries(ANCHORS)) {
      if (!bones[name]) continue;
      const group = new THREE.Group();
      rig.add(group);
      anchors[key] = { group, bone: bones[name], calib: new THREE.Quaternion(), toHand: null };
    }
    const tail = bones.TailA && bones.TailB ? [bones.TailA, bones.TailB] : null;
    const left = bones.LeftHand ? armProxy(rig, bones.LeftHand) : null;
    const right = bones.RightHand ? armProxy(rig, bones.RightHand) : null;
    // Tamaño de la raza (el Oso es más grande y el Gnomo más pequeño), igual que las figuras de código
    const size = lookFor(cls, sex).scale || 1;
    rig.scale.setScalar(size);
    const m = {
      kind: 'hum',
      skinned: true,
      root,
      rig,
      scene,
      mixer,
      actions,
      hips: bones.Hips || null,
      bones,
      emote: null, // gesto en curso { id, t0, dur }
      emoteSit: false,
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
      height: (HEIGHT + 0.05) * size,
      lastT: null,
      prevAtk: 0,
      atkLeft: 0,
      atk: null, // ataque en curso (de ATTACKS)
      celebLeft: 0,
      sitting: false,
      dying: false,
      feet: ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map((n) => bones[n]).filter(Boolean),
      anchors,
      armorParts: [],
      armorRainbow: [],
      body: a.body ? scaleBody(a.body, a.scale) : null,
      tail,
      tailRest: tail ? tail.map((b) => b.quaternion.clone()) : null,
      wingBones: bones.WingL && bones.WingR ? [bones.WingL, bones.WingR] : null, // alas de la hada
      wingRest: bones.WingL && bones.WingR ? [bones.WingL.quaternion.clone(), bones.WingR.quaternion.clone()] : null,
      footRest: 0,
    };
    calibrateAnchors(m, { lFore: bones.LeftHand, rFore: bones.RightHand });
    // Pose quieta (primer cuadro) para calibrar cómo se sujetan las armas
    mixer.update(0);
    calibrate(m);
    return m;
  }

  // La cola se balancea: suave al estar quieto y más rápido al correr (la punta va un poco atrasada)
  const _qt = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  function swayTail(m, t, moving) {
    const amp = 0.16 + 0.22 * moving;
    const sp = 2.2 + 6.5 * moving;
    m.tail[0].quaternion.copy(m.tailRest[0]).multiply(_qt.setFromAxisAngle(_up, Math.sin(t * sp) * amp));
    m.tail[1].quaternion.copy(m.tailRest[1]).multiply(_qt.setFromAxisAngle(_up, Math.sin(t * sp - 0.9) * amp * 1.3));
  }

  // Alas de la hada: aleteo suave al estar quieta y más vivo al correr (cada ala gira sobre su eje vertical)
  function flapWings(m, t, moving) {
    const sp = 5 + 9 * moving;
    const amp = 0.18 + 0.2 * moving;
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1;
      m.wingBones[i].quaternion
        .copy(m.wingRest[i])
        .multiply(_qt.setFromAxisAngle(_up, s * (Math.sin(t * sp) * amp + 0.05)))
        .multiply(_qz.setFromAxisAngle(_fwd, -s * Math.sin(t * sp + 0.6) * amp * 0.35));
    }
  }
  const _qz = new THREE.Quaternion();
  const _fwd = new THREE.Vector3(0, 0, 1);

  const scaleBody = (b, k) => {
    const v = (p) => p.clone().multiplyScalar(k);
    const band = (r) => ({ half: r.half * k, front: r.front * k, back: r.back * k, top: r.top * k });
    return { H: b.H * k, hips: v(b.hips), chest: v(b.chest), head: v(b.head), chestBand: band(b.chestBand), waist: band(b.waist), headBand: band(b.headBand), top: b.top * k };
  };

  // ---------- Armadura en los modelos 3D: las mismas piezas por grado que las figuras de bloques ----------
  function setArmorSkinned(m, item) {
    // Las piezas anteriores se quitan y se libera su memoria de video (geometría y material propios)
    for (const g of m.armorParts) {
      if (g.parent) g.parent.remove(g);
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    m.armorParts = [];
    m.armorRainbow = [];
    m.armorGrade = item ? item.grade || null : null;
    const d = m.body;
    const A = m.anchors;
    if (!item || !item.grade || !d || !A.hips || !A.chest || !A.head) return M.syncRainbow(m);
    const { GRADE_IDX, TRIM, GEM } = M.ARMOR_STYLE;
    const gi = GRADE_IDX[item.grade];
    const type = item.armorType;
    const robe = type === 'CLOTH_ROBE' || type === 'SACRED_ROBE';
    const heavy = type === 'HEAVY_PLATE';
    const metal = gi >= 2 && !robe;
    const trim = M.mat(TRIM[item.grade], { metalness: metal ? 0.3 : 0.05, roughness: metal ? 0.5 : 0.8 });
    const H = d.H;
    const add = (anchor, w, h, dep, mt, x, y, z) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), mt);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.raycast = () => {};
      anchor.group.add(o);
      m.armorParts.push(o);
      return o;
    };
    // Posición respecto al hueso del ancla (medidas tomadas en reposo)
    const rel = (anchor, p) => p.clone().sub(anchor);
    const cb = d.chestBand;
    const wb = d.waist;
    const torsoHalf = Math.min(cb.half, wb.half * 1.1); // sin contar los brazos que cuelgan al lado
    const hb = d.headBand;
    // Cobre en adelante: cinturón y brazaletes
    if (gi >= 1) {
      const c = rel(d.hips, new THREE.Vector3(d.hips.x, d.hips.y + 0.04 * H, (wb.front + wb.back) / 2));
      add(A.hips, wb.half * 2 + 0.04 * H, 0.055 * H, wb.front - wb.back + 0.03 * H, trim, c.x, c.y, c.z);
      for (const fore of [A.lFore, A.rFore]) {
        if (!fore || !fore.toHand) continue;
        // Brazalete a mitad del antebrazo, orientado como el antebrazo
        const dir = fore.toHand.clone();
        const len = dir.length();
        const g = new THREE.Group();
        g.position.copy(dir).multiplyScalar(0.5);
        g.quaternion.setFromUnitVectors(_up, dir.normalize());
        fore.group.add(g);
        m.armorParts.push(g);
        const o = new THREE.Mesh(new THREE.BoxGeometry(0.075 * H, Math.min(0.08 * H, len * 0.6), 0.075 * H), trim);
        o.castShadow = true;
        o.raycast = () => {};
        g.add(o);
      }
    }
    // Cristal Azul en adelante: hombreras (o cuello en las túnicas) y gema en el pecho
    if (gi >= 2) {
      if (robe) {
        const c = rel(d.chest, new THREE.Vector3(d.chest.x, cb.top - 0.01 * H, (cb.front + cb.back) / 2));
        add(A.chest, torsoHalf * 2 * 0.95, 0.05 * H, cb.front - cb.back + 0.03 * H, trim, c.x, c.y, c.z);
      } else {
        const sz = ((heavy ? 0.14 : type === 'LIGHT_LEATHER' ? 0.1 : 0.12) + (gi - 2) * 0.015) * H;
        for (const [arm, sx] of [[A.lArm, 1], [A.rArm, -1]]) if (arm) add(arm, sz, sz * 0.5, sz, trim, sx * 0.01 * H, 0.025 * H, 0);
      }
      const gem = M.mat(GEM[item.grade], { emissive: GEM[item.grade], emissiveIntensity: gi >= 4 ? 0.35 : 0.2 });
      const c = rel(d.chest, new THREE.Vector3(d.chest.x, d.chest.y - 0.05 * H, cb.front + 0.008 * H));
      add(A.chest, 0.055 * H, 0.055 * H, 0.02 * H, gem, c.x, c.y, c.z);
      if (item.grade === 'arcoiris') m.armorRainbow.push(gem);
    }
    // Oro Morado en adelante: franja decorada en el pecho
    if (gi >= 3) {
      const c = rel(d.chest, new THREE.Vector3(d.chest.x, d.chest.y - 0.13 * H, cb.front + 0.004 * H));
      add(A.chest, 0.045 * H, 0.2 * H, 0.012 * H, trim, c.x, c.y, c.z);
    }
    // Diamante Dorado en adelante: capa en la espalda. Cuelga derecha desde los hombros (no se
    // inclina con el pecho) y se levanta un poco al correr.
    if (gi >= 4) {
      const capeM = M.mat(item.grade === 'arcoiris' ? 0xffffff : 0xb03a2a, { side: THREE.DoubleSide });
      const hang = 0.36 * H;
      const pin = new THREE.Object3D(); // punto de la espalda donde se sujeta (sigue al pecho)
      pin.position.copy(rel(d.chest, new THREE.Vector3(d.chest.x, d.chest.y + 0.02 * H, cb.back - 0.045 * H)));
      A.chest.group.add(pin);
      m.armorParts.push(pin);
      const cape = new THREE.Group();
      m.rig.add(cape);
      m.armorParts.push(cape);
      const o = new THREE.Mesh(new THREE.BoxGeometry(torsoHalf * 2 * 0.9, hang, 0.015 * H), capeM);
      o.position.y = -hang / 2;
      o.castShadow = true;
      o.raycast = () => {};
      cape.add(o);
      m.cape = { pin, cape };
      if (item.grade === 'arcoiris') m.armorRainbow.push(capeM);
    } else m.cape = null;
    // Arcoíris: casco épico (armaduras pesada y media) o corona (las demás)
    if (gi >= 5) {
      const top = rel(d.head, new THREE.Vector3(d.head.x, hb.top, (hb.front + hb.back) / 2));
      const depth = hb.front - hb.back;
      if (heavy || type === 'MEDIUM_SCALE') {
        add(A.head, hb.half * 2 * 1.06, 0.09 * H, depth * 1.06, trim, top.x, top.y - 0.03 * H, top.z);
        add(A.head, 0.03 * H, 0.1 * H, depth * 0.7, trim, top.x, top.y + 0.04 * H, top.z);
      } else {
        const r = Math.min(hb.half, depth / 2) * 0.95;
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * Math.PI * 2;
          add(A.head, 0.04 * H, 0.07 * H, 0.04 * H, trim, top.x + Math.sin(ang) * r, top.y + 0.025 * H, top.z + Math.cos(ang) * r);
        }
      }
      m.armorRainbow.push(trim);
    } else if (item.grade === 'arcoiris') m.armorRainbow.push(trim);
    M.syncRainbow(m);
    // Coloca las piezas ya en este cuadro
    m.rig.updateMatrixWorld(true);
    syncAnchors(m);
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
    // Un gesto se corta al moverse o atacar
    if (m.emote || m.emoteSit) {
      if (walk > 0.3 || swim > 0.01 || m.atk) {
        m.emote = null;
        m.emoteSit = false;
      }
    }
    m.atkLeft = Math.max(0, m.atkLeft - dt);
    const def = m.atk;
    const wa = def ? Math.min(1, m.atkLeft / 0.12, (def.time - m.atkLeft) / 0.08 + 0.2) : 0;
    if (def && m.atkLeft <= 0) m.atk = null;
    const moving = Math.max(walk, swim > 0.01 ? 1 : 0);
    if (moving > 0.3) m.celebLeft = 0;
    m.celebLeft = Math.max(0, m.celebLeft - dt);
    const wc = A.celebrate ? Math.min(1, m.celebLeft / 0.25) * (1 - wa) : 0;
    const sit = (m.sitting || m.emoteSit) && A.sit ? 1 : 0;
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
    m.scene.rotation.y = (def && def.aim ? def.aim : 0) * Math.min(1, wa * 1.2);
    m.rig.rotation.x = swim > 0.01 ? -1.1 * swim : 0;
    m.rig.position.y = swim > 0.01 ? 1.0 * swim : 0;
    m.scene.position.y = 0;
    m.mixer.update(dt);
    if (m.tail) swayTail(m, t, moving);
    if (m.wingBones) flapWings(m, t, moving);
    // La capa se levanta hacia atrás al correr (con un leve aleteo)
    m.capeLift = 0.08 + 0.5 * moving + Math.sin(t * 9) * 0.06 * moving;
    // Pies en el suelo: las animaciones compartidas vienen de otro cuerpo y pueden dejarlo flotando
    // (no al saltar de alegría, al nadar ni sentado en la montura)
    if (m.feet.length && wc < 0.3 && !sit && swim <= 0.01) {
      m.rig.updateMatrixWorld(true);
      const lift = lowestFoot(m) - m.footRest;
      if (lift > 0.005) m.scene.position.y = -Math.min(0.4, lift);
    }
    if (m.emote) emoteSkinned(m, now());
    syncArms(m);
    // Sentado en el suelo (gesto): la cadera baja hasta el piso
    if (m.emoteSit && !m.sitting) m.rig.position.y = (SIT_HIP - m.curHipY) * m.rig.scale.y;
  }

  // ---------- Gestos (emotes) ----------
  // Los clips compartidos solo traen festejo y sentado: saludar, aplaudir, animar y bailar se hacen
  // apuntando los brazos hacia direcciones del cuerpo (independiente de los ejes de cada hueso,
  // así sirve igual para todas las razas). Direcciones en el espacio del modelo: x = lado, y = arriba,
  // z = adelante; `s` es el lado del brazo (+1 o -1).
  const SIT_HIP = 0.32;
  const _ea = new THREE.Vector3();
  const _eb = new THREE.Vector3();
  const _ec = new THREE.Vector3();
  const _ed = new THREE.Vector3();
  const _eq = new THREE.Quaternion();
  const _ep = new THREE.Quaternion();
  const _ei = new THREE.Quaternion();
  function aimBone(m, bone, child, x, y, z, k) {
    if (!bone || !child || k <= 0) return;
    bone.getWorldPosition(_ea);
    child.getWorldPosition(_eb);
    _ec.subVectors(_eb, _ea).normalize();
    _ed.set(x, y, z).normalize().transformDirection(m.scene.matrixWorld);
    _eq.setFromUnitVectors(_ec, _ed);
    _eq.copy(_ei.identity().slerp(_eq, k));
    bone.parent.getWorldQuaternion(_ep);
    // Rotación en el mundo → en el espacio del padre del hueso
    const local = _ep.clone().invert().multiply(_eq).multiply(_ep);
    bone.quaternion.premultiply(local);
    bone.updateMatrixWorld(true);
  }
  // Lado de cada brazo (signo de x del hombro en el espacio del modelo)
  function armSide(m, bone) {
    bone.getWorldPosition(_ea);
    m.scene.worldToLocal(_ea);
    return _ea.x >= 0 ? 1 : -1;
  }
  function arm(m, side, up, fore, k) {
    const B = m.bones;
    const [a, f, h] = side === 'R' ? [B.RightArm, B.RightForeArm, B.RightHand] : [B.LeftArm, B.LeftForeArm, B.LeftHand];
    if (!a) return;
    const s = armSide(m, a);
    aimBone(m, a, f, up[0] * s, up[1], up[2], k);
    aimBone(m, f, h, fore[0] * s, fore[1], fore[2], k);
  }
  function emoteSkinned(m, t) {
    const e = m.emote;
    const el = t - e.t0;
    if (e.dur && el > e.dur) {
      m.emote = null;
      return;
    }
    const k = e.dur ? Math.max(0, Math.min(1, el / 0.25, (e.dur - el) / 0.3)) : 1;
    m.root.updateMatrixWorld(true);
    if (e.id === 'saludar') {
      const w = Math.sin(el * 11) * 0.4;
      arm(m, 'R', [0.5, 0.85, 0.15], [0.25 + w, 1, 0.2], k);
    } else if (e.id === 'aplaudir') {
      const open = (Math.sin(el * 14) + 1) / 2;
      for (const sd of ['R', 'L']) arm(m, sd, [0.3, -0.55, 0.8], [-(0.2 + open * 0.6), 0.05, 0.9], k);
    } else if (e.id === 'animar') {
      arm(m, 'R', [0.25, 1, 0.1], [0.1, 1, 0.1], k * Math.max(0.15, Math.sin(el * 7)));
      arm(m, 'L', [0.25, 1, 0.1], [0.1, 1, 0.1], k * Math.max(0.15, -Math.sin(el * 7)));
      m.scene.position.y += Math.max(0, Math.sin(el * 14)) * 0.05 * k;
    } else if (e.id === 'bailar') {
      const sw = Math.sin(el * 5);
      arm(m, 'R', [0.55, 0.75, 0.25], [0.2 + sw * 0.6, 0.9, 0.2], k);
      arm(m, 'L', [0.55, 0.75, 0.25], [0.2 - sw * 0.6, 0.9, 0.2], k);
      m.scene.rotation.y += sw * 0.45 * k;
      m.scene.position.y += Math.abs(Math.sin(el * 10)) * 0.07 * k;
    }
  }

  const WAVE_OUT = 0.7; // brazo derecho de la figura de bloques hacia afuera
  // Figuras de bloques (razas sin modelo 3D): brazos y cuerpo, más simple
  function emoteBlock(m, t) {
    const e = m.emote;
    const el = t - e.t0;
    if (e.dur && el > e.dur) {
      m.emote = null;
      return;
    }
    if (!m.lArm || !m.rArm) return;
    if (e.id === 'saludar') {
      m.rArm.rotation.x = -2.4;
      m.rArm.rotation.z = WAVE_OUT + Math.sin(el * 11) * 0.3;
    } else if (e.id === 'aplaudir') {
      const open = (Math.sin(el * 14) + 1) / 2;
      m.lArm.rotation.x = m.rArm.rotation.x = -1.35;
      m.lArm.rotation.y = -0.6 + open * 0.5;
      m.rArm.rotation.y = 0.6 - open * 0.5;
    } else if (e.id === 'animar') {
      m.rArm.rotation.x = -2.9 * Math.max(0.15, Math.sin(el * 7));
      m.lArm.rotation.x = -2.9 * Math.max(0.15, -Math.sin(el * 7));
    } else if (e.id === 'bailar') {
      const sw = Math.sin(el * 5);
      m.lArm.rotation.x = -2.5 + sw * 0.5;
      m.rArm.rotation.x = -2.5 - sw * 0.5;
      m.rig.rotation.y = sw * 0.45;
      m.rig.position.y += Math.abs(Math.sin(el * 10)) * 0.08;
    } else if (e.id === 'celebrar') {
      m.lArm.rotation.x = m.rArm.rotation.x = -2.9;
      m.rig.position.y += Math.abs(Math.sin(el * 7)) * 0.35;
    } else if (e.id === 'sentarse') {
      m.rig.position.y -= 0.55 * (m.rig.scale.y || 1);
      if (m.lLeg) m.lLeg.rotation.x = m.rLeg.rotation.x = -1.45;
    }
  }

  function emote(m, id) {
    if (!m || m.dying) return;
    const def = (V.Data.EMOTES || []).find((x) => x.id === id);
    if (!def) return;
    if (m.skinned) {
      if (id === 'celebrar') return celebrate(m);
      if (id === 'sentarse') {
        m.emote = null;
        m.emoteSit = true;
        return;
      }
    }
    m.emote = { id, t0: now(), dur: def.dur };
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
      m.scene.rotation.y = 0;
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
  M.animateModel = (m, t, walk, atk, swim = 0) => {
    if (m.skinned) return animateSkinned(m, t, walk, atk, swim);
    if (m.emote && (walk > 0.3 || atk > 0 || swim > 0.01)) m.emote = null;
    if (!m.emote && m.rig && m.rig.rotation.y && m.kind === 'hum') m.rig.rotation.y = 0;
    if (!m.emote && m.lArm && m.lArm.rotation.y) m.lArm.rotation.y = m.rArm.rotation.y = 0;
    if (!m.emote && m.rArm && m.rArm.rotation.z) m.rArm.rotation.z = 0;
    baseAnimate(m, t, walk, atk, swim);
    if (m.emote) emoteBlock(m, now());
  };
  const baseDeath = M.animateDeath;
  M.animateDeath = (m, k) => (m.skinned ? deathSkinned(m, k) : baseDeath(m, k));
  const baseArmor = M.setArmorLook;
  M.setArmorLook = (m, item) => (m.skinned ? setArmorSkinned(m, item) : baseArmor(m, item));

  V.Actors = { preload, request, buildHero, celebrate, emote, has: (cls, sex) => !!assets[`${cls}_${sex}`] };
})();
