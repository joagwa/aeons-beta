/**
 * OrbitalEnergyDisplay — renders motes orbiting the player representing current energy.
 * Energy is displayed in base-10: each tier shows the corresponding digit as orbiting motes.
 * Tier 0 = ones (radius 60), Tier 1 = tens (radius 80), ..., Tier 4 = ten-thousands (radius 170).
 */

const TIERS = [
  { radius: 60,  moteSize: 2.5, color: '#5878c0', speed: 1.5  }, // ones
  { radius: 80,  moteSize: 4,   color: '#00d4ff', speed: 1.0  }, // tens
  { radius: 105, moteSize: 6,   color: '#c850ff', speed: 0.7  }, // hundreds
  { radius: 135, moteSize: 8,   color: '#ffd700', speed: 0.45 }, // thousands
  { radius: 170, moteSize: 11,  color: '#ffffff', speed: 0.3  }, // ten-thousands
];

// Minimum player visual size driven by the highest active tier
const TIER_PLAYER_MIN_SIZE = [5, 7, 10, 14, 18];

export class OrbitalEnergyDisplay {
  constructor() {
    this._energy = 0;
    this._counts = new Array(TIERS.length).fill(0);
    this._angles = TIERS.map((_, i) => []); // per-tier array of mote angles
    this._flashTimers = new Array(TIERS.length).fill(0); // brief flash on tier rollover
  }

  /** Advance angles and sync mote counts to current energy. */
  update(dt, currentEnergy) {
    const e = Math.max(0, Math.floor(currentEnergy));
    const newCounts = this._computeCounts(e);

    for (let t = 0; t < TIERS.length; t++) {
      const prev = this._counts[t];
      const next = newCounts[t];

      if (prev !== next) {
        this._redistributeAngles(t, next);
        this._counts[t] = next;
        // Flash on the next tier when this tier rolls from 9 → 0
        if (prev > 0 && next === 0 && t + 1 < TIERS.length) {
          this._flashTimers[t + 1] = Math.min(1, (this._flashTimers[t + 1] || 0) + 0.5);
        }
      }

      for (let i = 0; i < this._angles[t].length; i++) {
        this._angles[t][i] += TIERS[t].speed * dt;
      }
    }

    for (let t = 0; t < TIERS.length; t++) {
      if (this._flashTimers[t] > 0) {
        this._flashTimers[t] = Math.max(0, this._flashTimers[t] - dt * 2.5);
      }
    }

    this._energy = e;
  }

  /** Minimum player visual size based on highest active tier (0 = no energy). */
  getMinPlayerSize() {
    if (this._energy <= 0) return 0;
    const maxTier = Math.min(TIERS.length - 1, Math.floor(Math.log10(this._energy)));
    return TIER_PLAYER_MIN_SIZE[maxTier] ?? 0;
  }

  /**
   * Render orbiting motes on the main canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} sx  Screen X of player centre
   * @param {number} sy  Screen Y of player centre
   */
  render(ctx, sx, sy) {
    ctx.save();
    for (let t = 0; t < TIERS.length; t++) {
      const count = this._counts[t];
      if (count === 0) continue;
      const tier = TIERS[t];
      const flash = this._flashTimers[t] || 0;
      const sizeBoost = 1 + flash * 0.35;

      for (let i = 0; i < count; i++) {
        const angle = this._angles[t][i];
        const mx = sx + Math.cos(angle) * tier.radius;
        const my = sy + Math.sin(angle) * tier.radius;
        const r = tier.moteSize * sizeBoost;

        // Soft glow halo
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, r * 3.5);
        grad.addColorStop(0, tier.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.22 + flash * 0.1;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(mx, my, r * 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.globalAlpha = 0.8 + flash * 0.2;
        ctx.fillStyle = tier.color;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _computeCounts(energy) {
    return TIERS.map((_, t) => Math.floor(energy / Math.pow(10, t)) % 10);
  }

  _redistributeAngles(tierIndex, count) {
    const existing = this._angles[tierIndex];
    const baseAngle = existing.length > 0 ? existing[0] : (tierIndex * Math.PI * 0.4);
    this._angles[tierIndex] = count > 0
      ? Array.from({ length: count }, (_, i) => baseAngle + (i / count) * Math.PI * 2)
      : [];
  }
}
