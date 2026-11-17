// Prueba de la simulación sin gráficos, en Node: es la base del servidor online.
// Uso: node test/sim.test.js   (también corre en GitHub Actions en cada push)
const assert = require('assert');
const Sim = require('../juego/src/sim.js');
const Data = require('../juego/src/data.js');
const Terrain = require('../juego/src/terrain.js');

const C = Sim.cmd;
const DT = 1 / 20; // el servidor simula a 20 pasos por segundo

function run(w, seconds, onTick) {
  for (let t = 0; t < seconds; t += DT) {
    if (onTick) onTick();
    Sim.step(w, DT);
  }
}

// Bot sencillo: busca el monstruo más cercano, lo ataca y usa habilidades y pociones.
function bot(w, p) {
  return () => {
    if (p.dead) return C.respawn(w, p);
    if (p.hp < p.stats.maxHp * 0.4) C.usePotion(w, p, 'pocion_vida');
    if (p.mp < p.stats.maxMp * 0.2) C.usePotion(w, p, 'pocion_mana');
    if (!p.target || p.target.dead) {
      C.targetNearest(w, p);
      C.attack(w, p);
    }
    if (p.target) C.useSkill(w, p, Math.floor(Math.random() * p.skills.length));
  };
}

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
  console.log(`  ✓ ${msg}`);
};

// 0) Datos: todo botín existe para cada clase y todas las habilidades tienen un tipo conocido
{
  const types = ['dmg', 'heal', 'aoe', 'area', 'buff', 'shield', 'leap', 'charge', 'chain'];
  for (const m of Object.values(Data.MOBS)) for (const [raw] of m.drops) for (const cls of Data.CLASS_IDS) assert.ok(Data.ITEMS[Data.resolveDrop(raw, cls)], `${raw} existe para ${cls}`);
  for (const cls of Data.CLASS_IDS) for (const s of Data.CLASSES[cls].skills) assert.ok(types.includes(s.type), `tipo ${s.type}`);
  ok(Data.CLASS_IDS.every((c) => Data.CLASSES[c].skills.length === 6), 'cada clase tiene 6 habilidades');
  ok(Data.CLASS_IDS.every((c) => Data.WEAPON_TIERS[c].every((id) => Data.ITEMS[id] && Data.ITEMS[id].cls === c)), 'las armas de cada nivel existen y son de su clase');
}

// 1) Cada clase caza en una zona de su nivel
for (const cls of Data.CLASS_IDS) {
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const data = Sim.newCharacter(`Bot ${cls}`, cls, cls === 'arquera' ? 'f' : 'm');
  data.level = 4;
  data.pos = { x: 50, z: 14 }; // Prados de Brezo
  const p = Sim.addPlayer(w, data);
  let kills = 0;
  const tick = bot(w, p);
  for (let t = 0; t < 240; t += DT) {
    tick();
    Sim.step(w, DT);
    for (const ev of Sim.drainEvents(w)) if (ev.type === 'mobDeath') kills++;
  }
  ok(kills >= 5, `${cls}: derrota al menos 5 monstruos (derrotó ${kills})`);
  ok(p.level > 4 || p.xp > 0, `${cls}: gana experiencia`);
  ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z), `${cls}: posición válida`);
  ok(p.stats.crit > 0.05 && p.stats.atkSpeed > 0 && p.stats.speed > 0, `${cls}: tiene crítico, velocidad de ataque y de movimiento`);
}

