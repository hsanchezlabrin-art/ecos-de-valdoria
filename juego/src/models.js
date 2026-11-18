// Modelos low-poly hechos con primitivas. Se reemplazarán por modelos .glb con animaciones.
(function () {
  const THREE = window.THREE;

  const cache = {};
  const geo = (k, f) => cache[k] || (cache[k] = f());
  const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  const sphere = (r) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 10, 8));

  const mat = (color, extra = {}) =>
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

  function buildHumanoid(o) {
    const root = new THREE.Group();
    const rig = new THREE.Group();
    root.add(rig);
    const skin = mat(o.skin);
    const body = mat(o.body);
    const legs = mat(o.legs);
    const dark = mat(0x2a2119);

    // Figura: las mujeres tienen torso y hombros más estrechos y cintura marcada
    const fem = !!o.female;
    const torsoW = fem ? 0.66 : 0.8;
    const shoulder = fem ? 0.45 : 0.52;
    rig.add(part(box(torsoW, 0.95, fem ? 0.4 : 0.46), body, 0, 1.43, 0));
    if (fem) {
      rig.add(part(box(0.56, 0.22, 0.42), body, 0, 1.62, 0.05)); // busto
      rig.add(part(box(0.74, 0.3, 0.46), body, 0, 1.06, 0)); // caderas
    }
    rig.add(part(box(fem ? 0.7 : 0.84, 0.14, 0.5), dark, 0, 0.99, 0));

    const head = new THREE.Group();
    head.position.set(0, 2.13, 0);
    rig.add(head);
    head.add(part(sphere(0.3), skin));
    if (o.hair && !o.hat) head.add(part(box(0.62, 0.2, 0.64), mat(o.hair), 0, 0.17, -0.05));
    if (o.longHair) {
      head.add(part(box(0.58, 0.66, 0.2), mat(o.hair), 0, -0.14, -0.25));
      if (fem) {
        // mechones a los lados de la cara
        head.add(part(box(0.1, 0.5, 0.22), mat(o.hair), 0.28, -0.12, -0.04));
        head.add(part(box(0.1, 0.5, 0.22), mat(o.hair), -0.28, -0.12, -0.04));
      }
    }
    if (o.beard) head.add(part(box(0.4, 0.36, 0.16), mat(o.hair), 0, -0.25, 0.2));
    if (o.hat) {
      const hm = mat(o.hat);
      head.add(part(geo('brim', () => new THREE.CylinderGeometry(0.56, 0.56, 0.06, 10)), hm, 0, 0.2, 0));
      const cone = part(geo('hatc', () => new THREE.ConeGeometry(0.34, 0.85, 8)), hm, 0, 0.6, -0.06);
      cone.rotation.x = -0.22;
      head.add(cone);
    }
    const eyeM = o.glow ? mat(o.glow, { emissive: o.glow, emissiveIntensity: 0.7 }) : mat(0x1a1410);
    head.add(part(box(0.07, 0.07, 0.04), eyeM, 0.11, 0.03, 0.28));
    head.add(part(box(0.07, 0.07, 0.04), eyeM, -0.11, 0.03, 0.28));
    if (o.tusks) {
      const t = mat(0xece3c8);
      head.add(part(box(0.06, 0.15, 0.06), t, 0.13, -0.14, 0.25));
      head.add(part(box(0.06, 0.15, 0.06), t, -0.13, -0.14, 0.25));
    }
    if (o.ears === true) {
      const e1 = part(box(0.08, 0.1, 0.34), skin, 0.32, 0.06, -0.02);
      const e2 = part(box(0.08, 0.1, 0.34), skin, -0.32, 0.06, -0.02);
      e1.rotation.y = 0.9;
      e2.rotation.y = -0.9;
      head.add(e1, e2);
    } else if (o.ears === 'pointy') {
      // Elfo: orejas largas y puntiagudas hacia arriba
      for (const sx of [1, -1]) {
        const e = part(box(0.06, 0.1, 0.3), skin, 0.3 * sx, 0.08, -0.04);
        e.rotation.set(0.5, 0.5 * sx, 0.6 * sx);
        head.add(e);
      }
    } else if (o.ears === 'round') {
      // Oso: orejas redondas (cubos) sobre la cabeza
      const em = mat(o.hair || o.skin);
      head.add(part(box(0.17, 0.17, 0.1), em, 0.22, 0.3, -0.02), part(box(0.17, 0.17, 0.1), em, -0.22, 0.3, -0.02));
    } else if (o.ears === 'cat') {
      // Hada-Gato: orejas de gato triangulares
      for (const sx of [1, -1]) {
        const e = part(geo('catear', () => new THREE.ConeGeometry(0.11, 0.24, 4)), skin, 0.18 * sx, 0.34, -0.02);
        e.rotation.y = Math.PI / 4;
        head.add(e);
      }
    }
    if (o.snout) {
      // Hocico de oso o de lagarto
      head.add(part(box(0.26, 0.18, 0.2), mat(o.snout), 0, -0.08, 0.3));
      head.add(part(box(0.1, 0.06, 0.04), mat(0x1a1410), 0, -0.02, 0.41));
    }
    if (o.crest) {
      // Cresta dracónica
      const cm = mat(o.crest);
      for (let i = 0; i < 3; i++) head.add(part(box(0.06, 0.16 - i * 0.03, 0.12), cm, 0, 0.32 - i * 0.04, -0.06 - i * 0.13));
    }
    if (o.goggles) {
      // Gnomo: gafas de ingeniero sobre la frente
      const gm = mat(o.goggles, { metalness: 0.4, roughness: 0.3 });
      head.add(part(box(0.15, 0.12, 0.06), gm, 0.1, 0.14, 0.27), part(box(0.15, 0.12, 0.06), gm, -0.1, 0.14, 0.27));
      head.add(part(box(0.62, 0.05, 0.05), mat(0x3a2a1c), 0, 0.14, 0.02));
    }
    if (o.cape) rig.add(part(box(0.74, 1.15, 0.06), mat(o.cape), 0, 1.33, -0.27));
    if (o.tail) {
      // Cola: corta (oso), larga y gruesa (lagarto) o fina y curvada (gato)
      const tm = mat(o.tail === 'stub' ? o.hair || o.skin : o.skin);
      if (o.tail === 'stub') rig.add(part(box(0.2, 0.2, 0.16), tm, 0, 1.0, -0.3));
      else if (o.tail === 'lizard') {
        // Tres segmentos que bajan hasta el suelo
        const t1 = part(box(0.26, 0.24, 0.5), tm, 0, 0.98, -0.38);
        t1.rotation.x = 0.45;
        const t2 = part(box(0.2, 0.18, 0.45), tm, 0, 0.78, -0.72);
        t2.rotation.x = 0.55;
        const t3 = part(box(0.14, 0.12, 0.42), tm, 0, 0.58, -1.05);
        t3.rotation.x = 0.6;
        rig.add(t1, t2, t3);
      } else {
        const t1 = part(box(0.08, 0.08, 0.5), tm, 0, 1.0, -0.42);
        t1.rotation.x = -0.6;
        const t2 = part(box(0.08, 0.3, 0.08), tm, 0, 1.35, -0.62);
        rig.add(t1, t2);
      }
    }
    if (o.wings) {
      // Alas de hada translúcidas
      const wm = mat(o.wings, { transparent: true, opacity: 0.55, emissive: o.wings, emissiveIntensity: 0.15, side: THREE.DoubleSide });
      for (const sx of [1, -1]) {
        const wg = part(box(0.62, 0.8, 0.02), wm, 0.36 * sx, 1.62, -0.32);
        wg.rotation.set(0.1, -0.5 * sx, 0.35 * sx);
        wg.castShadow = false;
        rig.add(wg);
      }
    }
    if (o.robe) {
      const skirt = part(geo('robe', () => new THREE.CylinderGeometry(0.42, 0.56, 0.95, 8)), body, 0, 0.5, 0);
      rig.add(skirt);
    }

    const armW = fem ? 0.19 : 0.22;
    const lArm = limb(rig, -shoulder, 1.86, 0, armW, 0.82, skin);
    const rArm = limb(rig, shoulder, 1.86, 0, armW, 0.82, skin);
    lArm.add(part(box(fem ? 0.25 : 0.3, 0.24, fem ? 0.28 : 0.32), body, 0, -0.06, 0));
    rArm.add(part(box(fem ? 0.25 : 0.3, 0.24, fem ? 0.28 : 0.32), body, 0, -0.06, 0));
    const legW = fem ? 0.24 : 0.27;
    const lLeg = limb(rig, fem ? -0.17 : -0.2, 0.95, 0, legW, 0.95, legs);
    const rLeg = limb(rig, fem ? 0.17 : 0.2, 0.95, 0, legW, 0.95, legs);

    const wt = o.weapon === false ? null : o.weaponType || (o.club ? 'club' : 'sword');
    let weapon = null;
    let bladeMat = null;
    if (wt === 'hammer') {
      // Martillo de bloques: mango y cabeza que cambia de color según el grado
      weapon = new THREE.Group();
      weapon.position.set(0, -0.82, 0.04);
      weapon.rotation.x = Math.PI / 2;
      rArm.add(weapon);
      weapon.add(part(box(0.1, 1.15, 0.1), mat(0x5b4129), 0, 0.5, 0));
      bladeMat = mat(0x9a8f80, { metalness: 0.25, roughness: 0.6 });
      weapon.add(part(box(0.5, 0.32, 0.32), bladeMat, 0, 1.1, 0));
    } else if (wt === 'sword' || wt === 'club') {
      weapon = new THREE.Group();
      weapon.position.set(0, -0.82, 0.04);
      weapon.rotation.x = Math.PI / 2;
      rArm.add(weapon);
      if (wt === 'club') {
        weapon.add(part(box(0.16, 1.0, 0.16), mat(0x5b4129), 0, 0.48, 0));
        weapon.add(part(box(0.3, 0.36, 0.3), mat(0x4a3826), 0, 0.95, 0));
      } else {
        bladeMat = mat(o.weaponColor || 0xc9ccd2, { metalness: 0.3, roughness: 0.62 });
        weapon.add(part(box(0.07, 1.1, 0.17), bladeMat, 0, 0.68, 0));
        weapon.add(part(box(0.38, 0.07, 0.12), mat(0x8a6d3b, { metalness: 0.25, roughness: 0.6 }), 0, 0.1, 0));
        weapon.add(part(box(0.07, 0.3, 0.07), dark, 0, -0.07, 0));
      }
    } else if (wt === 'staff') {
      // Báculo vertical en la mano derecha, con un orbe que brilla según la rareza.
      weapon = new THREE.Group();
      weapon.position.set(0, -0.8, 0.08);
      weapon.rotation.x = 0.12;
      rArm.add(weapon);
      weapon.add(part(geo('staff', () => new THREE.CylinderGeometry(0.045, 0.06, 2.3, 6)), mat(0x5a3e28), 0, 0.35, 0));
      weapon.add(part(geo('staffcap', () => new THREE.ConeGeometry(0.13, 0.3, 6)), mat(0x8a6d3b, { metalness: 0.25, roughness: 0.6 }), 0, 1.45, 0));
      bladeMat = mat(0x9fc4ff, { emissive: 0x3a6ad0, emissiveIntensity: 0.6 });
      weapon.add(part(sphere(0.16), bladeMat, 0, 1.68, 0));
    } else if (wt === 'bow') {
      // Arco en la mano izquierda: medio toro como palas y una cuerda fina.
      weapon = new THREE.Group();
      weapon.position.set(0, -0.8, 0.06);
      lArm.add(weapon);
      const inner = new THREE.Group();
      inner.rotation.y = -Math.PI / 2;
      weapon.add(inner);
      bladeMat = mat(0x6b4a2e);
      const arc = part(geo('bow', () => new THREE.TorusGeometry(0.72, 0.04, 4, 14, Math.PI)), bladeMat, -0.3, 0, 0);
      arc.rotation.z = -Math.PI / 2;
      arc.scale.set(0.42, 1, 1);
      const string = part(box(0.015, 1.44, 0.015), mat(0xe8e0cc), -0.3, 0, 0);
      inner.add(arc, string);
    }

    const s = o.scale || 1;
    rig.scale.setScalar(s);
    return { kind: 'hum', root, rig, head, lArm, rArm, lLeg, rLeg, weapon, weaponType: wt, bladeMat, torsoMat: body, baseBody: o.body, height: 2.5 * s };
  }

  function buildQuadruped(o) {
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

  function animateModel(m, t, walk, atk, swim = 0) {
    const swing = atk > 0 ? Math.sin(Math.PI * (1 - atk)) : 0;
    if (m.kind === 'hum' && swim > 0.01) {
      // Nadar: cuerpo inclinado, brazadas alternas y patada
      const s = Math.sin(t * 5);
      m.rig.rotation.x = -1.1 * swim;
      m.rig.position.y = 1.0 * swim + Math.sin(t * 2.5) * 0.06;
      m.lArm.rotation.x = -1.6 - s * 1.4;
      m.rArm.rotation.x = -1.6 + s * 1.4;
      m.lLeg.rotation.x = Math.sin(t * 10) * 0.4;
      m.rLeg.rotation.x = -Math.sin(t * 10) * 0.4;
      return;
    }
    if (m.kind === 'hum' && m.rig.rotation.x !== 0 && !m.dying) m.rig.rotation.x = 0;
    if (m.kind === 'hum') {
      const s = Math.sin(t * 9) * 0.75 * walk;
      m.lLeg.rotation.x = s;
      m.rLeg.rotation.x = -s;
      if (m.weaponType === 'bow' && atk > 0) {
        // Tensar: ambos brazos al frente.
        m.lArm.rotation.x = -swing * 1.55;
        m.rArm.rotation.x = -swing * 1.45;
      } else {
        m.lArm.rotation.x = -s * 0.8;
        m.rArm.rotation.x = atk > 0 ? -swing * (m.weaponType === 'staff' ? 1.7 : 2.3) : s * 0.8;
      }
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

  function animateDeath(m, k) {
    m.dying = k > 0;
    if (m.kind === 'hum') {
      m.rig.rotation.x = (-Math.PI / 2) * k;
      m.rig.position.y = 0.1 * m.height * k;
    } else {
      m.rig.rotation.z = (Math.PI / 2) * k;
      m.rig.position.y = 0.15 * m.height * k;
    }
  }

  // [color, emisivo, intensidad] por grado y tipo de arma
  const LOOKS = {
    sword: {
      madera: [0x9a7448, 0x000000, 0],
      cobre: [0xc8844a, 0x1a0a02, 0.1],
      azul: [0x8fb8ff, 0x1a3a90, 0.5],
      morado: [0xc79bff, 0x5a1fa0, 0.77],
      dorado: [0xffc46b, 0xb05a10, 0.99],
      arcoiris: [0xffe6ff, 0xd060c0, 1.1],
    },
    hammer: {
      madera: [0x8a6a46, 0x000000, 0],
      cobre: [0x9a9088, 0x000000, 0],
      azul: [0x6a9cff, 0x1a3a90, 0.5],
      morado: [0xb88cff, 0x5a1fa0, 0.72],
      dorado: [0xffc46b, 0xb05a10, 0.94],
      arcoiris: [0xffe6ff, 0xd060c0, 1.05],
    },
    bow: {
      madera: [0x6b4a2e, 0x000000, 0],
      cobre: [0x7a5a32, 0x1d1206, 0.1],
      azul: [0xd4dde8, 0x2a4a90, 0.44],
      morado: [0xb88cff, 0x5a1fa0, 0.72],
      dorado: [0xffc46b, 0xb05a10, 0.94],
      arcoiris: [0xffe6ff, 0xd060c0, 1.05],
    },
    staff: {
      madera: [0x9fe08a, 0x2f8a2a, 0.33],
      cobre: [0xffb06a, 0x8a4010, 0.5],
      azul: [0x6a9cff, 0x1f4ad0, 0.83],
      morado: [0xd09bff, 0x7a2ad0, 1.1],
      dorado: [0xffd27a, 0xd07a10, 1.32],
      arcoiris: [0xfff0ff, 0xe070d0, 1.4],
    },
  };

  function setWeaponLook(m, item) {
    if (!m.weapon) return;
    m.weapon.visible = !!item;
    if (!item || !m.bladeMat) return;
    const table = LOOKS[m.weaponType] || LOOKS.sword;
    const [c, e, i] = table[item.grade || item.rarity] || table.madera;
    m.bladeMat.color.setHex(c);
    m.bladeMat.emissive.setHex(e);
    m.bladeMat.emissiveIntensity = i;
  }

  function setArmorLook(m, item) {
    m.torsoMat.color.setHex(item ? item.look : m.baseBody);
  }

  V.Models = { mat, buildHumanoid, buildQuadruped, animateModel, animateDeath, setWeaponLook, setArmorLook };
})();
