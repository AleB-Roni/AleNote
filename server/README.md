# AleNote Server

Sync-Server für AleNote mit Benutzerverwaltung und Web-Admin-Konsole.
Benötigt nur **Node.js 18+** und keine weiteren Pakete.

## Starten

```bash
cd server
node server.js
```

Unter Windows reicht ein Doppelklick auf `start-server.bat`.

Beim **ersten Start** wird ein Admin-Konto angelegt und das Passwort in der Konsole angezeigt:

```
Benutzer: admin
Passwort: xY7k...
```

Danach:

1. **Admin-Konsole** öffnen: `http://<server>:8787/admin`
2. Unter „Mein Konto“ das Admin-Passwort ändern.
3. Unter „Benutzer“ Konten für andere anlegen.
4. In AleNote unten links auf **Anmelden** klicken und als Server-Adresse z.B. `http://192.168.1.20:8787` eintragen.

## Optionen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `8787` | Port |
| `HOST` | `0.0.0.0` | Adresse, auf der gelauscht wird |
| `DATA_DIR` | `./data` | Speicherort für Benutzer, Sitzungen und Notizen |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / zufällig | nur beim allerersten Start |

## Admin-Konsole

- **Übersicht**: Benutzer, aktive Geräte, Anzahl der Notizen, Speicherverbrauch
- **Benutzer**: anlegen, bearbeiten, Rolle (Admin/Benutzer), Speicher-Kontingent, deaktivieren, Passwort zurücksetzen, löschen
- **Sitzungen**: angemeldete Geräte sehen und abmelden
- **Einstellungen**: Servername, Nachricht an alle Benutzer, Selbst-Registrierung, Sitzungsdauer, maximale Upload-Größe, Standard-Kontingent

## Im Internet betreiben (für Handy unterwegs)

Den Server am besten hinter einen Reverse-Proxy mit **HTTPS** stellen, z.B. [Caddy](https://caddyserver.com):

```
notizen.example.de {
    reverse_proxy localhost:8787
}
```

Für **Unraid** gibt es ein fertiges Template, siehe [`../unraid/README.md`](../unraid/README.md).

Alternativ mit Docker:

```bash
docker run -d -p 8787:8787 -v alenote-data:/data --name alenote ghcr.io/aleb-roni/alenote-server:latest
docker logs alenote   # zeigt das Admin-Passwort beim ersten Start
```

## Datensicherung

Alles liegt im Ordner `data/`. Für ein Backup genügt es, diesen Ordner zu kopieren.

```
data/settings.json    Server-Einstellungen
data/users.json       Benutzer (Passwörter als scrypt-Hash)
data/sessions.json    angemeldete Geräte (Tokens nur als SHA-256-Hash)
data/vaults/<id>/     Notizen und Bilder je Benutzer
```

Die API für eigene Apps (z.B. eine Handy-App) ist in [`../docs/API.md`](../docs/API.md) beschrieben.
