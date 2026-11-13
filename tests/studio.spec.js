import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const ARTIFACTS = '/opt/cursor/artifacts';

function watchErrors(page, bucket) {
  page.on('pageerror', (error) => bucket.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.push(`console: ${msg.text()}`);
  });
}

test.beforeAll(() => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
});

test('personal studio plays in rainbow, routes a simulated 26c, and exports', async ({ page }) => {
  const errors = [];
  watchErrors(page, errors);

  await page.goto('/');
  await expect(page).toHaveTitle(/Mirmobe Beat Forge/);
  await expect(page.locator('footer')).toContainText('Mirmobe Beat Forge is a creative music tool. Apps, not investments. No offer to buy or sell anything, and no promise about price.');
  await expect(page.locator('footer a[href="https://mirmobe.wordpress.com"]')).toBeVisible();
  await expect(page.locator('#modeBadge')).toHaveText(/Personal studio/);
  await expect(page.locator('#trialBadge')).toBeHidden();
  await expect(page.locator('#openPaywallBtn')).toBeHidden();
  await expect(page.locator('#paywallOverlay')).toBeHidden();
  const unlocked = await page.evaluate(() => ({
    paywall: window.MirmobeBeatForge.PAYWALL_ENABLED,
    access: window.MirmobeBeatForge.hasFullAccess(),
    kick: getComputedStyle(document.documentElement).getPropertyValue('--c-kick').trim(),
    bass: getComputedStyle(document.documentElement).getPropertyValue('--c-bass').trim(),
    chords: getComputedStyle(document.documentElement).getPropertyValue('--c-chords').trim()
  }));
  expect(unlocked.paywall).toBe(false);
  expect(unlocked.access).toBe(true);
  expect(unlocked.kick).toBe('#ff2d55');
  expect(unlocked.bass).toBe('#4d7dff');
  expect(unlocked.chords).toBe('#c084fc');
  await page.waitForSelector('[data-preset="atlanta-slide"]', { state: 'attached' });

  await page.click('#playBtn');
  await page.waitForFunction(() => document.querySelector('#stepReadout').textContent !== '–');
  await expect(page.locator('#transportState')).toHaveText('Playing');
  await page.waitForFunction(() => document.querySelectorAll('.track-row.is-hot, .strip.is-hot, .lamp.is-hot').length >= 2);
  await page.screenshot({ path: `${ARTIFACTS}/rainbow-playback.png` });
  await page.click('#stopBtn');
  await expect(page.locator('#transportState')).toHaveText('Stopped');

  await page.fill('#aiPrompt', 'dark trap 140 bpm in F minor');
  await page.click('#generateBeatBtn');
  await expect(page.locator('#aiStatus')).toContainText(/forged|forge|Pollinations|local/i);
  await expect(page.locator('#bpmInput')).toHaveValue('140');
  await expect(page.locator('#keySelect')).toHaveValue('F');
  await expect(page.locator('#scaleSelect')).toHaveValue('minor');
  expect(await page.locator('#grid .step.is-on').count()).toBeGreaterThan(4);

  await page.click('#tabAddons');
  await expect(page.locator('[data-addon-panel="trap-forge"]')).toContainText('808 & Trap Forge');
  await page.click('[data-preset="atlanta-slide"]');
  await expect(page.locator('#bpmInput')).toHaveValue('142');
  await page.click('[data-addon-toggle="lyric-pad"]');
  await expect(page.locator('[data-addon-panel="lyric-pad"]')).toHaveCount(0);
  await page.click('[data-addon-toggle="lyric-pad"]');
  await expect(page.locator('[data-addon-panel="lyric-pad"]')).toBeVisible();
  await page.fill('#addonUrlInput', './addons/example-pack.json');
  await page.click('#addonImportUrlBtn');
  await expect(page.locator('#importedMount')).toContainText('Night Market');

  await page.click('#demoTrackBtn');
  await expect(page.locator('.audio-track')).toHaveCount(1);
  await expect(page.locator('.audio-track strong')).toHaveText('Demo vocal loop');
  await page.click('[data-chain="crisp"]');
  const crispHigh = await page.evaluate(() => window.MirmobeBeatForge.state.audioTracks[0].eqHigh);
  expect(crispHigh).toBe(4);

  await page.click('#tabMixer');
  await page.click('#mixAssistBtn');
  expect(await page.locator('#mixSuggestions li').count()).toBeGreaterThan(2);
  await page.click('#applyMixBtn');
  const nudge = await page.evaluate(() => window.MirmobeBeatForge.state.audioTracks[0].nudgeMs);
  expect(typeof nudge).toBe('number');
  expect(nudge).not.toBe(0);

  const downloadPromise = page.waitForEvent('download');
  await page.click('#exportWavBtn');
  const download = await downloadPromise;
  const filePath = await download.path();
  const wav = fs.readFileSync(filePath);
  expect(wav.length).toBeGreaterThan(44);
  expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
  await page.waitForFunction(() => window.MirmobeBeatForge.lastExport && window.MirmobeBeatForge.lastExport.bytes > 44);
  const summary = await page.evaluate(() => window.MirmobeBeatForge.lastExport);
  expect(summary.riff).toBe('RIFF');
  expect(summary.peak).toBeGreaterThan(0.01);
  await expect(page.locator('#paywallOverlay')).toBeHidden();

  await page.click('#openIoBtn');
  await expect(page.locator('#ioOverlay')).toBeVisible();
  await expect(page.locator('#ioPermissionNote')).toContainText(/only when you click/i);
  await page.click('#simulate26c');
  await expect(page.locator('#gearBadge')).toHaveText('PreSonus 26c Ready');
  await expect(page.locator('#ioCallout')).toContainText(/Studio 26c/);
  await expect(page.locator('#ioInput')).toContainText('Mic/Inst 1-2');
  await expect(page.locator('#ioOutput')).toContainText('Line Out 3-4');
  await expect(page.locator('#directMode')).toBeChecked();
  await page.selectOption('#ioChannel', 'input1');
  await expect(page.locator('#routeSummary')).toContainText('Input 1');
  await expect(page.locator('#routeSummary')).toContainText(/echo cancellation/i);
  await page.selectOption('#ioOutput', 'sim-26c-out-line');
  await expect(page.locator('#sinkNote')).toContainText(/setSinkId|system sound/i);
  await expect(page.locator('#midiInputs')).toContainText('PreSonus Studio 26c MIDI In');
  await page.click('#midiLearnBtn');
  await page.click('#learnMaster');
  await expect(page.locator('#midiLearnStatus')).toContainText(/master/i);
  await page.click('#sendTestCc');
  await expect(page.locator('#midiMonitor')).toContainText(/CC 7/);
  await expect(page.locator('#midiMapList')).toContainText('CC 7 → master');
  const gain = Number(await page.locator('#masterGain').inputValue());
  expect(gain).toBeCloseTo(100 / 127, 1);
  await page.click('#sendTestNote');
  await expect(page.locator('#midiMonitor')).toContainText(/Note On/);
  await page.click('#monitorInputBtn');
  await page.waitForFunction(() => {
    const text = document.querySelector('#dbReadout').textContent || '';
    return /-?\d+\.\d/.test(text);
  });
  await page.evaluate(() => {
    const toast = document.getElementById('toast');
    if (toast) toast.hidden = true;
    const card = document.querySelector('.io-card');
    if (card) card.scrollTop = 0;
  });
  await page.screenshot({ path: `${ARTIFACTS}/studio-26c-io.png` });
  await page.click('#closeIoBtn');
  await expect(page.locator('#ioOverlay')).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${ARTIFACTS}/mobile-rainbow.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('a stored trial timer does not lock the personal studio', async ({ page }) => {
  const errors = [];
  watchErrors(page, errors);
  await page.addInitScript(() => {
    localStorage.setItem('mbf_v1_used_ms', String(6 * 60 * 1000));
  });
  await page.goto('/');
  await expect(page.locator('#paywallOverlay')).toBeHidden();
  await expect(page.locator('#trialBadge')).toBeHidden();
  await page.click('#playBtn');
  await page.waitForFunction(() => document.querySelector('#stepReadout').textContent !== '–');
  await page.click('#stopBtn');
  await page.click('#mixAssistBtn');
  await expect(page.locator('#paywallOverlay')).toBeHidden();
  expect(await page.locator('#mixSuggestions li').count()).toBeGreaterThan(0);
  const downloadPromise = page.waitForEvent('download');
  await page.click('#exportWavBtn');
  const download = await downloadPromise;
  const wav = fs.readFileSync(await download.path());
  expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
  await expect(page.locator('#paywallOverlay')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});
