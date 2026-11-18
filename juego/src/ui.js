// Interfaz (HUD) en HTML sobre el canvas 3D. Los botones funcionan con ratón y con toque.
(function () {
const G = V.G;
const { ITEMS, RARITY, CLASSES, MOBS, shopFor, MAX_LEVEL, xpToNext, sellPrice, className, raceName, resolveDrop, skillLock, passiveFor, STAGES, GRADES, ARMOR_TYPES, WEAPON_TYPES, questFor } = V.Data;
const equipProblem = (it) => V.Data.equipProblem(G.player, it);
const { zoneAt } = V.World;
// game.js se carga después de este archivo: se llama a través de V.Game en tiempo de ejecución.
const useSkill = (i) => V.Game.useSkill(i);
const usePotion = (id) => V.Game.usePotion(id);
const clickInventory = (i) => V.Game.clickInventory(i);
const unequip = (k) => V.Game.unequip(k);
const buyItem = (id) => openTrade('buy', id);
const countItem = (id) => V.Game.countItem(id);

const THREE = window.THREE;
const $ = (id) => document.getElementById(id);
const v = new THREE.Vector3();
let E = null;
let frame = 0;
let lastZone;
const statics = [];
let myPlate = null;
let mmR = 80; // radio visible del minimapa (zoom)

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
    stats: $('statPanel'),
    map: $('mapPanel'),
    drop: $('dropPanel'),
    master: $('masterPanel'),
  };
  E.hud.hidden = false;
  E.pName.textContent = G.player.name;
  $('pClass').textContent = className(G.player.cls, G.player.sex, G.player.stage, G.player.branch);
  buildHotbar();
  bindMaster();
  $('hatchClose').onclick = () => ($('hatchPanel').hidden = true);
  if ($('btnGuide')) {
    const sync = () => ($('btnGuide').firstChild.textContent = V.Guide && V.Guide.enabled ? 'Guía: sí ' : 'Guía: no ');
    $('btnGuide').onclick = () => {
      V.Guide.toggle();
      sync();
    };
    sync();
  }
  $('btnInv').onclick = () => togglePanel('inv');
  $('btnHelp').onclick = () => togglePanel('help');
  $('btnStats').onclick = () => togglePanel('stats');
  $('btnMap').onclick = () => togglePanel('map');
  $('minimap').onclick = () => togglePanel('map', true);
  $('mmIn').onclick = () => (mmR = Math.max(30, mmR / 1.4));
  $('mmOut').onclick = () => (mmR = Math.min(200, mmR * 1.4));
  $('tInfo').onclick = () => G.target && openDrops(G.target);
  $('btnInvite').onclick = () => G.playerSel && V.Game.invite(G.playerSel.id);
  $('btnPartyLeave').onclick = () => V.Game.leaveParty();
  $('inviteYes').onclick = () => answerInvite(true);
  $('inviteNo').onclick = () => answerInvite(false);
  bindBigMap();
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => togglePanel(b.dataset.close, false)));
  bindTrade();
  $('tClose').onclick = () => V.Game.setTarget(null);
  // La ficha de objeto se cierra al tocar fuera de ella
  document.addEventListener('pointerdown', (e) => {
    const menu = $('itemMenu');
    if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('.islot')) closeItemMenu();
  });

  myPlate = addStatic(G.player.pos, G.player.model.height + 0.5, G.player.name, 'np-player', 40);
  myPlate.id = G.player.id;
  for (const n of G.world.npcs) addStatic(n.root.position, 2.9, n.name, 'np-npc', 40).npcId = n.id;
  for (const s of G.world.signs) addStatic(s.pos, s.height, s.text, 'np-sign', 26);

  // Chat: Enter abre, Enter envía, Esc cierra. "#texto" habla al grupo; "/invitar Nombre" invita.
  const input = $('chatInput');
  E.online.hidden = false;
  if (V.Mobile && V.Mobile.isTouch) input.placeholder = 'Escribe aquí · #texto para el grupo';
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = input.value.trim();
      const cmd = text.match(/^\/(invitar|invite)\s+(.+)$/i);
      if (cmd) V.Game.inviteByName(cmd[2].trim());
      else if (/^\/(salir|leave)$/i.test(text)) V.Game.leaveParty();
      else if (text) V.Game.sendChat(text);
      input.value = '';
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });
}

// ---------- Barra de acciones ----------

function buildHotbar() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  const defs = [
    ...G.player.skills.map((s, i) => ({ kind: 'skill', i, key: String(i + 1), glyph: s.glyph, title: skillTitle(s) })),
    { kind: 'pot', id: 'pocion_vida', key: '7', glyph: ITEMS.pocion_vida.glyph, title: `${ITEMS.pocion_vida.name}\n${ITEMS.pocion_vida.desc}` },
    { kind: 'pot', id: 'pocion_mana', key: '8', glyph: ITEMS.pocion_mana.glyph, title: `${ITEMS.pocion_mana.name}\n${ITEMS.pocion_mana.desc}` },
    { kind: 'gem', id: 'gema_poder', key: '9', glyph: ITEMS.gema_poder.glyph, title: `${ITEMS.gema_poder.name} (activar o desactivar)\n${ITEMS.gema_poder.desc}` },
    { kind: 'mount', key: '0', glyph: '🐾', title: 'Montar o bajar de tu mascota (desde el nivel 20)\nTerrestre: +60% de velocidad. Planeadora (nivel 40 con la Ascensión): +100% y cruza el agua.' },
  ];
  E.slots = defs.map((d) => {
    const b = document.createElement('button');
    b.className = `slot ${d.kind === 'pot' ? `pot ${d.id}` : d.kind === 'gem' || d.kind === 'mount' ? d.kind : 'skill'}`;
    b.title = d.title;
    b.innerHTML = `<span class="glyph">${d.glyph}</span><span class="key">${d.key}</span><span class="cd"></span><span class="qty"></span><span class="lock"></span>`;
    b.addEventListener('click', () => (d.kind === 'skill' ? useSkill(d.i) : d.kind === 'gem' ? V.Game.toggleGems() : d.kind === 'mount' ? V.Game.toggleMount() : usePotion(d.id)));
    bar.append(b);
    return { d, b, cd: b.querySelector('.cd'), qty: b.querySelector('.qty'), lock: b.querySelector('.lock'), state: '' };
  });
}

