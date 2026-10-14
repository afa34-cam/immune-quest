// ═══════════════════════════════════════════════════════════════════
//  IMMUNE QUEST — Stealth Mission
//  game.js — the game state machine (StealthGame). No DOM code here;
//  game-ui.js renders the state and calls in.
//
//  Each turn runs four phases. The three automatic ones compute their
//  result and pause, so the UI can narrate it, then the UI calls advance():
//    1. virus_growth    — the virus spreads in every active tissue
//    2. immune_response — the immune system draws and plays its cards
//    3. mutation        — chance of a mutation
//    4. play_cards      — the player drafts and plays cards, then endTurn()
//
//  Win:  the virus reaches the bottom row of an active tissue.
//  Lose: no infected cells left anywhere, or the virus is boxed in.
//
//  Contents
//    1. Immune play order
//    2. Setup & derived stats
//    3. Turn flow
//    4. Phase 1 — virus growth & spillover
//    5. Phase 2 — immune response
//    6. Phase 3 — mutation
//    7. Phase 4 — player cards (draft, trade, play, end turn)
//    8. Win / loss
//    9. Scoring & saving
//   10. Helpers
// ═══════════════════════════════════════════════════════════════════


// ═══ 1. Immune play order ══════════════════════════════════════════
// Order the immune system resolves its hand each turn (lower = earlier):
//   mRNA Vaccine first, so its boost already applies to this turn's
//     T-Cells and Cytokines;
//   NK Cell, then T-Cell — clearers before shielders, so a row they just
//     cleared can be shielded the same turn (and NK Cell picking off the
//     thin front cell first pushes T-Cell back onto the denser row);
//   Antibody, then Cytokines biggest shape first (Red, Orange, Blue):
//     each one grabs the best remaining stretch of frontier, so the big
//     shapes take the wide openings and Blue fills whatever gap is left.
// Anything else plays last, in hand order.
const _CYTOKINE_PLAY_ORDER = { 'immune-cytokine-red': 2.1, 'immune-cytokine-orange': 2.2, 'immune-cytokine-blue': 2.3 };
function _immunePlayPriority(id) {
  if (id === 'vaccine-mrna') return 0;
  if (id === 'immune-nkcell') return 1;
  if (id.startsWith('immune-tcell-')) return 1.5;
  if (id.startsWith('immune-antibody-')) return 2;
  if (id in _CYTOKINE_PLAY_ORDER) return _CYTOKINE_PLAY_ORDER[id];
  return 3;
}

class StealthGame {

  // ═══ 2. Setup & derived stats ════════════════════════════════════
  constructor(loadout) {
    this.loadout = loadout;   // { name, icon, tissue, replication, mutation, abilities, deck }
    this.turn    = 0;
    this.phase   = 'virus_growth';
    this.state   = 'playing';
    this.log     = [];

    // Every tissue has a board all game, so the immune system can
    // pre-fortify tissues the virus hasn't reached. activeTissues (not
    // board presence) says where the virus can spread. Only the first
    // loadout tissue starts infected; other tropism tissues are active but
    // clean until spillover (or a mutation) reaches them.
    this.boards = {};
    STEALTH_CONFIG.BOARD.TISSUES.forEach(tissueName => {
      this.boards[tissueName] = new StealthBoard(tissueName, this.loadout);
    });
    this.activeTissues = [];
    this.loadout.tissue.forEach((t, i) => {
      const tissueName = t.replace('-tropism', ''); // 'lung-tropism' -> 'lung'
      if (i === 0) this.boards[tissueName].seedInfection();
      this.activeTissues.push(tissueName);
    });

    // Player deck and hand (the hand fills from the first draft).
    this.deck = new StealthDeck(this.loadout.deck, this.activeTissues, this.difficultyBand.name, this.loadout.id);
    this.hand = [];
    this.currentOffer = null;

    // The immune system's single shared deck and hand.
    this.immuneDeck     = new ImmuneDeck(this.loadout);
    this.immuneHand     = [];
    this.mrnaBoostTurns = 0;

    // Effects changed by cards during play
    // Replication Boost: extra speed for the next spread phase only, then
    // reset to 0. Several in one turn add up.
    this.replicationBoostAmount = 0;
    // Antiviral: permanent speed penalty; grows with every play.
    this.antiviralPenalty = 0;
    // Protein Vaccine: turns left on its temporary speed penalty. A new
    // play extends the time; it doesn't deepen the penalty.
    this.proteinVaccineTurns = 0;
    // Activate Tregs: the immune system may play only 1 card next turn.
    this.immuneCardCapTurns  = 0;
    this.mhcActive            = {};  // { tissue: turnsRemaining } — T-Cell Evasion primed: cancels the next T-Cell there

    // Results of the latest phases, for the UI to narrate.
    this.lastGrowth  = null;  // { totalNew, perTissue: {tissue: {count, cells}}, spillovers }
    this.lastImmune  = null;  // { totalCleared, played: [{id, name, icon, cells}], handSize }
    this.lastMutation = null; // { event, text } | null

    // Score — only calculated on a win (_finalizeScore()).
    this.score = 0;
    this.isNewHighScore = false;  // set by _saveScore() once the mission ends
    // Net cells infected: everything infected by growth, spillover and
    // cards, minus cells the immune system cleared back to healthy.
    this.cellsInfectedTotal = 0;
    this.missionStartTime = Date.now(); // for the score's game-length multiplier
    // Tissues the virus has actually infected at some point (never shrinks).
    this.tissuesReached = new Set([this.activeTissues[0]]);

    this._addLog(`Loadout deployed: ${this.loadout.name} targeting ${this.activeTissues.join(', ')}.`);
  }

