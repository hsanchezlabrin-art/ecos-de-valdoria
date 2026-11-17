// Datos del juego: clases, zonas, monstruos, objetos, habilidades, NPCs y fórmulas.
// Todo el contenido vive aquí. La web de guías lee este mismo archivo, así que lo que
// cambies aquí se refleja en la guía automáticamente. Funciona en el navegador (V.Data)
// y en Node (require), para que el servidor use exactamente las mismas reglas.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const V = (globalThis.V = globalThis.V || {});
    V.Data = factory();
  }
})(function () {
  const MAX_LEVEL = 20;
  const xpToNext = (lvl) => Math.floor(42 * Math.pow(lvl, 1.85) + 18);

  // ---------- Clases ----------
  // base: [valor en nivel 1, aumento por nivel]
  const CLASSES = {
    guerrero: {
      name: 'Guerrero',
      names: { m: 'Guerrero', f: 'Guerrera' },
      crit: 0.08,
      role: 'Cuerpo a cuerpo · Resistente',
      desc: 'Aguanta en primera línea con espada y armadura. Mucha vida, golpes potentes y ataques en área.',
      base: { hp: [80, 22], mp: [40, 10], atk: [8, 3], def: [2, 1.5] },
      range: 2.4,
      atkSpeed: 1.05,
      projectile: null,
      mpRegen: 1,
      start: 'espada_corta',
      look: { skin: 0xe2b78f, body: 0x34557d, legs: 0x3b3127, hair: 0x4a2c17, cape: 0x7a2630, weaponType: 'sword' },
      skills: [
        { id: 'golpe', name: 'Golpe Feroz', glyph: '⚔︎', type: 'dmg', mult: 2.2, mp: 8, cd: 4, range: 2.6, lvl: 1, desc: 'Un tajo potente: 220% de daño al objetivo.' },
        { id: 'aliento', name: 'Segundo Aliento', glyph: '✚', type: 'heal', amount: 0.35, mp: 15, cd: 12, lvl: 3, desc: 'Recupera el 35% de tu vida al instante.' },
        { id: 'torbellino', name: 'Torbellino', glyph: '❂', type: 'aoe', mult: 1.5, radius: 4.5, mp: 20, cd: 8, lvl: 5, desc: 'Golpea a todos los enemigos a tu alrededor con 150% de daño.' },
        { id: 'grito', name: 'Grito de Guerra', glyph: '⚑', type: 'buff', pct: 0.3, dur: 15, mp: 25, cd: 35, lvl: 8, desc: '+30% de ataque durante 15 segundos.' },
        { id: 'embestida', name: 'Embestida', glyph: '⇥', type: 'charge', mult: 1.6, stun: 2, mp: 22, cd: 12, range: 12, lvl: 11, desc: 'Cargas contra el objetivo desde hasta 12 m: 160% de daño y lo aturdes 2 segundos.' },
        { id: 'sismo', name: 'Golpe Sísmico', glyph: '✸', type: 'aoe', mult: 2.2, radius: 6, slow: 3, mp: 35, cd: 14, lvl: 15, desc: 'Golpeas el suelo: 220% de daño a todo lo que te rodea y lo ralentizas 3 segundos.' },
      ],
    },
    arquera: {
      name: 'Arquera',
      names: { m: 'Arquero', f: 'Arquera' },
      crit: 0.14,
      role: 'A distancia · Ágil',
      desc: 'Dispara desde lejos y se retira antes de que la alcancen. Menos vida, pero los monstruos rara vez llegan a tocarla.',
      base: { hp: [66, 17], mp: [45, 11], atk: [8, 3.05], def: [1.5, 1.1] },
      range: 15,
      atkSpeed: 1.15,
      projectile: 'arrow',
      mpRegen: 1,
      start: 'arco_corto',
      look: { skin: 0xe6bf9a, body: 0x3f6b3a, legs: 0x4a3a28, hair: 0x9a4a22, longHair: true, cape: 0x2f4a2a, weaponType: 'bow' },
      skills: [
        { id: 'certero', name: 'Disparo Certero', glyph: '➶', type: 'dmg', proj: 'arrow', mult: 2.3, mp: 8, cd: 4, range: 16, lvl: 1, desc: 'Una flecha apuntada con calma: 230% de daño.' },
        { id: 'retirada', name: 'Salto de Retirada', glyph: '↶', type: 'leap', dist: 7, slow: 4, mp: 12, cd: 10, lvl: 3, desc: 'Saltas 7 metros hacia atrás y ralentizas a tu objetivo durante 4 segundos.' },
        { id: 'lluvia', name: 'Lluvia de Flechas', glyph: '⇣', type: 'area', fx: 'rain', mult: 1.4, radius: 4.5, delay: 0.55, mp: 22, cd: 9, range: 16, lvl: 5, desc: 'Una descarga cae sobre el objetivo y todo lo que lo rodea: 140% de daño.' },
        { id: 'halcon', name: 'Ojo de Halcón', glyph: '◉', type: 'buff', pct: 0.35, crit: 0.1, dur: 20, mp: 25, cd: 40, lvl: 8, desc: '+35% de ataque y +10% de probabilidad de crítico durante 20 segundos.' },
        { id: 'veneno', name: 'Flecha Venenosa', glyph: '☣', type: 'dmg', proj: 'arrow', mult: 1.4, dot: { mult: 2.4, dur: 6 }, mp: 18, cd: 9, range: 16, lvl: 11, desc: '140% de daño y veneno: un 240% adicional repartido en 6 segundos.' },
        { id: 'tormenta', name: 'Tormenta de Flechas', glyph: '⛆', type: 'area', fx: 'rain', mult: 2.4, radius: 6.5, delay: 0.6, mp: 38, cd: 16, range: 18, lvl: 15, desc: 'Cientos de flechas sobre el objetivo y su entorno: 240% de daño en un área amplia.' },
      ],
    },
    mago: {
      name: 'Mago',
      names: { m: 'Mago', f: 'Maga' },
      crit: 0.1,
      role: 'Magia · Daño en área',
      desc: 'Domina el fuego y la escarcha. Poca defensa, pero el mayor daño del juego y mucho maná.',
      base: { hp: [56, 14], mp: [70, 18], atk: [9, 3.3], def: [1, 0.9] },
      range: 13,
      atkSpeed: 1.45,
      projectile: 'arcane',
      mpRegen: 1.5,
      start: 'baculo_aprendiz',
      look: { skin: 0xdcb08a, body: 0x3b3f8a, legs: 0x2a2c55, hair: 0xd8d4cc, beard: true, robe: true, hat: 0x2c2f6e, weaponType: 'staff' },
      skills: [
        { id: 'fuego', name: 'Bola de Fuego', glyph: '✺', type: 'dmg', proj: 'fire', mult: 2.6, mp: 10, cd: 3.5, range: 14, lvl: 1, desc: 'Lanza una esfera ardiente: 260% de daño.' },
        { id: 'escudo', name: 'Escudo Arcano', glyph: '◈', type: 'shield', amount: 0.4, dur: 12, mp: 20, cd: 22, lvl: 3, desc: 'Un escudo absorbe daño igual al 40% de tu vida durante 12 segundos.' },
        { id: 'nova', name: 'Nova de Escarcha', glyph: '❄', type: 'aoe', mult: 1.3, radius: 5, slow: 5, mp: 24, cd: 10, lvl: 5, desc: 'Hielo a tu alrededor: 130% de daño y ralentiza a los enemigos 5 segundos.' },
        { id: 'meteoro', name: 'Meteoro', glyph: '☄', type: 'area', fx: 'meteor', mult: 3, radius: 5, delay: 0.75, mp: 40, cd: 18, range: 15, lvl: 8, desc: 'Un meteoro cae sobre el objetivo: 300% de daño en área.' },
        { id: 'rayo', name: 'Cadena de Rayos', glyph: 'ϟ', type: 'chain', mult: 1.9, jumps: 3, jumpR: 8, mp: 26, cd: 8, range: 14, lvl: 11, desc: 'Un rayo golpea al objetivo y salta a 3 enemigos cercanos: 190% de daño a cada uno.' },
        { id: 'ventisca', name: 'Ventisca', glyph: '❆', type: 'area', fx: 'frost', mult: 2.2, radius: 6.5, slow: 5, delay: 0.5, mp: 45, cd: 18, range: 15, lvl: 15, desc: 'Una tormenta de hielo sobre el objetivo: 220% de daño en área y ralentiza 5 segundos.' },
      ],
    },
  };
  const CLASS_IDS = Object.keys(CLASSES);

  const SEXES = { m: 'Hombre', f: 'Mujer' };
  const className = (cls, sex) => {
    const c = CLASSES[cls] || CLASSES.guerrero;
    return (c.names && c.names[sex]) || c.name;
  };
  // Aspecto según clase y sexo: las mujeres llevan pelo largo y figura más estilizada;
  // los hombres, pelo corto (y barba el mago).
  function lookFor(cls, sex) {
    const base = { ...(CLASSES[cls] || CLASSES.guerrero).look };
    if (sex === 'f') {
      base.female = true;
      base.longHair = true;
      base.beard = false;
      if (cls === 'guerrero') base.hair = 0x9a4a22;
      if (cls === 'mago') base.hair = 0xe2d6b8;
    } else {
      base.female = false;
      base.longHair = false;
      if (cls === 'arquera') base.hair = 0x5a3a1c;
    }
    return base;
  }

  function playerBaseStats(cls, lvl) {
    const c = CLASSES[cls] || CLASSES.guerrero;
    const b = c.base;
    const at = ([v, inc]) => v + inc * (lvl - 1);
    return { maxHp: Math.round(at(b.hp)), maxMp: Math.round(at(b.mp)), atk: at(b.atk), def: at(b.def), crit: c.crit };
  }
  const CRIT_MULT = 1.8;
  const MOVE_SPEED = 7.2;

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

  const MOBS = {
    jabali: {
      name: 'Jabalí Salvaje', kind: 'quad', lvl: [1, 2], zone: 'prados', count: 16,
      color: 0x6b4a32, scale: 0.85, tusks: true, mane: true, aggressive: false, speed: 4.6,
      drops: [['piel', 0.55], ['pocion_vida', 0.12], ['@w0', 0.03], ['jubon', 0.05]],
    },
    lobo: {
      name: 'Lobo Gris', kind: 'quad', lvl: [3, 4], zone: 'bosque', count: 15,
      color: 0x7b7f87, scale: 0.9, aggressive: true, speed: 5.6,
      drops: [['colmillo', 0.5], ['pocion_vida', 0.15], ['pocion_mana', 0.1], ['jubon', 0.06]],
    },
    goblin: {
      name: 'Goblin Saqueador', kind: 'hum', lvl: [5, 7], zone: 'goblin', count: 15,
      skin: 0x76a03d, body: 0x5a3d22, legs: 0x3b2a1a, scale: 0.72, ears: true, aggressive: true, speed: 5.2,
      weaponColor: 0x8d8a80,
      drops: [['oreja_goblin', 0.45], ['pocion_vida', 0.18], ['pocion_mana', 0.12], ['@w1', 0.05], ['cota_malla', 0.04]],
    },
    orco: {
      name: 'Orco Guerrero', kind: 'hum', lvl: [8, 11], zone: 'fuerte', count: 16,
      skin: 0x557043, body: 0x6e2a22, legs: 0x2f2a26, scale: 1.18, tusks: true, aggressive: true, speed: 5,
      club: true,
      drops: [['amuleto_hueso', 0.4], ['pocion_vida', 0.2], ['pocion_mana', 0.15], ['@w1', 0.06], ['cota_malla', 0.06], ['@w2', 0.025], ['placas', 0.02]],
    },
    golem: {
      name: 'Gólem de Ceniza', kind: 'hum', lvl: [12, 14], zone: 'ceniza', count: 14,
      skin: 0x5a5652, body: 0x46423e, legs: 0x3a3734, scale: 1.4, glow: 0xff6a2a, weapon: false, aggressive: true, speed: 4.4,
      drops: [['nucleo_ceniza', 0.4], ['pocion_vida', 0.25], ['pocion_mana', 0.2], ['@w2', 0.05], ['placas', 0.05], ['@w3', 0.03], ['escamas', 0.03]],
    },
    sapo: {
      name: 'Sapo de Ciénaga', kind: 'quad', lvl: [13, 14], zone: 'pantano', count: 7,
      color: 0x4c6a36, scale: 1.05, aggressive: false, speed: 4,
      drops: [['mucosa', 0.5], ['pocion_vida', 0.25], ['pocion_mana', 0.2], ['@w3', 0.03], ['escamas', 0.03]],
    },
    tharmok: {
      name: 'Tharmok, Señor del Pantano', kind: 'hum', lvl: [15, 15], zone: 'pantano', count: 1, boss: true, respawn: 180,
      skin: 0x3d5a3a, body: 0x2c3a24, legs: 0x1f2a1a, scale: 2.3, tusks: true, glow: 0xb6ff5a, club: true, aggressive: true, speed: 4.8,
      drops: [['@w4', 0.6], ['egida', 0.6], ['@w5', 0.12], ['mithril', 0.1], ['@w6', 0.03], ['aurora', 0.03], ['pocion_vida', 1], ['pocion_mana', 1]],
    },
  };

  const RARITY = {
    comun: { name: 'Común', color: '#cfc6b2' },
    refinado: { name: 'Refinado', color: '#8fd37a' },
    raro: { name: 'Raro', color: '#74aaff' },
    epico: { name: 'Épico', color: '#c895ff' },
    legendario: { name: 'Legendario', color: '#ffb347' },
  };

  const ITEMS = {
    pocion_vida: { name: 'Poción de Vida', type: 'potion', stat: 'hp', amount: 0.35, price: 20, stack: true, glyph: '♥', rarity: 'comun', desc: 'Restaura el 35% de la vida.' },
    pocion_mana: { name: 'Poción de Maná', type: 'potion', stat: 'mp', amount: 0.4, price: 25, stack: true, glyph: '◆', rarity: 'comun', desc: 'Restaura el 40% del maná.' },

    piel: { name: 'Piel de Jabalí', type: 'junk', price: 4, stack: true, glyph: '▤', rarity: 'comun', desc: 'Se vende en el mercado.' },
    colmillo: { name: 'Colmillo de Lobo', type: 'junk', price: 8, stack: true, glyph: '◣', rarity: 'comun', desc: 'Se vende en el mercado.' },
    oreja_goblin: { name: 'Oreja de Goblin', type: 'junk', price: 13, stack: true, glyph: '◖', rarity: 'comun', desc: 'Prueba de caza. Se vende en el mercado.' },
    amuleto_hueso: { name: 'Amuleto de Hueso', type: 'junk', price: 22, stack: true, glyph: '◎', rarity: 'comun', desc: 'Talismán orco. Se vende en el mercado.' },
    nucleo_ceniza: { name: 'Núcleo de Ceniza', type: 'junk', price: 36, stack: true, glyph: '✹', rarity: 'refinado', desc: 'Aún está tibio. Se vende en el mercado.' },
    mucosa: { name: 'Mucosa de Ciénaga', type: 'junk', price: 32, stack: true, glyph: '●', rarity: 'comun', desc: 'Viscosa. Se vende en el mercado.' },

    espada_corta: { name: 'Espada Corta', type: 'weapon', cls: 'guerrero', atk: 4, lvl: 1, price: 30, glyph: '†', rarity: 'comun', desc: 'Hoja sencilla de hierro.' },
    espada_larga: { name: 'Espada Larga', type: 'weapon', cls: 'guerrero', atk: 10, lvl: 5, price: 140, glyph: '†', rarity: 'refinado', desc: 'Equilibrada y fiable.' },
    hoja_azul: { name: 'Hoja de Acero Azul', type: 'weapon', cls: 'guerrero', atk: 18, lvl: 9, price: 450, glyph: '†', rarity: 'raro', desc: 'Forjada en las minas del norte.' },
    hoja_runica: { name: 'Hoja Rúnica de Brezal', type: 'weapon', cls: 'guerrero', atk: 24, lvl: 11, price: 900, crit: 0.02, glyph: '†', rarity: 'raro', desc: 'Runas antiguas recorren el acero.' },
    filo_crepusculo: { name: 'Filo del Crepúsculo', type: 'weapon', cls: 'guerrero', atk: 30, lvl: 13, price: 1600, crit: 0.03, glyph: '†', rarity: 'epico', desc: 'Arrebatada a Tharmok. Brilla al anochecer.' },
    espada_dragon: { name: 'Espada del Dragón de Ceniza', type: 'weapon', cls: 'guerrero', atk: 40, lvl: 16, price: 3200, crit: 0.04, glyph: '†', rarity: 'epico', desc: 'Templada en el aliento de un dragón.' },
    colmillo_rey: { name: 'Colmillo del Rey Caído', type: 'weapon', cls: 'guerrero', atk: 52, lvl: 19, price: 6000, crit: 0.06, glyph: '†', rarity: 'legendario', desc: 'Dicen que aún obedece a su antiguo dueño.' },

    arco_corto: { name: 'Arco Corto', type: 'weapon', cls: 'arquera', atk: 4, lvl: 1, price: 30, glyph: '➶', rarity: 'comun', desc: 'Madera de fresno y cuerda de lino.' },
    arco_largo: { name: 'Arco Largo de Tejo', type: 'weapon', cls: 'arquera', atk: 10, lvl: 5, price: 140, glyph: '➶', rarity: 'refinado', desc: 'Más alcance, más fuerza en cada tiro.' },
    arco_plata: { name: 'Arco de Plata Élfica', type: 'weapon', cls: 'arquera', atk: 18, lvl: 9, price: 450, glyph: '➶', rarity: 'raro', desc: 'Ligero como una rama y duro como el acero.' },
    arco_runico: { name: 'Arco Rúnico', type: 'weapon', cls: 'arquera', atk: 24, lvl: 11, price: 900, crit: 0.02, glyph: '➶', rarity: 'raro', desc: 'Las runas guían cada flecha.' },
    arco_crepusculo: { name: 'Arco del Crepúsculo', type: 'weapon', cls: 'arquera', atk: 30, lvl: 13, price: 1600, crit: 0.03, glyph: '➶', rarity: 'epico', desc: 'Arrebatado a Tharmok. Sus flechas dejan estela violeta.' },
    arco_dragon: { name: 'Arco de Hueso de Dragón', type: 'weapon', cls: 'arquera', atk: 40, lvl: 16, price: 3200, crit: 0.04, glyph: '➶', rarity: 'epico', desc: 'Tensado con tendones de dragón.' },
    arco_vientos: { name: 'Arco de los Vientos Eternos', type: 'weapon', cls: 'arquera', atk: 52, lvl: 19, price: 6000, crit: 0.06, glyph: '➶', rarity: 'legendario', desc: 'El viento mismo empuja sus flechas.' },

    baculo_aprendiz: { name: 'Báculo de Aprendiz', type: 'weapon', cls: 'mago', atk: 4, lvl: 1, price: 30, glyph: '⚚', rarity: 'comun', desc: 'Un cayado con un cristal opaco.' },
    baculo_roble: { name: 'Báculo de Roble Antiguo', type: 'weapon', cls: 'mago', atk: 10, lvl: 5, price: 140, glyph: '⚚', rarity: 'refinado', desc: 'Tallado en el corazón de un roble milenario.' },
    baculo_zafiro: { name: 'Báculo de Zafiro', type: 'weapon', cls: 'mago', atk: 18, lvl: 9, price: 450, glyph: '⚚', rarity: 'raro', desc: 'El zafiro concentra el maná del portador.' },
    baculo_runico: { name: 'Báculo Rúnico', type: 'weapon', cls: 'mago', atk: 24, lvl: 11, price: 900, crit: 0.02, glyph: '⚚', rarity: 'raro', desc: 'Las runas laten al canalizar maná.' },
    baculo_crepusculo: { name: 'Báculo del Crepúsculo', type: 'weapon', cls: 'mago', atk: 30, lvl: 13, price: 1600, crit: 0.03, glyph: '⚚', rarity: 'epico', desc: 'Arrebatado a Tharmok. Susurra en lenguas olvidadas.' },
    baculo_dragon: { name: 'Báculo de Ascuas Dracónicas', type: 'weapon', cls: 'mago', atk: 40, lvl: 16, price: 3200, crit: 0.04, glyph: '⚚', rarity: 'epico', desc: 'Un ascua de dragón arde en su punta.' },
    baculo_archimago: { name: 'Báculo del Archimago', type: 'weapon', cls: 'mago', atk: 52, lvl: 19, price: 6000, crit: 0.06, glyph: '⚚', rarity: 'legendario', desc: 'Perteneció al último archimago de Valdoria.' },

    jubon: { name: 'Jubón de Cuero', type: 'armor', def: 3, hp: 15, lvl: 1, price: 30, glyph: '▣', rarity: 'comun', look: 0x6b4a2e, desc: 'Cuero curtido. Sirve a cualquier clase.' },
    cota_malla: { name: 'Cota de Malla', type: 'armor', def: 7, hp: 40, lvl: 5, price: 140, glyph: '▣', rarity: 'refinado', look: 0x858b93, desc: 'Anillas de hierro remachadas.' },
    placas: { name: 'Armadura de Placas', type: 'armor', def: 13, hp: 80, lvl: 9, price: 450, glyph: '▣', rarity: 'raro', look: 0xb4bac2, desc: 'Pesada pero casi impenetrable.' },
    escamas: { name: 'Coraza de Escamas', type: 'armor', def: 16, hp: 110, lvl: 11, price: 900, glyph: '▣', rarity: 'raro', look: 0x5a7a6a, desc: 'Escamas de sapo gigante cosidas sobre cuero.' },
    egida: { name: 'Égida del Pantano', type: 'armor', def: 20, hp: 140, lvl: 13, price: 1600, glyph: '▣', rarity: 'epico', look: 0x3f6b4a, desc: 'Escamas de Tharmok sobre bronce.' },
    mithril: { name: 'Armadura de Mithril', type: 'armor', def: 26, hp: 190, lvl: 16, price: 3200, glyph: '▣', rarity: 'epico', look: 0xd6e0ea, desc: 'Ligera como la seda, dura como el diamante.' },
    aurora: { name: 'Manto de la Aurora', type: 'armor', def: 34, hp: 260, lvl: 19, price: 6000, glyph: '▣', rarity: 'legendario', look: 0xe8b04a, desc: 'Brilla con la primera luz del día.' },
  };

  // Armas por nivel de cada clase (niveles 1, 5, 9, 11, 13, 16 y 19).
  // Los botines '@w0'…'@w6' se convierten en el arma de ese nivel para la clase de quien mata.
  const WEAPON_TIERS = {
    guerrero: ['espada_corta', 'espada_larga', 'hoja_azul', 'hoja_runica', 'filo_crepusculo', 'espada_dragon', 'colmillo_rey'],
    arquera: ['arco_corto', 'arco_largo', 'arco_plata', 'arco_runico', 'arco_crepusculo', 'arco_dragon', 'arco_vientos'],
    mago: ['baculo_aprendiz', 'baculo_roble', 'baculo_zafiro', 'baculo_runico', 'baculo_crepusculo', 'baculo_dragon', 'baculo_archimago'],
  };
  const resolveDrop = (id, cls) => (id[0] === '@' ? WEAPON_TIERS[cls][+id.slice(2)] : id);

  const shopFor = (cls) => ['pocion_vida', 'pocion_mana', WEAPON_TIERS[cls][0], 'jubon', WEAPON_TIERS[cls][1], 'cota_malla', WEAPON_TIERS[cls][2], 'placas'];
  const sellPrice = (item) => (item.type === 'junk' ? item.price : Math.floor(item.price * 0.4));

  // Personajes de la aldea. x, z: posición; se les habla con clic.
  const NPCS = [
    {
      id: 'mercader', name: 'Mercader Orlen', title: 'Comerciante', x: 6.5, z: -5.5,
      look: { skin: 0xd9a77e, body: 0x6a4c7a, legs: 0x3a2e40, hair: 0xbfb8ab, robe: true, weapon: false },
      desc: 'Vende pociones, armas básicas de tu clase y armaduras. También compra todo tu botín.',
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
  ];

  return {
    MAX_LEVEL, xpToNext, CLASSES, CLASS_IDS, SEXES, className, lookFor, playerBaseStats, CRIT_MULT, MOVE_SPEED,
    mobStats, ZONES, MOBS, RARITY, ITEMS, WEAPON_TIERS, resolveDrop, shopFor, sellPrice, NPCS,
  };
});
