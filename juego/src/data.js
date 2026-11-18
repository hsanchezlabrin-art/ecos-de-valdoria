// Datos del juego: razas (arquetipos), habilidades, grados de equipo, zonas, monstruos,
// objetos, NPCs, progresión y fórmulas. Todo el contenido vive aquí. La web de guías lee
// este mismo archivo, así que lo que cambies aquí se refleja en la guía automáticamente.
// Funciona en el navegador (V.Data) y en Node (require): el servidor usa exactamente las
// mismas reglas.
//
// Modelo (v0.7):
//   · 5 razas jugables (ArchetypeID: oso, elfo, gnomo, hada, lagarto). Cada una reutiliza
//     una forma de combate: cuerpo a cuerpo (oso, lagarto), a distancia (elfo) o magia
//     (gnomo, hada).
//   · Etapas de clase (stage): 0 base · 1 Despertar (nv 10) · 2 Especialización (nv 25,
//     rama A o B) · 3 Ascensión Maestra (nv 40). Cada cambio exige nivel + misión.
//   · Grados de equipo (EquipmentGrade) con nivel y etapa mínimos. Cada raza solo usa su
//     tipo de armadura y sus tipos de arma.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const V = (globalThis.V = globalThis.V || {});
    V.Data = factory();
  }
})(function () {
  const MAX_LEVEL = 50;
  const xpToNext = (lvl) => Math.floor(42 * Math.pow(lvl, 1.85) + 18);
  const CRIT_MULT = 1.8;
  const MOVE_SPEED = 7.2;
  const SEXES = { m: 'Hombre', f: 'Mujer' };

  // ---------- Grados de equipo (ADN Lineage 2) ----------

  const EquipmentGrade = {
    GRADE_WOOD: 'madera',
    GRADE_COPPER: 'cobre',
    GRADE_BLUE_CRYSTAL: 'azul',
    GRADE_PURPLE_GOLD: 'morado',
    GRADE_GOLD_DIAMOND: 'dorado',
    GRADE_RAINBOW_CELESTIAL: 'arcoiris',
  };
  // lvl: nivel mínimo · stage: cambio de clase necesario · look: color de armadura
  const GRADES = {
    madera: { id: 'GRADE_WOOD', name: 'Madera', color: '#b9b2a4', lvl: 1, stage: 0, atk: 4, def: 3, hp: 15, price: 30, look: 0x8a6a46 },
    cobre: { id: 'GRADE_COPPER', name: 'Cobre', color: '#8fd37a', lvl: 5, stage: 0, atk: 10, def: 7, hp: 40, price: 140, look: 0xb5703f },
    azul: { id: 'GRADE_BLUE_CRYSTAL', name: 'Cristal Azul', color: '#74aaff', lvl: 10, stage: 1, atk: 20, def: 14, hp: 90, price: 520, look: 0x5d8fd8 },
    morado: { id: 'GRADE_PURPLE_GOLD', name: 'Oro Morado', color: '#c895ff', lvl: 20, stage: 1, atk: 34, def: 22, hp: 150, price: 1500, look: 0x8a55c8 },
    dorado: { id: 'GRADE_GOLD_DIAMOND', name: 'Diamante Dorado', color: '#ffc44d', lvl: 25, stage: 2, atk: 52, def: 32, hp: 230, price: 3800, look: 0xe0b040 },
    arcoiris: { id: 'GRADE_RAINBOW_CELESTIAL', name: 'Arcoíris Celestial', color: '#ff8adf', lvl: 40, stage: 3, atk: 80, def: 46, hp: 340, price: 9500, look: 0xf0e0ff, rainbow: true },
  };
  const GRADE_ORDER = ['madera', 'cobre', 'azul', 'morado', 'dorado', 'arcoiris'];
  const gradeIndex = (g) => GRADE_ORDER.indexOf(g);

  // Colores de rareza (los grados más los objetos sin grado)
  const RARITY = {
    comun: { name: 'Común', color: '#cfc6b2' },
    refinado: { name: 'Refinado', color: '#8fd37a' },
  };
  for (const [k, g] of Object.entries(GRADES)) RARITY[k] = { name: `Grado ${g.name}`, color: g.color, grade: true };

  // ---------- Tipos de armadura y arma ----------

  const ARMOR_TYPES = {
    HEAVY_PLATE: { key: 'heavy', name: 'Pesada', def: 1.3, hp: 1.3, mp: 0 },
    MEDIUM_SCALE: { key: 'medium', name: 'Media', def: 1.05, hp: 1.05, mp: 0 },
    LIGHT_LEATHER: { key: 'light', name: 'Ligera', def: 0.8, hp: 0.85, mp: 0, evade: 0.03 },
    CLOTH_ROBE: { key: 'cloth', name: 'Tela', def: 0.6, hp: 0.65, mp: 0.5 },
    SACRED_ROBE: { key: 'sacred', name: 'Sagrada', def: 0.65, hp: 0.7, mp: 0.45, heal: 0.05 },
  };
  // model: forma 3D del arma (sword, hammer, bow, staff)
  const WEAPON_TYPES = {
    hammer: { name: 'Martillo', model: 'hammer', glyph: '⚒' },
    mace: { name: 'Maza', model: 'hammer', glyph: '⚒' },
    hammer2h: { name: 'Martillo a dos manos', model: 'hammer', glyph: '⚒', twoHanded: true },
    longsword: { name: 'Espada larga', model: 'sword', glyph: '†' },
    dualswords: { name: 'Espadas dobles', model: 'sword', glyph: '⚔' },
    spear: { name: 'Lanza', model: 'sword', glyph: '↟' },
    bow: { name: 'Arco', model: 'bow', glyph: '➶' },
    crossbow: { name: 'Ballesta', model: 'bow', glyph: '➶' },
    daggers: { name: 'Dagas dobles', model: 'sword', glyph: '⚔' },
    crystalstaff: { name: 'Báculo de cristal', model: 'staff', glyph: '⚚' },
    wand: { name: 'Varita mecánica', model: 'staff', glyph: '⚚' },
    launcher: { name: 'Lanzapociones', model: 'staff', glyph: '⚗' },
    book: { name: 'Libro flotante', model: 'staff', glyph: '❦' },
    bell: { name: 'Campana mágica', model: 'staff', glyph: '♫' },
    scepter: { name: 'Cetro estrella', model: 'staff', glyph: '✦' },
  };

  // ---------- Mascotas y monturas ----------
  // La mascota nace del huevo (nivel 5), crece a montura terrestre (nivel 20) y a montura
  // planeadora con la Ascensión Maestra (nivel 40). La planeadora cruza el agua sin nadar.
  const PET_LVL = 5;
  const MOUNT_LVL = 20;
  const GLIDER_LVL = 40;
  const MOUNT_SPEED = { 1: 0.6, 2: 1.0 }; // +60% terrestre, +100% planeadora
  const PET_FETCH_R = 14; // distancia a la que la mascota va a buscar el botín
  const PETS = {
    perro: { name: 'Cubo-Perro', glyph: '🐶', color: 0xd9a066, mount: 'Lobo de Bloques', glider: 'Lobo Alado', desc: 'Leal y juguetón. Mueve la cola cuando encuentra botín.' },
    dragon: { name: 'Dragoncito', glyph: '🐲', color: 0x5ab06a, mount: 'Dragón Corredor', glider: 'Dragón Celeste', desc: 'Pequeño y valiente. Suelta chispitas cuando está feliz.' },
    buho: { name: 'Búho Cúbico', glyph: '🦉', color: 0xa08060, mount: 'Grifo Terrestre', glider: 'Grifo Planeador', desc: 'Lo ve todo desde arriba y nunca pierde un objeto.' },
  };
  const isPet = (t) => typeof t === 'string' && Object.prototype.hasOwnProperty.call(PETS, t);
  // 0: sin montura · 1: terrestre · 2: planeadora
  const mountKind = (p) => (!p.pet ? 0 : p.level >= GLIDER_LVL && (p.stage || 0) >= 3 ? 2 : p.level >= MOUNT_LVL ? 1 : 0);
  const petName = (type, kind = 0) => (isPet(type) ? (kind === 2 ? PETS[type].glider : kind === 1 ? PETS[type].mount : PETS[type].name) : '');

  // ---------- Razas (arquetipos) ----------
  // base: [valor en nivel 1, aumento por nivel]
  // combat: forma de combate heredada (melee = antiguo Guerrero, ranged = Arquero, magic = Mago)
  // skills: 3 de nivel 1 + 2 del Despertar (nivel 10). branches: ramas del nivel 25 y 40.
  //
  // Tipos de habilidad (los resuelve sim.js):
  //   dmg (a un objetivo; proj, dot, stun, root, hits, critIfBurning, knock, healAlly)
  //   area (sobre el objetivo; radius, delay, slow, stun, count/spread, healAllies, dot)
  //   aoe (a tu alrededor; taunt, allyShield, stun, slow) · cone (frente; dot) · line (en línea)
  //   chain (rebota) · charge (embestida) · leap (salto atrás, con disparo) · blink (adelante)
  //   buff (a ti o al grupo: atk, crit, speed, haste, dr, evade, thorns, cdr, ccImmune)
  //   heal (a ti o al grupo: amount, shield, cleanse, revive) · bubble (bloquea el siguiente golpe)
  //   mark (el objetivo recibe más daño) · zone (charco o rastro en el suelo)
  //   turret (torreta o autómata) · poly (polimorfia) · pulse (golpes repetidos a tu alrededor)
  //   dance (cortes saltando entre enemigos)
  const ARCHETYPES = {
    oso: {
      name: 'Oso Pardo',
      names: { m: 'Oso Pardo', f: 'Osa Parda' },
      short: { m: 'Oso', f: 'Osa' },
      glyph: '🐻',
      combat: 'melee',
      role: 'Tanque · Guardián',
      desc: 'Un oso enorme con armadura pesada. Protege a sus amigos, atrae a los monstruos y aguanta golpes que nadie más soporta.',
      crit: 0.06,
      base: { hp: [96, 26], mp: [40, 9], atk: [7, 2.7], def: [3, 1.8] },
      range: 2.5,
      atkSpeed: 1.15,
      projectile: null,
      mpRegen: 1,
      armorType: 'HEAVY_PLATE',
      weaponTypes: ['hammer', 'mace', 'hammer2h'],
      look: { skin: 0x8a5a34, body: 0x6f7a86, legs: 0x4a3524, hair: 0x6b4426, ears: 'round', snout: 0x6b4426, tail: 'stub', scale: 1.12, weaponType: 'hammer' },
      lookF: { skin: 0xa0703f, hair: 0x7d5030 },
      awaken: 'Oso Guardián',
      skills: [
        { id: 'rugido', name: 'Rugido Protector', glyph: '◉', type: 'aoe', mult: 0.6, radius: 6, taunt: true, allyShield: 0.15, shieldDur: 6, mp: 12, cd: 10, desc: 'Ruges fuerte: los monstruos cercanos te atacan a ti y tus aliados cercanos reciben un escudo.' },
        { id: 'salto_sismico', name: 'Salto Sísmico', glyph: '✸', type: 'aoe', mult: 1.6, radius: 4.5, stun: 1.5, mp: 16, cd: 9, desc: 'Saltas y caes con fuerza: 160% de daño alrededor y aturdes a los enemigos 1,5 s.' },
        { id: 'muro_miel', name: 'Muro de Miel', glyph: '◍', type: 'zone', radius: 4, dur: 6, slow: true, tick: 0.3, fx: 0xf2b13a, mp: 14, cd: 14, desc: 'Un charco de miel pegajosa: ralentiza y daña poco a poco a los enemigos que lo pisan durante 6 s.' },
        { id: 'piel_corteza', name: 'Piel de Corteza', glyph: '▦', type: 'buff', aura: 'bark', dr: 0.3, dur: 6, mp: 15, cd: 20, desc: 'Tu piel se vuelve corteza: recibes un 30% menos de daño durante 6 s.' },
        { id: 'tronco', name: 'Lanzamiento de Tronco', glyph: '▬', type: 'line', mult: 2, length: 14, width: 2, stun: 1.2, mp: 20, cd: 11, desc: 'Arrojas un tronco cuadrado en línea recta: 200% de daño y derriba a los enemigos 1,2 s.' },
      ],
      branches: {
        a: {
          name: 'Guardián de Roca',
          master: 'Titán de Piedra Viva',
          passive: { name: 'Corazón de Roca', hpPct: 0.25, block: 0.2, desc: '+25% de vida máxima y 20% de probabilidad de bloquear la mitad de un golpe con el escudo.' },
          ultimate: { id: 'fortaleza', name: 'Fortaleza Cubo', glyph: '⛫', type: 'heal', group: true, radius: 10, amount: 0, shield: 0.5, shieldDur: 6, dome: { dr: 0.5 }, mp: 45, cd: 60, desc: 'Una cúpula de piedra cubre al grupo durante 6 s: cada aliado recibe un escudo enorme y, dentro de la cúpula, la mitad de daño (también de proyectiles).' },
          masterUlt: { name: 'Fortaleza Cubo Maestra', amount: 0.35, thorns: 0.6, dome: { dr: 0.5, heal: 0.04 }, desc: 'La cúpula también cura al grupo (35% al instante y un 4% por segundo dentro) y devuelve daño a quien golpea.' },
        },
        b: {
          name: 'Oso Berserker',
          master: 'Coloso Tronador',
          passive: { name: 'Furia Creciente', twoHanded: true, frenzy: 0.05, desc: 'Puede usar martillos a dos manos. Cada golpe acelera tus ataques un 5% (hasta 5 veces).' },
          ultimate: { id: 'terremoto', name: 'Terremoto Estelar', glyph: '✺', type: 'pulse', mult: 2.2, radius: 7, count: 3, every: 0.5, stun: 0.6, mp: 45, cd: 45, desc: 'Golpeas el suelo 3 veces: ondas expansivas de 220% de daño cada una.' },
          masterUlt: { name: 'Terremoto Estelar Maestro', lightning: 1.2, desc: 'Además caen rayos sobre los enemigos golpeados.' },
        },
      },
    },
    elfo: {
      name: 'Elfo del Bosque Cubo',
      names: { m: 'Elfo del Bosque Cubo', f: 'Elfa del Bosque Cubo' },
      short: { m: 'Elfo', f: 'Elfa' },
      glyph: '🏹',
      combat: 'ranged',
      role: 'Explorador · Arquero',
      desc: 'Rápido y certero. Ataca desde lejos con su arco, marca a los enemigos y escapa de un salto cuando se acercan.',
      crit: 0.14,
      base: { hp: [66, 17], mp: [45, 11], atk: [8, 3.05], def: [1.5, 1.1] },
      range: 15,
      atkSpeed: 1.15,
      projectile: 'arrow',
      mpRegen: 1,
      armorType: 'LIGHT_LEATHER',
      weaponTypes: ['bow', 'crossbow', 'daggers'],
      look: { skin: 0xf0cfa8, body: 0x3f7a3a, legs: 0x4a3a28, hair: 0xd9b25f, ears: 'pointy', cape: 0x2f5a2a, weaponType: 'bow' },
      lookF: { hair: 0xe8c878 },
      awaken: 'Explorador del Bosque',
      skills: [
        { id: 'bellotas', name: 'Lluvia de Bellotas', glyph: '⇣', type: 'area', fx: 'acorn', mult: 1.4, radius: 4.5, delay: 0.5, mp: 12, cd: 8, range: 16, desc: 'Una lluvia de bellotas cae sobre el objetivo y todo lo que lo rodea: 140% de daño.' },
        { id: 'salto_copa', name: 'Salto de Copa', glyph: '↶', type: 'leap', dist: 7, shot: 1.2, knock: 3, mp: 12, cd: 10, desc: 'Saltas 7 m hacia atrás y disparas una flecha que empuja al objetivo.' },
        { id: 'halcon', name: 'Compañero Halcón', glyph: '🦅', type: 'mark', hawk: true, pct: 0.25, dur: 10, mp: 10, cd: 16, range: 22, desc: 'Tu halcón marca al objetivo: recibe un 25% más de daño de todo tu grupo durante 10 s.' },
        { id: 'enredadera', name: 'Flecha Enredadera', glyph: '❦', type: 'dmg', proj: 'arrow', mult: 1.3, root: 3, mp: 16, cd: 12, range: 16, desc: 'Raíces cúbicas atrapan al objetivo: 130% de daño y no puede moverse durante 3 s.' },
        { id: 'paso_veloz', name: 'Paso Veloz', glyph: '»', type: 'buff', aura: 'wind', speed: 0.35, evade: 0.25, dur: 8, mp: 14, cd: 20, desc: 'Corres como el viento: +35% de velocidad y +25% de esquivar durante 8 s.' },
      ],
      branches: {
        a: {
          name: 'Francotirador Solar',
          master: 'Centinela del Sol',
          passive: { name: 'Ojo del Sol', rangePct: 0.3, farCrit: 0.5, desc: '+30% de alcance. Tus críticos hacen hasta un 50% más de daño cuanto más lejos está el objetivo.' },
          ultimate: { id: 'rayo_solar', name: 'Rayo Solar', glyph: '☀', type: 'line', mult: 4.5, length: 28, width: 2.4, mp: 45, cd: 40, desc: 'Una flecha de luz gigante atraviesa a todos los enemigos en línea: 450% de daño.' },
          masterUlt: { name: 'Rayo Solar Maestro', trail: { dur: 5, tick: 0.5 }, allyBuff: { speed: 0.25, dur: 6 }, desc: 'Deja un rastro de luz que quema a los enemigos y acelera a tus aliados.' },
        },
        b: {
          name: 'Jinete del Viento',
          master: 'Sombra del Vendaval',
          passive: { name: 'Danza del Viento', moveAttack: true, speedPct: 0.1, desc: 'Puedes atacar mientras te mueves sin perder velocidad, y te mueves un 10% más rápido.' },
          ultimate: { id: 'tornado', name: 'Tornado de Hojas', glyph: '🌪', type: 'pulse', aura: 'tornado', mult: 0.9, radius: 4, count: 10, every: 0.4, selfBuff: { speed: 0.2, dur: 4 }, mp: 40, cd: 35, desc: 'Te conviertes en un torbellino que golpea rápido a tu alrededor mientras te mueves.' },
          masterUlt: { name: 'Tornado de Hojas Maestro', mult: 1.2, count: 15, clones: 2, selfBuff: { speed: 0.2, dur: 6 }, desc: 'Creas 2 clones de viento que giran a tu lado e imitan tus golpes durante 6 s.' },
        },
      },
    },
    gnomo: {
      name: 'Gnomo Ingeniero',
      names: { m: 'Gnomo Ingeniero', f: 'Gnoma Ingeniera' },
      short: { m: 'Gnomo', f: 'Gnoma' },
      glyph: '⚙',
      combat: 'magic',
      role: 'Mago elemental · Artificiero',
      desc: 'Pequeño e ingenioso. Lanza rayos de cristal, construye torretas y convierte a los monstruos en ovejas.',
      crit: 0.1,
      base: { hp: [56, 14], mp: [70, 18], atk: [9, 3.3], def: [1, 0.9] },
      range: 13,
      atkSpeed: 1.45,
      projectile: 'arcane',
      mpRegen: 1.5,
      armorType: 'CLOTH_ROBE',
      weaponTypes: ['crystalstaff', 'wand', 'launcher'],
      look: { skin: 0xe8b894, body: 0x8a5a2a, legs: 0x3a3f55, hair: 0xe6e0d6, beard: true, goggles: 0x6fb8d8, scale: 0.78, weaponType: 'staff' },
      lookF: { hair: 0xd8743a, beard: false },
      awaken: 'Artificiero de Cristal',
      skills: [
        { id: 'rayo_cristal', name: 'Rayo de Cristal', glyph: 'ϟ', type: 'chain', mult: 1.6, jumps: 2, jumpR: 8, mp: 10, cd: 4, range: 14, desc: 'Un rayo de cristal golpea al objetivo y rebota hasta 3 enemigos: 160% de daño a cada uno.' },
        { id: 'torreta', name: 'Torreta de Chispas', glyph: '⛯', type: 'turret', summon: 'turret', mult: 0.9, dur: 8, every: 1, reach: 12, mp: 16, cd: 14, desc: 'Construyes un tótem que dispara chispas al enemigo más cercano durante 8 s.' },
        { id: 'polimorfia', name: 'Polimorfia Divertida', glyph: '🐑', type: 'poly', dur: 5, mp: 18, cd: 18, range: 14, desc: 'Conviertes al objetivo en una oveja o un pollo cuadrado inofensivo durante 5 s. Se rompe si lo golpean. (No sirve con jefes.)' },
        { id: 'pegamento', name: 'Bomba de Pegamento', glyph: '⚗', type: 'area', fx: 'glue', mult: 1.5, radius: 4, delay: 0.45, slow: 4, mp: 18, cd: 10, range: 14, desc: 'Un frasco explota sobre el objetivo: 150% de daño en área y ralentiza 4 s.' },
        { id: 'propulsores', name: 'Propulsores de Mochila', glyph: '⇢', type: 'blink', dist: 8, mp: 12, cd: 12, desc: 'Tu mochila te lanza 8 m hacia adelante dejando una nube de humo.' },
      ],
      branches: {
        a: {
          name: 'Maestro de Cristales',
          master: 'Archimago Prismático',
          passive: { name: 'Resonancia Prismática', freeEvery: 3, desc: 'Cada 3 hechizos, el siguiente no cuesta maná y hace el doble de daño.' },
          ultimate: { id: 'meteoritos', name: 'Lluvia de Meteoritos Cubo', glyph: '☄', type: 'area', fx: 'meteor', mult: 2.8, radius: 3.5, count: 5, spread: 5, delay: 0.8, mp: 55, cd: 45, range: 16, desc: 'Caen 5 bloques de magma gigantes sobre un área amplia: 280% de daño cada uno.' },
          masterUlt: { name: 'Meteoritos Prismáticos', stun: 2, slow: 4, fx: 'frost', desc: 'Los meteoritos son de cristal prismático: además congelan y aturden 2 s.' },
        },
        b: {
          name: 'Inventor de Autómatas',
          master: 'Gran Mecánico Estelar',
          passive: { name: 'Taller Portátil', turretMax: 2, turretPct: 0.2, desc: 'Puedes tener 2 torretas o robots a la vez, y hacen un 20% más de daño.' },
          ultimate: { id: 'mecha', name: 'Invocar Mecha-Gólem', glyph: '🤖', type: 'turret', summon: 'mecha', mult: 2.2, dur: 15, every: 1.2, reach: 14, mp: 55, cd: 60, desc: 'Un robot gigante camina, pelea y atrae a los monstruos (los golpes van a él) durante 15 s: 220% de daño por golpe.' },
          masterUlt: { name: 'Mecha-Gólem Pilotado', ride: true, mult: 1.6, every: 0.8, reach: 18, selfShield: 0.6, dur: 15, desc: 'Te subes al Mecha-Gólem 15 s: ganas un gran escudo y sus cañones láser atraviesan a los enemigos en línea (160%).' },
        },
      },
    },
    hada: {
      name: 'Hada-Gato (Sylph)',
      names: { m: 'Hada-Gato (Sylph)', f: 'Hada-Gata (Sylph)' },
      short: { m: 'Hada-Gato', f: 'Hada-Gata' },
      glyph: '🐱',
      combat: 'magic',
      role: 'Sanador · Soporte',
      desc: 'Una gatita con alas de hada. Cura al grupo con canciones, protege con burbujas y hace a todos más rápidos.',
      crit: 0.08,
      base: { hp: [62, 16], mp: [80, 20], atk: [7.5, 2.8], def: [1.3, 1], heal: [1, 0] },
      range: 12,
      atkSpeed: 1.4,
      projectile: 'arcane',
      mpRegen: 1.7,
      armorType: 'SACRED_ROBE',
      weaponTypes: ['book', 'bell', 'scepter'],
      look: { skin: 0xf2e2d0, body: 0xb48ce0, legs: 0x8a6ac0, hair: 0xf6f0ff, ears: 'cat', tail: 'cat', wings: 0xbfe6ff, robe: true, scale: 0.92, weaponType: 'staff' },
      lookF: { hair: 0xffd6ec, body: 0xe0a0d0 },
      awaken: 'Tejedor de Estrellas',
      skills: [
        { id: 'corazones', name: 'Canción de Corazones', glyph: '♥', type: 'heal', group: true, radius: 9, amount: 0.25, mp: 16, cd: 8, desc: 'Cantas y curas al instante un 25% de vida a ti y a los aliados cercanos.' },
        { id: 'burbuja', name: 'Burbuja Estelar', glyph: '◯', type: 'bubble', dur: 10, reach: 16, mp: 14, cd: 14, desc: 'Una burbuja protege al aliado más herido (o a ti): bloquea por completo el siguiente golpe.' },
        { id: 'bendicion', name: 'Bendición de Velocidad', glyph: '»', type: 'buff', group: true, radius: 12, speed: 0.2, haste: 0.2, dur: 15, mp: 20, cd: 30, desc: 'Tú y tu grupo se mueven y atacan un 20% más rápido durante 15 s.' },
        { id: 'destello', name: 'Destello Purificador', glyph: '✧', type: 'heal', group: true, radius: 9, amount: 0.12, cleanse: true, mp: 14, cd: 12, desc: 'Quita veneno, quemaduras y lentitud a tu grupo (los causan lobos, orcos, gólems, sapos y Tharmok) y lo cura un poco.' },
        { id: 'ola_notas', name: 'Ola de Notas', glyph: '♫', type: 'dmg', proj: 'arcane', mult: 1.8, healAlly: 0.15, mp: 14, cd: 6, range: 14, desc: 'Una nota musical daña al enemigo (180%) y rebota hacia el aliado más herido para curarlo.' },
      ],
      branches: {
        a: {
          name: 'Oráculo Estelar',
          master: 'Emperador Celestial',
          passive: { name: 'Bendición del Oráculo', healPct: 0.3, partyMp: 0.5, desc: '+30% de curación y tu grupo cercano recupera maná un 50% más rápido.' },
          ultimate: { id: 'estrellas', name: 'Lluvia de Estrellas Sanadoras', glyph: '✶', type: 'heal', group: true, radius: 14, amount: 1, shield: 0.2, shieldDur: 8, mp: 60, cd: 75, desc: 'Restaura el 100% de la vida de todo el grupo cercano y le da un escudo extra.' },
          masterUlt: { name: 'Lluvia de Estrellas Maestra', revive: true, desc: 'Además revive al instante a los aliados caídos en el área.' },
        },
        b: {
          name: 'Bardo Melódico',
          master: 'Virtuoso Cósmico',
          passive: { name: 'Aura de Canción', aura: { atk: 0.1, speed: 0.1, radius: 10 }, desc: 'Tus canciones dejan un aura: tu grupo cercano tiene +10% de ataque y velocidad siempre.' },
          ultimate: { id: 'sinfonia', name: 'Sinfonía Heroica', glyph: '🎼', type: 'buff', group: true, radius: 14, atk: 0.4, speed: 0.4, haste: 0.4, cdr: 0.4, dur: 10, mp: 55, cd: 60, desc: 'Todo el grupo: +40% de daño y velocidad, y habilidades un 40% más rápidas durante 10 s.' },
          masterUlt: { name: 'Sinfonía Cósmica', danceStun: { radius: 9, dur: 4 }, desc: 'Además los enemigos cercanos se ponen a bailar sin poder atacar durante 4 s.' },
        },
      },
    },
    lagarto: {
      name: 'Caballero Lagarto',
      names: { m: 'Caballero Lagarto', f: 'Dama Lagarto' },
      short: { m: 'Lagarto', f: 'Lagarta' },
      glyph: '🦎',
      combat: 'melee',
      role: 'Luchador · Espadachín',
      desc: 'Un draconiano valiente con espada y escamas. Gira, escupe chispas y quema a los enemigos para golpes críticos.',
      crit: 0.1,
      base: { hp: [80, 22], mp: [42, 10], atk: [8.5, 3.1], def: [2, 1.4] },
      range: 2.4,
      atkSpeed: 1.0,
      projectile: null,
      mpRegen: 1,
      armorType: 'MEDIUM_SCALE',
      weaponTypes: ['longsword', 'dualswords', 'spear'],
      look: { skin: 0x5a9a4a, body: 0xb06a2a, legs: 0x3a3024, snout: 0x4a8a3c, crest: 0xd9602a, tail: 'lizard', cape: 0x8a2a1a, weaponType: 'sword' },
      lookF: { skin: 0x6aaa6a, crest: 0xe0a030 },
      awaken: 'Guerrero Escama de Fuego',
      skills: [
        { id: 'torbellino', name: 'Torbellino de Escamas', glyph: '❂', type: 'aoe', mult: 1.5, radius: 4.5, mp: 14, cd: 7, desc: 'Giras con tu espada: 150% de daño a todos los enemigos a tu alrededor.' },
        { id: 'aliento', name: 'Aliento de Chispa', glyph: '🔥', type: 'cone', mult: 1, radius: 7, angle: 70, burn: { mult: 1.6, dur: 4 }, mp: 14, cd: 9, desc: 'Escupes chispas al frente: 100% de daño y los quemas (160% más en 4 s).' },
        { id: 'carga', name: 'Carga Heroica', glyph: '⇥', type: 'charge', mult: 1.6, stun: 1, mp: 14, cd: 11, range: 12, desc: 'Corres hacia el objetivo desde hasta 12 m: 160% de daño y lo aturdes 1 s.' },
        { id: 'escudo_brasas', name: 'Escudo de Brasas', glyph: '♨', type: 'buff', aura: 'fire', thorns: 0.5, dur: 10, mp: 16, cd: 20, desc: 'Te rodeas de fuego: quien te golpee cuerpo a cuerpo se quema (50% de tu ataque) durante 10 s.' },
        { id: 'corte_cruzado', name: 'Corte Cruzado', glyph: '✕', type: 'dmg', mult: 1.2, hits: 2, critIfBurning: true, mp: 16, cd: 8, range: 2.8, desc: 'Dos tajos rápidos de 120%. Si el enemigo se está quemando, ambos son críticos.' },
      ],
      branches: {
        a: {
          name: 'Paladín Escama Dorada',
          master: 'Campeón Dracónico',
          passive: { name: 'Escama Dorada', healEvery: 3, healPct: 0.04, desc: 'Cada 3er ataque básico te cura un 4% de vida a ti y al aliado más cercano.' },
          ultimate: { id: 'juicio', name: 'Juicio del Dragón', glyph: '🗡', type: 'area', fx: 'sword', mult: 3.5, radius: 5, delay: 0.7, healAllies: 0.25, mp: 50, cd: 45, range: 14, desc: 'Una espada gigante de luz cae sobre el objetivo: 350% de daño en área y cura a tus aliados.' },
          masterUlt: { name: 'Juicio del Dragón Maestro', aura: 'wings', auraDur: 12, selfBuff: { dr: 0.3, ccImmune: true, dur: 12 }, desc: 'Despliegas alas de luz 12 s: recibes un 30% menos de daño y nada puede aturdirte.' },
        },
        b: {
          name: 'Danzante de Fuego',
          master: 'Señor de las Llamas',
          passive: { name: 'Ritmo Llameante', cdRefund: 1, desc: 'Especialista en espadas dobles: cada habilidad que usas reduce 1 s la recarga de las demás.' },
          ultimate: { id: 'danza', name: 'Danza del Dragón de Fuego', glyph: '🐉', type: 'dance', mult: 1.1, hits: 8, jumpR: 10, mp: 50, cd: 40, range: 10, desc: '8 cortes ultrarrápidos saltando entre los enemigos cercanos: 110% de daño cada uno.' },
          masterUlt: { name: 'Danza del Señor de las Llamas', finale: { mult: 3, radius: 6, burn: { mult: 2, dur: 4 } }, desc: 'Al terminar la danza, una explosión volcánica enorme quema todo alrededor.' },
        },
      },
    },
  };
  const ARCHETYPE_IDS = Object.keys(ARCHETYPES);
  // Compatibilidad: el código antiguo llamaba "clase" a lo que ahora es la raza
  const CLASSES = ARCHETYPES;
  const CLASS_IDS = ARCHETYPE_IDS;
  const isArchetype = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(ARCHETYPES, id);
  const arch = (id) => ARCHETYPES[id] || ARCHETYPES.lagarto;

  // ---------- Etapas de clase y progresión ----------

  const STAGES = [
    { stage: 0, name: 'Inicio', lvl: 1 },
    { stage: 1, name: 'Despertar', lvl: 10, quest: { title: 'Prueba del Gremio', kills: 12 }, unlocks: '2 habilidades nuevas y equipo de Cristal Azul' },
    { stage: 2, name: 'Especialización', lvl: 25, quest: { title: 'Senda del Especialista', kills: 20 }, branch: true, unlocks: 'Elegir rama A o B: habilidad pasiva, Ultimate y equipo Diamante Dorado' },
    { stage: 3, name: 'Ascensión Maestra', lvl: 40, quest: { title: 'Prueba de Ascensión', boss: true, group: true }, unlocks: 'Ultimate Maestra, Aura de Héroe y equipo Arcoíris Celestial' },
  ];
  // Hitos del árbol de progresión (soon: aún no está en el juego)
  const PROGRESSION = [
    { lvl: 1, text: 'Eliges raza: 3 habilidades y equipo de Madera' },
    { lvl: 5, text: 'Huevo de Mascota: tu mascota te sigue y recoge el botín' },
    { lvl: 5, text: 'Equipo de Cobre' },
    { lvl: 10, text: '1er cambio de clase: Despertar', stage: 1 },
    { lvl: 20, text: 'La mascota evoluciona en Montura Terrestre (+60% de velocidad)' },
    { lvl: 20, text: 'Equipo de Oro Morado' },
    { lvl: 25, text: '2do cambio de clase: Especialización (rama A o B)', stage: 2 },
    { lvl: 40, text: '3er cambio de clase: Ascensión Maestra', stage: 3 },
    { lvl: 40, text: 'Con la Ascensión: Montura Planeadora (cruza el agua) y Aura de Héroe' },
  ];

  // Nombre visible según raza, sexo y etapa (ej.: "Oso Guardián", "Titán de Piedra Viva")
  const raceName = (cls, sex) => {
    const a = arch(cls);
    return (a.names && a.names[sex]) || a.name;
  };
  function className(cls, sex, stage = 0, branch = null) {
    const a = arch(cls);
    const b = branch && a.branches[branch];
    if (stage >= 3 && b) return b.master;
    if (stage >= 2 && b) return b.name;
    if (stage >= 1) return a.awaken;
    return raceName(cls, sex);
  }

  // Habilidades activas: 5 de la raza + la Ultimate (bloqueada hasta elegir rama).
  // Cada una lleva lvl y stage necesarios; en etapa 3 la Ultimate pasa a su versión Maestra.
  const ULT_LOCKED = { id: 'ultimate', name: 'Ultimate', glyph: '★', type: 'none', mp: 0, cd: 1, lvl: 25, stage: 2, locked: true, desc: 'Se desbloquea al elegir tu especialización en el nivel 25.' };
  function skillsFor(cls, stage = 0, branch = null) {
    const a = arch(cls);
    const list = a.skills.map((s, i) => ({ ...s, lvl: i < 3 ? 1 : 10, stage: i < 3 ? 0 : 1 }));
    const b = branch && a.branches[branch];
    if (!b) return [...list, ULT_LOCKED];
    let ult = { ...b.ultimate, lvl: 25, stage: 2, ultimate: true };
    if (stage >= 3) ult = { ...ult, ...b.masterUlt, master: true, lvl: 40, stage: 3 };
    return [...list, ult];
  }
  const passiveFor = (cls, stage, branch) => (stage >= 2 && branch && arch(cls).branches[branch] ? arch(cls).branches[branch].passive : null);
  const skillLock = (p, s) => (s.locked || p.level < s.lvl || (p.stage || 0) < s.stage ? (s.stage > (p.stage || 0) && p.level >= s.lvl ? 'Cambio de clase' : `Nv ${s.lvl}`) : '');

  // ---------- Objetos ----------

  const ITEMS = {
    pocion_vida: { name: 'Poción de Vida', type: 'potion', stat: 'hp', amount: 0.35, price: 20, stack: true, glyph: '♥', rarity: 'comun', desc: 'Restaura el 35% de la vida.' },
    pocion_mana: { name: 'Poción de Maná', type: 'potion', stat: 'mp', amount: 0.4, price: 25, stack: true, glyph: '◆', rarity: 'comun', desc: 'Restaura el 40% del maná.' },
    huevo_mascota: { name: 'Huevo de Mascota', type: 'egg', price: 0, glyph: '🥚', rarity: 'refinado', desc: 'Úsalo para que nazca tu mascota: elige entre Cubo-Perro, Dragoncito o Búho Cúbico. Te sigue y recoge el botín por ti.' },
    gema_poder: { name: 'Gema de Poder', type: 'gem', price: 3, stack: true, glyph: '✦', rarity: 'refinado', desc: 'Actívalas con la tecla 9: cada ataque o habilidad gasta una gema y hace un 25% más de daño. Tu arma brilla mientras estén activas.' },

    piel: { name: 'Piel de Jabalí', type: 'junk', price: 4, stack: true, glyph: '▤', rarity: 'comun', desc: 'Se vende en el mercado.' },
    colmillo: { name: 'Colmillo de Lobo', type: 'junk', price: 8, stack: true, glyph: '◣', rarity: 'comun', desc: 'Se vende en el mercado.' },
    oreja_goblin: { name: 'Oreja de Goblin', type: 'junk', price: 13, stack: true, glyph: '◖', rarity: 'comun', desc: 'Prueba de caza. Se vende en el mercado.' },
    amuleto_hueso: { name: 'Amuleto de Hueso', type: 'junk', price: 22, stack: true, glyph: '◎', rarity: 'comun', desc: 'Talismán orco. Se vende en el mercado.' },
    nucleo_ceniza: { name: 'Núcleo de Ceniza', type: 'junk', price: 36, stack: true, glyph: '✹', rarity: 'refinado', desc: 'Aún está tibio. Se vende en el mercado.' },
    mucosa: { name: 'Mucosa de Ciénaga', type: 'junk', price: 32, stack: true, glyph: '●', rarity: 'comun', desc: 'Viscosa. Se vende en el mercado.' },
  };

  // Armas por raza y grado: [tipo, nombre, descripción]
  const WEAPON_NAMES = {
    oso: [
      ['mace', 'Mazo de Madera', 'Un tronco con mango. Pesa más de lo que parece.'],
      ['mace', 'Maza de Piedra', 'Una piedra bien atada a un palo firme.'],
      ['hammer', 'Martillo de Hierro Azul', 'Forjado en las minas de cristal.'],
      ['hammer', 'Martillo de Amatista', 'La amatista retumba en cada golpe.'],
      ['hammer', 'Martillo de Diamante Estelar', 'Brilla como una estrella al chocar.'],
      ['hammer', 'Martillo Celestial', 'Deja una estela de arcoíris al moverse.'],
    ],
    elfo: [
      ['bow', 'Arco de Rama', 'Una rama flexible y una cuerda de lino.'],
      ['bow', 'Arco de Roble', 'Más alcance y más fuerza en cada tiro.'],
      ['crossbow', 'Ballesta de Cristal Azul', 'Dispara virotes de cristal.'],
      ['bow', 'Arco Compuesto de Amatista', 'Capas de madera y amatista encantada.'],
      ['bow', 'Arco de Diamante Estelar', 'Sus flechas dejan polvo de estrellas.'],
      ['bow', 'Arco Celestial del Alba', 'Dispara flechas de luz de arcoíris.'],
    ],
    gnomo: [
      ['wand', 'Vara de Rama', 'Una ramita con una chispa en la punta.'],
      ['wand', 'Varita Mecánica de Cobre', 'Engranajes que giran al lanzar hechizos.'],
      ['crystalstaff', 'Báculo de Zafiro', 'El zafiro concentra el maná.'],
      ['launcher', 'Lanzapociones de Amatista', 'Dispara frascos burbujeantes.'],
      ['crystalstaff', 'Báculo de Diamante Estelar', 'Un diamante gira en su punta.'],
      ['crystalstaff', 'Báculo Prismático Celestial', 'Descompone la luz en todos los colores.'],
    ],
    hada: [
      ['scepter', 'Cetro de Rama', 'Una ramita con una estrellita.'],
      ['bell', 'Campanita de Cobre', 'Su tintineo calma a los heridos.'],
      ['book', 'Libro Flotante Azul', 'Sus páginas pasan solas.'],
      ['book', 'Libro Rúnico Morado', 'Las runas cantan al abrirlo.'],
      ['scepter', 'Cetro Estrella de Diamante', 'Una estrella de diamante late en la punta.'],
      ['bell', 'Campana Celestial', 'Su sonido se escucha en todo el cielo.'],
    ],
    lagarto: [
      ['longsword', 'Espada de Madera', 'Para entrenar… y para pelear de verdad.'],
      ['spear', 'Lanza de Cobre', 'Larga y con punta afilada de cobre.'],
      ['longsword', 'Espada Larga de Cristal Azul', 'Equilibrada y brillante.'],
      ['dualswords', 'Espadas Dobles de Amatista', 'Un par de hojas moradas muy rápidas.'],
      ['longsword', 'Espada de Diamante Estelar', 'Corta el aire con un silbido.'],
      ['longsword', 'Hoja Celestial del Dragón', 'Arde con fuego de arcoíris.'],
    ],
  };
  // Martillos a dos manos (solo Oso Berserker): +35% de ataque
  const TWO_HANDED = [
    ['dorado', 'gran_martillo_tronador', 'Gran Martillo Tronador', 'Hace temblar la tierra.'],
    ['arcoiris', 'martillo_coloso', 'Martillo del Coloso', 'Solo un coloso puede levantarlo.'],
  ];
  const ARMOR_NAMES = {
    HEAVY_PLATE: ['Peto de Tablas', 'Armadura de Cobre', 'Armadura de Cristal Azul', 'Armadura de Oro Encantado', 'Coraza de Diamante con Capa', 'Armadura Legendaria del Titán'],
    MEDIUM_SCALE: ['Escamas de Corteza', 'Cota de Escamas de Cobre', 'Escamas de Cristal Azul', 'Escamas de Oro Encantado', 'Escamas de Diamante con Capa', 'Escamas Celestiales del Dragón'],
    LIGHT_LEATHER: ['Chaleco de Hojas', 'Armadura de Cuero', 'Cuero de Cristal Azul', 'Cuero de Oro Encantado', 'Capa de Diamante del Explorador', 'Atuendo Celestial del Viento'],
    CLOTH_ROBE: ['Ropa de Tela Simple', 'Túnica de Cobre', 'Túnica de Cristal Azul', 'Túnica de Oro Encantado', 'Túnica de Diamante con Capa', 'Túnica Prismática Celestial'],
    SACRED_ROBE: ['Vestido de Pétalos', 'Hábito de Cobre', 'Vestiduras de Cristal Azul', 'Vestiduras de Oro Encantado', 'Manto Sagrado de Diamante', 'Manto Celestial de las Estrellas'],
  };

  const WEAPON_TIERS = {}; // raza → ids de arma por grado (madera … arcoiris)
  const ARMOR_TIERS = {}; // tipo de armadura → ids por grado
  for (const cls of ARCHETYPE_IDS) {
    WEAPON_TIERS[cls] = GRADE_ORDER.map((g, i) => {
      const [wt, name, desc] = WEAPON_NAMES[cls][i];
      const G = GRADES[g];
      const id = `w_${cls}_${g}`;
      ITEMS[id] = { name, type: 'weapon', weaponType: wt, cls, grade: g, atk: G.atk, lvl: G.lvl, price: G.price, crit: i >= 3 ? 0.01 * (i - 1) : 0, glyph: WEAPON_TYPES[wt].glyph, rarity: g, desc };
      return id;
    });
  }
  for (const [g, id, name, desc] of TWO_HANDED) {
    const G = GRADES[g];
    ITEMS[id] = { name, type: 'weapon', weaponType: 'hammer2h', cls: 'oso', grade: g, atk: Math.round(G.atk * 1.35), lvl: G.lvl, price: Math.round(G.price * 1.3), crit: 0.02, glyph: '⚒', rarity: g, desc: `${desc} Martillo a dos manos: solo para el Oso Berserker.` };
  }
  for (const [type, names] of Object.entries(ARMOR_NAMES)) {
    const T = ARMOR_TYPES[type];
    ARMOR_TIERS[type] = GRADE_ORDER.map((g, i) => {
      const G = GRADES[g];
      const id = `a_${T.key}_${g}`;
      ITEMS[id] = {
        name: names[i],
        type: 'armor',
        armorType: type,
        grade: g,
        def: Math.round(G.def * T.def),
        hp: Math.round(G.hp * T.hp),
        mp: Math.round(G.hp * T.mp * 0.6),
        evade: T.evade || 0,
        heal: T.heal || 0,
        lvl: G.lvl,
        price: G.price,
        glyph: '▣',
        rarity: g,
        look: G.look,
        desc: `Armadura ${T.name.toLowerCase()} de grado ${G.name}.`,
      };
      return id;
    });
  }
  const weaponFor = (cls, grade) => WEAPON_TIERS[cls][Math.max(0, gradeIndex(grade))];
  const armorFor = (cls, grade) => ARMOR_TIERS[arch(cls).armorType][Math.max(0, gradeIndex(grade))];
  const startGear = (cls) => ({ weapon: weaponFor(cls, 'madera'), armor: armorFor(cls, 'madera') });

  // ¿Puede este personaje equipar el objeto? Devuelve '' si sí, o el motivo si no.
  // p: { cls, level, stage, branch }
  function equipProblem(p, it) {
    if (!it || (it.type !== 'weapon' && it.type !== 'armor')) return 'No se puede equipar.';
    const a = arch(p.cls);
    if (it.type === 'weapon') {
      if (!a.weaponTypes.includes(it.weaponType)) return `${raceName(p.cls, p.sex)} no puede usar ${WEAPON_TYPES[it.weaponType].name.toLowerCase()}s.`;
      if (it.cls && it.cls !== p.cls) return `Solo para ${ARCHETYPES[it.cls].name}.`;
      if (WEAPON_TYPES[it.weaponType].twoHanded) {
        const pas = passiveFor(p.cls, p.stage || 0, p.branch);
        if (!pas || !pas.twoHanded) return 'Solo el Oso Berserker puede usar martillos a dos manos.';
      }
    } else if (it.armorType !== a.armorType) {
      return `Tu raza usa armadura ${ARMOR_TYPES[a.armorType].name.toLowerCase()}.`;
    }
    if (p.level < it.lvl) return `Necesitas nivel ${it.lvl} (tienes ${p.level}).`;
    const G = it.grade && GRADES[it.grade];
    if (G && (p.stage || 0) < G.stage) return `El grado ${G.name} requiere el ${['', '1er', '2do', '3er'][G.stage]} cambio de clase (${STAGES[G.stage].name}).`;
    return '';
  }

  // ---------- Fórmulas ----------

  function playerBaseStats(cls, lvl) {
    const a = arch(cls);
    const b = a.base;
    const at = ([v, inc]) => v + inc * (lvl - 1);
    return { maxHp: Math.round(at(b.hp)), maxMp: Math.round(at(b.mp)), atk: at(b.atk), def: at(b.def), crit: a.crit };
  }

  function mobStats(def, lvl) {
    const boss = !!def.boss;
    return {
      maxHp: Math.round((35 + 26 * lvl) * (boss ? 6 : 1)),
      atk: (4 + 2.6 * lvl) * (boss ? 1.5 : 1),
      armor: 1 + 1.3 * lvl,
      xp: Math.round(14 * Math.pow(lvl, 1.4) * (boss ? 10 : 1)),
      gold: [lvl * 2 * (boss ? 25 : 1), lvl * 5 * (boss ? 25 : 1)],
    };
  }

  // ---------- Mundo ----------

  // ground: altura base a la que se aplana el terreno de la zona
  // trees: densidad de árboles; treeType: pine | round | dead | swamp
  const ZONES = [
    { id: 'aldea', name: 'Aldea de Brezal', x: 0, z: 0, r: 22, safe: true, tint: [0.5, 0.42, 0.3], desc: 'Tu hogar. Zona segura: los monstruos no entran y recuperas vida y maná más rápido.' },
    { id: 'prados', name: 'Prados de Brezo', lvl: '1–2', x: 50, z: 14, r: 26, ground: 0.6, trees: 0.06, treeType: 'round', tint: [0.46, 0.6, 0.27], desc: 'Praderas abiertas al este. Jabalíes que solo atacan si los provocas.' },
    { id: 'bosque', name: 'Bosque Aullante', lvl: '3–4', x: -54, z: 46, r: 28, ground: 1.2, trees: 0.55, treeType: 'pine', tint: [0.2, 0.36, 0.2], desc: 'Pinar cerrado al noroeste. Los lobos cazan en manada y atacan al verte.' },
    { id: 'goblin', name: 'Campamento Goblin', lvl: '5–7', x: 22, z: -80, r: 25, ground: 0.8, trees: 0.12, treeType: 'round', tint: [0.5, 0.43, 0.27], desc: 'Tiendas y fogatas al sur. Saqueadores rápidos y numerosos.' },
    { id: 'fuerte', name: 'Fuerte de los Orcos', lvl: '8–11', x: -92, z: -62, r: 28, ground: 1.5, trees: 0.08, treeType: 'pine', tint: [0.43, 0.36, 0.29], desc: 'Una empalizada al suroeste. Orcos con garrotes que pegan muy fuerte.' },
    { id: 'ceniza', name: 'Llanura de Ceniza', lvl: '12–14', x: 104, z: -96, r: 30, ground: 1.0, trees: 0.1, treeType: 'dead', tint: [0.33, 0.31, 0.3], desc: 'Tierra quemada con grietas de lava. Gólems lentos y muy resistentes.' },
    { id: 'pantano', name: 'Pantano de Tharmok', lvl: '13–15 · Jefe', x: 108, z: 96, r: 26, ground: -1.1, trees: 0.3, treeType: 'swamp', tint: [0.24, 0.31, 0.2], desc: 'Ciénaga al noreste donde aguarda Tharmok, el jefe final.' },
  ];

  // Botín: [id, probabilidad, [cantidad mín, máx]]. '@w:grado' = arma de ese grado para la raza
  // de quien lo recibe; '@a:grado' = armadura. onHit: estado que pueden causar al golpear
  // (poison/burn: % de su ataque por segundo; slow: segundos de lentitud).
  const MOBS = {
    jabali: {
      name: 'Jabalí Salvaje', kind: 'quad', lvl: [1, 2], zone: 'prados', count: 16,
      color: 0x6b4a32, scale: 0.85, tusks: true, mane: true, aggressive: false, speed: 4.6,
      drops: [['piel', 0.55], ['pocion_vida', 0.12], ['gema_poder', 0.25, [2, 5]], ['@w:madera', 0.03], ['@a:madera', 0.05]],
    },
    lobo: {
      name: 'Lobo Gris', kind: 'quad', lvl: [3, 4], zone: 'bosque', count: 15,
      color: 0x7b7f87, scale: 0.9, aggressive: true, speed: 5.6,
      onHit: { slow: 2, chance: 0.25 },
      drops: [['gema_poder', 0.3, [3, 6]], ['colmillo', 0.5], ['pocion_vida', 0.15], ['pocion_mana', 0.1], ['@a:madera', 0.05], ['@w:cobre', 0.02]],
    },
    goblin: {
      name: 'Goblin Saqueador', kind: 'hum', lvl: [5, 7], zone: 'goblin', count: 15,
      skin: 0x76a03d, body: 0x5a3d22, legs: 0x3b2a1a, scale: 0.72, ears: true, aggressive: true, speed: 5.2,
      weaponColor: 0x8d8a80,
      drops: [['gema_poder', 0.3, [4, 8]], ['oreja_goblin', 0.45], ['pocion_vida', 0.18], ['pocion_mana', 0.12], ['@w:cobre', 0.05], ['@a:cobre', 0.04]],
    },
    orco: {
      name: 'Orco Guerrero', kind: 'hum', lvl: [8, 11], zone: 'fuerte', count: 16,
      skin: 0x557043, body: 0x6e2a22, legs: 0x2f2a26, scale: 1.18, tusks: true, aggressive: true, speed: 5,
      club: true,
      onHit: { slow: 2.5, chance: 0.2 },
      drops: [['gema_poder', 0.35, [5, 10]], ['amuleto_hueso', 0.4], ['pocion_vida', 0.2], ['pocion_mana', 0.15], ['@w:cobre', 0.05], ['@a:cobre', 0.05], ['@w:azul', 0.02], ['@a:azul', 0.02]],
    },
    golem: {
      name: 'Gólem de Ceniza', kind: 'hum', lvl: [12, 14], zone: 'ceniza', count: 14,
      skin: 0x5a5652, body: 0x46423e, legs: 0x3a3734, scale: 1.4, glow: 0xff6a2a, weapon: false, aggressive: true, speed: 4.4,
      onHit: { burn: { pct: 0.35, dur: 4 }, chance: 0.3 },
      drops: [['gema_poder', 0.4, [6, 12]], ['nucleo_ceniza', 0.4], ['pocion_vida', 0.25], ['pocion_mana', 0.2], ['@w:azul', 0.04], ['@a:azul', 0.04]],
    },
    sapo: {
      name: 'Sapo de Ciénaga', kind: 'quad', lvl: [13, 14], zone: 'pantano', count: 7,
      color: 0x4c6a36, scale: 1.05, aggressive: false, speed: 4,
      onHit: { poison: { pct: 0.3, dur: 5 }, chance: 0.4 },
      drops: [['gema_poder', 0.4, [6, 12]], ['mucosa', 0.5], ['pocion_vida', 0.25], ['pocion_mana', 0.2], ['@w:azul', 0.04], ['@a:azul', 0.04]],
    },
    tharmok: {
      name: 'Tharmok, Señor del Pantano', kind: 'hum', lvl: [15, 15], zone: 'pantano', count: 1, boss: true, respawn: 180,
      skin: 0x3d5a3a, body: 0x2c3a24, legs: 0x1f2a1a, scale: 2.3, tusks: true, glow: 0xb6ff5a, club: true, aggressive: true, speed: 4.8,
      onHit: { poison: { pct: 0.3, dur: 6 }, slow: 2, chance: 0.35 },
      drops: [['gema_poder', 1, [25, 40]], ['@w:azul', 0.6], ['@a:azul', 0.6], ['@w:morado', 0.1], ['@a:morado', 0.1], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
  };
  // Nivel de monstruo más alto (sin jefes) y jefe más fuerte: lo usan las misiones de cambio de clase
  const TOP_MOB_LVL = Math.max(...Object.values(MOBS).filter((m) => !m.boss).map((m) => m.lvl[1]));
  const TOP_BOSS = Object.entries(MOBS)
    .filter(([, m]) => m.boss)
    .sort((a, b) => b[1].lvl[1] - a[1].lvl[1])[0][0];
  // Misión del cambio a la etapa `stage`: monstruos de al menos este nivel (o el jefe)
  function questFor(stage) {
    const st = STAGES[stage];
    if (!st || !st.quest) return null;
    if (st.quest.boss) return { stage, title: st.quest.title, boss: TOP_BOSS, need: 1, group: !!st.quest.group, text: `Derrota a ${MOBS[TOP_BOSS].name} (puedes ir con tu grupo).` };
    const minLvl = Math.max(1, Math.min(st.lvl - 4, TOP_MOB_LVL - 3));
    return { stage, title: st.quest.title, minLvl, need: st.quest.kills, text: `Derrota ${st.quest.kills} monstruos de nivel ${minLvl} o más.` };
  }

  const resolveDrop = (id, cls) => {
    if (id[0] !== '@') return id;
    const [kind, grade] = id.slice(1).split(':');
    return kind === 'w' ? weaponFor(cls, grade) : armorFor(cls, grade);
  };

  const GEM_MULT = 1.25;
  const shopFor = (cls) => ['pocion_vida', 'pocion_mana', 'gema_poder', ...['madera', 'cobre', 'azul'].flatMap((g) => [weaponFor(cls, g), armorFor(cls, g)])];
  const sellPrice = (item) => (item.type === 'junk' ? item.price : Math.floor(item.price * 0.4));

  // Personajes de la aldea. x, z: posición; se les habla con clic.
  const NPCS = [
    {
      id: 'mercader', name: 'Mercader Orlen', title: 'Comerciante', x: 6.5, z: -5.5,
      look: { skin: 0xd9a77e, body: 0x6a4c7a, legs: 0x3a2e40, hair: 0xbfb8ab, robe: true, weapon: false },
      desc: 'Vende pociones, armas de tu raza y armaduras de tu tipo (grados Madera, Cobre y Cristal Azul). También compra todo tu botín.',
    },
    {
      id: 'sanadora', name: 'Sanadora Ilwen', title: 'Sacerdotisa', x: -8, z: -2.5,
      look: { skin: 0xe8c4a2, body: 0xe6dfcc, legs: 0xcfc6b2, hair: 0xc9a46a, longHair: true, robe: true, weapon: false },
      desc: 'Restaura por completo tu vida y tu maná, gratis, siempre que no estés en combate.',
    },
    {
      id: 'capitana', name: 'Capitana Brisa', title: 'Guardia de Brezal', x: 3.5, z: 9.5,
      look: { skin: 0xc99a74, body: 0x858b93, legs: 0x3b3127, hair: 0x2a1c12, cape: 0x34557d, weaponType: 'sword' },
      desc: 'Conoce las tierras de Valdoria: te recomienda a qué zona ir según tu nivel y te da consejos.',
    },
    {
      id: 'maestro', name: 'Maestro Aldric', title: 'Maestro de Clase', x: -6, z: 8.5,
      look: { skin: 0xd6a882, body: 0x7a2630, legs: 0x2a1f1a, hair: 0xe6e0d6, beard: true, cape: 0xd9b25f, weapon: false },
      desc: 'Guía los cambios de clase: Despertar (nivel 10), Especialización (nivel 25) y Ascensión Maestra (nivel 40).',
    },
  ];

  // Aspecto según raza y sexo
  function lookFor(cls, sex) {
    const a = arch(cls);
    const base = { ...a.look };
    if (sex === 'f') Object.assign(base, a.lookF || {}, { female: true, longHair: !!a.look.hair && a.look.ears !== 'round' });
    else base.female = false;
    return base;
  }

  // ---------- Migración de personajes antiguos (v0.6 → v0.7) ----------
  // Guerrero → Caballero Lagarto · Arquera → Elfo · Mago → Gnomo. El equipo antiguo se
  // cambia por el del grado equivalente de su nueva raza. Con nivel 10 o más se concede el
  // Despertar (ya tenían esas habilidades).
  const OLD_CLASS_MAP = { guerrero: 'lagarto', arquera: 'elfo', mago: 'gnomo' };
  const OLD_WEAPON_LVL = {
    espada_corta: 1, espada_larga: 5, hoja_azul: 9, hoja_runica: 11, filo_crepusculo: 13, espada_dragon: 16, colmillo_rey: 19,
    arco_corto: 1, arco_largo: 5, arco_plata: 9, arco_runico: 11, arco_crepusculo: 13, arco_dragon: 16, arco_vientos: 19,
    baculo_aprendiz: 1, baculo_roble: 5, baculo_zafiro: 9, baculo_runico: 11, baculo_crepusculo: 13, baculo_dragon: 16, baculo_archimago: 19,
  };
  const OLD_ARMOR_LVL = { jubon: 1, cota_malla: 5, placas: 9, escamas: 11, egida: 13, mithril: 16, aurora: 19 };
  const oldGrade = (lvl) => (lvl >= 16 ? 'morado' : lvl >= 9 ? 'azul' : lvl >= 5 ? 'cobre' : 'madera');

  function migrateCharacter(oldCls, data) {
    if (isArchetype(oldCls) && data && data.v >= 4) return { cls: oldCls, data };
    const cls = OLD_CLASS_MAP[oldCls] || (isArchetype(oldCls) ? oldCls : 'lagarto');
    const d = { ...(data || {}) };
    const conv = (id) => {
      if (!id) return null;
      if (OLD_WEAPON_LVL[id]) return weaponFor(cls, oldGrade(OLD_WEAPON_LVL[id]));
      if (OLD_ARMOR_LVL[id]) return armorFor(cls, oldGrade(OLD_ARMOR_LVL[id]));
      return ITEMS[id] ? id : null;
    };
    const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(+d.level || 1)));
    d.cls = cls;
    d.stage = lvl >= STAGES[1].lvl ? 1 : 0;
    d.branch = null;
    d.quest = null;
    d.inv = Array.isArray(d.inv) ? d.inv.map((s) => s && { ...s, id: conv(s.id) }).filter((s) => s && s.id) : [];
    const eq = d.equip || {};
    d.equip = { weapon: conv(eq.weapon) || weaponFor(cls, 'madera'), armor: conv(eq.armor) || armorFor(cls, 'madera') };
    d.v = 4;
    return { cls, data: d, migrated: true };
  }

  return {
    MAX_LEVEL, xpToNext, CRIT_MULT, MOVE_SPEED, SEXES,
    EquipmentGrade, GRADES, GRADE_ORDER, gradeIndex, RARITY, ARMOR_TYPES, WEAPON_TYPES,
    ARCHETYPES, ARCHETYPE_IDS, CLASSES, CLASS_IDS, isArchetype, STAGES, PROGRESSION,
    raceName, className, skillsFor, passiveFor, skillLock, lookFor, playerBaseStats, mobStats,
    ITEMS, WEAPON_TIERS, ARMOR_TIERS, weaponFor, armorFor, startGear, equipProblem,
    ZONES, MOBS, TOP_MOB_LVL, TOP_BOSS, questFor, resolveDrop, shopFor, sellPrice, NPCS, GEM_MULT,
    PETS, isPet, PET_LVL, MOUNT_LVL, GLIDER_LVL, MOUNT_SPEED, PET_FETCH_R, mountKind, petName,
    OLD_CLASS_MAP, migrateCharacter,
  };
});
