// Interfaz (HUD) en HTML sobre el canvas 3D. Los botones funcionan con ratón y con toque.
(function () {
const G = V.G;
const { ITEMS, RARITY, CLASSES, shopFor, MAX_LEVEL, xpToNext, sellPrice } = V.Data;
const { zoneAt } = V.World;
// game.js se carga después de este archivo: se llama a través de V.Game en tiempo de ejecución.
const useSkill = (i) => V.Game.useSkill(i);
const usePotion = (id) => V.Game.usePotion(id);
const clickInventory = (i) => V.Game.clickInventory(i);
const unequip = (k) => V.Game.unequip(k);
const buyItem = (id) => V.Game.buyItem(id);
const countItem = (id) => V.Game.countItem(id);

const THREE = window.THREE;
const $ = (id) => document.getElementById(id);
const v = new THREE.Vector3();
let E = null;
let frame = 0;
let lastZone;
const statics = [];

function initUI() {
  E = {
    hud: $('hud'),
    pName: $('pName'),
    pLvl: $('pLvl'),
    pHp: $('pHpFill'),
    pHpT: $('pHpTxt'),
    pMp: $('pMpFill'),
    pMpT: $('pMpTxt'),
    pXp: $('pXpFill'),
    pXpT: $('pXpTxt'),
    buffs: $('buffs'),
    tFrame: $('tFrame'),
    tName: $('tName'),
    tLvl: $('tLvl'),
    tHp: $('tHpFill'),
    tHpT: $('tHpTxt'),
    zone: $('zoneName'),
    gold: $('goldTxt'),
    log: $('logLines'),
    online: $('onlineTxt'),
    labels: $('labels'),
    floats: $('floats'),
    banner: $('banner'),
    mm: $('minimap').getContext('2d'),
    inv: $('invPanel'),
    shop: $('shopPanel'),
    help: $('helpPanel'),
  };
  E.hud.hidden = false;
  E.pName.textContent = G.player.name;
  $('pClass').textContent = G.player.cdef.name;
  buildHotbar();
  $('btnInv').onclick = () => togglePanel('inv');
  $('btnHelp').onclick = () => togglePanel('help');
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => togglePanel(b.dataset.close, false)));

  addStatic(G.player.pos, G.player.model.height + 0.5, G.player.name, 'np-player', 40);
  for (const n of G.world.npcs) addStatic(n.root.position, 2.9, n.name, 'np-npc', 40);
  for (const s of G.world.signs) addStatic(s.pos, s.height, s.text, 'np-sign', 26);

  // Chat (solo en línea): Enter abre, Enter envía, Esc cierra
  const input = $('chatInput');
  const isOnline = V.Game.online;
  input.hidden = !isOnline;
  E.online.hidden = !isOnline;
  if (isOnline) {
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text) V.Game.sendChat(text);
        input.value = '';
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = '';
        input.blur();
      }
    });
  }
}

// ---------- Barra de acciones ----------

function buildHotbar() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  const defs = [
    ...G.player.skills.map((s, i) => ({ kind: 'skill', i, key: String(i + 1), glyph: s.glyph, title: `${s.name} (nivel ${s.lvl}) · ${s.mp} MP · ${s.cd} s\n${s.desc}` })),
    { kind: 'pot', id: 'pocion_vida', key: '5', glyph: ITEMS.pocion_vida.glyph, title: `${ITEMS.pocion_vida.name}\n${ITEMS.pocion_vida.desc}` },
    { kind: 'pot', id: 'pocion_mana', key: '6', glyph: ITEMS.pocion_mana.glyph, title: `${ITEMS.pocion_mana.name}\n${ITEMS.pocion_mana.desc}` },
  ];
  E.slots = defs.map((d) => {
    const b = document.createElement('button');
    b.className = `slot ${d.kind === 'pot' ? `pot ${d.id}` : 'skill'}`;
    b.title = d.title;
    b.innerHTML = `<span class="glyph">${d.glyph}</span><span class="key">${d.key}</span><span class="cd"></span><span class="qty"></span><span class="lock"></span>`;
    b.addEventListener('click', () => (d.kind === 'skill' ? useSkill(d.i) : usePotion(d.id)));
    bar.append(b);
    return { d, b, cd: b.querySelector('.cd'), qty: b.querySelector('.qty'), lock: b.querySelector('.lock'), state: '' };
  });
}

