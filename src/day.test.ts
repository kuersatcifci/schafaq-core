import { describe, it, expect } from 'vitest';
import {
  computeRawDay,
  shiftDate,
  DEFAULT_PARAMS,
  EVENT_ORDER,
  type CalendarDate,
  type LocationInput,
  type MethodParams,
  type RawDay,
} from './rawDay';
import { nightSpan } from './night';
import { applyHighLatitude, DEFAULT_HIGHLAT, type HighLatRule } from './highLatitude';
import { instantToLocalParts, tzOffsetMs } from './timezone';

const BERLIN: LocationInput = { latitude: 52.52, longitude: 13.405, zone: 'Europe/Berlin' };
const FRANKFURT: LocationInput = { latitude: 50.11, longitude: 8.682, zone: 'Europe/Berlin' };
const TROMSOE: LocationInput = { latitude: 69.65, longitude: 18.96, zone: 'Europe/Oslo' };

const MIN = 60_000;
const HOUR = 3_600_000;

/**
 * Zwischenspeichernder Zugriff auf Tagesplaene. Ohne Cache rechnet die
 * Aqrab-Suche denselben Tag hunderte Male neu, und ein Jahresdurchlauf laeuft in
 * die Minuten statt in die Sekunden.
 */
function makeProvider(loc: LocationInput, params: MethodParams) {
  const cache = new Map<string, RawDay>();
  return (date: CalendarDate): RawDay => {
    const key = `${date.year}-${date.month}-${date.day}`;
    let d = cache.get(key);
    if (!d) {
      d = computeRawDay(loc, params, date);
      cache.set(key, d);
    }
    return d;
  };
}

function tagMitNachbarn(loc: LocationInput, params: MethodParams, date: CalendarDate) {
  const get = makeProvider(loc, params);
  return { day: get(date), relativ: (offset: number) => get(shiftDate(date, offset)) };
}

describe('computeRawDay an einem gewoehnlichen Tag', () => {
  it('liefert alle sechs Zeiten in der richtigen Reihenfolge', () => {
    const day = computeRawDay(BERLIN, DEFAULT_PARAMS, { year: 2026, month: 3, day: 20 });
    const zeiten = EVENT_ORDER.map((k) => day.events[k].instant);
    expect(zeiten.every((t) => t !== null)).toBe(true);
    for (let i = 1; i < zeiten.length; i++) {
      expect(zeiten[i]!).toBeGreaterThan(zeiten[i - 1]!);
    }
  });

  it('setzt Dhur auf den Transit und beruecksichtigt die Sicherheitsminuten', () => {
    const ohne = computeRawDay(BERLIN, DEFAULT_PARAMS, { year: 2026, month: 3, day: 20 });
    expect(ohne.events.dhuhr.instant).toBe(ohne.transit.instant);

    const mit = computeRawDay(
      BERLIN,
      { ...DEFAULT_PARAMS, dhuhrOffsetMin: 5 },
      { year: 2026, month: 3, day: 20 },
    );
    expect(mit.events.dhuhr.instant! - mit.transit.instant).toBe(5 * MIN);
  });

  it('verschiebt Assr nach hinten, wenn der Schattenfaktor von 1 auf 2 geht', () => {
    const einfach = computeRawDay(BERLIN, DEFAULT_PARAMS, { year: 2026, month: 3, day: 20 });
    const doppelt = computeRawDay(
      BERLIN,
      { ...DEFAULT_PARAMS, asrFactor: 2 },
      { year: 2026, month: 3, day: 20 },
    );
    expect(doppelt.events.asr.instant!).toBeGreaterThan(einfach.events.asr.instant!);
    // Der Unterschied liegt in Berlin im Maerz bei rund einer Stunde.
    const diff = doppelt.events.asr.instant! - einfach.events.asr.instant!;
    expect(diff).toBeGreaterThan(30 * MIN);
    expect(diff).toBeLessThan(2 * HOUR);
  });

  it('meldet am 21. Juni in Berlin bei 18 Grad weder Fajr noch Isha', () => {
    const day = computeRawDay(
      BERLIN,
      { ...DEFAULT_PARAMS, fajrAngle: 18, ishaAngle: 18 },
      { year: 2026, month: 6, day: 21 },
    );
    expect(day.events.fajr.instant).toBeNull();
    expect(day.events.isha.instant).toBeNull();
    expect(day.events.fajr.existence!.marginDeg).toBeGreaterThan(3.8);
    // Sonnenaufgang, Dhur, Assr und Maghreb bleiben davon unberuehrt.
    expect(day.events.sunrise.instant).not.toBeNull();
    expect(day.events.maghrib.instant).not.toBeNull();
  });
});

