// Mirmobe Beat Forge — static studio entry.

import { state } from './state.js';
import { initUi } from './ui.js';
import { initPaywall, hasFullAccess } from './paywall.js';
import { initAddons } from './addons.js';

window.MirmobeBeatForge = {
  get state() {
    return state;
  },
  hasFullAccess,
  lastExport: null
};

initUi();
initPaywall();
initAddons().catch(() => {
  const status = document.getElementById('addonImportStatus');
  if (status) status.textContent = 'Built-in add-ons could not be loaded.';
});
