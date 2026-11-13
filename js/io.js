// Studio Gear & I/O — audio interface routing and Web MIDI.
// Microphone and MIDI permission are requested only from a click.

import { state, emit, subscribe, toast, currentPattern } from './state.js';
import { DRUM_IDS, clamp, midiToDegree } from './theory.js';
import { ensureContext, play, stop, syncMix, triggerLive } from './engine.js';

const SIM_INPUTS = [
  { deviceId: 'sim-26c-in-12', kind: 'audioinput', label: 'PreSonus Studio 26c (Mic/Inst 1-2)' }
];
const SIM_OUTPUTS = [
  { deviceId: 'sim-26c-out-main', kind: 'audiooutput', label: 'PreSonus Studio 26c (Main Out 1-2)' },
  { deviceId: 'sim-26c-out-line', kind: 'audiooutput', label: 'PreSonus Studio 26c (Line Out 3-4)' }
];
const SIM_MIDI_IN = [
  { id: 'sim-26c-midi-in', name: 'PreSonus Studio 26c MIDI In' },
  { id: 'sim-atom', name: 'PreSonus ATOM' },
  { id: 'sim-iac', name: 'IAC Driver Bus 1' },
  { id: 'sim-studio-one', name: 'Studio One Virtual MIDI' }
];
const SIM_MIDI_OUT = [
  { id: 'sim-26c-midi-out', name: 'PreSonus Studio 26c MIDI Out' },
  { id: 'sim-loopmidi', name: 'loopMIDI / DAW Bus' }
];

const DRUM_NOTES = {
  35: 'kick',
  36: 'kick',
  38: 'snare',
  40: 'snare',
  39: 'clap',
  42: 'hat',
  44: 'hat',
  46: 'openhat',
  37: 'perc',
  56: 'perc',
  75: 'perc'
};

const CHANNEL_LABEL = {
  stereo: 'Stereo (Ch 1–2)',
  input1: 'Input 1 (Mono Left / Mic)',
  input2: 'Input 2 (Mono Right / Line-Inst)'
};

let started = false;
let realDevices = [];
let midiAccess = null;
let learnArmed = false;
let learnTarget = '';
let monitor = null;
let meterAnalyser = null;
let meterFrame = 0;
let clipLatched = false;
let clockTimer = 0;
let clockTicks = 0;
let boundInputs = new Set();

export function deviceFamily(label) {
  const text = String(label || '').toLowerCase();
  if (text.includes('presonus') && (text.includes('26c') || text.includes('studio 26'))) return '26c';
  if (text.includes('presonus')) return 'presonus';
  if (/focusrite|scarlett|universal audio|apollo|motu|rme|audient|ssl|behringer|arturia|steinberg|clarett|komplete audio/.test(text)) {
    return 'interface';
  }
  return '';
}

export function isSimulatedInput(id = state.io.inputId) {
  return Boolean(state.io.simulate && (!id || String(id).startsWith('sim-')));
}

export function recordConstraints() {
  const audio = {
    echoCancellation: !state.io.directMode,
    noiseSuppression: !state.io.directMode,
    autoGainControl: !state.io.directMode
  };
  if (state.io.channel !== 'stereo') audio.channelCount = 2;
  const id = state.io.inputId;
  if (id && !String(id).startsWith('sim-')) audio.deviceId = { exact: id };
  return { audio };
}

function listedDevices() {
  const inputs = realDevices.filter((device) => device.kind === 'audioinput');
  const outputs = realDevices.filter((device) => device.kind === 'audiooutput');
  if (!state.io.simulate) return { inputs, outputs };
  return {
    inputs: [...SIM_INPUTS, ...inputs],
    outputs: [...SIM_OUTPUTS, ...outputs]
  };
}

function setBadges(text, kind) {
  document.querySelectorAll('[data-gear-badge]').forEach((el) => {
    el.textContent = text;
    el.classList.toggle('is-presonus', kind === '26c' || kind === 'presonus');
    el.classList.toggle('is-interface', kind === 'interface');
  });
}

