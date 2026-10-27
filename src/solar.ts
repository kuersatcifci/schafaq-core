/**
 * Sonnenposition nach Meeus, "Astronomical Algorithms", Kapitel 25 (Low Precision)
 * mit den Zusaetzen fuer Aberration und Nutation aus Kapitel 22 und 25.
 *
 * Genauigkeit: etwa 0,01 Grad in der Laenge. Umgerechnet auf Gebetszeiten sind das
 * in Deutschland wenige Sekunden. Die dominierende Fehlerquelle bei Sonnenauf- und
 * -untergang ist nicht dieses Modell, sondern die wetterabhaengige Refraktion, die
 * den sichtbaren Auf- und Untergang um bis zu zwei Minuten verschiebt.
 *
 * Die Funktion gibt bewusst ein reiches Objekt zurueck und nicht nur Deklination und
 * Zeitgleichung. Die Zwischenwerte werden ohnehin berechnet, und das Rechenprotokoll
 * der App braucht sie. So entsteht das Protokoll aus regulaeren Rueckgabewerten
 * statt aus einem Logging-Seitenkanal.
 */

import { sinD, cosD, tanD, asinD, atan2D, norm360, norm180, DEG2RAD, RAD2DEG } from './angles';
import { julianCentury } from './julian';

export interface SunPosition {
  /** Julianische Jahrhunderte seit J2000.0, TT. */
  T: number;
  /** Mittlere Laenge der Sonne in Grad, [0, 360). */
  meanLongitude: number;
  /** Mittlere Anomalie in Grad. */
  meanAnomaly: number;
  /** Numerische Exzentrizitaet der Erdbahn. */
  eccentricity: number;
  /** Mittelpunktsgleichung in Grad. */
  equationOfCenter: number;
  /** Wahre Laenge in Grad. */
  trueLongitude: number;
  /** Scheinbare Laenge in Grad, korrigiert um Aberration und Nutation. */
  apparentLongitude: number;
  /** Laenge des aufsteigenden Mondknotens in Grad, fuer die Nutationsterme. */
  omega: number;
  /** Mittlere Schiefe der Ekliptik in Grad. */
  meanObliquity: number;
  /** Wahre Schiefe der Ekliptik in Grad, inklusive Nutationsterm. */
  obliquity: number;
  /** Deklination in Grad. */
  declination: number;
  /** Rektaszension in Grad, [0, 360). */
  rightAscension: number;
  /** Zeitgleichung in Minuten, nach Meeus 28.3. */
  equationOfTimeMin: number;
  /** Radiusvektor Erde zu Sonne in astronomischen Einheiten. */
  radiusVector: number;
  /** Scheinbarer Halbmesser der Sonnenscheibe in Grad. */
  semidiameter: number;
}

/**
 * Vollstaendige Sonnenposition zu einem Julianischen Datum in TT.
 * Wer ein JD in UT hat, schickt es vorher durch jdUTtoTT aus julian.ts.
 */
export function sunPosition(jdTT: number): SunPosition {
  const T = julianCentury(jdTT);

  // Meeus 25.2: geometrische mittlere Laenge
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  // Meeus 25.3: mittlere Anomalie
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  // Meeus 25.4: Exzentrizitaet der Erdbahn
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;

  // Mittelpunktsgleichung
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sinD(M) +
    (0.019993 - 0.000101 * T) * sinD(2 * M) +
    0.000289 * sinD(3 * M);

  const trueLongitude = L0 + C;
  const trueAnomaly = M + C;

  // Meeus 25.5: Radiusvektor in AE
  const radiusVector = (1.000001018 * (1 - e * e)) / (1 + e * cosD(trueAnomaly));

  // Laenge des aufsteigenden Mondknotens, Grundlage der Nutationsterme
  const omega = 125.04 - 1934.136 * T;

  // Scheinbare Laenge: Nutation in Laenge plus Aberration (die 0,00569 Grad).
  // Ohne den Aberrationsterm bleiben etwa 1,4 Sekunden Fehler stehen.
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * sinD(omega);

  // Meeus 22.2: mittlere Schiefe der Ekliptik
  const meanObliquity =
    23 +
    26 / 60 +
    21.448 / 3600 -
    (46.815 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
  // Nutation in der Schiefe
  const obliquity = meanObliquity + 0.00256 * cosD(omega);

  const declination = asinD(sinD(obliquity) * sinD(apparentLongitude));
  const rightAscension = norm360(
    atan2D(cosD(obliquity) * sinD(apparentLongitude), cosD(apparentLongitude)),
  );

  return {
    T,
    meanLongitude: L0,
    meanAnomaly: M,
    eccentricity: e,
    equationOfCenter: C,
    trueLongitude: norm360(trueLongitude),
    apparentLongitude: norm360(apparentLongitude),
    omega: norm360(omega),
    meanObliquity,
    obliquity,
    declination,
    rightAscension,
    equationOfTimeMin: equationOfTimeMeeus283(L0, M, e, obliquity),
    radiusVector,
    // Scheinbarer Halbmesser: 0,266563 Grad im Abstand 1 AE.
    semidiameter: 0.266563 / radiusVector,
  };
}

/**
 * Zeitgleichung nach Meeus 28.3, Ergebnis in Minuten.
 *
 * Bewusst nicht ueber die Rektaszension (28.1) gerechnet: Der Weg ueber
 * L0 - alpha ist quadrantenanfaellig, weil die Differenz um den Jahreswechsel
 * ueber 360 Grad springt. 28.3 hat dieses Problem nicht und ist besser als
 * eine halbe Sekunde genau. Die 28.1-Variante existiert als Kreuzpruefung im Test.
 */
function equationOfTimeMeeus283(L0: number, M: number, e: number, obliquity: number): number {
  const y = tanD(obliquity / 2) ** 2;
  const eRad =
    y * Math.sin(2 * L0 * DEG2RAD) -
    2 * e * Math.sin(M * DEG2RAD) +
    4 * e * y * Math.sin(M * DEG2RAD) * Math.cos(2 * L0 * DEG2RAD) -
    0.5 * y * y * Math.sin(4 * L0 * DEG2RAD) -
    1.25 * e * e * Math.sin(2 * M * DEG2RAD);
  // Radiant zu Grad, dann Grad zu Zeitminuten (1 Grad entspricht 4 Minuten).
  return eRad * RAD2DEG * 4;
}

/**
 * Zeitgleichung nach Meeus 28.1, nur fuer die Kreuzpruefung im Test.
 * Exportiert, damit der Test nicht auf interne Details zugreifen muss.
 *
 * Vollstaendig lautet 28.1: E = L0 - 0,0057183 Grad - alpha + dPsi * cos(epsilon).
 * Der letzte Term ist unverzichtbar, weil die hier gerechnete Rektaszension aus der
 * SCHEINBAREN Laenge stammt, also die Nutation bereits enthaelt. Er rechnet sie
 * wieder heraus, damit beide Seiten dieselbe Bezugsrichtung meinen. Ohne ihn bleiben
 * etwa 1,3 Sekunden Unterschied zu 28.3 stehen, was wie ein Formelfehler aussieht,
 * aber nur ein Bezugsfehler waere.
 */
export function equationOfTimeViaRightAscension(pos: SunPosition): number {
  const nutationInLongitude = -0.00478 * sinD(pos.omega);
  const deg = norm180(
    pos.meanLongitude - 0.0057183 - pos.rightAscension + nutationInLongitude * cosD(pos.obliquity),
  );
  return deg * 4;
}
