// Five-minute trial, one share bonus, and a 0.05 SOL unlock.
// A signature can be used once in this browser. The transaction must have
// succeeded, be newer than 7 days, and the unlock address must have gained
// at least 0.05 SOL, including addresses loaded into the transaction.

import qrcode from './vendor/qrcode.js';

const UNLOCK_PRICE_SOL = 0.05;
const PAYMENT_ADDRESS = '5P1ArCLapXPjSEaNauVYAmtLKxEwoELcttQvPqmF1VYP';
const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const TRIAL_MS = 5 * 60 * 1000;
const SHARE_BONUS_MS = 5 * 60 * 1000;
const PAYMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_URL = 'https://mirmobe.github.io/mirmobe-beat-forge/';
const LS_USED_MS = 'mbf_v1_used_ms';
const LS_UNLOCKED = 'mbf_v1_unlocked';
const LS_USED_SIGS = 'mbf_v1_used_sigs';
const LS_SHARED = 'mbf_v1_shared';
const LAMPORTS_PER_SOL = 1000000000;
const MIN_LAMPORTS = Math.round(UNLOCK_PRICE_SOL * LAMPORTS_PER_SOL);
const SOLANA_PAY_URL = `solana:${PAYMENT_ADDRESS}?amount=${UNLOCK_PRICE_SOL}&label=Mirmobe%20Beat%20Forge&message=Beat%20Forge%20unlock`;
const SHARE_TEXT = 'I made a beat in Mirmobe Beat Forge. Five free minutes in the browser:';

let lastTick = Date.now();
let dismissedWhileLocked = false;
let started = false;

