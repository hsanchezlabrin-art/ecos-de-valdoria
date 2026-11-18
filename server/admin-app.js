// Panel de control del servidor (lado del navegador).
// Todo el texto que viene de jugadores se inserta con textContent (nunca como HTML).
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'valdoria-admin';
  const CLS = { oso: 'Oso', elfo: 'Elfo', gnomo: 'Gnomo', hada: 'Hada-Gato', lagarto: 'Lagarto' };
  let token = null;
  try {
    token = sessionStorage.getItem(KEY);
  } catch {
    /* sin almacenamiento */
  }
  let timer = null;
  let logTimer = null;
  let lastLogs = [];
  let online = true;

  // ---------- Utilidades ----------

  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) (k === 'class' ? (e.className = v) : k === 'style' ? e.setAttribute('style', v) : (e[k] = v));
    for (const k of kids) if (k != null) e.append(k instanceof Node ? k : String(k));
    return e;
  }

  const fmtDur = (s) => {
    s = Math.max(0, Math.floor(s));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${m} min`;
    if (m) return `${m} min ${s % 60} s`;
    return `${s} s`;
  };
  const fmtMB = (b) => `${Math.round(b / 1048576)} MB`;
  const fmtDate = (t) => (t ? new Date(t).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
  const fmtTime = (t) => new Date(t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  let toastT = null;
  function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' bad' : '');
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 4000);
  }

  async function call(route, body) {
    const opts = { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(`/admin/api/${route}`, opts);
    let data = {};
    try {
      data = await r.json();
    } catch {
      /* respuesta vacía */
    }
    if (r.status === 401) {
      signOut(data.error || 'Sesión vencida.');
      throw new Error(data.error || 'Sesión vencida.');
    }
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    return data;
  }

  async function act(route, body, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await call(route, body);
      toast(r.msg || 'Listo.');
      refresh();
      return r;
    } catch (e) {
      toast(e.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---------- Acceso ----------

  function signOut(msg) {
    token = null;
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nada */
    }
    clearInterval(timer);
    clearInterval(logTimer);
    $('app').hidden = true;
    $('login').hidden = false;
    $('loginErr').textContent = msg || '';
    $('pass').value = '';
    $('pass').focus();
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginErr').textContent = '';
    try {
      const r = await fetch('/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: $('pass').value }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
      token = data.token;
      try {
        sessionStorage.setItem(KEY, token);
      } catch {
        /* nada */
      }
      start();
    } catch (err) {
      $('loginErr').textContent = err.message;
    }
  });

  $('logout').addEventListener('click', async () => {
    try {
      await call('logout', {});
    } catch {
      /* da igual */
    }
    signOut();
  });

  // ---------- Estado ----------

  function setStatus(kind, text) {
    $('status').className = 'pill' + (kind === 'ok' ? '' : ` ${kind}`);
    $('statusText').textContent = text;
  }

  function drawChart(hist, now) {
    const svg = $('chart');
    const W = 600;
    const H = 150;
    const padB = 16;
    const t0 = now - 24 * 3600e3;
    const pts = hist.filter((p) => p[0] >= t0);
    const max = Math.max(4, ...pts.map((p) => p[1]));
    const x = (t) => ((t - t0) / (24 * 3600e3)) * W;
    const y = (n) => H - padB - (n / max) * (H - padB - 10);
    const ns = 'http://www.w3.org/2000/svg';
    svg.replaceChildren();
    const mk = (tag, attrs) => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      svg.append(e);
      return e;
    };
    for (let i = 0; i <= 4; i++) {
      const v = Math.round((max * i) / 4);
      mk('line', { x1: 0, x2: W, y1: y(v), y2: y(v), stroke: '#3a3024', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
    }
    if (pts.length > 1) {
      let d = `M${x(pts[0][0])},${y(pts[0][1])}`;
      for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i][0])} V${y(pts[i][1])}`;
      mk('path', { d: `${d} V${H - padB} H${x(pts[0][0])} Z`, fill: 'rgba(217,178,95,.15)' });
      mk('path', { d, fill: 'none', stroke: '#d9b25f', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
    }
    const lbl = (tx, text, anchor) => {
      const e = mk('text', { x: tx, y: H - 3, class: 'axis', 'text-anchor': anchor });
      e.textContent = text;
    };
    lbl(2, 'hace 24 h', 'start');
    lbl(W / 2, 'hace 12 h', 'middle');
    lbl(W - 2, `ahora · máx. ${max}`, 'end');
  }

  function renderPlayers(list) {
    $('plCount').textContent = `· ${list.length}`;
    const body = $('plBody');
    body.replaceChildren();
    if (!list.length) {
      body.append(el('tr', null, el('td', { colSpan: 10, class: 'empty' }, 'No hay jugadores conectados.')));
      return;
    }
    const now = Date.now();
    for (const p of list) {
      const pct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
      const mute = el('button', null, p.muted ? `Quitar silencio (${Math.ceil((p.muted - now) / 60000)} min)` : 'Silenciar 30 min');
      mute.addEventListener('click', () => act('mute', { account: p.account, minutes: p.muted ? 0 : 30 }, mute));
      const kick = el('button', { class: 'danger' }, 'Desconectar');
      kick.addEventListener('click', () => {
        if (confirm(`¿Desconectar a ${p.name} (cuenta ${p.account})?`)) act('kick', { id: p.id }, kick);
      });
      body.append(
        el(
          'tr',
          null,
          el('td', null, el('b', null, p.name), p.party ? el('span', { class: 'tag', style: 'margin-left:6px' }, 'grupo') : null),
          el('td', null, p.account),
          el('td', null, el('span', { class: `cls ${p.cls}` }, `${CLS[p.cls] || p.cls} ${p.sex === 'f' ? '♀' : '♂'}`)),
          el('td', { class: 'num' }, p.level),
          el('td', { class: 'num' }, p.dead ? el('span', { class: 'tag dead' }, 'muerto') : [el('span', { class: 'hp' }, el('i', { style: `width:${pct}%` })), `${p.hp}/${p.maxHp}`].reduce((f, n) => (f.append(n), f), document.createDocumentFragment())),
          el('td', { title: `x ${p.x} · z ${p.z}` }, p.zone),
          el('td', { class: 'num' }, p.since ? fmtDur((now - p.since) / 1000) : '–'),
          el('td', { class: 'num' }, p.rtt == null ? '–' : `${p.rtt} ms`),
          el('td', { class: 'num' }, p.ip),
          el('td', null, mute, ' ', kick)
        )
      );
    }
  }

  async function refresh() {
    if (!token) return;
    try {
      const s = await call('state');
      online = true;
      setStatus(s.restarting ? 'wait' : 'ok', s.restarting ? 'Reiniciando…' : 'En línea');
      $('verPill').textContent = `v${s.version}`;
      $('regionPill').textContent = `${s.region ? `Región ${s.region}` : 'Local'} · Node ${s.node}`;
      $('updated').textContent = `Actualizado ${fmtTime(s.now)}`;
      $('tUptime').textContent = fmtDur(s.uptime);
      $('tStarted').textContent = `desde ${fmtDate(s.started)}`;
      $('tPlayers').textContent = s.players;
      $('tConn').textContent = `${s.connections} conexión${s.connections === 1 ? '' : 'es'} (incluye menús)`;
      $('tPeak').textContent = s.peak.n;
      $('tPeakAt').textContent = s.peak.n ? `a las ${new Date(s.peak.at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}` : 'nadie aún';
      $('tAcc').textContent = `${s.accounts} · ${s.characters}`;
      const limit = 512 * 1048576; // memoria de la máquina en Fly.io
      $('tMem').textContent = fmtMB(s.memory.rss);
      $('tMemS').textContent = `de 512 MB · montón ${fmtMB(s.memory.heap)}`;
      $('bMem').style.width = `${Math.min(100, (s.memory.rss / limit) * 100)}%`;
      $('bMem').style.background = s.memory.rss / limit > 0.8 ? 'var(--bad)' : 'var(--gold)';
      $('tCpu').textContent = `${s.cpu}%`;
      $('tLoop').textContent = `retraso ${s.loopMs} ms (máx. ${s.loopMaxMs} ms)`;
      $('bCpu').style.width = `${Math.min(100, s.cpu)}%`;
      $('bCpu').style.background = s.cpu > 80 ? 'var(--bad)' : 'var(--gold)';
      $('tMobs').textContent = `${s.mobs.alive}`;
      $('tMobsS').textContent = `de ${s.mobs.total} en el mundo`;
      drawChart(s.history, s.now);
      renderPlayers(s.list);
      renderReports(s.reports || []);
    } catch (e) {
      if (!token) return;
      online = false;
      setStatus('off', 'Sin respuesta');
      $('updated').textContent = e.message.slice(0, 60);
    }
  }

  // ---------- Reportes de jugadores ----------

  const REASON = { insultos: 'Insultos', datos: 'Pidió datos personales', molesta: 'Molesta', otro: 'Otra cosa' };
  let reportsKey = '';
  function renderReports(list) {
    const key = list.map((r) => r.at).join(',');
    if (key === reportsKey) return;
    reportsKey = key;
    $('repCount').textContent = `· ${list.length}`;
    const body = $('repBody');
    body.replaceChildren();
    if (!list.length) body.append(el('tr', null, el('td', { colSpan: 5, class: 'empty' }, 'Sin reportes. ¡Bien!')));
    for (const r of list) {
      const msgs = el('td', { class: 'msgs' });
      for (const h of r.history.slice(-6)) msgs.append(el('div', null, el('span', { class: 't' }, `${fmtTime(h.at)} `), h.text));
      if (!r.history.length) msgs.append(el('span', { class: 't' }, '(no había escrito nada)'));
      const mute = el('button', null, 'Silenciar 1 día');
      mute.addEventListener('click', () => act('mute', { account: r.account, minutes: 1440 }, mute));
      body.append(el('tr', null, el('td', null, fmtDate(r.at)), el('td', null, el('b', null, r.name), ` (${r.account})`), el('td', null, REASON[r.reason] || r.reason, el('br'), el('span', { class: 't' }, `por ${r.fromName}`)), msgs, el('td', null, mute)));
    }
  }

  // ---------- Cuentas ----------

  async function loadAccounts() {
    try {
      const r = await call(`accounts?q=${encodeURIComponent($('accQ').value.trim())}`);
      $('accCount').textContent = `· ${r.total}`;
      const body = $('accBody');
      body.replaceChildren();
      if (!r.accounts.length) body.append(el('tr', null, el('td', { colSpan: 6, class: 'empty' }, 'Sin resultados.')));
      for (const a of r.accounts) {
        const del = el('button', { class: 'danger' }, 'Eliminar');
        del.addEventListener('click', async () => {
          const chars = a.chars.map((c) => c.name).join(', ') || 'ninguno';
          if (!confirm(`¿Eliminar la cuenta «${a.user}» y sus personajes (${chars})?\n\nNo se puede deshacer.`)) return;
          await act('deleteAccount', { user: a.user }, del);
          loadAccounts();
        });
        const chars = el('td', null);
        if (!a.chars.length) chars.append(el('span', { class: 'n', style: 'color:var(--dim)' }, 'ninguno'));
        a.chars.forEach((c, i) => {
          if (i) chars.append(', ');
          chars.append(el('span', { class: `cls ${c.cls}`, title: `${CLS[c.cls] || c.cls} · último juego ${fmtDate(c.last)}` }, `${c.name} ${c.level}`));
        });
        body.append(
          el(
            'tr',
            null,
            el('td', null, el('b', null, a.user), a.online ? el('span', { class: 'tag', style: 'margin-left:6px' }, 'conectado') : null),
            el('td', null, a.email),
            chars,
            el('td', null, fmtDate(a.created)),
            el('td', null, fmtDate(a.lastLogin)),
            el('td', null, del)
          )
        );
      }
    } catch (e) {
      toast(e.message, true);
    }
  }
  $('accReload').addEventListener('click', loadAccounts);
  $('accQ').addEventListener('keydown', (e) => e.key === 'Enter' && loadAccounts());

  // ---------- Registro ----------

  function renderLogs() {
    const q = $('logQ').value.trim().toLowerCase();
    const lv = $('logLevel').value;
    const box = $('logs');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    box.replaceChildren();
    const rows = lastLogs.filter((l) => (!lv || l.level === lv || (lv === 'warn' && l.level === 'error')) && (!q || l.text.toLowerCase().includes(q)));
    if (!rows.length) box.append(el('div', { class: 't' }, 'Sin líneas.'));
    for (const l of rows) box.append(el('div', { class: l.level }, el('span', { class: 't' }, `${fmtTime(l.at)}  `), l.text));
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  async function loadLogs() {
    try {
      lastLogs = (await call('logs')).logs;
      renderLogs();
    } catch {
      /* se reintenta */
    }
  }
  $('logQ').addEventListener('input', renderLogs);
  $('logLevel').addEventListener('change', renderLogs);

  // ---------- Acciones ----------

  $('annSend').addEventListener('click', async () => {
    const text = $('annText').value.trim();
    if (!text) return toast('Escribe el aviso.', true);
    const r = await act('announce', { text }, $('annSend'));
    if (r) $('annText').value = '';
  });
  $('annText').addEventListener('keydown', (e) => e.key === 'Enter' && $('annSend').click());

  $('kickAll').addEventListener('click', () => {
    if (confirm('¿Desconectar a TODOS los jugadores conectados?')) act('kickAll', {}, $('kickAll'));
  });

  $('restart').addEventListener('click', () => {
    const delay = +$('rsDelay').value;
    const when = delay ? $('rsDelay').selectedOptions[0].textContent.toLowerCase() : 'ahora';
    if (!confirm(`¿Reiniciar el servidor ${when}?\n\nSe guarda el progreso de todos y el juego se corta unos segundos.`)) return;
    act('restart', { delay }, $('restart'));
  });

  // ---------- Inicio ----------

  function start() {
    $('login').hidden = true;
    $('app').hidden = false;
    refresh();
    loadAccounts();
    loadLogs();
    clearInterval(timer);
    clearInterval(logTimer);
    timer = setInterval(refresh, 3000);
    logTimer = setInterval(loadLogs, 5000);
  }

  if (token) start();
  else $('pass').focus();
})();
