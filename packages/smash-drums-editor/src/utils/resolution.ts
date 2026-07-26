/** Clone Hero / Moonscraper standard chart resolution */
export const RESOLUTION = 480;
export const BEATS_PER_MEASURE = 4;
export const TICKS_PER_MEASURE = RESOLUTION * BEATS_PER_MEASURE;

/** Moonscraper-style grid: always draw 1/8 lines; snap only changes placement. */
export const VISUAL_GRID_TICKS = 240;

/** Default zoom — 64px per 1/8 row at startup. */
export const FIXED_PIXELS_PER_TICK = 64 / VISUAL_GRID_TICKS;

export const MIN_PIXELS_PER_TICK = 0.12;
export const MAX_PIXELS_PER_TICK = 2;

export function clampPixelsPerTick(ppt: number): number {
  return Math.max(MIN_PIXELS_PER_TICK, Math.min(MAX_PIXELS_PER_TICK, ppt));
}

/** Visual 1/8 row height — snap only affects placement, not zoom. */
export function visualGridRowPixels(pixelsPerTick: number): number {
  return VISUAL_GRID_TICKS * pixelsPerTick;
}

export const SNAP_OPTIONS = [
  { ticks: 480, label: "1/4 (Beat)" },
  { ticks: 240, label: "1/8" },
  { ticks: 120, label: "1/16" },
  { ticks: 60, label: "1/32" },
  { ticks: 30, label: "1/64" },
  { ticks: TICKS_PER_MEASURE, label: "1/1 (Measure)" },
] as const;

export function beatToTick(beat: number): number {
  return Math.round(beat * RESOLUTION);
}

export function tickToBeat(tick: number): number {
  return tick / RESOLUTION;
}

export function snapTick(rawTick: number, snapTicks: number): number {
  if (snapTicks <= 0) return Math.max(0, Math.round(rawTick));
  return Math.max(0, Math.round(rawTick / snapTicks) * snapTicks);
}

export function snapBeat(beat: number, snapTicks: number): number {
  return tickToBeat(snapTick(beatToTick(beat), snapTicks));
}

export function beatsEqual(a: number, b: number): boolean {
  return beatToTick(a) === beatToTick(b);
}

export function formatTick(tick: number): string {
  const measure = Math.floor(tick / TICKS_PER_MEASURE);
  const beatInMeasure = Math.floor((tick % TICKS_PER_MEASURE) / RESOLUTION);
  const sub = tick % RESOLUTION;
  if (sub === 0) return `M${measure}:B${beatInMeasure}`;
  return `M${measure}:B${beatInMeasure}+${sub}`;
}