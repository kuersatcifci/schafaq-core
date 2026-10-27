/**
 * Anzeige. Das einzige Modul, das aus Zeitpunkten Wanduhrzeiten macht.
 *
 * Der Rechenkern kennt nur Millisekunden seit Epoch. Erst hier wird in die Zone
 * des ORTES formatiert, nicht in die des Geraets. Wer in Berlin sitzt und Zeiten
 * fuer Istanbul rechnet, bekommt Istanbuler Uhrzeiten.
 */

import { instantToLocalParts } from './timezone';
import type { TimeKey } from './schedule';

export const LABELS: Record<TimeKey, string> = {
  fajr: 'Fajr',
  sunrise: 'Sonnenaufgang',
  dhuhr: 'Dhur',
  asr: 'Assr',
  maghrib: 'Maghreb',
  isha: 'Isha',
  nachtmitte: 'Mitte der Nacht',
  letztes_drittel: 'Letztes Nachtdrittel',
};

/**
 * Kurze Erlaeuterung je Zeit.
 *
 * Bewusst KURZ und ungefaehr gleich lang. In der Liste steht je Zeit genau eine
 * Zeile, und alle Zeilen sind gleich hoch. Vorher war die Assr-Erklaerung
 * doppelt so lang wie die uebrigen und brach um; diese eine Zeile machte ihre
 * Zeile hoeher als alle anderen und die ganze Liste unruhig.
 *
 * Ausfuehrlich steht alles unter /methoden/, hier reicht das Stichwort.
 */
export const DEFINITIONS: Record<TimeKey, string> = {
  fajr: 'Wahres Morgengrauen bis Sonnenaufgang.',
  sunrise: 'Oberkante der Sonne am Horizont.',
  dhuhr: 'Nach dem Sonnenhöchststand.',
  asr: 'Schattenzuwachs über den Mittagsschatten.',
  maghrib: 'Sonnenscheibe vollständig untergegangen.',
  isha: 'Abenddämmerung verschwunden.',
  nachtmitte: 'Hälfte zwischen Maghreb und Fajr.',
  letztes_drittel: 'Letztes Drittel derselben Nacht.',
};

export interface FormattedTime {
  /** "05:12", oder null wenn nichts eintritt. */
  text: string | null;
  /** Um wie viele Kalendertage der Zeitpunkt vom angefragten Datum abweicht. */
  dayShift: number;
  /** "Folgetag" oder "Vortag", wenn dayShift nicht null ist. */
  dayNote: string | null;
}

const zweistellig = (n: number) => String(n).padStart(2, '0');

/** Uhrzeit in der Zone des Ortes. */
export function formatTime(instant: number | null, zone: string): string | null {
  if (instant === null) return null;
  const p = instantToLocalParts(zone, instant);
  return `${zweistellig(p.hour)}:${zweistellig(p.minute)}`;
}

/**
 * Uhrzeit samt Hinweis auf einen Tageswechsel.
 *
 * Isha rutscht in Deutschland im Sommer bis dicht an Mitternacht und bei
 * kleineren Winkeln darueber hinaus. Ohne diesen Hinweis wirkt die Tabelle
 * fehlerhaft, obwohl sie stimmt.
 */
export function formatWithDayShift(
  instant: number | null,
  zone: string,
  dayShift: number,
): FormattedTime {
  return {
    text: formatTime(instant, zone),
    dayShift,
    dayNote: dayShift === 0 ? null : dayShift > 0 ? 'Folgetag' : 'Vortag',
  };
}

/** Datum als "Sonntag, 21. Juni 2026" in der Zone des Ortes. */
export function formatDate(instant: number, zone: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(instant));
}

/** Dauer als "7 h 35 min". Fuer Nachtlaengen und uebertragene Zeitdifferenzen. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  const total = Math.round(Math.abs(ms) / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const vorzeichen = ms < 0 ? '-' : '';
  return h > 0 ? `${vorzeichen}${h} h ${m} min` : `${vorzeichen}${m} min`;
}

/**
 * Restzeit in Worten, fuer den Kopf der Startseite.
 *
 * Sekunden erst in der letzten Viertelstunde: Den ganzen Tag ueber sind sie
 * eine Ziffer, die sich sechzigmal je Minute aendert und niemandem hilft. Kurz
 * vor der Zeit zaehlt man dagegen wirklich herunter.
 *
 * Steht hier und nicht in einer Komponente, weil inzwischen vier Startseiten
 * dieselbe Zahl anzeigen. Vorher stand die Funktion in JetztLeiste.svelte, und
 * drei Kopien davon waeren drei Gelegenheiten, dass eine anders rundet.
 */
export function restzeitText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sek = s % 60;
  if (s < 15 * 60) {
    return h > 0 ? `${h} Std. ${m} Min.` : `${m}:${String(sek).padStart(2, '0')} Min.`;
  }
  if (h === 0) return `${m} Min.`;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

/** Gradzahl mit Gradzeichen und deutschem Dezimalkomma. */
export function formatDegrees(deg: number | null, digits = 2): string | null {
  if (deg === null || !Number.isFinite(deg)) return null;
  return `${deg.toFixed(digits).replace('.', ',')}°`;
}

/** Kurzer Satz, warum eine Zeit nicht eintritt. */
export function explainMissing(marginDeg: number, targetAngle: number, hMin: number): string {
  return (
    `Die Sonne sinkt an diesem Tag nur bis ${formatDegrees(hMin)} unter den Horizont. ` +
    `Die geforderten ${formatDegrees(-Math.abs(targetAngle))} werden um ${formatDegrees(marginDeg)} verfehlt.`
  );
}
