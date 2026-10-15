# Klassenmanager

Eine Web-App für Lehrpersonen: Klassen verwalten, Anwesenheit erfassen und auswerten, Prüfungen und Bonuspunkte führen, faire Teams bilden und Sitzordnungen planen.

*(früher "Team Generator" — umbenannt, weil die App deutlich mehr kann als Teams zu generieren)*

**Warum Klassenmanager?** Kostenlos, ohne Konto und ohne Werbung. Alle Daten bleiben auf dem eigenen Gerät, die App lädt nichts von fremden Servern und läuft nach der Installation auch ohne Internet, z.B. in der Turnhalle. Zum Ausprobieren genügt ein Klick auf **"Beispielklasse anlegen"**.

- **Geräte:** Die App ist für **Laptop** und **Tablet** gedacht. Auf dem **Smartphone** ist die **Anwesenheit** voll nutzbar (die App startet dort direkt in diesem Reiter); Sitzordnung und Tabellen planst du besser am grösseren Bildschirm.
- **Hell oder dunkel:** Folgt der Systemeinstellung, umschaltbar über den Mond/Sonne-Knopf oben rechts.
- **Technik:** Reine Client-App (HTML/CSS/JavaScript), kein Server und kein Konto nötig.
- **Daten:** Alle Daten bleiben im `localStorage` des Browsers, optional zusätzlich in einer lokalen Datei.
- **Offline und installierbar:** Es werden keine externen Ressourcen geladen (Schriften, Icons und Styles sind gebündelt). Als gehostete Version (https) läuft die App dank Service Worker auch ohne Netz und lässt sich über **"App installieren"** (oben rechts, Chrome/Edge) bzw. *Teilen → Zum Home-Bildschirm* (iPad) wie eine normale App starten.
- **Schnell:** Die ganze App lädt rund 500 KB (früher über 800 KB), weil die Symbole als Subset ausgeliefert werden (11 KB statt 375 KB). Beim Erfassen der Anwesenheit wird nur die angeklickte Karte neu gezeichnet, und die automatische Sitzordnung bewertet beim Optimieren nur die betroffenen Nachbarplätze neu.

## Übersicht

Die App hat sieben Reiter. Die Leiste bleibt beim Scrollen oben stehen.

| Reiter | Wofür |
|---|---|
| **Klassen** | Klassen, Schüler(innen), Wochenplan, Unterrichtsart, Import/Export |
| **Anwesenheit** | Anwesenheit pro Termin erfassen, Termine importieren |
| **Auswertung** | Anwesenheitsstatistik pro Klasse, nach Semester/Kürzel filtern, CSV-Export |
| **Prüfungen** | Prüfungen/Lernzielkontrollen mit Noten-Auswertung und TXT-Export |
| **Punkte** | Punkte-Tracker für Bonusstunden mit Verlaufs-Graph |
| **Sitzordnung** | Visueller Sitzplan, automatische Zuteilung, speichern, präsentieren |
| **Teams** | Faire Zufallsteams, "Wer ist dran?"-Zufallsauswahl, Klassen direkt laden, präsentieren |

Jeder Reiter hat eine eigene Adresse (z.B. `…/#teams`), die beim Neuladen erhalten bleibt und sich als Lesezeichen speichern lässt. Die installierte App bietet Schnellzugriffe auf Anwesenheit, Teams und Sitzordnung.

## Funktionen

