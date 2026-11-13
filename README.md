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
- Mix with volume, pan, mute, solo, 3-band EQ, reverb, delay, and drive. The master bus has a compressor and a limiter, plus a live spectrum.
- Export a WAV rendered in `OfflineAudioContext`, or save and load a project JSON file.
- Turn on the three built-in add-ons, or import a JSON pack. The contract for other bots is in [ADDONS.md](ADDONS.md).

## Trial and unlock

The five-minute sample, the one-time share bonus of five more minutes, and the 0.05 SOL unlock follow the same rules as Meme Crucible.

- Time counts only while the tab is visible.
- A signature can be used once in that browser.
- The transaction must have succeeded, be newer than seven days, and show at least 0.05 SOL gained by `5P1ArCLapXPjSEaNauVYAmtLKxEwoELcttQvPqmF1VYP`, including addresses loaded into the transaction.

After the sample, playback, the step grid, and the built-in add-on toggles stay available. Full WAV export, AI Mix Assist, and custom add-on imports ask for the sample or the unlock.

The unlock buys use of the app. It is not an investment and the page does not make claims about price.

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

The Playwright suite opens the studio in Chrome, plays and stops the sequencer, forges a beat, loads an add-on, adds the demo loop, runs mix assist, checks that the WAV bounce is a non-empty RIFF file, and opens the paywall.

## Add-ons

See [ADDONS.md](ADDONS.md) and [addons/schema.json](addons/schema.json). Modules live in `addons/` and are listed in `addons/registry.json`. JSON packs such as `addons/example-pack.json` can be imported from the Add-ons tab. Remote code is not loaded.

## Browser notes

- Chrome, Edge, Firefox, and Safari can run the sequencer, the demo loop, import, and WAV export.
- Recording needs a microphone permission. The demo loop is there when permission is blocked.
- The beat writer and the lyric writer call `https://text.pollinations.ai/openai` with no key. A 402 or a dropped network starts a 45 second cooldown, and the local forge answers instead.
- Payment checks call the public Solana mainnet RPC from the browser. No key is shipped in the page.
