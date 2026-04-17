/**
 * ParticleSystem — Per-region particle arrays with max 500 per region.
 * Handles spawning, movement, wrapping, brightness flickering, and drawing.
 * Supports "attracted" particles that home toward a target (e.g. the home object).
 */

const MAX_PER_REGION = 500;

/** Maps particle type names to quality tier index (used for energy payouts on absorption). */
const TYPE_QUALITY = { mote: 0, mote_base: 0, mote_common: 1, mote_rare: 2, mote_epic: 3, mote_legendary: 4 };

export class ParticleSystem {
  constructor(spriteManager) {
    this.spriteManager = spriteManager;
    /** @type {Map<string, {particles: object[], config: object, params: object, targetDensity: number, attraction: object|null}>} */
    this.regions = new Map();
    this._glowCtx = null;
    /** @type {((worldX: number, worldY: number) => void)|null} */
    this._onAbsorb = null;
    // Mass-based gravity multiplier (set externally each frame)
    this._massGravityMult = 1;
    // Spawn flash tracking: [{x, y, age, maxAge}]
    this._spawnFlashes = [];
    this._qualityLevel = 0;
    // Background scroll velocity (world px/s) — applied to all non-homing particles
    this._worldScrollVx = 0;
    this._worldScrollVy = 0;
    // Vacuum mode: all particles pulled toward a single target
    this._vacuumTarget = null; // { x, y, strength }
    // Last known viewport dimensions (updated each draw call) — used by recycle logic
    this._viewW = 0;
    this._viewH = 0;
    // Cached screen diagonal (2× for recycle threshold) — recomputed each draw call
    this._recycleMinDistSq = 0;
  }

  /** Initialize particle arrays for each region. */
  loadRegions(regions) {
    this.regions.clear();
    for (const region of regions) {
      this.regions.set(region.regionId, {
        particles: [],
        config: region,
        params: { density: 0, motionSpeed: 1, brightness: 1 },
        targetDensity: 0,
        // Apply stored attraction defaults so gravity persists across region reloads
        attraction: this._defaultAttraction ? { ...this._defaultAttraction } : null,
      });
    }
  }

