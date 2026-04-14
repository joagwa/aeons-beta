/**
 * OrbitalEnergyDisplay — renders motes orbiting the player representing current energy.
 * Energy is displayed in base-10: each tier shows the corresponding digit as orbiting motes.
 * Each tier orbits on a distinct inclined plane, projecting a 3D multi-ring appearance.
 * Tier 0 = ones (radius 60), Tier 1 = tens (radius 80), ..., Tier 4 = ten-thousands (radius 170).
 *
 * Render order matters for depth: call renderBack() BEFORE drawing the player, then
 * renderFront() AFTER, so near-side motes appear in front and far-side motes behind.
 */

// Each tier has a unique inclination and ascending node to create distinct orbital planes.
// incl: tilt from the screen plane (0 = flat ring, π/2 = edge-on line)
// node: orientation of the tilt axis in screen space
const TIERS = [
  { radius: 60,  moteSize: 2.5, color: '#5878c0', speed: 1.5,  incl: 0,                  node: 0                }, // ones — flat equatorial
  { radius: 80,  moteSize: 4,   color: '#00d4ff', speed: 1.0,  incl: Math.PI / 6,        node: Math.PI * 0.4    }, // tens — 30°
  { radius: 105, moteSize: 6,   color: '#c850ff', speed: 0.7,  incl: Math.PI * 5 / 18,   node: Math.PI * 0.8    }, // hundreds — 50°
  { radius: 135, moteSize: 8,   color: '#ffd700', speed: 0.45, incl: Math.PI * 7 / 18,   node: Math.PI * 1.2    }, // thousands — 70°
  { radius: 170, moteSize: 11,  color: '#ffffff', speed: 0.3,  incl: Math.PI * 4 / 9,    node: Math.PI * 1.6    }, // ten-thousands — 80°
];

// Precompute fixed trig values per tier (incl/node never change at runtime)
TIERS.forEach(t => {
  t._cosNode = Math.cos(t.node);
  t._sinNode = Math.sin(t.node);
  t._cosIncl = Math.cos(t.incl);
  t._sinIncl = Math.sin(t.incl);
});

// Minimum player visual size driven by the highest active tier
const TIER_PLAYER_MIN_SIZE = [5, 7, 10, 14, 18];

export class OrbitalEnergyDisplay {
  constructor() {
    this._energy = 0;
    this._counts = new Array(TIERS.length).fill(0);
    this._angles = TIERS.map(() => []); // per-tier array of mote angles
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
   * Render far-side elements (behind player): orbital path ellipses + motes with oz < 0.
   * Must be called BEFORE the player is drawn.
   */
  renderBack(ctx, sx, sy) {
    ctx.save();

    // Faint orbital path ellipses for each active tier
    for (let t = 0; t < TIERS.length; t++) {
      if (this._counts[t] === 0) continue;
      const tier = TIERS[t];
      ctx.globalAlpha = 0.07;
      ctx.strokeStyle = tier.color;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      // Project tilted circle as ellipse: semi-major=radius, semi-minor=radius*|cosIncl|, rotated by node
      ctx.ellipse(sx, sy, tier.radius, tier.radius * Math.abs(tier._cosIncl), tier.node, 0, Math.PI * 2);
      ctx.stroke();
    }

    this._renderMotes(ctx, sx, sy, false);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Render near-side motes (in front of player): motes with oz >= 0.
   * Must be called AFTER the player is drawn.
   */
  renderFront(ctx, sx, sy) {
    ctx.save();
    this._renderMotes(ctx, sx, sy, true);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Render motes for one depth pass.
   * @param {boolean} frontSide  true = oz >= 0 (near), false = oz < 0 (far)
   */
  _renderMotes(ctx, sx, sy, frontSide) {
    for (let t = 0; t < TIERS.length; t++) {
      const count = this._counts[t];
      if (count === 0) continue;
      const tier = TIERS[t];
      const flash = this._flashTimers[t] || 0;
      const sizeBoost = 1 + flash * 0.35;

      for (let i = 0; i < count; i++) {
        const angle = this._angles[t][i];
        const cosTheta = Math.cos(angle);
        const sinTheta = Math.sin(angle);

        // Orthographic 3D projection of a tilted circular orbit
        const ox = tier.radius * (cosTheta * tier._cosNode - sinTheta * tier._cosIncl * tier._sinNode);
        const oy = tier.radius * (cosTheta * tier._sinNode + sinTheta * tier._cosIncl * tier._cosNode);
        const oz = tier.radius * sinTheta * tier._sinIncl;

        // Skip motes not on the requested depth side
        if (frontSide ? oz < 0 : oz >= 0) continue;

        // Depth cue: near motes slightly larger/brighter; clamped to avoid extremes
        const depth = Math.max(0.75, Math.min(1.25, 1 + oz / (tier.radius * 3)));
        const mx = sx + ox;
        const my = sy + oy;
        const r = tier.moteSize * sizeBoost * depth;

        // Soft glow halo
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, r * 3.5);
        grad.addColorStop(0, tier.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = (0.22 + flash * 0.1) * depth;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(mx, my, r * 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.globalAlpha = (0.8 + flash * 0.2) * Math.max(0.3, depth);
        ctx.fillStyle = tier.color;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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
