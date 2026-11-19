// Cuentas y personajes de Ecos de Valdoria.
//
// Se guardan en un archivo JSON en el disco persistente de Fly.io (DATA_DIR). Las
// contraseñas se guardan con scrypt (sal propia por cuenta) y las sesiones solo como
// hash: si alguien copiara el archivo, no podría entrar con esos datos.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');
const MAX_CHARS = 7;
const MAX_SESSIONS = 5;
const SESSION_DAYS = 30;
const RESERVED = ['orlen', 'ilwen', 'brisa', 'tharmok', 'admin', 'gm', 'sistema', 'valdoria'];

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Date.now();

let db = { accounts: {}, chars: {}, names: {}, nextChar: 1, guilds: [] };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch {
  /* primera vez */
}
// Con las cuentas se borran todos los personajes anteriores (registro de nombres de la v0.3)
try {
  fs.rmSync(path.join(DIR, 'names.json'), { force: true });
} catch {
  /* nada */
}

let timer = null;
function persist(immediate = false) {
  clearTimeout(timer);
  const write = () => {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, FILE); // escritura atómica
    } catch (e) {
      console.error('[db] no se pudo guardar:', e.message);
    }
  };
  if (immediate) write();
  else timer = setTimeout(write, 300);
}

const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

// ---------- Validaciones ----------

const USER_RE = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,24}$/;

function checkAccountInput(user, email, pass) {
  if (!USER_RE.test(user || '')) return 'El ID debe tener de 3 a 16 caracteres: letras, números o guion bajo.';
  if (email !== undefined && (!EMAIL_RE.test(email || '') || email.length > 120)) return 'Escribe un correo válido.';
  if (typeof pass !== 'string' || pass.length < 6 || pass.length > 72) return 'La contraseña debe tener entre 6 y 72 caracteres.';
  return null;
}

function cleanCharName(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f<>"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}

function checkCharName(name) {
  if (name.length < 3) return 'El nombre debe tener al menos 3 caracteres.';
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ]*$/.test(name)) return 'El nombre solo puede tener letras, números y espacios, y empezar con una letra.';
  if (RESERVED.includes(name.toLowerCase())) return 'Ese nombre está reservado.';
  if (own(db.names, name.toLowerCase())) return `El nombre «${name}» ya pertenece a otro personaje.`;
  return null;
}

// ---------- Cuentas y sesiones ----------

function hashPass(pass, salt) {
  return crypto.scryptSync(pass, salt, 64).toString('hex');
}

function newSession(acc) {
  const token = crypto.randomBytes(32).toString('base64url');
  acc.sessions = (acc.sessions || []).filter((s) => s.exp > now()).slice(-(MAX_SESSIONS - 1));
  acc.sessions.push({ hash: sha(token), exp: now() + SESSION_DAYS * 864e5 });
  persist();
  return token;
}

function register(user, email, pass) {
  const err = checkAccountInput(user, email, pass);
  if (err) return { ok: false, error: err };
  const key = user.toLowerCase();
  if (own(db.accounts, key)) return { ok: false, error: 'Ese ID ya está en uso. Elige otro.' };
  const mail = email.trim().toLowerCase();
  if (Object.values(db.accounts).some((a) => a.email === mail)) return { ok: false, error: 'Ya existe una cuenta con ese correo.' };
  const salt = crypto.randomBytes(16).toString('hex');
  const acc = { user, email: mail, salt, hash: hashPass(pass, salt), created: now(), chars: [], sessions: [] };
  db.accounts[key] = acc;
  const session = newSession(acc);
  persist(true);
  return { ok: true, acc, session };
}

function login(user, pass) {
  const key = String(user || '').toLowerCase();
  const acc = own(db.accounts, key) ? db.accounts[key] : null;
  // Mismo mensaje si no existe o si la contraseña es incorrecta
  if (!acc || typeof pass !== 'string') return { ok: false, error: 'ID o contraseña incorrectos.' };
  const h = hashPass(pass, acc.salt);
  if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(acc.hash, 'hex'))) return { ok: false, error: 'ID o contraseña incorrectos.' };
  acc.lastLogin = now();
  return { ok: true, acc, session: newSession(acc) };
}

function resume(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const h = sha(token);
  for (const acc of Object.values(db.accounts)) {
    if ((acc.sessions || []).some((s) => s.hash === h && s.exp > now())) {
      acc.lastLogin = now();
      return acc;
    }
  }
  return null;
}

function logout(acc, token) {
  if (!acc || typeof token !== 'string') return;
  const h = sha(token);
  acc.sessions = (acc.sessions || []).filter((s) => s.hash !== h);
  persist();
}

// ---------- Personajes ----------

