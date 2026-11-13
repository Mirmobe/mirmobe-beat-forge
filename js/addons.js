// Add-on host. Built-in tools are ES modules. Custom packs are JSON only.

import { state, emit, subscribe, toast, currentPattern } from './state.js';
import { TRACK_IDS, clonePattern, SCALES, normalizeKey, normalizeScale } from './theory.js';
import { syncMix } from './engine.js';
import { requireFullAccess } from './paywall.js';

const LS_ENABLED = 'mbf_v1_addons';
const presets = [];
const vocalChains = [];
const records = new Map();
let api = null;

function readEnabled() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_ENABLED) || 'null');
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function writeEnabled() {
  const ids = [...records.entries()].filter(([, record]) => record.enabled).map(([id]) => id);
  localStorage.setItem(LS_ENABLED, JSON.stringify(ids));
}

export function getApi() {
  if (!api) api = createApi();
  return api;
}

function createApi() {
  return {
    getState() {
      return state;
    },
    setTransport(partial) {
      if (!partial) return;
      if (partial.bpm != null) state.bpm = Math.min(180, Math.max(60, Math.round(Number(partial.bpm))));
      if (partial.swing != null) state.swing = Math.min(0.45, Math.max(0, Number(partial.swing) || 0));
      if (partial.key) {
        const key = normalizeKey(partial.key);
        if (key) state.key = key;
      }
      if (partial.scale && SCALES[partial.scale]) state.scale = partial.scale;
      if (partial.steps === 16 || partial.steps === 32) state.steps = partial.steps;
      emit('project');
    },
    setPattern(track, steps) {
      if (!TRACK_IDS.includes(track) || !Array.isArray(steps)) return;
      const line = currentPattern()[track];
      for (let i = 0; i < 32; i += 1) line[i] = Number(steps[i]) || 0;
      emit('pattern');
    },
    setMixer(channel, params) {
      const target = channel === 'master' ? null : (state.mixer[channel] || state.audioTracks.find((track) => track.id === channel));
      if (channel === 'master' && params) {
        state.master = { ...state.master, ...params };
      } else if (target && params) {
        Object.assign(target, params);
      }
      syncMix();
      emit('project');
    },
    setVoiceOptions(id, partial) {
      state.voiceOptions[id] = { ...(state.voiceOptions[id] || {}), ...partial };
    },
    setSidechain(amount) {
      state.sidechain = Math.min(1, Math.max(0, Number(amount) || 0));
      emit('project');
    },
    registerPreset(preset) {
      if (!preset || !preset.id) return;
      const index = presets.findIndex((item) => item.id === preset.id);
      const next = { ...preset };
      if (index >= 0) presets[index] = next;
      else presets.push(next);
      emit('addons');
    },
    clearGroup(group) {
      for (let i = presets.length - 1; i >= 0; i -= 1) {
        if (presets[i].group === group) presets.splice(i, 1);
      }
      emit('addons');
    },
    listPresets(group) {
      return presets.filter((preset) => !group || preset.group === group);
    },
    applyPreset(id) {
      const preset = presets.find((item) => item.id === id);
      if (!preset) return;
      if (preset.bpm) state.bpm = Math.min(180, Math.max(60, Math.round(preset.bpm)));
      if (preset.swing != null) state.swing = Math.min(0.45, Math.max(0, Number(preset.swing) || 0));
      const key = normalizeKey(preset.key);
      if (key) state.key = key;
      const scale = normalizeScale(preset.scale);
      if (scale) state.scale = scale;
      if (preset.steps === 16 || preset.steps === 32) state.steps = preset.steps;
      if (preset.patterns) {
        const next = clonePattern(preset.patterns);
        TRACK_IDS.forEach((track) => {
          currentPattern()[track] = next[track];
        });
      }
      if (preset.voice) {
        Object.keys(preset.voice).forEach((id) => {
          state.voiceOptions[id] = { ...(state.voiceOptions[id] || {}), ...preset.voice[id] };
        });
      }
      if (preset.sidechain != null) state.sidechain = Math.min(1, Math.max(0, Number(preset.sidechain) || 0));
      emit('project');
      toast(`${preset.name} is on bank ${state.bank}.`);
    },
    registerVocalChain(chain) {
      if (!chain || !chain.id) return;
      const index = vocalChains.findIndex((item) => item.id === chain.id);
      if (index >= 0) vocalChains[index] = chain;
      else vocalChains.push(chain);
      emit('addons');
    },
    clearVocalGroup(group) {
      for (let i = vocalChains.length - 1; i >= 0; i -= 1) {
        if (vocalChains[i].group === group) vocalChains.splice(i, 1);
      }
      emit('addons');
    },
    listVocalChains(group) {
      return vocalChains.filter((chain) => !group || chain.group === group);
    },
    applyVocalChain(chainOrId) {
      const chain = typeof chainOrId === 'string'
        ? vocalChains.find((item) => item.id === chainOrId)
        : chainOrId;
      if (!chain) return 0;
      const tagged = state.audioTracks.filter((track) => track.role === 'vocal');
      const targets = tagged.length ? tagged : state.audioTracks;
      if (!targets.length) {
        toast('Add a demo loop or a vocal take first.');
        return 0;
      }
      targets.forEach((track) => {
        ['volume', 'eqLow', 'eqMid', 'eqHigh', 'reverb', 'delay', 'drive', 'pan'].forEach((key) => {
          if (chain[key] != null) track[key] = chain[key];
        });
      });
      syncMix();
      emit('tracks');
      toast(`${chain.name} is on ${targets.length === 1 ? targets[0].name : `${targets.length} tracks`}.`);
      return targets.length;
    },
    setLyrics(lines) {
      state.lyrics = [0, 1, 2, 3].map((index) => String((lines && lines[index]) || ''));
      emit('lyrics');
    },
    toast,
    on(type, fn) {
      return subscribe((event, detail) => {
        if (event === type) fn(detail);
      });
    },
    requestAccess() {
      return requireFullAccess();
    }
  };
}

