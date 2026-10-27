/**
 * Alle Zielhoehen an genau einer Stelle, jeweils mit aufgeschluesselten Anteilen.
 *
 * Der haeufigste stille Fehler in selbstgebauten Gebetszeitenrechnern sitzt hier:
 * Refraktion, Sonnenhalbmesser und Kimmtiefe werden auf ALLE Ereignisse angewandt.
 * Richtig ist:
 *
 *   Sonnenaufgang und Maghreb: h = -0,833 Grad minus Kimmtiefe.
 *     Die -0,833 Grad enthalten die mittlere Refraktion am Horizont (etwa 34
 *     Bogenminuten) und den halben Sonnendurchmesser (etwa 16 Bogenminuten).
 *
 *   Fajr und Isha: h = -Winkel, sonst nichts.
 *     Die Daemmerungswinkel sind Definitionen ueber die geometrische Sonnenhoehe,
 *     nicht ueber einen sichtbaren Horizont. Wer hier Refraktion oder Kimmtiefe
 *     addiert, verschiebt eine Definition.
 *
 *   Assr: aus dem Schattenfaktor, ohne jede Horizontkorrektur.
 */

import { tanD, acotD } from './angles';

export interface AltitudeTarget {
  /** Die Zielhoehe in Grad. */
  altitude: number;
  /** Aufschluesselung fuers Rechenprotokoll. */
  breakdown: {
    base: number;
    refractionAndSemidiameter: number;
    dip: number;
  };
}

/** In den -0,833 Grad stecken mittlere Refraktion und halber Sonnendurchmesser. */
export const HORIZON_BASE = -0.833;

/**
 * Zielhoehe fuer Sonnenaufgang und Sonnenuntergang.
 *
 * Die Kimmtiefe -0,0347 * Wurzel(Hoehe in Metern) gilt nur, wenn der Beobachter
 * einen frei tiefer liegenden Horizont sieht, etwa am Meer oder auf einem Berg.
 * In einer Stadt auf 100 Metern, deren Umland ebenfalls auf 100 Metern liegt, ist
 * sie schlicht falsch und macht den Sonnenaufgang zu frueh. Deshalb ist sie
 * standardmaessig aus, und das Eingabefeld heisst in der Oberflaeche
 * "Hoehe ueber dem sichtbaren Horizont", nicht "Hoehe ueber Normalnull".
 */
export function horizonAltitude(elevationMeters = 0): AltitudeTarget {
  const elev = Math.max(0, elevationMeters);
  const dip = elev > 0 ? -0.0347 * Math.sqrt(elev) : 0;
  return {
    altitude: HORIZON_BASE + dip,
    breakdown: { base: 0, refractionAndSemidiameter: HORIZON_BASE, dip },
  };
}

/**
 * Zielhoehe fuer Fajr und Isha: der reine Daemmerungswinkel, negativ.
 * Bewusst ohne jede Korrektur, siehe Modulkommentar.
 */
export function twilightAltitude(angleDeg: number): AltitudeTarget {
  return {
    altitude: -Math.abs(angleDeg),
    breakdown: { base: -Math.abs(angleDeg), refractionAndSemidiameter: 0, dip: 0 },
  };
}

export interface AsrTarget extends AltitudeTarget {
  /** Zenitdistanz der Sonne zum Transit, also |phi - delta|. */
  transitZenithDistance: number;
  /**
   * Wahr, wenn die Zielhoehe so flach liegt, dass Assr praktisch mit Maghreb
   * zusammenfaellt. Mathematisch gueltig, aber ohne Hinweis unverstaendlich.
   */
  degenerate: boolean;
}

/**
 * Zielhoehe fuer Assr: cot(h) = f + tan(|phi - delta|)
 *
 * Die Definition lautet nicht "Schatten gleich Objektlaenge", sondern "Schatten
 * hat um f mal die Objektlaenge ZUGENOMMEN, gerechnet ab dem Mittagsschatten".
 * Der Mittagsschatten ist tan(|phi - delta|) mal Objektlaenge, und er ist in
 * Deutschland im Winter erheblich. Deshalb steht er in der Formel.
 *
 * Wichtig: delta muss die Deklination ZUM TRANSIT sein, nicht die zum
 * Assr-Zeitpunkt. Der Mittagsschatten ist per Definition der Schatten zum Zawal.
 * Wer den Zielwinkel mit der Deklination des Ereignisses iteriert, rechnet einen
 * Fixpunkt von etwas anderem als der Definition (Abweichung bis etwa 20 Sekunden,
 * am groessten zu den Aequinoktien). Der Aufrufer friert deshalb diesen Wert ein.
 *
 * Wirft, wenn die Sonne zum Transit unter dem Horizont bleibt: dann gibt es
 * keinen Mittagsschatten und damit keinen definierbaren Assr.
 */
export function asrAltitude(
  latitude: number,
  declinationAtTransit: number,
  shadowFactor: number,
): AsrTarget {
  const z = Math.abs(latitude - declinationAtTransit);
  if (z >= 90) {
    throw new Error(
      `Assr ist nicht definiert: die Sonne kulminiert an diesem Tag unter dem Horizont, es gibt also keinen Mittagsschatten (Zenitdistanz ${z.toFixed(2)}°).`,
    );
  }
  if (!(shadowFactor > 0)) {
    throw new Error(`Der Schattenfaktor muss größer als null sein, angegeben war ${shadowFactor}.`);
  }

  const altitude = acotD(shadowFactor + tanD(z));
  return {
    altitude,
    transitZenithDistance: z,
    // Unter einem Grad liegt Assr so dicht an Maghreb, dass die Anzeige das
    // erklaeren muss, statt zwei Zeiten im Abstand von Sekunden zu zeigen.
    degenerate: altitude < 1,
    breakdown: { base: altitude, refractionAndSemidiameter: 0, dip: 0 },
  };
}
