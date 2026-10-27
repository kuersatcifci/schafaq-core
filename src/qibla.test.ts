import { describe, it, expect } from 'vitest';
import { qiblaVon, himmelsrichtung, KAABA } from './qibla';

describe('qiblaVon', () => {
  it('zeigt von einem Punkt genau nördlich der Kaaba nach Süden', () => {
    const r = qiblaVon(45, KAABA.longitude);
    expect(r.bearing).toBeCloseTo(180, 6);
    expect(r.himmelsrichtung).toBe('Süd');
  });

  it('zeigt von einem Punkt genau südlich der Kaaba nach Norden', () => {
    const r = qiblaVon(-10, KAABA.longitude);
    expect(r.bearing).toBeCloseTo(0, 6);
  });

  it('liefert für Frankfurt die bekannte Peilung nach Südost', () => {
    const r = qiblaVon(50.11, 8.682);
    expect(r.bearing).toBeGreaterThan(127);
    expect(r.bearing).toBeLessThan(129);
    expect(r.himmelsrichtung).toBe('Südost');
    // Luftlinie Frankfurt nach Mekka, rund 4190 km. Gegenprobe von Hand:
    // 28,7 Grad Breitenunterschied sind etwa 3190 km, 31,1 Grad Laenge auf
    // mittlerer Breite etwa 2830 km, zusammen gut 4200 km. Der Grosskreis
    // liegt erwartungsgemaess knapp darunter.
    expect(r.distanceKm).toBeGreaterThan(4100);
    expect(r.distanceKm).toBeLessThan(4300);
  });

  it('liefert an der Kaaba selbst die Entfernung null', () => {
    const r = qiblaVon(KAABA.latitude, KAABA.longitude);
    expect(r.distanceKm).toBeLessThan(0.001);
  });

  it('zeigt von Jakarta nach Westnordwest, nicht nach Westen', () => {
    // Die Grosskreis-Peilung ist hier der Punkt: Auf einer flachen Karte sieht
    // es so aus, als muesste man genau nach Westen; tatsaechlich zeigt der
    // kuerzeste Weg deutlich noerdlicher.
    const r = qiblaVon(-6.2, 106.8);
    expect(r.bearing).toBeGreaterThan(290);
    expect(r.bearing).toBeLessThan(300);
  });

  it('zeigt von New York nach Nordost, nicht nach Südost', () => {
    // Der klassische Fall, an dem sich zeigt, dass eine Linie auf der Karte
    // nicht die Qibla ist.
    const r = qiblaVon(40.71, -74.01);
    expect(r.bearing).toBeGreaterThan(55);
    expect(r.bearing).toBeLessThan(60);
  });

  it('bleibt für jede Position im gültigen Bereich', () => {
    for (let lat = -80; lat <= 80; lat += 20) {
      for (let lon = -180; lon <= 180; lon += 30) {
        const r = qiblaVon(lat, lon);
        expect(r.bearing).toBeGreaterThanOrEqual(0);
        expect(r.bearing).toBeLessThan(360);
        expect(r.distanceKm).toBeGreaterThanOrEqual(0);
        expect(r.distanceKm).toBeLessThan(20038);
      }
    }
  });
});

describe('himmelsrichtung', () => {
  it('rundet auf Sechzehntel', () => {
    expect(himmelsrichtung(0)).toBe('Nord');
    expect(himmelsrichtung(90)).toBe('Ost');
    expect(himmelsrichtung(180)).toBe('Süd');
    expect(himmelsrichtung(270)).toBe('West');
    expect(himmelsrichtung(135)).toBe('Südost');
    // 359 Grad ist wieder Nord, nicht Nordnordwest.
    expect(himmelsrichtung(359)).toBe('Nord');
  });
});