function addonUrl(entry, registryUrl) {
  return new URL(entry, registryUrl);
}

async function setEnabled(manifest, registryUrl, enabled) {
  const id = manifest.id;
  const record = records.get(id) || { manifest, enabled: false, unmount: null, module: null };
  records.set(id, record);
  if (enabled && !record.enabled) {
    const mod = record.module || await import(addonUrl(manifest.entry, registryUrl).href);
    record.module = mod;
    const host = getApi();
    if (typeof mod.activate === 'function') mod.activate(host);
    const slot = document.createElement('section');
    slot.className = 'addon-card';
    slot.dataset.addonPanel = id;
    document.getElementById('addonMount')?.appendChild(slot);
    if (typeof mod.mount === 'function') record.unmount = mod.mount(slot, host) || null;
    record.enabled = true;
  } else if (!enabled && record.enabled) {
    if (typeof record.unmount === 'function') record.unmount();
    document.querySelector(`[data-addon-panel="${id}"]`)?.remove();
    if (record.module && typeof record.module.deactivate === 'function') record.module.deactivate(getApi());
    record.enabled = false;
    record.unmount = null;
  }
  writeEnabled();
  renderToggles();
}

function renderToggles() {
  const list = document.getElementById('addonToggles');
  if (!list) return;
  list.innerHTML = '';
  records.forEach((record) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `addon-toggle${record.enabled ? ' is-on' : ''}`;
    button.dataset.addonToggle = record.manifest.id;
    button.setAttribute('aria-pressed', record.enabled ? 'true' : 'false');
    const manifest = record.manifest;
    button.innerHTML = `<span>${manifest.name}</span><small>${record.enabled ? 'On' : 'Off'}</small>`;
    button.title = manifest.description || '';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await setEnabled(manifest, record.registryUrl, !record.enabled);
      } catch (err) {
        toast(`Could not load ${manifest.name}.`);
      } finally {
        button.disabled = false;
      }
    });
    list.appendChild(button);
  });
  renderImported();
}

