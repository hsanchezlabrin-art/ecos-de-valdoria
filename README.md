# Ecos de Valdoria

Prototipo de RPG de fantasía en 3D para el navegador, hecho con three.js.
Siete tierras rodean la Aldea de Brezal: caza, sube de nivel, consigue mejor equipo y enfréntate a Tharmok en el pantano.

## Jugar en local

Los módulos ES no cargan con `file://`, así que hace falta un servidor estático:

```bash
npx serve .
```

## Estructura

- `index.html`: interfaz (HUD) y arranque
- `src/`: lógica del juego (`main`, `game`, `world`, `models`, `ui`, `data`, `state`)
- `vendor/three.min.js`: three.js

## Despliegue

Es un sitio estático sin paso de build. Vercel despliega automáticamente cada push a `main`.
