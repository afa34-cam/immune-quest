// ═══════════════════════════════════════════════════════════════════
//  game.js — Main game state machine. Orchestrates all modules.
//
//  Turn phases (matching GDD Section 3.2):
//    1. CANCER_GROWTH  — spread, tick established timers
//    2. DRAW_CARDS     — draw from deck into hand
//    3. PLAY_CARDS     — player selects and plays cards
//    4. MUTATION       — roll for mutation event
//
//  State machine states:
//    'intro'      → show intro screen
//    'playing'    → normal gameplay (phase cycling)
//    'metastasis' → pause to show metastasis event screen
//    'won'        → win screen
//    'lost'       → lose screen
// ═══════════════════════════════════════════════════════════════════

class CancerGame {
  constructor(difficulty = 'normal') {
    this.difficulty  = difficulty;
    this.cfg         = CONFIG.DIFFICULTY[difficulty];
    this.turn        = 0;
    this.phase       = 'draw';  // current phase within a turn
    this.state       = 'intro';
    this.log         = [];      // action log for display

    // Board
    this.primaryBoard = new Board(
      CONFIG.BOARD.COLS,
      CONFIG.BOARD.ROWS,
      'intestine'
    );

    // Metastasis manager
    this.meta = new MetastasisManager(difficulty);

    // Deck and hand
    this.deck = new Deck();
    this.hand = [];

    // Turn-state flags (reset each turn)
    this.drawBonus         = 0;
    this.skipDrawNextTurn  = false;
    this.vaccineBoostTurns = 0;
    this.immunePenaltyTurns = 0;
    this.immunePenaltyMult  = 1.0;

    // Mutation state
    this.resistantCardType  = null;
    this.evasionTurns        = 0;
    this.currentMutationEvent = null;

    // Score
    this.score = 0;
    this.cellsCleared = 0;

    // Seed the initial tumour
    this.primaryBoard.seedTumour(CONFIG.BOARD.ORIGIN_COL, CONFIG.BOARD.ORIGIN_ROW);
  }

  // ── Start game ────────────────────────────────────────────────
  start() {
    this.state = 'playing';
    this.turn  = 1;
    this.phase = 'cancer_growth';
    this._runCancerGrowth();
  }

  // ── Phase 1: Cancer growth ────────────────────────────────────
  _runCancerGrowth() {
    this.phase = 'cancer_growth';
    const newCells = this.primaryBoard.spreadCancer(this.cfg.established_turns);

    if (this.meta.isActive) {
      this.meta.secondaryBoard.spreadCancer(this.cfg.established_turns);
    }

    // Tick all timers
    this.primaryBoard.tickTimers();
    if (this.meta.isActive) this.meta.secondaryBoard.tickTimers();

    // Tick game-level timers
    if (this.evasionTurns > 0)       this.evasionTurns--;
    if (this.vaccineBoostTurns > 0)  this.vaccineBoostTurns--;
    if (this.immunePenaltyTurns > 0) {
      this.immunePenaltyTurns--;
      if (this.immunePenaltyTurns === 0) this.immunePenaltyMult = 1.0;
    }

    this._addLog(`Turn ${this.turn} — Cancer growth: ${newCells.length} new cell(s) infected.`);

    // Check lose condition after growth
    if (this._checkLoss()) return;

    this._runDrawPhase();
  }

