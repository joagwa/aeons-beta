/**
 * EpochCollapseAnimation — Multi-phase Big Crunch cinematic.
 *
 * Triggered when energy >= 10,000,000 (absolute cap).
 * Drives orbital spin-up, particle vacuum, convergence burst, white flash,
 * and narrative text reveal.
 *
 * Phases:
 *   0 (0–3s)   Spin-up     — orbital speed ramps 1× → 6×
 *   1 (2–7s)   Mote vacuum — all background motes drift toward player
 *   2 (5–8s)   Convergence — orbital radii collapse to 0, burst flash
 *   3 (7–9s)   Flash       — full-screen white gradient from player
 *   4 (8–14s)  Narrative   — text panel fades in over dark
 *   5 (14s+)   Done        — waiting for player [Continue]
 */
export class EpochCollapseAnimation {
  #running = false;
  #elapsed = 0;
  #phase = -1;
  #sourceX = 0;
  #sourceY = 0;
  #done = false;
  #continued = false;

  // Phase timing (seconds)
  static PHASE_START = [0, 2, 5, 7, 8, 14];
  static TOTAL_DURATION = 14;

  /**
   * Begin the Epoch Collapse animation.
   * @param {number} sx — player world X
   * @param {number} sy — player world Y
   */
  start(sx, sy) {
    this.#running = true;
    this.#elapsed = 0;
    this.#phase = 0;
    this.#sourceX = sx;
    this.#sourceY = sy;
    this.#done = false;
    this.#continued = false;
  }

  /**
   * Advance the animation by dt seconds.
   * @param {number} dt
   * @returns {{ phase: number, done: boolean }}
   */
  update(dt) {
    if (!this.#running) return { phase: -1, done: true };
    this.#elapsed += dt;

    // Determine current phase from elapsed time
    const starts = EpochCollapseAnimation.PHASE_START;
    let newPhase = 0;
    for (let i = starts.length - 1; i >= 0; i--) {
      if (this.#elapsed >= starts[i]) { newPhase = i; break; }
    }
    this.#phase = newPhase;

    if (this.#phase >= 5) {
      this.#done = true;
    }

    return { phase: this.#phase, done: this.#done };
  }

  /** True while animation is active. */
  isRunning() { return this.#running; }

  /** True once phase 5 reached and waiting for continue. */
  isDone() { return this.#done; }

  /** Call when player clicks [Continue]. */
  continue() {
    this.#continued = true;
    this.#running = false;
  }

  hasContinued() { return this.#continued; }

  // ── Queries for other systems ──────────────────────────────────────────

  /** Orbital speed multiplier (1.0 → 6.0 during phase 0–2). */
  getSpeedMultiplier() {
    if (!this.#running) return 1;
    const t = Math.min(1, this.#elapsed / 5); // ramp over 5s
    return 1 + 5 * t * t; // quadratic ease-in: 1→6
  }

  /** Orbital radius collapse factor (1.0 → 0.0 during phase 2). */
  getRadiusCollapse() {
    if (!this.#running || this.#elapsed < 5) return 1;
    const t = Math.min(1, (this.#elapsed - 5) / 3); // 5s→8s
    return Math.max(0, 1 - t * t); // quadratic ease-in collapse
  }

  /** Vacuum strength for ParticleSystem (0 → 1 during phase 1–2). */
  getVacuumStrength() {
    if (!this.#running || this.#elapsed < 2) return 0;
    const t = Math.min(1, (this.#elapsed - 2) / 6); // 2s→8s ramp
    return t * t; // quadratic ease-in
  }

  /** Flash overlay alpha (0 → 1 → fade to 0 during phase 3–4). */
  getFlashAlpha() {
    if (!this.#running) return 0;
    const e = this.#elapsed;
    if (e < 7) return 0;
    if (e < 8) return (e - 7); // 0→1 over 1s
    if (e < 9) return 1; // hold
    if (e < 11) return 1 - (e - 9) / 2; // 1→0 over 2s
    return 0;
  }

  /** Narrative panel alpha (0 → 1 during phase 4). */
  getNarrativeAlpha() {
    if (!this.#running || this.#elapsed < 9) return 0;
    const t = Math.min(1, (this.#elapsed - 9) / 2); // 9s→11s
    return t;
  }

  /** Player glow intensity multiplier (1→3 during spin-up). */
  getGlowIntensity() {
    if (!this.#running) return 1;
    const t = Math.min(1, this.#elapsed / 5);
    return 1 + 2 * t;
  }

  /** Source coordinates (player position at start). */
  getSource() { return { x: this.#sourceX, y: this.#sourceY }; }

  /** Current phase number. */
  getPhase() { return this.#phase; }

  /** Elapsed seconds. */
  getElapsed() { return this.#elapsed; }
}
