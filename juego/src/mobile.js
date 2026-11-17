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
    const R = 46;

    const move = (e) => {
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const k = Math.min(1, len / R);
      G.joy = k < 0.18 ? null : { x: dx / R, y: dy / R };
    };
    const end = () => {
      id = null;
      G.joy = null;
      knob.style.transform = '';
      pad.classList.remove('active');
    };

    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (id !== null) return;
      id = e.pointerId;
      const r = pad.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      try {
        pad.setPointerCapture(id);
      } catch {
        /* sin captura: igual funciona mientras el dedo siga sobre el joystick */
      }
      pad.classList.add('active');
      move(e);
    });
    pad.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    pad.addEventListener('pointerup', (e) => e.pointerId === id && end());
    pad.addEventListener('pointercancel', (e) => e.pointerId === id && end());
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
  function onStart(canvas) {
    syncFsButton();
    if (!isTouch) return;
    initJoystick();
    initPinch(canvas);
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
