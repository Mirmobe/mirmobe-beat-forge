// Level and grid analysis. Suggests a balance, then applies it in one click.

import { state, emit } from './state.js';
import { DRUM_IDS, TRACK_IDS, bufferRms, clamp, detectOnset } from './theory.js';
import { loopDuration, syncMix } from './engine.js';

function cloneMix() {
  const mix = {};
  TRACK_IDS.forEach((id) => {
    mix[id] = { ...state.mixer[id] };
  });
  return mix;
}

export function analyzeMix() {
  const mix = cloneMix();
  const pattern = state.patterns[state.bank];
  const density = {};
  TRACK_IDS.forEach((id) => {
    const line = pattern[id].slice(0, state.steps);
    density[id] = line.filter((value) => value > 0).length / Math.max(1, line.length);
  });

  mix.kick.volume = 0.9;
  mix.kick.eqLow = 3.5;
  mix.kick.eqMid = -2;
  mix.kick.drive = 0.06;
  mix.snare.volume = 0.64;
  mix.snare.reverb = 0.16;
  mix.snare.eqHigh = 2;
  mix.clap.volume = density.clap > 0.2 ? 0.5 : 0.42;
  mix.clap.reverb = 0.12;
  mix.hat.volume = density.hat > 0.55 ? 0.22 : 0.32;
  mix.hat.eqLow = -8;
  mix.hat.eqHigh = 3.5;
  mix.openhat.volume = 0.3;
  mix.openhat.reverb = 0.18;
  mix.openhat.eqLow = -6;
  mix.perc.volume = density.perc > 0.3 ? 0.4 : 0.34;
  mix.bass.volume = 0.8;
  mix.bass.eqLow = 2.5;
  mix.bass.eqMid = -3.5;
  mix.bass.eqHigh = -4;
  mix.bass.drive = state.genre === 'trap' || state.genre === 'drill' ? 0.3 : 0.16;
  mix.chords.volume = 0.48;
  mix.chords.eqLow = -4;
  mix.chords.eqHigh = 2;
  mix.chords.reverb = 0.22;
  mix.chords.delay = 0.14;

  const sidechain = density.kick > 0.12 ? 0.58 : 0.3;
  const suggestions = [
    'Gain staging: kick leads, hats sit back, chords leave room for the vocal.',
    'EQ carve: bass mids dip so the kick keeps the sub, hats lose the rumble.',
    `Sidechain feel at ${Math.round(sidechain * 100)}% so the 808 and vocals duck the kick.`,
    'Sends: a short room on the snare and a dotted delay on the chords.'
  ];

  const tracks = state.audioTracks.map((track) => {
    const next = { ...track };
    const rms = bufferRms(track.buffer);
    const staged = clamp(0.2 / Math.max(0.04, rms), 0.35, 1);
    next.volume = Math.round(staged * 100) / 100;
    if (track.role === 'vocal') {
      next.eqLow = -6;
      next.eqMid = 1.8;
      next.eqHigh = 3.2;
      next.reverb = Math.max(next.reverb || 0, 0.14);
      next.delay = Math.max(next.delay || 0, 0.08);
    }
    const onset = detectOnset(track.buffer);
    const step = 60 / state.bpm / 4;
    const nearest = Math.round(onset / step) * step;
    const nudge = clamp((nearest - onset) * 1000, -150, 150);
    next.nudgeMs = Math.round(nudge);
    suggestions.push(`"${track.name}" leveled to ${Math.round(next.volume * 100)}% and nudged ${next.nudgeMs} ms onto the grid.`);
    return next;
  });

  if (!tracks.length) {
    suggestions.push('Add a demo loop or a take to align a recording to the grid.');
  }

  return { mix, sidechain, tracks, suggestions, loop: loopDuration() };
}

export function applyMix(plan) {
  state.mixer = plan.mix;
  state.sidechain = plan.sidechain;
  plan.tracks.forEach((updated) => {
    const track = state.audioTracks.find((item) => item.id === updated.id);
    if (!track) return;
    track.volume = updated.volume;
    track.eqLow = updated.eqLow;
    track.eqMid = updated.eqMid;
    track.eqHigh = updated.eqHigh;
    track.reverb = updated.reverb;
    track.delay = updated.delay;
    track.nudgeMs = updated.nudgeMs;
  });
  syncMix();
  emit('project');
}
