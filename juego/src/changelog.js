// Registro de cambios. Lo muestran la web (cambios.html) y la pantalla de inicio del juego.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const V = (globalThis.V = globalThis.V || {});
    V.CHANGELOG = factory();
  }
})(function () {
  return [
    {
      version: '0.6.0',
      date: '2026-11-18',
      title: 'Panel de control del servidor',
      items: [
        'Nuevo panel para los administradores: estado del servidor, jugadores en línea, cuentas y registro de eventos.',
        'Los administradores pueden enviar avisos al chat de todos (por ejemplo, antes de un mantenimiento).',
      ],
    },
    {
      version: '0.5.6',
      date: '2026-11-18',
      title: 'El Guerrero de siempre',
      items: ['El Guerrero (hombre) vuelve a su aspecto anterior, con su armadura y armas según el equipo.'],
    },
    {
      version: '0.5.5',
      date: '2026-11-18',
      title: 'Adiós a los destellos',
      items: [
        'Arreglado: el sol reflejado en espadas y armas metálicas formaba bolas de luz cerca del suelo.',
        'El brillo de bastones, hechizos y armas raras queda contenido: se ve el objeto brillar, sin halos enormes.',
      ],
    },
    {
      version: '0.5.4',
      date: '2026-11-17',
      title: 'Hechizos sin encandilar',
      items: ['Arreglado: los proyectiles mágicos, bolas de fuego, rayos y el efecto de subir de nivel ya no forman grandes destellos.'],
    },
    {
      version: '0.5.3',
      date: '2026-11-17',
      title: 'Versión a la vista',
      items: ['La versión del juego se ve en el recuadro del minimapa, en PC y en celulares.'],
    },
    {
      version: '0.5.2',
      date: '2026-11-17',
      title: 'Menos destellos, más fluidez',
      items: [
        'Arreglado: fogatas, lava y ojos de monstruos ya no forman grandes destellos de día.',
        'Brillo más suave y calidad Alta y Media más livianas.',
        'Si el juego va lento, la calidad gráfica baja sola al empezar (si no la elegiste tú).',
      ],
    },
    {
      version: '0.5.1',
      date: '2026-11-17',
      title: 'El primer héroe realista',
      items: [
        'El Guerrero (hombre) estrena modelo 3D realista con armadura de placas, capa y animaciones de verdad para estar quieto, caminar y atacar.',
        'Las demás clases llegarán con su modelo nuevo en las próximas versiones.',
      ],
    },
    {
      version: '0.5.0',
      date: '2026-11-17',
      title: 'Un mundo más vivo',
      items: [
        'Ciclo de día y noche: amaneceres, atardeceres y noches con estrellas y luna. Todos los jugadores ven la misma hora.',
        'Cielo con nubes que se mueven y sol con resplandor.',
        'Suelo con texturas de pasto, tierra y roca, y sombra bajo árboles y casas.',
        'Pasto que se mece con el viento y se aparta al pasar.',
        'Agua con olas, reflejos del cielo y espuma en la orilla.',
        'Brillo en llamas, lava, ventanas y hechizos, y colores más cálidos.',
        'Nuevo botón Gráficos (Baja, Media, Alta) para elegir calidad según tu equipo.',
      ],
    },
    {
      version: '0.4.1',
      date: '2026-11-17',
      title: 'Joystick y celulares',
      items: [
        'Arreglado: el joystick a veces quedaba pegado y el personaje seguía caminando solo.',
        'Interfaz en celulares con proporciones de MMORPG móvil: más compacta, deja ver más del mundo.',
        'Barra de chat fija abajo a la izquierda; el botón Objetivo pasa junto a Atacar.',
        'Reconexión más rápida y con más intentos si el servidor se reinicia.',
      ],
    },
    {
      version: '0.4.0',
      date: '2026-11-17',
      title: 'Cuentas, grupos y un mundo más sólido',
      items: [
        'Cuentas de jugador: crea tu cuenta con ID, correo y contraseña y entra al instante. Tus personajes quedan guardados en el servidor.',
        'Selector de personajes: hasta 7 personajes por cuenta, con vista 3D de cada uno con su equipo.',
        'Creador de personaje: elige hombre o mujer y mira cómo cambia su apariencia antes de crearlo.',
        'Grupos (party) como en Lineage 2: invita jugadores, ve su vida y maná, y comparte la experiencia.',
        'Colisiones: ya no se atraviesan árboles, casas, rocas ni empalizadas; el personaje los rodea.',
        'Natación: el personaje nada en aguas profundas y se le acaba el aire si se queda demasiado.',
        'Golpes críticos con probabilidad según tu clase y arma; ahora se ven en tu ventana de estado.',
        'Dos habilidades nuevas por clase (niveles 11 y 15) y armas y armaduras para los niveles 11, 16 y 19, con la nueva rareza Legendaria.',
        'Ventana de estado separada del inventario, con velocidad de ataque, velocidad, crítico y más.',
        'Mapa grande: se abre con M o tocando el minimapa, se puede mover y acercar.',
        'Shift + clic sobre un monstruo muestra qué botín puede soltar.',
        'Efecto de luz al subir de nivel, visible para todos.',
        'Los monstruos ya no recuperan la vida al instante cuando los atacas desde lejos.',
        'Conexión más estable: el juego se reconecta solo si se corta.',
        'Se borraron todos los personajes anteriores al estrenar las cuentas.',
      ],
    },
    {
      version: '0.3.3',
      date: '2026-11-17',
      title: 'Inventario y personajes de la aldea',
      items: [
        'Ficha de objeto con botones Equipar, Usar, Vender y Quitar; clic derecho para equipar al instante.',
        'Los NPCs seleccionados se marcan con un anillo dorado y su marco de objetivo.',
        'Nombres aleatorios al crear personaje y nombres únicos reservados.',
        'Arreglado: los NPCs no respondían si había que caminar hasta ellos.',
      ],
    },
    {
      version: '0.3.2',
      date: '2026-11-17',
      title: 'Celulares y tienda',
      items: [
        'Interfaz táctil al estilo de los MMORPG móviles: botón Atacar, arco de habilidades y joystick.',
        'La tienda pide confirmación y permite elegir la cantidad.',
        'Instalador para macOS.',
      ],
    },
    {
      version: '0.3.1',
      date: '2026-11-17',
      title: 'Chat y actualizaciones',
      items: [
        'Chat visible en todas las pantallas, con globos de texto sobre los personajes.',
        'Dos jugadores conectados no pueden usar el mismo nombre.',
        'La app de Windows se actualiza sola desde la pantalla de carga.',
      ],
    },
    {
      version: '0.3.0',
      date: '2026-11-17',
      title: 'Ecos de Valdoria en línea',
      items: [
        'Servidor en línea: todos los jugadores comparten el mismo mundo, combate y monstruos.',
        'Versión para jugar en el navegador, también en celular en horizontal.',
      ],
    },
    {
      version: '0.2.0',
      date: '2026-11-17',
      title: 'Nuevas clases',
      items: [
        'Clases Arquera y Mago con sus propias armas y habilidades.',
        'La Sanadora Ilwen y la Capitana Brisa llegan a la Aldea de Brezal.',
        'App de escritorio para Windows con pantalla de carga.',
      ],
    },
    {
      version: '0.1.0',
      date: '2026-11-16',
      title: 'Primer prototipo',
      items: ['Guerrero, siete zonas, el Mercader Orlen y el jefe Tharmok.'],
    },
  ];
});
