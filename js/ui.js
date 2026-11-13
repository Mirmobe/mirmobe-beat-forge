// Studio view: transport, grid, mixer, tracks, and the spectrum.

import { state, subscribe, toast, currentPattern, audible, duplicateBarIfEmpty } from './state.js';
import {
  DRUM_IDS,
  TRACK_IDS,
  TRACK_LABELS,
  KEYS,
  clamp,
  noteNameFromDegree,
  roman,
  scaleLength,
  trackColor
} from './theory.js';
import { getAnalyser, play, stop, syncMix, togglePlay } from './engine.js';
import { applyBeat, forgeBeat } from './ai.js';
import { analyzeMix, applyMix } from './mixassist.js';
import { addDemoTrack, importAudioFile, removeTrack, toggleRecording } from './tracks.js';
import { exportWav, loadProjectFile, saveProject } from './project.js';
import { requireFullAccess } from './paywall.js';

let toastTimer = 0;
let mixPlan = null;
const hotUntil = new Map();
const activity = Object.create(null);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOT_MS = reduceMotion ? 280 : 900;

export function initUi() {
  const keySelect = document.getElementById('keySelect');
  KEYS.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    keySelect.appendChild(option);
  });

  document.getElementById('playBtn').addEventListener('click', () => play());
  document.getElementById('stopBtn').addEventListener('click', () => stop());
  document.getElementById('bpmInput').addEventListener('change', (event) => {
    state.bpm = clamp(Math.round(Number(event.target.value) || state.bpm), 60, 180);
    syncMix();
    syncControls();
  });
  document.getElementById('swingInput').addEventListener('input', (event) => {
    state.swing = clamp(Number(event.target.value) || 0, 0, 0.45);
    document.getElementById('swingReadout').textContent = `${Math.round(state.swing * 100)}%`;
  });
  document.getElementById('tapTempoBtn').addEventListener('click', onTap);
  document.getElementById('countInToggle').addEventListener('change', (event) => {
    state.countIn = event.target.checked;
  });
  document.getElementById('metronomeToggle').addEventListener('change', (event) => {
    state.metronome = event.target.checked;
  });
  document.getElementById('stepsToggle').addEventListener('click', () => {
    state.steps = state.steps === 16 ? 32 : 16;
    if (state.steps === 32) duplicateBarIfEmpty();
    emitPattern();
  });
  document.getElementById('keySelect').addEventListener('change', (event) => {
    state.key = event.target.value;
    emitPattern();
  });
  document.getElementById('scaleSelect').addEventListener('change', (event) => {
    state.scale = event.target.value;
    emitPattern();
  });
  document.querySelectorAll('[data-bank]').forEach((button) => {
    button.addEventListener('click', () => {
      state.bank = button.dataset.bank;
      emitPattern();
    });
  });
  document.getElementById('projectName').addEventListener('change', (event) => {
    state.projectName = event.target.value.trim() || 'Untitled Forge';
  });

  document.getElementById('grid').addEventListener('click', onStepClick);
  document.getElementById('generateBeatBtn').addEventListener('click', onGenerate);
  document.getElementById('aiPrompt').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onGenerate();
  });
  document.getElementById('demoTrackBtn').addEventListener('click', () => addDemoTrack());
  document.getElementById('recordBtn').addEventListener('click', () => {
    toggleRecording().catch(() => toast('Recording stopped.'));
  });
  document.getElementById('audioFile').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      await importAudioFile(file);
    } catch (err) {
      toast('That audio file could not be read.');
    }
  });
  document.getElementById('importAudioBtn').addEventListener('click', () => {
    document.getElementById('audioFile').click();
  });

  document.getElementById('mixerStrips').addEventListener('input', onMixerInput);
  document.getElementById('mixerStrips').addEventListener('click', onMixerClick);
  document.getElementById('sidechainInput').addEventListener('input', (event) => {
    state.sidechain = Number(event.target.value);
    document.getElementById('sidechainReadout').textContent = `${Math.round(state.sidechain * 100)}%`;
  });
  document.getElementById('glueInput').addEventListener('input', (event) => {
    state.master.glue = Number(event.target.value);
    syncMix();
  });
  document.getElementById('masterGain').addEventListener('input', (event) => {
    state.master.gain = Number(event.target.value);
    syncMix();
  });

  document.getElementById('mixAssistBtn').addEventListener('click', onMixAssist);
  document.getElementById('applyMixBtn').addEventListener('click', () => {
    if (!mixPlan || !requireFullAccess()) return;
    applyMix(mixPlan);
    toast('Balance applied.');
  });

  document.getElementById('trackList').addEventListener('input', onTrackInput);
  document.getElementById('trackList').addEventListener('click', onTrackClick);

  document.getElementById('exportWavBtn').addEventListener('click', onExport);
  document.getElementById('saveProjectBtn').addEventListener('click', () => saveProject());
  document.getElementById('loadProjectBtn').addEventListener('click', () => document.getElementById('loadProject').click());
  document.getElementById('loadProject').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      await loadProjectFile(file);
    } catch (err) {
      toast(err.message || 'Could not load that project.');
    }
  });

  document.getElementById('tabMixer').addEventListener('click', () => showTab('mixer'));
  document.getElementById('tabAddons').addEventListener('click', () => showTab('addons'));

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    event.preventDefault();
    togglePlay();
  });

  subscribe((type, detail) => {
    if (type === 'step') {
      highlight(detail);
      if (state.playing && detail >= 0) {
        state.audioTracks.forEach((track) => {
          if (audible(track)) markHot(track.id, 0.66);
        });
      }
    }
    if (type === 'hit' && detail) markHot(detail.id, detail.velocity || 0.85);
    if (type === 'transport') paintTransport();
    if (type === 'pattern') {
      renderGrid();
      syncControls();
    }
    if (type === 'project') {
      syncControls();
      renderGrid();
      renderMixer();
      renderTracks();
    }
    if (type === 'tracks') {
      renderTracks();
      renderLamps();
    }
    if (type === 'toast' && detail) showToast(detail);
  });

  syncControls();
  renderGrid();
  renderMixer();
  renderTracks();
  renderLamps();
  paintTransport();
  resizeViz();
  window.addEventListener('resize', resizeViz);
  requestAnimationFrame(drawViz);
}

