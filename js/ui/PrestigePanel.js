/**
 * PrestigePanel — Full-screen overlay with animated star-field and tiered upgrade tree.
 *
 * Tiers displayed:
 *   Tier 1 (always) — gold  — Energetic Echo, Vacuum Expansion, Mote Acceleration
 *   Tier 2 (≥3 pts) — blue  — Auto-production, Instant Prestige, Conversion Boost, Primal Memory
 *   Tier 3 (≥10 pts)— purple— Bulk Prestige, Celestial Quanta
 *   Echo Tree        — cyan  — Quark Sight etc. (post-Collapse only)
 *
 * Star-field background rendered on a canvas element.
 * Upgrade nodes rendered as HTML over the canvas.
 * Leave confirmation shown inline when closing with unspent Aeons while in purgatory.
 */

import { PrestigeSystem } from '../engine/PrestigeSystem.js?v=afe6d74';

const TIER_CONFIG = [
  { tier: 1, label: 'Tier I — Primal',      color: '#ffd700', unlockMsg: null },
  { tier: 2, label: 'Tier II — Automation', color: '#60a5fa', unlockMsg: 'Spend 3 Aeons to unlock' },
  { tier: 3, label: 'Tier III — Transcendent', color: '#a78bfa', unlockMsg: 'Spend 10 Aeons to unlock' },
];

