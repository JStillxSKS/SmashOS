import type { ChartNote, Difficulty, MetaJson } from "../types/meta";

const DIFFICULTY_ORDER: Difficulty[] = ["extreme", "hard", "normal", "easy"];

/** Clone Hero / Moonscraper song.ini difficulty rating (0 = none, 4 = expert). */
const CH_DIFFICULTY_RATING: Record<Difficulty, number> = {
  easy: 1,
  normal: 2,
  hard: 3,
  extreme: 4,
};

function highestDrumDifficulty(charts: Record<Difficulty, ChartNote[]>): number {
  for (const difficulty of DIFFICULTY_ORDER) {
    if (charts[difficulty].length > 0) {
      return CH_DIFFICULTY_RATING[difficulty];
    }
  }
  return 0;
}

function iniLine(key: string, value: string | number): string {
  return `${key} = ${value}`;
}

/**
 * Clone Hero song.ini — matches Indies TCBAITW layout and Moonscraper export tags.
 * Offset is baked into notes.chart / meta timing, so delay stays 0.
 */
export function buildSongIni(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>,
  duration = 0
): string {
  const diffRating = highestDrumDifficulty(charts);
  const songLengthMs = duration > 0 ? Math.round(duration * 1000) : 0;

  const lines = [
    "[song]",
    iniLine("name", meta.NameSong.trim() || "Untitled Song"),
    iniLine("artist", meta.NameArtist.trim() || "Unknown Artist"),
    iniLine("album", ""),
    iniLine("genre", "rock"),
    iniLine("year", ""),
    iniLine("song_length", songLengthMs),
    iniLine("charter", meta.NameCharter.trim() || "Chart Editor"),
    iniLine("diff_band", diffRating),
    iniLine("diff_guitar", diffRating),
    iniLine("diff_rhythm", diffRating),
    iniLine("diff_bass", diffRating),
    iniLine("diff_drums", diffRating),
    iniLine("diff_keys", diffRating),
    iniLine("diff_guitarghl", diffRating),
    iniLine("diff_bassghl", diffRating),
    iniLine("diff_rhythmghl", diffRating),
    iniLine("preview_start_time", 0),
    iniLine("icon", 0),
    iniLine("playlist_track", ""),
    iniLine("track", ""),
    iniLine("album_track", ""),
    iniLine("delay", 0),
    iniLine("loading_phrase", ""),
    "",
  ];

  return lines.join("\n");
}

function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadSongIni(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>,
  duration = 0,
  filename = "song.ini"
): void {
  downloadTextFile(buildSongIni(meta, charts, duration), filename);
}