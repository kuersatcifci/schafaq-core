// Beispiel: Welches Gebet kommt als Nächstes, und wie lange noch?
// Aufruf nach `npm run build`: node beispiele/naechstes-gebet.mjs 50.11 8.682 Europe/Berlin
import { computeSchedule, DEFAULT_SETTINGS } from '../dist/schafaq.mjs';

const [lat = '50.11', lon = '8.682', zone = 'Europe/Berlin'] = process.argv.slice(2);
const NAMEN = { fajr: 'Fajr', sunrise: 'Sonnenaufgang', dhuhr: 'Dhur', asr: 'Assr', maghrib: 'Maghreb', isha: 'Isha' };
const settings = { ...DEFAULT_SETTINGS, location: { latitude: Number(lat), longitude: Number(lon), zone } };

const jetzt = Date.now();
const heute = new Date();
for (let i = 0; i < 2; i++) {
  const tag = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + i);
  const { times } = computeSchedule(settings, { year: tag.getFullYear(), month: tag.getMonth() + 1, day: tag.getDate() });
  const naechstes = times.find((t) => t.key in NAMEN && t.instant !== null && t.instant > jetzt);
  if (naechstes) {
    const minuten = Math.ceil((naechstes.instant - jetzt) / 60000);
    const uhr = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(naechstes.instant);
    console.log(`${NAMEN[naechstes.key]} um ${uhr}, in ${Math.floor(minuten / 60)} h ${minuten % 60} min`);
    break;
  }
}
