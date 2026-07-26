export type AudioSource = "song" | "drums";

export function getActiveAudioUrl(state: {
  audioSource: AudioSource;
  audioUrl: string | null;
  drumsAudioUrl: string | null;
}): string | null {
  if (state.audioSource === "drums" && state.drumsAudioUrl) {
    return state.drumsAudioUrl;
  }
  return state.audioUrl;
}

export function getActiveAudioBuffer(state: {
  audioSource: AudioSource;
  audioBuffer: AudioBuffer | null;
  drumsAudioBuffer: AudioBuffer | null;
}): AudioBuffer | null {
  if (state.audioSource === "drums" && state.drumsAudioBuffer) {
    return state.drumsAudioBuffer;
  }
  return state.audioBuffer;
}

export function hasActiveAudio(state: {
  audioSource: AudioSource;
  audioBuffer: AudioBuffer | null;
  drumsAudioBuffer: AudioBuffer | null;
}): boolean {
  return getActiveAudioBuffer(state) != null;
}

export function getActiveDuration(state: {
  audioSource: AudioSource;
  duration: number;
  drumsAudioBuffer: AudioBuffer | null;
}): number {
  if (state.audioSource === "drums" && state.drumsAudioBuffer) {
    return state.drumsAudioBuffer.duration;
  }
  return state.duration;
}

export function getMainWaveformBuffer(state: {
  audioSource: AudioSource;
  audioBuffer: AudioBuffer | null;
  drumsAudioBuffer: AudioBuffer | null;
}): AudioBuffer | null {
  if (state.audioSource === "drums" && state.drumsAudioBuffer) {
    return state.drumsAudioBuffer;
  }
  return state.audioBuffer;
}

/** Per-lane strips prefer the isolated drums stem when loaded. */
export function getLaneWaveformBuffer(state: {
  drumsAudioBuffer: AudioBuffer | null;
  audioBuffer: AudioBuffer | null;
}): AudioBuffer | null {
  return state.drumsAudioBuffer ?? state.audioBuffer;
}

export function activeSourceLabel(state: {
  audioSource: AudioSource;
  drumsAudioUrl: string | null;
}): AudioSource {
  if (state.audioSource === "drums" && state.drumsAudioUrl) return "drums";
  return "song";
}