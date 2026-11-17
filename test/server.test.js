// Prueba del servidor online: lo arranca de verdad y conecta jugadores por WebSocket.
// Uso: (cd server && npm install) && node test/server.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));

const PORT = 18000 + Math.floor(Math.random() * 1000);
const URL = `ws://127.0.0.1:${PORT}/ws`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const V = 2;

// Cliente de prueba: guarda todo lo que recibe y permite esperar un tipo de mensaje
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = { ws, inbox: [], snaps: [], events: [], chats: [], last: null, closed: false };
    c.send = (msg) => ws.send(JSON.stringify(msg));
    c.next = (type, ms = 4000) =>
      new Promise((res, rej) => {
        const i = c.inbox.findIndex((m) => m.t === type || (Array.isArray(type) && type.includes(m.t)));
        if (i >= 0) return res(c.inbox.splice(i, 1)[0]);
        const t0 = Date.now();
        const iv = setInterval(() => {
          const j = c.inbox.findIndex((m) => m.t === type || (Array.isArray(type) && type.includes(m.t)));
          if (j >= 0) {
            clearInterval(iv);
            res(c.inbox.splice(j, 1)[0]);
          } else if (Date.now() - t0 > ms) {
            clearInterval(iv);
            rej(new Error(`no llegó ${type}`));
          }
        }, 20);
      });
    ws.on('open', () => resolve(c));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 's') {
        c.last = m;
        c.snaps.push(m);
      } else if (m.t === 'e') c.events.push(...m.e);
      else if (m.t === 'chat') c.chats.push(m);
      else c.inbox.push(m);
    });
    ws.on('close', () => (c.closed = true));
    ws.on('error', reject);
  });
}