  // Difficulty band (config.js DIFFICULTY) from the base replication speed.
  get difficultyBand() {
    const speed = this.loadout.replication;
    for (const [name, cfg] of Object.entries(STEALTH_CONFIG.DIFFICULTY)) {
      if (speed >= cfg.speed[0] && speed <= cfg.speed[1]) return { name, ...cfg };
    }
    return { name: 'medium', ...STEALTH_CONFIG.DIFFICULTY.medium };
  }

  // How long a new Cytokine shield lasts (0 = permanent). Fixed per named
  // virus; a custom virus uses its difficulty band's value.
  effectiveCytokineProtectTurns() {
    if (this.loadout.id === 'hepatitis') return 0;
    if (this.loadout.id === 'influenza') return 4;
    if (this.loadout.id === 'norovirus') return 3;
    return this.difficultyBand.cytokine_protect_turns;
  }

  // Replication speed right now: the base speed (mutations change it
  // permanently) minus Antiviral and Protein Vaccine penalties, plus any
  // Replication Boost, clamped once to 1–MAX_REPLICATION_SPEED. Used both
  // for spreading and for the speed badge on screen.
  effectiveReplicationSpeed() {
    let speed = this.loadout.replication - this.antiviralPenalty + this.replicationBoostAmount;
    if (this.proteinVaccineTurns > 0) speed -= STEALTH_CONFIG.VACCINE.PROTEIN_SPEED_PENALTY_AMOUNT;
    return Math.max(1, Math.min(STEALTH_CONFIG.MAX_REPLICATION_SPEED, speed));
  }

  // ═══ 3. Turn flow ════════════════════════════════════════════════
  start() {
    this.turn = 1;
    this._runVirusGrowth();
  }

  // Called by the UI once an automatic phase has been shown.
  advance() {
    if (this.state !== 'playing') return;
    if (this.phase === 'virus_growth')     { this._runImmuneResponse(); return; }
    if (this.phase === 'immune_response')  { this._runMutationPhase();  return; }
    if (this.phase === 'mutation')         { this._runDraftPhase();     return; }
    // 'play_cards' is interactive — it ends via endTurn()
  }

  // ═══ 4. Phase 1 — virus growth & spillover ═══════════════════════
  _runVirusGrowth() {
    this.phase = 'virus_growth';
    // Any Antiviral (ever) or an active Protein Vaccine also lowers the
    // per-attempt spread chance (_rollSpreadTargets(), board.js).
    const penalized = this.antiviralPenalty > 0 || this.proteinVaccineTurns > 0;
    const effectiveSpeed = this.effectiveReplicationSpeed();
    // Kept for display: the boost is reset below, before the UI shows this phase.
    const replicationBoostUsed = this.replicationBoostAmount;

    const perTissue = {};
    let totalNew = 0;
    this.activeTissues.forEach(t => {
      const board = this.boards[t];
      const newCells = board.spreadVirus(effectiveSpeed, penalized);
      perTissue[t] = { count: newCells.cells.length, cells: newCells.cells, awoken: newCells.awoken };
      totalNew += newCells.cells.length;
    });

    // Protein Vaccine counts down; Replication Boost is used up.
    if (this.proteinVaccineTurns > 0) this.proteinVaccineTurns--;
    this.replicationBoostAmount = 0;

    const spillovers = this._runSpillover();
    this.cellsInfectedTotal += totalNew + spillovers.length;

    // effectiveSpeedUsed / replicationBoostUsed let the speed badge and
    // Active Cards banner show the boost during the phase that used it.
    this.lastGrowth = { totalNew, perTissue, spillovers, effectiveSpeedUsed: effectiveSpeed, replicationBoostUsed };
    this._addLog(`Turn ${this.turn} — Virus growth: ${totalNew} new cell(s) infected.`);
    spillovers.forEach(s => this._addLog(`Spillover: infection spread from ${s.from} into ${s.to}.`));

    this._checkWin() || this._checkLoss();
  }

