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

test('studio plays, forges, mixes, exports, and shows the paywall', async ({ page }) => {
  const errors = [];
  watchErrors(page, errors);

  await page.goto('/');
  await expect(page).toHaveTitle(/Mirmobe Beat Forge/);
  await expect(page.locator('footer')).toContainText('Mirmobe Beat Forge is a creative music tool. Apps, not investments. No offer to buy or sell anything, and no promise about price.');
  await expect(page.locator('footer a[href="https://mirmobe.wordpress.com"]')).toBeVisible();
  await expect(page.locator('footer a[href="https://mirmobe-apps.myshopify.com/"]')).toBeVisible();
  await page.waitForSelector('[data-preset="atlanta-slide"]', { state: 'attached' });

  await page.screenshot({ path: `${ARTIFACTS}/desktop-studio.png` });

  await page.click('#playBtn');
  await page.waitForFunction(() => {
    const text = document.querySelector('#stepReadout').textContent;
    return text && text !== '–';
  });
  await expect(page.locator('#transportState')).toHaveText('Playing');
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
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const rack = document.getElementById('rack');
    if (rack) rack.scrollTop = 0;
  });
  await page.screenshot({ path: `${ARTIFACTS}/mixer-addons.png` });

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

  await page.click('#openPaywallBtn');
  await expect(page.locator('#paywallOverlay')).toBeVisible();
  await expect(page.locator('#payAddressDisplay')).toHaveText('5P1ArCLapXPjSEaNauVYAmtLKxEwoELcttQvPqmF1VYP');
  await expect(page.locator('#payAmountHero')).toHaveText('0.05 SOL');
  await page.screenshot({ path: `${ARTIFACTS}/paywall.png` });
  await page.click('#dismissPaywallBtn');
  await expect(page.locator('#paywallOverlay')).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${ARTIFACTS}/mobile-layout.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('an ended trial still previews playback and gates export', async ({ page }) => {
  const errors = [];
  watchErrors(page, errors);
  await page.addInitScript(() => {
    localStorage.setItem('mbf_v1_used_ms', String(6 * 60 * 1000));
  });
  await page.goto('/');
  await expect(page.locator('#paywallOverlay')).toBeVisible();
  await page.click('#dismissPaywallBtn');
  await page.click('#playBtn');
  await page.waitForFunction(() => document.querySelector('#stepReadout').textContent !== '–');
  await page.click('#stopBtn');
  await page.click('#exportWavBtn');
  await expect(page.locator('#paywallOverlay')).toBeVisible();
  await page.click('#dismissPaywallBtn');
  await page.click('#mixAssistBtn');
  await expect(page.locator('#paywallOverlay')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
