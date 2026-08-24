// ═══════════════════════════════════════════════════════════════════
//  game.js — Main game state machine. Mirrors games/cancer/game.js.
//
//  Turn phases — each phase computes its result and PAUSES; the UI shows
//  a transition banner and calls advance() to move to the next phase.
//  This makes each step of a turn visible rather than resolving silently:
//    1. VIRUS_GROWTH     — autonomous spread across all active tissues
//    2. IMMUNE_RESPONSE   — autonomous immune clearing + antibody advance
//    3. MUTATION          — roll for a mutation event
//    4. PLAY_CARDS        — draft offer, player plays cards from hand
//
//  Win:  the virus reaches the bottom row of any active tissue.
//  Lose: the virus has no infected cells left anywhere.
// ═══════════════════════════════════════════════════════════════════

class StealthGame {
  constructor(loadout) {
    this.loadout = loadout;   // { name, icon, tissue, replication, mutation, abilities, deck }
    this.turn    = 0;
    this.phase   = 'virus_growth';
    this.state   = 'playing';
    this.log     = [];

    // Every tissue gets a board for the whole game, not just the ones the
    // player's loadout targets — the immune system can pre-fortify a
    // tissue with Antibody/Cytokine before the virus ever reaches it (see
    // _runImmuneResponse()), so there needs to be something to place that
    // protection on. activeTissues (not board presence) is the source of
    // truth for which tissues the virus can currently spread in — a
    // pre-fortified but still-inactive board just sits there healthy and
    // untargeted by virus growth until tropism_gain (or the loadout
    // itself) activates it. Only the first loadout tissue is seeded at
    // game start — additional tropism tissues start uninfected and can
    // only get infection via spillover from an adjacent, already-infected
    // tropism tissue (or a lucky mutation).
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

    // Deck and hand — starts empty; the first draft offer (_runDraftPhase())
    // is the player's first chance to actually get a card.
    this.deck = new StealthDeck(this.loadout.deck, this.activeTissues, this.difficultyBand.name, this.loadout.id);
    this.hand = [];
    this.currentOffer = null;

    // The immune system's ONE shared deck/hand for the whole game — see
    // _runImmuneResponse() below. Replaces what used to be a separate deck
    // per tissue board plus a separate global vaccine deck.
    this.immuneDeck     = new ImmuneDeck(this.loadout);
    this.immuneHand     = [];
    this.mrnaBoostTurns = 0;

    // Turn-state flags (mutable each turn via card effects)
    // Replication Boost is a permanent +1 to loadout.replication now (see
    // 'spread-speed-plus', cards.js) — same as the speed_gain mutation
    // event, not a temporary timer. This flag only controls whether the
    // card still shows in the Active Cards banner: true from the moment
    // it's played until the next pick-cards phase starts (_runDraftPhase()
    // resets it), independent of the (now permanent) effect itself.
    this.showReplicationBoostBadge = false;
    this.speedPenaltyTurns    = 0;   // Antiviral / Protein Vaccine (immune-favourable): the exact opposite of the above
    // How much effectiveReplicationSpeed() currently subtracts while
    // speedPenaltyTurns is active — Antiviral's -1 vs Protein Vaccine's
    // deeper -2 (see ANTIVIRAL_PENALTY_AMOUNT/PROTEIN_SPEED_PENALTY_AMOUNT,
    // config.js). The two share one pooled DURATION counter (see
    // vaccine-protein's apply(), cards.js) rather than stacking, so
    // whichever effect most recently (re)applied also sets the amount for
    // the remainder of that pooled countdown — same "most recent wins"
    // relationship lastSpeedPenaltySource already has with the badge shown.
    this.speedPenaltyAmount = 0;
    // Whichever of Antiviral/Protein Vaccine most recently topped up
    // speedPenaltyTurns — the two share one pooled counter (see
    // vaccine-protein's apply(), cards.js), so this picks which card face
    // the still-active countdown badge shows (see renderImmuneBanner(),
    // game-ui.js) and, via speedPenaltyAmount above, the actual magnitude.
    this.lastSpeedPenaltySource = null;
    this.immuneSkipTurns      = 0;   // turns remaining where the immune system's whole turn is skipped — Activate Tregs (virus-favourable)
    this.mhcActive            = {};  // { tissue: turnsRemaining } — T-Cell Evasion primed (virus-favourable): cancels the next T-Cell there, expires after MHC_EVASION_TURNS unused

    // Structured results from the most recent phase, for the UI's
    // transition banners and the "immune actions" strip.
    this.lastGrowth  = null;  // { totalNew, perTissue: {tissue: {count, cells}}, spillovers }
    this.lastImmune  = null;  // { totalCleared, played: [{id, name, icon, cells}], handSize }
    this.lastMutation = null; // { event, text } | null

    // Score — only ever finalized on a win, see _finalizeScore().
    this.score = 0;
    this.isNewHighScore = false;  // set by _saveScore() once the mission ends
    // Net cells currently credited to the virus: every cell infected by
    // growth/spillover/card plays, minus whatever NK Cell/T-Cell cleared
    // back to healthy along the way (see _runImmuneResponse()) — so
    // territory the immune system took back doesn't still count.
    this.cellsInfectedTotal = 0;
    this.missionStartTime = Date.now(); // real wall-clock start, for the score's duration multiplier
    // Only the tissue actually seeded with infection above counts yet — a
    // multi-tropism loadout's other starting tissues are merely "active"
    // (targetable) until spillover or a mutation actually infects them
    // (see _runSpillover()/tropism_gain below, which grow this set).
    // Never shrinks — tropism_loss clearing a tissue doesn't un-reach it.
    this.tissuesReached = new Set([this.activeTissues[0]]);

    this._addLog(`Loadout deployed: ${this.loadout.name} targeting ${this.activeTissues.join(', ')}.`);
  }