  // Cells where infection could spill from one active tissue into an
  // adjacent active tissue (order: liver – lung – intestine). For each
  // row, the source tissue's edge cell must itself be infected/dormant and
  // the facing edge cell of the neighbour must be healthy — so the virus
  // never appears to jump through a shielded border cell.
  // Used by _runSpillover() (rolls each) and _checkLoss() (any left?).
  _spilloverCandidates() {
    const order = STEALTH_CONFIG.BOARD.ADJACENCY_ORDER;
    const candidates = [];
    order.forEach((from, i) => {
      if (!this.activeTissues.includes(from)) return;
      const fromBoard = this.boards[from];
      if (fromBoard.hasNoInfection()) return;
      [order[i - 1], order[i + 1]].filter(Boolean).forEach(to => {
        if (!this.activeTissues.includes(to)) return;
        const toBoard = this.boards[to];
        const toIndex = order.indexOf(to);
        // Each board's edge column that faces the other tissue.
        const toEntryCol = toIndex < i ? toBoard.cols - 1 : 0;
        const fromEdgeCol = toIndex < i ? 0 : fromBoard.cols - 1;
        for (let r = 0; r < toBoard.rows; r++) {
          const sourceCell = fromBoard.getCell(fromEdgeCol, r);
          const targetCell = toBoard.getCell(toEntryCol, r);
          const sourceInfected = sourceCell && (sourceCell.state === 'infected' || sourceCell.state === 'dormant');
          if (sourceInfected && targetCell && targetCell.state === 'healthy') {
            candidates.push({ from, to, toBoard, col: toEntryCol, row: r });
          }
        }
      });
    });
    return candidates;
  }

  // Each candidate gets its own SPILLOVER.CHANCE roll.
  _runSpillover() {
    const results = [];
    this._spilloverCandidates().forEach(({ from, to, toBoard, col, row }) => {
      if (Math.random() < STEALTH_CONFIG.SPILLOVER.CHANCE) {
        toBoard._infect(toBoard.getCell(col, row));
        this.tissuesReached.add(to);
        results.push({ from, to, col, row });
      }
    });
    return results;
  }

