// Interfaz (HUD) en HTML sobre el canvas 3D. Los botones funcionan con ratón y con toque.
(function () {
const G = V.G;
const { GUILD_EMBLEMS, GUILD_COLORS, GUILD_RANKS, GUILD_LVL, GUILD_COST } = V.Data;
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
    quests: $('questPanel'),
    guild: $('guildPanel'),
  };
  E.hud.hidden = false;
  E.pName.textContent = G.player.name;
  $('pClass').textContent = className(G.player.cls, G.player.sex, G.player.stage, G.player.branch);
  buildHotbar();
  bindMaster();
  bindInvTabs();
  bindSafeChat();
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
  $('btnQuests').onclick = () => togglePanel('quests');
  $('btnGuild').onclick = () => togglePanel('guild');
  $('btnGuildInv').onclick = () => G.playerSel && V.Game.guild.invite(G.playerSel.id);
  $('guildYes').onclick = () => answerGuild(true);
  $('guildNo').onclick = () => answerGuild(false);
  $('btnMap').onclick = () => togglePanel('map');
  $('minimap').onclick = () => togglePanel('map', true);
  $('mmIn').onclick = () => (mmR = Math.max(30, mmR / 1.4));
  $('mmOut').onclick = () => (mmR = Math.min(200, mmR * 1.4));
  $('tInfo').onclick = () => G.target && openDrops(G.target);
  $('btnInvite').onclick = () => G.playerSel && V.Game.invite(G.playerSel.id);
  // Forzar ataque a un jugador blanco: pide un segundo toque para confirmar (en 6 s), así nadie
  // ataca por error. A morados y rojos se les ataca directo.
  let pvpAsk = null; // { id, until }
  $('btnPvp').onclick = () => {
    const q = G.playerSel;
    if (!q) return;
    if (!q.pvpState && !(pvpAsk && pvpAsk.id === q.id && performance.now() < pvpAsk.until)) {
      pvpAsk = { id: q.id, until: performance.now() + 6000 };
      return;
    }
    pvpAsk = null;
    V.Game.attackTarget(true);
  };
  G.pvpAsking = (q) => !!(pvpAsk && q && pvpAsk.id === q.id && performance.now() < pvpAsk.until);
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
  if (V.Mobile && V.Mobile.isTouch) input.placeholder = 'Escribe aquí · # grupo · @ gremio';
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = input.value.trim();
      const cmd = text.match(/^\/(invitar|invite)\s+(.+)$/i);
      if (safeChat) {
        /* modo solo frases: no se envía texto escrito */
      } else if (cmd) V.Game.inviteByName(cmd[2].trim());
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
  // Dos grupos: habilidades (1–6) y acciones (pociones, Gemas de Poder y montura)
  const skillsBox = document.createElement('div');
  skillsBox.className = 'hb-group hb-skills';
  skillsBox.setAttribute('aria-label', 'Habilidades');
  const actionsBox = document.createElement('div');
  actionsBox.className = 'hb-group hb-actions';
  actionsBox.setAttribute('aria-label', 'Acciones');
  bar.append(skillsBox, actionsBox);
  E.slots = defs.map((d) => {
    const b = document.createElement('button');
    b.className = `slot ${d.kind === 'pot' ? `pot ${d.id}` : d.kind === 'gem' || d.kind === 'mount' ? d.kind : 'skill'}`;
    b.title = d.title;
    b.innerHTML = `<span class="glyph">${d.glyph}</span><span class="key">${d.key}</span><span class="cd"></span><span class="qty"></span><span class="lock"></span>`;
    b.addEventListener('click', () => (d.kind === 'skill' ? useSkill(d.i) : d.kind === 'gem' ? V.Game.toggleGems() : d.kind === 'mount' ? V.Game.toggleMount() : usePotion(d.id)));
    (d.kind === 'skill' ? skillsBox : actionsBox).append(b);
    return { d, b, cd: b.querySelector('.cd'), qty: b.querySelector('.qty'), lock: b.querySelector('.lock'), state: '' };
  });
}

