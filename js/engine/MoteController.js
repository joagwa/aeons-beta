/**
 * MoteController — Manages the player mote's world position, angle, and velocity.
 * Movement is unlocked by purchasing the Cosmic Drift upgrade (1 energy) in every run.
 * After the first prestige it is also auto-granted via PrestigeSystem.applyRunBonuses.
 * Speed is a flat 40 px/sec.
 * Supports keyboard (WASD/arrows) and touch (drag) input.
 * Emits 'mote:moved' on the EventBus each tick.
 */

export class MoteController {
  constructor(EventBus) {
    this.bus = EventBus;
    this.worldX = 2000;
    this.worldY = 2500;
    this.angle = -Math.PI / 2; // visual facing angle, derived from velocity
    this.maxSpeed = 40; // flat movement speed when enabled (half of previous max 80)
    this._speedMultiplier = 1.0; // applied via Spatial Acceleration upgrade
    this.tractorBeamRange = 0;
    this.tractorBeamStrength = 1.0;

    // Velocity components for direct 4-axis movement
    this._vx = 0;
    this._vy = 0;

    // Movement input state (WASD = up/down/left/right in world space)
    this._input = { up: false, down: false, left: false, right: false };
    this._enabled = false; // unlocked as passive on first prestige
    this._inputBlocked = false; // blocks all input except when prestige panel is hidden

    // Universe bounds (set from canvas config)
    this._boundsW = 4000;
    this._boundsH = 3000;

    // Auto-drift bounds (sourced from void region config)
    this._driftBoundsX = 0;
    this._driftBoundsY = 0;
    this._driftBoundsW = 4000;
    this._driftBoundsH = 5000;

    // Auto-drift state (active before cosmicDrift is purchased)
    this._driftAngle = Math.random() * Math.PI * 2;
    this._driftChangeTimer = 2 + Math.random() * 3;

    // Controls hint timing
    this._hintShowTime = 0;
    this._lastMoveTime = 0;

    // Virtual joystick state (touch/mouse drag)
    this._joystickActive = false;
    this._joystickOriginX = 0;  // canvas-relative screen coords
    this._joystickOriginY = 0;
    this._joystickCurrentX = 0;
    this._joystickCurrentY = 0;
    this._joystickCanvasLeft = 0; // cached canvas offset at gesture start
    this._joystickCanvasTop = 0;
    /** Maximum drag radius in CSS pixels before speed is capped */
    this._joystickMaxRadius = 60;
    this._canvas = null;
    this._tiltController = null;

    /** True when the primary input is touch (used to tailor the controls hint). */
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Bound handlers
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
  }

  /**
   * Initialise with starting position, attach keyboard listeners, and
   * optionally attach pointer-based drag-to-move on a canvas element.
   * @param {number} initialX
   * @param {number} initialY
   * @param {HTMLCanvasElement} [canvas]
   */
  init(initialX, initialY, canvas) {
    this.worldX = initialX;
    this.worldY = initialY;
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);

    if (canvas) {
      this._canvas = canvas;
      canvas.addEventListener('pointerdown', this._onPointerDown);
      canvas.addEventListener('pointermove', this._onPointerMove, { passive: false });
      canvas.addEventListener('pointerup', this._onPointerUp);
      canvas.addEventListener('pointercancel', this._onPointerUp);
    }

