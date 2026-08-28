// ═══════════════════════════════════════════════════════════════════
//  board.js — Cell state management for one tissue board.
//  Mirrors games/cancer/board.js structure, with the virus spreading
//  top-down and the immune system placing individual antibody/cytokine
//  cells strategically each turn — not a blind row-by-row sweep. See
//  _runImmuneResponse() (game.js) for the immune card system — one shared
//  deck/hand for the whole immune system, not a separate one per board.
//
//  Cell states:
//    'healthy'   — normal tissue cell, infectable
//    'infected'  — virus present
//    'dormant'   — latency token: invisible to immune response, wakes and
//                  infects neighbours on a future turn
//    'immune'    — protected, blocks infection (unless escaped). Permanent
//                  if placed by Antibody (protectedTurns stays 0); temporary
//                  if placed by a Cytokine (protectedTurns counts down and
//                  reverts the cell to healthy — see tickTimers()).
//
//  Every immune-response clear (T-Cell, NK Cell, DNA/RNA Sensing) puts a
//  cell straight back to plain 'healthy' — no separate resistant-to-
//  reinfection state or cooldown in between.
//
//  Each cell object:
//    { state, turnsInfected, dormantTurns, escapeImmune, protectedTurns }
// ═══════════════════════════════════════════════════════════════════

// One shared counter across every board — each protectShape() call (one
// Cytokine play) claims the next id, so cytokinePlacementId is unique
// even across separate tissues, not just within one board. See
// protectShape()/neutralizeCytokine() below.
let _nextCytokinePlacementId = 1;