function skillTitle(s) {
  if (s.locked) return `${s.name}\n${s.desc}`;
  const req = s.stage ? `${STAGES[s.stage].name} · nivel ${s.lvl}` : `nivel ${s.lvl}`;
  const p = G.player;
  const lvl = p ? V.Data.skillLevel(p, s) : 0;
  const mp = V.Data.skillMp(s, Math.max(1, lvl));
  return `${s.ultimate ? '★ ' : ''}${s.name}${lvl ? ` · Nv ${lvl}/${V.Data.skillMaxLevel(s)}` : ` (${req})`} · ${mp} MP · ${s.cd} s\n${s.desc}`;
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
      const slvl = V.Data.skillLevel(p, sk);
      low = !p.freeNext && p.mp < V.Data.skillMp(sk, Math.max(1, slvl));
      // Al subir de nivel la habilidad, su ficha (tooltip) se actualiza
      if (s.lv !== slvl) {
        s.lv = slvl;
        s.b.title = skillTitle(sk);
      }
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

const AGGRO_HINT = 'Agresivo: te ataca si te acercas';

function refreshNameplate(m) {
  m.np.name.innerHTML = '';
  // Monstruo agresivo: un «!» rojo antes del nombre (ataca solo si uno se acerca)
  if (m.def.aggressive) {
    const a = document.createElement('i');
    a.className = 'np-aggro';
    a.textContent = '!';
    a.title = AGGRO_HINT;
    m.np.name.append(a);
  }
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
  const s = { pos, height, el, maxDist, name: text };
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
    // Nombre morado (atacó a alguien hace poco) o rojo (PK)
    // Gremio: emblema y nombre bajo el nombre del jugador
    if (s === myPlate || s.ent) {
      const tag = s === myPlate ? (p.guild ? `${p.guild.emblem}|${p.guild.color}|${p.guild.name}` : '') : s.ent.guildTag || '';
      if (tag !== (s.gtag || '')) {
        s.gtag = tag;
        s.el.textContent = s.name;
        if (tag) {
          const [e, c, n] = tag.split('|');
          const t = document.createElement('small');
          t.className = 'np-guild';
          t.style.color = GUILD_COLORS[+c] || '';
          t.textContent = `${GUILD_EMBLEMS[+e] || ''} ${n}`;
          s.el.append(t);
        }
      }
    }
    const pv = s === myPlate ? (p.karma > 0 ? 2 : p.flagT > 0 ? 1 : 0) : s.ent ? s.ent.pvpState || 0 : 0;
    if (pv !== (s.pvp || 0)) {
      s.pvp = pv;
      s.el.classList.toggle('np-flag', pv === 1);
      s.el.classList.toggle('np-pk', pv === 2);
    }
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
  // Lo importante también se muestra en el centro (lo que ya anuncia el cartel grande, no)
  if (TOAST_MS[cls] && !/^Has alcanzado el nivel|¡completada!/.test(text)) notify(text, cls);
}

// ---------- Avisos en el centro de la pantalla ----------
// lvl: logros (dorado) · quest: progreso de misión (verde) · warn: algo no se pudo hacer (rojo)
const TOAST_MS = { lvl: 4500, quest: 3200, warn: 2400 };
function notify(text, kind = 'lvl') {
  const box = $('toasts');
  if (!box) return;
  const ms = TOAST_MS[kind] || 3000;
  // El mismo aviso repetido no se apila: se renueva y cuenta las veces
  for (const t of box.children) {
    if (t.dataset.text !== text || t.classList.contains('out')) continue;
    t.dataset.n = String(Number(t.dataset.n || 1) + 1);
    t.lastChild.textContent = `×${t.dataset.n}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => dismissToast(t), ms);
    return;
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.dataset.text = text;
  t.append(text, document.createElement('b'));
  box.append(t);
  // Como mucho 4 a la vez: se va el más antiguo
  const live = [...box.children].filter((x) => !x.classList.contains('out'));
  if (live.length > 4) dismissToast(live[0]);
  t._timer = setTimeout(() => dismissToast(t), ms);
}
function dismissToast(t) {
  clearTimeout(t._timer);
  t.classList.add('out');
  setTimeout(() => t.remove(), 400);
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
// ---------- Chat seguro: frases rápidas, modo solo frases y jugadores silenciados ----------

const SAFE_KEY = 'valdoria-chat-seguro';
const MUTE_KEY = 'valdoria-silenciados';
const loadPref = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const savePref = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sin almacenamiento */
  }
};
let safeChat = loadPref(SAFE_KEY, false);
let mutedNames = new Set(loadPref(MUTE_KEY, []));

function bindSafeChat() {
  document.body.classList.toggle('safe-chat', safeChat);
  const list = $('phraseList');
  list.innerHTML = '';
  for (const ph of V.Data.PHRASES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ph.text;
    b.onclick = () => {
      V.Game.sendPhrase(ph.id, $('phraseParty').checked);
      $('phrasePanel').hidden = true;
    };
    list.append(b);
  }
  $('btnPhrases').onclick = (e) => {
    e.stopPropagation();
    $('phrasePanel').hidden = !$('phrasePanel').hidden;
  };
  $('safeChat').checked = safeChat;
  $('safeChat').onchange = () => {
    safeChat = $('safeChat').checked;
    savePref(SAFE_KEY, safeChat);
    document.body.classList.toggle('safe-chat', safeChat);
    log(safeChat ? 'Modo solo frases rápidas: no verás mensajes escritos por otros jugadores.' : 'Chat libre activado (con filtro de palabras y datos personales).', 'sys');
  };
  document.addEventListener('pointerdown', (e) => {
    const panel = $('phrasePanel');
    if (!panel.hidden && !panel.contains(e.target) && e.target !== $('btnPhrases')) panel.hidden = true;
  });
  // Silenciar y reportar al jugador seleccionado
  $('btnMute').onclick = () => {
    const ply = G.playerSel;
    if (!ply) return;
    if (mutedNames.has(ply.name)) mutedNames.delete(ply.name);
    else mutedNames.add(ply.name);
    savePref(MUTE_KEY, [...mutedNames]);
    log(mutedNames.has(ply.name) ? `Silenciaste a ${ply.name}: ya no verás sus mensajes.` : `Vuelves a ver los mensajes de ${ply.name}.`, 'sys');
  };
  $('btnReport').onclick = () => ($('reportBox').hidden = !$('reportBox').hidden);
  document.querySelectorAll('#reportBox button').forEach((b) =>
    (b.onclick = () => {
      if (G.playerSel) V.Game.report(G.playerSel.id, b.dataset.reason);
      $('reportBox').hidden = true;
    })
  );
}

function chat(msg) {
  if (!E) return;
  // Mensajes de jugadores silenciados, y mensajes escritos en el modo solo frases
  const own = G.player && msg.id === G.player.id;
  if ((msg.kind === 'player' || msg.kind === 'party' || msg.kind === 'guild') && !own) {
    if (mutedNames.has(msg.name)) return;
    if (safeChat && !msg.phrase) return;
  }
  const line = document.createElement('p');
  if (msg.kind === 'guild') {
    line.className = 'chat-guild';
    const who = document.createElement('b');
    who.textContent = `[Gremio] ${msg.name}: `;
    line.append(who, msg.text);
    showBubble(msg.id, msg.text);
  } else if (msg.kind === 'party') {
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

// Tienda abierta: id de la tienda y NPC que la atiende (para cerrarla al alejarse)
let shopId = 'orlen';
const shopNpc = () => G.world.npcs.find((n) => n.role === 'shop' && n.shop === shopId);
const shopEntry = (id) => V.Data.shopItems(shopId, G.player.cls).find((x) => x.id === id);
const priceText = (n, currency) => (currency ? `${n} ${ITEMS[currency].glyph}` : `${n.toLocaleString('es')} oro`);
const wallet = (currency) => (currency ? countItem(currency) : G.player.gold);

function openShop(id = 'orlen') {
  shopId = id;
  const npc = shopNpc();
  $('shopTitle').textContent = npc ? npc.name : 'Tienda';
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
  const entry = mode === 'buy' ? shopEntry(id) : null;
  if (mode === 'buy' && !entry) return;
  const currency = entry && entry.currency;
  const unit = mode === 'buy' ? entry.price : mode === 'destroy' ? 0 : sellPrice(it);
  const have = mode !== 'buy' ? p.inv[ref].qty : 0;
  const max = mode === 'buy' ? (it.stack ? Math.max(1, Math.min(99, Math.floor(wallet(currency) / unit))) : 1) : have;
  trade = { mode, ref, id, unit, max, qty: 1, currency };

  const box = $('tradePanel');
  $('trTitle').textContent = mode === 'buy' ? 'Comprar' : mode === 'destroy' ? 'Destruir' : 'Vender';
  $('trOk').classList.toggle('danger', mode === 'destroy');
  const icon = $('trIcon');
  icon.style.setProperty('--r', RARITY[it.rarity].color);
  icon.textContent = it.glyph;
  $('trName').textContent = it.name;
  $('trName').style.color = RARITY[it.rarity].color;
  $('trDesc').textContent = mode !== 'buy' && have > 1 ? `Tienes ${have}. ${it.desc}` : it.desc;
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
  const poor = trade.mode === 'buy' && wallet(trade.currency) < total;
  const destroy = trade.mode === 'destroy';
  $('trTotal').textContent = destroy
    ? '⚠ Se pierde para siempre: no se puede deshacer.'
    : `${trade.mode === 'buy' ? 'Total' : 'Recibes'}: ${priceText(total, trade.currency)}`;
  $('trTotal').classList.toggle('poor', poor);
  $('trTotal').classList.toggle('warn', destroy);
  $('trOk').disabled = poor;
  const n = trade.qty > 1 ? `×${trade.qty}` : '';
  $('trOk').textContent = trade.mode === 'buy' ? `Comprar ${n}` : destroy ? `Destruir ${n}` : `Vender ${n}`;
}

function closeTrade() {
  trade = null;
  $('tradePanel').hidden = true;
}

function confirmTrade() {
  if (!trade) return;
  if (trade.mode === 'buy') V.Game.buyItem(trade.id, trade.qty);
  else if (trade.mode === 'destroy') V.Game.destroyItem(trade.ref, trade.qty);
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
  if (!$('guildInvitePanel').hidden) {
    answerGuild(false);
    return true;
  }
  for (const k of ['master', 'drop', 'map', 'stats', 'shop', 'inv', 'help', 'quests', 'guild']) {
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

// Pestañas del inventario (la elegida se recuerda mientras dura la partida)
const INV_SLOTS = 30;
const INV_TABS = { all: 'Todo', equip: 'Equipo', consumable: 'Consumibles', quest: 'Misión', other: 'Otros' };
let invCat = 'all';
function bindInvTabs() {
  document.querySelectorAll('#invPanel [data-cat]').forEach((b) => {
    b.onclick = () => {
      invCat = b.dataset.cat;
      refreshPanels();
    };
  });
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
    if (!V.Data.isKeyItem(it)) btn('Destruir', () => openTrade('destroy', source.index)).classList.add('danger');
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
    $('invGold').textContent = p.gold.toLocaleString('es');
    const used = p.inv.length;
    $('invCount').textContent = `${used} / ${INV_SLOTS}`;
    $('invCount').classList.toggle('full', used >= INV_SLOTS);
    // Cantidad de objetos por pestaña
    const per = { all: used, equip: 0, consumable: 0, quest: 0, other: 0 };
    for (const s of p.inv) per[V.Data.itemCategory(ITEMS[s.id])]++;
    document.querySelectorAll('#invPanel [data-cat]').forEach((b) => {
      b.classList.toggle('on', b.dataset.cat === invCat);
      const label = INV_TABS[b.dataset.cat];
      b.innerHTML = '';
      b.append(label);
      if (per[b.dataset.cat]) {
        const n = document.createElement('small');
        n.textContent = per[b.dataset.cat];
        b.append(n);
      }
    });
    const grid = $('invGrid');
    grid.innerHTML = '';
    if (invCat === 'all') {
      for (let i = 0; i < INV_SLOTS; i++) {
        const slot = p.inv[i];
        grid.append(slotEl(slot && slot.id, slot && slot.qty, (e, b) => openItemMenu(b, { index: i }), '', () => clickInventory(i)));
      }
    } else {
      // Solo los objetos de la pestaña (cada uno conserva su casilla real de la mochila)
      let shown = 0;
      p.inv.forEach((slot, i) => {
        if (V.Data.itemCategory(ITEMS[slot.id]) !== invCat) return;
        grid.append(slotEl(slot.id, slot.qty, (e, b) => openItemMenu(b, { index: i }), '', () => clickInventory(i)));
        shown++;
      });
      // Casillas vacías hasta completar la mochila: el panel no cambia de tamaño entre pestañas
      for (; shown < INV_SLOTS; shown++) grid.append(slotEl(null));
    }
    $('invEmpty').hidden = invCat === 'all' || per[invCat] > 0;
    const touch = V.Mobile && V.Mobile.isTouch;
    $('invHint').textContent = shopOpen()
      ? 'Tienda abierta: toca un objeto para venderlo o equiparlo.'
      : touch
        ? 'Toca un objeto para ver sus opciones: equipar, usar o quitar.'
        : 'Clic en un objeto para ver sus opciones. Clic derecho o doble clic: equipar o usar al instante.';
  }
  if (!E.stats.hidden) renderStats();
  if (!E.quests.hidden) renderQuests();
  if (!E.guild.hidden) renderGuild();
  if (!E.shop.hidden) {
    const list = $('shopList');
    list.innerHTML = '';
    for (const { id, price, currency } of V.Data.shopItems(shopId, p.cls)) {
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
      buy.textContent = priceText(price, currency);
      buy.disabled = wallet(currency) < price;
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
    const pv = ply.pvpState || 0;
    const tag = inParty ? ' · De tu grupo' : pv === 2 ? ' · PK' : pv === 1 ? ' · En combate PvP' : '';
    const title = `${className(ply.cls, ply.sex, ply.stage, ply.branch)}${tag}`;
    if (tTitle.textContent !== title) tTitle.textContent = title;
    E.tFrame.dataset.pvp = pv;
    // Atacar: a morados y rojos directo; a los demás, ataque forzado (como Ctrl + clic)
    const pvpBtn = $('btnPvp');
    pvpBtn.hidden = !!inParty || ply.dead;
    const asking = !pv && G.pvpAsking(ply);
    const pvpTxt = pv ? '⚔ Atacar' : asking ? '¿Seguro? Si lo derrotas serás PK · Toca otra vez' : '⚔ Forzar ataque';
    if (pvpBtn.textContent !== pvpTxt) pvpBtn.textContent = pvpTxt;
    pvpBtn.classList.toggle('ask', asking);
    pvpBtn.title = pv ? 'Es PK o está en combate: se le puede atacar' : 'Atacar a este jugador (igual que Ctrl + clic). Si lo derrotas te volverás PK.';
    tTitle.hidden = false;
    tBar.hidden = false;
    bar(E.tHp, E.tHpT, ply.hp, ply.stats.maxHp);
    $('btnInvite').hidden = !!inParty || !!(p.party && p.party.leader !== p.id);
    $('btnGuildInv').hidden = !(p.guild && p.guild.rank >= 1) || !!ply.guildTag;
    $('tActions').hidden = false;
    const muted = mutedNames.has(ply.name);
    if ($('btnMute').textContent !== (muted ? 'Quitar silencio' : 'Silenciar')) $('btnMute').textContent = muted ? 'Quitar silencio' : 'Silenciar';
    $('btnMute').classList.toggle('on', muted);
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
    tBar.hidden = false;
    E.tFrame.hidden = !t || t.dead || t.hidden;
    tTitle.hidden = !(t && t.def && t.def.aggressive);
    if (t && !t.dead && !t.hidden) {
      E.tLvl.textContent = t.lvl;
      E.tName.textContent = t.def.name;
      if (t.def.aggressive) {
        const hint = `❗ ${AGGRO_HINT}`;
        if (tTitle.textContent !== hint) tTitle.textContent = hint;
      }
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
  if (frame % 20 === 0 && !E.quests.hidden) renderQuests();
  if (frame % 20 === 0 && !E.guild.hidden) renderGuild();
  if (!E.map.hidden && frame % 2 === 0) drawBigMap();
  if (frame % 15 === 0) {
    const z = zoneAt(p.pos);
    if (z !== lastZone) {
      if (lastZone !== undefined) banner(z ? z.name : 'Tierras salvajes', z ? (z.safe ? 'Zona segura' : `Nivel ${z.lvl}`) : 'Sin dueño ni ley');
      lastZone = z;
      E.zone.textContent = z ? z.name : 'Tierras salvajes';
    }
    if (!E.master.hidden && !masterNear()) togglePanel('master', false);
    const sn = shopNpc();
    if (shopOpen() && (!sn || Math.hypot(p.pos.x - sn.root.position.x, p.pos.z - sn.root.position.z) > 8)) {
      togglePanel('shop', false);
    }
  }
}

// ---------- Estado del personaje ----------

// ---------- Panel de misiones: misión de clase en curso, próximo paso y camino del héroe ----------
function questBar(cur, max, label) {
  const b = document.createElement('div');
  b.className = 'qbar';
  const i = document.createElement('i');
  i.style.transform = `scaleX(${Math.max(0, Math.min(1, max ? cur / max : 1)).toFixed(3)})`;
  const s = document.createElement('span');
  s.textContent = label;
  b.append(i, s);
  return b;
}

// ---------- Gremio (tecla G) ----------

let guildFound = false; // abierto desde el Maestro del Gremio: muestra cómo fundarlo
const guildForm = { name: '', emblem: 0, color: 0 };
let guildOpenRow = null; // miembro con sus acciones a la vista
let guildEditNotice = false;

function openGuild(found) {
  guildFound = !!found;
  togglePanel('guild', true);
}
function guildChanged() {
  guildOpenRow = null;
  guildEditNotice = false;
  if (!E.guild.hidden) renderGuild();
}

// Botón que pide un segundo toque para confirmar (5 s)
function confirmBtn(b, ask, fn) {
  b.onclick = () => {
    if (b.dataset.ask && performance.now() < +b.dataset.ask) return fn();
    b.dataset.ask = performance.now() + 5000;
    b.dataset.label = b.dataset.label || b.textContent;
    b.textContent = ask;
    b.classList.add('ask');
    setTimeout(() => {
      if (!b.isConnected) return;
      b.textContent = b.dataset.label;
      b.classList.remove('ask');
      delete b.dataset.ask;
    }, 5000);
  };
}

function renderGuild() {
  const p = G.player;
  const g = p.guild;
  const box = $('guildBody');
  const key = g
    ? `${g.id}:${g.ver}:${guildOpenRow}:${guildEditNotice}`
    : `none:${guildFound}:${p.level >= GUILD_LVL}:${p.gold >= GUILD_COST}:${guildForm.emblem}:${guildForm.color}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = '';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const badge = (emblem, color) => {
    const b = el('span', 'gd-badge', GUILD_EMBLEMS[emblem] || '?');
    b.style.setProperty('--gc', GUILD_COLORS[color] || '#888');
    return b;
  };

  if (!g) {
    box.append(el('p', 'gd-intro', 'Un gremio reúne a tus amigos: tienen su propio chat (escribe @ antes del mensaje), su emblema bajo el nombre y no pueden atacarse entre ustedes.'));
    if (!guildFound) {
      box.append(el('p', 'muted', `Para fundar uno habla con el Maestro del Gremio en la Ciudadela de Gludio-Cubo (nivel ${GUILD_LVL} y ${GUILD_COST.toLocaleString('es')} de oro). También puedes unirte si un líder u oficial te invita.`));
      return;
    }
    const form = el('div', 'gd-form');
    const nameLab = el('label', 'gd-lab', 'Nombre del gremio');
    const name = el('input');
    name.id = 'guildName';
    name.maxLength = 18;
    name.placeholder = 'Ej.: Los Dragones';
    name.value = guildForm.name;
    name.autocomplete = 'off';
    name.oninput = () => {
      guildForm.name = name.value;
      prevName.textContent = name.value.trim() || 'Tu gremio';
    };
    name.addEventListener('keydown', (e) => e.stopPropagation());
    nameLab.append(name);
    const emb = el('div', 'gd-pick');
    GUILD_EMBLEMS.forEach((e, i) => {
      const b = el('button', i === guildForm.emblem ? 'on' : '', e);
      b.type = 'button';
      b.setAttribute('aria-label', `Emblema ${i + 1}`);
      b.onclick = () => {
        guildForm.emblem = i;
        renderGuild();
      };
      emb.append(b);
    });
    const col = el('div', 'gd-pick gd-colors');
    GUILD_COLORS.forEach((c, i) => {
      const b = el('button', i === guildForm.color ? 'on' : '');
      b.type = 'button';
      b.style.background = c;
      b.setAttribute('aria-label', `Color ${i + 1}`);
      b.onclick = () => {
        guildForm.color = i;
        renderGuild();
      };
      col.append(b);
    });
    const prev = el('div', 'gd-prev');
    const prevName = el('strong', '', guildForm.name.trim() || 'Tu gremio');
    prevName.style.color = GUILD_COLORS[guildForm.color];
    prev.append(badge(guildForm.emblem, guildForm.color), prevName);
    const okLvl = p.level >= GUILD_LVL;
    const okGold = p.gold >= GUILD_COST;
    const req = el('p', 'gd-req');
    req.append(el('span', okLvl ? 'ok' : 'no', `${okLvl ? '✔' : '✘'} Nivel ${GUILD_LVL}`), el('span', okGold ? 'ok' : 'no', `${okGold ? '✔' : '✘'} ${GUILD_COST.toLocaleString('es')} oro`));
    const go = el('button', 'buy', 'Fundar gremio');
    go.type = 'button';
    go.disabled = !okLvl || !okGold;
    go.onclick = () => V.Game.guild.create(name.value, guildForm.emblem, guildForm.color);
    form.append(nameLab, el('div', 'gd-lab', 'Emblema'), emb, el('div', 'gd-lab', 'Color'), col, prev, req, go);
    box.append(form);
    return;
  }

  // Con gremio: cabecera, mensaje, miembros, invitar y salir
  const head = el('div', 'gd-head');
  const t = el('div');
  const nm = el('strong', '', g.name);
  nm.style.color = GUILD_COLORS[g.color];
  const online = g.members.filter((m) => m.online).length;
  t.append(nm, el('small', '', `${g.members.length}/${g.max} miembros · ${online} conectados · Tu rango: ${GUILD_RANKS[g.rank]}`));
  head.append(badge(g.emblem, g.color), t);
  box.append(head);

  const nb = el('div', 'gd-notice');
  if (guildEditNotice) {
    const ta = el('textarea');
    ta.maxLength = 140;
    ta.rows = 2;
    ta.value = g.notice;
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    const save = el('button', 'buy', 'Guardar');
    save.type = 'button';
    save.onclick = () => {
      V.Game.guild.notice(ta.value);
      guildEditNotice = false;
      renderGuild();
    };
    nb.append(ta, save);
  } else {
    nb.append(el('p', g.notice ? '' : 'muted', g.notice || 'Sin mensaje del gremio.'));
    if (g.rank >= 1) {
      const ed = el('button', 'gd-mini', 'Editar');
      ed.type = 'button';
      ed.onclick = () => {
        guildEditNotice = true;
        renderGuild();
      };
      nb.append(ed);
    }
  }
  box.append(nb);

  const list = el('ul', 'gd-list');
  const sorted = [...g.members].sort((a, b) => b.online - a.online || b.rank - a.rank || b.level - a.level || a.name.localeCompare(b.name));
  const meKey = p.name.toLowerCase();
  for (const m of sorted) {
    const li = el('li', `gd-m${m.online ? ' on' : ''}${guildOpenRow === m.key ? ' open' : ''}`);
    const row = el('button', 'gd-row');
    row.type = 'button';
    row.append(el('i', 'gd-dot'), el('span', 'gd-nm', m.name), el('small', '', `Nv ${m.level} · ${raceName(m.cls, m.sex)}`), el('em', `gd-rk r${m.rank}`, GUILD_RANKS[m.rank]));
    li.append(row);
    // Acciones posibles sobre este miembro
    const acts = [];
    if (m.key !== meKey) {
      if (g.rank === 2) {
        const r = el('button', '', m.rank === 1 ? 'Quitar oficial' : 'Nombrar oficial');
        r.onclick = () => V.Game.guild.rank(m.key, m.rank === 1 ? 0 : 1);
        acts.push(r);
        const l = el('button', '', 'Hacer líder');
        confirmBtn(l, '¿Seguro? Toca otra vez', () => V.Game.guild.leader(m.key));
        acts.push(l);
      }
      if (g.rank >= 1 && m.rank < g.rank) {
        const k = el('button', 'warn', 'Expulsar');
        confirmBtn(k, '¿Expulsar? Toca otra vez', () => V.Game.guild.kick(m.key));
        acts.push(k);
      }
    }
    if (acts.length) {
      row.onclick = () => {
        guildOpenRow = guildOpenRow === m.key ? null : m.key;
        renderGuild();
      };
      if (guildOpenRow === m.key) {
        const a = el('div', 'gd-acts');
        for (const b of acts) {
          b.type = 'button';
          a.append(b);
        }
        li.append(a);
      }
    } else row.classList.add('static');
    list.append(li);
  }
  box.append(list);

  if (g.rank >= 1) {
    const inv = el('div', 'gd-inv');
    const who = el('input');
    who.placeholder = 'Nombre del jugador';
    who.maxLength = 16;
    who.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && who.value.trim()) {
        V.Game.guild.inviteByName(who.value.trim());
        who.value = '';
      }
    });
    const b = el('button', 'buy', 'Invitar');
    b.type = 'button';
    b.onclick = () => {
      if (!who.value.trim()) return;
      V.Game.guild.inviteByName(who.value.trim());
      who.value = '';
    };
    inv.append(who, b);
    box.append(inv, el('p', 'hint', 'También puedes elegir a un jugador y tocar «Invitar al gremio» en su ficha. Escribe @ antes de un mensaje para hablar con el gremio.'));
  } else box.append(el('p', 'hint', 'Escribe @ antes de un mensaje para hablar con el gremio.'));

  const foot = el('div', 'gd-foot');
  if (g.rank === 2) {
    const d = el('button', 'warn', 'Disolver gremio');
    d.type = 'button';
    confirmBtn(d, '¿Disolver para siempre? Toca otra vez', () => V.Game.guild.disband());
    foot.append(d);
  }
  if (g.rank < 2 || g.members.length === 1) {
    const lv = el('button', 'warn', 'Salir del gremio');
    lv.type = 'button';
    confirmBtn(lv, '¿Salir? Toca otra vez', () => V.Game.guild.leave());
    foot.append(lv);
  }
  box.append(foot);
}

