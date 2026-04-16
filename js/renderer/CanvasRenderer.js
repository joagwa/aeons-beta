/**
 * CanvasRenderer — Master renderer orchestrating all sub-renderers.
 * Owns the main and glow canvas contexts and drives per-frame updates.
 */

import { SpriteManager } from './SpriteManager.js?v=0e91f62';
import { Camera } from './Camera.js?v=0e91f62';
import { ParticleSystem } from './ParticleSystem.js?v=0e91f62';
import { RegionManager } from './RegionManager.js?v=0e91f62';
import { FloatingNumbers } from './FloatingNumbers.js?v=0e91f62';
import { OrbitalEnergyDisplay } from './OrbitalEnergyDisplay.js?v=0e91f62';
import { EpochCollapseAnimation } from './EpochCollapseAnimation.js?v=0e91f62';

// Star visual definitions by stage
const STAR_VISUALS = {
  main_sequence: { color: '#ffffff', size: 4, glow: false },
  red_giant:     { color: '#ff6030', size: 6, glow: true },
  supernova:     { color: '#ffffff', size: 8, glow: true },
  neutron_star:  { color: '#8090c0', size: 2, glow: false },
};

export class CanvasRenderer {
  constructor(EventBus) {
    this.bus = EventBus;

    this.mainCanvas = null;
    this.glowCanvas = null;
    this.mainCtx = null;
    this.glowCtx = null;
    this.dpr = 1;

    this.camera = null;
    this.spriteManager = null;
    this.particleSystem = null;
    this.regionManager = null;
    this.floatingNumbers = null;

    this.glowEnabled = true;
    this.canvasConfig = null;
    this.lastFrameTime = 0;

    // Stars registered via events
    this._stars = new Map();

    // Directional indicators for off-screen region activations
    this._indicators = [];

    // Home object absorption pulse (0 = idle, >0 = pulsing)
    this._homeObjectPulse = 0;

    // Mote controller reference (set via setMoteController)
    this._moteController = null;
    this._gravityBaseRadius = 0; // set when upg_gravitationalPull purchased
    this._pendingGravityLevel = 0; // deferred if canvasConfig not ready on purchase
    this._effectiveGravityRadius = 0; // computed each frame from base radius + bonuses

    // Mass-based gravity scaling state
    this._currentMass = 0;

    // Conversion rate slider (0..1, default 1 = 100%)
    this._conversionRate = 1;

    // Visual threshold state (home object evolves with mass)
    this._thresholdLevel = 0;
    this._visualSize = 4;
    this._visualTargetSize = 4;
    this._visualGlow = 3;
    this._visualTargetGlow = 3;
    this._visualColor = '#c8e0ff';
    this._visualFlash = 0; // 0..1, fades out
    this._visualThresholds = null; // loaded from epoch config

    this._resizeObserver = null;
    this._darkMatterActive = false;

    /** @type {import('../engine/DarkMatterSystem.js?v=0e91f62').DarkMatterSystem|null} */
    this._darkMatterSystem = null;

    // Particle storm (temporary boost from milestone reward)
    this._particleStormActive = false;
    this._particleStormTimer = 0;   // seconds remaining
    this._stormGravityMult = 1;

    // Mobile drawer camera offset (smooth lerp when drawer opens/closes)
    this._cameraOffsetY = 0;
    this._targetCameraOffsetY = 0;

    // Space dust parallax layers: [far, near]
    this._dustLayers = null;
    this._dustTime   = 0;  // accumulated time for twinkle animation

    // Background world-scroll for early-game movement illusion
    // Velocity in world px/s — decelerates to 0 after EM Bond is purchased
    this._bgScrollVx = 50;
    this._bgScrollVy = 12;
    this._bgScrollTargetVx = 50;
    this._bgScrollTargetVy = 12;
    this._dustScrollX = 0;
    this._dustScrollY = 0;

    // Current energy value (cached from resource:updated, used by orbital display)
    this._currentEnergy = 0;

    // Energy Resonance upgrade multiplier (applied to attraction radius and mote density)
    this._resonanceMult = 1;

    // Separate targets so competing systems don't overwrite each other
    this._massTargetSize  = 4; // driven by mass thresholds
    // _visualTargetSize = max(massTargetSize, orbitalDisplay.getMinPlayerSize()) — computed each frame

    // Orbital energy display (orbiting motes representing current energy)
    this._orbitalDisplay = new OrbitalEnergyDisplay();

    // Epoch Collapse animation controller
    this._collapseAnim = new EpochCollapseAnimation();
    this._collapseTriggered = false; // prevent re-trigger
    this._narrativePanel = null;     // set via setNarrativePanel()

    // Mote detection arrow (appears after 10s without absorption)
    this._lastAbsorptionTime = Date.now(); // Track when last mote was absorbed
    this._moteArrowAlpha = 0; // Fade in over time
  }

  // ---------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------

  /**
   * Set up canvases, sub-systems, and event subscriptions.
   * @param {HTMLCanvasElement} mainCanvas
   * @param {HTMLCanvasElement} glowCanvas
   */
  init(mainCanvas, glowCanvas) {
    this.mainCanvas = mainCanvas;
    this.glowCanvas = glowCanvas;
    this.mainCtx = mainCanvas.getContext('2d');
    this.glowCtx = glowCanvas.getContext('2d');

    this.dpr = window.devicePixelRatio || 1;
    this._resizeCanvases();

    // Sub-systems
    this.spriteManager = new SpriteManager();
    this.camera = new Camera(this.bus);
    this.particleSystem = new ParticleSystem(this.spriteManager);
    this.regionManager = new RegionManager(this.bus, this.particleSystem);
    this.floatingNumbers = new FloatingNumbers();

    this.camera.attach(mainCanvas);
    this.particleSystem.setGlowCtx(this.glowCtx);

    // Set absorption callback once at init — fires for both contact and gravity absorption.
    this.particleSystem.setAbsorptionCallback((wx, wy, quality) => {
      this._homeObjectPulse = 1;
      const { sx, sy } = this.camera.worldToScreen(wx, wy);
      this.bus.emit('particle:absorbed', { worldX: wx, worldY: wy, screenX: sx, screenY: sy, quality });
    });

    // Resize on viewport change
    this._resizeObserver = new ResizeObserver(() => this._resizeCanvases());
    this._resizeObserver.observe(mainCanvas);

    // --- EventBus subscriptions ---
    this.bus.on('resource:updated', (data) => this._onResourceUpdated(data));
    this.bus.on('star:created', (data) => this._onStarCreated(data));
    this.bus.on('star:stage:changed', (data) => this._onStarStageChanged(data));
    this.bus.on('region:activated', (data) => this._onRegionActivated(data));
    this.bus.on('upgrade:purchased', (data) => this._onUpgradePurchased(data));
    this.bus.on('visual:threshold:changed', (data) => {
      this._visualFlash = 1.0;
      if (this.canvasConfig?.homeObject) {
        this.canvasConfig.homeObject.baseColor = data.color;
      }
      this._massTargetSize = data.size;
      this._visualTargetGlow = data.glowRadius;
      this._visualColor = data.color;
      if (data.particleBoost && this.particleSystem) {
        this.particleSystem.spawnInitialParticles('void', data.particleBoost);
      }
    });
    this.bus.on('settings:changed', (data) => {
      if (data.key === 'glowEnabled') this.setGlowEnabled(data.value);
    });
    this.bus.on('ui:mobile:drawer:state',(data) => {
      this._targetCameraOffsetY = data.open ? data.offsetY : 0;
    });
    // Reset mote detection arrow timer on absorption
    this.bus.on('particle:absorbed', () => {
      this._lastAbsorptionTime = Date.now();
      this._moteArrowAlpha = 0;
    });
    this.bus.on('milestone:triggered', (data) => {
      if (data.milestoneId === 'ms_gasCloud') {
        this._darkMatterActive = true;
        // Inject dark matter motes into the void region particle types
        const voidRegion = this.canvasConfig?.regions?.find(r => r.regionId === 'void');
        if (voidRegion && !voidRegion.particleTypes.includes('darkMote')) {
          voidRegion.particleTypes.push('darkMote');
        }
        // Seed some dark motes immediately
        this.particleSystem?.spawnInitialParticles('void', 80);
      }
    });
  }