function updateHotbar() {
  const p = G.player;
  for (const s of E.slots) {
    let cd = 0;
    let total = 1;
    let locked = false;
    let low = false;
    let qty = '';
    if (s.d.kind === 'skill') {
      const sk = p.skills[s.d.i];
      cd = p.cds[sk.id] || 0;
      total = sk.cd;
      locked = p.level < sk.lvl;
      low = p.mp < sk.mp;
      s.lock.textContent = locked ? `Nv ${sk.lvl}` : '';
    } else {
      cd = p.cds.pot || 0;
      qty = countItem(s.d.id);
      low = qty === 0;
    }
    const st = `${Math.ceil(cd * 10)}|${locked}|${low}|${qty}`;
    if (st === s.state) continue;
    s.state = st;
    s.b.style.setProperty('--p', (cd / total).toFixed(3));
    s.cd.textContent = cd > 0.05 && total > 1 ? Math.ceil(cd) : '';
    s.b.classList.toggle('locked', locked);
    s.b.classList.toggle('low', low && !locked);
    s.qty.textContent = qty === '' ? '' : qty;
  }
}

// ---------- Etiquetas sobre las cabezas ----------

function createNameplate(m) {
  const el = document.createElement('div');
  el.className = 'np';
  el.hidden = true;
  el.innerHTML = '<span class="np-name"></span><span class="np-hp"><i></i></span>';
  $('labels').append(el);
  m.np = { el, name: el.querySelector('.np-name'), hpWrap: el.querySelector('.np-hp'), hp: el.querySelector('.np-hp i'), cls: '' };
  refreshNameplate(m);
}

function refreshNameplate(m) {
  m.np.name.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = m.lvl;
  m.np.name.append(b, ` ${m.def.name}`);
  m.np.cls = '';
}

function levelClass(diff) {
  if (diff <= -5) return 'lv-grey';
  if (diff <= -2) return 'lv-green';
  if (diff <= 1) return 'lv-white';
  if (diff <= 3) return 'lv-yellow';
  return 'lv-red';
}

function addStatic(pos, height, text, cls, maxDist) {
  const el = document.createElement('div');
  el.className = `np ${cls}`;
  el.hidden = true;
  el.textContent = text;
  $('labels').append(el);
  const s = { pos, height, el, maxDist };
  statics.push(s);
  return s;
}

// Nombres sobre otros jugadores (modo en línea)
function addPlayerPlate(q) {
  const s = addStatic(q.pos, 2.95, q.name, 'np-player np-other', 40);
  s.ent = q;
  q.plate = s;
}
function removePlayerPlate(q) {
  if (!q.plate) return;
  q.plate.el.remove();
  statics.splice(statics.indexOf(q.plate), 1);
  q.plate = null;
}

function project(pos, h) {
  v.set(pos.x, pos.y + h, pos.z).project(G.camera);
  if (v.z > 1) return null;
  return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight];
}

function place(el, xy) {
  if (!xy) {
    if (!el.hidden) el.hidden = true;
    return;
  }
  if (el.hidden) el.hidden = false;
  el.style.transform = `translate(${xy[0].toFixed(1)}px, ${xy[1].toFixed(1)}px) translate(-50%, -100%)`;
}

function updateNameplates() {
  const p = G.player;
  const cam = G.camera.position;
  for (const m of G.mobs) {
    const show = !m.dead && !m.hidden && Math.hypot(m.pos.x - cam.x, m.pos.z - cam.z) < 42;
    place(m.np.el, show ? project(m.pos, m.model.height + 0.45) : null);
    if (!show) continue;
    const cls = levelClass(m.lvl - p.level) + (G.target === m ? ' is-target' : '');
    if (cls !== m.np.cls) {
      m.np.cls = cls;
      m.np.el.className = `np ${cls}`;
    }
    const hurt = m.hp < m.maxHp || G.target === m;
    m.np.hpWrap.hidden = !hurt;
    if (hurt) m.np.hp.style.transform = `scaleX(${(m.hp / m.maxHp).toFixed(3)})`;
  }
  for (const s of statics) {
    const d = Math.hypot(s.pos.x - cam.x, s.pos.z - cam.z);
    const gone = (s.pos === p.pos && p.dead) || (s.ent && s.ent.dead);
    place(s.el, d < s.maxDist && !gone ? project(s.pos, s.height) : null);
  }
}