const summary = (c) => ({ id: c.id, name: c.name, cls: c.cls, sex: c.sex, level: c.data.level, stage: c.data.stage || 0, branch: c.data.branch || null, equip: c.data.equip, created: c.created, last: c.last || null });

function listChars(acc) {
  return acc.chars.map((id) => db.chars[id]).filter(Boolean).map(summary);
}

function createChar(acc, name, cls, sex, data) {
  if (acc.chars.length >= MAX_CHARS) return { ok: false, error: `Puedes tener hasta ${MAX_CHARS} personajes por cuenta.` };
  const clean = cleanCharName(name);
  const err = checkCharName(clean);
  if (err) return { ok: false, error: err };
  const id = `c${db.nextChar++}`;
  db.chars[id] = { id, account: acc.user.toLowerCase(), name: clean, cls, sex, created: now(), data: { ...data, name: clean, cls, sex } };
  db.names[clean.toLowerCase()] = id;
  acc.chars.push(id);
  persist(true);
  return { ok: true, char: summary(db.chars[id]) };
}

function deleteChar(acc, id) {
  if (!acc.chars.includes(id) || !own(db.chars, id)) return { ok: false, error: 'Ese personaje no existe.' };
  const c = db.chars[id];
  delete db.names[c.name.toLowerCase()];
  delete db.chars[id];
  acc.chars = acc.chars.filter((x) => x !== id);
  persist(true);
  return { ok: true };
}

function getChar(acc, id) {
  if (!acc || !acc.chars.includes(id) || !own(db.chars, id)) return null;
  return db.chars[id];
}

function saveChar(id, data) {
  if (!own(db.chars, id)) return;
  const c = db.chars[id];
  c.data = { ...data, name: c.name, cls: c.cls, sex: c.sex };
  c.last = now();
  persist();
}

const nameAvailable = (name) => {
  const clean = cleanCharName(name);
  return clean.length >= 3 && !checkCharName(clean);
};

const counts = () => ({ accounts: Object.keys(db.accounts).length, characters: Object.keys(db.chars).length });

// Convierte los personajes guardados con un formato antiguo. fn(cls, data) → { cls, data, migrated }
function migrateChars(fn) {
  let n = 0;
  for (const c of Object.values(db.chars)) {
    const r = fn(c.cls, c.data);
    if (!r || !r.migrated) continue;
    c.cls = r.cls;
    c.data = { ...r.data, name: c.name, cls: r.cls, sex: c.sex };
    n++;
  }
  if (n) persist(true);
  return n;
}

// Silenciar una cuenta hasta cierta hora (0 = quitar). Se guarda en el disco.
function setMute(user, until) {
  const key = String(user || '').toLowerCase();
  if (!own(db.accounts, key)) return false;
  db.accounts[key].mutedUntil = until || 0;
  persist();
  return true;
}

// ---------- Administración ----------

// Cuentas para el panel (sin datos de contraseña ni sesiones)
function listAccounts(q = '', limit = 200) {
  const s = String(q || '').toLowerCase().trim();
  const out = [];
  for (const [key, a] of Object.entries(db.accounts)) {
    const chars = listChars(a);
    if (s && !key.includes(s) && !(a.email || '').includes(s) && !chars.some((c) => c.name.toLowerCase().includes(s))) continue;
    out.push({ user: a.user, email: a.email, created: a.created, lastLogin: a.lastLogin || null, chars: chars.map((c) => ({ name: c.name, cls: c.cls, level: c.level, last: c.last })) });
  }
  out.sort((x, y) => (y.lastLogin || y.created) - (x.lastLogin || x.created));
  return { total: out.length, accounts: out.slice(0, limit) };
}

// Borra una cuenta con todos sus personajes (libera sus nombres)
function deleteAccount(user) {
  const key = String(user || '').toLowerCase();
  if (!own(db.accounts, key)) return { ok: false, error: 'Esa cuenta no existe.' };
  for (const id of db.accounts[key].chars) {
    if (!own(db.chars, id)) continue;
    delete db.names[db.chars[id].name.toLowerCase()];
    delete db.chars[id];
  }
  delete db.accounts[key];
  persist(true);
  return { ok: true };
}

// Gremios: lista completa (la simulación es la fuente de verdad mientras el servidor corre)
const loadGuilds = () => (Array.isArray(db.guilds) ? db.guilds : []);
function saveGuilds(list) {
  db.guilds = list;
  persist();
}
const hasName = (name) => own(db.names, String(name || '').toLowerCase());

module.exports = { loadGuilds, saveGuilds, hasName, register, login, resume, logout, listChars, createChar, deleteChar, getChar, saveChar, nameAvailable, counts, listAccounts, deleteAccount, migrateChars, setMute, flush: () => persist(true), MAX_CHARS, DIR };
