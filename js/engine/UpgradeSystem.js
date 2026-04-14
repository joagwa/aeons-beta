/**
 * UpgradeSystem — Manages upgrade definitions, purchase logic, prerequisite
 * validation, and affordability tracking via EventBus events.
 *
 * Supports multi-level upgrades: upgrades with maxLevel > 1 can be purchased
 * multiple times. Effects scale with level. Prerequisites and milestone gates
 * are only checked on the first purchase (level 0 → 1).
 */

export class UpgradeSystem {
  /** @type {import('../core/EventBus.js?v=d0c4d72').EventBus} */
  #eventBus;
  /** @type {import('./ResourceManager.js?v=d0c4d72').ResourceManager} */
  #resourceManager;
  /** @type {import('./MilestoneSystem.js?v=d0c4d72').MilestoneSystem | null} */
  #milestoneSystem = null;
  /** @type {Map<string, object>} upgrade definitions keyed by id */
  #definitions = new Map();
  /** @type {Map<string, object>} upgrade states keyed by id — { purchased, level } */
  #states = new Map();
  /** @type {Map<string, boolean>} previous affordability per upgrade */
  #previousAffordability = new Map();

  constructor(EventBus, resourceManager) {
    this.#eventBus = EventBus;
    this.#resourceManager = resourceManager;
    this.#eventBus.on('resource:updated', () => this.#checkAffordabilityChanges());
  }

  // ── Dependency wiring ─────────────────────────────────────────────────

  setMilestoneSystem(ms) {
    this.#milestoneSystem = ms;
  }

  // ── Definitions ───────────────────────────────────────────────────────

  loadDefinitions(upgrades) {
    this.#definitions.clear();
    for (const def of upgrades) {
      this.#definitions.set(def.id, def);
      if (!this.#states.has(def.id)) {
        this.#states.set(def.id, { purchased: false, level: 0 });
      }
      this.#previousAffordability.set(def.id, false);
    }
  }

  // ── Cost ──────────────────────────────────────────────────────────────

  /**
   * Returns the cost for the NEXT purchase of this upgrade (scales with level).
   *
   * Base formula (levels 0..threshold): baseCost * costScaling^currentLevel
   *
   * Logarithmic transition (level > threshold, for upgrades with many levels):
   *   cost = costAtThreshold * (1 + log₂(level − threshold + 1) * (costScaling − 1))
   * This ensures cost continuity at threshold+1 and gentle growth beyond it,
   * keeping late-game upgrade costs manageable after milestone storms.
   */
  getCost(upgradeId) {
    const def = this.#definitions.get(upgradeId);
    const state = this.#states.get(upgradeId);
    if (!def || !state) return Infinity;
    if (def.costRecipe) return def.costRecipe;
    const scaling = def.costScaling || 1;
    const level = state.level;

    // Logarithmic scaling kicks in for long upgrades (maxLevel > threshold) after the threshold.
    // Threshold defaults to 5; individual upgrades can override via logScalingThreshold.
    const threshold = def.logScalingThreshold ?? 5;
    const maxLevel = def.maxLevel || 1;

    if (scaling > 1 && maxLevel > threshold && level > threshold) {
      const costAtThreshold = def.baseCost * Math.pow(scaling, threshold);
      // Normalisation constant: ensures cost at threshold+1 equals costAtThreshold * scaling
      const logScalingFactor = scaling - 1;
      return Math.round(costAtThreshold * (1 + Math.log2(level - threshold + 1) * logScalingFactor));
    }

    return Math.round(def.baseCost * Math.pow(scaling, level));
  }

  // ── Purchase validation ───────────────────────────────────────────────

