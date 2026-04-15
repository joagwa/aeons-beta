/**
 * ResourceManager — Owns all resource state, handles passive generation,
 * click combos, rate recalculation, and offline gains.
 */

export class ResourceManager {
  /** @type {import('../core/EventBus.js?v=a41dea8').EventBus} */
  #eventBus;
  /** @type {Map<string, object>} resource definitions keyed by id */
  #definitions = new Map();
  /** @type {Map<string, object>} live resource states keyed by id */
  #states = new Map();
  /** @type {import('./UpgradeSystem.js?v=a41dea8').UpgradeSystem | null} */
  #upgradeSystem = null;
  /** @type {Map<string, number>} milestone rate bonuses keyed by resource id */
  #rateBonuses = new Map();
  /** @type {Map<string, number>} persistent cap bonuses (e.g. cosmic echo) keyed by resource id */
  #capBonuses = new Map();
  /** @type {Map<string, number>} dynamic run caps set by prestige (overrides def.cap as base) */
  #dynamicCaps = new Map();
  /** @type {Map<string, number>} persistent rate multipliers (e.g. prestige Quantum Resonance) */
  #persistentRateMultipliers = new Map();
  /** @type {number} combined click multiplier from upgrades */
  #clickMultiplier = 1;
  /** @type {number[]} timestamps of recent clicks for combo detection */
  #clickTimestamps = [];
  /** @type {boolean} */
  #comboActive = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #comboTimer = null;

  /**
   * @param {import('../core/EventBus.js?v=a41dea8').EventBus} EventBus
   */
  constructor(EventBus) {
    this.#eventBus = EventBus;
  }

  // ── Dependency wiring ─────────────────────────────────────────────────

  /** Called from main.js after UpgradeSystem is created. */
  setUpgradeSystem(us) {
    this.#upgradeSystem = us;
  }

  // ── Definitions & initialisation ──────────────────────────────────────

