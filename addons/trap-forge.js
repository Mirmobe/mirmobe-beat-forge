// 808 & Trap Forge — glides, hat rolls, and pattern presets.

function drums(pattern) {
  const line = Array(32).fill(0);
  for (let i = 0; i < pattern.length && i < 32; i += 1) line[i] = pattern[i] === 'x' ? 1 : 0;
  return line;
}

function notes(pattern) {
  const line = Array(32).fill(0);
  for (let i = 0; i < pattern.length && i < 32; i += 1) {
    const value = pattern.charCodeAt(i);
    if (value >= 49 && value <= 55) line[i] = value - 48;
  }
  return line;
}

const PRESETS = [
  {
    id: 'atlanta-slide',
    name: 'Atlanta Slide',
    bpm: 142,
    swing: 0.05,
    key: 'F',
    scale: 'minor',
    steps: 16,
    sidechain: 0.66,
    voice: { bass: { glide: true, decay: 1.15, pitchDrop: 12 }, hat: { rolls: true }, clap: { variant: 'trap' }, kick: { variant: 'trap' } },
    patterns: {
      kick: drums('x.........x..x..'),
      snare: drums('....x.......x...'),
      clap: drums('....x..x....x...'),
      hat: drums('xxxxxxxxxxxxxxxx'),
      openhat: drums('..............x.'),
      perc: drums('...x.......x....'),
      bass: notes('1-1---1---5--6--'),
      chords: notes('1-----------7---')
    }
  },
  {
    id: 'drill-stabs',
    name: 'Drill Stabs',
    bpm: 144,
    swing: 0.03,
    key: 'G#',
    scale: 'minor',
    steps: 16,
    sidechain: 0.74,
    voice: { bass: { glide: true, decay: 1.25, pitchDrop: 14 }, hat: { rolls: true }, clap: { variant: 'trap' }, kick: { variant: 'trap' } },
    patterns: {
      kick: drums('x..x........x...'),
      snare: drums('........x.......'),
      clap: drums('........x....x..'),
      hat: drums('xxx.xxx.xxx.xxxx'),
      openhat: drums('.......x........'),
      perc: drums('..x...x...x...x.'),
      bass: notes('1-----6---5---1-'),
      chords: notes('1---------6-----')
    }
  },
  {
    id: 'memphis-bounce',
    name: 'Memphis Bounce',
    bpm: 74,
    swing: 0.12,
    key: 'D#',
    scale: 'minor',
    steps: 16,
    sidechain: 0.4,
    voice: { bass: { glide: false, decay: 0.7, pitchDrop: 7 }, hat: { rolls: false }, clap: { variant: 'trap' }, kick: { variant: 'trap' } },
    patterns: {
      kick: drums('x.......x..x....'),
      snare: drums('....x.......x..x'),
      clap: drums('....x.......x...'),
      hat: drums('x.x.x.x.x.x.x.x.'),
      openhat: drums('............x...'),
      perc: drums('..x.....x.....x.'),
      bass: notes('1-----1-3---5---'),
      chords: notes('1-------4-------')
    }
  },
  {
    id: 'rage-loop',
    name: 'Rage Loop',
    bpm: 150,
    swing: 0,
    key: 'C',
    scale: 'minor',
    steps: 16,
    sidechain: 0.7,
    voice: { bass: { glide: true, decay: 0.8, pitchDrop: 10 }, hat: { rolls: true }, clap: { variant: 'trap' }, kick: { variant: 'trap' } },
    patterns: {
      kick: drums('x...x...x..x.x..'),
      snare: drums('....x.......x...'),
      clap: drums('....x..x....x..x'),
      hat: drums('xxxxxxxxxxxxxxxx'),
      openhat: drums('..............x.'),
      perc: drums('x...x...x...x...'),
      bass: notes('1-1-1---1-5-1-7-'),
      chords: notes('1---1---6---6---')
    }
  }
];

export function activate(api) {
  api.setVoiceOptions('bass', { glide: true, decay: 1.05, pitchDrop: 12, variant: 'sub' });
  api.setVoiceOptions('clap', { variant: 'trap' });
  api.setVoiceOptions('hat', { rolls: true });
  api.setVoiceOptions('kick', { variant: 'trap' });
  PRESETS.forEach((preset) => api.registerPreset({ ...preset, group: 'trap-forge' }));
}

export function deactivate(api) {
  api.clearGroup('trap-forge');
  api.setVoiceOptions('bass', { glide: false, decay: 0.55, pitchDrop: 5 });
  api.setVoiceOptions('clap', { variant: 'studio' });
  api.setVoiceOptions('hat', { rolls: false });
  api.setVoiceOptions('kick', { variant: 'studio' });
}

export function mount(container, api) {
  container.innerHTML = `
    <header class="addon-head">
      <h3>808 & Trap Forge</h3>
      <p>Gliding subs, rolled hats, and four trap pockets.</p>
    </header>
    <div class="preset-row" id="trapPresetRow"></div>
    <p class="hint">Glide and hat rolls stay on while this add-on is enabled.</p>
  `;
  const row = container.querySelector('#trapPresetRow');
  PRESETS.forEach((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip-btn';
    button.dataset.preset = preset.id;
    button.textContent = preset.name;
    button.addEventListener('click', () => api.applyPreset(preset.id));
    row.appendChild(button);
  });
  return () => {
    container.innerHTML = '';
  };
}