function describeGear() {
  const { inputs, outputs } = listedDevices();
  const labels = [...inputs, ...outputs].map((device) => device.label || '');
  const family = labels.map(deviceFamily).find((kind) => kind === '26c')
    || labels.map(deviceFamily).find((kind) => kind === 'presonus')
    || labels.map(deviceFamily).find((kind) => kind === 'interface')
    || '';
  const callout = document.getElementById('ioCallout');
  if (family === '26c') {
    setBadges('PreSonus 26c Ready', '26c');
    if (callout) {
      callout.classList.add('is-on');
      callout.textContent = 'PreSonus Studio 26c detected. Route Mic/Inst 1–2, Main Out 1–2, or Line Out 3–4. Direct mode leaves the XMAX-L preamps alone.';
    }
  } else if (family === 'presonus') {
    setBadges('PreSonus detected', 'presonus');
    if (callout) {
      callout.classList.add('is-on');
      callout.textContent = 'A PreSonus interface is connected. Pick its input and output below.';
    }
  } else if (family === 'interface') {
    setBadges('Interface detected', 'interface');
    if (callout) {
      callout.classList.remove('is-on');
      callout.textContent = 'A USB audio interface is connected. Choose its input, channel, and output.';
    }
  } else if (inputs.length || outputs.length) {
    setBadges('Audio devices ready', '');
    if (callout) {
      callout.classList.remove('is-on');
      callout.textContent = 'Browser audio devices are listed. Plug in a Studio 26c to highlight it, or keep simulating one.';
    }
  } else {
    setBadges('No interface yet', '');
    if (callout) {
      callout.classList.remove('is-on');
      callout.textContent = 'Plug in a Studio 26c, or turn on Simulate PreSonus 26c to inspect channel, preamp, output, and MIDI controls.';
    }
  }
  paintRouteSummary();
}

function paintRouteSummary() {
  const summary = document.getElementById('routeSummary');
  if (!summary) return;
  const input = labelFor(state.io.inputId, 'audioinput') || 'Default input';
  const output = labelFor(state.io.outputId, 'audiooutput') || 'System output';
  const raw = state.io.directMode
    ? 'Direct interface mode: echo cancellation, noise suppression, and auto gain are off'
    : 'Browser voice processing is on';
  summary.textContent = `${raw}. ${CHANNEL_LABEL[state.io.channel] || CHANNEL_LABEL.stereo}. ${input} → ${output}.`;
}

function labelFor(id, kind) {
  if (!id) return '';
  const pool = kind === 'audiooutput' ? listedDevices().outputs : listedDevices().inputs;
  const found = pool.find((device) => device.deviceId === id);
  return found ? (found.label || found.deviceId) : '';
}

function fillDeviceSelect(select, devices, placeholder) {
  if (!select) return;
  const current = select.value;
  select.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = placeholder;
  select.appendChild(blank);
  devices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    const family = deviceFamily(device.label);
    const prefix = family === '26c' ? '26c · ' : family === 'presonus' ? 'PreSonus · ' : family === 'interface' ? 'Interface · ' : '';
    option.textContent = `${prefix}${device.label || 'Unnamed device'}`;
    if (family) option.dataset.family = family;
    select.appendChild(option);
  });
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function renderDeviceSelects() {
  const { inputs, outputs } = listedDevices();
  fillDeviceSelect(document.getElementById('ioInput'), inputs, 'System default input');
  fillDeviceSelect(document.getElementById('ioOutput'), outputs, 'System default output');
  const input = document.getElementById('ioInput');
  const output = document.getElementById('ioOutput');
  if (input && [...input.options].some((option) => option.value === state.io.inputId)) input.value = state.io.inputId;
  if (output && [...output.options].some((option) => option.value === state.io.outputId)) output.value = state.io.outputId;
  describeGear();
}

function sinkSupportNote() {
  const note = document.getElementById('sinkNote');
  if (!note) return;
  const supported = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  note.textContent = supported
    ? 'This browser can route the studio to a chosen output with setSinkId, including Studio 26c Main Out 1–2 or Line Out 3–4. Simulated outputs stay inside the page.'
    : 'This browser picks the output in the operating system (Safari and Firefox do this). Choose the Studio 26c there. The menu above still remembers which port you mean.';
}

export async function refreshDevices({ prompt = false } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    toast('This browser cannot list audio devices.');
    renderDeviceSelects();
    return;
  }
  try {
    if (prompt && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    }
    realDevices = await navigator.mediaDevices.enumerateDevices();
  } catch (err) {
    toast('Microphone permission was blocked, so device names may be hidden.');
  }
  renderDeviceSelects();
}

