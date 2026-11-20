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
  const MAX_LEVEL = 80;
  // Experiencia para subir de nivel: desde el 50 la curva se empina (como el final de Lineage 2)
  const xpToNext = (lvl) => Math.floor((42 * Math.pow(lvl, 1.85) + 18) * (lvl > 50 ? 1 + (lvl - 50) * 0.08 : 1));
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
    GRADE_COMET_SILVER: 'cometa',
    GRADE_AURORA_ETERNAL: 'aurora',
  };
  // lvl: nivel mínimo · stage: cambio de clase necesario · look: color de armadura
  const GRADES = {
    madera: { id: 'GRADE_WOOD', name: 'Madera', color: '#b9b2a4', lvl: 1, stage: 0, atk: 4, def: 3, hp: 15, price: 30, look: 0x8a6a46 },
    cobre: { id: 'GRADE_COPPER', name: 'Cobre', color: '#8fd37a', lvl: 5, stage: 0, atk: 10, def: 7, hp: 40, price: 140, look: 0xb5703f },
    azul: { id: 'GRADE_BLUE_CRYSTAL', name: 'Cristal Azul', color: '#74aaff', lvl: 10, stage: 1, atk: 20, def: 14, hp: 90, price: 520, look: 0x5d8fd8 },
    morado: { id: 'GRADE_PURPLE_GOLD', name: 'Oro Morado', color: '#c895ff', lvl: 20, stage: 1, atk: 34, def: 22, hp: 150, price: 1500, look: 0x8a55c8 },
    dorado: { id: 'GRADE_GOLD_DIAMOND', name: 'Diamante Dorado', color: '#ffc44d', lvl: 25, stage: 2, atk: 52, def: 32, hp: 230, price: 3800, look: 0xe0b040 },
    arcoiris: { id: 'GRADE_RAINBOW_CELESTIAL', name: 'Arcoíris Celestial', color: '#ff8adf', lvl: 40, stage: 3, atk: 80, def: 46, hp: 340, price: 9500, look: 0xf0e0ff, rainbow: true },
    cometa: { id: 'GRADE_COMET_SILVER', name: 'Cometa Plateado', color: '#9fe8ff', lvl: 55, stage: 3, atk: 112, def: 63, hp: 470, price: 26000, look: 0xc8f0ff },
    aurora: { id: 'GRADE_AURORA_ETERNAL', name: 'Aurora Eterna', color: '#7dffc0', lvl: 70, stage: 3, atk: 150, def: 84, hp: 640, price: 62000, look: 0xb8ffe0 },
  };
  const GRADE_ORDER = ['madera', 'cobre', 'azul', 'morado', 'dorado', 'arcoiris', 'cometa', 'aurora'];
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
  // Categoría de un objeto para las pestañas del inventario: equipo, consumibles, misión u otros.
  // Un objeto puede fijar la suya con `cat` (por ejemplo, objetos de misiones futuras).
  function itemCategory(it) {
    if (!it) return 'other';
    if (it.cat) return it.cat;
    if (it.type === 'weapon' || it.type === 'armor') return 'equip';
    if (it.type === 'potion' || it.type === 'gem') return 'consumable';
    if (it.type === 'egg' || it.type === 'quest') return 'quest';
    return 'other';
  }
  // Objetos que no se pueden vender ni destruir
  const isKeyItem = (it) => !!it && (it.type === 'egg' || it.type === 'quest' || it.cat === 'quest');

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
        { id: 'muro_miel', name: 'Muro de Miel', glyph: '◍', type: 'zone', applies: 'WET_GLUE', radius: 4, dur: 6, slow: true, tick: 0.3, fx: 0xf2b13a, mp: 14, cd: 14, desc: 'Un charco de miel pegajosa: ralentiza y daña poco a poco a los enemigos que lo pisan durante 6 s.' },
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
        { id: 'salto_copa', name: 'Salto de Copa', glyph: '↶', type: 'leap', applies: 'WIND_GUST', dist: 7, shot: 1.2, knock: 3, mp: 12, cd: 10, desc: 'Saltas 7 m hacia atrás y disparas una flecha que empuja al objetivo.' },
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
        { id: 'rayo_cristal', name: 'Rayo de Cristal', glyph: 'ϟ', type: 'chain', applies: 'CRYSTAL_CHARGE', mult: 1.6, jumps: 2, jumpR: 8, mp: 10, cd: 4, range: 14, desc: 'Un rayo de cristal golpea al objetivo y rebota hasta 3 enemigos: 160% de daño a cada uno.' },
        { id: 'torreta', name: 'Torreta de Chispas', glyph: '⛯', type: 'turret', summon: 'turret', mult: 0.9, dur: 8, every: 1, reach: 12, mp: 16, cd: 14, desc: 'Construyes un tótem que dispara chispas al enemigo más cercano durante 8 s.' },
        { id: 'polimorfia', name: 'Polimorfia Divertida', glyph: '🐑', type: 'poly', dur: 5, mp: 18, cd: 18, range: 14, desc: 'Conviertes al objetivo en una oveja o un pollo cuadrado inofensivo durante 5 s. Se rompe si lo golpean. (No sirve con jefes.)' },
        { id: 'pegamento', name: 'Bomba de Pegamento', glyph: '⚗', type: 'area', applies: 'WET_GLUE', fx: 'glue', mult: 1.5, radius: 4, delay: 0.45, slow: 4, mp: 18, cd: 10, range: 14, desc: 'Un frasco explota sobre el objetivo: 150% de daño en área y ralentiza 4 s.' },
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
        { id: 'ola_notas', name: 'Ola de Notas', glyph: '♫', type: 'dmg', applies: 'WIND_GUST', proj: 'arcane', mult: 1.8, healAlly: 0.15, mp: 14, cd: 6, range: 14, desc: 'Una nota musical daña al enemigo (180%) y rebota hacia el aliado más herido para curarlo.' },
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
        { id: 'aliento', name: 'Aliento de Chispa', glyph: '🔥', type: 'cone', applies: 'FIRE_SPARK', mult: 1, radius: 7, angle: 70, burn: { mult: 1.6, dur: 4 }, mp: 14, cd: 9, desc: 'Escupes chispas al frente: 100% de daño y los quemas (160% más en 4 s).' },
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
  // Niveles de habilidad (estilo Lineage 2): cada habilidad sube de nivel solo, cada 5 niveles del
  // personaje desde que se desbloquea, hasta Nv 12 (o lo que alcance antes del nivel máximo). Cada
  // nivel: +6% de poder (daño, curación y escudos) y +5% de maná.
  const SKILL_LVL_EVERY = 5;
  const SKILL_MAX_LVL = 12;
  const SKILL_POWER_PER = 0.06;
  const SKILL_MP_PER = 0.05;
  const skillMaxLevel = (s) => (s.locked ? 0 : Math.min(SKILL_MAX_LVL, 1 + Math.floor((MAX_LEVEL - s.lvl) / SKILL_LVL_EVERY)));
  // Nivel actual de una habilidad para ese personaje (0 = aún bloqueada)
  const skillLevel = (p, s) => (!s || skillLock(p, s) ? 0 : Math.min(skillMaxLevel(s), 1 + Math.floor((p.level - s.lvl) / SKILL_LVL_EVERY)));
  const skillPower = (lvl) => 1 + SKILL_POWER_PER * Math.max(0, lvl - 1);
  const skillMp = (s, lvl) => Math.round(s.mp * (1 + SKILL_MP_PER * Math.max(0, lvl - 1)));
  // Nivel del personaje en que la habilidad sube al siguiente nivel (null si ya está al máximo)
  const skillNextAt = (p, s) => {
    const lvl = Math.max(1, skillLevel(p, s));
    return lvl < skillMaxLevel(s) ? s.lvl + lvl * SKILL_LVL_EVERY : null;
  };

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

    seta: { name: 'Sombrero de Hongo', type: 'junk', price: 3, stack: true, glyph: '⌂', rarity: 'comun', desc: 'Todavía rebota. Se vende en el mercado.' },
    lana: { name: 'Lana Cuadrada', type: 'junk', price: 5, stack: true, glyph: '▦', rarity: 'comun', desc: 'Suave y cúbica. Se vende en el mercado.' },
    pinza: { name: 'Pinza de Cangrejo', type: 'junk', price: 7, stack: true, glyph: '⋎', rarity: 'comun', desc: 'Se vende en el mercado.' },
    corteza: { name: 'Corteza de Lobo', type: 'junk', price: 10, stack: true, glyph: '▤', rarity: 'comun', desc: 'Huele a pino. Se vende en el mercado.' },
    gorro_duende: { name: 'Gorro de Duende', type: 'junk', price: 14, stack: true, glyph: '▲', rarity: 'comun', desc: 'Con cascabel. Se vende en el mercado.' },
    miel: { name: 'Tarro de Miel', type: 'junk', price: 18, stack: true, glyph: '◍', rarity: 'comun', desc: 'Dulcísima. Se vende en el mercado.' },
    cristal_murcielago: { name: 'Ala de Cristal', type: 'junk', price: 24, stack: true, glyph: '◆', rarity: 'comun', desc: 'Brilla en la oscuridad. Se vende en el mercado.' },
    gel_cobre: { name: 'Gel de Cobre', type: 'junk', price: 28, stack: true, glyph: '●', rarity: 'comun', desc: 'Pegajoso. Se vende en el mercado.' },
    engranaje: { name: 'Engranaje Viejo', type: 'junk', price: 34, stack: true, glyph: '⚙', rarity: 'comun', desc: 'Aún gira. Se vende en el mercado.' },
    escama_fuego: { name: 'Escama de Fuego', type: 'junk', price: 45, stack: true, glyph: '◈', rarity: 'refinado', desc: 'Tibia al tacto. Se vende en el mercado.' },
    cola_salamandra: { name: 'Cola de Salamandra', type: 'junk', price: 52, stack: true, glyph: '∿', rarity: 'refinado', desc: 'Se vende en el mercado.' },
    nucleo_magma: { name: 'Núcleo de Magma', type: 'junk', price: 60, stack: true, glyph: '✹', rarity: 'refinado', desc: 'Sigue ardiendo. Se vende en el mercado.' },
    pluma_nube: { name: 'Pluma de Nube', type: 'junk', price: 72, stack: true, glyph: '☁', rarity: 'refinado', desc: 'Ligera como el aire. Se vende en el mercado.' },
    polvo_estelar: { name: 'Polvo Estelar', type: 'junk', price: 80, stack: true, glyph: '✦', rarity: 'refinado', desc: 'Centellea. Se vende en el mercado.' },
    pluma_grifo: { name: 'Pluma de Grifo', type: 'junk', price: 90, stack: true, glyph: '❦', rarity: 'refinado', desc: 'Se vende en el mercado.' },
    savia_real: { name: 'Savia del Rey Tronco', type: 'junk', price: 140, stack: true, glyph: '❂', rarity: 'azul', desc: 'Trofeo del Rey Tronco. Se vende caro.' },
    chip_automata: { name: 'Chip del Mega-Autómata', type: 'junk', price: 220, stack: true, glyph: '▣', rarity: 'azul', desc: 'Trofeo de La Fábrica Descontrolada. Se vende caro.' },
    colmillo_ignis: { name: 'Colmillo de Ignis', type: 'junk', price: 420, stack: true, glyph: '◣', rarity: 'morado', desc: 'Trofeo del Dragón Dormilón. Se vende muy caro.' },
    polvo_arcoiris: { name: 'Polvo de Arcoíris', type: 'material', price: 60, stack: true, glyph: '✧', rarity: 'arcoiris', desc: 'Material celestial: el Herrero Celestial de la Ciudadela lo cambia por equipo Dorado y Arcoíris.' },
    // Tierras lejanas (niveles 40–80)
    copo_eterno: { name: 'Copo Eterno', type: 'junk', price: 95, stack: true, glyph: '❄', rarity: 'refinado', desc: 'Nunca se derrite. Se vende en el mercado.' },
    bufanda: { name: 'Bufanda de Muñeco', type: 'junk', price: 105, stack: true, glyph: '≋', rarity: 'refinado', desc: 'Calentita. Se vende en el mercado.' },
    cuerno_yeti: { name: 'Cuerno de Yeti', type: 'junk', price: 118, stack: true, glyph: '◣', rarity: 'refinado', desc: 'Se vende en el mercado.' },
    corona_escarcha: { name: 'Corona de Escarcha', type: 'junk', price: 700, stack: true, glyph: '♛', rarity: 'dorado', desc: 'Trofeo de la Reina de la Escarcha. Se vende muy caro.' },
    anca_rana: { name: 'Lengua de Rana', type: 'junk', price: 125, stack: true, glyph: '∿', rarity: 'refinado', desc: 'Pegajosa. Se vende en el mercado.' },
    frasco_luz: { name: 'Frasco de Luciérnagas', type: 'junk', price: 135, stack: true, glyph: '✺', rarity: 'refinado', desc: 'Ilumina la noche. Se vende en el mercado.' },
    petalo_glotona: { name: 'Pétalo Glotón', type: 'junk', price: 145, stack: true, glyph: '✿', rarity: 'refinado', desc: 'Se vende en el mercado.' },
    escama_hidra: { name: 'Escama de Hidra', type: 'junk', price: 850, stack: true, glyph: '◈', rarity: 'dorado', desc: 'Trofeo de la Hidra del Pantano. Se vende muy caro.' },
    caparazon_oro: { name: 'Caparazón Dorado', type: 'junk', price: 155, stack: true, glyph: '⬢', rarity: 'refinado', desc: 'Brilla al sol. Se vende en el mercado.' },
    venda_momia: { name: 'Venda Antigua', type: 'junk', price: 165, stack: true, glyph: '≡', rarity: 'refinado', desc: 'Se vende en el mercado.' },
    espina_cactus: { name: 'Espina de Cactus', type: 'junk', price: 175, stack: true, glyph: '✶', rarity: 'refinado', desc: 'Pincha un poquito. Se vende en el mercado.' },
    ojo_esfinge: { name: 'Ojo de la Esfinge', type: 'junk', price: 1000, stack: true, glyph: '◉', rarity: 'dorado', desc: 'Trofeo de la Gran Esfinge de Arena. Se vende muy caro.' },
    cristal_prisma: { name: 'Cristal Prismático', type: 'junk', price: 190, stack: true, glyph: '◆', rarity: 'refinado', desc: 'Descompone la luz. Se vende en el mercado.' },
    escama_prisma: { name: 'Escama de Dragoncito', type: 'junk', price: 205, stack: true, glyph: '◈', rarity: 'refinado', desc: 'Se vende en el mercado.' },
    chispa_prisma: { name: 'Chispa Prismática', type: 'junk', price: 220, stack: true, glyph: '✦', rarity: 'refinado', desc: 'Se vende en el mercado.' },
    nucleo_coloso: { name: 'Núcleo del Coloso', type: 'junk', price: 1200, stack: true, glyph: '❂', rarity: 'cometa', desc: 'Trofeo del Coloso Prismático. Se vende muy caro.' },
    emblema_sombra: { name: 'Emblema Sombrío', type: 'junk', price: 235, stack: true, glyph: '⛉', rarity: 'refinado', desc: 'Se vende en el mercado.' },
    ala_lunar: { name: 'Ala Lunar', type: 'junk', price: 250, stack: true, glyph: '☾', rarity: 'refinado', desc: 'Se vende en el mercado.' },
    piedra_lunar: { name: 'Piedra Lunar', type: 'junk', price: 270, stack: true, glyph: '●', rarity: 'refinado', desc: 'Se vende en el mercado.' },
    corona_eclipse: { name: 'Corona del Eclipse', type: 'junk', price: 1600, stack: true, glyph: '♛', rarity: 'aurora', desc: 'Trofeo del Rey del Eclipse. Se vende carísimo.' },
    fragmento_aurora: { name: 'Fragmento de Aurora', type: 'material', price: 150, stack: true, glyph: '✧', rarity: 'aurora', desc: 'Material boreal: la Herrera de la Aurora, en el Oasis del Sol, lo cambia por equipo Aurora Eterna.' },
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
      ['hammer', 'Martillo de Cometa', 'Cae como una estrella fugaz.'],
      ['hammer', 'Martillo de la Aurora', 'Pinta el cielo de verde y violeta.'],
    ],
    elfo: [
      ['bow', 'Arco de Rama', 'Una rama flexible y una cuerda de lino.'],
      ['bow', 'Arco de Roble', 'Más alcance y más fuerza en cada tiro.'],
      ['crossbow', 'Ballesta de Cristal Azul', 'Dispara virotes de cristal.'],
      ['bow', 'Arco Compuesto de Amatista', 'Capas de madera y amatista encantada.'],
      ['bow', 'Arco de Diamante Estelar', 'Sus flechas dejan polvo de estrellas.'],
      ['bow', 'Arco Celestial del Alba', 'Dispara flechas de luz de arcoíris.'],
      ['bow', 'Arco de Cometa', 'Sus flechas dejan una cola plateada.'],
      ['bow', 'Arco de la Aurora', 'Dispara flechas de luz boreal.'],
    ],
    gnomo: [
      ['wand', 'Vara de Rama', 'Una ramita con una chispa en la punta.'],
      ['wand', 'Varita Mecánica de Cobre', 'Engranajes que giran al lanzar hechizos.'],
      ['crystalstaff', 'Báculo de Zafiro', 'El zafiro concentra el maná.'],
      ['launcher', 'Lanzapociones de Amatista', 'Dispara frascos burbujeantes.'],
      ['crystalstaff', 'Báculo de Diamante Estelar', 'Un diamante gira en su punta.'],
      ['crystalstaff', 'Báculo Prismático Celestial', 'Descompone la luz en todos los colores.'],
      ['crystalstaff', 'Báculo de Cometa', 'Un cometa diminuto gira en su punta.'],
      ['crystalstaff', 'Báculo de la Aurora', 'De su cristal salen ondas de luz boreal.'],
    ],
    hada: [
      ['scepter', 'Cetro de Rama', 'Una ramita con una estrellita.'],
      ['bell', 'Campanita de Cobre', 'Su tintineo calma a los heridos.'],
      ['book', 'Libro Flotante Azul', 'Sus páginas pasan solas.'],
      ['book', 'Libro Rúnico Morado', 'Las runas cantan al abrirlo.'],
      ['scepter', 'Cetro Estrella de Diamante', 'Una estrella de diamante late en la punta.'],
      ['bell', 'Campana Celestial', 'Su sonido se escucha en todo el cielo.'],
      ['scepter', 'Cetro de Cometa', 'Una estrella fugaz late en la punta.'],
      ['bell', 'Campana de la Aurora', 'Suena como el cielo del norte.'],
    ],
    lagarto: [
      ['longsword', 'Espada de Madera', 'Para entrenar… y para pelear de verdad.'],
      ['spear', 'Lanza de Cobre', 'Larga y con punta afilada de cobre.'],
      ['longsword', 'Espada Larga de Cristal Azul', 'Equilibrada y brillante.'],
      ['dualswords', 'Espadas Dobles de Amatista', 'Un par de hojas moradas muy rápidas.'],
      ['longsword', 'Espada de Diamante Estelar', 'Corta el aire con un silbido.'],
      ['longsword', 'Hoja Celestial del Dragón', 'Arde con fuego de arcoíris.'],
      ['longsword', 'Espada de Cometa', 'Corta con un destello plateado.'],
      ['longsword', 'Hoja de la Aurora', 'Brilla con luz verde y violeta.'],
    ],
  };
  // Martillos a dos manos (solo Oso Berserker): +35% de ataque
  const TWO_HANDED = [
    ['dorado', 'gran_martillo_tronador', 'Gran Martillo Tronador', 'Hace temblar la tierra.'],
    ['arcoiris', 'martillo_coloso', 'Martillo del Coloso', 'Solo un coloso puede levantarlo.'],
    ['aurora', 'martillo_boreal', 'Gran Martillo Boreal', 'Retumba como un trueno del norte.'],
  ];
  const ARMOR_NAMES = {
    HEAVY_PLATE: ['Peto de Tablas', 'Armadura de Cobre', 'Armadura de Cristal Azul', 'Armadura de Oro Encantado', 'Coraza de Diamante con Capa', 'Armadura Legendaria del Titán', 'Armadura de Cometa', 'Armadura de la Aurora'],
    MEDIUM_SCALE: ['Escamas de Corteza', 'Cota de Escamas de Cobre', 'Escamas de Cristal Azul', 'Escamas de Oro Encantado', 'Escamas de Diamante con Capa', 'Escamas Celestiales del Dragón', 'Escamas de Cometa', 'Escamas de la Aurora'],
    LIGHT_LEATHER: ['Chaleco de Hojas', 'Armadura de Cuero', 'Cuero de Cristal Azul', 'Cuero de Oro Encantado', 'Capa de Diamante del Explorador', 'Atuendo Celestial del Viento', 'Cuero de Cometa', 'Atuendo de la Aurora'],
    CLOTH_ROBE: ['Ropa de Tela Simple', 'Túnica de Cobre', 'Túnica de Cristal Azul', 'Túnica de Oro Encantado', 'Túnica de Diamante con Capa', 'Túnica Prismática Celestial', 'Túnica de Cometa', 'Túnica de la Aurora'],
    SACRED_ROBE: ['Vestido de Pétalos', 'Hábito de Cobre', 'Vestiduras de Cristal Azul', 'Vestiduras de Oro Encantado', 'Manto Sagrado de Diamante', 'Manto Celestial de las Estrellas', 'Manto de Cometa', 'Manto de la Aurora'],
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
      maxHp: Math.round((35 + 26 * lvl) * (boss ? def.hpMult || 6 : 1)),
      atk: (4 + 2.6 * lvl) * (boss ? 1.5 : 1),
      armor: 1 + 1.3 * lvl,
      xp: Math.round(14 * Math.pow(lvl, 1.4) * (boss ? 10 : 1)),
      gold: [lvl * 2 * (boss ? 25 : 1), lvl * 5 * (boss ? 25 : 1)],
    };
  }

  // ---------- Mundo ----------

  // ground: altura base a la que se aplana el terreno de la zona
  // trees: densidad de árboles; treeType: round | pine | giant | dead | none
  const ZONES = [
    { id: 'aldea', name: 'Aldea de los Bloques', x: 0, z: 0, r: 22, safe: true, tint: [0.5, 0.42, 0.3], desc: 'Tu hogar. Zona segura con cabañas, molinos y el Maestro de Clase. Los monstruos no entran y recuperas vida y maná más rápido.' },
    { id: 'praderas', name: 'Praderas de los Bloques', lvl: '1–5', x: 52, z: 18, r: 30, ground: 0.6, trees: 0.05, treeType: 'round', tint: [0.46, 0.62, 0.28], desc: 'Praderas verdes junto a la aldea, con molinos. Hongos, ovejas y cangrejos tranquilos: solo atacan si los provocas.' },
    { id: 'bosque', name: 'Bosque de Árboles Gigantes', lvl: '5–12', x: -58, z: 52, r: 34, ground: 1.2, trees: 0.42, treeType: 'giant', tint: [0.2, 0.38, 0.2], desc: 'Árboles colosales y setas brillantes. Lobos de madera, duendes traviesos y avispas de miel. Aquí despierta el Rey Tronco.' },
    { id: 'minas', name: 'Minas de Cristal y Engranajes', lvl: '12–20', x: 25, z: -98, r: 32, ground: 3, trees: 0, treeType: 'none', tint: [0.42, 0.38, 0.36], desc: 'Rocas naranjas, cristales y vías de vagonetas. Dentro está La Fábrica Descontrolada del Mega-Autómata 3000.' },
    { id: 'ciudadela', name: 'Ciudadela de Gludio-Cubo', lvl: '15+', x: -100, z: -60, r: 28, safe: true, hub: true, ground: 1, tint: [0.66, 0.64, 0.58], desc: 'Gran ciudad blanca de techos de colores. Mercader de grados altos, Herrero Celestial, Maestra de Clase, gremios, establo y portales.' },
    { id: 'valle', name: 'Valle de los Dragones Dormidos', lvl: '20–30', x: 110, z: -78, r: 34, ground: 1.5, trees: 0.06, treeType: 'dead', tint: [0.38, 0.26, 0.2], desc: 'Montañas volcánicas con lava de gelatina naranja y géiseres que te lanzan por los aires. Aquí duerme Ignis.' },
    { id: 'islas', name: 'Islas Flotantes del Cielo', lvl: '30–40+', x: 70, z: 118, r: 34, ground: 24, trees: 0.08, treeType: 'round', tint: [0.55, 0.75, 0.45], desc: 'Ruinas antiguas sobre las nubes, con puentes de arcoíris. Se llega por el portal de la Ciudadela. Hogar del Gran Guardián Celestial.' },
    // Tierras lejanas (desde la v0.31): dos aldeas nuevas y cinco zonas para los niveles 40–80
    { id: 'nevada', name: 'Villa Nevada', lvl: '40+', x: -60, z: 235, r: 22, safe: true, hub: true, village: true, ground: 1.6, tint: [0.86, 0.9, 0.96], snow: true, desc: 'Aldea de cabañas nevadas al norte. Zona segura con mercader, sanadora, portal y subastador. Puerta de la Tundra.' },
    { id: 'tundra', name: 'Tundra de los Muñecos de Nieve', lvl: '40–48', x: -185, z: 170, r: 36, ground: 2, trees: 0.12, treeType: 'snowpine', tint: [0.84, 0.88, 0.95], snow: true, desc: 'Llanuras nevadas con pinos blancos. Muñecos de nieve gruñones, pingüinos patinadores y yetis. Aquí reina la Reina de la Escarcha.' },
    { id: 'pantano', name: 'Pantano de las Luciérnagas', lvl: '48–56', x: -268, z: 15, r: 36, ground: 0.5, trees: 0.14, treeType: 'dead', tint: [0.24, 0.34, 0.2], desc: 'Charcos verdes y luciérnagas gigantes. Ranas saltarinas y plantas glotonas. En el fondo duerme la Hidra del Pantano.' },
    { id: 'desierto', name: 'Desierto de las Dunas Doradas', lvl: '56–64', x: -175, z: -210, r: 38, ground: 1.2, trees: 0.05, treeType: 'cactus', tint: [0.86, 0.72, 0.42], desc: 'Dunas, cactus y pirámides de bloques. Escarabajos dorados y momias dormilonas. La Gran Esfinge de Arena vigila su tesoro.' },
    { id: 'oasis', name: 'Oasis del Sol', lvl: '56+', x: 0, z: -258, r: 22, safe: true, hub: true, village: true, ground: 1, tint: [0.8, 0.7, 0.45], desc: 'Aldea de palmeras junto a un lago en el sur. Zona segura con mercader, sanador, la Herrera de la Aurora, portal y subastador.' },
    { id: 'canon', name: 'Cañón de Cristal Prismático', lvl: '64–72', x: 170, z: -205, r: 36, ground: 3, trees: 0, treeType: 'none', tint: [0.52, 0.42, 0.6], desc: 'Paredes de roca violeta llenas de cristales de colores. Gólems de cristal y dragoncitos prisma. Aquí brilla el Coloso Prismático.' },
    { id: 'eclipse', name: 'Ruinas del Eclipse', lvl: '72–80', x: 262, z: -40, r: 38, ground: 1.5, trees: 0.05, treeType: 'dead', tint: [0.3, 0.26, 0.4], desc: 'Ruinas bajo un cielo de luna eterna. Caballeros sombra y gárgolas lunares. El Rey del Eclipse espera a los héroes de nivel 80.' },
  ];

  // Arenas de jefes: botones de la Fábrica, rocas para esconderse de Ignis
  const ring = (cx, cz, r, n, a0 = 0) => Array.from({ length: n }, (_, i) => ({ x: cx + Math.cos(a0 + (i / n) * Math.PI * 2) * r, z: cz + Math.sin(a0 + (i / n) * Math.PI * 2) * r }));
  const ARENAS = {
    fabrica: { name: 'La Fábrica Descontrolada', x: 30, z: -108, r: 12, plates: ring(30, -108, 8.5, 3, Math.PI / 2) },
    ignis: { name: 'Nido de Ignis', x: 124, z: -88, r: 15, shelters: ring(124, -88, 9, 5, 0.3) },
    guardian: { name: 'Templo Estelar', x: 76, z: 128, r: 13 },
    escarcha: { name: 'Palacio de Hielo', x: -196, z: 182, r: 13 },
    charca: { name: 'Charca de la Hidra', x: -280, z: 22, r: 14 },
    piramide: { name: 'Patio de la Pirámide', x: -186, z: -222, r: 14 },
    espejo: { name: 'Salón de los Espejos', x: 178, z: -216, r: 13 },
    eclipse: { name: 'Altar del Eclipse', x: 276, z: -44, r: 15 },
  };

  // kind: forma del modelo (quad, hum, mush, crab, bug, bat, slime, orb)
  // Botín: [id, probabilidad, [cantidad mín, máx]]. '@w:grado' = arma de ese grado para la raza
  // de quien lo recibe; '@a:grado' = armadura. onHit: estado que pueden causar al golpear
  // (poison/burn: % de su ataque por segundo; slow: segundos de lentitud).
  // Jefes: hpMult (vida extra), at (dónde aparece), mech (mecánica especial).
  const MOBS = {
    // 1. Praderas de los Bloques (1–5): pacíficos
    hongo: {
      name: 'Hongo Saltarín', kind: 'mush', lvl: [1, 2], zone: 'praderas', count: 10,
      color: 0xd84a3a, body: 0xf0e6d0, scale: 0.9, aggressive: false, speed: 3.6,
      drops: [['seta', 0.55], ['pocion_vida', 0.12], ['gema_poder', 0.25, [2, 5]], ['@w:madera', 0.03], ['@a:madera', 0.05]],
    },
    oveja: {
      name: 'Oveja Cubo', kind: 'quad', lvl: [2, 3], zone: 'praderas', count: 10,
      color: 0xf4f0e6, head: 0x3a3430, wool: true, scale: 0.85, aggressive: false, speed: 4.2,
      drops: [['lana', 0.55], ['pocion_vida', 0.12], ['gema_poder', 0.25, [2, 5]], ['@w:madera', 0.03], ['@a:madera', 0.05]],
    },
    cangrejo: {
      name: 'Cangrejo de Río', kind: 'crab', lvl: [3, 5], zone: 'praderas', count: 9,
      color: 0xd8643a, scale: 0.9, aggressive: false, speed: 4.4,
      drops: [['pinza', 0.5], ['pocion_vida', 0.15], ['pocion_mana', 0.1], ['gema_poder', 0.3, [3, 6]], ['@w:cobre', 0.02], ['@a:madera', 0.05]],
    },
    // 2. Bosque de Árboles Gigantes (5–12)
    lobo_madera: {
      name: 'Lobo de Madera', kind: 'quad', lvl: [5, 7], zone: 'bosque', count: 10,
      color: 0x8a6a46, scale: 0.95, aggressive: true, speed: 5.6,
      onHit: { slow: 2, chance: 0.2 },
      drops: [['corteza', 0.5], ['pocion_vida', 0.18], ['pocion_mana', 0.12], ['gema_poder', 0.3, [4, 8]], ['@w:cobre', 0.05], ['@a:cobre', 0.04]],
    },
    duende: {
      name: 'Duende Travieso', kind: 'hum', lvl: [7, 9], zone: 'bosque', count: 10,
      skin: 0x8ac04a, body: 0x3f7a3a, legs: 0x5a3d22, hat: 0xd84a3a, ears: true, scale: 0.65, aggressive: true, speed: 5.6,
      weaponColor: 0x8d8a80,
      drops: [['gorro_duende', 0.45], ['pocion_vida', 0.2], ['pocion_mana', 0.15], ['gema_poder', 0.3, [4, 8]], ['@w:cobre', 0.05], ['@a:cobre', 0.05]],
    },
    avispa: {
      name: 'Avispa de Miel', kind: 'bug', lvl: [9, 11], zone: 'bosque', count: 9,
      color: 0xf2c13a, stripe: 0x2a2119, scale: 0.9, aggressive: true, speed: 6,
      onHit: { poison: { pct: 0.3, dur: 4 }, chance: 0.3 },
      drops: [['miel', 0.45], ['pocion_vida', 0.2], ['pocion_mana', 0.15], ['gema_poder', 0.35, [5, 10]], ['@w:cobre', 0.04], ['@w:azul', 0.015], ['@a:azul', 0.015]],
    },
    rey_tronco: {
      name: 'Rey Tronco', kind: 'hum', lvl: [12, 12], zone: 'bosque', count: 1, boss: true, world: true, respawn: 300, hpMult: 8,
      at: { x: -62, z: 60 }, treeKing: true, skin: 0x6b4a2e, body: 0x5a3d22, legs: 0x4a3020, crown: 0x4f7a34, glow: 0xb6ff5a, scale: 2.8, weapon: false, aggressive: true, speed: 3.8,
      mech: { type: 'roots', every: 7, count: 4, r: 3, delay: 1.6, dmg: 0.3, root: 2 },
      drops: [['savia_real', 1, [1, 2]], ['gema_poder', 1, [15, 25]], ['@w:cobre', 0.5], ['@a:cobre', 0.5], ['@w:azul', 0.25], ['@a:azul', 0.25], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
    // 3. Minas de Cristal y Engranajes (12–20)
    murcielago: {
      name: 'Murciélago de Cristal', kind: 'bat', lvl: [12, 14], zone: 'minas', count: 10,
      color: 0x5a6a8a, glow: 0x9fd8ff, scale: 0.9, aggressive: true, speed: 6.2,
      drops: [['cristal_murcielago', 0.45], ['pocion_vida', 0.22], ['pocion_mana', 0.18], ['gema_poder', 0.35, [6, 12]], ['@w:azul', 0.04], ['@a:azul', 0.04]],
    },
    slime: {
      name: 'Slime de Cobre', kind: 'slime', lvl: [14, 16], zone: 'minas', count: 10,
      color: 0xd8843a, scale: 1, aggressive: true, speed: 4,
      onHit: { slow: 2.5, chance: 0.3 },
      drops: [['gel_cobre', 0.45], ['pocion_vida', 0.22], ['pocion_mana', 0.18], ['gema_poder', 0.35, [6, 12]], ['@w:azul', 0.04], ['@a:azul', 0.04]],
    },
    golem_piedra: {
      name: 'Gólem de Piedra Pequeño', kind: 'hum', lvl: [16, 19], zone: 'minas', count: 9,
      skin: 0x8a8478, body: 0x77716a, legs: 0x5f5a54, glow: 0x9fd8ff, scale: 1.05, weapon: false, aggressive: true, speed: 4.6,
      drops: [['engranaje', 0.45], ['pocion_vida', 0.25], ['pocion_mana', 0.2], ['gema_poder', 0.4, [6, 12]], ['@w:azul', 0.05], ['@a:azul', 0.05], ['@w:morado', 0.01]],
    },
    mega_automata: {
      name: 'Mega-Autómata 3000', kind: 'hum', lvl: [18, 18], zone: 'minas', count: 1, boss: true, dungeon: 'fabrica', respawn: 300, hpMult: 10,
      at: { x: 30, z: -108 }, robot: true, skin: 0x9aa0aa, body: 0xb5703f, legs: 0x5f5a54, glow: 0xff5a3a, scale: 2.6, weapon: false, aggressive: true, speed: 3.6,
      mech: { type: 'plates', open: 12, lit: 6 },
      drops: [['chip_automata', 1, [1, 2]], ['gema_poder', 1, [20, 30]], ['@w:azul', 0.6], ['@a:azul', 0.6], ['@w:morado', 0.15], ['@a:morado', 0.15], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
    // 5. Valle de los Dragones Dormidos (20–30)
    lagarto_fuego: {
      name: 'Lagarto de Fuego', kind: 'quad', lvl: [20, 23], zone: 'valle', count: 10,
      color: 0xd8643a, scale: 1, aggressive: true, speed: 5.4, tail: true,
      onHit: { burn: { pct: 0.3, dur: 4 }, chance: 0.25 },
      drops: [['escama_fuego', 0.45], ['pocion_vida', 0.25], ['pocion_mana', 0.2], ['gema_poder', 0.4, [8, 14]], ['@w:morado', 0.03], ['@a:morado', 0.03]],
    },
    salamandra: {
      name: 'Salamandra Cubo', kind: 'quad', lvl: [23, 26], zone: 'valle', count: 10,
      color: 0x2f2a28, mane: true, maneColor: 0xff8a3d, scale: 0.85, aggressive: true, speed: 6.2, tail: true,
      drops: [['cola_salamandra', 0.45], ['pocion_vida', 0.25], ['pocion_mana', 0.2], ['gema_poder', 0.4, [8, 14]], ['@w:morado', 0.03], ['@a:morado', 0.03], ['@w:dorado', 0.006]],
    },
    golem_magma: {
      name: 'Gólem de Magma', kind: 'hum', lvl: [26, 29], zone: 'valle', count: 9,
      skin: 0x3a2a24, body: 0x2a1f1a, legs: 0x241a16, glow: 0xff6a2a, scale: 1.5, weapon: false, aggressive: true, speed: 4.4,
      onHit: { burn: { pct: 0.3, dur: 4 }, chance: 0.3 },
      drops: [['nucleo_magma', 0.45], ['pocion_vida', 0.28], ['pocion_mana', 0.22], ['gema_poder', 0.45, [10, 16]], ['@w:morado', 0.04], ['@a:morado', 0.04], ['@w:dorado', 0.01], ['@a:dorado', 0.01]],
    },
    ignis: {
      name: 'Ignis, el Dragón Dormilón', kind: 'quad', lvl: [28, 28], zone: 'valle', count: 1, boss: true, raid: true, respawn: 600, hpMult: 25,
      at: { x: 124, z: -88 }, color: 0xc8402a, dragon: true, scale: 3.2, aggressive: true, speed: 4.5,
      mech: { type: 'yawn', every: 14, warn: 2.8, dmg: 0.7, r: 22, burn: { pct: 0.5, dur: 5 } },
      drops: [['colmillo_ignis', 1, [1, 2]], ['gema_poder', 1, [30, 45]], ['@w:morado', 0.5], ['@a:morado', 0.5], ['@w:dorado', 0.15], ['@a:dorado', 0.15], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
    // 6. Islas Flotantes del Cielo (30–40+)
    caballero_nube: {
      name: 'Caballero Nube', kind: 'hum', lvl: [30, 33], zone: 'islas', count: 10,
      skin: 0xf0eee8, body: 0xe8f0ff, legs: 0xc9d4e2, cape: 0x9fd8ff, glow: 0x9fd8ff, weaponColor: 0xe8f0ff, scale: 1.15, aggressive: true, speed: 5.4,
      drops: [['pluma_nube', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.45, [10, 18]], ['@w:dorado', 0.02], ['@a:dorado', 0.02]],
    },
    elemental: {
      name: 'Elemental de Estrella', kind: 'orb', lvl: [33, 36], zone: 'islas', count: 9,
      color: 0xffe08a, scale: 1, aggressive: true, speed: 5,
      drops: [['polvo_estelar', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.45, [10, 18]], ['@w:dorado', 0.02], ['@a:dorado', 0.02], ['polvo_arcoiris', 0.04]],
    },
    grifo: {
      name: 'Grifo Cubo', kind: 'quad', lvl: [36, 39], zone: 'islas', count: 9,
      color: 0xc9a46a, wings: true, beak: true, scale: 1.2, aggressive: true, speed: 6,
      drops: [['pluma_grifo', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [12, 20]], ['@w:dorado', 0.03], ['@a:dorado', 0.03], ['polvo_arcoiris', 0.06]],
    },
    guardian: {
      name: 'Gran Guardián Celestial', kind: 'hum', lvl: [40, 40], zone: 'islas', count: 1, boss: true, raid: true, respawn: 900, hpMult: 30,
      at: { x: 76, z: 128 }, halo: true, skin: 0xf6f0e0, body: 0xffe9a0, legs: 0xd9b25f, cape: 0xffffff, glow: 0xfff0a0, weaponColor: 0xfff0c0, scale: 3, aggressive: true, speed: 4.6,
      mech: { type: 'stars', every: 8, count: 6, r: 3.5, delay: 1.8, dmg: 0.35, adds: { key: 'elemental', count: 3, at: 0.5 } },
      drops: [['polvo_arcoiris', 1, [8, 15]], ['gema_poder', 1, [40, 60]], ['@w:dorado', 0.5], ['@a:dorado', 0.5], ['@w:arcoiris', 0.15], ['@a:arcoiris', 0.15], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
    // 7. Tundra de los Muñecos de Nieve (40–48)
    muneco_nieve: {
      name: 'Muñeco de Nieve Gruñón', kind: 'hum', lvl: [40, 43], zone: 'tundra', count: 10,
      skin: 0xf4f8ff, body: 0xeef4fc, legs: 0xdfe8f4, hat: 0x2a2c34, glow: 0x9fd8ff, scale: 1.2, weapon: false, aggressive: true, speed: 4.6,
      onHit: { slow: 2.5, chance: 0.25 },
      drops: [['bufanda', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [12, 20]], ['@w:arcoiris', 0.012], ['@a:arcoiris', 0.012], ['polvo_arcoiris', 0.08]],
    },
    pinguino: {
      name: 'Pingüino Patinador', kind: 'hum', lvl: [42, 45], zone: 'tundra', count: 10,
      skin: 0x2a2c34, body: 0xf4f0e6, legs: 0x2a2c34, scale: 0.8, weapon: false, aggressive: true, speed: 6.6,
      drops: [['copo_eterno', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [12, 20]], ['@w:arcoiris', 0.012], ['@a:arcoiris', 0.012], ['polvo_arcoiris', 0.08]],
    },
    yeti: {
      name: 'Yeti Cúbico', kind: 'quad', lvl: [45, 48], zone: 'tundra', count: 9,
      color: 0xf4f6fa, head: 0x9fb4c8, wool: true, scale: 1.45, aggressive: true, speed: 5.2,
      drops: [['cuerno_yeti', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [14, 22]], ['@w:arcoiris', 0.015], ['@a:arcoiris', 0.015], ['polvo_arcoiris', 0.1]],
    },
    reina_escarcha: {
      name: 'Reina de la Escarcha', kind: 'hum', lvl: [48, 48], zone: 'tundra', count: 1, boss: true, raid: true, respawn: 900, hpMult: 30,
      at: { x: -196, z: 182 }, halo: true, skin: 0xdff4ff, body: 0x9fd8ff, legs: 0x6fa8d8, cape: 0xeef8ff, glow: 0xbfeaff, weaponColor: 0xdff4ff, scale: 2.9, aggressive: true, speed: 4.4,
      mech: { type: 'freeze', every: 11, warn: 2.6, dmg: 0.35, stun: 3, r: 24 },
      drops: [['corona_escarcha', 1, [1, 2]], ['polvo_arcoiris', 1, [6, 12]], ['gema_poder', 1, [45, 65]], ['@w:arcoiris', 0.35], ['@a:arcoiris', 0.35], ['@w:cometa', 0.08], ['@a:cometa', 0.08], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
    // 8. Pantano de las Luciérnagas (48–56)
    rana: {
      name: 'Rana Cubo Saltarina', kind: 'slime', lvl: [48, 51], zone: 'pantano', count: 10,
      color: 0x5ab04a, scale: 1.25, aggressive: true, speed: 5.6,
      onHit: { poison: { pct: 0.3, dur: 4 }, chance: 0.3 },
      drops: [['anca_rana', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [14, 22]], ['@w:arcoiris', 0.015], ['@a:arcoiris', 0.015], ['polvo_arcoiris', 0.1]],
    },
    luciernaga: {
      name: 'Luciérnaga Gigante', kind: 'orb', lvl: [50, 53], zone: 'pantano', count: 10,
      color: 0xd8ff6a, scale: 0.9, aggressive: true, speed: 6,
      drops: [['frasco_luz', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [14, 22]], ['@w:arcoiris', 0.015], ['@a:arcoiris', 0.015], ['polvo_arcoiris', 0.1]],
    },
    glotona: {
      name: 'Planta Glotona', kind: 'mush', lvl: [53, 56], zone: 'pantano', count: 9,
      color: 0xd84a8a, body: 0x4f8a34, scale: 1.4, aggressive: true, speed: 3.6,
      onHit: { slow: 2, chance: 0.3 },
      drops: [['petalo_glotona', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [16, 24]], ['@w:cometa', 0.01], ['@a:cometa', 0.01], ['polvo_arcoiris', 0.12]],
    },
    hidra: {
      name: 'Hidra del Pantano', kind: 'quad', lvl: [56, 56], zone: 'pantano', count: 1, boss: true, raid: true, respawn: 900, hpMult: 32,
      at: { x: -280, z: 22 }, color: 0x3f7a5a, dragon: true, tail: true, scale: 3.1, aggressive: true, speed: 4.2,
      mech: { type: 'puddles', every: 9, count: 4, r: 3.2, delay: 1.5, life: 9, dps: 0.06, poison: { pct: 0.35, dur: 4 } },
      drops: [['escama_hidra', 1, [1, 2]], ['polvo_arcoiris', 1, [8, 14]], ['gema_poder', 1, [50, 70]], ['@w:cometa', 0.3], ['@a:cometa', 0.3], ['fragmento_aurora', 0.5, [1, 2]], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
    // 9. Desierto de las Dunas Doradas (56–64)
    escarabajo: {
      name: 'Escarabajo Dorado', kind: 'bug', lvl: [56, 59], zone: 'desierto', count: 10,
      color: 0xe0b040, stripe: 0x5a3d22, scale: 1.1, aggressive: true, speed: 6,
      drops: [['caparazon_oro', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [16, 24]], ['@w:cometa', 0.012], ['@a:cometa', 0.012], ['fragmento_aurora', 0.02]],
    },
    momia: {
      name: 'Momia Dormilona', kind: 'hum', lvl: [59, 62], zone: 'desierto', count: 10,
      skin: 0xe8dcc0, body: 0xd8ccb0, legs: 0xc8bca0, glow: 0x7fe0b0, scale: 1.15, weapon: false, aggressive: true, speed: 4.4,
      onHit: { slow: 2.5, chance: 0.25 },
      drops: [['venda_momia', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [16, 24]], ['@w:cometa', 0.012], ['@a:cometa', 0.012], ['fragmento_aurora', 0.02]],
    },
    cactus: {
      name: 'Cactus Saltarín', kind: 'mush', lvl: [61, 64], zone: 'desierto', count: 9,
      color: 0x4f9a3a, body: 0x6ab04a, scale: 1.2, aggressive: true, speed: 5,
      onHit: { poison: { pct: 0.3, dur: 4 }, chance: 0.25 },
      drops: [['espina_cactus', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [18, 26]], ['@w:cometa', 0.015], ['@a:cometa', 0.015], ['fragmento_aurora', 0.03]],
    },
    esfinge: {
      name: 'Gran Esfinge de Arena', kind: 'quad', lvl: [64, 64], zone: 'desierto', count: 1, boss: true, raid: true, respawn: 900, hpMult: 34,
      at: { x: -186, z: -222 }, color: 0xd9b25f, head: 0x3a6ad8, mane: true, maneColor: 0x3a6ad8, wings: true, scale: 3.2, aggressive: true, speed: 4.4,
      mech: { type: 'vortex', every: 13, warn: 2.4, dur: 3.5, pull: 4.5, r: 22, core: 5, dps: 0.12 },
      drops: [['ojo_esfinge', 1, [1, 2]], ['gema_poder', 1, [55, 75]], ['@w:cometa', 0.4], ['@a:cometa', 0.4], ['@w:aurora', 0.06], ['@a:aurora', 0.06], ['fragmento_aurora', 1, [2, 3]], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
    // 10. Cañón de Cristal Prismático (64–72)
    golem_cristal: {
      name: 'Gólem de Cristal', kind: 'hum', lvl: [64, 67], zone: 'canon', count: 10,
      skin: 0xb98cff, body: 0x8a6ad8, legs: 0x6a4ab0, glow: 0xe0c0ff, scale: 1.4, weapon: false, aggressive: true, speed: 4.4,
      drops: [['cristal_prisma', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [18, 26]], ['@w:cometa', 0.015], ['@a:cometa', 0.015], ['fragmento_aurora', 0.04]],
    },
    dragoncito: {
      name: 'Dragoncito Prisma', kind: 'quad', lvl: [67, 70], zone: 'canon', count: 10,
      color: 0x7fd0ff, wings: true, tail: true, scale: 1.1, aggressive: true, speed: 6.2,
      onHit: { burn: { pct: 0.3, dur: 4 }, chance: 0.25 },
      drops: [['escama_prisma', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [18, 28]], ['@w:cometa', 0.015], ['@a:cometa', 0.015], ['fragmento_aurora', 0.05]],
    },
    espiritu_prisma: {
      name: 'Espíritu Prismático', kind: 'orb', lvl: [69, 72], zone: 'canon', count: 9,
      color: 0xff9ad5, scale: 1.15, aggressive: true, speed: 5.4,
      drops: [['chispa_prisma', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [20, 30]], ['@w:aurora', 0.006], ['@a:aurora', 0.006], ['fragmento_aurora', 0.06]],
    },
    coloso: {
      name: 'Coloso Prismático', kind: 'hum', lvl: [72, 72], zone: 'canon', count: 1, boss: true, raid: true, respawn: 900, hpMult: 36,
      at: { x: 178, z: -216 }, robot: true, skin: 0xd8c0ff, body: 0x8a6ad8, legs: 0x5a4ab0, glow: 0xff9ad5, scale: 3.1, weapon: false, aggressive: true, speed: 4.2,
      mech: { type: 'mirror', every: 12, warn: 1.6, dur: 4, reflect: 0.08, count: 5, r: 3, delay: 1.6, dmg: 0.3 },
      drops: [['nucleo_coloso', 1, [1, 2]], ['gema_poder', 1, [60, 80]], ['@w:cometa', 0.4], ['@a:cometa', 0.4], ['@w:aurora', 0.1], ['@a:aurora', 0.1], ['fragmento_aurora', 1, [3, 4]], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
    // 11. Ruinas del Eclipse (72–80)
    caballero_sombra: {
      name: 'Caballero Sombra', kind: 'hum', lvl: [72, 75], zone: 'eclipse', count: 10,
      skin: 0x3a3450, body: 0x2a2440, legs: 0x1f1a30, cape: 0x5a3a8a, glow: 0xb98cff, weaponColor: 0x8a6ad8, scale: 1.2, aggressive: true, speed: 5.4,
      drops: [['emblema_sombra', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [20, 30]], ['@w:aurora', 0.008], ['@a:aurora', 0.008], ['fragmento_aurora', 0.07]],
    },
    murcielago_luna: {
      name: 'Murciélago Lunar', kind: 'bat', lvl: [74, 77], zone: 'eclipse', count: 10,
      color: 0x4a4a6a, glow: 0xeef0ff, scale: 1.1, aggressive: true, speed: 6.4,
      onHit: { slow: 2, chance: 0.25 },
      drops: [['ala_lunar', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [20, 30]], ['@w:aurora', 0.008], ['@a:aurora', 0.008], ['fragmento_aurora', 0.08]],
    },
    gargola: {
      name: 'Gárgola Lunar', kind: 'quad', lvl: [77, 80], zone: 'eclipse', count: 9,
      color: 0x6a6a7a, wings: true, beak: true, scale: 1.4, aggressive: true, speed: 5.6,
      drops: [['piedra_lunar', 0.45], ['pocion_vida', 0.3], ['pocion_mana', 0.25], ['gema_poder', 0.5, [22, 32]], ['@w:aurora', 0.01], ['@a:aurora', 0.01], ['fragmento_aurora', 0.1]],
    },
    rey_eclipse: {
      name: 'Rey del Eclipse', kind: 'hum', lvl: [80, 80], zone: 'eclipse', count: 1, boss: true, raid: true, respawn: 1200, hpMult: 42,
      at: { x: 276, z: -44 }, crown: 0xffd36b, skin: 0x2a2440, body: 0x1f1a30, legs: 0x151022, cape: 0x8a55c8, glow: 0xffe08a, weaponColor: 0xffe08a, scale: 3.3, aggressive: true, speed: 4.6,
      mech: { type: 'eclipse', every: 15, warn: 3.2, dmg: 0.6, safe: 4.5, adds: { key: 'caballero_sombra', count: 3, at: 0.5 } },
      drops: [['corona_eclipse', 1, [1, 2]], ['gema_poder', 1, [70, 100]], ['@w:aurora', 0.35], ['@a:aurora', 0.35], ['fragmento_aurora', 1, [5, 8]], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
  };
  // Altura de cada forma de monstruo (para nombres, proyectiles y selección)
  const MOB_H = { quad: 1.5, hum: 2.5, mush: 1.3, crab: 0.9, bug: 1.8, bat: 2.2, slime: 1.1, orb: 2 };
  const mobHeight = (def) => (MOB_H[def.kind] || 1.5) * (def.scale || 1);
  // Nivel de monstruo más alto (sin jefes) y jefe más fuerte: lo usan las misiones de cambio de clase
  const TOP_MOB_LVL = Math.max(...Object.values(MOBS).filter((m) => !m.boss).map((m) => m.lvl[1]));
  // Jefe de la misión de la Ascensión Maestra: el más fuerte que no pasa del nivel 40 (esa etapa)
  const TOP_BOSS = Object.entries(MOBS)
    .filter(([, m]) => m.boss && m.lvl[1] <= 40)
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

  // Frases rápidas del chat seguro: siempre se pueden enviar, sin escribir
  // ---------- Gremios ----------
  const GUILD_LVL = 15; // nivel para fundar un gremio
  const GUILD_COST = 1000; // oro para fundarlo
  const GUILD_MAX = 30; // miembros como máximo
  const GUILD_RANKS = ['Miembro', 'Oficial', 'Líder'];
  // Emblemas y colores fijos (sin imágenes subidas: siempre apropiados para niños)
  const GUILD_EMBLEMS = ['⚔', '🛡', '🐉', '🦉', '🐻', '⭐', '🍄', '🌙', '🔥', '🌊', '🍀', '👑', '🦊', '🐢', '🌈', '💎'];
  const GUILD_COLORS = ['#e05a4a', '#e8963a', '#e6cf4a', '#6cc46a', '#3fbfa8', '#4aa8e0', '#6a7ae6', '#a46ae0', '#e06ab0', '#d9d4c7'];

  const PHRASES = [
    { id: 'hola', text: '¡Hola! 👋' },
    { id: 'grupo', text: '¿Hacemos grupo?' },
    { id: 'ayuda', text: '¡Ayuda, por favor!' },
    { id: 'sigueme', text: '¡Sígueme!' },
    { id: 'espera', text: 'Espera un momento ⏳' },
    { id: 'jefe', text: '¡Vamos por el jefe!' },
    { id: 'curame', text: '¿Me curas? ❤️' },
    { id: 'gracias', text: '¡Gracias! 😊' },
    { id: 'bien', text: '¡Buen trabajo! ⭐' },
    { id: 'si', text: 'Sí 👍' },
    { id: 'no', text: 'No, gracias' },
    { id: 'adios', text: '¡Adiós, hasta pronto!' },
    { id: 'curacion', text: '¡Necesito curación! 💚' },
    { id: 'equipo', text: '¡Buen equipo! 🤝' },
    { id: 'secreto', text: '¡Aquí hay un secreto! ✨' },
  ];

  // ---------- Gestos (sistema de emotes) ----------
  const EMOTES = [
    { id: 'saludar', name: 'Saludar', icon: '👋', dur: 2.4 },
    { id: 'aplaudir', name: 'Aplaudir', icon: '👏', dur: 2.4 },
    { id: 'animar', name: 'Animar', icon: '📣', dur: 2.6 },
    { id: 'bailar', name: 'Bailar', icon: '🎵', dur: 5 },
    { id: 'celebrar', name: 'Celebrar', icon: '🎉', dur: 3.7 },
    { id: 'sentarse', name: 'Sentarse', icon: '🪑', dur: 0 }, // hasta que se mueva
  ];
  const EMOTE_CD = 3; // segundos entre gestos (anti-spam)

  // ---------- Álbum de coleccionables ----------
  // Se arma solo a partir de los datos: monstruos por tierra, jefes, tierras, botín que de verdad
  // sueltan los monstruos y gestos. Cada colección completa da oro, objetos y un título.
  // (Se completa más abajo, cuando ya existen MOBS, ZONES e ITEMS.)
  let ALBUM = null;
  function albumData() {
    if (ALBUM) return ALBUM;
    const mobsIn = (zone) => Object.keys(MOBS).filter((k) => MOBS[k].zone === zone && !MOBS[k].boss);
    const lootIds = [...new Set(Object.values(MOBS).flatMap((m) => m.drops.map((d) => d[0])))].filter((id) => !id.startsWith('@') && ITEMS[id] && ['junk', 'material'].includes(ITEMS[id].type));
    const sets = [
      { id: 'praderas', cat: 'mobs', name: 'Criaturas de las Praderas', items: mobsIn('praderas'), gold: 150, give: [['pocion_vida', 5]], title: 'Amigo de las Praderas' },
      { id: 'bosque', cat: 'mobs', name: 'Criaturas del Bosque', items: mobsIn('bosque'), gold: 400, give: [['pocion_vida', 8]], title: 'Guardabosques' },
      { id: 'minas', cat: 'mobs', name: 'Criaturas de las Minas', items: mobsIn('minas'), gold: 800, give: [['gema_poder', 10]], title: 'Minero Valiente' },
      { id: 'valle', cat: 'mobs', name: 'Criaturas del Valle', items: mobsIn('valle'), gold: 1500, give: [['gema_poder', 15]], title: 'Amigo de los Dragones' },
      { id: 'islas', cat: 'mobs', name: 'Criaturas del Cielo', items: mobsIn('islas'), gold: 3000, give: [['gema_poder', 20]], title: 'Héroe del Cielo' },
      { id: 'jefes', cat: 'mobs', name: 'Grandes Jefes', items: Object.keys(MOBS).filter((k) => MOBS[k].boss), gold: 5000, give: [['gema_poder', 30]], title: 'Cazajefes' },
      { id: 'tierras', cat: 'zones', name: 'Tierras de Valdoria', items: ZONES.map((z) => z.id), gold: 1000, give: [['pocion_mana', 10]], title: 'Gran Explorador' },
      { id: 'botin', cat: 'items', name: 'Tesoros y Botín', items: lootIds, gold: 2000, give: [['gema_poder', 20]], title: 'Coleccionista' },
      { id: 'gestos', cat: 'emotes', name: 'Gestos', items: EMOTES.map((e) => e.id), gold: 200, give: [['pocion_vida', 3]], title: 'Alma Expresiva' },
    ].filter((s) => s.items.length);
    ALBUM = { sets, cats: { mobs: 'Criaturas', zones: 'Tierras', items: 'Objetos', emotes: 'Gestos' } };
    return ALBUM;
  }

  // ---------- Ayudante de Novatos (Puntos de Amistad) ----------
  const MENTOR = { gap: 10, boss: 10, quest: 5, killsPerPoint: 5, dailyCap: 50 };

  // ---------- Tienda de Amistad: pociones cosméticas, estelas y títulos ----------
  // Se pagan con Puntos de Amistad (p.ext.mentor.pts). Son solo de adorno: no cambian estadísticas.
  //  - potion: se bebe al comprarla y dura `dur` segundos jugados (color, tamaño o aura).
  //  - trail: estela de partículas al caminar; se compra una vez y se activa o quita cuando quieras.
  //  - title: texto que aparece sobre el nombre; se compra una vez.
  const POTION_SECS = 600;
  const FRIEND_SHOP = [
    { id: 'poc_rosa', kind: 'potion', fx: 'color', color: 0xff7ab8, name: 'Poción Rosa Chicle', icon: '🧪', price: 5, dur: POTION_SECS, desc: 'Te tiñe de rosa chicle.' },
    { id: 'poc_azul', kind: 'potion', fx: 'color', color: 0x5aa9ff, name: 'Poción Azul Cielo', icon: '🧪', price: 5, dur: POTION_SECS, desc: 'Te tiñe de azul cielo.' },
    { id: 'poc_verde', kind: 'potion', fx: 'color', color: 0x6fdc6a, name: 'Poción Verde Hoja', icon: '🧪', price: 5, dur: POTION_SECS, desc: 'Te tiñe de verde hoja.' },
    { id: 'poc_dorada', kind: 'potion', fx: 'color', color: 0xffd04a, name: 'Poción Dorada', icon: '🧪', price: 8, dur: POTION_SECS, desc: 'Brillas como el oro.' },
    { id: 'poc_gigante', kind: 'potion', fx: 'size', scale: 1.35, name: 'Poción de Gigante', icon: '⬆️', price: 8, dur: POTION_SECS, desc: 'Te haces grandote.' },
    { id: 'poc_mini', kind: 'potion', fx: 'size', scale: 0.7, name: 'Poción Minúscula', icon: '⬇️', price: 8, dur: POTION_SECS, desc: 'Te haces chiquito.' },
    { id: 'poc_estrellas', kind: 'potion', fx: 'aura', aura: 'estrellas', color: 0xffe36b, name: 'Aura de Estrellas', icon: '⭐', price: 10, dur: POTION_SECS, desc: 'Estrellitas dan vueltas a tu alrededor.' },
    { id: 'poc_corazones', kind: 'potion', fx: 'aura', aura: 'corazones', color: 0xff6f9c, name: 'Aura de Corazones', icon: '💗', price: 10, dur: POTION_SECS, desc: 'Corazoncitos flotan a tu alrededor.' },
    { id: 'poc_burbujas', kind: 'potion', fx: 'aura', aura: 'burbujas', color: 0x9fe8ff, name: 'Aura de Burbujas', icon: '🫧', price: 10, dur: POTION_SECS, desc: 'Burbujas suben a tu alrededor.' },
    { id: 'est_chispas', kind: 'trail', shape: 'chispas', colors: [0xffe36b, 0xfff3b0], name: 'Estela de Chispas', icon: '✨', price: 15, desc: 'Chispitas doradas tras tus pasos.' },
    { id: 'est_burbujas', kind: 'trail', shape: 'burbujas', colors: [0x9fe8ff, 0xd6f6ff], name: 'Estela de Burbujas', icon: '🫧', price: 15, desc: 'Burbujas que suben al caminar.' },
    { id: 'est_hojas', kind: 'trail', shape: 'hojas', colors: [0x6fdc6a, 0xa8e86a, 0xffb74a], name: 'Estela de Hojas', icon: '🍃', price: 15, desc: 'Hojitas que caen a tu paso.' },
    { id: 'est_corazones', kind: 'trail', shape: 'corazones', colors: [0xff6f9c, 0xff9ec0], name: 'Estela de Corazones', icon: '💗', price: 20, desc: 'Corazoncitos por donde pasas.' },
    { id: 'est_nieve', kind: 'trail', shape: 'nieve', colors: [0xffffff, 0xd6ecff], name: 'Estela de Copos', icon: '❄️', price: 20, desc: 'Copos de nieve a tu paso.' },
    { id: 'est_arcoiris', kind: 'trail', shape: 'arcoiris', colors: [], name: 'Estela Arcoíris', icon: '🌈', price: 30, desc: 'Cubitos que cambian de color.' },
    { id: 'tit_amigo', kind: 'title', text: 'Amigo de Todos', name: 'Título «Amigo de Todos»', icon: '🤝', price: 20, desc: 'Un título sobre tu nombre.' },
    { id: 'tit_mano', kind: 'title', text: 'Mano Amiga', name: 'Título «Mano Amiga»', icon: '🖐️', price: 30, desc: 'Un título sobre tu nombre.' },
    { id: 'tit_mentor', kind: 'title', text: 'Gran Mentor', name: 'Título «Gran Mentor»', icon: '🎓', price: 60, desc: 'Un título sobre tu nombre.' },
  ];
  const friendItem = (id) => FRIEND_SHOP.find((x) => x.id === id) || null;

  // ---------- Combos elementales entre clases ----------
  // Algunas habilidades dejan una etiqueta en el monstruo (campo `applies` de la habilidad). Si otro
  // jugador le pone una etiqueta que hace pareja antes de que caduque, estalla un combo. Solo contra
  // monstruos: entre jugadores no hay combos.
  const COMBO_TAGS = {
    WET_GLUE: { name: 'Pegajoso', icon: '💧', color: 0x6fd6ff, dur: 5 },
    FIRE_SPARK: { name: 'Chispas', icon: '🔥', color: 0xff8a3a, dur: 4 },
    CRYSTAL_CHARGE: { name: 'Carga de Cristal', icon: '💎', color: 0xb98cff, dur: 4 },
    WIND_GUST: { name: 'Ráfaga', icon: '🍃', color: 0x8fe8a0, dur: 3 },
  };
  // Pares a+b (el orden no importa). mult = daño en área sobre el ataque de quien lo completa;
  // push = empuje en metros; bounce = los monstruos dan un saltito (solo visual)
  const COMBOS = [
    { a: 'WET_GLUE', b: 'FIRE_SPARK', id: 'caramelo', name: 'Explosión de Caramelo', mult: 1.8, radius: 4.5, push: 2.5, bounce: false, fx: 0xff9ad5 },
    { a: 'WIND_GUST', b: 'CRYSTAL_CHARGE', id: 'prisma', name: 'Tormenta Prismática', mult: 2, radius: 5, push: 0, bounce: true, fx: 0xb98cff },
    { a: 'FIRE_SPARK', b: 'WIND_GUST', id: 'brasas', name: 'Remolino de Brasas', mult: 1.7, radius: 5, push: 1.5, bounce: false, fx: 0xff7a2a },
    { a: 'CRYSTAL_CHARGE', b: 'WET_GLUE', id: 'gelatina', name: 'Gelatina Cristalina', mult: 1.5, radius: 4, push: 0, bounce: true, fx: 0x6fd6ff },
    { a: 'FIRE_SPARK', b: 'CRYSTAL_CHARGE', id: 'fuegos', name: 'Fuegos Artificiales', mult: 2.2, radius: 3.5, push: 1, bounce: true, fx: 0xffd36b },
    { a: 'WET_GLUE', b: 'WIND_GUST', id: 'burbujas', name: 'Burbujas Pegajosas', mult: 1.4, radius: 5.5, push: 1, bounce: true, fx: 0x9fe8ff },
  ];
  const comboFor = (t1, t2) => COMBOS.find((c) => (c.a === t1 && c.b === t2) || (c.a === t2 && c.b === t1)) || null;

  const GEM_MULT = 1.25;
  // Tiendas: lista de { id, price, currency } (currency: objeto con el que se paga; sin él, oro)
  const gearOf = (cls, grades) => grades.flatMap((g) => [weaponFor(cls, g), armorFor(cls, g)]);
  const SHOPS = {
    orlen: { name: 'Mercader Orlen', items: (cls) => ['pocion_vida', 'pocion_mana', 'gema_poder', ...gearOf(cls, ['madera', 'cobre', 'azul'])].map((id) => ({ id, price: ITEMS[id].price })) },
    corvin: { name: 'Mercader Corvin', items: (cls) => ['pocion_vida', 'pocion_mana', 'gema_poder', ...gearOf(cls, ['azul', 'morado', 'dorado'])].map((id) => ({ id, price: ITEMS[id].price })) },
    herrero: {
      name: 'Herrero Celestial',
      currency: 'polvo_arcoiris',
      items: (cls) => {
        const list = [
          { id: weaponFor(cls, 'dorado'), price: 4 },
          { id: armorFor(cls, 'dorado'), price: 4 },
          { id: weaponFor(cls, 'arcoiris'), price: 12 },
          { id: armorFor(cls, 'arcoiris'), price: 14 },
        ];
        if (cls === 'oso') list.push({ id: 'gran_martillo_tronador', price: 6 }, { id: 'martillo_coloso', price: 16 });
        return list.map((x) => ({ ...x, currency: 'polvo_arcoiris' }));
      },
    },
    // Tierras lejanas
    nilo: { name: 'Mercader Nilo', items: (cls) => ['pocion_vida', 'pocion_mana', 'gema_poder', ...gearOf(cls, ['dorado', 'cometa'])].map((id) => ({ id, price: ITEMS[id].price })) },
    safira: { name: 'Mercader Safira', items: (cls) => ['pocion_vida', 'pocion_mana', 'gema_poder', ...gearOf(cls, ['cometa'])].map((id) => ({ id, price: ITEMS[id].price })) },
    aurora: {
      name: 'Herrera de la Aurora',
      currency: 'fragmento_aurora',
      items: (cls) => {
        const list = [
          { id: weaponFor(cls, 'cometa'), price: 6 },
          { id: armorFor(cls, 'cometa'), price: 6 },
          { id: weaponFor(cls, 'aurora'), price: 18 },
          { id: armorFor(cls, 'aurora'), price: 20 },
        ];
        if (cls === 'oso') list.push({ id: 'martillo_boreal', price: 24 });
        return list.map((x) => ({ ...x, currency: 'fragmento_aurora' }));
      },
    },
  };
  const shopItems = (shop, cls) => (SHOPS[shop] ? SHOPS[shop].items(cls) : []);
  const shopFor = (cls) => shopItems('orlen', cls).map((x) => x.id);
  const sellPrice = (item) => (item.type === 'junk' || item.type === 'material' ? item.price : Math.floor(item.price * 0.4));

  // Personajes no jugadores. role: shop | heal | guide | master | travel | info.
  // prop: se dibuja un objeto en vez de una persona (cart = vagoneta, portal).
  const NPCS = [
    {
      id: 'mercader', role: 'shop', shop: 'orlen', name: 'Mercader Orlen', title: 'Comerciante', x: 6.5, z: -5.5,
      look: { skin: 0xd9a77e, body: 0x6a4c7a, legs: 0x3a2e40, hair: 0xbfb8ab, robe: true, weapon: false },
      desc: 'Vende pociones, Gemas de Poder, armas de tu raza y armaduras de tu tipo (grados Madera, Cobre y Cristal Azul). También compra todo tu botín.',
    },
    {
      id: 'sanadora', role: 'heal', name: 'Sanadora Ilwen', title: 'Sacerdotisa', x: -8, z: -2.5,
      look: { skin: 0xe8c4a2, body: 0xe6dfcc, legs: 0xcfc6b2, hair: 0xc9a46a, longHair: true, robe: true, weapon: false },
      desc: 'Restaura por completo tu vida y tu maná, gratis, siempre que no estés en combate.',
    },
    {
      id: 'capitana', role: 'guide', name: 'Capitana Brisa', title: 'Guardia de la Aldea', x: 3.5, z: 9.5,
      look: { skin: 0xc99a74, body: 0x858b93, legs: 0x3b3127, hair: 0x2a1c12, cape: 0x34557d, weaponType: 'sword' },
      desc: 'Conoce las tierras de Valdoria: te recomienda a qué zona ir según tu nivel y te da consejos.',
    },
    {
      id: 'maestro', role: 'master', name: 'Maestro Aldric', title: 'Maestro de Clase', x: -6, z: 8.5,
      look: { skin: 0xd6a882, body: 0x7a2630, legs: 0x2a1f1a, hair: 0xe6e0d6, beard: true, cape: 0xd9b25f, weapon: false },
      desc: 'Guía los cambios de clase: Despertar (nivel 10), Especialización (nivel 25) y Ascensión Maestra (nivel 40).',
    },
    {
      id: 'vagoneta_aldea', role: 'travel', to: 'vagoneta_minas', prop: 'cart', name: 'Vagoneta a las Minas', title: 'Transporte', x: 8, z: -18,
      desc: 'Una vagoneta que corre por las vías hasta las Minas de Cristal y Engranajes.',
    },
    {
      id: 'vagoneta_minas', role: 'travel', to: 'vagoneta_aldea', prop: 'cart', name: 'Vagoneta a la Aldea', title: 'Transporte', x: 22, z: -69,
      desc: 'Te lleva de vuelta a la Aldea de los Bloques.',
    },
    // Ciudadela de Gludio-Cubo
    {
      id: 'maestra', role: 'master', name: 'Maestra Lys', title: 'Maestra de Clase', x: -95, z: -55,
      look: { skin: 0xe8c4a2, body: 0x34557d, legs: 0x2a2c55, hair: 0xe6e0d6, longHair: true, female: true, cape: 0xd9b25f, weapon: false },
      desc: 'Maestra de Clase de la Ciudadela: hace los mismos cambios de clase que el Maestro Aldric.',
    },
    {
      id: 'corvin', role: 'shop', shop: 'corvin', name: 'Mercader Corvin', title: 'Comerciante de la Ciudadela', x: -105, z: -55,
      look: { skin: 0xd9a77e, body: 0x2f5a8a, legs: 0x2a2c55, hair: 0x3a2a1c, beard: true, robe: true, weapon: false },
      desc: 'Vende equipo de grados Cristal Azul, Oro Morado y Diamante Dorado, además de pociones y gemas.',
    },
    {
      id: 'herrero', role: 'shop', shop: 'herrero', name: 'Herrero Celestial', title: 'Forja de Arcoíris', x: -106, z: -65,
      look: { skin: 0xc99a74, body: 0x5a5652, legs: 0x3a3734, hair: 0x2a1c12, beard: true, weapon: false },
      desc: 'Cambia Polvo de Arcoíris (lo suelta el Gran Guardián Celestial) por equipo Diamante Dorado y Arcoíris Celestial.',
    },
    {
      id: 'sanador', role: 'heal', name: 'Sanador Tobías', title: 'Clérigo', x: -94, z: -65,
      look: { skin: 0xe8c4a2, body: 0xe6dfcc, legs: 0xcfc6b2, hair: 0x8a6a46, robe: true, weapon: false },
      desc: 'Restaura tu vida y tu maná, gratis, fuera de combate.',
    },
    {
      id: 'gremio', role: 'guild', name: 'Maestro del Gremio', title: 'Gremios', x: -100, z: -50,
      look: { skin: 0xc99a74, body: 0x7a2630, legs: 0x2a1f1a, hair: 0x5a3a1c, cape: 0x7a2630, weaponType: 'sword' },
      desc: 'Funda tu gremio (nivel 15 y 1.000 de oro): nombre, emblema y color para ti y tus amigos.',
      text: 'Funda tu gremio con tus amigos: elige un nombre, un emblema y un color.',
    },
    {
      id: 'establo', role: 'info', name: 'Cuidadora Mabel', title: 'Establo de Monturas', x: -110, z: -60,
      look: { skin: 0xe6bf9a, body: 0x6b4a2e, legs: 0x4a3a28, hair: 0x9a4a22, longHair: true, female: true, weapon: false },
      desc: 'Experta en mascotas y monturas.',
      text: 'Tu mascota nace del Huevo (nivel 5), crece a montura en el nivel 20 (tecla 0) y con la Ascensión Maestra aprende a planear sobre el agua. ¡Cuídala mucho!',
    },
    {
      id: 'portal_asedio', role: 'info', prop: 'portal', portalColor: 0xd84a3a, name: 'Portal de Asedios', title: 'Castillos de Juguete', x: -100, z: -72,
      desc: 'Portal a los Asedios de Castillos de Juguete.',
      text: 'Asedios de Castillos de Juguete: los gremios se inscribirán aquí para pelear los fines de semana. ¡Muy pronto!',
    },
    {
      id: 'portal_islas', role: 'travel', to: 'portal_ciudadela', prop: 'portal', portalColor: 0x9fd8ff, name: 'Portal a las Islas Flotantes', title: 'Nivel 30+', minLvl: 30, x: -88, z: -60,
      desc: 'Te lleva a las Islas Flotantes del Cielo (nivel 30 o más).',
    },
    {
      id: 'portal_ciudadela', role: 'travel', to: 'portal_islas', prop: 'portal', portalColor: 0xffd36b, name: 'Portal a la Ciudadela', title: 'Transporte', x: 60, z: 99,
      desc: 'Vuelve a la Ciudadela de Gludio-Cubo.',
    },
    // Red de portales (uno en cada aldea) y subastadores del mercado entre jugadores
    {
      id: 'portal_aldea', role: 'portal', prop: 'portal', portalColor: 0x7dffc0, name: 'Portal de los Viajeros', title: 'Red de portales', x: -1.5, z: -10,
      desc: 'Te lleva a cualquier aldea o zona que ya hayas visitado, a cambio de un poco de oro.',
    },
    {
      id: 'subasta_aldea', role: 'market', name: 'Subastadora Rita', title: 'Mercado de Aventureros', x: 9.5, z: -1,
      look: { skin: 0xe6bf9a, body: 0xd9b25f, legs: 0x5a3d22, hair: 0x9a4a22, longHair: true, female: true, robe: true, weapon: false },
      desc: 'Pon a la venta tus objetos al precio que quieras y compra lo que venden otros aventureros (tecla U).',
    },
    {
      id: 'portal_red_ciudadela', role: 'portal', prop: 'portal', portalColor: 0x7dffc0, name: 'Portal de los Viajeros', title: 'Red de portales', x: -91, z: -71,
      desc: 'Te lleva a cualquier aldea o zona que ya hayas visitado, a cambio de un poco de oro.',
    },
    {
      id: 'subasta_ciudadela', role: 'market', name: 'Subastador Gaspar', title: 'Mercado de Aventureros', x: -111, z: -51,
      look: { skin: 0xd9a77e, body: 0xd9b25f, legs: 0x3a2e40, hair: 0x2a1c12, beard: true, robe: true, weapon: false },
      desc: 'Pon a la venta tus objetos al precio que quieras y compra lo que venden otros aventureros (tecla U).',
    },
    // Villa Nevada
    {
      id: 'nilo', role: 'shop', shop: 'nilo', name: 'Mercader Nilo', title: 'Comerciante de Villa Nevada', x: -53.9, z: 238.5,
      look: { skin: 0xe8c4a2, body: 0x3a6ad8, legs: 0x2a2c55, hair: 0xe6e0d6, beard: true, cape: 0xeef4fc, weapon: false },
      desc: 'Vende pociones, gemas y equipo de grados Diamante Dorado y Cometa Plateado.',
    },
    {
      id: 'sanadora_nevada', role: 'heal', name: 'Sanadora Nieves', title: 'Sacerdotisa', x: -66.1, z: 238.5,
      look: { skin: 0xf0d8c0, body: 0xeef4fc, legs: 0xcfd8e6, hair: 0xffffff, longHair: true, female: true, robe: true, weapon: false },
      desc: 'Restaura tu vida y tu maná, gratis, fuera de combate.',
    },
    {
      id: 'guia_nevada', role: 'guide', name: 'Explorador Bruno', title: 'Guía de las Tierras Lejanas', x: -63.5, z: 229,
      look: { skin: 0xc99a74, body: 0x8a5a34, legs: 0x3b3127, hair: 0x2a1c12, cape: 0xd84a3a, weaponType: 'sword' },
      desc: 'Te recomienda a qué zona ir según tu nivel.',
    },
    {
      id: 'portal_nevada', role: 'portal', prop: 'portal', portalColor: 0x7dffc0, name: 'Portal de los Viajeros', title: 'Red de portales', x: -60, z: 244,
      desc: 'Te lleva a cualquier aldea o zona que ya hayas visitado, a cambio de un poco de oro.',
    },
    {
      id: 'subasta_nevada', role: 'market', name: 'Subastadora Olga', title: 'Mercado de Aventureros', x: -53.9, z: 231.5,
      look: { skin: 0xf0d8c0, body: 0xd9b25f, legs: 0x3a2e40, hair: 0xbfb8ab, longHair: true, female: true, robe: true, weapon: false },
      desc: 'Pon a la venta tus objetos al precio que quieras y compra lo que venden otros aventureros (tecla U).',
    },
    // Oasis del Sol
    {
      id: 'safira', role: 'shop', shop: 'safira', name: 'Mercader Safira', title: 'Comerciante del Oasis', x: -4.5, z: -252.6,
      look: { skin: 0xb07850, body: 0xd84a3a, legs: 0xf2c13a, hair: 0x1a1210, longHair: true, female: true, robe: true, weapon: false },
      desc: 'Vende pociones, gemas y equipo de grado Cometa Plateado.',
    },
    {
      id: 'sanador_oasis', role: 'heal', name: 'Sanador Amir', title: 'Clérigo del Oasis', x: -5.4, z: -262.5,
      look: { skin: 0xb07850, body: 0xf4f0e6, legs: 0xe0d8c6, hair: 0x1a1210, beard: true, robe: true, weapon: false },
      desc: 'Restaura tu vida y tu maná, gratis, fuera de combate.',
    },
    {
      id: 'herrera', role: 'shop', shop: 'aurora', name: 'Herrera de la Aurora', title: 'Forja Boreal', x: 5.4, z: -262.5,
      look: { skin: 0xc99a74, body: 0x3a8a6a, legs: 0x2a3a34, hair: 0x7dffc0, longHair: true, female: true, weapon: false },
      desc: 'Cambia Fragmentos de Aurora (los sueltan los monstruos y jefes de las tierras lejanas) por equipo Cometa Plateado y Aurora Eterna.',
    },
    {
      id: 'portal_oasis', role: 'portal', prop: 'portal', portalColor: 0x7dffc0, name: 'Portal de los Viajeros', title: 'Red de portales', x: 0, z: -265,
      desc: 'Te lleva a cualquier aldea o zona que ya hayas visitado, a cambio de un poco de oro.',
    },
    {
      id: 'subasta_oasis', role: 'market', name: 'Subastador Omar', title: 'Mercado de Aventureros', x: 4.9, z: -253,
      look: { skin: 0xb07850, body: 0xd9b25f, legs: 0x5a3d22, hair: 0x1a1210, beard: true, robe: true, weapon: false },
      desc: 'Pon a la venta tus objetos al precio que quieras y compra lo que venden otros aventureros (tecla U).',
    },
  ];

  // ---------- Red de portales ----------
  // Destinos del Portal de los Viajeros: aldeas y zonas. Solo aparecen las que el jugador ya visitó
  // (las guarda el sistema «viajes» en p.ext.viajes). price: oro que cuesta el viaje.
  const PORTAL_DESTS = [
    { id: 'aldea', price: 100 },
    { id: 'ciudadela', price: 200 },
    { id: 'nevada', price: 800 },
    { id: 'oasis', price: 1200 },
    { id: 'praderas', price: 50 },
    { id: 'bosque', price: 100 },
    { id: 'minas', price: 200 },
    { id: 'valle', price: 400 },
    { id: 'islas', price: 600 },
    { id: 'tundra', price: 900 },
    { id: 'pantano', price: 1100 },
    { id: 'desierto', price: 1400 },
    { id: 'canon', price: 1700 },
    { id: 'eclipse', price: 2000 },
  ];
  const portalDest = (id) => PORTAL_DESTS.find((d) => d.id === id) || null;

  // ---------- Mercado entre jugadores ----------
  // maxListings: publicaciones a la vez por personaje · maxPrice: precio máximo por unidad ·
  // tax: impuesto que se descuenta al vendedor · minLvl: nivel mínimo para vender
  const MARKET = { maxListings: 10, maxPrice: 9999999, tax: 0.05, minLvl: 5, maxTotal: 4000, pageSize: 40 };
  // Protección al reaparecer: segundos en que nadie puede atacarte (se pierde si atacas)
  const SPAWN_PROTECT = 6;

  // Aspecto según raza y sexo
  function lookFor(cls, sex) {
    const a = arch(cls);
    const base = { ...a.look, bigHead: true }; // cabeza grande y cúbica, estilo bloques
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
    raceName, className, skillsFor, passiveFor, skillLock, skillLevel, skillMaxLevel, skillPower, skillMp, skillNextAt, SKILL_LVL_EVERY, SKILL_POWER_PER, SKILL_MP_PER, lookFor, playerBaseStats, mobStats,
    ITEMS, WEAPON_TIERS, ARMOR_TIERS, weaponFor, armorFor, startGear, equipProblem,
    ZONES, MOBS, TOP_MOB_LVL, TOP_BOSS, questFor, resolveDrop, shopFor, sellPrice, NPCS, GEM_MULT, PORTAL_DESTS, portalDest, MARKET, SPAWN_PROTECT,
    ARENAS, SHOPS, shopItems, MOB_H, mobHeight, PHRASES,
    GUILD_LVL, GUILD_COST, GUILD_MAX, GUILD_RANKS, GUILD_EMBLEMS, GUILD_COLORS,
    EMOTES, EMOTE_CD, MENTOR, FRIEND_SHOP, friendItem, albumData, COMBO_TAGS, COMBOS, comboFor,
    PETS, isPet, PET_LVL, MOUNT_LVL, GLIDER_LVL, MOUNT_SPEED, PET_FETCH_R, mountKind, petName, itemCategory, isKeyItem,
    OLD_CLASS_MAP, migrateCharacter,
  };
});