### Klassen
- **Beispielklasse** (20 Schüler(innen) mit Hobbys, Wochenplan und Punkte-Tracker) zum Ausprobieren, später einfach löschen.
- **Einführungstour** beim ersten Start (drei Schritte), jederzeit erneut über die **Hilfe** (`?` oben rechts) mit allen Tastenkürzeln.
- Klassen anlegen, umbenennen, löschen; Schüler(innen) einzeln oder per Mehrfach-Import (Text) hinzufügen und wieder entfernen.
- **Wochenplan** pro Klasse (ein oder mehrere Wochentag/Uhrzeit-Termine).
- **Unterrichtsart** pro Klasse: *Sport*, *Klassenzimmer* oder *beides* (Standard). Die Sitzordnung zeigt nur Klassen mit Klassenzimmer-Unterricht.
- Pro Schüler(in): **Geschlecht**, **sportlich** (Läufer-Symbol) und **Hobbys/Sportarten** (Ball-Symbol, z.B. "Fussball, Tennis"). Beides fliesst in die Team-Bildung ein.
- **Klassenkürzel**: Mischt eine Gruppe mehrere Schulklassen (z.B. Sport 7a+7b), lässt sich pro Person ein Kürzel setzen (Feld "Klasse", `Max m [7b]` im Mehrfach-Import, 5. CSV-Spalte oder Tag-Symbol). Auswertung und Prüfungen können danach pro Kürzel getrennt werden.
- **Bearbeiten:** Ein Klick auf eine Person öffnet den Dialog für Name, Geschlecht, Klassenkürzel, Hobbys und Sportlich (und zum Entfernen). Beim Umbenennen werden "Nicht zusammen"-Regeln mitgeführt.
- **Geschlecht "ohne Angabe"** ist möglich und ist der Standard, wenn beim Import nichts angegeben ist. Diese Personen zählen bei Teams und Sitzordnung neutral.
- Gleiche Vornamen sind nach Rückfrage möglich, am besten mit Initial unterscheiden ("Lena M").
- Entfernte Schüler(innen) mit erfasster Anwesenheit oder Prüfungsergebnissen bleiben als **"ehemalig"** in den Auswertungen sichtbar.

### Import und Export
- Klassen als **JSON** exportieren und importieren (inkl. Wochenplan, Unterrichtsart, Punkte-Tracker, Sportlich-Markierung, Hobbys).
- Import auch als **CSV/TXT**: `Klasse;Name;Geschlecht;Sportlich;Kürzel;Hobbys`. Sportlich ist optional (`s`/`ja`/`x`/`1`), Hobbys werden mit `/` getrennt, eine Kopfzeile wird erkannt. Trennzeichen `;`, `,` oder Tab; Felder in Anführungszeichen (z.B. `"Meier, Tom"`) und das BOM von Excel-Dateien werden korrekt gelesen.
- **Termin-Import:** Vergangene Anwesenheitschecks als CSV (aus Excel: *Speichern unter → CSV*), Format `Datum;Name;Status;Grund;Notiz`. Hilfe über das Fragezeichen im Anwesenheits-Reiter.

### Anwesenheit
- Pro Klasse und Datum ein eigener Termin (beliebig viele). Ein Klick wechselt den Status: **anwesend (grün) → abwesend (rot) → verletzt (orange)**.
- *Verletzt* heisst: anwesend, macht aber nicht mit. Diese Personen zählen als anwesend, werden aber nicht in Teams übernommen.
- Bei Abwesenheit ein **Grund** (Krank, Verletzt, Entschuldigt, Schnuppern, Unentschuldigt, Sonstiges) plus Notiz.
- **Gemeinsame Klassenwahl:** Die zuletzt gewählte Klasse ist in allen Reitern vorausgewählt. Hat eine Klasse laut Wochenplan gerade Unterricht, schlägt der Reiter sie vor.
- Die **Speichern-Leiste** bleibt beim Scrollen unten sichtbar. Ein Datum in der Zukunft wird vor dem Speichern bestätigt.
- Hinweis, wenn das Datum nicht zum Wochenplan passt. Termine lassen sich erneut öffnen, bearbeiten und löschen (mit Rückgängig).
- Ungespeicherte Änderungen werden angezeigt; vor Verlust wird gewarnt.

### Auswertung
- Anwesenheit, Abwesenheit, Quote, Anzahl Termine und Aufschlüsselung der Gründe pro Person, mit Durchschnittszeile, sortierbaren Spalten und CSV-Export.
- Filter nach **Semester 1** (Aug–Jan) oder **Semester 2** (Feb–Jul) und nach Klassenkürzel.

