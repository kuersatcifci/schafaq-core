/**
 * Geschlossene Aussagen ueber den Sonnenlauf eines Tages.
 *
 * Der Kern dieses Moduls ist die Existenzfrage: Erreicht die Sonne an diesem Tag
 * ueberhaupt eine bestimmte Hoehe? Ueblich ist die Pruefung ueber |cos H| > 1 beim
 * Stundenwinkel. Die ist richtig, aber blind: Sie sagt nur "nein", nicht "wie weit
 * daneben". Die beiden Kulminationshoehen liefern dieselbe Antwort geschlossen und
 * dazu die Fehlmarge in Grad. Genau die will diese App anzeigen, wenn sie im
 * deutschen Hochsommer meldet, dass Isha bei 18 Grad nicht eintritt.
 */

export interface Culmination {
  /** Hoechste Sonnenhoehe des Tages, in Grad. */
  hMax: number;
  /** Tiefste Sonnenhoehe des Tages, in Grad (nachts, untere Kulmination). */
  hMin: number;
}

export interface Existence extends Culmination {
  /** Wird die Zielhoehe an diesem Tag durchlaufen? */
  exists: boolean;
  /**
   * Wie weit die Zielhoehe verfehlt wird, in Grad. Null, wenn sie erreicht wird.
   * Beispiel: "18 Grad werden um 3,9 Grad verfehlt."
   */
  marginDeg: number;
  /** Warum es nicht eintritt. Null, wenn es eintritt. */
  reason: 'sonne_bleibt_hoeher' | 'sonne_bleibt_tiefer' | null;
}

/**
 * Obere und untere Kulminationshoehe.
 *
 * hMax = 90 - |phi - delta| ist die Hoehe zum Transit.
 * hMin = |phi + delta| - 90 ist die Hoehe zur unteren Kulmination, also
 * zum Zeitpunkt der tiefsten Sonne. Aus hMin folgt direkt die kritische Breite
 * fuer die Daemmerungswinkel: phi_krit = 66,56 Grad minus Winkel.
 */
export function culmination(latitude: number, declination: number): Culmination {
  return {
    hMax: 90 - Math.abs(latitude - declination),
    hMin: Math.abs(latitude + declination) - 90,
  };
}

/** Tritt die Zielhoehe an diesem Tag ein, und wenn nicht, wie knapp daneben? */
export function checkExistence(
  latitude: number,
  declination: number,
  targetAltitude: number,
): Existence {
  const { hMax, hMin } = culmination(latitude, declination);

  if (targetAltitude > hMax) {
    // Die Sonne steigt an diesem Tag nie so hoch.
    return {
      hMax,
      hMin,
      exists: false,
      marginDeg: targetAltitude - hMax,
      reason: 'sonne_bleibt_tiefer',
    };
  }
  if (targetAltitude < hMin) {
    // Die Sonne sinkt an diesem Tag nie so tief. Das ist der deutsche Sommerfall.
    return {
      hMax,
      hMin,
      exists: false,
      marginDeg: hMin - targetAltitude,
      reason: 'sonne_bleibt_hoeher',
    };
  }
  return { hMax, hMin, exists: true, marginDeg: 0, reason: null };
}
