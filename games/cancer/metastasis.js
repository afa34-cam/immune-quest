// ═══════════════════════════════════════════════════════════════════
//  metastasis.js — Secondary board trigger and management.
// ═══════════════════════════════════════════════════════════════════

class MetastasisManager {
  constructor(difficulty) {
    this.difficulty     = difficulty;
    this.triggered      = false;
    this.site           = null;   // 'liver' | 'lymph'
    this.secondaryBoard = null;
    this._cfg           = CONFIG.DIFFICULTY[difficulty];
    this._metaCfg       = CONFIG.META_BOARD;
  }

  // Called at end of each mutation phase
  // Returns true if metastasis just triggered for the first time
  checkTrigger(primaryBoard, mutationResult) {
    if (this.triggered) return false;
    if (mutationResult !== 'metastasis') return false;

    const triggerRow = this._cfg.meta_trigger_row;
    if (!primaryBoard.hasReachedRow(triggerRow)) return false;

    this.triggered = true;
    this.site      = Math.random() < this._metaCfg.LIVER_PROB ? 'liver' : 'lymph';

    const cols = this._metaCfg.COLS[this.difficulty];
    const rows = this._metaCfg.ROWS[this.difficulty];
    this.secondaryBoard = new Board(cols, rows, this.site);

    // Seed 1-2 cancer cells on the secondary board
    const seedCount = Math.random() < 0.5 ? 1 : 2;
    const placed    = new Set();
    for (let i = 0; i < seedCount; i++) {
      let col, row;
      do {
        col = Math.floor(Math.random() * cols);
        row = 0; // always starts at top
      } while (placed.has(`${col},${row}`));
      placed.add(`${col},${row}`);
      this.secondaryBoard.seedTumour(col, row);
    }

    return true;
  }

  get isActive() { return this.triggered && this.secondaryBoard !== null; }

  get siteName() {
    return this.site === 'liver' ? 'liver' : 'lymph node';
  }

  get siteNameCapital() {
    return this.site === 'liver' ? 'Liver' : 'Lymph Node';
  }

  // Returns metastasis event message
  get eventMessage() {
    return `The cancer has broken through the intestinal wall and entered the bloodstream. A cluster of cells has settled in the ${this.siteName}. You now need to fight on two fronts. This is why early detection is so important — once cancer spreads, treatment becomes much harder.`;
  }

  // Both boards must be clear to win
  allCleared() {
    if (!this.triggered) return true;
    return this.secondaryBoard.isCleared();
  }

  // Either board reaching its bottom row triggers loss
  secondaryLost() {
    if (!this.triggered) return false;
    return this.secondaryBoard.bottomRowInfected();
  }
}
