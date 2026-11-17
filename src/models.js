// Modelos low-poly hechos con primitivas. Se reemplazarán por modelos .glb con animaciones.
const THREE = window.THREE;

const cache = {};
const geo = (k, f) => cache[k] || (cache[k] = f());
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const sphere = (r) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 10, 8));

export const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.05, flatShading: true, ...extra });

function part(g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

function limb(parent, x, y, z, w, h, m) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(part(box(w, h, w), m, 0, -h / 2, 0));
  parent.add(g);
  return g;
}

export function buildHumanoid(o) {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);
  const skin = mat(o.skin);
  const body = mat(o.body);
  const legs = mat(o.legs);
  const dark = mat(0x2a2119);

  rig.add(part(box(0.8, 0.95, 0.46), body, 0, 1.43, 0));
  rig.add(part(box(0.84, 0.14, 0.5), dark, 0, 0.99, 0));

  const head = new THREE.Group();
  head.position.set(0, 2.13, 0);
  rig.add(head);
  head.add(part(sphere(0.3), skin));
  if (o.hair) head.add(part(box(0.62, 0.2, 0.64), mat(o.hair), 0, 0.17, -0.05));
  const eyeM = o.glow ? mat(o.glow, { emissive: o.glow, emissiveIntensity: 1.6 }) : mat(0x1a1410);
  head.add(part(box(0.07, 0.07, 0.04), eyeM, 0.11, 0.03, 0.28));
  head.add(part(box(0.07, 0.07, 0.04), eyeM, -0.11, 0.03, 0.28));
  if (o.tusks) {
    const t = mat(0xece3c8);
    head.add(part(box(0.06, 0.15, 0.06), t, 0.13, -0.14, 0.25));
    head.add(part(box(0.06, 0.15, 0.06), t, -0.13, -0.14, 0.25));
  }
  if (o.ears) {
    const e1 = part(box(0.08, 0.1, 0.34), skin, 0.32, 0.06, -0.02);
    const e2 = part(box(0.08, 0.1, 0.34), skin, -0.32, 0.06, -0.02);
    e1.rotation.y = 0.9;
    e2.rotation.y = -0.9;
    head.add(e1, e2);
  }
  if (o.cape) rig.add(part(box(0.74, 1.15, 0.06), mat(o.cape), 0, 1.33, -0.27));
  if (o.robe) {
    const skirt = part(geo('robe', () => new THREE.CylinderGeometry(0.42, 0.56, 0.95, 8)), body, 0, 0.5, 0);
    rig.add(skirt);
  }

  const lArm = limb(rig, -0.52, 1.86, 0, 0.22, 0.82, skin);
  const rArm = limb(rig, 0.52, 1.86, 0, 0.22, 0.82, skin);
  lArm.add(part(box(0.3, 0.26, 0.32), body, 0, -0.06, 0));
  rArm.add(part(box(0.3, 0.26, 0.32), body, 0, -0.06, 0));
  const lLeg = limb(rig, -0.2, 0.95, 0, 0.27, 0.95, legs);
  const rLeg = limb(rig, 0.2, 0.95, 0, 0.27, 0.95, legs);

  let weapon = null;
  let bladeMat = null;
  if (o.weapon !== false) {
    weapon = new THREE.Group();
    weapon.position.set(0, -0.82, 0.04);
    weapon.rotation.x = Math.PI / 2;
    rArm.add(weapon);
    if (o.club) {
      weapon.add(part(box(0.16, 1.0, 0.16), mat(0x5b4129), 0, 0.48, 0));
      weapon.add(part(box(0.3, 0.36, 0.3), mat(0x4a3826), 0, 0.95, 0));
    } else {
      bladeMat = mat(o.weaponColor || 0xc9ccd2, { metalness: 0.6, roughness: 0.35 });
      weapon.add(part(box(0.07, 1.1, 0.17), bladeMat, 0, 0.68, 0));
      weapon.add(part(box(0.38, 0.07, 0.12), mat(0x8a6d3b, { metalness: 0.5 }), 0, 0.1, 0));
      weapon.add(part(box(0.07, 0.3, 0.07), dark, 0, -0.07, 0));
    }
  }

  const s = o.scale || 1;
  rig.scale.setScalar(s);
  return { kind: 'hum', root, rig, head, lArm, rArm, lLeg, rLeg, weapon, bladeMat, torsoMat: body, baseBody: o.body, height: 2.5 * s };
}

