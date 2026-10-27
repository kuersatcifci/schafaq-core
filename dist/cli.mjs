#!/usr/bin/env node

// src/timezone.ts
var formatterCache = /* @__PURE__ */ new Map();
function getFormatter(zone2) {
  let f = formatterCache.get(zone2);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: zone2,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch {
      throw new Error(`Unbekannte Zeitzone: ${zone2}`);
    }
    formatterCache.set(zone2, f);
  }
  return f;
}
function isValidZone(zone2) {
  try {
    getFormatter(zone2);
    return true;
  } catch {
    return false;
  }
}
function instantToLocalParts(zone2, instantMs) {
  const parts = getFormatter(zone2).formatToParts(new Date(instantMs));
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // hourCycle h23 liefert 00 bis 23. Manche Umgebungen liefern trotzdem 24 fuer
    // Mitternacht, deshalb die Modulo-Absicherung.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second)
  };
}
function tzOffsetMs(zone2, instantMs) {
  const p = instantToLocalParts(zone2, instantMs);
  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUTC - Math.floor(instantMs / 1e3) * 1e3;
}
function localNoonAnchor(zone2, year2, month2, day2) {
  const guess = Date.UTC(year2, month2 - 1, day2, 12, 0, 0);
  const off1 = tzOffsetMs(zone2, guess);
  let instant = guess - off1;
  const off2 = tzOffsetMs(zone2, instant);
  if (off2 !== off1) instant = guess - off2;
  return instant;
}

// src/julian.ts
var JD_J2000 = 2451545;
var MS_PER_DAY = 864e5;
var JD_UNIX_EPOCH = 24405875e-1;
function instantToJD(instantMs) {
  return instantMs / MS_PER_DAY + JD_UNIX_EPOCH;
}
function julianCentury(jdTT) {
  return (jdTT - JD_J2000) / 36525;
}
function deltaTSeconds(jd) {
  const year2 = jdToDecimalYear(jd);
  if (year2 >= 2005 && year2 < 2050) {
    const t = year2 - 2e3;
    return 62.92 + 0.32217 * t + 5589e-6 * t * t;
  }
  if (year2 >= 2050 && year2 <= 2150) {
    const u2 = (year2 - 1820) / 100;
    return -20 + 32 * u2 * u2 - 0.5628 * (2150 - year2);
  }
  if (year2 >= 1986 && year2 < 2005) {
    const t = year2 - 2e3;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 17275e-7 * t ** 3 + 651814e-9 * t ** 4 + 2373599e-11 * t ** 5;
  }
  const u = (year2 - 1820) / 100;
  return -20 + 32 * u * u;
}
function jdToDecimalYear(jd) {
  return 2e3 + (jd - JD_J2000) / 365.25;
}
function jdUTtoTT(jdUT) {
  return jdUT + deltaTSeconds(jdUT) / 86400;
}
function instantToJDTT(instantMs) {
  return jdUTtoTT(instantToJD(instantMs));
}

// src/angles.ts
var DEG2RAD = Math.PI / 180;
var RAD2DEG = 180 / Math.PI;
var sinD = (deg) => Math.sin(deg * DEG2RAD);
var cosD = (deg) => Math.cos(deg * DEG2RAD);
var tanD = (deg) => Math.tan(deg * DEG2RAD);
var asinD = (x) => Math.asin(x) * RAD2DEG;
var acosD = (x) => Math.acos(x) * RAD2DEG;
var atanD = (x) => Math.atan(x) * RAD2DEG;
var atan2D = (y, x) => Math.atan2(y, x) * RAD2DEG;
function norm360(deg) {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}
function norm180(deg) {
  const r = norm360(deg);
  return r > 180 ? r - 360 : r;
}
function acotD(x) {
  const a = atanD(1 / x);
  return a < 0 ? a + 180 : a;
}

