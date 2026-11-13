// Web Audio graph, step scheduler, voice synthesis, and offline bounce.

import { state, emit, audible } from './state.js';
import { DRUM_IDS, chordTones, degreeToMidi, midiToFreq, TRACK_IDS } from './theory.js';
import { matchRate } from './wav.js';

const LOOKAHEAD = 0.16;
const SCHEDULE_MS = 25;

let ctx = null;
let graph = null;
let timer = 0;
let nextStepTime = 0;
let stepIndex = 0;
let uiTimers = [];
let activeSources = [];
let glideMem = { bassFreq: 0, bassTime: -10 };

export function getContext() {
  return ctx;
}

export function getAnalyser() {
  return graph ? graph.analyser : null;
}

export function secondsPerStep() {
  return 60 / state.bpm / 4;
}

export function loopDuration() {
  return state.steps * secondsPerStep();
}

function stepAdvance(step) {
  const sps = secondsPerStep();
  const amount = Math.min(0.45, Math.max(0, state.swing));
  return step % 2 === 0 ? sps * (1 + amount) : sps * (1 - amount);
}

function makeCurve(amount) {
  const samples = 256;
  const curve = new Float32Array(samples);
  const k = 1 + Math.max(0, amount) * 28;
  const norm = Math.tanh(k);
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / norm;
  }
  return curve;
}

function makeImpulse(context, seconds, decay) {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return impulse;
}

function noiseBuffer(context) {
  if (context.__forgeNoise) return context.__forgeNoise;
  const length = Math.floor(context.sampleRate);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  context.__forgeNoise = buffer;
  return buffer;
}

function createStrip(context) {
  const input = context.createGain();
  const eqLow = context.createBiquadFilter();
  eqLow.type = 'lowshelf';
  eqLow.frequency.value = 120;
  const eqMid = context.createBiquadFilter();
  eqMid.type = 'peaking';
  eqMid.frequency.value = 1100;
  eqMid.Q.value = 0.85;
  const eqHigh = context.createBiquadFilter();
  eqHigh.type = 'highshelf';
  eqHigh.frequency.value = 6800;
  const shaper = context.createWaveShaper();
  shaper.curve = makeCurve(0);
  shaper.oversample = '2x';
  const vca = context.createGain();
  const duck = context.createGain();
  duck.gain.value = 1;
  const panner = context.createStereoPanner();
  const revSend = context.createGain();
  const delSend = context.createGain();
  revSend.gain.value = 0;
  delSend.gain.value = 0;
  input.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(shaper);
  shaper.connect(vca);
  vca.connect(duck);
  duck.connect(panner);
  vca.connect(revSend);
  vca.connect(delSend);
  return { input, eqLow, eqMid, eqHigh, shaper, vca, duck, panner, revSend, delSend };
}

function createGraph(context, ids) {
  const masterIn = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const limiter = context.createDynamicsCompressor();
  const out = context.createGain();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.78;

  const reverb = context.createConvolver();
  reverb.buffer = makeImpulse(context, 1.55, 2.6);
  const reverbGain = context.createGain();
  reverbGain.gain.value = 0.85;

  const delay = context.createDelay(2);
  const delayFilter = context.createBiquadFilter();
  delayFilter.type = 'lowpass';
  delayFilter.frequency.value = 2600;
  const delayFb = context.createGain();
  delayFb.gain.value = 0.34;
  const delayGain = context.createGain();
  delayGain.gain.value = 0.8;
  delay.connect(delayFilter);
  delayFilter.connect(delayFb);
  delayFb.connect(delay);
  delayFilter.connect(delayGain);
  delayGain.connect(masterIn);
  reverb.connect(reverbGain);
  reverbGain.connect(masterIn);

  compressor.threshold.value = -16;
  compressor.knee.value = 10;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.012;
  compressor.release.value = 0.2;
  limiter.threshold.value = -1.8;
  limiter.knee.value = 0;
  limiter.ratio.value = 18;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;

  masterIn.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(out);
  out.connect(analyser);
  out.connect(context.destination);

  const strips = new Map();
  ids.forEach((id) => {
    const strip = createStrip(context);
    strip.panner.connect(masterIn);
    strip.revSend.connect(reverb);
    strip.delSend.connect(delay);
    strips.set(id, strip);
  });
  return { masterIn, compressor, limiter, out, analyser, delay, reverbIn: reverb, strips };
}