  // ---------------------------------------------------------------
  // Canvas sizing
  // ---------------------------------------------------------------

  _resizeCanvases() {
    const w = this.mainCanvas.clientWidth;
    const h = this.mainCanvas.clientHeight;
    if (w === 0 || h === 0) return;

    for (const canvas of [this.mainCanvas, this.glowCanvas]) {
      canvas.width = w * this.dpr;
      canvas.height = h * this.dpr;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }

    if (this.camera) {
      this.camera.setViewSize(w, h);
      // Re-center camera on home object after resize
      const ho = this.canvasConfig?.homeObject;
      if (ho) {
        this.camera.x = ho.worldX - w / 2;
        this.camera.y = ho.worldY - h / 2;
      }
    }
  }

  // ---------------------------------------------------------------
  // Epoch Config & Drift Control
  // ---------------------------------------------------------------

  /** Stop background drift (called when Cosmic Drift is already purchased on load). */
  stopBackgroundDrift() {
    this._bgScrollVx = 0;
    this._bgScrollVy = 0;
    this._bgScrollTargetVx = 0;
    this._bgScrollTargetVy = 0;
  }

  /** Load a full epoch canvas config (regions, sprites, home object, etc). */
  loadEpochConfig(config) {
    this.canvasConfig = config;

    this.camera.setUniverseSize(config.universeWidth, config.universeHeight);
    this.spriteManager.loadEpochSprites(config);
    this.particleSystem.loadRegions(config.regions);
    this.regionManager.loadRegions(config.regions);

    // Center camera on home object
    if (config.homeObject) {
      this.camera.x = config.homeObject.worldX - this.camera.viewW / 2;
      this.camera.y = config.homeObject.worldY - this.camera.viewH / 2;
      this.camera.clamp();
    }

    // Spawn particles in initially active regions
    for (const region of config.regions) {
      if (region.initiallyActive) {
        this.particleSystem.spawnInitialParticles(region.regionId, region.initialParticleCount ?? 250);
      }
    }

    this._stars.clear();
    this._indicators = [];

    // Load visual thresholds from canvas config module (imported by caller)
    this._visualThresholds = config.visualThresholds || null;
    // Set initial visual state from threshold level 0
    if (this._visualThresholds && this._visualThresholds.length > 0) {
      const t = this._visualThresholds[0];
      this._visualSize = t.size;
      this._massTargetSize = t.size;
      this._visualTargetSize = t.size;
      this._visualGlow = t.glowRadius;
      this._visualTargetGlow = t.glowRadius;
      this._visualColor = t.color;
      if (config.homeObject) {
        config.homeObject.baseColor = t.color;
        config.homeObject.baseSize = t.size;
        config.homeObject.glowRadius = t.glowRadius;
      }
    }
    this._thresholdLevel = 0;

    // Spawn beacon mote — a single homing mote that drifts toward the player.
    // It is cleaned up when EM Bond is purchased (clearHomingParticles).
    if (config.homeObject) {
      const ho = config.homeObject;
      this.particleSystem.spawnBeaconMote('void', ho.worldX + 400, ho.worldY, ho.worldX, ho.worldY, 30);

      // Add small initial attraction (100px radius) so player doesn't need perfect alignment
      // This is replaced/expanded when upg_gravitationalPull is purchased
      this.particleSystem.updateAttractionTargetAll(ho.worldX, ho.worldY, 100);
    }

    // Apply any gravity upgrade that fired before canvasConfig was ready
    if (this._pendingGravityLevel > 0) {
      this._onUpgradePurchased({ upgradeId: 'upg_gravitationalPull', level: this._pendingGravityLevel });
      this._pendingGravityLevel = 0;
    }
  }

  // ---------------------------------------------------------------
  // Frame rendering (called by GameLoop)
  // ---------------------------------------------------------------

