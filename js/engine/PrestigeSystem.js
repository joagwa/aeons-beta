/**
 * PrestigeSystem — Manages prestige state, dark matter banking, and meta upgrade tree.
 *
 * Dark matter flow:
 *   - DarkMatterSystem.totalCollected tracks DM collected this run
 *   - Prestige requires >= 10 DM collected AND ms_firstAtom reached
 *   - On prestige: run DM added to darkMatterBanked, then run resets
 *   - darkMatterBanked is spent on persistent meta upgrades (persists forever)
 */
export class PrestigeSystem {
  /** @type {import('../core/EventBus.js?v=9f33b5b').EventBus} */
  #eventBus;
  /** @type {import('./UpgradeSystem.js?v=9f33b5b').UpgradeSystem} */
  #upgradeSystem;
  /** @type {import('./MilestoneSystem.js?v=9f33b5b').MilestoneSystem} */
  #milestoneSystem;
  /** @type {import('./DarkMatterSystem.js?v=9f33b5b').DarkMatterSystem} */
  #darkMatterSystem;

  #count = 0;
  #darkMatterBanked = 0;
  /** @type {Map<string, number>} prestige upgrade id → level */
  #levels = new Map();

  // ── Tree definition ────────────────────────────────────────────────────

  static TREE = {
    production: [
      { id: 'prs_voidMemory',    name: 'Void Memory',       cost: 10,  maxLevel: 1, description: 'Start each run with 50 H and 10 He' },
      { id: 'prs_primordalRate', name: 'Primordial Rate',   cost: 25,  maxLevel: 1, description: '+25% proton synthesis rate', requires: 'prs_voidMemory' },
      { id: 'prs_moteStorm',     name: 'Mote Storm',        cost: 50,  maxLevel: 1, description: 'Start each run with Mote Genesis L3 purchased', requires: 'prs_primordalRate' },
      { id: 'prs_energySurge',   name: 'Energy Surge',      cost: 75,  maxLevel: 1, description: '+50% starting energy cap', requires: 'prs_moteStorm' },
      { id: 'prs_heliumSeed',    name: 'Helium Seed',       cost: 100, maxLevel: 1, description: 'Start each run with 20 He', requires: 'prs_energySurge' },
    ],
    discovery: [
      { id: 'prs_fusionKnowledge',   name: 'Fusion Knowledge',   cost: 15, maxLevel: 1, description: 'Start each run with Fusion Ignition purchased' },
      { id: 'prs_stellarMemory',     name: 'Stellar Memory',     cost: 30, maxLevel: 1, description: 'Star lifecycle 50% faster', requires: 'prs_fusionKnowledge' },
      { id: 'prs_elementalAffinity', name: 'Elemental Affinity', cost: 50, maxLevel: 1, description: 'He\u2192C/O unlocked from first red giant', requires: 'prs_stellarMemory' },
      { id: 'prs_molecularInstinct', name: 'Molecular Instinct', cost: 75, maxLevel: 1, description: 'Molecule synthesis starts at 2\u00d7 rate', requires: 'prs_elementalAffinity' },
    ],
    darkForce: [
      { id: 'prs_darkResonance', name: 'Dark Resonance',        cost: 10, maxLevel: 1, description: '+1 DM node burst per energy threshold crossed' },
      { id: 'prs_voidHarvest',   name: 'Void Harvest',          cost: 25, maxLevel: 1, description: '\u00d71.5 DM node creation rate', requires: 'prs_darkResonance' },
      { id: 'prs_dmSiphon',      name: 'DM Siphon',             cost: 15, maxLevel: 1, description: '+40 px DM collection radius' },
      { id: 'prs_darkFlow',      name: 'Dark Flow',             cost: 30, maxLevel: 1, description: '+5 max simultaneous DM nodes', requires: 'prs_darkResonance' },
      { id: 'prs_dmCapacity',    name: 'Dark Matter Abundance', cost: 20, maxLevel: 5, description: '+5 bonus DM nodes on each prestige' },
    ],
    inheritance: [
      { id: 'prs_gravityStart', name: 'Gravity Start', cost: 20, maxLevel: 1, description: 'Begin with Gravitational Pull L2 purchased' },
      { id: 'prs_motorStart',   name: 'Motor Start',   cost: 20, maxLevel: 1, description: 'Begin with Cosmic Drift unlocked' },
      { id: 'prs_protonStart',  name: 'Proton Start',  cost: 35, maxLevel: 1, description: 'Begin with Proton Forge purchased', requires: 'prs_gravityStart' },
      { id: 'prs_forgeMemory',  name: 'Forge Memory',  cost: 50, maxLevel: 1, description: '+25% proton synthesis rate carry-over', requires: 'prs_protonStart' },
      { id: 'prs_cosmicWeb',    name: 'Cosmic Web',    cost: 60, maxLevel: 1, description: 'DM threshold values halved', requires: 'prs_forgeMemory' },
    ],
  };

  static get ALL_UPGRADES() {
    return Object.values(PrestigeSystem.TREE).flat();
  }

  // ── Constructor ────────────────────────────────────────────────────────