// src/solar.ts
function sunPosition(jdTT) {
  const T = julianCentury(jdTT);
  const L0 = norm360(280.46646 + 36000.76983 * T + 3032e-7 * T * T);
  const M = norm360(357.52911 + 35999.05029 * T - 1537e-7 * T * T);
  const e = 0.016708634 - 42037e-9 * T - 1267e-10 * T * T;
  const C = (1.914602 - 4817e-6 * T - 14e-6 * T * T) * sinD(M) + (0.019993 - 101e-6 * T) * sinD(2 * M) + 289e-6 * sinD(3 * M);
  const trueLongitude = L0 + C;
  const trueAnomaly = M + C;
  const radiusVector = 1.000001018 * (1 - e * e) / (1 + e * cosD(trueAnomaly));
  const omega = 125.04 - 1934.136 * T;
  const apparentLongitude = trueLongitude - 569e-5 - 478e-5 * sinD(omega);
  const meanObliquity = 23 + 26 / 60 + 21.448 / 3600 - (46.815 * T + 59e-5 * T * T - 1813e-6 * T * T * T) / 3600;
  const obliquity = meanObliquity + 256e-5 * cosD(omega);
  const declination = asinD(sinD(obliquity) * sinD(apparentLongitude));
  const rightAscension = norm360(
    atan2D(cosD(obliquity) * sinD(apparentLongitude), cosD(apparentLongitude))
  );
  return {
    T,
    meanLongitude: L0,
    meanAnomaly: M,
    eccentricity: e,
    equationOfCenter: C,
    trueLongitude: norm360(trueLongitude),
    apparentLongitude: norm360(apparentLongitude),
    omega: norm360(omega),
    meanObliquity,
    obliquity,
    declination,
    rightAscension,
    equationOfTimeMin: equationOfTimeMeeus283(L0, M, e, obliquity),
    radiusVector,
    // Scheinbarer Halbmesser: 0,266563 Grad im Abstand 1 AE.
    semidiameter: 0.266563 / radiusVector
  };
}
function equationOfTimeMeeus283(L0, M, e, obliquity) {
  const y = tanD(obliquity / 2) ** 2;
  const eRad = y * Math.sin(2 * L0 * DEG2RAD) - 2 * e * Math.sin(M * DEG2RAD) + 4 * e * y * Math.sin(M * DEG2RAD) * Math.cos(2 * L0 * DEG2RAD) - 0.5 * y * y * Math.sin(4 * L0 * DEG2RAD) - 1.25 * e * e * Math.sin(2 * M * DEG2RAD);
  return eRad * RAD2DEG * 4;
}

// src/hourangle.ts
function hourAngleFor(targetAltitude, latitude, declination) {
  const denom = cosD(latitude) * cosD(declination);
  if (Math.abs(denom) < 1e-12) {
    return { cosH: NaN, H: null, status: "entartet" };
  }
  const cosH = (sinD(targetAltitude) - sinD(latitude) * sinD(declination)) / denom;
  if (cosH > 1) return { cosH, H: null, status: "ziel_ueber_maximum" };
  if (cosH < -1) return { cosH, H: null, status: "ziel_unter_minimum" };
  return { cosH, H: acosD(cosH), status: "ok" };
}

// src/geometry.ts
function culmination(latitude, declination) {
  return {
    hMax: 90 - Math.abs(latitude - declination),
    hMin: Math.abs(latitude + declination) - 90
  };
}
function checkExistence(latitude, declination, targetAltitude) {
  const { hMax, hMin } = culmination(latitude, declination);
  if (targetAltitude > hMax) {
    return {
      hMax,
      hMin,
      exists: false,
      marginDeg: targetAltitude - hMax,
      reason: "sonne_bleibt_tiefer"
    };
  }
  if (targetAltitude < hMin) {
    return {
      hMax,
      hMin,
      exists: false,
      marginDeg: hMin - targetAltitude,
      reason: "sonne_bleibt_hoeher"
    };
  }
  return { hMax, hMin, exists: true, marginDeg: 0, reason: null };
}

// src/solve.ts
var HOUR_MS = 36e5;
var DAY_MS = 864e5;
var TOLERANCE_DEG = 5e-3;
function localHourAngle(instantMs, longitude) {
  return hourAngleFromPosition(instantMs, longitude, sunPosition(instantToJDTT(instantMs)));
}
function hourAngleFromPosition(instantMs, longitude, pos) {
  const utHours = (instantMs % DAY_MS + DAY_MS) % DAY_MS / HOUR_MS;
  return norm180(15 * utHours + pos.equationOfTimeMin / 4 + longitude - 180);
}
function solarAltitudeAt(instantMs, latitude, longitude) {
  const pos = sunPosition(instantToJDTT(instantMs));
  const H = hourAngleFromPosition(instantMs, longitude, pos);
  return asinD(
    sinD(latitude) * sinD(pos.declination) + cosD(latitude) * cosD(pos.declination) * cosD(H)
  );
}
function solveEvent(opts) {
  const { transitInstant, latitude, longitude, targetAltitude, direction } = opts;
  const sign = direction === "morgens" ? -1 : 1;
  const posAtTransit = sunPosition(instantToJDTT(transitInstant));
  const existence = checkExistence(latitude, posAtTransit.declination, targetAltitude);
  if (!existence.exists) return { found: false, existence };
  const trace = [];
  let estimate = null;
  let t = transitInstant;
  for (let i = 0; i < 3; i++) {
    const pos2 = sunPosition(instantToJDTT(t));
    const ha2 = hourAngleFor(targetAltitude, latitude, pos2.declination);
    trace.push({ instant: t, declination: pos2.declination, hourAngle: ha2.H });
    if (ha2.status !== "ok" || ha2.H === null) break;
    t = transitInstant + sign * (ha2.H / 15) * HOUR_MS;
    estimate = t;
  }
  let lo = direction === "morgens" ? transitInstant - 12 * HOUR_MS : transitInstant;
  let hi = direction === "morgens" ? transitInstant : transitInstant + 12 * HOUR_MS;
  const f = (x) => solarAltitudeAt(x, latitude, longitude) - targetAltitude;
  let fLo = f(lo);
  const fHi = f(hi);
  if (Math.sign(fLo) === Math.sign(fHi)) {
    return { found: false, existence: { ...existence, exists: false } };
  }
  let steps = 0;
  while (hi - lo > 1 && steps < 40) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
    steps++;
  }
  const instant = (lo + hi) / 2;
  const pos = sunPosition(instantToJDTT(instant));
  const ha = hourAngleFor(targetAltitude, latitude, pos.declination);
  const residualDeg = f(instant);
  if (Math.abs(residualDeg) > TOLERANCE_DEG) {
    throw new Error(
      `Bisektion konvergierte nicht: Restfehler ${residualDeg.toFixed(6)} Grad nach ${steps} Schritten.`
    );
  }
  return {
    found: true,
    instant: Math.round(instant),
    method: "bisektion",
    steps,
    residualDeg,
    estimateFromHourAngle: estimate === null ? null : Math.round(estimate),
    estimateDeviationMs: estimate === null ? null : Math.round(estimate - instant),
    declinationUsed: pos.declination,
    equationOfTimeUsed: pos.equationOfTimeMin,
    cosH: ha.cosH,
    hourAngle: sign * (ha.H ?? 0),
    trace
  };
}

