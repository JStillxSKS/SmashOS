import type { ChartNote, Difficulty, MetaJson } from "../types/meta";

export function chartFingerprint(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>
): string {
  return JSON.stringify({ meta, charts });
}