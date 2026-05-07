/**
 * DarkMatterSystem — Manages dark matter nodes that spawn in the void,
 * emit gravity-disrupting waves, and are collected by the player.
 *
 * Nodes are created by threshold-triggered spawners rather than a fixed timer.
 */

export class DarkMatterSystem {
  /**
   * @param {import('../core/EventBus.js?v=afe6d74').EventBus} eventBus
   * @param {import('./UpgradeSystem.js?v=afe6d74').UpgradeSystem} upgradeSystem
   */
  constructor(eventBus, upgradeSystem) {
    this.bus = eventBus;
    this.upgradeSystem = upgradeSystem;

    this.active = false;
    /** @type {Array<{x:number, y:number, pulseTimer:number, pulseInterval:number, pulsing:boolean, waveRadius:number, waveMaxRadius:number, waveAlpha:number, nodeRadius:number, flickerTimer:number, displayOpacity:number, collected:boolean, _reflTriggered:boolean, reflWave:{x:number,y:number,radius:number,alpha:number}|null}>} */
    this.nodes = [];
    this.totalCollected = 0;

    /** @type {{x:number, y:number, w:number, h:number}|null} */
    this._voidBounds = null;
    this._spawnTimer = 3.0;

    this._maxNodeBonus = 0;
    this._collectRadiusBonus = 0;

    /** @type {Set<string>} IDs of creation thresholds already crossed */
    this._thresholdsMet = new Set();
    /** @type {Array<{id:string, condition:function, baseNodes:number, rateInterval:number, rateResourceId:string, rateThreshold:number, _progress:number}>} */
    this._spawners = this._buildSpawners();

    /** @type {import('./ResourceManager.js?v=afe6d74').ResourceManager|null} */
    this._resourceManager = null;
    /** @type {import('./MilestoneSystem.js?v=afe6d74').MilestoneSystem|null} */
    this._milestoneSystem = null;
  }

  /** Set the void region bounds used for node placement. */
  setVoidBounds(bounds) {
    this._voidBounds = bounds;
  }

  setMaxNodeBonus(n) { this._maxNodeBonus = n; }
  setCollectRadiusBonus(n) { this._collectRadiusBonus = n; }

  setResourceManager(rm) {
    this._resourceManager = rm;
  }

  setMilestoneSystem(milestoneSystem) {
    this._milestoneSystem = milestoneSystem;
  }

  setPrestigeSystem(ps) {
    this._prestigeSystem = ps;
  }

  /** Activate the system (called at ms_gasCloud milestone). */
  activate() {
    this.active = true;
    // Don't pre-spawn; threshold system creates nodes when conditions are met
  }

  // ── Parameter derivation from upgrades ───────────────────────────────

  _getParams() {
    const waveLevel = this.upgradeSystem.getLevel('upg_gravityAmplifier2') || 0;
    const bonuses = this._prestigeSystem?.getRuntimeBonuses() ?? {};
    return {
      spawnInterval: 8,
      maxNodes: 1 + (bonuses.dmMaxNodeBonus ?? 0) + this._maxNodeBonus,
      collectRadius: 60 + (bonuses.dmCollectRadiusBonus ?? 0) + this._collectRadiusBonus,
      waveStrength: 180 + waveLevel * 80,
    };
  }

  // ── Threshold spawners ────────────────────────────────────────────────