function stopClock() {
  if (clockTimer) window.clearTimeout(clockTimer);
  clockTimer = 0;
}

function sendBytes(bytes, silentClock = false) {
  const id = state.io.midiOutId;
  const port = midiAccess && [...midiAccess.outputs.values()].find((item) => item.id === id);
  if (port) {
    try { port.send(bytes); } catch (err) { /* port closed */ }
  }
  if (bytes[0] === 0xF8) {
    clockTicks += 1;
    const readout = document.getElementById('midiClockReadout');
    if (readout) readout.textContent = state.io.clockOut && state.playing ? `Clock ${clockTicks}` : 'Clock idle';
    return;
  }
  if (!silentClock) pushMonitor(`Out ${bytes.map((byte) => byte.toString(16).toUpperCase()).join(' ')}`);
}

function syncClock() {
  stopClock();
  if (!state.io.clockOut || !state.playing) {
    if (state.io.clockOut) sendBytes([0xFC]);
    const readout = document.getElementById('midiClockReadout');
    if (readout && !state.playing) readout.textContent = 'Clock idle';
    return;
  }
  clockTicks = 0;
  sendBytes([0xFA]);
  const tick = () => {
    if (!state.playing || !state.io.clockOut) return;
    sendBytes([0xF8]);
    clockTimer = window.setTimeout(tick, 60000 / Math.max(1, state.bpm) / 24);
  };
  tick();
}

function pushMonitor(line) {
  const log = document.getElementById('midiMonitor');
  if (!log) return;
  const row = document.createElement('li');
  row.textContent = line;
  log.prepend(row);
  while (log.children.length > 8) log.lastChild.remove();
}

function renderMaps() {
  const list = document.getElementById('midiMapList');
  if (!list) return;
  list.replaceChildren();
  if (!state.io.mappings.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No learned controls yet.';
    list.appendChild(empty);
    return;
  }
  state.io.mappings.forEach((map) => {
    const item = document.createElement('li');
    const control = map.cc != null ? `CC ${map.cc}` : `Note ${map.note}`;
    item.textContent = `${control} → ${map.target}`;
    list.appendChild(item);
  });
}

function setLearnStatus(text) {
  const status = document.getElementById('midiLearnStatus');
  if (status) status.textContent = text;
  const button = document.getElementById('midiLearnBtn');
  if (button) {
    button.classList.toggle('is-on', learnArmed);
    button.setAttribute('aria-pressed', learnArmed ? 'true' : 'false');
  }
}

function applyTarget(target, norm, raw) {
  if (target === 'play') {
    if (raw > 0 && !state.playing) play();
    return;
  }
  if (target === 'stop') {
    if (raw > 0) stop();
    return;
  }
  if (target === 'record') {
    if (raw > 0) import('./tracks.js').then((mod) => mod.toggleRecording()).catch(() => {});
    return;
  }
  if (target === 'master') {
    state.master.gain = clamp(norm, 0, 1);
    const el = document.getElementById('masterGain');
    if (el) el.value = String(state.master.gain);
    syncMix();
    return;
  }
  if (target === 'bpm') {
    state.bpm = clamp(Math.round(60 + norm * 120), 60, 180);
    const el = document.getElementById('bpmInput');
    if (el) el.value = String(state.bpm);
    syncMix();
    return;
  }
  const [id, param] = String(target).split(':');
  if (!id || !param) return;
  const audio = state.audioTracks.find((track) => track.id === id);
  const mixer = audio || state.mixer[id];
  if (!mixer) return;
  if (param === 'volume') mixer.volume = clamp(norm, 0, 1);
  else if (param === 'pan') mixer.pan = clamp(norm * 2 - 1, -1, 1);
  else if (param.startsWith('eq')) mixer[param] = clamp(norm * 24 - 12, -12, 12);
  else mixer[param] = clamp(norm, 0, 1);
  const input = document.querySelector(`[data-channel="${id}"] input[data-param="${param}"], [data-track-id="${id}"] input[data-param="${param}"]`);
  if (input) input.value = String(mixer[param]);
  syncMix();
}

function rememberMap(entry) {
  state.io.mappings = state.io.mappings.filter((map) => map.target !== entry.target);
  state.io.mappings.push(entry);
  learnArmed = false;
  learnTarget = '';
  setLearnStatus(`Mapped ${entry.cc != null ? `CC ${entry.cc}` : `note ${entry.note}`} to ${entry.target}.`);
  renderMaps();
  toast(`MIDI mapped to ${entry.target}.`);
}

