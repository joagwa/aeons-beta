/**
 * PrestigePanel — Full-screen overlay with animated star-field and Aeon/Echo upgrade tree.
 *
 * Layout: 3 Aeon branches + 1 Echo branch (post-Collapse only).
 *   Expansion (top)   — gold  — Expanded Vacuum
 *   Efficiency (right) — blue  — Quantum Resonance, Mote Inheritance
 *   Memory (left)      — purple — Primal Memory, Echo Chamber
 *   Collapse (bottom)  — cyan  — Echo upgrades (Quark Sight, etc.)
 *
 * Star-field background rendered on a canvas element.
 * Upgrade nodes rendered as HTML over the canvas.
 */

import { PrestigeSystem } from '../engine/PrestigeSystem.js?v=8bf03cd';

const AEON_BRANCHES = {
  expansion:   { label: 'Expansion',  color: '#ffd700' },
  efficiency:  { label: 'Efficiency', color: '#60a5fa' },
  memory:      { label: 'Memory',     color: '#a78bfa' },
};

const ECHO_BRANCHES = {
  collapse:    { label: 'Epoch Echoes', color: '#44dddd' },
};

export class PrestigePanel {
  constructor(EventBus, prestigeSystem, moteController = null) {
    this.bus = EventBus;
    this.prestigeSystem = prestigeSystem;
    this.moteController = moteController;
    this.overlay = null;
    this.canvas  = null;
    this.ctx     = null;
    this._stars  = [];
    this._animId = null;
    this._visible = false;
    this._inPurgatory = false; // true when prestige executed but menu still open
  }

  // ── Init ──────────────────────────────────────────────────────────────

