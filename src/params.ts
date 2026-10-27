/**
 * Eingaben pruefen und Einstellungen als URL abbilden.
 *
 * Zwei Aufgaben:
 *
 * 1. Ablehnen statt rechnen. Ein Breitengrad von 91, ein Daemmerungswinkel von
 *    90 Grad oder ein NaN duerfen nicht in den Rechenkern gelangen. Dort
 *    erzeugen sie entweder stille Unsinnswerte oder Ausnahmen an einer Stelle,
 *    die dem Nutzer nichts sagt. Hier gibt es stattdessen eine benannte
 *    Fehlermeldung je Feld.
 *
 * 2. Eine Rechnung teilbar machen. Wer eine Zeit anzweifelt, soll die
 *    vollstaendige Parameterlage als Link weitergeben koennen. Das gehoert zum
 *    Transparenzversprechen: Nachvollziehbar ist nur, was reproduzierbar ist.
 */

import { isValidZone } from './timezone';
import { DEFAULT_PARAMS, type LocationInput, type MethodParams } from './rawDay';
import { DEFAULT_HIGHLAT, type HighLatConfig, type HighLatRule } from './highLatitude';
import { DEFAULT_SETTINGS, type NightDefinition, type Rounding, type Settings } from './schedule';

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; settings: Settings; errors: ValidationError[] }
  | { ok: false; settings: null; errors: ValidationError[] };

const HIGHLAT_RULES: HighLatRule[] = [
  'keine',
  'siebtel',
  'mitte',
  'winkelproportional',
  'aqrab_al_ayyam',
  'fester_versatz',
];
const ROUNDINGS: Rounding[] = ['ceil', 'floor', 'nearest'];
const NIGHT_DEFS: NightDefinition[] = ['maghrib_bis_fadschr', 'untergang_bis_aufgang'];

/** Eine endliche Zahl, sonst null. Akzeptiert auch das deutsche Dezimalkomma. */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Prueft eine Eingabe vollstaendig und liefert entweder gueltige Einstellungen
 * oder ALLE Fehler auf einmal. Nicht beim ersten Fehler abbrechen: Wer drei
 * Felder falsch hat, will das in einem Durchgang erfahren.
 */