function writeStep(id, midi) {
  const pattern = currentPattern();
  if (!pattern[id]) return;
  let step = state.currentStep;
  if (step < 0) {
    step = state.io.writeHead % state.steps;
    state.io.writeHead = (state.io.writeHead + 1) % state.steps;
  }
  if (DRUM_IDS.includes(id)) pattern[id][step] = 1;
  else pattern[id][step] = midiToDegree(midi, state.key, state.scale);
  emit('pattern');
}

function routeNote(note, velocity) {
  const drum = DRUM_NOTES[note];
  const target = state.io.midiTarget;
  let id = 'chords';
  if (target === 'drums') id = drum || 'perc';
  else if (target === 'bass') id = 'bass';
  else if (target === 'chords') id = 'chords';
  else if (drum) id = drum;
  else if (note < 48) id = 'bass';
  triggerLive(id, velocity / 127, note);
  if (state.io.stepRecord) writeStep(id, note);
}

export function handleMidiBytes(bytes, portName = 'Studio 26c') {
  const [status = 0, data1 = 0, data2 = 0] = bytes;
  if (status === 0xFA) {
    pushMonitor(`Start · ${portName}`);
    if (!state.playing) play();
    return;
  }
  if (status === 0xFC) {
    pushMonitor(`Stop · ${portName}`);
    stop();
    return;
  }
  if (status === 0xF8) return;
  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  if (command === 0x90 && data2 > 0) {
    pushMonitor(`Note On · Ch ${channel} · ${data1} · vel ${data2} · ${portName}`);
    if (learnArmed && learnTarget) {
      rememberMap({ note: data1, target: learnTarget });
      return;
    }
    const mapped = state.io.mappings.find((map) => map.note === data1);
    if (mapped && ['play', 'stop', 'record'].includes(mapped.target)) {
      applyTarget(mapped.target, data2 / 127, data2);
      return;
    }
    routeNote(data1, data2);
    return;
  }
  if (command === 0x80 || (command === 0x90 && data2 === 0)) {
    pushMonitor(`Note Off · Ch ${channel} · ${data1} · ${portName}`);
    return;
  }
  if (command === 0xB0) {
    pushMonitor(`CC ${data1} · ${data2} · Ch ${channel} · ${portName}`);
    if (learnArmed && learnTarget) {
      const target = learnTarget;
      rememberMap({ cc: data1, target });
      applyTarget(target, data2 / 127, data2);
      return;
    }
    const mapped = state.io.mappings.find((map) => map.cc === data1);
    if (mapped) applyTarget(mapped.target, data2 / 127, data2);
  }
}

function bindMidiInputs() {
  if (!midiAccess) return;
  midiAccess.inputs.forEach((port) => {
    if (boundInputs.has(port.id)) return;
    boundInputs.add(port.id);
    port.onmidimessage = (event) => handleMidiBytes(Array.from(event.data), port.name || 'MIDI In');
  });
  renderMidiPorts();
}

