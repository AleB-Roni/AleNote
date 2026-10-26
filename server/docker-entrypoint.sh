#!/bin/sh
# Bereitet den Datenordner vor. Der Server wechselt danach selbst zur
# Benutzer-ID aus PUID/PGID (Unraid-Standard: 99/100), damit die Dateien
# im appdata-Ordner nicht root gehören.
set -e
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ] && [ "${PUID:-0}" != "0" ]; then
  chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || true
fi
exec "$@"
