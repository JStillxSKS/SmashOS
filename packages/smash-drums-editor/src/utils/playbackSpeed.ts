export const PLAYBACK_SPEED_MIN = 0.25;
export const PLAYBACK_SPEED_MAX = 2;

export function clampPlaybackSpeed(speed: number): number {
  return Math.max(PLAYBACK_SPEED_MIN, Math.min(PLAYBACK_SPEED_MAX, speed));
}