// Scales, prompt parsing, and the deterministic beat forge.
// Same prompt always returns the same local beat.

export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  pentatonic: [0, 3, 5, 7, 10]
};

export const DRUM_IDS = ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc'];
export const MELODIC_IDS = ['bass', 'chords'];
export const TRACK_IDS = [...DRUM_IDS, ...MELODIC_IDS];

export const TRACK_LABELS = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  hat: 'Closed Hat',
  openhat: 'Open Hat',
  perc: 'Perc',
  bass: '808 / Sub',
  chords: 'Chords'
};

const MAJOR_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const MINOR_ROMAN = ['i', 'ii', 'III', 'iv', 'v', 'VI', 'VII'];

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function hashString(str) {
  let h = 2166136261;
  const text = String(str);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scaleLength(scale) {
  return (SCALES[scale] || SCALES.minor).length;
}

export function degreeToMidi(degree, key, scale, octave) {
  const intervals = SCALES[scale] || SCALES.minor;
  const deg = Math.max(1, Math.min(intervals.length, degree | 0));
  const keyIndex = Math.max(0, KEYS.indexOf(key));
  return 12 * (octave + 1) + keyIndex + intervals[deg - 1];
}

export function chordTones(degree, key, scale, octave) {
  const intervals = SCALES[scale] || SCALES.minor;
  const len = intervals.length;
  const rootIdx = (Math.max(1, degree) - 1) % len;
  const keyIndex = Math.max(0, KEYS.indexOf(key));
  return [0, 2, 4].map((off) => {
    const idx = rootIdx + off;
    const oct = Math.floor(idx / len);
    return 12 * (octave + oct + 1) + keyIndex + intervals[idx % len];
  });
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteNameFromDegree(degree, key, scale, octave) {
  if (!degree) return '';
  const midi = degreeToMidi(degree, key, scale, octave);
  return KEYS[((midi % 12) + 12) % 12];
}

export function roman(degree, scale) {
  if (!degree) return '';
  const row = scale === 'major' ? MAJOR_ROMAN : MINOR_ROMAN;
  return row[(degree - 1) % row.length];
}

export function midiToDegree(midi, key, scale) {
  const intervals = SCALES[scale] || SCALES.minor;
  const keyIndex = Math.max(0, KEYS.indexOf(key));
  const pc = ((Math.round(midi) % 12) - keyIndex + 12) % 12;
  let best = 1;
  let bestDist = 99;
  intervals.forEach((interval, index) => {
    const dist = Math.min(Math.abs(interval - pc), 12 - Math.abs(interval - pc));
    if (dist < bestDist) {
      bestDist = dist;
      best = index + 1;
    }
  });
  return best;
}

function row(pattern) {
  const out = Array(32).fill(0);
  const text = pattern.padEnd(16, '.').slice(0, 32);
  for (let i = 0; i < text.length; i += 1) {
    out[i] = text[i] === 'x' || text[i] === 'X' ? 1 : 0;
  }
  return out;
}

function degrees(pattern) {
  const out = Array(32).fill(0);
  const text = pattern.padEnd(16, '-').slice(0, 32);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 49 && code <= 55) out[i] = code - 48;
  }
  return out;
}

function blankPattern() {
  const pattern = {};
  TRACK_IDS.forEach((id) => {
    pattern[id] = Array(32).fill(0);
  });
  return pattern;
}

