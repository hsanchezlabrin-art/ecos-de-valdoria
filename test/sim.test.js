// Prueba de la simulación sin gráficos, en Node: es la base del servidor online.
// Uso: node test/sim.test.js   (también corre en GitHub Actions en cada push)
const assert = require('assert');

// Azar con semilla fija: la prueba sale igual en cada ejecución (sin fallos por mala suerte)
let seed = 20261118;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

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

// 0) Datos: 5 razas, habilidades con tipos conocidos, botín y equipo por grado
{
  const types = ['dmg', 'heal', 'aoe', 'area', 'buff', 'leap', 'blink', 'charge', 'chain', 'cone', 'line', 'mark', 'zone', 'turret', 'poly', 'bubble', 'pulse', 'dance'];
  ok(Data.ARCHETYPE_IDS.length === 5, 'hay 5 razas jugables');
  for (const m of Object.values(Data.MOBS)) for (const [raw] of m.drops) for (const cls of Data.CLASS_IDS) assert.ok(Data.ITEMS[Data.resolveDrop(raw, cls)], `${raw} existe para ${cls}`);
  for (const cls of Data.CLASS_IDS) {
    const a = Data.CLASSES[cls];
    for (const s of a.skills) assert.ok(types.includes(s.type), `tipo ${s.type}`);
    for (const b of Object.values(a.branches)) assert.ok(types.includes(b.ultimate.type) && b.passive.desc && b.masterUlt.desc, `rama ${b.name}`);
  }
  ok(Data.CLASS_IDS.every((c) => Data.CLASSES[c].skills.length === 5 && Object.keys(Data.CLASSES[c].branches).length === 2), 'cada raza tiene 5 habilidades y 2 ramas');
  ok(Data.CLASS_IDS.every((c) => Data.skillsFor(c, 0).length === 6 && Data.skillsFor(c, 0).filter((s) => s.lvl === 1).length === 3), 'en el nivel 1 hay 3 habilidades y la barra tiene 6 casillas');
  ok(Data.CLASS_IDS.every((c) => Data.WEAPON_TIERS[c].length === 6 && Data.WEAPON_TIERS[c].every((id) => Data.ITEMS[id] && Data.ITEMS[id].cls === c && Data.CLASSES[c].weaponTypes.includes(Data.ITEMS[id].weaponType))), 'cada raza tiene un arma de su tipo por grado');
  ok(Object.values(Data.ARMOR_TIERS).every((ids) => ids.length === 6 && ids.every((id) => Data.ITEMS[id])), 'cada tipo de armadura tiene los 6 grados');
  ok(Data.MAX_LEVEL === 50, 'el nivel máximo es 50');
}

// 1) Cada raza caza en una zona de su nivel
for (const cls of Data.CLASS_IDS) {
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const data = Sim.newCharacter(`Bot ${cls}`, cls, cls === 'elfo' ? 'f' : 'm');
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
  const p = Sim.addPlayer(w, { ...Sim.newCharacter('Muro', 'oso'), pos: front });
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
  const p = Sim.addPlayer(w, { ...Sim.newCharacter('Nadador', 'gnomo'), pos: deep });
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
  const a = Sim.addPlayer(w, { ...Sim.newCharacter('Ana', 'elfo', 'f'), level: 3, pos: { x: 50, z: 14 } });
  const b = Sim.addPlayer(w, { ...Sim.newCharacter('Beto', 'lagarto'), level: 3, pos: { x: 51, z: 15 } });
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
  const p = Sim.addPlayer(w, { ...Sim.newCharacter('Cazador', 'elfo'), level: 6, pos: { x: m.pos.x + 5, z: m.pos.z } });
  m.hp = Math.round(m.maxHp * 0.3);
  m.aggro = p;
  m.pos.x = m.spawn.x + 60; // lejos de su sitio: deja de perseguir y vuelve
  run(w, 0.5);
  ok(m.state === 'return', 'el monstruo vuelve a su sitio');
  ok(m.hp < m.maxHp * 0.5, `no se cura al instante (vida ${Math.round((m.hp / m.maxHp) * 100)}%)`);
}

