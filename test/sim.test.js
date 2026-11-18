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
      if (C.targetNearest(w, p)) C.attack(w, p);
      else {
        // Nada cerca: camina hacia el monstruo vivo más cercano (como haría un jugador)
        let best = null;
        let bd = Infinity;
        for (const m of w.mobs) {
          if (m.dead || m.def.boss) continue;
          const d = Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
          if (d < bd) [best, bd] = [m, d];
        }
        if (best && !p.moveTarget) C.moveTo(w, p, best.pos);
      }
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
  data.pos = { x: 50, z: 14 }; // Praderas de los Bloques
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
  const m = w.mobs.find((x) => x.key === 'lobo_madera');
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
  const goblin = w.mobs.filter((m) => m.key === 'duende').sort((a, b) => Math.hypot(a.pos.x - 22, a.pos.z + 70) - Math.hypot(b.pos.x - 22, b.pos.z + 70))[0];
  goblin.pos.x = 30;
  goblin.pos.z = -70;
  goblin.maxHp = goblin.hp = 1e6;
  C.setTarget(w, g, goblin);
  C.useSkill(w, g, 2); // Carga Heroica
  run(w, 0.6);
  ok(goblin.stunT > 0, 'la Carga Heroica aturde al objetivo');

  const mg = Sim.addPlayer(w, { ...Sim.newCharacter('Ma', 'gnomo', 'f'), level: 15, pos: { x: 22, z: -74 } });
  for (const m of w.mobs.filter((x) => x.key === 'duende').slice(0, 3)) {
    m.pos.x = 28 + Math.random() * 3;
    m.pos.z = -74 + Math.random() * 3;
    m.maxHp = m.hp = 1e6;
  }
  Sim.drainEvents(w);
  C.setTarget(w, mg, w.mobs.find((x) => x.key === 'duende' && x !== goblin));
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
  // Caza en el Bosque de Árboles Gigantes (nivel 5–12): cuenta para la misión
  const def = Data.questFor(1);
  p.pos.x = -50;
  p.pos.z = 48;
  p.level = 14;
  const tick = bot(w, p);
  for (let t = 0; t < 900 && p.quest.kills < def.need; t += DT) {
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
    p.hp = p.stats.maxHp; // el jefe pega muy fuerte: la prueba solo comprueba la misión
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
  const m = w.mobs.find((x) => x.key === 'oveja');
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
  const target = w.mobs.find((x) => x.key === 'oveja' && !x.dead);
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

// 12) Fase 2: invocaciones, estados alterados, Gemas de Poder y cúpula
{
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const orcs = w.mobs.filter((m) => m.key === 'golem_piedra').slice(0, 3);
  const at = { x: 58, z: 22 }; // campo abierto en las Praderas
  for (const m of orcs) {
    m.pos.x = at.x + 3;
    m.pos.z = at.z;
    m.spawn.x = m.pos.x; // su "casa" también se mueve, para que no vuelvan a las Minas
    m.spawn.z = m.pos.z;
    m.maxHp = m.hp = 1e6;
  }
  // Mecha-Gólem: entidad que atrae a los monstruos y recibe sus golpes
  const g = Sim.addPlayer(w, { ...Sim.newCharacter('Tuerca', 'gnomo'), level: 30, stage: 2, branch: 'b', pos: at });
  g.mp = g.stats.maxMp;
  C.setTarget(w, g, orcs[0]);
  C.useSkill(w, g, 5);
  ok(w.summons.some((u) => u.type === 'mecha' && u.owner === g), 'el Mecha-Gólem aparece como una entidad');
  run(w, 2);
  const mecha = w.summons.find((u) => u.type === 'mecha');
  ok(orcs.every((m) => m.aggro === mecha) && mecha.hp < mecha.maxHp, 'los monstruos atacan al Mecha-Gólem en vez de al gnomo');
  ok(orcs.some((m) => m.hp < 1e6), 'el Mecha-Gólem golpea a los monstruos');
  // Inventor: dos torretas a la vez; la tercera reemplaza a la más antigua
  for (let i = 0; i < 3; i++) {
    g.cds = {};
    g.mp = g.stats.maxMp;
    C.useSkill(w, g, 1);
  }
  ok(w.summons.filter((u) => u.owner === g && !u.dead).length === 2, 'el Inventor de Autómatas mantiene 2 invocaciones a la vez');
  // Mecha pilotado (nivel 40): va con el jugador y dispara láseres
  const g2 = Sim.addPlayer(w, { ...Sim.newCharacter('Piloto', 'gnomo', 'f'), level: 45, stage: 3, branch: 'b', pos: { x: at.x - 4, z: at.z } });
  g2.mp = g2.stats.maxMp;
  C.setTarget(w, g2, orcs[1]);
  C.useSkill(w, g2, 5);
  Sim.drainEvents(w);
  run(w, 1.5);
  const ride = w.summons.find((u) => u.owner === g2);
  ok(ride && ride.ride && g2.shield > 0 && Math.hypot(ride.pos.x - g2.pos.x, ride.pos.z - g2.pos.z) < 0.01, 'en el Mecha pilotado el gnomo va dentro y tiene escudo');
  ok(Sim.drainEvents(w).some((e) => e.type === 'beam' && e.color === 0xff5a5a), 'el Mecha pilotado dispara láseres');

  // Tornado Maestro: 2 clones de viento
  const e = Sim.addPlayer(w, { ...Sim.newCharacter('Viento', 'elfo'), level: 45, stage: 3, branch: 'b', pos: { x: at.x + 1, z: at.z + 1 } });
  e.mp = e.stats.maxMp;
  C.setTarget(w, e, orcs[2]);
  C.useSkill(w, e, 5);
  ok(w.summons.filter((u) => u.type === 'clone' && u.owner === e).length === 2, 'el Tornado Maestro crea 2 clones de viento');

  // Estados alterados: el sapo envenena y el Destello Purificador lo quita
  const h = Sim.addPlayer(w, { ...Sim.newCharacter('Mimi', 'hada', 'f'), level: 15, stage: 1, pos: { x: -50, z: 44 } });
  const sapo = w.mobs.find((m) => m.key === 'avispa');
  h.debuffs = {};
  // El sapo golpea una y otra vez hasta que envenena (40% por golpe)
  for (let i = 0; i < 40 && !h.debuffs.poison; i++) {
    h.hp = h.stats.maxHp;
    sapo.aggro = h;
    sapo.atkTimer = 0;
    sapo.pos.x = h.pos.x + 1;
    sapo.pos.z = h.pos.z;
    Sim.step(w, DT);
  }
  Sim.drainEvents(w);
  ok(!!h.debuffs.poison, 'la Avispa de Miel puede envenenar');
  const hp0 = h.hp;
  sapo.hp = 0;
  sapo.dead = true;
  run(w, 1.2);
  ok(h.hp < hp0, 'el veneno quita vida con el tiempo');
  h.mp = h.stats.maxMp;
  C.useSkill(w, h, 3); // Destello Purificador
  ok(!Object.keys(h.debuffs).length, 'el Destello Purificador quita el veneno');

  // Gemas de Poder: +25% de daño y gastan una por ataque
  const lz = Sim.addPlayer(w, { ...Sim.newCharacter('Gema', 'lagarto'), level: 10, pos: { x: 50, z: 14 } });
  const gems0 = Sim.countItem(lz, 'gema_poder');
  C.setGems(w, lz, true);
  const boar = w.mobs.find((m) => m.key === 'oveja' && !m.dead);
  boar.pos.x = 51.5;
  boar.pos.z = 14;
  boar.maxHp = boar.hp = 1e6;
  C.setTarget(w, lz, boar);
  C.attack(w, lz);
  run(w, 3);
  ok(lz.gemsOn && Sim.countItem(lz, 'gema_poder') < gems0, `cada ataque gasta una Gema de Poder (${gems0} → ${Sim.countItem(lz, 'gema_poder')})`);
  const withGems = 1e6 - boar.hp;
  const n1 = gems0 - Sim.countItem(lz, 'gema_poder');
  lz.inv = lz.inv.filter((s2) => s2.id !== 'gema_poder');
  boar.hp = 1e6;
  run(w, 3);
  ok(!lz.gemsOn, 'sin gemas se desactivan solas');
  const without = 1e6 - boar.hp;
  ok(withGems / n1 > (without / Math.max(1, n1)) * 1.05, 'con gemas el daño por golpe es mayor');

  // Fortaleza Cubo: dentro de la cúpula se recibe la mitad de daño
  const bear = Sim.addPlayer(w, { ...Sim.newCharacter('Muro', 'oso'), level: 30, stage: 2, branch: 'a', pos: { x: 0, z: 30 } });
  bear.mp = bear.stats.maxMp;
  C.useSkill(w, bear, 5);
  run(w, 0.6);
  ok(Sim.liveStats(bear).dr >= 0.5, 'dentro de la cúpula de la Fortaleza Cubo se recibe la mitad de daño');
}

// 13) Fase 3: huevo de mascota, botín en el suelo, montura y montura planeadora
{
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  // Huevo al llegar al nivel 5
  const p = Sim.addPlayer(w, { ...Sim.newCharacter('Pipo', 'elfo'), level: 4, pos: { x: 50, z: 14 } });
  ok(!p.inv.some((s) => s.id === 'huevo_mascota'), 'en el nivel 4 aún no hay huevo');
  p.xp = Data.xpToNext(4) - 1;
  const boar = w.mobs.find((m) => m.key === 'oveja');
  boar.pos.x = 52;
  boar.pos.z = 14;
  boar.hp = 1;
  C.setTarget(w, p, boar);
  C.attack(w, p);
  run(w, 3);
  ok(p.level >= 5 && p.inv.some((s) => s.id === 'huevo_mascota'), 'al llegar al nivel 5 se recibe el Huevo de Mascota');
  // Botín en el suelo: sin mascota hay que acercarse (o llega solo a los 30 s)
  w.loot.length = 0;
  p.inv = p.inv.filter((s) => s.id !== 'piel');
  const near = { x: p.pos.x + 6, z: p.pos.z };
  w.loot.push({ id: 'bx1', owner: p.id, item: 'piel', qty: 2, pos: { ...near, y: 0 }, t: 30, fetching: false });
  run(w, 0.5);
  ok(w.loot.length === 1, 'sin mascota, el botín espera en el suelo');
  C.moveTo(w, p, near);
  run(w, 2);
  ok(!w.loot.length && Sim.countItem(p, 'piel') === 2, 'al pasar por encima se recoge');
  // Nace la mascota y trae el botín cercano
  const egg = p.inv.findIndex((s) => s.id === 'huevo_mascota');
  C.useItem(w, p, egg);
  ok(Sim.drainEvents(w).some((e) => e.type === 'hatchChoose' && e.to === p.id), 'usar el huevo abre la elección de mascota');
  C.hatchPet(w, p, 'dragon');
  ok(p.pet && p.pet.type === 'dragon' && !p.inv.some((s) => s.id === 'huevo_mascota'), 'nace el Dragoncito y el huevo se gasta');
  w.loot.push({ id: 'bx2', owner: p.id, item: 'colmillo', qty: 1, pos: { x: p.pos.x + 10, y: 0, z: p.pos.z }, t: 30, fetching: false });
  run(w, 2);
  ok(!w.loot.length && Sim.countItem(p, 'colmillo') === 1, 'la mascota va a buscar el botín y lo trae');
  // Botín olvidado: llega solo a la mochila
  w.loot.push({ id: 'bx3', owner: p.id, item: 'piel', qty: 1, pos: { x: p.pos.x + 40, y: 0, z: p.pos.z }, t: 0.2, fetching: false });
  run(w, 0.5);
  ok(!w.loot.length && Sim.countItem(p, 'piel') === 3, 'el botín que nadie recoge llega solo a la mochila');
  // Montura terrestre (nivel 20): más rápida; atacar te baja
  C.toggleMount(w, p);
  ok(!p.mounted, 'antes del nivel 20 no se puede montar');
  p.level = 20;
  p.combatT = 0;
  C.toggleMount(w, p);
  ok(p.mounted === 1 && Sim.liveStats(p).speed > p.stats.speed * 1.5, 'en el nivel 20 se monta: +60% de velocidad');
  const target = w.mobs.find((m) => !m.dead && m.key === 'oveja');
  C.setTarget(w, p, target);
  C.attack(w, p);
  ok(!p.mounted, 'atacar te baja de la montura');
  // Planeadora (nivel 40 + Ascensión): cruza el agua sin nadar
  let deep = null;
  for (let x = -170; x < 170 && !deep; x += 3) for (let z = -170; z < 170 && !deep; z += 3) if (Terrain.waterDepth(x, z) > Terrain.DEEP_DEPTH + 0.6 && Math.hypot(x, z) < 175) deep = { x, z };
  const g = Sim.addPlayer(w, { ...Sim.newCharacter('Alas', 'hada', 'f'), level: 42, stage: 3, branch: 'a', pet: { type: 'buho' }, pos: deep });
  C.toggleMount(w, g);
  run(w, 1);
  ok(g.mounted === 2 && !g.swimming && !g.deep && g.pos.y > Terrain.WATER_Y, 'la montura planeadora vuela sobre el agua sin nadar');
  const save = Sim.serialize(g);
  ok(save.pet && save.pet.type === 'buho', 'la mascota se guarda con el personaje');
  // Al salir, el botín del suelo pasa a la mochila
  w.loot.push({ id: 'bx4', owner: g.id, item: 'piel', qty: 4, pos: { x: 0, y: 0, z: 0 }, t: 30, fetching: false });
  Sim.collectAllLoot(w, g);
  ok(Sim.countItem(g, 'piel') === 4 && !w.loot.length, 'al salir del juego el botín pendiente no se pierde');
  // Personajes antiguos de nivel 5 o más reciben su huevo al entrar
  const old = Sim.addPlayer(w, { ...Sim.newCharacter('Viejo', 'oso'), level: 12 });
  ok(old.inv.some((s) => s.id === 'huevo_mascota'), 'los personajes que ya pasaron el nivel 5 reciben su huevo');
}

// 14) Fase 4: zonas del 1 al 40, Ciudadela segura, transporte, Herrero y jefes con mecánicas
{
  const w = Sim.createWorld();
  Sim.spawnMobs(w);
  const ids = Data.ZONES.map((z) => z.id).join(',');
  ok(ids === 'aldea,praderas,bosque,minas,ciudadela,valle,islas', 'el mundo tiene las 6 zonas del documento más la aldea');
  ok(Data.TOP_BOSS === 'guardian' && ['rey_tronco', 'mega_automata', 'ignis', 'guardian'].every((k) => Data.MOBS[k].boss), 'hay 4 jefes y el Gran Guardián es el de la Ascensión');
  ok(w.mobs.every((m) => !Terrain.inSafe(m.pos)), 'ningún monstruo aparece en la aldea ni en la Ciudadela');
  const isl = Data.ZONES.find((z) => z.id === 'islas');
  ok(Terrain.heightAt(isl.x, isl.z) > 15, 'las Islas Flotantes están sobre las nubes');

  // La Ciudadela es zona segura: los monstruos dejan de perseguirte
  const cz = Data.ZONES.find((z) => z.id === 'ciudadela');
  const safe = Sim.addPlayer(w, { ...Sim.newCharacter('Seguro', 'oso'), level: 30, pos: { x: cz.x, z: cz.z + 6 } });
  const chaser = w.mobs.find((m) => m.key === 'lobo_madera');
  chaser.aggro = safe;
  run(w, 0.3);
  ok(chaser.aggro !== safe, 'en la Ciudadela los monstruos dejan de perseguirte');

  // Vagoneta y portal
  const traveller = Sim.addPlayer(w, { ...Sim.newCharacter('Viajera', 'elfo', 'f'), level: 12 });
  const cart = Data.NPCS.find((n) => n.id === 'vagoneta_aldea');
  traveller.pos.x = cart.x + 1;
  traveller.pos.z = cart.z + 1;
  C.talkTo(w, traveller, 'vagoneta_aldea');
  ok(Terrain.zoneAt(traveller.pos) && Terrain.zoneAt(traveller.pos).id === 'minas', 'la vagoneta lleva a las Minas');
  const portal = Data.NPCS.find((n) => n.id === 'portal_islas');
  traveller.pos.x = portal.x - 1;
  traveller.pos.z = portal.z;
  C.talkTo(w, traveller, 'portal_islas');
  ok(Terrain.zoneAt(traveller.pos).id === 'ciudadela', 'el portal a las Islas exige nivel 30');
  traveller.level = 30;
  C.talkTo(w, traveller, 'portal_islas');
  ok(Terrain.zoneAt(traveller.pos).id === 'islas', 'con nivel 30 el portal lleva a las Islas Flotantes');

  // Herrero Celestial: equipo a cambio de Polvo de Arcoíris
  const smith = Data.NPCS.find((n) => n.id === 'herrero');
  const buyer = Sim.addPlayer(w, { ...Sim.newCharacter('Forja', 'lagarto'), level: 40, stage: 3, branch: 'a', pos: { x: smith.x + 1.5, z: smith.z } });
  buyer.inv.push({ id: 'polvo_arcoiris', qty: 12 });
  const gold0 = buyer.gold;
  C.buyItem(w, buyer, Data.weaponFor('lagarto', 'arcoiris'));
  ok(Sim.countItem(buyer, Data.weaponFor('lagarto', 'arcoiris')) === 1 && Sim.countItem(buyer, 'polvo_arcoiris') === 0 && buyer.gold === gold0, 'el Herrero cambia 12 Polvos de Arcoíris por un arma Arcoíris');
  C.buyItem(w, buyer, Data.armorFor('lagarto', 'arcoiris'));
  ok(!buyer.inv.some((s) => s.id === Data.armorFor('lagarto', 'arcoiris')), 'sin polvo suficiente no se forja');

  // Géiser del Valle: lanza al jugador
  const gy = Terrain.layout().geysers[0];
  const jumper = Sim.addPlayer(w, { ...Sim.newCharacter('Salto', 'gnomo'), level: 22, pos: { x: gy.x, z: gy.z } });
  run(w, 0.1);
  ok(!!jumper.leap && jumper.leap.hop > 5, 'los géiseres del Valle lanzan por los aires');

  // Rey Tronco: marca raíces en el suelo y enraíza a quien no se aparta
  const rt = w.mobs.find((m) => m.key === 'rey_tronco');
  const a = Sim.addPlayer(w, { ...Sim.newCharacter('Raiz', 'oso'), level: 15, pos: { x: rt.pos.x + 4, z: rt.pos.z } });
  C.setTarget(w, a, rt);
  C.attack(w, a);
  let marks = 0;
  let rooted = false;
  run(w, 10, () => {
    a.hp = a.stats.maxHp;
    for (const e of Sim.drainEvents(w)) if (e.type === 'telegraph') marks++;
    if (a.debuffs.root) rooted = true;
  });
  ok(marks >= 4 && rooted, 'el Rey Tronco marca raíces en el suelo y enraíza a quien no se aparta');

  // Mega-Autómata: inmune hasta pisar los 3 botones
  const ma = w.mobs.find((m) => m.key === 'mega_automata');
  const b = Sim.addPlayer(w, { ...Sim.newCharacter('Golpe', 'lagarto'), level: 20, pos: { x: ma.pos.x + 3, z: ma.pos.z } });
  C.setTarget(w, b, ma);
  C.attack(w, b);
  run(w, 3, () => (b.hp = b.stats.maxHp));
  ok(ma.hp === ma.maxHp, 'el Mega-Autómata no recibe daño con el escudo');
  const helpers = Data.ARENAS.fabrica.plates.map((pl, i) => Sim.addPlayer(w, { ...Sim.newCharacter(`Boton${i}`, 'hada'), level: 20, pos: { x: pl.x, z: pl.z } }));
  run(w, 3, () => [b, ...helpers].forEach((q) => (q.hp = q.stats.maxHp)));
  ok(ma.hp < ma.maxHp, 'pisando los 3 botones a la vez se apaga el escudo y recibe daño');

  // Ignis: el bostezo de fuego no daña a quien se esconde detrás de una roca
  const ig = w.mobs.find((m) => m.key === 'ignis');
  const sh = Data.ARENAS.ignis.shelters[0];
  const dx = sh.x - ig.pos.x;
  const dz = sh.z - ig.pos.z;
  const len = Math.hypot(dx, dz);
  const hidden = Sim.addPlayer(w, { ...Sim.newCharacter('Escondido', 'oso'), level: 30, pos: { x: sh.x + (dx / len) * 2.6, z: sh.z + (dz / len) * 2.6 } });
  const exposed = Sim.addPlayer(w, { ...Sim.newCharacter('Expuesto', 'oso'), level: 30, pos: { x: ig.pos.x - 6, z: ig.pos.z + 6 } });
  ig.aggro = exposed;
  ig.mechT = 0.1;
  const hp1 = hidden.hp;
  const hp2 = exposed.hp;
  run(w, 3.5);
  ok(hidden.hp === hp1 && exposed.hp < hp2 * 0.5, 'Ignis bosteza fuego: detrás de la roca no pasa nada, al descubierto duele mucho');

  // Guardián: llama refuerzos a la mitad de su vida
  const gd = w.mobs.find((m) => m.key === 'guardian');
  const gg = Sim.addPlayer(w, { ...Sim.newCharacter('Final', 'elfo'), level: 40, pos: { x: gd.pos.x + 6, z: gd.pos.z } });
  C.setTarget(w, gg, gd);
  C.attack(w, gg);
  gd.hp = gd.maxHp * 0.49;
  run(w, 0.5, () => (gg.hp = gg.stats.maxHp));
  ok(w.mobs.filter((m) => m.temp).length === 3, 'el Gran Guardián Celestial llama 3 refuerzos a la mitad de su vida');
}

console.log(`\nSimulación OK: ${checks} comprobaciones superadas.`);
