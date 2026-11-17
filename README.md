# Ecos de Valdoria

RPG de fantasía en 3D para Windows, hecho con three.js y Electron.
Tres clases (Guerrero, Arquera y Mago), siete tierras alrededor de la Aldea de Brezal y un jefe final, Tharmok.

- Web y guía: https://ecos-de-valdoria.vercel.app
- Descarga: https://github.com/hsanchezlabrin-art/ecos-de-valdoria/releases/latest

## Estructura

| Carpeta | Qué contiene |
| --- | --- |
| `juego/` | El juego: `index.html`, `src/` (lógica, mundo, modelos, interfaz, datos) y `vendor/three.min.js` |
| `desktop/` | App de escritorio (Electron): ventana principal, splash de carga e instalador |
| `index.html`, `guia.html`, `site.*` | Web de presentación y guía (Vercel). Reutiliza `juego/src/data.js` |
| `.github/workflows/` | Compila el instalador de Windows en GitHub Actions |

`juego/src/data.js` es la única fuente de clases, habilidades, zonas, monstruos, objetos y NPCs. La guía de la web se genera a partir de ese archivo.

### Arquitectura (preparada para el modo online)

| Archivo | Rol | Corre en |
| --- | --- | --- |
| `data.js` | Reglas y contenido | Navegador y Node |
| `terrain.js` | Alturas del terreno, aldea y zonas | Navegador y Node |
| `sim.js` | Simulación completa: jugadores, monstruos, combate, habilidades, botín, NPCs. Multijugador, sin gráficos. Emite eventos | Navegador y Node (futuro servidor) |
| `game.js` | Cliente: envía comandos a la simulación y dibuja su estado y eventos | Navegador |
| `models.js`, `world.js`, `ui.js`, `main.js` | Modelos 3D, escenario, interfaz y arranque | Navegador |

`test/sim.test.js` ejecuta la simulación en Node con bots de las tres clases y varios jugadores. Corre en GitHub Actions en cada push (`node test/sim.test.js`).

## Publicar una versión

1. Sube los cambios a `main` (Vercel actualiza la web solo).
2. Crea y sube una etiqueta de versión:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. GitHub Actions compila `EcosDeValdoria-Setup.exe` y lo publica en Releases. El botón de descarga de la web siempre apunta a la última versión.

## Probar en local

```bash
python -m http.server 8765
```

Luego abre http://127.0.0.1:8765/juego/ (juego) o http://127.0.0.1:8765/ (web).