// src/transit.ts
var HOUR_MS2 = 36e5;
function solarTransit(zone2, year2, month2, day2, longitude) {
  const anchor = localNoonAnchor(zone2, year2, month2, day2);
  let t = anchor;
  for (let i = 0; i < 3; i++) {
    const H = localHourAngle(t, longitude);
    t = t - H / 15 * HOUR_MS2;
  }
  const pos = sunPosition(instantToJDTT(t));
  return {
    instant: Math.round(t),
    anchor,
    offsetFromLocalNoonMin: (t - anchor) / 6e4,
    equationOfTimeMin: pos.equationOfTimeMin,
    declination: pos.declination,
    residualHourAngleDeg: localHourAngle(t, longitude)
  };
}

// src/altitude.ts
var HORIZON_BASE = -0.833;
function horizonAltitude(elevationMeters = 0) {
  const elev = Math.max(0, elevationMeters);
  const dip = elev > 0 ? -0.0347 * Math.sqrt(elev) : 0;
  return {
    altitude: HORIZON_BASE + dip,
    breakdown: { base: 0, refractionAndSemidiameter: HORIZON_BASE, dip }
  };
}
function twilightAltitude(angleDeg) {
  return {
    altitude: -Math.abs(angleDeg),
    breakdown: { base: -Math.abs(angleDeg), refractionAndSemidiameter: 0, dip: 0 }
  };
}
function asrAltitude(latitude, declinationAtTransit, shadowFactor) {
  const z = Math.abs(latitude - declinationAtTransit);
  if (z >= 90) {
    throw new Error(
      `Assr ist nicht definiert: die Sonne kulminiert an diesem Tag unter dem Horizont, es gibt also keinen Mittagsschatten (Zenitdistanz ${z.toFixed(2)}\xB0).`
    );
  }
  if (!(shadowFactor > 0)) {
    throw new Error(`Der Schattenfaktor muss gr\xF6\xDFer als null sein, angegeben war ${shadowFactor}.`);
  }
  const altitude = acotD(shadowFactor + tanD(z));
  return {
    altitude,
    transitZenithDistance: z,
    // Unter einem Grad liegt Assr so dicht an Maghreb, dass die Anzeige das
    // erklaeren muss, statt zwei Zeiten im Abstand von Sekunden zu zeigen.
    degenerate: altitude < 1,
    breakdown: { base: altitude, refractionAndSemidiameter: 0, dip: 0 }
  };
}