function setNow(param, value, context) {
  const time = context.currentTime;
  param.cancelScheduledValues(time);
  param.setValueAtTime(value, time);
}

function applyStrip(strip, params, context, canHear) {
  if (!strip || !params) return;
  const volume = canHear ? params.volume : 0;
  setNow(strip.vca.gain, volume, context);
  setNow(strip.panner.pan, params.pan || 0, context);
  setNow(strip.eqLow.gain, params.eqLow || 0, context);
  setNow(strip.eqMid.gain, params.eqMid || 0, context);
  setNow(strip.eqHigh.gain, params.eqHigh || 0, context);
  setNow(strip.revSend.gain, (params.reverb || 0) * Math.max(0.15, volume), context);
  setNow(strip.delSend.gain, (params.delay || 0) * Math.max(0.15, volume), context);
  strip.shaper.curve = makeCurve(params.drive || 0);
}

function applyMaster(context, target) {
  const glue = state.master.glue;
  setNow(target.compressor.threshold, -24 + glue * 12, context);
  setNow(target.compressor.ratio, 1.4 + glue * 4.5, context);
  setNow(target.out.gain, state.master.gain, context);
  const dotted = Math.min(1.4, (60 / state.bpm) * 0.375);
  setNow(target.delay.delayTime, dotted, context);
}

function applyAll(context, target) {
  TRACK_IDS.forEach((id) => {
    applyStrip(target.strips.get(id), state.mixer[id], context, audible(state.mixer[id]));
  });
  state.audioTracks.forEach((track) => {
    applyStrip(target.strips.get(track.id), track, context, audible(track));
  });
  applyMaster(context, target);
}

export function channelIds() {
  return [...TRACK_IDS, ...state.audioTracks.map((track) => track.id)];
}

export function ensureContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!ctx) {
    ctx = new AudioCtx();
    graph = createGraph(ctx, channelIds());
    applyAll(ctx, graph);
  }
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  return ctx;
}

export function ensureTrackStrip(id) {
  attachStrip(id);
}

export function resetGraph() {
  stop();
  if (ctx) ctx.close().catch(() => {});
  ctx = null;
  graph = null;
}

export function syncMix() {
  if (!ctx || !graph) return;
  applyAll(ctx, graph);
}

function trackSource(node) {
  activeSources.push(node);
  node.onended = () => {
    activeSources = activeSources.filter((item) => item !== node);
  };
}

function burstNoise(context, dest, time, duration, gainValue, filterType, freq) {
  const src = context.createBufferSource();
  src.buffer = noiseBuffer(context);
  const filter = context.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(Math.max(40, freq), time);
  const gain = context.createGain();
  gain.gain.setValueAtTime(Math.max(0.0001, gainValue), time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  const offset = Math.random() * 0.4;
  src.start(time, offset, duration);
  src.stop(time + duration + 0.02);
  trackSource(src);
}

function triggerKick(context, dest, time, velocity, options) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'sine';
  const startFreq = options.variant === 'trap' ? 176 : 142;
  osc.frequency.setValueAtTime(startFreq, time);
  osc.frequency.exponentialRampToValueAtTime(46, time + 0.085);
  gain.gain.setValueAtTime(velocity, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.38);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.42);
  trackSource(osc);

  const click = context.createOscillator();
  const clickGain = context.createGain();
  click.type = 'square';
  click.frequency.setValueAtTime(980, time);
  clickGain.gain.setValueAtTime(velocity * 0.16, time);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.018);
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 900;
  click.connect(clickGain);
  clickGain.connect(highpass);
  highpass.connect(dest);
  click.start(time);
  click.stop(time + 0.03);
  trackSource(click);
}