function readNumber(key) {
  const n = Number(localStorage.getItem(key));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function isUnlocked() {
  return localStorage.getItem(LS_UNLOCKED) === '1';
}

function hasShared() {
  return localStorage.getItem(LS_SHARED) === '1';
}

function allowedMs() {
  return TRIAL_MS + (hasShared() ? SHARE_BONUS_MS : 0);
}

function usedMs() {
  return Math.min(readNumber(LS_USED_MS), allowedMs() + 1000);
}

export function remainingMs() {
  if (isUnlocked()) return Infinity;
  return Math.max(0, allowedMs() - usedMs());
}

export function hasFullAccess() {
  return isUnlocked() || remainingMs() > 0;
}

function getUsedSignatures() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_USED_SIGS) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function setPaywallStatus(message, kind) {
  const el = document.getElementById('paywallStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = `paywall-status${kind ? ` is-${kind}` : ''}`;
}

function updateTrialBadge() {
  const badge = document.getElementById('trialBadge');
  if (!badge) return;
  badge.classList.remove('is-low', 'is-unlocked');
  if (isUnlocked()) {
    badge.classList.add('is-unlocked');
    badge.textContent = 'Unlocked';
    return;
  }
  const left = remainingMs();
  badge.textContent = left > 0 ? `${formatCountdown(left)} left` : 'Preview';
  if (left <= 60 * 1000) badge.classList.add('is-low');
  document.querySelectorAll('[data-gated]').forEach((node) => {
    node.classList.toggle('is-locked', !hasFullAccess());
  });
}

function paywallCopy() {
  const title = document.getElementById('paywallTitle');
  const kicker = document.getElementById('paywallKicker');
  const copy = document.getElementById('paywallCopy');
  if (hasFullAccess() && !isUnlocked()) {
    if (title) title.textContent = 'Unlock the full forge';
    if (kicker) kicker.textContent = 'Keep export, mix assist, and custom add-ons after the sample';
    if (copy) copy.textContent = 'The preview is still running. Pay 0.05 SOL once to keep full WAV export, AI Mix Assist, and custom add-on imports. Playback stays available either way.';
    return;
  }
  if (isUnlocked()) {
    if (title) title.textContent = 'The forge is unlocked';
    if (kicker) kicker.textContent = 'This browser already has the studio unlock';
    if (copy) copy.textContent = 'WAV export, AI Mix Assist, and custom add-on imports stay open on this browser.';
    return;
  }
  if (title) title.textContent = 'The free sample has ended';
  if (kicker) kicker.textContent = 'Playback stays open. Export, mix assist, and custom add-ons need the unlock';
  if (copy) copy.textContent = 'Your five free minutes are up. Pay 0.05 SOL to unlock the studio, or share Beat Forge for five more minutes. You can keep previewing the sequencer either way.';
}

export function showPaywall() {
  const overlay = document.getElementById('paywallOverlay');
  if (!overlay) return;
  paywallCopy();
  overlay.hidden = false;
  updateTrialBadge();
}

export function hidePaywall() {
  const overlay = document.getElementById('paywallOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  updateTrialBadge();
}

export function openPaywall() {
  showPaywall();
}

function persistUsed(ms) {
  localStorage.setItem(LS_USED_MS, String(Math.max(0, Math.floor(ms))));
}

function tickTrial() {
  const now = Date.now();
  const delta = now - lastTick;
  lastTick = now;
  if (!isUnlocked() && document.visibilityState === 'visible' && remainingMs() > 0 && delta > 0 && delta < 5000) {
    persistUsed(usedMs() + delta);
  }
  updateTrialBadge();
  if (!isUnlocked() && remainingMs() <= 0 && !dismissedWhileLocked) showPaywall();
}

export function requireFullAccess() {
  if (hasFullAccess()) return true;
  dismissedWhileLocked = false;
  showPaywall();
  setPaywallStatus('That part of the forge needs an active sample or the 0.05 SOL unlock.', 'error');
  return false;
}

function extractSignature(raw) {
  const text = (raw || '').trim();
  if (!text) return '';
  const urlMatch = text.match(/(?:solscan\.io|solana\.fm|explorer\.solana\.com)\/(?:tx|transaction)\/([1-9A-HJ-NP-Za-km-z]+)/i);
  if (urlMatch) return urlMatch[1];
  const sigMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{80,90}/);
  return sigMatch ? sigMatch[0] : '';
}

function collectAccountKeys(tx) {
  const keys = [];
  const accountKeys = (tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || [];
  accountKeys.forEach((key) => {
    keys.push(typeof key === 'string' ? key : key.pubkey);
  });
  const loaded = tx.meta && tx.meta.loadedAddresses;
  if (loaded) {
    (loaded.writable || []).forEach((key) => keys.push(key));
    (loaded.readonly || []).forEach((key) => keys.push(key));
  }
  return keys;
}

function recipientGainLamports(tx, address) {
  const keys = collectAccountKeys(tx);
  const index = keys.indexOf(address);
  if (index === -1) return 0;
  const pre = (tx.meta.preBalances || [])[index];
  const post = (tx.meta.postBalances || [])[index];
  if (!Number.isFinite(pre) || !Number.isFinite(post)) return 0;
  return post - pre;
}

async function verifyPaymentSignature(signature) {
  const used = getUsedSignatures();
  if (used.includes(signature)) throw new Error('This signature has already been used in this browser.');

  const response = await fetch(SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]
    })
  });
  if (!response.ok) throw new Error('The Solana network could not be reached. Please try again in a moment.');
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || 'The Solana network rejected that lookup.');
  const tx = body.result;
  if (!tx) throw new Error('That transaction was not found yet. Wait a few seconds, then try again.');
  if (tx.meta == null || tx.meta.err) throw new Error('That transaction did not succeed on-chain.');
  const ageMs = Date.now() - (tx.blockTime || 0) * 1000;
  if (!tx.blockTime || ageMs > PAYMENT_MAX_AGE_MS || ageMs < -60 * 1000) {
    throw new Error('That payment is older than 7 days, or has no timestamp.');
  }
  const gain = recipientGainLamports(tx, PAYMENT_ADDRESS);
  if (gain < MIN_LAMPORTS) {
    throw new Error(`That transaction did not send at least ${UNLOCK_PRICE_SOL} SOL to the unlock address.`);
  }
  const latestUsed = getUsedSignatures();
  if (latestUsed.includes(signature)) throw new Error('This signature has already been used in this browser.');
  latestUsed.push(signature);
  localStorage.setItem(LS_USED_SIGS, JSON.stringify(latestUsed));
  localStorage.setItem(LS_UNLOCKED, '1');
  dismissedWhileLocked = false;
}

