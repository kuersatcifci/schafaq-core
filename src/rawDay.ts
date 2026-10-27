/**
 * Der ungeregelte Tagesplan.
 *
 * "Ungeregelt" heisst: Hier wird ausschliesslich gerechnet. Was astronomisch
 * nicht eintritt, bleibt null und traegt seine Begruendung mit sich. Ersatzregeln
 * fuer hohe Breiten greifen erst eine Schicht darueber, in highLatitude.ts.
 *
 * Diese Trennung ist nicht kosmetisch. Die Suche nach dem naechsten brauchbaren
 * Tag (Aqrab al-Ayyam) muss auf ungeregelten Tagesplaenen laufen, sonst sucht
 * sie in Ergebnissen, die selbst schon aus einer Ersatzregel stammen, und die
 * Rekursion endet nie.
 */

import { solarTransit, type TransitResult } from './transit';
import { solveEvent, type SolveSuccess } from './solve';
import {
  horizonAltitude,
  twilightAltitude,
  asrAltitude,
  type AltitudeTarget,
  type AsrTarget,
} from './altitude';
import type { Existence } from './geometry';

export interface LocationInput {
  latitude: number;
  longitude: number;
  /** IANA-Zone des ORTES, nicht des Geraets. */
  zone: string;
}

export interface MethodParams {
  /** Daemmerungswinkel fuer Fajr, positiv angegeben. */
  fajrAngle: number;
  /** Daemmerungswinkel fuer Isha, positiv angegeben. */
  ishaAngle: number;
  /** Schattenfaktor fuer Assr: 1 nach Schafiiten, Malikiten, Hanbaliten; 2 nach Hanafiten. */
  asrFactor: number;
  /** Sicherheitsminuten nach dem Zawal. Standard 0. */
  dhuhrOffsetMin: number;
  /**
   * Hoehe ueber dem SICHTBAREN Horizont in Metern, nicht ueber Normalnull.
   * Standard 0, siehe altitude.ts.
   */
  elevationMeters: number;
}

export const DEFAULT_PARAMS: MethodParams = {
  fajrAngle: 12,
  ishaAngle: 12,
  asrFactor: 1,
  dhuhrOffsetMin: 0,
  elevationMeters: 0,
};

export type EventKey = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export const EVENT_ORDER: EventKey[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

export interface RawEvent {
  key: EventKey;
  /** Zeitpunkt in Unix-Millisekunden, oder null wenn das Ereignis nicht eintritt. */
  instant: number | null;
  /** Die verwendete Zielhoehe samt Aufschluesselung. Null bei Dhur. */
  target: AltitudeTarget | null;
  /** Rechenweg, fuers Protokoll. Null bei Dhur und bei Nichteintreten. */
  solve: SolveSuccess | null;
  /** Warum es nicht eintritt, inklusive Fehlmarge in Grad. Null wenn es eintritt. */
  existence: Existence | null;
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface RawDay {
  date: CalendarDate;
  location: LocationInput;
  params: MethodParams;
  transit: TransitResult;
  events: Record<EventKey, RawEvent>;
  /** Der Assr-Zielwinkel samt Mittagsschatten. Null, wenn Assr nicht definierbar ist. */
  asrTarget: AsrTarget | null;
  /** Begruendung, falls Assr nicht definierbar ist (Sonne kulminiert unter dem Horizont). */
  asrProblem: string | null;
}

/**
 * Rechnet einen Tag durch, ohne jede Ersatzregel.
 *
 * Alle sechs Ereignisse haengen am selben Transit. Deshalb gibt es hier keinen
 * Tagesuebertrag: Was rechnerisch nach Mitternacht faellt, faellt eben nach
 * Mitternacht und behaelt trotzdem seinen Bezug zu diesem Tag.
 */
export function computeRawDay(
  location: LocationInput,
  params: MethodParams,
  date: CalendarDate,
): RawDay {
  const { latitude, longitude, zone } = location;
  const transit = solarTransit(zone, date.year, date.month, date.day, longitude);

  const horizon = horizonAltitude(params.elevationMeters);
  const fajrTarget = twilightAltitude(params.fajrAngle);
  const ishaTarget = twilightAltitude(params.ishaAngle);

  // Der Assr-Zielwinkel folgt aus der Deklination ZUM TRANSIT und wird danach
  // eingefroren. Der Mittagsschatten ist per Definition der Schatten zum Zawal.
  let asrTarget: AsrTarget | null = null;
  let asrProblem: string | null = null;
  try {
    asrTarget = asrAltitude(latitude, transit.declination, params.asrFactor);
  } catch (err) {
    asrProblem = err instanceof Error ? err.message : String(err);
  }

  const solve = (
    key: EventKey,
    target: AltitudeTarget,
    direction: 'morgens' | 'abends',
  ): RawEvent => {
    const r = solveEvent({
      transitInstant: transit.instant,
      latitude,
      longitude,
      targetAltitude: target.altitude,
      direction,
    });
    return r.found
      ? { key, instant: r.instant, target, solve: r, existence: null }
      : { key, instant: null, target, solve: null, existence: r.existence };
  };

  const events: Record<EventKey, RawEvent> = {
    fajr: solve('fajr', fajrTarget, 'morgens'),
    sunrise: solve('sunrise', horizon, 'morgens'),
    dhuhr: {
      key: 'dhuhr',
      // Dhur ist der Transit selbst, plus optionale Sicherheitsminuten.
      // Ein Ereignis, das keine Zielhoehe hat und deshalb nie ausfaellt.
      instant: transit.instant + params.dhuhrOffsetMin * 60_000,
      target: null,
      solve: null,
      existence: null,
    },
    asr: asrTarget
      ? solve('asr', asrTarget, 'abends')
      : { key: 'asr', instant: null, target: null, solve: null, existence: null },
    maghrib: solve('maghrib', horizon, 'abends'),
    isha: solve('isha', ishaTarget, 'abends'),
  };

  return { date, location, params, transit, events, asrTarget, asrProblem };
}

/** Verschiebt ein Kalenderdatum um ganze Tage, ueber Monats- und Jahresgrenzen hinweg. */
export function shiftDate(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
