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

  // ---------- Armas: forma según el tipo ----------
  // shape: forma 3D · familia (para colores y animación): sword | hammer | bow | staff
  const WEAPON_SHAPE = {
    hammer: 'hammer', mace: 'mace', hammer2h: 'hammer2h', longsword: 'sword', dualswords: 'dual', spear: 'spear', daggers: 'daggers',
    bow: 'bow', crossbow: 'crossbow', crystalstaff: 'staff', wand: 'wand', launcher: 'launcher', book: 'book', bell: 'bell', scepter: 'scepter',
    sword: 'sword', club: 'club', staff: 'staff',
  };
  const FAMILY = { hammer: 'hammer', mace: 'hammer', hammer2h: 'hammer', sword: 'sword', dual: 'sword', spear: 'sword', daggers: 'sword', club: 'sword', bow: 'bow', crossbow: 'bow', staff: 'staff', wand: 'staff', launcher: 'staff', book: 'staff', bell: 'staff', scepter: 'staff' };

  function swordInto(g, blade, guard, grip, len) {
    g.add(part(box(0.07, len, 0.17), blade, 0, 0.13 + len / 2, 0));
    g.add(part(box(0.38 * Math.min(1, len + 0.2), 0.07, 0.12), guard, 0, 0.1, 0));
    g.add(part(box(0.07, 0.3, 0.07), grip, 0, -0.07, 0));
  }

  // Construye (o cambia) el arma del modelo. Devuelve el material que cambia de color por grado.
  function makeWeapon(m, shape, color) {
    for (const g of m.weaponParts || []) if (g.parent) g.parent.remove(g);
    m.weaponParts = [];
    m.floatBook = null;
    const dark = mat(0x2a2119);
    const wood = mat(0x5b4129);
    const gold = mat(0x8a6d3b, { metalness: 0.25, roughness: 0.6 });
    let blade = mat(color || 0xc9ccd2, { metalness: 0.3, roughness: 0.62 });
    const holder = (parent, upright) => {
      const g = new THREE.Group();
      if (upright) {
        g.position.set(0, -0.8, 0.08);
        g.rotation.x = 0.12;
      } else {
        g.position.set(0, -0.82, 0.04);
        g.rotation.x = Math.PI / 2;
      }
      parent.add(g);
      m.weaponParts.push(g);
      return g;
    };
    let main = null;
    switch (shape) {
      case 'hammer':
      case 'mace':
      case 'hammer2h': {
        const big = shape === 'hammer2h';
        main = holder(m.rArm);
        main.add(part(box(0.1, big ? 1.5 : 1.15, 0.1), wood, 0, big ? 0.65 : 0.5, 0));
        if (shape === 'mace') {
          main.add(part(box(0.34, 0.34, 0.34), blade, 0, 1.1, 0));
          for (const [x, z] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) main.add(part(box(0.1, 0.1, 0.1), blade, x, 1.1, z));
        } else main.add(part(box(big ? 0.72 : 0.5, big ? 0.42 : 0.32, big ? 0.42 : 0.32), blade, 0, big ? 1.45 : 1.1, 0));
        break;
      }
      case 'sword':
      case 'dual':
        main = holder(m.rArm);
        swordInto(main, blade, gold, dark, 1.1);
        if (shape === 'dual') swordInto(holder(m.lArm), blade, gold, dark, 0.95);
        break;
      case 'daggers':
        main = holder(m.rArm);
        swordInto(main, blade, gold, dark, 0.5);
        swordInto(holder(m.lArm), blade, gold, dark, 0.5);
        break;
      case 'spear':
        main = holder(m.rArm);
        main.add(part(box(0.07, 2.3, 0.07), wood, 0, 0.75, 0));
        main.add(part(geo('spearTip', () => new THREE.ConeGeometry(0.11, 0.42, 4)), blade, 0, 2.05, 0));
        break;
      case 'club':
        main = holder(m.rArm);
        main.add(part(box(0.16, 1.0, 0.16), wood, 0, 0.48, 0));
        main.add(part(box(0.3, 0.36, 0.3), mat(0x4a3826), 0, 0.95, 0));
        blade = null;
        break;
      case 'bow': {
        main = new THREE.Group();
        main.position.set(0, -0.8, 0.06);
        m.lArm.add(main);
        m.weaponParts.push(main);
        const inner = new THREE.Group();
        inner.rotation.y = -Math.PI / 2;
        main.add(inner);
        blade = mat(color || 0x6b4a2e);
        const arc = part(geo('bow', () => new THREE.TorusGeometry(0.72, 0.04, 4, 14, Math.PI)), blade, -0.3, 0, 0);
        arc.rotation.z = -Math.PI / 2;
        arc.scale.set(0.42, 1, 1);
        inner.add(arc, part(box(0.015, 1.44, 0.015), mat(0xe8e0cc), -0.3, 0, 0));
        break;
      }
      case 'crossbow': {
        // Ballesta: culata hacia adelante y arco horizontal
        main = holder(m.rArm);
        blade = mat(color || 0x6b4a2e);
        main.add(part(box(0.12, 0.9, 0.14), wood, 0, 0.35, 0));
        const arc = part(geo('xbow', () => new THREE.TorusGeometry(0.42, 0.04, 4, 12, Math.PI)), blade, 0, 0.72, 0);
        arc.rotation.x = Math.PI / 2;
        main.add(arc, part(box(0.84, 0.015, 0.015), mat(0xe8e0cc), 0, 0.72, 0));
        break;
      }
      case 'staff':
        main = holder(m.rArm, true);
        main.add(part(geo('staff', () => new THREE.CylinderGeometry(0.045, 0.06, 2.3, 6)), wood, 0, 0.35, 0));
        main.add(part(geo('staffcap', () => new THREE.ConeGeometry(0.13, 0.3, 6)), gold, 0, 1.45, 0));
        blade = mat(0x9fc4ff, { emissive: 0x3a6ad0, emissiveIntensity: 0.4, flatShading: true });
        main.add(part(geo('staffgem', () => new THREE.OctahedronGeometry(0.2, 0)), blade, 0, 1.72, 0));
        break;
      case 'wand':
        main = holder(m.rArm, true);
        main.add(part(box(0.06, 0.9, 0.06), mat(0x8a8f9a, { metalness: 0.4 }), 0, 0.1, 0));
        blade = mat(0xd9b25f, { metalness: 0.4, roughness: 0.4 });
        main.add(part(geo('wgear', () => new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8)), blade, 0, 0.6, 0).rotateX(Math.PI / 2));
        break;
      case 'launcher':
        main = holder(m.rArm);
        main.add(part(geo('ltube', () => new THREE.CylinderGeometry(0.09, 0.11, 0.9, 8)), mat(0x8a8f9a, { metalness: 0.4 }), 0, 0.35, 0));
        blade = mat(0x9fe08a, { transparent: true, opacity: 0.85, emissive: 0x2f8a2a, emissiveIntensity: 0.3 });
        main.add(part(sphere(0.17), blade, 0, 0.85, 0));
        break;
      case 'bell':
        main = holder(m.rArm, true);
        main.add(part(box(0.06, 0.5, 0.06), wood, 0, -0.05, 0));
        blade = mat(0xd9b25f, { metalness: 0.45, roughness: 0.35 });
        main.add(part(geo('bell', () => new THREE.CylinderGeometry(0.08, 0.22, 0.3, 8)), blade, 0, 0.32, 0));
        break;
      case 'scepter':
        main = holder(m.rArm, true);
        main.add(part(geo('sceptre', () => new THREE.CylinderGeometry(0.04, 0.05, 1.5, 6)), mat(0xf2efe6), 0, 0.15, 0));
        blade = mat(0xffe08a, { emissive: 0xd0a020, emissiveIntensity: 0.35, flatShading: true });
        {
          const star = part(geo('star', () => new THREE.OctahedronGeometry(0.22, 0)), blade, 0, 1.0, 0);
          star.scale.set(1, 1, 0.4);
          main.add(star);
        }
        break;
      case 'book': {
        // Libro flotante al lado del personaje
        main = new THREE.Group();
        main.position.set(0.75, 1.55, 0.25);
        m.rig.add(main);
        m.weaponParts.push(main);
        blade = mat(0x5d8fd8);
        main.add(part(box(0.42, 0.08, 0.32), blade, 0, 0, 0));
        main.add(part(box(0.38, 0.06, 0.3), mat(0xf4f0e6), 0, 0.07, 0));
        main.rotation.set(-0.5, 0.3, 0);
        m.floatBook = main;
        break;
      }
      default:
        break;
    }
    m.weapon = main;
    m.bladeMat = blade;
    m.weaponShape = shape;
    m.weaponType = FAMILY[shape] || 'sword';
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
    head.position.set(0, o.bigHead ? 2.2 : 2.15, 0);
    if (o.bigHead) head.scale.setScalar(1.18);
    rig.add(head);
    head.add(part(box(0.58, 0.58, 0.58), skin));
    if (o.hair && !o.hat) head.add(part(box(0.64, 0.14, 0.64), mat(o.hair), 0, 0.3, -0.02));
    if (o.longHair) {
      head.add(part(box(0.6, 0.66, 0.14), mat(o.hair), 0, -0.1, -0.3));
      if (fem) {
        // mechones a los lados de la cara
        head.add(part(box(0.08, 0.5, 0.3), mat(o.hair), 0.31, -0.08, -0.08));
        head.add(part(box(0.08, 0.5, 0.3), mat(o.hair), -0.31, -0.08, -0.08));
      }
    }
    if (o.beard) head.add(part(box(0.44, 0.3, 0.1), mat(o.hair), 0, -0.2, 0.31));
    if (o.hat) {
      const hm = mat(o.hat);
      head.add(part(geo('brim', () => new THREE.CylinderGeometry(0.56, 0.56, 0.06, 10)), hm, 0, 0.3, 0));
      const cone = part(geo('hatc', () => new THREE.ConeGeometry(0.34, 0.85, 8)), hm, 0, 0.7, -0.06);
      cone.rotation.x = -0.22;
      head.add(cone);
    }
    const eyeM = o.glow ? mat(o.glow, { emissive: o.glow, emissiveIntensity: 0.7 }) : mat(0x1a1410);
    head.add(part(box(0.09, 0.09, 0.03), eyeM, 0.13, 0.04, 0.295));
    head.add(part(box(0.09, 0.09, 0.03), eyeM, -0.13, 0.04, 0.295));
    if (o.tusks) {
      const t = mat(0xece3c8);
      head.add(part(box(0.06, 0.15, 0.06), t, 0.13, -0.16, 0.3));
      head.add(part(box(0.06, 0.15, 0.06), t, -0.13, -0.16, 0.3));
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
      head.add(part(box(0.18, 0.18, 0.1), em, 0.22, 0.38, -0.02), part(box(0.18, 0.18, 0.1), em, -0.22, 0.38, -0.02));
    } else if (o.ears === 'cat') {
      // Hada-Gato: orejas de gato triangulares
      for (const sx of [1, -1]) {
        const e = part(geo('catear', () => new THREE.ConeGeometry(0.12, 0.26, 4)), skin, 0.18 * sx, 0.42, -0.02);
        e.rotation.y = Math.PI / 4;
        head.add(e);
      }
    }
    if (o.snout) {
      // Hocico de oso o de lagarto
      head.add(part(box(0.3, 0.2, 0.18), mat(o.snout), 0, -0.1, 0.35));
      head.add(part(box(0.12, 0.07, 0.04), mat(0x1a1410), 0, -0.03, 0.45));
    }
    if (o.crest) {
      // Cresta dracónica
      const cm = mat(o.crest);
      for (let i = 0; i < 3; i++) head.add(part(box(0.07, 0.18 - i * 0.03, 0.14), cm, 0, 0.36 - i * 0.04, -0.04 - i * 0.14));
    }
    if (o.goggles) {
      // Gnomo: gafas de ingeniero sobre la frente
      const gm = mat(o.goggles, { metalness: 0.4, roughness: 0.3 });
      head.add(part(box(0.17, 0.13, 0.06), gm, 0.12, 0.17, 0.31), part(box(0.17, 0.13, 0.06), gm, -0.12, 0.17, 0.31));
      head.add(part(box(0.62, 0.05, 0.62), mat(0x3a2a1c), 0, 0.17, 0));
    }
    if (o.cape) rig.add(part(box(0.74, 1.15, 0.06), mat(o.cape), 0, 1.33, -0.27));
    if (o.treeKing) {
      // Rey Tronco: copa de hojas como corona y ramas en los hombros
      const leaf = mat(o.crown);
      head.add(part(geo('crown', () => new THREE.IcosahedronGeometry(0.75, 0)), leaf, 0, 0.55, 0));
      for (const sx of [1, -1]) {
        const br = part(box(0.14, 0.7, 0.14), body, sx * 0.55, 2.15, -0.05);
        br.rotation.z = sx * -0.6;
        rig.add(br);
        rig.add(part(geo('leafball', () => new THREE.IcosahedronGeometry(0.38, 0)), leaf, sx * 0.85, 2.5, -0.05));
      }
    }
    if (o.robot) {
      // Mega-Autómata: casco cuadrado, antena y engranaje en el pecho
      head.add(part(box(0.72, 0.62, 0.66), body, 0, 0.05, 0));
      head.add(part(box(0.06, 0.4, 0.06), mat(0x8a8f9a), 0, 0.55, 0));
      head.add(part(sphere(0.1), mat(o.glow, { emissive: o.glow, emissiveIntensity: 0.6 }), 0, 0.8, 0));
      rig.add(part(geo('gear', () => new THREE.CylinderGeometry(0.3, 0.3, 0.08, 8)), mat(0xd9b25f, { metalness: 0.4 }), 0, 1.5, 0.27).rotateX(Math.PI / 2));
    }
    if (o.halo) {
      // Gran Guardián: aureola y alas de luz
      const hal = part(geo('halo', () => new THREE.TorusGeometry(0.38, 0.05, 6, 20)), mat(0xffe9a0, { emissive: 0xffd36b, emissiveIntensity: 0.6 }), 0, 0.62, 0);
      hal.rotation.x = Math.PI / 2;
      head.add(hal);
      const wm = mat(0xffffff, { transparent: true, opacity: 0.8 });
      for (const sx of [1, -1]) {
        const w = part(box(1, 1.3, 0.05), wm, sx * 0.75, 1.75, -0.35);
        w.rotation.set(0.1, sx * -0.4, sx * 0.25);
        rig.add(w);
      }
    }
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
    const s = o.scale || 1;
    rig.scale.setScalar(s);
    const m = { kind: 'hum', root, rig, head, lArm, rArm, lLeg, rLeg, weapon: null, weaponType: null, bladeMat: null, torsoMat: body, baseBody: o.body, fem, hasCape: !!o.cape, height: 2.5 * s };
    if (wt) makeWeapon(m, WEAPON_SHAPE[wt] || 'sword', o.weaponColor);
    return m;
  }

  function buildQuadruped(o) {
    const root = new THREE.Group();
    const rig = new THREE.Group();
    root.add(rig);
    const c = mat(o.color);
    const d = mat(new THREE.Color(o.color).multiplyScalar(0.62));
    const black = mat(0x15110d);

    rig.add(part(box(o.wool ? 0.9 : 0.72, o.wool ? 0.8 : 0.62, 1.35), c, 0, 0.88, 0));
    if (o.mane) rig.add(part(box(0.5, 0.2, 0.9), o.maneColor ? mat(o.maneColor, { emissive: o.maneColor, emissiveIntensity: 0.3 }) : d, 0, 1.25, 0.15));
    const head = new THREE.Group();
    head.position.set(0, 1.02, 0.72);
    rig.add(head);
    const hm = o.head ? mat(o.head) : c;
    head.add(part(box(0.5, 0.46, 0.52), hm, 0, 0, 0.2));
    head.add(part(box(0.3, 0.26, 0.34), o.head ? hm : d, 0, -0.08, 0.58));
    if (o.beak) head.add(part(box(0.16, 0.14, 0.24), mat(0xf2b13a), 0, -0.05, 0.62));
    if (o.dragon) {
      // Ignis: cuernos, púas en el lomo y alas grandes
      const horn = mat(0xece3c8);
      head.add(part(box(0.09, 0.32, 0.09), horn, 0.16, 0.38, 0.02), part(box(0.09, 0.32, 0.09), horn, -0.16, 0.38, 0.02));
      for (let i = 0; i < 4; i++) rig.add(part(box(0.1, 0.22, 0.14), d, 0, 1.3, 0.45 - i * 0.32));
    }
    if (o.wings || o.dragon) {
      const wm = mat(o.dragon ? 0x8a2a1a : 0xe8dcc2);
      for (const sx of [1, -1]) {
        const w = part(box(o.dragon ? 1.6 : 1, 0.05, 0.7), wm, sx * (o.dragon ? 1.1 : 0.8), 1.25, 0.05);
        w.rotation.z = sx * 0.35;
        rig.add(w);
      }
    }
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
    const tail = part(box(o.tail ? 0.16 : 0.1, o.tail ? 0.14 : 0.1, o.tail ? 0.9 : 0.4), d, 0, o.tail ? 0.85 : 1.0, o.tail ? -1.05 : -0.8);
    tail.rotation.x = o.tail ? 0.25 : 0.5;
    rig.add(tail);

    const s = o.scale || 1;
    rig.scale.setScalar(s);
    return { kind: 'quad', root, rig, head, legs, height: 1.5 * s };
  }

  // Monstruos de bloques simples (kind 'blob'): se mueven saltando o flotando
  function buildBlob(o) {
    const root = new THREE.Group();
    const rig = new THREE.Group();
    root.add(rig);
    const c = mat(o.color);
    const black = mat(0x15110d);
    const head = new THREE.Group();
    rig.add(head);
    const wings = [];
    let fly = 0;
    const eyes = (y, z, gap = 0.12, m = black) => head.add(part(box(0.08, 0.08, 0.04), m, gap, y, z), part(box(0.08, 0.08, 0.04), m, -gap, y, z));
    if (o.kind === 'mush') {
      rig.add(part(box(0.5, 0.6, 0.5), mat(o.body), 0, 0.3, 0));
      head.add(part(geo('mushcap', () => new THREE.CylinderGeometry(0.2, 0.62, 0.4, 8)), c, 0, 0.8, 0));
      head.add(part(box(0.12, 0.12, 0.04), mat(0xffffff), 0.25, 0.92, 0.42), part(box(0.1, 0.1, 0.04), mat(0xffffff), -0.2, 0.86, 0.45));
      eyes(0.42, 0.26);
    } else if (o.kind === 'crab') {
      rig.add(part(box(0.9, 0.35, 0.6), c, 0, 0.35, 0));
      for (const sx of [1, -1]) {
        head.add(part(box(0.28, 0.2, 0.3), c, sx * 0.62, 0.42, 0.42));
        for (let i = 0; i < 3; i++) rig.add(part(box(0.06, 0.25, 0.06), mat(new THREE.Color(o.color).multiplyScalar(0.7)), sx * 0.5, 0.15, -0.2 + i * 0.2));
      }
      head.add(part(box(0.06, 0.2, 0.06), black, 0.12, 0.62, 0.22), part(box(0.06, 0.2, 0.06), black, -0.12, 0.62, 0.22));
    } else if (o.kind === 'bug') {
      fly = 1.1;
      const stripe = mat(o.stripe);
      rig.add(part(box(0.45, 0.45, 0.4), c, 0, 0.5, 0.2), part(box(0.47, 0.47, 0.18), stripe, 0, 0.5, -0.05), part(box(0.4, 0.4, 0.35), c, 0, 0.5, -0.3));
      rig.add(part(geo('sting', () => new THREE.ConeGeometry(0.08, 0.3, 4)), stripe, 0, 0.5, -0.58).rotateX(-Math.PI / 2));
      eyes(0.55, 0.42, 0.12);
      const wm = mat(0xe8f0ff, { transparent: true, opacity: 0.6 });
      for (const sx of [1, -1]) {
        const g = new THREE.Group();
        g.position.set(sx * 0.2, 0.75, 0.05);
        g.add(part(box(0.5, 0.03, 0.3), wm, sx * 0.25, 0, 0));
        rig.add(g);
        wings.push(g);
      }
    } else if (o.kind === 'bat') {
      fly = 1.4;
      rig.add(part(box(0.4, 0.5, 0.35), c, 0, 0.5, 0));
      eyes(0.6, 0.18, 0.1, mat(o.glow, { emissive: o.glow, emissiveIntensity: 0.6 }));
      head.add(part(geo('batear', () => new THREE.ConeGeometry(0.08, 0.2, 4)), c, 0.12, 0.85, 0), part(geo('batear', () => new THREE.ConeGeometry(0.08, 0.2, 4)), c, -0.12, 0.85, 0));
      const wm = mat(o.glow, { transparent: true, opacity: 0.75, emissive: o.glow, emissiveIntensity: 0.2 });
      for (const sx of [1, -1]) {
        const g = new THREE.Group();
        g.position.set(sx * 0.2, 0.6, 0);
        g.add(part(box(0.8, 0.04, 0.45), wm, sx * 0.4, 0, 0));
        rig.add(g);
        wings.push(g);
      }
    } else if (o.kind === 'slime') {
      rig.add(part(box(0.9, 0.8, 0.9), mat(o.color, { transparent: true, opacity: 0.8, roughness: 0.2 }), 0, 0.4, 0));
      rig.add(part(box(0.4, 0.4, 0.4), mat(new THREE.Color(o.color).multiplyScalar(0.6)), 0, 0.35, 0));
      eyes(0.55, 0.46, 0.18);
    } else if (o.kind === 'orb') {
      fly = 1;
      const star = mat(o.color, { emissive: o.color, emissiveIntensity: 0.55 });
      rig.add(part(geo('starcore', () => new THREE.OctahedronGeometry(0.5, 0)), star, 0, 0.9, 0));
      for (let i = 0; i < 4; i++) {
        const g = new THREE.Group();
        g.position.y = 0.9;
        g.rotation.y = (i * Math.PI) / 2;
        g.add(part(geo('starpt', () => new THREE.ConeGeometry(0.14, 0.5, 4)), star, 0, 0, 0.6).rotateX(Math.PI / 2));
        rig.add(g);
        wings.push(g);
      }
      eyes(0.95, 0.42, 0.12);
    }
    const s = o.scale || 1;
    rig.scale.setScalar(s);
    return { kind: 'blob', form: o.kind, root, rig, head, wings, fly, height: (o.h || 1.2) * s };
  }

  // Elige el modelo según la forma del monstruo
  function buildMob(def) {
    if (def.kind === 'quad') return buildQuadruped(def);
    if (def.kind === 'hum') return buildHumanoid(def);
    return buildBlob(def);
  }

  // Mascotas y monturas de bloques. form: 'pet' (pequeña), 'mount' (terrestre) o 'glider' (con alas grandes)
  const PET_LOOK = {
    perro: { color: 0xd9a066, mount: 0x8a8f9a, glider: 0xb9c4d2, wing: 0xe8f0ff },
    dragon: { color: 0x5ab06a, mount: 0x3f8a4a, glider: 0x4a9ad0, wing: 0xb6e08a, horns: true },
    buho: { color: 0xa08060, mount: 0xc9a46a, glider: 0xd9b25f, wing: 0x8a6a46, beak: true },
  };
  function buildPet(type, form = 'pet') {
    const L = PET_LOOK[type] || PET_LOOK.perro;
    const scale = form === 'pet' ? (type === 'buho' ? 0.38 : 0.45) : form === 'mount' ? 1.4 : 1.5;
    const m = buildQuadruped({ color: form === 'pet' ? L.color : form === 'mount' ? L.mount : L.glider, scale, mane: form !== 'pet' && type === 'perro' });
    const dark = mat(new THREE.Color(form === 'pet' ? L.color : L.mount).multiplyScalar(0.55));
    if (L.horns) {
      m.head.add(part(box(0.08, 0.26, 0.08), mat(0xece3c8), 0.15, 0.36, 0.05));
      m.head.add(part(box(0.08, 0.26, 0.08), mat(0xece3c8), -0.15, 0.36, 0.05));
      // Púas en el lomo
      for (let i = 0; i < 3; i++) m.rig.add(part(box(0.1, 0.18, 0.12), dark, 0, 1.28, 0.35 - i * 0.35));
    }
    if (L.beak) m.head.add(part(box(0.14, 0.12, 0.18), mat(0xf2b13a), 0, -0.05, 0.6));
    // Alas: pequeñas en el dragón y el búho; grandes en la planeadora
    if (form === 'glider' || type !== 'perro') {
      const big = form === 'glider';
      const wm = mat(L.wing, big ? { transparent: true, opacity: 0.85 } : {});
      const wings = [];
      for (const sx of [1, -1]) {
        const g = new THREE.Group();
        g.position.set(0.36 * sx, 1.12, 0.1);
        g.add(part(box(big ? 1.5 : 0.55, 0.05, big ? 0.8 : 0.4), wm, (big ? 0.75 : 0.28) * sx, 0, 0));
        m.rig.add(g);
        wings.push(g);
      }
      m.wings = wings;
    }
    // Silla de montar
    if (form !== 'pet') m.rig.add(part(box(0.66, 0.12, 0.6), mat(0x7a2630), 0, 1.25, 0));
    m.saddle = form === 'pet' ? 0 : 1.25 * scale + 0.05;
    m.form = form;
    m.petType = type;
    return m;
  }

  function animateModel(m, t, walk, atk, swim = 0) {
    const swing = atk > 0 ? Math.sin(Math.PI * (1 - atk)) : 0;
    if (m.kind === 'blob') {
      // Saltitos al moverse; los voladores flotan y aletean; al atacar se lanzan hacia adelante
      if (m.fly) {
        m.rig.position.y = m.fly + Math.sin(t * 3) * 0.15;
        for (const [i, w] of m.wings.entries()) {
          if (m.form === 'orb') w.rotation.y = (i * Math.PI) / 2 + t * 2;
          else w.rotation.z = (i ? -1 : 1) * Math.sin(t * 22) * 0.7;
        }
      } else {
        m.rig.position.y = Math.abs(Math.sin(t * 7)) * 0.35 * walk;
        m.rig.scale.y = m.rig.scale.x * (1 - Math.abs(Math.sin(t * 7)) * 0.12 * walk);
      }
      m.rig.position.z = swing * 0.4;
      return;
    }
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
    if (m.floatBook) {
      m.floatBook.position.y = 1.55 + Math.sin(t * 2) * 0.08 + swing * 0.25;
      m.floatBook.rotation.y = 0.3 + Math.sin(t * 1.3) * 0.15;
    }
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

  // Color del arma por grado (sin brillos fuertes: el resplandor se limita para no causar destellos)
  function setWeaponLook(m, item) {
    if (item && item.weaponType && m.lArm) {
      const shape = WEAPON_SHAPE[item.weaponType] || 'sword';
      if (shape !== m.weaponShape) makeWeapon(m, shape);
    }
    for (const g of m.weaponParts || []) g.visible = !!item;
    if (!m.weapon) return;
    m.weapon.visible = !!item;
    m.weaponGrade = item ? item.grade || null : null;
    syncRainbow(m);
    if (!item || !m.bladeMat) return;
    const table = LOOKS[m.weaponType] || LOOKS.sword;
    const [c, e, i] = table[item.grade || item.rarity] || table.madera;
    m.bladeMat.color.setHex(c);
    if (m.bladeMat.emissive) {
      m.bladeMat.emissive.setHex(e);
      m.bladeMat.emissiveIntensity = Math.min(0.55, i * 0.5);
    }
  }

  // ---------- Armaduras: piezas según grado y tipo ----------
  const GRADE_IDX = { madera: 0, cobre: 1, azul: 2, morado: 3, dorado: 4, arcoiris: 5 };
  const TRIM = { madera: 0x6b4a2e, cobre: 0xc8844a, azul: 0x5d8fd8, morado: 0x8a55c8, dorado: 0xe0b040, arcoiris: 0xffffff };
  const GEM = { azul: 0x7fd0ff, morado: 0xd09bff, dorado: 0xffd27a, arcoiris: 0xffffff };

  function setArmorLook(m, item) {
    if (m.torsoMat) m.torsoMat.color.setHex(item ? item.look : m.baseBody);
    for (const g of m.armorParts || []) if (g.parent) g.parent.remove(g);
    m.armorParts = [];
    m.armorRainbow = [];
    m.armorGrade = item ? item.grade || null : null;
    if (!item || !m.lArm || !item.grade) return syncRainbow(m);
    const gi = GRADE_IDX[item.grade];
    const type = item.armorType;
    const robe = type === 'CLOTH_ROBE' || type === 'SACRED_ROBE';
    const heavy = type === 'HEAVY_PLATE';
    const metal = gi >= 2 && !robe;
    const trim = mat(TRIM[item.grade], { metalness: metal ? 0.3 : 0.05, roughness: metal ? 0.5 : 0.8 });
    const add = (parent, mesh) => {
      parent.add(mesh);
      m.armorParts.push(mesh);
      return mesh;
    };
    const fem = m.fem;
    const tw = fem ? 0.66 : 0.8;
    const td = fem ? 0.4 : 0.46;
    // Cobre en adelante: cinturón y brazaletes
    if (gi >= 1) {
      add(m.rig, part(box(tw + 0.06, 0.13, td + 0.06), trim, 0, 1.0, 0));
      for (const arm of [m.lArm, m.rArm]) add(arm, part(box(0.27, 0.14, 0.27), trim, 0, -0.6, 0));
    }
    // Cristal Azul en adelante: hombreras (o cuello en las túnicas) y gema en el pecho
    if (gi >= 2) {
      if (robe) add(m.rig, part(box(tw + 0.14, 0.12, td + 0.08), trim, 0, 1.92, 0));
      else {
        const sz = (heavy ? 0.36 : type === 'LIGHT_LEATHER' ? 0.26 : 0.3) + (gi - 2) * 0.05;
        for (const [arm, sx] of [[m.lArm, -1], [m.rArm, 1]]) add(arm, part(box(sz, sz * 0.55, sz), trim, sx * 0.04, 0.1, 0));
      }
      const gem = mat(GEM[item.grade], { emissive: GEM[item.grade], emissiveIntensity: gi >= 4 ? 0.35 : 0.2 });
      add(m.rig, part(box(0.14, 0.14, 0.06), gem, 0, 1.62, td / 2 + 0.02));
      if (item.grade === 'arcoiris') m.armorRainbow.push(gem);
    }
    // Oro Morado en adelante: franja decorada en el pecho
    if (gi >= 3) add(m.rig, part(box(0.12, 0.8, 0.02), trim, 0, 1.4, td / 2 + 0.01));
    // Diamante Dorado en adelante: capa (si el personaje no trae una propia)
    if (gi >= 4 && !m.hasCape) {
      const capeM = mat(item.grade === 'arcoiris' ? 0xffffff : 0xb03a2a, { side: THREE.DoubleSide });
      add(m.rig, part(box(tw - 0.04, 1.25, 0.05), capeM, 0, 1.3, -td / 2 - 0.04));
      if (item.grade === 'arcoiris') m.armorRainbow.push(capeM);
    }
    // Arcoíris: casco épico (armaduras pesada y media) o corona (las demás)
    if (gi >= 5 && m.head) {
      if (heavy || type === 'MEDIUM_SCALE') {
        add(m.head, part(box(0.68, 0.24, 0.68), trim, 0, 0.3, 0));
        add(m.head, part(box(0.08, 0.3, 0.5), trim, 0, 0.52, -0.02));
      } else {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          add(m.head, part(box(0.1, 0.18, 0.1), trim, Math.sin(a) * 0.26, 0.4, Math.cos(a) * 0.26));
        }
      }
      m.armorRainbow.push(trim);
    } else if (item.grade === 'arcoiris') m.armorRainbow.push(trim);
    syncRainbow(m);
  }

  // Materiales que cambian de color en arcoíris (armas y armaduras de grado Arcoíris)
  function syncRainbow(m) {
    m.rainbowMats = [...(m.armorRainbow || [])];
    if (m.weaponGrade === 'arcoiris' && m.bladeMat) m.rainbowMats.push(m.bladeMat);
  }

  V.Models = { mat, buildHumanoid, buildQuadruped, buildBlob, buildMob, buildPet, animateModel, animateDeath, setWeaponLook, setArmorLook, syncRainbow, ARMOR_STYLE: { GRADE_IDX, TRIM, GEM } };
})();
