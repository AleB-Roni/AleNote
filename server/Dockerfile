FROM node:22-alpine

LABEL org.opencontainers.image.title="AleNote Server" \
      org.opencontainers.image.description="Sync-Server für AleNote mit Benutzerverwaltung und Admin-Konsole" \
      org.opencontainers.image.source="https://github.com/AleB-Roni/AleNote" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY admin ./admin
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
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