### Prüfungen
- Titel und Datum, wahlweise mit **Punkten und Maximum** (Note nach Schweizer Formel `5 × Punkte ÷ Max + 1`, auf Zehntel gerundet) oder mit **direkter Noteneingabe** (1–6).
- Auswertung: Anzahl bewertet, Ø-Note, Minimum, Maximum, Anzahl ungenügend, bei gemischten Gruppen zusätzlich pro Kürzel.
- Ungültige Eingaben (z.B. mehr Punkte als das Maximum) werden rot markiert und überschreiben nie einen bereits gespeicherten Wert.
- **TXT-Export** im Format `Name Punkte` bzw. `Name Note`. Bei mehreren Kürzeln entsteht pro Kürzel eine Datei.

### Punkte (Bonusstunden)
- Pro Klasse aktivierbar. Pro Lektion werden erfüllte Ziele abgehakt (frei anpassbar, je **1 oder 2 Punkte**).
- Der Stand wird als **Verlaufs-Graph** gezeigt. *Punkte einlösen* setzt auf 0 zurück, der Verlauf bleibt erhalten.
- *Punkte anpassen* fügt pauschal Punkte hinzu oder zieht sie ab (z.B. Startstand). Der Stand fällt nie unter 0.

### Sitzordnung
- Pro Klasse ein Raster (bis 16 × 12): Tische per Klick **setzen oder entfernen**, oder eine **Vorlage** wählen (Reihen, Gruppentische, U-Form). **"Alle Tische löschen"** beginnt von vorn.
- **Plätze tauschen:** Person mit Maus oder Finger auf einen anderen Tisch **ziehen** (oder zwei Tische nacheinander anklicken). Auf "Ohne Platz" ziehen gibt den Platz frei; das Schloss **fixiert** einen Platz.
- **Automatisch erstellen** mit Optionen: Jungen/Mädchen abwechselnd, "Nicht zusammen"-Regeln beachten, nur Anwesende vom letzten Termin. Fixierte Plätze bleiben.
- Der aktuelle Plan wird **automatisch gespeichert**. Zusätzlich lassen sich pro Klasse beliebig viele benannte **Tischanordnungen** (nur Tische) und **Sitzordnungen** (Tische + Personen) ablegen und wieder laden.
- **Export** als **PNG** oder **PDF** (A4 quer, neutrale Darstellung ohne Geschlechtsfarben), Drucken und **Präsentationsmodus** (siehe unten).

### Teams
- Quellen: anwesende Schüler(innen) aus dem Anwesenheits-Reiter, **direkt gewählte Klassen** (auch mehrere kombiniert) oder manuell hinzugefügte Personen.
- Aufteilung nach **Anzahl Teams** oder **Personen pro Team**; kopieren, drucken, neu mischen.
- **"Wofür sind die Gruppen?"**: *Kein Sport*, *Sport — allgemeines Spiel* (Sportlichkeit fair verteilen) oder eine **konkrete Sportart** (erscheint, sobald Hobbys erfasst sind). Optional werden auch Geschlechter fair verteilt.
- **"Nicht zusammen"-Regeln** halten Paare in verschiedenen Teams.
- Werden Klassen mit gleichen Namen kombiniert, erhalten die Namen die Klasse in Klammern ("Anna (7a)"), damit Anzeige und Regeln eindeutig bleiben.
- **"Wer ist dran?"** zieht zufällig eine Person aus der Teilnehmerliste und zeigt sie gross im Präsentationsmodus. Niemand kommt doppelt dran, bis alle einmal gezogen wurden. **Leertaste** zieht die nächste Person.
- Sportlichkeit und Hobbys sind im Teams-Reiter bewusst **nicht sichtbar**, damit sie beim Projizieren nicht auffallen.

