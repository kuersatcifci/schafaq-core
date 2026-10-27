/**
 * Uebersetzt gerechnete Tage in die Datei, die die App an Kotlin uebergibt.
 *
 * Hier wird nichts gerechnet, was nicht schon gerechnet ist. Der einzige Zweck
 * ist, aus DisplayTime eine Form zu machen, die ein Widget lesen kann, ohne
 * Astronomie zu koennen.
 *
 * Zwei Festlegungen aus dem Entwurf, die nicht angetastet werden sollten:
 *
 * 1. Ausschliesslich Zeitpunkte in Millisekunden, nie Wanduhrzeiten. Damit
 *    kann das Widget bei der Zeitumstellung nichts falsch machen, es hat gar
 *    keine Wanduhrzeit zum Verrechnen.
 * 2. Ein Eintrag wird nie weggelassen. Tritt die Zeit nicht ein, steht `ms`
 *    auf null und `tiefster` und `fehlt` tragen die Gradzahlen. Sonst koennte
 *    das Widget "tritt nicht ein" nicht von "noch nicht gerechnet"
 *    unterscheiden, und das sind zwei voellig verschiedene Aussagen.
 */
import { computeSchedule, type Settings, type TimeKey } from './schedule';
import { shiftDate, type CalendarDate } from './rawDay';

export interface ExportTime {
  id: TimeKey;
  /** Zeitpunkt in Millisekunden, oder null wenn die Zeit nicht eintritt. */
  ms: number | null;
  /** Name der angewandten Ersatzregel, oder null. */
  ersatz: string | null;
  /** Tiefster erreichter Sonnenstand in Grad, nur wenn ms null ist. */
  tiefster: number | null;
  /** Fehlmarge in Grad, nur wenn ms null ist. */
  fehlt: number | null;
}

export interface ExportDay {
  /** Kalendertag als YYYY-MM-DD. Nur zum Nachschlagen, gerechnet wird mit ms. */
  d: string;
  t: ExportTime[];
}

export interface ExportPayload {
  version: 1;
  generatedAt: number;
  place: { name: string; lat: number; lon: number; tz: string };
  /**
   * Vollstaendige Einstellungen. Sie stehen hier, damit das Nachfuellen im
   * Hintergrund ohne localStorage auskommt: Kotlin liest sie aus dieser Datei
   * und reicht sie der oberflaechenlosen Seite herein.
   */
  settings: Settings;
  notify: Record<string, boolean | number>;
  days: ExportDay[];
}

function datumsText(d: CalendarDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export function baueExport(
  settings: Settings,
  start: CalendarDate,
  tage: number,
  ortsname: string,
  jetzt: number,
  notify: Record<string, boolean | number> = {},
): ExportPayload {
  const days: ExportDay[] = [];
  let d = start;
  for (let i = 0; i < tage; i++) {
    const r = computeSchedule(settings, d);
    days.push({
      d: datumsText(d),
      t: r.times.map((x) => ({
        id: x.key,
        ms: x.instant,
        ersatz: x.source === 'ersatzregel' ? (x.appliedRule?.rule ?? null) : null,
        tiefster: x.instant === null ? (x.existence?.hMin ?? null) : null,
        fehlt: x.instant === null ? (x.existence?.marginDeg ?? null) : null,
      })),
    });
    d = shiftDate(d, 1);
  }
  return {
    version: 1,
    generatedAt: jetzt,
    place: {
      name: ortsname,
      lat: settings.location.latitude,
      lon: settings.location.longitude,
      tz: settings.location.zone,
    },
    settings,
    notify,
    days,
  };
}