describe('nightSpan', () => {
  it('mittelt auf der physikalischen Achse, nicht auf der Uhr', () => {
    // Nacht vom 28. auf den 29. Maerz 2026: In dieser Nacht wird in Deutschland
    // auf Sommerzeit umgestellt, 02:00 wird zu 03:00.
    const d28 = computeRawDay(BERLIN, DEFAULT_PARAMS, { year: 2026, month: 3, day: 28 });
    const d29 = computeRawDay(BERLIN, DEFAULT_PARAMS, { year: 2026, month: 3, day: 29 });
    const nacht = nightSpan(d28.events.maghrib.instant!, d29.events.fajr.instant!);

    expect(nacht.violations).toEqual([]);
    expect(nacht.midpoint - nacht.start).toBe(nacht.end - nacht.midpoint);
    expect(nacht.lastThirdStart - nacht.start).toBeCloseTo(
      2 * (nacht.end - nacht.lastThirdStart),
      6,
    );

    // Gegenprobe: Die naive Mittelung ueber Wanduhrzeiten liegt genau eine halbe
    // Stunde daneben, weil die uebersprungene Stunde mitgemittelt wird.
    const wandStart =
      d28.events.maghrib.instant! + tzOffsetMs(BERLIN.zone, d28.events.maghrib.instant!);
    const wandEnde = d29.events.fajr.instant! + tzOffsetMs(BERLIN.zone, d29.events.fajr.instant!);
    const wandMitte = (wandStart + wandEnde) / 2;
    const echteMitteAlsWandzeit = nacht.midpoint + tzOffsetMs(BERLIN.zone, nacht.midpoint);
    expect(Math.abs(wandMitte - echteMitteAlsWandzeit)).toBeCloseTo(30 * MIN, -4);
  });

  it('erkennt die vertauschte Reihenfolge als Verletzung', () => {
    const n = nightSpan(2000, 1000);
    expect(n.violations.length).toBeGreaterThan(0);
    expect(n.violations[0]).toMatch(/Folgetages/);
  });

  it('erkennt eine unplausible Nachtlaenge', () => {
    expect(nightSpan(0, 2 * HOUR).violations.length).toBeGreaterThan(0);
    expect(nightSpan(0, 22 * HOUR).violations.length).toBeGreaterThan(0);
    expect(nightSpan(0, 8 * HOUR).violations).toEqual([]);
  });
});