  // ═══ 5. Phase 2 — immune response ════════════════════════════════
  // The immune system draws DRAW_PER_TURN cards, plays every card in its
  // hand that is useful right now (in _immunePlayPriority() order) and
  // keeps the rest, then may trade dead cards (_maybeTradeImmuneHand()).
  // Everything resolves at once; the UI then narrates the plays one by
  // one using the before/after snapshots recorded below.
  _runImmuneResponse() {
    this.phase = 'immune_response';

    // T-Cell Evasion as it was before this phase, so the Active Cards
    // banner can still show it while this phase is narrated.
    const mhcActiveBefore = { ...this.mhcActive };

    // An mRNA boost from earlier turns applies now, then counts down.
    // Timers keep running even when Activate Tregs limits the immune turn.
    const mrnaBoosted = this.mrnaBoostTurns > 0;
    if (this.mrnaBoostTurns > 0) this.mrnaBoostTurns--;

    // Shield and escape timers run on every board, active or not.
    Object.values(this.boards).forEach(board => board.tickTimers());

    // Remove the early-game extra cards once that window has passed
    // (a no-op after the first time).
    if (this.turn > STEALTH_CONFIG.IMMUNE.EARLY_DILUTION_TURNS) this.immuneDeck.pruneEarlyDilution();

    const played = [];
    let totalCleared = 0;
    let traded = null;

    // Activate Tregs: only 1 card may be played this turn (drawing is
    // unaffected).
    const cardCap = this.immuneCardCapTurns > 0 ? 1 : Infinity;
    if (this.immuneCardCapTurns > 0) this.immuneCardCapTurns--;

    {
      // Draw, discarding the oldest cards beyond the hand limit.
      const drawn = this.immuneDeck.drawCards(STEALTH_CONFIG.IMMUNE.DRAW_PER_TURN);
      this.immuneHand.push(...drawn);
      if (this.immuneHand.length > STEALTH_CONFIG.IMMUNE.HAND_LIMIT) {
        const overflow = this.immuneHand.splice(0, this.immuneHand.length - STEALTH_CONFIG.IMMUNE.HAND_LIMIT);
        overflow.forEach(c => this.immuneDeck.discardCard(c));
      }

      const ctx = { protectTurns: this.effectiveCytokineProtectTurns(), mrnaBoosted };

      // Every board's cells before any card resolves. Each play records
      // the "before" state of the cells it touches, so the UI can keep
      // them looking unchanged until that play is narrated.
      const preTurnBoardState = {};
      Object.keys(this.boards).forEach(t => {
        preTurnBoardState[t] = this.boards[t].cells.map(row =>
          row.map(c => ({ state: c.state, cytokineColor: c.cytokineColor, protectedTurns: c.protectedTurns })));
      });

      // Iterate a sorted copy; stillHeld becomes the new hand (it also
      // collects cards granted mid-turn, e.g. by Protein Vaccine).
      const handSnapshot = [...this.immuneHand].sort((a, b) => _immunePlayPriority(a.id) - _immunePlayPriority(b.id));
      const stillHeld = [];
      handSnapshot.forEach(card => {
        // Activate Tregs cap reached, or nothing useful to do: keep it.
        if (played.length >= cardCap) {
          stillHeld.push(card);
          return;
        }
        if (!card.isUseful(this)) {
          stillHeld.push(card);
          return;
        }

        // T-Cell Evasion primed on this tissue: the T-Cell is cancelled
        // (the priming is used up) and the card stays in hand.
        if (card.id.startsWith('immune-tcell-') && this.mhcActive[card.tissue] > 0) {
          this.mhcActive[card.tissue] = 0;
          stillHeld.push(card);
          this._addLog(`T-Cell Evasion: blocked a T-Cell play in ${card.tissue}.`);
          return;
        }

        // Turn 1 only: don't let NK Cell / T-Cell wipe out the whole
        // starting infection before the player has had a turn — hold the
        // card instead.
        if (this.turn === 1 && (card.id === 'immune-nkcell' || card.id.startsWith('immune-tcell-'))) {
          const totalInfected = Object.values(this.boards).reduce((s, b) => s + b.infectedCount(), 0);
          let wouldClear = 0;
          if (card.id === 'immune-nkcell') {
            wouldClear = 1;
          } else {
            const board = this.boards[card.tissue];
            const row = board._pickTCellRow();
            if (row !== null) {
              wouldClear = board._infectedCountInRow(row);
              if (mrnaBoosted && row - 1 >= 0) wouldClear += board._infectedCountInRow(row - 1);
            }
          }
          if (wouldClear >= totalInfected) {
            stillHeld.push(card);
            return;
          }
        }

        // Play the card and gather the cells it affected.
        const speedBefore = this.effectiveReplicationSpeed();
        const result = card.apply(this, ctx);
        let cells = [];
        if (result.cleared) { cells = result.cleared; totalCleared += result.cleared.length; }
        else if (result.protectedCells) cells = result.protectedCells;
        else if (result.revealed) cells = [{ tissue: result.tissue, col: result.col, row: result.row }];
        if (result.grantedCards) stillHeld.push(...result.grantedCards);

        // Antiviral: permanent −1 per play, but never below a base speed of
        // 1 (so no hidden penalty builds up beyond what's visible).
        if (card.id === 'immune-antiviral') {
          const maxPenalty = Math.max(0, this.loadout.replication - 1);
          this.antiviralPenalty = Math.min(maxPenalty, (this.antiviralPenalty || 0) + STEALTH_CONFIG.IMMUNE.ANTIVIRAL_PENALTY_AMOUNT);
        }
        // Actual change to the displayed speed (0 if a limit absorbed it);
        // the UI only animates nonzero changes.
        const speedDelta = this.effectiveReplicationSpeed() - speedBefore;

        const beforeStates = cells.map(c => {
          const snap = (preTurnBoardState[c.tissue] || [])[c.row] && preTurnBoardState[c.tissue][c.row][c.col];
          return snap ? { tissue: c.tissue, col: c.col, row: c.row, ...snap } : null;
        }).filter(Boolean);

        // The cells right after THIS card — what its narration step shows,
        // even if a later card this turn changes the same cells again.
        const afterStates = cells.map(c => {
          const cell = this.boards[c.tissue] && this.boards[c.tissue].cells[c.row] && this.boards[c.tissue].cells[c.row][c.col];
          return cell ? { tissue: c.tissue, col: c.col, row: c.row, state: cell.state, cytokineColor: cell.cytokineColor, protectedTurns: cell.protectedTurns } : null;
        }).filter(Boolean);

        // Full duration at the moment of play, for the card's countdown
        // badge in the Immune System banner.
        const turnsBadge = card.id.startsWith('immune-cytokine-') && afterStates[0]
          ? afterStates[0].protectedTurns
          : card.id === 'vaccine-protein' ? STEALTH_CONFIG.VACCINE.PROTEIN_SPEED_PENALTY_TURNS
          : card.id === 'vaccine-mrna' ? STEALTH_CONFIG.VACCINE.MRNA_BOOST_TURNS
          : undefined;

        played.push({ id: card.id, name: card.name, icon: card.icon, tissue: card.tissue, cells, beforeStates, afterStates, speedDelta, turnsBadge });
        this.immuneDeck.discardCard(card);
      });
      this.immuneHand = stillHeld;

      traded = this._maybeTradeImmuneHand();
    }

    // T-Cell Evasion counts down after the plays, on active tissues only.
    this.activeTissues.forEach(t => {
      if (this.mhcActive[t] > 0) this.mhcActive[t]--;
    });

    // Cells the immune system cleared no longer count toward the score.
    this.cellsInfectedTotal = Math.max(0, this.cellsInfectedTotal - totalCleared);

    this.lastImmune = { totalCleared, played, handSize: this.immuneHand.length, mrnaBoosted, traded, mhcActiveBefore };
    this._addLog(`Turn ${this.turn} — Immune response: ${totalCleared} cell(s) cleared.`);
    played.forEach(p => this._addLog(`Immune: ${p.name} played.`));
    if (traded) this._addLog(`Immune system traded 3 cards for ${traded.received}.`);

    this._checkWin() || this._checkLoss();
  }

