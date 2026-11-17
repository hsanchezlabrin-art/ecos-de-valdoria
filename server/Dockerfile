# Imagen del servidor de Ecos de Valdoria (se construye desde la raíz del repositorio).
FROM node:20-slim
WORKDIR /app
COPY server/package.json server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY juego/src/data.js juego/src/terrain.js juego/src/sim.js juego/src/
COPY server/index.js server/names.js server/
# /data es un disco persistente de Fly.io (registro de nombres de personajes)
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server/index.js"]