// src/rawDay.ts
var DEFAULT_PARAMS = {
  fajrAngle: 12,
  ishaAngle: 12,
  asrFactor: 1,
  dhuhrOffsetMin: 0,
  elevationMeters: 0
};
function computeRawDay(location, params, date) {
  const { latitude, longitude, zone: zone2 } = location;
  const transit = solarTransit(zone2, date.year, date.month, date.day, longitude);
  const horizon = horizonAltitude(params.elevationMeters);
  const fajrTarget = twilightAltitude(params.fajrAngle);
  const ishaTarget = twilightAltitude(params.ishaAngle);
  let asrTarget = null;
  let asrProblem = null;
  try {
    asrTarget = asrAltitude(latitude, transit.declination, params.asrFactor);
  } catch (err) {
    asrProblem = err instanceof Error ? err.message : String(err);
  }
  const solve = (key, target, direction) => {
    const r = solveEvent({
      transitInstant: transit.instant,
      latitude,
      longitude,
      targetAltitude: target.altitude,
      direction
    });
    return r.found ? { key, instant: r.instant, target, solve: r, existence: null } : { key, instant: null, target, solve: null, existence: r.existence };
  };
  const events = {
    fajr: solve("fajr", fajrTarget, "morgens"),
    sunrise: solve("sunrise", horizon, "morgens"),
    dhuhr: {
      key: "dhuhr",
      // Dhur ist der Transit selbst, plus optionale Sicherheitsminuten.
      // Ein Ereignis, das keine Zielhoehe hat und deshalb nie ausfaellt.
      instant: transit.instant + params.dhuhrOffsetMin * 6e4,
      target: null,
      solve: null,
      existence: null
    },
    asr: asrTarget ? solve("asr", asrTarget, "abends") : { key: "asr", instant: null, target: null, solve: null, existence: null },
    maghrib: solve("maghrib", horizon, "abends"),
    isha: solve("isha", ishaTarget, "abends")
  };
  return { date, location, params, transit, events, asrTarget, asrProblem };
}
function shiftDate(date, days) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// src/highLatitude.ts
var DEFAULT_HIGHLAT = {
  rule: "keine",
  fixedOffsetMin: 75,
  maxSearchDays: 200
};
var MIN_MS = 6e4;
function applyHighLatitude(day2, getDay, config = DEFAULT_HIGHLAT) {
  return {
    fajr: resolve(day2, getDay, config, "fajr"),
    isha: resolve(day2, getDay, config, "isha")
  };
}
function resolve(day2, getDay, config, key) {
  const ev = day2.events[key];
  if (ev.instant !== null) {
    return {
      instant: ev.instant,
      source: "berechnet",
      appliedRule: null,
      existence: null,
      warnings: []
    };
  }
  const nichtEingetreten = (warnings = []) => ({
    instant: null,
    source: "nicht_eingetreten",
    appliedRule: null,
    existence: ev.existence,
    warnings
  });
  if (config.rule === "keine") return nichtEingetreten();
  const nacht = key === "fajr" ? nightBefore(day2, getDay) : nightAfter(day2, getDay);
  if (nacht === null) {
    return nichtEingetreten([
      "Die Ersatzregel greift nicht, weil an diesem Ort auch Sonnenauf- oder Sonnenuntergang nicht eintreten."
    ]);
  }
  const anker = key === "fajr" ? nacht.sunrise : nacht.sunset;
  const richtung = key === "fajr" ? -1 : 1;
  const bauen = (offsetMs, appliedRule) => ({
    instant: Math.round(anker + richtung * offsetMs),
    source: "ersatzregel",
    appliedRule,
    existence: ev.existence,
    warnings: []
  });
  switch (config.rule) {
    case "siebtel":
      return bauen(nacht.lengthMs / 7, {
        rule: "siebtel",
        transferredOffsetMs: nacht.lengthMs / 7
      });
    case "mitte":
      return bauen(nacht.lengthMs / 2, {
        rule: "mitte",
        transferredOffsetMs: nacht.lengthMs / 2
      });
    case "winkelproportional": {
      const winkel = key === "fajr" ? day2.params.fajrAngle : day2.params.ishaAngle;
      const nenner = key === "fajr" ? 60 : 18;
      const roh = winkel / nenner;
      const anteil = Math.min(0.5, Math.max(0, roh));
      const applied = {
        rule: "winkelproportional",
        transferredOffsetMs: anteil * nacht.lengthMs
      };
      if (roh !== anteil) applied.clampedFraction = roh;
      return bauen(anteil * nacht.lengthMs, applied);
    }
    case "fester_versatz":
      return bauen(config.fixedOffsetMin * MIN_MS, {
        rule: "fester_versatz",
        transferredOffsetMs: config.fixedOffsetMin * MIN_MS
      });
    case "aqrab_al_ayyam":
      return aqrabAlAyyam(day2, getDay, config, key, anker, richtung, ev.existence);
  }
}
function aqrabAlAyyam(day2, getDay, config, key, anker, richtung, existence) {
  for (let k = 1; k <= config.maxSearchDays; k++) {
    for (const dir of [-1, 1]) {
      const kandidat = getDay(dir * k);
      const ereignis = kandidat.events[key].instant;
      const bezug = key === "fajr" ? kandidat.events.sunrise.instant : kandidat.events.maghrib.instant;
      if (ereignis === null || bezug === null) continue;
      const differenz = Math.abs(bezug - ereignis);
      return {
        instant: Math.round(anker + richtung * differenz),
        source: "ersatzregel",
        appliedRule: {
          rule: "aqrab_al_ayyam",
          referenceDayOffset: dir * k,
          transferredOffsetMs: differenz
        },
        existence,
        warnings: []
      };
    }
  }
  const sekundaer = resolve(day2, getDay, { ...config, rule: "siebtel" }, key);
  if (sekundaer.appliedRule) sekundaer.appliedRule.fallbackFrom = "aqrab_al_ayyam";
  sekundaer.warnings.push(
    `Der Winkel wird an diesem Ort auch im Umkreis von ${config.maxSearchDays} Tagen nicht erreicht. Ersatzweise wurde das Siebtel der Nacht verwendet.`
  );
  return sekundaer;
}
function nightBefore(day2, getDay) {
  const sunset = getDay(-1).events.maghrib.instant;
  const sunrise = day2.events.sunrise.instant;
  if (sunset === null || sunrise === null || sunrise <= sunset) return null;
  return { sunset, sunrise, lengthMs: sunrise - sunset };
}
function nightAfter(day2, getDay) {
  const sunset = day2.events.maghrib.instant;
  const sunrise = getDay(1).events.sunrise.instant;
  if (sunset === null || sunrise === null || sunrise <= sunset) return null;
  return { sunset, sunrise, lengthMs: sunrise - sunset };
}

