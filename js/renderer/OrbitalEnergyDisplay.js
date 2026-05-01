/**
 * OrbitalEnergyDisplay — renders motes orbiting the player representing current energy.
 * Energy is displayed in base-10: each tier shows the corresponding digit as orbiting motes.
 * Each tier orbits on a distinct inclined plane, projecting a 3D multi-ring appearance.
 * Tier 0 = ones (radius 50), Tier 1 = tens (radius 68), ..., Tier 6 = millions (radius 210).
 * All tiers are white pre-Collapse; quark colours are applied post-Epoch Collapse.
 *
 * Render order matters for depth: call renderBack() BEFORE drawing the player, then
 * renderFront() AFTER, so near-side motes appear in front and far-side motes behind.
 */

// Each tier has a unique inclination and ascending node to create distinct orbital planes.
// incl: tilt from the screen plane (0 = flat ring, π/2 = edge-on line)
// node: orientation of the tilt axis in screen space
const TIERS = [
  { radius: 50,  moteSize: 2.0,  color: '#ffffff', speed: 2.8,  incl: 0,                    node: 0,             precession: 0.60 }, // ones — flat equatorial
  { radius: 68,  moteSize: 3.0,  color: '#ffffff', speed: 2.1,  incl: Math.PI / 6,          node: Math.PI * 0.4,  precession: 0.40 }, // tens — 30°
  { radius: 88,  moteSize: 4.5,  color: '#ffffff', speed: 1.54, incl: Math.PI * 5 / 18,     node: Math.PI * 0.8,  precession: 0.30 }, // hundreds — 50°
  { radius: 112, moteSize: 6.0,  color: '#ffffff', speed: 1.12, incl: Math.PI * 7 / 18,     node: Math.PI * 1.2,  precession: 0.20 }, // thousands — 70°
  { radius: 140, moteSize: 8.0,  color: '#ffffff', speed: 0.77, incl: Math.PI * 4 / 9,      node: Math.PI * 1.6,  precession: 0.14 }, // ten-thousands — 80°
  { radius: 172, moteSize: 10.0, color: '#ffffff', speed: 0.49, incl: Math.PI / 4,           node: Math.PI * 0.2,  precession: 0.10 }, // hundred-thousands — 45°
  { radius: 210, moteSize: 13.0, color: '#ffffff', speed: 0.31, incl: Math.PI * 67 / 180,   node: Math.PI,        precession: 0.06 }, // millions — 67°
];

// Precompute fixed trig values per tier (incl/node never change at runtime)
TIERS.forEach(t => {
  t._cosNode = Math.cos(t.node);
  t._sinNode = Math.sin(t.node);
  t._cosIncl = Math.cos(t.incl);
  t._sinIncl = Math.sin(t.incl);
});

// Minimum player visual size driven by the highest active tier
const TIER_PLAYER_MIN_SIZE = [5, 7, 10, 14, 18, 22, 26];

export class OrbitalEnergyDisplay {
  constructor() {
    this._energy = 0;
    this._counts = new Array(TIERS.length).fill(0);
    this._angles = TIERS.map(() => []);
    this._tierPhase = new Array(TIERS.length).fill(0);
    this._precessionPhase = new Array(TIERS.length).fill(0); // tracks orbital plane rotation per tier
    // Per-tier tumble phases: even tiers (Y-axis), odd tiers (X-axis, alternating direction)
    this._tumblePhases = new Array(TIERS.length).fill(0);
    // Tumble speeds: starting at 0.60, decreasing by 0.08 per tier
    this._tumbleSpeeds = [0.60, 0.52, 0.44, 0.36, 0.28, 0.20, 0.12];
    this._flashTimers = new Array(TIERS.length).fill(0);
    // Phase animation: { targetPhase, remainingTime } per tier (for smooth 0.2s transitions on mote add)
    this._phaseAnimations = new Array(TIERS.length).fill(null);
    this._speedMultiplier = 1;
    this._radiusScale = 1;
    this._quarkColor = null;
    this._mode = 'energy';
    this._subatomicCounts = { proton: 0, neutron: 0, electron: 0 };
  }

  /** Switch display mode. 'energy' = normal orbital, 'subatomic' = proton/neutron/electron rings. */
  setMode(mode) { this._mode = mode; }
  getMode() { return this._mode; }

  /** Update subatomic particle counts for subatomic mode rendering. */
  setSubatomicCounts(protons, neutrons, electrons) {
    this._subatomicCounts = { proton: protons, neutron: neutrons, electron: electrons };
  }

