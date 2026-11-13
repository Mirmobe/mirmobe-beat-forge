// Prompt-to-beat. Tries the keyless Pollinations endpoint, then the local forge.

import { state, emit, toast } from './state.js';
import {
  DRUM_IDS,
  SCALES,
  TRACK_IDS,
  clamp,
  forgeLocal,
  midiToDegree,
  normalizeKey,
  normalizeScale,
  writeLocalHook
} from './theory.js';

const ENDPOINT = 'https://text.pollinations.ai/openai';
const COOLDOWN_KEY = 'mbf_pollinations_cooldown_until';
const COOLDOWN_MS = 45000;

function cooldownActive() {
  try {
    return Date.now() < Number(sessionStorage.getItem(COOLDOWN_KEY) || 0);
  } catch (err) {
    return false;
  }
}

function startCooldown() {
  try {
    sessionStorage.setItem(COOLDOWN_KEY, String(Date.now() + COOLDOWN_MS));
  } catch (err) {
    // Private mode can block sessionStorage. The in-memory local forge still runs.
  }
}

function extractJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : String(text);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return JSON.');
  return JSON.parse(raw.slice(start, end + 1));
}

function contentOf(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  const choice = payload.choices && payload.choices[0];
  if (choice && choice.message && typeof choice.message.content === 'string') return choice.message.content;
  if (typeof payload.content === 'string') return payload.content;
  if (payload.patterns) return JSON.stringify(payload);
  return '';
}

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

function coerceCell(id, value, local) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (DRUM_IDS.includes(id)) return 1;
  if (n <= 7) return Math.round(n);
  return midiToDegree(n, local.key, local.scale);
}

function coerceMix(mix, fallback) {
  if (!mix || typeof mix !== 'object') return fallback;
  const out = {};
  TRACK_IDS.forEach((id) => {
    const src = mix[id] || {};
    const base = fallback[id];
    out[id] = {
      ...base,
      volume: num(src.volume, base.volume, 0, 1),
      pan: num(src.pan, base.pan, -1, 1),
      eqLow: num(src.eqLow, base.eqLow, -12, 12),
      eqMid: num(src.eqMid, base.eqMid, -12, 12),
      eqHigh: num(src.eqHigh, base.eqHigh, -12, 12),
      reverb: num(src.reverb, base.reverb, 0, 1),
      delay: num(src.delay, base.delay, 0, 1),
      drive: num(src.drive, base.drive, 0, 1),
      mute: false,
      solo: false
    };
  });
  return out;
}

function coerceRemote(remote, local) {
  if (!remote || typeof remote !== 'object' || !remote.patterns) return null;
  const patterns = {};
  for (const id of TRACK_IDS) {
    const raw = remote.patterns[id];
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[\s,]+/) : null);
    if (!list || list.length < 8) return null;
    patterns[id] = Array(32).fill(0);
    for (let i = 0; i < 32 && i < list.length; i += 1) patterns[id][i] = coerceCell(id, list[i], local);
  }
  let swing = Number(remote.swing);
  if (!Number.isFinite(swing)) swing = local.swing;
  if (swing > 1) swing /= 100;
  const scale = local.explicitScale ? local.scale : (normalizeScale(remote.scale) || local.scale);
  return {
    bpm: local.explicitBpm ? local.bpm : num(remote.bpm, local.bpm, 60, 180),
    swing: clamp(swing, 0, 0.45),
    key: local.explicitKey ? local.key : (normalizeKey(remote.key) || local.key),
    scale: SCALES[scale] ? scale : local.scale,
    genre: local.genre,
    patterns,
    mix: coerceMix(remote.mix, local.mix),
    sidechain: num(remote.sidechain, local.sidechain, 0, 1),
    voice: local.voice,
    explicitBpm: local.explicitBpm,
    explicitKey: local.explicitKey,
    explicitScale: local.explicitScale
  };
}