  // The immune system's version of Trade 3▸1: if 3+ cards in hand are
  // useless right now, swap 3 of them for a card from the deck that is
  // useful now. Skipped if the deck has nothing useful.
  _maybeTradeImmuneHand() {
    if (this.immuneHand.length < 3) return null;
    const deadWeight = this.immuneHand.filter(c => !c.isUseful(this));
    if (deadWeight.length < 3) return null;

    if (this.immuneDeck.draw.length === 0) this.immuneDeck._reshuffleDiscard();
    const usefulIndex = this.immuneDeck.draw.findIndex(c => c.isUseful(this));
    if (usefulIndex === -1) return null; // nothing useful to trade into — skip

    const giveUp = deadWeight.slice(0, 3);
    const received = this.immuneDeck.draw.splice(usefulIndex, 1)[0];
    giveUp.forEach(c => {
      this.immuneHand.splice(this.immuneHand.indexOf(c), 1);
      this.immuneDeck.discardCard(c);
    });
    this.immuneHand.push(received);
    return { gaveUp: giveUp.map(c => c.name), received: received.name };
  }

  // ═══ 6. Phase 3 — mutation ═══════════════════════════════════════
  // Rolls whether a mutation happens (by mutation rate), then which one.
  // Each result is tagged with a category and direction ('gain' helps the
  // virus, 'loss' helps the immune system) so the UI can label it clearly.
  _runMutationPhase() {
    this.phase = 'mutation';
    const event = this._rollMutation();
    if (!event) {
      this.lastMutation = null;
      this._addLog('Mutation phase: no mutation this turn.');
      return;
    }

    let category = null, direction = null, text = '', tissue = null, color = null;
    // Actual change to the displayed speed (speed mutations only; null
    // otherwise). Can be 0 at the speed limits.
    let speedDelta = null;

    switch (event) {
      case 'none':
        text = 'The virus did not mutate';
        break;

      case 'speed_gain': {
        category = 'Replication Speed'; direction = 'gain';
        const speedBefore = this.effectiveReplicationSpeed();
        this.loadout = { ...this.loadout, replication: Math.min(STEALTH_CONFIG.MAX_REPLICATION_SPEED, this.loadout.replication + 1) };
        // Report the effective speed — the number the player sees.
        const speedAfter = this.effectiveReplicationSpeed();
        speedDelta = speedAfter - speedBefore;
        text = speedDelta ? `Mutation - replication speed increased to ${speedAfter}` : 'Mutation - replication speed already at maximum, no effect';
        break;
      }

      case 'speed_loss': {
        category = 'Replication Speed'; direction = 'loss';
        const speedBefore = this.effectiveReplicationSpeed();
        this.loadout = { ...this.loadout, replication: Math.max(1, this.loadout.replication - 1) };
        const speedAfter = this.effectiveReplicationSpeed();
        speedDelta = speedAfter - speedBefore;
        text = speedDelta ? `Mutation - replication speed decreased to ${speedAfter}` : 'Mutation - replication speed already at minimum, no effect';
        break;
      }

      case 'escape_gain': {
        // Adds an Antibody Escape card (random active tissue) to the hand.
        category = 'Antibody Escape'; direction = 'gain';
        const t = this._pickMutationTarget(this.activeTissues);
        const def = STEALTH_CARD_DEFS[`antibody-escape-${t}`];
        if (def) this.hand.push({ ...def });
        if (this.hand.length > STEALTH_CONFIG.CARDS.HAND_LIMIT) {
          const discarded = this.hand.splice(STEALTH_CONFIG.CARDS.HAND_LIMIT);
          discarded.forEach(c => this.deck.discardCard(c));
        }
        tissue = t;
        text = `Mutation - gained Antibody Escape (${_capitalize(t)})`;
        break;
      }

      case 'escape_loss': {
        // Removes an Antibody Escape card from the hand; if there isn't
        // one, removes an active escape effect from the board instead.
        // Only rolled when one of these exists (_effectiveMutationTable()).
        category = 'Antibody Escape'; direction = 'loss';
        const handIdx = this.hand.findIndex(c => c.id.startsWith('antibody-escape-'));
        if (handIdx !== -1) {
          const removed = this.hand.splice(handIdx, 1)[0];
          this.deck.discardCard(removed);
          tissue = removed.id.replace('antibody-escape-', '');
          text = `Mutation - lost Antibody Escape (${_capitalize(tissue)})`;
        } else {
          const t = this.activeTissues.find(t => this.boards[t].cells.some(row => row.some(c => c.escapeImmune > 0)));
          this.boards[t].clearEscapeImmunity();
          tissue = t;
          text = `Mutation - lost Antibody Escape (${_capitalize(t)})`;
        }
        break;
      }

      case 'latency_gain': {
        // Adds a Latency card to the hand.
        category = 'Latency'; direction = 'gain';
        const def = STEALTH_CARD_DEFS['latency'];
        this.hand.push({ ...def });
        if (this.hand.length > STEALTH_CONFIG.CARDS.HAND_LIMIT) {
          const discarded = this.hand.splice(STEALTH_CONFIG.CARDS.HAND_LIMIT);
          discarded.forEach(c => this.deck.discardCard(c));
        }
        text = 'Mutation - gained Latency';
        break;
      }

      case 'tropism_loss': {
        // Deactivates a random active tissue. Its infection stays frozen in
        // place (no spreading, not targeted) until a later tropism_gain
        // picks that tissue again; its shields keep counting down.
        category = 'Tropism'; direction = 'loss';
        const t = this._pickMutationTarget(this.activeTissues);
        this.activeTissues = this.activeTissues.filter(x => x !== t);
        tissue = t;
        text = `Mutation - lost Tropism (${_capitalize(t)})`;
        break;
      }

      case 'latency_loss': {
        category = 'Latency'; direction = 'loss';
        const candidates = this.activeTissues.filter(t => this.boards[t].hasDormant());
        if (candidates.length) {
          const t = this._pickMutationTarget(candidates);
          this.boards[t].clearDormant();
          tissue = t;
          text = 'Mutation - lost Latency';
        } else {
          text = 'Mutation - latency loss failed - no dormant cells';
        }
        break;
      }

      case 'tropism_gain': {
        // Activates and seeds a random inactive tissue, keeping any
        // shields the immune system already placed there. Only rolled
        // when an inactive tissue exists (_effectiveMutationTable()).
        category = 'Tropism'; direction = 'gain';
        const inactive = STEALTH_CONFIG.BOARD.ADJACENCY_ORDER.filter(t => !this.activeTissues.includes(t));
        const t = this._pickMutationTarget(inactive);
        this.boards[t].seedInfection();
        this.activeTissues.push(t);
        this.tissuesReached.add(t);
        tissue = t;
        text = `Mutation - gained Tropism (${_capitalize(t)})`;
        break;
      }

      case 'cytokine_neutralise_gain': {
        // Adds a random-colour Cytokine Neutralisation card to the hand.
        category = 'Cytokine Neutralisation'; direction = 'gain';
        const colors = ['blue', 'orange', 'red'];
        color = this._pickMutationTarget(colors);
        const def = STEALTH_CARD_DEFS[`cytokine-neutralise-${color}`];
        this.hand.push({ ...def });
        if (this.hand.length > STEALTH_CONFIG.CARDS.HAND_LIMIT) {
          const discarded = this.hand.splice(STEALTH_CONFIG.CARDS.HAND_LIMIT);
          discarded.forEach(c => this.deck.discardCard(c));
        }
        text = `Mutation - gained Cytokine Neutralisation (${_capitalize(color)})`;
        break;
      }
    }

    this.lastMutation = { event, category, direction, text, tissue, color, speedDelta };
    this._addLog(`Mutation: ${text}`);

    // tropism_loss can remove the last active tissue — end the game now
    // rather than after a pointless player turn.
    this._checkWin() || this._checkLoss();
  }

