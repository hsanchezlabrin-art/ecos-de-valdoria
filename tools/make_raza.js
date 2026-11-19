// Arma <raza>_m.glb y <raza>_f.glb (y sus armaduras) a partir de las mallas esculpidas en Blender.
//
// Blender (blender/scripts/gnomos_rig.py) deja en blender/salida/<raza>_<m|f>_rig.json + .bin la
// malla en pose T con colores por vértice, los pesos de cada vértice y dónde va cada hueso; los
// scripts de armaduras dejan <raza>_<m|f>_armadura_<nombre>.json + .bin.
// Aquí se reutiliza el esqueleto de 24 huesos que comparten todas las razas (el original de Meshy,
// guardado en tools/esqueleto_meshy.glb): se conservan las rotaciones de reposo de cada hueso, que
// son las que esperan las animaciones de animaciones.glb, y solo se cambia su posición. En el juego
// la raza está en OWN_BONES (actors.js): las animaciones solo giran los huesos.
//
// Uso (con el Node de la app de escritorio):
//   ELECTRON_RUN_AS_NODE=1 "<Ecos de Valdoria.exe>" tools/make_raza.js <raza> [carpeta de salida]
const fs = require('fs');
const path = require('path');
const THREE = require('../juego/vendor/three.min.js');
const G = require('./glb.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, 'esqueleto_meshy.glb');
const DATA = path.join(ROOT, 'blender/salida');

const src = G.read(SRC);
const skin0 = src.json.skins[0];
const ibm0 = G.acc(src, skin0.inverseBindMatrices);
const parentOf = {};
src.json.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parentOf[c] = i)));
const NAME = src.json.nodes.map((n) => n.name);
const SCALE_ARM = new THREE.Matrix4().makeScale(0.01, 0.01, 0.01); // el nodo Armature
const joints = skin0.joints.slice();

function skeleton(pos) {
  // Pose de reposo de cada hueso: rotación y escala del original, posición del personaje
  const bind = {};
  const q0 = new THREE.Quaternion();
  const p0 = new THREE.Vector3();
  const s0 = new THREE.Vector3();
  joints.forEach((j, k) => {
    new THREE.Matrix4().fromArray(ibm0, k * 16).invert().decompose(p0, q0, s0);
    const p = pos[NAME[j]];
    if (!p) throw new Error('falta la posición del hueso ' + NAME[j]);
    bind[j] = new THREE.Matrix4().compose(new THREE.Vector3(...p), q0.clone(), s0.clone());
  });
  const nodes = JSON.parse(JSON.stringify(src.json.nodes));
  for (const j of joints) {
    const pw = parentOf[j] in bind ? bind[parentOf[j]] : SCALE_ARM;
    const t = new THREE.Vector3();
    pw.clone().invert().multiply(bind[j]).decompose(t, new THREE.Quaternion(), new THREE.Vector3());
    nodes[j].translation = t.toArray(); // en cm, como el original
  }
  const ibm = new Float32Array(joints.length * 16);
  joints.forEach((j, k) => bind[j].clone().invert().toArray(ibm, k * 16));
  return { nodes, ibm };
}