function triggerSnare(context, dest, time, velocity) {
  const body = context.createOscillator();
  const bodyGain = context.createGain();
  body.type = 'triangle';
  body.frequency.setValueAtTime(188, time);
  body.frequency.exponentialRampToValueAtTime(140, time + 0.12);
  bodyGain.gain.setValueAtTime(velocity * 0.55, time);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  body.connect(bodyGain);
  bodyGain.connect(dest);
  body.start(time);
  body.stop(time + 0.2);
  trackSource(body);
  burstNoise(context, dest, time, 0.18, velocity * 0.7, 'highpass', 1800);
}

function triggerClap(context, dest, time, velocity, options) {
  const gaps = options.variant === 'trap' ? [0, 0.012, 0.024, 0.05] : [0, 0.011, 0.022];
  gaps.forEach((gap, index) => {
    const decay = index === gaps.length - 1 ? (options.variant === 'trap' ? 0.22 : 0.14) : 0.04;
    burstNoise(context, dest, time + gap, decay, velocity * (0.45 + index * 0.12), 'bandpass', 1500);
  });
}

function triggerHat(context, dest, time, velocity, open) {
  burstNoise(context, dest, time, open ? 0.28 : 0.045, velocity * (open ? 0.42 : 0.34), 'highpass', open ? 6200 : 7600);
}

function triggerPerc(context, dest, time, velocity) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(540 + (Math.random() * 80), time);
  osc.frequency.exponentialRampToValueAtTime(180, time + 0.08);
  gain.gain.setValueAtTime(velocity * 0.45, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.14);
  trackSource(osc);
  burstNoise(context, dest, time, 0.05, velocity * 0.2, 'bandpass', 900);
}

function triggerBass(context, dest, time, midi, velocity, options, mem) {
  const freq = Math.max(28, midiToFreq(midi));
  const decay = Math.max(0.12, options.decay || 0.55);
  const canGlide = options.glide && mem.bassFreq > 30 && time - mem.bassTime < 0.5;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'sine';
  const startFreq = canGlide ? mem.bassFreq : freq;
  osc.frequency.setValueAtTime(Math.max(28, startFreq), time);
  if (canGlide) osc.frequency.exponentialRampToValueAtTime(freq, time + 0.09);
  if (options.pitchDrop) {
    const dropped = Math.max(24, freq * (2 ** (-options.pitchDrop / 12)));
    osc.frequency.exponentialRampToValueAtTime(dropped, time + decay);
  }
  gain.gain.setValueAtTime(velocity * 0.85, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + decay + 0.05);
  trackSource(osc);

  const sub = context.createOscillator();
  const subGain = context.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(Math.max(20, freq / 2), time);
  subGain.gain.setValueAtTime(velocity * 0.32, time);
  subGain.gain.exponentialRampToValueAtTime(0.0001, time + decay * 0.9);
  sub.connect(subGain);
  subGain.connect(dest);
  sub.start(time);
  sub.stop(time + decay + 0.05);
  trackSource(sub);
  mem.bassFreq = freq;
  mem.bassTime = time;
}

function triggerChord(context, dest, time, tones, velocity) {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(380, time);
  filter.frequency.exponentialRampToValueAtTime(2400, time + 0.07);
  filter.frequency.exponentialRampToValueAtTime(720, time + 0.55);
  filter.Q.value = 0.7;
  const gain = context.createGain();
  gain.gain.setValueAtTime(velocity * 0.2, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.85);
  filter.connect(gain);
  gain.connect(dest);
  tones.forEach((midi) => {
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(midiToFreq(midi), time);
    const voice = context.createGain();
    voice.gain.value = 0.34;
    osc.connect(voice);
    voice.connect(filter);
    osc.start(time);
    osc.stop(time + 0.9);
    trackSource(osc);
  });
}