class StealthBoard {
  constructor(tissue, loadout) {
    this.tissue = tissue;   // 'lung' | 'liver' | 'intestine'
    this.cols   = STEALTH_CONFIG.BOARD.COLS;
    this.rows   = STEALTH_CONFIG.BOARD.ROWS;
    this.cells  = [];
    this._init();
    // No per-board immune deck/hand any more — the immune system has ONE
    // shared deck/hand for the whole game now (StealthGame.immuneDeck /
    // immuneHand), not one per tissue. See _runImmuneResponse() (game.js).

    // Set by seedInfection(), cleared after this board's very next
    // spreadVirus() call — suppresses cascading (see spreadVirus()) for
    // that one growth phase, so a tissue's opening seed (game start, or a
    // tropism_gain mutation) grows by one normal, non-cascading spread
    // step before cascading kicks in on later turns, instead of the fresh
    // seed immediately blowing up into a much bigger blob than intended
    // before the player's even taken an action.
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
      escapeImmune:  0,   // turns of antibody-escape immunity remaining
      protectedTurns: 0,  // turns of Cytokine protection remaining (0 = permanent if 'immune')
      cytokineColor: null, // 'blue'|'orange'|'red' if protected by a Cytokine — null for Antibody (permanent) or unprotected
      // Which single protectShape() call placed this cell's shield — lets
      // Cytokine Neutralisation strip only the one targeted block instead
      // of every same-coloured cell anywhere on the board (see
      // neutralizeCytokine()). null whenever cytokineColor is null.
      cytokinePlacementId: null,
    };
  }

  getCell(col, row) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    return this.cells[row][col];
  }

  // ── Seed initial infection: a random blob within a fixed 3-column x
  //     2-row block at the centre top ──────────────────────────────
  // Layout (centreCol = c, block spans c-1..c+1, rows 0-1):
  //     [ tl][ TOP ][ tr]   row 0 — TOP (centre) is guaranteed infected;
  //     [ bl][ mid ][ br]   row 1 — every other cell is a coin flip.
  // Same blocking rule as spillover into an already-fortified entry cell
  // (see game.js _runSpillover) — now that a tissue can be pre-fortified
  // with Antibody/Cytokine before the virus ever arrives (see the
  // StealthGame constructor), the very first seed has to respect that too:
  // a fortified cell just stays whatever it already was, same as any other
  // cell that loses its coin flip.
  //
  // bl/br (the row-1 corners) are NOT plain independent coin flips like
  // the other four — each is only ELIGIBLE to roll at all if it has a
  // direct (non-diagonal) connection back to the guaranteed TOP cell:
  // either mid (the row-1 centre, directly below TOP) is infected, or the
  // corner's own directly-above neighbour (tl for bl, tr for br) is
  // infected. Without this, a corner could end up infected while diagonally
  // isolated from the rest of the blob — connected to nothing by a shared
  // edge, only by a shared corner — which would read as the infection
  // having somehow jumped there instead of grown into it.
  seedInfection(col = Math.floor(this.cols / 2)) {
    const top = this.getCell(col, 0);
    if (!top || top.state !== 'healthy') return false; // blocked before it can even start
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

  // ── Phase 1: autonomous virus spread ───────────────────────────
  // `penalized` comes from the game-level Antiviral-or-Protein-Vaccine
  // timer — beyond just changing replicationSpeed's attempt count, it also
  // directly shifts the actual per-attempt spread CHANCE (see
  // _rollSpreadTargets()). Replication Boost has no equivalent chance
  // bonus of its own here — its own (temporary — see replicationBoostAmount,
  // game.js) bonus only raises replicationSpeed's attempt count, same as
  // before it became temporary.
  spreadVirus(replicationSpeed, penalized = false) {
    // Higher replication speed = more spread attempts per turn. Thresholds
    // lowered (was >=9/>=6) — Hepatitis in particular starts at speed 4 and
    // was stuck at 1 attempt/turn for most of a game, too slow to outrun
    // the immune system's row-clears before establishing itself.
    const attemptsPerSource = replicationSpeed >= 7 ? 3 : replicationSpeed >= 4 ? 2 : 1;

    const newlyInfected = [];
    // Worklist, not a fixed snapshot — starts as every cell already
    // infected before this phase, but a cell infected DURING this phase
    // (below) is pushed onto the very same queue, so it gets its own
    // attemptsPerSource-worth of rolls to spread further too, same turn.
    // Infection can now cascade across several cells in a single spread
    // phase instead of only ever moving one cell deep per source per turn
    // — depth (0 for the pre-existing snapshot, +1 each hop) decays the
    // chance via CASCADE_DECAY (see _rollSpreadTargets()) so that cascade
    // tapers out instead of flood-filling the whole board; CASCADE_MAX_
    // DEPTH below is just the hard backstop on top of that.
    // turnsInfected++ only happens for the pre-existing snapshot here —
    // cells infected via the cascade already got turnsInfected set to 1 by
    // _infect() itself and shouldn't be double-bumped to 2 on the same
    // turn they were infected.
    //
    // justSeeded (set by seedInfection(), consumed here) caps this one
    // call at maxDepth 0 — every cell in the queue starts at depth 0, so
    // `depth >= maxDepth` is true immediately and NOTHING rolls this call,
    // not even the freshly-seeded cells themselves (turnsInfected still
    // ticks up for them in the loop above, just no spread attempt). A
    // maxDepth of 1 (tried first) still let the seeded cells make one
    // normal, non-cascading roll — which was enough on its own to push a
    // row-1 seed cell down into row 2, showing 3 rows deep on turn 1
    // instead of the intended 2. Zero means the tissue's very first growth
    // phase (game start, or right after a tropism_gain mutation) is a
    // no-op for it — the board shows exactly the seed, nothing more —
    // before normal growth (and cascading) begins on the NEXT phase.
    const maxDepth = this.justSeeded ? 0 : STEALTH_CONFIG.SPREAD.CASCADE_MAX_DEPTH;
    this.justSeeded = false;

    // Wake any dormant cells whose timer has elapsed BEFORE building this
    // phase's spread queue below — a balance-pass change (guaranteed
    // auto-infect was too strong) means a woken cell no longer
    // force-infects a neighbour on waking. Instead
    // it just becomes a normal infected cell going into the SAME queue as
    // every pre-existing one, with its own attemptsPerSource rolls through
    // the ordinary _rollSpreadTargets() chance below — same pattern, same
    // odds as any other cell, not a guaranteed "explosion". awoken is
    // still tracked separately, purely for the UI's own "Latent cell(s)
    // became active" narration line (buildVirusGrowthSteps(), game-ui.js)
    // and its transparent-then-bright reveal (primeVirusGrowthRevealMask()).
    const awoken = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.state === 'dormant') {
          cell.dormantTurns--;
          if (cell.dormantTurns <= 0) {
            cell.state = 'infected';
            // Left at 0, not 1 — the snapshot loop below bumps every
            // 'infected' cell's turnsInfected by 1 as it builds this
            // phase's queue, this one included, same as a pre-existing
            // cell would be. Setting it here too would double-count.
            cell.turnsInfected = 0;
            newlyInfected.push({ col: c, row: r });
            awoken.push({ col: c, row: r });
          }
        }
      }
    }

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
      if (depth >= maxDepth) continue; // hard backstop — this cell doesn't cascade further
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

  // Every healthy cell this infected cell could possibly spread into right
  // now (sideways or down) — a pure possibility check, no randomness. Used
  // for the "can this cell spread at all" question (hasSpreadTarget(), the
  // boxed-in loss check, and the dormant wake-up's guaranteed pick), as
  // opposed to _rollSpreadTargets() below, which decides what actually
  // happens this turn.
  _spreadCandidates(col, row) {
    const candidates = [];
    if (row + 1 < this.rows) candidates.push({ col, row: row + 1 });
    if (col - 1 >= 0)        candidates.push({ col: col - 1, row });
    if (col + 1 < this.cols) candidates.push({ col: col + 1, row });
    return candidates.filter(t => this.cells[t.row][t.col].state === 'healthy');
  }

  // Horizontal spread is rolled first, then vertical — two independent
  // chances rather than a single either/or pick, so a cell blocked
  // straight down can still spread sideways in the very same attempt (and
  // vice versa). Can return 0, 1, or both targets. `penalized` (Antiviral /
  // Protein Vaccine) lowers both chances — Replication Boost no longer has
  // an equivalent bonus here (see spreadVirus() above). `depth` (0 for a
  // cell that was already infected before this phase, +1 each cascade hop
  // — see spreadVirus()) tapers both chances down via CASCADE_DECAY so a
  // single-phase cascade fades out instead of flood-filling the board.
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

  // Immune response resolution now lives at the game level, one shared
  // deck/hand for the whole immune system instead of one per tissue — see
  // _runImmuneResponse() (game.js).

  // T-Cell targets the DEEPEST row with a clearable infected cell — the
  // front line closest to the bottom row (the win condition), same "defend
  // the front" logic NK Cell's own _pickDeepestInfectedCell() and Antibody/
  // Cytokine's targeting already use, rather than whichever row happens to
  // have the most infected cells (which could be near the top, well behind
  // the actual front, if it just happened to fill up completely). Returns
  // null if no row has any (no minimum floor — any row with at least one
  // infected cell qualifies).
  _pickTCellRow() {
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.cells[r].some(c => c.state === 'infected' && c.escapeImmune <= 0)) return r;
    }
    return null;
  }

  // How many cells a T-Cell clear of this row would actually remove —
  // mirrors clearRow()'s own eligibility check exactly, but as a read-only
  // peek (no mutation) so _runImmuneResponse() (game.js) can tell in
  // advance whether playing T-Cell would wipe out the game's last
  // remaining infection, without having to apply-then-undo the card.
  _infectedCountInRow(row) {
    return this.cells[row].filter(c => c.state === 'infected' && c.escapeImmune <= 0).length;
  }

  // NK Cells' own target on this board — the single infected cell that's
  // advanced furthest toward the bottom row (the most urgent one to clear
  // right now), tie-broken randomly. No row-size floor like T-Cell has,
  // since NK Cells is deliberately a small, always-available single-cell
  // play rather than a big row-clearing swing.
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

  clearRow(row) {
    const cleared = [];
    for (let c = 0; c < this.cols; c++) {
      const cell = this.cells[row][c];
      if (cell.state === 'infected' && cell.escapeImmune <= 0) {
        // Straight back to a normal healthy cell — no transient 'cleared'
        // cooldown (that's still used by DNA/RNA Sensing, just not here):
        // T-Cell's "poof" animation (see .cell-tcell-poof, highlightCells()
        // in game-ui.js) is a separate transient CSS class layered on top
        // at render time, so it still plays regardless of the cell's real
        // state underneath — it just settles into the plain healthy look
        // once it's done, instead of the dimmed .state-cleared one, and the
        // cell can be infected again immediately rather than waiting out a
        // resistance window.
        cell.state = 'healthy'; cell.turnsInfected = 0;
        cleared.push({ col: c, row });
      }
    }
    return cleared;
  }

  // Antibody protects a whole row PERMANENTLY, but only a row with no
  // virus anywhere in it. Prefers the row immediately ahead of the
  // infection front (deepest infected row + 1) so it's actually in the
  // virus's path; falls back to the closest virus-free row to the front.
  //
  // adjacentThreatRow (caller-supplied — see _adjacentThreatRow(), cards.js)
  // is how deep an ADJACENT active tissue has already reached, used only
  // when THIS tissue has no infection of its own (deepest === -1). Guarding
  // row 0 (the entry point) there only blocks growth that starts right at
  // the top, but this tissue can also be reached via SPILLOVER from that
  // adjacent tissue (_runSpillover(), game.js), which lands in THIS
  // tissue's edge column at the SAME row number the source tissue's own
  // infection has reached — not row 0. Targeting that exact row directly
  // denies the spillover cell itself, rather than only reacting after the
  // fact. Falls back to row 0 when there's no adjacent threat to react to
  // either (a genuinely untouched, unthreatened tissue).
  _pickAntibodyRow(adjacentThreatRow = -1) {
    const isVirusFree = r => this.cells[r].every(c => c.state !== 'infected' && c.state !== 'dormant');
    const hasProtectableCell = r => this.cells[r].some(c => c.state === 'healthy');
    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      if (isVirusFree(r) && hasProtectableCell(r)) candidates.push(r);
    }
    if (candidates.length === 0) return null;

    const deepest = this._deepestInfectedRow();
    const preferred = deepest === -1
      ? (adjacentThreatRow >= 0 ? adjacentThreatRow : 0)
      : deepest + 1;
    if (candidates.includes(preferred)) return preferred;
    return candidates.reduce((best, r) => Math.abs(r - preferred) < Math.abs(best - preferred) ? r : best);
  }

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

  // Places temporary protection (blocks infection) on healthy cells within
  // `offsets` of a centre cell — used by the Cytokine cards. `color`
  // ('blue'/'orange'/'red') tags which cytokine placed it, and every cell
  // from this one call shares a fresh placement id (see
  // _nextCytokinePlacementId below), so Cytokine Neutralisation can later
  // strip just this one block instead of every same-coloured cell
  // anywhere on the board.
  //
  // The anchor is nudged inward first so the FULL shape lands on-board
  // whenever the board is large enough to fit it (always true here — even
  // the widest shape, Red's boosted 4x2 rectangle, comfortably fits a
  // 5-wide board) — the immune system should get its full blocked
  // frontage out of every Cytokine play, not lose cells off the edge just
  // because the strategic target (_pickStrategicAntibodyTarget()) happened
  // to land near one. Every shape here includes [0, 0] (the target cell
  // itself), and the nudge never moves further than the shape's own
  // bounding box requires, so the target stays covered either way — this
  // only recovers cells that would otherwise be wasted, never sacrifices
  // the actual entry point being guarded.
  protectShape(centerCol, centerRow, offsets, turns, color = null) {
    const dxs = offsets.map(([dx]) => dx);
    const dys = offsets.map(([, dy]) => dy);
    const minDx = Math.min(...dxs), maxDx = Math.max(...dxs);
    const minDy = Math.min(...dys), maxDy = Math.max(...dys);
    let col = centerCol, row = centerRow;
    if (col + minDx < 0) col = -minDx;
    if (col + maxDx > this.cols - 1) col = this.cols - 1 - maxDx;
    if (row + minDy < 0) row = -minDy;
    if (row + maxDy > this.rows - 1) row = this.rows - 1 - maxDy;

    const protectedCells = [];
    const placementId = color ? _nextCytokinePlacementId++ : null;
    offsets.forEach(([dx, dy]) => {
      const cell = this.getCell(col + dx, row + dy);
      if (cell && cell.state === 'healthy') {
        cell.state = 'immune';
        cell.protectedTurns = turns;
        cell.cytokineColor = color;
        cell.cytokinePlacementId = placementId;
        protectedCells.push({ col: col + dx, row: row + dy });
      }
    });
    return protectedCells;
  }

  // "Cytokine Neutralisation" (virus card) — strips protection from just
  // the ONE block a Cytokine of this colour placed (identified by
  // placementId, the targeted cell's own cytokinePlacementId — see
  // protectShape() above), leaving any OTHER same-coloured block placed by
  // a separate play untouched, and leaving Antibody's separate permanent
  // protection (cytokineColor stays null) untouched too.
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

  // Row by row, bottom (deepest, most urgent) up to top — at EACH row,
  // vertical is still checked before horizontal (blocking the actual move
  // toward the win condition beats blocking a sideways one), but both are
  // tried for THIS row before moving up to a shallower one:
  //   Priority 1: a healthy cell directly BELOW an infected cell in this
  //               row — blocks the specific move that would advance
  //               toward the win condition (the bottom row).
  //   Priority 2: no opening below at this row (already blocked — e.g. an
  //               Antibody row already sitting right under it — or off
  //               the bottom edge) — a healthy cell BESIDE an infected
  //               cell in this SAME row instead, sealing its flanks
  //               rather than leaving them open while this method moves
  //               on to guard a shallower, less-urgent row's own vertical
  //               path first. Was two entirely separate passes (every
  //               row's vertical option, THEN every row's horizontal
  //               option) — that let a wide-open flank on the deepest row
  //               sit unguarded for turns while a vertical opening on
  //               some row far from winning got defended first, just
  //               because vertical options anywhere outranked horizontal
  //               options everywhere.
  //   Priority 3: no infection anywhere on this board yet — guard whatever
  //               row an ADJACENT active tissue's own infection has
  //               already reached (adjacentThreatRow, caller-supplied —
  //               see _adjacentThreatRow(), cards.js), matching the exact
  //               row a spillover would actually land on, rather than
  //               row 0 (only relevant to a mutation-seeded start, a much
  //               rarer path in for a tissue nothing has reached yet).
  //               Falls back to row 0 when there's no adjacent threat to
  //               react to either.
  //
  // Among tied candidates at whichever priority wins, _pickSpreadOutCandidate()
  // below breaks the tie toward whichever one is farthest from EXISTING
  // protection instead of picking uniformly at random — a Cytokine's own
  // shape (protectShape(), cards.js) already clusters several cells around
  // wherever it lands, so with no bias away from existing coverage,
  // repeated plays landing near each other by pure chance wastes overlap
  // (protecting the same handful of cells twice) while a whole flank sits
  // completely open. The virus only loses once it has nowhere left to
  // spread at all, so maximising the WIDTH of blocked area matters more
  // than reinforcing a spot that's already covered.
  _pickStrategicAntibodyTarget(adjacentThreatRow = -1) {
    for (let r = this.rows - 1; r >= 0; r--) {
      if (!this.cells[r].some(c => c.state === 'infected')) continue;

      const below = [];
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].state !== 'infected') continue;
        const downCell = this.getCell(c, r + 1);
        if (downCell && downCell.state === 'healthy') below.push({ col: c, row: r + 1 });
      }
      if (below.length) return this._pickSpreadOutCandidate(below);

      const beside = [];
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].state !== 'infected') continue;
        [[c - 1, r], [c + 1, r]].forEach(([cc, rr]) => {
          const cell = this.getCell(cc, rr);
          if (cell && cell.state === 'healthy') beside.push({ col: cc, row: rr });
        });
      }
      if (beside.length) return this._pickSpreadOutCandidate(beside);
    }

    if (this._deepestInfectedRow() === -1) {
      const entryCol = Math.floor(this.cols / 2);
      const targetRow = adjacentThreatRow >= 0 ? adjacentThreatRow : 0;
      const target = this.getCell(entryCol, targetRow);
      if (target && target.state === 'healthy') return { col: entryCol, row: targetRow };
    }
    return null;
  }

  // Scores each candidate by its (Manhattan) distance to the NEAREST cell
  // already in state 'immune' anywhere on this board, and picks whichever
  // is FARTHEST from existing protection (ties broken randomly) — see
  // _pickStrategicAntibodyTarget()'s own comment above for why. A board
  // with no protection anywhere yet has nothing to spread away from, so
  // every candidate ties and this is equivalent to the old uniform-random
  // pick in that case.
  _pickSpreadOutCandidate(candidates) {
    if (candidates.length === 1) return candidates[0];
    let bestDist = -1;
    let best = [];
    candidates.forEach(cand => {
      let minDist = Infinity;
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (this.cells[r][c].state !== 'immune') continue;
          const dist = Math.abs(c - cand.col) + Math.abs(r - cand.row);
          if (dist < minDist) minDist = dist;
        }
      }
      if (minDist === Infinity) minDist = 0; // no existing protection anywhere — every candidate ties
      if (minDist > bestDist) { bestDist = minDist; best = [cand]; }
      else if (minDist === bestDist) best.push(cand);
    });
    return best[Math.floor(Math.random() * best.length)];
  }

  // Deepest (highest row index) cell currently infected or dormant, or
  // -1 if the virus hasn't reached this tissue at all (yet).
  _deepestInfectedRow() {
    for (let r = this.rows - 1; r >= 0; r--) {
      for (let c = 0; c < this.cols; c++) {
        const s = this.cells[r][c].state;
        if (s === 'infected' || s === 'dormant') return r;
      }
    }
    return -1;
  }

  // ── Tick per-cell timers (end of turn) ─────────────────────────
  tickTimers() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.escapeImmune > 0) cell.escapeImmune--;
        // Cytokine protection expires and reverts to healthy. Antibody-
        // placed cells never get protectedTurns set, so they're unaffected
        // and stay permanently protected.
        if (cell.protectedTurns > 0) {
          cell.protectedTurns--;
          if (cell.protectedTurns === 0 && cell.state === 'immune') { cell.state = 'healthy'; cell.cytokineColor = null; cell.cytokinePlacementId = null; }
        }
      }
    }
  }

  // ── Player card effects ─────────────────────────────────────────

  // "Horizontal Spread" — every healthy cell directly beside an
  // already-infected cell in the same row (sideways only). Returns
  // candidates rather than infecting one directly — the player no longer
  // picks the exact cell (balance pass: guaranteed precision was too
  // strong), the card's own apply() (cards.js) picks randomly among these
  // instead.
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

  // "Vertical Spread" — every healthy cell directly below an
  // already-infected cell in the same column. See horizontalSpreadCandidates()
  // above for why this returns candidates instead of infecting directly.
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

  // Deepest (highest row index) cell that's actually infected — unlike
  // _deepestInfectedRow() above, a dormant cell doesn't count here on
  // purpose (see placeDormant() below, its only caller): a latent cell is
  // itself invisible to the immune system and not yet spreading anything,
  // so it shouldn't be able to anchor a SECOND latency play further out —
  // only genuine, active infection should extend how far ahead of the
  // front the virus can lie in wait.
  _deepestActuallyInfectedRow() {
    for (let r = this.rows - 1; r >= 0; r--) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].state === 'infected') return r;
      }
    }
    return -1;
  }

  // "Latency" — place a dormant token on a healthy cell; it wakes and
  // auto-infects after a delay, invisible to immune response meanwhile.
  // Restricted to at most two rows past the current infection front (the
  // deepest ACTUALLY infected row + 2) — latency represents the virus
  // lying low just ahead of where it already is, not seeding somewhere
  // random and disconnected from the active infection.
  placeDormant(col, row, turns = 2) {
    const cell = this.getCell(col, row);
    if (!cell || cell.state !== 'healthy') return false;
    const maxRow = this._deepestActuallyInfectedRow() + 2; // -1+2=1 if nothing infected yet
    if (row > maxRow) return false;
    cell.state        = 'dormant';
    cell.dormantTurns = turns;
    return true;
  }

  // Mutation "lost latency" — finds one dormant cell (if any) and clears
  // it straight back to healthy, the inverse of placeDormant().
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

  // "Antibody Escape: <tissue>" — grants all currently-infected cells in
  // this tissue immunity from immune-response clearing for N turns.
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

  // "Antibody Escape" also breaks through any EXISTING antibody barrier in
  // this tissue, not just future clearing — the virus evades the
  // antibodies that were already blocking it. Cytokine shields are left
  // alone (cytokineColor set) since those have their own counter, see
  // Cytokine Neutralisation.
  // Returns the cleared cells (not just a count) so the UI can animate
  // exactly which ones just lost their antibody — see the "poof" flash in
  // game-ui.js.
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

  // "Escape Loss" mutation — the immune system identifies the virus's
  // disguise; strip any active antibody-escape protection immediately.
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

  // ── Queries ───────────────────────────────────────────────────
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

  // True if at least one infected OR dormant cell has a healthy cell it
  // could still spread into (same row, or directly below) — used to
  // detect the virus being fully boxed in on this board. Dormant cells
  // count too: when one wakes it's guaranteed to auto-infect an open
  // neighbour (see spreadVirus()'s dormant-wake handling), so a dormant
  // cell that isn't itself boxed in means the virus isn't really finished
  // here yet even if every currently-infected cell already is.
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

  toRenderData() {
    return this.cells.map((row, ri) =>
      row.map((cell, ci) => ({ ...cell, col: ci, row: ri }))
    );
  }
}
