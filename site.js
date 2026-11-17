// Web de Ecos de Valdoria. Reutiliza los datos y modelos del juego (juego/src) para que
// la portada y la guía muestren siempre lo mismo que hay en el juego.
(function () {
  const D = V.Data;
  const THREE = window.THREE;
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k);
    return e;
  };
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  const tint = (t) => `rgb(${t.map((v) => Math.round(v * 255)).join(',')})`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGL = (() => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  })();

  // Ajusta el lienzo a su tamaño en pantalla cada vez que cambie
  function fit(canvas, renderer, camera) {
    const apply = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    if ('ResizeObserver' in window) new ResizeObserver(apply).observe(canvas);
    else addEventListener('resize', apply);
    apply();
  }

  // Pausa el render de un lienzo cuando no está a la vista
  function whenVisible(node, onChange) {
    if (!('IntersectionObserver' in window)) return onChange(true);
    new IntersectionObserver((es) => es.forEach((e) => onChange(e.isIntersecting)), { rootMargin: '100px' }).observe(node);
  }

  // ---------- Portada: el mundo real del juego como fondo ----------
  function hero() {
    const canvas = $('#heroCanvas');
    if (!canvas) return;
    if (!hasGL) return canvas.parentElement.classList.add('hero-fallback');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcdb898, 60, 240);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1400);
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a3b28, 0.62));
    const sun = new THREE.DirectionalLight(0xffe0b0, 1.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
    sun.position.set(45, 80, 30);
    scene.add(sun, sun.target);
    const world = V.World.buildWorld(scene);

    // Los tres héroes junto a la fogata
    const heroes = D.CLASS_IDS.map((id, i) => {
      const c = D.CLASSES[id];
      const m = V.Models.buildHumanoid(c.look);
      V.Models.setWeaponLook(m, D.ITEMS[D.WEAPON_TIERS[id][2]]);
      const a = -0.6 + i * 0.9;
      const x = Math.cos(a) * 3.6;
      const z = Math.sin(a) * 3.6 + 0.5;
      m.root.position.set(x, V.World.heightAt(x, z), z);
      m.root.rotation.y = Math.atan2(-x, -z);
      scene.add(m.root);
      return { m, phase: i * 1.7 };
    });

    fit(canvas, renderer, camera);

    let on = true;
    whenVisible(canvas, (v) => (on = v));
    const clock = new THREE.Clock();
    let t = 0;
    (function loop() {
      requestAnimationFrame(loop);
      if (!on) return clock.getDelta();
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!reduced) t += dt;
      const yaw = 2.2 + t * 0.035;
      camera.position.set(Math.sin(yaw) * 26, 9.5, Math.cos(yaw) * 26);
      camera.lookAt(0, 3, 0);
      world.sky.position.copy(camera.position);
      for (const f of world.fires) {
        f.light.intensity = f.base * (0.85 + Math.sin(t * 13) * 0.08 + Math.random() * 0.07);
        f.flame.scale.y = 0.9 + Math.sin(t * 17) * 0.12;
      }
      if (world.crystal) world.crystal.rotation.y += dt * 0.8;
      for (const h of heroes) {
        const k = (t + h.phase) % 4;
        V.Models.animateModel(h.m, t + h.phase, 0, k < 0.45 ? 1 - k / 0.45 : 0);
      }
      renderer.render(scene, camera);
    })();
  }

  // ---------- Tarjetas de clase con el personaje girando ----------
  function classStage(container, id) {
    if (!hasGL) return;
    const c = D.CLASSES[id];
    const canvas = el('canvas', { 'aria-hidden': 'true' });
    container.prepend(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 2.4, 7.4);
    camera.lookAt(0, 1.35, 0);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a2e22, 0.9));
    const key = new THREE.DirectionalLight(0xffe0b0, 1.4);
    key.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0xd9b56a, 0.9);
    rim.position.set(-4, 3, -4);
    scene.add(key, rim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.12, 32), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9 }));
    disc.position.y = -0.06;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.025, 6, 48), new THREE.MeshBasicMaterial({ color: 0x8a6d3b }));
    ring.rotation.x = Math.PI / 2;
    scene.add(disc, ring);
    const m = V.Models.buildHumanoid(c.look);
    V.Models.setWeaponLook(m, D.ITEMS[D.WEAPON_TIERS[id][2]]);
    scene.add(m.root);

    fit(canvas, renderer, camera);
    let on = true;
    whenVisible(canvas, (v) => (on = v));
    const clock = new THREE.Clock();
    let t = Math.random() * 3;
    (function loop() {
      requestAnimationFrame(loop);
      if (!on) return clock.getDelta();
      const dt = Math.min(clock.getDelta(), 0.05);
      t += dt;
      m.root.rotation.y = reduced ? 0.5 : t * 0.6;
      const k = t % 3;
      V.Models.animateModel(m, t, 0, k < 0.45 ? 1 - k / 0.45 : 0);
      renderer.render(scene, camera);
    })();
  }

  function classCards() {
    const box = $('#classCards');
    if (!box) return;
    for (const id of D.CLASS_IDS) {
      const c = D.CLASSES[id];
      const stage = el('div', { class: 'class-stage' }, el('span', { class: 'glyph', 'aria-hidden': 'true' }, c.skills[0].glyph));
      const card = el(
        'article',
        { class: 'class-card' },
        stage,
        el(
          'div',
          { class: 'class-body' },
          el('h3', {}, c.name),
          el('span', { class: 'role' }, c.role),
          el('p', {}, c.desc),
          el('div', { class: 'skill-chips' }, c.skills.map((s) => el('span', { class: 'chip', title: s.desc }, el('b', {}, s.glyph), s.name)))
        )
      );
      box.append(card);
      classStage(stage, id);
    }
  }

  // ---------- Mapa y zonas ----------
  function worldMap() {
    const box = $('#worldMap');
    if (!box) return;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '-190 -190 380 380');
    const add = (tag, a) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
      svg.append(n);
      return n;
    };
    const field = D.ZONES.filter((z) => !z.safe);
    for (const z of field) add('line', { x1: 0, y1: 0, x2: z.x, y2: z.z, stroke: 'rgba(176,146,98,.6)', 'stroke-width': 4, 'stroke-linecap': 'round' });
    for (const z of field) add('circle', { cx: z.x, cy: z.z, r: z.r, fill: tint(z.tint), 'fill-opacity': 0.75, stroke: 'rgba(0,0,0,.35)' });
    add('circle', { cx: 0, cy: 0, r: 22, fill: 'rgba(217,181,106,.45)', stroke: '#d9b56a', 'stroke-width': 1.5 });
    for (const z of D.ZONES) {
      const t = add('text', { x: z.x, y: z.z + 3, 'text-anchor': 'middle', fill: '#f3e7cc', 'font-size': z.safe ? 9 : 10, 'font-family': 'Cinzel, Georgia, serif', 'font-weight': 700, 'paint-order': 'stroke', stroke: 'rgba(0,0,0,.7)', 'stroke-width': 3 });
      t.textContent = { aldea: 'Brezal', prados: 'Prados', bosque: 'Bosque', goblin: 'Goblins', fuerte: 'Fuerte Orco', ceniza: 'Ceniza', pantano: 'Pantano' }[z.id] || z.name;
    }
    const boss = D.ZONES.find((z) => z.id === 'pantano');
    add('text', { x: boss.x, y: boss.z - 10, 'text-anchor': 'middle', 'font-size': 14, fill: '#c895ff' }).textContent = '☠';
    box.append(svg);

    const list = $('#zoneList');
    if (!list) return;
    for (const z of D.ZONES) {
      list.append(
        el(
          'li',
          {},
          el('span', { class: 'sw', style: `background:${z.safe ? '#d9b56a' : tint(z.tint)}` }),
          el('strong', {}, z.name),
          el('span', { class: 'lv' }, z.safe ? 'Zona segura' : `Nv ${z.lvl}`),
          el('p', {}, z.desc)
        )
      );
    }
  }

  // ---------- Guía ----------
  const rarity = (r) => el('span', { class: 'rar', style: `color:${D.RARITY[r].color}` }, D.RARITY[r].name);
  const table = (heads, rows) =>
    el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        {},
        el('thead', {}, el('tr', {}, heads.map(([h, cls]) => el('th', cls ? { class: cls } : {}, h)))),
        el('tbody', {}, rows)
      )
    );
  const skillType = {
    dmg: 'Daño a un objetivo',
    heal: 'Curación',
    aoe: 'Área a tu alrededor',
    area: 'Área sobre el objetivo',
    buff: 'Mejora temporal',
    shield: 'Escudo',
    leap: 'Movilidad',
  };

  function guideClasses() {
    const box = $('#guideClasses');
    if (!box) return;
    for (const id of D.CLASS_IDS) {
      const c = D.CLASSES[id];
      const s1 = D.playerBaseStats(id, 1);
      const s20 = D.playerBaseStats(id, D.MAX_LEVEL);
      const rows = c.skills.map((s) =>
        el(
          'tr',
          {},
          el('td', { class: 'num' }, String(s.lvl)),
          el('td', {}, el('span', { class: 'g', 'aria-hidden': 'true' }, s.glyph), el('strong', {}, s.name)),
          el('td', {}, skillType[s.type]),
          el('td', { class: 'num' }, `${s.mp}`),
          el('td', { class: 'num' }, `${s.cd} s`),
          el('td', { class: 'num' }, s.range ? `${s.range} m` : '—'),
          el('td', {}, s.desc)
        )
      );
      box.append(
        el(
          'div',
          { class: 'class-guide', id: `clase-${id}` },
          el('header', {}, el('h3', {}, c.name), el('span', { class: 'role' }, c.role)),
          el('p', {}, c.desc),
          el(
            'div',
            { class: 'statline' },
            el('span', {}, 'Vida ', el('b', {}, `${s1.maxHp} → ${s20.maxHp}`)),
            el('span', {}, 'Maná ', el('b', {}, `${s1.maxMp} → ${s20.maxMp}`)),
            el('span', {}, 'Alcance ', el('b', {}, c.range > 3 ? `${c.range} m` : 'cuerpo a cuerpo')),
            el('span', {}, 'Ataque cada ', el('b', {}, `${c.atkSpeed} s`)),
            el('span', {}, 'Arma inicial ', el('b', {}, D.ITEMS[c.start].name))
          ),
          table([['Nivel', 'num'], ['Habilidad'], ['Tipo'], ['Maná', 'num'], ['Recarga', 'num'], ['Alcance', 'num'], ['Efecto']], rows)
        )
      );
    }
  }

  function guideLevels() {
    const box = $('#guideLevels');
    if (!box) return;
    let total = 0;
    const rows = [];
    for (let lv = 1; lv <= D.MAX_LEVEL; lv++) {
      const need = lv < D.MAX_LEVEL ? D.xpToNext(lv) : null;
      const unlocks = D.CLASS_IDS.map((id) => D.CLASSES[id].skills.find((s) => s.lvl === lv)).filter(Boolean);
      const gear = Object.values(D.ITEMS).filter((it) => it.lvl === lv && (it.type === 'weapon' || it.type === 'armor'));
      const notes = [];
      if (unlocks.length) notes.push(`Habilidades: ${unlocks.map((s) => s.name).join(', ')}`);
      if (gear.length && lv > 1) notes.push(`Equipo de nivel ${lv}`);
      const zones = D.ZONES.filter((z) => z.lvl && +z.lvl.split('–')[0] === lv).map((z) => z.name);
      if (zones.length) notes.push(`Zona: ${zones.join(', ')}`);
      if (lv === D.MAX_LEVEL) notes.push('Nivel máximo');
      rows.push(
        el(
          'tr',
          unlocks.length ? { class: 'unlock' } : {},
          el('td', { class: 'num' }, String(lv)),
          el('td', { class: 'num' }, need ? need.toLocaleString('es') : '—'),
          el('td', { class: 'num' }, total.toLocaleString('es')),
          el('td', {}, notes.join(' · ') || '')
        )
      );
      if (need) total += need;
    }
    box.append(table([['Nivel', 'num'], ['XP para subir', 'num'], ['XP acumulada', 'num'], ['Qué obtienes']], rows));
  }

  function guideZones() {
    const box = $('#guideZones');
    if (!box) return;
    const rows = [];
    for (const z of D.ZONES.filter((zz) => !zz.safe)) {
      const mobs = Object.values(D.MOBS).filter((m) => m.zone === z.id);
      for (const m of mobs) {
        rows.push(
          el(
            'tr',
            {},
            el('td', {}, el('strong', {}, z.name)),
            el('td', {}, m.boss ? el('span', { style: 'color:#c895ff;font-weight:700' }, m.name) : m.name),
            el('td', { class: 'num' }, m.lvl[0] === m.lvl[1] ? `${m.lvl[0]}` : `${m.lvl[0]}–${m.lvl[1]}`),
            el('td', {}, m.aggressive ? 'Te ataca al verte' : 'Solo si lo atacas'),
            el('td', {}, m.drops.map(([id]) => (id[0] === '@' ? `Arma de tu clase (${['común', 'refinada', 'rara', 'épica'][+id.slice(2)]})` : D.ITEMS[id].name)).join(', '))
          )
        );
      }
    }
    box.append(table([['Zona'], ['Monstruo'], ['Nivel', 'num'], ['Comportamiento'], ['Botín posible']], rows));
  }

  function guideItems() {
    const w = $('#guideWeapons');
    if (w) {
      const rows = [0, 1, 2, 3].map((tier) => {
        const ids = D.CLASS_IDS.map((c) => D.WEAPON_TIERS[c][tier]);
        const first = D.ITEMS[ids[0]];
        return el(
          'tr',
          {},
          el('td', { class: 'num' }, String(first.lvl)),
          el('td', {}, rarity(first.rarity)),
          ids.map((id) => el('td', {}, D.ITEMS[id].name)),
          el('td', { class: 'num' }, `+${first.atk}`),
          el('td', {}, tier < 2 ? `Tienda (${first.price} oro) o botín` : tier === 2 ? 'Botín de orcos y gólems' : 'Solo Tharmok')
        );
      });
      w.append(table([['Nivel', 'num'], ['Rareza'], ['Guerrero'], ['Arquera'], ['Mago'], ['Ataque', 'num'], ['Dónde']], rows));
    }
    const a = $('#guideArmor');
    if (a) {
      const rows = Object.entries(D.ITEMS)
        .filter(([, it]) => it.type === 'armor')
        .map(([, it]) =>
          el('tr', {}, el('td', { class: 'num' }, String(it.lvl)), el('td', {}, el('strong', {}, it.name)), el('td', {}, rarity(it.rarity)), el('td', { class: 'num' }, `+${it.def}`), el('td', { class: 'num' }, `+${it.hp}`), el('td', {}, it.desc))
        );
      a.append(table([['Nivel', 'num'], ['Armadura'], ['Rareza'], ['Defensa', 'num'], ['Vida', 'num'], ['Notas']], rows));
    }
    const p = $('#guideMisc');
    if (p) {
      const rows = Object.values(D.ITEMS)
        .filter((it) => it.type === 'potion' || it.type === 'junk')
        .map((it) => el('tr', {}, el('td', {}, el('span', { class: 'g', style: `color:${D.RARITY[it.rarity].color}` }, it.glyph), el('strong', {}, it.name)), el('td', {}, it.type === 'potion' ? 'Poción' : 'Botín'), el('td', {}, it.desc), el('td', { class: 'num' }, it.type === 'potion' ? `${it.price} oro` : `Vende: ${D.sellPrice(it)} oro`)));
      p.append(table([['Objeto'], ['Tipo'], ['Uso'], ['Precio', 'num']], rows));
    }
  }

  function guideNpcs() {
    const box = $('#guideNpcs');
    if (!box) return;
    for (const n of D.NPCS) box.append(el('div', { class: 'npc' }, el('span', { class: 'title' }, n.title), el('h3', {}, n.name), el('p', {}, n.desc)));
  }

  function tocSpy() {
    const links = [...document.querySelectorAll('.toc a')];
    if (!links.length || !('IntersectionObserver' in window)) return;
    const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (!e.isIntersecting) continue;
          links.forEach((a) => a.classList.remove('active'));
          const a = map.get(e.target.id);
          if (a) a.classList.add('active');
        }
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );
    for (const id of map.keys()) {
      const s = document.getElementById(id);
      if (s) io.observe(s);
    }
  }

  // Resalta la descarga del sistema del visitante y apunta el botón principal a ella
  function detectOS() {
    const ua = navigator.userAgent || '';
    const os = /Mac|iPhone|iPad/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'win' : null;
    if (!os) return;
    const card = document.querySelector(`.platform[data-os="${os}"]`);
    if (!card) return;
    card.classList.add('mine');
    card.querySelector('.badge').hidden = false;
    card.parentElement.prepend(card);
    const label = document.getElementById('heroDl');
    if (label) label.textContent = os === 'mac' ? 'Descargar para Mac' : 'Descargar para Windows';
    const heroBtn = label && label.closest('a');
    if (heroBtn) heroBtn.href = card.querySelector('.dl-link').href;
  }

  detectOS();
  hero();
  classCards();
  worldMap();
  guideClasses();
  guideLevels();
  guideZones();
  guideItems();
  guideNpcs();
  tocSpy();
})();
