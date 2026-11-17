// Datos del juego: zonas, monstruos, objetos, habilidades y fórmulas.
// Todo el contenido vive aquí para poder moverlo luego al servidor sin tocar la lógica.

export const MAX_LEVEL = 20;
export const xpToNext = (lvl) => Math.floor(42 * Math.pow(lvl, 1.85) + 18);

export function playerBaseStats(lvl) {
  return {
    maxHp: 80 + 22 * (lvl - 1),
    maxMp: 40 + 10 * (lvl - 1),
    atk: 8 + 3 * (lvl - 1),
    def: 2 + 1.5 * (lvl - 1),
  };
}

export function mobStats(def, lvl) {
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
export const ZONES = [
  { id: 'aldea', name: 'Aldea de Brezal', x: 0, z: 0, r: 22, safe: true, tint: [0.5, 0.42, 0.3] },
  { id: 'prados', name: 'Prados de Brezo', lvl: '1–2', x: 50, z: 14, r: 26, ground: 0.6, trees: 0.06, treeType: 'round', tint: [0.46, 0.6, 0.27] },
  { id: 'bosque', name: 'Bosque Aullante', lvl: '3–4', x: -54, z: 46, r: 28, ground: 1.2, trees: 0.55, treeType: 'pine', tint: [0.2, 0.36, 0.2] },
  { id: 'goblin', name: 'Campamento Goblin', lvl: '5–7', x: 22, z: -80, r: 25, ground: 0.8, trees: 0.12, treeType: 'round', tint: [0.5, 0.43, 0.27] },
  { id: 'fuerte', name: 'Fuerte de los Orcos', lvl: '8–11', x: -92, z: -62, r: 28, ground: 1.5, trees: 0.08, treeType: 'pine', tint: [0.43, 0.36, 0.29] },
  { id: 'ceniza', name: 'Llanura de Ceniza', lvl: '12–14', x: 104, z: -96, r: 30, ground: 1.0, trees: 0.1, treeType: 'dead', tint: [0.33, 0.31, 0.3] },
  { id: 'pantano', name: 'Pantano de Tharmok', lvl: '13–15 · Jefe', x: 108, z: 96, r: 26, ground: -1.1, trees: 0.3, treeType: 'swamp', tint: [0.24, 0.31, 0.2] },
];

export const MOBS = {
  jabali: {
    name: 'Jabalí Salvaje', kind: 'quad', lvl: [1, 2], zone: 'prados', count: 16,
    color: 0x6b4a32, scale: 0.85, tusks: true, mane: true, aggressive: false, speed: 4.6,
    drops: [['piel', 0.55], ['pocion_vida', 0.12], ['espada_corta', 0.03], ['jubon', 0.05]],
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
    drops: [['oreja_goblin', 0.45], ['pocion_vida', 0.18], ['pocion_mana', 0.12], ['espada_larga', 0.05], ['cota_malla', 0.04]],
  },
  orco: {
    name: 'Orco Guerrero', kind: 'hum', lvl: [8, 11], zone: 'fuerte', count: 16,
    skin: 0x557043, body: 0x6e2a22, legs: 0x2f2a26, scale: 1.18, tusks: true, aggressive: true, speed: 5,
    club: true,
    drops: [['amuleto_hueso', 0.4], ['pocion_vida', 0.2], ['pocion_mana', 0.15], ['espada_larga', 0.06], ['cota_malla', 0.06], ['hoja_azul', 0.025], ['placas', 0.02]],
  },
  golem: {
    name: 'Gólem de Ceniza', kind: 'hum', lvl: [12, 14], zone: 'ceniza', count: 14,
    skin: 0x5a5652, body: 0x46423e, legs: 0x3a3734, scale: 1.4, glow: 0xff6a2a, weapon: false, aggressive: true, speed: 4.4,
    drops: [['nucleo_ceniza', 0.4], ['pocion_vida', 0.25], ['pocion_mana', 0.2], ['hoja_azul', 0.05], ['placas', 0.05]],
  },
  sapo: {
    name: 'Sapo de Ciénaga', kind: 'quad', lvl: [13, 14], zone: 'pantano', count: 7,
    color: 0x4c6a36, scale: 1.05, aggressive: false, speed: 4,
    drops: [['mucosa', 0.5], ['pocion_vida', 0.25], ['pocion_mana', 0.2]],
  },
  tharmok: {
    name: 'Tharmok, Señor del Pantano', kind: 'hum', lvl: [15, 15], zone: 'pantano', count: 1, boss: true, respawn: 180,
    skin: 0x3d5a3a, body: 0x2c3a24, legs: 0x1f2a1a, scale: 2.3, tusks: true, glow: 0xb6ff5a, club: true, aggressive: true, speed: 4.8,
    drops: [['filo_crepusculo', 0.6], ['egida', 0.6], ['pocion_vida', 1], ['pocion_mana', 1]],
  },
};

export const RARITY = {
  comun: { name: 'Común', color: '#cfc6b2' },
  refinado: { name: 'Refinado', color: '#8fd37a' },
  raro: { name: 'Raro', color: '#74aaff' },
  epico: { name: 'Épico', color: '#c895ff' },
};

export const ITEMS = {
  pocion_vida: { name: 'Poción de Vida', type: 'potion', stat: 'hp', amount: 0.35, price: 20, stack: true, glyph: '♥', rarity: 'comun', desc: 'Restaura el 35% de la vida.' },
  pocion_mana: { name: 'Poción de Maná', type: 'potion', stat: 'mp', amount: 0.4, price: 25, stack: true, glyph: '◆', rarity: 'comun', desc: 'Restaura el 40% del maná.' },

  piel: { name: 'Piel de Jabalí', type: 'junk', price: 4, stack: true, glyph: '▤', rarity: 'comun', desc: 'Se vende en el mercado.' },
  colmillo: { name: 'Colmillo de Lobo', type: 'junk', price: 8, stack: true, glyph: '◣', rarity: 'comun', desc: 'Se vende en el mercado.' },
  oreja_goblin: { name: 'Oreja de Goblin', type: 'junk', price: 13, stack: true, glyph: '◖', rarity: 'comun', desc: 'Prueba de caza. Se vende en el mercado.' },
  amuleto_hueso: { name: 'Amuleto de Hueso', type: 'junk', price: 22, stack: true, glyph: '◎', rarity: 'comun', desc: 'Talismán orco. Se vende en el mercado.' },
  nucleo_ceniza: { name: 'Núcleo de Ceniza', type: 'junk', price: 36, stack: true, glyph: '✹', rarity: 'refinado', desc: 'Aún está tibio. Se vende en el mercado.' },
  mucosa: { name: 'Mucosa de Ciénaga', type: 'junk', price: 32, stack: true, glyph: '●', rarity: 'comun', desc: 'Viscosa. Se vende en el mercado.' },

  espada_corta: { name: 'Espada Corta', type: 'weapon', atk: 4, lvl: 1, price: 30, glyph: '†', rarity: 'comun', desc: 'Hoja sencilla de hierro.' },
  espada_larga: { name: 'Espada Larga', type: 'weapon', atk: 10, lvl: 5, price: 140, glyph: '†', rarity: 'refinado', desc: 'Equilibrada y fiable.' },
  hoja_azul: { name: 'Hoja de Acero Azul', type: 'weapon', atk: 18, lvl: 9, price: 450, glyph: '†', rarity: 'raro', desc: 'Forjada en las minas del norte.' },
  filo_crepusculo: { name: 'Filo del Crepúsculo', type: 'weapon', atk: 30, lvl: 13, price: 1600, glyph: '†', rarity: 'epico', desc: 'Arrebatada a Tharmok. Brilla al anochecer.' },

  jubon: { name: 'Jubón de Cuero', type: 'armor', def: 3, hp: 15, lvl: 1, price: 30, glyph: '▣', rarity: 'comun', look: 0x6b4a2e, desc: 'Cuero curtido.' },
  cota_malla: { name: 'Cota de Malla', type: 'armor', def: 7, hp: 40, lvl: 5, price: 140, glyph: '▣', rarity: 'refinado', look: 0x858b93, desc: 'Anillas de hierro remachadas.' },
  placas: { name: 'Armadura de Placas', type: 'armor', def: 13, hp: 80, lvl: 9, price: 450, glyph: '▣', rarity: 'raro', look: 0xb4bac2, desc: 'Pesada pero casi impenetrable.' },
  egida: { name: 'Égida del Pantano', type: 'armor', def: 20, hp: 140, lvl: 13, price: 1600, glyph: '▣', rarity: 'epico', look: 0x3f6b4a, desc: 'Escamas de Tharmok sobre bronce.' },
};

export const SHOP = ['pocion_vida', 'pocion_mana', 'espada_corta', 'jubon', 'espada_larga', 'cota_malla'];
export const sellPrice = (item) => (item.type === 'junk' ? item.price : Math.floor(item.price * 0.4));

export const SKILLS = [
  { id: 'golpe', name: 'Golpe Feroz', glyph: '⚔︎', type: 'dmg', mult: 2.2, mp: 8, cd: 4, range: 2.6, lvl: 1, desc: 'Un tajo potente: 220% de daño al objetivo.' },
  { id: 'aliento', name: 'Segundo Aliento', glyph: '✚', type: 'heal', amount: 0.35, mp: 15, cd: 12, lvl: 3, desc: 'Recupera el 35% de tu vida.' },
  { id: 'torbellino', name: 'Torbellino', glyph: '❂', type: 'aoe', mult: 1.5, radius: 4.5, mp: 20, cd: 8, lvl: 5, desc: 'Golpea a todos los enemigos cercanos con 150% de daño.' },
  { id: 'grito', name: 'Grito de Guerra', glyph: '⚑', type: 'buff', dur: 15, mp: 25, cd: 35, lvl: 8, desc: '+30% de ataque durante 15 segundos.' },
];