function skillTitle(s) {
  if (s.locked) return `${s.name}\n${s.desc}`;
  const req = s.stage ? `${STAGES[s.stage].name} · nivel ${s.lvl}` : `nivel ${s.lvl}`;
  return `${s.ultimate ? '★ ' : ''}${s.name} (${req}) · ${s.mp} MP · ${s.cd} s\n${s.desc}`;
}

// Tras un cambio de clase: barra, título y paneles
function classChanged() {
  if (!E) return;
  buildHotbar();
  $('pClass').textContent = className(G.player.cls, G.player.sex, G.player.stage, G.player.branch);
  refreshPanels();
  refreshMaster();
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
      const lock = skillLock(p, sk);
      locked = !!lock;
      low = !p.freeNext && p.mp < sk.mp;
      s.lock.textContent = lock === 'Cambio de clase' ? 'Clase' : lock;
    } else if (s.d.kind === 'mount') {
      const lock = !p.pet ? (countItem('huevo_mascota') ? 'Huevo' : 'Nv 5') : p.mountKind ? '' : 'Nv 20';
      locked = !!lock;
      s.lock.textContent = lock;
      s.b.classList.toggle('on', !!p.mounted);
    } else if (s.d.kind === 'gem') {
      qty = p.gems || 0;
      low = qty === 0;
      s.b.classList.toggle('on', !!p.gemsOn && qty > 0);
    } else {
      cd = p.cds.pot || 0;
      qty = countItem(s.d.id);
      low = qty === 0;
    }
    const st = `${Math.ceil(cd * 10)}|${locked}|${low}|${qty}|${s.lock.textContent}`;
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
    if (s.npcId) s.el.classList.toggle('is-target', !!G.npcSel && G.npcSel.id === s.npcId);
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
  if (msg.kind === 'party') {
    line.className = 'chat-party';
    const who = document.createElement('b');
    who.textContent = `[Grupo] ${msg.name}: `;
    line.append(who, msg.text);
    showBubble(msg.id, msg.text);
  } else if (msg.kind === 'sys') {
    line.className = 'chat-sys';
    line.textContent = msg.text;
  } else {
    line.className = 'chat';
    const who = document.createElement('b');
    who.className = `who-${msg.cls}`;
    who.textContent = `${msg.name}: `;
    line.append(who, msg.text);
    showBubble(msg.id, msg.text);
  }
  pushLog(line);
}

// Globo de texto sobre la cabeza de quien habla (6 segundos)
function showBubble(id, text) {
  const plate = myPlate && myPlate.id === id ? myPlate : statics.find((s) => s.ent && s.ent.id === id);
  if (!plate) return;
  let b = plate.el.querySelector('.bubble');
  if (!b) {
    b = document.createElement('span');
    b.className = 'bubble';
    plate.el.prepend(b);
  }
  b.textContent = text;
  clearTimeout(b._t);
  b._t = setTimeout(() => b.remove(), 6000);
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
  if (name === 'map' && E.map.hidden && force !== false) mapView.center = null; // al abrir, centrado en ti
  const el = E[name];
  el.hidden = force === undefined ? !el.hidden : !force;
  if (name === 'shop' && el.hidden && trade) closeTrade();
  refreshPanels();
}

const shopOpen = () => !!E && !E.shop.hidden;

function openShop() {
  togglePanel('shop', true);
  togglePanel('inv', true);
}

// ---------- Diálogo de compra / venta: confirmación y cantidad ----------

let trade = null;

function openTrade(mode, ref) {
  const p = G.player;
  const id = mode === 'buy' ? ref : p.inv[ref] && p.inv[ref].id;
  if (!id) return;
  const it = ITEMS[id];
  const unit = mode === 'buy' ? it.price : sellPrice(it);
  const have = mode === 'sell' ? p.inv[ref].qty : 0;
  const max = mode === 'buy' ? (it.stack ? Math.max(1, Math.min(99, Math.floor(p.gold / unit))) : 1) : have;
  trade = { mode, ref, id, unit, max, qty: 1 };

  const box = $('tradePanel');
  $('trTitle').textContent = mode === 'buy' ? 'Comprar' : 'Vender';
  const icon = $('trIcon');
  icon.style.setProperty('--r', RARITY[it.rarity].color);
  icon.textContent = it.glyph;
  $('trName').textContent = it.name;
  $('trName').style.color = RARITY[it.rarity].color;
  $('trDesc').textContent = mode === 'sell' && have > 1 ? `Tienes ${have}. ${it.desc}` : it.desc;
  const range = $('trRange');
  range.max = max;
  $('trQtyRow').hidden = max <= 1;
  setTradeQty(1);
  box.hidden = false;
  $('trOk').focus();
}

