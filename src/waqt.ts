/**
 * Welcher Waqt laeuft gerade, und welches Gebet kommt als naechstes.
 *
 * Waqt ist der Zeitraum eines Gebets, nicht sein Zeitpunkt. Diese Datei
 * beantwortet damit genau die Frage, die im Kopf der Startseite steht.
 *
 * Warum das hier liegt und nicht in der Svelte-Komponente:
 *
 * In der ersten Fassung stand die Liste der Gebetsschluessel als Zeichenkette
 * in der Komponente, in deutscher Schreibweise: 'fadschr', 'ischa',
 * 'sonnenaufgang'. Die Schluessel des Kerns heissen aber 'fajr', 'isha',
 * 'sunrise'. Die drei Vergleiche trafen deshalb NIE zu, und die drei Marken
 * wurden stumm verworfen. Uebrig blieben Dhur, Assr und Maghreb, und kurz vor
 * Isha war die naechste verbliebene Marke folgerichtig der Dhur des
 * naechsten Tages.
 *
 * Der Fehler war unsichtbar, weil ein nicht zutreffender Vergleich kein Fehler
 * ist, sondern einfach false. Hier ist die Liste als EventKey typisiert: Ein
 * Tippfehler laesst sich nicht mehr uebersetzen. Und sie ist geprueft.
 *
 * Zweite Einsicht aus demselben Fehler: NICHT jede Marke eroeffnet ein Gebet.
 * Der Sonnenaufgang BEENDET Fajr und beginnt nichts. Zwischen ihm und Dhur
 * laeuft kein Waqt. Deshalb werden Gebet und Grenze getrennt zurueckgegeben,
 * und das naechste GEBET wird unabhaengig davon bestimmt, ob vorher noch eine
 * Grenze liegt.
 */

import type { EventKey } from './rawDay';
import type { DisplayTime } from './schedule';

/** Die fuenf Zeiten, die einen Waqt eroeffnen. Reihenfolge des Tages. */
export const GEBETE: readonly EventKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Marken, die einen Waqt beenden, ohne einen neuen zu eroeffnen. */
export const GRENZEN: readonly EventKey[] = ['sunrise'];

export interface Marke {
  key: EventKey;
  instant: number;
  /** true, wenn mit dieser Marke ein Waqt beginnt. */
  eroeffnet: boolean;
}

export interface WaqtLage {
  /** Das Gebet, dessen Waqt gerade laeuft. null zwischen Sonnenaufgang und Dhur. */
  laufend: Marke | null;
  /**
   * Das naechste Gebet. Immer ein Gebet, nie eine Grenze.
   *
   * Das ist die Zusage dieser Funktion: Im Kopf der Seite steht immer das
   * naechste Gebet, auch wenn vorher noch der Sonnenaufgang liegt.
   */
  naechstesGebet: Marke | null;
  /** Die naechste Grenze, aber nur wenn sie VOR dem naechsten Gebet liegt. */
  naechsteGrenze: Marke | null;
}

/**
 * Fuehrt mehrere Tagesplaene zu einer Zeitachse zusammen.
 *
 * Erwartet werden mindestens Vortag, Tag und Folgetag. Ohne die Nachbarn
 * entsteht zwischen Isha und Fajr eine Luecke, denn dort gehoert das
 * laufende Gebet zum Vortag und das naechste zum Folgetag.
 */
export function markenAus(...tage: DisplayTime[][]): Marke[] {
  const alle: Marke[] = [];
  for (const tag of tage) {
    for (const t of tag) {
      if (t.instant === null) continue;
      const key = t.key as EventKey;
      const eroeffnet = GEBETE.includes(key);
      const grenze = GRENZEN.includes(key);
      if (!eroeffnet && !grenze) continue;
      alle.push({ key, instant: t.instant, eroeffnet });
    }
  }
  alle.sort((a, b) => a.instant - b.instant);
  // Die Tage koennen sich durch Folgetagswerte ueberlappen. Zwei Marken zum
  // exakt selben Zeitpunkt sind dieselbe Marke.
  return alle.filter((m, i) => i === 0 || m.instant !== alle[i - 1]!.instant);
}

/** Bestimmt die Lage zu einem Zeitpunkt. Die Marken muessen sortiert sein. */
export function bestimmeWaqt(marken: Marke[], jetzt: number): WaqtLage {
  let letzte: Marke | null = null;
  for (const m of marken) {
    if (m.instant <= jetzt) letzte = m;
    else break;
  }

  const naechstesGebet = marken.find((m) => m.instant > jetzt && m.eroeffnet) ?? null;
  const grenze = marken.find((m) => m.instant > jetzt && !m.eroeffnet) ?? null;

  return {
    // Steht als letztes eine Grenze, laeuft kein Waqt. Genau das ist die Lage
    // zwischen Sonnenaufgang und Dhur.
    laufend: letzte?.eroeffnet ? letzte : null,
    naechstesGebet,
    naechsteGrenze:
      grenze && (!naechstesGebet || grenze.instant < naechstesGebet.instant) ? grenze : null,
  };
}
