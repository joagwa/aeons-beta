/**
 * QuarkEngine — Manages quark flavour allocations and passive bonuses.
 *
 * Six quark flavours can be mixed by the player via percentage sliders.
 * Each flavour provides a different passive multiplier that scales with energy.
 *
 * Unlocked after the first Epoch Collapse via the Quark Sight echo upgrade.
 */

const FLAVOURS = [
  { id: 'up',      color: '#4488ff', strength: 0.020 }, // +% energy rate
  { id: 'down',    color: '#ff4444', strength: 0.015 }, // +% mote spawn
  { id: 'charm',   color: '#44ff88', strength: 0.018 }, // +% absorption per mote
  { id: 'strange',  color: '#cc44ff', strength: 0.012 }, // +% energy cap
  { id: 'top',     color: '#ffd700', strength: 0.010 }, // +% EM Bond attraction radius
  { id: 'bottom',  color: '#44dddd', strength: 0.008 }, // -% upgrade costs
];

export class QuarkEngine {
  #allocations = {}; // { up: 1.0, down: 0, ... } fractions summing to 1.0
  #unlocked = false;
  #eventBus = null;
  #bonuses = {};     // cached per-flavour bonus values
  #resonanceScale = 1; // from Flavour Resonance echo upgrade

  static FLAVOURS = FLAVOURS;

  constructor(EventBus) {
    this.#eventBus = EventBus;
    // Default: 100% up
    for (const f of FLAVOURS) {
      this.#allocations[f.id] = f.id === 'up' ? 1.0 : 0;
      this.#bonuses[f.id] = 0;
    }
  }

  /** Unlock the quark system (called on Quark Sight purchase). */
  unlock() {
    this.#unlocked = true;
    this.#eventBus.emit('quarks:unlocked');
  }

  isUnlocked() { return this.#unlocked; }

  /** Get all flavour definitions. */
  getFlavours() { return FLAVOURS; }

  /** Get current allocation fractions (read-only copy). */
  getAllocations() { return { ...this.#allocations }; }

  /** Get a single flavour allocation fraction. */
  getAllocation(id) { return this.#allocations[id] ?? 0; }

  /** Get cached bonuses. */
  getBonuses() { return { ...this.#bonuses }; }

  /** Get a single flavour bonus value. */
  getBonus(id) { return this.#bonuses[id] ?? 0; }

  /** Set Flavour Resonance scale (from echo upgrade). */
  setResonanceScale(s) { this.#resonanceScale = s; }

  /**
   * Set allocation for a specific flavour.
   * Remaining flavours are proportionally adjusted to maintain sum = 1.0.
   * @param {string} id  Flavour id
   * @param {number} frac  New fraction (0..1)
   */
  setAllocation(id, frac) {
    frac = Math.max(0, Math.min(1, frac));
    const oldFrac = this.#allocations[id] ?? 0;
    if (Math.abs(frac - oldFrac) < 0.001) return;

    this.#allocations[id] = frac;

    // Redistribute remaining among other flavours proportionally
    const otherIds = FLAVOURS.filter(f => f.id !== id).map(f => f.id);
    const otherSum = otherIds.reduce((s, oid) => s + (this.#allocations[oid] ?? 0), 0);
    const remaining = Math.max(0, 1.0 - frac);

    if (otherSum > 0.001) {
      const scale = remaining / otherSum;
      for (const oid of otherIds) {
        this.#allocations[oid] = (this.#allocations[oid] ?? 0) * scale;
      }
    } else {
      // All others were 0 — distribute equally
      const share = remaining / otherIds.length;
      for (const oid of otherIds) {
        this.#allocations[oid] = share;
      }
    }

    // Emit color changed for orbital display
    this.#eventBus.emit('quarks:colorChanged', { color: this.getBlendedColor() });
    this.#eventBus.emit('quarks:allocationChanged', { allocations: this.getAllocations() });
  }

  /**
   * Compute bonuses based on current allocations and energy level.
   * Called each tick.
   * @param {number} energy  Current energy value
   */
  tick(energy) {
    if (!this.#unlocked) return;

    const logE = Math.log10(Math.max(1, energy + 1));
    for (const f of FLAVOURS) {
      const frac = this.#allocations[f.id] ?? 0;
      this.#bonuses[f.id] = frac * f.strength * logE * this.#resonanceScale;
    }
  }

  /**
   * Compute the blended color from current allocations.
   * Starts from white, lerps toward each quark color weighted by fraction.
   * @returns {string} CSS hex color string
   */
  getBlendedColor() {
    let r = 255, g = 255, b = 255;

    for (const f of FLAVOURS) {
      const frac = this.#allocations[f.id] ?? 0;
      if (frac < 0.01) continue;

      const cr = parseInt(f.color.slice(1, 3), 16);
      const cg = parseInt(f.color.slice(3, 5), 16);
      const cb = parseInt(f.color.slice(5, 7), 16);

      // Lerp toward quark color
      r = r + (cr - r) * frac;
      g = g + (cg - g) * frac;
      b = b + (cb - b) * frac;
    }

    const hex = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  // ── Save / Load ──────────────────────────────────────────────────────

  getState() {
    return {
      unlocked: this.#unlocked,
      allocations: { ...this.#allocations },
      resonanceScale: this.#resonanceScale,
    };
  }

  loadState(state) {
    if (!state) return;
    this.#unlocked = state.unlocked ?? false;
    this.#resonanceScale = state.resonanceScale ?? 1;
    if (state.allocations) {
      for (const f of FLAVOURS) {
        this.#allocations[f.id] = state.allocations[f.id] ?? 0;
      }
    }
  }

  reset() {
    // Quark allocations persist across prestige — only reset bonuses
    for (const f of FLAVOURS) {
      this.#bonuses[f.id] = 0;
    }
  }
}
