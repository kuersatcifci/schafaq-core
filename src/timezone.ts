/**
 * IANA-Zonenarithmetik ohne Bibliothek, ueber Intl.DateTimeFormat.
 *
 * Zwei Aufgaben:
 *   1. Wie gross ist der Zonenversatz zu einem bestimmten Zeitpunkt?
 *   2. Welcher Zeitpunkt gehoert zu einem lokalen Kalendertag?
 *
 * Zu 2. die wichtigste Entscheidung des Moduls: Der Anker ist immer 12:00 Uhr
 * lokal, nie 00:00. Lokale Mitternacht kann in manchen Zonen gar nicht existieren
 * oder doppeldeutig sein (Umstellung um Mitternacht). 12:00 lokal ist in keiner
 * realen Zone von einer Umstellung betroffen. Damit entfaellt die gesamte
 * Ambiguitaetsbehandlung.
 */

export interface LocalParts {
  year: number;
  month: number; // 1 bis 12
  day: number;
  hour: number; // 0 bis 23
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(zone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(zone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      throw new Error(`Unbekannte Zeitzone: ${zone}`);
    }
    formatterCache.set(zone, f);
  }
  return f;
}

/** Prueft, ob eine IANA-Zone von der Laufzeitumgebung unterstuetzt wird. */
export function isValidZone(zone: string): boolean {
  try {
    getFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** Lokale Datumsteile eines Zeitpunkts in der angegebenen Zone. */
export function instantToLocalParts(zone: string, instantMs: number): LocalParts {
  const parts = getFormatter(zone).formatToParts(new Date(instantMs));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // hourCycle h23 liefert 00 bis 23. Manche Umgebungen liefern trotzdem 24 fuer
    // Mitternacht, deshalb die Modulo-Absicherung.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Zonenversatz in Millisekunden zu einem bestimmten Zeitpunkt.
 * Positiv oestlich von Greenwich. Behandelt halbstuendige und
 * viertelstuendige Versaetze (Kathmandu +05:45, Chatham +12:45) korrekt,
 * weil der Wert aus der Formatierung selbst stammt und nicht geparst wird.
 */
export function tzOffsetMs(zone: string, instantMs: number): number {
  const p = instantToLocalParts(zone, instantMs);
  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Der Formatter arbeitet sekundengenau, deshalb wird der Zeitpunkt vor dem
  // Vergleich ebenfalls auf volle Sekunden abgeschnitten.
  return asIfUTC - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Zeitpunkt des lokalen Mittags (12:00) an einem lokalen Kalendertag.
 *
 * Das ist der Anker, an dem der gesamte Tagesplan haengt. Der zweite
 * Offset-Aufruf faengt den Fall ab, dass der erste Schaetzwert in einen anderen
 * Sommerzeit-Zustand faellt als das Ergebnis.
 */
export function localNoonAnchor(zone: string, year: number, month: number, day: number): number {
  const guess = Date.UTC(year, month - 1, day, 12, 0, 0);
  const off1 = tzOffsetMs(zone, guess);
  let instant = guess - off1;
  const off2 = tzOffsetMs(zone, instant);
  if (off2 !== off1) instant = guess - off2;
  return instant;
}

/** Zone des Geraets. Nur als Vorschlag zu verwenden, nie als Tatsache. */
export function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
