// Filtro del chat para un juego de niños (7 a 13 años).
//  · Datos personales (teléfonos, correos, enlaces, redes sociales, direcciones,
//    contraseñas): el mensaje NO se envía y se avisa a quien lo escribió.
//  · Palabrotas e insultos: se tapan con estrellas (★).
// Se normaliza el texto (tildes, mayúsculas, letras repetidas y trucos como "pvt4" o
// "p.u.t.a") para que sea difícil esquivar el filtro.

// Palabras que se tapan (se comparan ya normalizadas: sin tildes, en minúsculas)
const BAD = [
  // español
  'puta', 'puto', 'putas', 'putos', 'puteo', 'putear', 'mierda', 'mierdas', 'cabron', 'cabrona', 'cabrones', 'pendejo', 'pendeja', 'pendejos',
  'idiota', 'idiotas', 'imbecil', 'imbeciles', 'estupido', 'estupida', 'estupidos', 'tonto', 'tonta', 'tontos', 'tontas', 'bobo', 'boba',
  'tarado', 'tarada', 'retrasado', 'retrasada', 'mongolico', 'mongolica', 'subnormal', 'gilipollas', 'gilipolla', 'capullo', 'capulla',
  'joder', 'jodete', 'jodido', 'jodida', 'coño', 'cono', 'concha', 'conchetumare', 'conchesumadre', 'ctm', 'csm', 'qlo', 'culiao', 'culiado', 'culia',
  'weon', 'weona', 'huevon', 'huevona', 'guevon', 'aweonao', 'maricon', 'marica', 'maraco', 'maraca', 'perra', 'perras', 'zorra', 'zorras',
  'verga', 'vergas', 'pija', 'pico', 'raja', 'chucha', 'chupala', 'chupalo', 'mamon', 'mamona', 'malparido', 'malparida', 'hijueputa', 'hdp',
  'gonorrea', 'carajo', 'cojones', 'polla', 'pajero', 'pajera', 'paja', 'culo', 'culos', 'tetas', 'teta', 'sexo', 'porno', 'violar', 'violacion',
  'matate', 'suicidate', 'muerete', 'nazi', 'basura', 'asco', 'feo', 'fea', 'gordo', 'gorda', 'inutil', 'manco', 'noob', 'mrd', 'wn', 'ql',
  // inglés
  'fuck', 'fucking', 'fucker', 'shit', 'bitch', 'bitches', 'asshole', 'dick', 'cock', 'pussy', 'cunt', 'bastard', 'slut', 'whore', 'stupid',
  'idiot', 'retard', 'kys', 'nigger', 'nigga', 'faggot', 'fag', 'porn', 'sex', 'wtf', 'stfu',
];
// Raíces que se tapan aunque formen parte de una palabra más larga (ej. "putisimo")
const STEMS = ['put', 'mierd', 'cabron', 'pendej', 'idiot', 'imbecil', 'estupid', 'gilipoll', 'jod', 'conchetu', 'culia', 'weon', 'huevon', 'maric', 'verg', 'malparid', 'hijueput', 'fuck', 'shit', 'bitch', 'porn'];
// Raíces con falsos positivos frecuentes: solo cuentan al inicio de la palabra
const STEM_EXCEPT = ['computador', 'computadora', 'reputacion', 'disputa', 'diputado', 'imputar', 'jodhpur', 'conchita', 'picor', 'pichon', 'putumayo'];
const BAD_SET = new Set(BAD);

// Datos personales y contacto fuera del juego
const PERSONAL = [
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, // correo
  /(https?:\/\/|www\.)\S+/i, // enlace
  /\b[\w-]+\.(com|net|org|cl|ar|mx|es|co|pe|io|gg|me|tv|app|xyz)\b/i, // dominio
  /(\d[\s.\-()]*){6,}/, // 6 o más cifras: teléfono, RUT, dirección…
  /(^|\s)@[\w.]{3,}/, // usuario de redes (@nombre)
];
const PERSONAL_WORDS = [
  'whatsapp', 'whatsap', 'wsp', 'wasap', 'guasap', 'instagram', 'insta', 'tiktok', 'discord', 'snapchat', 'telegram', 'facebook', 'twitter',
  'telefono', 'celular', 'fono', 'direccion', 'calle', 'avenida', 'comuna', 'contrasena', 'password',
  'correo', 'gmail', 'hotmail', 'email', 'dondevives', 'vivoen', 'tarjeta', 'cuenta bancaria',
];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '¡': 'i', '!': 'i', '|': 'l', '+': 't' };

// Texto en minúsculas, sin tildes, sin trucos con números y sin letras repetidas
function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0-9@$¡!|+]/g, (ch) => LEET[ch] || ch)
    .replace(/(.)\1+/g, '$1');
}
const lettersOnly = (s) => norm(s).replace(/[^a-zñ]/g, '');

function isBadWord(w) {
  const n = lettersOnly(w);
  if (!n) return false;
  if (BAD_SET.has(n)) return true;
  if (STEM_EXCEPT.some((e) => n.startsWith(e))) return false;
  return STEMS.some((st) => n.startsWith(st) && n.length <= st.length + 6);
}

function hasPersonal(text) {
  if (PERSONAL.some((re) => re.test(text))) return true;
  const n = norm(text);
  const joined = n.replace(/[^a-zñ]/g, '');
  return PERSONAL_WORDS.some((raw) => {
    const w = norm(raw); // la lista también se normaliza (calle → cale, como el texto)
    const k = w.replace(/\s/g, '');
    // Palabra suelta (o escrita junta, como "dondevives")
    return new RegExp(`(^|[^a-zñ])${w}($|[^a-zñ])`).test(n) || (k.length >= 7 && joined.includes(k));
  });
}

// Devuelve { ok, text, censored, reason }. ok=false: el mensaje no se envía.
function filterChat(raw) {
  let text = String(raw || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (hasPersonal(text)) return { ok: false, reason: 'personal' };
  let censored = false;
  // Palabras separadas por espacios
  text = text.replace(/\S+/g, (w) => {
    if (!isBadWord(w)) return w;
    censored = true;
    return '★'.repeat(Math.min(6, Math.max(3, w.length)));
  });
  // Trucos con letras separadas ("p u t a", "p.u.t.a"): se revisa el texto sin espacios
  if (!censored) {
    const glued = lettersOnly(text);
    if (BAD.some((b) => b.length >= 4 && glued.includes(b) && !STEM_EXCEPT.some((e) => glued.includes(e)))) {
      const spaced = text.replace(/[^\s]/g, '').length > 0;
      if (spaced && /(\b\w\b[\s.\-_*]*){4,}/.test(text)) return { ok: true, text: '★★★', censored: true };
    }
  }
  // GRITOS: si casi todo está en mayúsculas, se pasa a minúsculas
  const letters = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  if (letters.length >= 8 && letters === letters.toUpperCase()) text = text.toLowerCase();
  return { ok: true, text, censored };
}

module.exports = { filterChat, norm };
