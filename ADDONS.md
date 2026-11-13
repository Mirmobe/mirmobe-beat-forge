# Beat Forge add-ons

Other bots can add tools to Mirmobe Beat Forge without changing the mixer, the scheduler, or the paywall. There are two kinds of add-on.

1. **ES module** — a file in `addons/` listed in `addons/registry.json`. The host loads it with `import()`. Use this when the tool needs a panel, a new preset button, or a voice option.
2. **JSON pack** — a file or URL the user imports from the Add-ons tab. Packs can carry presets, vocal chains, and lyric seeds. The page does not fetch or run remote JavaScript.

The shapes are in `addons/schema.json`.

## Registry

`addons/registry.json` is the list of modules that ship with the studio.

```json
{
  "format": "mirmobe-beat-forge-registry",
  "version": 1,
  "addons": [
    {
      "id": "my-tool",
      "name": "My Tool",
      "version": "1.0.0",
      "description": "What the toggle does.",
      "kind": "module",
      "entry": "./my-tool.js",
      "builtin": true,
      "defaultEnabled": true
    }
  ]
}
```

`entry` is relative to the registry file. `id` is lowercase letters, numbers, and hyphens.

## Module shape

```js
export function activate(api) {}
export function deactivate(api) {}
export function mount(container, api) {
  container.innerHTML = "<p>Panel</p>";
  return () => {
    container.innerHTML = "";
  };
}
```

`activate` runs when the user turns the add-on on. `deactivate` runs when they turn it off. `mount` fills a section in the Add-ons tab and may return an unmount function. The host removes the section after unmount.

Keep ids stable. Register presets with `group` set to the add-on id so `clearGroup` can remove them.

## Host API

`api` is the only way a module should touch the studio.

| Method | Use |
| --- | --- |
| `getState()` | Read bpm, swing, steps, bank, key, scale, patterns, mixer, voiceOptions, audioTracks, lyrics. Do not replace the object. |
| `setTransport({ bpm, swing, key, scale, steps })` | Move the transport. `steps` is 16 or 32. `bpm` is clamped to 60–180. |
| `setPattern(track, steps)` | Replace one line on the current bank. `track` is `kick`, `snare`, `clap`, `hat`, `openhat`, `perc`, `bass`, or `chords`. |
| `setMixer(channel, params)` | Merge volume, pan, mute, solo, eqLow, eqMid, eqHigh, reverb, delay, drive. `channel` may be `master` or an audio-track id. |
| `setVoiceOptions(id, partial)` | Bass reads `glide`, `decay`, `pitchDrop`. Hats read `rolls`. Kick and clap read `variant` (`studio` or `trap`). |
| `setSidechain(amount)` | 0 to 1. This is the kick ducking depth. |
| `registerPreset(preset)` / `clearGroup(group)` / `applyPreset(id)` | Presets the host can load onto the current bank. |
| `registerVocalChain(chain)` / `clearVocalGroup(group)` / `applyVocalChain(id)` | Chains print onto vocal tracks, or onto every audio track when none are tagged vocal. |
| `setLyrics(lines)` | Four strings, highlighted with the playhead. |
| `toast(message)` | One short status line. |
| `on(event, fn)` | Subscribe to `step`, `hit`, `transport`, `pattern`, `project`, `tracks`, `lyrics`, or `addons`. `hit` is `{ id, velocity }` when a track triggers. Returns an unsubscribe function. |
| `requestAccess()` | Returns true while `PAYWALL_ENABLED` is false. When that flag is true, returns false and opens the paywall after the sample ends if the browser is not unlocked. |

Pattern lines are 16 or 32 steps. Drums are `0` or `1`. Bass and chords are scale degrees: `0` is a rest, `1`–`7` walk the locked scale (minor, major, dorian, or pentatonic). A 16-step line leaves the second bar empty until the user switches to 32 steps, which copies the first bar when the second bar is blank.

A preset looks like this:

```json
{
  "id": "night-market-keys",
  "name": "Night Market",
  "group": "my-tool",
  "bpm": 102,
  "swing": 0.14,
  "key": "D",
  "scale": "dorian",
  "steps": 16,
  "sidechain": 0.3,
  "patterns": {
    "kick": [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    "snare": [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    "clap": [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    "hat": [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    "openhat": [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    "perc": [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    "bass": [1, 0, 0, 5, 0, 0, 1, 0, 4, 0, 0, 0, 5, 0, 0, 0],
    "chords": [1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0]
  }
}
```

A vocal chain uses the strip that already exists. It does not create Web Audio nodes of its own.

```json
{ "id": "air", "name": "Air", "eqLow": -3, "eqMid": 1, "eqHigh": 3, "reverb": 0.3, "delay": 0.18, "drive": 0.05, "volume": 0.8 }
```

## JSON packs

Users load a pack from a file or a same-origin (or CORS-enabled) URL. Personal-use mode (`PAYWALL_ENABLED = false` in `js/paywall.js`) leaves WAV export, AI Mix Assist, and this import open. Set the flag to true to put them behind the five-minute sample and the 0.05 SOL unlock again. Built-in toggles stay available either way.

```json
{
  "format": "mirmobe-beat-forge-pack",
  "version": 1,
  "title": "Night Market",
  "addons": [
    { "id": "night-market", "name": "Night Market Keys", "kind": "preset-pack", "presets": [] },
    { "id": "night-market-air", "name": "Night Market Air", "kind": "vocal-chains", "chains": [] },
    { "id": "seeds", "kind": "lyric-seeds", "lines": ["line one", "line two", "line three", "line four"] }
  ]
}
```

`addons/example-pack.json` is a working pack.

## What not to do

- Do not import remote scripts, call `eval`, or add a `moduleUrl` and expect the host to run it.
- Do not change the unlock address or the payment check.
- Do not write API keys into an add-on. The lyric and beat writers already call the keyless Pollinations endpoint and fall back on device.
- Do not reach into private audio nodes. Ask `api` to change the score, then let the engine build the sound.

## Built-in modules

| File | What it adds |
| --- | --- |
| `addons/trap-forge.js` | 808 glide, trap clap, hat rolls, and four presets |
| `addons/vocal-fx.js` | Crisp Studio, Warm Tape, Radio Lo-Fi, Shimmer Echo |
| `addons/lyric-pad.js` | Four bar slots plus a hook writer |

A new bot can copy one of those files, give it a new id, and add one object to the registry.