function showGuildInvite(ev) {
  $('guildInviteText').textContent = `${ev.name} te invita a su gremio ${ev.emblem} ${ev.guild}.`;
  $('guildInviteText').style.setProperty('--gc', ev.color || '');
  $('guildInvitePanel').hidden = false;
  clearTimeout(showGuildInvite.t);
  showGuildInvite.t = setTimeout(() => !$('guildInvitePanel').hidden && answerGuild(false), 28000);
}
function answerGuild(accept) {
  $('guildInvitePanel').hidden = true;
  V.Game.guild.answer(accept);
}

function renderQuests() {
  const p = G.player;
  const list = $('questList');
  const guide = V.Guide && V.Guide.objective ? V.Guide.objective(p) : null;
  const q = p.quest;
  const key = `${p.level}|${p.stage}|${p.branch}|${q ? `${q.stage}:${q.kills}:${q.branch}` : '-'}|${p.pet ? 1 : 0}|${guide ? guide.text : ''}`;
  if (list.dataset.key === key) return; // solo se redibuja si algo cambió
  list.dataset.key = key;
  list.innerHTML = '';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const section = (title) => {
    const s = el('section', 'q-sec');
    s.append(el('h3', '', title));
    list.append(s);
    return s;
  };
  const tag = (text, kind) => el('span', `q-tag ${kind || ''}`, text);

  // 1) Misión de clase (Maestro Aldric)
  const sec = section('Misión de clase');
  const card = el('div', 'qc');
  sec.append(card);
  const next = STAGES[(p.stage || 0) + 1];
  if (q) {
    const def = questFor(q.stage);
    const st = STAGES[q.stage];
    const done = def && q.kills >= def.need;
    card.classList.add(done ? 'done' : 'active');
    const head = el('div', 'qt', def ? def.title : st.name);
    head.append(el('small', '', `${st.name} · nivel ${st.lvl}`), tag(done ? '¡Cumplida!' : 'En curso', done ? 'ok' : 'go'));
    card.append(head);
    if (q.branch) card.append(el('p', 'muted', `Especialización elegida: ${CLASSES[p.cls].branches[q.branch].name}`));
    if (def) {
      card.append(el('p', '', def.text));
      card.append(questBar(q.kills, def.need, `${q.kills} / ${def.need}`));
    }
    card.append(el('p', '', done ? '➜ Vuelve con el Maestro Aldric en la aldea para completarla.' : guide ? `➜ Dónde: ${guide.text}` : ''));
    card.append(el('p', 'muted', `Recompensa: ${st.unlocks}.`));
  } else if (next) {
    const def = questFor(next.stage);
    const ready = p.level >= next.lvl;
    if (ready) card.classList.add('active');
    const head = el('div', 'qt', def ? def.title : next.name);
    head.append(el('small', '', `${next.name} · nivel ${next.lvl}`), tag(ready ? 'Disponible' : `Nivel ${next.lvl}`, ready ? 'go' : ''));
    card.append(head);
    card.append(el('p', '', ready ? '➜ Habla con el Maestro Aldric en la aldea para comenzarla.' : `Se desbloquea al llegar al nivel ${next.lvl}.`));
    if (!ready) card.append(questBar(p.level, next.lvl, `Nivel ${p.level} / ${next.lvl}`));
    if (def) card.append(el('p', 'muted', `Misión: ${def.text}`));
    card.append(el('p', 'muted', `Recompensa: ${next.unlocks}.`));
  } else {
    card.classList.add('done');
    const head = el('div', 'qt', 'Maestría alcanzada');
    head.append(tag('Completo', 'ok'));
    card.append(head, el('p', '', 'Completaste todas las misiones de clase. ¡Eres un héroe de Valdoria!'));
  }

  // 2) Próximo paso (el mismo que marcan las flechas doradas)
  if (guide) {
    const s2 = section('Próximo paso');
    const c2 = el('div', 'qc');
    c2.append(el('p', '', `➜ ${guide.text}`));
    c2.append(el('p', 'muted', V.Guide.enabled ? 'Sigue las flechas doradas del suelo.' : 'Activa la Guía para ver flechas doradas en el suelo.'));
    s2.append(c2);
  }

  // 3) Camino del héroe: metas por nivel con su avance
  const s3 = section('Camino del héroe');
  const ul = el('ul', 'q-steps');
  s3.append(ul);
  const D = V.Data;
  const steps = [
    { name: 'Mascota', req: `Nivel ${D.PET_LVL}: recibe un huevo y hazlo eclosionar`, lvl: D.PET_LVL, done: !!p.pet, pending: 'Falta: abre el huevo desde el inventario' },
    { name: STAGES[1].name, req: `Nivel ${STAGES[1].lvl}: misión de clase con el Maestro Aldric`, lvl: STAGES[1].lvl, done: (p.stage || 0) >= 1, pending: 'Falta: completar la misión de clase' },
    { name: 'Montura', req: `Nivel ${D.MOUNT_LVL}: monta tu mascota (tecla 0)`, lvl: D.MOUNT_LVL, done: !!p.pet && p.level >= D.MOUNT_LVL, pending: 'Falta: tener una mascota' },
    { name: STAGES[2].name, req: `Nivel ${STAGES[2].lvl}: elige tu rama A o B`, lvl: STAGES[2].lvl, done: (p.stage || 0) >= 2, pending: 'Falta: completar la misión de clase' },
    { name: STAGES[3].name, req: `Nivel ${STAGES[3].lvl}: derrota al jefe más fuerte`, lvl: STAGES[3].lvl, done: (p.stage || 0) >= 3, pending: 'Falta: completar la misión de clase' },
    { name: 'Planeador', req: `Nivel ${D.GLIDER_LVL} con la ${STAGES[3].name}: vuela sobre el agua`, lvl: D.GLIDER_LVL, done: (p.stage || 0) >= 3 && !!p.pet && p.level >= D.GLIDER_LVL, pending: `Falta: la ${STAGES[3].name} y una mascota` },
    { name: 'Nivel máximo', req: `Llega al nivel ${MAX_LEVEL}`, lvl: MAX_LEVEL, done: p.level >= MAX_LEVEL },
  ];
  for (const st of steps) {
    const li = el('li', st.done ? 'ok' : '');
    const nm = el('span', 'nm', st.name);
    nm.append(el('small', '', st.req));
    li.append(el('span', 'ck', st.done ? '✔' : ''), nm);
    // Nivel alcanzado pero falta algo (misión de clase, huevo…): se dice qué falta
    const reached = p.level >= st.lvl;
    if (!st.done) li.append(questBar(Math.min(p.level, st.lvl), st.lvl, reached ? (st.pending || 'Nivel listo: falta completarlo') : `Nivel ${p.level} / ${st.lvl}`));
    else li.append(el('span', 'muted', '¡Logrado!'));
    ul.append(li);
  }
}