### Timer
Über **"Timer"** oben rechts: **Countdown** (Vorgaben von 30 s bis 15 min, ±1 min) oder **Stoppuhr**, gross für den Beamer. Mit mehreren **Stationen/Runden** startet nach jedem Ablauf automatisch die nächste Runde; sind Teams erstellt, zeigt die App, welches Team an welcher Station ist. Signalton am Ende, der Bildschirm bleibt während des Laufens an. **Leertaste** = Start/Pause, **R** = zurücksetzen.

### Präsentationsmodus
Bei Sitzordnung und Teams zeigt **"Präsentieren"** das Ergebnis im Vollbild für den Beamer: grosse Namen, keine Sport- oder Geschlechtshinweise. **Esc** oder "Schliessen" beendet.

### Backup und Datendatei
- **Komplett-Backup** (Fusszeile): alle Daten als JSON sichern, **optional mit Passwort verschlüsselt** (AES-GCM), und auf einem anderen Gerät wiederherstellen.
- **Rückgängig** ist nur möglich, solange seither nichts anderes geändert wurde (sonst gingen spätere Änderungen verloren).
- **Backup-Erinnerung:** Wurde seit 30 Tagen kein Backup erstellt (und ist keine Datendatei verbunden), erinnert die App höchstens einmal pro Woche daran. Zusätzlich bittet sie den Browser, die Daten nicht automatisch zu löschen (`navigator.storage.persist`).
- **Automatische Datendatei** (Chrome/Edge): Eine JSON-Datei auf der Festplatte verbinden, z.B. im Dokumente-Ordner. Danach wird jede Änderung automatisch dorthin geschrieben und beim Start geladen. Weicht die Datei vom Browser-Stand ab, fragt die App, welcher gelten soll. In Safari und Firefox fehlt die Funktion; dort gelten `localStorage` und das manuelle Backup.

## Sicherheit und Datenschutz

- **Keine externen Requests:** Tailwind ist vorkompiliert, Font Awesome (als Subset) und Inter liegen lokal in `vendor/`. Es fliessen keine IP-Adressen an Drittanbieter (relevant für DSG/DSGVO im Schulkontext).
- Namen, Notizen und importierte Daten werden nur als Text ins DOM eingefügt (kein XSS über Schülernamen).
- Importe (Klassen und Backups) werden strikt validiert; ungültige Werte werden verworfen oder normalisiert.
- CSV-Exporte sind gegen Formel-Injection abgesichert.
- Strikte Content-Security-Policy (`default-src 'self'`).
- Keine Daten gehen an einen Server. Der `localStorage` selbst ist **unverschlüsselt**: Auf geteilten Geräten nach Gebrauch die Browserdaten löschen. Backups mit Passwort verschlüsseln, da sie sensible Daten (Abwesenheitsgründe) enthalten.

## Lokal starten

**Mac, ohne Terminal:** Im Finder `Klassenmanager.app` im Projektordner doppelklicken. Der Klassenmanager öffnet sich im Browser unter http://localhost:8000. Es geht kein Terminalfenster auf: Ein kleiner Server läuft unsichtbar im Hintergrund weiter, bis zum Abmelden oder Neustart. Erneutes Öffnen der App öffnet nur den Browser.

- Für schnellen Zugriff die App **ins Dock ziehen**. Die App selbst muss im Projektordner bleiben.
- Wurde das Projekt als ZIP heruntergeladen, blockiert macOS die App beim ersten Mal. Dann **Rechtsklick > Öffnen > Öffnen** wählen (nur einmal nötig).
- Die App nutzt Python 3 und sonst das auf dem Mac vorinstallierte Ruby. Klappt beides nicht, einmalig `xcode-select --install` ausführen.
- Den Server vorzeitig beenden: Aktivitätsanzeige öffnen, nach `python` (bzw. `ruby`) suchen und beenden. Protokoll: `~/Library/Logs/Klassenmanager.log`.
- Immer über die App starten: Die Daten hängen an der Adresse `localhost:8000`.

Von Hand:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Alternativ `index.html` direkt im Browser öffnen. Achtung: Der Browser speichert die Daten dann getrennt von `localhost:8000`, die Klassen sind dort also nicht sichtbar.

