import { normalizeSongBpm } from "./timing";

export type BpmResult = {
  bpm: number;
  confidence: number;
};

/**
 * Estimate BPM from an AudioBuffer using spectral flux + autocorrelation.
 * Analyzes up to 90 seconds of audio.
 */
export function detectBpm(buffer: AudioBuffer): BpmResult {
  const sampleRate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);
  const maxLen = Math.min(channel.length, Math.floor(sampleRate * 90));

  const fps = 100;
  const frameSize = Math.floor(sampleRate / fps);
  const frames = Math.floor(maxLen / frameSize);
  if (frames < fps * 4) return { bpm: normalizeSongBpm(120), confidence: 0 };

  const envelope = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const start = f * frameSize;
    for (let i = 0; i < frameSize; i++) {
      const v = channel[start + i] ?? 0;
      e += v * v;
    }
    envelope[f] = Math.sqrt(e / frameSize);
  }

  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    flux[f] = Math.max(0, envelope[f] - envelope[f - 1]);
  }

  const minBpm = 55;
  const maxBpm = 220;
  const minLag = Math.max(2, Math.floor((fps * 60) / maxBpm));
  const maxLag = Math.floor((fps * 60) / minBpm);

  const scores: { lag: number; score: number }[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let n = 0;
    for (let f = 0; f < frames - lag; f++) {
      corr += flux[f] * flux[f + lag];
      n++;
    }
    scores.push({ lag, score: n > 0 ? corr / n : 0 });
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best || best.score <= 0) return { bpm: normalizeSongBpm(120), confidence: 0 };

  const rawBpm = (60 * fps) / best.lag;

  // Resolve half/double tempo ambiguities — compare whole-number BPM only
  const candidates = new Set<number>();
  for (const { lag } of scores.slice(0, 8)) {
    let b = (60 * fps) / lag;
    while (b < 75) b *= 2;
    while (b > 190) b /= 2;
    candidates.add(normalizeSongBpm(b));
  }

  const ranked = [...candidates].map((b) => {
    const targetLag = (60 * fps) / b;
    let score = 0;
    for (const { lag, score: s } of scores) {
      const ratio = lag / targetLag;
      const harm = Math.min(Math.abs(ratio - 1), Math.abs(ratio - 2), Math.abs(ratio - 0.5));
      if (harm < 0.08) score = Math.max(score, s);
    }
    return { bpm: b, score };
  });
  ranked.sort((a, b) => b.score - a.score);

  const pick = ranked[0] ?? { bpm: normalizeSongBpm(rawBpm), score: best.score };
  const maxScore = scores[0].score;
  const confidence = maxScore > 0 ? Math.min(1, pick.score / maxScore) : 0;

  return {
    bpm: normalizeSongBpm(pick.bpm),
    confidence: Math.round(confidence * 100) / 100,
  };
}