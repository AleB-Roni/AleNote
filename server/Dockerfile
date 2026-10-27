FROM node:22-alpine

LABEL org.opencontainers.image.title="AleNote Server" \
      org.opencontainers.image.description="Sync-Server für AleNote mit Benutzerverwaltung, Admin-Konsole und Web-Version" \
      org.opencontainers.image.source="https://github.com/AleB-Roni/AleNote" \
      org.opencontainers.image.licenses="MIT"

# Wird aus dem Hauptordner des Repositorys gebaut:  docker build -f server/Dockerfile .
WORKDIR /app
COPY server/package.json server/server.js ./
COPY server/lib ./lib
COPY server/admin ./admin
# Web-Version (AleNote im Browser unter /app/) + deren Versionsnummer
COPY src ./web
COPY package.json ./app-package.json
COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=8787 \
    DATA_DIR=/data \
    PUID=99 \
    PGID=100 \
    TZ=Europe/Berlin

VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