function click(context, dest, time, accent) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(accent ? 1760 : 1180, time);
  gain.gain.setValueAtTime(accent ? 0.18 : 0.09, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.05);
  trackSource(osc);
}

function duckAt(strip, time, depth) {
  if (!strip || depth <= 0) return;
  const gain = strip.duck.gain;
  const dip = Math.max(0.12, 1 - depth);
  gain.cancelScheduledValues(time);
  gain.setValueAtTime(1, time);
  gain.linearRampToValueAtTime(dip, time + 0.016);
  gain.linearRampToValueAtTime(1, time + 0.2);
}

function sidechain(target, time) {
  const depth = state.sidechain || 0;
  if (depth <= 0) return;
  duckAt(target.strips.get('bass'), time, depth);
  duckAt(target.strips.get('chords'), time, depth * 0.45);
  state.audioTracks.forEach((track) => {
    if (track.role === 'vocal' || track.role === 'audio') {
      duckAt(target.strips.get(track.id), time, depth * 0.7);
    }
  });
}

function scheduleTracks(context, target, loopTime) {
  const loopDur = loopDuration();
  state.audioTracks.forEach((track) => {
    if (!track.buffer || !audible(track)) return;
    const strip = target.strips.get(track.id);
    if (!strip) return;
    const buffer = matchRate(track.buffer, context.sampleRate);
    const trimStart = Math.max(0, track.trimStart || 0);
    const trimEnd = Math.max(0, track.trimEnd || 0);
    let offset = trimStart;
    let when = loopTime + (track.nudgeMs || 0) / 1000;
    if (context.currentTime && when < context.currentTime + 0.01) {
      const late = context.currentTime + 0.01 - when;
      offset += late;
      when = context.currentTime + 0.01;
    }
    const available = buffer.duration - offset - trimEnd;
    if (available <= 0.02 || offset >= buffer.duration) return;
    const src = context.createBufferSource();
    src.buffer = buffer;
    const playDur = available;
    let rate = 1;
    if (track.followTempo) {
      rate = Math.min(4, Math.max(0.25, available / Math.max(0.05, loopDur)));
      src.playbackRate.setValueAtTime(rate, Math.max(0, when));
    }
    const outDur = playDur / rate;
    const fade = context.createGain();
    const attackEnd = when + Math.min(0.012, outDur * 0.2);
    const releaseStart = Math.max(attackEnd + 0.004, when + outDur - 0.018);
    fade.gain.setValueAtTime(0.0001, when);
    fade.gain.linearRampToValueAtTime(1, attackEnd);
    fade.gain.setValueAtTime(1, releaseStart);
    fade.gain.linearRampToValueAtTime(0.0001, when + Math.max(outDur, releaseStart + 0.004));
    src.connect(fade);
    fade.connect(strip.input);
    try {
      src.start(Math.max(0, when), offset, playDur);
      trackSource(src);
    } catch (err) {
      // A take that no longer fits the loop is skipped for this pass.
    }
  });
}