// ---------- Textos flotantes, registro y avisos ----------

function floatText(pos, h, text, cls) {
  if (!E) return;
  const xy = project(pos, h);
  if (!xy) return;
  const el = document.createElement('div');
  el.className = `ft ${cls}`;
  el.textContent = text;
  el.style.left = `${xy[0] + (Math.random() - 0.5) * 30}px`;
  el.style.top = `${xy[1]}px`;
  E.floats.append(el);
  const done = () => el.remove();
  el.addEventListener('animationend', done);
  setTimeout(done, 1600);
}

function log(text, cls = '') {
  if (!E) return;
  const line = document.createElement('p');
  line.className = cls;
  line.textContent = text;
  pushLog(line);
}

function logLoot(id, qty, verb = 'Obtienes') {
  if (!E) return;
  const it = ITEMS[id];
  const line = document.createElement('p');
  line.className = 'loot';
  const name = document.createElement('span');
  name.style.color = RARITY[it.rarity].color;
  name.textContent = `[${it.name}]`;
  line.append(`${verb} `, name, qty > 1 ? ` ×${qty}` : '');
  pushLog(line);
}

function pushLog(line) {
  E.log.append(line);
  while (E.log.children.length > 60) E.log.firstChild.remove();
  E.log.scrollTop = E.log.scrollHeight;
}

// Mensajes del chat en línea: { kind: 'player' | 'sys', name, cls, text }
function chat(msg) {
  if (!E) return;
  const line = document.createElement('p');
  if (msg.kind === 'sys') {
    line.className = 'chat-sys';
    line.textContent = msg.text;
  } else {
    line.className = 'chat';
    const who = document.createElement('b');
    who.className = `who-${msg.cls}`;
    who.textContent = `${msg.name}: `;
    line.append(who, msg.text);
  }
  pushLog(line);
}

function focusChat() {
  const input = $('chatInput');
  if (!input || input.hidden) return false;
  input.focus();
  return true;
}

function banner(title, sub = '') {
  if (!E) return;
  E.banner.innerHTML = '<strong></strong><span></span>';
  E.banner.firstChild.textContent = title;
  E.banner.lastChild.textContent = sub;
  E.banner.classList.remove('show');
  void E.banner.offsetWidth;
  E.banner.classList.add('show');
}

function showDeath(show) {
  $('death').hidden = !show;
}

// ---------- Paneles ----------

function togglePanel(name, force) {
  const el = E[name];
  el.hidden = force === undefined ? !el.hidden : !force;
  if (name === 'shop' && el.hidden) refreshPanels();
  refreshPanels();
}

const shopOpen = () => !!E && !E.shop.hidden;

function openShop() {
  togglePanel('shop', true);
  togglePanel('inv', true);
}

function closeAll() {
  let closed = false;
  for (const k of ['shop', 'inv', 'help']) {
    if (!E[k].hidden) {
      E[k].hidden = true;
      closed = true;
    }
  }
  return closed;
}

function itemTitle(it) {
  const lines = [`${it.name} · ${RARITY[it.rarity].name}`];
  if (it.atk) lines.push(`Ataque +${it.atk}`);
  if (it.def) lines.push(`Defensa +${it.def} · Vida +${it.hp}`);
  if (it.cls) lines.push(`Clase: ${CLASSES[it.cls].name}`);
  if (it.lvl) lines.push(`Requiere nivel ${it.lvl}`);
  lines.push(it.desc);
  return lines.join('\n');
}

function slotEl(id, qty, onClick, extraCls = '') {
  const b = document.createElement('button');
  b.className = `islot ${extraCls}`;
  if (id) {
    const it = ITEMS[id];
    b.style.setProperty('--r', RARITY[it.rarity].color);
    b.classList.add('filled');
    b.title = itemTitle(it) + (shopOpen() ? `\nVender: ${sellPrice(it)} oro` : '');
    b.innerHTML = `<span class="glyph"></span>${qty > 1 ? `<span class="qty">${qty}</span>` : ''}`;
    b.firstChild.textContent = it.glyph;
    b.addEventListener('click', onClick);
  } else {
    b.disabled = true;
  }
  return b;
}

