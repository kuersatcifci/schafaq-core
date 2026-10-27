/**
 * Nachtmitte und letztes Nachtdrittel.
 *
 * Das Modul ist winzig und trotzdem eigenstaendig, weil hier der teuerste
 * Fehler des ganzen Projekts lauert: Wer die Nacht ueber Wanduhrzeiten mittelt,
 * liegt in der Umstellungsnacht um eine halbe Stunde daneben.
 *
 * Beispiel Nacht vom 28. auf den 29. Maerz 2026 in Europe/Berlin: Maghreb um
 * 19:44 MEZ, Fajr um 04:19 MESZ. Auf der Uhr sind das 8 Stunden 35 Minuten,
 * tatsaechlich vergangen sind 7 Stunden 35 Minuten, weil eine Stunde
 * uebersprungen wurde. Die Nachtmitte laege auf der Uhr um 00:01, richtig ist
 * 23:31 MEZ. Deshalb wird hier ausschliesslich auf der physikalischen Achse
 * gerechnet, also mit Zeitpunkten in Millisekunden.
 *
 * Die Umstellung selbst taucht in diesem Modul nirgends auf. Das ist der Punkt:
 * Wenn alles ein Zeitpunkt ist, ist Sommerzeit ein reines Anzeigeproblem.
 */

const HOUR_MS = 3_600_000;

export interface NightSpan {
  /** Beginn der Nacht, ueblicherweise Maghreb des Tages. */
  start: number;
  /** Ende der Nacht, ueblicherweise Fajr des FOLGENDEN Tages. */
  end: number;
  lengthMs: number;
  /** Mitte der Nacht. */
  midpoint: number;
  /** Beginn des letzten Nachtdrittels. */
  lastThirdStart: number;
  /** Verletzte Plausibilitaetsannahmen. Leer, wenn alles stimmig ist. */
  violations: string[];
}

/**
 * Bildet die Nacht aus zwei Zeitpunkten.
 *
 * @param start Maghreb des Tages D (oder Sonnenuntergang, je nach Einstellung).
 * @param end Fajr des Tages D+1 (oder Sonnenaufgang).
 */
export function nightSpan(start: number, end: number): NightSpan {
  const violations: string[] = [];
  const lengthMs = end - start;

  if (lengthMs <= 0) {
    // Der klassische Fehler: Fajr desselben Tages statt des Folgetages.
    violations.push(
      'Die Nacht ist nicht positiv. Vermutlich wurde Fajr desselben Tages statt des Folgetages verwendet.',
    );
  } else if (lengthMs < 4 * HOUR_MS || lengthMs > 20 * HOUR_MS) {
    violations.push(
      `Die Nachtlänge von ${(lengthMs / HOUR_MS).toFixed(1)} Stunden liegt außerhalb des weltweit plausiblen Bereichs von 4 bis 20 Stunden.`,
    );
  }

  return {
    start,
    end,
    lengthMs,
    midpoint: start + lengthMs / 2,
    // Das letzte Drittel beginnt nach zwei Dritteln der Nacht.
    lastThirdStart: start + (lengthMs * 2) / 3,
    violations,
  };
}
