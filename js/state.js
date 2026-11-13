// Shared studio state. Audio nodes live in the engine; this object is the score.

import { clonePattern, emptyPattern, forgeLocal, TRACK_IDS } from './theory.js';

const opening = forgeLocal('warm dusk groove 96 bpm in A minor');

export const state = {
  bpm: opening.bpm,
  swing: opening.swing,
  steps: 16,
  bank: 'A',
  scale: opening.scale,
  key: opening.key,
  playing: false,
  recording: false,
  currentStep: -1,
  countIn: false,
  metronome: false,
  sidechain: opening.sidechain,
  master: { glue: 0.42, gain: 0.88 },
  patterns: {
    A: clonePattern(opening.patterns),
    B: emptyPattern(),
    C: emptyPattern(),
    D: emptyPattern()
  },
  mixer: opening.mix,
  voiceOptions: opening.voice,
  audioTracks: [],
  lyrics: ['', '', '', ''],
  projectName: 'Untitled Forge',
  genre: opening.genre,
  io: {
    directMode: false,
    channel: 'stereo',
    inputId: '',
    outputId: '',
    inputGain: 1,
    simulate: false,
    midiTarget: 'auto',
    stepRecord: false,
    clockOut: false,
    midiOutId: '',
    mappings: [],
    writeHead: 0
  }
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(type, detail) {
  for (const fn of [...listeners]) {
    try {
      fn(type, detail);
    } catch (err) {
      // A view error must not stop the scheduler.
    }
  }
}

export function toast(message) {
  emit('toast', message);
}

export function currentPattern() {
  return state.patterns[state.bank];
}

export function anySolo() {
  if (TRACK_IDS.some((id) => state.mixer[id] && state.mixer[id].solo)) return true;
  return state.audioTracks.some((track) => track.solo);
}

export function audible(params) {
  if (!params || params.mute) return false;
  if (anySolo() && !params.solo) return false;
  return true;
}

export function duplicateBarIfEmpty() {
  const pattern = currentPattern();
  TRACK_IDS.forEach((id) => {
    const line = pattern[id];
    if (line.slice(16, 32).some((value) => value)) return;
    for (let i = 0; i < 16; i += 1) line[16 + i] = line[i];
  });
}