const LIBRARY = {
  boom: [
    {
      kick: 'x......x..x.....',
      snare: '....x.......x..x',
      clap: '....x.......x...',
      hat: 'x.x.x.x.x.x.xx.x',
      openhat: '.......x........',
      perc: '..x...x...x.....',
      bass: '1--1---3--1-5---',
      chords: '1-------6-------'
    },
    {
      kick: 'x.......x..x....',
      snare: '....x.......x...',
      clap: '....x..x....x...',
      hat: 'x.x.x.x.x.x.x.x.',
      openhat: '............x...',
      perc: '.x...x...x...x..',
      bass: '1-----5---1-3---',
      chords: '1-------4-------'
    }
  ],
  lofi: [
    {
      kick: 'x.........x.....',
      snare: '....x.......x...',
      clap: '............x...',
      hat: 'x..x..x.x..x..x.',
      openhat: '.......x........',
      perc: '..x.....x.....x.',
      bass: '1-----6---4-5---',
      chords: '2-------5---1---'
    },
    {
      kick: 'x.......x.......',
      snare: '....x.......x..x',
      clap: '....x.......x...',
      hat: 'x.x..x.x.x..x.x.',
      openhat: '..............x.',
      perc: '...x.....x......',
      bass: '6---5-----1-----',
      chords: '6-----4---5-----'
    }
  ],
  trap: [
    {
      kick: 'x.........x..x..',
      snare: '....x.......x...',
      clap: '....x..x....x...',
      hat: 'xxxxxxxxxxxxxxxx',
      openhat: '..............x.',
      perc: '...x.......x....',
      bass: '1-1---1---5--1--',
      chords: '1-----------7---'
    },
    {
      kick: 'x.......x...x...',
      snare: '....x.......x...',
      clap: '....x.......x..x',
      hat: 'x.xxx.xxx.xxx.xx',
      openhat: '............x...',
      perc: '......x.......x.',
      bass: '1-----3-1-----5-',
      chords: '1-------6-------'
    }
  ],
  drill: [
    {
      kick: 'x..x........x...',
      snare: '........x.......',
      clap: '........x....x..',
      hat: 'xxxxxxxxxxxxxxxx',
      openhat: '..............x.',
      perc: '..x...x...x...x.',
      bass: '1-----1---6---5-',
      chords: '1---------6-----'
    },
    {
      kick: 'x..x......x.....',
      snare: '........x.......',
      clap: '....x...x.......',
      hat: 'xxx.xxx.xxx.xxx.',
      openhat: '.......x........',
      perc: 'x...x...x...x...',
      bass: '6---1-----5---1-',
      chords: '6---------5-----'
    }
  ],
  house: [
    {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      clap: '....x.......x...',
      hat: '..x...x...x...x.',
      openhat: '..............x.',
      perc: 'x..x..x..x..x..x',
      bass: '1-5-1-5-1-3-1-5-',
      chords: '1---6---4---5---'
    },
    {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      clap: '....x..x....x...',
      hat: '..x...x...x.xxx.',
      openhat: '.......x........',
      perc: '..x...x...x...x.',
      bass: '1---1-5---1-3---',
      chords: '1---4---6---5---'
    }
  ],
  dnb: [
    {
      kick: 'x.........x.....',
      snare: '....x.......x...',
      clap: '....x.......x...',
      hat: 'xxxxxxxxxxxxxxxx',
      openhat: '.......x....x...',
      perc: '..x.x...x.x.....',
      bass: '1--5----1--3--6-',
      chords: '1-------5-------'
    },
    {
      kick: 'x.......x..x....',
      snare: '....x.......x...',
      clap: '....x.......x..x',
      hat: 'xxx.xxx.xxx.xxx.',
      openhat: '..............x.',
      perc: '.x...x.x...x.x..',
      bass: '1-3---1---6-5---',
      chords: '6-------4-------'
    }
  ],
  afro: [
    {
      kick: 'x..x..x...x..x..',
      snare: '....x..x....x..x',
      clap: '....x..x....x...',
      hat: 'x.x.x.x.x.x.x.x.',
      openhat: '.......x....x...',
      perc: 'x.x.xx.x.x.x.xx.',
      bass: '1-5-1---1-3-1---',
      chords: '1---4---6---5---'
    },
    {
      kick: 'x...x.x...x.....',
      snare: '....x.......x..x',
      clap: '..x.x.....x.x...',
      hat: 'xxxxxxxxxxxxxxxx',
      openhat: '......x.......x.',
      perc: '.x.x.x.x.xx.x.x.',
      bass: '1--1-5--1--3-5--',
      chords: '1-----6---4---5-'
    }
  ],
  rnb: [
    {
      kick: 'x.......x..x....',
      snare: '....x.......x...',
      clap: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
      openhat: '............x...',
      perc: '..x.....x.......',
      bass: '1-----6---4--5--',
      chords: '1---6---4---5---'
    },
    {
      kick: 'x.........x.....',
      snare: '....x.......x..x',
      clap: '....x.......x...',
      hat: 'x..x.x.x.x..x.x.',
      openhat: '.......x........',
      perc: '.....x.....x....',
      bass: '6---5-----1-3---',
      chords: '6---5---4---1---'
    }
  ]
};

const GENRE_DEFAULTS = {
  boom: { bpm: 94, swing: 0.18, sidechain: 0.28 },
  lofi: { bpm: 84, swing: 0.3, sidechain: 0.2 },
  trap: { bpm: 140, swing: 0.06, sidechain: 0.62 },
  drill: { bpm: 144, swing: 0.04, sidechain: 0.72 },
  house: { bpm: 124, swing: 0, sidechain: 0.5 },
  dnb: { bpm: 174, swing: 0, sidechain: 0.34 },
  afro: { bpm: 108, swing: 0.14, sidechain: 0.32 },
  rnb: { bpm: 90, swing: 0.16, sidechain: 0.24 }
};

function strip(overrides) {
  return {
    volume: 0.75,
    pan: 0,
    mute: false,
    solo: false,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    reverb: 0,
    delay: 0,
    drive: 0,
    ...overrides
  };
}

