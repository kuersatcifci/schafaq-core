import { describe, it, expect } from 'vitest';
import { solveEvent, solarAltitudeAt, type Direction, type SolveSuccess } from './solve';
import { solarTransit } from './transit';
import { horizonAltitude, twilightAltitude, asrAltitude } from './altitude';
import { instantToLocalParts } from './timezone';
import { tanD, cotD } from './angles';

const ORTE = {
  berlin: { lat: 52.52, lon: 13.405, zone: 'Europe/Berlin' },
  frankfurt: { lat: 50.11, lon: 8.682, zone: 'Europe/Berlin' },
  flensburg: { lat: 54.78, lon: 9.44, zone: 'Europe/Berlin' },
  muenchen: { lat: 48.14, lon: 11.58, zone: 'Europe/Berlin' },
  aequator: { lat: 0, lon: 0, zone: 'UTC' },
  mekka: { lat: 21.42, lon: 39.83, zone: 'Asia/Riyadh' },
  sydney: { lat: -33.87, lon: 151.21, zone: 'Australia/Sydney' },
  acoruna: { lat: 43.37, lon: -8.42, zone: 'Europe/Madrid' },
  kaschgar: { lat: 39.47, lon: 75.99, zone: 'Asia/Shanghai' },
  tromsoe: { lat: 69.65, lon: 18.96, zone: 'Europe/Oslo' },
};

function ok(r: ReturnType<typeof solveEvent>): SolveSuccess {
  if (!r.found) throw new Error('Ereignis wurde nicht gefunden, obwohl erwartet');
  return r;
}

/**
 * Unabhaengige Gegenrechnung: Der halbe Tag wird sekundenweise abgetastet und der
 * erste Vorzeichenwechsel linear interpoliert. Nutzt nur solarAltitudeAt, also
 * weder Stundenwinkel noch Fixpunkt noch Bisektion. Das ist der schaerfste Test
 * des Projekts, weil er ganz ohne externe Bibliothek auskommt.
 */
function bruteForce(
  transit: number,
  lat: number,
  lon: number,
  target: number,
  direction: Direction,
): number | null {
  const sign = direction === 'morgens' ? -1 : 1;
  let prev = solarAltitudeAt(transit, lat, lon) - target;
  for (let k = 1; k <= 12 * 3600; k++) {
    const t = transit + sign * k * 1000;
    const cur = solarAltitudeAt(t, lat, lon) - target;
    if (Math.sign(cur) !== Math.sign(prev)) {
      // Innerhalb der gefundenen Sekunde nachschaerfen. Lineare Interpolation
      // reicht hier nicht: Bei flachem Durchgang, also wenn die Sonne die
      // Zielhoehe nur knapp unterschreitet, ist der Verlauf naeherungsweise eine
      // Parabel und die Sehne liegt mehrere Sekunden daneben. Das Nachschaerfen
      // benutzt weiterhin nur solarAltitudeAt, bleibt also unabhaengig vom
      // Stundenwinkel, vom Fixpunkt und von der Transit-Arithmetik.
      let a = transit + sign * (k - 1) * 1000;
      let b = t;
      let fa = prev;
      for (let i = 0; i < 30; i++) {
        const mid = (a + b) / 2;
        const fMid = solarAltitudeAt(mid, lat, lon) - target;
        if (Math.sign(fMid) === Math.sign(fa)) {
          a = mid;
          fa = fMid;
        } else {
          b = mid;
        }
      }
      return (a + b) / 2;
    }
    prev = cur;
  }
  return null;
}

