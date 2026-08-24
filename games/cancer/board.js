// ═══════════════════════════════════════════════════════════════════
//  board.js — Cell state management, cancer spread, mutation events.
//
//  Cell states:
//    'healthy'     — normal epithelial cell
//    'cancerous'   — infected by tumour
//    'cleared'     — recently cleared (fades to healthy after 2 turns)
//    'protected'   — healthy + immune shield (cytokines / mAb barrier)
//    'damaged'     — healthy but damaged by radiotherapy
//
//  Each cell object:
//    { state, established, turnsPresent, protectedTurns, damagedTurns,
//      barrierTurns, resistantTo[] }
// ═══════════════════════════════════════════════════════════════════

class Board {
  // ── Constructor ───────────────────────────────────────────────
  constructor(cols, rows, type = 'intestine') {
    this.cols  = cols;
    this.rows  = rows;
    this.type  = type;   // 'intestine' | 'liver' | 'lymph'
    this.cells = [];
    this._init();
  }

  _init() {
    for (let r = 0; r < this.rows; r++) {
      this.cells[r] = [];
      for (let c = 0; c < this.cols; c++) {
        this.cells[r][c] = this._emptyCell();
      }
    }
  }

  _emptyCell() {
    return {
      state:          'healthy',
      established:    false,
      turnsPresent:   0,        // how long this cell has been cancerous
      protectedTurns: 0,        // turns of cytokine protection remaining
      barrierTurns:   0,        // turns of mAb barrier remaining
      damagedTurns:   0,        // turns of radiotherapy damage remaining
      clearingTurns:  0,        // turns in 'cleared' state before returning healthy
      resistantTo:    [],       // card ids this cell is resistant to
    };
  }

