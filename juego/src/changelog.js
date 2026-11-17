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