async function grantShareBonus() {
  if (hasShared() || isUnlocked()) return false;
  const text = SHARE_TEXT;
  let shared = false;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Mirmobe Beat Forge', text, url: SITE_URL });
      shared = true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
    }
  }
  if (!shared) {
    const intent = `https://x.com/intent/post?text=${encodeURIComponent(`${text} ${SITE_URL}`)}`;
    window.open(intent, '_blank', 'noopener,noreferrer');
  }
  localStorage.setItem(LS_SHARED, '1');
  dismissedWhileLocked = false;
  lastTick = Date.now();
  updateShareButton();
  updateTrialBadge();
  if (remainingMs() > 0) hidePaywall();
  return true;
}

function updateShareButton() {
  const button = document.getElementById('shareBonusBtn');
  if (!button) return;
  if (isUnlocked()) {
    button.disabled = true;
    button.textContent = 'Studio unlocked';
    return;
  }
  if (hasShared()) {
    button.disabled = true;
    button.textContent = 'Bonus claimed — enjoy your extra 5 minutes';
  }
}

function drawQr() {
  const holder = document.getElementById('payQr');
  if (!holder) return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(SOLANA_PAY_URL);
    qr.make();
    holder.innerHTML = qr.createSvgTag(4, 8, 'Solana Pay code for the Beat Forge unlock');
  } catch (err) {
    holder.textContent = PAYMENT_ADDRESS;
  }
}

export function initPaywall() {
  if (started) return;
  started = true;
  const amount = `${UNLOCK_PRICE_SOL} SOL`;
  const amountLabel = document.getElementById('payAmountLabel');
  const amountHero = document.getElementById('payAmountHero');
  const addressEl = document.getElementById('payAddressDisplay');
  const payLink = document.getElementById('phantomPayLink');
  if (amountLabel) amountLabel.textContent = amount;
  if (amountHero) amountHero.textContent = amount;
  if (addressEl) addressEl.textContent = PAYMENT_ADDRESS;
  if (payLink) payLink.href = SOLANA_PAY_URL;
  drawQr();

  document.getElementById('copyPayAddressBtn')?.addEventListener('click', async () => {
    const button = document.getElementById('copyPayAddressBtn');
    try {
      await navigator.clipboard.writeText(PAYMENT_ADDRESS);
      if (button) button.textContent = 'Copied';
      setTimeout(() => { if (button) button.textContent = 'Copy'; }, 1600);
    } catch (err) {
      setPaywallStatus('Copy failed. Select the address and copy it manually.', 'error');
    }
  });

  document.getElementById('shareBonusBtn')?.addEventListener('click', () => {
    grantShareBonus();
  });

  document.getElementById('verifyPayBtn')?.addEventListener('click', async () => {
    const signature = extractSignature(document.getElementById('txSigInput').value);
    if (!signature) {
      setPaywallStatus('Paste a valid Solana transaction signature first.', 'error');
      return;
    }
    const button = document.getElementById('verifyPayBtn');
    button.disabled = true;
    setPaywallStatus('Checking the chain…', 'pending');
    try {
      await verifyPaymentSignature(signature);
      setPaywallStatus('Payment confirmed. Beat Forge is unlocked on this browser.', 'ok');
      hidePaywall();
      updateTrialBadge();
    } catch (err) {
      setPaywallStatus(err && err.message ? err.message : 'Could not verify that payment.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('openPaywallBtn')?.addEventListener('click', () => openPaywall());
  document.getElementById('dismissPaywallBtn')?.addEventListener('click', () => {
    if (!hasFullAccess()) dismissedWhileLocked = true;
    hidePaywall();
  });

  updateShareButton();
  lastTick = Date.now();
  document.addEventListener('visibilitychange', () => {
    lastTick = Date.now();
    tickTrial();
  });
  window.setInterval(tickTrial, 250);
  tickTrial();
}

export function paymentAddress() {
  return PAYMENT_ADDRESS;
}
