// Soporte para pantallas táctiles y modo web: pantalla completa, orientación horizontal,
// joystick virtual y zoom con dos dedos.
(function () {
  const G = V.G;
  const $ = (id) => document.getElementById(id);
  const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const isDesktopApp = !!window.desktop;
  const doc = document.documentElement;
  const canFullscreen = !isDesktopApp && !!(doc.requestFullscreen || doc.webkitRequestFullscreen);

  G.joy = null; // { x, y } entre -1 y 1 mientras se usa el joystick
  if (isTouch) document.body.classList.add('touch');

  // ---------- Pantalla completa ----------

  const inFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

  async function enterFullscreen() {
    if (!canFullscreen || inFullscreen()) return;
    try {
      if (doc.requestFullscreen) await doc.requestFullscreen({ navigationUI: 'hide' });
      else doc.webkitRequestFullscreen();
    } catch {
      /* el navegador lo rechazó */
    }
    // En celulares Android se puede fijar la orientación horizontal estando en pantalla completa
    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch {
      /* no soportado (iPhone, escritorio) */
    }
  }

  function exitFullscreen() {
    if (!inFullscreen()) return;
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }

  function toggleFullscreen() {
    if (inFullscreen()) exitFullscreen();
    else enterFullscreen();
  }

  function syncFsButton() {
    const b = $('btnFull');
    if (!b) return;
    b.hidden = !canFullscreen;
    b.firstChild.textContent = inFullscreen() ? 'Salir de pantalla completa ' : 'Pantalla completa ';
  }
  document.addEventListener('fullscreenchange', syncFsButton);
  document.addEventListener('webkitfullscreenchange', syncFsButton);

  // ---------- Joystick virtual ----------

  function initJoystick() {
    const pad = $('joystick');
    const knob = $('joyKnob');
    if (!pad) return;
    pad.hidden = false;
    let id = null;
    let cx = 0;
    let cy = 0;
    let radius = 46;

    const move = (e) => {
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      // La perilla se mueve en el espacio del joystick (que puede estar escalado)
      const k = pad.offsetWidth ? pad.offsetWidth / pad.getBoundingClientRect().width : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const amount = Math.min(1, len / radius);
      G.joy = amount < 0.18 ? null : { x: dx / radius, y: dy / radius };
    };
    // Soltar: deja de caminar pase lo que pase
    const end = () => {
      id = null;
      G.joy = null;
      knob.style.transform = '';
      pad.classList.remove('active');
    };

    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Un toque nuevo siempre manda (si quedó uno "fantasma", se reemplaza)
      id = e.pointerId;
      const r = pad.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      radius = r.width * 0.35;
      try {
        pad.setPointerCapture(id);
      } catch {
        /* sin captura: los avisos llegan igual a la ventana */
      }
      pad.classList.add('active');
      move(e);
    });
    // Se escucha en toda la ventana: si el dedo sale del círculo, igual se detecta al soltar
    addEventListener('pointermove', (e) => e.pointerId === id && move(e), { passive: true });
    addEventListener('pointerup', (e) => e.pointerId === id && end());
    addEventListener('pointercancel', (e) => e.pointerId === id && end());
    pad.addEventListener('lostpointercapture', (e) => e.pointerId === id && end());
    // Respaldo: sin dedos en la pantalla, el joystick siempre queda suelto
    addEventListener('touchend', (e) => e.touches.length === 0 && end(), { passive: true });
    addEventListener('touchcancel', (e) => e.touches.length === 0 && end(), { passive: true });
    // Si la app pasa a segundo plano o pierde el foco
    addEventListener('blur', end);
    addEventListener('pagehide', end);
    document.addEventListener('visibilitychange', () => document.hidden && end());
  }

  // ---------- Zoom con dos dedos ----------

  function initPinch(canvas) {
    let start = 0;
    let startDist = 0;
    const gap = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 2) {
          start = gap(e.touches);
          startDist = G.cam.dist;
          G.pinching = true;
        }
      },
      { passive: true }
    );
    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length !== 2 || !start) return;
        G.cam.dist = Math.min(32, Math.max(5, startDist * (start / gap(e.touches))));
      },
      { passive: true }
    );
    canvas.addEventListener(
      'touchend',
      (e) => {
        if (e.touches.length < 2) {
          start = 0;
          setTimeout(() => (G.pinching = false), 120);
        }
      },
      { passive: true }
    );
  }

  // Al entrar al mundo en un dispositivo táctil: joystick, zoom y pantalla completa persistente
  function initButtons() {
    const Game = V.Game;
    // Atacar: si no hay objetivo, elige el monstruo más cercano y lo ataca
    // Con un jugador elegido ataca a ese jugador (si es blanco, el servidor pide forzar el ataque)
    $('btnAttack').addEventListener('click', () => {
      const t = G.target;
      if (G.playerSel && !G.playerSel.dead) return Game.attackTarget();
      if (!t || t.dead || t.hidden) Game.targetNearest();
      Game.attackTarget();
    });
  }

  function onStart(canvas) {
    syncFsButton();
    if (!isTouch) return;
    initJoystick();
    initPinch(canvas);
    initButtons();
    // Si el jugador sale de pantalla completa (gesto atrás), el siguiente toque la recupera
    canvas.addEventListener('pointerdown', () => {
      if (!inFullscreen()) enterFullscreen();
    });
  }

  // iPhone: Safari no permite pantalla completa en páginas; sí al abrirlo desde la pantalla de inicio
  const isIOS = /iPhone|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
  const tip = $('iosTip');
  if (tip && isIOS && !standalone) tip.hidden = false;

  V.Mobile = { isTouch, canFullscreen, enterFullscreen, toggleFullscreen, onStart };
})();
