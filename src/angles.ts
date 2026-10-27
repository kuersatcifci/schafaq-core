/**
 * Gradbasierte Trigonometrie an genau einer Stelle.
 *
 * Der gesamte Rechenkern arbeitet in Grad, weil alle Quellen (Meeus, die
 * Daemmerungswinkel, die Koordinaten) in Grad formuliert sind. Wer zwischendurch
 * auf Radiant wechselt, baut irgendwann einen Faktor-57,3-Fehler ein. Deshalb
 * gibt es hier die einzige Stelle, an der DEG2RAD ueberhaupt vorkommt.
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const sinD = (deg: number): number => Math.sin(deg * DEG2RAD);
export const cosD = (deg: number): number => Math.cos(deg * DEG2RAD);
export const tanD = (deg: number): number => Math.tan(deg * DEG2RAD);

export const asinD = (x: number): number => Math.asin(x) * RAD2DEG;
export const acosD = (x: number): number => Math.acos(x) * RAD2DEG;
export const atanD = (x: number): number => Math.atan(x) * RAD2DEG;
export const atan2D = (y: number, x: number): number => Math.atan2(y, x) * RAD2DEG;

/** Normalisiert auf [0, 360). */
export function norm360(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Normalisiert auf (-180, 180]. Fuer Laengendifferenzen und Stundenwinkel. */
export function norm180(deg: number): number {
  const r = norm360(deg);
  return r > 180 ? r - 360 : r;
}

/**
 * Kotangens in Grad. Wird fuer Assr gebraucht.
 * Bei deg = 0 waere das Ergebnis unendlich, das faengt der Aufrufer ab.
 */
export const cotD = (deg: number): number => 1 / tanD(deg);

/**
 * Umkehrung: Winkel in Grad, dessen Kotangens x ist, im Bereich (0, 180).
 * atan(1/x) liefert fuer negative x einen negativen Winkel, deshalb die Korrektur.
 */
export function acotD(x: number): number {
  const a = atanD(1 / x);
  return a < 0 ? a + 180 : a;
}
