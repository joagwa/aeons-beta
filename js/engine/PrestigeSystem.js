/**
 * PrestigeSystem — Manages tiered Aeon prestige cycles and the Epoch Echo currency.
 *
 * Aeon prestige (auto-triggered when energy fills cap):
 *   - Trigger: Quantum Capacitor maxed (L10) AND energy >= cap
 *   - Awards: vacuumExpansion.level + 1 + conversionBoost + bulkPrestige bonus
 *   - Resets: energy, upgrades, milestones
 *   - Persists: Aeons total, purchased prestige upgrades, dynamic energy cap
 *
 * Tiered upgrade system (unlocked by cumulative Aeons spent):
 *   - Tier 1: always available — energy rate, cap expansion, mote acceleration
 *   - Tier 2: unlocked after ≥3 Aeons spent — automation, instant prestige
 *   - Tier 3: unlocked after ≥10 Aeons spent — bulk prestige, celestial quanta
 *
 * Epoch Echo (story, auto-triggered at Epoch Collapse):
 *   - Awarded by EpochCollapseAnimation on completion
 *   - Spent on phase-unlocking upgrades (Quark Sight, Deep Structure, etc.)
 */
export class PrestigeSystem {
  /** @type {import('../core/EventBus.js?v=c3f8e0c').EventBus} */
  #eventBus;
  /** @type {import('./ResourceManager.js?v=c3f8e0c').ResourceManager} */
  #resourceManager;
  /** @type {import('./UpgradeSystem.js?v=c3f8e0c').UpgradeSystem} */
  #upgradeSystem;

  #count = 0;
  #aeonCount = 0;
  #epochEchoCount = 0;
  #peakEnergy = 0;
  #pointsSpentTotal = 0;
  /** @type {Map<string, number>} prestige upgrade id → level */
  #levels = new Map();

  // ── Tier definitions ──────────────────────────────────────────────────

  static TIER1 = [
    { id: 'prs_energeticEcho',    name: 'Energetic Echo',    tier: 1, baseCost: null, maxLevel: 10, description: '+25% energy rate per level (multiplicative).' },
    { id: 'prs_vacuumExpansion',  name: 'Vacuum Expansion',  tier: 1, baseCost: null, maxLevel: 15, description: '×2 energy cap per level. Also increases Aeon reward.' },
    { id: 'prs_moteAcceleration', name: 'Mote Acceleration', tier: 1, baseCost: 1,   maxLevel: 10, description: '+30% mote spawn rate per level.' },
    { id: 'prs_flexiblePrestige', name: 'Flexible Prestige', tier: 1, baseCost: 2,   maxLevel: 1,  description: 'Remove the Quantum Capacitor gate for all future runs. Prestige when energy fills cap.' },
    { id: 'prs_bulkBuy',         name: 'Bulk Buy',          tier: 1, baseCost: 1,   maxLevel: 1,  description: 'Adds a ×10 buy button to all in-run upgrades.' },
  ];

  static TIER2 = [
    { id: 'prs_autoProductionE',  name: 'Auto: Energy Path',    tier: 2, baseCost: 2, maxLevel: 1, description: 'Auto-buy Energy upgrades every 5 seconds.' },
    { id: 'prs_autoProductionEff',name: 'Auto: Efficiency Path', tier: 2, baseCost: 2, maxLevel: 1, description: 'Auto-buy Efficiency upgrades every 7 seconds.' },
    { id: 'prs_instantPrestige',  name: 'Instant Prestige',     tier: 2, baseCost: 2, maxLevel: 1, description: 'Auto-prestige when energy cap is reached. Skips the dialog.' },
    { id: 'prs_conversionBoost',  name: 'Conversion Boost',     tier: 2, baseCost: 2, maxLevel: 3, description: '+1 Aeon per prestige per level.' },
    { id: 'prs_primalMemory',     name: 'Primal Memory',        tier: 2, baseCost: 1, maxLevel: 1, description: 'Start next run with 50% of your peak energy.' },
  ];

  static TIER3 = [
    { id: 'prs_bulkPrestige',    name: 'Bulk Prestige',    tier: 3, baseCost: null, maxLevel: 5, description: '+1 bonus Aeon per prestige per level.' },
    { id: 'prs_celestialQuanta', name: 'Celestial Quanta', tier: 3, baseCost: 3,    maxLevel: 1, description: 'Unlock Celestial Quanta: orbiting energy motes coloured by quark flavour.' },
  ];

