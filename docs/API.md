# AleNote Server-API

Grundlage für eigene Clients, z.B. eine Handy-App. Alle Anfragen und Antworten sind JSON.
CORS ist für alle Herkünfte freigeschaltet.

## Anmeldung

Geschützte Endpunkte erwarten den Header `Authorization: Bearer <token>`.

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok, name, version, allowRegistration, motd }` |
| POST | `/api/login` | `{ username, password, device }` | `{ token, user, server }` |
| POST | `/api/register` | `{ username, password, displayName, device }` | wie Login (nur wenn erlaubt) |
| POST | `/api/logout` | – | `{ ok }` |
| GET | `/api/me` | – | `{ user (mit usage), server }` |
| PATCH | `/api/me` | `{ displayName }` | `{ user }` |
| POST | `/api/me/password` | `{ oldPassword, newPassword }` | `{ ok }` |

## Synchronisierung

Jeder Eintrag hat `kind` (`note`, `folder`, `asset`), `rev` (Version), `hash` (SHA-1 des Inhalts), `seq` (Änderungsnummer), `updated` und `deleted`.

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/sync/changes?since=<seq>` | alle Einträge mit `seq > since` → `{ seq, items: [...] }` |
| GET | `/api/sync/note?path=<pfad>` | `{ ...eintrag, content }` (content = JSON-Text der Notiz) |
| PUT | `/api/sync/note` | `{ path, content, baseRev, force? }` → Eintrag. **409**, wenn `baseRev` nicht der Server-Version entspricht (`current` steht in der Antwort) |
| DELETE | `/api/sync/note?path=&baseRev=` | Notiz löschen (409 bei Konflikt) |
| PUT | `/api/sync/folder` | `{ path }` → leeren Ordner anlegen |
| DELETE | `/api/sync/folder?path=` | Ordner-Eintrag löschen |
| GET / PUT | `/api/sync/asset/<name>` | Bilder als Binärdaten |

**Ablauf für einen Client:**

1. `GET /api/sync/changes?since=<letzte seq>` holen.
2. Für jede Änderung prüfen, ob der Client die Notiz seit dem letzten Abgleich lokal geändert hat:
   - Nur auf dem Server geändert → herunterladen.
   - Nur lokal geändert → `PUT` mit `baseRev` = zuletzt bekannte `rev`.
   - Beide geändert → den Benutzer fragen und danach `force: true` senden.
3. Die neue `seq` speichern.

Die Referenz-Implementierung ist [`sync.js`](../sync.js).

## KI-Einstellungen des Kontos

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/me/ai` | `{ config, updated }` – API-Schlüssel, Modelle, Adressen, eigene Prompts (oder `config: null`) |
| PUT | `/api/me/ai` | `{ config, updated }` speichern; andere Geräte bekommen das Live-Ereignis `aiconfig` |

Gespeichert in `<Daten>/vaults/<Benutzer>/ai-config.json`, nicht im Notiz-Abgleich und nicht im Versionsverlauf.

## Live-Bearbeitung

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/live?client=<id>&device=<name>` | Server-Sent Events (mit `Authorization`-Header, z.B. per `fetch`-Stream). Ereignisse: `hello` `{ client, presence }`, `presence` `{ list }`, `change` `{ path, kind, rev, deleted }` (→ sofort abgleichen), `edit` `{ path, patch, rev, hash, content, by }` |
| POST | `/api/live/presence` | `{ client, path }` → welche Notiz dieses Gerät gerade offen hat |
| POST | `/api/live/edit` | `{ client, path, patch }` → Block-Änderungen einarbeiten. `patch = { blocks: { id: block \| null }, order?: [ids], meta?: { key: value \| null } }`. Antwort `{ rev, hash, content }` – diese Fassung lokal speichern und als synchron vormerken. **404**, wenn die Notiz noch nicht auf dem Server liegt (erst normal hochladen) |

Der Server führt Änderungen pro Block zusammen (die letzte gewinnt) und schickt sie als `edit` an die anderen Geräte. Optionaler Header `X-AleNote-Client` bei Sync-Anfragen verhindert, dass das eigene Gerät seine `change`-Meldung bekommt. Die Referenz-Implementierung ist [`src/core/live.js`](../src/core/live.js).

## Notiz-Format (`content`)

```json
{
  "version": 1,
  "icon": "📝",
  "cover": { "type": "gradient", "value": "aurora" },
  "blocks": [
    { "id": "a1", "type": "h1", "data": { "text": "Titel" } },
    { "id": "a2", "type": "paragraph", "data": { "text": "Text mit <b>HTML</b>-Formatierung" } },
    { "id": "a3", "type": "todo", "data": { "text": "Aufgabe", "checked": false } },
    { "id": "a4", "type": "table", "data": { "header": true, "rows": [["A", "B"], ["1", "2"]] } },
    { "id": "a5", "type": "image", "data": { "src": "alenote://asset/xyz.png", "width": 80 } }
  ],
  "floats": [{ "id": "f1", "src": "alenote://asset/abc.png", "x": 400, "y": 120, "w": 240, "rot": 5 }]
}
```

Der Notiztitel ist der Dateiname ohne `.alenote`.
Bilder werden mit `alenote://asset/<name>` referenziert und über `/api/sync/asset/<name>` geladen.

## Admin (nur Rolle `admin`)

| Methode | Pfad |
|---|---|
| GET | `/api/admin/stats` |
| GET / POST | `/api/admin/users` |
| PATCH / DELETE | `/api/admin/users/<id>` |
| GET | `/api/admin/sessions` |
| DELETE | `/api/admin/sessions/<id>` |
| GET / PATCH | `/api/admin/settings` |

## App-Updates

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/updates/latest.yml` | Update-Info für electron-updater (öffentlich) |
| GET | `/updates/<datei>` | Setup-EXE / Blockmap (öffentlich, mit Range-Unterstützung) |
| GET | `/api/admin/updates` | Status (Admin) |
| POST | `/api/admin/updates/check` | neuestes GitHub-Release übernehmen (Admin) |
| PUT | `/api/admin/updates/file/<name>` | Datei manuell hochladen (Admin) |
