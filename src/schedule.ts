/**
 * Der Orchestrator. Setzt aus rohen Tagesplaenen, Ersatzregeln, Nachtbildung,
 * Rundung und Anzeigelogik ein fertiges Ergebnis zusammen.
 *
 * Hier entsteht auch das Rechenprotokoll, und zwar als REGULAERER
 * Rueckgabewert: computeSchedule liefert { times, protocol }. Es gibt keinen
 * trace-Parameter, keinen Collector, keine Mutation und keinen Logger. Die
 * unteren Module geben ihre Zwischenwerte ohnehin als Daten zurueck, dieses
 * Modul sammelt sie nur ein. Das Protokoll ist ein Produkt, kein Nebeneffekt.
 *
 * Das ist der technische Kern des Versprechens: keine Blackbox.
 */

import {
  computeRawDay,
  shiftDate,
  DEFAULT_PARAMS,
  type CalendarDate,
  type EventKey,
  type LocationInput,
  type MethodParams,
  type RawDay,
} from './rawDay';
import {
  applyHighLatitude,
  DEFAULT_HIGHLAT,
  type AppliedRule,
  type HighLatConfig,
} from './highLatitude';
import { nightSpan, type NightSpan } from './night';
import { instantToLocalParts } from './timezone';
import { tanD } from './angles';
import type { Existence } from './geometry';

const MIN_MS = 60_000;

/** Wie auf volle Minuten gerundet wird. */
export type Rounding = 'ceil' | 'floor' | 'nearest';

/** Woraus die Nacht gebildet wird. */
export type NightDefinition = 'maghrib_bis_fadschr' | 'untergang_bis_aufgang';

export interface Settings {
  location: LocationInput;
  params: MethodParams;
  highLat: HighLatConfig;
  /**
   * Rundungspolitik. Voreinstellung: Gebetszeiten aufrunden, Sonnenaufgang
   * abrunden. So behauptet die Anzeige nie eine Gebetszeit vor ihrem
   * tatsaechlichen Eintritt. Das ist kein Detail: Die Rundung verschiebt bis zu
   * einer Minute, der gesamte Modellfehler liegt darunter.
   */
  rounding: Rounding;
  nightDefinition: NightDefinition;
}

export const DEFAULT_SETTINGS: Settings = {
  location: { latitude: 50.11, longitude: 8.682, zone: 'Europe/Berlin' },
  params: DEFAULT_PARAMS,
  highLat: DEFAULT_HIGHLAT,
  rounding: 'ceil',
  nightDefinition: 'maghrib_bis_fadschr',
};

export type TimeSource = 'berechnet' | 'ersatzregel' | 'nicht_eingetreten';

export type TimeKey = EventKey | 'nachtmitte' | 'letztes_drittel';

export interface DisplayTime {
  key: TimeKey;
  /** Gerundeter Zeitpunkt fuer die Anzeige. Null, wenn nichts eintritt. */
  instant: number | null;
  /** Ungerundeter Zeitpunkt. Steht im Protokoll. */
  exactInstant: number | null;
  source: TimeSource;
  /** Faellt der Zeitpunkt auf einen anderen Kalendertag als den angefragten? */
  dayShift: number;
  /** Welche Ersatzregel gegriffen hat. Null, wenn gerechnet wurde. */
  appliedRule: AppliedRule | null;
  /** Warum nichts eintritt, inklusive Fehlmarge in Grad. */
  existence: Existence | null;
  warnings: string[];
}

export interface EventProtocol {
  key: string;
  targetAltitude: number | null;
  targetBreakdown: { base: number; refractionAndSemidiameter: number; dip: number } | null;
  declinationUsed: number | null;
  equationOfTimeUsed: number | null;
  cosH: number | null;
  hourAngle: number | null;
  method: string | null;
  bisectionSteps: number | null;
  residualDeg: number | null;
  /** Wie weit die reine Stundenwinkel-Naeherung danebenlaege, in Millisekunden. */
  estimateDeviationMs: number | null;
  exactInstant: number | null;
  roundedInstant: number | null;
  roundingDeltaMs: number | null;
  appliedRule: AppliedRule | null;
  existence: Existence | null;
}

