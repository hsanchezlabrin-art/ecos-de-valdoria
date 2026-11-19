// Generador del modelo 3D de la Hada (gatita con alas), estilo vóxel/low-poly infantil.
// No usa créditos de IA: arma el .glb desde código. Reutiliza el esqueleto de 24 huesos que
// comparten todas las razas (copiado de elfo_f.glb) para que sirvan las animaciones de
// animaciones.glb, lo acomoda a proporciones "chibi" (cabezona, piernas cortas) y le agrega
// huesos propios para las alas (WingL/WingR) y la cola (TailA/TailB).
//
// Uso (con el Node de la app de escritorio):
//   ELECTRON_RUN_AS_NODE=1 "<Ecos de Valdoria.exe>" tools/make_hada.js [carpeta de salida]
// Escribe hada_f.glb y hada_m.glb (por defecto en juego/assets/models).
const fs = require('fs');
const path = require('path');
const THREE = require('../juego/vendor/three.min.js');
const G = require('./glb.js');

const ROOT = path.join(__dirname, '..');
// esqueleto original de Meshy (el de elfo_f.glb antes del elfo hecho en Blender)
const SRC = path.join(__dirname, 'esqueleto_meshy.glb');
const OUT = process.argv[2] || path.join(ROOT, 'juego/assets/models');

// ---------- Esqueleto ----------
const src = G.read(SRC);
const skin0 = src.json.skins[0];
const ibm0 = G.acc(src, skin0.inverseBindMatrices);
const parentOf = {};
src.json.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parentOf[c] = i)));
const NAME = src.json.nodes.map((n) => n.name);
const IDX = Object.fromEntries(NAME.map((n, i) => [n, i]));
const SCALE_ARM = new THREE.Matrix4().makeScale(0.01, 0.01, 0.01); // el nodo Armature