function emitPattern() {
  syncControls();
  renderGrid();
}

const taps = [];
function onTap() {
  const now = performance.now();
  const recent = taps.filter((time) => now - time < 2200);
  recent.push(now);
  taps.length = 0;
  taps.push(...recent);
  if (taps.length < 2) return;
  let total = 0;
  for (let i = 1; i < taps.length; i += 1) total += taps[i] - taps[i - 1];
  state.bpm = clamp(Math.round(60000 / (total / (taps.length - 1))), 60, 180);
  syncMix();
  syncControls();
}

function syncControls() {
  setNumber('bpmInput', state.bpm);
  setNumber('swingInput', state.swing);
  setNumber('sidechainInput', state.sidechain);
  setNumber('glueInput', state.master.glue);
  setNumber('masterGain', state.master.gain);
  const name = document.getElementById('projectName');
  if (name && document.activeElement !== name) name.value = state.projectName;
  const key = document.getElementById('keySelect');
  if (key) key.value = state.key;
  const scale = document.getElementById('scaleSelect');
  if (scale) scale.value = state.scale;
  const swing = document.getElementById('swingReadout');
  if (swing) swing.textContent = `${Math.round(state.swing * 100)}%`;
  const side = document.getElementById('sidechainReadout');
  if (side) side.textContent = `${Math.round(state.sidechain * 100)}%`;
  const steps = document.getElementById('stepsToggle');
  if (steps) steps.textContent = state.steps === 32 ? '32 steps' : '16 steps';
  document.getElementById('countInToggle').checked = state.countIn;
  document.getElementById('metronomeToggle').checked = state.metronome;
  document.querySelectorAll('[data-bank]').forEach((button) => {
    const on = button.dataset.bank === state.bank;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function setNumber(id, value) {
  const el = document.getElementById(id);
  if (el && document.activeElement !== el) el.value = String(value);
}

function paintTransport() {
  const play = document.getElementById('playBtn');
  const label = document.getElementById('transportState');
  const record = document.getElementById('recordBtn');
  play.setAttribute('aria-pressed', state.playing ? 'true' : 'false');
  play.classList.toggle('is-on', state.playing);
  label.textContent = state.playing ? 'Playing' : state.recording ? 'Recording' : 'Stopped';
  document.body.classList.toggle('is-playing', state.playing);
  document.body.classList.toggle('is-recording', state.recording);
  record.textContent = state.recording ? 'Stop rec' : 'Record';
  record.classList.toggle('is-recording', state.recording);
  record.setAttribute('aria-pressed', state.recording ? 'true' : 'false');
  if (!state.playing) highlight(-1);
  paintFlags();
}

function renderGrid() {
  const root = document.getElementById('grid');
  root.classList.toggle('is-32', state.steps === 32);
  root.replaceChildren();
  TRACK_IDS.forEach((id) => {
    const row = document.createElement('div');
    row.className = `track-row track-${id}`;
    row.dataset.track = id;
    const label = document.createElement('div');
    label.className = 'track-label';
    label.innerHTML = `<i class="swatch" aria-hidden="true"></i><span>${TRACK_LABELS[id]}</span><span class="lane-meter" aria-hidden="true"><span data-activity="${id}"></span></span>`;
    const steps = document.createElement('div');
    steps.className = 'steps';
    const line = currentPattern()[id];
    for (let i = 0; i < state.steps; i += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'step';
      if (i % 4 === 0) button.classList.add('is-bar');
      button.dataset.track = id;
      button.dataset.step = String(i);
      paintCell(button, id, line[i] || 0);
      steps.appendChild(button);
    }
    row.append(label, steps);
    root.appendChild(row);
  });
  paintFlags();
  if (state.currentStep >= 0) highlight(state.currentStep);
}

function paintCell(button, track, value) {
  button.classList.toggle('is-on', value > 0);
  button.setAttribute('aria-pressed', value > 0 ? 'true' : 'false');
  if (DRUM_IDS.includes(track)) {
    button.textContent = '';
    button.title = value ? 'On' : 'Off';
    return;
  }
  if (!value) {
    button.textContent = '·';
    button.title = 'Rest';
    return;
  }
  if (track === 'bass') {
    const name = noteNameFromDegree(value, state.key, state.scale, 1);
    button.textContent = name;
    button.title = name;
  } else {
    const numeral = roman(value, state.scale);
    button.textContent = numeral;
    button.title = numeral;
  }
}

function onStepClick(event) {
  const button = event.target.closest('.step');
  if (!button) return;
  const track = button.dataset.track;
  const step = Number(button.dataset.step);
  const line = currentPattern()[track];
  if (DRUM_IDS.includes(track)) {
    line[step] = line[step] ? 0 : 1;
  } else if (event.shiftKey) {
    line[step] = 0;
  } else {
    const span = scaleLength(state.scale);
    line[step] = (Number(line[step]) + 1) % (span + 1);
  }
  paintCell(button, track, line[step] || 0);
}

function highlight(step) {
  document.querySelectorAll('.step.is-playhead').forEach((el) => el.classList.remove('is-playhead', 'is-flash'));
  const readout = document.getElementById('stepReadout');
  if (step == null || step < 0) {
    if (readout) readout.textContent = '–';
    return;
  }
  document.querySelectorAll(`.step[data-step="${step}"]`).forEach((el) => {
    el.classList.add('is-playhead');
    if (el.classList.contains('is-on')) el.classList.add('is-flash');
  });
  if (readout) readout.textContent = `${Math.floor(step / 4) + 1}.${(step % 4) + 1}`;
}

function markHot(id, amount = 0.85) {
  if (!id) return;
  hotUntil.set(id, performance.now() + HOT_MS);
  activity[id] = Math.max(activity[id] || 0, amount);
  applyHot(id, true);
}

function applyHot(id, on) {
  document.querySelectorAll(`[data-track="${CSS.escape(id)}"], [data-channel="${CSS.escape(id)}"], [data-track-id="${CSS.escape(id)}"]`).forEach((el) => {
    if (el.classList.contains('step')) return;
    el.classList.toggle('is-hot', on);
  });
}

function refreshHot() {
  const now = performance.now();
  hotUntil.forEach((until, id) => {
    const on = now <= until;
    if (!on) hotUntil.delete(id);
    applyHot(id, on);
  });
  Object.keys(activity).forEach((id) => {
    activity[id] *= reduceMotion ? 0.7 : 0.93;
    const width = `${Math.max(0, Math.min(100, Math.round(activity[id] * 100)))}%`;
    document.querySelectorAll(`[data-activity="${CSS.escape(id)}"]`).forEach((bar) => {
      bar.style.width = width;
    });
  });
}

function paintFlags() {
  TRACK_IDS.forEach((id) => {
    const params = state.mixer[id];
    const heard = audible(params);
    document.querySelectorAll(`[data-track="${id}"], [data-channel="${id}"]`).forEach((el) => {
      if (el.classList.contains('step')) return;
      el.classList.toggle('is-muted', Boolean(params.mute));
      el.classList.toggle('is-solo', Boolean(params.solo));
      el.classList.toggle('is-silent', !heard);
    });
  });
  state.audioTracks.forEach((track) => {
    const el = document.querySelector(`.audio-track[data-track-id="${track.id}"]`);
    if (!el) return;
    el.classList.toggle('is-muted', Boolean(track.mute));
    el.classList.toggle('is-solo', Boolean(track.solo));
    el.classList.toggle('is-silent', !audible(track));
  });
}

function renderMixer() {
  const root = document.getElementById('mixerStrips');
  root.replaceChildren();
  TRACK_IDS.forEach((id) => root.appendChild(stripView(id, TRACK_LABELS[id], state.mixer[id])));
  paintFlags();
}

function renderLamps() {
  const row = document.getElementById('lampRow');
  if (!row) return;
  row.replaceChildren();
  const items = TRACK_IDS.map((id) => ({ id, label: TRACK_LABELS[id], cls: `track-${id}` }));
  state.audioTracks.forEach((track) => items.push({ id: track.id, label: track.name, cls: 'track-vocal' }));
  items.forEach((item) => {
    const lamp = document.createElement('span');
    lamp.className = `lamp ${item.cls}`;
    lamp.dataset.channel = item.id;
    lamp.textContent = item.label;
    row.appendChild(lamp);
  });
}

function stripView(id, label, params) {
  const row = document.createElement('div');
  row.className = `strip track-${id}`;
  row.dataset.channel = id;
  row.innerHTML = `
    <div class="strip-name"><i class="swatch" aria-hidden="true"></i><span>${label}</span><span class="lane-meter" aria-hidden="true"><span data-activity="${id}"></span></span></div>
    <button type="button" class="ms ${params.mute ? 'is-on' : ''}" data-flag="mute" aria-pressed="${params.mute}">M</button>
    <button type="button" class="ms ${params.solo ? 'is-on' : ''}" data-flag="solo" aria-pressed="${params.solo}">S</button>
    ${slider('Vol', 'volume', params.volume, 0, 1, 0.01, `${id}:volume`)}
    ${slider('Pan', 'pan', params.pan, -1, 1, 0.01, `${id}:pan`)}
    ${slider('Lo', 'eqLow', params.eqLow, -12, 12, 0.1, `${id}:eqLow`)}
    ${slider('Mid', 'eqMid', params.eqMid, -12, 12, 0.1, `${id}:eqMid`)}
    ${slider('Hi', 'eqHigh', params.eqHigh, -12, 12, 0.1, `${id}:eqHigh`)}
    ${slider('Rev', 'reverb', params.reverb, 0, 1, 0.01, `${id}:reverb`)}
    ${slider('Dly', 'delay', params.delay, 0, 1, 0.01, `${id}:delay`)}
    ${slider('Drv', 'drive', params.drive, 0, 1, 0.01, `${id}:drive`)}
  `;
  return row;
}

function slider(label, param, value, min, max, step, learn) {
  const learnAttr = learn ? ` data-learn="${learn}"` : '';
  return `<label class="fader">${label}<input type="range" data-param="${param}"${learnAttr} min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function onMixerInput(event) {
  const row = event.target.closest('[data-channel]');
  const param = event.target.dataset.param;
  if (!row || !param) return;
  state.mixer[row.dataset.channel][param] = Number(event.target.value);
  syncMix();
}

function onMixerClick(event) {
  const flag = event.target.dataset.flag;
  const row = event.target.closest('[data-channel]');
  if (!flag || !row) return;
  const params = state.mixer[row.dataset.channel];
  params[flag] = !params[flag];
  event.target.classList.toggle('is-on', params[flag]);
  event.target.setAttribute('aria-pressed', params[flag] ? 'true' : 'false');
  syncMix();
  paintFlags();
}

async function onGenerate() {
  const prompt = document.getElementById('aiPrompt').value.trim();
  const status = document.getElementById('aiStatus');
  const button = document.getElementById('generateBeatBtn');
  if (!prompt) {
    status.textContent = 'Describe a vibe, genre, tempo, or key.';
    return;
  }
  button.disabled = true;
  status.textContent = 'Forging…';
  try {
    const beat = await forgeBeat(prompt);
    applyBeat(beat);
    status.textContent = beat.note;
  } catch (err) {
    status.textContent = 'The forge could not write that beat.';
  } finally {
    button.disabled = false;
  }
}

function onMixAssist() {
  if (!requireFullAccess()) return;
  mixPlan = analyzeMix();
  const list = document.getElementById('mixSuggestions');
  list.replaceChildren();
  mixPlan.suggestions.forEach((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    list.appendChild(item);
  });
  document.getElementById('applyMixBtn').disabled = false;
}

function renderTracks() {
  const root = document.getElementById('trackList');
  root.replaceChildren();
  if (!state.audioTracks.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No audio tracks yet. Add the demo loop, import a file, or record over the beat.';
    root.appendChild(empty);
    renderLamps();
    return;
  }
  state.audioTracks.forEach((track) => {
    const card = document.createElement('article');
    card.className = 'audio-track track-vocal';
    card.dataset.trackId = track.id;
    const heard = audible(track);
    card.innerHTML = `
      <div class="audio-top">
        <i class="swatch" aria-hidden="true"></i>
        <strong>${escapeHtml(track.name)}</strong>
        <span class="lane-meter" aria-hidden="true"><span data-activity="${track.id}"></span></span>
        <span class="role">${track.role}</span>
        <button type="button" class="ms ${track.mute ? 'is-on' : ''}" data-flag="mute">M</button>
        <button type="button" class="ms ${track.solo ? 'is-on' : ''}" data-flag="solo">S</button>
        <button type="button" class="text-btn" data-remove>Remove</button>
      </div>
      <canvas class="wave" width="320" height="36" aria-hidden="true"></canvas>
      <div class="audio-controls">
        ${slider('Vol', 'volume', track.volume, 0, 1, 0.01, `${track.id}:volume`)}
        ${slider('Nudge', 'nudgeMs', track.nudgeMs, -150, 150, 1)}
        ${slider('Trim in', 'trimStart', track.trimStart, 0, Math.max(0.1, track.buffer.duration), 0.01)}
        ${slider('Trim out', 'trimEnd', track.trimEnd, 0, Math.max(0.1, track.buffer.duration), 0.01)}
      </div>
      <p class="hint">${heard ? 'In the mix' : 'Silent'} · nudge ${Math.round(track.nudgeMs)} ms</p>
    `;
    drawWaveform(card.querySelector('canvas'), track.buffer);
    root.appendChild(card);
  });
  paintFlags();
  renderLamps();
}

function onTrackInput(event) {
  const card = event.target.closest('[data-track-id]');
  const param = event.target.dataset.param;
  if (!card || !param) return;
  const track = state.audioTracks.find((item) => item.id === card.dataset.trackId);
  if (!track) return;
  track[param] = Number(event.target.value);
  syncMix();
  const hint = card.querySelector('.hint');
  if (hint && param === 'nudgeMs') hint.textContent = `${audible(track) ? 'In the mix' : 'Silent'} · nudge ${Math.round(track.nudgeMs)} ms`;
}

function onTrackClick(event) {
  const card = event.target.closest('[data-track-id]');
  if (!card) return;
  const track = state.audioTracks.find((item) => item.id === card.dataset.trackId);
  if (!track) return;
  if (event.target.dataset.remove != null) {
    removeTrack(track.id);
    return;
  }
  const flag = event.target.dataset.flag;
  if (!flag) return;
  track[flag] = !track[flag];
  syncMix();
  renderTracks();
}

async function onExport() {
  if (!requireFullAccess()) return;
  const button = document.getElementById('exportWavBtn');
  const status = document.getElementById('bounceStatus');
  const bars = Number(document.getElementById('exportBars').value) || 4;
  button.disabled = true;
  status.textContent = 'Rendering WAV…';
  try {
    const summary = await exportWav(bars);
    status.textContent = `WAV ready · ${summary.bytes.toLocaleString()} bytes · peak ${summary.peak.toFixed(2)}`;
  } catch (err) {
    status.textContent = 'The bounce did not finish.';
    toast('Export failed. Try a shorter length.');
  } finally {
    button.disabled = false;
  }
}

function showTab(name) {
  const mixer = document.getElementById('mixerPanel');
  const addons = document.getElementById('addonPanel');
  const tabMixer = document.getElementById('tabMixer');
  const tabAddons = document.getElementById('tabAddons');
  const showMixer = name === 'mixer';
  mixer.hidden = !showMixer;
  addons.hidden = showMixer;
  tabMixer.setAttribute('aria-selected', showMixer ? 'true' : 'false');
  tabAddons.setAttribute('aria-selected', showMixer ? 'false' : 'true');
  tabMixer.classList.toggle('is-on', showMixer);
  tabAddons.classList.toggle('is-on', !showMixer);
}

function showToast(message) {
  const el = document.getElementById('toast');
  el.hidden = false;
  el.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 3400);
}

function drawWaveform(canvas, buffer) {
  const width = canvas.clientWidth || 320;
  const height = 36;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#ff2d55');
  gradient.addColorStop(0.28, '#ffc43d');
  gradient.addColorStop(0.55, '#3ad6ff');
  gradient.addColorStop(1, '#ff3db8');
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1.4;
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / width));
  ctx.beginPath();
  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * step;
    const hop = Math.max(1, Math.floor(step / 24));
    for (let i = 0; i < step; i += hop) {
      const value = data[start + i] || 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    ctx.moveTo(x + 0.5, (1 - max) * 0.5 * height);
    ctx.lineTo(x + 0.5, (1 - min) * 0.5 * height);
  }
  ctx.stroke();
}

const viz = () => document.getElementById('viz');
let vizFreq = null;
let vizWave = null;

function resizeViz() {
  const canvas = viz();
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth || 320;
  const height = 84;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
}

function drawViz() {
  requestAnimationFrame(drawViz);
  refreshHot();
  const canvas = viz();
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#07060c';
  ctx.fillRect(0, 0, width, height);
  const analyser = getAnalyser();
  const bars = 48;
  const gap = 2;
  const barWidth = (width - gap * bars) / bars;
  const playing = state.playing || state.recording;
  if (analyser) {
    if (!vizFreq || vizFreq.length !== analyser.frequencyBinCount) {
      vizFreq = new Uint8Array(analyser.frequencyBinCount);
      vizWave = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteFrequencyData(vizFreq);
    analyser.getByteTimeDomainData(vizWave);
  }
  for (let i = 0; i < bars; i += 1) {
    const hue = Math.round((i / bars) * 310);
    let mag = 0.08 + 0.06 * Math.sin((performance.now() / 420) + i * 0.45);
    if (analyser && vizFreq) {
      const index = Math.floor((i / bars) ** 1.35 * (vizFreq.length * 0.7));
      mag = Math.max(mag * 0.35, vizFreq[index] / 255);
    }
    const barHeight = Math.max(2, mag * (height - 22));
    ctx.fillStyle = `hsl(${hue} 92% ${playing ? 62 : 48}%)`;
    ctx.shadowColor = `hsl(${hue} 100% 60%)`;
    ctx.shadowBlur = reduceMotion || !playing ? 0 : 8;
    ctx.fillRect(i * (barWidth + gap) + 2, height - 8 - barHeight, Math.max(1, barWidth), barHeight);
  }
  ctx.shadowBlur = 0;
  const lamps = [...TRACK_IDS, ...state.audioTracks.map((track) => track.id)];
  lamps.forEach((id, index) => {
    const level = activity[id] || 0;
    const x = 16 + index * Math.min(36, (width - 20) / Math.max(1, lamps.length));
    const y = 14;
    ctx.beginPath();
    ctx.strokeStyle = trackColor(id);
    ctx.globalAlpha = 0.35 + level * 0.65;
    ctx.lineWidth = 2;
    ctx.arc(x, y, 5 + (reduceMotion ? 0 : level * 7), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
  if (analyser && vizWave) {
    ctx.beginPath();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.78)';
    for (let i = 0; i < vizWave.length; i += 8) {
      const x = (i / vizWave.length) * width;
      const y = (vizWave[i] / 255) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