// 6) Habilidades: la carga aturde, el rayo rebota entre varios, el aliento quema con el tiempo
{
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const g = Sim.addPlayer(w, { ...Sim.newCharacter('Gu', 'lagarto'), level: 15, pos: { x: 22, z: -70 } });
  const goblin = w.mobs.filter((m) => m.key === 'goblin').sort((a, b) => Math.hypot(a.pos.x - 22, a.pos.z + 70) - Math.hypot(b.pos.x - 22, b.pos.z + 70))[0];
  goblin.pos.x = 30;
  goblin.pos.z = -70;
  goblin.maxHp = goblin.hp = 1e6;
  C.setTarget(w, g, goblin);
  C.useSkill(w, g, 2); // Carga Heroica
  run(w, 0.6);
  ok(goblin.stunT > 0, 'la Carga Heroica aturde al objetivo');

  const mg = Sim.addPlayer(w, { ...Sim.newCharacter('Ma', 'gnomo', 'f'), level: 15, pos: { x: 22, z: -74 } });
  for (const m of w.mobs.filter((x) => x.key === 'goblin').slice(0, 3)) {
    m.pos.x = 28 + Math.random() * 3;
    m.pos.z = -74 + Math.random() * 3;
    m.maxHp = m.hp = 1e6;
  }
  Sim.drainEvents(w);
  C.setTarget(w, mg, w.mobs.find((x) => x.key === 'goblin' && x !== goblin));
  C.useSkill(w, mg, 0); // Rayo de Cristal
  run(w, 0.2);
  const chain = Sim.drainEvents(w).find((e) => e.type === 'chain');
  ok(chain && chain.pts.length >= 3, 'el Rayo de Cristal rebota entre varios enemigos');

  goblin.stunT = 0;
  g.pos.x = goblin.pos.x - 2;
  g.pos.z = goblin.pos.z;
  g.cds = {};
  g.mp = g.stats.maxMp;
  C.useSkill(w, g, 1); // Aliento de Chispa
  run(w, 0.3);
  ok(goblin.dots.some((d) => d.kind === 'burn'), 'el Aliento de Chispa quema');
  g.cds = {};
  g.mp = g.stats.maxMp;
  C.useSkill(w, g, 4); // Corte Cruzado: bloqueado sin el Despertar
  ok(!g.cds.corte_cruzado, 'Corte Cruzado está bloqueado hasta el Despertar');
}

// 7) Tienda: hay que estar junto al mercader y se puede comprar y vender en cantidad
{
  const w = Sim.createWorld();
  const p = Sim.addPlayer(w, Sim.newCharacter('Cliente', 'gnomo'));
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
  C.buyItem(w, p, 'w_lagarto_cobre');
  ok(p.gold === 480, 'un gnomo no puede comprar armas de lagarto');
  C.buyItem(w, p, 'pocion_mana', 4);
  ok(p.gold === 380 && Sim.countItem(p, 'pocion_mana') === 8, 'se compran varias pociones de una vez');
  const idx = p.inv.findIndex((s) => s.id === 'pocion_mana');
  C.sellItem(w, p, idx, 3);
  ok(Sim.countItem(p, 'pocion_mana') === 5, 'se venden varias unidades de una vez');
  const save = Sim.serialize(p);
  ok(save.cls === 'gnomo' && save.v === 4 && save.stage === 0 && save.inv.length === p.inv.length, 'la partida se serializa');
}

// 8) Hablar con un NPC lejano: el jugador camina hasta él (rodeando obstáculos) y habla
{
  for (const id of ['sanadora', 'capitana', 'mercader', 'maestro']) {
    const w = Sim.createWorld();
    const p = Sim.addPlayer(w, Sim.newCharacter('Viajero', 'hada'));
    C.talkTo(w, p, id);
    let talked = false;
    for (let t = 0; t < 8 && !talked; t += DT) {
      Sim.step(w, DT);
      talked = Sim.drainEvents(w).some((e) => (e.type === 'log' && e.cls === 'npc') || e.type === 'openShop' || e.type === 'openMaster');
    }
    ok(talked, `al llegar junto a ${id}, responde`);
  }
}

