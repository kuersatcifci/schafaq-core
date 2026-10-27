import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, computeSchedule, type Settings } from './schedule';
import { shiftDate } from './rawDay';
import { baueExport } from './export';

describe('baueExport', () => {
  it('liefert 365 Tage ab dem Startdatum', () => {
    const p = baueExport(
      DEFAULT_SETTINGS,
      { year: 2026, month: 1, day: 1 },
      365,
      'Frankfurt am Main',
      1754300000000,
    );
    expect(p.version).toBe(1);
    expect(p.generatedAt).toBe(1754300000000);
    expect(p.days).toHaveLength(365);
    expect(p.days[0]!.d).toBe('2026-01-01');
    expect(p.days[364]!.d).toBe('2026-12-31');
  });

  it('gibt dieselben Zeitpunkte wie computeSchedule', () => {
    const datum = { year: 2026, month: 3, day: 20 };
    const p = baueExport(DEFAULT_SETTINGS, datum, 1, 'Frankfurt am Main', 0);
    const r = computeSchedule(DEFAULT_SETTINGS, datum);
    for (const t of r.times) {
      const e = p.days[0]!.t.find((x) => x.id === t.key);
      expect(e, `Eintrag fehlt: ${t.key}`).toBeDefined();
      expect(e!.ms).toBe(t.instant);
    }
  });

  it('laesst den Eintrag stehen, wenn die Zeit nicht eintritt, und traegt Grad nach', () => {
    // Flensburg zur Sonnenwende bei 18 Grad: Isha tritt nicht ein.
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      location: { latitude: 54.78, longitude: 9.44, zone: 'Europe/Berlin' },
      params: { ...DEFAULT_SETTINGS.params, ishaAngle: 18 },
    };
    const p = baueExport(s, { year: 2026, month: 6, day: 21 }, 1, 'Flensburg', 0);
    const ischa = p.days[0]!.t.find((x) => x.id === 'isha')!;
    expect(ischa).toBeDefined();
    expect(ischa.ms).toBeNull();
    expect(ischa.ersatz).toBeNull();
    expect(ischa.fehlt).toBeGreaterThan(0);
  });

  it('traegt die Einstellungen mit, damit das Nachfuellen sie nicht suchen muss', () => {
    const p = baueExport(DEFAULT_SETTINGS, { year: 2026, month: 1, day: 1 }, 1, 'Frankfurt am Main', 0);
    expect(p.settings.location.zone).toBe('Europe/Berlin');
    expect(p.place.tz).toBe('Europe/Berlin');
  });

  it('deckt sich ueber ein ganzes Jahr mit computeSchedule', () => {
    const p = baueExport(DEFAULT_SETTINGS, { year: 2026, month: 1, day: 1 }, 365, 'Frankfurt am Main', 0);
    let d = { year: 2026, month: 1, day: 1 };
    for (const tag of p.days) {
      const r = computeSchedule(DEFAULT_SETTINGS, d);
      for (const t of r.times) {
        expect(tag.t.find((x) => x.id === t.key)!.ms, `${tag.d} ${t.key}`).toBe(t.instant);
      }
      d = shiftDate(d, 1);
    }
  });
});
