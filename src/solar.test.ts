import { describe, it, expect } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import { sunPosition, equationOfTimeViaRightAscension } from './solar';
import { instantToJDTT } from './julian';

/** Stichtage ueber das Jahr, inklusive Sonnenwenden, Aequinoktien und Jahreswechsel. */
const SAMPLE_DAYS: Array<[number, number, number]> = [
  [2026, 1, 1],
  [2026, 2, 11],
  [2026, 3, 20],
  [2026, 4, 15],
  [2026, 5, 14],
  [2026, 6, 21],
  [2026, 7, 26],
  [2026, 8, 30],
  [2026, 9, 23],
  [2026, 11, 3],
  [2026, 12, 21],
  [2027, 1, 1],
];

function posAt(y: number, m: number, d: number, hourUTC = 12) {
  return sunPosition(instantToJDTT(Date.UTC(y, m - 1, d, hourUTC)));
}

describe('sunPosition gegen astronomy-engine', () => {
  it('trifft die Deklination auf besser als 0,01 Grad', () => {
    for (const [y, m, d] of SAMPLE_DAYS) {
      const mine = posAt(y, m, d);
      const eq = Astronomy.Equator(
        Astronomy.Body.Sun,
        new Date(Date.UTC(y, m - 1, d, 12)),
        new Astronomy.Observer(0, 0, 0),
        true, // Koordinaten des Datums, nicht J2000
        true, // Aberration beruecksichtigen
      );
      expect(Math.abs(mine.declination - eq.dec)).toBeLessThan(0.01);
    }
  });

  it('trifft die Rektaszension auf besser als 0,01 Grad', () => {
    for (const [y, m, d] of SAMPLE_DAYS) {
      const mine = posAt(y, m, d);
      const eq = Astronomy.Equator(
        Astronomy.Body.Sun,
        new Date(Date.UTC(y, m - 1, d, 12)),
        new Astronomy.Observer(0, 0, 0),
        true,
        true,
      );
      const raRef = eq.ra * 15; // Stunden zu Grad
      let diff = Math.abs(mine.rightAscension - raRef);
      if (diff > 180) diff = 360 - diff; // Sprung um den Nullpunkt abfangen
      expect(diff).toBeLessThan(0.01);
    }
  });

  it('trifft den Abstand Erde zu Sonne auf besser als 0,0001 AE', () => {
    for (const [y, m, d] of SAMPLE_DAYS) {
      const mine = posAt(y, m, d);
      const vec = Astronomy.GeoVector(
        Astronomy.Body.Sun,
        new Date(Date.UTC(y, m - 1, d, 12)),
        true,
      );
      const dist = Math.hypot(vec.x, vec.y, vec.z);
      expect(Math.abs(mine.radiusVector - dist)).toBeLessThan(0.0001);
    }
  });
});

describe('Zeitgleichung', () => {
  it('28.3 und 28.1 stimmen auf besser als 5 Sekunden ueberein', () => {
    // Warum nicht schaerfer: 28.1 bildet E aus der Rektaszension. Die stammt hier
    // aus dem Low-Precision-Modell mit etwa 0,01 Grad Fehler, und 0,01 Grad sind
    // definitionsgemaess 0,04 Minuten, also 2,4 Sekunden in E. Beobachtet werden
    // bis zu 2,9 Sekunden, genau diese Groessenordnung. 28.3 umgeht die
    // Rektaszension vollstaendig und ist deshalb der genauere der beiden Wege.
    // Genau darum steht 28.3 im Produktivcode und 28.1 nur hier.
    //
    // Was die Pruefung trotzdem leistet: Sie faengt grobe Fehler. Vertauschte
    // Quadranten, Radiant statt Grad oder Faktor 4 statt 15 liegen bei Minuten
    // bis Stunden und wuerden hier sofort auffliegen.
    for (const [y, m, d] of SAMPLE_DAYS) {
      const p = posAt(y, m, d);
      const viaRA = equationOfTimeViaRightAscension(p);
      expect(Math.abs(p.equationOfTimeMin - viaRA)).toBeLessThan(5 / 60);
    }
  });

  it('bleibt ganzjaehrig im bekannten Wertebereich von etwa -14 bis +17 Minuten', () => {
    for (let day = 0; day < 365; day++) {
      const p = sunPosition(instantToJDTT(Date.UTC(2026, 0, 1 + day, 12)));
      expect(p.equationOfTimeMin).toBeGreaterThan(-15);
      expect(p.equationOfTimeMin).toBeLessThan(17.5);
    }
  });

  it('erreicht die Extrema in den richtigen Monaten', () => {
    let min = { v: Infinity, month: 0 };
    let max = { v: -Infinity, month: 0 };
    for (let day = 0; day < 365; day++) {
      const t = Date.UTC(2026, 0, 1 + day, 12);
      const p = sunPosition(instantToJDTT(t));
      const month = new Date(t).getUTCMonth() + 1;
      if (p.equationOfTimeMin < min.v) min = { v: p.equationOfTimeMin, month };
      if (p.equationOfTimeMin > max.v) max = { v: p.equationOfTimeMin, month };
    }
    // Tiefstwert etwa -14 min Mitte Februar, Hoechstwert etwa +16 min Anfang November.
    expect(min.month).toBe(2);
    expect(max.month).toBe(11);
    expect(min.v).toBeLessThan(-13);
    expect(max.v).toBeGreaterThan(15);
  });
});

describe('Deklination im Jahresverlauf', () => {
  it('erreicht die Extrema zu den Sonnenwenden', () => {
    const juni = posAt(2026, 6, 21);
    const dezember = posAt(2026, 12, 21);
    expect(juni.declination).toBeGreaterThan(23.4);
    expect(juni.declination).toBeLessThan(23.45);
    expect(dezember.declination).toBeLessThan(-23.4);
    expect(dezember.declination).toBeGreaterThan(-23.45);
  });

  it('ist zu den Aequinoktien nahe null', () => {
    expect(Math.abs(posAt(2026, 3, 20).declination)).toBeLessThan(0.5);
    expect(Math.abs(posAt(2026, 9, 23).declination)).toBeLessThan(0.5);
  });

  it('liefert eine plausible Schiefe der Ekliptik', () => {
    const p = posAt(2026, 6, 21);
    expect(p.obliquity).toBeGreaterThan(23.43);
    expect(p.obliquity).toBeLessThan(23.44);
  });

  it('liefert einen Halbmesser zwischen 15,7 und 16,3 Bogenminuten', () => {
    for (const [y, m, d] of SAMPLE_DAYS) {
      const arcmin = posAt(y, m, d).semidiameter * 60;
      expect(arcmin).toBeGreaterThan(15.7);
      expect(arcmin).toBeLessThan(16.3);
    }
  });
});
