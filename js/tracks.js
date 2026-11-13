// Microphone takes, file import, and the built-in demo loop.

import { state, emit, subscribe, toast } from './state.js';
import { degreeToMidi, midiToFreq, scaleLength } from './theory.js';
import { ensureContext, ensureTrackStrip, play } from './engine.js';

let trackSerial = 1;
let takeSerial = 1;
let recorder = null;
let recordStream = null;
let recordChunks = [];
let meterAnalyser = null;
let meterFrame = 0;
let meterSource = null;

export function makeDemoBuffer() {
  const rate = 44100;
  const bars = state.steps / 16;
  const seconds = bars * (60 / state.bpm);
  const length = Math.max(1, Math.floor(seconds * rate));
  const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: rate });
  const data = buffer.getChannelData(0);
  const lead = Math.floor(rate * 0.035);
  const degrees = [1, 5, 3, 4, 1, 6, 5, 3];
  const notes = Math.max(4, Math.round(bars * 4));
  const slice = (length - lead) / notes;
  for (let i = 0; i < notes; i += 1) {
    const degree = degrees[i % degrees.length];
    const span = scaleLength(state.scale);
    const midi = degreeToMidi(((degree - 1) % span) + 1, state.key, state.scale, 4);
    writeTone(data, rate, lead + i * slice, slice * 0.86, midiToFreq(midi), i % 2 === 0 ? 0.42 : 0.28);
  }
  fadeEdges(data, rate);
  return buffer;
}

function writeTone(data, rate, startSample, duration, freq, amp) {
  const start = Math.max(0, Math.floor(startSample));
  const end = Math.min(data.length, Math.floor(start + duration));
  for (let i = start; i < end; i += 1) {
    const t = (i - start) / rate;
    const env = Math.min(1, t / 0.03) * Math.exp(-t * 3.1);
    const vib = freq * (1 + 0.007 * Math.sin(2 * Math.PI * 5.2 * t));
    let sample = 0;
    const partials = [1, 0.62, 0.38, 0.22, 0.12, 0.07];
    for (let p = 0; p < partials.length; p += 1) {
      sample += partials[p] * Math.sin(2 * Math.PI * vib * (p + 1) * t);
    }
    data[i] += sample * env * amp * 0.34;
  }
}

function fadeEdges(data, rate) {
  const fade = Math.floor(rate * 0.008);
  for (let i = 0; i < fade && i < data.length; i += 1) {
    const gain = i / fade;
    data[i] *= gain;
    data[data.length - 1 - i] *= gain;
  }
}

export function addBufferTrack({ name, buffer, role, nudgeMs, followTempo }) {
  if (state.audioTracks.length >= 8) {
    toast('The mixer holds eight audio tracks.');
    return null;
  }
  const track = {
    id: `audio-${trackSerial}`,
    name,
    role: role || 'audio',
    buffer,
    nudgeMs: nudgeMs || 0,
    trimStart: 0,
    trimEnd: 0,
    mute: false,
    solo: false,
    volume: 0.82,
    pan: 0,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    reverb: role === 'vocal' ? 0.1 : 0.04,
    delay: 0,
    drive: 0,
    followTempo: Boolean(followTempo)
  };
  trackSerial += 1;
  state.audioTracks.push(track);
  ensureTrackStrip(track.id);
  emit('tracks');
  return track;
}

export function addDemoTrack() {
  const track = addBufferTrack({
    name: 'Demo vocal loop',
    buffer: makeDemoBuffer(),
    role: 'vocal',
    followTempo: true
  });
  if (track) toast('Demo vocal loop is on the grid. No microphone needed.');
  return track;
}

export function removeTrack(id) {
  state.audioTracks = state.audioTracks.filter((track) => track.id !== id);
  emit('tracks');
}

export async function importAudioFile(file) {
  const context = ensureContext();
  const bytes = await file.arrayBuffer();
  const buffer = await context.decodeAudioData(bytes.slice(0));
  const track = addBufferTrack({
    name: file.name.replace(/\.[^.]+$/, '') || 'Import',
    buffer,
    role: 'audio',
    followTempo: false
  });
  if (track) toast(`Imported ${track.name}.`);
  return track;
}

function startMeter() {
  const bar = document.getElementById('inputMeterBar');
  const loop = () => {
    if (!meterAnalyser) return;
    const bins = new Uint8Array(meterAnalyser.fftSize);
    meterAnalyser.getByteTimeDomainData(bins);
    let peak = 0;
    for (let i = 0; i < bins.length; i += 1) {
      const value = Math.abs(bins[i] - 128) / 128;
      if (value > peak) peak = value;
    }
    if (bar) bar.style.width = `${Math.min(100, Math.round(peak * 140))}%`;
    meterFrame = requestAnimationFrame(loop);
  };
  meterFrame = requestAnimationFrame(loop);
}

function stopMeter() {
  if (meterFrame) cancelAnimationFrame(meterFrame);
  meterFrame = 0;
  meterAnalyser = null;
  if (meterSource) {
    try { meterSource.disconnect(); } catch (err) { /* already gone */ }
  }
  meterSource = null;
  const bar = document.getElementById('inputMeterBar');
  if (bar) bar.style.width = '0%';
}

function releaseStream() {
  if (recordStream) recordStream.getTracks().forEach((track) => track.stop());
  recordStream = null;
}

async function beginRecorder() {
  if (!recordStream) return;
  recordChunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
  recorder = mime ? new MediaRecorder(recordStream, { mimeType: mime }) : new MediaRecorder(recordStream);
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) recordChunks.push(event.data);
  };
  recorder.onstop = async () => {
    const blob = new Blob(recordChunks, { type: recorder.mimeType || 'audio/webm' });
    releaseStream();
    stopMeter();
    state.recording = false;
    emit('transport');
    try {
      const context = ensureContext();
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const latency = Number(document.getElementById('latencyMs')?.value || 0);
      const track = addBufferTrack({
        name: `Take ${takeSerial}`,
        buffer: decoded,
        role: 'vocal',
        nudgeMs: latency,
        followTempo: false
      });
      takeSerial += 1;
      if (track) toast(`Take saved with ${latency} ms of latency offset.`);
    } catch (err) {
      toast('The take could not be decoded.');
    }
  };
  recorder.start();
  state.recording = true;
  emit('transport');
}

export async function toggleRecording() {
  if (state.recording && recorder && recorder.state === 'recording') {
    recorder.stop();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('This browser has no microphone API. Use the demo loop instead.');
    return;
  }
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  } catch (err) {
    toast('Microphone permission was blocked. The demo loop still works.');
    state.recording = false;
    emit('transport');
    return;
  }
  const context = ensureContext();
  meterSource = context.createMediaStreamSource(recordStream);
  meterAnalyser = context.createAnalyser();
  meterAnalyser.fftSize = 256;
  meterSource.connect(meterAnalyser);
  startMeter();
  if (state.countIn && !state.playing) {
    const off = subscribe((type) => {
      if (type === 'transport' && !state.playing && !state.recording) {
        off();
        releaseStream();
        stopMeter();
        return;
      }
      if (type === 'step' && state.playing) {
        off();
        beginRecorder();
      }
    });
    play();
    toast('Count-in running. Recording starts on the downbeat.');
    return;
  }
  await beginRecorder();
  if (!state.playing) play();
}
