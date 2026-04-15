/**
 * SubatomicEngine — Manages quark production, hadron formation, and lepton generation.
 *
 * Unlocked after the 2nd Epoch Collapse via the Deep Structure echo upgrade.
 *
 * Resource flow:
 *   - Quark allocation → quark_up / quark_down production (from energy)
 *   - Proton = 2 up + 1 down quark
 *   - Neutron = 1 up + 2 down quark
 *   - Electron = generated from energy (lepton field)
 *
 * Passive effects:
 *   - Proton: +2% energy rate per proton
 *   - Neutron: +1% stability (reduces prestige cost scaling)
 *   - Electron: +0.5% attraction radius per electron
 */

export class SubatomicEngine {
  #unlocked = false;
  #eventBus = null;
  #resourceManager = null;
  #upgradeSystem = null;
  #quarkEngine = null;

  // Base production rates (per second)
  #baseQuarkRate = 0.5;     // quarks per second base
  #baseElectronRate = 0.2;  // electrons per second base

  // Formation toggles (auto-craft when enabled)
  #autoFormProtons = false;
  #autoFormNeutrons = false;

  // Frame-independent formation accumulators (fractional progress)
  #protonAccum = 0;
  #neutronAccum = 0;

  constructor(EventBus, resourceManager, upgradeSystem, quarkEngine) {
    this.#eventBus = EventBus;
    this.#resourceManager = resourceManager;
    this.#upgradeSystem = upgradeSystem;
    this.#quarkEngine = quarkEngine;
  }

  unlock() {
    this.#unlocked = true;
    // Make subatomic resources visible
    for (const id of ['quark_up', 'quark_down', 'proton', 'neutron', 'electron']) {
      const res = this.#resourceManager.get(id);
      if (res) res.visible = true;
    }
    // Unhide subatomic upgrades
    const subUpgrades = [
      'upg_quarkConfinement', 'upg_protonForge2', 'upg_neutronBinder',
      'upg_leptonField', 'upg_electronCascade', 'upg_nuclearForce',
      'upg_neutronShell', 'upg_electronShell',
    ];
    for (const id of subUpgrades) {
      this.#upgradeSystem.setHidden?.(id, false);
    }
    this.#eventBus.emit('subatomic:unlocked');
  }