  // ── Cell accessors ────────────────────────────────────────────
  getCell(col, row) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    return this.cells[row][col];
  }

  isCancerous(col, row) {
    const c = this.getCell(col, row);
    return c && c.state === 'cancerous';
  }

  isBlocked(col, row) {
    // A cell is blocked from cancer spread if protected or has barrier
    const c = this.getCell(col, row);
    if (!c) return true;
    return c.state === 'protected' || c.barrierTurns > 0;
  }

  // ── Seed tumour ───────────────────────────────────────────────
  seedTumour(col, row) {
    const cell = this.getCell(col, row);
    if (!cell) return;
    cell.state        = 'cancerous';
    cell.turnsPresent = 1;
  }

  // ── Cancer spread (called each Phase 1) ──────────────────────
  spreadCancer(establishedThreshold) {
    // Collect all currently cancerous cells BEFORE spreading
    const sources = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].state === 'cancerous') {
          sources.push({ col: c, row: r });
        }
      }
    }

    const newlyInfected = [];

    sources.forEach(({ col, row }) => {
      const cell = this.cells[row][col];

      // Tick age counter
      cell.turnsPresent++;

      // Promote to established if threshold reached
      if (!cell.established && cell.turnsPresent >= establishedThreshold) {
        cell.established = true;
      }

      // Spread every turn if established, every 2 turns otherwise
      const shouldSpread = cell.established
        ? true
        : cell.turnsPresent % CONFIG.SPREAD.TIMER_NORMAL === 0;

      if (!shouldSpread) return;

      // Weighted neighbour selection
      const target = this._pickSpreadTarget(col, row);
      if (target) {
        const t = this.cells[target.row][target.col];
        if (t.state === 'healthy' && t.protectedTurns === 0 && t.barrierTurns === 0) {
          t.state        = 'cancerous';
          t.turnsPresent = 1;
          newlyInfected.push({ col: target.col, row: target.row });
        }
      }
    });

    return newlyInfected;
  }

  _pickSpreadTarget(col, row) {
    // Candidates: down, left, right (weighted)
    const candidates = [];

    if (row + 1 < this.rows) candidates.push({ col, row: row + 1, weight: CONFIG.SPREAD.WEIGHT_DOWN });
    if (col - 1 >= 0)        candidates.push({ col: col - 1, row, weight: CONFIG.SPREAD.WEIGHT_SIDE });
    if (col + 1 < this.cols) candidates.push({ col: col + 1, row, weight: CONFIG.SPREAD.WEIGHT_SIDE });

    // Filter out already-cancerous and blocked cells
    const valid = candidates.filter(t => {
      const c = this.cells[t.row][t.col];
      return c.state === 'healthy' && c.protectedTurns === 0 && c.barrierTurns === 0;
    });

    if (valid.length === 0) return null;

    // Weighted random pick
    const total = valid.reduce((s, t) => s + t.weight, 0);
    let roll = Math.random() * total;
    for (const t of valid) {
      roll -= t.weight;
      if (roll <= 0) return t;
    }
    return valid[valid.length - 1];
  }

  // ── Tick timers (end of turn) ─────────────────────────────────
  tickTimers() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];

        if (cell.protectedTurns > 0) {
          cell.protectedTurns--;
          if (cell.protectedTurns === 0 && cell.state === 'protected') {
            cell.state = 'healthy';
          }
        }
        if (cell.barrierTurns > 0)  cell.barrierTurns--;
        if (cell.damagedTurns > 0)  cell.damagedTurns--;
        if (cell.clearingTurns > 0) {
          cell.clearingTurns--;
          if (cell.clearingTurns === 0) cell.state = 'healthy';
        }
      }
    }
  }

  // ── Mutation: resistance ──────────────────────────────────────
  applyResistanceMutation() {
    // Pick a random immune card type and apply resistance to all cancerous cells
    const immuneCards = ['cytotoxic_t', 'nk_cell', 'macrophage', 'neutrophil'];
    const target = immuneCards[Math.floor(Math.random() * immuneCards.length)];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.state === 'cancerous' && !cell.resistantTo.includes(target)) {
          cell.resistantTo.push(target);
        }
      }
    }
    return target;
  }

  // ── Card effects ──────────────────────────────────────────────

  clearCell(col, row, { ignoreEvasion = false, resistanceCheck = null } = {}) {
    const cell = this.getCell(col, row);
    if (!cell || cell.state !== 'cancerous') return false;
    if (resistanceCheck && cell.resistantTo.includes(resistanceCheck)) return false;
    cell.state         = 'cleared';
    cell.established   = false;
    cell.turnsPresent  = 0;
    cell.clearingTurns = 2;
    cell.resistantTo   = [];
    return true;
  }

  clearCancerousInRow(row, { ignoreEvasion = false } = {}) {
    let count = 0;
    for (let c = 0; c < this.cols; c++) {
      if (this.clearCell(c, row, { ignoreEvasion })) count++;
    }
    return count;
  }

  clearCancerousInCol(col) {
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      if (this.clearCell(col, r)) count++;
    }
    return count;
  }

  clearArea(centreCol, centreRow, w, h) {
    let count = 0;
    const halfW = Math.floor(w / 2);
    const halfH = Math.floor(h / 2);
    for (let r = centreRow - halfH; r <= centreRow + halfH; r++) {
      for (let c = centreCol - halfW; c <= centreCol + halfW; c++) {
        if (this.clearCell(c, r)) count++;
      }
    }
    return count;
  }

  clearAllCancerous({ exceptRow = -1 } = {}) {
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      if (r === exceptRow) continue;
      for (let c = 0; c < this.cols; c++) {
        if (this.clearCell(c, r)) count++;
      }
    }
    return count;
  }

  protectCell(col, row, turns = 3) {
    const cell = this.getCell(col, row);
    if (!cell || cell.state === 'cancerous') return false;
    cell.state          = 'protected';
    cell.protectedTurns = Math.max(cell.protectedTurns, turns);
    return true;
  }

  protectRow(row, count, startCol = 0) {
    let protected_ = 0;
    for (let c = startCol; c < Math.min(startCol + count, this.cols); c++) {
      if (this.protectCell(c, row)) protected_++;
    }
    return protected_;
  }

  barrierRow(row, turns = 3) {
    let count = 0;
    for (let c = 0; c < this.cols; c++) {
      const cell = this.cells[row][c];
      if (cell.state !== 'cancerous') {
        cell.barrierTurns = Math.max(cell.barrierTurns, turns);
        count++;
      }
    }
    return count;
  }

  damageHealthyInCol(col, turns) {
    for (let r = 0; r < this.rows; r++) {
      const cell = this.cells[r][col];
      if (cell.state === 'healthy' || cell.state === 'protected') {
        cell.state        = 'damaged';
        cell.damagedTurns = turns;
      }
    }
  }

  resetEstablished() {
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.state === 'cancerous' && cell.established) {
          cell.established = false;
          count++;
        }
      }
    }
    return count;
  }

  // ── Queries ───────────────────────────────────────────────────

  cancerousCount() {
    let n = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.cells[r][c].state === 'cancerous') n++;
    return n;
  }

  hasReachedRow(row) {
    // row is 1-indexed from GDD; convert to 0-indexed
    const r = row - 1;
    for (let c = 0; c < this.cols; c++) {
      if (this.cells[r] && this.cells[r][c].state === 'cancerous') return true;
    }
    return false;
  }

  bottomRowInfected() {
    return this.hasReachedRow(this.rows);
  }

  isCleared() {
    return this.cancerousCount() === 0;
  }

  getCellsInRow(row) {
    return this.cells[row] || [];
  }

  // Serialise for rendering
  toRenderData() {
    return this.cells.map((row, ri) =>
      row.map((cell, ci) => ({ ...cell, col: ci, row: ri }))
    );
  }
}