// src/night.ts
var HOUR_MS3 = 36e5;
function nightSpan(start2, end) {
  const violations = [];
  const lengthMs = end - start2;
  if (lengthMs <= 0) {
    violations.push(
      "Die Nacht ist nicht positiv. Vermutlich wurde Fajr desselben Tages statt des Folgetages verwendet."
    );
  } else if (lengthMs < 4 * HOUR_MS3 || lengthMs > 20 * HOUR_MS3) {
    violations.push(
      `Die Nachtl\xE4nge von ${(lengthMs / HOUR_MS3).toFixed(1)} Stunden liegt au\xDFerhalb des weltweit plausiblen Bereichs von 4 bis 20 Stunden.`
    );
  }
  return {
    start: start2,
    end,
    lengthMs,
    midpoint: start2 + lengthMs / 2,
    // Das letzte Drittel beginnt nach zwei Dritteln der Nacht.
    lastThirdStart: start2 + lengthMs * 2 / 3,
    violations
  };
}

// src/schedule.ts
var MIN_MS2 = 6e4;
var DEFAULT_SETTINGS = {
  location: { latitude: 50.11, longitude: 8.682, zone: "Europe/Berlin" },
  params: DEFAULT_PARAMS,
  highLat: DEFAULT_HIGHLAT,
  rounding: "ceil",
  nightDefinition: "maghrib_bis_fadschr"
};
var HAUPTZEITEN = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
function roundToMinute(instant, mode) {
  const m = instant / MIN_MS2;
  const r = mode === "ceil" ? Math.ceil(m) : mode === "floor" ? Math.floor(m) : Math.round(m);
  return r * MIN_MS2;
}
function computeSchedule(settings2, date) {
  const { location, params, highLat, rounding, nightDefinition } = settings2;
  const cache = /* @__PURE__ */ new Map();
  const dayAt = (d) => {
    const key = `${d.year}-${d.month}-${d.day}`;
    let cached = cache.get(key);
    if (!cached) {
      cached = computeRawDay(location, params, d);
      cache.set(key, cached);
    }
    return cached;
  };
  const heute2 = dayAt(date);
  const morgen = dayAt(shiftDate(date, 1));
  const geregelt = applyHighLatitude(heute2, (o) => dayAt(shiftDate(date, o)), highLat);
  const geregeltMorgen = applyHighLatitude(morgen, (o) => dayAt(shiftDate(date, o + 1)), highLat);
  const warnings = [];
  const bauen = (key, exact, source, appliedRule, existence, eventWarnings = []) => {
    const mode = key === "sunrise" ? "floor" : rounding;
    const gerundet = exact === null ? null : roundToMinute(exact, mode);
    return {
      key,
      instant: gerundet,
      exactInstant: exact,
      source,
      dayShift: gerundet === null ? 0 : dayShiftOf(location.zone, date, gerundet),
      appliedRule,
      existence,
      warnings: eventWarnings
    };
  };
  const einfach = (key) => bauen(
    key,
    heute2.events[key].instant,
    heute2.events[key].instant === null ? "nicht_eingetreten" : "berechnet",
    null,
    heute2.events[key].existence,
    key === "asr" && heute2.asrProblem ? [heute2.asrProblem] : []
  );
  const times = [
    bauen(
      "fajr",
      geregelt.fajr.instant,
      geregelt.fajr.source,
      geregelt.fajr.appliedRule,
      geregelt.fajr.existence,
      geregelt.fajr.warnings
    ),
    einfach("sunrise"),
    einfach("dhuhr"),
    einfach("asr"),
    einfach("maghrib"),
    bauen(
      "isha",
      geregelt.isha.instant,
      geregelt.isha.source,
      geregelt.isha.appliedRule,
      geregelt.isha.existence,
      geregelt.isha.warnings
    )
  ];
  warnings.push(...geregelt.fajr.warnings, ...geregelt.isha.warnings);
  if (heute2.asrProblem) warnings.push(heute2.asrProblem);
  const nachtStart = heute2.events.maghrib.instant;
  const nachtEnde = nightDefinition === "maghrib_bis_fadschr" ? geregeltMorgen.fajr.instant : morgen.events.sunrise.instant;
  let nacht = null;
  if (nachtStart !== null && nachtEnde !== null) {
    nacht = nightSpan(nachtStart, nachtEnde);
    warnings.push(...nacht.violations);
  }
  const nachtAufErsatz = nightDefinition === "maghrib_bis_fadschr" && geregeltMorgen.fajr.source === "ersatzregel";
  if (nachtAufErsatz) {
    warnings.push(
      "Nachtmitte und letztes Drittel beruhen auf einem ersatzweise berechneten Fajr des Folgetages."
    );
  }
  const abgeleitet = (key, exact) => bauen(
    key,
    exact,
    exact === null ? "nicht_eingetreten" : nachtAufErsatz ? "ersatzregel" : "berechnet",
    null,
    null,
    nachtAufErsatz ? ["Beruht auf einem ersatzweise berechneten Fajr des Folgetages."] : []
  );
  times.push(abgeleitet("nachtmitte", nacht?.midpoint ?? null));
  times.push(abgeleitet("letztes_drittel", nacht?.lastThirdStart ?? null));
  const phi = location.latitude;
  const delta = heute2.transit.declination;
  const protocol = {
    version: "core-1.0.0",
    inputs: {
      latitude: phi,
      longitude: location.longitude,
      zone: location.zone,
      date,
      elevationMeters: params.elevationMeters,
      elevationApplied: params.elevationMeters > 0
    },
    method: {
      fajrAngle: params.fajrAngle,
      ishaAngle: params.ishaAngle,
      asrFactor: params.asrFactor,
      dhuhrOffsetMin: params.dhuhrOffsetMin,
      highLatRule: highLat.rule,
      rounding,
      nightDefinition
    },
    assumptions: [
      "Sonnenposition nach Meeus, Kapitel 25 (Low Precision), inklusive Aberration und Nutation.",
      "Delta T nach Espenak und Meeus. Einfluss auf die Gebetszeiten unter einer Sekunde.",
      "Horizontstand \u22120,833\xB0: mittlere Refraktion (34 Bogenminuten) plus halber Sonnendurchmesser (16 Bogenminuten).",
      "Refraktion, Halbmesser und Kimmtiefe gelten nur f\xFCr Sonnenauf- und -untergang, nicht f\xFCr die D\xE4mmerungswinkel.",
      "Die Solarparallaxe wird vernachl\xE4ssigt, das sind etwa ein bis zwei Sekunden.",
      "Wetterbedingte Refraktionsschwankungen verschieben den sichtbaren Sonnenauf- und -untergang um bis zu zwei Minuten. Das ist die gr\xF6\xDFte verbleibende Unsicherheit, gr\xF6\xDFer als der Modellfehler."
    ],
    solar: {
      transitInstant: heute2.transit.instant,
      offsetFromLocalNoonMin: heute2.transit.offsetFromLocalNoonMin,
      declination: delta,
      equationOfTimeMin: heute2.transit.equationOfTimeMin,
      residualHourAngleDeg: heute2.transit.residualHourAngleDeg
    },
    // Geschlossen aus Breite und Deklination. hMin ist der Wert, den die App
    // zeigt, wenn ein Daemmerungswinkel nicht erreicht wird.
    culmination: {
      hMax: 90 - Math.abs(phi - delta),
      hMin: Math.abs(phi + delta) - 90
    },
    asr: heute2.asrTarget ? {
      transitZenithDistance: heute2.asrTarget.transitZenithDistance,
      shadowAtNoon: tanD(heute2.asrTarget.transitZenithDistance),
      targetAltitude: heute2.asrTarget.altitude,
      degenerate: heute2.asrTarget.degenerate
    } : null,
    events: times.filter(
      (t) => HAUPTZEITEN.includes(t.key)
    ).map((t) => eventProtocol(t, heute2)),
    night: {
      definition: nightDefinition,
      startKey: "maghrib",
      endKey: nightDefinition === "maghrib_bis_fadschr" ? "Fajr des Folgetages" : "Sonnenaufgang des Folgetages",
      lengthMs: nacht?.lengthMs ?? null,
      basedOnSubstitute: nachtAufErsatz,
      violations: nacht?.violations ?? []
    },
    warnings
  };
  return { date, times, protocol };
}
function eventProtocol(t, day2) {
  const raw = day2.events[t.key];
  const s = raw.solve;
  const istDhuhr = t.key === "dhuhr";
  return {
    key: t.key,
    targetAltitude: raw.target?.altitude ?? null,
    targetBreakdown: raw.target?.breakdown ?? null,
    declinationUsed: s?.declinationUsed ?? (istDhuhr ? day2.transit.declination : null),
    equationOfTimeUsed: s?.equationOfTimeUsed ?? (istDhuhr ? day2.transit.equationOfTimeMin : null),
    cosH: s?.cosH ?? null,
    hourAngle: s?.hourAngle ?? (istDhuhr ? 0 : null),
    method: s?.method ?? (istDhuhr ? "transit" : null),
    bisectionSteps: s?.steps ?? null,
    residualDeg: s?.residualDeg ?? null,
    estimateDeviationMs: s?.estimateDeviationMs ?? null,
    exactInstant: t.exactInstant,
    roundedInstant: t.instant,
    roundingDeltaMs: t.instant !== null && t.exactInstant !== null ? t.instant - t.exactInstant : null,
    appliedRule: t.appliedRule,
    existence: t.existence
  };
}
function dayShiftOf(zone2, date, instant) {
  const p = instantToLocalParts(zone2, instant);
  const a = Date.UTC(p.year, p.month - 1, p.day);
  const b = Date.UTC(date.year, date.month - 1, date.day);
  return Math.round((a - b) / 864e5);
}

