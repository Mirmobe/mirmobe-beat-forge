// Mirmobe Beat Forge — static studio entry.

import { state } from './state.js';
import { initUi } from './ui.js';
import { initPaywall, hasFullAccess, PAYWALL_ENABLED } from './paywall.js';
import { initAddons } from './addons.js';
import { initIo } from './io.js';

window.MirmobeBeatForge = {
  get state() {
    return state;
  },
  hasFullAccess,
  PAYWALL_ENABLED,
  lastExport: null
};

initUi();
initPaywall();
initIo();
initAddons().catch(() => {
  const status = document.getElementById('addonImportStatus');
  if (status) status.textContent = 'Built-in add-ons could not be loaded.';
});
