/**
 * Vom Zielwinkel zum Zeitpunkt.
 *
 * Das Verfahren ist Bisektion auf dem garantiert monotonen Halbtag, immer, ohne
 * Ausnahme. Der Stundenwinkel liefert nur noch einen Schaetzwert fuer das
 * Rechenprotokoll.
 *
 * Warum nicht der uebliche Fixpunkt mit Abbruch bei kleinem Hoehenfehler: Die
 * Probe misst Grad, entscheiden muss aber die Zeit, und der Umrechnungsfaktor
 * zwischen beiden ist nicht konstant. In Muenchen unterschreitet die Sonne zur
 * Sommersonnenwende die 18 Grad nur um 0,42 Grad; ihre Hoehe aendert sich dort
 * mit etwa 0,0004 Grad je Sekunde. Eine Schranke von 0,005 Grad erlaubt damit
 * zwoelf Sekunden Zeitfehler, und gemessen wurden 6,2 Sekunden gegen die
 * unabhaengige Gegenrechnung. Der Fixpunkt hatte die Probe bestanden und lag
 * trotzdem daneben.
 *
 * Bisektion kennt dieses Problem nicht: Sie halbiert das Zeitfenster bis auf die
 * Millisekunde, voellig unabhaengig davon, wie flach der Durchgang ist. Sie
 * kostet rund 40 Auswertungen, also Mikrosekunden. Fuer eine App, die einen Tag
 * mit sechs Ereignissen rechnet, ist das nicht messbar.
 */

import { sinD, cosD, asinD, norm180 } from './angles';
import { instantToJDTT } from './julian';
import { sunPosition } from './solar';
import { hourAngleFor } from './hourangle';
import { checkExistence, type Existence } from './geometry';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Wie genau die Zielhoehe getroffen sein muss, in Grad. Etwa eine Sekunde Zeit. */
const TOLERANCE_DEG = 0.005;

/** Richtung vom Transit aus gesehen. */
export type Direction = 'morgens' | 'abends';

export interface SolveStep {
  instant: number;
  declination: number;
  hourAngle: number | null;
}

export interface SolveSuccess {
  found: true;
  instant: number;
  method: 'bisektion';
  steps: number;
  /** Verbleibende Abweichung der Sonnenhoehe vom Ziel, in Grad. */
  residualDeg: number;
  /**
   * Was der reine Stundenwinkel ohne Nachiteration ergeben haette. Steht im
   * Protokoll, damit sichtbar wird, wie stark die Naeherung an flachen
   * Durchgaengen abweicht.
   */
  estimateFromHourAngle: number | null;
  /** Abstand zwischen Schaetzwert und Ergebnis, in Millisekunden. */
  estimateDeviationMs: number | null;
  /** Deklination und Zeitgleichung am Ergebniszeitpunkt, fuers Protokoll. */
  declinationUsed: number;
  equationOfTimeUsed: number;
  cosH: number;
  hourAngle: number;
  trace: SolveStep[];
}

export interface SolveFailure {
  found: false;
  /** Warum nichts gefunden wurde, inklusive Fehlmarge in Grad. */
  existence: Existence;
}

export type SolveResult = SolveSuccess | SolveFailure;

/**
 * Oertlicher Stundenwinkel der Sonne zu einem Zeitpunkt, in Grad, (-180, 180].
 * Negativ vor dem Transit, positiv danach.
 *
 * Wahre Ortszeit = UT + Zeitgleichung + Laenge/15. Der Stundenwinkel ist der
 * Winkel, um den die wahre Ortszeit vom Mittag abweicht, mal 15 Grad je Stunde.
 */
export function localHourAngle(instantMs: number, longitude: number): number {
  return hourAngleFromPosition(instantMs, longitude, sunPosition(instantToJDTT(instantMs)));
}