  static ECHO_TREE = {
    collapse: [
      { id: 'prs_quarkSight',     name: 'Quark Sight',      cost: 1, maxLevel: 1, description: 'Unlock the Quark Allocation Panel' },
      { id: 'prs_chromaticField',  name: 'Chromatic Field',  cost: 1, maxLevel: 1, description: 'Quark colour blending applies to orbital motes', requires: 'prs_quarkSight' },
      { id: 'prs_flavourResonance',name: 'Flavour Resonance',cost: 2, maxLevel: 1, description: 'Quark bonus scaling ×1.5', requires: 'prs_chromaticField' },
      { id: 'prs_deepStructure',   name: 'Deep Structure',   cost: 2, maxLevel: 1, description: 'Unlock subatomic phase (protons, neutrons, electrons)', requires: 'prs_flavourResonance' },
    ],
  };

  /** Upgrade IDs that auto-production timers target — defined here for consistency. */
  static AUTO_PATHS = {
    energy:     ['upg_quantumFluctuation', 'upg_vacuumHarvesting', 'upg_moteResonance', 'upg_clickAmplifier', 'upg_quantumCapacitor'],
    efficiency: ['upg_moteGeneration', 'upg_moteQuality', 'upg_moteFlood', 'upg_voidSaturation', 'upg_nebularSurge'],
  };

  // ── Prestige Milestones ───────────────────────────────────────────────
  // Auto-unlock when cumulative prestige count reaches requiredCount.
  // No purchase needed — purely passive, permanent bonuses.
  // effectType: 'energyRateMult' | 'moteSpawnMult' | 'startingQcLevel' | 'startingEnergy'
  // energyRateMult / moteSpawnMult: stack multiplicatively
  // startingQcLevel: only highest unlocked applies
  // startingEnergy: additive

  static MILESTONES = [
    { id: 'pm_firstLight',         requiredCount:   1, name: 'First Light',          effectType: 'energyRateMult',  effectValue: 1.15, description: '+15% energy generation rate.',            flavour: 'The universe remembers its first spark.' },
    { id: 'pm_orbitalReach',       requiredCount:   2, name: 'Orbital Reach',         effectType: 'startingGpLevel', effectValue: 2,    description: 'Gravitational Pull starts at L2 (up from L1).', flavour: 'Memory of gravity persists through the void.' },
    { id: 'pm_echoSeed',           requiredCount:   3, name: 'Echo Seed',             effectType: 'moteSpawnMult',   effectValue: 1.20, description: '+20% mote spawn rate.',                  flavour: 'Resonance echoes leave traces in the fabric.' },
    { id: 'pm_primalCore',         requiredCount:   5, name: 'Primal Core',           effectType: 'startingEnergy',  effectValue: 500,  description: 'Start each run with 500 energy.',          flavour: 'A seed of potential, carried across resets.' },
    { id: 'pm_voidCurrent',        requiredCount:   8, name: 'Void Current',          effectType: 'energyRateMult',  effectValue: 1.30, description: '+30% energy generation rate.',            flavour: 'The void flows with accumulated will.' },
    { id: 'pm_quantumResidue',     requiredCount:  10, name: 'Quantum Residue',       effectType: 'startingQcLevel', effectValue: 2,    description: 'Start each run with Quantum Capacitor at L2.', flavour: 'Quantum structure crystallises across iterations.' },
    { id: 'pm_solarBloom',         requiredCount:  15, name: 'Solar Bloom',           effectType: 'moteSpawnMult',   effectValue: 1.50, description: '+50% mote spawn rate.',                  flavour: 'Stars multiply as the cosmos awakens.' },
    { id: 'pm_cosmicDraft',        requiredCount:  20, name: 'Cosmic Draft',          effectType: 'energyRateMult',  effectValue: 2.00, description: 'Energy generation ×2.',                  flavour: 'Two decades of collapse — the draft runs deep.' },
    { id: 'pm_nebularMemory',      requiredCount:  25, name: 'Nebular Memory',        effectType: 'startingQcLevel', effectValue: 5,    description: 'Start each run with Quantum Capacitor at L5.', flavour: 'Nebulae remember the shape of what came before.' },
    { id: 'pm_darkTide',           requiredCount:  30, name: 'Dark Tide',             effectType: 'energyRateMult',  effectValue: 1.50, description: 'Energy generation ×1.5.',                 flavour: 'The dark tide turns in your favour.' },
    { id: 'pm_stellarInheritance', requiredCount:  50, name: 'Stellar Inheritance',   effectType: 'startingQcLevel', effectValue: 10,   description: 'Start each run with Quantum Capacitor at L10.', flavour: 'Fifty collapses distilled into a single instant.' },
    { id: 'pm_voidMastery',        requiredCount:  75, name: 'Void Mastery',          effectType: 'moteSpawnMult',   effectValue: 3.00, description: 'Mote spawn rate ×3.',                    flavour: 'Mastery of the void — motes answer your call.' },
    { id: 'pm_epochResonance',     requiredCount: 100, name: 'Epoch Resonance',       effectType: 'startingEnergy',  effectValue: 5000, description: 'Start each run with 5,000 energy.',       flavour: 'A century of collapse echoes into every beginning.' },
  ];