function setTradeQty(q) {
  if (!trade) return;
  trade.qty = Math.max(1, Math.min(trade.max, Math.floor(Number(q)) || 1));
  $('trRange').value = trade.qty;
  $('trNum').value = trade.qty;
  const total = trade.unit * trade.qty;
  const poor = trade.mode === 'buy' && G.player.gold < total;
  $('trTotal').textContent = `${trade.mode === 'buy' ? 'Total' : 'Recibes'}: ${total.toLocaleString('es')} oro`;
  $('trTotal').classList.toggle('poor', poor);
  $('trOk').disabled = poor;
  $('trOk').textContent = trade.mode === 'buy' ? `Comprar ${trade.qty > 1 ? `×${trade.qty}` : ''}` : `Vender ${trade.qty > 1 ? `×${trade.qty}` : ''}`;
}

function closeTrade() {
  trade = null;
  $('tradePanel').hidden = true;
}

function confirmTrade() {
  if (!trade) return;
  if (trade.mode === 'buy') V.Game.buyItem(trade.id, trade.qty);
  else V.Game.sellItem(trade.ref, trade.qty);
  closeTrade();
}

function bindTrade() {
  $('trMinus').onclick = () => setTradeQty(trade.qty - 1);
  $('trPlus').onclick = () => setTradeQty(trade.qty + 1);
  $('trMax').onclick = () => setTradeQty(trade.max);
  $('trRange').oninput = (e) => setTradeQty(e.target.value);
  $('trNum').oninput = (e) => setTradeQty(e.target.value);
  $('trOk').onclick = confirmTrade;
  $('trCancel').onclick = closeTrade;
  $('tradePanel').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closeTrade();
    if (e.key === 'Enter' && !$('trOk').disabled) confirmTrade();
  });
}

function closeAll() {
  let closed = false;
  if (!$('itemMenu').hidden) {
    closeItemMenu();
    return true;
  }
  if (trade) {
    closeTrade();
    return true;
  }
  if (!$('invitePanel').hidden) {
    answerInvite(false);
    return true;
  }
  for (const k of ['master', 'drop', 'map', 'stats', 'shop', 'inv', 'help']) {
    if (!E[k].hidden) {
      E[k].hidden = true;
      closed = true;
    }
  }
  return closed;
}

// Tipo de equipo: "Martillo · Oso Pardo" o "Armadura pesada"
function gearKind(it) {
  if (it.type === 'weapon') return `${WEAPON_TYPES[it.weaponType].name}${it.cls ? ` · ${CLASSES[it.cls].name}` : ''}`;
  if (it.type === 'armor') return `Armadura ${ARMOR_TYPES[it.armorType].name.toLowerCase()}`;
  return '';
}
function gearStats(it) {
  const out = [];
  if (it.atk) out.push(`Ataque +${it.atk}${it.crit ? ` · Crítico +${Math.round(it.crit * 100)}%` : ''}`);
  if (it.def) out.push(`Defensa +${it.def} · Vida +${it.hp}${it.mp ? ` · Maná +${it.mp}` : ''}`);
  if (it.evade) out.push(`Esquivar +${Math.round(it.evade * 100)}%`);
  if (it.heal) out.push(`Curación +${Math.round(it.heal * 100)}%`);
  return out;
}
function gearReq(it) {
  const G2 = it.grade && GRADES[it.grade];
  const req = [];
  if (it.lvl) req.push(`Nivel ${it.lvl}`);
  if (G2 && G2.stage) req.push(STAGES[G2.stage].name);
  return req.join(' · ');
}

function itemTitle(it) {
  const lines = [`${it.name} · ${RARITY[it.rarity].name}`];
  const kind = gearKind(it);
  if (kind) lines.push(kind);
  lines.push(...gearStats(it));
  if (it.type === 'weapon' || it.type === 'armor') {
    lines.push(`Requiere: ${gearReq(it)}`);
    const problem = equipProblem(it);
    if (problem) lines.push(`✕ ${problem}`);
  }
  lines.push(it.desc);
  return lines.join('\n');
}

function slotEl(id, qty, onClick, extraCls = '', onQuick = null) {
  const b = document.createElement('button');
  b.className = `islot ${extraCls}`;
  if (id) {
    const it = ITEMS[id];
    b.style.setProperty('--r', RARITY[it.rarity].color);
    b.classList.add('filled');
    b.title = itemTitle(it) + (shopOpen() ? `\nVender: ${sellPrice(it)} oro` : '');
    b.innerHTML = `<span class="glyph"></span>${qty > 1 ? `<span class="qty">${qty}</span>` : ''}`;
    b.firstChild.textContent = it.glyph;
    b.addEventListener('click', (e) => onClick(e, b));
    if (onQuick) {
      // Clic derecho o doble clic: equipar / usar / vender al instante
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        closeItemMenu();
        onQuick();
      });
      b.addEventListener('dblclick', (e) => {
        e.preventDefault();
        closeItemMenu();
        onQuick();
      });
    }
  } else {
    b.disabled = true;
  }
  return b;
}

// ---------- Ficha de objeto: detalles y acciones (Equipar, Usar, Vender, Quitar) ----------