Auf `localhost` wird bewusst **kein Service Worker** registriert (alte Worker und Caches werden entfernt). So zeigt der Browser nach Code-Änderungen sofort die neuen Dateien. Nach Änderungen genügt ein normales Neuladen, bei Bedarf Cmd/Strg+Shift+R.

## Entwicklung

```bash
npm install          # einmalig (nur Tailwind als Dev-Dependency)
npm run build:css    # Tailwind neu kompilieren (nach Änderungen an index.html/app.js/core.js)
npm run build:icons  # Font-Awesome-Subset neu bauen (nach neuen Symbolen; braucht: pip install fonttools brotli)
npm test             # Unit-Tests (Parser, Validierung, Team-Verteilung, Sitzordnung)
```

Struktur:
- `index.html` / `style.css` — Oberfläche und eigene Styles.
- `core.js` — reine, DOM-freie Logik (Parser, Backup-Validierung, Team-Verteilung, Sitzordnungs-Zuteilung); wird von den Tests direkt geladen.
- `app.js` — UI und Zustand, nutzt `window.TG` aus `core.js`.
- `vendor/` — gebündelte Assets. `vendor/tailwind.css` und `vendor/fontawesome/css|webfonts/` sind Build-Artefakte (`npm run build:css` bzw. `npm run build:icons`) und werden mit eingecheckt. Die Original-Dateien von Font Awesome liegen in `vendor/fontawesome/source/`.
- `scripts/build-icons.py` — sucht die verwendeten `fa-…`-Symbole in `index.html`/`app.js` und erzeugt CSS und Schrift nur mit diesen.
- `theme.js` — setzt Hell/Dunkel vor dem ersten Zeichnen (kein Aufblitzen).
- `sw.js` / `manifest.webmanifest` / `icon.svg` / `icons/` — PWA und Offline-Betrieb. Bei geänderten Dateinamen die Liste und `CACHE_NAME` in `sw.js` anpassen.
- `tests/core.test.js` — Unit-Tests (`node:test`).
- `Klassenmanager.app` — Mac-Starter (siehe „Lokal starten“); das eigentliche Skript liegt in `Contents/MacOS/Klassenmanager`.

## Online hosten

Die App besteht nur aus statischen Dateien und lässt sich kostenlos hosten.

**GitHub Pages**
1. Repository auf GitHub pushen.
2. Unter *Settings → Pages* den Branch `main` (Ordner `/root`) wählen.
3. Die App ist unter `https://<username>.github.io/<repo>/` erreichbar.

**Netlify / Vercel**
1. Repository importieren.
2. Kein Build-Schritt nötig (Framework "None"/"Static"), Publish-Verzeichnis `.`
3. Deployen.

Die gehostete Version lässt sich im Browser als App installieren (Manifest + Icon) und läuft nach dem ersten Aufruf offline.

## Datenformat für den Klassen-Import (JSON)

```json
[
  {
    "name": "7a",
    "kind": "both",
    "collectsPoints": false,
    "schedule": [
      { "weekday": 0, "time": "10:00" }
    ],
    "students": [
      { "name": "Anna", "gender": "female", "sporty": true, "hobbies": ["Fussball", "Tennis"], "classTag": "7a" },
      { "name": "Max", "gender": "male", "sporty": false },
      "Lena M"
    ]
  }
]
```

- Pflicht ist nur `name`. Alle anderen Felder sind optional.
- `gender`: `female`, `male`, `diverse` oder `unknown` (ohne Angabe, Standard).
- `kind`: Unterrichtsart, `sport`, `room` (Klassenzimmer) oder `both` (Standard).
- `collectsPoints`: `true` aktiviert den Punkte-Tracker.
- `weekday`: `0` = Montag … `6` = Sonntag.
- `classTag`: Klassenkürzel bei gemischten Gruppen (max. 20 Zeichen).
- Schüler(innen) dürfen auch nur als Name (Text) angegeben werden.
- Gibt es die Klasse schon, werden nur fehlende Schüler(innen) ergänzt.