  static get ALL_PRESTIGE_UPGRADES() {
    return [...PrestigeSystem.TIER1, ...PrestigeSystem.TIER2, ...PrestigeSystem.TIER3];
  }

  static get ALL_ECHO_UPGRADES() {
    return Object.values(PrestigeSystem.ECHO_TREE).flat();
  }

  static get ALL_UPGRADES() {
    return [...PrestigeSystem.ALL_PRESTIGE_UPGRADES, ...PrestigeSystem.ALL_ECHO_UPGRADES];
  }

  // ── Constructor ───────────────────────────────────────────────────────

  constructor(EventBus, upgradeSystem, resourceManager) {
    this.#eventBus = EventBus;
    this.#upgradeSystem = upgradeSystem;
    this.#resourceManager = resourceManager;
  }

  // ── Accessors ─────────────────────────────────────────────────────────

  getCount()              { return this.#count; }
  getAeonCount()          { return this.#aeonCount; }
  getEpochEchoCount()     { return this.#epochEchoCount; }
  getPeakEnergy()         { return this.#peakEnergy; }
  getLevel(id)            { return this.#levels.get(id) ?? 0; }
  getPointsSpentTotal()   { return this.#pointsSpentTotal; }

  /**
   * Compute combined passive bonuses from all unlocked prestige milestones.
   * @returns {{ energyRateMult: number, moteSpawnMult: number, startingQcLevel: number, startingEnergy: number }}
   */
  getMilestoneBonuses() {
    let energyRateMult = 1;
    let moteSpawnMult  = 1;
    let startingQcLevel = 0;
    let startingGpLevel = 0;
    let startingEnergy  = 0;
    for (const m of PrestigeSystem.MILESTONES) {
      if (this.#count < m.requiredCount) continue;
      switch (m.effectType) {
        case 'energyRateMult':  energyRateMult  *= m.effectValue; break;
        case 'moteSpawnMult':   moteSpawnMult   *= m.effectValue; break;
        case 'startingQcLevel': startingQcLevel  = Math.max(startingQcLevel, m.effectValue); break;
        case 'startingGpLevel': startingGpLevel  = Math.max(startingGpLevel, m.effectValue); break;
        case 'startingEnergy':  startingEnergy  += m.effectValue; break;
      }
    }
    return { energyRateMult, moteSpawnMult, startingQcLevel, startingGpLevel, startingEnergy };
  }

  /** Returns all milestones, annotated with whether they are currently unlocked. */
  getMilestonesWithStatus() {
    return PrestigeSystem.MILESTONES.map(m => ({
      ...m,
      unlocked: this.#count >= m.requiredCount,
    }));
  }

  canPrestige() {
    const energy = this.#resourceManager?.get('energy');
    if (!energy) return false;
    const energyAtCap = energy.currentValue >= energy.cap && energy.cap > 0;
    if (!energyAtCap) return false;

    // prs_flexiblePrestige removes the capacitor gate (but only after first prestige).
    const flexiblePrestige = this.getLevel('prs_flexiblePrestige') > 0;
    if (flexiblePrestige) return true;

    const capacitorLevel = this.#upgradeSystem?.getLevel('upg_quantumCapacitor') ?? 0;
    return capacitorLevel >= 10;
  }

  /** Returns a user-facing message explaining why prestige is currently blocked, or null if not blocked. */
  canPrestigeBlockedMessage() {
    if (this.canPrestige()) return null;
    const energy = this.#resourceManager?.get('energy');
    const flexiblePrestige = this.getLevel('prs_flexiblePrestige') > 0;
    const energyAtCap = energy && energy.currentValue >= energy.cap && energy.cap > 0;
    const capacitorLevel = this.#upgradeSystem?.getLevel('upg_quantumCapacitor') ?? 0;
    const capacitorMaxed = capacitorLevel >= 10;

    if (!flexiblePrestige) {
      if (!capacitorMaxed && !energyAtCap) return `Max Quantum Capacitor (${capacitorLevel}/10) & fill energy to cap`;
      if (!capacitorMaxed) return `Max Quantum Capacitor (${capacitorLevel}/10) to prestige`;
    }
    return 'Fill energy to cap to prestige';
  }

  /** Tier N is unlocked when the player has spent enough cumulative Aeons. */
  getTierUnlocked(tier) {
    if (tier <= 1) return true;
    if (tier === 2) return this.#pointsSpentTotal >= 3;
    if (tier === 3) return this.#pointsSpentTotal >= 10;
    return false;
  }

  /**
   * Dynamic cost for a prestige upgrade at its current level.
   * - prs_energeticEcho / prs_vacuumExpansion: cost = currentLevel + 1
   * - prs_bulkPrestige: cost = 5 × (currentLevel + 1)
   * - All others: fixed baseCost
   */
  getUpgradeCost(id) {
    const def = PrestigeSystem.ALL_UPGRADES.find(u => u.id === id);
    if (!def) return Infinity;
    const level = this.getLevel(id);
    if (id === 'prs_energeticEcho' || id === 'prs_vacuumExpansion') return level + 1;
    if (id === 'prs_bulkPrestige') return 5 * (level + 1);
    return def.baseCost ?? def.cost ?? 1;
  }

  /** How many Aeons the next prestige would award. */
  getPrestigeAeonReward() {
    // Base scales with vacuum expansion level so raising the cap is worthwhile
    const base = this.getLevel('prs_vacuumExpansion') + 1;
    const convBonus = this.getLevel('prs_conversionBoost');
    const bulkBonus = this.getLevel('prs_bulkPrestige');
    return base + convBonus + bulkBonus;
  }

  /** Current energy cap (for display). */
  getCurrentEnergyCap() {
    return this.#resourceManager?.get('energy')?.cap ?? 500;
  }

  /** Next energy cap after one more Vacuum Expansion purchase. */
  getNextEnergyCap() {
    const level = this.getLevel('prs_vacuumExpansion');
    return 500 * Math.pow(2, level + 1);
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
    return PrestigeSystem.ALL_UPGRADES.find(u => u.id === id);
  }

  canAffordUpgrade(id) {
    const def = PrestigeSystem.ALL_UPGRADES.find(u => u.id === id);
    if (!def) return false;
    if (this.getLevel(id) >= (def.maxLevel ?? 1)) return false;
    if (def.requires && this.getLevel(def.requires) < 1) return false;

    const isEcho = PrestigeSystem.ALL_ECHO_UPGRADES.some(u => u.id === id);
    const balance = isEcho ? this.#epochEchoCount : this.#aeonCount;
    const cost = isEcho ? (def.cost ?? 1) : this.getUpgradeCost(id);
    return balance >= cost;
  }

  purchaseUpgrade(id) {
    if (!this.canAffordUpgrade(id)) return false;

    const isEcho = PrestigeSystem.ALL_ECHO_UPGRADES.some(u => u.id === id);
    const def = PrestigeSystem.ALL_UPGRADES.find(u => u.id === id);
    const cost = isEcho ? (def.cost ?? 1) : this.getUpgradeCost(id);

    if (isEcho) {
      this.#epochEchoCount -= cost;
    } else {
      this.#aeonCount -= cost;
      this.#pointsSpentTotal += cost;
    }

    this.#levels.set(id, (this.#levels.get(id) ?? 0) + 1);
    this.#eventBus.emit('prestige:upgrade:purchased', { id, level: this.getLevel(id) });

    // Apply cap change immediately when vacuum expansion is purchased
    if (id === 'prs_vacuumExpansion') {
      const newCap = 500 * Math.pow(2, this.getLevel('prs_vacuumExpansion'));
      this.#resourceManager.setCurrentCap('energy', newCap);
    }

    return true;
  }

  /**
   * Force-grant an upgrade without checking cost or prerequisites.
   * Used by story events (e.g. Epoch Collapse auto-granting echo chain).
   */
  forceGrantUpgrade(id) {
    const def = PrestigeSystem.ALL_UPGRADES.find(u => u.id === id);
    if (!def) return;
    if (this.getLevel(id) >= (def.maxLevel ?? 1)) return;
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
    this.applyPersistentBonuses(resourceManager);

    // Primal Memory — start with 50% of last peak energy (one-shot, not on reload)
    const peak = peakEnergyOverride ?? 0;
    if (this.getLevel('prs_primalMemory') >= 1 && peak > 0) {
      resourceManager.add('energy', Math.floor(peak * 0.5));
    }

    // Prestige milestones — QC starting level and bonus starting energy
    const mb = this.getMilestoneBonuses();

    // Starting QC level: take highest of milestone bonus and post-prestige baseline (L1)
    const qcTarget = Math.max(this.#count >= 1 ? 1 : 0, mb.startingQcLevel);
    if (qcTarget > 0) {
      const cur = upgradeSystem.getLevel('upg_quantumCapacitor') ?? 0;
      if (cur < qcTarget) upgradeSystem.forceLevel('upg_quantumCapacitor', qcTarget);
    }

    // Starting energy from milestones (additive)
    if (mb.startingEnergy > 0) {
      resourceManager.add('energy', mb.startingEnergy);
    }

    // Auto-grant movement after first prestige
    if (this.#count >= 1) {
      const curDrift = upgradeSystem.getLevel('upg_cosmicDrift') ?? 0;
      if (curDrift < 1) upgradeSystem.forceLevel('upg_cosmicDrift', 1);
    }

    // Gravitational Pull baseline: pm_orbitalReach (P2) upgrades this to L2; otherwise L1
    const gpTarget = Math.max(this.#count >= 1 ? 1 : 0, mb.startingGpLevel);
    if (gpTarget > 0) {
      const cur = upgradeSystem.getLevel('upg_gravitationalPull') ?? 0;
      if (cur < gpTarget) upgradeSystem.forceLevel('upg_gravitationalPull', gpTarget);
    }
  }

  /**
   * Apply only persistent bonuses that are safe to re-apply on save load.
   * Does NOT re-seed energy or re-purchase upgrades.
   */
  applyPersistentBonuses(resourceManager) {
    // Vacuum Expansion — restore dynamic cap (×2 per level)
    const vacLevel = this.getLevel('prs_vacuumExpansion');
    if (vacLevel > 0) {
      resourceManager.setCurrentCap('energy', 500 * Math.pow(2, vacLevel));
    }

    // Energetic Echo × milestone energy rate — stored as single combined multiplier
    const echoMult      = Math.pow(1.25, this.getLevel('prs_energeticEcho'));
    const milestoneMult = this.getMilestoneBonuses().energyRateMult;
    const totalMult     = echoMult * milestoneMult;
    if (totalMult !== 1) {
      resourceManager.applyPersistentRateMultiplier('energy', totalMult);
    }
  }

  /**
   * Runtime multipliers and flags consumed by other systems.
   */
  getRuntimeBonuses() {
    const echoLevel = this.getLevel('prs_energeticEcho');
    const mb = this.getMilestoneBonuses();
    return {
      energyRateMult:         Math.pow(1.25, echoLevel) * mb.energyRateMult,
      moteSpawnMult:          Math.pow(1.3,  this.getLevel('prs_moteAcceleration')) * mb.moteSpawnMult,
      autoProductionE:        this.getLevel('prs_autoProductionE')   >= 1,
      autoProductionEff:      this.getLevel('prs_autoProductionEff') >= 1,
      instantPrestige:        this.getLevel('prs_instantPrestige')   >= 1,
      celestialQuantaUnlocked:this.getLevel('prs_celestialQuanta')   >= 1,
      // Echo tree bonuses (unchanged)
      quarkSightUnlocked:     this.getLevel('prs_quarkSight')        >= 1,
      chromaticFieldActive:   this.getLevel('prs_chromaticField')    >= 1,
      flavourResonanceMult:   this.getLevel('prs_flavourResonance')  >= 1 ? 1.5 : 1.0,
      deepStructureUnlocked:  this.getLevel('prs_deepStructure')     >= 1,
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
      pointsSpentTotal: this.#pointsSpentTotal,
      upgrades,
    };
  }

  loadState(state) {
    if (!state) return;
    this.#count          = state.count          ?? 0;
    this.#aeonCount      = state.aeonCount      ?? 0;
    this.#epochEchoCount = state.epochEchoCount ?? 0;
    this.#peakEnergy     = state.peakEnergy     ?? 0;

    if (state.upgrades) {
      for (const [id, level] of Object.entries(state.upgrades)) {
        this.#levels.set(id, level);
      }
    }

    // Restore pointsSpentTotal; derive from upgrade levels for old saves
    if (state.pointsSpentTotal != null) {
      this.#pointsSpentTotal = state.pointsSpentTotal;
    } else {
      let migrated = 0;
      const echoIds = new Set(PrestigeSystem.ALL_ECHO_UPGRADES.map(u => u.id));
      for (const [id, level] of this.#levels) {
        if (!echoIds.has(id)) migrated += level;
      }
      this.#pointsSpentTotal = migrated;
    }
  }
}