  /** Main render loop entry point. */
  onFrame(ts) {
    const dt = this.lastFrameTime ? (ts - this.lastFrameTime) / 1000 : 0.016;
    this.lastFrameTime = ts;
    const clampedDt = Math.min(dt, 0.1);

    const viewW = this.mainCanvas.clientWidth;
    const viewH = this.mainCanvas.clientHeight;

    // Clear
    this.mainCtx.clearRect(0, 0, viewW, viewH);
    if (this.glowEnabled) this.glowCtx.clearRect(0, 0, viewW, viewH);

    if (!this.canvasConfig) return;

    // Always center camera on home object
    const ho = this.canvasConfig.homeObject;

    // Smooth mobile drawer camera offset
    if (this._cameraOffsetY !== this._targetCameraOffsetY) {
      this._cameraOffsetY += (this._targetCameraOffsetY - this._cameraOffsetY) * Math.min(1, 8 * clampedDt);
      if (Math.abs(this._cameraOffsetY - this._targetCameraOffsetY) < 0.5) {
        this._cameraOffsetY = this._targetCameraOffsetY;
      }
    }

    if (ho && this.camera) {
      this.camera.x = ho.worldX - viewW / 2;
      this.camera.y = ho.worldY - viewH / 2 + this._cameraOffsetY;
    }

    // Sync home object position from mote controller
    if (this._moteController && this.canvasConfig.homeObject) {
      this.canvasConfig.homeObject.worldX = this._moteController.worldX;
      this.canvasConfig.homeObject.worldY = this._moteController.worldY;
      // Update particle attraction target in ALL regions to follow the mote
      if (this._gravityBaseRadius > 0) {
        const baseRadius = this._gravityBaseRadius || 100;
        const tractorRange = this._moteController.tractorBeamRange || 0;
        // Energy-based radius bonus: +60px per log10(energy) so early accumulation widens pull
        const energyBonus = Math.log10(Math.max(1, this._currentEnergy)) * 60;
        // Mass-based radius expansion: +50% radius per 100 mass, logarithmic scaling
        const massBonus = this._currentMass > 0 ? Math.log10(1 + this._currentMass) * 0.4 : 0;
        const effectiveRadius = (baseRadius + tractorRange + energyBonus) * (1 + massBonus) * this._stormGravityMult * this._resonanceMult;
        this._effectiveGravityRadius = effectiveRadius;
        this.particleSystem.updateAttractionTargetAll(
          this._moteController.worldX,
          this._moteController.worldY,
          effectiveRadius
        );
        // Mass-based speed multiplier: 1.0 base, +10% per log10(mass)
        const massSpeedMult = 1 + (this._currentMass > 0 ? Math.log10(1 + this._currentMass) * 0.1 : 0);
        this.particleSystem.setMassGravityMultiplier(massSpeedMult);
        // Apply tractor beam speed/conversion params to all regions
        if (tractorRange > 0) {
          for (const region of this.canvasConfig.regions) {
            this.particleSystem.setAttractionParams(region.regionId, {
              conversionRate: this._moteController.tractorBeamStrength,
              speedMultiplier: this._moteController.tractorBeamStrength,
            });
          }
        }
      }
    }

    // Update beacon homing target to player's current position
    if (this.canvasConfig.homeObject) {
      this.particleSystem.setHomingTarget(
        this.canvasConfig.homeObject.worldX,
        this.canvasConfig.homeObject.worldY
      );
    }

    // Decelerate background scroll toward target (lerp at 0.5/s — ~2s to stop)
    const scrollLerp = Math.min(1, 0.5 * clampedDt);
    this._bgScrollVx += (this._bgScrollTargetVx - this._bgScrollVx) * scrollLerp;
    this._bgScrollVy += (this._bgScrollTargetVy - this._bgScrollVy) * scrollLerp;
    // Snap to zero to avoid infinite crawl
    if (Math.abs(this._bgScrollVx) < 0.3) this._bgScrollVx = 0;
    if (Math.abs(this._bgScrollVy) < 0.1) this._bgScrollVy = 0;

    // Accumulate dust drift offset for space dust parallax scroll
    this._dustScrollX += this._bgScrollVx * clampedDt;
    this._dustScrollY += this._bgScrollVy * clampedDt;

    // Push scroll velocity into particle system
    this.particleSystem.setWorldScroll(this._bgScrollVx, this._bgScrollVy);

    // Contact absorption: active before gravity is purchased; drifting into motes gives energy
    if (this.particleSystem && this.canvasConfig?.homeObject && this._gravityBaseRadius === 0) {
      const ho = this.canvasConfig.homeObject;
      this.particleSystem.checkContactAbsorption(ho.worldX, ho.worldY, 6);
    }

    // Update orbital energy display angles
    this._orbitalDisplay.update(clampedDt, this._currentEnergy);
    // Keep visual target as max of mass-driven size and energy-tier minimum
    this._visualTargetSize = Math.max(this._massTargetSize, this._orbitalDisplay.getMinPlayerSize());

    // --- Epoch Collapse animation ---
    if (this._collapseAnim.isRunning()) {
      this._collapseAnim.update(clampedDt);

      // Speed up orbital rotation
      this._orbitalDisplay.setSpeedMultiplier(this._collapseAnim.getSpeedMultiplier());

      // Collapse orbital radii (getRadiusCollapse returns 1→0, use directly as scale)
      const radiusCollapse = this._collapseAnim.getRadiusCollapse();
      this._orbitalDisplay.setRadiusScale(radiusCollapse);

      // Vacuum particles toward player
      const vacStr = this._collapseAnim.getVacuumStrength();
      if (vacStr > 0 && ho) {
        this.particleSystem.setVacuumMode(ho.worldX, ho.worldY, vacStr);
      }

      // Narrative panel fade
      const narAlpha = this._collapseAnim.getNarrativeAlpha();
      if (this._narrativePanel) {
        this._narrativePanel.setAlpha(narAlpha);
        if (narAlpha >= 1 && !this._narrativePanel.isVisible()) {
          // Already shown via setAlpha — ensure continue button is available
        }
      }

      // If animation finished, emit event
      if (this._collapseAnim.isDone()) {
        this.particleSystem.setVacuumMode(null, null, 0);
        this._orbitalDisplay.setSpeedMultiplier(1);
        this._orbitalDisplay.setRadiusScale(1);
        // NarrativePanel continue button will emit collapse:complete
      }
    }

    // Update
    this.regionManager.update(clampedDt);
    this.particleSystem.update(clampedDt);
    this.floatingNumbers.update(clampedDt);

    // Decay absorption pulse
    if (this._homeObjectPulse > 0) {
      this._homeObjectPulse = Math.max(0, this._homeObjectPulse - clampedDt * 4);
    }

    // Decay particle storm timer
    if (this._particleStormActive) {
      this._particleStormTimer -= clampedDt;
      if (this._particleStormTimer <= 0) {
        this._particleStormActive = false;
        this._stormGravityMult = 1;
      }
    }

    // Lerp visual size and glow toward targets
    const lerpSpeed = 2.0;
    this._visualSize += (this._visualTargetSize - this._visualSize) * Math.min(1, lerpSpeed * clampedDt);
    this._visualGlow += (this._visualTargetGlow - this._visualGlow) * Math.min(1, lerpSpeed * clampedDt);
    // Decay threshold flash
    if (this._visualFlash > 0) {
      this._visualFlash = Math.max(0, this._visualFlash - clampedDt * 1.5);
    }

    // Draw region backgrounds
    this.regionManager.draw(this.mainCtx, this.camera, viewW, viewH);

    // Lazy-init space dust on first frame (always visible, not gated on movement)
    if (!this._dustLayers) {
      this._initSpaceDust();
    }
    this._dustTime += clampedDt;

    // Space dust parallax layers (drawn behind everything)
    this._drawSpaceDust(this.mainCtx, viewW, viewH, clampedDt);

    // Subtle dark matter tint over the void when dark matter is active
    if (this._darkMatterActive && this.canvasConfig) {
      const voidRegion = this.canvasConfig.regions?.find(r => r.regionId === 'void');
      if (voidRegion) {
        const b = voidRegion.worldBounds;
        const { sx, sy } = this.camera.worldToScreen(b.x, b.y);
        this.mainCtx.globalAlpha = 0.18;
        this.mainCtx.fillStyle = '#110024';
        this.mainCtx.fillRect(Math.round(sx), Math.round(sy), b.w, b.h);
        this.mainCtx.globalAlpha = 1;
      }
    }

    // Draw dark matter nodes (barely visible in void; wave rings rendered here too)
    if (this._darkMatterActive) {
      this._drawDarkMatterNodes(this.mainCtx);
    }

    // Draw particles
    this.particleSystem.draw(this.mainCtx, this.camera, viewW, viewH);

    // Draw home object
    this._drawHomeObject(this.mainCtx);

    // Draw stars
    this._drawStars(this.mainCtx);

    // Draw floating numbers (screen-space)
    this.floatingNumbers.draw(this.mainCtx);

    // Draw directional indicators
    this._drawIndicators(this.mainCtx, viewW, viewH);

    // Draw mote detection arrow (if 10+ seconds without absorption)
    this._drawMoteDetectionArrow(this.mainCtx, viewW, viewH, clampedDt);

    // Draw controls hint overlay (bottom-left of canvas)
    this._drawControlsHint(this.mainCtx, viewW, viewH);

    // --- Epoch Collapse flash overlay (on top of everything except UI) ---
    if (this._collapseAnim.isRunning()) {
      const flashAlpha = this._collapseAnim.getFlashAlpha();
      if (flashAlpha > 0.01) {
        this.mainCtx.save();
        this.mainCtx.globalAlpha = flashAlpha;
        this.mainCtx.fillStyle = '#ffffff';
        this.mainCtx.fillRect(0, 0, viewW, viewH);
        this.mainCtx.restore();
      }
    }

    // Draw virtual joystick overlay (screen-space, on top of everything)
    this._drawJoystick(this.mainCtx);
  }

