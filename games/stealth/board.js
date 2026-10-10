// ═══════════════════════════════════════════════════════════════════
//  IMMUNE QUEST — Stealth Mission
//  board.js — cell state for ONE tissue board (5 × 10), plus every
//  operation that reads or changes it. The immune system's shared
//  deck/hand lives at game level (game.js), not per board.
//
//  Cell states
//    'healthy'  — normal tissue, can be infected
//    'infected' — virus present
//    'dormant'  — Latency token: invisible to the immune system, becomes
//                 infected when its timer runs out
//    'immune'   — shielded, blocks infection. Permanent if placed by an
//                 Antibody (protectedTurns 0); counts down if placed by a
//                 Cytokine (protectedTurns > 0, cytokineColor set)
//  Every immune clear (T-Cell, NK Cell) returns a cell straight to
//  'healthy' — there's no resistant/cooldown state.
//
//  Contents
//    1. Setup & cell access
//    2. Starting infection
//    3. Virus spread (phase 1)
//    4. Immune targeting — T-Cell, NK Cell, Antibody
//    5. Immune targeting — Cytokine placement
//    6. Per-turn timers
//    7. Player card effects
//    8. Queries
// ═══════════════════════════════════════════════════════════════════

// Shared across all boards: each Cytokine play (placeShape() call) takes
// the next id, so Cytokine Neutralisation can remove exactly that block.
let _nextCytokinePlacementId = 1;

class StealthBoard {