function fireStep(context, target, step, time, mem, live) {
  const pattern = state.patterns[state.bank];
  const hatOpts = state.voiceOptions.hat || {};
  DRUM_IDS.forEach((id) => {
    const cell = pattern[id][step] || 0;
    if (!cell || !audible(state.mixer[id])) return;
    const dest = target.strips.get(id).input;
    const options = state.voiceOptions[id] || {};
    if (id === 'kick') {
      triggerKick(context, dest, time, 0.95, options);
      sidechain(target, time);
    } else if (id === 'snare') triggerSnare(context, dest, time, 0.8);
    else if (id === 'clap') triggerClap(context, dest, time, 0.7, options);
    else if (id === 'hat') {
      triggerHat(context, dest, time, 0.55, false);
      if (hatOpts.rolls && step % 4 === 3) {
        triggerHat(context, dest, time + secondsPerStep() * 0.5, 0.36, false);
      }
    } else if (id === 'openhat') triggerHat(context, dest, time, 0.5, true);
    else if (id === 'perc') triggerPerc(context, dest, time, 0.6);
  });

  const bassCell = pattern.bass[step] || 0;
  if (bassCell && audible(state.mixer.bass)) {
    const midi = degreeToMidi(bassCell, state.key, state.scale, 1);
    triggerBass(context, target.strips.get('bass').input, time, midi, 0.9, state.voiceOptions.bass || {}, mem);
  }

  const chordCell = pattern.chords[step] || 0;
  if (chordCell && audible(state.mixer.chords)) {
    const tones = chordTones(chordCell, state.key, state.scale, 3);
    triggerChord(context, target.strips.get('chords').input, time, tones, 0.8);
  }

  if (step === 0) scheduleTracks(context, target, time);
  if (live && state.metronome && step % 4 === 0) {
    click(context, target.masterIn, time, step === 0);
  }
  if (live) {
    const delayMs = Math.max(0, (time - context.currentTime) * 1000);
    const handle = window.setTimeout(() => {
      state.currentStep = step;
      emit('step', step);
    }, delayMs);
    uiTimers.push(handle);
  }
}

function scheduler() {
  if (!state.playing || !ctx || !graph) return;
  const horizon = ctx.currentTime + LOOKAHEAD;
  let guard = 0;
  while (nextStepTime < horizon && guard < 64) {
    fireStep(ctx, graph, stepIndex, nextStepTime, glideMem, true);
    nextStepTime += stepAdvance(stepIndex);
    stepIndex = (stepIndex + 1) % state.steps;
    guard += 1;
  }
  timer = window.setTimeout(scheduler, SCHEDULE_MS);
}

export function play() {
  const context = ensureContext();
  if (state.playing) return;
  state.playing = true;
  stepIndex = 0;
  glideMem = { bassFreq: 0, bassTime: -10 };
  const start = context.currentTime + 0.08;
  if (state.countIn) {
    const beat = 60 / state.bpm;
    for (let i = 0; i < 4; i += 1) click(context, graph.masterIn, start + i * beat, i === 0);
    nextStepTime = start + beat * 4;
  } else {
    nextStepTime = start;
  }
  emit('transport');
  scheduler();
}

export function stop() {
  state.playing = false;
  state.currentStep = -1;
  if (timer) window.clearTimeout(timer);
  timer = 0;
  uiTimers.forEach((handle) => window.clearTimeout(handle));
  uiTimers = [];
  activeSources.forEach((node) => {
    try { node.stop(); } catch (err) { /* already stopped */ }
  });
  activeSources = [];
  emit('transport');
  emit('step', -1);
}

export function togglePlay() {
  if (state.playing) stop();
  else play();
}

export async function renderOffline(loops = 4) {
  const rate = 44100;
  const bars = Math.max(1, Math.min(8, loops));
  const total = 0.05 + bars * loopDuration() + 1.45;
  const offline = new OfflineAudioContext(2, Math.ceil(total * rate), rate);
  const bounce = createGraph(offline, channelIds());
  // Connect new track sends to the bounce reverb. createGraph already did.
  applyAll(offline, bounce);
  const mem = { bassFreq: 0, bassTime: -10 };
  const savedSources = activeSources;
  activeSources = [];
  const loopDur = loopDuration();
  for (let loop = 0; loop < bars; loop += 1) {
    let time = 0.05 + loop * loopDur;
    for (let step = 0; step < state.steps; step += 1) {
      fireStep(offline, bounce, step, time, mem, false);
      time += stepAdvance(step);
    }
  }
  activeSources = savedSources;
  return offline.startRendering();
}

export function attachStrip(id) {
  if (!ctx || !graph || graph.strips.has(id)) {
    if (ctx && graph) applyAll(ctx, graph);
    return;
  }
  const strip = createStrip(ctx);
  strip.panner.connect(graph.masterIn);
  strip.revSend.connect(graph.reverbIn);
  strip.delSend.connect(graph.delay);
  graph.strips.set(id, strip);
  applyAll(ctx, graph);
}
