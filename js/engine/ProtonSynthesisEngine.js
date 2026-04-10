/**
 * ProtonSynthesisEngine
 * Converts energy → hydrogen at a slider-controlled rate, scaled by upgrades.
 * Rate = baseRate × sliderFraction × rateMult × costMult
 *   baseRate:    1 hydrogen per second at 100% slider (before upgrades)
 *   rateMult:    ×1.5 per level of upg_quantumNucleogenesis
 *   costMult:    ×0.85 per level of upg_energyDensity (reduces energy cost per H)
 * Energy cost = (1 / costMult) × hydrogenProduced
 */
export class ProtonSynthesisEngine {
  /** @param {import('./ResourceManager.js?v=62753f8').ResourceManager} resourceManager */
  constructor(resourceManager) {
    this._resourceManager = resourceManager;
    this._sliderFraction = 0;   // 0..1 set by UI slider
    this._upgradeSystem  = null; // injected after construction
    this._unlocked       = false;
  }

  /** Called once the UpgradeSystem is available */
  setUpgradeSystem(upgradeSystem) {
    this._upgradeSystem = upgradeSystem;
  }

  /** Called when upg_protonForge is purchased */
  unlock() {
    this._unlocked = true;
  }

  /** @param {number} fraction 0..1 */
  setSliderFraction(fraction) {
    this._sliderFraction = Math.max(0, Math.min(1, fraction));
  }

  getSliderFraction() {
    return this._sliderFraction;
  }

  isUnlocked() {
    return this._unlocked;
  }

  /**
   * @param {number} dt  Elapsed seconds
   */
  tick(dt) {
    if (!this._unlocked || this._sliderFraction <= 0) return;

    const up = this._upgradeSystem;
    const nucleoLevel = up ? (up.getLevel('upg_quantumNucleogenesis') || 0) : 0;
    const densityLevel = up ? (up.getLevel('upg_energyDensity') || 0) : 0;

    const rateMult = Math.pow(1.5, nucleoLevel);
    const costMult = Math.pow(0.85, densityLevel);  // < 1 → cheaper per H

    // Hydrogen produced this tick
    const hRate = 1.0 * rateMult * this._sliderFraction; // H/s
    const hProduced = hRate * dt;

    // Energy consumed this tick
    const energyCostPerH = 1.0 / costMult;
    const energyNeeded = hProduced * energyCostPerH;

    const energyState = this._resourceManager.get('energy');
    const energyAvailable = energyState ? energyState.currentValue : 0;

    if (energyAvailable < energyNeeded * 0.001) return; // not enough energy

    const fraction = Math.min(1, energyAvailable / energyNeeded);
    this._resourceManager.spend('energy', energyNeeded * fraction);
    this._resourceManager.add('hydrogen', hProduced * fraction);
  }

  /** Returns serialisable state */
  getState() {
    return {
      unlocked: this._unlocked,
      sliderFraction: this._sliderFraction,
    };
  }

  /** Restores state from a save object */
  loadState(state) {
    if (!state) return;
    this._unlocked       = Boolean(state.unlocked);
    this._sliderFraction = typeof state.sliderFraction === 'number' ? state.sliderFraction : 0;
  }

  reset() {
    this._unlocked       = false;
    this._sliderFraction = 0;
  }
}
