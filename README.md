# Netzwerkplan

Desktop-App zum Erstellen von Netzwerkplaenen fuer Windows, macOS und Linux.

## Funktionen

- Geraete einfuegen: Router, Switch, Server, Firewall, Client und Cloud
- Geraete per Drag-and-drop auf der Zeichenflaeche anordnen
- Verbindungen zwischen Geraeten erstellen und typisieren
- Eigenschaften wie Name, IP-Adresse, Rolle, Notizen und Link-Label bearbeiten
- Projekt als `.nplan` speichern und wieder laden
- Export als SVG oder PNG
- Zoom, Pan, Einpassen, Rueckgaengig/Wiederholen

## Entwicklung starten

```bash
npm install
npm run desktop
```

## App bauen

```bash
npm run build
```

Vor jedem Build wird der Ordner `release/` automatisch geleert, damit dort nur die aktuell gebauten Pakete liegen.

Plattformspezifisch:

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

Hinweis: Windows-Installer baut man am besten auf Windows, Linux-Pakete auf Linux und macOS-Pakete auf macOS. Der lokale macOS-Build ist absichtlich unsigniert. Fuer eine oeffentliche Verteilung sollten Code Signing und Notarization eingerichtet werden.

## Updates ueber GitHub

Die App prueft beim Start automatisch, ob im GitHub-Repository `indextorben/Netzwerkplan` ein neueres Release vorhanden ist. Wird eine neue Version gefunden, wird sie heruntergeladen und die App bietet einen Neustart zur Installation an.

Fuer ein neues Update:

1. Versionsnummer in `package.json` erhoehen, z. B. von `1.0.0` auf `1.0.1`.
2. App bauen:

```bash
npm run build
```

3. Die Dateien aus `release/` als GitHub Release zur passenden Version veroeffentlichen.

Auf macOS sollten Release-Builds fuer verlaessliche automatische Updates signiert und notarisiert werden.

## Projektdateien

- `src/main.js`: Electron-Hauptprozess und Datei-Dialoge
- `src/preload.js`: sichere Bridge zwischen App und Renderer
- `src/index.html`: App-Struktur
- `src/styles.css`: Oberflaeche
- `src/app.js`: Diagramm-Logik