function renderImported() {
  const host = document.getElementById('importedMount');
  if (!host) return;
  const imported = presets.filter((preset) => preset.imported);
  const chains = vocalChains.filter((chain) => chain.imported);
  if (!imported.length && !chains.length) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = '<h3>Imported pack</h3>';
  imported.forEach((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip-btn';
    button.dataset.preset = preset.id;
    button.textContent = preset.name;
    button.addEventListener('click', () => getApi().applyPreset(preset.id));
    host.appendChild(button);
  });
  chains.forEach((chain) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip-btn';
    button.dataset.chain = chain.id;
    button.textContent = chain.name;
    button.addEventListener('click', () => getApi().applyVocalChain(chain.id));
    host.appendChild(button);
  });
}

function validatePack(data) {
  if (!data || data.format !== 'mirmobe-beat-forge-pack' || !Array.isArray(data.addons)) {
    throw new Error('That JSON is not a Beat Forge add-on pack.');
  }
  return data;
}

export function importPackData(data) {
  if (!requireFullAccess()) return false;
  const pack = validatePack(data);
  const host = getApi();
  pack.addons.forEach((addon) => {
    if (addon.kind === 'preset-pack' && Array.isArray(addon.presets)) {
      addon.presets.forEach((preset) => {
        host.registerPreset({ ...preset, id: preset.id || `${addon.id}-preset`, group: addon.id || 'import', imported: true });
      });
    }
    if (addon.kind === 'vocal-chains' && Array.isArray(addon.chains)) {
      addon.chains.forEach((chain) => {
        host.registerVocalChain({ ...chain, group: addon.id || 'import', imported: true });
      });
    }
    if (addon.kind === 'lyric-seeds' && Array.isArray(addon.lines)) {
      host.setLyrics(addon.lines);
    }
  });
  renderImported();
  const title = pack.title || 'Add-on pack';
  toast(`${title} loaded.`);
  const status = document.getElementById('addonImportStatus');
  if (status) status.textContent = `${title} loaded.`;
  return true;
}

export async function importPackUrl(url) {
  if (!requireFullAccess()) return false;
  const response = await fetch(url);
  if (!response.ok) throw new Error('That URL did not return a pack.');
  const data = await response.json();
  return importPackData(data);
}

export async function initAddons() {
  const registryUrl = new URL('../addons/registry.json', import.meta.url);
  const response = await fetch(registryUrl);
  if (!response.ok) throw new Error('Add-on registry missing.');
  const registry = await response.json();
  const saved = readEnabled();
  for (const manifest of registry.addons || []) {
    records.set(manifest.id, {
      manifest,
      registryUrl,
      enabled: false,
      module: null,
      unmount: null
    });
    const shouldEnable = saved ? saved.includes(manifest.id) : manifest.defaultEnabled !== false;
    if (shouldEnable) {
      try {
        await setEnabled(manifest, registryUrl, true);
      } catch (err) {
        toast(`${manifest.name} did not start.`);
      }
    }
  }
  renderToggles();
  subscribe((type) => {
    if (type === 'addons') renderImported();
  });

  document.getElementById('addonFileBtn')?.addEventListener('click', () => {
    if (!requireFullAccess()) return;
    document.getElementById('addonFile')?.click();
  });
  document.getElementById('addonImportForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    document.getElementById('addonImportUrlBtn')?.click();
  });

  document.getElementById('addonFile')?.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!requireFullAccess()) return;
    try {
      importPackData(JSON.parse(await file.text()));
    } catch (err) {
      toast(err.message || 'Could not read that add-on pack.');
    }
  });

  document.getElementById('addonImportUrlBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('addonUrlInput');
    const url = input ? input.value.trim() : '';
    if (!url) {
      toast('Paste a JSON pack URL first.');
      return;
    }
    if (!requireFullAccess()) return;
    try {
      await importPackUrl(url);
    } catch (err) {
      toast(err.message || 'Could not load that URL.');
    }
  });
}