  // ── 1. Setup & cell access ──────────────────────────────────────
  constructor(tissue, loadout) {
    this.tissue = tissue;   // 'lung' | 'liver' | 'intestine'
    this.cols   = STEALTH_CONFIG.BOARD.COLS;
    this.rows   = STEALTH_CONFIG.BOARD.ROWS;
    this.cells  = [];
    this._init();

    // Set by seedInfection(); makes this board's next spread phase a
    // no-op, so a fresh seed shows as-is for a turn before it grows.
    this.justSeeded = false;
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
      state:         'healthy',
      turnsInfected: 0,
      dormantTurns:  0,
      escapeImmune:  0,   // turns of Antibody Escape immunity left
      protectedTurns: 0,  // turns of Cytokine shield left (0 = permanent if 'immune')
      cytokineColor: null, // 'blue'|'orange'|'red' if shielded by a Cytokine; null for Antibody / unshielded
      cytokinePlacementId: null, // which Cytokine play shielded this cell (see neutralizeCytokine())
    };
  }

  getCell(col, row) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    return this.cells[row][col];
  }

  // ── 2. Starting infection ───────────────────────────────────────
  // A small random blob in a 3 × 2 block at the top, centred on `col`:
  //     [ tl][ TOP ][ tr]   row 0 — TOP is always infected
  //     [ bl][ mid ][ br]   row 1
  // Every other cell is a SEED_CELL_CHANCE coin flip, except bl/br may
  // only roll if they'd touch the blob edge-to-edge (via mid, or the cell
  // above them) — so the blob is never diagonally disconnected.
  // Cells already shielded (pre-fortified) just stay as they are.
  seedInfection(col = Math.floor(this.cols / 2)) {
    const top = this.getCell(col, 0);
    if (!top || top.state !== 'healthy') return false; // entry already blocked
    const infect = cell => { if (cell && cell.state === 'healthy') { cell.state = 'infected'; cell.turnsInfected = 1; return true; } return false; };
    const roll = () => Math.random() < STEALTH_CONFIG.BOARD.SEED_CELL_CHANCE;

    infect(top);
    const tlInfected  = roll() && infect(this.getCell(col - 1, 0));
    const trInfected  = roll() && infect(this.getCell(col + 1, 0));
    const midInfected = roll() && infect(this.getCell(col, 1));
    if ((midInfected || tlInfected) && roll()) infect(this.getCell(col - 1, 1));
    if ((midInfected || trInfected) && roll()) infect(this.getCell(col + 1, 1));

    this.justSeeded = true;
    return true;
  }

  // ── 3. Virus spread (phase 1, automatic) ────────────────────────
  // Each infected cell gets 1–3 spread attempts (by replication speed).
  // Newly infected cells join the same queue and can cascade further this
  // phase, with each hop's chance reduced by CASCADE_DECAY (see
  // _rollSpreadTargets()) and capped at CASCADE_MAX_DEPTH. `penalized`
  // (Antiviral / Protein Vaccine active) lowers the spread chances.
  // Returns { cells: newly infected, awoken: dormant cells that woke }.
  spreadVirus(replicationSpeed, penalized = false) {
    const attemptsPerSource = replicationSpeed >= 7 ? 3 : replicationSpeed >= 4 ? 2 : 1;

    const newlyInfected = [];
    // A freshly seeded board doesn't spread on its first phase at all.
    const maxDepth = this.justSeeded ? 0 : STEALTH_CONFIG.SPREAD.CASCADE_MAX_DEPTH;
    this.justSeeded = false;

    // Wake dormant cells whose timer ran out. They become ordinary
    // infected cells and spread with normal odds below (no guaranteed
    // infection). `awoken` is reported separately for the UI's narration.
    const awoken = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.state === 'dormant') {
          cell.dormantTurns--;
          if (cell.dormantTurns <= 0) {
            cell.state = 'infected';
            cell.turnsInfected = 0; // bumped to 1 in the queue loop below
            newlyInfected.push({ col: c, row: r });
            awoken.push({ col: c, row: r });
          }
        }
      }
    }

    // Queue starts with every cell infected before this phase (depth 0).
    const queue = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].state === 'infected') {
          this.cells[r][c].turnsInfected++;
          queue.push({ col: c, row: r, depth: 0 });
        }
      }
    }

    for (let i = 0; i < queue.length; i++) {
      const { col, row, depth } = queue[i];
      if (depth >= maxDepth) continue;
      for (let a = 0; a < attemptsPerSource; a++) {
        const targets = this._rollSpreadTargets(col, row, penalized, depth);
        targets.forEach(target => {
          const t = this.cells[target.row][target.col];
          if (this._infect(t)) {
            newlyInfected.push({ col: target.col, row: target.row });
            queue.push({ col: target.col, row: target.row, depth: depth + 1 });
          }
        });
      }
    }

    return { cells: newlyInfected, awoken };
  }

  _infect(cell) {
    if (cell.state !== 'healthy') return false;
    cell.state         = 'infected';
    cell.turnsInfected  = 1;
    return true;
  }

  // Healthy cells this cell could spread into (below, left, right) — a
  // possibility check with no randomness.
  _spreadCandidates(col, row) {
    const candidates = [];
    if (row + 1 < this.rows) candidates.push({ col, row: row + 1 });
    if (col - 1 >= 0)        candidates.push({ col: col - 1, row });
    if (col + 1 < this.cols) candidates.push({ col: col + 1, row });
    return candidates.filter(t => this.cells[t.row][t.col].state === 'healthy');
  }

  // One spread attempt: each side and below are rolled independently, so
  // it can return 0–3 targets. Chances drop with `penalized` and with
  // cascade `depth`.
  _rollSpreadTargets(col, row, penalized = false, depth = 0) {
    const bonus = penalized ? -STEALTH_CONFIG.SPREAD.BOOST_CHANCE_BONUS : 0;
    const decay = Math.pow(STEALTH_CONFIG.SPREAD.CASCADE_DECAY, depth);
    const sideChance = Math.min(1, Math.max(0, STEALTH_CONFIG.SPREAD.WEIGHT_SIDE + bonus)) * decay;
    const downChance = Math.min(1, Math.max(0, STEALTH_CONFIG.SPREAD.WEIGHT_DOWN + bonus)) * decay;
    const targets = [];

    [[col - 1, row], [col + 1, row]].forEach(([c, r]) => {
      const cell = this.getCell(c, r);
      if (cell && cell.state === 'healthy' && Math.random() < sideChance) {
        targets.push({ col: c, row: r });
      }
    });

    const below = this.getCell(col, row + 1);
    if (below && below.state === 'healthy' && Math.random() < downChance) {
      targets.push({ col, row: row + 1 });
    }

    return targets;
  }

  // ── 4. Immune targeting — T-Cell, NK Cell, Antibody ─────────────

  // T-Cell: the deepest row with a clearable infected cell (the front
  // line closest to the bottom), or null.
  _pickTCellRow() {
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.cells[r].some(c => c.state === 'infected' && c.escapeImmune <= 0)) return r;
    }
    return null;
  }

  // How many cells clearRow(row) would remove, without changing anything —
  // lets game.js check whether a T-Cell would wipe out the last infection.
  _infectedCountInRow(row) {
    return this.cells[row].filter(c => c.state === 'infected' && c.escapeImmune <= 0).length;
  }

  // NK Cell: a random clearable infected cell in the deepest such row.
  _pickDeepestInfectedCell() {
    let deepestRow = -1;
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.cells[r].some(c => c.state === 'infected' && c.escapeImmune <= 0)) { deepestRow = r; break; }
    }
    if (deepestRow === -1) return null;
    const candidates = [];
    this.cells[deepestRow].forEach((cell, c) => {
      if (cell.state === 'infected' && cell.escapeImmune <= 0) candidates.push({ col: c, row: deepestRow });
    });
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // T-Cell effect: clears every infected (non-escaped) cell in the row
  // straight back to healthy. Returns the cleared cells for the UI.
  clearRow(row) {
    const cleared = [];
    for (let c = 0; c < this.cols; c++) {
      const cell = this.cells[row][c];
      if (cell.state === 'infected' && cell.escapeImmune <= 0) {
        cell.state = 'healthy'; cell.turnsInfected = 0;
        cleared.push({ col: c, row });
      }
    }
    return cleared;
  }

  // Antibody shields a whole row permanently, but only a row with no
  // virus in it. It only ever targets a meaningful row; otherwise it
  // returns null and the card stays in hand (useful after Antibody Escape
  // strips a tissue's antibodies).
  //   Tissue not reached yet: row 0 (where a mutation would seed it),
  //     then the row an adjacent tissue's infection has reached (where a
  //     spillover would land — adjacentThreatRow, from cards.js).
  //   Active tissue: the row just below the infection front, then that
  //     same spillover row if it's still open.
  _pickAntibodyRow(adjacentThreatRow = -1) {
    const isCandidate = r => r >= 0 && r < this.rows
      && this.cells[r].every(c => c.state !== 'infected' && c.state !== 'dormant')
      && this.cells[r].some(c => c.state === 'healthy');

    const deepest = this._deepestInfectedRow();
    if (deepest === -1) {
      if (isCandidate(0)) return 0;
      if (adjacentThreatRow >= 0 && isCandidate(adjacentThreatRow)) return adjacentThreatRow;
      return null;
    }
    const preferred = deepest + 1;
    if (isCandidate(preferred)) return preferred;
    if (adjacentThreatRow >= 0 && isCandidate(adjacentThreatRow)) return adjacentThreatRow;
    return null;
  }

  // Shields every healthy cell in the row (turns 0 = permanent).
  protectRow(row, turns) {
    const protectedCells = [];
    for (let c = 0; c < this.cols; c++) {
      const cell = this.cells[row][c];
      if (cell.state === 'healthy') {
        cell.state = 'immune';
        cell.protectedTurns = turns;
        protectedCells.push({ col: c, row });
      }
    }
    return protectedCells;
  }

  // ── 5. Immune targeting — Cytokine placement ────────────────────
  //
  // The "frontier" is every healthy cell the virus could spread into on
  // its very next spread phase: directly below or beside an infected cell
  // (same rule as _spreadCandidates()). Dormant cells are invisible to the
  // immune system, so they don't create frontier.
  _frontierCells() {
    const byKey = new Map();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].state !== 'infected') continue;
        this._spreadCandidates(c, r).forEach(t => byKey.set(`${t.col},${t.row}`, t));
      }
    }
    return [...byKey.values()];
  }

  // Best anchor for a Cytokine `offsets` shape on this board, or null if
  // there's no frontier to block. Every anchor where the whole shape fits
  // on the board is scored by what it would shield:
  //   - each frontier cell: 10 points, up to 1.5× for deeper rows (closer
  //     to the bottom row — the virus's win line)
  //   - each healthy cell one step beyond the frontier: 1 point, so spare
  //     shape cells sit just ahead of the front instead of in open ground
  // Highest score wins; ties are broken randomly. Combined with playing the
  // biggest shape first (_immunePlayPriority(), game.js), large shapes
  // take the widest openings and a single-cell Blue fills the last gap.
  _bestCytokineAnchor(offsets) {
    const frontier = this._frontierCells();
    if (!frontier.length) return null;

    const weights = new Map();
    frontier.forEach(f => weights.set(`${f.col},${f.row}`, 10 * (1 + 0.5 * f.row / (this.rows - 1))));
    frontier.forEach(f => {
      this._spreadCandidates(f.col, f.row).forEach(t => {
        const key = `${t.col},${t.row}`;
        if (!weights.has(key)) weights.set(key, 1);
      });
    });

    const dxs = offsets.map(([dx]) => dx), dys = offsets.map(([, dy]) => dy);
    let best = [], bestScore = 0;
    for (let row = -Math.min(...dys); row < this.rows - Math.max(...dys); row++) {
      for (let col = -Math.min(...dxs); col < this.cols - Math.max(...dxs); col++) {
        const score = offsets.reduce((sum, [dx, dy]) => {
          const cell = this.getCell(col + dx, row + dy);
          return sum + (cell && cell.state === 'healthy' ? (weights.get(`${col + dx},${row + dy}`) || 0) : 0);
        }, 0);
        if (score > bestScore + 1e-9) { bestScore = score; best = [{ col, row }]; }
        else if (Math.abs(score - bestScore) < 1e-9 && score > 0) best.push({ col, row });
      }
    }
    return best.length ? best[Math.floor(Math.random() * best.length)] : null;
  }

  // Shields every healthy cell of `offsets` around (anchorCol, anchorRow)
  // for `turns` turns (0 = permanent). `color` ('blue'/'orange'/'red') tags
  // which Cytokine placed it, and all cells from this one call share a
  // fresh placement id, so Cytokine Neutralisation can later strip just
  // this block. Off-board or non-healthy shape cells are skipped.
  placeShape(anchorCol, anchorRow, offsets, turns, color = null) {
    const protectedCells = [];
    const placementId = color ? _nextCytokinePlacementId++ : null;
    offsets.forEach(([dx, dy]) => {
      const cell = this.getCell(anchorCol + dx, anchorRow + dy);
      if (cell && cell.state === 'healthy') {
        cell.state = 'immune';
        cell.protectedTurns = turns;
        cell.cytokineColor = color;
        cell.cytokinePlacementId = placementId;
        protectedCells.push({ col: anchorCol + dx, row: anchorRow + dy });
      }
    });
    return protectedCells;
  }

  // Pre-fortification (no infection on this board yet): places the shape
  // so it covers (targetCol, targetRow) — the cell where the virus would
  // enter — choosing, among the anchors that keep that cell covered and
  // fit on the board, the one shielding the most healthy cells.
  protectShapeCovering(targetCol, targetRow, offsets, turns, color = null) {
    const dxs = offsets.map(([dx]) => dx), dys = offsets.map(([, dy]) => dy);
    const clamp = (c, r) => [
      Math.min(Math.max(c, -Math.min(...dxs)), this.cols - 1 - Math.max(...dxs)),
      Math.min(Math.max(r, -Math.min(...dys)), this.rows - 1 - Math.max(...dys)),
    ];
    let bestAnchor = [targetCol, targetRow], bestScore = -1;
    offsets.forEach(([dx, dy]) => {
      const [c, r] = clamp(targetCol - dx, targetRow - dy);
      if (!offsets.some(([odx, ody]) => c + odx === targetCol && r + ody === targetRow)) return;
      const score = offsets.filter(([odx, ody]) => this.getCell(c + odx, r + ody)?.state === 'healthy').length;
      if (score > bestScore) { bestScore = score; bestAnchor = [c, r]; }
    });
    return this.placeShape(bestAnchor[0], bestAnchor[1], offsets, turns, color);
  }

  // Cytokine Neutralisation (virus card): removes exactly one Cytokine
  // block — the cells sharing this colour and placement id. Other blocks
  // and Antibody shields are untouched.
  neutralizeCytokine(color, placementId) {
    const cleared = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.state === 'immune' && cell.cytokineColor === color && cell.cytokinePlacementId === placementId) {
          cell.state = 'healthy';
          cell.protectedTurns = 0;
          cell.cytokineColor = null;
          cell.cytokinePlacementId = null;
          cleared.push({ col: c, row: r });
        }
      }
    }
    return cleared;
  }

  hasDormant() {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.cells[r][c].state === 'dormant') return true;
    return false;
  }

  // Where the virus would enter a tissue it hasn't reached yet — used to
  // pre-fortify it with a Cytokine. If an adjacent tissue is infected,
  // that's the row its infection has reached, in the edge column facing
  // it (exactly where a spillover would land — see _spilloverCandidates(),
  // game.js); otherwise row 0, middle column (a mutation-seeded start).
  // null if this board already has infection, or that cell isn't healthy.
  _pickEntryCell(adjacentThreatRow = -1, adjacentThreatCol = null) {
    if (this._deepestInfectedRow() !== -1) return null;
    const row = adjacentThreatRow >= 0 ? adjacentThreatRow : 0;
    const col = adjacentThreatRow >= 0 && adjacentThreatCol !== null ? adjacentThreatCol : Math.floor(this.cols / 2);
    return this.getCell(col, row)?.state === 'healthy' ? { col, row } : null;
  }

  // Deepest row containing an infected or dormant cell; -1 if the virus
  // hasn't reached this tissue.
  _deepestInfectedRow() {
    for (let r = this.rows - 1; r >= 0; r--) {
      for (let c = 0; c < this.cols; c++) {
        const s = this.cells[r][c].state;
        if (s === 'infected' || s === 'dormant') return r;
      }
    }
    return -1;
  }

  // ── 6. Per-turn timers ──────────────────────────────────────────
  // Counts down Antibody Escape immunity and Cytokine shields; an expired
  // Cytokine shield reverts to healthy. Antibody shields (protectedTurns
  // 0) are permanent.
  tickTimers() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.escapeImmune > 0) cell.escapeImmune--;
        if (cell.protectedTurns > 0) {
          cell.protectedTurns--;
          if (cell.protectedTurns === 0 && cell.state === 'immune') { cell.state = 'healthy'; cell.cytokineColor = null; cell.cytokinePlacementId = null; }
        }
      }
    }
  }

  // ── 7. Player card effects ──────────────────────────────────────

  // Horizontal Spread: healthy cells directly beside an infected cell.
  // The card picks one at random (cards.js) — the player only picks the tissue.
  horizontalSpreadCandidates() {
    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.state !== 'healthy') continue;
        const left  = this.getCell(c - 1, r);
        const right = this.getCell(c + 1, r);
        if ((left && left.state === 'infected') || (right && right.state === 'infected')) candidates.push({ col: c, row: r });
      }
    }
    return candidates;
  }

  // Vertical Spread: healthy cells directly below an infected cell.
  verticalSpreadCandidates() {
    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.state !== 'healthy') continue;
        const above = this.getCell(c, r - 1);
        if (above && above.state === 'infected') candidates.push({ col: c, row: r });
      }
    }
    return candidates;
  }

  // Deepest row with an actually infected cell (dormant doesn't count), so
  // one Latency token can't extend the range for the next.
  _deepestActuallyInfectedRow() {
    for (let r = this.rows - 1; r >= 0; r--) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].state === 'infected') return r;
      }
    }
    return -1;
  }

  // Latency: places a dormant token on a healthy cell at most two rows
  // below the infection front.
  placeDormant(col, row, turns = 2) {
    const cell = this.getCell(col, row);
    if (!cell || cell.state !== 'healthy') return false;
    const maxRow = this._deepestActuallyInfectedRow() + 2; // -1+2=1 if nothing infected yet
    if (row > maxRow) return false;
    cell.state        = 'dormant';
    cell.dormantTurns = turns;
    return true;
  }

  // latency_loss mutation: one dormant cell (if any) back to healthy.
  clearDormant() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].state === 'dormant') {
          this.cells[r][c].state = 'healthy';
          this.cells[r][c].dormantTurns = 0;
          return true;
        }
      }
    }
    return false;
  }

  // Antibody Escape: every infected cell here can't be cleared for N turns.
  grantEscapeImmunity(turns) {
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.state === 'infected') {
          cell.escapeImmune = Math.max(cell.escapeImmune, turns);
          count++;
        }
      }
    }
    return count;
  }

  // Antibody Escape also removes every existing Antibody shield in this
  // tissue (Cytokine shields stay). Returns the cleared cells for the UI.
  clearAntibodyProtection() {
    const cleared = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.state === 'immune' && !cell.cytokineColor) {
          cell.state = 'healthy';
          cell.protectedTurns = 0;
          cleared.push({ col: c, row: r });
        }
      }
    }
    return cleared;
  }

  // escape_loss mutation: removes all Antibody Escape immunity at once.
  clearEscapeImmunity() {
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.escapeImmune > 0) { cell.escapeImmune = 0; count++; }
      }
    }
    return count;
  }

  // ── 8. Queries ──────────────────────────────────────────────────
  infectedCount() {
    let n = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.cells[r][c].state === 'infected' || this.cells[r][c].state === 'dormant') n++;
    return n;
  }

  hasNoInfection() {
    return this.infectedCount() === 0;
  }

  // False when the virus is fully boxed in on this board: no infected or
  // dormant cell has a healthy cell beside or below it. (A dormant cell
  // counts — it will wake up and spread normally.)
  hasSpreadTarget() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const state = this.cells[r][c].state;
        if ((state === 'infected' || state === 'dormant') && this._spreadCandidates(c, r).length) return true;
      }
    }
    return false;
  }

  hasReachedBottomRow() {
    const r = this.rows - 1;
    for (let c = 0; c < this.cols; c++) {
      if (this.cells[r][c].state === 'infected') return true;
    }
    return false;
  }

  // Plain copy of every cell (with its col/row) for rendering.
  toRenderData() {
    return this.cells.map((row, ri) =>
      row.map((cell, ci) => ({ ...cell, col: ci, row: ri }))
    );
  }
}
