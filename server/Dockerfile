# Imagen del servidor de Ecos de Valdoria (se construye desde la raíz del repositorio).
FROM node:20-slim
WORKDIR /app
COPY server/package.json server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY juego/src/data.js juego/src/terrain.js juego/src/sim.js juego/src/
COPY server/index.js server/
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