describe('solarTransit', () => {
  it('trifft den Meridiandurchgang, der Reststundenwinkel verschwindet', () => {
    for (const o of Object.values(ORTE)) {
      const t = solarTransit(o.zone, 2026, 6, 21, o.lon);
      expect(Math.abs(t.residualHourAngleDeg)).toBeLessThan(0.001);
    }
  });

  it('findet in A Coruna den spaeten Sonnenmittag gegen 14:30 Ortszeit', () => {
    const o = ORTE.acoruna;
    const t = solarTransit(o.zone, 2026, 6, 21, o.lon);
    const p = instantToLocalParts(o.zone, t.instant);
    expect(p.day).toBe(21);
    expect(p.hour).toBe(14);
  });

  it('findet in Kaschgar den Sonnenmittag gegen 14:58 Pekinger Zeit', () => {
    // Kaschgar liegt bei 76 Grad Ost, gilt aber Pekinger Zeit (UTC+8, Meridian
    // 120 Grad Ost). Der Sonnenhoechststand liegt deshalb fast drei Stunden nach
    // dem Uhrenmittag. Ohne die Normalisierung des Stundenwinkels lieferte die
    // Rechnung hier den Transit des Vor- oder Folgetags.
    const o = ORTE.kaschgar;
    const t = solarTransit(o.zone, 2026, 6, 21, o.lon);
    const p = instantToLocalParts(o.zone, t.instant);
    expect(p.day).toBe(21);
    expect(p.hour).toBe(14);
    expect(t.offsetFromLocalNoonMin).toBeGreaterThan(150);
  });

  it('bleibt in jeder Zone auf dem angefragten lokalen Kalendertag', () => {
    const faelle = [
      ['Pacific/Apia', -171.77],
      ['Pacific/Kiritimati', -157.4],
      ['Asia/Kathmandu', 85.32],
      ['Pacific/Chatham', -176.55],
    ] as const;
    for (const [zone, lon] of faelle) {
      for (const [m, d] of [
        [1, 1],
        [6, 21],
        [12, 31],
      ] as const) {
        const t = solarTransit(zone, 2026, m, d, lon);
        const p = instantToLocalParts(zone, t.instant);
        expect([zone, p.month, p.day]).toEqual([zone, m, d]);
        expect(Math.abs(t.offsetFromLocalNoonMin)).toBeLessThan(200);
      }
    }
  });
});

describe('solveEvent gegen sekundenweises Abtasten', () => {
  const faelle: Array<[string, keyof typeof ORTE, number, number, number, Direction]> = [
    ['Berlin Sonnenaufgang Maerz', 'berlin', 3, 20, horizonAltitude().altitude, 'morgens'],
    ['Berlin Sonnenuntergang Maerz', 'berlin', 3, 20, horizonAltitude().altitude, 'abends'],
    ['Berlin Fajr 12 Grad Maerz', 'berlin', 3, 20, twilightAltitude(12).altitude, 'morgens'],
    ['Berlin Isha 12 Grad Dezember', 'berlin', 12, 21, twilightAltitude(12).altitude, 'abends'],
    ['Berlin Isha 18 Grad Dezember', 'berlin', 12, 21, twilightAltitude(18).altitude, 'abends'],
    ['Frankfurt Fajr 15 Grad Oktober', 'frankfurt', 10, 15, twilightAltitude(15).altitude, 'morgens'],
    ['Aequator Sonnenaufgang', 'aequator', 3, 20, horizonAltitude().altitude, 'morgens'],
    ['Mekka Sonnenuntergang Juli', 'mekka', 7, 16, horizonAltitude().altitude, 'abends'],
    ['Sydney Sonnenaufgang Juni', 'sydney', 6, 21, horizonAltitude().altitude, 'morgens'],
    ['Sydney Sonnenuntergang Dezember', 'sydney', 12, 21, horizonAltitude().altitude, 'abends'],
    ['Muenchen Isha 18 Grad Sonnenwende', 'muenchen', 6, 21, twilightAltitude(18).altitude, 'abends'],
  ];

  it.each(faelle)('%s stimmt auf unter eine Sekunde', (_name, ortKey, m, d, target, dir) => {
    const o = ORTE[ortKey];
    const transit = solarTransit(o.zone, 2026, m, d, o.lon).instant;
    const analytic = ok(
      solveEvent({
        transitInstant: transit,
        latitude: o.lat,
        longitude: o.lon,
        targetAltitude: target,
        direction: dir,
      }),
    );
    const brute = bruteForce(transit, o.lat, o.lon, target, dir);
    expect(brute).not.toBeNull();
    expect(Math.abs(analytic.instant - brute!)).toBeLessThan(1000);
    expect(Math.abs(solarAltitudeAt(analytic.instant, o.lat, o.lon) - target)).toBeLessThan(0.005);
  });

  it('haelt auch am streifenden Durchgang die Sekunde ein', () => {
    // Kuenstlich streifender Fall: Die Zielhoehe wird eine Hundertstel Grad ueber
    // die tiefste Sonnenhoehe des Tages gelegt. Dort geht die Hoehenaenderung
    // gegen null, das heisst ein winziger Hoehenfehler entspricht einem grossen
    // Zeitfehler. Genau hier scheitert jedes Verfahren, das auf einen Hoehenrest
    // abbricht, und genau hier muss die Bisektion ihre Staerke zeigen.
    const o = ORTE.berlin;
    const tr = solarTransit(o.zone, 2026, 6, 21, o.lon);
    const hMin = Math.abs(o.lat + tr.declination) - 90;
    const target = hMin + 0.01;
    const r = ok(
      solveEvent({
        transitInstant: tr.instant,
        latitude: o.lat,
        longitude: o.lon,
        targetAltitude: target,
        direction: 'abends',
      }),
    );
    const brute = bruteForce(tr.instant, o.lat, o.lon, target, 'abends');
    expect(brute).not.toBeNull();
    expect(Math.abs(r.instant - brute!)).toBeLessThan(1000);
  });

  it('weist im Protokoll aus, wie weit die reine Stundenwinkel-Naeherung danebenliegt', () => {
    const o = ORTE.muenchen;
    const transit = solarTransit(o.zone, 2026, 6, 21, o.lon).instant;
    const r = ok(
      solveEvent({
        transitInstant: transit,
        latitude: o.lat,
        longitude: o.lon,
        targetAltitude: twilightAltitude(18).altitude,
        direction: 'abends',
      }),
    );
    // An diesem flachen Durchgang weicht die Naeherung um mehrere Sekunden ab.
    // Das ist kein Fehler, sondern der Grund fuer die Bisektion, und es gehoert
    // sichtbar ins Rechenprotokoll.
    expect(r.estimateDeviationMs).not.toBeNull();
    expect(Math.abs(r.estimateDeviationMs!)).toBeGreaterThan(1000);
  });
});