function renderMidiPorts() {
  const inputList = document.getElementById('midiInputs');
  const outputSelect = document.getElementById('midiOutput');
  const inputs = [];
  const outputs = [];
  if (midiAccess) {
    midiAccess.inputs.forEach((port) => inputs.push(port));
    midiAccess.outputs.forEach((port) => outputs.push(port));
  }
  if (state.io.simulate) {
    SIM_MIDI_IN.forEach((port) => inputs.push(port));
    SIM_MIDI_OUT.forEach((port) => outputs.push(port));
  }
  if (inputList) {
    inputList.replaceChildren();
    if (!inputs.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No MIDI inputs yet.';
      inputList.appendChild(empty);
    }
    inputs.forEach((port) => {
      const item = document.createElement('li');
      const family = deviceFamily(port.name);
      item.textContent = family === '26c' ? `26c · ${port.name}` : port.name;
      if (family) item.dataset.family = family;
      inputList.appendChild(item);
    });
  }
  if (outputSelect) {
    const current = state.io.midiOutId;
    outputSelect.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'No MIDI output';
    outputSelect.appendChild(blank);
    outputs.forEach((port) => {
      const option = document.createElement('option');
      option.value = port.id;
      option.textContent = port.name;
      outputSelect.appendChild(option);
    });
    if ([...outputSelect.options].some((option) => option.value === current)) outputSelect.value = current;
  }
  const note = document.getElementById('midiSupportNote');
  if (note) {
    if (!navigator.requestMIDIAccess) {
      note.textContent = 'Web MIDI is not available in this browser. Chrome and Edge on HTTPS or localhost can talk to the Studio 26c MIDI ports, ATOM, FaderPort, and virtual buses from Studio One, Ableton, FL Studio, Logic, IAC Driver, or loopMIDI. Simulate mode still exercises the panel.';
    } else if (!midiAccess && !state.io.simulate) {
      note.textContent = 'Click Connect MIDI to allow access. Nothing is requested on page load. If no hardware is plugged in, the list stays empty until you simulate a 26c.';
    } else if (midiAccess && midiAccess.inputs.size === 0 && !state.io.simulate) {
      note.textContent = 'MIDI is allowed, and no ports are connected. Plug in a controller or enable a virtual bus, then connect again.';
    } else {
      note.textContent = 'Incoming notes play drums, the 808, or the chord synth. Start and Stop follow MIDI realtime. Clock out sends 24 PPQN plus Start/Stop.';
    }
  }
}

export async function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    renderMidiPorts();
    toast('This browser has no Web MIDI. Use Simulate PreSonus 26c to try the panel.');
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    midiAccess.onstatechange = () => {
      bindMidiInputs();
    };
    bindMidiInputs();
    toast('MIDI ports are connected.');
  } catch (err) {
    toast('MIDI permission was blocked.');
    renderMidiPorts();
  }
}

function paintMeter(peak) {
  const safe = Number.isFinite(peak) ? peak : 0;
  const db = safe < 0.00001 ? -Infinity : 20 * Math.log10(safe);
  const readout = document.getElementById('dbReadout');
  if (readout) readout.textContent = db === -Infinity ? '-∞' : db.toFixed(1);
  const width = db === -Infinity ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  const fill = document.getElementById('ioMeterFill');
  const bar = document.getElementById('inputMeterBar');
  if (fill) fill.style.width = `${width}%`;
  if (bar) bar.style.width = `${width}%`;
  if (safe >= 0.98) clipLatched = true;
  const clip = document.getElementById('clipLight');
  if (clip) clip.classList.toggle('is-hot', clipLatched);
}

function meterLoop() {
  if (!meterAnalyser) {
    meterFrame = 0;
    return;
  }
  const bins = new Float32Array(meterAnalyser.fftSize);
  meterAnalyser.getFloatTimeDomainData(bins);
  let peak = 0;
  for (let i = 0; i < bins.length; i += 1) {
    const value = Math.abs(bins[i]);
    if (value > peak) peak = value;
  }
  paintMeter(peak);
  meterFrame = requestAnimationFrame(meterLoop);
}

function attachAnalyser(analyser) {
  meterAnalyser = analyser;
  if (!meterFrame) meterFrame = requestAnimationFrame(meterLoop);
}

export function stopInputRoute() {
  if (monitor) {
    try { if (monitor.osc) monitor.osc.stop(); } catch (err) { /* already stopped */ }
    try { if (monitor.lfo) monitor.lfo.stop(); } catch (err) { /* already stopped */ }
    try { if (monitor.source) monitor.source.disconnect(); } catch (err) { /* already gone */ }
    if (monitor.rawStream) monitor.rawStream.getTracks().forEach((track) => track.stop());
    monitor = null;
  }
  meterAnalyser = null;
  if (meterFrame) cancelAnimationFrame(meterFrame);
  meterFrame = 0;
  const button = document.getElementById('monitorInputBtn');
  if (button) {
    button.classList.remove('is-on');
    button.setAttribute('aria-pressed', 'false');
    button.textContent = 'Monitor input';
  }
}

