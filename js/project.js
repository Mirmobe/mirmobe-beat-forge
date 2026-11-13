// Project JSON and the offline WAV bounce.

import { state, emit, toast } from './state.js';
import { TRACK_IDS, clonePattern, emptyPattern } from './theory.js';
import { renderOffline, resetGraph, syncMix } from './engine.js';
import { base64ToBytes, bytesToBase64, encodeWav, peakOf } from './wav.js';

export async function exportWav(loops = 4) {
  const rendered = await renderOffline(loops);
  const bytes = encodeWav(rendered);
  const peak = peakOf(rendered);
  const name = `${safeName(state.projectName)}-${state.bpm}bpm.wav`;
  downloadBlob(new Blob([bytes], { type: 'audio/wav' }), name);
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const summary = { bytes: bytes.length, peak, riff: head, name, seconds: rendered.duration };
  window.MirmobeBeatForge = window.MirmobeBeatForge || {};
  window.MirmobeBeatForge.lastExport = summary;
  return summary;
}

export function saveProject() {
  const payload = {
    format: 'mirmobe-beat-forge-project',
    version: 1,
    name: state.projectName,
    bpm: state.bpm,
    swing: state.swing,
    steps: state.steps,
    bank: state.bank,
    scale: state.scale,
    key: state.key,
    genre: state.genre,
    sidechain: state.sidechain,
    master: state.master,
    patterns: state.patterns,
    mixer: state.mixer,
    voiceOptions: state.voiceOptions,
    lyrics: state.lyrics,
    audioTracks: state.audioTracks.map((track) => ({
      name: track.name,
      role: track.role,
      nudgeMs: track.nudgeMs,
      trimStart: track.trimStart,
      trimEnd: track.trimEnd,
      mute: track.mute,
      solo: track.solo,
      volume: track.volume,
      pan: track.pan,
      eqLow: track.eqLow,
      eqMid: track.eqMid,
      eqHigh: track.eqHigh,
      reverb: track.reverb,
      delay: track.delay,
      drive: track.drive,
      followTempo: track.followTempo,
      wav: bytesToBase64(encodeWav(track.buffer))
    }))
  };
  downloadBlob(
    new Blob([JSON.stringify(payload)], { type: 'application/json' }),
    `${safeName(state.projectName)}.json`
  );
  toast('Project JSON saved in this browser download.');
}

export async function loadProjectFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || data.format !== 'mirmobe-beat-forge-project') {
    throw new Error('That file is not a Beat Forge project.');
  }
  state.projectName = String(data.name || 'Untitled Forge');
  state.bpm = clampInto(data.bpm, 60, 180, state.bpm);
  state.swing = clampInto(data.swing, 0, 0.45, state.swing);
  state.steps = data.steps === 32 ? 32 : 16;
  state.bank = ['A', 'B', 'C', 'D'].includes(data.bank) ? data.bank : 'A';
  state.scale = data.scale || state.scale;
  state.key = data.key || state.key;
  state.genre = data.genre || state.genre;
  state.sidechain = clampInto(data.sidechain, 0, 1, state.sidechain);
  if (data.master) state.master = { ...state.master, ...data.master };
  if (data.mixer) {
    TRACK_IDS.forEach((id) => {
      if (data.mixer[id]) state.mixer[id] = { ...state.mixer[id], ...data.mixer[id], mute: false, solo: false };
    });
  }
  if (data.patterns) {
    ['A', 'B', 'C', 'D'].forEach((bank) => {
      state.patterns[bank] = data.patterns[bank] ? clonePattern(data.patterns[bank]) : emptyPattern();
    });
  }
  if (data.voiceOptions) state.voiceOptions = { ...state.voiceOptions, ...data.voiceOptions };
  if (Array.isArray(data.lyrics)) state.lyrics = data.lyrics.slice(0, 4).map((line) => String(line));
  state.audioTracks = [];
  resetGraph();
  const context = new AudioContext();
  try {
    for (const item of data.audioTracks || []) {
      const bytes = base64ToBytes(item.wav);
      const buffer = await context.decodeAudioData(bytes.buffer.slice(0));
      state.audioTracks.push({
        id: `audio-load-${state.audioTracks.length + 1}`,
        name: item.name || 'Track',
        role: item.role || 'audio',
        buffer,
        nudgeMs: Number(item.nudgeMs) || 0,
        trimStart: Number(item.trimStart) || 0,
        trimEnd: Number(item.trimEnd) || 0,
        mute: Boolean(item.mute),
        solo: Boolean(item.solo),
        volume: Number(item.volume) || 0.8,
        pan: Number(item.pan) || 0,
        eqLow: Number(item.eqLow) || 0,
        eqMid: Number(item.eqMid) || 0,
        eqHigh: Number(item.eqHigh) || 0,
        reverb: Number(item.reverb) || 0,
        delay: Number(item.delay) || 0,
        drive: Number(item.drive) || 0,
        followTempo: Boolean(item.followTempo)
      });
    }
  } finally {
    context.close().catch(() => {});
  }
  syncMix();
  emit('project');
  toast('Project loaded.');
}

function clampInto(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function safeName(name) {
  return String(name || 'mirmobe-beat-forge').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mirmobe-beat-forge';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