  // ═══ 7. Phase 4 — player cards ═══════════════════════════════════
  _runDraftPhase() {
    this.phase = 'play_cards';
    this.currentOffer = this.deck.offerDraft();
    // The UI takes over: pick from currentOffer, play cards, endTurn().
  }

  // The player's picks from the draft offer go into the hand.
  resolveDraft(pickedIndexes) {
    if (this.phase !== 'play_cards' || !this.currentOffer) return { ok: false };
    const picked = this.deck.resolveDraft(this.currentOffer, pickedIndexes);
    this.hand.push(...picked);
    if (this.hand.length > STEALTH_CONFIG.CARDS.HAND_LIMIT) {
      const discarded = this.hand.splice(STEALTH_CONFIG.CARDS.HAND_LIMIT);
      discarded.forEach(c => this.deck.discardCard(c));
    }
    this.currentOffer = null;
    this._addLog(`Drafted ${picked.length} card(s). Hand: ${this.hand.length}.`);
    return { ok: true };
  }

  // Trade 3▸1: swap exactly 3 hand cards for one card of the player's
  // choice (any type in this virus's deck). Free — doesn't end the turn.
  tradeCards(handIndexes, chosenCardId) {
    if (this.phase !== 'play_cards') return { ok: false, reason: 'Not in play phase.' };
    const uniqueIndexes = [...new Set(handIndexes)];
    if (uniqueIndexes.length !== 3) return { ok: false, reason: 'Choose exactly 3 cards to give up.' };
    if (uniqueIndexes.some(i => i < 0 || i >= this.hand.length)) return { ok: false, reason: 'Invalid card index.' };
    const def = STEALTH_CARD_DEFS[chosenCardId];
    if (!def) return { ok: false, reason: 'Invalid card choice.' };

    // Highest index first, so earlier removals don't shift later ones.
    [...uniqueIndexes].sort((a, b) => b - a).forEach(i => {
      const card = this.hand.splice(i, 1)[0];
      this.deck.discardCard(card);
    });
    this.hand.push({ ...def });
    this._addLog(`Traded 3 card(s) for ${def.name}.`);
    return { ok: true, result: { text: `Traded 3 cards for ${def.name}.`, cardName: def.name } };
  }