  /**
   * Initialise ResourceState map from an array of ResourceDefinitions.
   * Preserves any states already loaded (e.g. from a save) for matching ids.
   * @param {object[]} resources
   */
  loadDefinitions(resources) {
    this.#definitions.clear();
    for (const def of resources) {
      this.#definitions.set(def.id, def);
      if (!this.#states.has(def.id)) {
        this.#states.set(def.id, {
          id: def.id,
          currentValue: def.initialValue,
          passiveRatePerSec: def.initialRate,
          cap: def.cap,
          displayLabel: def.displayLabel,
          epochId: def.epochId,
          visible: def.visible ?? true,
          derived: def.derived ?? false,
          generationEnabled: true,
        });
      }
    }
  }

  // ── Tick ───────────────────────────────────────────────────────────────

  /**
   * Advance all non-derived resources by dt seconds of passive generation,
   * then recalculate the derived gravity resource.
   * @param {number} dt — seconds since last tick
   */
  tick(dt) {
    for (const [id, state] of this.#states) {
      if (state.derived) continue;
      if (!state.generationEnabled) continue;
      if (state.passiveRatePerSec === 0) continue;

      const prevValue = state.currentValue;
      state.currentValue += state.passiveRatePerSec * dt;

      if (state.cap !== null) {
        state.currentValue = Math.min(state.currentValue, state.cap);
      }

      const delta = state.currentValue - prevValue;
      if (delta !== 0) {
        this.#eventBus.emit('resource:updated', {
          resourceId: id,
          newValue: state.currentValue,
          delta,
          ratePerSec: state.passiveRatePerSec,
        });
      }
    }

    // Recalculate all derived resources
    this.#recalcDerived();
  }

  /** Compute mass from elemental resource amounts */
  #recalcMass() {
    const massState = this.#states.get('mass');
    if (!massState) return;
    const H  = this.#states.get('hydrogen')?.currentValue  ?? 0;
    const He = this.#states.get('helium')?.currentValue    ?? 0;
    const C  = this.#states.get('carbon')?.currentValue    ?? 0;
    const O  = this.#states.get('oxygen')?.currentValue    ?? 0;
    const Fe = this.#states.get('iron')?.currentValue      ?? 0;
    const newMass = H * 1.008 + He * 4.003 + C * 12.011 + O * 15.999 + Fe * 55.845;
    if (newMass !== massState.currentValue) {
      const delta = newMass - massState.currentValue;
      massState.currentValue = newMass;
      this.#eventBus.emit('resource:updated', {
        resourceId: 'mass',
        newValue: newMass,
        delta,
        ratePerSec: 0,
      });
    }
  }

  /** Recalculate all derived resources (mass, then gravity) */
  #recalcDerived() {
    this.#recalcMass();
    this.#recalcGravity();
  }

  /** gravity = sqrt(max(0, mass)) * 0.01 */
  #recalcGravity() {
    const gravityState = this.#states.get('gravity');
    const massState = this.#states.get('mass');
    if (!gravityState || !massState) return;

    const newGravity = Math.sqrt(Math.max(0, massState.currentValue)) * 0.01;
    if (newGravity !== gravityState.currentValue) {
      const delta = newGravity - gravityState.currentValue;
      gravityState.currentValue = newGravity;
      this.#eventBus.emit('resource:updated', {
        resourceId: 'gravity',
        newValue: newGravity,
        delta,
        ratePerSec: 0,
      });
    }
  }

  // ── Mutations ─────────────────────────────────────────────────────────

  /**
   * Add a flat amount to a resource, clamped to its cap.
   * @param {string} id
   * @param {number} amount
   */
  add(id, amount) {
    const state = this.#states.get(id);
    if (!state) return;
    if (state.derived) {
      console.debug(`[ResourceManager] add('${id}') ignored — derived resource`);
      return;
    }

    const prevValue = state.currentValue;
    state.currentValue += amount;
    if (state.cap !== null) {
      state.currentValue = Math.min(state.currentValue, state.cap);
    }

    this.#eventBus.emit('resource:updated', {
      resourceId: id,
      newValue: state.currentValue,
      delta: state.currentValue - prevValue,
      ratePerSec: state.passiveRatePerSec,
    });
  }

  /**
   * Click-based resource addition with combo tracking.
   * 5+ clicks within 3 s activates a 2× combo for 3 s.
   * @param {string} id
   * @param {number} amount — base click value (pre-combo)
   */
  addClick(id, amount) {
    const now = Date.now();
    this.#clickTimestamps.push(now);
    this.#clickTimestamps = this.#clickTimestamps.filter((t) => now - t <= 3000);

    if (this.#clickTimestamps.length >= 5) {
      this.#comboActive = true;
      if (this.#comboTimer) clearTimeout(this.#comboTimer);
      this.#comboTimer = setTimeout(() => {
        this.#comboActive = false;
        this.#comboTimer = null;
      }, 3000);
    }

    const clickValue = amount * (this.#comboActive ? 2 : 1);

    const state = this.#states.get(id);
    if (!state) return;

    const prevValue = state.currentValue;
    state.currentValue += clickValue;
    if (state.cap !== null) {
      state.currentValue = Math.min(state.currentValue, state.cap);
    }

    this.#eventBus.emit('resource:updated', {
      resourceId: id,
      newValue: state.currentValue,
      delta: state.currentValue - prevValue,
      ratePerSec: state.passiveRatePerSec,
      comboActive: this.#comboActive,
    });
  }

  /**
   * Spend an amount of a resource. Returns false if insufficient.
   * @param {string} id
   * @param {number} amount
   * @returns {boolean}
   */
  spend(id, amount) {
    const state = this.#states.get(id);
    if (!state || state.currentValue < amount) return false;
    if (state.derived) {
      console.debug(`[ResourceManager] spend('${id}') ignored — derived resource`);
      return false;
    }

    state.currentValue -= amount;
    this.#eventBus.emit('resource:updated', {
      resourceId: id,
      newValue: state.currentValue,
      delta: -amount,
      ratePerSec: state.passiveRatePerSec,
    });
    return true;
  }

  // ── Queries ───────────────────────────────────────────────────────────

  /** @returns {object|undefined} Resource definition for the given id */
  getDefinition(id) {
    return this.#definitions.get(id);
  }

  /** @returns {object|undefined} ResourceState for the given id */
  get(id) {
    return this.#states.get(id);
  }

  /** @returns {object} all states keyed by id */
  getAll() {
    const obj = {};
    for (const [id, state] of this.#states) {
      obj[id] = state;
    }
    return obj;
  }

  /** @returns {object[]} array of visible resource states */
  getAllArray() {
    const arr = [];
    for (const state of this.#states.values()) {
      if (state.visible) arr.push(state);
    }
    return arr;
  }

  /** Base click value × clickMultiplier from upgrades. Dev=5, Prod=1 */
  getClickValue() {
    // Dev mode: 5 for faster iteration, Prod mode: 1 for balanced gameplay
    const baseClick = window.AEONS_DEBUG ? 5 : 1;
    return baseClick * this.#clickMultiplier;
  }

  // ── State modifiers ───────────────────────────────────────────────────

  setVisible(id, bool) {
    const state = this.#states.get(id);
    if (!state || state.visible === bool) return;
    state.visible = bool;
    this.#eventBus.emit('resource:visibility:changed', { resourceId: id, visible: bool });
  }

  setGenerationEnabled(id, bool) {
    const state = this.#states.get(id);
    if (state) state.generationEnabled = bool;
  }

  /**
   * Set the dynamic run cap for a resource, overriding the definition's base cap.
   * Clamped to absoluteCap if defined. Survives recalculateRates(); cleared on reset().
   * @param {string} id
   * @param {number} value
   */
  setCurrentCap(id, value) {
    const def = this.#definitions.get(id);
    const absoluteCap = def?.absoluteCap ?? Infinity;
    this.#dynamicCaps.set(id, Math.min(value, absoluteCap));
    const state = this.#states.get(id);
    if (state && state.cap !== null) {
      state.cap = Math.min(value, absoluteCap);
    }
    this.recalculateRates();
    this.#eventBus.emit('resource:cap:changed', { resourceId: id, cap: state?.cap });
  }

  increaseCap(id, amount) {
    const state = this.#states.get(id);
    if (state && state.cap !== null) state.cap += amount;
  }

  /**
   * Track a milestone rate bonus (additive) for a resource.
   * Triggers a full rate recalculation.
   * @param {string} id — resource id
   * @param {number} amount
   */
  applyRateBonus(id, amount) {
    const current = this.#rateBonuses.get(id) || 0;
    this.#rateBonuses.set(id, current + amount);
    this.recalculateRates();
  }

  /**
   * Track a persistent cap bonus for a resource (survives recalculateRates).
   * Triggers a full rate recalculation.
   * @param {string} id — resource id
   * @param {number} amount
   */
  applyCapBonus(id, amount) {
    const current = this.#capBonuses.get(id) || 0;
    this.#capBonuses.set(id, current + amount);
    this.recalculateRates();
  }

  /**
   * Set a persistent rate multiplier for a resource (e.g. prestige bonuses).
   * Replaces any previous multiplier for this resource. Applied in recalculateRates
   * after base rate is set but before upgrade effects.
   * @param {string} id — resource id
   * @param {number} mult — multiplier (1.0 = no change, 1.25 = +25%)
   */
  applyPersistentRateMultiplier(id, mult) {
    this.#persistentRateMultipliers.set(id, mult);
    this.recalculateRates();
  }

  // ── Offline gains ─────────────────────────────────────────────────────

  /**
   * Apply passive rates × elapsed seconds to each non-derived resource.
   * @param {number} elapsedSeconds
   * @returns {Object<string, number>} gains map { resourceId: amount }
   */
  applyOfflineGains(elapsedSeconds) {
    const gains = {};
    for (const [id, state] of this.#states) {
      if (state.derived) continue;
      if (!state.generationEnabled) continue;
      if (state.passiveRatePerSec <= 0) continue;

      const gain = state.passiveRatePerSec * elapsedSeconds;
      state.currentValue += gain;
      if (state.cap !== null) {
        state.currentValue = Math.min(state.currentValue, state.cap);
      }
      gains[id] = gain;
    }

    this.#recalcDerived();
    return gains;
  }

  // ── Rate recalculation ────────────────────────────────────────────────

  /**
   * Recompute passiveRatePerSec for every resource from base definitions,
   * purchased upgrade effects, and milestone bonuses.
   *
   * Order: initialRate → +rateAdditive → ×rateMultiplier → ×'all' mult
   *        → +milestoneBonuses.  Also recalculates caps & clickMultiplier.
   */
  recalculateRates() {
    const effects = this.#upgradeSystem
      ? this.#upgradeSystem.getPurchasedEffects()
      : [];

    // 1. Reset every resource rate to its definition's initialRate and cap
    //    Use dynamic cap if set by prestige, otherwise fall back to definition cap.
    for (const [id, state] of this.#states) {
      const def = this.#definitions.get(id);
      if (def) {
        state.passiveRatePerSec = def.initialRate;
        state.cap = this.#dynamicCaps.has(id) ? this.#dynamicCaps.get(id) : def.cap;
      }
    }

    this.#clickMultiplier = 1;

    // 1b. Persistent rate multipliers (prestige bonuses like Quantum Resonance)
    for (const [id, mult] of this.#persistentRateMultipliers) {
      const state = this.#states.get(id);
      if (state && !state.derived) state.passiveRatePerSec *= mult;
    }

    // 2. Additive rate effects
    for (const effect of effects) {
      if (effect.effectType === 'rateAdditive') {
        const state = this.#states.get(effect.effectTarget);
        if (state && !state.derived) state.passiveRatePerSec += effect.effectMagnitude;
      }
    }

    // 3. Multiplicative rate effects (per-resource, excluding 'all')
    for (const effect of effects) {
      if (effect.effectType === 'rateMultiplier' && effect.effectTarget !== 'all') {
        const state = this.#states.get(effect.effectTarget);
        if (state && !state.derived) state.passiveRatePerSec *= effect.effectMagnitude;
      }
    }

    // 4. 'all' target multiplier — multiply every non-derived resource rate
    for (const effect of effects) {
      if (effect.effectType === 'rateMultiplier' && effect.effectTarget === 'all') {
        for (const state of this.#states.values()) {
          if (!state.derived) {
            state.passiveRatePerSec *= effect.effectMagnitude;
          }
        }
      }
    }

    // 5. Milestone rate bonuses (additive, applied after upgrade effects)
    for (const [id, bonus] of this.#rateBonuses) {
      const state = this.#states.get(id);
      if (state && !state.derived) state.passiveRatePerSec += bonus;
    }

    // 6. Cap increases from upgrades
    for (const effect of effects) {
      if (effect.effectType === 'capIncrease') {
        const state = this.#states.get(effect.effectTarget);
        if (state && state.cap !== null) state.cap += effect.effectMagnitude;
      }
    }

    // 6b. Persistent cap bonuses (cosmic echo, etc.)
    for (const [id, bonus] of this.#capBonuses) {
      const state = this.#states.get(id);
      if (state && state.cap !== null) state.cap += bonus;
    }

    // 6c. Clamp all caps to absoluteCap if defined
    for (const [id, state] of this.#states) {
      if (state.cap === null) continue;
      const def = this.#definitions.get(id);
      if (def?.absoluteCap != null) {
        state.cap = Math.min(state.cap, def.absoluteCap);
      }
    }

    // 7. Click multiplier from upgrades
    for (const effect of effects) {
      if (effect.effectType === 'clickMultiplier') {
        this.#clickMultiplier *= effect.effectMagnitude;
      }
    }
  }

  // ── Serialisation ─────────────────────────────────────────────────────

  /** @returns {object} states keyed by id, suitable for JSON serialisation */
  getStates() {
    const obj = {};
    for (const [id, state] of this.#states) {
      obj[id] = { ...state };
    }
    return obj;
  }

  /** @returns {object} rate bonus map as plain object */
  getRateBonuses() {
    const obj = {};
    for (const [id, bonus] of this.#rateBonuses) obj[id] = bonus;
    return obj;
  }

  /** @returns {object} cap bonus map as plain object */
  getCapBonuses() {
    const obj = {};
    for (const [id, bonus] of this.#capBonuses) obj[id] = bonus;
    return obj;
  }

  /** @returns {object} dynamic cap map as plain object */
  getDynamicCaps() {
    const obj = {};
    for (const [id, cap] of this.#dynamicCaps) obj[id] = cap;
    return obj;
  }

  /** Restore rate bonuses from save data (does not trigger recalculation). */
  loadRateBonuses(bonuses) {
    if (!bonuses) return;
    for (const [id, bonus] of Object.entries(bonuses)) {
      this.#rateBonuses.set(id, bonus);
    }
  }

  /** Restore cap bonuses from save data (does not trigger recalculation). */
  loadCapBonuses(bonuses) {
    if (!bonuses) return;
    for (const [id, bonus] of Object.entries(bonuses)) {
      this.#capBonuses.set(id, bonus);
    }
  }

  /** Restore dynamic caps from save data (does not trigger recalculation). */
  loadDynamicCaps(caps) {
    if (!caps) return;
    for (const [id, cap] of Object.entries(caps)) {
      this.#dynamicCaps.set(id, cap);
    }
  }

  /** @returns {object} persistent rate multipliers as plain object */
  getPersistentRateMultipliers() {
    const obj = {};
    for (const [id, mult] of this.#persistentRateMultipliers) obj[id] = mult;
    return obj;
  }

  /** Restore persistent rate multipliers from save data (does not trigger recalculation). */
  loadPersistentRateMultipliers(mults) {
    if (!mults) return;
    for (const [id, mult] of Object.entries(mults)) {
      this.#persistentRateMultipliers.set(id, mult);
    }
  }

  /** Restore states from save data. */
  loadStates(states) {
    if (!states) return;
    for (const [id, savedState] of Object.entries(states)) {
      const existing = this.#states.get(id);
      if (existing) {
        Object.assign(existing, savedState);
      } else {
        this.#states.set(id, { ...savedState });
      }
    }
  }

  /** Clear all state to prepare for a fresh epoch. */
  reset() {
    this.#states.clear();
    this.#definitions.clear();
    this.#rateBonuses.clear();
    this.#capBonuses.clear();
    this.#dynamicCaps.clear();
    this.#persistentRateMultipliers.clear();
    this.#clickMultiplier = 1;
    this.#clickTimestamps = [];
    this.#comboActive = false;
    if (this.#comboTimer) {
      clearTimeout(this.#comboTimer);
      this.#comboTimer = null;
    }
  }
}
