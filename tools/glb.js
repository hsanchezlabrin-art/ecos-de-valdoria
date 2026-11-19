// Lectura mínima de archivos .glb (para las herramientas de creación de modelos)
const fs = require('fs');
exports.read = (f) => {
  const b = fs.readFileSync(f);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jl).toString());
  const bin = b.slice(20 + jl + 8);
  return { json, bin };
};
const CT = { 5126: [Float32Array, 4], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5121: [Uint8Array, 1] };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
exports.acc = (g, i) => {
  const a = g.json.accessors[i];
  const bv = g.json.bufferViews[a.bufferView];
  const [T, sz] = CT[a.componentType];
  const n = NC[a.type];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new T(a.count * n);
  const stride = bv.byteStride || n * sz;
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset);
  for (let k = 0; k < a.count; k++)
    for (let c = 0; c < n; c++) {
      const p = off + k * stride + c * sz;
      out[k * n + c] = T === Float32Array ? dv.getFloat32(p, true) : T === Uint16Array ? dv.getUint16(p, true) : T === Uint32Array ? dv.getUint32(p, true) : dv.getUint8(p);
    }
  return out;
};
