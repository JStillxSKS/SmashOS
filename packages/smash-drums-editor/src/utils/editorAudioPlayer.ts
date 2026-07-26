import type { AudioSource } from "./audioSource";
import { getActiveAudioBuffer } from "./audioSource";
import { editorAudioContext } from "./editorAudioContext";
import { clampPlaybackSpeed } from "./playbackSpeed";

/**
 * Plays the decoded AudioBuffer via Web Audio so playback length matches the
 * waveform (HTMLMediaElement often reports a shorter duration for OGG/VBR).
 */
class EditorAudioPlayer {
  private buffer: AudioBuffer | null = null;
  private readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private generation = 0;

  private pausedAt = 0;
  private playStartedAt = 0;
  private playOffset = 0;
  private playing = false;
  private rate = 1;
  private muted = false;
  private volume = 1;
  private onEnded: (() => void) | null = null;

  constructor() {
    this.gain = editorAudioContext.createGain();
    this.gain.connect(editorAudioContext.destination);
  }

  setBuffer(buffer: AudioBuffer | null): void {
    this.cancelPending();
    this.buffer = buffer;
    this.pausedAt = 0;
    this.playing = false;
  }

  setOnEnded(handler: (() => void) | null): void {
    this.onEnded = handler;
  }

  getDuration(): number {
    return this.buffer?.duration ?? 0;
  }

  getAudioTime(): number {
    if (!this.playing) return this.pausedAt;
    const elapsed = (editorAudioContext.currentTime - this.playStartedAt) * this.rate;
    const duration = this.getDuration();
    const next = this.playOffset + elapsed;
    return duration > 0 ? Math.min(next, duration) : next;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  isAudible(): boolean {
    return this.playing && !this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  cancelPending(): void {
    this.generation++;
    if (this.playing) {
      this.pausedAt = this.getAudioTime();
    }
    this.stopSource();
    this.playing = false;
  }

  pause(): void {
    this.cancelPending();
  }

  seek(audioTime: number): void {
    const duration = this.getDuration();
    this.pausedAt =
      duration > 0
        ? Math.max(0, Math.min(audioTime, duration))
        : Math.max(0, audioTime);
    if (this.playing) {
      this.cancelPending();
    }
  }

  play(from?: number): void {
    if (!this.buffer || this.buffer.duration <= 0) return;

    if (from !== undefined) {
      this.seek(from);
    }

    const duration = this.buffer.duration;
    if (this.pausedAt >= duration - 0.01) {
      this.playing = false;
      this.pausedAt = duration;
      this.onEnded?.();
      return;
    }

    this.stopSource();
    const gen = ++this.generation;
    this.playOffset = this.pausedAt;

    const source = editorAudioContext.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    source.connect(this.gain);
    source.onended = () => {
      if (gen !== this.generation) return;
      this.playing = false;
      this.source = null;
      this.pausedAt = duration;
      this.onEnded?.();
    };

    this.gain.gain.value = this.muted ? 0 : this.volume;
    this.playStartedAt = editorAudioContext.currentTime;
    source.start(0, this.playOffset);
    this.source = source;
    this.playing = true;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.gain.gain.value = muted ? 0 : this.volume;
  }

  setRate(rate: number): void {
    const next = clampPlaybackSpeed(rate);
    if (Math.abs(next - this.rate) < 0.001) return;
    this.rate = next;
    if (!this.playing) return;
    const at = this.getAudioTime();
    this.cancelPending();
    this.play(at);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (!this.muted) {
      this.gain.gain.value = this.volume;
    }
  }

  private stopSource(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // Already stopped.
    }
    this.source.disconnect();
    this.source = null;
  }
}

export const editorAudioPlayer = new EditorAudioPlayer();

export function syncEditorAudioPlayerFromState(state: {
  audioSource: AudioSource;
  audioBuffer: AudioBuffer | null;
  drumsAudioBuffer: AudioBuffer | null;
  playbackSpeed: number;
  songVolume: number;
}): void {
  const keepTime = editorAudioPlayer.getAudioTime();
  const wasPlaying = editorAudioPlayer.isPlaying();
  editorAudioPlayer.setBuffer(getActiveAudioBuffer(state));
  editorAudioPlayer.setRate(state.playbackSpeed);
  editorAudioPlayer.setVolume(state.songVolume);
  editorAudioPlayer.seek(keepTime);
  if (wasPlaying) {
    editorAudioPlayer.play(keepTime);
  }
}