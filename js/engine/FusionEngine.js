/**
 * FusionEngine — Drives elemental fusion reactions based on active star stages.
 *
 * Reactions:
 *   main_sequence : 4H  → 1He  (1.0 He/s base)
 *   red_giant     : 3He → 1C   (0.3 C/s base)
 *                   4He → 1O   (0.3 O/s base)
 *   supernova     : burst +10 Fe on stage entry
 */

export class FusionEngine {
  /** @type {import('../core/EventBus.js?v=0ba458a').EventBus} */
  #eventBus;
  /** @type {import('./ResourceManager.js?v=0ba458a').ResourceManager} */
  #resourceManager;
  /** @type {Map<string, string>} starId → current stage */
  #starStages = new Map();
  /** @type {number} multiplier for H→He rate */
  #hFusionMult = 1.0;
  /** @type {number} multiplier for He→C/O rate */
  #heFusionMult = 1.0;
  /** @type {number} multiplier for supernova Fe burst */
  #ironYieldMult = 1.0;
  /** @type {Set<string>} elements that have been produced at least once */
  #firstProduced = new Set();
  /** @type {import('./UpgradeSystem.js?v=0ba458a').UpgradeSystem|null} */
  #upgradeSystem = null;
  /** @type {number} 0-1 throttle for H→He reaction */
  #hToHeThrottle = 1.0;
  /** @type {number} 0-1 split: fraction of He reactions that go → C (remainder → O) */
  #cOSplit = 0.5;

  // Base rates
  static #BASE_HE_PER_SEC = 1.0;
  static #BASE_C_PER_SEC  = 0.3;
  static #BASE_O_PER_SEC  = 0.3;
  static #SUPERNOVA_FE    = 10;

