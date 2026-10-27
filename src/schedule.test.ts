import { describe, it, expect } from 'vitest';
import { computeSchedule, DEFAULT_SETTINGS, type Settings, type TimeKey } from './schedule';
import { DEFAULT_PARAMS, shiftDate, type CalendarDate } from './rawDay';
import { DEFAULT_HIGHLAT } from './highLatitude';
import { validateSettings, settingsToQuery, settingsFromQuery } from './params';
import { formatTime, formatDuration, formatDegrees, LABELS } from './format';

const MIN = 60_000;

const FRANKFURT: Settings = {
  ...DEFAULT_SETTINGS,
  location: { latitude: 50.11, longitude: 8.682, zone: 'Europe/Berlin' },
};
const BERLIN: Settings = {
  ...DEFAULT_SETTINGS,
  location: { latitude: 52.52, longitude: 13.405, zone: 'Europe/Berlin' },
};
const KAIRO: Settings = {
  ...DEFAULT_SETTINGS,
  location: { latitude: 30.044, longitude: 31.236, zone: 'Africa/Cairo' },
};

const zeit = (r: ReturnType<typeof computeSchedule>, key: TimeKey) =>
  r.times.find((t) => t.key === key)!;

describe('computeSchedule an einem gewoehnlichen Tag', () => {
  const r = computeSchedule(FRANKFURT, { year: 2026, month: 3, day: 20 });

  it('liefert acht Zeiten, alle gerechnet', () => {
    expect(r.times).toHaveLength(8);
    expect(r.times.every((t) => t.instant !== null)).toBe(true);
    expect(r.times.every((t) => t.source === 'berechnet')).toBe(true);
  });

  it('haelt die Reihenfolge der sechs Hauptzeiten ein', () => {
    const keys: TimeKey[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const werte = keys.map((k) => zeit(r, k).instant!);
    for (let i = 1; i < werte.length; i++) expect(werte[i]!).toBeGreaterThan(werte[i - 1]!);
  });

  it('rundet Gebetszeiten auf und den Sonnenaufgang ab', () => {
    for (const t of r.times) {
      expect(t.instant! % MIN).toBe(0);
      const delta = t.instant! - t.exactInstant!;
      if (t.key === 'sunrise') {
        // Abgerundet: die angezeigte Zeit liegt nie nach dem echten Aufgang.
        expect(delta).toBeLessThanOrEqual(0);
        expect(delta).toBeGreaterThan(-MIN);
      } else {
        // Aufgerundet: die Anzeige behauptet nie eine Gebetszeit vor ihrem Eintritt.
        expect(delta).toBeGreaterThanOrEqual(0);
        expect(delta).toBeLessThan(MIN);
      }
    }
  });

  it('bildet die Nacht aus Maghreb und dem Fajr des Folgetages', () => {
    const morgen = computeSchedule(FRANKFURT, { year: 2026, month: 3, day: 21 });
    const nachtLaenge = r.protocol.night.lengthMs!;
    expect(nachtLaenge).toBeCloseTo(
      zeit(morgen, 'fajr').exactInstant! - zeit(r, 'maghrib').exactInstant!,
      -2,
    );
    // Mitte und letztes Drittel liegen im richtigen Verhaeltnis.
    const mitte = zeit(r, 'nachtmitte').exactInstant!;
    const drittel = zeit(r, 'letztes_drittel').exactInstant!;
    const start = zeit(r, 'maghrib').exactInstant!;
    expect((mitte - start) / nachtLaenge).toBeCloseTo(0.5, 6);
    expect((drittel - start) / nachtLaenge).toBeCloseTo(2 / 3, 6);
  });
});

describe('Das Rechenprotokoll', () => {
  const r = computeSchedule(FRANKFURT, { year: 2026, month: 3, day: 20 });
  const p = r.protocol;

  it('nennt Eingaben und Methode vollstaendig', () => {
    expect(p.inputs.latitude).toBe(50.11);
    expect(p.inputs.zone).toBe('Europe/Berlin');
    expect(p.inputs.elevationApplied).toBe(false);
    expect(p.method.fajrAngle).toBe(12);
    expect(p.method.asrFactor).toBe(1);
    expect(p.method.highLatRule).toBe('keine');
  });

  it('benennt die Annahmen, insbesondere die groesste Unsicherheit', () => {
    expect(p.assumptions.length).toBeGreaterThan(4);
    expect(p.assumptions.join(' ')).toMatch(/Refraktionsschwankungen/);
    expect(p.assumptions.join(' ')).toMatch(/nicht für die Dämmerungswinkel/);
  });

  it('liefert je Ereignis die Zwischenwerte, aus denen die Zeit entstanden ist', () => {
    for (const ev of p.events) {
      expect(ev.exactInstant).not.toBeNull();
      expect(ev.roundedInstant).not.toBeNull();
      expect(ev.roundingDeltaMs).not.toBeNull();
      expect(Math.abs(ev.roundingDeltaMs!)).toBeLessThan(MIN);

      if (ev.key === 'dhuhr') {
        // Dhur hat keine Zielhoehe, es ist der Transit selbst.
        expect(ev.targetAltitude).toBeNull();
        expect(ev.method).toBe('transit');
        expect(ev.hourAngle).toBe(0);
      } else {
        expect(ev.targetAltitude).not.toBeNull();
        expect(ev.declinationUsed).not.toBeNull();
        expect(ev.cosH).not.toBeNull();
        expect(ev.method).toBe('bisektion');
        expect(Math.abs(ev.residualDeg!)).toBeLessThan(0.005);
      }
    }
  });

  it('schluesselt die Zielhoehen richtig auf', () => {
    const fajr = p.events.find((e) => e.key === 'fajr')!;
    // Daemmerungswinkel: reiner Winkel, keine Refraktion, keine Kimmtiefe.
    expect(fajr.targetAltitude).toBe(-12);
    expect(fajr.targetBreakdown).toEqual({ base: -12, refractionAndSemidiameter: 0, dip: 0 });

    const maghrib = p.events.find((e) => e.key === 'maghrib')!;
    // Horizont: Refraktion und halber Sonnendurchmesser, keine Kimmtiefe bei 0 m.
    expect(maghrib.targetBreakdown).toEqual({
      base: 0,
      refractionAndSemidiameter: -0.833,
      dip: 0,
    });
  });

  it('haelt den Assr-Mittagsschatten fest', () => {
    expect(p.asr).not.toBeNull();
    // Zur Tagundnachtgleiche ist die Zenitdistanz zum Transit gleich der Breite.
    expect(p.asr!.transitZenithDistance).toBeCloseTo(50.11, 0);
    // Und der Zielwinkel erfuellt die Definition exakt.
    expect(1 / Math.tan((p.asr!.targetAltitude * Math.PI) / 180) - p.asr!.shadowAtNoon).toBeCloseTo(
      1,
      9,
    );
  });

  it('bestaetigt, dass der Transit getroffen wurde', () => {
    expect(Math.abs(p.solar.residualHourAngleDeg)).toBeLessThan(0.001);
  });
});

describe('Wenn ein Winkel nicht erreicht wird', () => {
  const einstellungen: Settings = {
    ...BERLIN,
    params: { ...DEFAULT_PARAMS, fajrAngle: 18, ishaAngle: 18 },
  };
  const r = computeSchedule(einstellungen, { year: 2026, month: 6, day: 21 });

  it('meldet Fajr und Isha als nicht eingetreten, mit Fehlmarge', () => {
    for (const key of ['fajr', 'isha'] as const) {
      const t = zeit(r, key);
      expect(t.instant).toBeNull();
      expect(t.source).toBe('nicht_eingetreten');
      expect(t.existence!.marginDeg).toBeGreaterThan(3.8);
      expect(t.existence!.marginDeg).toBeLessThan(4.1);
    }
  });

  it('nennt im Protokoll die tiefste Sonnenhoehe des Tages', () => {
    // Das ist der Wert, den die App anzeigt statt einer erfundenen Uhrzeit.
    expect(r.protocol.culmination.hMin).toBeGreaterThan(-14.2);
    expect(r.protocol.culmination.hMin).toBeLessThan(-13.9);
  });

  it('laesst Sonnenaufgang, Dhur, Assr und Maghreb unberuehrt', () => {
    for (const key of ['sunrise', 'dhuhr', 'asr', 'maghrib'] as const) {
      expect(zeit(r, key).instant).not.toBeNull();
    }
  });

  it('kann die Nacht dann nicht bilden', () => {
    expect(zeit(r, 'nachtmitte').instant).toBeNull();
    expect(r.protocol.night.lengthMs).toBeNull();
  });

  it('kennzeichnet mit Ersatzregel die Herkunft und die Abhaengigkeit der Nacht', () => {
    const mitRegel = computeSchedule(
      { ...einstellungen, highLat: { ...DEFAULT_HIGHLAT, rule: 'siebtel' } },
      { year: 2026, month: 6, day: 21 },
    );
    const isha = zeit(mitRegel, 'isha');
    expect(isha.source).toBe('ersatzregel');
    expect(isha.appliedRule!.rule).toBe('siebtel');

    const mitte = zeit(mitRegel, 'nachtmitte');
    expect(mitte.instant).not.toBeNull();
    expect(mitte.source).toBe('ersatzregel');
    expect(mitRegel.protocol.night.basedOnSubstitute).toBe(true);
    expect(mitRegel.protocol.warnings.join(' ')).toMatch(/ersatzweise berechneten Fajr/);
  });
});

describe('Tageswechsel', () => {
  it('kennzeichnet Isha als Folgetag, wenn es nach Mitternacht faellt', () => {
    // Bei 13 Grad liegt Isha in Berlin zur Sonnenwende nach Mitternacht,
    // bei 12 Grad noch knapp davor.
    const spaet = computeSchedule(
      { ...BERLIN, params: { ...DEFAULT_PARAMS, ishaAngle: 13 } },
      { year: 2026, month: 6, day: 21 },
    );
    expect(zeit(spaet, 'isha').dayShift).toBe(1);

    const knappDavor = computeSchedule(BERLIN, { year: 2026, month: 6, day: 21 });
    expect(zeit(knappDavor, 'isha').dayShift).toBe(0);
  });

  it('setzt dayShift auf null fuer die Hauptzeiten eines gewoehnlichen Wintertags', () => {
    const r = computeSchedule(FRANKFURT, { year: 2026, month: 12, day: 21 });
    for (const t of r.times) {
      if (t.key === 'nachtmitte' || t.key === 'letztes_drittel') continue;
      expect(t.dayShift).toBe(0);
    }
  });
});

describe('params: Validierung', () => {
  const gut = {
    location: { latitude: 50.11, longitude: 8.682, zone: 'Europe/Berlin' },
    params: DEFAULT_PARAMS,
    highLat: { rule: 'keine', fixedOffsetMin: 75 },
    rounding: 'ceil',
    nightDefinition: 'maghrib_bis_fadschr',
  };

  it('nimmt gueltige Eingaben an', () => {
    const r = validateSettings(gut);
    expect(r.ok).toBe(true);
    expect(r.settings!.location.latitude).toBe(50.11);
  });

  it('lehnt unmoegliche Koordinaten ab', () => {
    const r = validateSettings({ ...gut, location: { latitude: 91, longitude: 181, zone: 'UTC' } });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.field).sort()).toEqual(['latitude', 'longitude']);
  });

  it('lehnt unsinnige Winkel ab, statt sie zu rechnen', () => {
    for (const winkel of [0, 90, -5, Number.NaN, 'keine Zahl']) {
      const r = validateSettings({ ...gut, params: { ...DEFAULT_PARAMS, fajrAngle: winkel } });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.field === 'fajrAngle')).toBe(true);
    }
  });

  it('lehnt einen Schattenfaktor von null ab', () => {
    const r = validateSettings({ ...gut, params: { ...DEFAULT_PARAMS, asrFactor: 0 } });
    expect(r.ok).toBe(false);
  });

  it('lehnt eine unbekannte Zeitzone ab', () => {
    const r = validateSettings({ ...gut, location: { ...gut.location, zone: 'Europe/Gondor' } });
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/unbekannt/);
  });

  it('meldet alle Fehler auf einmal, nicht nur den ersten', () => {
    const r = validateSettings({
      location: { latitude: 91, longitude: 999, zone: 'Nirgendwo' },
      params: { ...DEFAULT_PARAMS, fajrAngle: 0, asrFactor: -1 },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(5);
  });

  it('akzeptiert das deutsche Dezimalkomma', () => {
    const r = validateSettings({ ...gut, location: { ...gut.location, latitude: '50,11' } });
    expect(r.ok).toBe(true);
    expect(r.settings!.location.latitude).toBe(50.11);
  });
});