function refreshPanels() {
  if (!E) return;
  const p = G.player;
  if (!E.inv.hidden) {
    const s = p.stats;
    $('invStats').innerHTML = '';
    const stats = [
      ['Ataque', Math.round(s.atk * (1 + (p.buffT > 0 ? p.buffPct : 0)))],
      ['Defensa', Math.round(s.def)],
      ['Vida', s.maxHp],
      ['Maná', s.maxMp],
    ];
    for (const [k, val] of stats) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = val;
      $('invStats').append(dt, dd);
    }
    const eq = $('invEquip');
    eq.innerHTML = '';
    for (const [key, label] of [
      ['weapon', 'Arma'],
      ['armor', 'Armadura'],
    ]) {
      const wrap = document.createElement('div');
      wrap.className = 'eq';
      const id = p.equip[key];
      wrap.append(slotEl(id, 1, () => unequip(key), 'equipped'));
      const t = document.createElement('div');
      const lab = document.createElement('small');
      lab.textContent = label;
      const nm = document.createElement('span');
      nm.textContent = id ? ITEMS[id].name : 'Vacío';
      if (id) nm.style.color = RARITY[ITEMS[id].rarity].color;
      t.append(lab, nm);
      wrap.append(t);
      eq.append(wrap);
    }
    const grid = $('invGrid');
    grid.innerHTML = '';
    for (let i = 0; i < 30; i++) {
      const slot = p.inv[i];
      grid.append(slotEl(slot && slot.id, slot && slot.qty, () => clickInventory(i)));
    }
    $('invHint').textContent = shopOpen()
      ? 'Tienda abierta: haz clic en un objeto para venderlo.'
      : 'Clic en un objeto para usarlo o equiparlo. Clic en el equipo para quitártelo.';
  }
  if (!E.shop.hidden) {
    const list = $('shopList');
    list.innerHTML = '';
    for (const id of shopFor(p.cls)) {
      const it = ITEMS[id];
      const row = document.createElement('li');
      const ic = slotEl(id, 1, () => buyItem(id));
      const info = document.createElement('div');
      const nm = document.createElement('strong');
      nm.textContent = it.name;
      nm.style.color = RARITY[it.rarity].color;
      const meta = document.createElement('small');
      meta.textContent = it.atk ? `Ataque +${it.atk} · Nv ${it.lvl}` : it.def ? `Defensa +${it.def} · Vida +${it.hp} · Nv ${it.lvl}` : it.desc;
      info.append(nm, meta);
      const buy = document.createElement('button');
      buy.className = 'buy';
      buy.textContent = `${it.price} oro`;
      buy.disabled = p.gold < it.price;
      buy.addEventListener('click', () => buyItem(id));
      row.append(ic, info, buy);
      list.append(row);
    }
  }
}

// ---------- Minimapa ----------