// 2) Colisiones: nunca dentro de un obstáculo, y rodea una casa para llegar detrás
{
  const L = Terrain.layout();
  ok(L.obstacles.length > 500, `el mundo tiene obstáculos (${L.obstacles.length})`);
  const house = L.houses[0];
  const w = Sim.createWorld();
  const toCenter = Math.atan2(-house.x, -house.z);
  const front = { x: house.x + Math.sin(toCenter) * 6, z: house.z + Math.cos(toCenter) * 6 };
  const back = { x: house.x - Math.sin(toCenter) * 6, z: house.z - Math.cos(toCenter) * 6 };
  const p = Sim.addPlayer(w, { ...Sim.newCharacter('Muro', 'guerrero'), pos: front });
  C.moveTo(w, p, back);
  let inside = false;
  for (let t = 0; t < 12 && p.moveTarget; t += DT) {
    Sim.step(w, DT);
    for (const o of L.near(p.pos.x, p.pos.z)) if (Math.hypot(p.pos.x - o.x, p.pos.z - o.z) < o.r + 0.3) inside = true;
  }
  ok(!inside, 'el jugador no atraviesa la casa');
  ok(Math.hypot(p.pos.x - back.x, p.pos.z - back.z) < 1.5, 'el jugador rodea la casa y llega detrás');
}

// 3) Agua: en aguas profundas se nada, se acaba el aire y se pierde vida
{
  let deep = null;
  for (let x = -170; x < 170 && !deep; x += 3) for (let z = -170; z < 170 && !deep; z += 3) if (Terrain.waterDepth(x, z) > Terrain.DEEP_DEPTH + 0.6 && Math.hypot(x, z) < 175) deep = { x, z };
  ok(!!deep, 'el mundo tiene aguas profundas');
  const w = Sim.createWorld();
  const p = Sim.addPlayer(w, { ...Sim.newCharacter('Nadador', 'mago'), pos: deep });
  run(w, 1);
  ok(p.swimming && p.deep, 'el jugador nada en aguas profundas');
  ok(p.pos.y > Terrain.heightAt(p.pos.x, p.pos.z), 'flota sobre el fondo');
  const hp0 = p.hp;
  run(w, Sim.BREATH_MAX + 3);
  ok(p.breath === 0 && (p.hp < hp0 || p.dead), 'sin aire pierde vida');
}

// 4) Grupo: invitar, aceptar, experiencia compartida y salir
{
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const a = Sim.addPlayer(w, { ...Sim.newCharacter('Ana', 'arquera', 'f'), level: 3, pos: { x: 50, z: 14 } });
  const b = Sim.addPlayer(w, { ...Sim.newCharacter('Beto', 'guerrero'), level: 3, pos: { x: 51, z: 15 } });
  C.partyInvite(w, a, b.id);
  ok(Sim.drainEvents(w).some((e) => e.type === 'partyInvite' && e.to === b.id), 'Beto recibe la invitación');
  C.partyAnswer(w, b, true);
  ok(a.party && a.party === b.party, 'ambos quedan en el mismo grupo');
  ok(Sim.partyView(w, a).members.length === 2, 'el grupo muestra dos miembros');
  const xpB = b.xp + b.level * 1e6;
  const ta = bot(w, a);
  for (let t = 0; t < 60; t += DT) {
    ta();
    Sim.step(w, DT);
  }
  Sim.drainEvents(w);
  ok(b.xp + b.level * 1e6 > xpB, 'Beto gana experiencia de grupo sin atacar');
  C.partyLeave(w, b);
  ok(!a.party && !b.party, 'con un solo miembro el grupo se disuelve');
}

// 5) Monstruos: al volver a su sitio no se curan al instante
{
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const m = w.mobs.find((x) => x.key === 'lobo');
  const p = Sim.addPlayer(w, { ...Sim.newCharacter('Cazador', 'arquera'), level: 6, pos: { x: m.pos.x + 5, z: m.pos.z } });
  m.hp = Math.round(m.maxHp * 0.3);
  m.aggro = p;
  m.pos.x = m.spawn.x + 60; // lejos de su sitio: deja de perseguir y vuelve
  run(w, 0.5);
  ok(m.state === 'return', 'el monstruo vuelve a su sitio');
  ok(m.hp < m.maxHp * 0.5, `no se cura al instante (vida ${Math.round((m.hp / m.maxHp) * 100)}%)`);
}

