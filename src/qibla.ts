/**
 * Richtung und Entfernung zur Kaaba.
 *
 * Gerechnet wird die Grosskreis-Peilung, also die Anfangsrichtung des kuerzesten
 * Wegs ueber die Erdkugel. Das ist die uebliche Bestimmung der Qibla und NICHT
 * dasselbe wie eine gerade Linie auf einer flachen Karte. Von Deutschland aus
 * betraegt der Unterschied mehrere Grad.
 */

import { sinD, cosD, atan2D, acosD, norm360 } from './angles';

/** Kaaba, Masdschid al-Haram in Mekka. */
export const KAABA = { latitude: 21.4225, longitude: 39.8262 } as const;

const ERDRADIUS_KM = 6371;

export interface QiblaRichtung {
  /** Peilung in Grad, im Uhrzeigersinn von Nord, [0, 360). */
  bearing: number;
  /** Entfernung zur Kaaba in Kilometern, entlang der Erdoberflaeche. */
  distanceKm: number;
  /** Himmelsrichtung als Wort, etwa "Südost". */
  himmelsrichtung: string;
}

const RICHTUNGEN = [
  'Nord',
  'Nordnordost',
  'Nordost',
  'Ostnordost',
  'Ost',
  'Ostsüdost',
  'Südost',
  'Südsüdost',
  'Süd',
  'Südsüdwest',
  'Südwest',
  'Westsüdwest',
  'West',
  'Westnordwest',
  'Nordwest',
  'Nordnordwest',
];

/** Himmelsrichtung in Sechzehnteln, also auf 22,5 Grad genau. */
export function himmelsrichtung(bearing: number): string {
  const i = Math.round(norm360(bearing) / 22.5) % 16;
  return RICHTUNGEN[i]!;
}

/**
 * Anfangspeilung des Grosskreises von einem Ort zur Kaaba.
 *
 * Am Ort der Kaaba selbst ist keine Richtung definiert; dort liefert die Formel
 * einen beliebigen Wert. Das faengt der Aufrufer ueber die Entfernung ab.
 */
export function qiblaVon(latitude: number, longitude: number): QiblaRichtung {
  const dl = KAABA.longitude - longitude;

  const y = sinD(dl) * cosD(KAABA.latitude);
  const x =
    cosD(latitude) * sinD(KAABA.latitude) - sinD(latitude) * cosD(KAABA.latitude) * cosD(dl);
  const bearing = norm360(atan2D(y, x));

  // Zentralwinkel ueber das Skalarprodukt der beiden Ortsvektoren. Fuer sehr
  // kleine Entfernungen waere die Haversine-Formel numerisch besser, aber hier
  // geht es um tausende Kilometer.
  const cosZ =
    sinD(latitude) * sinD(KAABA.latitude) + cosD(latitude) * cosD(KAABA.latitude) * cosD(dl);
  const distanceKm = acosD(Math.min(1, Math.max(-1, cosZ))) * (Math.PI / 180) * ERDRADIUS_KM;

  return { bearing, distanceKm, himmelsrichtung: himmelsrichtung(bearing) };
}
