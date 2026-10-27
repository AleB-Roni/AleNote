# AleNote Server auf Unraid

## Installation

### 1. Template herunterladen

Im Unraid-Webinterface oben rechts das **Terminal** (`>_`) öffnen und eingeben:

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-AleNote-Server.xml \
  https://raw.githubusercontent.com/AleB-Roni/AleNote/main/unraid/alenote-server.xml
```

### 2. Container anlegen

1. **Docker** → **Add Container**
2. Bei **Template** die Vorlage **AleNote-Server** auswählen
3. Optional ein **Admin-Passwort** eintragen (leer lassen = zufälliges Passwort im Log)
4. **Apply** klicken

| Einstellung | Standard |
|---|---|
| Port | `8787` |
| Daten | `/mnt/user/appdata/alenote` |
| Admin-Benutzername | `admin` |
| PUID / PGID (erweitert) | `99` / `100` |

### 3. Erster Login

1. Im Docker-Tab auf das AleNote-Icon klicken und **WebUI** wählen. Die Admin-Konsole öffnet sich.
2. Ohne gesetztes Passwort: Icon → **Logs**. Dort steht das Admin-Passwort.
3. In der Admin-Konsole unter **Mein Konto** das Passwort ändern und unter **Benutzer** Konten anlegen.

### 4. AleNote verbinden

In AleNote unten links auf **Anmelden** klicken. Als Server-Adresse `http://<Unraid-IP>:8787` eintragen, z.B. `http://192.168.1.10:8787`.

### 5. AleNote im Browser (Mac, Linux, jeder PC)

Der Container enthält auch eine **Web-Version**: `http://<Unraid-IP>:8787/app/` öffnen (auch über die Admin-Konsole → „AleNote im Browser“) und mit deinem Konto anmelden.
Die Notizen werden im Browser gespeichert und automatisch mit dem Server abgeglichen, genau wie in der Windows- und Handy-App.
Auf dem Mac lässt sie sich wie ein Programm ins Dock legen: Safari → **Ablage → Zum Dock hinzufügen** (Chrome: ⋮ → **Streamen, speichern und teilen → Seite als App installieren**).

## Update

Docker-Tab → **Check for Updates** → **apply update**.
Die Daten im `appdata`-Ordner bleiben dabei erhalten.

## App-Updates verteilen

Der Server stellt Updates für die AleNote-Desktop-App bereit. Neue GitHub-Releases werden automatisch übernommen (alle 6 Stunden).
Status, „Jetzt prüfen“ und manuelles Hochladen findest du in der **Admin-Konsole → App-Updates**.

## Backup

Der Ordner `/mnt/user/appdata/alenote` enthält alles: Benutzer, Einstellungen und Notizen.
Er wird z.B. vom Plugin **Appdata Backup** automatisch mitgesichert.

## Zugriff von unterwegs

Am einfachsten über **Tailscale** oder **WireGuard** (in Unraid eingebaut). Dann funktioniert dieselbe Adresse auch unterwegs.

Soll der Server öffentlich erreichbar sein, nur mit HTTPS über einen Reverse-Proxy wie **Nginx Proxy Manager**, **SWAG** oder **Caddy**. Weiterleiten auf `http://<Unraid-IP>:8787`.
