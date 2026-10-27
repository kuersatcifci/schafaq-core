/**
 * Der Sonnenhoechststand als Zeitpunkt.
 *
 * Das ist der Anker, an dem der gesamte Tagesplan haengt. Alle sechs Ereignisse
 * werden relativ zu ihm gebildet, deshalb gibt es im Kern nirgends einen
 * Tagesuebertrag und damit auch keine Datumsgrenzenfehler.
 *
 * Das Verfahren nutzt aus, dass der oertliche Stundenwinkel zum Transit genau
 * null ist. Vom lokalen Mittag aus wird der Stundenwinkel berechnet und die Zeit
 * um ihn korrigiert. Weil der Stundenwinkel auf (-180, 180] normalisiert wird,
 * landet das Verfahren automatisch auf dem NAECHSTGELEGENEN Meridiandurchgang.
 *
 * Genau das loest die schwierigen Faelle ohne Sonderbehandlung:
 *
 *   A Coruna (43,37 N / 8,42 W) liegt in Europe/Madrid, der Sonnenhoechststand
 *   ist dort gegen 14:30 Ortszeit. Kaschgar (75,99 O) liegt in Asia/Shanghai,
 *   dort gegen 15:10. Apia und Kiritimati liegen jenseits der Datumsgrenze, ihr
 *   lokales Datum stimmt zum Sonnenmittag nicht mit dem UTC-Datum ueberein.
 *
 * In allen vier Faellen ist der naechstgelegene Transit der richtige, und die
 * Normalisierung findet ihn.
 */

import { localNoonAnchor } from './timezone';
import { instantToJDTT } from './julian';
import { sunPosition } from './solar';
import { localHourAngle } from './solve';

const HOUR_MS = 3_600_000;

export interface TransitResult {
  /** Zeitpunkt des Sonnenhoechststands, Unix-Millisekunden. */
  instant: number;
  /** Zeitpunkt von 12:00 Uhr Ortszeit, von dem aus gesucht wurde. */
  anchor: number;
  /** Abstand zwischen Ortsmittag und Sonnenhoechststand, in Minuten. */
  offsetFromLocalNoonMin: number;
  /** Zeitgleichung am Transit, in Minuten. */
  equationOfTimeMin: number;
  /** Deklination am Transit. Assr braucht genau diesen Wert. */
  declination: number;
  /** Verbleibender Stundenwinkel nach der Iteration, in Grad. Sollte nahe null sein. */
  residualHourAngleDeg: number;
}

/**
 * Sonnenhoechststand fuer einen lokalen Kalendertag.
 *
 * @param zone IANA-Zone des Ortes, nicht die des Geraets.
 * @param longitude Geografische Laenge, oestlich positiv.
 */
export function solarTransit(
  zone: string,
  year: number,
  month: number,
  day: number,
  longitude: number,
): TransitResult {
  const anchor = localNoonAnchor(zone, year, month, day);

  // Der Stundenwinkel aendert sich mit gut 15 Grad je Stunde, deshalb konvergiert
  // das hier in zwei Schritten auf weit unter eine Sekunde.
  let t = anchor;
  for (let i = 0; i < 3; i++) {
    const H = localHourAngle(t, longitude);
    t = t - (H / 15) * HOUR_MS;
  }

  const pos = sunPosition(instantToJDTT(t));
  return {
    instant: Math.round(t),
    anchor,
    offsetFromLocalNoonMin: (t - anchor) / 60_000,
    equationOfTimeMin: pos.equationOfTimeMin,
    declination: pos.declination,
    residualHourAngleDeg: localHourAngle(t, longitude),
  };
}
