/**
 * PrestigeSystem — Manages Aeon prestige cycles and the Epoch Echo currency.
 *
 * Aeon prestige (player-triggered):
 *   - Trigger: energy >= currentCap
 *   - Awards: 1+ Aeons (bonus from Echo Chamber)
 *   - Resets: energy, upgrades, milestones
 *   - Persists: Aeons total, purchased Aeon upgrades, dynamic energy cap
 *
 * Epoch Echo (story, auto-triggered at Epoch Collapse):
 *   - Awarded by EpochCollapseAnimation on completion
 *   - Spent on phase-unlocking upgrades (Quark Sight, Deep Structure, etc.)
 */
export class PrestigeSystem {
  /** @type {import('../core/EventBus.js?v=8b3ecad').EventBus} */
  #eventBus;
  /** @type {import('./ResourceManager.js?v=8b3ecad').ResourceManager} */
  #resourceManager;
  /** @type {import('./UpgradeSystem.js?v=8b3ecad').UpgradeSystem} */
  #upgradeSystem;

  #count = 0;
  #aeonCount = 0;
  #epochEchoCount = 0;
  #peakEnergy = 0;
  /** @type {Map<string, number>} prestige upgrade id → level */
  #levels = new Map();

  // ── Tree definitions ──────────────────────────────────────────────────

  static AEON_TREE = {
    expansion: [
      { id: 'prs_expandedVacuum', name: 'Expanded Vacuum', cost: 1, maxLevel: 5, description: 'Raise energy cap ×10 per level (500 → 5K → 50K → 500K → 5M → 10M)' },
    ],
    efficiency: [
      { id: 'prs_quantumResonance', name: 'Quantum Resonance', cost: 1, maxLevel: 5, description: '+25% base energy rate per level' },
      { id: 'prs_moteInheritance',  name: 'Mote Inheritance',  cost: 1, maxLevel: 1, description: 'Start each run with EM Bond L1', requires: 'prs_quantumResonance' },
    ],
    memory: [
      { id: 'prs_primalMemory', name: 'Primal Memory', cost: 1, maxLevel: 1, description: 'Start next run with 50% of last run peak energy' },
      { id: 'prs_echoChamber',  name: 'Echo Chamber',  cost: 2, maxLevel: 1, description: '+1 bonus Aeon on each future prestige', requires: 'prs_primalMemory' },
      { id: 'prs_aeonAutomaton', name: 'Aeon Automaton', cost: 10, maxLevel: 1, description: 'Auto-purchase Phase 1 energy upgrades for you', requires: 'prs_echoChamber' },
    ],
  };

  static ECHO_TREE = {
    collapse: [
      { id: 'prs_quarkSight',     name: 'Quark Sight',      cost: 1, maxLevel: 1, description: 'Unlock the Quark Allocation Panel' },
      { id: 'prs_chromaticField',  name: 'Chromatic Field',  cost: 1, maxLevel: 1, description: 'Quark colour blending applies to orbital motes', requires: 'prs_quarkSight' },
      { id: 'prs_flavourResonance',name: 'Flavour Resonance',cost: 2, maxLevel: 1, description: 'Quark bonus scaling ×1.5', requires: 'prs_chromaticField' },
      { id: 'prs_deepStructure',   name: 'Deep Structure',   cost: 2, maxLevel: 1, description: 'Unlock subatomic phase (protons, neutrons, electrons)', requires: 'prs_flavourResonance' },
    ],
  };

  static get ALL_AEON_UPGRADES() {
    return Object.values(PrestigeSystem.AEON_TREE).flat();
  }

  static get ALL_ECHO_UPGRADES() {
    return Object.values(PrestigeSystem.ECHO_TREE).flat();
  }

  static get ALL_UPGRADES() {
    return [...PrestigeSystem.ALL_AEON_UPGRADES, ...PrestigeSystem.ALL_ECHO_UPGRADES];
  }