// Altura nueva según la altura de la elfa (tramos: piernas, torso, cuello+cabeza)
const YMAP = [[0, 0], [0.77, 0.36], [1.12, 0.78], [1.21, 0.84], [1.7, 1.38]];
function remapY(y) {
  for (let i = 1; i < YMAP.length; i++) {
    if (y <= YMAP[i][0] || i === YMAP.length - 1) {
      const [a, b] = [YMAP[i - 1], YMAP[i]];
      return b[1] + ((y - b[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    }
  }
}

// Pose de reposo (T) de cada hueso: matriz del mundo (con la escala 0.01 del esqueleto)
const bind = {};
const joints = skin0.joints.slice();
const q0 = new THREE.Quaternion();
const p0 = new THREE.Vector3();
const s0 = new THREE.Vector3();
joints.forEach((j, k) => {
  const m = new THREE.Matrix4().fromArray(ibm0, k * 16).invert();
  m.decompose(p0, q0, s0);
  const n = NAME[j];
  const arm = /Arm|Hand|Shoulder/.test(n);
  const leg = /Leg|Foot|Toe/.test(n);
  const np = new THREE.Vector3(p0.x * (arm ? 0.62 : leg ? 0.95 : 1), remapY(p0.y), 0.1 + (p0.z - 0.1) * 0.8);
  if (n === 'Hips' || n === 'Head' || n === 'neck' || /^Spine/.test(n) || n === 'head_end' || n === 'headfront') np.x = 0;
  bind[j] = new THREE.Matrix4().compose(np, q0.clone(), s0.clone());
});
const P = (n) => new THREE.Vector3().setFromMatrixPosition(bind[IDX[n]]);

// Huesos propios (orientación del mundo en reposo: así el código del juego los mueve con ejes simples)
const Z0 = 0.1; // centro del cuerpo en profundidad (el frente es +z)
const EXTRA = [
  { name: 'WingL', parent: 'Spine', pos: [0.07, 0.69, Z0 - 0.1] },
  { name: 'WingR', parent: 'Spine', pos: [-0.07, 0.69, Z0 - 0.1] },
  { name: 'TailA', parent: 'Hips', pos: [0, 0.4, Z0 - 0.12] },
  { name: 'TailB', parent: 'TailA', pos: [0, 0.43, Z0 - 0.3] },
];
const nodes = JSON.parse(JSON.stringify(src.json.nodes));
for (const e of EXTRA) {
  const idx = nodes.length;
  IDX[e.name] = idx;
  NAME[idx] = e.name;
  nodes.push({ name: e.name });
  parentOf[idx] = IDX[e.parent];
  (nodes[IDX[e.parent]].children = nodes[IDX[e.parent]].children || []).push(idx);
  bind[idx] = new THREE.Matrix4().compose(new THREE.Vector3(...e.pos), new THREE.Quaternion(), new THREE.Vector3(0.01, 0.01, 0.01));
  joints.push(idx);
}
// Posiciones locales (en cm, como el original) a partir de la pose de reposo nueva
for (const j of joints) {
  const par = parentOf[j];
  const pw = par in bind ? bind[par] : SCALE_ARM;
  const l = pw.clone().invert().multiply(bind[j]);
  const t = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  l.decompose(t, q, s);
  nodes[j].translation = t.toArray();
  if (j >= src.json.nodes.length) {
    nodes[j].rotation = q.toArray();
    nodes[j].scale = [1, 1, 1];
  }
}
const ibm = new Float32Array(joints.length * 16);
joints.forEach((j, k) => bind[j].clone().invert().toArray(ibm, k * 16));
const JI = Object.fromEntries(joints.map((j, k) => [NAME[j], k]));

// ---------- Constructor de mallas (cubos y troncos de pirámide con color por cara) ----------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const FACES = [
  { c: [1, 3, 7, 5], k: 0.93 }, // +x
  { c: [0, 4, 6, 2], k: 0.93 }, // -x
  { c: [2, 6, 7, 3], k: 1.08 }, // +y
  { c: [0, 1, 5, 4], k: 0.76 }, // -y
  { c: [4, 5, 7, 6], k: 1.0 }, // +z
  { c: [0, 2, 3, 1], k: 0.88 }, // -z
];
class Mesh {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.jnt = [];
    this.idx = [];
  }
  // Tronco: cx,cz centro; y0..y1; bw,bd = ancho y fondo abajo; tw,td arriba.
  // o: { rot:[rx,ry,rz], pivot:[x,y,z], dx, dz (inclina la cara de arriba), shade: 0..1 }
  solid(cx, cz, y0, y1, bw, bd, tw, td, color, bone, o = {}) {
    const c = [];
    const dx = o.dx || 0;
    const dz = o.dz || 0;
    for (let i = 0; i < 8; i++) {
      const top = (i >> 1) & 1;
      const w = top ? tw : bw;
      const d = top ? td : bd;
      c.push(new THREE.Vector3(cx + (top ? dx : 0) + ((i & 1) - 0.5) * w, top ? y1 : y0, cz + (top ? dz : 0) + (((i >> 2) & 1) - 0.5) * d));
    }
    if (o.rot) {
      const pv = o.pivot ? new THREE.Vector3(...o.pivot) : new THREE.Vector3(cx, (y0 + y1) / 2, cz);
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...o.rot, 'XYZ'));
      for (const v of c) v.sub(pv).applyMatrix4(m).add(pv);
    }
    const cen = new THREE.Vector3();
    c.forEach((v) => cen.add(v));
    cen.multiplyScalar(1 / 8);
    const base = hex(color);
    const ji = JI[bone];
    if (ji === undefined) throw new Error('hueso desconocido: ' + bone);
    for (const f of FACES) {
      let q = f.c.map((i) => c[i]);
      const fc = new THREE.Vector3();
      q.forEach((v) => fc.add(v));
      fc.multiplyScalar(0.25);
      let n = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[3], q[0]));
      if (n.lengthSq() < 1e-12) n = new THREE.Vector3().subVectors(q[2], q[1]).cross(new THREE.Vector3().subVectors(q[0], q[1]));
      if (n.dot(fc.clone().sub(cen)) < 0) {
        q = [q[0], q[3], q[2], q[1]];
        n.negate();
      }
      n.normalize();
      const k = 1 + (f.k - 1) * (o.shade === undefined ? 1 : o.shade);
      const b = this.pos.length / 3;
      for (const v of q) {
        this.pos.push(v.x, v.y, v.z);
        this.nor.push(n.x, n.y, n.z);
        this.col.push(Math.min(1, base[0] * k), Math.min(1, base[1] * k), Math.min(1, base[2] * k));
        this.jnt.push(ji, 0, 0, 0);
      }
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  box(cx, cy, cz, sx, sy, sz, color, bone, o) {
    this.solid(cx, cz, cy - sy / 2, cy + sy / 2, sx, sz, sx, sz, color, bone, o);
  }
}