describe('params: Rechnung teilbar machen', () => {
  it('ueberlebt den Weg durch die URL unveraendert', () => {
    const original: Settings = {
      location: { latitude: 41.0082, longitude: 28.9784, zone: 'Europe/Istanbul' },
      params: {
        fajrAngle: 18,
        ishaAngle: 17,
        asrFactor: 2,
        dhuhrOffsetMin: 3,
        elevationMeters: 120,
      },
      highLat: { rule: 'fester_versatz', fixedOffsetMin: 90, maxSearchDays: 200 },
      rounding: 'nearest',
      nightDefinition: 'untergang_bis_aufgang',
    };
    const zurueck = settingsFromQuery(settingsToQuery(original));
    expect(zurueck.ok).toBe(true);
    expect(zurueck.settings).toEqual(original);
  });

  it('ergaenzt fehlende Felder aus den Voreinstellungen', () => {
    const r = settingsFromQuery('fajr=18', FRANKFURT);
    expect(r.ok).toBe(true);
    expect(r.settings!.params.fajrAngle).toBe(18);
    expect(r.settings!.location.zone).toBe('Europe/Berlin');
  });

  it('lehnt einen manipulierten Link ab, statt Unsinn zu rechnen', () => {
    expect(settingsFromQuery('lat=999').ok).toBe(false);
    expect(settingsFromQuery('hl=erfunden').ok).toBe(false);
  });
});