export function validateSettings(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const loc = (raw.location ?? {}) as Record<string, unknown>;
  const par = (raw.params ?? {}) as Record<string, unknown>;
  const hl = (raw.highLat ?? {}) as Record<string, unknown>;

  const pruefe = (
    field: string,
    value: unknown,
    min: number,
    max: number,
    fallback: number,
    hinweis: string,
  ): number => {
    const n = num(value);
    if (n === null) {
      errors.push({ field, message: `${hinweis} Erwartet wird eine Zahl.` });
      return fallback;
    }
    if (n < min || n > max) {
      errors.push({
        field,
        message: `${hinweis} Erlaubt ist ${min} bis ${max}, angegeben war ${n}.`,
      });
      return fallback;
    }
    return n;
  };

  const latitude = pruefe('latitude', loc.latitude, -90, 90, 0, 'Breitengrad.');
  const longitude = pruefe('longitude', loc.longitude, -180, 180, 0, 'Längengrad.');

  const zone = typeof loc.zone === 'string' ? loc.zone : '';
  if (!zone) {
    errors.push({ field: 'zone', message: 'Es wurde keine Zeitzone angegeben.' });
  } else if (!isValidZone(zone)) {
    errors.push({ field: 'zone', message: `Die Zeitzone "${zone}" ist unbekannt.` });
  }

  // Winkel: 0 Grad waere kein Daemmerungswinkel, sondern der Horizont selbst.
  // Ueber 30 Grad gibt es keine vertretene Meinung, und die Regeln fuer hohe
  // Breiten wuerden dort unsinnig.
  const fajrAngle = pruefe(
    'fajrAngle',
    par.fajrAngle,
    0.5,
    30,
    DEFAULT_PARAMS.fajrAngle,
    'Dämmerungswinkel für Fajr.',
  );
  const ishaAngle = pruefe(
    'ishaAngle',
    par.ishaAngle,
    0.5,
    30,
    DEFAULT_PARAMS.ishaAngle,
    'Dämmerungswinkel für Isha.',
  );
  const asrFactor = pruefe(
    'asrFactor',
    par.asrFactor,
    0.5,
    8,
    DEFAULT_PARAMS.asrFactor,
    'Schattenfaktor für Assr.',
  );
  const dhuhrOffsetMin = pruefe(
    'dhuhrOffsetMin',
    par.dhuhrOffsetMin,
    -30,
    60,
    0,
    'Sicherheitsminuten für Dhur.',
  );
  const elevationMeters = pruefe(
    'elevationMeters',
    par.elevationMeters,
    0,
    9000,
    0,
    'Höhe über dem sichtbaren Horizont.',
  );

  const rule = hl.rule as HighLatRule;
  if (hl.rule !== undefined && !HIGHLAT_RULES.includes(rule)) {
    errors.push({
      field: 'highLatRule',
      message: `Unbekannte Regel für hohe Breiten: "${String(hl.rule)}".`,
    });
  }
  const fixedOffsetMin = pruefe(
    'fixedOffsetMin',
    hl.fixedOffsetMin ?? DEFAULT_HIGHLAT.fixedOffsetMin,
    1,
    240,
    DEFAULT_HIGHLAT.fixedOffsetMin,
    'Fester Versatz.',
  );

  const rounding = raw.rounding as Rounding;
  if (raw.rounding !== undefined && !ROUNDINGS.includes(rounding)) {
    errors.push({ field: 'rounding', message: `Unbekannte Rundung: "${String(raw.rounding)}".` });
  }

  const nightDefinition = raw.nightDefinition as NightDefinition;
  if (raw.nightDefinition !== undefined && !NIGHT_DEFS.includes(nightDefinition)) {
    errors.push({
      field: 'nightDefinition',
      message: `Unbekannte Nachtdefinition: "${String(raw.nightDefinition)}".`,
    });
  }

  if (errors.length > 0) return { ok: false, settings: null, errors };

  const location: LocationInput = { latitude, longitude, zone };
  const params: MethodParams = {
    fajrAngle,
    ishaAngle,
    asrFactor,
    dhuhrOffsetMin,
    elevationMeters,
  };
  const highLat: HighLatConfig = {
    rule: rule ?? DEFAULT_HIGHLAT.rule,
    fixedOffsetMin,
    maxSearchDays: DEFAULT_HIGHLAT.maxSearchDays,
  };

  return {
    ok: true,
    errors: [],
    settings: {
      location,
      params,
      highLat,
      rounding: rounding ?? DEFAULT_SETTINGS.rounding,
      nightDefinition: nightDefinition ?? DEFAULT_SETTINGS.nightDefinition,
    },
  };
}

/** Einstellungen als Query-String, damit eine Rechnung teilbar wird. */
export function settingsToQuery(s: Settings): string {
  const q = new URLSearchParams({
    lat: s.location.latitude.toFixed(4),
    lon: s.location.longitude.toFixed(4),
    tz: s.location.zone,
    fajr: String(s.params.fajrAngle),
    isha: String(s.params.ishaAngle),
    asr: String(s.params.asrFactor),
    dhuhr: String(s.params.dhuhrOffsetMin),
    elev: String(s.params.elevationMeters),
    hl: s.highLat.rule,
    round: s.rounding,
    night: s.nightDefinition,
  });
  if (s.highLat.rule === 'fester_versatz') q.set('hlmin', String(s.highLat.fixedOffsetMin));
  return q.toString();
}

/**
 * Liest Einstellungen aus einem Query-String und prueft sie.
 * Fehlende Felder werden aus den Voreinstellungen ergaenzt, damit ein
 * unvollstaendiger Link nicht die ganze Seite blockiert.
 */
export function settingsFromQuery(
  query: string,
  base: Settings = DEFAULT_SETTINGS,
): ValidationResult {
  const q = new URLSearchParams(query);
  const hole = (key: string, fallback: unknown) => (q.has(key) ? q.get(key) : fallback);

  return validateSettings({
    location: {
      latitude: hole('lat', base.location.latitude),
      longitude: hole('lon', base.location.longitude),
      zone: hole('tz', base.location.zone),
    },
    params: {
      fajrAngle: hole('fajr', base.params.fajrAngle),
      ishaAngle: hole('isha', base.params.ishaAngle),
      asrFactor: hole('asr', base.params.asrFactor),
      dhuhrOffsetMin: hole('dhuhr', base.params.dhuhrOffsetMin),
      elevationMeters: hole('elev', base.params.elevationMeters),
    },
    highLat: {
      rule: hole('hl', base.highLat.rule),
      fixedOffsetMin: hole('hlmin', base.highLat.fixedOffsetMin),
    },
    rounding: hole('round', base.rounding),
    nightDefinition: hole('night', base.nightDefinition),
  });
}
