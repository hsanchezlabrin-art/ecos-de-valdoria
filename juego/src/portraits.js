// Retratos vóxel de cada raza y emblema de Ecos de Valdoria, dibujados como SVG de píxeles.
// Los usan el selector de personajes, el marco del jugador, la pantalla de carga y la web.
// Cada retrato es una cuadrícula de 12×12: cada letra es un color de la paleta y «.» es vacío.
(function () {
  const V = (globalThis.V = globalThis.V || {});

  const PALS = {
    oso: { d: '#5e3a1a', b: '#9a6232', e: '#d99a6a', m: '#e8c69a', k: '#1b1209', w: '#ffffff' },
    elfo: { G: '#2b7a20', g: '#4fae34', s: '#f4c99c', S: '#dba272', k: '#1e3a14', w: '#ffffff', c: '#f29a86', m: '#9a4a2a', o: '#c98a3a', t: '#4f8a2e' },
    gnomo: { h: '#e0483c', H: '#a8302a', y: '#ffc83d', l: '#8fdcff', s: '#f6cfa6', S: '#dca27a', k: '#2a1a0a', n: '#f39a7e', w: '#f6f3ec', W: '#d6cfc0' },
    hada: { P: '#c76fa8', p: '#f6b8dc', e: '#ffe0f0', k: '#4a2a6a', w: '#ffffff', c: '#ff8fb8', n: '#ff6f9f', m: '#a04070' },
    lagarto: { h: '#f6f1e2', D: '#2f8a22', L: '#62c63e', Y: '#ffd23a', k: '#13240c', w: '#ffffff', y: '#e9e48c' },
  };
  const GRIDS = {
    oso: [
      '.dd......dd.',
      'deedbbbbdeed',
      'dbbbbbbbbbbd',
      'bbbbbbbbbbbb',
      'bbwkbbbbwkbb',
      'bbkkbbbbkkbb',
      'bbbbmmmmbbbb',
      'bbbmmkkmmbbb',
      'bbbmmmmmmbbb',
      'dbbbmmmmbbbd',
      '.dbbbbbbbbd.',
      '..dddddddd..',
    ],
    elfo: [
      '...GgggggG..',
      '..GgggggggG.',
      '.GgggGgggggG',
      '.GgssgsssggG',
      'SSsGGssGGsSS',
      '.SswksswksS.',
      '..cssssssc..',
      '..sssmmsss..',
      '...ssssss...',
      '....ssss....',
      '..oooooooo..',
      '..tttttttt..',
    ],
    gnomo: [
      '.....hh.....',
      '....hhhh....',
      '...hhhhhh...',
      '..HHHHHHHH..',
      '.HylyHHylyH.',
      '..ssssssss..',
      '..skssssks..',
      '.SsssnnsssS.',
      '.wwwwnnwwww.',
      '.wwwwwwwwww.',
      '..wwwWWwww..',
      '...wwwwww...',
    ],
    hada: [
      '.P........P.',
      '.PP......PP.',
      '.PeP....PeP.',
      '.PepPPPPpeP.',
      'PppppppppppP',
      'PpwkppppwkpP',
      'PpkkppppkkpP',
      'PcpppnnpppcP',
      '.ppppmmpppp.',
      '..pppppppp..',
      '...PPPPPP...',
      '............',
    ],
    lagarto: [
      '.h........h.',
      '.hD......Dh.',
      '..DDLLLLDD..',
      '.DLLLLLLLLD.',
      'DLYkLLLLkYLD',
      'DLYYLLLLYYLD',
      'DLLLLLLLLLLD',
      'DLLLkLLkLLLD',
      'DLLLLLLLLLLD',
      '.DwkkkkkkwD.',
      '.DyyyyyyyyD.',
      '..DDDDDDDD..',
    ],
  };
  // Fondo de cada raza (degradado dentro del círculo)
  const BG = {
    oso: ['#f3c98a', '#c9813d'],
    elfo: ['#a6e37a', '#3f8f2a'],
    gnomo: ['#9fd8ff', '#3a7fd0'],
    hada: ['#f6c6ff', '#a45ad0'],
    lagarto: ['#c9f27a', '#4f9a24'],
  };

  // Rectángulos de la cuadrícula (se juntan los píxeles iguales de cada fila)
  function pixels(cls, ox, oy, size) {
    const grid = GRIDS[cls] || GRIDS.elfo;
    const pal = PALS[cls] || PALS.elfo;
    const px = size / 12;
    let out = '';
    grid.forEach((row, y) => {
      let x = 0;
      while (x < 12) {
        const ch = row[x];
        let n = 1;
        while (x + n < 12 && row[x + n] === ch) n++;
        if (ch !== '.' && pal[ch]) out += `<rect x="${(ox + x * px).toFixed(2)}" y="${(oy + y * px).toFixed(2)}" width="${(n * px + 0.05).toFixed(2)}" height="${(px + 0.05).toFixed(2)}" fill="${pal[ch]}"/>`;
        x += n;
      }
    });
    return out;
  }

  let uid = 0;
  // Retrato redondo de una raza (para listas y el marco del jugador)
  function portrait(cls) {
    const id = `pt${++uid}`;
    const bg = BG[cls] || BG.elfo;
    return (
      `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true">` +
      `<defs><radialGradient id="${id}" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient></defs>` +
      `<rect width="64" height="64" rx="10" fill="url(#${id})"/>` +
      `<rect x="0" y="50" width="64" height="14" fill="rgba(0,0,0,.12)"/>` +
      pixels(cls, 8, 9, 48) +
      `</svg>`
    );
  }

  // Emblema: anillo dorado con corona, bosque, cabeza vóxel de elfo y estrella azul.
  // simple = versión para íconos pequeños (sin corona ni remaches).
  function emblem(simple) {
    const crown = simple
      ? ''
      : `<path d="M44 20 L50 6 L57 15 L64 2 L71 15 L78 6 L84 20 Z" fill="#ffc83d" stroke="#6e3f0c" stroke-width="3" stroke-linejoin="round"/>` +
        `<path d="M48 18 L51 10 L56 17 Z M72 17 L77 10 L80 18 Z" fill="#ffe58a"/>`;
    const rivets = simple
      ? ''
      : [45, 135, 225, 315]
          .map((a) => {
            const r = (a * Math.PI) / 180;
            const x = 64 + Math.cos(r) * 52;
            const y = 68 + Math.sin(r) * 52;
            return `<rect x="${(x - 7).toFixed(1)}" y="${(y - 7).toFixed(1)}" width="14" height="14" rx="2" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})" fill="#ffc83d" stroke="#6e3f0c" stroke-width="2.5"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="#8a5a1a"/>`;
          })
          .join('');
    const cy = simple ? 64 : 68;
    const R = simple ? 60 : 54;
    return (
      `<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
      `<defs>` +
      `<linearGradient id="emRing" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe58a"/><stop offset=".5" stop-color="#ffc83d"/><stop offset="1" stop-color="#d98a12"/></linearGradient>` +
      `<radialGradient id="emIn" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#3f8a35"/><stop offset="1" stop-color="#173d1a"/></radialGradient>` +
      `<linearGradient id="emStar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bff4ff"/><stop offset=".5" stop-color="#3fb4ff"/><stop offset="1" stop-color="#1f5fd6"/></linearGradient>` +
      `<clipPath id="emClip"><circle cx="64" cy="${cy}" r="${R - 9}"/></clipPath>` +
      `</defs>` +
      crown +
      `<circle cx="64" cy="${cy}" r="${R}" fill="url(#emRing)" stroke="#6e3f0c" stroke-width="4"/>` +
      `<circle cx="64" cy="${cy}" r="${R - 9}" fill="url(#emIn)" stroke="#6e3f0c" stroke-width="3"/>` +
      `<g clip-path="url(#emClip)" shape-rendering="crispEdges">` +
      // Bosque de bloques al fondo
      `<rect x="10" y="${cy + 8}" width="108" height="60" fill="#2f6e28"/>` +
      `<rect x="14" y="${cy - 14}" width="16" height="22" fill="#24561f"/><rect x="98" y="${cy - 18}" width="18" height="26" fill="#24561f"/>` +
      `<rect x="22" y="${cy + 4}" width="12" height="8" fill="#5aa83a"/><rect x="94" y="${cy + 2}" width="14" height="10" fill="#5aa83a"/>` +
      pixels('elfo', 34, cy - 34, 60) +
      `</g>` +
      // Estrella azul de cuatro puntas
      `<g transform="translate(64 ${cy + (simple ? 34 : 40)})">` +
      `<path d="M0 -17 L5 -5 L17 0 L5 5 L0 17 L-5 5 L-17 0 L-5 -5 Z" fill="url(#emStar)" stroke="#ffc83d" stroke-width="3" stroke-linejoin="round"/>` +
      `<path d="M0 -10 L2.5 -2.5 L0 0 Z" fill="#ffffff" opacity=".8"/>` +
      `</g>` +
      rivets +
      `</svg>`
    );
  }

  // Imagen lista para <img src> o fondos CSS
  const dataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  // Rellena todos los elementos con data-portrait="raza" o data-emblem dentro de root
  function fill(root) {
    const r = root || document;
    r.querySelectorAll('[data-portrait]').forEach((el) => (el.innerHTML = portrait(el.dataset.portrait)));
    r.querySelectorAll('[data-emblem]').forEach((el) => (el.innerHTML = emblem(el.dataset.emblem === 'simple')));
  }

  V.Portraits = { portrait, emblem, dataUrl, fill, RACES: Object.keys(GRIDS) };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fill());
    else fill();
  }
})();
