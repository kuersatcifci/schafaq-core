/**
 * Ersatzregeln fuer Breiten, in denen die Daemmerungswinkel nicht erreicht werden.
 *
 * Fuer Deutschland ist das keine Randfunktion. Die kritische Breite betraegt
 * 66,56 Grad minus Winkel, also 48,56 Grad bei 18 Grad Daemmerung. Noerdlich
 * davon gibt es um die Sommersonnenwende wochenlang weder Fajr noch Isha.
 * Betroffen ist fast das gesamte Land.
 *
 * Die wichtigste Einsicht dieses Moduls, und der Fehler, den fast jede
 * Umsetzung macht: FADSCHR UND ISCHA DESSELBEN TABELLENTAGES GEHOEREN ZU ZWEI
 * VERSCHIEDENEN NAECHTEN.
 *
 *   N_vor  = Sonnenaufgang(D)   - Sonnenuntergang(D-1)   fuer Fajr(D)
 *   N_nach = Sonnenaufgang(D+1) - Sonnenuntergang(D)     fuer Isha(D)
 *
 * Wer fuer beide dieselbe Nacht nimmt, bekommt eine Verschiebung von mehreren
 * Minuten je Tag und einen unstetigen Jahresverlauf.
 *
 * Zweite Einsicht: Die Wahl der Regel ist selbst eine Rechtsfrage, keine
 * technische Entscheidung. Deshalb ist die Voreinstellung "keine": Die App sagt
 * dann ehrlich, dass das Ereignis nicht eintritt, und nennt die Fehlmarge in
 * Grad. Wer eine Regel zuschaltet, sieht am Ergebnis, dass sie gegriffen hat.
 */

import type { RawDay } from './rawDay';
import type { Existence } from './geometry';

export type HighLatRule =
  /** Nichts ersetzen, ehrlich melden. Voreinstellung. */
  | 'keine'
  | 'siebtel'
  | 'mitte'
  | 'winkelproportional'
  | 'aqrab_al_ayyam'
  /** Konvention vieler Gemeinden, keine Berechnung. */
  | 'fester_versatz';

export interface HighLatConfig {
  rule: HighLatRule;
  /** Nur fuer 'fester_versatz': Minuten vor Sonnenaufgang bzw. nach Sonnenuntergang. */
  fixedOffsetMin: number;
  /** Wie viele Tage die Aqrab-Suche hoechstens absucht. */
  maxSearchDays: number;
}

export const DEFAULT_HIGHLAT: HighLatConfig = {
  rule: 'keine',
  fixedOffsetMin: 75,
  maxSearchDays: 200,
};

export interface AppliedRule {
  rule: HighLatRule;
  /** Bei Aqrab al-Ayyam: um wie viele Tage der Fundtag entfernt liegt. */
  referenceDayOffset?: number;
  /** Uebertragene Zeitdifferenz zu Sonnenauf- oder -untergang, in Millisekunden. */
  transferredOffsetMs?: number;
  /** Falls die Regel nicht greifen konnte und ersatzweise eine andere lief. */
  fallbackFrom?: HighLatRule;
  /** Falls ein Anteil geklemmt wurde. */
  clampedFraction?: number;
}

export interface ResolvedEvent {
  instant: number | null;
  source: 'berechnet' | 'ersatzregel' | 'nicht_eingetreten';
  appliedRule: AppliedRule | null;
  existence: Existence | null;
  warnings: string[];
}

/** Zugriff auf einen ungeregelten Nachbartag. Muss ungeregelt sein, sonst Endlosrekursion. */
export type RawDayProvider = (offsetDays: number) => RawDay;

const MIN_MS = 60_000;

/**
 * Wendet die eingestellte Regel auf Fajr und Isha an, falls noetig.
 *
 * Greift nur, wenn das Ereignis rechnerisch nicht eintritt. Solange die Sonne den
 * Winkel erreicht, bleibt die Rechnung unangetastet. Sonst spraenge die Tabelle an
 * dem Tag, an dem die Regel einsetzt.
 */