// 9) Equipo: cada raza solo usa su armadura, sus armas y el grado que le corresponde
{
  const w = Sim.createWorld();
  const p = Sim.addPlayer(w, { ...Sim.newCharacter('Bruno', 'oso'), level: 12 });
  const prob = (id) => Data.equipProblem(p, Data.ITEMS[id]);
  ok(!prob('w_oso_cobre') && !prob('a_heavy_cobre'), 'el oso usa martillos y armadura pesada');
  ok(prob('w_elfo_madera') && prob('a_cloth_madera') && prob('a_light_madera'), 'el oso no puede usar arcos ni otras armaduras');
  ok(/cambio de clase/.test(prob('w_oso_azul')), 'el grado Azul exige el Despertar');
  ok(/Berserker/.test(prob('gran_martillo_tronador')), 'el martillo a dos manos es solo del Oso Berserker');
  p.inv.push({ id: 'w_elfo_madera', qty: 1 });
  C.useItem(w, p, p.inv.length - 1);
  ok(p.equip.weapon === 'w_oso_madera', 'el servidor rechaza equipar un arma de otra raza');
  // Equipo inválido guardado: vuelve al inventario al entrar
  const q = Sim.addPlayer(w, { ...Sim.newCharacter('Elsa', 'elfo', 'f'), equip: { weapon: 'w_oso_madera', armor: 'a_light_azul' } });
  ok(!q.equip.weapon && !q.equip.armor && q.inv.some((s) => s.id === 'w_oso_madera'), 'el equipo que no corresponde se desequipa al entrar');
}

// 10) Cambios de clase con el Maestro: nivel, misión, rama y habilidades
{
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const master = Data.NPCS.find((n) => n.id === 'maestro');
  const atMaster = (p) => {
    p.pos.x = master.x + 1.5;
    p.pos.z = master.z + 1.5;
  };
  const p = Sim.addPlayer(w, { ...Sim.newCharacter('Lia', 'elfo', 'f'), level: 9 });
  atMaster(p);
  C.classQuest(w, p, 'accept');
  ok(!p.quest, 'antes del nivel 10 no se puede hacer el Despertar');
  p.level = 10;
  C.classQuest(w, p, 'accept');
  ok(p.quest && p.quest.stage === 1, 'en el nivel 10 se acepta la Prueba del Gremio');
  C.classQuest(w, p, 'complete');
  ok(p.stage === 0, 'no se completa sin cumplir la misión');
  // Caza en el Fuerte de los Orcos (nivel 8–11): cuenta para la misión
  const def = Data.questFor(1);
  p.pos.x = -92;
  p.pos.z = -62;
  p.level = 14;
  const tick = bot(w, p);
  for (let t = 0; t < 400 && p.quest.kills < def.need; t += DT) {
    tick();
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
    Sim.step(w, DT);
  }
  Sim.drainEvents(w);
  ok(p.quest.kills >= def.need, `los monstruos de nivel ${def.minLvl}+ cuentan para la misión (${p.quest.kills}/${def.need})`);
  atMaster(p);
  C.classQuest(w, p, 'complete');
  ok(p.stage === 1 && Data.className(p.cls, p.sex, p.stage) === 'Explorador del Bosque', 'Despertar completado: Explorador del Bosque');
  ok(Sim.skillReady(p, p.skills[3]) && Sim.skillReady(p, p.skills[4]) && !Sim.skillReady(p, p.skills[5]), 'se desbloquean 2 habilidades; la Ultimate sigue bloqueada');
  ok(p.inv.some((s) => s.id === 'w_elfo_azul'), 'el gremio regala un arma de Cristal Azul');
  // Especialización (nivel 25): hay que elegir rama
  p.level = 25;
  C.classQuest(w, p, 'accept');
  ok(!p.quest, 'la Especialización exige elegir rama');
  C.classQuest(w, p, 'accept', 'b');
  p.quest.kills = Data.questFor(2).need;
  C.classQuest(w, p, 'complete');
  ok(p.stage === 2 && p.branch === 'b' && p.passive.moveAttack && p.skills[5].id === 'tornado', 'rama B: Jinete del Viento con pasiva y Ultimate');
  // Ascensión (nivel 40): derrotar al jefe con el grupo
  p.level = 40;
  C.classQuest(w, p, 'accept');
  const boss = w.mobs.find((m) => m.key === Data.TOP_BOSS);
  p.pos.x = boss.pos.x + 3;
  p.pos.z = boss.pos.z;
  p.queued = null;
  p.leap = null;
  C.setTarget(w, p, boss);
  C.attack(w, p);
  // Se mantiene al jefe con 1 de vida (sin volver a su sitio) hasta que cae
  run(w, 4, () => {
    if (!boss.dead) {
      boss.hp = Math.min(boss.hp, 1);
      boss.state = 'idle';
    }
  });
  ok(p.quest.kills >= 1, `derrotar a ${boss.def.name} cumple la Prueba de Ascensión`);
  atMaster(p);
  C.classQuest(w, p, 'complete');
  ok(p.stage === 3 && p.skills[5].master && Data.className(p.cls, p.sex, 3, 'b') === 'Sombra del Vendaval', 'Ascensión Maestra: Sombra del Vendaval con Ultimate Maestra');
  const back = Sim.addPlayer(Sim.createWorld(), Sim.serialize(p));
  ok(back.stage === 3 && back.branch === 'b' && back.skills[5].master, 'la etapa y la rama se guardan');
}

