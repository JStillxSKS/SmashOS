import type { ChartNote, Difficulty } from "../types/meta";
import { beatToTick, RESOLUTION } from "./resolution";

const DIFFICULTY_ORDER: Difficulty[] = ["extreme", "hard", "normal", "easy"];

/** After import, jump to the chart that has notes and scroll near the first hit. */
export function importViewState(
  charts: Record<Difficulty, ChartNote[]>
): { difficulty: Difficulty; scrollTick: number } {
  for (const difficulty of DIFFICULTY_ORDER) {
    const notes = charts[difficulty];
    if (notes.length > 0) {
      const firstTick = beatToTick(notes[0].Beat);
      return {
        difficulty,
        scrollTick: Math.max(0, firstTick - RESOLUTION * 2),
      };
    }
  }
  return { difficulty: "extreme", scrollTick: 0 };
}