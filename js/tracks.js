// Microphone takes, file import, and the built-in demo loop.

import { state, emit, subscribe, toast } from './state.js';
import { degreeToMidi, midiToFreq, scaleLength } from './theory.js';
import { ensureContext, ensureTrackStrip, play } from './engine.js';
import { isSimulatedInput, openInput, stopInputRoute } from './io.js';

let trackSerial = 1;
let takeSerial = 1;
let recorder = null;
let recordStream = null;
let recordChunks = [];

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

function releaseStream() {
  stopInputRoute();
  recordStream = null;
}

function simulatedTakeBuffer() {
  const rate = 44100;
  const seconds = Math.max(0.6, (state.steps / 4) * (60 / state.bpm));
  const channels = state.io.channel === 'stereo' ? 2 : 1;
  const buffer = new AudioBuffer({ length: Math.floor(seconds * rate), numberOfChannels: channels, sampleRate: rate });
  const freq = state.io.channel === 'input2' ? 330 : state.io.channel === 'input1' ? 196 : 247;
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const t = i / rate;
      const env = Math.min(1, t / 0.02) * (0.65 + 0.35 * Math.sin(2 * Math.PI * 2 * t));
      data[i] = Math.sin(2 * Math.PI * freq * t) * 0.28 * env;
    }
  }
  return buffer;
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
  if (isSimulatedInput()) {
    const latency = Number(document.getElementById('latencyMs')?.value || 0);
    const channel = state.io.channel === 'input2' ? 'Input 2' : state.io.channel === 'input1' ? 'Input 1' : 'Ch 1-2';
    const track = addBufferTrack({
      name: `26c ${channel} sim take`,
      buffer: simulatedTakeBuffer(),
      role: 'vocal',
      nudgeMs: latency,
      followTempo: false
    });
    if (track) toast(`Simulated Studio 26c take on ${channel}. No hardware stream was opened.`);
    return;
  }
  let opened = null;
  try {
    opened = await openInput();
  } catch (err) {
    toast('Microphone permission was blocked. The demo loop still works.');
    state.recording = false;
    emit('transport');
    return;
  }
  if (!opened.stream) {
    toast('The input did not return a stream. Use the demo loop instead.');
    if (opened.stop) opened.stop();
    return;
  }
  recordStream = opened.stream;
  if (state.countIn && !state.playing) {
    const off = subscribe((type) => {
      if (type === 'transport' && !state.playing && !state.recording) {
        off();
        releaseStream();
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
