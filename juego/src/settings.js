// Panel de Configuración: gráficos, imagen y sonido. Se abre desde la pantalla de inicio (antes de
// entrar) y dentro del juego (botón Ajustes o tecla O). Los valores los guarda y aplica V.Gfx.
(function () {
  const $ = (id) => document.getElementById(id);
  const panel = $('setPanel');
  if (!panel) return;

  const LABELS = {
    quality: { auto: 'Automática', baja: 'Baja', media: 'Media', alta: 'Alta', ultra: 'Ultra' },
    chars: { cerca: 'Cerca', medio: 'Medio', lejos: 'Lejos' },
    view: { cercana: 'Cercana', media: 'Media', lejana: 'Lejana' },
    fps: { 30: '30', 60: '60', 120: '120' },
    shadows: { true: 'Sí', false: 'No' },
  };
  const HELP = {
    quality: 'Automática ajusta la calidad sola según cómo rinde tu equipo.',
    chars: 'Hasta dónde se ven otros jugadores, monstruos y NPC.',
    view: 'Hasta dónde se ve el paisaje antes de la niebla.',
    fps: 'Menos cuadros por segundo gasta menos batería.',
    shadows: 'Sin sombras el juego va más rápido.',
  };

  // Tamaño de la interfaz (texto, botones y ventanas). Se guarda aparte de los gráficos.
  const UI_KEY = 'valdoria-ui-scale';
  const UI_SCALES = [
    [0.9, 'Pequeña'],
    [1, 'Normal'],
    [1.15, 'Grande'],
    [1.3, 'Muy grande'],
  ];
  let uiScale = 1;
  try {
    const v = Number(localStorage.getItem(UI_KEY));
    if (UI_SCALES.some(([s]) => s === v)) uiScale = v;
  } catch {
    /* sin almacenamiento */
  }
  const applyUiScale = () => document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  applyUiScale();
  function setUiScale(v) {
    uiScale = v;
    applyUiScale();
    try {
      localStorage.setItem(UI_KEY, String(v));
    } catch {
      /* sin almacenamiento */
    }
    sync();
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // Fila con botones de opción (una sola elegida)
  function choiceRow(key, title, options) {
    const row = el('div', 'set-row');
    const head = el('div', 'set-label');
    head.append(el('span', '', title));
    if (HELP[key]) head.append(el('small', '', HELP[key]));
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', title);
    for (const opt of options) {
      const b = el('button', '', LABELS[key][String(opt)]);
      b.type = 'button';
      b.dataset.key = key;
      b.dataset.value = String(opt);
      b.setAttribute('role', 'radio');
      b.onclick = () => V.Gfx.setSetting(key, key === 'fps' ? Number(opt) : key === 'shadows' ? opt === true : opt);
      seg.append(b);
    }
    row.append(head, seg);
    return row;
  }

  // Fila con deslizador (0–200 %)
  function rangeRow(key, title, suffix = '%') {
    const [min, max] = V.Gfx.RANGES[key];
    const row = el('div', 'set-row');
    const head = el('div', 'set-label');
    head.append(el('span', '', title));
    const out = el('output', 'set-val');
    out.dataset.key = key;
    head.append(out);
    const input = el('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = 1;
    input.dataset.key = key;
    input.setAttribute('aria-label', title);
    input.oninput = () => {
      out.textContent = `${input.value}${suffix}`;
      V.Gfx.setSetting(key, Number(input.value));
    };
    row.append(head, input);
    return row;
  }

  function build() {
    panel.innerHTML = '';
    const header = el('header');
    header.append(el('h2', '', 'Configuración'));
    const x = el('button', 'x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Cerrar');
    x.onclick = close;
    header.append(x);
    panel.append(header);

    const body = el('div', 'set-body');
    const sec = (title) => {
      const s = el('section', 'set-sec');
      s.append(el('h3', '', title));
      body.append(s);
      return s;
    };
    const maxIdx = V.Gfx.CHOICES.quality.indexOf(V.Gfx.maxQuality);
    const g = sec('Gráficos');
    g.append(
      choiceRow('quality', 'Calidad gráfica', V.Gfx.CHOICES.quality.slice(0, maxIdx + 1)),
      choiceRow('chars', 'Visibilidad de personajes', V.Gfx.CHOICES.chars),
      choiceRow('view', 'Distancia de visión', V.Gfx.CHOICES.view),
      choiceRow('fps', 'Límite de FPS', V.Gfx.CHOICES.fps),
      choiceRow('shadows', 'Sombras', [true, false])
    );
    const ui = sec('Interfaz');
    const row = el('div', 'set-row');
    const head = el('div', 'set-label');
    head.append(el('span', '', 'Tamaño de la interfaz'), el('small', '', 'Agranda el texto, los botones y las ventanas.'));
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Tamaño de la interfaz');
    for (const [v, name] of UI_SCALES) {
      const b = el('button', '', name);
      b.type = 'button';
      b.dataset.ui = String(v);
      b.setAttribute('role', 'radio');
      b.onclick = () => setUiScale(v);
      seg.append(b);
    }
    row.append(head, seg);
    ui.append(row);
    const im = sec('Imagen');
    im.append(rangeRow('brightness', 'Brillo'), rangeRow('gamma', 'Gamma'), rangeRow('contrast', 'Contraste'), rangeRow('saturation', 'Saturación'));
    const so = sec('Sonido');
    so.append(rangeRow('volMaster', 'Volumen general'), rangeRow('volMusic', 'Música'), rangeRow('volSfx', 'Efectos'));
    so.append(el('p', 'set-note', 'El juego todavía no tiene sonido: estos volúmenes quedan guardados para cuando llegue.'));
    panel.append(body);

    const foot = el('div', 'set-foot');
    const def = el('button', 'ghost', 'Valores por defecto');
    def.type = 'button';
    def.onclick = () => {
      setUiScale(1);
      V.Gfx.resetSettings();
    };
    const ok = el('button', 'btn', 'Listo');
    ok.type = 'button';
    ok.onclick = close;
    foot.append(def, ok);
    panel.append(foot);
  }

  // Marca lo elegido y mueve los deslizadores a los valores guardados
  function sync() {
    const s = V.Gfx.settings;
    panel.querySelectorAll('.seg button').forEach((b) => {
      const on = b.dataset.ui ? Number(b.dataset.ui) === uiScale : String(s[b.dataset.key]) === b.dataset.value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    panel.querySelectorAll('input[type=range]').forEach((i) => {
      if (Number(i.value) !== s[i.dataset.key]) i.value = s[i.dataset.key];
    });
    panel.querySelectorAll('output.set-val').forEach((o) => (o.textContent = `${s[o.dataset.key]}%`));
    // En Automática se muestra también el perfil que eligió el juego
    const auto = panel.querySelector('.seg button[data-key=quality][data-value=auto]');
    if (auto) auto.textContent = s.quality === 'auto' ? `Automática (${V.Gfx.preset().label})` : 'Automática';
  }

  function open() {
    if (!panel.childElementCount) build();
    sync();
    panel.hidden = false;
    const first = panel.querySelector('.seg button.on') || panel.querySelector('button');
    if (first) first.focus();
  }
  function close() {
    panel.hidden = true;
  }
  const toggle = () => (panel.hidden ? open() : close());

  addEventListener('valdoria-settings', () => {
    if (!panel.hidden) sync();
  });
  addEventListener('valdoria-gfx', () => {
    if (!panel.hidden) sync();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      e.stopPropagation();
      close();
    }
  }, true);

  const startBtn = $('btnSetStart');
  if (startBtn) startBtn.onclick = open;

  V.Settings = { open, close, toggle, get isOpen() { return !panel.hidden; } };
})();
