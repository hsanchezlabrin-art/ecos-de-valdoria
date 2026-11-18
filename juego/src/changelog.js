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
      version: '0.17.0',
      date: '2026-11-18',
      title: 'Armaduras que se ven en 3D',
      items: [
        'Los personajes 3D ahora lucen su armadura según el grado: cinturón y brazaletes, hombreras y gema, franja decorada, capa, y casco o corona en Arcoíris.',
        'Las piezas se ajustan al cuerpo de cada raza y siguen sus movimientos; la capa se levanta al correr.',
        'La cola del Lagarto se balancea sola: suave al estar quieto y más rápido al correr.',
      ],
    },
    {
      version: '0.16.0',
      date: '2026-11-18',
      title: 'Botón Salir y monstruos con aviso',
      items: [
        'Nuevo botón «Salir»: guarda tu personaje y vuelve a la selección de personajes sin cerrar la sesión.',
        'Hay menos monstruos en cada zona, para explorar con más calma (los jefes siguen igual).',
        'Los monstruos agresivos llevan un «!» rojo junto a su nombre: te atacan si te acercas. Los demás solo pelean si los golpeas.',
      ],
    },
    {
      version: '0.15.1',
      date: '2026-11-18',
      title: 'El juego abre más rápido',
      items: [
        'Al iniciar ya no se descargan todos los personajes 3D: solo los movimientos y el modelo del héroe que eliges.',
        'Los demás modelos llegan cuando aparece alguien de esa raza; mientras tanto se ve su figura de bloques por un momento.',
      ],
    },
    {
      version: '0.15.0',
      date: '2026-11-18',
      title: 'Oso, Gnomo y Lagarto en 3D',
      items: [
        'El Oso Pardo, el Gnomo y el Lagarto estrenan modelo 3D, en versión hombre y mujer, con el mismo estilo low-poly del Elfo.',
        'Cada raza mantiene su tamaño: el Oso es grandote y el Gnomo bien pequeñito.',
        'Todos usan los movimientos nuevos: corren, atacan según su arma, celebran al subir de nivel y van sentados en la montura.',
        'El Hada-Gato llegará en 3D muy pronto.',
      ],
    },
    {
      version: '0.14.0',
      date: '2026-11-18',
      title: 'Movimientos para cada arma',
      items: [
        'El Elfo 3D ataca según el arma que lleva: corte de espada, combo de dagas, estocada de lanza, hechizo con báculo y disparo con arco.',
        'Las armas siguen el giro real de la muñeca, y el báculo, el cetro y el arco se sostienen derechos.',
        '¡A celebrar! Al subir de nivel el personaje salta de alegría con los brazos arriba.',
        'En la montura, el personaje 3D va sentado.',
        'Las animaciones se comparten entre todas las razas: los próximos personajes 3D se moverán igual de bien.',
      ],
    },
    {
      version: '0.13.0',
      date: '2026-11-18',
      title: 'El Elfo cobra vida en 3D',
      items: [
        'Nuevo modelo 3D del Elfo del Bosque Cubo, en versión hombre y mujer, con estilo low-poly de colores vivos.',
        'Movimientos naturales: respira cuando está quieto, corre, tensa el arco para disparar y cae al ser derrotado.',
        'El arco se sostiene derecho en la mano y al disparar el elfo apunta hacia su objetivo.',
        'Las demás razas mantienen su figura de bloques mientras preparamos sus modelos 3D.',
      ],
    },
    {
      version: '0.12.0',
      date: '2026-11-18',
      title: 'Chat seguro para niños',
      items: [
        'Filtro de palabras: los insultos y palabrotas se tapan con estrellas, aunque se escriban con trucos.',
        'Datos personales protegidos: los mensajes con teléfonos, direcciones, correos, enlaces, redes sociales o contraseñas no se envían.',
        'Frases rápidas (botón 💬): saluda, pide grupo, ayuda o da las gracias sin escribir.',
        'Modo solo frases rápidas: oculta los mensajes escritos por otros jugadores (ideal para los más pequeños).',
        'Silenciar y reportar: toca a otro jugador para dejar de ver sus mensajes o avisar a un adulto.',
        'Quien acumula avisos queda 5 minutos sin chat libre (las frases rápidas siguen funcionando).',
      ],
    },
    {
      version: '0.11.0',
      date: '2026-11-18',
      title: 'Héroes de bloques y equipo que se nota',
      items: [
        'Estilo de bloques: cabezas cúbicas en todos los personajes, y más grandes en las cinco razas jugables.',
        'Cada tipo de arma tiene su forma: espadas dobles, lanza, maza, martillo a dos manos, dagas, ballesta, varita mecánica, lanzapociones, libro flotante, campana y cetro estrella.',
        'La armadura cambia con el grado: Cobre suma cinturón y brazaletes; Cristal Azul, hombreras y una gema; Oro Morado, una franja decorada; Diamante Dorado, una capa; y Arcoíris, un casco épico o una corona.',
        'El equipo Arcoíris cambia de color sin parar y deja chispitas suaves al moverte o atacar (sin destellos).',
      ],
    },
    {
      version: '0.10.1',
      date: '2026-11-18',
      title: 'Caminos sin brillitos',
      items: [
        'Arreglado: los caminos de tierra mostraban puntitos que parpadeaban como brillitos al mover la cámara (las piedritas del suelo tenían demasiado contraste).',
        'La guía ahora son flechas doradas planas en el suelo que apuntan hacia tu destino, en vez de chispas brillantes.',
      ],
    },
    {
      version: '0.10.0',
      date: '2026-11-18',
      title: 'Un mundo nuevo: seis tierras y cuatro jefes',
      items: [
        'El mapa cambia por completo: Aldea de los Bloques, Praderas (1–5), Bosque de Árboles Gigantes (5–12), Minas de Cristal y Engranajes (12–20), Ciudadela de Gludio-Cubo, Valle de los Dragones Dormidos (20–30) e Islas Flotantes del Cielo (30–40+).',
        'Monstruos nuevos: hongos saltarines, ovejas cubo, cangrejos, lobos de madera, duendes, avispas, murciélagos de cristal, slimes, gólems, lagartos de fuego, salamandras, caballeros nube, elementales de estrella y grifos.',
        'Rey Tronco (nivel 12): esquiva las raíces marcadas en el suelo.',
        'Mega-Autómata 3000 (nivel 18) en La Fábrica Descontrolada: pisen los 3 botones en equipo para apagar su escudo.',
        'Ignis, el Dragón Dormilón (nivel 28): escóndete detrás de las rocas cuando bostece fuego.',
        'Gran Guardián Celestial (nivel 40): lluvia de estrellas, refuerzos y Polvo de Arcoíris para forjar equipo Arcoíris con el Herrero Celestial.',
        'Ciudadela de Gludio-Cubo: zona segura con Maestra de Clase, Mercader Corvin (grados Azul, Morado y Dorado), Herrero Celestial, sanador, gremio, establo y portales.',
        'Vagoneta de la aldea a las Minas, portal de la Ciudadela a las Islas (nivel 30) y géiseres que te lanzan por el Valle.',
        'Arreglado: si el servidor se reiniciaba mientras estabas eligiendo personaje, «Entrar al mundo» fallaba hasta recargar.',
      ],
    },
    {
      version: '0.9.0',
      date: '2026-11-18',
      title: 'Mascotas, monturas y guía',
      items: [
        'En el nivel 5 recibes un Huevo de Mascota: elige Cubo-Perro, Dragoncito o Búho Cúbico. Te sigue y va a buscar el botín por ti.',
        'El botín ahora cae al suelo en cofrecitos que solo ves tú: recógelo pasando por encima o deja que tu mascota lo traiga. Si nadie lo recoge, llega solo a tu mochila: nunca se pierde.',
        'En el nivel 20 tu mascota crece y se convierte en tu montura (tecla 0): +60% de velocidad.',
        'Con la Ascensión Maestra (nivel 40) tu montura gana alas: planea sobre el agua y va el doble de rápido. Además brilla tu Aura de Héroe.',
        'Guía dorada: unas chispas marcan el camino hacia tu próxima misión, el Maestro de Clase o la zona de tu nivel. Se puede apagar con el botón Guía.',
        'Los personajes que ya pasaron el nivel 5 reciben su huevo al entrar.',
      ],
    },
    {
      version: '0.8.0',
      date: '2026-11-18',
      title: 'Robots, clones y Gemas de Poder',
      items: [
        'Gemas de Poder: actívalas con la tecla 9 y cada ataque hace un 25% más de daño. Tu arma brilla con luz neón. Empiezas con 20, se compran al mercader y las sueltan los monstruos.',
        'El Mecha-Gólem es un robot de verdad: camina, pelea y los monstruos lo atacan a él. En el nivel 40 el Gnomo se sube dentro y dispara láseres.',
        'Las torretas del Gnomo son objetos en el mundo, y el Inventor puede tener dos a la vez.',
        'El Tornado de Hojas Maestro crea 2 clones de viento que giran contigo y golpean.',
        'La cúpula de la Fortaleza Cubo protege de verdad: dentro se recibe la mitad de daño.',
        'Polimorfia: ahora puede salir oveja o pollo. El halcón del Elfo vuela hasta el enemigo marcado.',
        'Nuevos efectos: alas de luz del Paladín, escudo de brasas, piel de corteza, viento y lluvia de bellotas.',
        'Lobos, orcos, gólems, sapos y Tharmok pueden dejarte lento, envenenado o quemado. El Destello Purificador de la Hada-Gato lo quita.',
      ],
    },
    {
      version: '0.7.0',
      date: '2026-11-18',
      title: 'Cinco razas y cambios de clase',
      items: [
        'Cinco razas nuevas: Oso Pardo (tanque), Elfo del Bosque Cubo (arquero), Gnomo Ingeniero (magia y torretas), Hada-Gato (sanadora) y Caballero Lagarto (espadachín).',
        'Tus personajes se conservan: el Guerrero pasa a Caballero Lagarto, la Arquera a Elfo y el Mago a Gnomo, con su nivel, oro y equipo equivalente.',
        'Nuevo Maestro Aldric en la aldea: cambios de clase en los niveles 10 (Despertar), 25 (eliges rama A o B) y 40 (Ascensión Maestra), cada uno con su misión.',
        'Cada raza tiene 5 habilidades, una pasiva y una Ultimate por rama, que se vuelve Maestra en el nivel 40. Nivel máximo: 50.',
        'Equipo por grados: Madera, Cobre, Cristal Azul, Oro Morado, Diamante Dorado y Arcoíris Celestial. Cada raza usa su tipo de armadura y sus armas.',
        'Sin castigos: al caer no pierdes experiencia ni objetos y despiertas en un lugar seguro cerca.',
        'En grupo, cada jugador recibe su propio botín y oro.',
      ],
    },
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