  init() {
    this.overlay = document.getElementById('prestige-overlay');
    if (!this.overlay) return;

    this.canvas = this.overlay.querySelector('#prestige-starfield');
    if (this.canvas) this.ctx = this.canvas.getContext('2d');

    this._buildStars(200);

    // Close button
    const closeBtn = this.overlay.querySelector('#prestige-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hide());

    // Prestige button — enter purgatory (execute but keep menu open)
    const prestigeBtn = this.overlay.querySelector('#prestige-action-btn');
    if (prestigeBtn) prestigeBtn.addEventListener('click', () => {
      if (this.prestigeSystem.canPrestige()) {
        // Execute prestige (reset happens now)
        this.prestigeSystem.executePrestige();
        // Enter purgatory state (menu stays open, game is in limbo)
        this._inPurgatory = true;
        this.bus.emit('prestige:purgatory:enter');
      }
    });

    this.bus.on('prestige:upgrade:purchased', () => this._renderTree());
    this.bus.on('prestige:execute',           () => this._renderTree());
    this.bus.on('epochEcho:awarded',          () => this._renderTree());

    window.addEventListener('resize', () => {
      this._resizeCanvas();
      this._renderTree();
    });
  }

  show() {
    if (!this.overlay) return;
    this._visible = true;
    this.overlay.classList.remove('hidden');
    this._resizeCanvas();
    this._renderHeader();
    this._renderTree();
    this._startAnimation();
    // Block player input when prestige panel opens
    if (this.moteController) {
      this.moteController.blockAllInput();
    }
  }

  hide() {
    if (!this.overlay) return;
    
    // If exiting purgatory, complete the post-reset sequence
    if (this._inPurgatory) {
      this._inPurgatory = false;
      this.bus.emit('prestige:purgatory:exit');
    }
    
    this._visible = false;
    this.overlay.classList.add('hidden');
    this._stopAnimation();
    // Unblock player input when prestige panel closes
    if (this.moteController) {
      this.moteController.unblockAllInput();
    }
  }

  isVisible() { return this._visible; }

  isInPurgatory() { return this._inPurgatory; }

  // ── Star-field ────────────────────────────────────────────────────────

  _buildStars(count) {
    this._stars = [];
    for (let i = 0; i < count; i++) {
      this._stars.push({
        x: Math.random(),
        y: Math.random(),
        r: 0.3 + Math.random() * 1.2,
        a: 0.2 + Math.random() * 0.6,
        da: (Math.random() - 0.5) * 0.008,
      });
    }
  }

  _resizeCanvas() {
    if (!this.canvas || !this.overlay) return;
    this.canvas.width  = this.overlay.offsetWidth;
    this.canvas.height = this.overlay.offsetHeight;
  }

  _startAnimation() {
    if (this._animId) return;
    const loop = () => {
      if (!this._visible) { this._animId = null; return; }
      this._drawStars();
      this._animId = requestAnimationFrame(loop);
    };
    this._animId = requestAnimationFrame(loop);
  }

  _stopAnimation() {
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
  }

  _drawStars() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width, h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);
    for (const s of this._stars) {
      s.a = Math.max(0.05, Math.min(0.9, s.a + s.da));
      if (s.a <= 0.05 || s.a >= 0.9) s.da = -s.da;
      this.ctx.beginPath();
      this.ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(255,255,255,${s.a})`;
      this.ctx.fill();
    }
  }

  // ── Header (Aeon balance + prestige button) ────────────────────────────

  _renderHeader() {
    const el = this.overlay?.querySelector('#prestige-dm-display');
    if (!el) return;
    const ps = this.prestigeSystem;
    const aeons = ps.getAeonCount();
    const echoes = ps.getEpochEchoCount();
    const cap = ps.getCurrentEnergyCap();
    const reward = ps.getPrestigeAeonReward();
    el.innerHTML = `<span style="color:#ffd700">✦ ${aeons} Aeons</span>` +
      (echoes > 0 ? ` <span style="color:#44dddd;margin-left:12px">◈ ${echoes} Epoch Echoes</span>` : '') +
      `<br><span style="font-size:0.85em;opacity:0.7">Energy Cap: ${cap.toLocaleString()} | Next prestige: +${reward} Aeon${reward > 1 ? 's' : ''}</span>`;

    const btn = this.overlay?.querySelector('#prestige-action-btn');
    if (btn) {
      if (this._inPurgatory) {
        // In purgatory — show that prestige is complete
        btn.disabled = true;
        btn.textContent = '✓ Prestige Complete — Exit to Begin';
        btn.title = 'You are in purgatory. Close this menu to start your next run.';
        btn.style.opacity = '0.7';
      } else {
        // Pre-prestige — show prestige option
        const canPrestige = ps.canPrestige();
        btn.disabled = !canPrestige;
        btn.textContent = canPrestige ? `Prestige (+${reward} Aeon${reward > 1 ? 's' : ''})` : 'Reach energy cap to prestige';
        btn.title = canPrestige ? 'Reset this run and earn Aeons' : 'Fill your energy to the cap first';
        btn.style.opacity = '1';
      }
    }
  }

  // ── Upgrade tree ──────────────────────────────────────────────────────

  _renderTree() {
    this._renderHeader();
    const container = this.overlay?.querySelector('#prestige-tree');
    if (!container) return;
    container.innerHTML = '';

    // Aeon branches
    for (const [branchId, cfg] of Object.entries(AEON_BRANCHES)) {
      const upgrades = PrestigeSystem.AEON_TREE[branchId] ?? [];
      container.appendChild(this._buildBranch(branchId, cfg, upgrades, 'aeon'));
    }

    // Echo branches (only if player has echoes or has purchased echo upgrades)
    const ps = this.prestigeSystem;
    const hasEchoes = ps.getEpochEchoCount() > 0 || ps.getLevel('prs_quarkSight') >= 1;
    if (hasEchoes) {
      for (const [branchId, cfg] of Object.entries(ECHO_BRANCHES)) {
        const upgrades = PrestigeSystem.ECHO_TREE[branchId] ?? [];
        container.appendChild(this._buildBranch(branchId, cfg, upgrades, 'echo'));
      }
    }
  }

  _buildBranch(branchId, cfg, upgrades, currency) {
    const branch = document.createElement('div');
    branch.className = `prs-branch prs-branch--${branchId}`;

    const title = document.createElement('div');
    title.className = 'prs-branch-title';
    title.style.color = cfg.color;
    title.textContent = cfg.label;
    branch.appendChild(title);

    const chain = document.createElement('div');
    chain.className = 'prs-chain';
    for (const def of upgrades) {
      chain.appendChild(this._buildUpgradeNode(def, cfg.color, currency));
    }
    branch.appendChild(chain);
    return branch;
  }

  _buildUpgradeNode(def, color, currency) {
    const ps = this.prestigeSystem;
    const level     = ps.getLevel(def.id);
    const maxLevel  = def.maxLevel ?? 1;
    const purchased = level >= maxLevel;
    const canAfford = ps.canAffordUpgrade(def.id);
    const locked    = def.requires && ps.getLevel(def.requires) < 1;

    let stateClass = 'prs-node--locked';
    if (purchased)    stateClass = 'prs-node--purchased';
    else if (canAfford) stateClass = 'prs-node--available';
    else if (!locked)   stateClass = 'prs-node--seen';

    const node = document.createElement('div');
    node.className = `prs-node ${stateClass}`;
    node.style.setProperty('--branch-color', color);

    const levelBadge = maxLevel > 1 ? ` <span class="prs-level">${level}/${maxLevel}</span>` : '';
    const currencyLabel = currency === 'echo' ? 'Echo' : 'Aeon';
    const currencySymbol = currency === 'echo' ? '◈' : '✦';
    node.innerHTML = `
      <div class="prs-node-dot"></div>
      <div class="prs-node-body">
        <div class="prs-node-name">${def.name}${levelBadge}</div>
        <div class="prs-node-desc">${def.description}</div>
        <div class="prs-node-cost">${currencySymbol} ${def.cost} ${currencyLabel}${def.cost > 1 ? 's' : ''}</div>
      </div>
    `;

    if (canAfford && !purchased) {
      node.addEventListener('click', () => {
        if (ps.purchaseUpgrade(def.id)) this._renderTree();
      });
      node.style.cursor = 'pointer';
    }
    return node;
  }
}
