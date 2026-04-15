/**
 * QuarkPanel — UI for quark flavour allocation sliders.
 *
 * Shows 6 colour-coded sliders (one per quark flavour) that sum to 100%.
 * Displays real-time bonus values and a colour preview swatch.
 * Appears after first Epoch Collapse when Quark Sight is purchased.
 */

export class QuarkPanel {
  #container = null;
  #quarkEngine = null;
  #eventBus = null;
  #sliders = {};    // { flavourId: HTMLInputElement }
  #labels = {};     // { flavourId: HTMLElement }
  #bonusEls = {};   // { flavourId: HTMLElement }
  #swatchEl = null;
  #visible = false;

  // Human-readable bonus descriptions per flavour
  static BONUS_LABELS = {
    up:      'Energy rate',
    down:    'Mote spawn',
    charm:   'Absorption',
    strange: 'Energy cap',
    top:     'Attraction',
    bottom:  'Cost reduction',
  };

  constructor(EventBus, quarkEngine) {
    this.#eventBus = EventBus;
    this.#quarkEngine = quarkEngine;
  }

  init() {
    this.#container = document.getElementById('quark-panel');
    if (!this.#container) {
      this.#container = this._createPanel();
    }

    this._buildSliders();

    // Listen for unlock
    this.#eventBus.on('quarks:unlocked', () => this.show());

    // Update bonus displays periodically
    this.#eventBus.on('resource:updated', (data) => {
      if (data?.resourceId === 'energy' && this.#visible) {
        this._refreshBonuses();
      }
    });

    // If already unlocked on load, show immediately
    if (this.#quarkEngine.isUnlocked()) this.show();
  }

  _createPanel() {
    const el = document.createElement('div');
    el.id = 'quark-panel';
    el.className = 'quark-panel hidden';
    el.innerHTML = `
      <div class="quark-panel-header">
        <h3>Quark Flavours</h3>
        <div class="quark-swatch" id="quark-swatch"></div>
      </div>
      <div class="quark-sliders" id="quark-sliders"></div>
    `;
    // Insert before game-canvas or at end of body
    const gameArea = document.querySelector('.game-container') || document.body;
    gameArea.appendChild(el);
    return el;
  }

  _buildSliders() {
    const slidersContainer = this.#container.querySelector('#quark-sliders')
      || this.#container.querySelector('.quark-sliders');
    if (!slidersContainer) return;
    slidersContainer.innerHTML = '';

    this.#swatchEl = this.#container.querySelector('#quark-swatch')
      || this.#container.querySelector('.quark-swatch');

    const flavours = this.#quarkEngine.getFlavours();
    const allocs = this.#quarkEngine.getAllocations();

    for (const f of flavours) {
      const row = document.createElement('div');
      row.className = 'quark-slider-row';

      const label = document.createElement('span');
      label.className = 'quark-label';
      label.style.color = f.color;
      label.textContent = f.id.charAt(0).toUpperCase() + f.id.slice(1);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.step = '1';
      slider.value = Math.round((allocs[f.id] ?? 0) * 100);
      slider.className = 'quark-slider';
      slider.style.accentColor = f.color;

      const pctLabel = document.createElement('span');
      pctLabel.className = 'quark-pct';
      pctLabel.textContent = `${slider.value}%`;

      const bonusLabel = document.createElement('span');
      bonusLabel.className = 'quark-bonus';
      bonusLabel.textContent = QuarkPanel.BONUS_LABELS[f.id] || '';

      slider.addEventListener('input', () => {
        const pct = parseInt(slider.value, 10);
        this.#quarkEngine.setAllocation(f.id, pct / 100);

        // Refresh all slider positions to reflect redistribution
        const newAllocs = this.#quarkEngine.getAllocations();
        for (const fl of flavours) {
          const s = this.#sliders[fl.id];
          const l = this.#labels[fl.id];
          if (s && fl.id !== f.id) {
            s.value = Math.round(newAllocs[fl.id] * 100);
          }
          if (l) l.textContent = `${Math.round(newAllocs[fl.id] * 100)}%`;
        }
        pctLabel.textContent = `${pct}%`;
        this._updateSwatch();
        this._refreshBonuses();
      });

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(pctLabel);
      row.appendChild(bonusLabel);
      slidersContainer.appendChild(row);

      this.#sliders[f.id] = slider;
      this.#labels[f.id] = pctLabel;
      this.#bonusEls[f.id] = bonusLabel;
    }

    this._updateSwatch();
  }

  _updateSwatch() {
    if (!this.#swatchEl) return;
    this.#swatchEl.style.backgroundColor = this.#quarkEngine.getBlendedColor();
  }

  _refreshBonuses() {
    const bonuses = this.#quarkEngine.getBonuses();
    for (const f of this.#quarkEngine.getFlavours()) {
      const el = this.#bonusEls[f.id];
      if (!el) continue;
      const val = bonuses[f.id] ?? 0;
      const pct = (val * 100).toFixed(1);
      el.textContent = `${QuarkPanel.BONUS_LABELS[f.id]}: +${pct}%`;
    }
  }

  show() {
    if (!this.#container) return;
    this.#visible = true;
    this.#container.classList.remove('hidden');
    this._refreshBonuses();
  }

  hide() {
    if (!this.#container) return;
    this.#visible = false;
    this.#container.classList.add('hidden');
  }

  isVisible() { return this.#visible; }
}
