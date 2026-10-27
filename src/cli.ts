/**
 * Gebetszeiten auf der Kommandozeile, fuer eigene Projekte (z. B. Pixel Boards, Mikrocontroller).
 *
 *   node dist/cli.mjs <breite> <laenge> <zeitzone> [JJJJ-MM-TT] [tage] [--text] [--einstellungen "<query>"]
 *
 * Standard ist JSON: [{ date, times: { fajr, sunrise, dhuhr, asr, maghrib, isha, ... } }],
 * Zeiten als Unix-Millisekunden (null, wenn eine Zeit astronomisch nicht eintritt).
 * Mit --text als lesbare Tabelle. Mit --einstellungen uebernimmt man die Parameter
 * aus einem geteilten Schafaq-Link (der Teil nach dem Fragezeichen).
 */
import { computeSchedule, DEFAULT_SETTINGS, settingsFromQuery, shiftDate, type Settings } from './index';

const NAMEN: Record<string, string> = {
  fajr: 'Fajr', sunrise: 'Sonnenaufgang', dhuhr: 'Dhur', asr: 'Assr', maghrib: 'Maghreb', isha: 'Isha',
};

function fehler(text: string): never {
  process.stderr.write(text + '\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const text = args.includes('--text');
const qIndex = args.indexOf('--einstellungen');
const query = qIndex >= 0 ? args[qIndex + 1] ?? '' : '';
const frei = args.filter((a, i) => !a.startsWith('--') && !(qIndex >= 0 && i === qIndex + 1));
const [lat, lon, zone, start, tage] = frei;
if (!lat || !lon || !zone) {
  fehler('Aufruf: schafaq <breite> <laenge> <zeitzone> [JJJJ-MM-TT] [tage] [--text] [--einstellungen "<query>"]');
}

const basis: Settings = query ? (() => {
  const r = settingsFromQuery(query);
  if (!r.ok) fehler(r.errors.map((e) => `${e.field}: ${e.message}`).join('\n'));
  return r.settings;
})() : DEFAULT_SETTINGS;
const settings: Settings = {
  ...basis,
  location: { latitude: Number(lat), longitude: Number(lon), zone },
};

const heute = new Date();
const [year, month, day] = (start ?? '').split('-').map(Number);
const erster = start
  ? { year, month, day }
  : { year: heute.getFullYear(), month: heute.getMonth() + 1, day: heute.getDate() };

const ergebnis = [];
for (let i = 0; i < Number(tage ?? 1); i++) {
  const date = shiftDate(erster, i);
  const result = computeSchedule(settings, date);
  const times: Record<string, number | null> = {};
  for (const t of result.times) times[t.key] = t.instant;
  ergebnis.push({ date, times });
}

if (!text) {
  process.stdout.write(JSON.stringify(ergebnis) + '\n');
} else {
  const uhr = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: zone });
  for (const { date, times } of ergebnis) {
    process.stdout.write(`${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}\n`);
    for (const key of Object.keys(NAMEN)) {
      const ms = times[key];
      process.stdout.write(`  ${NAMEN[key].padEnd(14)} ${ms === null ? 'tritt nicht ein' : uhr.format(ms)}\n`);
    }
  }
}