    this.bus.on('upgrade:purchased', (data) => this._onUpgrade(data));
  }

  /**
   * Reset all movement state for a prestige run.
   * Call this before loadEpoch, then set worldX/worldY to the new home object position.
   */
  resetForPrestige() {
    this._enabled = false; // disabled on prestige, re-enable if tier >= 1
    this.maxSpeed = 40; // flat speed when enabled
    this.tractorBeamRange = 0;
    this.tractorBeamStrength = 1.0;
    this._vx = 0;
    this._vy = 0;
    this._input = { up: false, down: false, left: false, right: false };
    this._joystickActive = false;
    this._hintShowTime = 0;
    this._lastMoveTime = 0;
    this._driftChangeTimer = 2 + Math.random() * 3;
  }

  /**
   * Set universe bounds for clamping (called when canvas config loads).
   */
  setBounds(w, h) {
    this._boundsW = w;
    this._boundsH = h;
  }

  /**
   * Set drift bounds from the void region config (auto-drift stays inside this area).
   */
  setDriftBounds(x, y, w, h) {
    this._driftBoundsX = x;
    this._driftBoundsY = y;
    this._driftBoundsW = w;
    this._driftBoundsH = h;
  }

  /**
   * Set movement speed multiplier (applied via Spatial Acceleration upgrade).
   * @param {number} mult - multiplier (1.0 = base speed)
   */
  setSpeedMultiplier(mult) {
    this._speedMultiplier = Math.max(1, mult);
  }

  /** Attach a TiltController to use as an additional movement input source. */
  setTiltController(tc) {
    this._tiltController = tc;
  }

  /**
   * Game-frame update — called from onFrame at full rAF rate (~60fps) for smooth motion.
   * @param {number} dt — real wall-clock delta in seconds (clamped externally)
   */
  tick(dt) {
    if (!this._enabled || dt <= 0) return;

    const effectiveMaxSpeed = this.maxSpeed * this._speedMultiplier;
    const accel = effectiveMaxSpeed * 8 * dt;   // reach max speed in ~0.125s
    const friction = Math.pow(0.008, dt);    // aggressive stop — nearly instant when released

    if (this._joystickActive) {
      // Virtual joystick drives velocity — speed proportional to drag distance
      const dx = this._joystickCurrentX - this._joystickOriginX;
      const dy = this._joystickCurrentY - this._joystickOriginY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const deadZone = 6; // CSS pixels — ignore micro-movements

      if (dist > deadZone) {
        const norm = Math.min(dist, this._joystickMaxRadius) / this._joystickMaxRadius;
        const nx = (dx / dist) * norm;
        const ny = (dy / dist) * norm;
        const targetVx = nx * effectiveMaxSpeed;
        const targetVy = ny * effectiveMaxSpeed;

        // Accelerate toward joystick target
        if (targetVx < this._vx) this._vx = Math.max(this._vx - accel, targetVx);
        else                      this._vx = Math.min(this._vx + accel, targetVx);
        if (targetVy < this._vy) this._vy = Math.max(this._vy - accel, targetVy);
        else                      this._vy = Math.min(this._vy + accel, targetVy);
      } else {
        this._vx *= friction;
        this._vy *= friction;
      }
    } else {
      // Tilt input (if active and giving a non-zero vector); falls through to keyboard when zero
      let tiltActive = false;
      if (!this._inputBlocked && this._tiltController && this._tiltController.isEnabled()) {
        const mv = this._tiltController.getMovementVector();
        if (mv.x !== 0 || mv.y !== 0) {
          tiltActive = true;
          // Normalise combined magnitude so diagonal tilt doesn't exceed maxSpeed
          const mag = Math.sqrt(mv.x * mv.x + mv.y * mv.y);
          const nx = mag > 1 ? mv.x / mag : mv.x;
          const ny = mag > 1 ? mv.y / mag : mv.y;
          const targetVx = nx * effectiveMaxSpeed;
          const targetVy = ny * effectiveMaxSpeed;
          if (targetVx < this._vx) this._vx = Math.max(this._vx - accel, targetVx);
          else                      this._vx = Math.min(this._vx + accel, targetVx);
          if (targetVy < this._vy) this._vy = Math.max(this._vy - accel, targetVy);
          else                      this._vy = Math.min(this._vy + accel, targetVy);
        }
      }

      if (!tiltActive) {
        // Keyboard input
        if (this._input.left)       this._vx = Math.max(this._vx - accel, -effectiveMaxSpeed);
        else if (this._input.right) this._vx = Math.min(this._vx + accel,  effectiveMaxSpeed);
        else                        this._vx *= friction;

        if (this._input.up)         this._vy = Math.max(this._vy - accel, -effectiveMaxSpeed);
        else if (this._input.down)  this._vy = Math.min(this._vy + accel,  effectiveMaxSpeed);
        else                        this._vy *= friction;
      }
    }

    // Snap tiny velocity to zero to avoid micro-drift
    if (Math.abs(this._vx) < 0.5) this._vx = 0;
    if (Math.abs(this._vy) < 0.5) this._vy = 0;

    this.worldX += this._vx * dt;
    this.worldY += this._vy * dt;

    // Clamp to world bounds (important at high AEONS_SPEED_MULT where dt is large)
    this.worldX = Math.max(0, Math.min(this._boundsW, this.worldX));
    this.worldY = Math.max(0, Math.min(this._boundsH, this.worldY));

    // Update visual facing angle from current velocity direction
    if (Math.abs(this._vx) > 1 || Math.abs(this._vy) > 1) {
      this.angle = Math.atan2(this._vy, this._vx);
      this._lastMoveTime = performance.now();
    }

    this.bus.emit('mote:moved', {
      worldX: this.worldX,
      worldY: this.worldY,
      angle: this.angle,
      speed: Math.sqrt(this._vx * this._vx + this._vy * this._vy),
    });
  }

  /**
   * Automatic pre-cosmicDrift drift through the void. Meanders slowly so the player
   * passively collides with motes to earn the first energy.
   * @param {number} dt
   */
  _tickAutoDrift(dt) {
    const SPEED = 120; // px/sec
    const MARGIN = 200;

    // Meander: change direction every 2–5 seconds with a ±45° turn
    this._driftChangeTimer -= dt;
    if (this._driftChangeTimer <= 0) {
      this._driftAngle += (Math.random() - 0.5) * Math.PI * 0.5;
      this._driftChangeTimer = 2 + Math.random() * 3;
    }

    // Soft-bounce: reflect the relevant axis component when approaching a wall
    const minX = this._driftBoundsX + MARGIN;
    const maxX = this._driftBoundsX + this._driftBoundsW - MARGIN;
    const minY = this._driftBoundsY + MARGIN;
    const maxY = this._driftBoundsY + this._driftBoundsH - MARGIN;

    if (this.worldX <= minX && Math.cos(this._driftAngle) < 0) {
      this._driftAngle = Math.atan2(Math.sin(this._driftAngle), Math.abs(Math.cos(this._driftAngle)));
    } else if (this.worldX >= maxX && Math.cos(this._driftAngle) > 0) {
      this._driftAngle = Math.atan2(Math.sin(this._driftAngle), -Math.abs(Math.cos(this._driftAngle)));
    }
    if (this.worldY <= minY && Math.sin(this._driftAngle) < 0) {
      this._driftAngle = Math.atan2(Math.abs(Math.sin(this._driftAngle)), Math.cos(this._driftAngle));
    } else if (this.worldY >= maxY && Math.sin(this._driftAngle) > 0) {
      this._driftAngle = Math.atan2(-Math.abs(Math.sin(this._driftAngle)), Math.cos(this._driftAngle));
    }

    this.worldX += Math.cos(this._driftAngle) * SPEED * dt;
    this.worldY += Math.sin(this._driftAngle) * SPEED * dt;

    // Hard clamp as safety net
    this.worldX = Math.max(minX, Math.min(maxX, this.worldX));
    this.worldY = Math.max(minY, Math.min(maxY, this.worldY));

    this.angle = this._driftAngle;
  }

  /** Current speed magnitude (for compatibility). */
  get speed() {
    return Math.sqrt(this._vx * this._vx + this._vy * this._vy);
  }

  /** Whether movement is currently enabled. */
  get enabled() {
    return this._enabled;
  }

  /**
   * Returns joystick state for the renderer to draw the virtual joystick overlay.
   * @returns {{ active: boolean, originX: number, originY: number, currentX: number, currentY: number, maxRadius: number }}
   */
  getJoystickState() {
    return {
      active: this._joystickActive,
      originX: this._joystickOriginX,
      originY: this._joystickOriginY,
      currentX: this._joystickCurrentX,
      currentY: this._joystickCurrentY,
      maxRadius: this._joystickMaxRadius,
    };
  }

  // ── Keyboard handlers ───────────────────────────────────────────────

  _handleKeyDown(e) {
    if (!this._enabled || this._inputBlocked) return;
    switch (e.key) {
      case 'w': case 'W': case 'ArrowUp':    this._input.up    = true; break;
      case 's': case 'S': case 'ArrowDown':   this._input.down  = true; break;
      case 'a': case 'A': case 'ArrowLeft':   this._input.left  = true; break;
      case 'd': case 'D': case 'ArrowRight':  this._input.right = true; break;
    }
  }

  _handleKeyUp(e) {
    if (this._inputBlocked) return;
    switch (e.key) {
      case 'w': case 'W': case 'ArrowUp':    this._input.up    = false; break;
      case 's': case 'S': case 'ArrowDown':   this._input.down  = false; break;
      case 'a': case 'A': case 'ArrowLeft':   this._input.left  = false; break;
      case 'd': case 'D': case 'ArrowRight':  this._input.right = false; break;
    }
  }

  // ── Virtual joystick pointer handlers ───────────────────────────────

  _handlePointerDown(e) {
    if (!this._enabled || !e.isPrimary || this._inputBlocked) return;
    // Cache canvas offset so we don't call getBoundingClientRect() every frame
    const rect = this._canvas.getBoundingClientRect();
    this._joystickCanvasLeft = rect.left;
    this._joystickCanvasTop = rect.top;
    const cx = e.clientX - this._joystickCanvasLeft;
    const cy = e.clientY - this._joystickCanvasTop;
    this._joystickOriginX = cx;
    this._joystickOriginY = cy;
    this._joystickCurrentX = cx;
    this._joystickCurrentY = cy;
    this._joystickActive = true;
    try { this._canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }

  _handlePointerMove(e) {
    if (!this._joystickActive || !e.isPrimary) return;
    e.preventDefault(); // prevent scroll on touch
    this._joystickCurrentX = e.clientX - this._joystickCanvasLeft;
    this._joystickCurrentY = e.clientY - this._joystickCanvasTop;
    this._lastMoveTime = performance.now();
  }

  _handlePointerUp(e) {
    if (!e.isPrimary) return;
    this._joystickActive = false;
  }

  // ── Upgrade handler ─────────────────────────────────────────────────

  _onUpgrade(data) {
    switch (data.upgradeId) {
      case 'upg_cosmicDrift':
        // Movement upgrade purchased — enable player control
        this._enabled = true;
        this._hintShowTime = performance.now() + 10_000; // show hint for 10s
        this._lastMoveTime = performance.now();
        break;
      case 'upg_eventHorizon':
        this.tractorBeamRange = 120 + (data.level || 1) * 60;
        this.tractorBeamStrength = 1.0 + (data.level || 1) * 0.5;
        break;
    }
  }

  /**
   * Returns whether the controls hint should be visible, and its alpha (0..1).
   * Shows for 10s after unlocking, then reappears on 30+ second idle.
   */
  getHintState() {
    if (!this._enabled) return { visible: false, alpha: 0 };
    const now = performance.now();

    // Show for 10s after first prestige unlock
    if (now < this._hintShowTime) {
      const remaining = this._hintShowTime - now;
      const alpha = remaining < 2000 ? remaining / 2000 : 1;
      return { visible: true, alpha };
    }

    // Reappear if idle for 30+ seconds
    const idle = now - this._lastMoveTime;
    if (idle > 30_000) {
      const fadeIn = Math.min(1, (idle - 30_000) / 1000);
      return { visible: true, alpha: fadeIn * 0.7 };
    }

    return { visible: false, alpha: 0 };
  }

  /**
   * Block all movement input (called when prestige dialog appears).
   * Prevents accidental player actions during prestige decision.
   */
  blockAllInput() {
    this._inputBlocked = true;
    this._input = { up: false, down: false, left: false, right: false };
    this._vx = 0;
    this._vy = 0;
    this._joystickActive = false;
  }

  /**
   * Unblock all movement input (called when prestige dialog closes or prestige executes).
   */
  unblockAllInput() {
    this._inputBlocked = false;
  }

  // ── Serialisation ───────────────────────────────────────────────────

  getState() {
    return {
      worldX: this.worldX,
      worldY: this.worldY,
      angle: this.angle,
      vx: this._vx,
      vy: this._vy,
      enabled: this._enabled,
      maxSpeed: this.maxSpeed,
      tractorBeamRange: this.tractorBeamRange,
      tractorBeamStrength: this.tractorBeamStrength,
    };
  }

  loadState(state) {
    if (!state) return;
    this.worldX = state.worldX ?? this.worldX;
    this.worldY = state.worldY ?? this.worldY;
    this.angle = state.angle ?? this.angle;
    this._vx = state.vx ?? 0;
    this._vy = state.vy ?? 0;
    this._enabled = state.enabled ?? false;
    this.maxSpeed = state.maxSpeed ?? 0;
    this.tractorBeamRange = state.tractorBeamRange ?? 0;
    this.tractorBeamStrength = state.tractorBeamStrength ?? 1.0;
    if (this._enabled) {
      this._lastMoveTime = performance.now();
    }
  }
}
