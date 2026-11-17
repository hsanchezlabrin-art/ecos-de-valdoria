// Prueba de la simulación sin gráficos, en Node: es la base del servidor online.
// Uso: node test/sim.test.js   (también corre en GitHub Actions en cada push)
const assert = require('assert');
const Sim = require('../juego/src/sim.js');
const Data = require('../juego/src/data.js');

const C = Sim.cmd;
const DT = 1 / 20; // el servidor simulará a 20 pasos por segundo

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
    if (p.target) C.useSkill(w, p, Math.floor(Math.random() * 4));
  };
}

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

// 1) Cada clase caza en una zona de su nivel
for (const cls of Data.CLASS_IDS) {
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const data = Sim.newCharacter(`Bot ${cls}`, cls);
  data.level = 4;
  data.pos = { x: 50, z: 14 }; // Prados de Brezo
  const p = Sim.addPlayer(w, data);
  const startXp = p.xp + p.level * 100000;
  let kills = 0;
  const tick = bot(w, p);
  for (let t = 0; t < 240; t += DT) {
    tick();
    Sim.step(w, DT);
    for (const ev of Sim.drainEvents(w)) if (ev.type === 'mobDeath') kills++;
  }
  ok(kills >= 5, `${cls}: debería derrotar al menos 5 monstruos (derrotó ${kills})`);
  ok(p.xp + p.level * 100000 > startXp, `${cls}: debería ganar experiencia`);
  ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z), `${cls}: posición válida`);
  console.log(`  ${cls}: ${kills} monstruos, nivel ${p.level}, ${p.gold} oro, ${p.inv.length} casillas usadas`);
}

// 2) Dos jugadores en el mismo mundo: el botín y la experiencia van a quien mata
{
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const a = Sim.addPlayer(w, { ...Sim.newCharacter('Ana', 'arquera'), level: 6, pos: { x: 50, z: 14 } });
  const b = Sim.addPlayer(w, { ...Sim.newCharacter('Beto', 'guerrero'), level: 6, pos: { x: 0, z: 8 } }); // en la aldea
  const goldB = b.gold;
  const ta = bot(w, a);
  run(w, 60, ta);
  const evs = Sim.drainEvents(w);
  ok(w.players.size === 2, 'dos jugadores en el mundo');
  ok(evs.some((e) => e.type === 'log' && e.to === a.id), 'Ana recibe sus propios mensajes');
  ok(!evs.some((e) => e.type === 'loot' && e.to === b.id), 'Beto no recibe el botín de Ana');
  ok(b.gold === goldB, 'el oro de Beto no cambia si no caza');

  // Los lobos del bosque son agresivos: si Beto se acerca a uno, debe perseguirlo
  const wolf = w.mobs.find((m) => m.key === 'lobo' && !m.dead && !m.aggro);
  b.pos.x = wolf.pos.x + 3;
  b.pos.z = wolf.pos.z;
  run(w, 0.5);
  ok(w.mobs.some((m) => m.key === 'lobo' && m.aggro === b), 'un lobo persigue a Beto');

  // Si Beto se desconecta, nadie lo sigue persiguiendo
  Sim.removePlayer(w, b.id);
  run(w, 1);
  ok(!w.mobs.some((m) => m.aggro === b), 'al salir Beto, los monstruos lo olvidan');
}

// 3) Reglas de la tienda: hay que estar junto al mercader
{
  const w = Sim.createWorld();
  const p = Sim.addPlayer(w, Sim.newCharacter('Cliente', 'mago'));
  p.gold = 500;
  p.pos.x = 60;
  p.pos.z = 60;
  C.buyItem(w, p, 'pocion_vida');
  ok(p.gold === 500, 'no se puede comprar lejos del mercader');
  const npc = Data.NPCS.find((n) => n.id === 'mercader');
  p.pos.x = npc.x + 1;
  p.pos.z = npc.z + 1;
  C.buyItem(w, p, 'pocion_vida');
  ok(p.gold === 480, 'se compra junto al mercader');
  C.buyItem(w, p, 'espada_larga');
  ok(p.gold === 480, 'un mago no puede comprar armas de guerrero');
  C.buyItem(w, p, 'pocion_mana', 4);
  ok(p.gold === 380 && Sim.countItem(p, 'pocion_mana') === 8, 'se compran varias pociones de una vez');
  C.buyItem(w, p, 'pocion_vida', 500);
  ok(p.gold === 380, 'no se compra más de lo que alcanza el oro');
  const idx = p.inv.findIndex((s) => s.id === 'pocion_mana');
  C.sellItem(w, p, idx, 3);
  ok(Sim.countItem(p, 'pocion_mana') === 5 && p.gold === 380 + 3 * Data.sellPrice(Data.ITEMS.pocion_mana), 'se venden varias unidades de una vez');
  const save = Sim.serialize(p);
  ok(save.cls === 'mago' && save.inv.length === p.inv.length, 'la partida se serializa');
}

console.log(`\nSimulación OK: ${checks} comprobaciones superadas.`);