function mixFor(genre) {
  const trapFamily = genre === 'trap' || genre === 'drill';
  const soft = genre === 'lofi' || genre === 'rnb' || genre === 'boom';
  return {
    kick: strip({ volume: 0.9, eqLow: trapFamily ? 4 : 2.5, eqMid: trapFamily ? -2 : -1, drive: 0.08 }),
    snare: strip({ volume: soft ? 0.58 : 0.66, eqHigh: 1.5, reverb: soft ? 0.2 : 0.12, drive: 0.1 }),
    clap: strip({ volume: 0.48, eqHigh: 2, reverb: 0.14 }),
    hat: strip({ volume: genre === 'house' ? 0.34 : 0.26, eqLow: -8, eqHigh: 3.5, delay: genre === 'trap' ? 0.04 : 0 }),
    openhat: strip({ volume: 0.32, eqLow: -6, eqHigh: 2, reverb: 0.16 }),
    perc: strip({ volume: genre === 'afro' ? 0.55 : 0.38, eqHigh: 1, reverb: 0.08 }),
    bass: strip({
      volume: trapFamily ? 0.82 : 0.74,
      eqLow: trapFamily ? 3 : 1.5,
      eqMid: trapFamily ? -4 : -2,
      eqHigh: -3,
      drive: trapFamily ? 0.32 : 0.12
    }),
    chords: strip({
      volume: soft ? 0.56 : 0.46,
      eqLow: -4,
      eqMid: soft ? 1 : 0,
      eqHigh: 2,
      reverb: soft ? 0.28 : 0.18,
      delay: genre === 'house' || genre === 'rnb' ? 0.2 : 0.1,
      pan: 0.08
    })
  };
}

function voiceFor(genre) {
  const slide = genre === 'trap' || genre === 'drill';
  return {
    kick: { variant: slide ? 'trap' : 'studio' },
    clap: { variant: slide ? 'trap' : 'studio' },
    hat: { rolls: slide },
    bass: {
      glide: slide,
      decay: genre === 'drill' ? 1.15 : slide ? 0.95 : genre === 'house' ? 0.28 : 0.55,
      pitchDrop: slide ? 12 : 5,
      variant: 'sub'
    }
  };
}

function materialize(template) {
  return {
    kick: row(template.kick),
    snare: row(template.snare),
    clap: row(template.clap),
    hat: row(template.hat),
    openhat: row(template.openhat),
    perc: row(template.perc),
    bass: degrees(template.bass),
    chords: degrees(template.chords)
  };
}

function decorate(pattern, genre, rng) {
  const next = blankPattern();
  TRACK_IDS.forEach((id) => {
    next[id] = pattern[id].slice();
  });
  if (genre === 'trap' || genre === 'drill' || genre === 'dnb') {
    for (let i = 0; i < 16; i += 1) {
      if (next.hat[i] && rng() < 0.12) next.hat[i] = 0;
    }
    if (rng() > 0.4) next.kick[14] = 1;
  }
  if (genre === 'lofi' || genre === 'boom') {
    if (rng() > 0.5) next.perc[6] = 1;
  }
  return next;
}

export function normalizeKey(raw) {
  if (!raw) return null;
  let key = String(raw).trim().toUpperCase().replace('♯', '#').replace('♭', 'B');
  const flats = { DB: 'C#', EB: 'D#', GB: 'F#', AB: 'G#', BB: 'A#' };
  if (flats[key]) key = flats[key];
  return KEYS.includes(key) ? key : null;
}

export function normalizeScale(raw) {
  const text = String(raw || '').toLowerCase();
  if (text.startsWith('pent')) return 'pentatonic';
  if (text.startsWith('dor')) return 'dorian';
  if (text.startsWith('maj')) return 'major';
  if (text.startsWith('min')) return 'minor';
  if (SCALES[text]) return text;
  return null;
}

export function detectGenre(prompt) {
  const text = prompt.toLowerCase();
  const checks = [
    ['dnb', /drum\s*&?\s*bass|drum and bass|\bdnb\b|jungle/],
    ['drill', /drill/],
    ['house', /house|techno|edm|club/],
    ['afro', /afro|amapiano|dancehall/],
    ['lofi', /lo-?fi|chillhop|dusty|jazzhop/],
    ['boom', /boom[\s-]?bap|boombap|groove|pocket/],
    ['rnb', /r\s*&\s*b|rnb|soul|slow jam/],
    ['trap', /trap|rage|atlanta|808|phonk/]
  ];
  for (const [genre, pattern] of checks) {
    if (pattern.test(text)) return genre;
  }
  return 'boom';
}