  _buildSpawners() {
    return [
      {
        id: 'energy_1k',
        label: 'Energy ≥ 1,000',
        baseNodes: 1,
        condition: (res) => (res.energy?.currentValue ?? 0) >= 1000,
        rateInterval: 5000,
        rateResourceId: 'energy',
        rateThreshold: 5000,
        _progress: 0,
      },
      {
        id: 'energy_10k',
        label: 'Energy ≥ 10,000',
        baseNodes: 2,
        condition: (res) => (res.energy?.currentValue ?? 0) >= 10000,
        rateInterval: 2500,
        rateResourceId: 'energy',
        rateThreshold: 2500,
        _progress: 0,
      },
      {
        id: 'ms_firstAtom',
        label: 'First Hydrogen',
        baseNodes: 5,
        condition: (res, ms) => ms && ms.isTriggered('ms_firstAtom'),
        rateInterval: 5000,
        rateResourceId: 'hydrogen',
        rateThreshold: 5000,
        _progress: 0,
      },
      {
        id: 'ms_heliumAccumulated',
        label: 'Helium Accumulated',
        baseNodes: 3,
        condition: (res, ms) => ms && ms.isTriggered('ms_heliumAccumulated'),
        rateInterval: 500,
        rateResourceId: 'helium',
        rateThreshold: 500,
        _progress: 0,
      },
      {
        id: 'ms_carbonForged',
        label: 'Carbon Forged',
        baseNodes: 4,
        condition: (res, ms) => ms && ms.isTriggered('ms_carbonForged'),
        rateInterval: 100,
        rateResourceId: 'carbon',
        rateThreshold: 100,
        _progress: 0,
      },
      {
        id: 'ms_firstWater',
        label: 'First Water',
        baseNodes: 2,
        condition: (res, ms) => ms && ms.isTriggered('ms_firstWater'),
        rateInterval: 100,
        rateResourceId: 'mol_h2o',
        rateThreshold: 100,
        _progress: 0,
      },
    ];
  }

  // ── Internal ─────────────────────────────────────────────────────────

  _spawnNode(params) {
    if (!this._voidBounds) return;
    const b = this._voidBounds;
    const margin = 350;
    if (b.w <= margin * 2 || b.h <= margin * 2) return;

    const x = b.x + margin + Math.random() * (b.w - margin * 2);
    const y = b.y + margin + Math.random() * (b.h - margin * 2);

    this.nodes.push({
      x,
      y,
      pulseTimer: 1 + Math.random() * 1.25,
      pulseInterval: 1.25 + Math.random() * 1.5,
      waveStrength: params.waveStrength,
      pulsing: false,
      waveRadius: 0,
      waveMaxRadius: 0,
      waveAlpha: 0,
      nodeRadius: 5 + Math.random() * 4,
      flickerTimer: Math.random() * Math.PI * 2,
      displayOpacity: 0,
      collected: false,
      reflWave: null,
      _reflTriggered: false,
    });
  }

  _checkThresholds(dt) {
    // Build a simple resource snapshot for the spawner conditions
    const res = {};
    for (const spawner of this._spawners) {
      if (spawner.rateResourceId && !res[spawner.rateResourceId]) {
        const s = this._resourceManager?.get(spawner.rateResourceId);
        if (s) res[spawner.rateResourceId] = s;
      }
    }
    // Also get energy for condition checks
    const energyS = this._resourceManager?.get('energy');
    if (energyS) res.energy = energyS;

    const ms = this._milestoneSystem;
    const params = this._getParams();

    for (const spawner of this._spawners) {
      const conditionMet = spawner.condition(res, ms);
      if (!conditionMet) continue;

      // First crossing: burst grant
      if (!this._thresholdsMet.has(spawner.id)) {
        this._thresholdsMet.add(spawner.id);
        for (let i = 0; i < spawner.baseNodes; i++) {
          this._spawnNode(params);
        }
        this.bus.emit('darkMatter:threshold', { id: spawner.id, label: spawner.label, nodes: spawner.baseNodes });
      }

      // Continuous generation: accumulate resource progress
      const rState = this._resourceManager?.get(spawner.rateResourceId);
      const rValue = rState?.currentValue ?? 0;
      if (rValue >= spawner.rateThreshold) {
        // nodes.length < maxNodes guard — only spawn if room
        if (this.nodes.length < params.maxNodes) {
          spawner._progress += dt;
          // Rate: roughly 1 node per (rateInterval / resourceValue) seconds
          const spawnEvery = Math.max(5, spawner.rateInterval / rValue);
          if (spawner._progress >= spawnEvery) {
            spawner._progress -= spawnEvery;
            this._spawnNode(params);
          }
        }
      }
    }
  }

  // ── Public update — called from main.js each game tick ────────────────

