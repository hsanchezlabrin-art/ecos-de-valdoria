// Gráficos: niveles de calidad, efectos de cámara (brillo y color), ciclo de día y noche,
// texturas del terreno generadas por código, pasto con viento y agua con olas.
// Solo lo usa el cliente; no cambia nada de la simulación.
(function () {
  const THREE = window.THREE;
  const { WORLD, WATER_Y, FIELD_ZONES, ss, rng, pathDist, heightAt, layout } = V.Terrain;
  const G = V.G;

  // ---------- Calidad ----------

  const PRESETS = {
    baja: { label: 'Baja', pixel: 1, shadows: false, shadowSize: 1024, post: false, grass: 0, grassR: 0, msaa: 0, aniso: 2 },
    media: { label: 'Media', pixel: 1, shadows: true, shadowSize: 1024, post: true, grass: 4500, grassR: 22, msaa: 0, aniso: 4 },
    alta: { label: 'Alta', pixel: 1.5, shadows: true, shadowSize: 2048, post: true, grass: 11000, grassR: 30, msaa: 2, aniso: 8 },
  };
  const ORDER = ['baja', 'media', 'alta'];
  const KEY = 'valdoria-graficos';
  const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  function savedQuality() {
    try {
      const q = localStorage.getItem(KEY);
      if (PRESETS[q]) return q;
    } catch {
      /* sin almacenamiento */
    }
    return isTouch ? 'media' : 'alta';
  }
  let quality = savedQuality();
  const preset = () => PRESETS[quality];

  // Brillo extra de luces y hechizos: solo con efectos de cámara (sin ellos se vería quemado)
  const glowK = (k) => (preset().post && post && post.hdr ? k : 1);
  const hot = (hex, k) => new THREE.Color(hex).multiplyScalar(glowK(k));

  // ---------- Ruido para texturas ----------

  function hash2(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // Ruido de valor que se repite sin costuras cada `cells` celdas
  function tileNoise(size, cells, seed) {
    const out = new Float32Array(size * size);
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = hash2(i % cells, (i / cells) | 0, seed);
    const k = cells / size;
    for (let y = 0; y < size; y++) {
      const fy = y * k;
      const y0 = fy | 0;
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = y0 * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = x * k;
        const x0 = fx | 0;
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % cells;
        const a = lat[r0 + x0] + (lat[r0 + x1] - lat[r0 + x0]) * sx;
        const b = lat[r1 + x0] + (lat[r1 + x1] - lat[r1 + x0]) * sx;
        out[y * size + x] = a + (b - a) * sy;
      }
    }
    return out;
  }
  function fbm(size, base, octaves, seed, ridged = false) {
    const out = new Float32Array(size * size);
    let amp = 0.5;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      const n = tileNoise(size, base << o, seed + o * 31);
      for (let i = 0; i < out.length; i++) out[i] += (ridged ? 1 - Math.abs(n[i] * 2 - 1) : n[i]) * amp;
      total += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }

  // Dibuja en un canvas repitiendo en los bordes (para que la textura no tenga costuras)
  function wrapDraw(c, size, x, y, fn) {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      if (x + ox < -40 || x + ox > size + 40 || y + oy < -40 || y + oy > size + 40) continue;
      c.save();
      c.translate(x + ox, y + oy);
      fn(c);
      c.restore();
    }
  }

  // Las texturas son de "detalle": su valor medio es ~0,5 y el color base lo pone el terreno
  function makeTexture(kind, size = 512) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    const img = c.createImageData(size, size);
    const d = img.data;
    const r = rng(kind.length * 97 + 5);
    if (kind === 'grass') {
      const big = fbm(size, 4, 4, 11);
      const fine = fbm(size, 64, 2, 12);
      for (let i = 0; i < size * size; i++) {
        const v = 0.36 + big[i] * 0.22 + fine[i] * 0.16;
        d[i * 4] = v * 255 * 0.98;
        d[i * 4 + 1] = v * 255 * 1.04;
        d[i * 4 + 2] = v * 255 * 0.9;
        d[i * 4 + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      // Briznas y matas
      for (let i = 0; i < 9000; i++) {
        const x = r() * size;
        const y = r() * size;
        const l = 3 + r() * 7;
        const a = -Math.PI / 2 + (r() - 0.5) * 1.6;
        const v = 70 + r() * 90;
        const tone = r();
        c.strokeStyle = `rgba(${v * (0.85 + tone * 0.25)},${v * 1.08},${v * (0.7 + tone * 0.15)},${0.35 + r() * 0.4})`;
        c.lineWidth = 0.8 + r() * 1.1;
        wrapDraw(c, size, x, y, (q) => {
          q.beginPath();
          q.moveTo(0, 0);
          q.lineTo(Math.cos(a) * l, Math.sin(a) * l);
          q.stroke();
        });
      }
      // Florecitas sueltas
      for (let i = 0; i < 70; i++) {
        const x = r() * size;
        const y = r() * size;
        c.fillStyle = r() < 0.5 ? 'rgba(235,225,150,.75)' : 'rgba(220,200,235,.7)';
        wrapDraw(c, size, x, y, (q) => q.fillRect(0, 0, 2, 2));
      }
    } else if (kind === 'dirt') {
      const big = fbm(size, 6, 4, 21);
      const fine = fbm(size, 96, 2, 22);
      for (let i = 0; i < size * size; i++) {
        const v = 0.34 + big[i] * 0.24 + fine[i] * 0.18;
        d[i * 4] = v * 255 * 1.05;
        d[i * 4 + 1] = v * 255;
        d[i * 4 + 2] = v * 255 * 0.9;
        d[i * 4 + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      // Piedritas con luz arriba y sombra abajo
      for (let i = 0; i < 1300; i++) {
        const x = r() * size;
        const y = r() * size;
        const rad = 1 + r() * r() * 5;
        const v = 110 + r() * 80;
        wrapDraw(c, size, x, y, (q) => {
          q.fillStyle = 'rgba(30,22,14,.45)';
          q.beginPath();
          q.ellipse(0.8, 1.2, rad, rad * 0.75, 0, 0, Math.PI * 2);
          q.fill();
          q.fillStyle = `rgb(${v},${v * 0.94},${v * 0.86})`;
          q.beginPath();
          q.ellipse(0, 0, rad, rad * 0.75, 0, 0, Math.PI * 2);
          q.fill();
        });
      }
    } else {
      // Roca: vetas y grietas
      const ridge = fbm(size, 4, 5, 31, true);
      const fine = fbm(size, 48, 3, 32);
      for (let i = 0; i < size * size; i++) {
        const v = 0.22 + Math.pow(ridge[i], 2.2) * 0.46 + fine[i] * 0.2;
        d[i * 4] = v * 255;
        d[i * 4 + 1] = v * 255 * 0.98;
        d[i * 4 + 2] = v * 255 * 0.95;
        d[i * 4 + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      c.strokeStyle = 'rgba(25,22,20,.55)';
      for (let i = 0; i < 60; i++) {
        let x = r() * size;
        let y = r() * size;
        c.lineWidth = 0.6 + r() * 1.4;
        let a = r() * Math.PI * 2;
        const pts = [[x, y]];
        for (let s = 0; s < 8; s++) {
          a += (r() - 0.5) * 1.2;
          x += Math.cos(a) * 9;
          y += Math.sin(a) * 9;
          pts.push([x, y]);
        }
        wrapDraw(c, size, 0, 0, (q) => {
          q.beginPath();
          pts.forEach(([px, py], j) => (j ? q.lineTo(px, py) : q.moveTo(px, py)));
          q.stroke();
        });
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 1;
    return t;
  }

  // ---------- Mapa de alturas y del suelo (para el pasto y el agua) ----------
  // Un texel por vértice del terreno: así el pasto y la orilla coinciden con el suelo dibujado.

  const SEG = 200;
  const TEX = SEG + 1;
  const H_MIN = -20;
  const H_RANGE = 70;
  let groundMaps = null;

  function buildGroundMaps(colors, grassDensity) {
    const hData = new Uint8Array(TEX * TEX * 4);
    const cData = new Uint8Array(TEX * TEX * 4);
    for (let j = 0; j < TEX; j++) {
      for (let i = 0; i < TEX; i++) {
        // Plano rotado: fila j va de z = -WORLD/2 a +WORLD/2
        const x = -WORLD / 2 + (i / SEG) * WORLD;
        const z = -WORLD / 2 + (j / SEG) * WORLD;
        const h = heightAt(x, z);
        const v = Math.round(Math.min(1, Math.max(0, (h - H_MIN) / H_RANGE)) * 65535);
        const k = (j * TEX + i) * 4;
        hData[k] = v >> 8;
        hData[k + 1] = v & 255;
        hData[k + 2] = Math.round(grassDensity(x, z, h) * 255);
        hData[k + 3] = 255;
        const ci = (j * TEX + i) * 3;
        cData[k] = Math.min(255, colors[ci] * 255);
        cData[k + 1] = Math.min(255, colors[ci + 1] * 255);
        cData[k + 2] = Math.min(255, colors[ci + 2] * 255);
        cData[k + 3] = 255;
      }
    }
    const height = new THREE.DataTexture(hData, TEX, TEX, THREE.RGBAFormat);
    height.magFilter = height.minFilter = THREE.NearestFilter;
    height.needsUpdate = true;
    const color = new THREE.DataTexture(cData, TEX, TEX, THREE.RGBAFormat);
    color.magFilter = color.minFilter = THREE.LinearFilter;
    color.needsUpdate = true;
    groundMaps = { height, color };
    return groundMaps;
  }

  // GLSL: altura del terreno con interpolación manual (la altura viene en 16 bits)
  const GROUND_GLSL = `
    uniform sampler2D uHeight;
    const float G_TEX = ${TEX}.0;
    const float G_SEG = ${SEG}.0;
    float gDecode(vec2 t){ vec4 s = texture2D(uHeight, (t + 0.5) / G_TEX); return (s.r * 255.0 * 256.0 + s.g * 255.0) / 65535.0 * ${H_RANGE.toFixed(1)} + ${H_MIN.toFixed(1)}; }
    vec2 gCoord(vec2 xz){ return clamp((xz + ${(WORLD / 2).toFixed(1)}) / ${WORLD.toFixed(1)} * G_SEG, 0.0, G_SEG - 0.001); }
    float groundH(vec2 xz){
      vec2 g = gCoord(xz); vec2 i = floor(g); vec2 f = g - i;
      float a = gDecode(i), b = gDecode(i + vec2(1.0, 0.0)), c = gDecode(i + vec2(0.0, 1.0)), d = gDecode(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float groundGrass(vec2 xz){ return texture2D(uHeight, (floor(gCoord(xz) + 0.5) + 0.5) / G_TEX).b; }
  `;

  // ---------- Terreno con texturas ----------

  let terrainTex = null;
  function terrainMaterial() {
    terrainTex = terrainTex || { grass: makeTexture('grass'), dirt: makeTexture('dirt'), rock: makeTexture('rock'), macro: null };
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tGrass = { value: terrainTex.grass };
      sh.uniforms.tDirt = { value: terrainTex.dirt };
      sh.uniforms.tRock = { value: terrainTex.rock };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;\nvarying vec3 vWorldP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D tGrass;\nuniform sampler2D tDirt;\nuniform sampler2D tRock;\nvarying vec3 vSplat;\nvarying vec3 vWorldP;'
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec2 uv = vWorldP.xz * 0.22;
            // Dos escalas mezcladas para que no se note la repetición
            vec3 g = mix(texture2D(tGrass, uv).rgb, texture2D(tGrass, uv * 0.27 + 0.31).rgb, 0.35);
            vec3 d = mix(texture2D(tDirt, uv * 0.8).rgb, texture2D(tDirt, uv * 0.21 + 0.17).rgb, 0.35);
            vec3 r = mix(texture2D(tRock, uv * 0.45).rgb, texture2D(tRock, uv * 0.12).rgb, 0.4);
            vec3 w = vSplat / max(0.001, vSplat.x + vSplat.y + vSplat.z);
            vec3 detail = g * w.x + d * w.y + r * w.z;
            float macro = texture2D(tGrass, vWorldP.xz * 0.011).r;
            diffuseColor.rgb *= detail * 2.0 * (0.86 + macro * 0.3);
          }`
        );
    };
    return m;
  }

  // Pesos de textura por vértice: x pasto, y tierra, z roca
  function splatAt(x, z, h, zone) {
    let dirt = 0;
    const sky = zone && zone.ground > 10 ? 1 - ss(zone.r * 0.9, zone.r * 1.6, Math.hypot(x - zone.x, z - zone.z)) : 0;
    let rock = ss(6, 13, h) * (1 - sky * 0.9);
    dirt = Math.max(dirt, 1 - ss(9, 17, Math.hypot(x, z)));
    dirt = Math.max(dirt, 1 - ss(1.4, 3.4, pathDist(x, z)));
    dirt = Math.max(dirt, 1 - ss(WATER_Y - 0.3, WATER_Y + 0.8, h));
    if (zone) {
      const w = 1 - ss(zone.r * 0.55, zone.r * 1.2, Math.hypot(x - zone.x, z - zone.z));
      if (zone.id === 'valle') rock = Math.max(rock, w * 0.8);
      if (zone.id === 'minas') rock = Math.max(rock, w * 0.6);
      if (zone.id === 'minas' || zone.id === 'ciudadela') dirt = Math.max(dirt, w * 0.6);
    }
    rock = Math.min(1, rock);
    dirt = Math.min(1 - rock, dirt);
    return [Math.max(0, 1 - dirt - rock), dirt, rock];
  }

  // Oscurece el suelo bajo árboles, rocas y casas (sombra de contacto horneada)
  function groundAO(x, z) {
    const L = layout();
    let ao = 1;
    for (const o of L.near(x, z)) {
      const dd = Math.hypot(x - o.x, z - o.z);
      ao *= 1 - 0.32 * (1 - ss(o.r * 0.5, o.r * 2.6 + 1.2, dd));
    }
    return Math.max(0.55, ao);
  }

  function grassDensityAt(x, z, h) {
    if (h < WATER_Y + 0.25 || (h > 9 && h < 18)) return 0;
    const d = Math.hypot(x, z);
    if (d > 182) return 0;
    let dens = ss(10, 16, d) * ss(1.6, 3.6, pathDist(x, z));
    const zone = V.Data.ZONES.find((zn) => zn.id !== 'aldea' && Math.hypot(x - zn.x, z - zn.z) < zn.r * 1.25);
    if (zone) {
      const w = 1 - ss(zone.r * 0.5, zone.r * 1.2, Math.hypot(x - zone.x, z - zone.z));
      const keep = { praderas: 1, bosque: 0.75, minas: 0.1, ciudadela: 0.2, valle: 0.05, islas: 0.9 }[zone.id];
      dens *= 1 - w * (1 - (keep == null ? 1 : keep));
    }
    const L = layout();
    for (const o of L.near(x, z)) if (Math.hypot(x - o.x, z - o.z) < o.r + 0.6) return 0;
    return Math.max(0, Math.min(1, dens));
  }

  // ---------- Cielo y ciclo de día y noche ----------

  // Un día dura 32 minutos reales; el 72 % es de día. Todos los jugadores ven la misma hora.
  const DAY_SECONDS = 32 * 60;
  const DAY_FRAC = 0.72;
  const sky = {
    dir: new THREE.Vector3(0.4, 0.8, 0.3),
    lightDir: new THREE.Vector3(),
    night: 0,
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    bottom: new THREE.Color(),
    sunColor: new THREE.Color(),
    fog: new THREE.Color(),
    tint: new THREE.Color(1, 1, 1),
    light: new THREE.Color(),
    sunI: 1,
    hemiI: 0.6,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
  };
  // Claves de color: [elevación del sol, cielo arriba, horizonte, abajo, sol, niebla, intensidad sol, cielo ambiente, intensidad ambiente, tinte]
  const KEYS = [
    { e: -0.5, top: 0x0a1428, hor: 0x24304c, bot: 0x151a24, sun: 0x9fb4ff, fog: 0x1f293d, si: 0.42, hs: 0x5b6c9c, hi: 0.5, tint: [0.8, 0.88, 1.12] },
    { e: -0.08, top: 0x1f2b4f, hor: 0x5a5470, bot: 0x2a2630, sun: 0xb0a8d8, fog: 0x4a4a62, si: 0.4, hs: 0x7a7aa8, hi: 0.5, tint: [0.92, 0.9, 1.05] },
    { e: 0.08, top: 0x46558a, hor: 0xf09a5e, bot: 0x6a5446, sun: 0xff9a55, fog: 0xc99470, si: 0.95, hs: 0xd8b8b0, hi: 0.55, tint: [1.08, 0.98, 0.9] },
    { e: 0.32, top: 0x3d5f92, hor: 0xe8c08e, bot: 0x7d6d5a, sun: 0xffd9a8, fog: 0xcdb494, si: 1.2, hs: 0xcfe0ff, hi: 0.6, tint: [1.04, 1, 0.95] },
    { e: 1.0, top: 0x3a5a86, hor: 0xe6c597, bot: 0x7d6d5a, sun: 0xffe6c0, fog: 0xcdb898, si: 1.3, hs: 0xcfe0ff, hi: 0.62, tint: [1.02, 1, 0.97] },
  ];
  const _a = new THREE.Color();
  const _b = new THREE.Color();
  function lerpHex(out, h1, h2, t) {
    return out.copy(_a.setHex(h1)).lerp(_b.setHex(h2), t);
  }

  function dayPhase() {
    if (typeof G.timeOverride === 'number') return G.timeOverride;
    return ((Date.now() / 1000) % DAY_SECONDS) / DAY_SECONDS;
  }

  function updateSky(phase) {
    let elev;
    let az;
    if (phase < DAY_FRAC) {
      const t = phase / DAY_FRAC;
      elev = Math.sin(Math.PI * t);
      az = Math.PI * t;
    } else {
      const t = (phase - DAY_FRAC) / (1 - DAY_FRAC);
      elev = -Math.sin(Math.PI * t) * 0.6;
      az = Math.PI * (1 + t);
    }
    // Dirección de la luz: de día el sol, de noche la luna (en el lado opuesto)
    const e = elev;
    const showY = e >= 0 ? Math.max(0.04, e) : Math.max(0.25, -e * 0.9 + 0.2);
    const sx = Math.cos(az);
    const sz = Math.sin(az) * 0.55 + 0.3;
    sky.dir.set(e >= 0 ? sx : -sx, showY, e >= 0 ? sz : -sz).normalize();
    sky.lightDir.copy(sky.dir);
    sky.lightDir.y = Math.max(sky.lightDir.y, 0.35);
    sky.lightDir.normalize();

    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const k0 = KEYS[i];
    const k1 = KEYS[i + 1];
    const t = Math.min(1, Math.max(0, (e - k0.e) / (k1.e - k0.e)));
    const st = t * t * (3 - 2 * t);
    lerpHex(sky.top, k0.top, k1.top, st);
    lerpHex(sky.horizon, k0.hor, k1.hor, st);
    lerpHex(sky.bottom, k0.bot, k1.bot, st);
    lerpHex(sky.sunColor, k0.sun, k1.sun, st);
    lerpHex(sky.fog, k0.fog, k1.fog, st);
    lerpHex(sky.hemiSky, k0.hs, k1.hs, st);
    sky.hemiGround.setHex(0x4a3b28).lerp(_a.setHex(0x1a1a24), 1 - ss(-0.3, 0.1, e));
    sky.sunI = k0.si + (k1.si - k0.si) * st;
    sky.hemiI = k0.hi + (k1.hi - k0.hi) * st;
    sky.tint.setRGB(
      k0.tint[0] + (k1.tint[0] - k0.tint[0]) * st,
      k0.tint[1] + (k1.tint[1] - k0.tint[1]) * st,
      k0.tint[2] + (k1.tint[2] - k0.tint[2]) * st
    );
    sky.night = 1 - ss(-0.2, 0.05, e);
    // Luz aproximada para lo que no usa luces de three (pasto y agua)
    sky.light.copy(sky.sunColor).multiplyScalar(sky.sunI * 0.55).add(_a.copy(sky.hemiSky).multiplyScalar(sky.hemiI * 0.75));
    sky.elev = e;
  }

  const NOISE_GLSL = `
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
  `;

  function skyMaterial() {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: sky.top },
        horizon: { value: sky.horizon },
        bottom: { value: sky.bottom },
        sunDir: { value: sky.dir },
        sunColor: { value: sky.sunColor },
        night: { value: 0 },
        time: { value: 0 },
        hdr: { value: 1 },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor;
        uniform float night; uniform float time; uniform float hdr; varying vec3 vP;
        ${NOISE_GLSL}
        void main(){
          vec3 d = normalize(vP); float h = d.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.5)) : mix(horizon, bottom, min(1.0, -h * 4.0));
          float sd = max(dot(d, sunDir), 0.0);
          c += sunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.35) * (1.0 - night * 0.7);
          float disc = smoothstep(mix(0.99955, 0.99975, night), mix(0.9998, 0.99988, night), sd);
          c = mix(c, sunColor * mix(1.0, 2.6, hdr), disc);
          if (h > -0.02) {
            float hp = max(h, 0.0);
            vec2 uv = d.xz / (hp + 0.12) * 0.9 + vec2(time * 0.0035, time * 0.0012);
            float cl = smoothstep(0.52, 0.82, fbm(uv)) * smoothstep(0.0, 0.2, hp);
            vec3 lit = mix(horizon, vec3(1.0, 0.98, 0.94), 0.55) * (1.0 - night * 0.8) + sunColor * pow(sd, 3.0) * 0.35;
            c = mix(c, lit, cl * 0.82);
            vec2 sp = d.xz / (hp + 0.35) * 110.0;
            float star = step(0.9965, hash(floor(sp))) * smoothstep(0.05, 0.3, hp);
            c += star * night * (1.0 - cl) * (0.6 + 0.4 * sin(time * 2.0 + hash(floor(sp)) * 40.0));
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
  }

  // ---------- Agua ----------

  function waterMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uHeight: { value: null },
          time: { value: 0 },
          top: { value: new THREE.Color() },
          horizon: { value: new THREE.Color() },
          sunDir: { value: new THREE.Vector3() },
          sunColor: { value: new THREE.Color() },
          light: { value: new THREE.Color() },
          hdr: { value: 1 },
        },
      ]),
      vertexShader: `
        varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float time; uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 light; uniform float hdr;
        varying vec3 vW;
        ${GROUND_GLSL}
        ${NOISE_GLSL}
        #include <fog_pars_fragment>
        void main(){
          vec2 p = vW.xz;
          float depth = ${WATER_Y.toFixed(2)} - groundH(p);
          // Olas: suma de ondas y ruido que se desplaza
          float n1 = vnoise(p * 0.35 + vec2(time * 0.18, time * 0.07));
          float n2 = vnoise(p * 0.9 - vec2(time * 0.11, time * 0.21));
          vec2 grad = vec2(
            cos(p.x * 0.6 + time * 1.1) * 0.5 + cos((p.x + p.y) * 1.3 + time * 1.7) * 0.3 + (n1 - 0.5) * 1.2,
            cos(p.y * 0.7 + time * 0.9) * 0.5 + cos((p.x - p.y) * 1.1 + time * 1.4) * 0.3 + (n2 - 0.5) * 1.2
          );
          vec3 n = normalize(vec3(-grad.x * 0.12, 1.0, -grad.y * 0.12));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(v, n), 0.0), 4.0);
          vec3 shallow = vec3(0.24, 0.42, 0.40);
          vec3 deep = vec3(0.07, 0.19, 0.25);
          vec3 base = mix(shallow, deep, smoothstep(0.0, 3.5, depth)) * light * 1.25;
          vec3 refl = mix(horizon, top, 0.35);
          vec3 c = mix(base, refl, 0.12 + 0.68 * fres);
          vec3 hv = normalize(sunDir + v);
          float spec = pow(max(dot(n, hv), 0.0), 220.0);
          c += sunColor * spec * mix(0.9, 2.2, hdr);
          // Espuma en la orilla
          float edge = 0.28 + 0.12 * sin(time * 1.6 + p.x * 0.7 + p.y * 0.5);
          float foam = (1.0 - smoothstep(0.0, edge, depth)) * smoothstep(0.35, 0.7, vnoise(p * 3.0 + time * 0.4) + 0.3);
          c = mix(c, light * 1.2, foam * 0.75);
          float a = mix(0.45, 0.9, smoothstep(0.0, 1.6, depth));
          a = max(a, foam * 0.8);
          a *= smoothstep(-0.05, 0.03, depth);
          gl_FragColor = vec4(c, a);
          #include <fog_fragment>
        }`,
    });
  }

  // ---------- Pasto ----------

  let grass = null;
  function buildGrass(scene, maxCount) {
    // Una mata = 5 briznas de 2 tramos
    const blades = 5;
    const pos = [];
    const tip = [];
    const idx = [];
    const r = rng(77);
    for (let b = 0; b < blades; b++) {
      const a = r() * Math.PI;
      const ox = (r() - 0.5) * 0.35;
      const oz = (r() - 0.5) * 0.35;
      const w = 0.045 + r() * 0.03;
      const h = 0.7 + r() * 0.5;
      const lean = (r() - 0.5) * 0.25;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      const base = pos.length / 3;
      const rows = [
        [w, 0],
        [w * 0.7, 0.5],
        [0, 1],
      ];
      rows.forEach(([ww, t], k) => {
        const lx = ox + -cz * lean * t * t;
        const lz = oz + cx * lean * t * t;
        if (ww > 0) {
          pos.push(lx - cx * ww, t * h, lz - cz * ww, lx + cx * ww, t * h, lz + cz * ww);
          tip.push(t, t);
        } else {
          pos.push(lx, t * h, lz);
          tip.push(t);
        }
      });
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('tip', new THREE.Float32BufferAttribute(tip, 1));
    geo.setIndex(idx);
    const off = new Float32Array(maxCount * 4);
    const rr = rng(78);
    for (let i = 0; i < maxCount; i++) {
      off[i * 4] = rr();
      off[i * 4 + 1] = rr();
      off[i * 4 + 2] = rr();
      off[i * 4 + 3] = rr() * Math.PI * 2;
    }
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 4));
    geo.instanceCount = 0;

    const m = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uHeight: { value: null },
          uColor: { value: null },
          uCenter: { value: new THREE.Vector2() },
          uPlayer: { value: new THREE.Vector2() },
          uRadius: { value: 30 },
          time: { value: 0 },
          light: { value: new THREE.Color() },
          sunColor: { value: new THREE.Color() },
        },
      ]),
      vertexShader: `
        attribute float tip; attribute vec4 offset;
        uniform sampler2D uColor; uniform vec2 uCenter; uniform vec2 uPlayer; uniform float uRadius; uniform float time;
        varying vec3 vCol; varying float vTip;
        ${GROUND_GLSL}
        #include <fog_pars_vertex>
        void main(){
          float S = uRadius * 2.0;
          vec2 rel = mod(offset.xy * S - uCenter + uRadius, S) - uRadius;
          vec2 wxz = uCenter + rel;
          float dist = length(rel);
          float dens = groundGrass(wxz);
          float keep = step(offset.z, dens) * (1.0 - smoothstep(uRadius * 0.72, uRadius, dist));
          float sc = keep * (0.55 + offset.z * 0.7) * (0.6 + dens * 0.5);
          float c = cos(offset.w), s = sin(offset.w);
          vec3 p = vec3(position.x * c - position.z * s, position.y * sc, position.x * s + position.z * c);
          // Viento y apartarse al paso del jugador
          float t2 = tip * tip;
          float gust = sin(time * 1.6 + wxz.x * 0.32 + wxz.y * 0.21) * 0.6 + sin(time * 0.7 + wxz.x * 0.08) * 0.4;
          p.x += gust * 0.16 * t2 * sc;
          p.z += cos(time * 1.3 + wxz.y * 0.4) * 0.05 * t2 * sc;
          vec2 away = wxz - uPlayer; float ad = length(away);
          if (ad < 1.1 && ad > 0.001) { vec2 push = away / ad * (1.1 - ad) * 0.6 * t2; p.x += push.x; p.z += push.y; p.y -= (1.1 - ad) * 0.3 * t2 * sc; }
          vec3 wp = vec3(wxz.x + p.x, groundH(wxz) - 0.04 + p.y, wxz.y + p.z);
          vec2 cuv = (gCoord(wxz) + 0.5) / G_TEX;
          vCol = texture2D(uColor, cuv).rgb;
          vTip = tip;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform vec3 light; uniform vec3 sunColor;
        varying vec3 vCol; varying float vTip;
        #include <fog_pars_fragment>
        void main(){
          vec3 c = vCol * mix(0.62, 1.32, vTip) * light * 1.18;
          c += sunColor * pow(vTip, 3.0) * 0.06;
          gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    scene.add(mesh);
    grass = { mesh, geo, mat: m, max: maxCount };
    return grass;
  }

  // ---------- Efectos de cámara: brillo (bloom) y corrección de color ----------

  let post = null;
  function Post(renderer) {
    const gl2 = renderer.capabilities.isWebGL2;
    const ext = renderer.extensions;
    const hdr = gl2 ? ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float') : false;
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const mk = (depth) =>
      new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const main = mk(true);
    const levels = [mk(false), mk(false), mk(false), mk(false)];
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    const qs = new THREE.Scene();
    qs.add(quad);
    const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const shader = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
    const bright = shader(
      `uniform sampler2D tDiffuse; uniform vec2 texel; uniform float threshold; varying vec2 vUv;
       void main(){
         vec3 c = (texture2D(tDiffuse, vUv + texel * vec2(-0.5)).rgb + texture2D(tDiffuse, vUv + texel * vec2(0.5)).rgb
                 + texture2D(tDiffuse, vUv + texel * vec2(0.5, -0.5)).rgb + texture2D(tDiffuse, vUv + texel * vec2(-0.5, 0.5)).rgb) * 0.25;
         float l = max(c.r, max(c.g, c.b));
         // Tope: un objeto pequeño muy brillante no puede formar una bola de luz
         vec3 b = c * smoothstep(threshold, threshold + 0.8, l);
         gl_FragColor = vec4(min(b, vec3(0.5)), 1.0);
       }`,
      { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: hdr ? 2.2 : 0.98 } }
    );
    const down = shader(
      `uniform sampler2D tDiffuse; uniform vec2 texel; varying vec2 vUv;
       void main(){
         vec3 s = texture2D(tDiffuse, vUv).rgb * 4.0;
         s += texture2D(tDiffuse, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(1.0, -1.0)).rgb;
         s += texture2D(tDiffuse, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(1.0, 1.0)).rgb;
         gl_FragColor = vec4(s / 8.0, 1.0);
       }`,
      { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() } }
    );
    const up = shader(
      `uniform sampler2D tDiffuse; uniform vec2 texel; varying vec2 vUv;
       void main(){
         vec3 s = vec3(0.0);
         s += texture2D(tDiffuse, vUv + texel * vec2(-2.0, 0.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(2.0, 0.0)).rgb;
         s += texture2D(tDiffuse, vUv + texel * vec2(0.0, -2.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(0.0, 2.0)).rgb;
         s += (texture2D(tDiffuse, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(1.0, 1.0)).rgb
             + texture2D(tDiffuse, vUv + texel * vec2(1.0, -1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(-1.0, -1.0)).rgb) * 2.0;
         gl_FragColor = vec4(s / 12.0, 1.0);
       }`,
      { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() } },
      { blending: THREE.AdditiveBlending, transparent: true }
    );
    const final = shader(
      `uniform sampler2D tDiffuse; uniform sampler2D tBloom; uniform float bloom; uniform vec3 tint; varying vec2 vUv;
       void main(){
         vec3 c = texture2D(tDiffuse, vUv).rgb + texture2D(tBloom, vUv).rgb * bloom;
         c *= tint;
         float l = dot(c, vec3(0.299, 0.587, 0.114));
         c = mix(vec3(l), c, 1.12);
         c = (c - 0.5) * 1.07 + 0.5;
         vec3 over = max(c - 0.8, 0.0);
         c = mix(c, 0.8 + 0.2 * (1.0 - exp(-over / 0.2)), step(0.8, c));
         vec2 d = vUv - 0.5;
         c *= 1.0 - dot(d, d) * 0.55;
         gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
       }`,
      { tDiffuse: { value: null }, tBloom: { value: null }, bloom: { value: 0.4 }, tint: { value: sky.tint } }
    );
    const pass = (m, target) => {
      quad.material = m;
      renderer.setRenderTarget(target);
      renderer.render(qs, cam);
    };
    function setSize(w, h, pr) {
      const W = Math.max(1, Math.floor(w * pr));
      const H = Math.max(1, Math.floor(h * pr));
      main.setSize(W, H);
      let lw = W;
      let lh = H;
      for (const l of levels) {
        lw = Math.max(1, lw >> 1);
        lh = Math.max(1, lh >> 1);
        l.setSize(lw, lh);
      }
    }
    function setSamples(n) {
      if (!gl2 || main.samples === n) return;
      main.samples = n;
      main.dispose();
    }
    function render(scene, camera) {
      renderer.setRenderTarget(main);
      renderer.render(scene, camera);
      // Brillo: zonas muy claras → cadena de reducciones → se suman de vuelta
      bright.uniforms.tDiffuse.value = main.texture;
      bright.uniforms.texel.value.set(1 / main.width, 1 / main.height);
      pass(bright, levels[0]);
      for (let i = 1; i < levels.length; i++) {
        down.uniforms.tDiffuse.value = levels[i - 1].texture;
        down.uniforms.texel.value.set(1 / levels[i - 1].width, 1 / levels[i - 1].height);
        pass(down, levels[i]);
      }
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      for (let i = levels.length - 1; i > 0; i--) {
        up.uniforms.tDiffuse.value = levels[i].texture;
        up.uniforms.texel.value.set(1 / levels[i].width, 1 / levels[i].height);
        pass(up, levels[i - 1]);
      }
      renderer.autoClear = auto;
      final.uniforms.tDiffuse.value = main.texture;
      final.uniforms.tBloom.value = levels[0].texture;
      pass(final, null);
    }
    post = { render, setSize, setSamples, hdr };
    return post;
  }

  // ---------- Conexión con la escena ----------

  const ctx = {};
  function attach(o) {
    Object.assign(ctx, o);
    const { renderer, scene } = ctx;
    Post(renderer);
    const vtf = renderer.capabilities.maxVertexTextures > 0;
    if (vtf && groundMaps) {
      buildGrass(scene, PRESETS.alta.grass);
      grass.mat.uniforms.uHeight.value = groundMaps.height;
      grass.mat.uniforms.uColor.value = groundMaps.color;
    }
    if (ctx.water) ctx.water.material.uniforms.uHeight.value = groundMaps.height;
    apply();
  }

  function apply() {
    const p = preset();
    const { renderer, sun, scene } = ctx;
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, p.pixel));
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
    post.setSamples(p.msaa);
    if (renderer.shadowMap.enabled !== p.shadows) {
      renderer.shadowMap.enabled = p.shadows;
      scene.traverse((o) => {
        if (!o.material) return;
        for (const m of [].concat(o.material)) m.needsUpdate = true;
      });
    }
    if (sun.shadow.mapSize.x !== p.shadowSize) {
      sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    if (terrainTex) {
      const aniso = Math.min(p.aniso, renderer.capabilities.getMaxAnisotropy());
      for (const t of [terrainTex.grass, terrainTex.dirt, terrainTex.rock]) {
        t.anisotropy = aniso;
        t.needsUpdate = true;
      }
    }
    if (grass) grass.geo.instanceCount = p.grass;
    if (grass) grass.mat.uniforms.uRadius.value = p.grassR || 1;
    if (grass) grass.mesh.visible = p.grass > 0;
    for (const g of glows) g.mat.color.copy(g.base).multiplyScalar(glowK(g.k));
  }

  function setQuality(q) {
    if (!PRESETS[q]) return;
    quality = q;
    try {
      localStorage.setItem(KEY, q);
    } catch {
      /* sin almacenamiento */
    }
    apply();
  }
  // Elección manual del jugador: desde ahí no se ajusta sola
  const MANUAL_KEY = 'valdoria-graficos-manual';
  let manual = false;
  try {
    manual = localStorage.getItem(MANUAL_KEY) === '1';
  } catch {
    /* sin almacenamiento */
  }
  const cycleQuality = () => {
    manual = true;
    try {
      localStorage.setItem(MANUAL_KEY, '1');
    } catch {
      /* sin almacenamiento */
    }
    setQuality(ORDER[(ORDER.indexOf(quality) + 1) % ORDER.length]);
  };

  // Ajuste automático: los primeros 90 s de juego, si va a menos de 32 cuadros por segundo
  // durante 5 s seguidos, baja un nivel de calidad
  const perf = { start: 0, win: 0, frames: 0, last: 0 };
  function autoTune() {
    if (manual || !G.started || quality === 'baja') return;
    const now = performance.now();
    if (!perf.start) perf.start = perf.win = perf.last = now;
    const gap = now - perf.last;
    perf.last = now;
    if (gap > 400) {
      // pestaña en segundo plano o carga: se reinicia la medición
      perf.win = now;
      perf.frames = 0;
      return;
    }
    if (now - perf.start > 90000) return;
    perf.frames++;
    if (now - perf.win < 5000) return;
    const fps = (perf.frames * 1000) / (now - perf.win);
    perf.win = now;
    perf.frames = 0;
    if (fps < 32) {
      setQuality(ORDER[ORDER.indexOf(quality) - 1]);
      dispatchEvent(new CustomEvent('valdoria-gfx', { detail: { auto: true, fps: Math.round(fps) } }));
    }
  }

  // Materiales que brillan (llamas, lava, ventanas): su color sube cuando hay bloom
  const glows = [];
  function glow(mat, k) {
    glows.push({ mat, k, base: mat.color.clone() });
    mat.color.multiplyScalar(glowK(k));
  }

  function update(dt, center, player) {
    const { scene, sun, hemi, skyMesh, water } = ctx;
    autoTune();
    updateSky(dayPhase());
    const hdr = preset().post && post.hdr ? 1 : 0;
    sun.color.copy(sky.sunColor);
    sun.intensity = sky.sunI;
    hemi.color.copy(sky.hemiSky);
    hemi.groundColor.copy(sky.hemiGround);
    hemi.intensity = sky.hemiI;
    sun.position.set(center.x + sky.lightDir.x * 110, center.y + sky.lightDir.y * 110, center.z + sky.lightDir.z * 110);
    sun.target.position.copy(center);
    scene.fog.color.copy(sky.fog);
    const su = skyMesh.material.uniforms;
    su.night.value = sky.night;
    su.time.value = G.time;
    su.hdr.value = hdr;
    if (water) {
      const wu = water.material.uniforms;
      wu.time.value = G.time;
      wu.top.value.copy(sky.top);
      wu.horizon.value.copy(sky.horizon);
      wu.sunDir.value.copy(sky.dir);
      wu.sunColor.value.copy(sky.sunColor).multiplyScalar(1 - sky.night * 0.6);
      wu.light.value.copy(sky.light);
      wu.hdr.value = hdr;
    }
    if (grass && grass.mesh.visible) {
      const gu = grass.mat.uniforms;
      gu.time.value = G.time;
      gu.uCenter.value.set(center.x, center.z);
      gu.uPlayer.value.set(player ? player.x : 9999, player ? player.z : 9999);
      gu.light.value.copy(sky.light);
      gu.sunColor.value.copy(sky.sunColor).multiplyScalar(sky.sunI * (1 - sky.night));
    }
    // Las fogatas y ventanas resaltan más de noche
    for (const g of glows) if (g.night) g.mat.color.copy(g.base).multiplyScalar(glowK(g.k) * (1 + sky.night * g.night));
  }

  function render(scene, camera) {
    if (preset().post) post.render(scene, camera);
    else {
      ctx.renderer.setRenderTarget(null);
      ctx.renderer.render(scene, camera);
    }
  }

  function resize() {
    if (!ctx.renderer) return;
    ctx.renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight, ctx.renderer.getPixelRatio());
  }

  V.Gfx = {
    PRESETS,
    get quality() {
      return quality;
    },
    preset,
    setQuality,
    cycleQuality,
    terrainMaterial,
    splatAt,
    groundAO,
    grassDensityAt,
    buildGroundMaps,
    skyMaterial,
    waterMaterial,
    attach,
    update,
    render,
    resize,
    glow,
    glowNight: (mat, k, night) => {
      glow(mat, k);
      glows[glows.length - 1].night = night;
    },
    hot,
    sky,
  };
})();