export async function openInput() {
  stopInputRoute();
  if (isSimulatedInput()) {
    const context = ensureContext();
    const osc = context.createOscillator();
    const lfo = context.createOscillator();
    const lfoGain = context.createGain();
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    osc.type = 'sawtooth';
    osc.frequency.value = state.io.channel === 'input2' ? 440 : state.io.channel === 'input1' ? 196 : 294;
    lfo.frequency.value = 2.4;
    lfoGain.gain.value = 0.08;
    gain.gain.value = 0.32 * state.io.inputGain;
    analyser.fftSize = 1024;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    osc.connect(gain);
    gain.connect(analyser);
    osc.start();
    lfo.start();
    monitor = { osc, lfo, gain, analyser, sim: true };
    attachAnalyser(analyser);
    return { simulated: true, stream: null, stop: stopInputRoute };
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('This browser has no microphone API.');
  }
  const rawStream = await navigator.mediaDevices.getUserMedia(recordConstraints());
  const context = ensureContext();
  const source = context.createMediaStreamSource(rawStream);
  const gain = context.createGain();
  gain.gain.value = state.io.inputGain;
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const dest = context.createMediaStreamDestination();
  if (state.io.channel === 'stereo') {
    source.connect(gain);
  } else {
    const splitter = context.createChannelSplitter(2);
    source.connect(splitter);
    const settings = rawStream.getAudioTracks()[0] && rawStream.getAudioTracks()[0].getSettings ? rawStream.getAudioTracks()[0].getSettings() : {};
    if ((settings.channelCount || 1) < 2 && state.io.channel === 'input2') {
      toast('This input is mono, so Input 2 carries the same signal as Input 1.');
    }
    splitter.connect(gain, state.io.channel === 'input2' ? 1 : 0);
  }
  gain.connect(analyser);
  gain.connect(dest);
  monitor = { source, gain, analyser, rawStream };
  attachAnalyser(analyser);
  return { simulated: false, stream: dest.stream, stop: stopInputRoute };
}

export function setInputGain(value) {
  state.io.inputGain = clamp(Number(value) || 0, 0, 2);
  if (monitor && monitor.gain && !monitor.sim) monitor.gain.gain.value = state.io.inputGain;
  if (monitor && monitor.sim && monitor.gain) monitor.gain.gain.value = 0.32 * state.io.inputGain;
  const readout = document.getElementById('inputGainReadout');
  if (readout) readout.textContent = `${state.io.inputGain.toFixed(2)}×`;
}

async function applySink(deviceId) {
  state.io.outputId = deviceId;
  paintRouteSummary();
  if (!deviceId || String(deviceId).startsWith('sim-')) {
    if (deviceId) toast('Simulated output stays in the browser.');
    return;
  }
  const context = ensureContext();
  if (typeof context.setSinkId !== 'function') {
    toast('Pick this output in the system sound settings.');
    return;
  }
  try {
    await context.setSinkId(deviceId);
    toast('Output routed.');
  } catch (err) {
    toast('That output could not be selected.');
  }
}