export function applyHighLatitude(
  day: RawDay,
  getDay: RawDayProvider,
  config: HighLatConfig = DEFAULT_HIGHLAT,
): { fajr: ResolvedEvent; isha: ResolvedEvent } {
  return {
    fajr: resolve(day, getDay, config, 'fajr'),
    isha: resolve(day, getDay, config, 'isha'),
  };
}

function resolve(
  day: RawDay,
  getDay: RawDayProvider,
  config: HighLatConfig,
  key: 'fajr' | 'isha',
): ResolvedEvent {
  const ev = day.events[key];
  if (ev.instant !== null) {
    return {
      instant: ev.instant,
      source: 'berechnet',
      appliedRule: null,
      existence: null,
      warnings: [],
    };
  }

  const nichtEingetreten = (warnings: string[] = []): ResolvedEvent => ({
    instant: null,
    source: 'nicht_eingetreten',
    appliedRule: null,
    existence: ev.existence,
    warnings,
  });

  if (config.rule === 'keine') return nichtEingetreten();

  // Alle Regeln brauchen die astronomische Nacht, also Sonnenuntergang bis
  // Sonnenaufgang. Auf Maghreb und Fajr kann man sich hier nicht stuetzen,
  // das waere zirkulaer: Fajr ist ja gerade das, was fehlt.
  const nacht = key === 'fajr' ? nightBefore(day, getDay) : nightAfter(day, getDay);
  if (nacht === null) {
    return nichtEingetreten([
      'Die Ersatzregel greift nicht, weil an diesem Ort auch Sonnenauf- oder Sonnenuntergang nicht eintreten.',
    ]);
  }

  const anker = key === 'fajr' ? nacht.sunrise : nacht.sunset;
  const richtung = key === 'fajr' ? -1 : 1;

  const bauen = (offsetMs: number, appliedRule: AppliedRule): ResolvedEvent => ({
    instant: Math.round(anker + richtung * offsetMs),
    source: 'ersatzregel',
    appliedRule,
    existence: ev.existence,
    warnings: [],
  });

  // Die Drittel-Regel der Weltkonferenz Istanbul 2021 war hier einmal
  // umgesetzt und ist bewusst wieder entfernt worden. Sie bleibt auf
  // /methoden/hohe-breiten/ beschrieben, mit Urheber und Jahr, aber sie wird
  // nicht angeboten. Wenn ein Zeichen nicht eintritt, sagt diese App das, statt
  // eine Zahl an seine Stelle zu setzen.
  switch (config.rule) {
    case 'siebtel':
      return bauen(nacht.lengthMs / 7, {
        rule: 'siebtel',
        transferredOffsetMs: nacht.lengthMs / 7,
      });

    case 'mitte':
      return bauen(nacht.lengthMs / 2, {
        rule: 'mitte',
        transferredOffsetMs: nacht.lengthMs / 2,
      });

    case 'winkelproportional': {
      // Die unterschiedlichen Nenner 60 und 18 sind kein Tippfehler, sie stammen
      // aus der urspruenglichen Formulierung der Regel.
      const winkel = key === 'fajr' ? day.params.fajrAngle : day.params.ishaAngle;
      const nenner = key === 'fajr' ? 60 : 18;
      const roh = winkel / nenner;
      const anteil = Math.min(0.5, Math.max(0, roh));
      const applied: AppliedRule = {
        rule: 'winkelproportional',
        transferredOffsetMs: anteil * nacht.lengthMs,
      };
      // Ein Freiwert von 25 Grad ergaebe bei Isha einen Anteil von 1,39, das
      // Ereignis laege dann nach dem Sonnenaufgang. Deshalb wird geklemmt, und
      // das Klemmen steht im Protokoll.
      if (roh !== anteil) applied.clampedFraction = roh;
      return bauen(anteil * nacht.lengthMs, applied);
    }

    case 'fester_versatz':
      return bauen(config.fixedOffsetMin * MIN_MS, {
        rule: 'fester_versatz',
        transferredOffsetMs: config.fixedOffsetMin * MIN_MS,
      });

    case 'aqrab_al_ayyam':
      return aqrabAlAyyam(day, getDay, config, key, anker, richtung, ev.existence);
  }
}