function openItemMenu(anchor, source) {
  const p = G.player;
  const id = source.equipped ? p.equip[source.equipped] : p.inv[source.index] && p.inv[source.index].id;
  if (!id) return;
  const it = ITEMS[id];
  const menu = $('itemMenu');
  menu.innerHTML = '';
  const add = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    menu.append(n);
    return n;
  };
  const head = add('div', 'im-head');
  const ic = document.createElement('span');
  ic.className = 'islot filled';
  ic.style.setProperty('--r', RARITY[it.rarity].color);
  ic.textContent = it.glyph;
  const nm = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = it.name;
  strong.style.color = RARITY[it.rarity].color;
  const small = document.createElement('small');
  const qty = source.equipped ? '' : p.inv[source.index].qty > 1 ? ` · ×${p.inv[source.index].qty}` : '';
  small.textContent = `${RARITY[it.rarity].name}${source.equipped ? ' · Equipado' : ''}${qty}`;
  nm.append(strong, small);
  head.append(ic, nm);

  const stats = gearStats(it);
  if (gearKind(it)) stats.unshift(gearKind(it));
  if (it.type === 'potion') stats.push(it.desc);
  for (const s of stats) add('p', 'im-stat', s);
  if (it.type === 'weapon' || it.type === 'armor') add('p', 'im-req', `Requiere: ${gearReq(it)}`);
  if (it.type !== 'potion') add('p', 'im-desc', it.desc);

  const actions = add('div', 'im-actions');
  const btn = (label, fn, opts = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (opts.primary) b.className = 'buy';
    if (opts.disabled) b.disabled = true;
    b.addEventListener('click', () => {
      closeItemMenu();
      fn();
    });
    actions.append(b);
    return b;
  };

  if (source.equipped) {
    btn('Quitar', () => unequip(source.equipped), { primary: true });
  } else {
    if (it.type === 'weapon' || it.type === 'armor') {
      const problem = equipProblem(it);
      btn('Equipar', () => V.Game.useItem(source.index), { primary: true, disabled: !!problem });
      if (problem) actions.before(add('p', 'im-warn', problem));
    } else if (it.type === 'potion') {
      btn('Usar', () => V.Game.useItem(source.index), { primary: true });
    } else if (it.type === 'egg') {
      btn('Abrir huevo', () => openHatch(), { primary: true });
    } else if (it.type === 'gem') {
      btn(p.gemsOn ? 'Desactivar gemas' : 'Activar gemas', () => V.Game.toggleGems(), { primary: true });
    }
    if (shopOpen()) btn(`Vender · ${sellPrice(it)} oro`, () => openTrade('sell', source.index));
  }
  btn('Cerrar', () => {});

  menu.hidden = false;
  // Colocar junto al objeto, sin salirse de la pantalla
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let x = r.left - w - 8;
  if (x < 8) x = Math.min(innerWidth - w - 8, r.right + 8);
  const y = Math.max(8, Math.min(innerHeight - h - 8, r.top - 8));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const first = menu.querySelector('.im-actions button:not(:disabled)');
  if (first) first.focus();
}

function closeItemMenu() {
  const menu = $('itemMenu');
  if (menu) menu.hidden = true;
}

