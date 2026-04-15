/**
 * ParticleForgePanel — UI for subatomic particle management.
 *
 * Shows quark counts, hadron formation controls, electron generation status,
 * and subatomic particle counts with their passive bonuses.
 */

export class ParticleForgePanel {
  #container = null;
  #subatomicEngine = null;
  #resourceManager = null;
  #eventBus = null;
  #visible = false;

  constructor(subatomicEngine, resourceManager, EventBus) {
    this.#subatomicEngine = subatomicEngine;
    this.#resourceManager = resourceManager;
    this.#eventBus = EventBus;
  }

  init() {
    this.#container = document.getElementById('particle-forge-panel');
    if (!this.#container) {
      this.#container = this._createPanel();
    }
    this._bindEvents();
    this.hide();
  }

  _createPanel() {
    const el = document.createElement('div');
    el.id = 'particle-forge-panel';
    el.className = 'particle-forge-panel hidden';
    el.innerHTML = `
      <h3 class="forge-title">⚛ Particle Forge</h3>
      <div class="forge-section">
        <div class="forge-quarks">
          <div class="forge-row"><span class="forge-label">Up Quarks:</span> <span id="forge-quark-up">0</span></div>
          <div class="forge-row"><span class="forge-label">Down Quarks:</span> <span id="forge-quark-down">0</span></div>
        </div>
        <div class="forge-controls">
          <label class="forge-toggle">
            <input type="checkbox" id="forge-auto-proton"> Auto-form Protons (2↑ + 1↓)
          </label>
          <label class="forge-toggle">
            <input type="checkbox" id="forge-auto-neutron"> Auto-form Neutrons (1↑ + 2↓)
          </label>
        </div>
      </div>
      <div class="forge-section">
        <div class="forge-particles">
          <div class="forge-row proton-row">
            <span class="forge-label">Protons:</span>
            <span id="forge-proton-count">0</span> / <span id="forge-proton-cap">12</span>
            <span class="forge-bonus" id="forge-proton-bonus"></span>
          </div>
          <div class="forge-row neutron-row">
            <span class="forge-label">Neutrons:</span>
            <span id="forge-neutron-count">0</span> / <span id="forge-neutron-cap">12</span>
            <span class="forge-bonus" id="forge-neutron-bonus"></span>
          </div>
          <div class="forge-row electron-row">
            <span class="forge-label">Electrons:</span>
            <span id="forge-electron-count">0</span> / <span id="forge-electron-cap">24</span>
            <span class="forge-bonus" id="forge-electron-bonus"></span>
          </div>
        </div>
      </div>
    `;
    // Insert after quark panel if it exists, otherwise append to body
    const quarkPanel = document.getElementById('quark-panel');
    if (quarkPanel && quarkPanel.parentNode) {
      quarkPanel.parentNode.insertBefore(el, quarkPanel.nextSibling);
    } else {
      document.body.appendChild(el);
    }
    return el;
  }

  _bindEvents() {
    const protonCb = this.#container.querySelector('#forge-auto-proton');
    const neutronCb = this.#container.querySelector('#forge-auto-neutron');

    if (protonCb) {
      protonCb.addEventListener('change', () => {
        this.#subatomicEngine.setAutoFormProtons(protonCb.checked);
      });
    }
    if (neutronCb) {
      neutronCb.addEventListener('change', () => {
        this.#subatomicEngine.setAutoFormNeutrons(neutronCb.checked);
      });
    }
  }

  /** Refresh displayed counts and bonuses. Called from game loop. */
  refresh() {
    if (!this.#visible || !this.#container) return;
    const rm = this.#resourceManager;
    const se = this.#subatomicEngine;

    const setTxt = (id, val) => {
      const el = this.#container.querySelector(`#${id}`);
      if (el) el.textContent = val;
    };

    setTxt('forge-quark-up', Math.floor(rm.get('quark_up')?.currentValue ?? 0));
    setTxt('forge-quark-down', Math.floor(rm.get('quark_down')?.currentValue ?? 0));

    const proton = rm.get('proton');
    const neutron = rm.get('neutron');
    const electron = rm.get('electron');

    setTxt('forge-proton-count', Math.floor(proton?.currentValue ?? 0));
    setTxt('forge-neutron-count', Math.floor(neutron?.currentValue ?? 0));
    setTxt('forge-electron-count', Math.floor(electron?.currentValue ?? 0));

    // Caps come from SubatomicEngine's effective cap calc
    // For now, use resource cap as base
    setTxt('forge-proton-cap', proton?.cap ?? 12);
    setTxt('forge-neutron-cap', neutron?.cap ?? 12);
    setTxt('forge-electron-cap', electron?.cap ?? 24);

    const bonuses = se.getPassiveBonuses();
    setTxt('forge-proton-bonus', bonuses.energyRateBonus > 0
      ? `(+${(bonuses.energyRateBonus * 100).toFixed(0)}% energy rate)` : '');
    setTxt('forge-neutron-bonus', bonuses.stabilityBonus > 0
      ? `(+${(bonuses.stabilityBonus * 100).toFixed(0)}% stability)` : '');
    setTxt('forge-electron-bonus', bonuses.attractRadiusBonus > 0
      ? `(+${(bonuses.attractRadiusBonus * 100).toFixed(1)}% attract radius)` : '');

    // Sync checkbox state
    const protonCb = this.#container.querySelector('#forge-auto-proton');
    const neutronCb = this.#container.querySelector('#forge-auto-neutron');
    if (protonCb) protonCb.checked = se.getAutoFormProtons();
    if (neutronCb) neutronCb.checked = se.getAutoFormNeutrons();
  }

  show() {
    if (!this.#container) return;
    this.#visible = true;
    this.#container.classList.remove('hidden');
  }

  hide() {
    if (!this.#container) return;
    this.#visible = false;
    this.#container.classList.add('hidden');
  }

  isVisible() { return this.#visible; }
}
