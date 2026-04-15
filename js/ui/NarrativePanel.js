/**
 * NarrativePanel — Full-screen overlay for Epoch Collapse story text.
 *
 * Displays lore text with a typewriter effect, then reveals [Continue].
 * On continue, emits 'collapse:complete' event and hides.
 */
export class NarrativePanel {
  #overlay = null;
  #textEl = null;
  #btnEl = null;
  #eventBus = null;
  #visible = false;
  #typewriterInterval = null;

  static NARRATIVE_TEXT =
    `10,000,000 units of raw energy. Every particle of quantum foam drawn into you.\n\n` +
    `A moment of everything.\n\n` +
    `Then — the collapse. Structure emerges from chaos.\n\n` +
    `You feel it: flavour. The hint of something beneath pure energy.\n\n` +
    `The age of undifferentiated energy ends. Something new begins.`;

  constructor(EventBus) {
    this.#eventBus = EventBus;
  }

  init() {
    this.#overlay = document.getElementById('narrative-overlay');
    if (!this.#overlay) {
      this.#overlay = this._createOverlay();
    }
    this.#textEl = this.#overlay.querySelector('.narrative-text');
    this.#btnEl = this.#overlay.querySelector('.narrative-continue');

    if (this.#btnEl) {
      this.#btnEl.addEventListener('click', () => this._onContinue());
    }
  }

  _createOverlay() {
    const el = document.createElement('div');
    el.id = 'narrative-overlay';
    el.className = 'narrative-overlay hidden';
    el.innerHTML = `
      <div class="narrative-content">
        <div class="narrative-text"></div>
        <button class="narrative-continue hidden">Continue</button>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  /**
   * Show the narrative with fade-in controlled by alpha.
   * @param {number} alpha — 0 to 1
   */
  setAlpha(alpha) {
    if (!this.#overlay) return;
    if (alpha > 0 && !this.#visible) {
      this.#visible = true;
      this.#overlay.classList.remove('hidden');
      this._startTypewriter();
    }
    this.#overlay.style.opacity = alpha.toFixed(3);
  }

  /** Show the continue button. */
  showContinue() {
    if (this.#btnEl) this.#btnEl.classList.remove('hidden');
  }

  hide() {
    if (!this.#overlay) return;
    this.#visible = false;
    if (this.#typewriterInterval) {
      clearInterval(this.#typewriterInterval);
      this.#typewriterInterval = null;
    }
    this.#overlay.classList.add('hidden');
    this.#overlay.style.opacity = '0';
    if (this.#textEl) this.#textEl.textContent = '';
    if (this.#btnEl) this.#btnEl.classList.add('hidden');
  }

  isVisible() { return this.#visible; }

  _startTypewriter() {
    if (!this.#textEl) return;
    const text = NarrativePanel.NARRATIVE_TEXT;
    this.#textEl.textContent = '';
    let i = 0;
    this.#typewriterInterval = setInterval(() => {
      if (i >= text.length) {
        clearInterval(this.#typewriterInterval);
        this.#typewriterInterval = null;
        this.showContinue();
        return;
      }
      this.#textEl.textContent += text[i];
      i++;
    }, 35); // ~35ms per character
  }

  _onContinue() {
    this.#eventBus.emit('collapse:complete');
    this.hide();
  }
}