// ---------- Diseño ----------
function build(v) {
  const body = new Mesh();
  const wings = new Mesh();
  const f = v === 'f';
  const C = f
    ? { skin: 0xe9b585, skinD: 0xd9a070, hair: 0x854d47, hairD: 0x6c3b37, hairL: 0x9c5e55, top: 0xc7b3e8, topD: 0xa994cf, skirt: 0xeab6e6, skirtD: 0xc99ad0, boot: 0xb48ad6, bootD: 0x8f68b8, cuff: 0xd8c4ef, ear: 0xf0a0b0, eye: 0x3b2622, nose: 0xd9808a, tail: 0x854d47, tailTip: 0xe9b585 }
    : { skin: 0xf0c08a, skinD: 0xe0a870, hair: 0xa8703f, hairD: 0x8a5732, hairL: 0xc08550, top: 0xa8d8b8, topD: 0x86bd9a, skirt: 0xe3b6dc, skirtD: 0xb88fc0, boot: 0x7a4a42, bootD: 0x5c3631, cuff: 0x9a6a5c, ear: 0xf0a0b0, eye: 0x3b2622, nose: 0xd9808a, tail: 0xa8703f, tailTip: 0xf0c08a };
  const sleeve = f ? 0xc7b3e8 : 0xc2a8e4;
  const WING = 0xbff5e4;
  const WING2 = 0xd9fff6;
  const Y_FACE = 1.07;

  // Piernas (muslo, espinilla, bota con puntera)
  for (const s of [1, -1]) {
    const side = s > 0 ? 'Left' : 'Right';
    const x = s * 0.078;
    body.box(x, 0.27, Z0, 0.118, 0.19, 0.118, C.skin, `${side}UpLeg`);
    body.box(x, 0.145, Z0, 0.112, 0.115, 0.112, C.skinD, `${side}Leg`, { shade: 0.8 });
    body.box(x, 0.05, Z0 + 0.0, 0.132, 0.1, 0.13, C.boot, `${side}Foot`);
    body.box(x, 0.098, Z0 + 0.0, 0.14, 0.036, 0.138, C.cuff, `${side}Foot`);
    body.box(x, 0.03, Z0 + 0.105, 0.126, 0.06, 0.09, C.bootD, `${side}ToeBase`);
  }

  // Tronco, cintura y falda
  body.box(0, 0.655, Z0, 0.3, 0.29, 0.205, C.top, 'Spine01');
  body.box(0, 0.745, Z0 + 0.0, 0.31, 0.05, 0.21, C.topD, 'Spine', { shade: 0.9 });
  body.box(0, 0.78, Z0 + 0.1, 0.085, 0.05, 0.012, C.skin, 'Spine'); // escote en V
  body.box(0, 0.51, Z0, 0.315, 0.04, 0.215, f ? C.topD : 0x8a5a48, 'Spine02');
  if (f) {
    body.solid(0, Z0, 0.27, 0.495, 0.6, 0.5, 0.31, 0.215, C.skirt, 'Hips', { shade: 1 });
    body.solid(0, Z0, 0.27, 0.318, 0.62, 0.52, 0.595, 0.495, C.skirtD, 'Hips', { shade: 0.9 });
  } else {
    body.solid(0, Z0, 0.3, 0.495, 0.43, 0.36, 0.31, 0.215, C.skirt, 'Hips', { shade: 1 });
    body.solid(0, Z0, 0.3, 0.335, 0.445, 0.375, 0.43, 0.36, C.skirtD, 'Hips', { shade: 0.9 });
  }

  // Brazos (manga, antebrazo, mano): en reposo van en T, las animaciones los bajan
  for (const s of [1, -1]) {
    const side = s > 0 ? 'Left' : 'Right';
    body.box(s * 0.168, 0.78, Z0, 0.16, 0.14, 0.14, sleeve, `${side}Arm`);
    body.box(s * 0.232, 0.78, Z0, 0.06, 0.1, 0.1, C.skin, `${side}Arm`);
    body.box(s * 0.325, 0.78, Z0, 0.13, 0.092, 0.092, C.skin, `${side}ForeArm`);
    body.box(s * 0.405, 0.78, Z0, 0.082, 0.1, 0.1, C.skinD, `${side}Hand`, { shade: 0.85 });
  }

  // Cabeza: cubo de piel con rostro
  body.box(0, Y_FACE, Z0, 0.45, 0.44, 0.43, C.skin, 'Head');
  const fz = Z0 + 0.215 + 0.004;
  for (const s of [1, -1]) {
    body.box(s * 0.1, Y_FACE + 0.0, fz, 0.056, 0.09, 0.012, C.eye, 'Head');
    body.box(s * 0.092, Y_FACE + 0.026, fz + 0.002, 0.016, 0.022, 0.012, 0xfff2e8, 'Head'); // brillito
    body.box(s * 0.155, Y_FACE - 0.075, fz - 0.001, 0.055, 0.032, 0.01, 0xe8997f, 'Head', { shade: 0.6 }); // mejillas
  }
  body.box(0, Y_FACE - 0.05, fz + 0.002, 0.034, 0.024, 0.014, C.nose, 'Head');
  // boquita en "w"
  body.box(-0.025, Y_FACE - 0.1, fz, 0.022, 0.012, 0.01, C.eye, 'Head');
  body.box(0.025, Y_FACE - 0.1, fz, 0.022, 0.012, 0.01, C.eye, 'Head');
  body.box(0, Y_FACE - 0.09, fz, 0.012, 0.025, 0.01, C.eye, 'Head');
  body.box(-0.045, Y_FACE - 0.088, fz, 0.012, 0.022, 0.01, C.eye, 'Head');
  body.box(0.045, Y_FACE - 0.088, fz, 0.012, 0.022, 0.01, C.eye, 'Head');

  // Pelo (capas de bloques) y orejas de gato
  if (f) {
    body.box(0, 1.315, Z0 - 0.005, 0.5, 0.1, 0.47, C.hair, 'Head');
    body.box(0, 1.1, Z0 - 0.205, 0.51, 0.5, 0.09, C.hairD, 'Head');
    body.box(0, 0.9, Z0 - 0.2, 0.53, 0.12, 0.1, C.hairL, 'Head', { shade: 0.8 });
    for (const s of [1, -1]) {
      body.box(s * 0.245, 1.04, Z0 - 0.02, 0.075, 0.46, 0.42, C.hair, 'Head');
      body.box(s * 0.255, 0.88, Z0 - 0.04, 0.075, 0.1, 0.36, C.hairL, 'Head', { shade: 0.8 });
    }
    // flequillo
    body.box(0, 1.265, Z0 + 0.212, 0.47, 0.1, 0.05, C.hair, 'Head');
    body.box(-0.15, 1.19, Z0 + 0.22, 0.14, 0.09, 0.04, C.hair, 'Head');
    body.box(0.0, 1.2, Z0 + 0.222, 0.1, 0.07, 0.04, C.hairL, 'Head');
    body.box(0.15, 1.185, Z0 + 0.22, 0.14, 0.1, 0.04, C.hair, 'Head');
    body.box(0.215, 1.17, Z0 + 0.19, 0.06, 0.2, 0.1, C.hair, 'Head');
    body.box(-0.215, 1.17, Z0 + 0.19, 0.06, 0.2, 0.1, C.hair, 'Head');
  } else {
    // pelo corto y alborotado
    body.box(0, 1.315, Z0 - 0.01, 0.5, 0.1, 0.47, C.hair, 'Head');
    body.box(0, 1.1, Z0 - 0.205, 0.5, 0.46, 0.08, C.hairD, 'Head');
    for (const s of [1, -1]) body.box(s * 0.245, 1.12, Z0 - 0.02, 0.07, 0.34, 0.4, C.hair, 'Head');
    body.box(0, 1.265, Z0 + 0.212, 0.47, 0.1, 0.05, C.hair, 'Head');
    // mechones del flequillo: anchos arriba y en punta hacia abajo, de distinto largo
    for (const [x, h, sh] of [[-0.18, 0.14, -0.2], [-0.085, 0.2, 0.1], [0.02, 0.12, -0.1], [0.11, 0.19, 0.15], [0.19, 0.12, 0.2]]) body.solid(x, Z0 + 0.226, 1.265 - h, 1.265, 0.03, 0.04, 0.095, 0.045, C.hairL, 'Head', { dx: sh * 0.12 });
    for (const [x, z, h, r] of [[-0.12, 0.05, 0.13, -0.3], [0.1, -0.02, 0.15, 0.25], [0.0, -0.12, 0.12, 0.1], [-0.16, -0.1, 0.1, -0.2], [0.17, 0.1, 0.1, 0.3]]) body.solid(x, Z0 + z, 1.36, 1.36 + h, 0.12, 0.12, 0.03, 0.03, C.hairL, 'Head', { rot: [0, 0, r], pivot: [x, 1.36, Z0 + z] });
  }
  for (const s of [1, -1]) {
    body.solid(s * 0.155, Z0 - 0.04, 1.36, 1.51, 0.15, 0.13, 0.035, 0.04, C.hair, 'Head', { rot: [0, 0, -s * 0.2], pivot: [s * 0.155, 1.36, Z0 - 0.04] });
    body.solid(s * 0.15, Z0 + 0.03, 1.365, 1.47, 0.09, 0.02, 0.02, 0.02, C.ear, 'Head', { rot: [0, 0, -s * 0.2], pivot: [s * 0.155, 1.36, Z0 - 0.04], shade: 0.7 });
  }

  // Cola de gato: cuatro tramos que suben en curva (los dos últimos se mueven con TailA/TailB)
  const tails = [
    ['Hips', 0.0, 0.405, Z0 - 0.17, 0.075],
    ['TailA', 0.0, 0.43, Z0 - 0.26, 0.07],
    ['TailA', 0.0, 0.47, Z0 - 0.34, 0.066],
    ['TailB', 0.0, 0.52, Z0 - 0.4, 0.062],
    ['TailB', 0.0, 0.58, Z0 - 0.44, 0.06],
  ];
  tails.forEach(([b, x, y, z, w], i) => body.box(x, y, z, w, w, i < 4 ? 0.1 : 0.075, i === 4 ? C.tailTip : C.tail, b, { shade: 0.95 }));

  // Alas: dos lóbulos por lado, de losas finas que se achican (aspecto vóxel), translúcidas
  for (const s of [1, -1]) {
    const bone = s > 0 ? 'WingL' : 'WingR';
    const pv = [s * 0.07, 0.69, Z0 - 0.1];
    const yaw = -s * 0.5; // abiertas hacia atrás
    const slab = (cx, cy, w, h, color) => wings.box(cx, cy, Z0 - 0.1, w, h, 0.012, color, bone, { rot: [0, yaw, -s * 0.12], pivot: pv, shade: 0.4 });
    slab(s * 0.19, 0.8, 0.22, 0.26, WING);
    slab(s * 0.22, 0.82, 0.14, 0.31, WING2);
    slab(s * 0.15, 0.6, 0.17, 0.16, WING);
    slab(s * 0.17, 0.585, 0.11, 0.2, WING2);
  }
  return { body, wings };
}

