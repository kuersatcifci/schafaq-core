import { describe, it, expect } from 'vitest';
import { computeSchedule, DEFAULT_SETTINGS } from './schedule';
import { markenAus, bestimmeWaqt, GEBETE, type Marke } from './waqt';

/**
 * Frankfurt, 2. August 2026. Aus dem laufenden Betrieb bekannt:
 * Fajr 04:28, Sonnenaufgang 05:56, Dhur 13:32, Assr 17:39,
 * Maghreb 21:07, Isha 22:36 Ortszeit.
 */
const ORT = { latitude: 49.995, longitude: 8.584, zone: 'Europe/Berlin' };
const EINSTELLUNGEN = { ...DEFAULT_SETTINGS, location: ORT };
const TAG = { year: 2026, month: 8, day: 2 };

function tagVersetzt(tage: number) {
  const d = new Date(Date.UTC(TAG.year, TAG.month - 1, TAG.day));
  d.setUTCDate(d.getUTCDate() + tage);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const marken = markenAus(
  computeSchedule(EINSTELLUNGEN, tagVersetzt(-1)).times,
  computeSchedule(EINSTELLUNGEN, TAG).times,
  computeSchedule(EINSTELLUNGEN, tagVersetzt(1)).times,
);

/** Ortszeit als Instant, damit die Testfaelle lesbar bleiben. */
function ortszeit(stunde: number, minute: number, tageVersetzt = 0): number {
  const d = tagVersetzt(tageVersetzt);
  // Europe/Berlin ist im August UTC+2.
  return Date.UTC(d.year, d.month - 1, d.day, stunde - 2, minute);
}

describe('Waqt: welches Gebet laeuft, welches kommt', () => {
  it('kennt alle sechs Marken je Tag, nicht nur die Haelfte', () => {
    // Der eigentliche Fehler: 'fajr', 'sunrise' und 'isha' wurden durch
    // deutsche Schluesselnamen stumm verworfen. Drei Tage mal sechs Marken.
    expect(marken.length).toBe(18);
    for (const k of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      expect(marken.filter((m) => m.key === k).length).toBe(3);
    }
  });

  it('ist aufsteigend sortiert', () => {
    for (let i = 1; i < marken.length; i++) {
      expect(marken[i]!.instant).toBeGreaterThan(marken[i - 1]!.instant);
    }
  });

  it('nennt kurz vor Isha auch Isha, nicht den Dhur des Folgetages', () => {
    // Der gemeldete Fehler, wortwoertlich. Maghreb 21:07, Isha 22:36.
    const lage = bestimmeWaqt(marken, ortszeit(22, 30));
    expect(lage.naechstesGebet?.key).toBe('isha');
    expect(lage.laufend?.key).toBe('maghrib');
    expect(lage.naechsteGrenze).toBeNull();
  });

  it('laesst zwischen Sonnenaufgang und Dhur keinen Waqt laufen', () => {
    const lage = bestimmeWaqt(marken, ortszeit(9, 0));
    expect(lage.laufend).toBeNull();
    expect(lage.naechstesGebet?.key).toBe('dhuhr');
  });

  it('nennt waehrend Fajr das naechste GEBET, nicht den Sonnenaufgang', () => {
    // Die Zusage: Im Kopf steht immer das naechste Gebet. Der Sonnenaufgang
    // liegt hier dazwischen und wird getrennt gemeldet.
    const lage = bestimmeWaqt(marken, ortszeit(5, 0));
    expect(lage.laufend?.key).toBe('fajr');
    expect(lage.naechstesGebet?.key).toBe('dhuhr');
    expect(lage.naechsteGrenze?.key).toBe('sunrise');
    expect(lage.naechsteGrenze!.instant).toBeLessThan(lage.naechstesGebet!.instant);
  });

  it('traegt nach Mitternacht ueber den Tageswechsel', () => {
    // Um 01:00 laeuft Isha des VORTAGES, naechstes Gebet ist Fajr.
    const lage = bestimmeWaqt(marken, ortszeit(1, 0));
    expect(lage.laufend?.key).toBe('isha');
    expect(lage.naechstesGebet?.key).toBe('fajr');
    expect(lage.laufend!.instant).toBeLessThan(ortszeit(0, 0));
  });

  it('meldet nach Isha das Fajr des Folgetages', () => {
    const lage = bestimmeWaqt(marken, ortszeit(23, 30));
    expect(lage.naechstesGebet?.key).toBe('fajr');
    expect(lage.naechstesGebet!.instant).toBeGreaterThan(ortszeit(0, 0, 1));
  });

  it('gibt nie eine Grenze als naechstes Gebet aus', () => {
    // Ueber den ganzen Tag in Zehnminutenschritten: Was als naechstes Gebet
    // gemeldet wird, ist immer eines der fuenf.
    for (let min = 0; min < 24 * 60; min += 10) {
      const lage = bestimmeWaqt(marken, ortszeit(0, min));
      expect(lage.naechstesGebet).not.toBeNull();
      expect(GEBETE).toContain(lage.naechstesGebet!.key);
      expect(lage.naechstesGebet!.instant).toBeGreaterThan(ortszeit(0, min));
    }
  });

  it('meldet als laufend immer ein Gebet oder nichts', () => {
    for (let min = 0; min < 24 * 60; min += 10) {
      const lage = bestimmeWaqt(marken, ortszeit(0, min));
      if (lage.laufend) expect(GEBETE).toContain(lage.laufend.key);
    }
  });

  it('haelt die Reihenfolge ein: laufend liegt vor jetzt, naechstes danach', () => {
    for (let min = 0; min < 24 * 60; min += 17) {
      const jetzt = ortszeit(0, min);
      const lage = bestimmeWaqt(marken, jetzt);
      if (lage.laufend) expect(lage.laufend.instant).toBeLessThanOrEqual(jetzt);
      expect(lage.naechstesGebet!.instant).toBeGreaterThan(jetzt);
    }
  });

  it('verwirft Zeiten, die nicht eintreten, statt sie als Marke zu fuehren', () => {
    // Tromsoe zur Sonnenwende: Fajr und Isha existieren nicht.
    const tromsoe = {
      ...DEFAULT_SETTINGS,
      location: { latitude: 69.65, longitude: 18.96, zone: 'Europe/Oslo' },
    };
    const sonnenwende = { year: 2026, month: 6, day: 21 };
    const m: Marke[] = markenAus(computeSchedule(tromsoe, sonnenwende).times);
    expect(m.some((x) => x.key === 'fajr')).toBe(false);
    expect(m.some((x) => x.key === 'isha')).toBe(false);
    expect(m.some((x) => x.key === 'dhuhr')).toBe(true);
  });
});