/**
 * Aqrab al-Ayyam: der naechstgelegene Tag, an dem der Winkel erreicht wird.
 *
 * Zwei Punkte entscheiden ueber die Richtigkeit:
 *
 * 1. Uebertragen wird die ZEITDIFFERENZ zu Sonnenauf- oder Sonnenuntergang,
 *    niemals die Uhrzeit. Ueber einen Suchzeitraum von bis zu 60 Tagen
 *    verschiebt sich der Sonnenuntergang um mehr als eine Stunde, dazu kann eine
 *    Zeitumstellung kommen. Wer die Uhrzeit uebertraegt, baut genau dort einen
 *    Sprung von einer Stunde ein, wo die Regel greift.
 *
 * 2. Gesucht wird in BEIDE Richtungen. Der unerreichbare Zeitraum liegt
 *    annaehernd symmetrisch um die Sonnenwende. Wer nur rueckwaerts sucht,
 *    erzeugt eine systematische Schieflage und einen sichtbaren Sprung an dem
 *    Tag, an dem der Winkel wieder erreichbar wird.
 */
function aqrabAlAyyam(
  day: RawDay,
  getDay: RawDayProvider,
  config: HighLatConfig,
  key: 'fajr' | 'isha',
  anker: number,
  richtung: number,
  existence: Existence | null,
): ResolvedEvent {
  for (let k = 1; k <= config.maxSearchDays; k++) {
    for (const dir of [-1, 1]) {
      const kandidat = getDay(dir * k);
      const ereignis = kandidat.events[key].instant;
      const bezug =
        key === 'fajr' ? kandidat.events.sunrise.instant : kandidat.events.maghrib.instant;
      if (ereignis === null || bezug === null) continue;

      const differenz = Math.abs(bezug - ereignis);
      return {
        instant: Math.round(anker + richtung * differenz),
        source: 'ersatzregel',
        appliedRule: {
          rule: 'aqrab_al_ayyam',
          referenceDayOffset: dir * k,
          transferredOffsetMs: differenz,
        },
        existence,
        warnings: [],
      };
    }
  }

  // Kein Fund im Suchfenster: An diesem Ort wird der Winkel ganzjaehrig nicht
  // erreicht. Statt endlos zu suchen wird auf das Siebtel der Nacht
  // zurueckgefallen, und das steht im Protokoll.
  const sekundaer = resolve(day, getDay, { ...config, rule: 'siebtel' }, key);
  if (sekundaer.appliedRule) sekundaer.appliedRule.fallbackFrom = 'aqrab_al_ayyam';
  sekundaer.warnings.push(
    `Der Winkel wird an diesem Ort auch im Umkreis von ${config.maxSearchDays} Tagen nicht erreicht. Ersatzweise wurde das Siebtel der Nacht verwendet.`,
  );
  return sekundaer;
}

interface AstronomicalNight {
  sunset: number;
  sunrise: number;
  lengthMs: number;
}

/** Nacht VOR dem Tag: Sonnenuntergang(D-1) bis Sonnenaufgang(D). Fuer Fajr(D). */
function nightBefore(day: RawDay, getDay: RawDayProvider): AstronomicalNight | null {
  const sunset = getDay(-1).events.maghrib.instant;
  const sunrise = day.events.sunrise.instant;
  if (sunset === null || sunrise === null || sunrise <= sunset) return null;
  return { sunset, sunrise, lengthMs: sunrise - sunset };
}

/** Nacht NACH dem Tag: Sonnenuntergang(D) bis Sonnenaufgang(D+1). Fuer Isha(D). */
function nightAfter(day: RawDay, getDay: RawDayProvider): AstronomicalNight | null {
  const sunset = day.events.maghrib.instant;
  const sunrise = getDay(1).events.sunrise.instant;
  if (sunset === null || sunrise === null || sunrise <= sunset) return null;
  return { sunset, sunrise, lengthMs: sunrise - sunset };
}