// ---------- Salida .glb ----------
function writeGlb(file, { body, wings }) {
  const chunks = [];
  const views = [];
  const accessors = [];
  let off = 0;
  const addView = (arr) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: off, byteLength: buf.length });
    chunks.push(buf, Buffer.alloc(pad));
    off += buf.length + pad;
    return views.length - 1;
  };
  const addAcc = (arr, type, comp, count, extra) => {
    accessors.push({ bufferView: addView(arr), componentType: comp, count, type, ...extra });
    return accessors.length - 1;
  };
  const prim = (m, material) => {
    const n = m.pos.length / 3;
    const pos = new Float32Array(m.pos);
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) (mn[c] = Math.min(mn[c], pos[i + c])), (mx[c] = Math.max(mx[c], pos[i + c]));
    const w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) w[i * 4] = 1;
    return {
      attributes: {
        POSITION: addAcc(pos, 'VEC3', 5126, n, { min: mn, max: mx }),
        NORMAL: addAcc(new Float32Array(m.nor), 'VEC3', 5126, n),
        COLOR_0: addAcc(new Float32Array(m.col), 'VEC3', 5126, n),
        JOINTS_0: addAcc(new Uint16Array(m.jnt), 'VEC4', 5123, n),
        WEIGHTS_0: addAcc(w, 'VEC4', 5126, n),
      },
      indices: addAcc(new Uint32Array(m.idx), 'SCALAR', 5125, m.idx.length),
      material,
      mode: 4,
    };
  };
  const prims = [prim(body, 0), prim(wings, 1)];
  const ibmAcc = addAcc(ibm, 'MAT4', 5126, joints.length);
  const outNodes = JSON.parse(JSON.stringify(nodes));
  const json = {
    asset: { version: '2.0', generator: 'tools/make_hada.js' },
    scene: 0,
    scenes: [{ nodes: src.json.scenes[0].nodes }],
    nodes: outNodes,
    skins: [{ inverseBindMatrices: ibmAcc, joints, ...(skin0.skeleton !== undefined ? { skeleton: skin0.skeleton } : {}) }],
    meshes: [{ name: 'hada', primitives: prims }],
    materials: [
      { name: 'cuerpo', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
      { name: 'alas', alphaMode: 'BLEND', doubleSided: true, emissiveFactor: [0.3, 0.42, 0.38], pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.5], metallicFactor: 0, roughnessFactor: 0.6 } },
    ],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: off }],
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('glTF', 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const h1 = Buffer.alloc(8);
  h1.writeUInt32LE(js.length, 0);
  h1.write('JSON', 4);
  const h2 = Buffer.alloc(8);
  h2.writeUInt32LE(bin.length, 0);
  h2.write('BIN\0', 4);
  fs.writeFileSync(file, Buffer.concat([head, h1, js, h2, bin]));
}

fs.mkdirSync(OUT, { recursive: true });
for (const v of ['f', 'm']) {
  const m = build(v);
  writeGlb(path.join(OUT, `hada_${v}.glb`), m);
  console.log(`hada_${v}.glb: ${m.body.pos.length / 72 + m.wings.pos.length / 72} piezas, ${(m.body.idx.length + m.wings.idx.length) / 3} triángulos`);
}
for (const n of ['Hips', 'Head', 'head_end', 'LeftHand', 'LeftFoot']) console.log(n, P(n).toArray().map((x) => x.toFixed(3)).join(', '));
