/**
 * Stundenwinkel zu einer Zielhoehe.
 *
 * Liefert nie NaN, sondern immer einen benannten Status. NaN wandert sonst
 * lautlos durch die halbe Rechnung und taucht erst in der Anzeige als leeres
 * Feld auf, ohne dass jemand sagen kann, wo es entstanden ist.
 */

import { sinD, cosD, acosD } from './angles';

export type HourAngleStatus =
  | 'ok'
  /** Zielhoehe liegt ueber der Tageshoechsthoehe: Sonne bleibt immer darunter. */
  | 'ziel_ueber_maximum'
  /** Zielhoehe liegt unter der Tagestiefsthoehe: Sonne bleibt immer darueber. */
  | 'ziel_unter_minimum'
  /** Beobachter praktisch am Pol, der Ausdruck ist dort nicht definiert. */
  | 'entartet';

export interface HourAngleResult {
  /** Der rohe Kosinus, auch wenn er ausserhalb von [-1, 1] liegt. Fuers Protokoll. */
  cosH: number;
  /** Halber Tagbogen in Grad, [0, 180]. Null, wenn kein Ergebnis existiert. */
  H: number | null;
  status: HourAngleStatus;
}

/**
 * cos H = (sin h - sin phi * sin delta) / (cos phi * cos delta)
 *
 * H ist der Betrag des Stundenwinkels. Das Ereignis am Morgen liegt bei -H,
 * das am Abend bei +H, jeweils gerechnet vom Transit aus.
 */
export function hourAngleFor(
  targetAltitude: number,
  latitude: number,
  declination: number,
): HourAngleResult {
  const denom = cosD(latitude) * cosD(declination);

  // An den Polen geht der Nenner gegen null. Der Grenzwert ist mathematisch
  // behandelbar, praktisch aber bedeutungslos: Dort gibt es keinen taeglichen
  // Auf- und Untergang, ueber den man reden koennte.
  if (Math.abs(denom) < 1e-12) {
    return { cosH: NaN, H: null, status: 'entartet' };
  }

  const cosH = (sinD(targetAltitude) - sinD(latitude) * sinD(declination)) / denom;

  // cos H > 1 heisst: sin h liegt ueber dem Maximum des Ausdrucks, die Zielhoehe
  // wird also nie erreicht, weil die Sonne nicht hoch genug steigt.
  if (cosH > 1) return { cosH, H: null, status: 'ziel_ueber_maximum' };
  // cos H < -1 heisst umgekehrt: die Sonne sinkt nie tief genug.
  if (cosH < -1) return { cosH, H: null, status: 'ziel_unter_minimum' };

  return { cosH, H: acosD(cosH), status: 'ok' };
}
