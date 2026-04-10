/**
 * FusionLabPanel — Controls for proton synthesis, fusion reactions, and molecule synthesis.
 * Sections are shown/hidden based on upgrade purchases.
 */
export class FusionLabPanel {
  constructor(EventBus, upgradeSystem, protonSynthesisEngine, fusionEngine, moleculeEngine, resourceManager) {
    this.bus = EventBus;
    this.upgradeSystem = upgradeSystem;
    this.pse = protonSynthesisEngine;
    this.fusionEngine = fusionEngine;
    this.moleculeEngine = moleculeEngine;
    this.resourceManager = resourceManager;
    this.container = null;
  }

  init() {
    this.container = document.getElementById('fusion-lab-body');
    if (!this.container) return;

    this._render();

    this.bus.on('upgrade:purchased', () => this._render());
    this.bus.on('milestone:triggered', () => this._render());
    this.bus.on('resource:visibility:changed', () => this._render());

    // Panel header collapse/expand
    const header = document.getElementById('fusion-lab-panel-header');
    if (header) {
      header.addEventListener('click', () => {
        const body = document.getElementById('fusion-lab-body');
        const panel = document.getElementById('fusion-lab-panel');
        const icon = header.querySelector('.collapse-icon');
        if (!body) return;
        const collapsed = body.classList.toggle('collapsed');
        if (panel) panel.classList.toggle('panel-collapsed', collapsed);
        if (icon) icon.textContent = collapsed ? '▼' : '▲';
      });
    }

    // Toolbar button toggles panel visibility
    const toggleBtn = document.getElementById('fusion-lab-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const panel = document.getElementById('fusion-lab-panel');
        if (panel) panel.classList.toggle('hidden');
      });
    }

    // Tick update for rate display
    setInterval(() => this._updateRates(), 500);
  }

  _render() {
    if (!this.container) return;
    this.container.innerHTML = '';

    const protonPurchased   = this.upgradeSystem.getLevel('upg_protonForge') >= 1;
    const fusionPurchased   = this.upgradeSystem.getLevel('upg_fusionIgnition') >= 1;
    const redGiantPurchased = this.upgradeSystem.getLevel('upg_redGiantCatalyst') >= 1;

    // Check if any molecule is visible
    const moleculesVisible = ['mol_h2o','mol_co2','mol_ch4','mol_fe2o3'].some(id => {
      const s = this.resourceManager?.get(id);
      return s?.visible;
    });

    // Placeholder if nothing unlocked yet
    if (!protonPurchased && !fusionPurchased && !redGiantPurchased && !moleculesVisible) {
      this.container.innerHTML = `<p class="fusion-lab-hint">Purchase <strong>Proton Forge</strong> in Upgrades to unlock fusion controls.</p>`;
      return;
    }

    if (protonPurchased) this._renderProtonSection();
    if (fusionPurchased) this._renderHToHeSection();
    if (redGiantPurchased) this._renderHeToCOSection();
    if (moleculesVisible) this._renderMoleculesSection();
  }

  _renderProtonSection() {
    const section = document.createElement('div');
    section.className = 'fusion-lab-section';
    section.id = 'fl-proton';

    const frac = this.pse.getSliderFraction();
    const pct = Math.round(frac * 100);

    section.innerHTML = `
      <div class="fl-section-title">⚗️ Proton Synthesis</div>
      <div class="fl-row">
        <span class="fl-label">Energy → H</span>
        <span class="fl-rate" id="fl-proton-rate">--</span>
        <input type="range" id="fl-proton-slider" min="0" max="100" value="${pct}" class="fl-slider">
        <span class="fl-pct" id="fl-proton-pct">${pct}%</span>
      </div>
    `;
    this.container.appendChild(section);

    const slider = section.querySelector('#fl-proton-slider');
    const pctLabel = section.querySelector('#fl-proton-pct');
    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value) / 100;
      this.pse.setSliderFraction(val);
      pctLabel.textContent = `${e.target.value}%`;
      this.bus.emit('fusionLab:protonSlider', { value: val });
    });
  }

  _renderHToHeSection() {
    const section = document.createElement('div');
    section.className = 'fusion-lab-section';
    section.id = 'fl-htohe';

    const throttle = this.fusionEngine.getHToHeThrottle();
    const pct = Math.round(throttle * 100);

    section.innerHTML = `
      <div class="fl-section-title">⚡ Hydrogen Fusion  <span class="fl-tag">4H → He</span></div>
      <div class="fl-row">
        <span class="fl-label">Throttle</span>
        <span class="fl-rate" id="fl-htohe-rate">--</span>
        <input type="range" id="fl-htohe-slider" min="0" max="100" value="${pct}" class="fl-slider">
        <span class="fl-pct" id="fl-htohe-pct">${pct}%</span>
      </div>
    `;
    this.container.appendChild(section);

    const slider = section.querySelector('#fl-htohe-slider');
    const pctLabel = section.querySelector('#fl-htohe-pct');
    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value) / 100;
      this.fusionEngine.setHToHeThrottle(val);
      pctLabel.textContent = `${e.target.value}%`;
    });
  }

  _renderHeToCOSection() {
    const section = document.createElement('div');
    section.className = 'fusion-lab-section';
    section.id = 'fl-heto-co';

    const split = this.fusionEngine.getCOSplit();
    const cPct = Math.round(split * 100);
    const oPct = 100 - cPct;

    section.innerHTML = `
      <div class="fl-section-title">🔴 Red Giant Fusion  <span class="fl-tag">He → C / O</span></div>
      <div class="fl-row">
        <span class="fl-label">C ↔ O split</span>
        <span class="fl-split-label" id="fl-co-labels">C: ${cPct}% / O: ${oPct}%</span>
        <input type="range" id="fl-co-slider" min="0" max="100" value="${cPct}" class="fl-slider">
      </div>
    `;
    this.container.appendChild(section);

    const slider = section.querySelector('#fl-co-slider');
    const labels = section.querySelector('#fl-co-labels');
    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value) / 100;
      this.fusionEngine.setCOSplit(val);
      const c = e.target.value;
      const o = 100 - c;
      labels.textContent = `C: ${c}% / O: ${o}%`;
    });
  }

  _renderMoleculesSection() {
    const section = document.createElement('div');
    section.className = 'fusion-lab-section';
    section.id = 'fl-molecules';

    const LABELS = { mol_h2o: 'H₂O', mol_co2: 'CO₂', mol_ch4: 'CH₄', mol_fe2o3: 'Fe₂O₃' };

    let rows = '';
    for (const [id, label] of Object.entries(LABELS)) {
      const s = this.resourceManager?.get(id);
      if (!s?.visible) continue;
      const enabled = this.moleculeEngine.isEnabled(id);
      rows += `
        <div class="fl-mol-row">
          <span class="fl-mol-label">${label}</span>
          <label class="fl-toggle">
            <input type="checkbox" data-mol="${id}" ${enabled ? 'checked' : ''}>
            <span class="fl-toggle-slider"></span>
          </label>
        </div>
      `;
    }
    if (!rows) return;

    section.innerHTML = `
      <div class="fl-section-title">🧪 Molecule Synthesis</div>
      ${rows}
    `;
    this.container.appendChild(section);

    section.querySelectorAll('[data-mol]').forEach(input => {
      input.addEventListener('change', (e) => {
        this.moleculeEngine.setEnabled(e.target.dataset.mol, e.target.checked);
      });
    });
  }

  _updateRates() {
    // Update Proton Synthesis rate display
    const protonEl = document.getElementById('fl-proton-rate');
    if (protonEl && this.pse.isUnlocked()) {
      const frac = this.pse.getSliderFraction();
      // Rough estimate: base rate 1 H/s × multipliers × fraction
      const nucLevel = this.upgradeSystem.getLevel('upg_quantumNucleogenesis') || 0;
      const rateMult = Math.pow(1.5, nucLevel);
      const rate = 1.0 * rateMult * frac;
      protonEl.textContent = `${rate.toFixed(2)} H/s`;
    }
  }
}