  isUnlocked() { return this.#unlocked; }

  setAutoFormProtons(v) { this.#autoFormProtons = v; }
  setAutoFormNeutrons(v) { this.#autoFormNeutrons = v; }
  getAutoFormProtons() { return this.#autoFormProtons; }
  getAutoFormNeutrons() { return this.#autoFormNeutrons; }

  /**
   * Main tick — called each game loop iteration.
   * @param {number} dt — seconds since last tick
   */
  tick(dt) {
    if (!this.#unlocked) return;

    const rm = this.#resourceManager;
    const us = this.#upgradeSystem;

    // --- Quark production (based on quark allocation ratios) ---
    const allocations = this.#quarkEngine.getAllocations();
    const upFrac = allocations.up ?? 0;
    const downFrac = allocations.down ?? 0;
    const quarkRate = this.#baseQuarkRate;

    if (upFrac > 0) {
      rm.add('quark_up', quarkRate * upFrac * dt);
    }
    if (downFrac > 0) {
      rm.add('quark_down', quarkRate * downFrac * dt);
    }

    // --- Hadron formation (if Quark Confinement unlocked) ---
    const hasConfinement = (us.getLevel('upg_quarkConfinement') ?? 0) >= 1;
    if (hasConfinement) {
      const protonRateMult = Math.pow(1.5, us.getLevel('upg_protonForge2') ?? 0);
      const neutronRateMult = Math.pow(1.5, us.getLevel('upg_neutronBinder') ?? 0);

      // Auto-form protons: 2 up + 1 down → 1 proton
      if (this.#autoFormProtons) {
        this.#protonAccum += protonRateMult * dt;
        const wantToForm = Math.floor(this.#protonAccum);
        if (wantToForm > 0) {
          const upQ = rm.get('quark_up')?.currentValue ?? 0;
          const downQ = rm.get('quark_down')?.currentValue ?? 0;
          const protonRes = rm.get('proton');
          const protonCap = protonRes?.cap ?? 0;
          const canForm = Math.min(
            wantToForm,
            Math.floor(upQ / 2),
            Math.floor(downQ / 1),
            Math.max(0, protonCap - (protonRes?.currentValue ?? 0))
          );
          if (canForm > 0) {
            rm.add('quark_up', -canForm * 2);
            rm.add('quark_down', -canForm * 1);
            rm.add('proton', canForm);
            this.#protonAccum -= canForm;
          } else {
            this.#protonAccum -= wantToForm; // couldn't form, discard progress
          }
        }
      }

      // Auto-form neutrons: 1 up + 2 down → 1 neutron
      if (this.#autoFormNeutrons) {
        this.#neutronAccum += neutronRateMult * dt;
        const wantToForm = Math.floor(this.#neutronAccum);
        if (wantToForm > 0) {
          const upQ = rm.get('quark_up')?.currentValue ?? 0;
          const downQ = rm.get('quark_down')?.currentValue ?? 0;
          const neutronRes = rm.get('neutron');
          const neutronCap = neutronRes?.cap ?? 0;
          const canForm = Math.min(
            wantToForm,
            Math.floor(upQ / 1),
            Math.floor(downQ / 2),
            Math.max(0, neutronCap - (neutronRes?.currentValue ?? 0))
          );
          if (canForm > 0) {
            rm.add('quark_up', -canForm * 1);
            rm.add('quark_down', -canForm * 2);
            rm.add('neutron', canForm);
            this.#neutronAccum -= canForm;
          } else {
            this.#neutronAccum -= wantToForm;
          }
        }
      }
    }

    // --- Electron generation (if Lepton Field unlocked) ---
    const hasLeptonField = (us.getLevel('upg_leptonField') ?? 0) >= 1;
    if (hasLeptonField) {
      const electronRateMult = Math.pow(1.5, us.getLevel('upg_electronCascade') ?? 0);
      const electronRes = rm.get('electron');
      const electronCap = electronRes?.cap ?? 0;
      const current = electronRes?.currentValue ?? 0;
      if (current < electronCap) {
        const gen = this.#baseElectronRate * electronRateMult * dt;
        rm.add('electron', Math.min(gen, electronCap - current));
      }
    }
  }

  /**
   * Get passive bonuses from subatomic particles.
   * @returns {{ energyRateBonus: number, stabilityBonus: number, attractRadiusBonus: number }}
   */
  getPassiveBonuses() {
    if (!this.#unlocked) return { energyRateBonus: 0, stabilityBonus: 0, attractRadiusBonus: 0 };
    const rm = this.#resourceManager;
    const protons = rm.get('proton')?.currentValue ?? 0;
    const neutrons = rm.get('neutron')?.currentValue ?? 0;
    const electrons = rm.get('electron')?.currentValue ?? 0;

    return {
      energyRateBonus: protons * 0.02,       // +2% per proton
      stabilityBonus: neutrons * 0.01,        // +1% per neutron
      attractRadiusBonus: electrons * 0.005,  // +0.5% per electron
    };
  }

  // ── Save / Load ──────────────────────────────────────────────────────

  getState() {
    return {
      unlocked: this.#unlocked,
      autoFormProtons: this.#autoFormProtons,
      autoFormNeutrons: this.#autoFormNeutrons,
    };
  }

  loadState(state) {
    if (!state) return;
    this.#unlocked = state.unlocked ?? false;
    this.#autoFormProtons = state.autoFormProtons ?? false;
    this.#autoFormNeutrons = state.autoFormNeutrons ?? false;
    if (this.#unlocked) {
      // Re-make resources visible on load
      for (const id of ['quark_up', 'quark_down', 'proton', 'neutron', 'electron']) {
        const res = this.#resourceManager.get(id);
        if (res) res.visible = true;
      }
      // Re-unhide subatomic upgrades on load
      const subUpgrades = [
        'upg_quarkConfinement', 'upg_protonForge2', 'upg_neutronBinder',
        'upg_leptonField', 'upg_electronCascade', 'upg_nuclearForce',
        'upg_neutronShell', 'upg_electronShell',
      ];
      for (const id of subUpgrades) {
        this.#upgradeSystem.setHidden?.(id, false);
      }
    }
  }

  reset() {
    // Subatomic resources persist across prestige within an epoch
    // Only reset formation toggles and accumulators
    this.#autoFormProtons = false;
    this.#autoFormNeutrons = false;
    this.#protonAccum = 0;
    this.#neutronAccum = 0;
  }
}