export interface CalculationProtocol {
  version: string;
  inputs: {
    latitude: number;
    longitude: number;
    zone: string;
    date: CalendarDate;
    elevationMeters: number;
    elevationApplied: boolean;
  };
  method: {
    fajrAngle: number;
    ishaAngle: number;
    asrFactor: number;
    dhuhrOffsetMin: number;
    highLatRule: string;
    rounding: Rounding;
    nightDefinition: NightDefinition;
  };
  assumptions: string[];
  solar: {
    transitInstant: number;
    offsetFromLocalNoonMin: number;
    declination: number;
    equationOfTimeMin: number;
    residualHourAngleDeg: number;
  };
  culmination: { hMax: number; hMin: number };
  asr: {
    transitZenithDistance: number;
    shadowAtNoon: number;
    targetAltitude: number;
    degenerate: boolean;
  } | null;
  events: EventProtocol[];
  night: {
    definition: NightDefinition;
    startKey: string;
    endKey: string;
    lengthMs: number | null;
    basedOnSubstitute: boolean;
    violations: string[];
  };
  warnings: string[];
}

export interface ScheduleResult {
  date: CalendarDate;
  times: DisplayTime[];
  protocol: CalculationProtocol;
}

const HAUPTZEITEN: EventKey[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Rundet auf volle Minuten nach der eingestellten Politik. */
function roundToMinute(instant: number, mode: Rounding): number {
  const m = instant / MIN_MS;
  const r = mode === 'ceil' ? Math.ceil(m) : mode === 'floor' ? Math.floor(m) : Math.round(m);
  return r * MIN_MS;
}

/**
 * Rechnet einen Tag vollstaendig durch.
 *
 * Der Tagesplan-Cache ist nicht nur Bequemlichkeit: Die Aqrab-Suche greift auf
 * bis zu 200 Nachbartage zu, und ohne Cache waere jeder davon eine komplette
 * Neuberechnung.
 */
export function computeSchedule(settings: Settings, date: CalendarDate): ScheduleResult {
  const { location, params, highLat, rounding, nightDefinition } = settings;

  const cache = new Map<string, RawDay>();
  const dayAt = (d: CalendarDate): RawDay => {
    const key = `${d.year}-${d.month}-${d.day}`;
    let cached = cache.get(key);
    if (!cached) {
      cached = computeRawDay(location, params, d);
      cache.set(key, cached);
    }
    return cached;
  };

  const heute = dayAt(date);
  const morgen = dayAt(shiftDate(date, 1));

  const geregelt = applyHighLatitude(heute, (o) => dayAt(shiftDate(date, o)), highLat);
  const geregeltMorgen = applyHighLatitude(morgen, (o) => dayAt(shiftDate(date, o + 1)), highLat);

  const warnings: string[] = [];

  const bauen = (
    key: TimeKey,
    exact: number | null,
    source: TimeSource,
    appliedRule: AppliedRule | null,
    existence: Existence | null,
    eventWarnings: string[] = [],
  ): DisplayTime => {
    // Sonnenaufgang wird abgerundet, alles andere nach der Einstellung. So
    // behauptet die Anzeige nie eine Gebetszeit vor ihrem Eintritt und laesst
    // die Fajr-Zeit nie kuenstlich laenger erscheinen.
    const mode: Rounding = key === 'sunrise' ? 'floor' : rounding;
    const gerundet = exact === null ? null : roundToMinute(exact, mode);
    return {
      key,
      instant: gerundet,
      exactInstant: exact,
      source,
      dayShift: gerundet === null ? 0 : dayShiftOf(location.zone, date, gerundet),
      appliedRule,
      existence,
      warnings: eventWarnings,
    };
  };

  const einfach = (key: EventKey): DisplayTime =>
    bauen(
      key,
      heute.events[key].instant,
      heute.events[key].instant === null ? 'nicht_eingetreten' : 'berechnet',
      null,
      heute.events[key].existence,
      key === 'asr' && heute.asrProblem ? [heute.asrProblem] : [],
    );

  const times: DisplayTime[] = [
    bauen(
      'fajr',
      geregelt.fajr.instant,
      geregelt.fajr.source,
      geregelt.fajr.appliedRule,
      geregelt.fajr.existence,
      geregelt.fajr.warnings,
    ),
    einfach('sunrise'),
    einfach('dhuhr'),
    einfach('asr'),
    einfach('maghrib'),
    bauen(
      'isha',
      geregelt.isha.instant,
      geregelt.isha.source,
      geregelt.isha.appliedRule,
      geregelt.isha.existence,
      geregelt.isha.warnings,
    ),
  ];

  warnings.push(...geregelt.fajr.warnings, ...geregelt.isha.warnings);
  if (heute.asrProblem) warnings.push(heute.asrProblem);

  // --- Die Nacht ------------------------------------------------------------
  // Immer von Tag D auf Tag D+1. Beide Tagesplaene liegen bereits vor.
  const nachtStart = heute.events.maghrib.instant;
  const nachtEnde =
    nightDefinition === 'maghrib_bis_fadschr'
      ? geregeltMorgen.fajr.instant
      : morgen.events.sunrise.instant;

  let nacht: NightSpan | null = null;
  if (nachtStart !== null && nachtEnde !== null) {
    nacht = nightSpan(nachtStart, nachtEnde);
    warnings.push(...nacht.violations);
  }

  // Wenn Fajr des Folgetages selbst aus einer Ersatzregel stammt, beruht die
  // Nachtmitte darauf. Das muss die Anzeige sagen.
  const nachtAufErsatz =
    nightDefinition === 'maghrib_bis_fadschr' && geregeltMorgen.fajr.source === 'ersatzregel';
  if (nachtAufErsatz) {
    warnings.push(
      'Nachtmitte und letztes Drittel beruhen auf einem ersatzweise berechneten Fajr des Folgetages.',
    );
  }

  const abgeleitet = (key: 'nachtmitte' | 'letztes_drittel', exact: number | null): DisplayTime =>
    bauen(
      key,
      exact,
      exact === null ? 'nicht_eingetreten' : nachtAufErsatz ? 'ersatzregel' : 'berechnet',
      null,
      null,
      nachtAufErsatz
        ? ['Beruht auf einem ersatzweise berechneten Fajr des Folgetages.']
        : [],
    );

  times.push(abgeleitet('nachtmitte', nacht?.midpoint ?? null));
  times.push(abgeleitet('letztes_drittel', nacht?.lastThirdStart ?? null));

  // --- Das Protokoll --------------------------------------------------------
  const phi = location.latitude;
  const delta = heute.transit.declination;

  const protocol: CalculationProtocol = {
    version: 'core-1.0.0',
    inputs: {
      latitude: phi,
      longitude: location.longitude,
      zone: location.zone,
      date,
      elevationMeters: params.elevationMeters,
      elevationApplied: params.elevationMeters > 0,
    },
    method: {
      fajrAngle: params.fajrAngle,
      ishaAngle: params.ishaAngle,
      asrFactor: params.asrFactor,
      dhuhrOffsetMin: params.dhuhrOffsetMin,
      highLatRule: highLat.rule,
      rounding,
      nightDefinition,
    },
    assumptions: [
      'Sonnenposition nach Meeus, Kapitel 25 (Low Precision), inklusive Aberration und Nutation.',
      'Delta T nach Espenak und Meeus. Einfluss auf die Gebetszeiten unter einer Sekunde.',
      'Horizontstand −0,833°: mittlere Refraktion (34 Bogenminuten) plus halber Sonnendurchmesser (16 Bogenminuten).',
      'Refraktion, Halbmesser und Kimmtiefe gelten nur für Sonnenauf- und -untergang, nicht für die Dämmerungswinkel.',
      'Die Solarparallaxe wird vernachlässigt, das sind etwa ein bis zwei Sekunden.',
      'Wetterbedingte Refraktionsschwankungen verschieben den sichtbaren Sonnenauf- und -untergang um bis zu zwei Minuten. Das ist die größte verbleibende Unsicherheit, größer als der Modellfehler.',
    ],
    solar: {
      transitInstant: heute.transit.instant,
      offsetFromLocalNoonMin: heute.transit.offsetFromLocalNoonMin,
      declination: delta,
      equationOfTimeMin: heute.transit.equationOfTimeMin,
      residualHourAngleDeg: heute.transit.residualHourAngleDeg,
    },
    // Geschlossen aus Breite und Deklination. hMin ist der Wert, den die App
    // zeigt, wenn ein Daemmerungswinkel nicht erreicht wird.
    culmination: {
      hMax: 90 - Math.abs(phi - delta),
      hMin: Math.abs(phi + delta) - 90,
    },
    asr: heute.asrTarget
      ? {
          transitZenithDistance: heute.asrTarget.transitZenithDistance,
          shadowAtNoon: tanD(heute.asrTarget.transitZenithDistance),
          targetAltitude: heute.asrTarget.altitude,
          degenerate: heute.asrTarget.degenerate,
        }
      : null,
    events: times
      .filter((t): t is DisplayTime & { key: EventKey } =>
        (HAUPTZEITEN as string[]).includes(t.key),
      )
      .map((t) => eventProtocol(t, heute)),
    night: {
      definition: nightDefinition,
      startKey: 'maghrib',
      endKey:
        nightDefinition === 'maghrib_bis_fadschr'
          ? 'Fajr des Folgetages'
          : 'Sonnenaufgang des Folgetages',
      lengthMs: nacht?.lengthMs ?? null,
      basedOnSubstitute: nachtAufErsatz,
      violations: nacht?.violations ?? [],
    },
    warnings,
  };

  return { date, times, protocol };
}

function eventProtocol(t: DisplayTime & { key: EventKey }, day: RawDay): EventProtocol {
  const raw = day.events[t.key];
  const s = raw.solve;
  const istDhuhr = t.key === 'dhuhr';
  return {
    key: t.key,
    targetAltitude: raw.target?.altitude ?? null,
    targetBreakdown: raw.target?.breakdown ?? null,
    declinationUsed: s?.declinationUsed ?? (istDhuhr ? day.transit.declination : null),
    equationOfTimeUsed: s?.equationOfTimeUsed ?? (istDhuhr ? day.transit.equationOfTimeMin : null),
    cosH: s?.cosH ?? null,
    hourAngle: s?.hourAngle ?? (istDhuhr ? 0 : null),
    method: s?.method ?? (istDhuhr ? 'transit' : null),
    bisectionSteps: s?.steps ?? null,
    residualDeg: s?.residualDeg ?? null,
    estimateDeviationMs: s?.estimateDeviationMs ?? null,
    exactInstant: t.exactInstant,
    roundedInstant: t.instant,
    roundingDeltaMs:
      t.instant !== null && t.exactInstant !== null ? t.instant - t.exactInstant : null,
    appliedRule: t.appliedRule,
    existence: t.existence,
  };
}

/**
 * Um wie viele Kalendertage der Zeitpunkt vom angefragten Datum abweicht.
 *
 * Wird gebraucht, weil Isha in Deutschland im Sommer bis kurz vor oder nach
 * Mitternacht rutscht. Ohne Kennzeichnung sieht die Tabelle dann fehlerhaft aus.
 */
function dayShiftOf(zone: string, date: CalendarDate, instant: number): number {
  const p = instantToLocalParts(zone, instant);
  const a = Date.UTC(p.year, p.month - 1, p.day);
  const b = Date.UTC(date.year, date.month - 1, date.day);
  return Math.round((a - b) / 86_400_000);
}
