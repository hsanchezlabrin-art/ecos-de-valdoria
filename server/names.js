// Registro de nombres de personajes: un nombre pertenece a quien lo usó primero.
//
// Cuando un personaje entra en línea por primera vez, su nombre queda reservado y el
// servidor le entrega una "llave" secreta que el juego guarda junto al personaje. Para
// volver a entrar con ese nombre hay que presentar la llave. Se guarda solo el hash.
// En la Fase 3 (cuentas) este registro pasará a la base de datos.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'names.json');
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const key = (name) => name.toLowerCase();

let names = {};
try {
  names = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  names = {};
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(names));
      fs.renameSync(tmp, FILE); // escritura atómica
    } catch (e) {
      console.error('[nombres] no se pudo guardar el registro:', e.message);
    }
  }, 200);
}

const isTaken = (name) => Object.prototype.hasOwnProperty.call(names, key(name));

// Devuelve { ok, token? }: token solo cuando el nombre se registra por primera vez.
function claim(name, token, cls) {
  const k = key(name);
  const entry = Object.prototype.hasOwnProperty.call(names, k) ? names[k] : null;
  if (entry) {
    if (token && entry.hash === hash(token)) {
      entry.seen = Date.now();
      persist();
      return { ok: true };
    }
    return { ok: false };
  }
  const fresh = crypto.randomBytes(24).toString('base64url');
  names[k] = { name, cls, hash: hash(fresh), created: Date.now(), seen: Date.now() };
  persist();
  return { ok: true, token: fresh };
}

const count = () => Object.keys(names).length;

module.exports = { isTaken, claim, count, DIR };