// 11) Sin castigo al caer, botín personal en grupo y migración de personajes antiguos
{
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const p = Sim.addPlayer(w, { ...Sim.newCharacter('Kiko', 'gnomo'), level: 5, xp: 300, pos: { x: 50, z: 14 } });
  p.hp = 1;
  const m = w.mobs.find((x) => x.key === 'jabali');
  m.aggro = p;
  m.pos.x = p.pos.x + 1;
  m.pos.z = p.pos.z;
  run(w, 6, () => {
    if (!p.dead) p.hp = Math.min(p.hp, 1);
  });
  ok(p.dead, 'el personaje cae');
  C.respawn(w, p);
  ok(!p.dead && p.xp === 300, 'al caer no se pierde experiencia');
  ok(Math.hypot(p.pos.x, p.pos.z) > 15, 'despierta en un lugar seguro cerca, no en la aldea');

  const a = Sim.addPlayer(w, { ...Sim.newCharacter('Uno', 'oso'), level: 5, pos: { x: 50, z: 14 } });
  const b = Sim.addPlayer(w, { ...Sim.newCharacter('Dos', 'hada', 'f'), level: 5, pos: { x: 51, z: 14 } });
  C.partyInvite(w, a, b.id);
  C.partyAnswer(w, b, true);
  const goldB = b.gold;
  const target = w.mobs.find((x) => x.key === 'jabali' && !x.dead);
  target.hp = 1;
  target.pos.x = 52;
  target.pos.z = 14;
  C.setTarget(w, a, target);
  C.attack(w, a);
  run(w, 3);
  ok(b.gold > goldB, 'cada miembro del grupo recibe su propio oro (botín personal)');

  const mig = Data.migrateCharacter('guerrero', { v: 3, level: 12, inv: [{ id: 'hoja_azul', qty: 1 }, { id: 'piel', qty: 2 }], equip: { weapon: 'hoja_runica', armor: 'placas' } });
  ok(mig.cls === 'lagarto' && mig.data.stage === 1 && mig.data.equip.weapon === 'w_lagarto_azul' && mig.data.equip.armor === 'a_medium_azul', 'un Guerrero antiguo pasa a Caballero Lagarto con equipo equivalente');
  ok(Data.migrateCharacter('arquera', { v: 3, level: 3 }).cls === 'elfo' && Data.migrateCharacter('mago', { v: 3, level: 3 }).cls === 'gnomo', 'Arquera → Elfo y Mago → Gnomo');
  ok(!Data.migrateCharacter('oso', { v: 4, level: 3 }).migrated, 'los personajes nuevos no se migran');
}

console.log(`\nSimulación OK: ${checks} comprobaciones superadas.`);