describe('format', () => {
  it('formatiert in der Zone des ORTES, nicht des Geraets', () => {
    const r = computeSchedule(KAIRO, { year: 2026, month: 6, day: 21 });
    const maghrib = zeit(r, 'maghrib');
    const inKairo = formatTime(maghrib.instant, 'Africa/Cairo');
    const inBerlin = formatTime(maghrib.instant, 'Europe/Berlin');
    expect(inKairo).not.toBe(inBerlin);
    expect(inKairo).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formatiert Dauern und Gradzahlen deutsch', () => {
    expect(formatDuration(7 * 3_600_000 + 35 * MIN)).toBe('7 h 35 min');
    expect(formatDuration(45 * MIN)).toBe('45 min');
    expect(formatDegrees(-14.0432)).toBe('-14,04°');
    expect(formatDegrees(null)).toBeNull();
  });

  it('hat fuer jede Zeit eine Bezeichnung', () => {
    const r = computeSchedule(FRANKFURT, { year: 2026, month: 3, day: 20 });
    for (const t of r.times) expect(LABELS[t.key]).toBeTruthy();
  });
});

describe('Golden Files', () => {
  const jahr = (s: Settings, label: string): string => {
    const keys: TimeKey[] = [
      'fajr',
      'sunrise',
      'dhuhr',
      'asr',
      'maghrib',
      'isha',
      'nachtmitte',
      'letztes_drittel',
    ];
    const zeilen: string[] = [`# ${label}`];
    let d: CalendarDate = { year: 2026, month: 1, day: 1 };
    for (let i = 0; i < 365; i++) {
      const r = computeSchedule(s, d);
      const spalten = keys.map((k) => {
        const t = zeit(r, k);
        if (t.instant === null) return '  --   ';
        const txt = formatTime(t.instant, s.location.zone)!;
        // Beide Markierungen unabhaengig voneinander. Ein ersatzweise
        // berechneter Wert kann sehr wohl zugleich auf den Folgetag fallen;
        // im 18-Grad-Fall in Frankfurt ist genau das der Regelfall.
        const ersatz = t.source === 'ersatzregel' ? '*' : ' ';
        const folgetag = t.dayShift > 0 ? '+' : t.dayShift < 0 ? '-' : ' ';
        return `${txt}${ersatz}${folgetag}`;
      });
      const datum = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      zeilen.push(`${datum} ${spalten.join(' ')}`);
      d = shiftDate(d, 1);
    }
    return zeilen.join('\n');
  };

  // Ein volles Jahr als Schnappschuss. Jede Aenderung am Rechenkern erzeugt
  // damit einen sichtbaren Diff, und zwar an genau den Tagen, an denen sie
  // wirkt. Fuer eine App, die Nachvollziehbarkeit verspricht, ist das
  // gleichzeitig Dokumentation.
  it('Frankfurt 2026, Voreinstellungen', () => {
    expect(
      jahr(FRANKFURT, 'Frankfurt 50,11 N / 8,682 O, Fajr und Isha 12 Grad, Assr 1'),
    ).toMatchSnapshot();
  });

  it('Frankfurt 2026, 18 Grad mit Aqrab al-Ayyam', () => {
    const s: Settings = {
      ...FRANKFURT,
      params: { ...DEFAULT_PARAMS, fajrAngle: 18, ishaAngle: 18 },
      highLat: { ...DEFAULT_HIGHLAT, rule: 'aqrab_al_ayyam' },
    };
    expect(
      jahr(s, 'Frankfurt, 18 Grad, Aqrab al-Ayyam (* = Ersatzregel, + = Folgetag)'),
    ).toMatchSnapshot();
  });

  it('Kairo 2026, Voreinstellungen', () => {
    expect(
      jahr(KAIRO, 'Kairo 30,044 N / 31,236 O, Fajr und Isha 12 Grad, Assr 1'),
    ).toMatchSnapshot();
  });
});
