// Panel de control del servidor: https://<servidor>/admin
//
// La página (admin.html + admin-app.js) se sirve desde aquí y habla con /admin/api/*.
// Acceso con la contraseña de la variable de entorno ADMIN_PASSWORD (secreto de Fly.io).
// Sin esa variable el panel queda cerrado. Tras varios intentos fallidos desde una misma
// dirección (o demasiados en total) el acceso se bloquea un rato.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { monitorEventLoopDelay } = require('perf_hooks');

const TOKEN_HOURS = 8;
const FAIL_LIMIT_IP = 5;
const FAIL_LIMIT_ALL = 25;
const LOCK_MS = 15 * 60 * 1000;
const LOG_LINES = 300;
const HISTORY_MIN = 24 * 60; // un punto por minuto durante 24 horas
const TZ = 'America/Santiago';

// ---------- Registro: últimas líneas de consola ----------

const logs = [];
function hookConsole() {
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      const text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a))).join(' ');
      logs.push({ at: Date.now(), level, text: text.slice(0, 600) });
      if (logs.length > LOG_LINES) logs.shift();
    };
  }
}
hookConsole();

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const dayKey = (t) => new Date(t).toLocaleDateString('es-CL', { timeZone: TZ });

function createAdmin(ctx) {
  const { world, clients, DB, Terrain, VERSION, started, send, broadcastChat, savePlayer, reports = [] } = ctx;
  const PASS = process.env.ADMIN_PASSWORD || '';
  const enabled = PASS.length >= 8;
  const tokens = new Map(); // hash del token → vence
  const fails = new Map(); // ip → { n, until }
  let failsAll = { n: 0, since: Date.now() };
  let restarting = false;

  // ---------- Mediciones ----------

  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let cpuPrev = process.cpuUsage();
  let cpuAt = Date.now();
  const metrics = { cpu: 0, loopMs: 0, loopMaxMs: 0 };
  setInterval(() => {
    const now = Date.now();
    const u = process.cpuUsage(cpuPrev);
    metrics.cpu = Math.round(((u.user + u.system) / 1000 / (now - cpuAt)) * 1000) / 10;
    cpuPrev = process.cpuUsage();
    cpuAt = now;
    metrics.loopMs = Math.round((loop.mean / 1e6) * 10) / 10;
    metrics.loopMaxMs = Math.round(loop.max / 1e6);
    loop.reset();
  }, 5000).unref();

  const history = [];
  let peak = { day: dayKey(Date.now()), n: 0, at: Date.now() };
  const trackPeak = () => {
    const n = world.players.size;
    const d = dayKey(Date.now());
    if (d !== peak.day) peak = { day: d, n: 0, at: Date.now() };
    if (n > peak.n) peak = { day: d, n, at: Date.now() };
  };
  setInterval(trackPeak, 5000).unref();
  setInterval(() => {
    history.push([Date.now(), world.players.size]);
    if (history.length > HISTORY_MIN) history.shift();
  }, 60000).unref();
  history.push([Date.now(), 0]);

  // ---------- Acceso ----------

  const ipOf = (req) => String(req.headers['fly-client-ip'] || req.socket.remoteAddress || '?');

  function locked(ip) {
    const now = Date.now();
    if (now - failsAll.since > LOCK_MS) failsAll = { n: 0, since: now };
    if (failsAll.n >= FAIL_LIMIT_ALL) return true;
    const f = fails.get(ip);
    return !!(f && f.n >= FAIL_LIMIT_IP && f.until > now);
  }

  function failed(ip) {
    const now = Date.now();
    const f = fails.get(ip);
    const n = f && f.until > now ? f.n + 1 : 1;
    fails.set(ip, { n, until: now + LOCK_MS });
    failsAll.n++;
    console.warn(`[admin] contraseña incorrecta desde ${ip} (${n})`);
  }

  function authed(req) {
    const m = /^Bearer (\S{20,100})$/.exec(req.headers.authorization || '');
    if (!m) return false;
    const h = sha(m[1]).toString('hex');
    const exp = tokens.get(h);
    if (!exp) return false;
    if (exp < Date.now()) {
      tokens.delete(h);
      return false;
    }
    return true;
  }

  // ---------- Datos ----------

  const zoneName = (pos) => {
    const z = Terrain.zoneAt(pos);
    return z ? z.name : 'Fuera de zona';
  };

  function playersList() {
    const out = [];
    for (const c of clients) {
      if (!c.p) continue;
      const p = c.p;
      out.push({
        id: p.id,
        name: p.name,
        account: c.acc ? c.acc.user : '?',
        cls: p.cls,
        sex: p.sex,
        level: p.level,
        hp: Math.round(p.hp),
        maxHp: p.stats.maxHp,
        dead: !!p.dead,
        zone: zoneName(p.pos),
        x: Math.round(p.pos.x),
        z: Math.round(p.pos.z),
        party: p.party || null,
        since: c.joinedAt || null,
        rtt: c.rtt == null ? null : c.rtt,
        ip: c.ip || '?',
        muted: c.acc && c.acc.mutedUntil > Date.now() ? c.acc.mutedUntil : 0,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  function state() {
    trackPeak();
    const mem = process.memoryUsage();
    const os = require('os');
    return {
      version: VERSION,
      node: process.version,
      region: process.env.FLY_REGION || null,
      machine: process.env.FLY_MACHINE_ID || null,
      started,
      uptime: Math.round((Date.now() - started) / 1000),
      now: Date.now(),
      players: world.players.size,
      connections: clients.size,
      peak,
      ...DB.counts(),
      mobs: { total: world.mobs.length, alive: world.mobs.filter((m) => !m.dead).length },
      memory: { rss: mem.rss, heap: mem.heapUsed, total: os.totalmem() },
      cpu: metrics.cpu,
      loopMs: metrics.loopMs,
      loopMaxMs: metrics.loopMaxMs,
      list: playersList(),
      reports: reports.slice(0, 50),
      history,
      restarting,
    };
  }

  // ---------- Acciones ----------

  function kick(c, text) {
    send(c, { t: 'kicked', msg: text });
    setTimeout(() => c.ws.close(), 100);
  }

  function restart(delaySec, reason) {
    if (restarting) return;
    restarting = true;
    const secs = Math.max(0, Math.min(600, Math.floor(delaySec) || 0));
    console.log(`[admin] reinicio programado en ${secs} s`);
    if (secs > 0) broadcastChat({ t: 'chat', kind: 'sys', text: `El servidor se reiniciará en ${secs >= 60 ? `${Math.round(secs / 60)} min` : `${secs} s`}${reason ? `: ${reason}` : ''}. Tu progreso se guarda.` });
    setTimeout(() => {
      for (const c of clients) savePlayer(c);
      DB.flush();
      console.log('[admin] reiniciando el servidor');
      // Código 1: Fly.io vuelve a encender la máquina; los jugadores se reconectan solos
      setTimeout(() => process.exit(1), 300);
    }, secs * 1000);
  }

  // ---------- HTTP ----------

  const FILES = {
    '/admin': ['admin.html', 'text/html; charset=utf-8'],
    '/admin/': ['admin.html', 'text/html; charset=utf-8'],
    '/admin/app.js': ['admin-app.js', 'text/javascript; charset=utf-8'],
  };
  const SEC_HEADERS = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };

  function reply(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json', ...SEC_HEADERS });
    res.end(JSON.stringify(obj));
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let size = 0;
      const parts = [];
      req.on('data', (d) => {
        size += d.length;
        if (size > 4096) {
          req.destroy();
          return resolve(null);
        }
        parts.push(d);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });
  }

  async function api(req, res, route) {
    const ip = ipOf(req);
    if (route === 'login') {
      if (req.method !== 'POST') return reply(res, 405, { error: 'Método no permitido.' });
      if (!enabled) return reply(res, 503, { error: 'El panel está cerrado: falta configurar la contraseña de administrador (ADMIN_PASSWORD).' });
      if (locked(ip)) return reply(res, 429, { error: 'Demasiados intentos fallidos. Espera 15 minutos.' });
      const body = await readBody(req);
      const pass = body && typeof body.pass === 'string' ? body.pass : '';
      if (!crypto.timingSafeEqual(sha(pass), sha(PASS))) {
        failed(ip);
        return reply(res, 401, { error: 'Contraseña incorrecta.' });
      }
      fails.delete(ip);
      const token = crypto.randomBytes(32).toString('base64url');
      tokens.set(sha(token).toString('hex'), Date.now() + TOKEN_HOURS * 3600e3);
      console.log(`[admin] acceso al panel desde ${ip}`);
      return reply(res, 200, { token, hours: TOKEN_HOURS });
    }
    if (!enabled) return reply(res, 503, { error: 'El panel está cerrado.' });
    if (!authed(req)) return reply(res, 401, { error: 'Sesión vencida. Vuelve a entrar.' });

    if (req.method === 'GET') {
      if (route === 'state') return reply(res, 200, state());
      if (route === 'logs') return reply(res, 200, { logs });
      if (route === 'accounts') {
        const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
        const r = DB.listAccounts(q.slice(0, 40));
        const online = new Set([...clients].filter((c) => c.acc).map((c) => c.acc.user.toLowerCase()));
        for (const a of r.accounts) a.online = online.has(a.user.toLowerCase());
        return reply(res, 200, r);
      }
      return reply(res, 404, { error: 'No existe.' });
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'Método no permitido.' });
    const body = (await readBody(req)) || {};

    switch (route) {
      case 'logout': {
        const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
        if (m) tokens.delete(sha(m[1]).toString('hex'));
        return reply(res, 200, { ok: true });
      }
      case 'kick': {
        const c = [...clients].find((o) => o.p && o.p.id === body.id);
        if (!c) return reply(res, 404, { error: 'Ese jugador ya no está conectado.' });
        const name = c.p.name;
        kick(c, typeof body.msg === 'string' && body.msg.trim() ? body.msg.trim().slice(0, 160) : 'Un administrador te desconectó del servidor.');
        console.log(`[admin] desconectado ${name}`);
        return reply(res, 200, { ok: true, msg: `${name} fue desconectado.` });
      }
      case 'mute': {
        // Silenciar (minutos > 0) o quitar el silencio (minutos = 0) a una cuenta
        const user = String(body.account || '').toLowerCase();
        const minutes = Math.max(0, Math.min(60 * 24 * 7, Math.floor(+body.minutes) || 0));
        const until = minutes ? Date.now() + minutes * 60000 : 0;
        if (!DB.setMute(user, until)) return reply(res, 404, { error: 'Esa cuenta no existe.' });
        for (const c of clients) {
          if (!c.acc || c.acc.user.toLowerCase() !== user) continue;
          c.acc.mutedUntil = until;
          if (c.p) send(c, { t: 'e', e: [{ type: 'log', to: c.p.id, text: minutes ? `Un administrador pausó tu chat libre ${minutes} min. Puedes usar las frases rápidas.` : 'Ya puedes volver a usar el chat libre.', cls: 'warn' }] });
        }
        console.log(`[admin] ${minutes ? `silenciado ${minutes} min` : 'sin silencio'}: ${user}`);
        return reply(res, 200, { ok: true, msg: minutes ? `Cuenta «${user}» silenciada ${minutes} min.` : `Cuenta «${user}» puede volver a hablar.` });
      }
      case 'kickAll': {
        let n = 0;
        for (const c of clients) {
          if (!c.p) continue;
          kick(c, 'Un administrador desconectó a todos los jugadores.');
          n++;
        }
        console.log(`[admin] desconectados todos (${n})`);
        return reply(res, 200, { ok: true, msg: `Se desconectó a ${n} jugador${n === 1 ? '' : 'es'}.` });
      }
      case 'announce': {
        const text = String(body.text || '')
          .replace(/[\u0000-\u001f]/g, '')
          .trim()
          .slice(0, 160);
        if (!text) return reply(res, 400, { error: 'Escribe el aviso.' });
        broadcastChat({ t: 'chat', kind: 'sys', text: `[Aviso] ${text}` });
        console.log(`[admin] aviso: ${text}`);
        return reply(res, 200, { ok: true, msg: 'Aviso enviado a todos los jugadores.' });
      }
      case 'restart': {
        if (restarting) return reply(res, 409, { error: 'Ya hay un reinicio en curso.' });
        const secs = Math.max(0, Math.min(600, Math.floor(+body.delay) || 0));
        restart(secs, typeof body.reason === 'string' ? body.reason.trim().slice(0, 80) : '');
        return reply(res, 200, { ok: true, msg: secs ? `El servidor se reiniciará en ${secs} s.` : 'Reiniciando el servidor…' });
      }
      case 'deleteAccount': {
        const user = String(body.user || '').toLowerCase();
        if (!user) return reply(res, 400, { error: 'Falta la cuenta.' });
        for (const c of clients) {
          if (c.acc && c.acc.user.toLowerCase() === user) {
            if (c.p) savePlayer(c);
            kick(c, 'Tu cuenta fue eliminada por un administrador.');
            c.acc = null;
            c.charId = null;
          }
        }
        // Se borra cuando la conexión ya se cerró (para que no se vuelva a guardar el personaje)
        await new Promise((r) => setTimeout(r, 250));
        const r = DB.deleteAccount(user);
        if (!r.ok) return reply(res, 404, { error: r.error });
        console.log(`[admin] cuenta eliminada: ${user}`);
        return reply(res, 200, { ok: true, msg: `Cuenta «${user}» eliminada.` });
      }
    }
    return reply(res, 404, { error: 'No existe.' });
  }

  // Devuelve true si la petición era del panel
  function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const file = FILES[url.pathname];
    if (file) {
      fs.readFile(path.join(__dirname, file[0]), (err, data) => {
        if (err) {
          res.writeHead(500, SEC_HEADERS);
          return res.end('No se pudo cargar el panel.');
        }
        res.writeHead(200, { 'Content-Type': file[1], ...SEC_HEADERS });
        res.end(data);
      });
      return true;
    }
    const m = /^\/admin\/api\/([A-Za-z]+)$/.exec(url.pathname);
    if (!m) return false;
    api(req, res, m[1]).catch((e) => {
      console.error('[admin]', e && e.stack);
      reply(res, 500, { error: 'Error interno.' });
    });
    return true;
  }

  return { handle, enabled };
}

module.exports = { createAdmin };