export function buildQuadruped(o) {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);
  const c = mat(o.color);
  const d = mat(new THREE.Color(o.color).multiplyScalar(0.62));
  const black = mat(0x15110d);

  rig.add(part(box(0.72, 0.62, 1.35), c, 0, 0.88, 0));
  if (o.mane) rig.add(part(box(0.5, 0.2, 0.9), d, 0, 1.25, 0.15));
  const head = new THREE.Group();
  head.position.set(0, 1.02, 0.72);
  rig.add(head);
  head.add(part(box(0.5, 0.46, 0.52), c, 0, 0, 0.2));
  head.add(part(box(0.3, 0.26, 0.34), d, 0, -0.08, 0.58));
  head.add(part(box(0.1, 0.18, 0.08), d, 0.17, 0.3, 0.08));
  head.add(part(box(0.1, 0.18, 0.08), d, -0.17, 0.3, 0.08));
  head.add(part(box(0.06, 0.06, 0.03), black, 0.14, 0.07, 0.46));
  head.add(part(box(0.06, 0.06, 0.03), black, -0.14, 0.07, 0.46));
  if (o.tusks) {
    const t = mat(0xece3c8);
    head.add(part(box(0.05, 0.16, 0.05), t, 0.13, 0.0, 0.7));
    head.add(part(box(0.05, 0.16, 0.05), t, -0.13, 0.0, 0.7));
  }
  const legs = [
    [-0.24, 0.45],
    [0.24, 0.45],
    [-0.24, -0.45],
    [0.24, -0.45],
  ].map(([x, z]) => limb(rig, x, 0.62, z, 0.17, 0.62, d));
  const tail = part(box(0.1, 0.1, 0.4), d, 0, 1.0, -0.8);
  tail.rotation.x = 0.5;
  rig.add(tail);

  const s = o.scale || 1;
  rig.scale.setScalar(s);
  return { kind: 'quad', root, rig, head, legs, height: 1.5 * s };
}

export function animateModel(m, t, walk, atk) {
  const swing = atk > 0 ? Math.sin(Math.PI * (1 - atk)) : 0;
  if (m.kind === 'hum') {
    const s = Math.sin(t * 9) * 0.75 * walk;
    m.lLeg.rotation.x = s;
    m.rLeg.rotation.x = -s;
    m.lArm.rotation.x = -s * 0.8;
    m.rArm.rotation.x = atk > 0 ? -swing * 2.3 : s * 0.8;
    m.rig.position.y = Math.abs(Math.sin(t * 9)) * 0.06 * walk + Math.sin(t * 2.2) * 0.015;
  } else {
    const s = Math.sin(t * 11) * 0.6 * walk;
    m.legs[0].rotation.x = s;
    m.legs[3].rotation.x = s;
    m.legs[1].rotation.x = -s;
    m.legs[2].rotation.x = -s;
    m.head.rotation.x = atk > 0 ? swing * 0.5 : Math.sin(t * 2) * 0.05;
    m.head.position.z = 0.72 + swing * 0.25;
    m.rig.position.y = Math.abs(Math.sin(t * 11)) * 0.05 * walk;
  }
}

export function animateDeath(m, k) {
  if (m.kind === 'hum') {
    m.rig.rotation.x = (-Math.PI / 2) * k;
    m.rig.position.y = 0.1 * m.height * k;
  } else {
    m.rig.rotation.z = (Math.PI / 2) * k;
    m.rig.position.y = 0.15 * m.height * k;
  }
}

const BLADE = {
  comun: [0xc9ccd2, 0x000000, 0],
  refinado: [0xdfe4ea, 0x0b2a12, 0.4],
  raro: [0x8fb8ff, 0x1a3a90, 0.9],
  epico: [0xc79bff, 0x5a1fa0, 1.4],
};

export function setWeaponLook(m, item) {
  if (!m.weapon) return;
  m.weapon.visible = !!item;
  if (!item || !m.bladeMat) return;
  const [c, e, i] = BLADE[item.rarity] || BLADE.comun;
  m.bladeMat.color.setHex(c);
  m.bladeMat.emissive.setHex(e);
  m.bladeMat.emissiveIntensity = i;
}

export function setArmorLook(m, item) {
  m.torsoMat.color.setHex(item ? item.look : m.baseBody);
}