  // Plays a hand card on a target. Card effects read and write a small
  // `state` object, copied back afterwards. An invalid target
  // (result.ok === false) leaves the card in hand.
  playCard(handIndex, target) {
    if (this.phase !== 'play_cards') return { ok: false, reason: 'Not in play phase.' };
    if (handIndex < 0 || handIndex >= this.hand.length) return { ok: false, reason: 'Invalid card index.' };

    const card = this.hand[handIndex];
    const state = {
      replicationBoostAmount: this.replicationBoostAmount,
      immuneCardCapTurns: this.immuneCardCapTurns,
      mhcActive: this.mhcActive,
      activeTissues: this.activeTissues,
    };

    const result = card.apply(this.boards, target, state);

    this.replicationBoostAmount = state.replicationBoostAmount;
    this.immuneCardCapTurns    = state.immuneCardCapTurns;
    this.mhcActive             = state.mhcActive;

    if (result.ok === false) {
      this._addLog(result.text);
      return { ok: false, result };
    }

    this.cellsInfectedTotal += result.count || 0;

    this.hand.splice(handIndex, 1);
    this.deck.discardCard(card);

    this._addLog(result.text);
    return { ok: true, result };
  }

  // "End Turn" button: check for a result, then start the next turn.
  endTurn() {
    if (this.phase !== 'play_cards') return;
    if (this._checkWin()) return;
    if (this._checkLoss()) return;
    this.turn++;
    this._runVirusGrowth();
  }

  // ═══ 8. Win / loss ═══════════════════════════════════════════════
  _checkWin() {
    const reached = this.activeTissues.some(t => this.boards[t].hasReachedBottomRow());
    if (!reached) return false;
    this.state = 'won';
    this._finalizeScore();
    this._addLog(`✓ WIN! Virus reached the bottom row on turn ${this.turn}. Score: ${this.score}.`);
    this._saveScore();
    return true;
  }

  _checkLoss() {
    // Lost if no infection remains on ANY board (inactive tissues can
    // still hold frozen infection after tropism_loss).
    const allClear = Object.values(this.boards).every(b => b.hasNoInfection());
    if (allClear) {
      this.state = 'lost';
      this._addLog(`✗ LOSS: no infected cells remain anywhere — the immune system won on turn ${this.turn}.`);
      this._saveScore();
      return true;
    }
    // Also lost if boxed in: no active tissue can spread and no spillover
    // is possible. (With zero active tissues the virus is only waiting on
    // a tropism_gain, so that doesn't count as boxed in.)
    const boxedIn = this.activeTissues.length > 0
      && this.activeTissues.every(t => !this.boards[t].hasSpreadTarget())
      && this._spilloverCandidates().length === 0;
    if (boxedIn) {
      this.state = 'lost';
      this._addLog(`✗ LOSS: the virus has nowhere left to spread on turn ${this.turn}.`);
      this._saveScore();
      return true;
    }
    return false;
  }

  // ═══ 9. Scoring & saving ═════════════════════════════════════════
  // Runs exactly once per finished mission (from _checkWin/_checkLoss).
  _saveScore() {
    try {
      const key  = 'iq_score_stealth';
      const best = parseInt(localStorage.getItem(key) || '0');
      // Recorded now, before the saved best is overwritten, for the end
      // screen's "New High Score" callout.
      this.isNewHighScore = this.score > best;
      if (this.isNewHighScore) localStorage.setItem(key, String(this.score));
      if (this.state === 'won') localStorage.setItem('iq_cleared_stealth', '1');
      const played = parseInt(localStorage.getItem('iq_played') || '0');
      localStorage.setItem('iq_played', String(played + 1));
    } catch (e) { /* localStorage may not be available */ }

    // Tell the platform page the result (win/loss analytics —
    // recordGameResult(), index.html). Sent here because this runs once.
    if (window.self !== window.top) {
      window.parent.postMessage({ type: 'iq_game_result', win: this.state === 'won', score: this.score }, '*');
    }
  }

