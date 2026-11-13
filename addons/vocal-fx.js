// Vocal FX Rack — one-click chains mapped onto the channel strip.

const CHAINS = [
  { id: 'crisp', name: 'Crisp Studio', eqLow: -5, eqMid: 1.5, eqHigh: 4, reverb: 0.12, delay: 0.06, drive: 0.08, volume: 0.82 },
  { id: 'tape', name: 'Warm Tape', eqLow: 3, eqMid: -1, eqHigh: -3.5, reverb: 0.08, delay: 0.04, drive: 0.42, volume: 0.78 },
  { id: 'radio', name: 'Radio Lo-Fi', eqLow: -2, eqMid: 4, eqHigh: -6, reverb: 0.05, delay: 0.08, drive: 0.55, volume: 0.74 },
  { id: 'shimmer', name: 'Shimmer Echo', eqLow: -3, eqMid: 0.5, eqHigh: 5, reverb: 0.42, delay: 0.38, drive: 0.12, volume: 0.76 }
];

export function activate(api) {
  CHAINS.forEach((chain) => api.registerVocalChain({ ...chain, group: 'vocal-fx' }));
}

export function deactivate(api) {
  api.clearVocalGroup('vocal-fx');
}

export function mount(container, api) {
  container.innerHTML = `
    <header class="addon-head">
      <h3>Vocal FX Rack</h3>
      <p>Print a chain onto the demo loop or the latest vocal takes.</p>
    </header>
    <div class="preset-row"></div>
  `;
  const row = container.querySelector('.preset-row');
  CHAINS.forEach((chain) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip-btn';
    button.dataset.chain = chain.id;
    button.textContent = chain.name;
    button.addEventListener('click', () => api.applyVocalChain(chain.id));
    row.appendChild(button);
  });
  return () => {
    container.innerHTML = '';
  };
}