function hourAngleFromPosition(
  instantMs: number,
  longitude: number,
  pos: { equationOfTimeMin: number },
): number {
  const utHours = (((instantMs % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS;
  return norm180(15 * utHours + pos.equationOfTimeMin / 4 + longitude - 180);
}

/**
 * Tatsaechliche Sonnenhoehe zu einem Zeitpunkt, in Grad. Die Probe fuer alles.
 *
 * Die Sonnenposition wird bewusst nur EINMAL berechnet und an die
 * Stundenwinkelbildung durchgereicht. Diese Funktion ist die innerste Schleife
 * der Bisektion und laeuft bei einem Jahresdurchlauf einige hunderttausend Mal.
 */
export function solarAltitudeAt(
  instantMs: number,
  latitude: number,
  longitude: number,
): number {
  const pos = sunPosition(instantToJDTT(instantMs));
  const H = hourAngleFromPosition(instantMs, longitude, pos);
  return asinD(
    sinD(latitude) * sinD(pos.declination) +
      cosD(latitude) * cosD(pos.declination) * cosD(H),
  );
}

export interface SolveOptions {
  /** Zeitpunkt des Sonnenhoechststands, Anker des ganzen Tages. */
  transitInstant: number;
  latitude: number;
  longitude: number;
  targetAltitude: number;
  direction: Direction;
}

/**
 * Findet den Zeitpunkt, zu dem die Sonne die Zielhoehe durchlaeuft.
 *
 * Der Zielwinkel wird als fester Wert uebergeben und hier NICHT nachgefuehrt.
 * Das ist fuer Assr entscheidend: Dessen Zielhoehe folgt aus der Deklination zum
 * Transit, weil der Mittagsschatten per Definition der Schatten zum Zawal ist.
 * Wer ihn mititerieren liesse, rechnete einen Fixpunkt von etwas anderem als der
 * Definition.
 */
export function solveEvent(opts: SolveOptions): SolveResult {
  const { transitInstant, latitude, longitude, targetAltitude, direction } = opts;
  const sign = direction === 'morgens' ? -1 : 1;

  const posAtTransit = sunPosition(instantToJDTT(transitInstant));
  const existence = checkExistence(latitude, posAtTransit.declination, targetAltitude);
  if (!existence.exists) return { found: false, existence };

  const trace: SolveStep[] = [];

  // --- Schaetzwert aus dem Stundenwinkel, nur fuers Protokoll ----------------
  let estimate: number | null = null;
  let t = transitInstant;
  for (let i = 0; i < 3; i++) {
    const pos = sunPosition(instantToJDTT(t));
    const ha = hourAngleFor(targetAltitude, latitude, pos.declination);
    trace.push({ instant: t, declination: pos.declination, hourAngle: ha.H });
    if (ha.status !== 'ok' || ha.H === null) break;
    t = transitInstant + sign * (ha.H / 15) * HOUR_MS;
    estimate = t;
  }

  // --- Bisektion, das eigentliche Verfahren ----------------------------------
  // Zwischen unterer und oberer Kulmination laeuft die Sonnenhoehe streng
  // monoton. Morgens ist das [Transit - 12 h, Transit], abends [Transit,
  // Transit + 12 h]. In diesem Fenster gibt es hoechstens einen Durchgang durch
  // die Zielhoehe, und die Klammer ist damit garantiert korrekt.
  let lo = direction === 'morgens' ? transitInstant - 12 * HOUR_MS : transitInstant;
  let hi = direction === 'morgens' ? transitInstant : transitInstant + 12 * HOUR_MS;

  const f = (x: number) => solarAltitudeAt(x, latitude, longitude) - targetAltitude;
  let fLo = f(lo);
  const fHi = f(hi);

  if (Math.sign(fLo) === Math.sign(fHi)) {
    // Die geschlossene Existenzpruefung oben nutzt die Deklination zum Transit.
    // Wenn sich die Deklination ueber den halben Tag genug aendert, kann ein
    // hauchduenner Grenzfall dort noch als existent gelten, hier aber nicht mehr.
    // Dann ist die ehrliche Antwort: tritt nicht ein.
    return { found: false, existence: { ...existence, exists: false } };
  }

  let steps = 0;
  // 40 Halbierungen bringen 12 Stunden auf unter eine Millisekunde herunter.
  while (hi - lo > 1 && steps < 40) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
    steps++;
  }

  const instant = (lo + hi) / 2;
  const pos = sunPosition(instantToJDTT(instant));
  const ha = hourAngleFor(targetAltitude, latitude, pos.declination);
  const residualDeg = f(instant);

  // Sollte nach 40 Halbierungen eines Zwoelfstundenfensters nie greifen. Wenn
  // doch, ist etwas grundlegend falsch und soll nicht still durchgehen.
  if (Math.abs(residualDeg) > TOLERANCE_DEG) {
    throw new Error(
      `Bisektion konvergierte nicht: Restfehler ${residualDeg.toFixed(6)} Grad nach ${steps} Schritten.`,
    );
  }

  return {
    found: true,
    instant: Math.round(instant),
    method: 'bisektion',
    steps,
    residualDeg,
    estimateFromHourAngle: estimate === null ? null : Math.round(estimate),
    estimateDeviationMs: estimate === null ? null : Math.round(estimate - instant),
    declinationUsed: pos.declination,
    equationOfTimeUsed: pos.equationOfTimeMin,
    cosH: ha.cosH,
    hourAngle: sign * (ha.H ?? 0),
    trace,
  };
}
