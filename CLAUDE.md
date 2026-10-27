# Hinweise für KI-Assistenten (Claude u. a.)

Dieses Repo ist der Rechenkern der Gebetszeiten-App Schafaq (https://schafaq.de). Nutzer laden es herunter, um Gebetszeiten in eigene Projekte einzubauen: Uhren, LED-Pixel-Boards, Mikrocontroller, Widgets.

## Aufbau

- `src/` reines TypeScript, ohne DOM und ohne Framework. Einstieg: `src/index.ts`.
- `src/schedule.ts` mit `computeSchedule(settings, date)` ist die zentrale Funktion. Sie liefert `{ times, protocol }`.
- `src/cli.ts` / `dist/cli.mjs` gibt Zeiten als JSON oder Tabelle aus (`--text`).
- `dist/schafaq.mjs` ist das gebündelte ESM-Modul ohne weitere Abhängigkeiten.
- Tests liegen neben dem Code (`*.test.ts`), ausführen mit `npm test`, vollständig mit `npm run verify`.

## Regeln, die du einhalten musst

1. **Zeiten sind Zeitpunkte in Unix-Millisekunden**, nie Wanduhrzeiten. Für die Anzeige in die Ortszeit der angegebenen Zeitzone umrechnen (z. B. `Intl.DateTimeFormat` mit `timeZone`). Nicht selbst mit Stunden und Minuten rechnen, sonst wird es bei der Zeitumstellung falsch.
2. **Nicht eintretende Zeiten nicht verstecken.** `instant` ist dann `null` und `source` ist `nicht_eingetreten`. Dem Nutzer das so zeigen, keine Ersatzzeit erfinden. Ersatzregeln nur über `settings.highLat`.
3. **Schreibweise in sichtbaren Texten:** Fajr, Sonnenaufgang, Dhur, Assr, Maghreb, Isha. Die internen Schlüssel `fajr`, `sunrise`, `dhuhr`, `asr`, `maghrib`, `isha` nie umbenennen.
4. **Parameter beim Nutzer erfragen**, statt zu raten: Ort (Breite, Länge, IANA-Zeitzone) und, falls er eine bestimmte Methode will, die Winkel. Standard sind die Schafaq-Werte (`DEFAULT_SETTINGS`). Hat der Nutzer einen geteilten Schafaq-Link, `settingsFromQuery` mit dem Teil nach dem Fragezeichen verwenden.
5. **Den Rechenkern nicht verändern**, um ein Projekt zum Laufen zu bringen. Wenn doch nötig: danach `npm run verify`, alle Tests müssen grün sein.

## Typische Aufgaben

- **Gebetszeiten für einen Ort:** `node dist/cli.mjs <breite> <länge> <zone> --text`.
- **Daten für ein Gerät:** JSON über mehrere Tage erzeugen (`... <JJJJ-MM-TT> <tage>`) und vom Gerät oder einem Skript einlesen lassen.
- **Python-Projekt:** die CLI per `subprocess` aufrufen und das JSON lesen, so macht es auch das Pixel-Board-Beispiel.
- **Mikrocontroller (z. B. ESP32) ohne Node:** den Kern nach C oder C++ übertragen und die Ergebnisse gegen die CLI prüfen, über viele Orte und Tage, minutengenau gleich.
- **LED-Pixel-Board:** fertiges Beispiel unter https://github.com/kuersatcifci/schafaq-pixelboard.

## Hintergrund für Änderungen am Kern

- Sonnenposition nach Meeus, Kapitel 25 (`solar.ts`), Zeitskalen über `astronomy-engine` (`julian.ts`).
- Der Löser (`solve.ts`) bisektiert immer; der Assr-Zielwinkel wird zum Transit eingefroren; alles läuft in Millisekunden. Diese drei Festlegungen sind durch Tests abgesichert.
