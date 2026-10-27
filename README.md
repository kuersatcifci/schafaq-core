# Schafaq-Kern

Der Rechenkern der Gebetszeiten-App [Schafaq](https://schafaq.de) als freie Bibliothek unter MIT-Lizenz.

Er berechnet islamische Gebetszeiten aus Koordinaten und selbst gesetzten Parametern und liefert zu jeder Zeit das vollständige Rechenprotokoll. Keine Blackbox: Jeder Zwischenwert ist einsehbar. Wo eine Zeit astronomisch nicht eintritt, etwa Isha im Sommer im hohen Norden, sagt der Kern das offen, statt still eine Ersatzregel anzuwenden.

Gedacht für eigene Projekte: Gebetszeiten-Uhren, LED-Pixel-Boards, Mikrocontroller, Widgets, Smart Home.

*English version below.*

## Über dieses Projekt

Dieses Projekt soll eine Sadaqatu Jariya werden und andere inspirieren, weiterzumachen. Deshalb seid ihr herzlich eingeladen, an diesem Projekt mitzuwirken und eure Gedanken und Rückmeldungen mitzugeben: als [Hinweis oder Frage](../../issues) oder als Änderungsvorschlag (Pull Request). Der Code liegt hier offen auf GitHub. Er kostet nur eine Dua.

Möge Allah es zu einem Gewinn für die Ummah machen.

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
git clone https://github.com/kuersatcifci/schafaq-core.git
cd schafaq-core
npm install
npm run build
node dist/cli.mjs 50.11 8.682 Europe/Berlin --text
```

Ausgabe (Frankfurt am Main, 28.10.2026, Schafaq-Standard):

```
2026-10-28
  Fajr           05:57
  Sonnenaufgang  07:08
  Dhur           12:10
  Assr           14:41
  Maghreb        17:09
  Isha           18:21
```

Ohne `--text` kommt JSON, mit den Zeiten als Unix-Millisekunden. Das ist die bequemste Form für eigene Geräte:

```bash
node dist/cli.mjs <breite> <länge> <zeitzone> [JJJJ-MM-TT] [tage] [--text] [--einstellungen "<query>"]
```

## Als Bibliothek

```js
import { computeSchedule, DEFAULT_SETTINGS } from './dist/schafaq.mjs';

const settings = {
  ...DEFAULT_SETTINGS,
  location: { latitude: 50.11, longitude: 8.682, zone: 'Europe/Berlin' },
};
const { times, protocol } = computeSchedule(settings, { year: 2026, month: 10, day: 28 });

for (const t of times) console.log(t.key, t.instant, t.source);
```

Jeder Eintrag in `times` hat einen Schlüssel (`fajr`, `sunrise`, `dhuhr`, `asr`, `maghrib`, `isha`, dazu `nachtmitte` und `letztes_drittel`), den Zeitpunkt `instant` in Millisekunden und die Quelle: `berechnet`, `ersatzregel` oder `nicht_eingetreten`. `protocol` enthält Eingaben, Methode, Annahmen und jeden Rechenschritt.

Wer TypeScript nutzt, importiert direkt aus `src/index.ts`.

## Einstellungen

| Parameter | Bedeutung | Schafaq-Standard |
|---|---|---|
| `params.fajrAngle` | Sonnenstand unter dem Horizont für Fajr, in Grad | 12 |
| `params.ishaAngle` | Sonnenstand unter dem Horizont für Isha, in Grad | 12 |
| `params.asrFactor` | Schattenfaktor für Assr (1 oder 2) | 1 |
| `params.dhuhrOffsetMin` | Zuschlag auf Dhur in Minuten | 0 |
| `params.elevationMeters` | Höhe über dem sichtbaren Horizont | 0 |
| `highLat` | Ersatzregel, wenn eine Zeit nicht eintritt | siehe `DEFAULT_HIGHLAT` |
| `rounding` | Rundung auf volle Minuten | aufwärts |

Andere Einrichtungen rechnen mit anderen Winkeln, zum Beispiel die Muslim World League mit 18° für Fajr und 17° für Isha oder ISNA mit je 15°. Alles ist frei einstellbar.

Einstellungen aus der Schafaq-App lassen sich direkt übernehmen: In der App den Link zur Rechnung teilen und den Teil nach dem Fragezeichen übergeben:

```bash
node dist/cli.mjs 50.11 8.682 Europe/Berlin --einstellungen "fajr=18&isha=17&asr=1" --text
```

## Mit Claude oder anderen KI-Assistenten

Das Repo ist so aufgebaut, dass ein KI-Assistent es ohne Vorwissen nutzen kann. Die Datei [`CLAUDE.md`](CLAUDE.md) erklärt ihm, wie der Kern arbeitet und worauf er achten muss. Zum Beispiel:

> Lade github.com/kuersatcifci/schafaq-core herunter und baue mir damit eine Gebetszeiten-Anzeige für mein LED-Pixel-Board, Ort Köln.

## Pixel Boards

Ein fertiges Beispiel für LED-Pixel-Boards (das Board von Action, B.K. Light ACT1026, 32×32, und baugleiche „iPixel Color“-Boards) gibt es als eigenes Repo: [schafaq-pixelboard](https://github.com/kuersatcifci/schafaq-pixelboard). Uhr mit nächstem Gebet, Countdown bis Sonnenaufgang, Adhan-Hinweis, Dhikr in Kalligrafie und islamische Ornamente.

## Prüfen

```bash
npm run verify   # Typprüfung, 131 Tests, Build
```

Drei Entscheidungen im Kern stammen aus Messungen und sollten nicht ohne die zugehörigen Tests geändert werden:

1. **Der Löser bisektiert immer.** Eine Abbruchbedingung auf kleinen Höhenfehler erlaubt an flachen Durchgängen mehrere Sekunden Zeitfehler.
2. **Der Assr-Zielwinkel wird eingefroren.** Er folgt aus der Deklination zum Transit, weil der Mittagsschatten per Definition der Schatten zum Zawal ist.
3. **Alles sind Zeitpunkte in Millisekunden.** Nie Wanduhrzeiten. Sonst ist die Nachtmitte in der Umstellungsnacht um 30 Minuten falsch.

## Lizenz

MIT, © 2026 Kürşat Çifçi. Frei nutzbar, auch kommerziell, solange Lizenz und Namensnennung mitgeliefert werden. Abhängigkeit: [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT).

---

## English

**About this project:** This project is meant to become a sadaqah jariyah and to inspire others to carry on. You are warmly invited to contribute and to share your thoughts and feedback, as an issue or a pull request. The code is free here on GitHub. It costs only a dua. May Allah make it a benefit for the Ummah.

**Schafaq core** is the calculation engine of the prayer times app [Schafaq](https://schafaq.de), released under the MIT license. It computes Islamic prayer times from coordinates and freely chosen parameters and returns a complete calculation protocol for every time. When a time does not occur astronomically (for example Isha in high-latitude summers), it says so openly instead of silently applying a fallback rule.

Built for your own projects: prayer clocks, LED pixel boards, microcontrollers, widgets, smart home.

```bash
git clone https://github.com/kuersatcifci/schafaq-core.git
cd schafaq-core && npm install && npm run build
node dist/cli.mjs 50.11 8.682 Europe/Berlin --text      # readable table
node dist/cli.mjs 50.11 8.682 Europe/Berlin 2026-10-28 7 # JSON, 7 days, Unix milliseconds
```

```js
import { computeSchedule, DEFAULT_SETTINGS } from './dist/schafaq.mjs';
const { times, protocol } = computeSchedule(
  { ...DEFAULT_SETTINGS, location: { latitude: 50.11, longitude: 8.682, zone: 'Europe/Berlin' } },
  { year: 2026, month: 10, day: 28 },
);
```

Defaults are Schafaq's own (Fajr and Isha at 12°, Asr factor 1); every parameter can be changed. Source comments are in German. AI assistants: read [`CLAUDE.md`](CLAUDE.md). Pixel board example: [schafaq-pixelboard](https://github.com/kuersatcifci/schafaq-pixelboard).