  // ── Difficulty band from replication speed ─────────────────────
  get difficultyBand() {
    const speed = this.loadout.replication;
    for (const [name, cfg] of Object.entries(STEALTH_CONFIG.DIFFICULTY)) {
      if (speed >= cfg.speed[0] && speed <= cfg.speed[1]) return { name, ...cfg };
    }
    return { name: 'medium', ...STEALTH_CONFIG.DIFFICULTY.medium };
  }

  // How long a freshly-placed Cytokine shield lasts before it expires on
  // its own (0 = permanent, only removable via Cytokine Neutralisation —
  // same convention Antibody already uses). Each named virus has its own
  // fixed duration, identity-driven rather than tied to its replication
  // band: Norovirus's fast reinfection cycle means the immune system can't
  // afford to let shields sit for long; Influenza sits a bit longer;
  // Hepatitis's whole "chronic, persistent infection" identity is that
  // shields never lapse at all. A custom (builder) virus has no such
  // identity to key off, so it falls back to difficultyBand's own
  // cytokine_protect_turns, which scales with the replication speed chosen
  // at build time (config.js DIFFICULTY).
  effectiveCytokineProtectTurns() {
    if (this.loadout.id === 'hepatitis') return 0;
    if (this.loadout.id === 'influenza') return 4;
    if (this.loadout.id === 'norovirus') return 3;
    return this.difficultyBand.cytokine_protect_turns;
  }

  // Base replication speed (Replication Boost/speed_gain mutation already
  // baked permanently into loadout.replication) adjusted by Antiviral or
  // Protein Vaccine's temporary penalty, if currently active — the
  // immune system "counteracting" the boost for the duration of that
  // penalty rather than erasing it outright. Single source of truth for
  // both the actual spread calc (_runVirusGrowth()) and the UI's speed
  // badge (renderVirusInfoPanel()).
  effectiveReplicationSpeed() {
    let speed = this.loadout.replication;
    if (this.speedPenaltyTurns > 0) speed = Math.max(1, speed - this.speedPenaltyAmount);
    return speed;
  }

  // ── Start game ────────────────────────────────────────────────
  start() {
    this.turn = 1;
    this._runVirusGrowth();
  }

  // Called by the UI's "Continue" button to move from the current
  // (non-interactive) phase to the next one.
  advance() {
    if (this.state !== 'playing') return;
    if (this.phase === 'virus_growth')     { this._runImmuneResponse(); return; }
    if (this.phase === 'immune_response')  { this._runMutationPhase();  return; }
    if (this.phase === 'mutation')         { this._runDraftPhase();     return; }
    // 'play_cards' is interactive — advancing out of it happens via endTurn()
  }

  // ── Phase 1: autonomous virus spread ───────────────────────────
  _runVirusGrowth() {
    this.phase = 'virus_growth';
    // Penalty nudges the actual spread CHANCE, not just the attempt count
    // — see board.js _rollSpreadTargets(). Replication Boost no longer has
    // an equivalent temporary bonus of its own here: it's a permanent +1
    // to loadout.replication now (cards.js), which already raises
    // effectiveReplicationSpeed()'s attempt count on its own.
    const penalized = this.speedPenaltyTurns > 0;
    const effectiveSpeed = this.effectiveReplicationSpeed();

    const perTissue = {};
    let totalNew = 0;
    this.activeTissues.forEach(t => {
      const board = this.boards[t];
      const newCells = board.spreadVirus(effectiveSpeed, penalized);
      perTissue[t] = { count: newCells.cells.length, cells: newCells.cells, awoken: newCells.awoken };
      totalNew += newCells.cells.length;
    });

    if (this.speedPenaltyTurns > 0) this.speedPenaltyTurns--;

    const spillovers = this._runSpillover();
    this.cellsInfectedTotal += totalNew + spillovers.length;

    this.lastGrowth = { totalNew, perTissue, spillovers };
    this._addLog(`Turn ${this.turn} — Virus growth: ${totalNew} new cell(s) infected.`);
    spillovers.forEach(s => this._addLog(`Spillover: infection spread from ${s.from} into ${s.to}.`));

    this._checkWin() || this._checkLoss();
  }