  // ── Phase 2: Draw cards ───────────────────────────────────────
  _runDrawPhase() {
    this.phase = 'draw_cards';

    if (this.skipDrawNextTurn) {
      this.skipDrawNextTurn = false;
      this._addLog('Card draw skipped this turn (cytokine storm from CAR T-cell therapy).');
      this.phase = 'play_cards';
      return; // UI takes over for play phase
    }

    const n = this.cfg.cards_drawn + this.drawBonus;
    this.drawBonus = 0;

    const drawn = this.deck.drawCards(n);
    this.hand.push(...drawn);

    // Enforce hand limit
    if (this.hand.length > CONFIG.CARDS.HAND_LIMIT) {
      const discarded = this.hand.splice(CONFIG.CARDS.HAND_LIMIT);
      discarded.forEach(c => this.deck.discardCard(c));
      this._addLog(`Hand limit reached — ${discarded.length} card(s) auto-discarded.`);
    }

    this._addLog(`Drew ${drawn.length} card(s). Hand: ${this.hand.length}. Deck: ${this.deck.drawCount}.`);
    this.phase = 'play_cards';
    // UI takes over — player selects cards to play
  }

  // ── Phase 3: Player plays a card ─────────────────────────────
  // Called by UI when player selects a card and target
  playCard(handIndex, target) {
    if (this.phase !== 'play_cards') return { ok: false, reason: 'Not in play phase.' };
    if (handIndex < 0 || handIndex >= this.hand.length) return { ok: false, reason: 'Invalid card index.' };

    const card    = this.hand[handIndex];
    const board   = target.boardType === 'secondary' ? this.meta.secondaryBoard : this.primaryBoard;

    // Apply immune penalty if active
    const state = {
      difficulty:          this.difficulty,
      deck:                this.deck,
      immunePenaltyMult:   this.immunePenaltyMult,
      vaccineBoostTurns:   this.vaccineBoostTurns,
      drawBonus:           this.drawBonus,
      skipDrawNextTurn:    this.skipDrawNextTurn,
      immunePenaltyTurns:  this.immunePenaltyTurns,
    };

    const result = card.apply(board, target, state);

    // Write back mutable state
    this.drawBonus         = state.drawBonus       || 0;
    this.skipDrawNextTurn  = state.skipDrawNextTurn || false;
    this.vaccineBoostTurns = state.vaccineBoostTurns || this.vaccineBoostTurns;
    this.immunePenaltyTurns = state.immunePenaltyTurns || this.immunePenaltyTurns;
    this.immunePenaltyMult  = state.immunePenaltyMult  || this.immunePenaltyMult;

    // Score: 10 pts per cell cleared
    this.cellsCleared += result.count || 0;
    this.score += (result.count || 0) * 10;

    // Remove card from hand and discard
    this.hand.splice(handIndex, 1);
    this.deck.discardCard(card);

    this._addLog(result.text);
    return { ok: true, result };
  }

  // ── End turn (called when player presses "End Turn") ─────────
  endTurn() {
    if (this.phase !== 'play_cards') return;
    this._runMutationPhase();
  }

  // ── Phase 4: Mutation ─────────────────────────────────────────
  _runMutationPhase() {
    this.phase = 'mutation';

    const isLateTurn = this.turn >= CONFIG.MUTATION.LATE_TURN_THRESHOLD;
    const mutProb    = isLateTurn
      ? this.cfg.mutation_prob_late
      : this.cfg.mutation_prob_early;

    // Roll: does mutation happen at all?
    if (Math.random() > mutProb) {
      this._addLog('Mutation phase: no mutation this turn.');
      this.currentMutationEvent = null;
      this._endTurnCleanup();
      return;
    }

    // Pick mutation type
    const table = isLateTurn ? CONFIG.MUTATION.late : CONFIG.MUTATION.early;
    const event = this._weightedPick(table);
    this.currentMutationEvent = event;

    switch (event) {
      case 'none':
        this._addLog('Mutation phase: roll resulted in no effect.');
        break;

      case 'resistance': {
        const cardType = this.primaryBoard.applyResistanceMutation();
        if (this.meta.isActive) this.meta.secondaryBoard.applyResistanceMutation();
        this.resistantCardType = cardType;
        this._addLog(`⚠ Mutation: cancer cells now resistant to ${CARD_DEFS[cardType]?.name || cardType}.`);
        break;
      }

      case 'growth_accel':
        // Handled in config: next spread cycle uses established_turns - 1
        this.cfg = { ...this.cfg, established_turns: Math.max(2, this.cfg.established_turns - 1) };
        this._addLog('⚠ Mutation: growth acceleration — cancer spreads faster.');
        break;

      case 'immune_evasion':
        this.evasionTurns = CONFIG.MUTATION.EVASION_DURATION;
        this._addLog(`⚠ Mutation: immune evasion active for ${CONFIG.MUTATION.EVASION_DURATION} turns — T-cell and NK cell effectiveness halved.`);
        break;

      case 'metastasis': {
        const fired = this.meta.checkTrigger(this.primaryBoard, 'metastasis');
        if (fired) {
          this._addLog(`🚨 METASTASIS: cancer has spread to the ${this.meta.siteName}!`);
          this.state = 'metastasis';
          // UI shows metastasis event screen; player must acknowledge before continuing
          return;
        } else {
          this._addLog('Mutation phase: metastasis roll — conditions not yet met.');
        }
        break;
      }
    }

    this._endTurnCleanup();
  }

