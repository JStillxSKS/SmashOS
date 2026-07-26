import type { ChartNote } from "../types/meta";

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function ensureAudio(): { ctx: AudioContext; master: GainNode } {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return { ctx: audioCtx, master: masterGain! };
}

function noiseBurst(
  ctx: AudioContext,
  dest: AudioNode,
  duration: number,
  gain: number,
  filterFreq?: number
) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq ?? 1800;
  filter.Q.value = 0.7;

  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  src.start();
  src.stop(ctx.currentTime + duration + 0.02);
}

function toneDrop(
  ctx: AudioContext,
  dest: AudioNode,
  startHz: number,
  endHz: number,
  duration: number,
  gain: number,
  type: OscillatorType = "sine"
) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(startHz, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, endHz), ctx.currentTime + duration);

  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.connect(g);
  g.connect(dest);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.02);
}

/** Synthesized Indies drum preview — editor only */
export function playDrumHit(
  id: ChartNote["Id"],
  strength: ChartNote["Strength"],
  volume: number
): void {
  if (volume <= 0) return;

  const { ctx, master } = ensureAudio();
  master.gain.value = volume;
  const t = ctx.currentTime;
  const vel = 0.35 + strength * 0.22;

  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(master);

  switch (id) {
    case 0: // Bass kick
      toneDrop(ctx, bus, 140, 48, 0.22, vel * 1.1, "sine");
      noiseBurst(ctx, bus, 0.04, vel * 0.25, 120);
      break;
    case 1: // Snare
      noiseBurst(ctx, bus, 0.14, vel * 0.95, 2200);
      toneDrop(ctx, bus, 220, 160, 0.06, vel * 0.35, "triangle");
      break;
    case 2: // Cymbal
      noiseBurst(ctx, bus, 0.55, vel * 0.7, 6800);
      noiseBurst(ctx, bus, 0.35, vel * 0.35, 12000);
      break;
    case 3: // Tom
      toneDrop(ctx, bus, 180, 90, 0.18, vel * 0.9, "sine");
      break;
    case 4: // Hi-hat
      noiseBurst(ctx, bus, strength === 0 ? 0.035 : 0.07, vel * 0.65, strength === 0 ? 9000 : 6500);
      break;
    case 5: // Clapfire
      noiseBurst(ctx, bus, 0.05, vel * 0.5, 1400);
      noiseBurst(ctx, bus, 0.08, vel * 0.55, 2800);
      toneDrop(ctx, bus, 900, 400, 0.04, vel * 0.2, "square");
      break;
    default:
      noiseBurst(ctx, bus, 0.08, vel * 0.5, 2000);
  }

  // Tiny click for articulation
  const click = ctx.createOscillator();
  click.type = "square";
  click.frequency.value = 1200;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(vel * 0.04, t);
  clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
  click.connect(clickGain);
  clickGain.connect(bus);
  click.start(t);
  click.stop(t + 0.015);
}