import { describe, it, expect } from 'vitest';
import { sinD, cosD, tanD, asinD, acosD, norm360, norm180, cotD, acotD } from './angles';
import {
  instantToJD,
  jdToInstant,
  julianCentury,
  deltaTSeconds,
  JD_J2000,
} from './julian';

describe('angles', () => {
  it('rechnet die bekannten Stuetzstellen', () => {
    expect(sinD(0)).toBeCloseTo(0, 12);
    expect(sinD(30)).toBeCloseTo(0.5, 12);
    expect(sinD(90)).toBeCloseTo(1, 12);
    expect(cosD(60)).toBeCloseTo(0.5, 12);
    expect(tanD(45)).toBeCloseTo(1, 12);
    expect(asinD(0.5)).toBeCloseTo(30, 12);
    expect(acosD(0.5)).toBeCloseTo(60, 12);
  });

  it('normalisiert Winkel', () => {
    expect(norm360(370)).toBeCloseTo(10, 12);
    expect(norm360(-10)).toBeCloseTo(350, 12);
    expect(norm180(350)).toBeCloseTo(-10, 12);
    expect(norm180(190)).toBeCloseTo(-170, 12);
    expect(norm180(180)).toBeCloseTo(180, 12);
  });

  it('acotD ist die Umkehrung von cotD und bleibt in (0, 180)', () => {
    for (const deg of [1, 15, 45, 89, 90, 120, 179]) {
      expect(acotD(cotD(deg))).toBeCloseTo(deg, 9);
    }
    // Negatives Argument muss in den zweiten Quadranten fallen, nicht negativ werden.
    expect(acotD(-1)).toBeCloseTo(135, 9);
    expect(acotD(-1)).toBeGreaterThan(0);
  });
});

describe('julian', () => {
  it('bildet J2000.0 korrekt ab', () => {
    // Der JD von 2000-01-01 12:00 UTC ist per Definition JD_J2000 (in UT gerechnet).
    expect(instantToJD(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(JD_J2000, 9);
    expect(julianCentury(JD_J2000)).toBeCloseTo(0, 12);
  });

  it('ist umkehrbar, bis auf die Aufloesung von float64', () => {
    // Ein Julianisches Datum liegt bei etwa 2,46 Millionen. In einer 64-Bit-
    // Gleitkommazahl bleiben davon rund 7 Mikrosekunden Aufloesung uebrig.
    // Das ist die harte Grenze dieser Darstellung und fuer Gebetszeiten
    // vollkommen belanglos, muss aber bekannt sein.
    for (const t of [0, Date.UTC(2026, 5, 21, 3, 17, 42), Date.UTC(1987, 3, 10)]) {
      expect(Math.abs(jdToInstant(instantToJD(t)) - t)).toBeLessThan(0.05);
    }
  });

  it('rechnet die Unix-Epoche auf das bekannte JD', () => {
    expect(instantToJD(0)).toBeCloseTo(2440587.5, 9);
  });

  it('liefert plausible Delta-T-Werte fuer die Gegenwart', () => {
    const dt2026 = deltaTSeconds(instantToJD(Date.UTC(2026, 0, 1)));
    // Realwert liegt bei etwa 69 s; das Espenak-Modell liegt etwas darueber.
    // Die Toleranz ist bewusst weit, weil der Einfluss auf die Gebetszeiten
    // unter einer Sekunde bleibt.
    expect(dt2026).toBeGreaterThan(60);
    expect(dt2026).toBeLessThan(90);
  });

  it('Delta T waechst monoton ueber die naechsten Jahrzehnte', () => {
    const years = [2026, 2030, 2040, 2049];
    const values = years.map((y) => deltaTSeconds(instantToJD(Date.UTC(y, 0, 1))));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });
});