// src/params.ts
var HIGHLAT_RULES = [
  "keine",
  "siebtel",
  "mitte",
  "winkelproportional",
  "aqrab_al_ayyam",
  "fester_versatz"
];
var ROUNDINGS = ["ceil", "floor", "nearest"];
var NIGHT_DEFS = ["maghrib_bis_fadschr", "untergang_bis_aufgang"];
function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function validateSettings(input) {
  const errors = [];
  const raw = input ?? {};
  const loc = raw.location ?? {};
  const par = raw.params ?? {};
  const hl = raw.highLat ?? {};
  const pruefe = (field, value, min, max, fallback, hinweis) => {
    const n = num(value);
    if (n === null) {
      errors.push({ field, message: `${hinweis} Erwartet wird eine Zahl.` });
      return fallback;
    }
    if (n < min || n > max) {
      errors.push({
        field,
        message: `${hinweis} Erlaubt ist ${min} bis ${max}, angegeben war ${n}.`
      });
      return fallback;
    }
    return n;
  };
  const latitude = pruefe("latitude", loc.latitude, -90, 90, 0, "Breitengrad.");
  const longitude = pruefe("longitude", loc.longitude, -180, 180, 0, "L\xE4ngengrad.");
  const zone2 = typeof loc.zone === "string" ? loc.zone : "";
  if (!zone2) {
    errors.push({ field: "zone", message: "Es wurde keine Zeitzone angegeben." });
  } else if (!isValidZone(zone2)) {
    errors.push({ field: "zone", message: `Die Zeitzone "${zone2}" ist unbekannt.` });
  }
  const fajrAngle = pruefe(
    "fajrAngle",
    par.fajrAngle,
    0.5,
    30,
    DEFAULT_PARAMS.fajrAngle,
    "D\xE4mmerungswinkel f\xFCr Fajr."
  );
  const ishaAngle = pruefe(
    "ishaAngle",
    par.ishaAngle,
    0.5,
    30,
    DEFAULT_PARAMS.ishaAngle,
    "D\xE4mmerungswinkel f\xFCr Isha."
  );
  const asrFactor = pruefe(
    "asrFactor",
    par.asrFactor,
    0.5,
    8,
    DEFAULT_PARAMS.asrFactor,
    "Schattenfaktor f\xFCr Assr."
  );
  const dhuhrOffsetMin = pruefe(
    "dhuhrOffsetMin",
    par.dhuhrOffsetMin,
    -30,
    60,
    0,
    "Sicherheitsminuten f\xFCr Dhur."
  );
  const elevationMeters = pruefe(
    "elevationMeters",
    par.elevationMeters,
    0,
    9e3,
    0,
    "H\xF6he \xFCber dem sichtbaren Horizont."
  );
  const rule = hl.rule;
  if (hl.rule !== void 0 && !HIGHLAT_RULES.includes(rule)) {
    errors.push({
      field: "highLatRule",
      message: `Unbekannte Regel f\xFCr hohe Breiten: "${String(hl.rule)}".`
    });
  }
  const fixedOffsetMin = pruefe(
    "fixedOffsetMin",
    hl.fixedOffsetMin ?? DEFAULT_HIGHLAT.fixedOffsetMin,
    1,
    240,
    DEFAULT_HIGHLAT.fixedOffsetMin,
    "Fester Versatz."
  );
  const rounding = raw.rounding;
  if (raw.rounding !== void 0 && !ROUNDINGS.includes(rounding)) {
    errors.push({ field: "rounding", message: `Unbekannte Rundung: "${String(raw.rounding)}".` });
  }
  const nightDefinition = raw.nightDefinition;
  if (raw.nightDefinition !== void 0 && !NIGHT_DEFS.includes(nightDefinition)) {
    errors.push({
      field: "nightDefinition",
      message: `Unbekannte Nachtdefinition: "${String(raw.nightDefinition)}".`
    });
  }
  if (errors.length > 0) return { ok: false, settings: null, errors };
  const location = { latitude, longitude, zone: zone2 };
  const params = {
    fajrAngle,
    ishaAngle,
    asrFactor,
    dhuhrOffsetMin,
    elevationMeters
  };
  const highLat = {
    rule: rule ?? DEFAULT_HIGHLAT.rule,
    fixedOffsetMin,
    maxSearchDays: DEFAULT_HIGHLAT.maxSearchDays
  };
  return {
    ok: true,
    errors: [],
    settings: {
      location,
      params,
      highLat,
      rounding: rounding ?? DEFAULT_SETTINGS.rounding,
      nightDefinition: nightDefinition ?? DEFAULT_SETTINGS.nightDefinition
    }
  };
}
function settingsFromQuery(query2, base = DEFAULT_SETTINGS) {
  const q = new URLSearchParams(query2);
  const hole = (key, fallback) => q.has(key) ? q.get(key) : fallback;
  return validateSettings({
    location: {
      latitude: hole("lat", base.location.latitude),
      longitude: hole("lon", base.location.longitude),
      zone: hole("tz", base.location.zone)
    },
    params: {
      fajrAngle: hole("fajr", base.params.fajrAngle),
      ishaAngle: hole("isha", base.params.ishaAngle),
      asrFactor: hole("asr", base.params.asrFactor),
      dhuhrOffsetMin: hole("dhuhr", base.params.dhuhrOffsetMin),
      elevationMeters: hole("elev", base.params.elevationMeters)
    },
    highLat: {
      rule: hole("hl", base.highLat.rule),
      fixedOffsetMin: hole("hlmin", base.highLat.fixedOffsetMin)
    },
    rounding: hole("round", base.rounding),
    nightDefinition: hole("night", base.nightDefinition)
  });
}