  /** Spawn a single particle, biased toward gravity center when attraction is active. */
  spawnParticle(regionId, type) {
    const entry = this.regions.get(regionId);
    if (!entry || entry.particles.length >= MAX_PER_REGION) return;

    const bounds = entry.config.worldBounds;
    const actualType = (type === 'mote' && this._qualityLevel > 0)
      ? this._selectQualityType()
      : type;
    const sprite = this.spriteManager.getSprite(actualType);
    if (!sprite) return;

    const size = sprite.minSize + Math.random() * (sprite.maxSize - sprite.minSize);

    let x, y;
    const attraction = entry.attraction;
    const gr = attraction?.gravityRadius ?? 0;
    // Cap effective spawn radius to the region's half-diagonal so motes are never
    // generated outside the region regardless of how large the gravity radius grows.
    const regionHalfDiag = Math.sqrt(bounds.w * bounds.w + bounds.h * bounds.h) * 0.5;
    if (attraction && Math.random() < 0.60) {
      const rawRadius = gr <= 880 ? gr * 1.3 : gr * 2;
      const spawnRadius = Math.min(rawRadius, regionHalfDiag);
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * spawnRadius; // sqrt for uniform area distribution
      x = attraction.targetX + Math.cos(angle) * dist;
      y = attraction.targetY + Math.sin(angle) * dist;
      // Clamp within region bounds with a small margin to avoid edge clustering
      const margin = 50;
      x = Math.max(bounds.x + margin, Math.min(bounds.x + bounds.w - margin, x));
      y = Math.max(bounds.y + margin, Math.min(bounds.y + bounds.h - margin, y));
    } else {
      x = bounds.x + Math.random() * bounds.w;
      y = bounds.y + Math.random() * bounds.h;
    }

    entry.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 2 * 1.5 + 0.5 * Math.sign(Math.random() - 0.5),
      vy: (Math.random() - 0.5) * 2 * 1.5 + 0.5 * Math.sign(Math.random() - 0.5),
      size,
      brightness: 0.4 + Math.random() * 0.5,
      type: actualType,
      quality: TYPE_QUALITY[actualType] ?? 0,
      sprite,
      attracted: false,
    });

    // Tiny spawn flash
    this._spawnFlashes.push({ x, y, age: 0, maxAge: 0.3 });
  }

  /**
   * Spawn a replacement particle — biased toward gravity zone, with edge fallback.
   */
  _spawnEdgeParticle(entry) {
    if (entry.particles.length >= MAX_PER_REGION) return;
    if (entry.targetDensity === 0) return; // pre-genesis: don't replace absorbed particles

    const bounds = entry.config.worldBounds;
    const types = entry.config.particleTypes;
    const rawType = types[Math.floor(Math.random() * types.length)];
    const actualType = (rawType === 'mote' && this._qualityLevel > 0)
      ? this._selectQualityType()
      : rawType;
    const sprite = this.spriteManager.getSprite(actualType);
    if (!sprite) return;

    const size = sprite.minSize + Math.random() * (sprite.maxSize - sprite.minSize);

    let x, y;
    const attraction = entry.attraction;
    const gr = attraction?.gravityRadius ?? 0;
    // Cap to region half-diagonal so replacement motes never spawn outside the region
    // regardless of how large the gravity radius grows.
    const regionHalfDiag = Math.sqrt(bounds.w * bounds.w + bounds.h * bounds.h) * 0.5;
    if (attraction && Math.random() < 0.58) {
      const rawInner = gr <= 880 ? gr * 0.4 : gr * 0.8;
      const rawOuter = gr <= 880 ? gr * 1.5 : gr * 2.5;
      const innerR = Math.min(rawInner, regionHalfDiag * 0.6); // inner ring stays well within region
      const outerR = Math.min(rawOuter, regionHalfDiag);       // outer ring capped at region edge
      const angle = Math.random() * Math.PI * 2;
      const dist = innerR + Math.random() * (outerR - innerR);
      x = attraction.targetX + Math.cos(angle) * dist;
      y = attraction.targetY + Math.sin(angle) * dist;
      const margin = 50;
      x = Math.max(bounds.x + margin, Math.min(bounds.x + bounds.w - margin, x));
      y = Math.max(bounds.y + margin, Math.min(bounds.y + bounds.h - margin, y));
    } else {
      // Spawn in outer ring (15% margin from each edge), distributed proportionally by perimeter
      const marginX = bounds.w * 0.15;
      const marginY = bounds.h * 0.15;
      const perimeter = 2 * (bounds.w + bounds.h);
      const r = Math.random() * perimeter;
      if (r < bounds.w) {
        x = bounds.x + Math.random() * bounds.w;
        y = bounds.y + Math.random() * marginY;
      } else if (r < 2 * bounds.w) {
        x = bounds.x + Math.random() * bounds.w;
        y = bounds.y + bounds.h - Math.random() * marginY;
      } else if (r < 2 * bounds.w + bounds.h) {
        x = bounds.x + Math.random() * marginX;
        y = bounds.y + Math.random() * bounds.h;
      } else {
        x = bounds.x + bounds.w - Math.random() * marginX;
        y = bounds.y + Math.random() * bounds.h;
      }
    }

    entry.particles.push({ x, y, vx: 0, vy: 0, size, brightness: 0.4 + Math.random() * 0.4, type: actualType, quality: TYPE_QUALITY[actualType] ?? 0, sprite, attracted: false });

    // Tiny spawn flash
    this._spawnFlashes.push({ x, y, age: 0, maxAge: 0.25 });
  }

  /** Update all particles: position, wrapping, flicker, attraction homing, absorption. */
  update(dt) {
    // Age and prune spawn flashes
    for (let i = this._spawnFlashes.length - 1; i >= 0; i--) {
      this._spawnFlashes[i].age += dt;
      if (this._spawnFlashes[i].age >= this._spawnFlashes[i].maxAge) {
        this._spawnFlashes.splice(i, 1);
      }
    }

    for (const [, entry] of this.regions) {
      const bounds = entry.config.worldBounds;
      const speed = entry.params.motionSpeed;
      const attraction = entry.attraction;
      const aParms = entry.attractionParams || { conversionRate: 1, speedMultiplier: 1 };

      // --- Move particles ---
      const gravRadius = attraction ? (attraction.gravityRadius || 600) : 0;
      const massMult = this._massGravityMult;

      for (const p of entry.particles) {
        // Decay dark-matter wave push immunity
        if (p._pushTimer > 0) {
          p._pushTimer = Math.max(0, p._pushTimer - dt);
        }

        // --- Vacuum mode overrides all normal movement ---
        if (this._vacuumTarget) {
          const vt = this._vacuumTarget;
          const dx = vt.x - p.x;
          const dy = vt.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 5) {
            // Mark for removal
            p._vacuumAbsorbed = true;
          } else {
            // Accelerate quadratically as strength increases
            const pullSpeed = 60 + 400 * vt.strength * vt.strength;
            p.x += (dx / dist) * pullSpeed * dt;
            p.y += (dy / dist) * pullSpeed * dt;
            p.brightness = Math.min(1, 0.5 + 0.5 * vt.strength);
          }
        } else if (p.homing) {
          // Beacon mote: drift toward homeX/homeY, immune to world scroll and gravity
          const dx = p.homeX - p.x;
          const dy = p.homeY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 1) {
            p.x += (dx / dist) * p.homeSpeed * dt;
            p.y += (dy / dist) * p.homeSpeed * dt;
          }
          p.brightness = 0.75 + Math.sin(Date.now() * 0.003) * 0.2;
        } else if (p.attracted && attraction && !p._pushTimer) {
          // Cubic distance-based speed with mass scaling: strong core, steep dropoff
          const dx = attraction.targetX - p.x;
          const dy = attraction.targetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0) {
            const t = Math.max(0, 1 - dist / gravRadius); // 0 at edge, 1 at center
            const minSpd = 2;
            const maxSpd = 180;
            // Quartic falloff: t⁴ creates strong inner zone with steep outer dropoff,
            // so far-away particles drift very slowly while close-in ones move fast
            const moveSpeed = (minSpd + (maxSpd - minSpd) * t * t * t * t) * aParms.speedMultiplier * massMult;
            p.x += (dx / dist) * moveSpeed * dt;
            p.y += (dy / dist) * moveSpeed * dt;
            // Brighten and grow as approaching
            p.brightness = Math.min(1, 0.35 + t * 0.65);
            p.size = p.sprite.minSize + (p.sprite.maxSize - p.sprite.minSize) * Math.min(1, t);
          }
        } else {
          // Normal ambient drift (also used during DM wave push)
          p.x += p.vx * speed * dt;
          p.y += p.vy * speed * dt;

          // Background world scroll (implies player movement through space)
          p.x -= this._worldScrollVx * dt;
          p.y -= this._worldScrollVy * dt;

          // Wrap within region bounds
          if (p.x < bounds.x)             p.x += bounds.w;
          else if (p.x > bounds.x + bounds.w) p.x -= bounds.w;
          if (p.y < bounds.y)             p.y += bounds.h;
          else if (p.y > bounds.y + bounds.h) p.y -= bounds.h;

          // Brightness flicker
          if (p.sprite.flickerRate > 0) {
            p.brightness += (Math.random() - 0.5) * p.sprite.flickerRate * dt * 4;
            p.brightness = Math.max(0.15, Math.min(0.9, p.brightness));
          }
        }
      }

      // --- Absorption: remove attracted particles that have reached the target ---
      // Skip normal absorption during vacuum mode to avoid spawning replacements
      if (attraction && !this._vacuumTarget) {
        const absorbed = [];
        const aParms = entry.attractionParams || { conversionRate: 1, speedMultiplier: 1 };
        for (let i = 0; i < entry.particles.length; i++) {
          const p = entry.particles[i];
          if (p.attracted) {
            const dx = attraction.targetX - p.x;
            const dy = attraction.targetY - p.y;
            if (dx * dx + dy * dy < 36) absorbed.push(i); // within 6px
          }
        }
        for (let i = absorbed.length - 1; i >= 0; i--) {
          const particle = entry.particles[absorbed[i]];
          const quality = particle.quality || 0;
          entry.particles.splice(absorbed[i], 1);
          this._spawnEdgeParticle(entry); // replace to maintain density
          if (this._onAbsorb) {
            this._onAbsorb(attraction.targetX, attraction.targetY, quality);
          }
        }

        // --- Proximity-based attraction: ALL particles within gravityRadius drift inward ---
        const gravRadiusSq = gravRadius * gravRadius;

        for (const p of entry.particles) {
          if (p.attracted) continue;
          if (p.homing) continue; // beacon: never pulled by gravity
          if (p._pushTimer > 0) continue; // DM wave push: skip re-attraction

          const dx = attraction.targetX - p.x;
          const dy = attraction.targetY - p.y;
          if (dx * dx + dy * dy < gravRadiusSq) {
            p.attracted = true;
          }
        }
      }

      // --- Vacuum mode: remove particles that reached the target ---
      if (this._vacuumTarget) {
        for (let i = entry.particles.length - 1; i >= 0; i--) {
          if (entry.particles[i]._vacuumAbsorbed) {
            entry.particles.splice(i, 1);
          }
        }
      }

      // Spawn toward target density — scale up spawn rate if far from target
      // (skip spawning during vacuum — we want particles to vanish)
      if (!this._vacuumTarget && entry.targetDensity > entry.particles.length) {
        const deficit = entry.targetDensity - entry.particles.length;
        // Spawn more per frame when deficit is large (catch up to target faster)
        const toSpawn = Math.min(entry.targetDensity, Math.max(2, Math.ceil(deficit / 10)));
        const types = entry.config.particleTypes;
        for (let i = 0; i < toSpawn; i++) {
          this.spawnParticle(entry.config.regionId, types[Math.floor(Math.random() * types.length)]);
        }

        // Recycle furthest motes when density gets too high, bringing them closer to player
        if (attraction && entry.particles.length > entry.targetDensity * 1.2) {
          this._recycleFurthestMotes(entry, attraction.targetX, attraction.targetY);
        }
      }
    }
  }

  /**
   * Remove motes that are more than twice the screen diagonal away from the character.
   * This prevents hitting mote limits on an infinite canvas while keeping nearby motes intact.
   */
  _recycleFurthestMotes(entry, charX, charY) {
    const particles = entry.particles;
    if (particles.length < 2) return;

    // Use cached threshold (set each draw call); fall back to 1.5× 1200 px if not yet computed
    // Reduced from 4× diagonal (2× screen diagonal) to 2.25× diagonal (1.5× screen diagonal)
    const minDistSq = this._recycleMinDistSq > 0 ? this._recycleMinDistSq * 0.5625 : 2.25 * 1200 * 1200;

    // Remove particles that are beyond the threshold (iterate backwards to preserve indices)
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const dx = p.x - charX;
      const dy = p.y - charY;
      if (dx * dx + dy * dy > minDistSq) {
        particles.splice(i, 1);
      }
    }
  }

  /** Draw visible particles on the main context. Glow particles on glow context. */
  draw(ctx, camera, viewW, viewH) {
    // Keep viewport dimensions current so the recycle logic has an up-to-date threshold
    this._viewW = viewW;
    this._viewH = viewH;
    // Cache 2× screen-diagonal squared for _recycleFurthestMotes
    const diagSq = viewW * viewW + viewH * viewH;
    this._recycleMinDistSq = diagSq > 0 ? 4 * diagSq : 4 * 1200 * 1200;
    for (const [, entry] of this.regions) {
      const bri = entry.params.brightness;
      for (const p of entry.particles) {
        if (!camera.isVisible(p.x, p.y, p.size, p.size)) continue;

        const { sx, sy } = camera.worldToScreen(p.x, p.y);
        const r = Math.max(0.5, p.size / 2);
        const cx = sx + r;
        const cy = sy + r;
        const alpha = p.brightness * bri;
        ctx.globalAlpha = Math.max(0.05, Math.min(1, alpha));
        ctx.fillStyle = p.attracted ? '#b8d4ff' : p.sprite.baseColor;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Glow on separate context (attracted particles always glow when close to target)
        const shouldGlow = p.sprite.glowRadius > 0 || p.attracted;
        if (shouldGlow && this._glowCtx) {
          this._glowCtx.globalAlpha = Math.max(0.05, Math.min(0.7, alpha * 0.5));
          this._glowCtx.fillStyle = p.attracted ? '#c0dcff' : p.sprite.baseColor;
          const gr = p.attracted ? r : p.sprite.glowRadius;
          this._glowCtx.beginPath();
          this._glowCtx.arc(cx, cy, r + gr, 0, Math.PI * 2);
          this._glowCtx.fill();
        }
      }
    }

    // Draw spawn flashes
    for (const flash of this._spawnFlashes) {
      if (!camera.isVisible(flash.x, flash.y, 6, 6)) continue;
      const { sx, sy } = camera.worldToScreen(flash.x, flash.y);
      const t = 1 - flash.age / flash.maxAge; // 1→0 over lifetime
      ctx.globalAlpha = t * 0.6;
      ctx.fillStyle = '#ffffff';
      const fr = 1 + t * 2;
      ctx.beginPath();
      ctx.arc(sx, sy, fr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    if (this._glowCtx) this._glowCtx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------
  // Quality level API
  // ---------------------------------------------------------------

  /** Set the quality level for mote spawning (0 = base only, up to 5 = all tiers). */
  setQualityLevel(level) {
    this._qualityLevel = Math.max(0, Math.min(8, level));
  }

  /**
   * Pick a quality-tiered sprite type based on current quality level.
   * Higher quality levels unlock rarer tiers with increasing probability.
   */
  _selectQualityType() {
    const distributions = [
      [1.00, 0.00, 0.00, 0.00, 0.00],  // Lv0: all base
      [0.70, 0.30, 0.00, 0.00, 0.00],  // Lv1
      [0.50, 0.30, 0.20, 0.00, 0.00],  // Lv2
      [0.30, 0.25, 0.25, 0.20, 0.00],  // Lv3
      [0.20, 0.20, 0.20, 0.20, 0.20],  // Lv4
      [0.10, 0.15, 0.25, 0.25, 0.25],  // Lv5
      [0.05, 0.10, 0.25, 0.30, 0.30],  // Lv6
      [0.03, 0.07, 0.20, 0.30, 0.40],  // Lv7
      [0.02, 0.05, 0.13, 0.30, 0.50],  // Lv8: half legendary
    ];
    const dist = distributions[Math.min(this._qualityLevel, 8)];
    const r = Math.random();
    let cumulative = 0;
    const types = ['mote_base', 'mote_common', 'mote_rare', 'mote_epic', 'mote_legendary'];
    for (let i = 0; i < dist.length; i++) {
      cumulative += dist[i];
      if (r < cumulative) return types[i];
    }
    return 'mote_base';
  }

  // ---------------------------------------------------------------
  // Attraction API
  // ---------------------------------------------------------------

  /**
   * Enable gravitational attraction for a region — particles within gravityRadius
   * of the target will be pulled toward it and absorbed.
   * @param {string} regionId
   * @param {number} targetX  World X of attraction centre
   * @param {number} targetY  World Y of attraction centre
   * @param {number} [gravityRadius=100]  Radius within which particles become attracted
   */
  enableAttraction(regionId, targetX, targetY, gravityRadius = 100) {
    const entry = this.regions.get(regionId);
    if (entry) entry.attraction = { targetX, targetY, gravityRadius };
  }

  /**
   * Enable attraction in ALL active regions at once (used when mote moves between regions).
   */
  enableAttractionAll(targetX, targetY, gravityRadius = 600) {
    let enabledCount = 0;
    for (const [regionId, entry] of this.regions) {
      entry.attraction = { targetX, targetY, gravityRadius };
      enabledCount++;
      if (window.AEONS_DEBUG && enabledCount <= 3) {
        console.log(`[ParticleSystem] Gravity enabled in ${regionId}: ${entry.particles.length} particles, target density ${entry.targetDensity}`);
      }
    }
    // Store attraction defaults so newly added regions also get attraction
    this._defaultAttraction = { targetX, targetY, gravityRadius };
    console.log(`[ParticleSystem] Gravity enabled in ${enabledCount} regions at (${targetX}, ${targetY}), radius ${gravityRadius}`);
  }

  /**
   * Update the attraction target position in ALL regions.
   * Used to track mote movement each frame.
   */
  updateAttractionTargetAll(x, y, gravityRadius) {
    for (const [, entry] of this.regions) {
      if (entry.attraction) {
        entry.attraction.targetX = x;
        entry.attraction.targetY = y;
        if (gravityRadius !== undefined) entry.attraction.gravityRadius = gravityRadius;
      }
    }
    // Keep default in sync so newly loaded regions get latest position
    if (this._defaultAttraction) {
      this._defaultAttraction.targetX = x;
      this._defaultAttraction.targetY = y;
      if (gravityRadius !== undefined) this._defaultAttraction.gravityRadius = gravityRadius;
    }
  }

  /**
   * Update the attraction target position without re-enabling.
   * Used to track mote movement each frame.
   */
  updateAttractionTarget(regionId, x, y) {
    const entry = this.regions.get(regionId);
    if (entry?.attraction) {
      entry.attraction.targetX = x;
      entry.attraction.targetY = y;
    }
  }

  /**
   * Set attraction tuning parameters for tractor beam effects.
   * @param {string} regionId
   * @param {{ conversionRate?: number, speedMultiplier?: number }} params
   */
  setAttractionParams(regionId, params) {
    const entry = this.regions.get(regionId);
    if (entry) {
      if (!entry.attractionParams) entry.attractionParams = { conversionRate: 1, speedMultiplier: 1 };
      Object.assign(entry.attractionParams, params);
    }
  }

  /** Disable attraction for a region. */
  disableAttraction(regionId) {
    const entry = this.regions.get(regionId);
    if (entry) {
      entry.attraction = null;
      for (const p of entry.particles) p.attracted = false;
    }
  }

  /**
   * Set the mass-based gravity multiplier (called each frame from renderer).
   * Scales pull speed: 1.0 = base, higher = stronger pull.
   */
  setMassGravityMultiplier(mult) {
    this._massGravityMult = mult;
  }

  /**
   * Register a callback invoked each time an attracted particle is absorbed.
   * @param {(worldX: number, worldY: number) => void} fn
   */
  setAbsorptionCallback(fn) {
    this._onAbsorb = fn;
  }

  /** Set the world-scroll velocity (world px/s) applied each frame to all non-homing particles. */
  setWorldScroll(vx, vy) {
    this._worldScrollVx = vx;
    this._worldScrollVy = vy;
  }

  /**
   * Epoch Collapse vacuum mode — all particles in all regions are pulled
   * toward a single point with increasing strength.
   * @param {number|null} x — world X (null to disable)
   * @param {number|null} y — world Y
   * @param {number} strength — 0 (off) to 1 (full pull)
   */
  setVacuumMode(x, y, strength) {
    if (x == null || strength <= 0) {
      this._vacuumTarget = null;
    } else {
      this._vacuumTarget = { x, y, strength };
    }
  }

  /**
   * Reset all gravity/vacuum/attraction state for a prestige run.
   * Call before loadEpochConfig so new regions start with no attraction.
   */
  clearDefaultAttraction() {
    this._defaultAttraction = null;
    this._vacuumTarget = null;
    for (const [, entry] of this.regions) {
      entry.attraction = null;
      entry.attractionParams = null;
      for (const p of entry.particles) p.attracted = false;
    }
  }

  /** Update the homing target for all beacon particles (used when player position changes). */
  setHomingTarget(x, y) {
    for (const [, entry] of this.regions) {
      for (const p of entry.particles) {
        if (p.homing) { p.homeX = x; p.homeY = y; }
      }
    }
  }

  /**
   * Spawn a beacon mote that drifts toward the player — bypasses targetDensity checks.
   * @param {string} regionId
   * @param {number} worldX   Initial world X
   * @param {number} worldY   Initial world Y
   * @param {number} homeX    Target world X (player position)
   * @param {number} homeY    Target world Y (player position)
   * @param {number} homeSpeed  Drift speed in world px/s
   */
  spawnBeaconMote(regionId, worldX, worldY, homeX, homeY, homeSpeed = 30) {
    const entry = this.regions.get(regionId);
    if (!entry) return;
    const sprite = this.spriteManager.getSprite('mote') || this.spriteManager.getSprite('mote_base');
    if (!sprite) return;
    entry.particles.push({
      x: worldX, y: worldY,
      vx: 0, vy: 0,
      size: sprite.maxSize,
      brightness: 0.8,
      type: 'mote',
      quality: TYPE_QUALITY['mote'] ?? 0,
      sprite,
      attracted: false,
      homing: true,
      homeX, homeY, homeSpeed,
    });
  }

  /** Remove all homing particles from a region (cleans up beacon on upgrade purchase or reload). */
  clearHomingParticles(regionId) {
    const entry = this.regions.get(regionId);
    if (!entry) return;
    entry.particles = entry.particles.filter(p => !p.homing);
  }

  /**
   * Contact absorption: remove particles within `radius` of `(targetX, targetY)`.
   * Used before gravity is purchased — drifting into motes gives energy.
   * @param {number} targetX  World X of the player mote
   * @param {number} targetY  World Y of the player mote
   * @param {number} radius   Contact radius in world pixels
   */
  checkContactAbsorption(targetX, targetY, radius) {
    const radiusSq = radius * radius;
    for (const [, entry] of this.regions) {
      const absorbed = [];
      for (let i = 0; i < entry.particles.length; i++) {
        const p = entry.particles[i];
        const dx = targetX - p.x;
        const dy = targetY - p.y;
        if (dx * dx + dy * dy <= radiusSq) absorbed.push(i);
      }
      for (let i = absorbed.length - 1; i >= 0; i--) {
        const particle = entry.particles[absorbed[i]];
        entry.particles.splice(absorbed[i], 1);
        this._spawnEdgeParticle(entry);
        if (this._onAbsorb) {
          this._onAbsorb(particle.x, particle.y, particle.quality ?? 0);
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------

  /** Adjust particle behavior for a region. */
  setRegionParams(regionId, params) {
    const entry = this.regions.get(regionId);
    if (entry) Object.assign(entry.params, params);
  }

  /** Total particle count across all regions. */
  getCount() {
    let total = 0;
    for (const [, entry] of this.regions) total += entry.particles.length;
    return total;
  }

  /** Spawn a batch of initial particles for a newly activated region. */
  spawnInitialParticles(regionId, count) {
    const entry = this.regions.get(regionId);
    if (!entry) return;
    entry.targetDensity = Math.min(count, MAX_PER_REGION);
    entry.params.density = entry.targetDensity;
    entry.params.brightness = 1;
  }

  /**
   * Immediately place `count` particles inside 0.7× the current gravity radius,
   * pre-marked attracted:true so they home in on the very next tick.
   * Falls back to random region bounds when no attraction target is set.
   * @param {string} regionId
   * @param {number} count
   */
  spawnWithinAttractionRange(regionId, count) {
    const entry = this.regions.get(regionId);
    if (!entry) return;
    const attraction = entry.attraction;
    const types = entry.config.particleTypes;
    const spriteTypes = ['mote_base', 'mote_common', 'mote_rare', 'mote_epic', 'mote_legendary'];
    for (let i = 0; i < count; i++) {
      if (entry.particles.length >= MAX_PER_REGION) break;
      let x, y;
      if (attraction) {
        const r = (attraction.gravityRadius * 0.7) * Math.sqrt(Math.random());
        const angle = Math.random() * Math.PI * 2;
        x = attraction.targetX + Math.cos(angle) * r;
        y = attraction.targetY + Math.sin(angle) * r;
      } else {
        const bounds = entry.config.worldBounds;
        x = bounds.x + Math.random() * bounds.w;
        y = bounds.y + Math.random() * bounds.h;
      }
      const type = types ? types[Math.floor(Math.random() * types.length)] : 'mote_base';
      const spriteType = spriteTypes.includes(type) ? type : 'mote_base';
      const sprite = this.spriteManager.getSprite(spriteType);
      if (!sprite) continue;
      const size = sprite.minSize + Math.random() * (sprite.maxSize - sprite.minSize);
      entry.particles.push({
        x, y, vx: 0, vy: 0,
        size,
        brightness: 0.5 + Math.random() * 0.4,
        type: spriteType,
        sprite,
        attracted: true,
        quality: TYPE_QUALITY[spriteType] ?? 0,
      });
    }
  }

  /**
   * Debug spawn: ignores mote limit, spawns count motes regardless of MAX_PER_REGION.
   */
  debugSpawnWithinAttractionRange(regionId, count) {
    const entry = this.regions.get(regionId);
    if (!entry) return;
    const attraction = entry.attraction;
    const types = entry.config.particleTypes;
    const spriteTypes = ['mote_base', 'mote_common', 'mote_rare', 'mote_epic', 'mote_legendary'];
    for (let i = 0; i < count; i++) {
      let x, y;
      if (attraction) {
        const r = (attraction.gravityRadius * 0.7) * Math.sqrt(Math.random());
        const angle = Math.random() * Math.PI * 2;
        x = attraction.targetX + Math.cos(angle) * r;
        y = attraction.targetY + Math.sin(angle) * r;
      } else {
        const bounds = entry.config.worldBounds;
        x = bounds.x + Math.random() * bounds.w;
        y = bounds.y + Math.random() * bounds.h;
      }
      const type = types ? types[Math.floor(Math.random() * types.length)] : 'mote_base';
      const spriteType = spriteTypes.includes(type) ? type : 'mote_base';
      const sprite = this.spriteManager.getSprite(spriteType);
      if (!sprite) continue;
      const size = sprite.minSize + Math.random() * (sprite.maxSize - sprite.minSize);
      entry.particles.push({
        x, y, vx: 0, vy: 0,
        size,
        brightness: 0.5 + Math.random() * 0.4,
        type: spriteType,
        sprite,
        attracted: true,
        quality: TYPE_QUALITY[spriteType] ?? 0,
      });
    }
  }

  /** Store the glow canvas 2D context for glow particle rendering. */
  setGlowCtx(ctx) {
    this._glowCtx = ctx;
  }

  /**
   * Apply an outward radial force burst (e.g., from a dark matter gravity wave).
   * Particles within the radius are pushed outward and briefly cannot re-enter attraction.
   * @param {number} centerX  World X of the wave source
   * @param {number} centerY  World Y of the wave source
   * @param {number} radius   Affected radius in world pixels
   * @param {number} strength Outward impulse strength (pixels/s)
   */
  applyRadialForce(centerX, centerY, radius, strength) {
    const radiusSq = radius * radius;
    for (const [, entry] of this.regions) {
      for (const p of entry.particles) {
        const dx = p.x - centerX;
        const dy = p.y - centerY;
        const distSq = dx * dx + dy * dy;
        if (distSq > 0 && distSq < radiusSq) {
          const dist = Math.sqrt(distSq);
          const falloff = 1 - dist / radius; // strongest at centre, 0 at edge
          const impulse = strength * falloff * 0.012;
          p.vx = (dx / dist) * impulse;
          p.vy = (dy / dist) * impulse;
          p.attracted = false;
          p._pushTimer = 2.2; // seconds of push immunity before gravity reclaims particle
        }
      }
    }
  }

  /**
   * Spawn a quality-tier particle in a region (for procedural generation).
   * Quality: 0=base, 1=common, 2=rare, 3=epic, 4=legendary
   * Returns the value multiplier for this quality tier.
   */
  spawnQualityParticle(regionId, quality, x, y, vx, vy) {
    const entry = this.regions.get(regionId);
    if (!entry || entry.particles.length >= MAX_PER_REGION) return 1.0;

    // Map quality to sprite type
    const spriteTypes = ['mote_base', 'mote_common', 'mote_rare', 'mote_epic', 'mote_legendary'];
    const spriteType = spriteTypes[Math.min(quality, 4)] || 'mote_base';
    const sprite = this.spriteManager.getSprite(spriteType);
    if (!sprite) return 1.0;

    const size = sprite.minSize + Math.random() * (sprite.maxSize - sprite.minSize);

    entry.particles.push({
      x,
      y,
      vx: vx || 0,
      vy: vy || 0,
      size,
      brightness: 0.5 + Math.random() * 0.4,
      type: spriteType,
      sprite,
      attracted: false,
      quality, // Track quality tier for absorption value calculation
    });

    // Return value multiplier for this quality
    const multipliers = [1.0, 1.5, 2.5, 5, 10];
    return multipliers[Math.min(quality, 4)];
  }

  /**
   * Get the value multiplier for a particle's quality tier.
   */
  static getQualityMultiplier(quality) {
    const multipliers = [1.0, 1.5, 2.5, 5, 10];
    return multipliers[Math.min(quality, 4)] || 1.0;
  }
}

