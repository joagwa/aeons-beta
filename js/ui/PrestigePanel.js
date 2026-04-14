/**
 * PrestigePanel — Full-screen overlay with animated star-field and meta upgrade tree.
 *
 * Layout: 4 branches radiate from a central hub.
 *   Production (top)    — yellow — 5 upgrades
 *   Discovery (right)   — blue  — 4 upgrades
 *   Dark Force (left)   — purple — 5 upgrades
 *   Inheritance (bottom)— orange — 5 upgrades
 *
 * Star-field background rendered on a canvas element.
 * Upgrade nodes rendered as HTML over the canvas.
 */

import { PrestigeSystem } from '../engine/PrestigeSystem.js?v=d69ce72';

const BRANCH_CONFIG = {
  production:  { label: 'Production',  color: '#f0c040', angle: -90 },
  discovery:   { label: 'Discovery',   color: '#60a5fa', angle:   0 },
  darkForce:   { label: 'Dark Force',  color: '#a78bfa', angle: 180 },
  inheritance: { label: 'Inheritance', color: '#fb923c', angle:  90 },
};

export class PrestigePanel {
  constructor(EventBus, prestigeSystem) {
    this.bus = EventBus;
    this.prestigeSystem = prestigeSystem;
    this.overlay = null;
    this.canvas  = null;
    this.ctx     = null;
    this._stars  = [];
    this._animId = null;
    this._visible = false;
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

    // Prestige button
    const prestigeBtn = this.overlay.querySelector('#prestige-action-btn');
    if (prestigeBtn) prestigeBtn.addEventListener('click', () => {
      if (this.prestigeSystem.canPrestige()) {
        this.prestigeSystem.executePrestige();
      }
    });

    this.bus.on('prestige:upgrade:purchased', () => this._renderTree());
    this.bus.on('prestige:execute',           () => this._renderTree());
    this.bus.on('darkMatter:threshold',       () => this._renderHeader());
    this.bus.on('darkMatter:collected',       () => this._renderHeader());

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
  }

  hide() {
    if (!this.overlay) return;
    this._visible = false;
    this.overlay.classList.add('hidden');
    this._stopAnimation();
  }

  isVisible() { return this._visible; }

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

  // ── Header (DM balance + prestige button) ─────────────────────────────

  _renderHeader() {
    const el = this.overlay?.querySelector('#prestige-dm-display');
    if (!el) return;
    const banked = this.prestigeSystem.getDarkMatterBanked();
    const runDM  = this.prestigeSystem.getRunDM();
    el.textContent = `Dark Matter: ${banked.toFixed(0)} banked  |  ${runDM.toFixed(0)} this run`;

    const btn = this.overlay?.querySelector('#prestige-action-btn');
    if (btn) {
      const canPrestige = this.prestigeSystem.canPrestige();
      btn.disabled = !canPrestige;
      btn.title    = canPrestige ? 'Reset this run and bank Dark Matter' : 'Requires: ms_firstAtom reached and \u2265 10 DM collected';
    }
  }

  // ── Upgrade tree ──────────────────────────────────────────────────────

  _renderTree() {
    this._renderHeader();
    const container = this.overlay?.querySelector('#prestige-tree');
    if (!container) return;
    container.innerHTML = '';

    for (const [branchId, cfg] of Object.entries(BRANCH_CONFIG)) {
      const upgrades = PrestigeSystem.TREE[branchId] ?? [];
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
        chain.appendChild(this._buildUpgradeNode(def, cfg.color));
      }
      branch.appendChild(chain);
      container.appendChild(branch);
    }
  }

  _buildUpgradeNode(def, color) {
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
    node.innerHTML = `
      <div class="prs-node-dot"></div>
      <div class="prs-node-body">
        <div class="prs-node-name">${def.name}${levelBadge}</div>
        <div class="prs-node-desc">${def.description}</div>
        <div class="prs-node-cost">${def.cost} DM</div>
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