describe('Nichteintreten wird ehrlich gemeldet', () => {
  it('Berlin, 21. Juni, Isha bei 18 Grad: verfehlt um etwa 3,9 Grad', () => {
    const o = ORTE.berlin;
    const transit = solarTransit(o.zone, 2026, 6, 21, o.lon).instant;
    const r = solveEvent({
      transitInstant: transit,
      latitude: o.lat,
      longitude: o.lon,
      targetAltitude: twilightAltitude(18).altitude,
      direction: 'abends',
    });
    expect(r.found).toBe(false);
    if (r.found) return;
    expect(r.existence.reason).toBe('sonne_bleibt_hoeher');
    expect(r.existence.marginDeg).toBeGreaterThan(3.8);
    expect(r.existence.marginDeg).toBeLessThan(4.1);
    expect(r.existence.hMin).toBeGreaterThan(-14.2);
    expect(r.existence.hMin).toBeLessThan(-13.9);
  });

  it('Flensburg, 21. Juni, 12 Grad: knapp ueber der Schwelle, tritt nicht ein', () => {
    const o = ORTE.flensburg;
    const transit = solarTransit(o.zone, 2026, 6, 21, o.lon).instant;
    const r = solveEvent({
      transitInstant: transit,
      latitude: o.lat,
      longitude: o.lon,
      targetAltitude: twilightAltitude(12).altitude,
      direction: 'abends',
    });
    expect(r.found).toBe(false);
    if (r.found) return;
    // Die kritische Breite fuer 12 Grad liegt bei 54,56 Grad, Flensburg bei 54,78.
    expect(r.existence.marginDeg).toBeLessThan(0.5);
  });

  it('Berlin, 21. Juni, 12 Grad: tritt ein, aber erst kurz vor Mitternacht', () => {
    const o = ORTE.berlin;
    const transit = solarTransit(o.zone, 2026, 6, 21, o.lon).instant;
    const r = ok(
      solveEvent({
        transitInstant: transit,
        latitude: o.lat,
        longitude: o.lon,
        targetAltitude: twilightAltitude(12).altitude,
        direction: 'abends',
      }),
    );
    const p = instantToLocalParts(o.zone, r.instant);
    // Der Stundenwinkel fuer -12 Grad betraegt hier 159,7 Grad, das sind
    // 10 Stunden 39 Minuten nach dem Transit um 13:12. Isha liegt damit gegen
    // 23:51 Ortszeit, also knapp vor Mitternacht und noch am selben Tag.
    // Bei kleineren Winkeln oder weiter noerdlich kippt es ueber Mitternacht,
    // deshalb muss die Anzeige den Folgetag trotzdem kennzeichnen koennen.
    expect(p.day).toBe(21);
    expect(p.hour).toBe(23);
    expect(p.minute).toBeGreaterThan(40);
  });

  it('Tromsoe zur Sonnenwende: Sonnenuntergang existiert nicht', () => {
    const o = ORTE.tromsoe;
    const transit = solarTransit(o.zone, 2026, 6, 21, o.lon).instant;
    const r = solveEvent({
      transitInstant: transit,
      latitude: o.lat,
      longitude: o.lon,
      targetAltitude: horizonAltitude().altitude,
      direction: 'abends',
    });
    expect(r.found).toBe(false);
    if (!r.found) expect(r.existence.reason).toBe('sonne_bleibt_hoeher');
  });
});