function setSimulate(on) {
  state.io.simulate = on;
  const button = document.getElementById('simulate26c');
  if (button) {
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  document.querySelectorAll('#sendTestNote, #sendTestCc').forEach((el) => {
    el.disabled = !on;
  });
  if (on) {
    state.io.directMode = true;
    state.io.inputId = 'sim-26c-in-12';
    state.io.outputId = state.io.outputId && !String(state.io.outputId).startsWith('sim-') ? state.io.outputId : 'sim-26c-out-main';
    state.io.midiOutId = state.io.midiOutId || 'sim-26c-midi-out';
    const direct = document.getElementById('directMode');
    if (direct) direct.checked = true;
  } else if (String(state.io.inputId).startsWith('sim-')) {
    state.io.inputId = '';
    if (String(state.io.outputId).startsWith('sim-')) state.io.outputId = '';
    if (String(state.io.midiOutId).startsWith('sim-')) state.io.midiOutId = '';
    stopInputRoute();
  }
  renderDeviceSelects();
  renderMidiPorts();
}

function armLearn(target) {
  learnArmed = true;
  learnTarget = target || '';
  setLearnStatus(learnTarget
    ? `Learning ${learnTarget}. Send a knob, fader, or pad from the controller.`
    : 'Learning. Click a target, then move a control.');
}

export function openIoPanel() {
  const overlay = document.getElementById('ioOverlay');
  if (!overlay) return;
  overlay.hidden = false;
  sinkSupportNote();
  renderDeviceSelects();
  renderMidiPorts();
  renderMaps();
}

export function closeIoPanel() {
  const overlay = document.getElementById('ioOverlay');
  if (overlay) overlay.hidden = true;
}

export function initIo() {
  if (started) return;
  started = true;
  sinkSupportNote();
  renderDeviceSelects();
  renderMidiPorts();
  renderMaps();
  setLearnStatus('Click MIDI Learn, then a target, then move a control.');
  document.querySelectorAll('#sendTestNote, #sendTestCc').forEach((el) => { el.disabled = true; });

  document.getElementById('openIoBtn')?.addEventListener('click', () => openIoPanel());
  document.getElementById('openIoFromTracks')?.addEventListener('click', () => openIoPanel());
  document.getElementById('closeIoBtn')?.addEventListener('click', () => closeIoPanel());
  document.getElementById('ioOverlay')?.addEventListener('click', (event) => {
    if (event.target.id === 'ioOverlay') closeIoPanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeIoPanel();
  });

  document.getElementById('refreshDevicesBtn')?.addEventListener('click', () => {
    refreshDevices({ prompt: false });
  });
  document.getElementById('allowDevicesBtn')?.addEventListener('click', () => {
    refreshDevices({ prompt: true });
  });
  document.getElementById('simulate26c')?.addEventListener('click', () => setSimulate(!state.io.simulate));
  document.getElementById('ioInput')?.addEventListener('change', (event) => {
    state.io.inputId = event.target.value;
    paintRouteSummary();
    describeGear();
  });
  document.getElementById('ioOutput')?.addEventListener('change', (event) => {
    applySink(event.target.value);
  });
  document.getElementById('ioChannel')?.addEventListener('change', (event) => {
    state.io.channel = event.target.value;
    if (monitor && monitor.sim && monitor.osc) {
      monitor.osc.frequency.value = state.io.channel === 'input2' ? 440 : state.io.channel === 'input1' ? 196 : 294;
    }
    paintRouteSummary();
  });
  document.getElementById('directMode')?.addEventListener('change', (event) => {
    state.io.directMode = event.target.checked;
    paintRouteSummary();
  });
  document.getElementById('inputGain')?.addEventListener('input', (event) => setInputGain(event.target.value));
  document.getElementById('monitorInputBtn')?.addEventListener('click', async () => {
    if (monitor) {
      stopInputRoute();
      paintMeter(0);
      return;
    }
    const button = document.getElementById('monitorInputBtn');
    try {
      await openInput();
      if (button) {
        button.classList.add('is-on');
        button.setAttribute('aria-pressed', 'true');
        button.textContent = 'Stop monitor';
      }
    } catch (err) {
      toast(err.message || 'The input could not be opened.');
    }
  });
  document.getElementById('resetClipBtn')?.addEventListener('click', () => {
    clipLatched = false;
    const clip = document.getElementById('clipLight');
    if (clip) clip.classList.remove('is-hot');
  });
  document.getElementById('connectMidiBtn')?.addEventListener('click', () => connectMidi());
  document.getElementById('midiOutput')?.addEventListener('change', (event) => {
    state.io.midiOutId = event.target.value;
  });
  document.getElementById('midiTarget')?.addEventListener('change', (event) => {
    state.io.midiTarget = event.target.value;
  });
  document.getElementById('stepRecordToggle')?.addEventListener('change', (event) => {
    state.io.stepRecord = event.target.checked;
  });
  document.getElementById('clockOutToggle')?.addEventListener('change', (event) => {
    state.io.clockOut = event.target.checked;
    syncClock();
  });
  document.getElementById('midiLearnBtn')?.addEventListener('click', () => {
    if (learnArmed) {
      learnArmed = false;
      learnTarget = '';
      setLearnStatus('MIDI Learn cancelled.');
      return;
    }
    armLearn('');
  });
  document.getElementById('sendTestNote')?.addEventListener('click', () => {
    handleMidiBytes([0x90, 36, 110], 'PreSonus Studio 26c MIDI In');
  });
  document.getElementById('sendTestCc')?.addEventListener('click', () => {
    handleMidiBytes([0xB0, 7, 100], 'PreSonus Studio 26c MIDI In');
  });

  document.addEventListener('click', (event) => {
    if (!learnArmed) return;
    const target = event.target.closest('[data-learn]');
    if (!target || target.id === 'midiLearnBtn') return;
    event.preventDefault();
    armLearn(target.dataset.learn);
  }, true);

  subscribe((type) => {
    if (type === 'transport') syncClock();
  });
}