  // ---------------------------------------------------------------
  // Home object
  // ---------------------------------------------------------------

  _drawHomeObject(ctx) {
    const ho = this.canvasConfig?.homeObject;
    if (!ho) {
      if (window.AEONS_DEBUG) console.warn('[CanvasRenderer] Home object not found in config');
      return;
    }

    const visible = this.camera.isVisible(ho.worldX - ho.hitRadius, ho.worldY - ho.hitRadius, ho.hitRadius * 2, ho.hitRadius * 2);
    if (!visible) {
      if (window.AEONS_DEBUG && Math.random() < 0.01) {
        console.warn(`[CanvasRenderer] Home object outside viewport. HO: (${ho.worldX}, ${ho.worldY}), Camera: (${this.camera.x}, ${this.camera.y}), View: ${this.camera.viewW}x${this.camera.viewH}`);
      }
      return;
    }

    const { sx, sy } = this.camera.worldToScreen(ho.worldX, ho.worldY);
    const pulse = this._homeObjectPulse;
    const s = this._visualSize + pulse * 3;
    const color = this._visualColor || ho.baseColor;

    // Draw threshold flash overlay (before home object, full viewport)
    if (this._visualFlash > 0.01) {
      const viewW = this.mainCanvas.clientWidth;
      const viewH = this.mainCanvas.clientHeight;
      ctx.save();
      ctx.globalAlpha = this._visualFlash * 0.35;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    // Far-side orbital motes and path ellipses — drawn behind player
    this._orbitalDisplay.renderBack(ctx, sx, sy);

    // Bright core circle
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, s, 0, Math.PI * 2);
    ctx.fill();

    // Pulse ring
    if (pulse > 0.05) {
      const ringR = (s + 6) + pulse * 12;
      ctx.globalAlpha = pulse * 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Storm visual: pulsing cyan ring when particle storm is active
    if (this._particleStormActive) {
      const stormPulse = (Math.sin(performance.now() * 0.006) + 1) * 0.5;
      const stormR = s + 10 + stormPulse * 8;
      ctx.globalAlpha = 0.35 + stormPulse * 0.35;
      ctx.strokeStyle = '#00e8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, stormR, 0, Math.PI * 2);
      ctx.stroke();
      const stormR2 = s + 22 + stormPulse * 12;
      ctx.globalAlpha = 0.15 + stormPulse * 0.15;
      ctx.strokeStyle = '#80ffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, stormR2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Glow on glow canvas
    if (this.glowEnabled) {
      const gr = this._visualGlow + pulse * 6;
      this.glowCtx.globalAlpha = 0.4 + pulse * 0.4;
      this.glowCtx.fillStyle = color;
      this.glowCtx.beginPath();
      this.glowCtx.arc(sx, sy, s + gr, 0, Math.PI * 2);
      this.glowCtx.fill();
      this.glowCtx.globalAlpha = 1;
    }

    // Tractor beam visual (pulsing dashed circle)
    if (this._moteController?.tractorBeamRange > 0) {
      const range = this._moteController.tractorBeamRange;
      const now = performance.now();
      const breathe = Math.sin(now * 0.003) * 0.04 + 0.16;
      const radiusOsc = range + Math.sin(now * 0.002) * 4;

      ctx.save();
      ctx.globalAlpha = breathe;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(sx, sy, radiusOsc, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Attraction boundary rings — hard zone (fast, inner) and soft zone (slow, outer)
    if (this._effectiveGravityRadius > 0) {
      const er = this._effectiveGravityRadius;
      const now = performance.now();
      ctx.save();

      // Soft boundary (outer dashed ring) — edge of attraction field
      const softBreath = 0.06 + Math.sin(now * 0.0015) * 0.02;
      ctx.globalAlpha = softBreath;
      ctx.strokeStyle = '#3366cc';
      ctx.lineWidth = 1;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(sx, sy, er, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Hard boundary (inner solid ring) — fast-pull zone, ~28% of outer radius
      const hardR = er * 0.28;
      const hardBreath = 0.12 + Math.sin(now * 0.002) * 0.04;
      ctx.globalAlpha = hardBreath;
      ctx.strokeStyle = '#44ccdd';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, hardR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }

    ctx.globalAlpha = 1;

    // Near-side orbital motes — drawn in front of player
    this._orbitalDisplay.renderFront(ctx, sx, sy);
  }

  /** Returns screen position of the home object. */
  getHomeObjectScreenPos() {
    const ho = this.canvasConfig?.homeObject;
    if (!ho) return { x: 0, y: 0 };
    const { sx, sy } = this.camera.worldToScreen(ho.worldX, ho.worldY);
    return { x: sx, y: sy };
  }

  // ---------------------------------------------------------------
  // Stars
  // ---------------------------------------------------------------

  _onStarCreated(data) {
    this._stars.set(data.starId, {
      starId: data.starId,
      slot: data.slot || 0,
      stage: 'main_sequence',
      stageProgress: 0,
    });
  }

  _onStarStageChanged(data) {
    const star = this._stars.get(data.starId);
    if (star) {
      star.stage = data.newStage;
      star.stageProgress = data.stageProgress || 0;
    }
  }

  /**
   * Draw dark matter nodes (barely-visible void anomalies) and their wave rings.
   * @param {CanvasRenderingContext2D} ctx
   */
  _drawDarkMatterNodes(ctx) {
    if (!this._darkMatterSystem) return;
    const nodes = this._darkMatterSystem.getNodes();
    if (nodes.length === 0) return;

    ctx.save();
    for (const node of nodes) {
      const { sx, sy } = this.camera.worldToScreen(node.x, node.y);

      const op = node.displayOpacity || 0.10;
      const r = node.nodeRadius || 6;

      // Soft violet glow halo — primary visibility cue
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 5);
      glow.addColorStop(0,   `rgba(120, 0, 200, ${(op * 2.5).toFixed(3)})`);
      glow.addColorStop(0.4, `rgba(60,  0, 110, ${(op * 1.2).toFixed(3)})`);
      glow.addColorStop(1,   'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 5, 0, Math.PI * 2);
      ctx.fill();

      // Dark void core
      ctx.globalAlpha = Math.min(op * 3, 0.55);
      ctx.fillStyle = '#050010';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();

      // Faint violet ring outlining the node
      ctx.globalAlpha = op * 1.8;
      ctx.strokeStyle = '#7a00cc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawStars(ctx) {
    if (this._stars.size === 0 || !this.canvasConfig) return;

    // Place stars in the Stellar Forge region
    const forgeRegion = this.canvasConfig.regions.find(
      (r) => r.regionId === 'stellarForge'
    );
    if (!forgeRegion) return;

    const bounds = forgeRegion.worldBounds;
    let idx = 0;

    for (const [, star] of this._stars) {
      const vis = STAR_VISUALS[star.stage] || STAR_VISUALS.main_sequence;
      // Distribute stars in a grid within the forge region
      const col = idx % 5;
      const row = Math.floor(idx / 5);
      const starX = bounds.x + 80 + col * 120;
      const starY = bounds.y + 200 + row * 200;
      idx++;

      if (!this.camera.isVisible(starX - vis.size, starY - vis.size, vis.size * 2, vis.size * 2)) continue;

      const { sx, sy } = this.camera.worldToScreen(starX, starY);

      // Star body
      ctx.fillStyle = vis.color;
      ctx.globalAlpha = 1;
      ctx.fillRect(
        Math.round(sx - vis.size / 2),
        Math.round(sy - vis.size / 2),
        vis.size,
        vis.size
      );

      // Progress arc
      const progress = star.stageProgress || 0;
      if (progress > 0 && progress < 1) {
        ctx.beginPath();
        ctx.arc(sx, sy, vis.size + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.strokeStyle = vis.color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Glow on glow canvas
      if (vis.glow && this.glowEnabled) {
        this.glowCtx.globalAlpha = 0.5;
        this.glowCtx.fillStyle = vis.color;
        this.glowCtx.fillRect(
          Math.round(sx - vis.size),
          Math.round(sy - vis.size),
          vis.size * 2,
          vis.size * 2
        );
        this.glowCtx.globalAlpha = 1;
      }
    }

    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------
  // Directional indicators
  // ---------------------------------------------------------------

  _onRegionActivated(data) {
    if (!this.canvasConfig) return;
    const region = this.canvasConfig.regions.find(
      (r) => r.regionId === data.regionId
    );
    if (!region) return;

    // If gravitational pull is active, enable attraction in the new region too
    if (this._gravityBaseRadius > 0 && this.canvasConfig.homeObject) {
      const ho = this.canvasConfig.homeObject;
      const tractorRange = this._moteController?.tractorBeamRange || 0;
      this.particleSystem.enableAttraction(
        data.regionId, ho.worldX, ho.worldY,
        this._gravityBaseRadius + tractorRange
      );
    }

    const cx = region.worldBounds.x + region.worldBounds.w / 2;
    const cy = region.worldBounds.y + region.worldBounds.h / 2;

    if (!this.camera.isVisible(cx - 1, cy - 1, 2, 2)) {
      this._indicators.push({
        regionName: data.regionName || region.name,
        worldX: cx,
        worldY: cy,
        createdAt: performance.now(),
        duration: 3000,
      });
    }
  }

  _drawIndicators(ctx, viewW, viewH) {
    const now = performance.now();
    for (let i = this._indicators.length - 1; i >= 0; i--) {
      const ind = this._indicators[i];
      const elapsed = now - ind.createdAt;
      if (elapsed > ind.duration) {
        this._indicators.splice(i, 1);
        continue;
      }

      const alpha = 1 - elapsed / ind.duration;
      const { sx, sy } = this.camera.worldToScreen(ind.worldX, ind.worldY);

      // Clamp to screen edge
      const pad = 30;
      const edgeX = Math.max(pad, Math.min(viewW - pad, sx));
      const edgeY = Math.max(pad, Math.min(viewH - pad, sy));

      // Arrow direction
      const angle = Math.atan2(sy - edgeY, sx - edgeX);

      ctx.save();
      ctx.translate(edgeX, edgeY);
      ctx.rotate(angle);
      ctx.globalAlpha = alpha * 0.8;

      // Draw arrow
      ctx.fillStyle = '#a0c4ff';
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-4, -5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // Label
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = '#a0c4ff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ind.regionName, edgeX, edgeY - 12);
      ctx.textAlign = 'start';
    }
    ctx.globalAlpha = 1;
  }

  _drawMoteDetectionArrow(ctx, viewW, viewH, clampedDt) {
    // Update arrow fade based on time since last absorption
    const timeSinceAbsorption = (Date.now() - this._lastAbsorptionTime) / 1000; // seconds
    const fadeInDuration = 1.0; // 1 second fade-in after 10 second threshold
    const thresholdTime = 10.0; // Show after 10 seconds

    if (timeSinceAbsorption >= thresholdTime) {
      // Fade in over fadeInDuration
      const elapsed = timeSinceAbsorption - thresholdTime;
      this._moteArrowAlpha = Math.min(1, elapsed / fadeInDuration);
    } else {
      this._moteArrowAlpha = 0;
    }

    if (this._moteArrowAlpha < 0.01) return; // Not visible yet

    // Find nearest mote to player
    const ho = this.canvasConfig?.homeObject;
    if (!ho || !this.particleSystem) return;

    let nearestMote = null;
    let nearestDist = Infinity;

    // Search all regions for nearest mote
    for (const [regionId, entry] of this.particleSystem.regions) {
      for (const particle of entry.particles) {
        // Only track regular motes, not beacon or dark motes
        if (particle.type && (particle.type.startsWith('mote') || particle.type === 'mote')) {
          const dx = particle.x - ho.worldX;
          const dy = particle.y - ho.worldY;
          const distSq = dx * dx + dy * dy;
          if (distSq < nearestDist) {
            nearestDist = distSq;
            nearestMote = { x: particle.x, y: particle.y };
          }
        }
      }
    }

    if (!nearestMote) return; // No motes found

    // Draw arrow pointing to nearest mote from player's position
    const { sx: playerSx, sy: playerSy } = this.camera.worldToScreen(ho.worldX, ho.worldY);
    const { sx: moteSx, sy: moteSy } = this.camera.worldToScreen(nearestMote.x, nearestMote.y);

    // Arrow originates from player position
    const dx = moteSx - playerSx;
    const dy = moteSy - playerSy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return; // Mote is too close to player

    // Position arrow 50px from player toward mote
    const arrowDist = 50;
    const arrowX = playerSx + (dx / dist) * arrowDist;
    const arrowY = playerSy + (dy / dist) * arrowDist;
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(arrowX, arrowY);
    ctx.rotate(angle);
    ctx.globalAlpha = this._moteArrowAlpha;

    // Draw arrow triangle pointing toward mote
    ctx.fillStyle = '#a0c4ff';
    ctx.beginPath();
    ctx.moveTo(12, 0);        // Tip
    ctx.lineTo(-4, -6);       // Left base
    ctx.lineTo(-4, 6);        // Right base
    ctx.closePath();
    ctx.fill();

    // Glow outline
    ctx.strokeStyle = 'rgba(160, 196, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  _drawControlsHint(ctx, viewW, viewH) {
    if (!this._moteController) return;
    const hint = this._moteController.getHintState();
    if (!hint.visible || hint.alpha <= 0) return;

    const hintText = this._moteController.isTouchDevice
      ? 'Touch & drag to move'
      : 'WASD / \u2191\u2193\u2190\u2192 or drag to move';

    ctx.save();
    ctx.globalAlpha = hint.alpha;
    ctx.fillStyle = '#a0c4ff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(hintText, 14, viewH - 18);
    ctx.restore();
  }

  /**
   * Draw the virtual joystick overlay in screen space.
   * Renders an outer boundary ring and a draggable thumb at the current
   * pointer position (clamped to the boundary radius).
   */
  _drawJoystick(ctx) {
    const mc = this._moteController;
    if (!mc?.enabled) return;
    const js = mc.getJoystickState();
    if (!js.active) return;

    const { originX, originY, currentX, currentY, maxRadius } = js;

    // Clamp thumb to boundary ring
    const dx = currentX - originX;
    const dy = currentY - originY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const thumbDist = Math.min(dist, maxRadius);
    const thumbX = dist > 0 ? originX + (dx / dist) * thumbDist : originX;
    const thumbY = dist > 0 ? originY + (dy / dist) * thumbDist : originY;

    ctx.save();

    // Outer boundary ring fill
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#aaccff';
    ctx.beginPath();
    ctx.arc(originX, originY, maxRadius, 0, Math.PI * 2);
    ctx.fill();

    // Outer boundary ring stroke
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = '#aaccff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(originX, originY, maxRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Line from origin to thumb
    if (dist > 6) {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = '#aaccff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(thumbX, thumbY);
      ctx.stroke();
    }

    // Origin centre dot
    ctx.globalAlpha = 0.40;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(originX, originY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Thumb fill
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#aaddff';
    ctx.beginPath();
    ctx.arc(thumbX, thumbY, 18, 0, Math.PI * 2);
    ctx.fill();

    // Thumb stroke
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(thumbX, thumbY, 18, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  // ---------------------------------------------------------------
  // Resource-driven visual updates
  // ---------------------------------------------------------------

  _onResourceUpdated(data) {
    // Modulate particle behavior based on resource rates
    if (!this.canvasConfig) return;

    if (data.resourceId === 'energy') {
      this._currentEnergy = data.newValue ?? 0;
      if (data.ratePerSec != null) {
        const intensity = Math.min(2, 0.5 + data.ratePerSec * 0.05);
        this.particleSystem.setRegionParams('void', {
          motionSpeed: intensity,
          brightness: Math.min(1.5, 0.6 + data.ratePerSec * 0.02),
        });
      }
    }

    if (data.resourceId === 'mass' && this._visualThresholds) {
      const mass = data.newValue || 0;
      this._currentMass = mass; // Track mass for gravity scaling
      let newLevel = 0;
      for (let i = this._visualThresholds.length - 1; i >= 0; i--) {
        if (mass >= this._visualThresholds[i].minMass) {
          newLevel = i;
          break;
        }
      }
      if (newLevel !== this._thresholdLevel) {
        this._thresholdLevel = newLevel;
        const threshold = this._visualThresholds[newLevel];
        this.bus.emit('visual:threshold:changed', threshold);
      }

      // Continuously interpolate size within the current threshold band
      const curT = this._visualThresholds[newLevel];
      const nextT = this._visualThresholds[newLevel + 1];
      if (nextT) {
        const t = Math.min(1, Math.max(0, (mass - curT.minMass) / (nextT.minMass - curT.minMass)));
        this._massTargetSize = curT.size + (nextT.size - curT.size) * t;
      } else {
        this._massTargetSize = curT.size;
      }
    }
  }

  _onUpgradePurchased(data) {
    if (data.upgradeId === 'upg_cosmicDrift') {
      // Stop background scroll when player purchases Cosmic Drift
      // (player now has active control, no need for passive drift)
      this._bgScrollTargetVx = 0;
      this._bgScrollTargetVy = 0;
      
      // Start mote genesis near the player in random clusters
      const ho = this.canvasConfig?.homeObject;
      if (ho && this.particleSystem) {
        // Create clusters of 1-5 motes at various distances from player
        // ~10 clusters total = 30-50 motes depending on random cluster sizes
        const numClusters = 10;
        for (let i = 0; i < numClusters; i++) {
          // Random angle for cluster position
          const angle = Math.random() * Math.PI * 2;
          
          // Random cluster distance: close clusters (100-400px), medium (400-800px)
          let clusterDistance;
          if (i < 4) {
            // First 4 clusters close (visible on screen)
            clusterDistance = 100 + Math.random() * 300;
          } else {
            // Remaining 6 clusters medium distance
            clusterDistance = 400 + Math.random() * 400;
          }
          
          // Cluster center
          const centerX = ho.worldX + Math.cos(angle) * clusterDistance;
          const centerY = ho.worldY + Math.sin(angle) * clusterDistance;
          
          // Random number of motes in this cluster (1-5)
          const clusterSize = 1 + Math.floor(Math.random() * 5);
          for (let j = 0; j < clusterSize; j++) {
            // Small offset from cluster center (20-80px radius)
            const offsetAngle = Math.random() * Math.PI * 2;
            const offsetDist = 20 + Math.random() * 60;
            const x = centerX + Math.cos(offsetAngle) * offsetDist;
            const y = centerY + Math.sin(offsetAngle) * offsetDist;
            const vx = (Math.random() - 0.5) * 2;
            const vy = (Math.random() - 0.5) * 2;
            this.particleSystem.spawnQualityParticle('void', 0, x, y, vx, vy);
          }
        }
        console.log('[CanvasRenderer] Cosmic Drift purchased — spawned mote clusters near player');
      } else {
        console.warn('[CanvasRenderer] Cannot spawn motes near player: home object or particle system not ready');
      }
    }
    if (data.upgradeId === 'upg_gravitationalPull') {
      const ho = this.canvasConfig?.homeObject;
      if (!ho) {
        // canvasConfig not loaded yet — defer until loadEpochConfig runs
        this._pendingGravityLevel = Math.max(this._pendingGravityLevel, data.level || 1);
        console.warn('[CanvasRenderer] Gravitational Pull deferred — home object not ready yet');
        return;
      }
      try {
        // Clean up beacon mote and start normal mote genesis (sparse — gravity will do the work)
        this.particleSystem.clearHomingParticles('void');
        this.particleSystem.spawnInitialParticles('void', 25);

        // Gravity radius scales with upgrade level — 10 levels, linear progression
        // Starts small (50px) and increases to 410px for late-game mote gathering
        const gravityRadiusByLevel = [0, 50, 70, 95, 125, 160, 200, 245, 295, 350, 410];
        const level = data.level || 1;
        const radius = gravityRadiusByLevel[Math.min(level, gravityRadiusByLevel.length - 1)];

        console.log(`[CanvasRenderer] Gravity level ${level}, radius ${radius} at (${ho.worldX}, ${ho.worldY})`);
        this.particleSystem.enableAttractionAll(ho.worldX, ho.worldY, radius);
        this._gravityBaseRadius = radius;
        console.log('[CanvasRenderer] Gravity attraction set up successfully');
      } catch (err) {
        console.error('[CanvasRenderer] Error setting up gravity:', err);
      }
    }
  }

  // ---------------------------------------------------------------
  // Space dust parallax layer
  // ---------------------------------------------------------------

  /** Simple seeded LCG PRNG — returns a function that yields [0, 1). */
  _seededRand(seed) {
    let s = (seed ^ 0x5A5A5A5A) >>> 0;
    return () => {
      s = ((Math.imul(s, 1664525) + 1013904223) | 0) >>> 0;
      return s / 4294967296;
    };
  }

  /** Initialise two dust layers using deterministic seeds. */
  _initSpaceDust() {
    const rand  = this._seededRand(0xAE0E5);
    const rand2 = this._seededRand(0xBF1F6);

    // Muted, desaturated palette — clearly distinct from the vivid blue motes
    const farColors  = ['#c0c8d0', '#d0ccbe', '#b8c0cc', '#ccc8b8'];
    const nearColors = ['#e0dcce', '#c8d4e0', '#d8ccb8', '#d0d4e8', '#c8c0b0', '#e4e0d4'];

    // Far layer — distant haze, fine 1×1 dots, slow twinkle
    const farParticles = Array.from({ length: 800 }, () => ({
      nx:          rand(),
      ny:          rand(),
      alpha:       0.18 + rand() * 0.18,       // 0.18–0.36
      color:       farColors[Math.floor(rand() * farColors.length)],
      phase:       rand() * Math.PI * 2,        // twinkle phase offset
      twinkleSpd:  0.2 + rand() * 0.5,         // slow twinkle (0.2–0.7 Hz)
      dy: 0, dvy: 0,
    }));

    // Near layer — closer, brighter, varied shapes, faster twinkle
    //   shape 0 = 1×1 dot (60%)
    //   shape 1 = 2×2 dot (15%)
    //   shape 2 = horizontal needle 3×1 (15%)
    //   shape 3 = plus cross (10%)
    const nearParticles = Array.from({ length: 600 }, () => {
      const r = rand2();
      const shape = r < 0.60 ? 0 : r < 0.75 ? 1 : r < 0.90 ? 2 : 3;
      return {
        nx:         rand2(),
        ny:         rand2(),
        alpha:      0.25 + rand2() * 0.20,     // 0.25–0.45
        color:      nearColors[Math.floor(rand2() * nearColors.length)],
        shape,
        phase:      rand2() * Math.PI * 2,
        twinkleSpd: 0.4 + rand2() * 0.8,      // slightly faster twinkle (0.4–1.2 Hz)
        dy: 0, dvy: 0,
      };
    });

    this._dustLayers = [
      { particles: farParticles,  parallax: 0.20 },
      { particles: nearParticles, parallax: 0.50 },
    ];
  }

  /**
   * Draw both space dust parallax layers with dark matter gravity wave undulation.
   * DM waves and their reflections displace dust particles as the ring passes;
   * displacement snaps back to rest immediately once the wave moves on.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} viewW
   * @param {number} viewH
   * @param {number} dt  Delta time in seconds
   */
  _drawSpaceDust(ctx, viewW, viewH, dt = 0.016) {
    if (!this._dustLayers || !this.camera) return;

    // Build screen-space influence records for each active DM node
    const dmInfluences = [];
    if (this._darkMatterActive && this._darkMatterSystem) {
      for (const node of this._darkMatterSystem.getNodes()) {
        const { sx, sy } = this.camera.worldToScreen(node.x, node.y);
        dmInfluences.push({
          sx,
          sy,
          clearRadius: 55 + (node.nodeRadius || 6) * 7,
          waveRadius: node.waveRadius || 0,
          waveMaxRadius: node.waveMaxRadius || 900,
          waveAlpha: node.waveAlpha || 0,
          pulsing: node.pulsing || false,
        });
      }
    }

    const activeWaves = dmInfluences.filter(dm => dm.pulsing && dm.waveAlpha > 0.01 && dm.waveRadius > 0);

    // Collect reflected ripples — constrained to 60° arc pointing back toward the DM node
    const reflectedWaves = [];
    if (this._darkMatterActive && this._darkMatterSystem) {
      for (const node of this._darkMatterSystem.getNodes()) {
        const rw = node.reflWave;
        if (rw && rw.alpha > 0.01 && rw.radius > 0) {
          const { sx: rwsx, sy: rwsy } = this.camera.worldToScreen(rw.x, rw.y);
          const { sx: nodeSx, sy: nodeSy } = this.camera.worldToScreen(node.x, node.y);
          reflectedWaves.push({
            sx: rwsx,
            sy: rwsy,
            waveRadius: rw.radius,
            waveMaxRadius: 140,
            waveAlpha: rw.alpha * 0.5,
            dirAngle: Math.atan2(nodeSy - rwsy, nodeSx - rwsx),
            arcHalfWidth: Math.PI / 6, // ±30° = 60° total arc
          });
        }
      }
    }

    ctx.save();

    // Void-clearing halo behind both dust layers
    for (const dm of dmInfluences) {
      const grad = ctx.createRadialGradient(dm.sx, dm.sy, 0, dm.sx, dm.sy, dm.clearRadius);
      grad.addColorStop(0,    'rgba(8,0,22,0.30)');
      grad.addColorStop(0.55, 'rgba(25,0,50,0.10)');
      grad.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(dm.sx, dm.sy, dm.clearRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw each layer (far first, then near on top)
    for (const layer of this._dustLayers) {
      const parallaxFactor = layer.parallax;

      for (const p of layer.particles) {
        // Screen position for this particle, offset by accumulated world scroll
        const sx = ((p.nx * viewW - (this.camera.x + this._dustScrollX) * parallaxFactor) % viewW + viewW) % viewW;
        let   sy = ((p.ny * viewH - (this.camera.y + this._dustScrollY) * parallaxFactor) % viewH + viewH) % viewH;

        // Compute target displacement from the nearest wave front (main or reflected).
        // Using direct lerp instead of spring physics so dust snaps back the moment the wave passes.
        let targetDy = 0;
        for (const wave of activeWaves) {
          const ddx = sx - wave.sx;
          const ddy = sy - wave.sy;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          const distFromWave = Math.abs(dist - wave.waveRadius);
          if (distFromWave < 50) {
            const ringFactor  = (1 - distFromWave / 50) * wave.waveAlpha;
            // Clamp falloff to a minimum so the wave always makes a noticeable hit at the player
            const distFalloff = Math.max(0.3, 1 - dist / wave.waveMaxRadius);
            targetDy = Math.min(targetDy, -ringFactor * distFalloff * 18);
          }
        }
        for (const wave of reflectedWaves) {
          const ddx = sx - wave.sx;
          const ddy = sy - wave.sy;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          const distFromWave = Math.abs(dist - wave.waveRadius);
          if (distFromWave < 50) {
            const particleAngle = Math.atan2(ddy, ddx);
            const angleDiff = Math.abs(((particleAngle - wave.dirAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (angleDiff > wave.arcHalfWidth) continue;
            const ringFactor  = (1 - distFromWave / 50) * wave.waveAlpha;
            const distFalloff = Math.max(0, 1 - dist / wave.waveMaxRadius);
            targetDy = Math.min(targetDy, -ringFactor * distFalloff * 18);
          }
        }

        // Fast lerp toward target — settles in ~0.15 s, restores instantly when wave moves on
        p.dy += (targetDy - p.dy) * Math.min(1, dt * 22);
        if (targetDy === 0 && Math.abs(p.dy) < 0.05) p.dy = 0;

        sy += p.dy;

        // Twinkle: gentle sinusoidal alpha modulation
        let alpha = p.alpha * (0.70 + 0.30 * Math.sin(this._dustTime * p.twinkleSpd + p.phase));

        // DM core clearing: fade dust near each node
        for (const dm of dmInfluences) {
          const ddx = sx - dm.sx;
          const ddy = sy - dm.sy;
          const dist2 = ddx * ddx + ddy * ddy;
          if (dist2 < dm.clearRadius * dm.clearRadius && dist2 > 0.25) {
            alpha *= Math.sqrt(dist2) / dm.clearRadius * 0.75;
          }
        }

        if (alpha < 0.01) continue;

        // Gravity wave displacement: subtle brightness boost only (no size expansion)
        const dispAbs = Math.abs(p.dy);
        if (dispAbs > 0.5) {
          const dispBoost = Math.min(2.0, 1 + dispAbs / 24);
          alpha = Math.min(1.0, alpha * dispBoost);
        }

        const px = Math.round(sx);
        const py = Math.round(sy);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;

        // Shape: 0=1×1, 1=2×2, 2=horizontal needle, 3=plus cross
        switch (p.shape) {
          case 1:  // 2×2 dot
            ctx.fillRect(px - 1, py - 1, 2, 2);
            break;
          case 2:  // horizontal needle 3×1
            ctx.fillRect(px - 1, py, 3, 1);
            break;
          case 3:  // plus cross
            ctx.fillRect(px - 1, py, 3, 1);
            ctx.fillRect(px, py - 1, 1, 3);
            break;
          default: // 1×1 dot
            ctx.fillRect(px, py, 1, 1);
        }
      }

    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /** Spawn a floating number at a screen position. */
  spawnFloatingNumber(text, sx, sy, combo = false) {
    this.floatingNumbers.spawn(text, sx, sy, combo);
  }

  /** Toggle glow canvas rendering. */
  setGlowEnabled(enabled) {
    this.glowEnabled = !!enabled;
    if (this.glowCanvas) {
      this.glowCanvas.style.display = this.glowEnabled ? '' : 'none';
    }
  }

  /** Set the energy→mass conversion rate (0..1). Used by the slider UI. */
  setConversionRate(rate) {
    this._conversionRate = Math.max(0, Math.min(1, rate));
  }

  /** Get the current conversion rate (0..1). */
  getConversionRate() {
    return this._conversionRate;
  }

  /**
   * Store a reference to the MoteController so the renderer can read
   * the mote's live position, angle, and tractor beam state each frame.
   */
  setMoteController(mc) {
    this._moteController = mc;
  }

  /**
   * Attach a DarkMatterSystem for node rendering and wave dispatch.
   * @param {import('../engine/DarkMatterSystem.js?v=0e91f62').DarkMatterSystem} sys
   */
  setDarkMatterSystem(sys) {
    this._darkMatterSystem = sys;
  }

  /**
   * Update the Energy Resonance multiplier applied to attraction radius.
   * Called each game tick from main.js with the current resonance factor.
   * @param {number} mult — ≥1.0
   */
  setResonanceMult(mult) {
    this._resonanceMult = mult;
  }

  /** Attach the NarrativePanel (for Epoch Collapse text display). */
  setNarrativePanel(panel) {
    this._narrativePanel = panel;
  }

  /**
   * Trigger the Epoch Collapse animation.
   * Called by main.js when energy reaches absoluteCap.
   */
  startEpochCollapse() {
    if (this._collapseTriggered || this._collapseAnim.isRunning()) return;
    this._collapseTriggered = true;
    const ho = this.canvasConfig?.homeObject;
    const sx = ho ? ho.worldX : 0;
    const sy = ho ? ho.worldY : 0;
    this._collapseAnim.start(sx, sy);
  }

  /** Reset collapse state (after prestige). */
  resetCollapse() {
    this._collapseTriggered = false;
    if (this._collapseAnim.isRunning()) {
      this._collapseAnim.continue(); // stops the animation
    }
    // Reset visual overrides
    this._orbitalDisplay.setSpeedMultiplier(1);
    this._orbitalDisplay.setRadiusScale(1);
    this.particleSystem.setVacuumMode(null, null, 0);
    if (this._narrativePanel) this._narrativePanel.hide();
  }

  /**
   * Reset renderer state for a prestige run.
   * Must be called BEFORE loadEpochConfig so particle regions start clean.
   */
  resetForPrestige() {
    this._gravityBaseRadius = 0;
    this._pendingGravityLevel = 0;
    this._currentEnergy = 0;
    this._currentMass = 0;
    this.particleSystem.clearDefaultAttraction();
    // Reset orbital display ephemeral state (mode/quark color persist intentionally)
    this._orbitalDisplay.setSpeedMultiplier(1);
    this._orbitalDisplay.setRadiusScale(1);
  }

  /**
   * Activate (or deactivate) the dark matter visual layer.
   * Must be called when restoring a saved game where ms_gasCloud was already triggered,
   * since milestone:triggered is not re-emitted on load.
   * @param {boolean} active
   */
  setDarkMatterActive(active) {
    this._darkMatterActive = !!active;
    if (active && this.canvasConfig) {
      const voidRegion = this.canvasConfig.regions?.find(r => r.regionId === 'void');
      if (voidRegion && !voidRegion.particleTypes.includes('darkMote')) {
        voidRegion.particleTypes.push('darkMote');
      }
    }
  }

  /**
   * Apply an outward radial force to particles (called on darkMatter:wave event).
   * @param {number} x  World X
   * @param {number} y  World Y
   * @param {number} radius  Affected radius in world pixels
   * @param {number} strength  Wave force strength
   */
  applyRadialForce(x, y, radius, strength) {
    this.particleSystem?.applyRadialForce(x, y, radius, strength);
  }

  /**
   * Activate the Particle Storm reward effect.
   * Expands gravity radius ×3, spawns a mote burst, and shows a visual indicator.
   * @param {number} durationMs
   */
  activateParticleStorm(durationMs) {
    this._particleStormActive = true;
    this._particleStormTimer = durationMs / 1000;
    this._stormGravityMult = 3;
    this._visualFlash = 1.0;
    // Spawn burst of motes in void region
    if (this.particleSystem) {
      this.particleSystem.spawnInitialParticles('void', 500);
    }
  }

  /** Handle epoch change by loading the new epoch's canvas config. */
  async onEpochChange(epochId) {
    try {
      const module = await import(`../data/${epochId}-canvas.js`);
      const configKey = Object.keys(module).find((k) => k.endsWith('CanvasConfig'));
      if (configKey) {
        this.loadEpochConfig(module[configKey]);
      }
    } catch (err) {
      console.error(`[CanvasRenderer] Failed to load canvas config for ${epochId}:`, err);
    }
  }
}