export function parsePrompt(prompt) {
  const text = String(prompt || '').trim();
  const lower = text.toLowerCase();
  const genre = detectGenre(lower);
  const defaults = GENRE_DEFAULTS[genre];
  const bpmMatch = lower.match(/\bbpm\s*(6[0-9]|[7-9]\d|1[0-7]\d|180)\b|\b(6[0-9]|[7-9]\d|1[0-7]\d|180)\s*bpm\b/);
  const explicitBpm = Boolean(bpmMatch);
  const bpm = explicitBpm ? Number(bpmMatch[1] || bpmMatch[2]) : defaults.bpm;
  const keyMatch = text.match(/\b(?:in|key)\s+([A-G](?:#|b)?)\s*(pentatonic|penta|dorian|major|minor|maj|min)?/i)
    || text.match(/\b([A-G](?:#|b)?)\s+(pentatonic|penta|dorian|major|minor|maj|min)\b/i);
  const explicitKey = Boolean(keyMatch && normalizeKey(keyMatch[1]));
  const key = explicitKey ? normalizeKey(keyMatch[1]) : 'A';
  const scaleWord = keyMatch && keyMatch[2] ? keyMatch[2] : (lower.match(/\b(pentatonic|penta|dorian|major|minor)\b/) || [])[1];
  const explicitScale = Boolean(normalizeScale(scaleWord));
  const scale = explicitScale ? normalizeScale(scaleWord) : (genre === 'house' ? 'minor' : 'minor');
  return {
    bpm: clamp(bpm, 60, 180),
    swing: defaults.swing,
    key,
    scale,
    genre,
    explicitBpm,
    explicitKey,
    explicitScale
  };
}

export function forgeLocal(prompt) {
  const parsed = parsePrompt(prompt);
  const rng = mulberry32(hashString(String(prompt || 'mirmobe').trim().toLowerCase() || 'mirmobe'));
  const choices = LIBRARY[parsed.genre] || LIBRARY.boom;
  const picked = choices[Math.floor(rng() * choices.length)];
  return {
    ...parsed,
    patterns: decorate(materialize(picked), parsed.genre, rng),
    mix: mixFor(parsed.genre),
    sidechain: GENRE_DEFAULTS[parsed.genre].sidechain,
    voice: voiceFor(parsed.genre),
    source: 'local'
  };
}

export function emptyPattern() {
  return blankPattern();
}

export function clonePattern(pattern) {
  const next = blankPattern();
  TRACK_IDS.forEach((id) => {
    const source = pattern && pattern[id] ? pattern[id] : [];
    for (let i = 0; i < 32; i += 1) next[id][i] = Number(source[i]) || 0;
  });
  return next;
}

const RHYME_FAMILIES = [
  ['night', 'light', 'flight', 'right'],
  ['gold', 'soul', 'roll', 'control'],
  ['fire', 'higher', 'wire', 'desire'],
  ['sound', 'ground', 'found', 'around'],
  ['dream', 'beam', 'scheme', 'machine'],
  ['room', 'moon', 'bloom', 'tune'],
  ['bass', 'space', 'place', 'grace'],
  ['heart', 'start', 'spark', 'dark']
];

export function writeLocalHook(topic, key, scale) {
  const clean = String(topic || 'the rhythm')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ') || 'the rhythm';
  const rng = mulberry32(hashString(`${clean}|${key}|${scale}`));
  const family = RHYME_FAMILIES[Math.floor(rng() * RHYME_FAMILIES.length)];
  const spin = Math.floor(rng() * family.length);
  const word = (offset) => family[(spin + offset) % family.length];
  return [
    `${clean} in the ${word(0)}, hold the ${key} ${scale}`,
    `Count the ${word(1)} before the kick finds the floor`,
    `We don't chase the noise, we shape the ${word(2)}`,
    `Leave the hook on repeat and run it back once more`
  ];
}

export function bufferRms(buffer) {
  if (!buffer || !buffer.length) return 0;
  const data = buffer.getChannelData(0);
  let sum = 0;
  const stride = Math.max(1, Math.floor(data.length / 8000));
  let count = 0;
  for (let i = 0; i < data.length; i += stride) {
    sum += data[i] * data[i];
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

export function detectOnset(buffer) {
  if (!buffer || !buffer.length) return 0;
  const data = buffer.getChannelData(0);
  const win = Math.max(8, Math.floor(buffer.sampleRate * 0.012));
  let acc = 0;
  for (let i = 0; i < data.length; i += 1) {
    acc += data[i] * data[i];
    if (i >= win) acc -= data[i - win] * data[i - win];
    if (i >= win && Math.sqrt(acc / win) > 0.02) return (i - win) / buffer.sampleRate;
  }
  return 0;
}