// ---------- Panel Estado: habilidades (lista compacta; al tocar una se ven sus detalles) ----------
const skOpen = new Set(); // habilidades desplegadas (se recuerdan mientras dura la partida)

function renderSkills() {
  const p = G.player;
  const list = $('skList');
  const key = `${p.cls}|${p.stage}|${p.branch}|${p.level}|${[...skOpen].join(',')}`;
  if (list.dataset.key === key) return; // solo cambia al subir de nivel, de clase o al desplegar
  list.dataset.key = key;
  list.innerHTML = '';
  const D = V.Data;
  const row = (id, glyph, keyLabel, name, badge, cls, details) => {
    const box = document.createElement('div');
    box.className = `skr ${cls || ''} ${skOpen.has(id) ? 'open' : ''}`;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-expanded', skOpen.has(id) ? 'true' : 'false');
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = glyph;
    if (keyLabel) {
      const k = document.createElement('b');
      k.textContent = keyLabel;
      ic.append(k);
    }
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = name;
    if (badge.pips) {
      const pips = document.createElement('span');
      pips.className = 'sk-pips';
      for (let i = 1; i <= badge.pips.max; i++) {
        const pip = document.createElement('i');
        if (i <= badge.pips.lvl) pip.className = 'on';
        pips.append(pip);
      }
      nm.append(pips);
    }
    const lv = document.createElement('span');
    lv.className = `sk-lv ${badge.cls || ''}`;
    lv.textContent = badge.text;
    b.append(ic, nm, lv);
    b.onclick = () => {
      if (skOpen.has(id)) skOpen.delete(id);
      else skOpen.add(id);
      renderSkills();
    };
    box.append(b);
    if (skOpen.has(id)) {
      const more = document.createElement('div');
      more.className = 'sk-more';
      for (const [text, muted] of details) {
        const pEl = document.createElement('p');
        if (muted) pEl.className = 'muted';
        pEl.textContent = text;
        more.append(pEl);
      }
      box.append(more);
    }
    list.append(box);
  };
  const pas = passiveFor(p.cls, p.stage, p.branch);
  if (pas) row('pasiva', '✧', '', pas.name, { text: 'Pasiva', cls: 'max' }, 'passive', [[pas.desc || ''], ['Siempre activa.', true]]);
  p.skills.forEach((s, i) => {
    const lock = skillLock(p, s);
    const lvl = D.skillLevel(p, s);
    const max = D.skillMaxLevel(s);
    const next = D.skillNextAt(p, s);
    const req = s.stage ? `${STAGES[s.stage].name} · nivel ${s.lvl}` : `nivel ${s.lvl}`;
    const details = [[s.desc || '']];
    if (!s.locked) {
      const shown = Math.max(1, lvl);
      const bonus = Math.round((D.skillPower(shown) - 1) * 100);
      details.push([`Maná ${D.skillMp(s, shown)} · recarga ${s.cd} s${bonus ? ` · poder +${bonus}%` : ''}`]);
      if (lock) details.push([lock === 'Cambio de clase' ? `Se desbloquea con el ${STAGES[s.stage].name} (Maestro Aldric).` : `Se desbloquea en el ${req}.`, true]);
      else details.push([next ? `Sube a Nv ${lvl + 1} al llegar a nivel ${next}.` : 'Nivel máximo alcanzado.', true]);
    }
    const badge = lock ? { text: lock === 'Cambio de clase' ? 'Clase' : lock, cls: 'lock' } : { text: `Nv ${lvl}/${max}`, cls: lvl >= max ? 'max' : '', pips: { lvl, max } };
    row(s.id, s.glyph, String(i + 1), `${s.ultimate ? '★ ' : ''}${s.name}`, badge, `${lock ? 'locked' : ''} ${s.ultimate ? 'ult' : ''}`, details);
  });
}

