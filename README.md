# Mirmobe Beat Forge

A static beat maker, multitrack booth, and add-on bay. It runs from GitHub Pages with no build step and no API key.

Live site, once Pages is serving this repository: [mirmobe.github.io/mirmobe-beat-forge](https://mirmobe.github.io/mirmobe-beat-forge/)

Mirmobe Beat Forge is a creative music tool. **Apps, not investments.** No offer to buy or sell anything, and no promise about price.

## What you can do

- Sequence Kick, Snare, Clap, Closed Hat, Open Hat, Perc, 808/Sub, and a scale-locked chord synth.
- Switch 16 steps or 32 steps (two bars), banks A–D, swing, tap tempo, count-in, and a metronome.
- Lock the bass and chords to minor, major, dorian, or pentatonic.
- Record a take over the beat, nudge it for latency, trim it, or import WAV, MP3, OGG, and WebM.
- Drop in a built-in demo vocal loop when there is no microphone.
- Describe a vibe and forge a beat. The page asks Pollinations when that free endpoint answers, and a local theory forge writes the same kind of pattern when it does not.
- Ask AI Mix & Beat Align for gain, EQ, sends, sidechain, and a grid nudge, then apply it in one click.
- Mix with volume, pan, mute, solo, 3-band EQ, reverb, delay, and drive. The master bus has a compressor and a limiter, plus a live rainbow spectrum.
- Each track keeps its own color. While it plays, its pad, label, mixer strip, and lamp glow.
- Export a WAV rendered in `OfflineAudioContext`, or save and load a project JSON file.
- Turn on the three built-in add-ons, or import a JSON pack. The contract for other bots is in [ADDONS.md](ADDONS.md).
- Open Studio Gear to route an audio interface and MIDI. PreSonus Studio 26c inputs, Main Out, and Line Out are called out when the browser can see them. Simulate PreSonus 26c exercises the same panel without hardware.

## Personal use

`PAYWALL_ENABLED` in `js/paywall.js` is `false`. WAV export, AI Mix Assist, custom add-on imports, and the rest of the studio are open, with no countdown and no paywall modal. The Solana verifier is still in that file. Set the flag to `true` to restore the five-minute sample, the one-time share bonus, and the 0.05 SOL unlock to `5P1ArCLapXPjSEaNauVYAmtLKxEwoELcttQvPqmF1VYP`.

The page is a creative music tool. **Apps, not investments.** No offer to buy or sell anything, and no promise about price.

## Studio 26c, other interfaces, and MIDI

Studio Gear asks for the microphone or MIDI only after a click.

- Pick an input and, where the browser supports `AudioContext.setSinkId`, an output. Safari and Firefox keep output selection in the system sound settings, and the panel says so.
- Studio / Direct Interface Mode records with echo cancellation, noise suppression, and auto gain turned off.
- A 2-channel interface can record Stereo (Ch 1–2), Input 1 (mono left / mic), or Input 2 (mono right / line-inst), with a dBFS meter, clip light, and input trim.
- Web MIDI plays the drums, 808, or chord synth, can step-record onto the grid, maps CC or notes with MIDI Learn, and can send MIDI clock plus start/stop.
- Simulate PreSonus 26c lists the 26c input, Main Out 1–2, Line Out 3–4, and MIDI ports so the panel can be checked with nothing plugged in.

## Run it

From the repository root:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/`. Paths are relative, so GitHub Pages can serve the root of `main` with no build. `.nojekyll` is included so Jekyll leaves the files alone.

## Tests

```bash
npm install
npx playwright install chromium
npm test
```

The Playwright suite opens the studio in Chrome, plays and stops the sequencer, checks the rainbow live glow, forges a beat, loads an add-on, adds the demo loop, runs mix assist, checks that the WAV bounce is a non-empty RIFF file, and opens Studio Gear in simulated PreSonus 26c mode.

## Add-ons

See [ADDONS.md](ADDONS.md) and [addons/schema.json](addons/schema.json). Modules live in `addons/` and are listed in `addons/registry.json`. JSON packs such as `addons/example-pack.json` can be imported from the Add-ons tab. Remote code is not loaded.

## Browser notes

- Chrome, Edge, Firefox, and Safari can run the sequencer, the demo loop, import, and WAV export.
- Recording needs a microphone permission, and only after Record or Allow device names. The demo loop is there when permission is blocked.
- The beat writer and the lyric writer call `https://text.pollinations.ai/openai` with no key. A 402 or a dropped network starts a 45 second cooldown, and the local forge answers instead.
- Payment checks stay in `js/paywall.js` and call the public Solana mainnet RPC only after the paywall flag is turned on. No key is shipped in the page.
- Web MIDI needs Chromium on HTTPS or localhost. Firefox and Safari can still run the sequencer, and the gear panel explains the gap.