  // Called after player acknowledges metastasis screen
  acknowledgeMetastasis() {
    this.state = 'playing';
    this._endTurnCleanup();
  }

  _endTurnCleanup() {
    // Check win condition
    if (this._checkWin()) return;
    // Check loss condition
    if (this._checkLoss()) return;

    this.turn++;
    this.phase = 'cancer_growth';
    this._runCancerGrowth();
  }

  // ── Win/lose checks ───────────────────────────────────────────
  _checkWin() {
    if (!this.primaryBoard.isCleared()) return false;
    if (!this.meta.allCleared()) return false;

    this.state = 'won';
    this.score += 500; // win bonus
    this._addLog(`✓ WIN! All cancer cells eliminated on turn ${this.turn}. Score: ${this.score}.`);
    this._saveScore();
    return true;
  }

  _checkLoss() {
    const reasons = [];
    if (this.primaryBoard.bottomRowInfected()) {
      reasons.push('Cancer has reached the bottom row of the intestine.');
    }
    if (this.meta.secondaryLost()) {
      reasons.push(`Cancer has overwhelmed the ${this.meta.siteName}.`);
    }
    if (reasons.length === 0) return false;

    this.state = 'lost';
    reasons.forEach(r => this._addLog(`✗ LOSS: ${r}`));
    this._saveScore();
    return true;
  }

  // ── Scoring and persistence ───────────────────────────────────
  _saveScore() {
    try {
      const key  = 'iq_score_cancer';
      const best = parseInt(localStorage.getItem(key) || '0');
      if (this.score > best) localStorage.setItem(key, String(this.score));
      if (this.state === 'won') localStorage.setItem('iq_cleared_cancer', '1');
      const played = parseInt(localStorage.getItem('iq_played') || '0');
      localStorage.setItem('iq_played', String(played + 1));
    } catch (e) { /* localStorage may not be available */ }
  }

  // ── Helpers ───────────────────────────────────────────────────
  _weightedPick(table) {
    const total = Object.values(table).reduce((s, v) => s + v, 0);
    let roll    = Math.random() * total;
    for (const [key, weight] of Object.entries(table)) {
      roll -= weight;
      if (roll <= 0) return key;
    }
    return Object.keys(table)[Object.keys(table).length - 1];
  }

  _addLog(msg) {
    this.log.unshift(`T${this.turn}: ${msg}`);
    if (this.log.length > 30) this.log.pop();
  }

  // ── Query helpers for UI ──────────────────────────────────────
  get isEvasionActive()   { return this.evasionTurns > 0; }
  get isPenaltyActive()   { return this.immunePenaltyTurns > 0; }
  get isVaccineActive()   { return this.vaccineBoostTurns > 0; }
  get activeMutation()    { return this.currentMutationEvent; }
  get resistantCard()     { return this.resistantCardType; }
}
