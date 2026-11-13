// Lyric & Flow Pad — four bars locked to the sequencer, plus a hook writer.

import { writeHook } from '../js/ai.js';

export function activate() {}

export function deactivate() {}

export function mount(container, api) {
  const state = api.getState();
  container.innerHTML = `
    <header class="addon-head">
      <h3>Lyric & Flow Pad</h3>
      <p>Four bars, highlighted with the playhead. The hook writer uses Pollinations when it answers, and a local rhyme pad when it does not.</p>
    </header>
    <label class="field">Topic
      <input id="lyricTopic" type="text" maxlength="80" placeholder="night drive, brass, no chorus yet">
    </label>
    <button type="button" class="btn primary" id="writeHookBtn">Write a hook</button>
    <p class="hint" id="lyricStatus" role="status"></p>
    <div class="lyric-lines" id="lyricLines"></div>
  `;
  const lines = container.querySelector('#lyricLines');
  for (let i = 0; i < 4; i += 1) {
    const row = document.createElement('label');
    row.className = 'lyric-line';
    row.dataset.line = String(i);
    row.innerHTML = `<span>Bar ${i + 1}</span><textarea rows="2" maxlength="120"></textarea>`;
    const area = row.querySelector('textarea');
    area.value = state.lyrics[i] || '';
    area.addEventListener('input', () => {
      const next = api.getState().lyrics.slice();
      next[i] = area.value;
      api.setLyrics(next);
    });
    lines.appendChild(row);
  }

  function paint(step) {
    const stepsPerLine = Math.max(1, api.getState().steps / 4);
    const active = step >= 0 ? Math.floor(step / stepsPerLine) : -1;
    lines.querySelectorAll('.lyric-line').forEach((row) => {
      row.classList.toggle('is-current', Number(row.dataset.line) === active);
    });
  }

  function pull() {
    const lyrics = api.getState().lyrics;
    lines.querySelectorAll('textarea').forEach((area, index) => {
      if (document.activeElement !== area) area.value = lyrics[index] || '';
    });
  }

  const offStep = api.on('step', paint);
  const offLyrics = api.on('lyrics', pull);
  container.querySelector('#writeHookBtn').addEventListener('click', async () => {
    const button = container.querySelector('#writeHookBtn');
    const status = container.querySelector('#lyricStatus');
    button.disabled = true;
    status.textContent = 'Writing…';
    try {
      const topic = container.querySelector('#lyricTopic').value;
      const result = await writeHook(topic);
      api.setLyrics(result.lines);
      pull();
      status.textContent = result.note;
    } catch (err) {
      status.textContent = 'The pad could not write that hook.';
    } finally {
      button.disabled = false;
    }
  });

  return () => {
    offStep();
    offLyrics();
    container.innerHTML = '';
  };
}