function refreshPanels() {
  if (!E) return;
  const p = G.player;
  closeItemMenu(); // el inventario cambió: la ficha abierta podría apuntar a otra casilla
  if (!E.inv.hidden) {
    const eq = $('invEquip');
    eq.innerHTML = '';
    for (const [key, label] of [
      ['weapon', 'Arma'],
      ['armor', 'Armadura'],
    ]) {
      const wrap = document.createElement('div');
      wrap.className = 'eq';
      const id = p.equip[key];
      wrap.append(slotEl(id, 1, (e, b) => openItemMenu(b, { equipped: key }), 'equipped', () => unequip(key)));
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
      grid.append(slotEl(slot && slot.id, slot && slot.qty, (e, b) => openItemMenu(b, { index: i }), '', () => clickInventory(i)));
    }
    const touch = V.Mobile && V.Mobile.isTouch;
    $('invHint').textContent = shopOpen()
      ? 'Tienda abierta: toca un objeto para venderlo o equiparlo.'
      : touch
        ? 'Toca un objeto para ver sus opciones: equipar, usar o quitar.'
        : 'Clic en un objeto para ver sus opciones. Clic derecho o doble clic: equipar o usar al instante.';
  }
  if (!E.stats.hidden) renderStats();
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
      const problem = it.type === 'weapon' || it.type === 'armor' ? equipProblem(it) : '';
      meta.textContent = it.atk || it.def ? `${gearStats(it)[0]} · ${gearReq(it)}${problem ? ' · Aún no puedes usarlo' : ''}` : it.desc;
      if (problem) meta.title = problem;
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
  const R = mmR;
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
  // Otros jugadores: azul; miembros de tu grupo: verde
  const ally = new Set(p.party ? p.party.members.map((m) => m.id) : []);
  for (const st of statics) {
    if (!st.ent || st.ent.dead) continue;
    c.fillStyle = ally.has(st.ent.id) ? '#7fe08a' : '#7fb6ff';
    c.beginPath();
    c.arc(tx(st.ent.pos.x), tz(st.ent.pos.z), ally.has(st.ent.id) ? 3.4 : 2.6, 0, Math.PI * 2);
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
  for (const b of p.buffs || []) parts.push(`${b.name} · ${Math.ceil(b.t)} s`);
  if (p.bubble) parts.push('Burbuja Estelar');
  if (p.gemsOn && p.gems > 0) parts.push(`Gemas de Poder (${p.gems})`);
  if (p.freeNext) parts.push('Resonancia: próximo hechizo gratis');
  if (p.shield > 0) parts.push(`Escudo ${Math.ceil(p.shield)} · ${Math.ceil(p.shieldT)} s`);
  const bad = (p.debuffs || []).map((d) => `${d.name} · ${Math.ceil(d.t)} s`).join('  ·  ');
  const buff = parts.join('  ·  ');
  const key = `${buff}|${bad}`;
  if (E.buffs.dataset.key !== key) {
    E.buffs.dataset.key = key;
    E.buffs.textContent = buff;
    if (bad) {
      const span = document.createElement('span');
      span.className = 'debuff';
      span.textContent = `${buff ? '  ·  ' : ''}${bad}`;
      E.buffs.append(span);
    }
  }
  E.buffs.hidden = !buff && !bad;

  const t = G.target;
  const npc = G.npcSel;
  const ply = G.playerSel;
  const tBar = E.tHp.parentElement;
  const tTitle = $('tTitle');
  $('tActions').hidden = !ply;
  $('tInfo').hidden = !!(npc || ply);
  if (ply) {
    E.tFrame.hidden = false;
    E.tFrame.dataset.lv = 'player';
    E.tLvl.textContent = ply.level || '?';
    E.tName.textContent = ply.name;
    const inParty = p.party && p.party.members.some((m) => m.id === ply.id);
    tTitle.textContent = `${className(ply.cls, ply.sex, ply.stage, ply.branch)}${inParty ? ' · De tu grupo' : ''}`;
    tTitle.hidden = false;
    tBar.hidden = false;
    bar(E.tHp, E.tHpT, ply.hp, ply.stats.maxHp);
    $('btnInvite').hidden = !!inParty || !!(p.party && p.party.leader !== p.id);
    $('tActions').hidden = $('btnInvite').hidden;
  } else if (npc) {
    // NPC seleccionado: nombre y oficio, sin barra de vida
    E.tFrame.hidden = false;
    E.tFrame.dataset.lv = 'npc';
    E.tLvl.textContent = '✦';
    E.tName.textContent = npc.name;
    tTitle.textContent = `${npc.title} · Haz clic para hablar`;
    tTitle.hidden = false;
    tBar.hidden = true;
  } else {
    tTitle.hidden = true;
    tBar.hidden = false;
    E.tFrame.hidden = !t || t.dead || t.hidden;
    if (t && !t.dead && !t.hidden) {
      E.tLvl.textContent = t.lvl;
      E.tName.textContent = t.def.name;
      E.tFrame.dataset.lv = levelClass(t.lvl - p.level);
      bar(E.tHp, E.tHpT, t.hp, t.maxHp);
    }
  }

  // Aire: visible en aguas profundas o mientras se recupera
  const air = $('pAir');
  const showAir = p.deep || (p.breath !== undefined && p.breath < 30);
  air.hidden = !showAir;
  if (showAir) {
    $('pAirFill').style.transform = `scaleX(${Math.max(0, p.breath / 30).toFixed(3)})`;
    $('pAirTxt').textContent = p.breath <= 0 ? '¡Sin aire!' : `Aire ${Math.ceil(p.breath)} s`;
  }

  updateHotbar();
  updateNameplates();
  if (frame % 3 === 0) drawMinimap();
  if (frame % 6 === 0) renderParty();
  if (frame % 20 === 0 && !E.stats.hidden) renderStats();
  if (!E.map.hidden && frame % 2 === 0) drawBigMap();
  if (frame % 15 === 0) {
    const z = zoneAt(p.pos);
    if (z !== lastZone) {
      if (lastZone !== undefined) banner(z ? z.name : 'Tierras salvajes', z ? (z.safe ? 'Zona segura' : `Nivel ${z.lvl}`) : 'Sin dueño ni ley');
      lastZone = z;
      E.zone.textContent = z ? z.name : 'Tierras salvajes';
    }
    if (!E.master.hidden && !masterNear()) togglePanel('master', false);
    if (shopOpen() && Math.hypot(p.pos.x - G.world.merchant.root.position.x, p.pos.z - G.world.merchant.root.position.z) > 8) {
      togglePanel('shop', false);
    }
  }
}

// ---------- Estado del personaje ----------

function renderStats() {
  const p = G.player;
  const s = p.stats;
  $('stLvl').textContent = p.level;
  $('stName').textContent = p.name;
  $('stClass').textContent = `${className(p.cls, p.sex, p.stage, p.branch)} · Nivel ${p.level}`;
  const need = p.level >= MAX_LEVEL ? 0 : xpToNext(p.level);
  const buffed = (p.buffs || []).length > 0;
  const pas = passiveFor(p.cls, p.stage, p.branch);
  const rows = [
    ['Raza', raceName(p.cls, p.sex)],
    ['Etapa de clase', `${STAGES[p.stage].name}${p.branch ? ` · Rama ${p.branch.toUpperCase()}` : ''}`],
    ['Pasiva', pas ? pas.name : 'Nivel 25 (Especialización)'],
    ['Vida', `${Math.round(p.hp)} / ${s.maxHp}`, false, 'sep'],
    ['Maná', `${Math.round(p.mp)} / ${s.maxMp}`],
    ['Experiencia', need ? `${p.xp.toLocaleString('es')} / ${need.toLocaleString('es')}` : 'Nivel máximo'],
    ['Ataque', Math.round(s.atk), buffed, 'sep'],
    ['Defensa', Math.round(s.def)],
    ['Prob. de crítico', `${(s.crit * 100).toFixed(1)}%`],
    ['Daño crítico', `×${(s.critMult || 1.8).toFixed(1)}`],
    ['Vel. de ataque', `${(1 / s.atkSpeed).toFixed(2)} golpes/s`, buffed],
    ['Vel. de movimiento', `${(s.speed || 7.2).toFixed(1)} m/s${p.swimming ? ' (nadando: 60%)' : ''}`, buffed],
    ['Alcance', s.range > 3 ? `${s.range} m` : 'Cuerpo a cuerpo'],
    ['Esquivar', `${Math.round((s.evade || 0) * 100)}%`],
    ['Daño recibido', s.dr ? `−${Math.round(s.dr * 100)}%` : 'Normal', !!s.dr],
    ['Bloqueo', s.block ? `${Math.round(s.block * 100)}%` : '—'],
    ['Curación', `${Math.round((s.heal || 1) * 100)}%`],
    ['Arma', p.equip.weapon ? ITEMS[p.equip.weapon].name : 'Ninguna', false, 'sep'],
    ['Armadura', p.equip.armor ? ITEMS[p.equip.armor].name : 'Ninguna'],
    ['Oro', p.gold.toLocaleString('es')],
  ];
  const dl = $('statList');
  dl.innerHTML = '';
  for (const [k, val, up, cls] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = val;
    if (up) dd.classList.add('up');
    if (cls) {
      dt.classList.add(cls);
      dd.classList.add(cls);
    }
    dl.append(dt, dd);
  }
}

// ---------- Maestro de Clase: cambios de clase (nivel 10, 25 y 40) ----------

function bindMaster() {
  const panel = $('masterPanel');
  if (panel) panel.addEventListener('keydown', (e) => e.stopPropagation());
}

function openMaster() {
  togglePanel('master', true);
  refreshMaster();
}

function masterNear() {
  const n = G.world.npcs.find((x) => x.id === 'maestro');
  if (!n) return false;
  const np = n.root.position;
  return Math.hypot(G.player.pos.x - np.x, G.player.pos.z - np.z) < 8;
}

function refreshMaster() {
  if (!E || !E.master || E.master.hidden) return;
  const p = G.player;
  const box = $('masterBody');
  box.innerHTML = '';
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const btn = (label, fn, primary, disabled) => {
    const b = el('button', primary ? 'buy' : '', label);
    b.type = 'button';
    b.disabled = !!disabled;
    b.onclick = fn;
    return b;
  };

  // Título actual
  const head = el('div', 'ms-head');
  head.append(el('strong', '', className(p.cls, p.sex, p.stage, p.branch)), el('small', '', `${raceName(p.cls, p.sex)} · Nivel ${p.level} · ${STAGES[p.stage].name}`));
  box.append(head);

  // Línea de progreso: Despertar → Especialización → Ascensión
  const steps = el('ol', 'ms-steps');
  for (const st of STAGES.slice(1)) {
    const done = p.stage >= st.stage;
    const cur = p.stage + 1 === st.stage;
    const li = el('li', done ? 'done' : cur ? 'cur' : '');
    li.append(el('b', '', `${done ? '✓ ' : ''}Nivel ${st.lvl} · ${st.name}`), el('small', '', st.unlocks));
    steps.append(li);
  }
  box.append(steps);

  const next = STAGES[p.stage + 1];
  const area = el('div', 'ms-next');
  box.append(area);
  if (!next) {
    area.append(el('p', '', '¡Alcanzaste la Ascensión Maestra! Eres de los héroes más fuertes de Valdoria.'));
    return;
  }
  const q = p.quest;
  const def = questFor(next.stage);
  if (q && q.stage === next.stage) {
    const ready = q.kills >= def.need;
    area.append(el('h3', '', def.title));
    if (q.branch) area.append(el('p', 'ms-branch', `Especialización elegida: ${CLASSES[p.cls].branches[q.branch].name}`));
    area.append(el('p', '', def.text));
    const bar = el('div', 'ms-bar');
    const fill = el('i');
    fill.style.width = `${Math.min(100, (q.kills / def.need) * 100)}%`;
    bar.append(fill);
    area.append(bar, el('p', 'ms-count', ready ? '¡Misión cumplida!' : `${q.kills} / ${def.need}`));
    const row = el('div', 'im-actions');
    row.append(
      btn('Completar cambio de clase', () => V.Game.classQuest('complete'), true, !ready || !masterNear()),
      btn('Abandonar', () => {
        if (confirm('¿Abandonar la misión? Perderás el progreso.')) V.Game.classQuest('abandon');
      })
    );
    area.append(row);
    return;
  }
  if (p.level < next.lvl) {
    area.append(el('p', '', `Vuelve cuando seas nivel ${next.lvl} para el ${next.name}. Te faltan ${next.lvl - p.level} niveles.`));
    return;
  }
  if (next.branch) {
    area.append(el('h3', '', 'Elige tu especialización'), el('p', 'hint', 'La elección es para siempre: piensa qué te gusta más.'));
    const cards = el('div', 'ms-branches');
    for (const key of ['a', 'b']) {
      const b = CLASSES[p.cls].branches[key];
      const card = el('div', 'ms-card');
      card.append(
        el('b', '', `Rama ${key.toUpperCase()}: ${b.name}`),
        el('small', '', `En el nivel 40: ${b.master}`),
        el('p', '', `Pasiva · ${b.passive.name}: ${b.passive.desc}`),
        el('p', '', `Ultimate · ${b.ultimate.name}: ${b.ultimate.desc}`),
        btn(`Elegir ${b.name}`, () => {
          if (confirm(`¿Elegir ${b.name}? No se puede cambiar después.`)) V.Game.classQuest('accept', key);
        }, true, !masterNear())
      );
      cards.append(card);
    }
    area.append(cards);
    return;
  }
  area.append(el('h3', '', def.title), el('p', '', def.text));
  if (next.stage === 1) area.append(el('p', 'hint', `Al completarla aprendes ${CLASSES[p.cls].skills[3].name} y ${CLASSES[p.cls].skills[4].name}, y te conviertes en ${CLASSES[p.cls].awaken}.`));
  if (def.group) area.append(el('p', 'hint', 'Misión épica: lo mejor es ir con tu grupo. Todos los miembros cercanos cuentan.'));
  const row = el('div', 'im-actions');
  row.append(btn('Aceptar misión', () => V.Game.classQuest('accept'), true, !masterNear()));
  area.append(row);
}

// ---------- Huevo de Mascota: elegir mascota ----------

function openHatch() {
  const box = $('hatchList');
  box.innerHTML = '';
  for (const [type, pet] of Object.entries(V.Data.PETS)) {
    const card = document.createElement('div');
    card.className = 'ms-card';
    const b = document.createElement('b');
    b.textContent = `${pet.glyph} ${pet.name}`;
    const small = document.createElement('small');
    small.textContent = `Nivel 20: ${pet.mount} · Nivel 40: ${pet.glider}`;
    const desc = document.createElement('p');
    desc.textContent = pet.desc;
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.textContent = `Elegir ${pet.name}`;
    pick.onclick = () => {
      V.Game.hatch(type);
      $('hatchPanel').hidden = true;
    };
    card.append(b, small, desc, pick);
    box.append(card);
  }
  $('hatchPanel').hidden = false;
}

// ---------- Grupo ----------

let partyKey = '';
function renderParty() {
  const p = G.player;
  const box = $('partyFrame');
  const party = p.party;
  box.hidden = !party;
  if (!party) {
    partyKey = '';
    return;
  }
  const list = $('partyList');
  const key = party.members.map((m) => m.id).join(',') + party.leader;
  if (key !== partyKey) {
    partyKey = key;
    list.innerHTML = '';
    for (const m of party.members) {
      const el = document.createElement('div');
      el.className = 'pm';
      el.dataset.id = m.id;
      el.innerHTML = '<div class="nm"><span class="who"></span><b></b></div><div class="bar hp"><i></i></div><div class="bar mp"><i></i></div>';
      el.querySelector('.who').textContent = `${party.leader === m.id ? '★ ' : ''}${m.name}`;
      if (party.leader === p.id && m.id !== p.id) {
        const kick = document.createElement('button');
        kick.className = 'kick';
        kick.title = 'Expulsar del grupo';
        kick.textContent = '✕';
        kick.onclick = (e) => {
          e.stopPropagation();
          V.Game.kickFromParty(m.id);
        };
        el.querySelector('.nm').append(kick);
      }
      el.onclick = () => {
        const q = statics.find((st) => st.ent && st.ent.id === m.id);
        if (q) V.Game.selectPlayer(q.ent);
      };
      list.append(el);
    }
  }
  for (const m of party.members) {
    const el = list.querySelector(`[data-id="${m.id}"]`);
    if (!el) continue;
    el.classList.toggle('dead', m.dead);
    el.querySelector('.nm b').textContent = `Nv ${m.level}`;
    const [hp, mp] = el.querySelectorAll('.bar i');
    hp.style.transform = `scaleX(${Math.max(0, m.hp / m.maxHp).toFixed(3)})`;
    mp.style.transform = `scaleX(${Math.max(0, m.mp / m.maxMp).toFixed(3)})`;
  }
}

function showInvite(name) {
  $('inviteText').textContent = `${name} te invita a su grupo. La experiencia se repartirá entre todos.`;
  $('invitePanel').hidden = false;
  clearTimeout(showInvite.t);
  showInvite.t = setTimeout(() => !$('invitePanel').hidden && answerInvite(false), 28000);
}
function answerInvite(accept) {
  $('invitePanel').hidden = true;
  V.Game.answerInvite(accept);
}

// ---------- Botín posible de un monstruo (Shift + clic) ----------

function openDrops(m) {
  if (!m || !m.def) return;
  const p = G.player;
  $('dropTitle').textContent = `Botín · ${m.def.name}`;
  const list = $('dropList');
  list.innerHTML = '';
  for (const [raw, chance] of m.def.drops) {
    const id = resolveDrop(raw, p.cls);
    const it = ITEMS[id];
    const li = document.createElement('li');
    const ic = document.createElement('span');
    ic.className = 'islot filled';
    ic.style.setProperty('--r', RARITY[it.rarity].color);
    ic.textContent = it.glyph;
    const nm = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = it.name;
    strong.style.color = RARITY[it.rarity].color;
    const small = document.createElement('small');
    small.style.cssText = 'display:block;color:var(--muted);font-size:12px';
    small.textContent = it.type === 'weapon' || it.type === 'armor' ? `${RARITY[it.rarity].name} · Nivel ${it.lvl}` : RARITY[it.rarity].name;
    nm.append(strong, small);
    const pct = document.createElement('span');
    pct.className = 'pct';
    pct.textContent = chance >= 1 ? '100%' : `${+(chance * 100).toFixed(1)}%`;
    li.append(ic, nm, pct);
    list.append(li);
  }
  togglePanel('drop', true);
}

// ---------- Mapa grande: arrastrar para mover, rueda o +/− para acercar ----------

const mapView = { center: null, scale: 1.6 };
function bindBigMap() {
  const cv = $('bigmap');
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY };
    cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = cv.width / cv.clientWidth / mapView.scale;
    const c = mapView.center || { x: G.player.pos.x, z: G.player.pos.z };
    mapView.center = { x: c.x - (e.clientX - drag.x) * k, z: c.z - (e.clientY - drag.y) * k };
    drag = { x: e.clientX, y: e.clientY };
  });
  const end = () => {
    drag = null;
    cv.style.cursor = 'grab';
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      mapView.scale = Math.min(8, Math.max(0.9, mapView.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    },
    { passive: false }
  );
  $('mapIn').onclick = () => (mapView.scale = Math.min(8, mapView.scale * 1.3));
  $('mapOut').onclick = () => (mapView.scale = Math.max(0.9, mapView.scale / 1.3));
  $('mapCenter').onclick = () => (mapView.center = null);
}