// data: nombre base en blender/salida (sin .json/.bin); mesh: nombre de la malla en el glTF;
// material(prim, info): material glTF de cada primitiva. Las primitivas (info.primitivas, en
// orden) comparten los vértices y se reparten los índices: cuerpo/gorro, o tela/brillo.
function writeGlb(file, data, mesh, material) {
  const info = JSON.parse(fs.readFileSync(path.join(DATA, data + '.json'), 'utf8'));
  const raw = fs.readFileSync(path.join(DATA, data + '.bin'));
  const n = info.vertices;
  let off0 = 0;
  const take = (T, count) => {
    const a = new T(raw.buffer.slice(raw.byteOffset + off0, raw.byteOffset + off0 + count * T.BYTES_PER_ELEMENT));
    off0 += count * T.BYTES_PER_ELEMENT;
    return a;
  };
  const pos = take(Float32Array, n * 3);
  const nor = take(Float32Array, n * 3);
  const col = take(Float32Array, n * 3);
  const jntBlender = take(Uint16Array, n * 4);
  const wgt = take(Float32Array, n * 4);
  const idx = take(Uint32Array, info.indices);
  // Índices de hueso: del orden de Blender al orden de la piel del glTF
  const JI = Object.fromEntries(joints.map((j, k) => [NAME[j], k]));
  const jnt = new Uint16Array(n * 4);
  for (let i = 0; i < jnt.length; i++) {
    const name = info.huesos[jntBlender[i]];
    if (JI[name] === undefined) throw new Error('hueso desconocido: ' + name);
    jnt[i] = wgt[i] > 0 ? JI[name] : 0;
  }
  const { nodes, ibm } = skeleton(info.posiciones);

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
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) (mn[c] = Math.min(mn[c], pos[i + c])), (mx[c] = Math.max(mx[c], pos[i + c]));
  const attributes = {
    POSITION: addAcc(pos, 'VEC3', 5126, n, { min: mn, max: mx }),
    NORMAL: addAcc(nor, 'VEC3', 5126, n),
    COLOR_0: addAcc(col, 'VEC3', 5126, n),
    JOINTS_0: addAcc(jnt, 'VEC4', 5123, n),
    WEIGHTS_0: addAcc(wgt, 'VEC4', 5126, n),
  };
  const lista = (info.primitivas || [{ nombre: 'unica', indices: info.indices }]).filter((p) => p.indices > 0);
  const materials = [];
  const prims = [];
  let desde = 0;
  for (const p of lista) {
    const parte = idx.slice(desde, desde + p.indices);
    desde += p.indices;
    materials.push(material(p, info));
    prims.push({ attributes, indices: addAcc(parte, 'SCALAR', 5125, parte.length), material: materials.length - 1, mode: 4 });
  }
  const ibmAcc = addAcc(ibm, 'MAT4', 5126, joints.length);
  const json = {
    asset: { version: '2.0', generator: 'tools/make_raza.js (malla de blender/proyectos)' },
    scene: 0,
    scenes: [{ nodes: src.json.scenes[0].nodes }],
    nodes,
    skins: [{ inverseBindMatrices: ibmAcc, joints, ...(skin0.skeleton !== undefined ? { skeleton: skin0.skeleton } : {}) }],
    meshes: [{ name: mesh, primitives: prims }],
    materials,
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
  return { vertices: n, triangulos: idx.length / 3, kb: Math.round((12 + 16 + js.length + bin.length) / 1024) };
}

// Marcas que lee actors.js (en material.userData):
//   suave: no forzarle caras planas (la malla esculpida trae sus propias normales)
//   gorro: lo que una armadura de cabeza reemplaza (gorro del gnomo, pelo de arriba del elfo)
//   colores: la armadura trae sus propios colores por vértice (no se pinta con el color del grado)
//   brilla: se dibuja sin sombra (runas, gemas, estrellas)
//   cubre_cabeza: esta armadura reemplaza el gorro
const PBR = { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 };
const ARMADURA = (p, info) =>
  info.primitivas
    ? { name: p.nombre, extras: { colores: true, suave: true, ...(p.brilla ? { brilla: true } : {}), ...(info.cubre_cabeza ? { cubre_cabeza: true } : {}) }, pbrMetallicRoughness: PBR }
    : { name: 'armadura', pbrMetallicRoughness: { baseColorFactor: [0.6, 0.6, 0.6, 1], metallicFactor: 0.3, roughnessFactor: 0.6 } };

function run(raza, out) {
  out = out || path.join(ROOT, 'juego/assets/models');
  const CUERPO = (p) => ({ name: p.nombre === 'gorro' ? 'gorro' : raza, extras: { suave: true, ...(p.nombre === 'gorro' ? { gorro: true } : {}) }, pbrMetallicRoughness: PBR });
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.join(out, 'armaduras'), { recursive: true });
  for (const sex of ['m', 'f']) {
    const r = writeGlb(path.join(out, `${raza}_${sex}.glb`), `${raza}_${sex}_rig`, `${raza}_${sex}`, CUERPO);
    console.log(`${raza}_${sex}.glb: ${r.vertices} vértices, ${r.triangulos} triángulos, ${r.kb} KB`);
    // Armaduras hechas sobre este cuerpo: mismo esqueleto y mismas coordenadas, que es lo que
    // espera actors.js para pegarlas al personaje
    for (const f of fs.readdirSync(DATA)) {
      const m = f.match(new RegExp(`^${raza}_${sex}_armadura_(\\w+)\\.json$`));
      if (!m) continue;
      const a = writeGlb(path.join(out, 'armaduras', `${m[1]}_${raza}_${sex}.glb`), f.slice(0, -5), `armadura_${m[1]}`, ARMADURA);
      console.log(`armaduras/${m[1]}_${raza}_${sex}.glb: ${a.vertices} vértices, ${a.triangulos} triángulos, ${a.kb} KB`);
    }
  }
}

module.exports = { run };
if (require.main === module) {
  if (!process.argv[2]) throw new Error('uso: make_raza.js <raza> [carpeta de salida]');
  run(process.argv[2], process.argv[3]);
}