async function forgeRemote(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  const instructions = [
    'You write one-bar drum machine patterns for a browser beat studio.',
    'Return JSON only, no markdown.',
    'Schema: {"bpm":140,"swing":0.08,"key":"F","scale":"minor","sidechain":0.6,',
    '"patterns":{"kick":[1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],"snare":[16 numbers of 0 or 1],',
    '"clap":[16], "hat":[16], "openhat":[16], "perc":[16],',
    '"bass":[16 numbers, scale degrees 0-7, 0 is rest], "chords":[16 scale degrees 0-7]},',
    '"mix":{"kick":{"volume":0.9,"pan":0,"eqLow":3,"eqMid":-2,"eqHigh":0,"reverb":0,"delay":0,"drive":0.1}}}',
    'Include a mix object for kick, snare, clap, hat, openhat, perc, bass, and chords.',
    'Volumes are 0 to 1. EQ is dB from -12 to 12. Sends and drive are 0 to 1.',
    'Keep the drums playable. Hats can be busy. 808 notes should follow the kick.',
    'scale is one of minor, major, dorian, pentatonic.'
  ].join(' ');
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'openai',
        jsonMode: true,
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: `Forge a beat for this description: ${prompt}` }
        ]
      })
    });
    if (response.status === 402 || response.status === 429) {
      startCooldown();
      const error = new Error('Pollinations is rate limited.');
      error.status = response.status;
      throw error;
    }
    if (!response.ok) throw new Error(`Pollinations returned ${response.status}.`);
    const payload = await response.json();
    const text = contentOf(payload);
    return extractJson(text);
  } finally {
    clearTimeout(timer);
  }
}

export async function forgeBeat(prompt) {
  const local = forgeLocal(prompt);
  if (cooldownActive()) {
    return {
      ...local,
      source: 'local',
      note: 'Pollinations is cooling down, so the local forge wrote this beat.'
    };
  }
  try {
    const remote = coerceRemote(await forgeRemote(prompt), local);
    if (!remote) {
      return { ...local, source: 'local', note: 'The model reply did not fit the grid, so the local forge wrote this beat.' };
    }
    return { ...remote, source: 'pollinations', note: 'Beat forged with Pollinations and locked to the tempo, key, and scale in your prompt.' };
  } catch (err) {
    return {
      ...local,
      source: 'local',
      note: 'Pollinations was unavailable, so the local forge wrote this beat.'
    };
  }
}

export function applyBeat(beat) {
  state.bpm = clamp(Math.round(beat.bpm), 60, 180);
  state.swing = clamp(beat.swing, 0, 0.45);
  state.key = beat.key;
  state.scale = SCALES[beat.scale] ? beat.scale : 'minor';
  state.genre = beat.genre || state.genre;
  state.sidechain = clamp(beat.sidechain ?? state.sidechain, 0, 1);
  state.patterns[state.bank] = beat.patterns;
  if (beat.mix) state.mixer = beat.mix;
  if (beat.voice) {
    state.voiceOptions = {
      ...state.voiceOptions,
      ...beat.voice,
      bass: { ...state.voiceOptions.bass, ...(beat.voice.bass || {}) },
      hat: { ...state.voiceOptions.hat, ...(beat.voice.hat || {}) },
      clap: { ...state.voiceOptions.clap, ...(beat.voice.clap || {}) },
      kick: { ...state.voiceOptions.kick, ...(beat.voice.kick || {}) }
    };
  }
  emit('project');
  toast(beat.note || 'Beat updated.');
}

export async function writeHook(topic) {
  const localLines = writeLocalHook(topic, state.key, state.scale);
  if (cooldownActive()) {
    return { lines: localLines, source: 'local', note: 'Local rhyme pad. Pollinations is cooling down.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'openai',
        jsonMode: true,
        messages: [
          {
            role: 'system',
            content: 'Write 4 original song bars. No artist names, no copyrighted lines, no slurs. Return JSON {"lines":["...","...","...","..."]} with each line under 90 characters.'
          },
          {
            role: 'user',
            content: `Topic: ${topic || 'a late-night session'}. Key: ${state.key} ${state.scale}. BPM: ${state.bpm}.`
          }
        ]
      })
    });
    if (response.status === 402 || response.status === 429) {
      startCooldown();
      throw new Error('rate limited');
    }
    if (!response.ok) throw new Error('bad status');
    const payload = await response.json();
    const parsed = extractJson(contentOf(payload));
    const lines = Array.isArray(parsed.lines) ? parsed.lines.map((line) => String(line).slice(0, 90)) : [];
    if (lines.length < 4) throw new Error('short');
    return { lines: lines.slice(0, 4), source: 'pollinations', note: 'Hook written with Pollinations.' };
  } catch (err) {
    return { lines: localLines, source: 'local', note: 'Local rhyme pad. Pollinations did not answer.' };
  } finally {
    clearTimeout(timer);
  }
}