  // ── Constructor ───────────────────────────────────────────────────────

  constructor(EventBus, upgradeSystem, resourceManager) {
    this.#eventBus = EventBus;
    this.#upgradeSystem = upgradeSystem;
    this.#resourceManager = resourceManager;
  }

  // ── Accessors ─────────────────────────────────────────────────────────

  getCount()            { return this.#count; }
  getAeonCount()        { return this.#aeonCount; }
  getEpochEchoCount()   { return this.#epochEchoCount; }
  getPeakEnergy()       { return this.#peakEnergy; }
  getLevel(id)          { return this.#levels.get(id) ?? 0; }

  canPrestige() {
    const energy = this.#resourceManager?.get('energy');
    if (!energy) return false;
    // Check against maximum potential energy cap (considering all available upgrades)
    const maxCap = this.getMaxPotentialEnergyCap();
    return energy.currentValue >= maxCap && maxCap > 0;
  }

  /** How many Aeons the next prestige would award. */
  getPrestigeAeonReward() {
    const base = 1;
    const echoBonus = this.getLevel('prs_echoChamber') >= 1 ? 1 : 0;
    return base + echoBonus;
  }

  /** Current energy cap (for display). */
  getCurrentEnergyCap() {
    return this.#resourceManager?.get('energy')?.cap ?? 500;
  }

  /** Next energy cap after purchasing one more Expanded Vacuum level. */
  getNextEnergyCap() {
    const level = this.getLevel('prs_expandedVacuum');
    if (level >= 5) return 10000000;
    return 500 * Math.pow(10, level + 1);
  }

  /**
   * Calculate maximum achievable energy cap if player purchases all affordable upgrades.
   * Considers:
   * - All currently-purchased prestige cap upgrades (Expanded Vacuum)
   * - All purchasable regular upgrades that increase energy cap (capIncrease, capMultiplier)
   * 
   * Used to determine true prestige checkpoint (player has maxed out progression potential).
   */
  getMaxPotentialEnergyCap() {
    if (!this.#resourceManager || !this.#upgradeSystem) {
      return 500;
    }

    // Start with base cap from Expanded Vacuum prestige upgrades
    const expandedLevel = this.getLevel('prs_expandedVacuum');
    let baseCap = expandedLevel >= 5 ? 10000000 : 500 * Math.pow(10, expandedLevel);

    // List of energy cap upgrades to consider (in order of priority)
    const capUpgradeIds = [
      'upg_quantumCapacitor',      // ×1.2 per level
      'upg_quantumReservoir',       // ×1.15 per level (needs hydrogen)
      'upg_hydrologicalCycle',      // ×1.12 per level (needs multi-resources)
    ];

    // For each cap upgrade, calculate max level we could afford and apply it
    let resultCap = baseCap;
    for (const upgradeId of capUpgradeIds) {
      const upgrade = this.#upgradeSystem.getDefinition(upgradeId);
      if (!upgrade) continue;

      const currentLevel = this.#upgradeSystem.getLevel(upgradeId);
      const maxLevelPossible = upgrade.maxLevel ?? 10;

      // Apply capMultiplier for this upgrade at max level
      if (upgrade.effectType === 'capMultiplier') {
        // Calculate what max level would give: magnitude ^ (maxLevelPossible - currentLevel)
        const additionalLevels = maxLevelPossible - currentLevel;
        const multiplierFactor = Math.pow(upgrade.effectMagnitude, additionalLevels);
        resultCap *= multiplierFactor;
      } else if (upgrade.effectType === 'capIncrease') {
        // Legacy support (shouldn't happen after recent conversion)
        for (let lvl = currentLevel + 1; lvl <= maxLevelPossible; lvl++) {
          resultCap += upgrade.effectMagnitude * lvl * lvl; // quadratic scaling
        }
      }
    }

    return resultCap;
  }


  // ── Track peak energy each tick ───────────────────────────────────────

  trackPeakEnergy() {
    const energy = this.#resourceManager?.get('energy');
    if (energy && energy.currentValue > this.#peakEnergy) {
      this.#peakEnergy = energy.currentValue;
    }
  }

  // ── Prestige action ───────────────────────────────────────────────────

  executePrestige() {
    if (!this.canPrestige()) return false;
    const reward = this.getPrestigeAeonReward();
    const peakAtPrestige = this.#peakEnergy;
    this.#aeonCount += reward;
    this.#count++;
    this.#eventBus.emit('prestige:execute', {
      count: this.#count,
      aeonsEarned: reward,
      aeonTotal: this.#aeonCount,
      peakEnergy: peakAtPrestige,
    });
    this.#peakEnergy = 0;
    return true;
  }

  // ── Epoch Echo award (called by Epoch Collapse) ───────────────────────

  awardEpochEcho(count = 1) {
    this.#epochEchoCount += count;
    this.#eventBus.emit('epochEcho:awarded', { count: this.#epochEchoCount });
  }

  // ── Upgrade purchasing ────────────────────────────────────────────────

  /**
   * Get the definition object for an upgrade by id.
   * @param {string} id
   * @return {object|undefined}
   */
  getUpgradeDefinition(id) {
    const allUpgrades = PrestigeSystem.ALL_UPGRADES;
    return allUpgrades.find(u => u.id === id);
  }

  canAffordUpgrade(id) {
    const allUpgrades = PrestigeSystem.ALL_UPGRADES;
    const def = allUpgrades.find(u => u.id === id);
    if (!def) return false;
    if (this.getLevel(id) >= def.maxLevel) return false;
    if (def.requires && this.getLevel(def.requires) < 1) return false;

    // Determine currency
    const isEcho = PrestigeSystem.ALL_ECHO_UPGRADES.some(u => u.id === id);
    const balance = isEcho ? this.#epochEchoCount : this.#aeonCount;
    return balance >= def.cost;
  }

  purchaseUpgrade(id) {
    if (!this.canAffordUpgrade(id)) return false;
    const allUpgrades = PrestigeSystem.ALL_UPGRADES;
    const def = allUpgrades.find(u => u.id === id);

    const isEcho = PrestigeSystem.ALL_ECHO_UPGRADES.some(u => u.id === id);
    if (isEcho) {
      this.#epochEchoCount -= def.cost;
    } else {
      this.#aeonCount -= def.cost;
    }

    this.#levels.set(id, (this.#levels.get(id) ?? 0) + 1);
    this.#eventBus.emit('prestige:upgrade:purchased', { id, level: this.getLevel(id) });

    // Apply Expanded Vacuum cap progression immediately
    if (id === 'prs_expandedVacuum') {
      const newCap = 500 * Math.pow(10, this.getLevel('prs_expandedVacuum'));
      this.#resourceManager.setCurrentCap('energy', newCap);
    }

    return true;
  }

  /**
   * Force-grant an upgrade without checking cost or prerequisites.
   * Used by story events (e.g. Epoch Collapse auto-granting echo chain).
   */
  forceGrantUpgrade(id) {
    const allUpgrades = PrestigeSystem.ALL_UPGRADES;
    const def = allUpgrades.find(u => u.id === id);
    if (!def) return;
    if (this.getLevel(id) >= def.maxLevel) return;
    this.#levels.set(id, (this.#levels.get(id) ?? 0) + 1);
    this.#eventBus.emit('prestige:upgrade:purchased', { id, level: this.getLevel(id) });
  }

  // ── Run-start bonuses ─────────────────────────────────────────────────

  /**
   * Apply bonuses at the start of a new run (after prestige reset).
   * @param {object} resourceManager
   * @param {object} upgradeSystem
   * @param {object} moteController
   * @param {number} [peakEnergyOverride] — peak energy from the prestige event
   */
  applyRunBonuses(resourceManager, upgradeSystem, moteController, peakEnergyOverride) {
    // Apply persistent bonuses (cap, rate multiplier)
    this.applyPersistentBonuses(resourceManager, upgradeSystem);

    // Primal Memory — start with 50% of last peak energy (one-shot, not on reload)
    const peak = peakEnergyOverride ?? 0;
    if (this.getLevel('prs_primalMemory') >= 1 && peak > 0) {
      resourceManager.add('energy', Math.floor(peak * 0.5));
    }

    // Auto-unlock EM Bond L1 after first prestige (always, not just for Mote Inheritance)
    if (this.#count === 1) {
      const cur = upgradeSystem.getLevel('upg_gravitationalPull') ?? 0;
      if (cur < 1) upgradeSystem.forceLevel('upg_gravitationalPull', 1);
    }

    // Mote Inheritance — start with EM Bond L1 on all subsequent prestige
    if (this.#count > 1 && this.getLevel('prs_moteInheritance') >= 1) {
      const cur = upgradeSystem.getLevel('upg_gravitationalPull') ?? 0;
      if (cur < 1) upgradeSystem.forceLevel('upg_gravitationalPull', 1);
    }

    // After first prestige, auto-grant movement via the upgrade system
    // (fires upgrade:purchased which MoteController handles to enable movement)
    if (this.#count >= 1) {
      const curDrift = upgradeSystem.getLevel('upg_cosmicDrift') ?? 0;
      if (curDrift < 1) upgradeSystem.forceLevel('upg_cosmicDrift', 1);
    }
  }

  /**
   * Apply only persistent bonuses that are safe to re-apply on save load.
   * Does NOT re-seed energy or re-purchase upgrades.
   */
  applyPersistentBonuses(resourceManager) {
    // Expanded Vacuum — restore dynamic cap
    const vacLevel = this.getLevel('prs_expandedVacuum');
    if (vacLevel > 0) {
      const cap = 500 * Math.pow(10, vacLevel);
      resourceManager.setCurrentCap('energy', cap);
    }

    // Quantum Resonance — persistent energy rate multiplier
    const qrLevel = this.getLevel('prs_quantumResonance');
    if (qrLevel > 0) {
      resourceManager.applyPersistentRateMultiplier('energy', 1 + qrLevel * 0.25);
    }
  }

  /**
   * Runtime multipliers applied by other systems.
   */
  getRuntimeBonuses() {
    const qrLevel = this.getLevel('prs_quantumResonance');
    return {
      energyRateMult: 1 + qrLevel * 0.25,
      quarkSightUnlocked: this.getLevel('prs_quarkSight') >= 1,
      chromaticFieldActive: this.getLevel('prs_chromaticField') >= 1,
      flavourResonanceMult: this.getLevel('prs_flavourResonance') >= 1 ? 1.5 : 1.0,
      deepStructureUnlocked: this.getLevel('prs_deepStructure') >= 1,
    };
  }

  // ── Save / Load ───────────────────────────────────────────────────────

  getState() {
    const upgrades = {};
    for (const [id, level] of this.#levels) upgrades[id] = level;
    return {
      count: this.#count,
      aeonCount: this.#aeonCount,
      epochEchoCount: this.#epochEchoCount,
      peakEnergy: this.#peakEnergy,
      upgrades,
    };
  }

  loadState(state) {
    if (!state) return;
    this.#count            = state.count            ?? 0;
    this.#aeonCount        = state.aeonCount        ?? 0;
    this.#epochEchoCount   = state.epochEchoCount   ?? 0;
    this.#peakEnergy       = state.peakEnergy       ?? 0;
    if (state.upgrades) {
      for (const [id, level] of Object.entries(state.upgrades)) {
        this.#levels.set(id, level);
      }
    }
    // Backwards compatibility: old saves had darkMatterBanked
    if (state.darkMatterBanked != null && this.#aeonCount === 0) {
      // Don't migrate DM to Aeons — just let them start fresh
    }
  }
}