  constructor(EventBus, resourceManager) {
    this.#eventBus = EventBus;
    this.#resourceManager = resourceManager;

    this.#eventBus.on('star:created', ({ starId }) => {
      this.#starStages.set(starId, 'main_sequence');
    });

    this.#eventBus.on('star:stage:changed', ({ starId, newStage }) => {
      this.#starStages.set(starId, newStage);
      if (newStage === 'supernova') {
        const amount = FusionEngine.#SUPERNOVA_FE * this.#ironYieldMult;
        this.#resourceManager.add('iron', amount);
        this.#notifyFirst('iron', amount);
      }
    });
  }

  // ── Tick ─────────────────────────────────────────────────────────────

  /**
   * Advance all fusion reactions by dt seconds.
   * @param {number} dt
   */
  tick(dt) {
    const fusionUnlocked   = !this.#upgradeSystem || this.#upgradeSystem.getLevel('upg_fusionIgnition') >= 1;
    const redGiantUnlocked = !this.#upgradeSystem || this.#upgradeSystem.getLevel('upg_redGiantCatalyst') >= 1;

    for (const [, stage] of this.#starStages) {
      if (stage === 'main_sequence' && fusionUnlocked) {
        this.#runHtoHe(dt);
      } else if (stage === 'red_giant' && redGiantUnlocked) {
        this.#runHetoC(dt);
        this.#runHetoO(dt);
      }
    }
  }

  // ── Reactions ─────────────────────────────────────────────────────────

  #runHtoHe(dt) {
    const heRate = FusionEngine.#BASE_HE_PER_SEC * this.#hFusionMult * this.#hToHeThrottle;
    const heTarget = heRate * dt;
    const hNeeded  = heTarget * 4;

    const hState = this.#resourceManager.get('hydrogen');
    if (!hState || hState.currentValue < hNeeded * 0.001) return;

    const fraction = Math.min(1, hState.currentValue / hNeeded);
    this.#resourceManager.spend('hydrogen', hNeeded * fraction);
    const heProduced = heTarget * fraction;
    this.#resourceManager.add('helium', heProduced);
    this.#notifyFirst('helium', heProduced);
  }

  #runHetoC(dt) {
    const cRate   = FusionEngine.#BASE_C_PER_SEC * this.#heFusionMult * this.#cOSplit;
    const cTarget = cRate * dt;
    const hNeeded = cTarget * 3;

    const heState = this.#resourceManager.get('helium');
    if (!heState || heState.currentValue < hNeeded * 0.001) return;

    const fraction = Math.min(1, heState.currentValue / hNeeded);
    this.#resourceManager.spend('helium', hNeeded * fraction);
    const cProduced = cTarget * fraction;
    this.#resourceManager.add('carbon', cProduced);
    this.#notifyFirst('carbon', cProduced);
  }

  #runHetoO(dt) {
    const oRate   = FusionEngine.#BASE_O_PER_SEC * this.#heFusionMult * (1 - this.#cOSplit);
    const oTarget = oRate * dt;
    const hNeeded = oTarget * 4;

    const heState = this.#resourceManager.get('helium');
    if (!heState || heState.currentValue < hNeeded * 0.001) return;

    const fraction = Math.min(1, heState.currentValue / hNeeded);
    this.#resourceManager.spend('helium', hNeeded * fraction);
    const oProduced = oTarget * fraction;
    this.#resourceManager.add('oxygen', oProduced);
    this.#notifyFirst('oxygen', oProduced);
  }

  #notifyFirst(element, amount) {
    if (amount > 0 && !this.#firstProduced.has(element)) {
      this.#firstProduced.add(element);
      this.#eventBus.emit('fusion:element:first', { element });
    }
  }

  // ── Multiplier setters ────────────────────────────────────────────────

  setUpgradeSystem(us) { this.#upgradeSystem = us; }
  setHToHeThrottle(t) { this.#hToHeThrottle = Math.max(0, Math.min(1, t)); }
  getHToHeThrottle() { return this.#hToHeThrottle; }
  setCOSplit(s) { this.#cOSplit = Math.max(0, Math.min(1, s)); }
  getCOSplit() { return this.#cOSplit; }

  setHFusionMult(n) { this.#hFusionMult = n; }
  setHeFusionMult(n) { this.#heFusionMult = n; }
  setIronYieldMult(n) { this.#ironYieldMult = n; }

  /**
   * Re-read all fusion-related upgrade effects and update multipliers.
   * @param {import('./UpgradeSystem.js?v=0ba458a').UpgradeSystem} upgradeSystem
   */
  recalculateMults(upgradeSystem) {
    let hMult = 1.0;
    let heMult = 1.0;
    let ironMult = 1.0;
    for (const effect of upgradeSystem.getPurchasedEffects()) {
      if (effect.effectType === 'hFusionMult')    hMult    *= effect.effectMagnitude;
      if (effect.effectType === 'heFusionMult')   heMult   *= effect.effectMagnitude;
      if (effect.effectType === 'ironYieldMult')  ironMult *= effect.effectMagnitude;
    }
    this.#hFusionMult    = hMult;
    this.#heFusionMult   = heMult;
    this.#ironYieldMult  = ironMult;
  }

  /**
   * Seed star stages from StarManager state (called after save load).
   * @param {object[]} starStates — from starManager.getStates()
   */
  syncFromStarManager(starStates) {
    for (const star of starStates) {
      this.#starStages.set(star.id, star.stage);
    }
  }

  /** Current effective rates for all fusion reactions (units/s). */
  getCurrentRates() {
    const fusionUnlocked   = !this.#upgradeSystem || this.#upgradeSystem.getLevel('upg_fusionIgnition') >= 1;
    const redGiantUnlocked = !this.#upgradeSystem || this.#upgradeSystem.getLevel('upg_redGiantCatalyst') >= 1;
    const hasStarStage = (stage) => [...this.#starStages.values()].includes(stage);

    const heRate = (fusionUnlocked && hasStarStage('main_sequence'))
      ? FusionEngine.#BASE_HE_PER_SEC * this.#hFusionMult * this.#hToHeThrottle : 0;
    const cRate = (redGiantUnlocked && hasStarStage('red_giant'))
      ? FusionEngine.#BASE_C_PER_SEC * this.#heFusionMult * this.#cOSplit : 0;
    const oRate = (redGiantUnlocked && hasStarStage('red_giant'))
      ? FusionEngine.#BASE_O_PER_SEC * this.#heFusionMult * (1 - this.#cOSplit) : 0;

    return {
      hConsumed: heRate * 4,
      heProduced: heRate,
      heConsumed: cRate * 3 + oRate * 4,
      cProduced: cRate,
      oProduced: oRate,
    };
  }

  getState() {
    return { hToHeThrottle: this.#hToHeThrottle, cOSplit: this.#cOSplit };
  }

  loadState(state) {
    if (!state) return;
    this.#hToHeThrottle = state.hToHeThrottle ?? 1.0;
    this.#cOSplit       = state.cOSplit ?? 0.5;
  }

  reset() {
    this.#starStages = new Map();
    this.#firstProduced = new Set();
  }
}