  /** Advance angles and sync mote counts to current energy. */
  update(dt, currentEnergy) {
    const e = Math.max(0, Math.floor(currentEnergy));
    const newCounts = this._computeCounts(e);
    const norm = a => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    // Advance per-tier tumble phases: even tiers Y-axis, odd tiers X-axis
    for (let t = 0; t < TIERS.length; t++) {
      this._tumblePhases[t] += this._tumbleSpeeds[t] * dt;
    }

    for (let t = 0; t < TIERS.length; t++) {
      // Advance both orbital phase and precession phase
      this._tierPhase[t] += TIERS[t].speed * this._speedMultiplier * dt;
      this._precessionPhase[t] += TIERS[t].precession * dt;

      // Apply phase animation (lerp toward target over 0.2s)
      if (this._phaseAnimations[t]) {
        const anim = this._phaseAnimations[t];
        anim.remainingTime -= dt;
        if (anim.remainingTime <= 0) {
          this._tierPhase[t] = anim.targetPhase;
          this._phaseAnimations[t] = null;
        } else {
          const progress = 1 - (anim.remainingTime / 0.2);
          const current = this._tierPhase[t];
          let diff = anim.targetPhase - current;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest arc
          this._tierPhase[t] = current + diff * progress;
        }
      }

      const prev = this._counts[t];
      const next = newCounts[t];
      if (prev !== next) {
        this._redistributeAngles(t, next, prev);
        this._counts[t] = next;
        if (prev > 0 && next === 0 && t + 1 < TIERS.length) {
          this._flashTimers[t + 1] = Math.min(1, (this._flashTimers[t + 1] || 0) + 0.5);
        }
      }

      const count = this._counts[t];
      if (count === 0) continue;

      // Apply full rotation to every mote
      for (let i = 0; i < count; i++) {
        this._angles[t][i] += TIERS[t].speed * this._speedMultiplier * dt;
      }

      if (count < 2) continue; // single mote needs no spacing correction

      // Ideal evenly-spaced slots co-rotating with _tierPhase
      const step = (Math.PI * 2) / count;
      const ideals = Array.from({ length: count }, (_, i) => this._tierPhase[t] + i * step);

      // Match each mote (sorted by normalised angle) to its corresponding sorted ideal slot.
      // Sorted pairing prevents motes crossing each other to reach targets.
      const sortedMoteIdx = [...Array(count).keys()].sort((a, b) => norm(this._angles[t][a]) - norm(this._angles[t][b]));
      const sortedIdeals  = [...ideals].sort((a, b) => norm(a) - norm(b));

      // Spring correction: each mote gets a nudge toward its assigned ideal slot.
      // Rate 2.5 rad/s/rad means a 1-radian gap closes in ~0.5 s without stopping rotation.
      const springK = 2.5;
      for (let i = 0; i < count; i++) {
        const mi = sortedMoteIdx[i];
        let diff = sortedIdeals[i] - this._angles[t][mi];
        diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest arc
        this._angles[t][mi] += diff * springK * dt;
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

  /** Set orbital spin speed multiplier (for Epoch Collapse spin-up). */
  setSpeedMultiplier(m) { this._speedMultiplier = m; }

  /** Set orbital radius scale factor: 1 = normal, 0 = collapsed to center. */
  setRadiusScale(s) { this._radiusScale = Math.max(0, Math.min(1, s)); }

  /** Set quark-blended color for all motes (null = white default). */
  setQuarkColor(hexColor) { this._quarkColor = hexColor || null; }

  /**
   * Render far-side elements (behind player): orbital path ellipses + motes with oz < 0.
   * Must be called BEFORE the player is drawn.
   */
  renderBack(ctx, sx, sy) {
    ctx.save();
    if (this._mode === 'subatomic') {
      this._renderSubatomicPaths(ctx, sx, sy);
      this._renderSubatomicMotes(ctx, sx, sy, false);
    } else {
      // Faint orbital path ellipses for each active tier
      for (let t = 0; t < TIERS.length; t++) {
        if (this._counts[t] === 0) continue;
        const tier = TIERS[t];
        ctx.globalAlpha = 0.07;
        ctx.strokeStyle = this._quarkColor || tier.color;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        const r = tier.radius * this._radiusScale;
        const dynamicNode = tier.node + this._precessionPhase[t];
        ctx.ellipse(sx, sy, r, r * Math.abs(tier._cosIncl), dynamicNode, 0, Math.PI * 2);
        ctx.stroke();
      }
      this._renderMotes(ctx, sx, sy, false);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Render near-side motes (in front of player): motes with oz >= 0.
   * Must be called AFTER the player is drawn.
   */
  renderFront(ctx, sx, sy) {
    ctx.save();
    if (this._mode === 'subatomic') {
      this._renderSubatomicMotes(ctx, sx, sy, true);
    } else {
      this._renderMotes(ctx, sx, sy, true);
    }
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
      const moteColor = this._quarkColor || tier.color;

      for (let i = 0; i < count; i++) {
        const angle = this._angles[t][i];
        const cosTheta = Math.cos(angle);
        const sinTheta = Math.sin(angle);

        // Dynamic node includes precession
        const dynamicNode = tier.node + this._precessionPhase[t];
        const cosNode = Math.cos(dynamicNode);
        const sinNode = Math.sin(dynamicNode);
        const cosIncl = tier._cosIncl;
        const sinIncl = tier._sinIncl;

        // Orthographic 3D projection of a tilted circular orbit
        const scaledR = tier.radius * this._radiusScale;
        let ox = scaledR * (cosTheta * cosNode - sinTheta * cosIncl * sinNode);
        let oy = scaledR * (cosTheta * sinNode + sinTheta * cosIncl * cosNode);
        let oz = scaledR * sinTheta * sinIncl;

        // Apply per-tier tumble rotation: even tiers Y-axis, odd tiers X-axis
        const tumblePhase = this._tumblePhases[t];
        const cosTumble = Math.cos(tumblePhase);
        const sinTumble = Math.sin(tumblePhase);

        if (t % 2 === 0) {
          // Even tiers (0, 2, 4, 6): Y-axis rotation
          // Rotate around Y-axis: X' = X·cos(t) + Z·sin(t), Z' = -X·sin(t) + Z·cos(t)
          const oxOld = ox;
          const ozOld = oz;
          ox = oxOld * cosTumble + ozOld * sinTumble;
          oz = -oxOld * sinTumble + ozOld * cosTumble;
        } else {
          // Odd tiers (1, 3, 5): X-axis rotation, alternating direction
          // Tier 1, 5: positive (counter-clockwise), Tier 3: negative (clockwise)
          const direction = t === 3 ? -1 : 1;
          // Rotate around X-axis: Y' = Y·cos(t) - Z·sin(t), Z' = Y·sin(t) + Z·cos(t)
          const oyOld = oy;
          const ozOld = oz;
          oy = oyOld * cosTumble - direction * ozOld * sinTumble;
          oz = direction * oyOld * sinTumble + ozOld * cosTumble;
        }

        // Skip motes not on the requested depth side
        if (frontSide ? oz < 0 : oz >= 0) continue;

        // Depth cue: near motes slightly larger/brighter; clamped to avoid extremes
        const depthBase = scaledR > 0 ? scaledR * 3 : tier.radius * 3;
        const depth = Math.max(0.75, Math.min(1.25, 1 + oz / depthBase));
        const mx = sx + ox;
        const my = sy + oy;
        const r = tier.moteSize * sizeBoost * depth;

        // Soft glow halo
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, r * 3.5);
        grad.addColorStop(0, moteColor);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = (0.22 + flash * 0.1) * depth;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(mx, my, r * 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.globalAlpha = (0.8 + flash * 0.2) * Math.max(0.3, depth);
        ctx.fillStyle = moteColor;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _computeCounts(energy) {
    // Once any higher tier is active the lower tier retains a full ring of 10 motes
    // (e.g. at 11 energy: tier 0 shows 10 motes, tier 1 shows 1 mote).
    return TIERS.map((_, t) => {
      const higherTiers = Math.floor(energy / Math.pow(10, t + 1));
      if (higherTiers > 0) return 10;
      return Math.floor(energy / Math.pow(10, t)) % 10;
    });
  }

  _redistributeAngles(tierIndex, count, prevCount) {
    const existing = this._angles[tierIndex];

    if (count === 0) {
      this._angles[tierIndex] = [];
      return;
    }

    const step = (Math.PI * 2) / count;

    if (existing.length === 0) {
      // Brand-new ring: evenly spaced from current tier phase.
      const phase = this._tierPhase[tierIndex];
      this._angles[tierIndex] = Array.from({ length: count }, (_, i) => phase + i * step);
      return;
    }

    // Only animate if we're **adding** motes; if removing, just slice without animation.
    const isAdding = count > prevCount;

    if (isAdding) {
      // Snap all motes to new ideal co-rotating positions, then animate over 0.2s.
      const survivors = [...existing];
      const norm = a => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const sorted = [...survivors].sort((a, b) => norm(a) - norm(b));

      // Circular mean of (m[i] − i·step): the phase that minimises total squared
      // displacement of existing motes to their new ideal slots.
      let sumCos = 0, sumSin = 0;
      for (let i = 0; i < sorted.length; i++) {
        const d = sorted[i] - i * step;
        sumCos += Math.cos(d);
        sumSin += Math.sin(d);
      }
      const rawPhase = Math.atan2(sumSin, sumCos);

      // Adjust rawPhase to stay numerically close to the current tierPhase (no 2π jump).
      const prevPhase = this._tierPhase[tierIndex];
      const delta = Math.atan2(Math.sin(rawPhase - prevPhase), Math.cos(rawPhase - prevPhase));
      const bestPhase = prevPhase + delta;

      // Snap motes to new positions and start animation toward bestPhase over 0.2s.
      this._angles[tierIndex] = Array.from({ length: count }, (_, i) => this._tierPhase[tierIndex] + i * step);
      this._phaseAnimations[tierIndex] = { targetPhase: bestPhase, remainingTime: 0.2 };
    } else {
      // Removing: just slice, no animation.
      this._angles[tierIndex] = existing.slice(0, count);
    }
  }

  // ── Subatomic mode rendering ──────────────────────────────────────────

  static SUBATOMIC_RINGS = [
    // Inner ring: protons (red) — close to nucleus
    { id: 'proton',   radius: 55,  moteSize: 5.0, color: '#ff4444', speed: 0.8,  incl: Math.PI / 5,  node: 0 },
    // Middle ring: neutrons (grey-blue)
    { id: 'neutron',  radius: 80,  moteSize: 4.5, color: '#6688aa', speed: 0.6,  incl: Math.PI / 4,  node: Math.PI * 0.7 },
    // Outer ring: electrons (cyan, fast)
    { id: 'electron', radius: 130, moteSize: 2.5, color: '#44ffff', speed: 2.5,  incl: Math.PI / 3,  node: Math.PI * 1.3 },
  ];

  _renderSubatomicPaths(ctx, sx, sy) {
    const rings = OrbitalEnergyDisplay.SUBATOMIC_RINGS;
    for (const ring of rings) {
      const count = this._subatomicCounts[ring.id] ?? 0;
      if (count === 0) continue;
      const cosIncl = Math.cos(ring.incl);
      ctx.globalAlpha = 0.06;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      const r = ring.radius * this._radiusScale;
      ctx.ellipse(sx, sy, r, r * Math.abs(cosIncl), ring.node, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _renderSubatomicMotes(ctx, sx, sy, frontSide) {
    const rings = OrbitalEnergyDisplay.SUBATOMIC_RINGS;
    const elapsed = performance.now() / 1000;

    for (const ring of rings) {
      const count = Math.floor(this._subatomicCounts[ring.id] ?? 0);
      if (count === 0) continue;

      const cosNode = Math.cos(ring.node);
      const sinNode = Math.sin(ring.node);
      const cosIncl = Math.cos(ring.incl);
      const sinIncl = Math.sin(ring.incl);
      const scaledR = ring.radius * this._radiusScale;
      const speed = ring.speed * this._speedMultiplier;

      for (let i = 0; i < count; i++) {
        const angle = (elapsed * speed + (i / count) * Math.PI * 2);
        const cosTheta = Math.cos(angle);
        const sinTheta = Math.sin(angle);

        const ox = scaledR * (cosTheta * cosNode - sinTheta * cosIncl * sinNode);
        const oy = scaledR * (cosTheta * sinNode + sinTheta * cosIncl * cosNode);
        const oz = scaledR * sinTheta * sinIncl;

        if (frontSide ? oz < 0 : oz >= 0) continue;

        const depthBase = scaledR > 0 ? scaledR * 3 : ring.radius * 3;
        const depth = Math.max(0.75, Math.min(1.25, 1 + oz / depthBase));
        const mx = sx + ox;
        const my = sy + oy;
        const r = ring.moteSize * depth;

        // Glow halo
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, r * 3);
        grad.addColorStop(0, ring.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.2 * depth;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(mx, my, r * 3, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.globalAlpha = 0.85 * Math.max(0.3, depth);
        ctx.fillStyle = ring.color;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