function drawMinimap() {
  const c = E.mm;
  const W = c.canvas.width;
  const half = W / 2;
  const R = 80;
  const s = half / R;
  const p = G.player;
  const tx = (x) => half + (x - p.pos.x) * s;
  const tz = (z) => half + (z - p.pos.z) * s;
  c.clearRect(0, 0, W, W);
  c.save();
  c.beginPath();
  c.arc(half, half, half - 1, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = '#26301f';
  c.fillRect(0, 0, W, W);
  c.strokeStyle = 'rgba(176,146,98,.55)';
  c.lineWidth = 3;
  for (const { x, z } of G.world.zones) {
    c.beginPath();
    c.moveTo(tx(0), tz(0));
    c.lineTo(tx(x), tz(z));
    c.stroke();
  }
  for (const z of G.world.zones) {
    c.fillStyle = `rgba(${z.tint.map((t) => Math.round(t * 255)).join(',')},.55)`;
    c.beginPath();
    c.arc(tx(z.x), tz(z.z), z.r * s, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = 'rgba(217,181,106,.35)';
  c.beginPath();
  c.arc(tx(0), tz(0), 22 * s, 0, Math.PI * 2);
  c.fill();
  for (const m of G.mobs) {
    if (m.dead || m.hidden) continue;
    const x = tx(m.pos.x);
    const y = tz(m.pos.z);
    if (x < 0 || y < 0 || x > W || y > W) continue;
    c.fillStyle = m.def.boss ? '#c895ff' : m.aggro ? '#ff5a4a' : m.def.aggressive ? '#e0866a' : '#f2cf5b';
    const r = m.def.boss ? 4 : 2;
    c.fillRect(x - r / 2, y - r / 2, r, r);
  }
  c.fillStyle = '#d9b56a';
  for (const n of G.world.npcs) {
    const np = n.root.position;
    c.beginPath();
    c.arc(tx(np.x), tz(np.z), 3, 0, Math.PI * 2);
    c.fill();
  }
  // Otros jugadores (en línea)
  c.fillStyle = '#7fb6ff';
  for (const s of statics) {
    if (!s.ent || s.ent.dead) continue;
    c.beginPath();
    c.arc(tx(s.ent.pos.x), tz(s.ent.pos.z), 2.6, 0, Math.PI * 2);
    c.fill();
  }
  c.translate(half, half);
  c.rotate(-p.facing);
  c.fillStyle = '#f4ead4';
  c.strokeStyle = '#111';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, 7);
  c.lineTo(-4.5, -5);
  c.lineTo(0, -2.5);
  c.lineTo(4.5, -5);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
}

// ---------- Actualización por fotograma ----------

const bar = (fill, txt, cur, max) => {
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, cur / max)).toFixed(3)})`;
  txt.textContent = `${Math.round(cur)} / ${max}`;
};

function updateUI() {
  const p = G.player;
  frame++;
  bar(E.pHp, E.pHpT, p.hp, p.stats.maxHp);
  bar(E.pMp, E.pMpT, p.mp, p.stats.maxMp);
  if (p.level >= MAX_LEVEL) {
    E.pXp.style.transform = 'scaleX(1)';
    E.pXpT.textContent = 'Nivel máximo';
  } else {
    const need = xpToNext(p.level);
    E.pXp.style.transform = `scaleX(${(p.xp / need).toFixed(4)})`;
    E.pXpT.textContent = `${((p.xp / need) * 100).toFixed(1)}%`;
  }
  E.pLvl.textContent = p.level;
  E.gold.textContent = p.gold.toLocaleString('es');
  if (V.Game.online && frame % 30 === 0) {
    const n = V.Game.onlineCount;
    E.online.textContent = `● ${n} ${n === 1 ? 'jugador' : 'jugadores'} en línea`;
  }
  const parts = [];
  if (p.buffT > 0) parts.push(`${p.buffName} · ${Math.ceil(p.buffT)} s`);
  if (p.shield > 0) parts.push(`Escudo ${Math.ceil(p.shield)} · ${Math.ceil(p.shieldT)} s`);
  const buff = parts.join('  ·  ');
  if (E.buffs.textContent !== buff) E.buffs.textContent = buff;
  E.buffs.hidden = !buff;

  const t = G.target;
  E.tFrame.hidden = !t || t.dead || t.hidden;
  if (t && !t.dead && !t.hidden) {
    E.tLvl.textContent = t.lvl;
    E.tName.textContent = t.def.name;
    E.tFrame.dataset.lv = levelClass(t.lvl - p.level);
    bar(E.tHp, E.tHpT, t.hp, t.maxHp);
  }

  updateHotbar();
  updateNameplates();
  if (frame % 3 === 0) drawMinimap();
  if (frame % 15 === 0) {
    const z = zoneAt(p.pos);
    if (z !== lastZone) {
      if (lastZone !== undefined) banner(z ? z.name : 'Tierras salvajes', z ? (z.safe ? 'Zona segura' : `Nivel ${z.lvl}`) : 'Sin dueño ni ley');
      lastZone = z;
      E.zone.textContent = z ? z.name : 'Tierras salvajes';
    }
    if (shopOpen() && Math.hypot(p.pos.x - G.world.merchant.root.position.x, p.pos.z - G.world.merchant.root.position.z) > 8) {
      togglePanel('shop', false);
    }
  }
}

V.UI = {
  initUI, createNameplate, refreshNameplate, addPlayerPlate, removePlayerPlate, chat, focusChat,
  floatText, log, logLoot, banner, showDeath,
  togglePanel, shopOpen, openShop, closeAll, refreshPanels, updateUI,
};
})();