const ECHO_BRANCH_CONFIG = { label: 'Epoch Echoes', color: '#44dddd' };

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
    this._inPurgatory = false;
    this._leaveConfirmVisible = false;
  }

  // ── Init ──────────────────────────────────────────────────────────────

  init() {
    this.overlay = document.getElementById('prestige-overlay');
    if (!this.overlay) return;

    this.canvas = this.overlay.querySelector('#prestige-starfield');
    if (this.canvas) this.ctx = this.canvas.getContext('2d');

    this._buildStars(200);

    // Close button — intercept for leave confirmation
    const closeBtn = this.overlay.querySelector('#prestige-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this._requestHide());

    // Prestige button — execute then enter purgatory
    const prestigeBtn = this.overlay.querySelector('#prestige-action-btn');
    if (prestigeBtn) prestigeBtn.addEventListener('click', () => {
      if (this.prestigeSystem.canPrestige()) {
        this.prestigeSystem.executePrestige();
        this._inPurgatory = true;
        this.bus.emit('prestige:purgatory:enter');
      }
    });

    // Leave confirmation buttons
    const leaveYes = this.overlay.querySelector('#prestige-leave-yes');
    const leaveNo  = this.overlay.querySelector('#prestige-leave-no');
    if (leaveYes) leaveYes.addEventListener('click', () => this._confirmLeave());
    if (leaveNo)  leaveNo.addEventListener('click',  () => this._cancelLeave());

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
    this._leaveConfirmVisible = false;
    this.overlay.classList.remove('hidden');
    this._hideLeaveConfirm();
    this._resizeCanvas();
    this._renderHeader();
    this._renderTree();
    this._startAnimation();
    if (this.moteController) this.moteController.blockAllInput();
  }

  /** Request to hide — shows leave confirmation if purgatory + unspent Aeons. */
  _requestHide() {
    if (this._inPurgatory && this.prestigeSystem.getAeonCount() > 0) {
      this._showLeaveConfirm();
    } else {
      this.hide();
    }
  }

  hide() {
    if (!this.overlay) return;
    if (this._inPurgatory) {
      this._inPurgatory = false;
      this.bus.emit('prestige:purgatory:exit');
    }
    this._visible = false;
    this._leaveConfirmVisible = false;
    this.overlay.classList.add('hidden');
    this._stopAnimation();
    if (this.moteController) this.moteController.unblockAllInput();
  }

  isVisible()     { return this._visible; }
  isInPurgatory() { return this._inPurgatory; }

  // ── Leave confirmation ────────────────────────────────────────────────

  _showLeaveConfirm() {
    const el = this.overlay?.querySelector('#prestige-leave-confirm');
    if (!el) { this.hide(); return; }
    const aeons = this.prestigeSystem.getAeonCount();
    const msgEl = el.querySelector('#prestige-leave-msg');
    if (msgEl) msgEl.textContent = `You have ${aeons} unspent Aeon${aeons !== 1 ? 's' : ''}. They'll be banked for your next run.`;
    el.classList.remove('hidden');
    this._leaveConfirmVisible = true;
  }

  _hideLeaveConfirm() {
    const el = this.overlay?.querySelector('#prestige-leave-confirm');
    if (el) el.classList.add('hidden');
    this._leaveConfirmVisible = false;
  }

  _confirmLeave() {
    this._hideLeaveConfirm();
    this.hide();
  }

  _cancelLeave() {
    this._hideLeaveConfirm();
  }

  // ── Star-field ────────────────────────────────────────────────────────

  _buildStars(count) {
    this._stars = [];
    for (let i = 0; i < count; i++) {
      this._stars.push({
        x: Math.random(), y: Math.random(),
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

  // ── Header ────────────────────────────────────────────────────────────

  _renderHeader() {
    const el = this.overlay?.querySelector('#prestige-dm-display');
    if (!el) return;
    const ps = this.prestigeSystem;
    const aeons  = ps.getAeonCount();
    const echoes = ps.getEpochEchoCount();
    const cap    = ps.getCurrentEnergyCap();
    const reward = ps.getPrestigeAeonReward();
    const spent  = ps.getPointsSpentTotal();
    const t2Rem  = Math.max(0, 3  - spent);
    const t3Rem  = Math.max(0, 10 - spent);

    el.innerHTML =
      `<span style="color:#ffd700">✦ ${aeons} Aeon${aeons !== 1 ? 's' : ''}</span>` +
      (echoes > 0 ? ` <span style="color:#44dddd;margin-left:12px">◈ ${echoes} Epoch Echo${echoes !== 1 ? 's' : ''}</span>` : '') +
      `<br><span style="font-size:0.85em;opacity:0.7">Energy Cap: ${cap.toLocaleString()} | Next prestige: +${reward} Aeon${reward !== 1 ? 's' : ''}</span>` +
      (t2Rem > 0 ? `<br><span style="font-size:0.8em;color:#60a5fa;opacity:0.8">Tier II unlocks in ${t2Rem} more spent Aeon${t2Rem !== 1 ? 's' : ''}</span>` : '') +
      (t3Rem > 0 && spent >= 3 ? `<br><span style="font-size:0.8em;color:#a78bfa;opacity:0.8">Tier III unlocks in ${t3Rem} more spent Aeon${t3Rem !== 1 ? 's' : ''}</span>` : '');

    const btn = this.overlay?.querySelector('#prestige-action-btn');
    if (btn) {
      if (this._inPurgatory) {
        btn.disabled = true;
        btn.textContent = '✓ Prestige Complete — Exit to Begin';
        btn.title = 'Close this menu to start your next run.';
        btn.style.opacity = '0.7';
      } else {
        const canPrestige = ps.canPrestige();
        const blockedMsg = canPrestige ? null : (ps.canPrestigeBlockedMessage?.() ?? 'Fill energy to cap to prestige');
        btn.disabled = !canPrestige;
        btn.textContent = canPrestige ? `Prestige (+${reward} Aeon${reward !== 1 ? 's' : ''})` : blockedMsg;
        btn.title = canPrestige ? 'Reset this run and earn Aeons' : blockedMsg;
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

    // Render prestige tiers
    for (const cfg of TIER_CONFIG) {
      const upgrades = {
        1: PrestigeSystem.TIER1,
        2: PrestigeSystem.TIER2,
        3: PrestigeSystem.TIER3,
      }[cfg.tier] ?? [];
      container.appendChild(this._buildTierBlock(cfg, upgrades));
    }

    // Echo branch (only if player has echoes or has any echo upgrade)
    const ps = this.prestigeSystem;
    const hasEchoes = ps.getEpochEchoCount() > 0 || ps.getLevel('prs_quarkSight') >= 1;
    if (hasEchoes) {
      const echoUpgrades = PrestigeSystem.ECHO_TREE.collapse ?? [];
      container.appendChild(this._buildBranch(ECHO_BRANCH_CONFIG, echoUpgrades, 'echo'));
    }
  }

  _buildTierBlock(cfg, upgrades) {
    const ps = this.prestigeSystem;
    const unlocked = ps.getTierUnlocked(cfg.tier);
    const spent    = ps.getPointsSpentTotal();

    const block = document.createElement('div');
    block.className = `prs-tier prs-tier--${cfg.tier}${unlocked ? '' : ' prs-tier--locked'}`;

    const title = document.createElement('div');
    title.className = 'prs-branch-title';
    title.style.color = cfg.color;
    title.textContent = cfg.label;

    if (!unlocked && cfg.unlockMsg) {
      const lockBadge = document.createElement('span');
      lockBadge.className = 'prs-tier-lock-badge';
      lockBadge.textContent = ` (${cfg.unlockMsg})`;
      lockBadge.style.color = 'rgba(255,255,255,0.4)';
      lockBadge.style.fontSize = '0.8em';
      title.appendChild(lockBadge);
    } else if (unlocked && cfg.tier === 2) {
      const nextThresh = 10 - spent;
      if (nextThresh > 0) {
        const progressNote = document.createElement('span');
        progressNote.style.cssText = 'font-size:0.75em;color:#a78bfa;opacity:0.7;margin-left:8px';
        progressNote.textContent = `(Tier III in ${nextThresh} Aeon${nextThresh !== 1 ? 's' : ''})`;
        title.appendChild(progressNote);
      }
    }
    block.appendChild(title);

    if (!unlocked) {
      const lockedHint = document.createElement('div');
      lockedHint.className = 'prs-tier-locked-hint';
      lockedHint.style.cssText = 'opacity:0.35;font-size:0.8em;padding:4px 8px';
      lockedHint.textContent = upgrades.map(u => u.name).join(' · ');
      block.appendChild(lockedHint);
    } else {
      const chain = document.createElement('div');
      chain.className = 'prs-chain';
      for (const def of upgrades) {
        chain.appendChild(this._buildUpgradeNode(def, cfg.color, 'aeon'));
      }
      block.appendChild(chain);
    }
    return block;
  }

  _buildBranch(cfg, upgrades, currency) {
    const branch = document.createElement('div');
    branch.className = 'prs-branch prs-branch--echo';

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
    const locked    = def.requires && ps.getLevel(def.requires) < 1;
    const canAfford = ps.canAffordUpgrade(def.id);

    let stateClass = 'prs-node--locked';
    if (purchased)        stateClass = 'prs-node--purchased';
    else if (canAfford)   stateClass = 'prs-node--available';
    else if (!locked)     stateClass = 'prs-node--seen';

    const node = document.createElement('div');
    node.className = `prs-node ${stateClass}`;
    node.style.setProperty('--branch-color', color);

    const levelBadge    = maxLevel > 1 ? ` <span class="prs-level">${level}/${maxLevel}</span>` : '';
    const currencySymbol = currency === 'echo' ? '◈' : '✦';
    const currencyLabel  = currency === 'echo' ? 'Echo' : 'Aeon';
    const cost           = currency === 'echo' ? (def.cost ?? 1) : ps.getUpgradeCost(def.id);
    const costDisplay    = purchased ? '✓' : `${currencySymbol} ${cost} ${currencyLabel}${cost !== 1 ? 's' : ''}`;

    node.innerHTML = `
      <div class="prs-node-dot"></div>
      <div class="prs-node-body">
        <div class="prs-node-name">${def.name}${levelBadge}</div>
        <div class="prs-node-desc">${def.description}</div>
        <div class="prs-node-cost">${costDisplay}</div>
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