function renderStats() {
  renderSkills();
  const p = G.player;
  const s = p.stats;
  $('stLvl').textContent = p.level;
  $('stName').textContent = p.name;
  $('stClass').textContent = `${className(p.cls, p.sex, p.stage, p.branch)} · Nivel ${p.level}`;
  const need = p.level >= MAX_LEVEL ? 0 : xpToNext(p.level);
  const buffed = (p.buffs || []).length > 0;
  const pas = passiveFor(p.cls, p.stage, p.branch);
  // Bloques de estadísticas: se ordenan en dos columnas para que la lista no sea tan larga
  const blocks = [
    ['Personaje', [
      ['Raza', raceName(p.cls, p.sex)],
      ['Etapa', `${STAGES[p.stage].name}${p.branch ? ` · Rama ${p.branch.toUpperCase()}` : ''}`],
      ['Pasiva', pas ? pas.name : 'Nivel 25'],
      ['PvP / PK', `${p.pvp || 0} / ${p.pk || 0}`],
      ['Karma', p.karma ? `${p.karma} (nombre rojo)` : p.flagT ? `0 · morado ${p.flagT} s` : '0'],
    ]],
    ['Vida y maná', [
      ['Vida', `${Math.round(p.hp)} / ${s.maxHp}`],
      ['Maná', `${Math.round(p.mp)} / ${s.maxMp}`],
      ['Experiencia', need ? `${Math.floor((p.xp / need) * 100)}%` : 'Máx.'],
    ]],
    ['Ataque', [
      ['Ataque', Math.round(s.atk), buffed],
      ['Crítico', `${(s.crit * 100).toFixed(1)}%`],
      ['Daño crítico', `×${(s.critMult || 1.8).toFixed(1)}`],
      ['Vel. ataque', `${(1 / s.atkSpeed).toFixed(2)}/s`, buffed],
      ['Alcance', s.range > 3 ? `${s.range} m` : 'Cuerpo a cuerpo'],
    ]],
    ['Defensa', [
      ['Defensa', Math.round(s.def)],
      ['Esquivar', `${Math.round((s.evade || 0) * 100)}%`],
      ['Bloqueo', s.block ? `${Math.round(s.block * 100)}%` : '—'],
      ['Daño recibido', s.dr ? `−${Math.round(s.dr * 100)}%` : 'Normal', !!s.dr],
      ['Curación', `${Math.round((s.heal || 1) * 100)}%`],
    ]],
    ['Equipo y movimiento', [
      ['Arma', p.equip.weapon ? ITEMS[p.equip.weapon].name : 'Ninguna'],
      ['Armadura', p.equip.armor ? ITEMS[p.equip.armor].name : 'Ninguna'],
      ['Velocidad', `${(s.speed || 7.2).toFixed(1)} m/s${p.swimming ? ' (nadando)' : ''}`, buffed],
      ['Oro', p.gold.toLocaleString('es')],
    ], 'wide'],
  ];
  const box = $('statList');
  box.innerHTML = '';
  for (const [title, rows, cls] of blocks) {
    const b = document.createElement('section');
    b.className = `st-block ${cls || ''}`;
    const h = document.createElement('h4');
    h.textContent = title;
    const dl = document.createElement('dl');
    dl.className = 'st-grid';
    for (const [k, val, up] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = val;
      if (up) dd.classList.add('up');
      dl.append(dt, dd);
    }
    b.append(h, dl);
    box.append(b);
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
  return G.world.npcs.some((n) => n.role === 'master' && Math.hypot(G.player.pos.x - n.root.position.x, G.player.pos.z - n.root.position.z) < 8);
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
  initUI, notify, createNameplate, refreshNameplate, addPlayerPlate, removePlayerPlate, chat, focusChat,
  floatText, log, logLoot, banner, showDeath, showInvite, openDrops, openGuild, guildChanged, showGuildInvite,
  togglePanel, shopOpen, openShop, closeAll, refreshPanels, updateUI, openTrade,
  classChanged, openMaster, refreshMaster, openHatch,
};
})();