  // Infection can jump from an infected tropism tissue into an ADJACENT
  // tropism tissue (board order: liver-lung-intestine — liver and
  // intestine aren't adjacent to each other) — row for row: a candidate
  // in `to`'s edge column at row R is only eligible if `from`'s OWN edge
  // cell in that same row R (the actual cell physically touching the
  // border, not just anywhere in the row) is infected or dormant. Both
  // boards' facing columns are whichever side physically touches the
  // other (leftmost/rightmost — lung faces liver on its left edge and
  // intestine on its right, since it sits between them).
  //
  // Deliberately keyed off that one specific boundary cell, not "virus
  // somewhere in the row": an earlier looser version allowed a hit as long
  // as ANY cell in the row was infected, which meant the virus could
  // appear to spread straight through a cytokine-shielded (or otherwise
  // still-healthy) border cell just because something infected sat further
  // back in that same row — visually indistinguishable from jumping the
  // shield. Each eligible border cell gets its own independent roll (see
  // _runSpillover()), rather than one roll per tissue pair picking among
  // several candidate rows — a wide, heavily infected front can now seed
  // more than one row of the neighbour in the same turn, same as a wide
  // front spreads across multiple cells within its own tissue.
  //
  // Shared by _runSpillover() (which rolls each candidate's own chance)
  // and _checkLoss() (via _hasSpilloverTarget(), which only needs to know
  // whether any candidate exists at all, so a tissue that's exhausted its
  // normal within-tissue spread isn't declared boxed in while a spillover
  // opportunity into a neighbour is still on the table).
  _spilloverCandidates() {
    const order = STEALTH_CONFIG.BOARD.ADJACENCY_ORDER;
    const candidates = [];
    order.forEach((from, i) => {
      if (!this.activeTissues.includes(from)) return;
      const fromBoard = this.boards[from];
      if (fromBoard.hasNoInfection()) return;
      [order[i - 1], order[i + 1]].filter(Boolean).forEach(to => {
        // Every tissue has a board now (pre-fortification — see the
        // constructor), so board presence alone no longer means "the
        // virus has tropism here." Spillover should still only ever jump
        // between tissues the virus is ACTIVELY infecting, same as before.
        if (!this.activeTissues.includes(to)) return;
        const toBoard = this.boards[to];
        const toIndex = order.indexOf(to);
        // Mirror-image columns: whichever side of EACH board faces the
        // other tissue.
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

  // ── Phase 2: autonomous immune response ────────────────────────
  // The immune system's turn now mirrors the player's own turn shape:
  // receives 2 random cards, decides what to play (or hold) from its
  // whole hand, and can trade 3-for-1 once it's holding enough dead
  // weight — see _maybeTradeImmuneHand() below. One shared deck/hand for
  // the whole game, not one per tissue — each card knows its own target
  // (baked in for T-Cell/Antibody, picked at play time for everything
  // else) rather than being told which board to act on by a per-tissue
  // loop, which is what this used to be.
  // Every card resolves in one uninterrupted pass — a primed T-Cell
  // Evasion (see mhcActive, played like any normal card during the
  // player's own turn) auto-cancels a matching T-Cell inline, with no
  // pause/popup needed, since the player already made that call earlier.
  _runImmuneResponse() {
    this.phase = 'immune_response';

    // mRNA Vaccine's boost is checked BEFORE ticking down, so a boost that
    // was activated last turn is still in effect this turn; a freshly-
    // played vaccine (below) only takes effect starting next turn. This
    // (and the per-tissue timers/mhcActive countdown further below) keeps
    // ticking even on a turn Activate Tregs skips — those are passive
    // effects independent of whether the immune system got to act, not
    // something a skipped turn should pause.
    const mrnaBoosted = this.mrnaBoostTurns > 0;
    if (this.mrnaBoostTurns > 0) this.mrnaBoostTurns--;

    // Every board, not just active tissues — a Cytokine shield's countdown
    // (or Antibody Escape's brief window) keeps running on a tissue that's
    // inactive because it lost tropism (see the tropism_loss mutation
    // case below) or hasn't been reached yet at all (pre-fortification);
    // it's a per-cell timer independent of whether the virus is currently
    // spreading there.
    Object.values(this.boards).forEach(board => board.tickTimers());

    // One-time cleanup once the early-dilution window closes — see
    // ImmuneDeck.pruneEarlyDilution() (cards.js). Cheap enough to just
    // re-run (a no-op after the first successful prune) rather than track
    // a separate "already pruned" flag.
    if (this.turn > STEALTH_CONFIG.IMMUNE.EARLY_DILUTION_TURNS) this.immuneDeck.pruneEarlyDilution();

    const skipped = this.immuneSkipTurns > 0;
    const played = [];
    let totalCleared = 0;
    let traded = null;

    if (skipped) {
      // Activate Tregs (virus-favourable) — the whole immune turn is
      // forfeit: no draw, no plays, no trade. Countdown decremented here
      // rather than alongside mhcActive below, so a freshly-set value of 1
      // is still the value THIS turn skips on, not already expired by the
      // time this check ran.
      this.immuneSkipTurns--;
      this._addLog(`Turn ${this.turn} — Immune response: suppressed by Activate Tregs, turn skipped.`);
    } else {
      const drawn = this.immuneDeck.drawCards(STEALTH_CONFIG.IMMUNE.DRAW_PER_TURN);
      this.immuneHand.push(...drawn);
      if (this.immuneHand.length > STEALTH_CONFIG.IMMUNE.HAND_LIMIT) {
        const overflow = this.immuneHand.splice(0, this.immuneHand.length - STEALTH_CONFIG.IMMUNE.HAND_LIMIT);
        overflow.forEach(c => this.immuneDeck.discardCard(c));
      }

      const ctx = { protectTurns: this.effectiveCytokineProtectTurns(), mrnaBoosted };

      // Per-tissue cell snapshot taken BEFORE any of this turn's cards
      // resolve — every card below applies its board effect immediately
      // (synchronously), but the UI narrates them one at a time with a delay
      // between each. Attaching each played card's pre-turn cell state (see
      // beforeStates below) lets game-ui.js keep a not-yet-narrated card's
      // cells LOOKING like this snapshot on screen until that card's own
      // narration step fires, instead of every card played this turn
      // appearing to resolve on the board all at once the moment the phase
      // starts.
      const preTurnBoardState = {};
      this.activeTissues.forEach(t => {
        preTurnBoardState[t] = this.boards[t].cells.map(row =>
          row.map(c => ({ state: c.state, cytokineColor: c.cytokineColor, protectedTurns: c.protectedTurns })));
      });

      // Snapshot instead of filtering the live array in place — a played
      // card (Protein Vaccine) can itself add new cards to this.immuneHand
      // via its own return value, and those need to survive being folded
      // into stillHeld below rather than getting silently dropped by a
      // .filter() reassignment that only knows about the pre-turn hand.
      const handSnapshot = [...this.immuneHand];
      const stillHeld = [];
      handSnapshot.forEach(card => {
        // No play-count cap (removed — balance pass): every useful card in
        // hand plays this turn, not just the first couple.
        if (!card.isUseful(this)) {
          stillHeld.push(card);
          return;
        }

        // T-Cell Evasion, if primed on this exact tissue, auto-cancels
        // a T-Cell here instead of letting it apply — consumes the priming
        // (the immune system got nothing for this attempt), but the T-Cell
        // card itself was never actually played, just deflected, so it
        // stays in hand for a future attempt rather than being discarded.
        if (card.id.startsWith('immune-tcell-') && this.mhcActive[card.tissue] > 0) {
          this.mhcActive[card.tissue] = 0;
          stillHeld.push(card);
          this._addLog(`T-Cell Evasion: blocked a T-Cell play in ${card.tissue}.`);
          return;
        }

        const result = card.apply(this, ctx);
        let cells = [];
        if (result.cleared) { cells = result.cleared; totalCleared += result.cleared.length; }
        else if (result.protectedCells) cells = result.protectedCells;
        else if (result.revealed) cells = [{ tissue: result.tissue, col: result.col, row: result.row }];
        if (result.grantedCards) stillHeld.push(...result.grantedCards);

        // Antiviral isn't tissue-specific — wherever it's played, it's the
        // exact mirror of the virus's own Replication Boost: -1 effective
        // speed and reduced spread chance across EVERY active tissue.
        // Single turn only (see ANTIVIRAL_PENALTY_TURNS) — a quick
        // knockdown rather than a sustained suppressant like Protein
        // Vaccine's own longer -1.
        if (card.id === 'immune-antiviral') {
          this.speedPenaltyTurns = (this.speedPenaltyTurns || 0) + STEALTH_CONFIG.IMMUNE.ANTIVIRAL_PENALTY_TURNS;
          this.speedPenaltyAmount = STEALTH_CONFIG.IMMUNE.ANTIVIRAL_PENALTY_AMOUNT;
          this.lastSpeedPenaltySource = 'immune-antiviral';
        }

        const beforeStates = cells.map(c => {
          const snap = (preTurnBoardState[c.tissue] || [])[c.row] && preTurnBoardState[c.tissue][c.row][c.col];
          return snap ? { tissue: c.tissue, col: c.col, row: c.row, ...snap } : null;
        }).filter(Boolean);

        // Snapshot taken RIGHT NOW — immediately after THIS card's own
        // apply() resolved, before the loop moves on to the next card in
        // hand. Every card this turn resolves synchronously in one pass,
        // well before any of it is narrated, so if a LATER card in this
        // same loop touches one of these same cells again (e.g. NK Cell
        // clears the last infected cell in a row, then Antibody protects
        // that now-empty row a few cards later), the board's LIVE state by
        // the time NK's own narration step finally reveals it would
        // already show Antibody's result too — reading as "the antibody
        // appeared before its own turn". afterStates is what THIS card's
        // own reveal step actually renders instead (see revealBoardCells(),
        // game-ui.js) — a clean freeze-frame of right after its own effect,
        // regardless of what happens to these cells later this same turn.
        const afterStates = cells.map(c => {
          const cell = this.boards[c.tissue] && this.boards[c.tissue].cells[c.row] && this.boards[c.tissue].cells[c.row][c.col];
          return cell ? { tissue: c.tissue, col: c.col, row: c.row, state: cell.state, cytokineColor: cell.cytokineColor, protectedTurns: cell.protectedTurns } : null;
        }).filter(Boolean);

        played.push({ id: card.id, name: card.name, icon: card.icon, tissue: card.tissue, cells, beforeStates, afterStates });
        this.immuneDeck.discardCard(card);
      });
      this.immuneHand = stillHeld;

      traded = this._maybeTradeImmuneHand();
    }

    // T-Cell Evasion's own countdown — decremented AFTER the hand loop
    // above (not earlier, alongside tickTimers()), so a value of N is still
    // checked at N, N-1, ..., 1 on N separate immune_response phases before
    // finally expiring at 0. Only active tissues tick down, so a tissue
    // lost to tropism_loss mid-countdown doesn't burn through its
    // remaining turns while dormant.
    this.activeTissues.forEach(t => {
      if (this.mhcActive[t] > 0) this.mhcActive[t]--;
    });

    // totalCleared is only ever populated by NK Cell/T-Cell (result.cleared
    // — DNA/RNA Sensing uses `revealed` instead, see above), so this is
    // exactly "cells the immune system took back this turn" for the score
    // (see cellsInfectedTotal's own comment, constructor).
    this.cellsInfectedTotal = Math.max(0, this.cellsInfectedTotal - totalCleared);

    this.lastImmune = { totalCleared, played, handSize: this.immuneHand.length, mrnaBoosted, skipped, traded };
    if (!skipped) {
      this._addLog(`Turn ${this.turn} — Immune response: ${totalCleared} cell(s) cleared.`);
      played.forEach(p => this._addLog(`Immune: ${p.name} played.`));
      if (traded) this._addLog(`Immune system traded 3 cards for ${traded.received}.`);
    }

    this._checkWin() || this._checkLoss();
  }

  // Mirrors the player's own Trade 3▸1 (see tradeCards()), but resolved
  // automatically like every other immune action instead of shown as a
  // choice — once the hand holds 3+ cards that are ALL currently dead
  // weight (none of them would do anything if played right now), trade
  // the first 3 of them for whichever card in the deck WOULD actually be
  // useful this turn. Skips the trade entirely if nothing in the deck
  // would help right now, rather than trading blind.
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

  // ── Phase 3: mutation (chance) ──────────────────────────────────
  // Every non-'none' outcome is explicitly tagged as a GAIN (favours the
  // virus) or a LOSS (favours the immune system) plus a category, so the
  // UI can badge it unambiguously rather than leaving the player to infer
  // whether a given mutation helped or hurt.
  _runMutationPhase() {
    this.phase = 'mutation';
    // Driven by the virus's own Low/Medium/High mutation-rate slider, not
    // the replication-speed difficulty band (that only sets spread/immune
    // tuning — see difficultyBand) — see MUTATION_PROB_BY_RATE, config.js.
    const mutationProb = STEALTH_CONFIG.MUTATION_PROB_BY_RATE[this.loadout.mutation]
      ?? STEALTH_CONFIG.MUTATION_PROB_BY_RATE.low;

    if (Math.random() > mutationProb) {
      this.lastMutation = null;
      this._addLog('Mutation phase: no mutation this turn.');
      return;
    }

    const event = this._weightedPick(this._effectiveMutationTable());
    let category = null, direction = null, text = '', tissue = null, color = null;

    switch (event) {
      case 'none':
        text = 'The virus did not mutate';
        break;

      case 'speed_gain':
        category = 'Replication Speed'; direction = 'gain';
        this.loadout = { ...this.loadout, replication: Math.min(10, this.loadout.replication + 1) };
        // effectiveReplicationSpeed(), not loadout.replication directly —
        // while an Antiviral/Protein Vaccine penalty is active the two
        // differ, and the badge (renderVirusInfoPanel(), game-ui.js) always
        // shows the effective one; logging the raw base here made the
        // mission log report a number that didn't match what the player
        // could actually see on screen.
        text = `Mutation - replication speed increased to ${this.effectiveReplicationSpeed()}`;
        break;

      case 'speed_loss':
        category = 'Replication Speed'; direction = 'loss';
        this.loadout = { ...this.loadout, replication: Math.max(1, this.loadout.replication - 1) };
        text = `Mutation - replication speed decreased to ${this.effectiveReplicationSpeed()}`;
        break;

      case 'escape_gain': {
        // Grants the card to hand for the player to play when they choose
        // — was applying grantEscapeImmunity() directly instead, which
        // showed up as an already-active effect in the virus's Active
        // Cards banner rather than a playable card in hand, same as every
        // other mutation-gained card (cytokine_neutralise_gain below).
        // escape_loss (the opposite) stays a direct board effect, since
        // it's stripping an EXISTING active effect, not granting a card.
        category = 'Antibody Escape'; direction = 'gain';
        const t = this.activeTissues[Math.floor(Math.random() * this.activeTissues.length)];
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
        // The direct mirror of escape_gain granting a card to hand above —
        // pulls an unplayed Antibody Escape straight back out of hand,
        // falling back to stripping a currently-active escapeImmune effect
        // on the board only if the player isn't holding one right now
        // (ESCAPE_IMMUNITY_TURNS is just 1 turn — see config.js — so that
        // window is usually already closed by the time this could roll).
        // Only rollable at all when at least one of the two is actually
        // true (see _effectiveMutationTable()) — previously this always
        // targeted the board effect, which by then had almost always
        // already expired on its own, making this mutation a near-total
        // no-op in practice.
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
        category = 'Latency'; direction = 'gain';
        const t = this.activeTissues[Math.floor(Math.random() * this.activeTissues.length)];
        const board = this.boards[t];
        // Same one-row-past-the-front limit as the player's own Latency
        // card (see board.placeDormant) — only search candidate rows the
        // placement would actually accept.
        const maxRow = Math.min(board._deepestInfectedRow() + 1, board.rows - 1);
        const healthy = [];
        for (let r = 0; r <= maxRow; r++) {
          board.cells[r].forEach((cell, c) => { if (cell.state === 'healthy') healthy.push({ c, r }); });
        }
        if (healthy.length) {
          const pick = healthy[Math.floor(Math.random() * healthy.length)];
          board.placeDormant(pick.c, pick.r, 2);
          tissue = t;
          text = 'Mutation - gained Latency';
        } else {
          text = 'Mutation - latency reactivation failed - no healthy cells available';
        }
        break;
      }

      case 'tropism_loss': {
        // The exact opposite of tropism_gain below — deactivates one of
        // the virus's own currently-active tissues, dropping it out of
        // activeTissues so it stops growing/spreading and can no longer
        // be targeted by the player's own cards or count toward the win
        // condition. Whatever infection is already sitting there is left
        // exactly as it is, not cleared — this represents the virus lying
        // dormant in a tissue the immune system has gotten the upper hand
        // in, not the immune system sterilising it outright. It stays
        // frozen in place (immune to further NK Cell/T-Cell/Antibody
        // pressure too, same as any other inactive board) until a future
        // tropism_gain mutation picks this tissue again, at which point
        // it's back in activeTissues and starts spreading again right from
        // where it was left off (plus whatever fresh seedInfection() adds
        // on top — see tropism_gain below). Cytokine shields already
        // placed here keep counting down regardless (tickTimers() below
        // now runs on every board, not just active ones), same as any
        // other inactive tissue.
        category = 'Tropism'; direction = 'loss';
        const t = this.activeTissues[Math.floor(Math.random() * this.activeTissues.length)];
        this.activeTissues = this.activeTissues.filter(x => x !== t);
        tissue = t;
        text = `Mutation - lost Tropism (${_capitalize(t)})`;
        break;
      }

      case 'latency_loss': {
        category = 'Latency'; direction = 'loss';
        const candidates = this.activeTissues.filter(t => this.boards[t].hasDormant());
        if (candidates.length) {
          const t = candidates[Math.floor(Math.random() * candidates.length)];
          this.boards[t].clearDormant();
          tissue = t;
          text = 'Mutation - lost Latency';
        } else {
          text = 'Mutation - latency loss failed - no dormant cells';
        }
        break;
      }

      case 'tropism_gain': {
        // Reuses the tissue's existing board (see the constructor comment)
        // rather than creating a fresh one — if the immune system had
        // already pre-fortified it with Antibody/Cytokine while it was
        // inactive, that protection is still there the moment the virus
        // actually arrives. Already-infects-every-tissue is handled
        // upstream now (see _effectiveMutationTable(), which zeroes this
        // event's own weight in that case), so `inactive` is guaranteed
        // non-empty here — nothing left to do in an else branch that can't
        // actually be reached.
        category = 'Tropism'; direction = 'gain';
        const inactive = STEALTH_CONFIG.BOARD.ADJACENCY_ORDER.filter(t => !this.activeTissues.includes(t));
        const t = inactive[Math.floor(Math.random() * inactive.length)];
        this.boards[t].seedInfection();
        this.activeTissues.push(t);
        this.tissuesReached.add(t);
        tissue = t;
        text = `Mutation - gained Tropism (${_capitalize(t)})`;
        break;
      }

      case 'cytokine_neutralise_gain': {
        category = 'Cytokine Neutralisation'; direction = 'gain';
        const colors = ['blue', 'orange', 'red'];
        color = colors[Math.floor(Math.random() * colors.length)];
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

    this.lastMutation = { event, category, direction, text, tissue, color };
    this._addLog(`Mutation: ${text}`);

    // tropism_loss can drop the virus's last active tissue (activeTissues
    // empty) or its last surviving infection anywhere (allClear, see
    // _checkLoss()) — checking right here catches either the instant it
    // happens, rather than waiting a full dead play_cards turn (where the
    // player would have nothing left to target) for the NEXT virus_growth
    // phase to notice.
    this._checkWin() || this._checkLoss();
  }

  // ── Phase 4: play cards ─────────────────────────────────────────
  _runDraftPhase() {
    this.phase = 'play_cards';
    this.currentOffer = this.deck.offerDraft();
    // Replication Boost's Active Cards badge only lasts until the next
    // pick-cards phase (see showReplicationBoostBadge, constructor) — the
    // permanent +1 itself stays regardless, this just stops re-announcing
    // it every turn.
    this.showReplicationBoostBadge = false;
    // UI takes over: player picks from currentOffer, then plays from hand,
    // then calls endTurn()
  }

  // Called by UI once the player has chosen which offered cards to keep
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

  // Trade exactly 3 chosen hand cards for 1 card of the player's choice —
  // any type that exists anywhere in this virus's own deck (draw pile,
  // discard pile, or hand), not a random draw. Free action, doesn't cost
  // the turn — lets a bad run of draws be corrected instead of sitting
  // stuck holding cards with nothing useful to do.
  tradeCards(handIndexes, chosenCardId) {
    if (this.phase !== 'play_cards') return { ok: false, reason: 'Not in play phase.' };
    const uniqueIndexes = [...new Set(handIndexes)];
    if (uniqueIndexes.length !== 3) return { ok: false, reason: 'Choose exactly 3 cards to give up.' };
    if (uniqueIndexes.some(i => i < 0 || i >= this.hand.length)) return { ok: false, reason: 'Invalid card index.' };
    const def = STEALTH_CARD_DEFS[chosenCardId];
    if (!def) return { ok: false, reason: 'Invalid card choice.' };

    // Descending order so earlier splices don't shift the indexes still
    // to be removed.
    [...uniqueIndexes].sort((a, b) => b - a).forEach(i => {
      const card = this.hand.splice(i, 1)[0];
      this.deck.discardCard(card);
    });
    this.hand.push({ ...def });
    this._addLog(`Traded 3 card(s) for ${def.name}.`);
    return { ok: true, result: { text: `Traded 3 cards for ${def.name}.`, cardName: def.name } };
  }

  // Called by UI when player selects a card and target
  playCard(handIndex, target) {
    if (this.phase !== 'play_cards') return { ok: false, reason: 'Not in play phase.' };
    if (handIndex < 0 || handIndex >= this.hand.length) return { ok: false, reason: 'Invalid card index.' };

    const card = this.hand[handIndex];
    const state = {
      replication: this.loadout.replication,
      showReplicationBoostBadge: this.showReplicationBoostBadge,
      immuneSkipTurns: this.immuneSkipTurns,
      mhcActive: this.mhcActive,
      activeTissues: this.activeTissues,
    };

    const result = card.apply(this.boards, target, state);

    this.loadout = { ...this.loadout, replication: state.replication };
    this.showReplicationBoostBadge = state.showReplicationBoostBadge;
    this.immuneSkipTurns = state.immuneSkipTurns;
    this.mhcActive       = state.mhcActive;

    // Only actually spend the card if the play succeeded — every apply()
    // now returns an explicit ok flag. Without this, clicking an invalid
    // target (e.g. a cell already protected by an immune card) silently
    // wasted the card for nothing.
    if (result.ok === false) {
      this._addLog(result.text);
      return { ok: false, result };
    }

    // this.score itself isn't touched here — it's never shown during play
    // (see renderEndScreen(), game-ui.js) and is only ever computed once,
    // in full, at _finalizeScore() on a win.
    this.cellsInfectedTotal += result.count || 0;

    this.hand.splice(handIndex, 1);
    this.deck.discardCard(card);

    this._addLog(result.text);
    return { ok: true, result };
  }

  // ── End turn (called when player presses "End Turn") ─────────
  endTurn() {
    if (this.phase !== 'play_cards') return;
    if (this._checkWin()) return;
    if (this._checkLoss()) return;
    this.turn++;
    this._runVirusGrowth();
  }

  // ── Win/lose checks ───────────────────────────────────────────
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
    // Every board, not just active tissues — a tropism_loss mutation
    // leaves its infected cells frozen in place rather than clearing them
    // (see that case, above), so a tissue can still genuinely hold virus
    // while sitting inactive. "No infected cells remain anywhere" should
    // mean exactly that.
    const allClear = Object.values(this.boards).every(b => b.hasNoInfection());
    if (allClear) {
      this.state = 'lost';
      this._addLog(`✗ LOSS: no infected cells remain anywhere — the immune system won on turn ${this.turn}.`);
      this._saveScore();
      return true;
    }
    // Boxed in — every infected cell on every ACTIVE board has no healthy
    // cell left to spread into (horizontal or vertical), so the virus can
    // never reach the bottom row from here.
    // "Boxed in" means no active tissue has a within-board spread target
    // AND there's no cross-tissue spillover opportunity either — a tissue
    // that's filled every reachable cell locally can still keep going by
    // spilling into a clean, tropism-active neighbour. Requires at least
    // one active tissue to even ask the question — a virus with ZERO
    // active tissues (every one currently lost to tropism_loss) isn't
    // "boxed in" so much as dormant, still holding frozen infection
    // somewhere and waiting on a tropism_gain mutation to pick one of
    // those tissues back up; that's the allClear check's call to make
    // instead, not this one's.
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

  // ── Scoring and persistence ───────────────────────────────────
  _saveScore() {
    try {
      const key  = 'iq_score_stealth';
      const best = parseInt(localStorage.getItem(key) || '0');
      // Read by renderEndScreen() (game-ui.js) to show a "New High Score"
      // callout — captured here, not recomputed there, since by the time
      // the end screen renders localStorage's own value has already been
      // overwritten to match this run's score, making a same-value
      // comparison at render time meaningless.
      this.isNewHighScore = this.score > best;
      if (this.isNewHighScore) localStorage.setItem(key, String(this.score));
      if (this.state === 'won') localStorage.setItem('iq_cleared_stealth', '1');
      const played = parseInt(localStorage.getItem('iq_played') || '0');
      localStorage.setItem('iq_played', String(played + 1));
    } catch (e) { /* localStorage may not be available */ }
  }

  // Computes the run's score, once, on a win only — never on a loss (see
  // renderEndScreen(), game-ui.js, which only shows the score block when
  // won). cellsInfectedTotal is the net cells-infected count tracked
  // throughout the game (growth/spillover/card plays, minus NK Cell/T-Cell
  // clears — see that field's own comment, constructor); duration and
  // difficulty then scale it from there.
  _finalizeScore() {
    const cfg = STEALTH_CONFIG.SCORE;
    const minutes = (Date.now() - this.missionStartTime) / 60000;
    const durationMult = this._durationMultiplier(minutes);
    const difficultyMult = this.difficultyBand.score_mult;
    const cellsScore = this.cellsInfectedTotal * cfg.PTS_PER_CELL * durationMult;
    const tissueBonus = this.tissuesReached.size * cfg.PTS_PER_TISSUE_REACHED;
    const subtotal = cellsScore + tissueBonus + cfg.WIN_BONUS;
    this.score = Math.round(subtotal * difficultyMult);
    // Exposed for the end screen / debugging, not required by scoring itself.
    this.scoreBreakdown = {
      cellsInfected: this.cellsInfectedTotal,
      minutes: Math.round(minutes * 10) / 10,
      durationMult, difficultyMult, tissueBonus,
      winBonus: cfg.WIN_BONUS,
    };
  }

  // Piecewise-linear interpolation over SCORE.DURATION_MULT_CURVE — flat
  // at the first breakpoint's multiplier before it, flat at the last
  // breakpoint's multiplier beyond it.
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

  // ── Helpers ───────────────────────────────────────────────────
  // Antigenic Drift is a passive builder ability (not a real playable
  // card — see ABILITY_IDS, index.html): the virus's surface proteins
  // shift often enough that it frequently rolls into gaining antibody
  // escape, so it biases its own roll toward escape_gain rather than
  // getting a flat global weight. Influenza carries this ability by
  // default; any custom-built virus can opt into it too.
  // tropism_loss is also rescaled here every roll, not just for
  // Antigenic-Drift loadouts — see TROPISM_LOSS_MULT_BY_ACTIVE_TISSUES
  // (config.js).
  //
  // A handful of events are gated to specific viruses (see the comment on
  // MUTATION, config.js) — zeroed out here rather than removed from the
  // base table, so the switch in _runMutationPhase() stays generic.
  _effectiveMutationTable() {
    const mult = STEALTH_CONFIG.TROPISM_LOSS_MULT_BY_ACTIVE_TISSUES[this.activeTissues.length] ?? 1;
    const table = { ...STEALTH_CONFIG.MUTATION, tropism_loss: STEALTH_CONFIG.MUTATION.tropism_loss * mult };
    const abilities = this.loadout.abilities || [];
    if (abilities.includes('antigenic-drift')) table.escape_gain *= 3;
    if (!abilities.includes('latency')) { table.latency_gain = 0; table.latency_loss = 0; }
    if (this.loadout.id !== 'influenza') {
      table.escape_loss = 0;
    } else {
      // Nothing for escape_loss to actually take away — no unplayed
      // Antibody Escape in hand, and no tissue currently has its
      // (usually already-expired, see _runMutationPhase()) board effect
      // active either. Zeroed the same way the other "impossible right
      // now" entries below are, rather than letting it roll and land on
      // a card the player was never holding.
      const hasEscapeCard = this.hand.some(c => c.id.startsWith('antibody-escape-'));
      const hasActiveEscape = this.activeTissues.some(t => this.boards[t].cells.some(row => row.some(c => c.escapeImmune > 0)));
      if (!hasEscapeCard && !hasActiveEscape) table.escape_loss = 0;
    }
    if (this.loadout.id === 'norovirus') table.tropism_gain = 0;
    // Already infects every tissue — nothing left to gain tropism INTO, so
    // zero this out here too (same technique as Norovirus's own override
    // above) instead of letting _runMutationPhase() roll it and then have
    // to fail outright. Its weight redistributes proportionally across
    // whatever else is still available (including 'none'), same as any
    // other zeroed-out entry — see _weightedPick() below.
    if (this.activeTissues.length >= STEALTH_CONFIG.BOARD.TISSUES.length) table.tropism_gain = 0;
    return table;
  }

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

  _addLog(msg) {
    this.log.unshift(`T${this.turn}: ${msg}`);
    if (this.log.length > 30) this.log.pop();
  }
}
