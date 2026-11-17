// Prueba del servidor online: lo arranca de verdad y conecta dos jugadores por WebSocket.
// Uso: (cd server && npm install) && node test/server.test.js
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));

const PORT = 18000 + Math.floor(Math.random() * 1000);
const URL = `ws://127.0.0.1:${PORT}/ws`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, cls, save) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = { ws, name, id: null, snaps: [], events: [], chats: [], last: null };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', v: 1, name, cls, save })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') c.id = m.id;
      else if (m.t === 's') {
        c.last = m;
        c.snaps.push(m);
        if (c.snaps.length === 1) resolve(c);
      } else if (m.t === 'e') c.events.push(...m.e);
      else if (m.t === 'chat') c.chats.push(m);
      else if (m.t === 'error') reject(new Error(m.msg));
    });
    ws.on('error', reject);
    c.send = (msg) => ws.send(JSON.stringify(msg));
  });
}

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => srv.stdout.on('data', (d) => String(d).includes('servidor en el puerto') && resolve()));
  let checks = 0;
  const ok = (cond, msg) => {
    assert.ok(cond, msg);
    checks++;
    console.log(`  ✓ ${msg}`);
  };

  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/status`);
    const status = await res.json();
    ok(status.ok && status.protocol === 1, 'el servidor responde en /status');

    // Una partida con valores imposibles debe quedar dentro de los límites
    const cheat = { cls: 'arquera', level: 999, gold: -50, xp: 1e12, inv: [{ id: 'no_existe', qty: 5 }, { id: 'pocion_vida', qty: 3 }], equip: { weapon: 'filo_crepusculo', armor: 'egida' }, pos: { x: 0, z: 5 } };
    const a = await client('Ana<script>', 'arquera', cheat);
    const b = await client('Beto', 'guerrero', null);
    // Ciro está lejos de todo (más allá del radio de visión de 72 m)
    const far = await client('Ciro', 'mago', { cls: 'mago', level: 3, pos: { x: -120, z: 95 } });
    ok(a.id && b.id && a.id !== b.id, 'dos jugadores reciben identificadores distintos');
    // Nombre repetido (sin importar mayúsculas): se rechaza
    let dupError = null;
    await client('beto', 'mago', null).catch((e) => (dupError = e.message));
    ok(dupError && dupError.includes('Ya hay un jugador'), 'no se permiten dos jugadores conectados con el mismo nombre');

    const proto = await client('Proto', '__proto__', { cls: '__proto__', inv: [{ id: '__proto__', qty: 1 }] });
    const protoRow = proto.last.p.find((r) => r[0] === proto.id);
    ok(protoRow[10] === 'guerrero' && proto.last.me.inv.every((s) => s.id !== '__proto__'), 'clases y objetos "__proto__" se rechazan');
    proto.ws.close();

    const meA = a.last.me;
    ok(meA.level === 20 && meA.gold === 0, 'nivel y oro de una partida trucada se limitan');
    ok(meA.inv.length === 1 && meA.inv[0].id === 'pocion_vida', 'los objetos inexistentes se descartan');
    ok(meA.equip.weapon === 'arco_corto', 'no puede equipar un arma de otra clase');

    await wait(400);
    const rowsA = a.last.p.map((r) => r[0]);
    ok(rowsA.includes(b.id), 'Ana ve a Beto en la aldea');
    const nameRow = b.last.p.find((r) => r[0] === a.id);
    ok(nameRow && !/[<>]/.test(nameRow[11]), 'el nombre se limpia de caracteres peligrosos');

    // Chat
    a.send({ t: 'chat', text: 'Hola, ¿alguien para cazar lobos?' });
    await wait(300);
    ok(b.chats.some((m) => m.kind === 'player' && m.text.startsWith('Hola')), 'Beto recibe el chat de Ana');

    // Movimiento con clic: Beto camina hacia el este
    const startX = b.last.p.find((r) => r[0] === b.id)[1];
    b.send({ t: 'move', x: 15, z: 5 });
    await wait(1500);
    const nowX = b.last.p.find((r) => r[0] === b.id)[1];
    ok(nowX > startX + 5, `Beto se mueve en el servidor (${startX.toFixed(1)} → ${nowX.toFixed(1)})`);

    // Combate: Beto va a los prados y ataca a un jabalí
    b.send({ t: 'move', x: 44, z: 12 });
    await wait(5000);
    const me = b.last.p.find((r) => r[0] === b.id);
    const boar = b.last.m
      .filter((r) => r[1] === 'jabali' && !r[7])
      .sort((r1, r2) => Math.hypot(r1[2] - me[1], r1[4] - me[3]) - Math.hypot(r2[2] - me[1], r2[4] - me[3]))[0];
    ok(!!boar, 'Beto ve jabalíes en los Prados de Brezo');
    b.send({ t: 'target', id: boar[0] });
    b.send({ t: 'attack' });
    await wait(6000);
    const hits = b.events.filter((e) => e.type === 'float' && e.ent === boar[0]);
    ok(hits.length > 0, `el servidor calcula el daño de Beto al jabalí (${hits.length} golpes)`);
    ok(!far.events.some((e) => e.type === 'float' && e.ent === boar[0]), 'Ciro, lejos, no recibe eventos de ese combate');
    ok(!far.last.p.some((r) => r[0] === b.id), 'Ciro no ve a Beto a más de 72 m');
    far.ws.close();

    // Ajenos al protocolo: mensajes basura no rompen el servidor
    b.ws.send('{esto no es json');
    b.send({ t: 'skill', i: 'x' });
    b.send({ t: 'buy', id: '__proto__' });
    await wait(300);
    const before = b.snaps.length;
    await wait(500);
    ok(b.snaps.length > before, 'el servidor sigue funcionando tras mensajes inválidos');

    // Desconexión
    a.ws.close();
    await wait(400);
    ok(b.chats.some((m) => m.kind === 'sys' && m.text === 'Anascript ha dejado Valdoria.'), 'se avisa cuando un jugador sale');
    ok(!b.last.p.some((r) => r[0] === a.id), 'Ana desaparece del mundo de Beto');
    b.ws.close();
    console.log(`\nServidor OK: ${checks} comprobaciones superadas.`);
  } finally {
    srv.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
