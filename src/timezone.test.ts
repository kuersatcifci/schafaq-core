import { describe, it, expect } from 'vitest';
import {
  tzOffsetMs,
  localNoonAnchor,
  instantToLocalParts,
  isValidZone,
} from './timezone';

const H = 3_600_000;
const MIN = 60_000;

describe('tzOffsetMs', () => {
  it('liefert Winter- und Sommerversatz fuer Europe/Berlin', () => {
    // 15. Januar 2026, 12:00 UTC -> MEZ, +1 h
    expect(tzOffsetMs('Europe/Berlin', Date.UTC(2026, 0, 15, 12))).toBe(1 * H);
    // 15. Juli 2026, 12:00 UTC -> MESZ, +2 h
    expect(tzOffsetMs('Europe/Berlin', Date.UTC(2026, 6, 15, 12))).toBe(2 * H);
  });

  it('behandelt nicht ganzzahlige Versaetze', () => {
    // Kathmandu +05:45, ganzjaehrig
    expect(tzOffsetMs('Asia/Kathmandu', Date.UTC(2026, 5, 21, 6))).toBe(5 * H + 45 * MIN);
    // Chatham +12:45 (Standard) bzw. +13:45 (Sommerzeit auf der Suedhalbkugel)
    expect(tzOffsetMs('Pacific/Chatham', Date.UTC(2026, 5, 21, 0))).toBe(12 * H + 45 * MIN);
    expect(tzOffsetMs('Pacific/Chatham', Date.UTC(2026, 0, 21, 0))).toBe(13 * H + 45 * MIN);
  });

  it('behandelt die halbstuendige Umstellung auf Lord Howe', () => {
    expect(tzOffsetMs('Australia/Lord_Howe', Date.UTC(2026, 5, 21, 0))).toBe(10 * H + 30 * MIN);
    expect(tzOffsetMs('Australia/Lord_Howe', Date.UTC(2026, 0, 21, 0))).toBe(11 * H);
  });

  it('behandelt Zonen jenseits der Datumsgrenze', () => {
    expect(tzOffsetMs('Pacific/Apia', Date.UTC(2026, 5, 21, 0))).toBe(13 * H);
    expect(tzOffsetMs('Pacific/Kiritimati', Date.UTC(2026, 5, 21, 0))).toBe(14 * H);
  });

  it('wirft bei unbekannter Zone', () => {
    expect(() => tzOffsetMs('Europe/Gondor', 0)).toThrow(/Unbekannte Zeitzone/);
    expect(isValidZone('Europe/Gondor')).toBe(false);
    expect(isValidZone('Europe/Berlin')).toBe(true);
  });
});

describe('localNoonAnchor', () => {
  it('trifft in Europe/Berlin genau 12:00 lokal, im Winter wie im Sommer', () => {
    for (const [y, m, d] of [
      [2026, 1, 15],
      [2026, 7, 15],
    ] as const) {
      const anchor = localNoonAnchor('Europe/Berlin', y, m, d);
      const p = instantToLocalParts('Europe/Berlin', anchor);
      expect([p.year, p.month, p.day, p.hour, p.minute, p.second]).toEqual([y, m, d, 12, 0, 0]);
    }
  });

  it('trifft 12:00 lokal an den beiden Umstellungstagen 2026', () => {
    // 29.03. Umstellung vorwaerts (02:00 -> 03:00), 25.10. rueckwaerts (03:00 -> 02:00)
    for (const [m, d] of [
      [3, 29],
      [10, 25],
    ] as const) {
      const anchor = localNoonAnchor('Europe/Berlin', 2026, m, d);
      const p = instantToLocalParts('Europe/Berlin', anchor);
      expect([p.month, p.day, p.hour, p.minute]).toEqual([m, d, 12, 0]);
    }
  });

  it('trifft 12:00 lokal in Zonen mit ungeraden Versaetzen und jenseits der Datumsgrenze', () => {
    const zones = [
      'Asia/Kathmandu',
      'Pacific/Chatham',
      'Pacific/Apia',
      'Pacific/Kiritimati',
      'Asia/Shanghai',
      'Europe/Madrid',
      'America/Sao_Paulo',
      'Australia/Lord_Howe',
    ];
    for (const zone of zones) {
      const anchor = localNoonAnchor(zone, 2026, 6, 21);
      const p = instantToLocalParts(zone, anchor);
      expect([zone, p.year, p.month, p.day, p.hour, p.minute]).toEqual([zone, 2026, 6, 21, 12, 0]);
    }
  });

  it('Round-Trip: jede Stunde des Jahres 2026 in Europe/Berlin fuehrt auf denselben Mittagsanker', () => {
    const zone = 'Europe/Berlin';
    const start = Date.UTC(2026, 0, 1);
    const end = Date.UTC(2027, 0, 1);
    let checked = 0;

    for (let t = start; t < end; t += H) {
      const p = instantToLocalParts(zone, t);
      const anchor = localNoonAnchor(zone, p.year, p.month, p.day);
      const back = instantToLocalParts(zone, anchor);
      expect(back.year).toBe(p.year);
      expect(back.month).toBe(p.month);
      expect(back.day).toBe(p.day);
      expect(back.hour).toBe(12);
      expect(back.minute).toBe(0);
      checked++;
    }
    // 365 Tage mal 24 Stunden, unabhaengig von der Sommerzeit, weil in UTC gezaehlt wird.
    expect(checked).toBe(8760);
  });
});