// src/cli.ts
var NAMEN = {
  fajr: "Fajr",
  sunrise: "Sonnenaufgang",
  dhuhr: "Dhur",
  asr: "Assr",
  maghrib: "Maghreb",
  isha: "Isha"
};
function fehler(text2) {
  process.stderr.write(text2 + "\n");
  process.exit(2);
}
var args = process.argv.slice(2);
var text = args.includes("--text");
var qIndex = args.indexOf("--einstellungen");
var query = qIndex >= 0 ? args[qIndex + 1] ?? "" : "";
var frei = args.filter((a, i) => !a.startsWith("--") && !(qIndex >= 0 && i === qIndex + 1));
var [lat, lon, zone, start, tage] = frei;
if (!lat || !lon || !zone) {
  fehler('Aufruf: schafaq <breite> <laenge> <zeitzone> [JJJJ-MM-TT] [tage] [--text] [--einstellungen "<query>"]');
}
var basis = query ? (() => {
  const r = settingsFromQuery(query);
  if (!r.ok) fehler(r.errors.map((e) => `${e.field}: ${e.message}`).join("\n"));
  return r.settings;
})() : DEFAULT_SETTINGS;
var settings = {
  ...basis,
  location: { latitude: Number(lat), longitude: Number(lon), zone }
};
var heute = /* @__PURE__ */ new Date();
var [year, month, day] = (start ?? "").split("-").map(Number);
var erster = start ? { year, month, day } : { year: heute.getFullYear(), month: heute.getMonth() + 1, day: heute.getDate() };
var ergebnis = [];
for (let i = 0; i < Number(tage ?? 1); i++) {
  const date = shiftDate(erster, i);
  const result = computeSchedule(settings, date);
  const times = {};
  for (const t of result.times) times[t.key] = t.instant;
  ergebnis.push({ date, times });
}
if (!text) {
  process.stdout.write(JSON.stringify(ergebnis) + "\n");
} else {
  const uhr = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: zone });
  for (const { date, times } of ergebnis) {
    process.stdout.write(`${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}
`);
    for (const key of Object.keys(NAMEN)) {
      const ms = times[key];
      process.stdout.write(`  ${NAMEN[key].padEnd(14)} ${ms === null ? "tritt nicht ein" : uhr.format(ms)}
`);
    }
  }
}