  // Final score (wins only):
  //   (net cells × PTS_PER_CELL × game-length multiplier
  //    + tissues reached × PTS_PER_TISSUE_REACHED + WIN_BONUS)
  //   × difficulty multiplier
  _finalizeScore() {
    const cfg = STEALTH_CONFIG.SCORE;
    const minutes = (Date.now() - this.missionStartTime) / 60000;
    const durationMult = this._durationMultiplier(minutes);
    const difficultyMult = this.difficultyBand.score_mult;
    const cellsScore = this.cellsInfectedTotal * cfg.PTS_PER_CELL * durationMult;
    const tissueBonus = this.tissuesReached.size * cfg.PTS_PER_TISSUE_REACHED;
    const subtotal = cellsScore + tissueBonus + cfg.WIN_BONUS;
    this.score = Math.round(subtotal * difficultyMult);
    // For the end screen / debugging.
    this.scoreBreakdown = {
      cellsInfected: this.cellsInfectedTotal,
      minutes: Math.round(minutes * 10) / 10,
      durationMult, difficultyMult, tissueBonus,
      winBonus: cfg.WIN_BONUS,
    };
  }

  // Linear interpolation along SCORE.DURATION_MULT_CURVE (flat beyond
  // either end).
  _durationMultiplier(minutes) {
    const curve = STEALTH_CONFIG.SCORE.DURATION_MULT_CURVE;
    if (minutes <= curve[0].min) return curve[0].mult;
    for (let i = 1; i < curve.length; i++) {
      if (minutes <= curve[i].min) {
        const a = curve[i - 1], b = curve[i];
        const t = (minutes - a.min) / (b.min - a.min);
        return a.mult + (b.mult - a.mult) * t;
      }
    }
    return curve[curve.length - 1].mult;
  }

  // ═══ 10. Helpers ═════════════════════════════════════════════════
  // The mutation weights for this virus right now:
  //   - tropism_loss scaled by the number of active tissues
  //   - Antigenic Drift (ability; Influenza by default) triples escape_gain
  //   - entries that can't apply to this virus, or can't do anything
  //     right now, are set to 0 (their weight spreads over the rest)
  _effectiveMutationTable() {
    const mult = STEALTH_CONFIG.TROPISM_LOSS_MULT_BY_ACTIVE_TISSUES[this.activeTissues.length] ?? 1;
    const table = { ...STEALTH_CONFIG.MUTATION, tropism_loss: STEALTH_CONFIG.MUTATION.tropism_loss * mult };
    const abilities = this.loadout.abilities || [];
    if (abilities.includes('antigenic-drift')) table.escape_gain *= 3;
    if (!abilities.includes('latency')) { table.latency_gain = 0; table.latency_loss = 0; }
    if (this.loadout.id !== 'influenza') {
      table.escape_loss = 0;
    } else {
      // Nothing to take away: no Antibody Escape in hand or on the board.
      const hasEscapeCard = this.hand.some(c => c.id.startsWith('antibody-escape-'));
      const hasActiveEscape = this.activeTissues.some(t => this.boards[t].cells.some(row => row.some(c => c.escapeImmune > 0)));
      if (!hasEscapeCard && !hasActiveEscape) table.escape_loss = 0;
    }
    if (this.loadout.id === 'norovirus') {
      table.tropism_gain = 0;
      // It can never regain a tissue, so it never loses its last one
      // (otherwise the game would stall with nothing left to happen).
      if (this.activeTissues.length <= 1) table.tropism_loss = 0;
    }
    // No active tissue (all lost to tropism_loss): nothing to pick a tissue
    // for until a tropism_gain.
    if (this.activeTissues.length === 0) { table.escape_gain = 0; table.tropism_loss = 0; }
    // Already in every tissue — nothing left to gain.
    if (this.activeTissues.length >= STEALTH_CONFIG.BOARD.TISSUES.length) table.tropism_gain = 0;
    return table;
  }

  // Whether a mutation happens this turn (by mutation rate) and which one;
  // null for none. Overridden by the tutorial (tutorial-game.js).
  _rollMutation() {
    const mutationProb = STEALTH_CONFIG.MUTATION_PROB_BY_RATE[this.loadout.mutation]
      ?? STEALTH_CONFIG.MUTATION_PROB_BY_RATE.low;
    if (Math.random() > mutationProb) return null;
    return this._weightedPick(this._effectiveMutationTable());
  }

  // Which tissue/colour a mutation applies to: random from `options`.
  // Overridden by the tutorial (tutorial-game.js).
  _pickMutationTarget(options) {
    return options[Math.floor(Math.random() * options.length)];
  }

  // Random key from a { key: weight } table.
  _weightedPick(table) {
    const total = Object.values(table).reduce((s, v) => typeof v === 'number' ? s + v : s, 0);
    let roll = Math.random() * total;
    for (const [key, weight] of Object.entries(table)) {
      if (typeof weight !== 'number') continue;
      roll -= weight;
      if (roll <= 0) return key;
    }
    return 'none';
  }

  // Newest-first text log (last 30 entries).
  _addLog(msg) {
    this.log.unshift(`T${this.turn}: ${msg}`);
    if (this.log.length > 30) this.log.pop();
  }
}