  /**
   * Update all nodes; return array of collected node events.
   * @param {number} dt  Delta time in seconds
   * @param {number} playerX  World X of the player (home object)
   * @param {number} playerY  World Y of the player
   * @returns {Array<{x:number, y:number, value:number}>}
   */
  update(dt, playerX, playerY) {
    if (!this.active) return [];

    // Check creation thresholds
    this._checkThresholds(dt);

    const params = this._getParams();
    const collected = [];

    for (const node of this.nodes) {
      // Gentle flicker: slow sinusoidal opacity variation
      node.flickerTimer += dt * 0.7;
      node.displayOpacity = 0.10 + Math.sin(node.flickerTimer) * 0.04;

      // Distance to player — computed once, used for pulse sizing, ripple trigger, and collection
      const dx = playerX - node.x;
      const dy = playerY - node.y;
      const distToPlayer = Math.sqrt(dx * dx + dy * dy);

      // Pulse countdown — wave max radius = player distance + 200 px so it just passes them
      node.pulseTimer -= dt;
      if (node.pulseTimer <= 0) {
        const waveMaxRadius = distToPlayer + 200;
        node.pulseTimer = node.pulseInterval;
        node.pulsing = true;
        node.waveRadius = 0;
        node.waveMaxRadius = waveMaxRadius;
        node.waveAlpha = 0.55;
        node._reflTriggered = false;
        node.reflWave = null;
        // Notify the rest of the system — ParticleSystem applies radial force
        this.bus.emit('darkMatter:wave', {
          x: node.x,
          y: node.y,
          strength: node.waveStrength,
          radius: waveMaxRadius,
        });
      }

      // Expand the visual wave ring
      if (node.pulsing) {
        node.waveRadius += dt * 360;
        node.waveAlpha = Math.max(0, 0.55 * (1 - node.waveRadius / node.waveMaxRadius));
        if (node.waveRadius >= node.waveMaxRadius) {
          node.pulsing = false;
          node.waveAlpha = 0;
        }
      }

      // Reflected ripple: trigger once when wave front crosses player position
      if (node.pulsing && !node._reflTriggered && node.waveRadius >= distToPlayer) {
        node._reflTriggered = true;
        node.reflWave = {
          x: playerX,
          y: playerY,
          radius: 0,
          alpha: 0.5,
        };
      }

      // Advance the reflected ripple
      if (node.reflWave) {
        node.reflWave.radius += dt * 200;
        node.reflWave.alpha = 0.5 * (1 - node.reflWave.radius / 140);
        if (node.reflWave.radius >= 140) {
          node.reflWave = null;
        }
      }

      // Collection: player proximity check
      if (dx * dx + dy * dy < params.collectRadius * params.collectRadius) {
        const value = 1;
        this.totalCollected++;
        collected.push({ x: node.x, y: node.y, value });
        node.collected = true;
      }
    }

    // Remove collected nodes
    this.nodes = this.nodes.filter(n => !n.collected);

    return collected;
  }

  /** Returns the live node array for rendering. */
  getNodes() {
    return this.nodes;
  }

  // ── Save / load ───────────────────────────────────────────────────────

  getState() {
    return {
      totalCollected: this.totalCollected,
      thresholdsMet: Array.from(this._thresholdsMet),
      spawnerProgress: this._spawners.map(s => ({ id: s.id, _progress: s._progress })),
    };
  }

  loadState(state) {
    if (!state) return;
    this.totalCollected = state.totalCollected || 0;
    if (Array.isArray(state.thresholdsMet)) {
      this._thresholdsMet = new Set(state.thresholdsMet);
    }
    if (Array.isArray(state.spawnerProgress)) {
      for (const entry of state.spawnerProgress) {
        const spawner = this._spawners.find(s => s.id === entry.id);
        if (spawner) spawner._progress = entry._progress || 0;
      }
    }
  }

  reset() {
    this.active = false;
    this.nodes = [];
    this.totalCollected = 0;
    this._spawnTimer = 3.0;
    this._thresholdsMet = new Set();
    for (const s of this._spawners) s._progress = 0;
  }
}