// 6) Habilidades nuevas: embestida aturde, cadena golpea a varios, veneno daña con el tiempo
{
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const g = Sim.addPlayer(w, { ...Sim.newCharacter('Gu', 'guerrero'), level: 15, pos: { x: 22, z: -70 } });
  const goblin = w.mobs.filter((m) => m.key === 'goblin').sort((a, b) => Math.hypot(a.pos.x - 22, a.pos.z + 70) - Math.hypot(b.pos.x - 22, b.pos.z + 70))[0];
  goblin.pos.x = 30;
  goblin.pos.z = -70;
  goblin.maxHp = goblin.hp = 1e6;
  C.setTarget(w, g, goblin);
  C.useSkill(w, g, 4); // Embestida
  run(w, 0.6);
  ok(goblin.stunT > 0, 'la Embestida aturde al objetivo');

  const mg = Sim.addPlayer(w, { ...Sim.newCharacter('Ma', 'mago', 'f'), level: 15, pos: { x: 22, z: -74 } });
  for (const m of w.mobs.filter((x) => x.key === 'goblin').slice(0, 3)) {
    m.pos.x = 28 + Math.random() * 3;
    m.pos.z = -74 + Math.random() * 3;
    m.maxHp = m.hp = 1e6;
  }
  Sim.drainEvents(w);
  C.setTarget(w, mg, w.mobs.find((x) => x.key === 'goblin' && x !== goblin));
  C.useSkill(w, mg, 4); // Cadena de Rayos
  run(w, 0.2);
  const chain = Sim.drainEvents(w).find((e) => e.type === 'chain');
  ok(chain && chain.pts.length >= 3, 'la Cadena de Rayos salta entre varios enemigos');

  const ar = Sim.addPlayer(w, { ...Sim.newCharacter('Ar', 'arquera', 'f'), level: 15, pos: { x: 22, z: -78 } });
  C.setTarget(w, ar, goblin);
  goblin.stunT = 0;
  C.useSkill(w, ar, 4); // Flecha Venenosa
  run(w, 1.5);
  ok(goblin.dots.length > 0, 'la Flecha Venenosa envenena');
}

// 7) Tienda: hay que estar junto al mercader y se puede comprar y vender en cantidad
{
  const w = Sim.createWorld();
  const p = Sim.addPlayer(w, Sim.newCharacter('Cliente', 'mago'));
  p.gold = 500;
  p.pos.x = 60;
  p.pos.z = 60;
  C.buyItem(w, p, 'pocion_vida');
  ok(p.gold === 500, 'no se puede comprar lejos del mercader');
  const npc = Data.NPCS.find((n) => n.id === 'mercader');
  p.pos.x = npc.x - 2;
  p.pos.z = npc.z + 1;
  C.buyItem(w, p, 'pocion_vida');
  ok(p.gold === 480, 'se compra junto al mercader');
  C.buyItem(w, p, 'espada_larga');
  ok(p.gold === 480, 'un mago no puede comprar armas de guerrero');
  C.buyItem(w, p, 'pocion_mana', 4);
  ok(p.gold === 380 && Sim.countItem(p, 'pocion_mana') === 8, 'se compran varias pociones de una vez');
  const idx = p.inv.findIndex((s) => s.id === 'pocion_mana');
  C.sellItem(w, p, idx, 3);
  ok(Sim.countItem(p, 'pocion_mana') === 5, 'se venden varias unidades de una vez');
  const save = Sim.serialize(p);
  ok(save.cls === 'mago' && save.inv.length === p.inv.length, 'la partida se serializa');
}

// 8) Hablar con un NPC lejano: el jugador camina hasta él (rodeando obstáculos) y habla
{
  for (const id of ['sanadora', 'capitana', 'mercader']) {
    const w = Sim.createWorld();
    const p = Sim.addPlayer(w, Sim.newCharacter('Viajero', 'guerrero'));
    C.talkTo(w, p, id);
    let talked = false;
    for (let t = 0; t < 8 && !talked; t += DT) {
      Sim.step(w, DT);
      talked = Sim.drainEvents(w).some((e) => (e.type === 'log' && e.cls === 'npc') || e.type === 'openShop');
    }
    ok(talked, `al llegar junto a ${id}, responde`);
  }
}

console.log(`\nSimulación OK: ${checks} comprobaciones superadas.`);