  constructor(EventBus, upgradeSystem, milestoneSystem, darkMatterSystem) {
    this.#eventBus = EventBus;
    this.#upgradeSystem = upgradeSystem;
    this.#milestoneSystem = milestoneSystem;
    this.#darkMatterSystem = darkMatterSystem;
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  getCount()           { return this.#count; }
  getDarkMatterBanked(){ return this.#darkMatterBanked; }
  getLevel(id)         { return this.#levels.get(id) ?? 0; }
  getRunDM()           { return this.#darkMatterSystem?.totalCollected ?? 0; }

  canPrestige() {
    const firstAtom = this.#milestoneSystem?.isTriggered?.('ms_firstAtom') ?? false;
    return this.getRunDM() >= 10 && firstAtom;
  }

  // ── Prestige action ────────────────────────────────────────────────────

  executePrestige() {
    if (!this.canPrestige()) return false;
    const runDM = this.getRunDM();
    this.#darkMatterBanked += runDM;
    this.#count++;
    const bonusNodes = 10 + this.getLevel('prs_dmCapacity') * 5;
    this.#eventBus.emit('prestige:execute', {
      count: this.#count,
      dmBanked: this.#darkMatterBanked,
      bonusNodes,
    });
    return true;
  }

  // ── Upgrade purchasing ─────────────────────────────────────────────────

  canAffordUpgrade(id) {
    const def = PrestigeSystem.ALL_UPGRADES.find(u => u.id === id);
    if (!def) return false;
    if (this.getLevel(id) >= def.maxLevel) return false;
    if (def.requires && this.getLevel(def.requires) < 1) return false;
    return this.#darkMatterBanked >= def.cost;
  }

  purchaseUpgrade(id) {
    if (!this.canAffordUpgrade(id)) return false;
    const def = PrestigeSystem.ALL_UPGRADES.find(u => u.id === id);
    this.#darkMatterBanked -= def.cost;
    this.#levels.set(id, (this.#levels.get(id) ?? 0) + 1);
    this.#eventBus.emit('prestige:upgrade:purchased', { id, level: this.getLevel(id) });
    return true;
  }

  // ── Run-start bonuses ──────────────────────────────────────────────────

  applyRunBonuses(resourceManager, upgradeSystem) {
    if (this.getLevel('prs_voidMemory') >= 1) {
      resourceManager.add('hydrogen', 50);
      resourceManager.add('helium', 10);
    }
    if (this.getLevel('prs_heliumSeed') >= 1) {
      resourceManager.add('helium', 20);
    }
    if (this.getLevel('prs_moteStorm') >= 1) {
      const cur = upgradeSystem.getLevel('upg_moteGeneration') ?? 0;
      for (let i = cur; i < 3; i++) upgradeSystem.forceLevel('upg_moteGeneration', i + 1);
    }
    if (this.getLevel('prs_protonStart') >= 1) {
      upgradeSystem.forceLevel('upg_protonForge', 1);
    }
    if (this.getLevel('prs_fusionKnowledge') >= 1) {
      upgradeSystem.forceLevel('upg_fusionIgnition', 1);
    }
    if (this.getLevel('prs_gravityStart') >= 1) {
      const cur = upgradeSystem.getLevel('upg_gravitationalPull') ?? 0;
      if (cur < 2) upgradeSystem.forceLevel('upg_gravitationalPull', 2);
    }
    if (this.getLevel('prs_motorStart') >= 1) {
      upgradeSystem.forceLevel('upg_cosmicDrift', 1);
    }
  }

  /**
   * Runtime multipliers applied by other systems.
   */
  getRuntimeBonuses() {
    return {
      protonSynthesisRateMult:   this.getLevel('prs_primordalRate')     >= 1 ? 1.25 : 1.0,
      starLifecycleSpeedMult:    this.getLevel('prs_stellarMemory')     >= 1 ? 1.5  : 1.0,
      moleculeSynthesisRateMult: this.getLevel('prs_molecularInstinct') >= 1 ? 2.0  : 1.0,
      dmCollectRadiusBonus:      this.getLevel('prs_dmSiphon')          >= 1 ? 40   : 0,
      dmMaxNodeBonus:            this.getLevel('prs_darkFlow')          >= 1 ? 5    : 0,
      energyCapMult:             this.getLevel('prs_energySurge')       >= 1 ? 1.5  : 1.0,
      elementalAffinityUnlocked: this.getLevel('prs_elementalAffinity') >= 1,
      cosmicWebActive:           this.getLevel('prs_cosmicWeb')         >= 1,
    };
  }

  // ── Save / Load ────────────────────────────────────────────────────────

  getState() {
    const upgrades = {};
    for (const [id, level] of this.#levels) upgrades[id] = level;
    return { count: this.#count, darkMatterBanked: this.#darkMatterBanked, upgrades };
  }

  loadState(state) {
    if (!state) return;
    this.#count            = state.count            ?? 0;
    this.#darkMatterBanked = state.darkMatterBanked ?? 0;
    if (state.upgrades) {
      for (const [id, level] of Object.entries(state.upgrades)) {
        this.#levels.set(id, level);
      }
    }
  }
}
