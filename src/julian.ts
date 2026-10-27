/**
 * Umrechnung zwischen Zeitpunkt (Unix-Millisekunden, UTC) und Julianischem Datum,
 * plus ein Modell fuer Delta T.
 *
 * Wichtig fuer den ganzen Kern: Ein "Zeitpunkt" ist immer eine Zahl in
 * Millisekunden seit Epoch. Es gibt im Rechenkern keine Wanduhrzeiten und keine
 * Date-Objekte mit lokaler Auslegung. Nur so bleiben Sommerzeit und Datumsgrenze
 * ein reines Anzeigeproblem.
 */

/** Julianisches Datum von J2000.0 (2000-01-01 12:00 TT). */
export const JD_J2000 = 2451545.0;

const MS_PER_DAY = 86_400_000;
/** Julianisches Datum der Unix-Epoche (1970-01-01 00:00 UTC). */
const JD_UNIX_EPOCH = 2440587.5;

export function instantToJD(instantMs: number): number {
  return instantMs / MS_PER_DAY + JD_UNIX_EPOCH;
}

export function jdToInstant(jd: number): number {
  return (jd - JD_UNIX_EPOCH) * MS_PER_DAY;
}

/** Julianische Jahrhunderte seit J2000.0. Erwartet ein JD in TT. */
export function julianCentury(jdTT: number): number {
  return (jdTT - JD_J2000) / 36525;
}

/**
 * Delta T = TT - UT in Sekunden, nach Espenak und Meeus.
 *
 * Der Wert liegt fuer die Gegenwart bei etwa 70 Sekunden. Sein Einfluss auf die
 * Gebetszeiten ist winzig: In 70 Sekunden aendert sich die Deklination der Sonne
 * um etwa 0,0003 Grad, das sind unter einer Sekunde im Ergebnis. Er wird trotzdem
 * mitgefuehrt, damit die Rechnung gegen astronomy-engine vergleichbar bleibt und
 * damit die Annahme im Rechenprotokoll benannt werden kann.
 */
export function deltaTSeconds(jd: number): number {
  const year = jdToDecimalYear(jd);

  if (year >= 2005 && year < 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  if (year >= 2050 && year <= 2150) {
    const u = (year - 1820) / 100;
    return -20 + 32 * u * u - 0.5628 * (2150 - year);
  }
  if (year >= 1986 && year < 2005) {
    const t = year - 2000;
    return (
      63.86 +
      0.3345 * t -
      0.060374 * t ** 2 +
      0.0017275 * t ** 3 +
      0.000651814 * t ** 4 +
      0.00002373599 * t ** 5
    );
  }
  // Ausserhalb des modellierten Bereichs: grobe Langzeitnaeherung.
  const u = (year - 1820) / 100;
  return -20 + 32 * u * u;
}

/** Naeherungsweises Dezimaljahr aus einem JD. Nur fuer die Delta-T-Auswahl. */
function jdToDecimalYear(jd: number): number {
  return 2000 + (jd - JD_J2000) / 365.25;
}

/** JD in TT aus einem JD in UT. Das ist das, was solar.ts erwartet. */
export function jdUTtoTT(jdUT: number): number {
  return jdUT + deltaTSeconds(jdUT) / 86400;
}

/** Bequemer Weg vom Zeitpunkt zum TT-basierten JD. */
export function instantToJDTT(instantMs: number): number {
  return jdUTtoTT(instantToJD(instantMs));
}