function drawBigMap() {
  const cv = $('bigmap');
  const c = cv.getContext('2d');
  const W = cv.width;
  const p = G.player;
  const ctr = mapView.center || { x: p.pos.x, z: p.pos.z };
  const s = mapView.scale;
  const tx = (x) => W / 2 + (x - ctr.x) * s;
  const tz = (z) => W / 2 + (z - ctr.z) * s;
  c.fillStyle = '#1d251a';
  c.fillRect(0, 0, W, W);
  // Borde del mundo
  c.fillStyle = '#26301f';
  c.beginPath();
  c.arc(tx(0), tz(0), 188 * s, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(176,146,98,.6)';
  c.lineWidth = Math.max(2, 3 * s * 0.6);
  for (const { x, z } of G.world.zones) {
    c.beginPath();
    c.moveTo(tx(0), tz(0));
    c.lineTo(tx(x), tz(z));
    c.stroke();
  }
  for (const z of G.world.zones) {
    c.fillStyle = `rgba(${z.tint.map((t) => Math.round(t * 255)).join(',')},.6)`;
    c.beginPath();
    c.arc(tx(z.x), tz(z.z), z.r * s, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = 'rgba(217,181,106,.4)';
  c.beginPath();
  c.arc(tx(0), tz(0), 22 * s, 0, Math.PI * 2);
  c.fill();
  // Nombres de zonas
  c.font = `700 ${Math.round(11 + s * 2)}px Cinzel, Georgia, serif`;
  c.textAlign = 'center';
  for (const z of [V.Data.ZONES[0], ...G.world.zones]) {
    const label = z.lvl ? `${z.name} · ${z.lvl}` : z.name;
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(0,0,0,.7)';
    c.strokeText(label, tx(z.x), tz(z.z) - (z.safe ? 0 : z.r * s * 0.15));
    c.fillStyle = '#f3e7cc';
    c.fillText(label, tx(z.x), tz(z.z) - (z.safe ? 0 : z.r * s * 0.15));
  }
  for (const m of G.mobs) {
    if (m.dead || m.hidden) continue;
    c.fillStyle = m.def.boss ? '#c895ff' : m.aggro ? '#ff5a4a' : '#f2cf5b';
    c.fillRect(tx(m.pos.x) - 2, tz(m.pos.z) - 2, 4, 4);
  }
  const ally = new Set(p.party ? p.party.members.map((m) => m.id) : []);
  for (const st of statics) {
    if (!st.ent || st.ent.dead) continue;
    c.fillStyle = ally.has(st.ent.id) ? '#7fe08a' : '#7fb6ff';
    c.beginPath();
    c.arc(tx(st.ent.pos.x), tz(st.ent.pos.z), 5, 0, Math.PI * 2);
    c.fill();
  }
  // Miembros del grupo lejanos (no visibles en la escena)
  if (p.party) {
    c.fillStyle = '#7fe08a';
    for (const m of p.party.members) {
      if (m.id === p.id || statics.some((st) => st.ent && st.ent.id === m.id)) continue;
      c.beginPath();
      c.arc(tx(m.x), tz(m.z), 5, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.fillStyle = '#d9b56a';
  for (const n of G.world.npcs) c.fillRect(tx(n.x) - 3, tz(n.z) - 3, 6, 6);
  c.save();
  c.translate(tx(p.pos.x), tz(p.pos.z));
  c.rotate(-p.facing);
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#111';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(0, 11);
  c.lineTo(-7, -8);
  c.lineTo(0, -4);
  c.lineTo(7, -8);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
}

V.UI = {
  initUI, createNameplate, refreshNameplate, addPlayerPlate, removePlayerPlate, chat, focusChat,
  floatText, log, logLoot, banner, showDeath, showInvite, openDrops,
  togglePanel, shopOpen, openShop, closeAll, refreshPanels, updateUI, openTrade,
  classChanged, openMaster, refreshMaster, openHatch,
};
})();
