# Imagen del servidor de Ecos de Valdoria (se construye desde la raíz del repositorio).
FROM node:20-slim
WORKDIR /app
COPY server/package.json server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY juego/src/data.js juego/src/terrain.js juego/src/sim.js juego/src/version.js juego/src/
COPY juego/src/systems/ juego/src/systems/
COPY server/index.js server/db.js server/admin.js server/admin.html server/admin-app.js server/chatfilter.js server/
# /data es un disco persistente de Fly.io (cuentas y personajes)
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server/index.js"]