describe('Assr', () => {
  it('der gefundene Zeitpunkt erfuellt die Schattendefinition exakt', () => {
    for (const ortKey of ['berlin', 'mekka', 'sydney'] as const) {
      for (const [m, d] of [
        [3, 20],
        [6, 21],
        [12, 21],
      ] as const) {
        for (const f of [1, 2]) {
          const o = ORTE[ortKey];
          const tr = solarTransit(o.zone, 2026, m, d, o.lon);
          const target = asrAltitude(o.lat, tr.declination, f);
          const r = ok(
            solveEvent({
              transitInstant: tr.instant,
              latitude: o.lat,
              longitude: o.lon,
              targetAltitude: target.altitude,
              direction: 'abends',
            }),
          );
          const mittagsschatten = tanD(target.transitZenithDistance);

          // Teil eins, die Definition: Der Zielwinkel selbst muss den
          // Schattenfaktor exakt erfuellen. Hier ist keine Toleranz noetig.
          expect(cotD(target.altitude) - mittagsschatten).toBeCloseTo(f, 9);

          // Teil zwei, der Loeser: Die Sonne steht zum gefundenen Zeitpunkt
          // tatsaechlich auf dieser Hoehe.
          const hIst = solarAltitudeAt(r.instant, o.lat, o.lon);
          expect(Math.abs(hIst - target.altitude)).toBeLessThan(0.005);

          // Teil drei, der Schatten in der Praxis. Die Toleranz ist hier weiter
          // als 0,005 Grad, weil der Kotangens bei tiefstehender Sonne steil
          // ansteigt: In Berlin im Dezember steht Assr bei etwa 11 Grad, dort
          // schlagen 0,005 Grad Hoehenfehler schon als 0,002 im Schattenmass
          // durch. Am Zollstock waeren das unter einem Millimeter je Meter.
          expect(Math.abs(cotD(hIst) - mittagsschatten - f)).toBeLessThan(0.01);
        }
      }
    }
  });

  it('in Mekka verschwindet der Mittagsschatten, Assr folgt dann atan(1/f)', () => {
    const o = ORTE.mekka;
    // Um den 16. Juli steht die Sonne in Mekka im Zenit, delta gleich phi.
    const tr = solarTransit(o.zone, 2026, 7, 16, o.lon);
    expect(Math.abs(o.lat - tr.declination)).toBeLessThan(0.5);
    const t1 = asrAltitude(o.lat, tr.declination, 1);
    // atan(1/1) ist 45 Grad, plus die winzige Restzenitdistanz.
    expect(t1.altitude).toBeGreaterThan(44);
    expect(t1.altitude).toBeLessThan(45.1);
  });

  it('lehnt einen Schattenfaktor von null ab', () => {
    expect(() => asrAltitude(52, 20, 0)).toThrow(/Schattenfaktor/);
  });
});

describe('Hoehe ueber dem sichtbaren Horizont', () => {
  it('macht den Sonnenaufgang frueher und den Untergang spaeter', () => {
    const o = ORTE.frankfurt;
    const transit = solarTransit(o.zone, 2026, 4, 15, o.lon).instant;
    const zeit = (elev: number, dir: Direction) =>
      ok(
        solveEvent({
          transitInstant: transit,
          latitude: o.lat,
          longitude: o.lon,
          targetAltitude: horizonAltitude(elev).altitude,
          direction: dir,
        }),
      ).instant;

    expect(zeit(500, 'morgens')).toBeLessThan(zeit(0, 'morgens'));
    expect(zeit(500, 'abends')).toBeGreaterThan(zeit(0, 'abends'));
    // 500 Meter ergeben etwa 0,78 Grad Kimmtiefe, also einige Minuten.
    const delta = zeit(0, 'morgens') - zeit(500, 'morgens');
    expect(delta).toBeGreaterThan(60_000);
    expect(delta).toBeLessThan(900_000);
  });
});

describe('Aequator zur Tagundnachtgleiche', () => {
  it('hat einen Tag von etwas ueber 12 Stunden, nicht exakt 12 Stunden', () => {
    const o = ORTE.aequator;
    const transit = solarTransit(o.zone, 2026, 3, 20, o.lon).instant;
    const zeit = (dir: Direction) =>
      ok(
        solveEvent({
          transitInstant: transit,
          latitude: o.lat,
          longitude: o.lon,
          targetAltitude: horizonAltitude().altitude,
          direction: dir,
        }),
      ).instant;
    const minuten = (zeit('abends') - zeit('morgens')) / 60_000;
    // Die Ueberlaenge kommt aus Refraktion und halbem Sonnendurchmesser.
    // Wer die -0,833 Grad vergisst, bekommt hier glatte 720 Minuten.
    expect(minuten).toBeGreaterThan(725);
    expect(minuten).toBeLessThan(730);
  });
});