describe('Hochbreiten-Regeln', () => {
  const params = { ...DEFAULT_PARAMS, fajrAngle: 18, ishaAngle: 18 };
  const datum = { year: 2026, month: 6, day: 21 };

  it('laesst ohne Regel ehrlich stehen, dass nichts eintritt', () => {
    const { day, relativ } = tagMitNachbarn(BERLIN, params, datum);
    const r = applyHighLatitude(day, relativ, DEFAULT_HIGHLAT);
    expect(r.fajr.source).toBe('nicht_eingetreten');
    expect(r.isha.source).toBe('nicht_eingetreten');
    expect(r.fajr.existence!.marginDeg).toBeGreaterThan(3.8);
  });

  const regeln: HighLatRule[] = [
    'siebtel',
    'mitte',
    'winkelproportional',
    'aqrab_al_ayyam',
    'fester_versatz',
  ];

  it.each(regeln)('%s liefert einen als Ersatz gekennzeichneten Wert in sinnvoller Lage', (rule) => {
    const { day, relativ } = tagMitNachbarn(BERLIN, params, datum);
    const r = applyHighLatitude(day, relativ, { ...DEFAULT_HIGHLAT, rule });

    for (const ev of [r.fajr, r.isha]) {
      expect(ev.source).toBe('ersatzregel');
      expect(ev.appliedRule!.rule).toBe(rule);
      expect(ev.instant).not.toBeNull();
    }
    // Fajr vor Sonnenaufgang, Isha nach Maghreb. Sonst waere die Regel
    // sinnlos angewandt worden.
    expect(r.fajr.instant!).toBeLessThan(day.events.sunrise.instant!);
    expect(r.isha.instant!).toBeGreaterThan(day.events.maghrib.instant!);
  });

  it('benutzt fuer Fajr und Isha zwei verschiedene Naechte', () => {
    const { day, relativ } = tagMitNachbarn(BERLIN, params, datum);
    const r = applyHighLatitude(day, relativ, { ...DEFAULT_HIGHLAT, rule: 'siebtel' });

    const nVor = day.events.sunrise.instant! - relativ(-1).events.maghrib.instant!;
    const nNach = relativ(1).events.sunrise.instant! - day.events.maghrib.instant!;
    // Um die Sonnenwende sind die beiden Naechte fast, aber eben nicht ganz
    // gleich lang. Genau diese Differenz verschwaende, wenn jemand faelschlich
    // dieselbe Nacht fuer beide benutzt.
    expect(nVor).not.toBe(nNach);
    expect(r.fajr.appliedRule!.transferredOffsetMs).toBeCloseTo(nVor / 7, -2);
    expect(r.isha.appliedRule!.transferredOffsetMs).toBeCloseTo(nNach / 7, -2);
  });

  it('klemmt den winkelproportionalen Anteil bei unsinnigen Freiwerten', () => {
    // 25 Grad ergaeben bei Isha einen Anteil von 1,39. Isha laege dann nach
    // dem Sonnenaufgang des Folgetages.
    const { day, relativ } = tagMitNachbarn(BERLIN, { ...params, ishaAngle: 25 }, datum);
    const r = applyHighLatitude(day, relativ, {
      ...DEFAULT_HIGHLAT,
      rule: 'winkelproportional',
    });
    expect(r.isha.appliedRule!.clampedFraction).toBeCloseTo(25 / 18, 6);
    expect(r.isha.instant!).toBeLessThan(relativ(1).events.sunrise.instant!);
  });

  it('Aqrab al-Ayyam sucht in beide Richtungen', () => {
    // Kurz vor der Sonnenwende muss rueckwaerts gesucht werden, kurz danach
    // vorwaerts. Eine einseitige Suche faellt hier durch.
    const vorher = tagMitNachbarn(BERLIN, params, { year: 2026, month: 5, day: 25 });
    const nachher = tagMitNachbarn(BERLIN, params, { year: 2026, month: 7, day: 18 });

    const rv = applyHighLatitude(vorher.day, vorher.relativ, {
      ...DEFAULT_HIGHLAT,
      rule: 'aqrab_al_ayyam',
    });
    const rn = applyHighLatitude(nachher.day, nachher.relativ, {
      ...DEFAULT_HIGHLAT,
      rule: 'aqrab_al_ayyam',
    });

    expect(rv.isha.appliedRule!.referenceDayOffset).toBeLessThan(0);
    expect(rn.isha.appliedRule!.referenceDayOffset).toBeGreaterThan(0);
  });

  it('uebertraegt eine Zeitdifferenz, keine Uhrzeit', () => {
    const { day, relativ } = tagMitNachbarn(BERLIN, params, datum);
    const r = applyHighLatitude(day, relativ, {
      ...DEFAULT_HIGHLAT,
      rule: 'aqrab_al_ayyam',
    });
    const offset = r.isha.appliedRule!.referenceDayOffset!;
    const fundtag = relativ(offset);
    const differenz = fundtag.events.isha.instant! - fundtag.events.maghrib.instant!;

    expect(r.isha.appliedRule!.transferredOffsetMs).toBeCloseTo(differenz, -2);
    // Und das Ergebnis haengt am Maghreb DIESES Tages, nicht an der Uhrzeit des Fundtages.
    expect(r.isha.instant! - day.events.maghrib.instant!).toBeCloseTo(differenz, -2);
  });

  it('bricht in Tromsoe sauber ab, statt endlos zu suchen', () => {
    // Dort geht die Sonne um die Sonnenwende gar nicht unter. Damit fehlt den
    // Regeln die astronomische Nacht, auf die sie sich stuetzen.
    const { day, relativ } = tagMitNachbarn(TROMSOE, params, datum);
    const r = applyHighLatitude(day, relativ, {
      ...DEFAULT_HIGHLAT,
      rule: 'aqrab_al_ayyam',
      maxSearchDays: 30,
    });
    expect(r.isha.instant).toBeNull();
    expect(r.isha.source).toBe('nicht_eingetreten');
    expect(r.isha.warnings.join(' ')).toMatch(/Sonnenauf/);
  });
});