  /**
   * True only if the upgrade can actually be bought right now.
   * Prerequisites and milestone gate are only checked on first purchase (level 0).
   */
  canPurchase(upgradeId) {
    const def = this.#definitions.get(upgradeId);
    const state = this.#states.get(upgradeId);
    if (!def || !state) {
      console.debug(`[UpgradeSystem] canPurchase(${upgradeId}): no def/state`);
      return false;
    }

    const maxLevel = def.maxLevel || 1;
    if (state.level >= maxLevel) return false; // fully maxed

    if (!this.canAfford(upgradeId)) {
      const costInfo = def.costRecipe
        ? def.costRecipe.map(r => `${r.amount} ${r.resourceId}`).join(' + ')
        : `${this.getCost(upgradeId)} ${def.costResource}`;
      console.debug(`[UpgradeSystem] canPurchase(${upgradeId}): can't afford — need ${costInfo}`);
      return false;
    }

    // Gate checks only apply to first purchase
    if (state.level === 0) {
      for (const prereqId of def.prerequisites) {
        const prereqState = this.#states.get(prereqId);
        // Requires at least 1 level purchased, not fully maxed
        if (!prereqState || prereqState.level < 1) {
          console.debug(`[UpgradeSystem] canPurchase(${upgradeId}): prereq ${prereqId} not met (level=${prereqState?.level})`);
          return false;
        }
      }
      if (def.requiresMilestone) {
        if (!this.#milestoneSystem) {
          console.debug(`[UpgradeSystem] canPurchase(${upgradeId}): no milestoneSystem`);
          return false;
        }
        const msState = this.#milestoneSystem.getStates()[def.requiresMilestone];
        if (!msState || !msState.triggered) {
          console.debug(`[UpgradeSystem] canPurchase(${upgradeId}): milestone ${def.requiresMilestone} not triggered`);
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Returns a human-readable reason why the upgrade is locked, or null if only
   * blocked by cost (or already maxed).
   * Gate checks only apply to first purchase (level 0).
   */
  getLockReason(upgradeId) {
    const def = this.#definitions.get(upgradeId);
    const state = this.#states.get(upgradeId);
    if (!def || !state || state.purchased) return null;

    if (state.level === 0) {
      for (const prereqId of def.prerequisites) {
        const prereqState = this.#states.get(prereqId);
        // Requires at least 1 level purchased, not fully maxed
        if (!prereqState || prereqState.level < 1) {
          const prereqDef = this.#definitions.get(prereqId);
          return `Requires: ${prereqDef ? prereqDef.name : prereqId}`;
        }
      }
      if (def.requiresMilestone) {
        if (!this.#milestoneSystem) return 'Milestone required';
        const msState = this.#milestoneSystem.getStates()[def.requiresMilestone];
        if (!msState || !msState.triggered) {
          const msDef = this.#milestoneSystem.getDefinition(def.requiresMilestone);
          const title = msDef ? msDef.title : def.requiresMilestone;
          return `Reach milestone: "${title}"`;
        }
      }
    }
    return null;
  }

  /**
   * True if this upgrade should be shown to the player:
   * - Already has at least 1 level purchased, OR
   * - Its cost-resource is visible to the player.
   */
  isVisible(upgradeId) {
    const def = this.#definitions.get(upgradeId);
    const state = this.#states.get(upgradeId);
    if (!def || !state) return false;
    if (state.level > 0) return true;
    if (def.costRecipe) {
      const costRes = this.#resourceManager.get(def.costRecipe[0].resourceId);
      return costRes ? costRes.visible : false;
    }
    const costRes = this.#resourceManager.get(def.costResource);
    return costRes ? costRes.visible : false;
  }

  canAfford(upgradeId) {
    const def = this.#definitions.get(upgradeId);
    if (!def) return false;
    if (def.costRecipe) {
      return def.costRecipe.every(({ resourceId, amount }) => {
        const res = this.#resourceManager.get(resourceId);
        return res && res.currentValue >= amount;
      });
    }
    const resource = this.#resourceManager.get(def.costResource);
    if (!resource) return false;
    return resource.currentValue >= this.getCost(upgradeId);
  }

  // ── Purchase ──────────────────────────────────────────────────────────

  /**
   * Attempt to purchase one level of an upgrade.
   * Returns true if the purchase succeeded.
   */
  purchase(upgradeId) {
    if (!this.canPurchase(upgradeId)) {
      console.debug(`[UpgradeSystem] purchase(${upgradeId}): canPurchase=false`);
      return false;
    }

    const def = this.#definitions.get(upgradeId);
    const state = this.#states.get(upgradeId);
    let cost;
    if (def.costRecipe) {
      for (const { resourceId, amount } of def.costRecipe) {
        this.#resourceManager.spend(resourceId, amount);
      }
      cost = def.costRecipe;
    } else {
      cost = this.getCost(upgradeId);
      if (!this.#resourceManager.spend(def.costResource, cost)) {
        console.debug(`[UpgradeSystem] purchase(${upgradeId}): spend failed (cost=${cost} ${def.costResource})`);
        return false;
      }
    }

    state.level += 1;
    const maxLevel = def.maxLevel || 1;
    if (state.level >= maxLevel) state.purchased = true;

    console.debug(`[UpgradeSystem] purchase(${upgradeId}): success → level ${state.level}/${maxLevel} (cost=${cost})`);

    this.#resourceManager.recalculateRates();

    this.#eventBus.emit('upgrade:purchased', {
      upgradeId,
      level: state.level,
      maxLevel,
      cost,
      costResource: def.costResource,
    });

    return true;
  }

  // ── Queries ───────────────────────────────────────────────────────────

  /**
   * Returns an array of { effectType, effectTarget, effectMagnitude } for
   * every upgrade that has been purchased at least once, scaling magnitude by level.
   *
   * Scaling rules:
   *   rateAdditive / capIncrease: effectMagnitude * level (linear stacking)
   *   rateMultiplier / clickMultiplier: effectMagnitude ^ level (exponential stacking)
   *   others: base magnitude (no scaling)
   */
  getPurchasedEffects() {
    const effects = [];
    for (const [id, state] of this.#states) {
      if (state.level === 0) continue;
      const def = this.#definitions.get(id);
      if (!def) continue;

      const level = state.level;
      let scaledMag = def.effectMagnitude;
      if (level > 1) {
        switch (def.effectType) {
          case 'rateAdditive':
          case 'capIncrease':
            scaledMag = def.effectMagnitude * level;
            break;
          case 'rateMultiplier':
          case 'clickMultiplier':
            scaledMag = Math.pow(def.effectMagnitude, level);
            break;
        }
      }

      effects.push({
        effectType: def.effectType,
        effectTarget: def.effectTarget,
        effectMagnitude: scaledMag,
      });
    }
    return effects;
  }

  /**
   * Returns all upgrades as { definition, state } sorted by tier.
   */
  getAll() {
    const result = [];
    for (const [id, def] of this.#definitions) {
      result.push({ definition: def, state: this.#states.get(id) });
    }
    result.sort((a, b) => (a.definition.tier || 0) - (b.definition.tier || 0));
    return result;
  }

  /**
   * Get the current level of an upgrade (0 if not purchased or doesn't exist).
   */
  getLevel(upgradeId) {
    return this.#states.get(upgradeId)?.level || 0;
  }

  // ── Serialisation ─────────────────────────────────────────────────────

  getStates() {
    const obj = {};
    for (const [id, state] of this.#states) {
      obj[id] = { ...state };
    }
    return obj;
  }

  loadStates(states) {
    if (!states) return;
    console.log('[UpgradeSystem] Loading upgrade states:', Object.keys(states));
    for (const [id, savedState] of Object.entries(states)) {
      const existing = this.#states.get(id);
      const def = this.#definitions.get(id);
      const maxLevel = def?.maxLevel || 1;

      // Old format had only `purchased: bool` with no level field.
      const rawLevel = savedState.level !== undefined ? savedState.level : (savedState.purchased ? 1 : 0);

      // Clamp to current maxLevel so rebalanced upgrades don't keep old over-limit levels.
      const level = Math.min(rawLevel, maxLevel);

      // Re-derive purchased from level >= maxLevel so multi-level upgrades
      // loaded from an old save aren't incorrectly treated as fully maxed.
      const purchased = level >= maxLevel;

      const normalized = { purchased, level };
      if (existing) {
        Object.assign(existing, normalized);
      } else {
        this.#states.set(id, normalized);
      }
      
      // Emit purchase event for ALL partially or fully purchased upgrades so
      // listeners can restore their state (e.g. gravity radius, mote generation rate).
      if (level > 0) {
        console.log(`[UpgradeSystem] Restored upgrade: ${id} (level ${level})`);
        this.#eventBus.emit('upgrade:purchased', { upgradeId: id, level });
      }
    }
  }

  /**
   * Force an upgrade to a specific level without spending resources.
   * Used by prestige system to apply run-start bonuses.
   */
  forceLevel(upgradeId, level) {
    const def = this.#definitions.get(upgradeId);
    if (!def) return;
    const maxLevel = def.maxLevel || 1;
    const clamped = Math.max(0, Math.min(level, maxLevel));
    let state = this.#states.get(upgradeId);
    if (!state) {
      state = { level: 0, purchased: false };
      this.#states.set(upgradeId, state);
    }
    state.level = clamped;
    state.purchased = clamped >= maxLevel;
    if (clamped > 0) {
      this.#resourceManager.recalculateRates();
      this.#eventBus.emit('upgrade:purchased', { upgradeId, level: clamped, maxLevel, forced: true });
    }
  }

  reset() {
    this.#states.clear();
    this.#definitions.clear();
    this.#previousAffordability.clear();
  }

  // ── Definition helpers ────────────────────────────────────────────────

  /** Returns the effectMagnitude from the upgrade's definition, or null if unknown. */
  getEffectMagnitude(upgradeId) {
    return this.#definitions.get(upgradeId)?.effectMagnitude ?? null;
  }

  /** Returns the full definition object for an upgrade, or null. */
  getDefinition(upgradeId) {
    return this.#definitions.get(upgradeId) ?? null;
  }

  /**
   * Compute current and next-level effect display strings for an upgrade card.
   * Returns { current, next } string pair, or null for upgrade types with no meaningful spec.
   *
   * current: what the player has right now (null if level=0)
   * next:    what the next purchase will give (null if already maxed)
   */
  getUpgradeStats(upgradeId) {
    const def = this.#definitions.get(upgradeId);
    const state = this.#states.get(upgradeId);
    if (!def || !state) return null;

    const level = state.level;
    const maxLevel = def.maxLevel || 1;
    const mag = def.effectMagnitude;
    if (mag == null) return null;

    const fmtMult = (v) => {
      if (v >= 1000) return `×${Math.round(v).toLocaleString()}`;
      if (v >= 10)   return `×${parseFloat(v.toFixed(1))}`;
      return `×${parseFloat(v.toFixed(2))}`;
    };
    const fmtNum = (v) => {
      if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
      if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
      return String(Math.round(v));
    };

    let current = null, next = null;

    switch (def.effectType) {
      case 'rateMultiplier':
      case 'absorptionMultiplier':
      case 'hFusionMult':
      case 'heFusionMult':
      case 'moleculeRateMult':
      case 'ironYieldMult':
      case 'protonSynthesisRate': {
        if (level > 0) current = fmtMult(Math.pow(mag, level));
        if (level < maxLevel) next = fmtMult(Math.pow(mag, level + 1));
        break;
      }
      case 'clickMultiplier': {
        if (level > 0) current = `${fmtMult(Math.pow(mag, level))} click`;
        if (level < maxLevel) next = `${fmtMult(Math.pow(mag, level + 1))} click`;
        break;
      }
      case 'protonSynthesisCost': {
        // mag < 1 means cost reduction per level; show as percentage
        if (level > 0) current = `${Math.round(Math.pow(mag, level) * 100)}% cost/H`;
        if (level < maxLevel) next = `${Math.round(Math.pow(mag, level + 1) * 100)}% cost/H`;
        break;
      }
      case 'rateAdditive': {
        if (level > 0) current = `+${fmtNum(mag * level)}/s`;
        if (level < maxLevel) next = `+${fmtNum(mag * (level + 1))}/s`;
        break;
      }
      case 'capIncrease': {
        if (level > 0) current = `+${fmtNum(mag * level)} cap`;
        if (level < maxLevel) next = `+${fmtNum(mag * (level + 1))} cap`;
        break;
      }
      case 'dmWaveStrength': {
        if (level > 0) current = `+${mag * level} force`;
        if (level < maxLevel) next = `+${mag * (level + 1)} force`;
        break;
      }
      default:
        return null;
    }

    if (current === null && next === null) return null;
    return { current, next };
  }

  // ── Affordability tracking ────────────────────────────────────────────

  #checkAffordabilityChanges() {
    for (const [id, state] of this.#states) {
      if (state.purchased) continue; // fully maxed
      const affordable = this.canAfford(id);
      const prev = this.#previousAffordability.get(id);
      if (affordable !== prev) {
        this.#previousAffordability.set(id, affordable);
        this.#eventBus.emit('upgrade:affordability:changed', {
          upgradeId: id,
          canAfford: affordable,
        });
      }
    }
  }
}