async function enter(user, email, pass, charName, cls, sex) {
  const c = await connect();
  c.send({ t: 'register', v: V, user, email, pass });
  const auth = await c.next(['auth', 'authError']);
  if (auth.t !== 'auth') throw new Error(auth.msg);
  c.session = auth.session;
  c.send({ t: 'createChar', name: charName, cls, sex });
  const list = await c.next(['chars', 'charError']);
  if (list.t !== 'chars') throw new Error(list.msg);
  c.charId = list.created;
  c.send({ t: 'play', id: c.charId });
  const wel = await c.next('welcome');
  c.id = wel.id;
  await wait(250);
  return c;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valdoria-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => srv.stdout.on('data', (d) => String(d).includes('servidor en el puerto') && resolve()));
  let checks = 0;
  const ok = (cond, msg) => {
    assert.ok(cond, msg);
    checks++;
    console.log(`  ✓ ${msg}`);
  };

  try {
    const status = await (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
    ok(status.ok && status.protocol === V && /^\d+\.\d+\.\d+$/.test(status.version), `el servidor responde (v${status.version})`);

    // ---------- Cuentas ----------
    const x = await connect();
    x.send({ t: 'register', v: V, user: 'a', email: 'malo', pass: '1' });
    ok((await x.next('authError')).msg.includes('ID'), 'se valida el ID al registrarse');
    x.send({ t: 'register', v: V, user: 'ana_01', email: 'no-es-correo', pass: 'secreto1' });
    ok((await x.next('authError')).msg.includes('correo'), 'se valida el correo');
    x.send({ t: 'register', v: V, user: 'ana_01', email: 'ana@example.com', pass: '123' });
    ok((await x.next('authError')).msg.includes('contraseña'), 'se valida la contraseña');
    x.send({ t: 'register', v: 1, user: 'ana_01', email: 'ana@example.com', pass: 'secreto1' });
    ok((await x.next('authError')).code === 'version', 'se rechaza una versión antigua del juego');
    x.ws.close();

    const a = await enter('ana_01', 'ana@example.com', 'secreto1', 'Selene', 'arquera', 'f');
    ok(!!a.id && !!a.session, 'Ana crea su cuenta, entra al instante y juega con su personaje');
    const meA = { ...a.last.me, ...a.snaps.find((x) => x.me && x.me.inv).me }; // el inventario llega solo cuando cambia
    ok(meA.level === 1 && meA.inv.length > 0 && meA.stats.crit > 0, 'el personaje nuevo empieza en nivel 1 con estadísticas de crítico');

    const dup = await connect();
    dup.send({ t: 'register', v: V, user: 'ANA_01', email: 'otra@example.com', pass: 'secreto1' });
    ok((await dup.next('authError')).msg.includes('en uso'), 'el ID de cuenta es único');
    dup.send({ t: 'register', v: V, user: 'otra', email: 'ANA@example.com', pass: 'secreto1' });
    ok((await dup.next('authError')).msg.includes('correo'), 'el correo es único');
    dup.send({ t: 'login', v: V, user: 'ana_01', pass: 'incorrecta' });
    ok((await dup.next('authError')).msg.includes('incorrectos'), 'contraseña incorrecta rechazada');
    dup.ws.close();

    const b = await enter('beto', 'beto@example.com', 'clave123', 'Orion', 'guerrero', 'm');
    ok(b.id && b.id !== a.id, 'Beto entra con su propia cuenta');

    // Nombres de personaje únicos y válidos
    const c3 = await connect();
    c3.send({ t: 'register', v: V, user: 'ciro', email: 'ciro@example.com', pass: 'clave123' });
    await c3.next('auth');
    c3.send({ t: 'createChar', name: 'selene', cls: 'mago', sex: 'm' });
    ok((await c3.next('charError')).msg.includes('ya pertenece'), 'no se repiten nombres de personaje');
    c3.send({ t: 'createChar', name: 'Brisa', cls: 'mago', sex: 'm' });
    ok((await c3.next('charError')).msg.includes('reservado'), 'los nombres de NPC están reservados');
    c3.send({ t: 'createChar', name: '<b>', cls: 'mago', sex: 'm' });
    ok((await c3.next('charError')).t === 'charError', 'nombres inválidos rechazados');
    c3.send({ t: 'createChar', name: 'Merlo', cls: '__proto__', sex: 'x' });
    const made = await c3.next('chars');
    ok(made.chars.length === 1 && made.chars[0].cls === 'guerrero' && made.chars[0].sex === 'm', 'clase y sexo inválidos se corrigen');
    const avail = await (await fetch(`http://127.0.0.1:${PORT}/name-available?name=Selene`)).json();
    const free = await (await fetch(`http://127.0.0.1:${PORT}/name-available?name=Nadie`)).json();
    ok(!avail.available && free.available, '/name-available indica si un nombre está libre');
    c3.send({ t: 'deleteChar', id: made.chars[0].id });
    ok((await c3.next('chars')).chars.length === 0, 'se puede borrar un personaje');
    c3.ws.close();

    // ---------- Juego ----------
    await wait(300);
    ok(a.last.p.some((r) => r[0] === b.id), 'Ana ve a Beto en la aldea');
    const rowA = b.last.p.find((r) => r[0] === a.id);
    ok(rowA && rowA[15] === 'f', 'se ve el sexo de los demás personajes');

    a.send({ t: 'chat', text: 'Hola, ¿alguien para cazar lobos?' });
    await wait(300);
    ok(b.chats.some((m) => m.kind === 'player' && m.text.startsWith('Hola')), 'Beto recibe el chat de Ana');

    // Grupo
    a.send({ t: 'invite', id: b.id });
    await wait(300);
    ok(b.events.some((e) => e.type === 'partyInvite' && e.name === 'Selene'), 'Beto recibe la invitación al grupo');
    b.send({ t: 'inviteAnswer', accept: true });
    await wait(400);
    ok(a.last.me.party && a.last.me.party.members.length === 2, 'Ana ve a Beto en su grupo con su vida y maná');
    b.send({ t: 'chat', text: '#vamos al bosque' });
    await wait(300);
    ok(a.chats.some((m) => m.kind === 'party' && m.text === 'vamos al bosque'), 'chat de grupo con #');

    // Movimiento y combate
    const startX = b.last.p.find((r) => r[0] === b.id)[1];
    b.send({ t: 'move', x: startX + 8, z: 6 });
    await wait(1600);
    const nowX = b.last.p.find((r) => r[0] === b.id)[1];
    ok(nowX > startX + 4, `Beto se mueve en el servidor (${startX.toFixed(1)} → ${nowX.toFixed(1)})`);

    // Compra (para probar el guardado): Beto va al mercader y compra una poción
    b.send({ t: 'talk', id: 'mercader' });
    await wait(2500);
    b.send({ t: 'buy', id: 'pocion_vida', q: 1 });
    await wait(300);
    const goldAfter = b.last.me.gold;
    ok(goldAfter === 20, `Beto compra una poción (oro ${goldAfter})`);

    // Mensajes basura no rompen el servidor
    b.ws.send('{esto no es json');
    b.send({ t: 'skill', i: 'x' });
    b.send({ t: 'buy', id: '__proto__' });
    b.send({ t: 'play', id: 'c999' });
    const before = b.snaps.length;
    await wait(500);
    ok(b.snaps.length > before, 'el servidor sigue funcionando tras mensajes inválidos');

    // Guardado: Beto sale y vuelve a entrar con su sesión
    b.ws.close();
    await wait(500);
    ok(a.chats.some((m) => m.kind === 'sys' && m.text === 'Orion ha dejado Valdoria.'), 'se avisa cuando un jugador sale');
    ok(!a.last.me.party, 'al salir Beto, el grupo se disuelve');
    const b2 = await connect();
    b2.send({ t: 'resume', v: V, session: b.session });
    const back = await b2.next('auth');
    ok(back.user === 'beto' && back.chars.length === 1 && back.chars[0].name === 'Orion', 'Beto reanuda su sesión y ve su personaje');
    b2.send({ t: 'play', id: back.chars[0].id });
    await b2.next('welcome');
    await wait(300);
    ok(b2.last.me.gold === 20, 'el oro gastado quedó guardado en el servidor');

    // Una cuenta no puede jugar dos veces a la vez
    const b3 = await connect();
    b3.send({ t: 'login', v: V, user: 'beto', pass: 'clave123' });
    await b3.next('auth');
    await wait(300);
    ok(b2.closed, 'al entrar en otro lugar, la sesión anterior se cierra');
    b3.ws.close();
    a.ws.close();
    await wait(400);

    const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
    const raw = JSON.stringify(db);
    ok(!raw.includes('secreto1') && !raw.includes(a.session), 'contraseñas y sesiones no se guardan en claro');
    ok(Object.keys(db.accounts).length === 3 && Object.keys(db.chars).length === 2, 'cuentas y personajes guardados en disco');
    console.log(`\nServidor OK: ${checks} comprobaciones superadas.`);
  } finally {
    srv.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
