// Arma gnomo_m.glb y gnomo_f.glb (y sus armaduras) a partir de las mallas esculpidas en Blender.
// Es un atajo de tools/make_raza.js (ver ahí cómo funciona).
//
// Uso (con el Node de la app de escritorio):
//   ELECTRON_RUN_AS_NODE=1 "<Ecos de Valdoria.exe>" tools/make_gnomo.js [carpeta de salida]
require('./make_raza.js').run('gnomo', process.argv[2]);