describe('Jahresverlauf', () => {
  it('bleibt in Frankfurt ueber 365 Tage stetig, auch dort wo die Regel einsetzt', () => {
    const params = { ...DEFAULT_PARAMS, fajrAngle: 18, ishaAngle: 18 };
    const get = makeProvider(FRANKFURT, params);
    const config = { ...DEFAULT_HIGHLAT, rule: 'aqrab_al_ayyam' as const, maxSearchDays: 120 };

    let datum: CalendarDate = { year: 2026, month: 1, day: 1 };
    const ishaZeiten: Array<{ t: number; ersatz: boolean; month: number }> = [];

    for (let i = 0; i < 365; i++) {
      const heute = datum;
      const day = get(heute);
      const r = applyHighLatitude(day, (o) => get(shiftDate(heute, o)), config);
      expect(r.isha.instant).not.toBeNull();
      ishaZeiten.push({
        t: r.isha.instant!,
        ersatz: r.isha.source === 'ersatzregel',
        month: heute.month,
      });
      datum = shiftDate(datum, 1);
    }

    // Es muss sowohl gerechnete als auch ersetzte Tage geben, sonst prueft der
    // Test die Regel gar nicht.
    expect(ishaZeiten.some((e) => e.ersatz)).toBe(true);
    expect(ishaZeiten.some((e) => !e.ersatz)).toBe(true);

    // Stetigkeit, in zwei Stufen. Gerechnet wird auf der physikalischen Achse
    // abzueglich 24 Stunden, damit die Zeitumstellung nicht als Sprung erscheint.
    //
    // Warum nicht ueberall dieselbe Schranke: Am Rand des unerreichbaren
    // Zeitraums verhaelt sich der Durchgangszeitpunkt wie die WURZEL aus der
    // Fehlmarge. Am letzten rechenbaren Tag faellt Isha fast auf
    // Sonnenmitternacht, einen Tag spaeter liegt es schon rund zwanzig Minuten
    // davor. Gemessen wurden 17 Minuten, und zwar zwischen zwei GERECHNETEN
    // Tagen, nicht am Umschaltpunkt zur Ersatzregel. Das ist Geometrie, kein
    // Fehler, und es ist der Grund, warum winkelbasierte Isha-Zeiten im
    // Fruehsommer unruhig wirken.
    //
    // In Frankfurt bei 18 Grad ist der Winkel unerreichbar, sobald die
    // Deklination 21,89 Grad ueberschreitet, also etwa vom 12. Mai bis zum
    // 1. August. Von Mai bis August gilt deshalb die weite Schranke, sonst die
    // enge.
    //
    // Die eigentlichen Fehler, die dieser Test fangen soll, liegen bei einer
    // vollen Stunde: eine falsch behandelte Zeitumstellung, oder eine
    // Aqrab-Suche, die die Uhrzeit statt der Zeitdifferenz uebertraegt.
    const sommer = (m: number) => m >= 5 && m <= 8;
    let maxSprung = 0;
    for (let i = 1; i < ishaZeiten.length; i++) {
      const heute = ishaZeiten[i]!;
      const gestern = ishaZeiten[i - 1]!;
      const diff = Math.abs(heute.t - gestern.t - 24 * HOUR);
      maxSprung = Math.max(maxSprung, diff);

      if (!sommer(heute.month) && !sommer(gestern.month)) {
        expect(diff).toBeLessThan(10 * MIN);
      }
      expect(diff).toBeLessThan(30 * MIN);
    }
    // Und der groesste Sprung im ganzen Jahr bleibt weit unter der Stundenmarke.
    expect(maxSprung).toBeLessThan(30 * MIN);
  });

  it('haelt die Reihenfolge an jedem Tag des Jahres ein', () => {
    const get = makeProvider(BERLIN, DEFAULT_PARAMS);
    let datum: CalendarDate = { year: 2026, month: 1, day: 1 };
    for (let i = 0; i < 365; i++) {
      const day = get(datum);
      const zeiten = EVENT_ORDER.map((k) => day.events[k].instant).filter(
        (t): t is number => t !== null,
      );
      for (let j = 1; j < zeiten.length; j++) {
        expect(zeiten[j]!).toBeGreaterThan(zeiten[j - 1]!);
      }
      datum = shiftDate(datum, 1);
    }
  });

  it('bleibt beim Jahreswechsel und im Schaltjahr korrekt', () => {
    expect(shiftDate({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    expect(shiftDate({ year: 2028, month: 2, day: 28 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(shiftDate({ year: 2100, month: 2, day: 28 }, 1)).toEqual({
      year: 2100,
      month: 3,
      day: 1,
    });

    const silvester = computeRawDay(BERLIN, DEFAULT_PARAMS, { year: 2026, month: 12, day: 31 });
    const neujahr = computeRawDay(BERLIN, DEFAULT_PARAMS, { year: 2027, month: 1, day: 1 });
    const nacht = nightSpan(silvester.events.maghrib.instant!, neujahr.events.fajr.instant!);
    expect(nacht.violations).toEqual([]);
    expect(instantToLocalParts(BERLIN.zone, nacht.midpoint).day).toBeGreaterThan(0);
  });
});
