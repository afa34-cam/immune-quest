// ═══════════════════════════════════════════════════════════════════
//  IMMUNE QUEST — Stealth Mission (play as the virus)
//  config.js — All game constants in one place. Mirrors games/cancer/config.js
//  structure with roles reversed: the player spreads infection, the immune
//  system is the autonomous antagonist.
// ═══════════════════════════════════════════════════════════════════

const STEALTH_CONFIG = {

  // ── Board — one sub-board per tissue, 5 wide x 10 deep ─────────
  BOARD: {
    COLS: 5,
    ROWS: 10,
    TISSUES: ['lung', 'liver', 'intestine'],
    // Left-to-right visual order — also defines spillover adjacency
    // (only immediate neighbours in this list can spill into each other;
    // liver and intestine are NOT adjacent to each other).
    ADJACENCY_ORDER: ['liver', 'lung', 'intestine'],
    // Independent per-cell chance for each of the 5 non-guaranteed cells in
    // the starting-seed block to end up infected — see seedInfection()
    // (board.js) for the block shape and connectivity rule.
    SEED_CELL_CHANCE: 0.5,
  },

  // ── Difficulty (driven by the virus's own replication stat, set at
  //     loadout time in the builder, not a separate menu choice) ──
  DIFFICULTY: {
    // Keyed by replication speed band (1-10 slider from the builder).
    // cytokine_protect_turns: how long a Cytokine's protection lasts before
    // the shielded cells revert to healthy — 0 means permanent (same
    // convention Antibody/Hepatitis already use, see protectRow()/
    // protectShape(), board.js). The 3 named viruses (Influenza/Norovirus/
    // Hepatitis) each have their own fixed duration instead, regardless of
    // band — see effectiveCytokineProtectTurns(), game.js. This per-band
    // scale is what a CUSTOM (builder) virus actually gets, keyed off its
    // own chosen replication speed: 3 turns at the slowest up to permanent
    // at the fastest. (Was flat 3 at every band — balance pass; cytokine
    // protection scaling up to 5 turns at extreme was giving the immune
    // system too durable a lock on top of Antibody/T-Cell's own row-level
    // power, but flat 3 undershot for the fastest, most dangerous viruses.)
    // score_mult: applied to the whole final score (see _finalizeScore(),
    // game.js) — a faster-replicating virus faces a proportionally
    // stronger immune response (immune_response_strength above), so
    // beating one is worth more than an easy slow-band win.
    slow:   { speed: [1, 3],  immune_response_strength: 0.35, cytokine_protect_turns: 3, score_mult: 0.8 },
    medium: { speed: [4, 6],  immune_response_strength: 0.50, cytokine_protect_turns: 4, score_mult: 1.0 },
    fast:   { speed: [7, 8],  immune_response_strength: 0.65, cytokine_protect_turns: 5, score_mult: 1.2 },
    extreme:{ speed: [9, 10], immune_response_strength: 0.80, cytokine_protect_turns: 0, score_mult: 1.4 },
  },

  // ── Mutation frequency — keyed by the virus's own Low/Medium/High
  //     mutation-rate slider (loadout.mutation), NOT the replication speed
  //     band above. This is the per-turn chance a mutation attempt happens
  //     at all (see _runMutationPhase, game.js) — even then, the roll
  //     within MUTATION below still has its own 'none' weight, so this
  //     isn't the only thing standing between a virus and a mutation.
  // 'high' bumped hard (was 0.50) — Influenza is the only built-in virus at
  // this rate, and the ask was mutation happening nearly every turn there,
  // compounding with its Antigenic Drift ability (3x escape_gain weight)
  // to make frequent free Antibody Escape its whole identity.
  MUTATION_PROB_BY_RATE: { low: 0.15, medium: 0.30, high: 0.90 },

  // ── Virus spread (autonomous baseline, phase 1 each turn) ───────
  SPREAD: {
    // Balance pass: trial runs were winning too easily and too quickly —
    // cut back down from 0.80 (which itself was buffed up from 0.60, then
    // 0.70 over earlier passes), vertical more than horizontal since it's
    // the one that drives straight toward the win condition. Trimmed
    // again after a further round of testing (0.55/0.28 was still not
    // enough resistance).
    WEIGHT_DOWN: 0.48,
    WEIGHT_SIDE: 0.24,  // each side — was 0.20, then 0.25, then 0.35, then 0.28
    // Subtracted from the weights above while a speed penalty (Antiviral /
    // Protein Vaccine) is active — see board.js _rollSpreadTargets().
    // Clamped to [0,1]. (Named for the general +/-0.15 swing rather than
    // this one remaining use — Replication Boost used to add it too,
    // before becoming a permanent loadout.replication increase instead.)
    BOOST_CHANCE_BONUS: 0.15,
    // Cascading spread (see spreadVirus(), board.js) — a cell infected
    // THIS phase immediately gets its own chance to infect ITS neighbours
    // too, same turn, not just the cells that were already infected
    // before the phase started. Left undecayed, this was an effectively
    // unbounded flood fill — verified live: 19-29 of 49 cells on an empty
    // board from a single source in one phase at high replication speed,
    // and still 10-25 even at the lowest speed. CASCADE_DECAY multiplies
    // the side/down chance by itself once per hop away from the original
    // (pre-turn) infected cells — depth 0 (the originals) is unaffected.
    // Was 0.6 (depth1 60%, depth2 36%, depth3 ~22%) — lowered for more
    // difficulty, tapering out faster: depth1 40%, depth2 16%, depth3
    // ~6%. CASCADE_MAX_DEPTH is a hard backstop on top of that, not the
    // primary limiter — the decay alone makes anywhere near that deep
    // vanishingly unlikely, it's just insurance against an unlucky (well,
    // lucky) long roll chain.
    CASCADE_DECAY: 0.4,
    CASCADE_MAX_DEPTH: 5,
  },

  // ── Immune response (autonomous, phase 2 each turn) ─────────────
  //  The immune system draws from its own weighted deck (see cards.js
  //  IMMUNE_CARD_DEFS / buildImmuneDeckCounts) and builds its hand the same
  //  way the virus does: offer 3, auto-keep 1 (resolved instantly, never
  //  shown to the player), then plays whatever in hand is currently
  //  useful, holding the rest for a later turn.
  //  PICK_COUNT is deliberately lower than the player's own (2) — the
  //  player actively burns their hand down most turns, but the immune
  //  system only plays a card once its isUseful() condition is met, which
  //  can take several turns per card. Drafting at the player's rate while
  //  consuming slower meant its hand just climbed straight to HAND_LIMIT
  //  and sat there; 1 a turn keeps intake roughly matched to how fast it
  //  actually plays things.
  IMMUNE: {
    HAND_LIMIT: 6,
    // Cards drawn per turn — see _runImmuneResponse() (game.js). Flat,
    // not scaled by how many tissues are currently active.
    DRAW_PER_TURN: 2,
    // How many turns cards.js's EARLY_DILUTION_BONUS (extra NK Cell/Blue
    // Cytokine copies, protecting a fresh beachhead) stays in the deck —
    // see ImmuneDeck.pruneEarlyDilution(), cards.js, called once turn
    // exceeds this from _runImmuneResponse() below.
    EARLY_DILUTION_TURNS: 5,
    // No cap on how many cards get played in one turn (removed — balance
    // pass) — held cards only get re-checked (not re-drawn) each turn, so
    // several can become useful on the same turn at once (e.g. a big
    // spread event suddenly satisfies T-Cell's row threshold AND a couple
    // of Cytokine targets together), and now all of them play the moment
    // they're useful instead of some sitting capped-out in hand until a
    // later turn. Naturally bounded by HAND_LIMIT above regardless.
    // Antibody Escape is only active for the turn it's played — was 2.
    // tickTimers() (board.js) decrements this at the START of the next
    // immune_response phase, BEFORE that phase's own card-play loop
    // processes any T-Cell/NK-Cell, so at 1 turn the protection window is
    // just "for the rest of the turn it was played, when nothing threatens
    // it anyway" (immune_response already happened earlier that same
    // turn) — the card's real value is the immediate, one-time
    // clearAntibodyProtection() break-through (see cards.js), with the
    // Active Cards banner correctly dropping it the very next turn.
    ESCAPE_IMMUNITY_TURNS: 1,
    // T-Cell Evasion (MHC-I Downregulation) stays primed for this many
    // immune_response phases before it expires unused — see mhcActive,
    // _runImmuneResponse() (game.js). Was indefinite (stayed primed
    // forever until it actually blocked a T-Cell).
    MHC_EVASION_TURNS: 3,
    // Permanent, unlike Protein Vaccine's own temporary (if deeper — see
    // PROTEIN_SPEED_PENALTY_AMOUNT below) -2 — every successful Antiviral
    // play knocks another ANTIVIRAL_PENALTY_AMOUNT off replication speed
    // for the rest of the game (see effectiveReplicationSpeed(), game.js).
    ANTIVIRAL_PENALTY_AMOUNT: 1,
  },

  // ── Vaccines — part of the one shared immune deck now (cards.js
  //     IMMUNE_CARD_DEFS), not a separate deck. ─────────────────────────
  VACCINE: {
    MRNA_BOOST_TURNS: 3,     // boosts T-Cell row-size + Cytokine shape tier for N turns
    MRNA_TCELL_EXTRA_ROWS: 1, // extra row cleared while boosted
    PROTEIN_SPEED_PENALTY_TURNS: 3,  // Protein Vaccine's replication-speed debuff duration
    PROTEIN_SPEED_PENALTY_AMOUNT: 2, // stronger than Antiviral's -1 — a sustained, deeper suppressant
  },

  // ── Spillover — infection can jump from an infected tissue into an
  //     adjacent one the player also has tropism for, row by row across the
  //     shared boundary — a row is only eligible if the SOURCE tissue's own
  //     boundary-edge cell in that exact row is infected/dormant (not just
  //     infected somewhere else in the row — see _spilloverCandidates(),
  //     game.js, for why that distinction matters: a looser "anywhere in
  //     the row" version let the virus visibly jump straight through a
  //     cytokine-shielded border cell). Each eligible row gets its own
  //     independent CHANCE roll every turn, so a wide, heavily infected
  //     front can seed more than one row of the neighbour at once — this
  //     is NOT one shared roll per tissue pair. One Antibody/Cytokine
  //     blocking a single row doesn't seal a tissue off from spillover
  //     entirely, since other rows can still have virus facing them — but
  //     spillover can no longer land somewhere with nothing infected
  //     directly across from it. See _runSpillover() (game.js) for the
  //     full mechanic. ──────────────────────────────────────────────────
  SPILLOVER: {
    // Deliberately kept below SPREAD.WEIGHT_SIDE (same-tissue horizontal
    // spread) — crossing into another tissue should be rarer than
    // spreading within one, but still a real, regularly-occurring threat
    // rather than a fluke.
    CHANCE: 0.20,   // independent roll per eligible border row, per turn
  },

  // ── Mutation table (phase 3, chance) — each non-'none' entry is either
  //     a GAIN (helps the virus) or a LOSS (helps the immune system); the
  //     UI tags each one so the effect is never ambiguous. Some entries are
  //     only available to specific viruses — see _effectiveMutationTable()
  //     (game.js), which zeroes them out for everyone else:
  //       - latency_gain/latency_loss: only viruses with the Latency
  //         ability (Hepatitis is the only built-in one)
  //       - escape_loss: Influenza only
  //       - tropism_gain: everyone except Norovirus (stays intestine-only)
  //     Every other entry (none/speed_gain/speed_loss/escape_gain/
  //     tropism_loss/cytokine_neutralise_gain) is available to all
  //     viruses at this same base weight. ──────────────────────────────
  MUTATION: {
    none:          0.38,
    speed_gain:    0.10,
    speed_loss:    0.07,
    escape_gain:   0.10,
    escape_loss:   0.07,   // Influenza only — see comment above
    latency_gain:  0.10,   // Latency-ability viruses only — see comment above
    latency_loss:  0.06,   // Latency-ability viruses only — see comment above
    // Grants a random Cytokine Neutralisation card (blue/orange/red) to
    // hand — the mutation-phase equivalent of drawing one, since there's
    // no board state to directly flip the way escape_gain has.
    cytokine_neutralise_gain: 0.10,
    // tropism_loss deactivates one of the virus's own active tissues
    // (the exact opposite of tropism_gain activating a new one) — this is
    // the BASE weight, further scaled at roll time by how many tissues are
    // currently active (see TROPISM_LOSS_MULT_BY_ACTIVE_TISSUES below /
    // _effectiveMutationTable() in game.js): losing your only front is
    // brutal, so it should be extremely rare with just 1 active; losing
    // one of several is a lot less punishing, so it scales up with 2-3.
    // tropism_gain stays the more frequent of the pair overall.
    tropism_loss:  0.05,
    // Buffed from 0.07, then 0.22, now further — a lone starting tissue
    // getting boxed in before a second front ever opened was the single
    // biggest cause of early losses (see balance-pass notes); this gets a
    // second tissue open much more reliably within the first several
    // turns for every virus that can gain tropism at all. Not Norovirus,
    // which zeroes this out entirely (see comment above, stays
    // intestine-only) — so Norovirus doesn't benefit from this buff at all,
    // by design (it leans on spread speed instead — see
    // NOROVIRUS_VERTICAL_BONUS/NOROVIRUS_HORIZONTAL_BONUS).
    tropism_gain:  0.40,
  },

  // Multiplies MUTATION.tropism_loss's base weight by the virus's current
  // active-tissue count at roll time — see _effectiveMutationTable() in
  // game.js. Keyed by activeTissues.length (1-3, board only ever has 3
  // tissue slots total).
  TROPISM_LOSS_MULT_BY_ACTIVE_TISSUES: { 1: 0.1, 2: 0.8, 3: 1.3 },

  // ── Infect-cell card counts, scaled by difficulty band ────────────
  //  Deliberately rare — infection cards are the virus's core spread
  //  mechanic and shouldn't dominate the deck the way they used to.
  //  Vertical spread pushes straight toward the bottom row (the win
  //  condition), so it's kept extremely rare across every band; horizontal
  //  spread (sideways — doesn't advance toward winning) is still rare but
  //  deliberately more frequent than vertical.
  INFECT_CARDS: {
    slow:    { horizontal: 2, vertical: 1 },
    medium:  { horizontal: 2, vertical: 1 },
    fast:    { horizontal: 3, vertical: 1 },
    extreme: { horizontal: 3, vertical: 1 },
  },
  // Norovirus specifically gets more vertical- AND horizontal-spread cards
  // than other viruses (added on top of INFECT_CARDS above) — matching its
  // real-world reputation as explosively fast; bumped further in the
  // balance pass targeting an ~80% win rate for it specifically. Norovirus
  // never gains a second tissue (tropism_gain is zeroed for it — see
  // MUTATION.tropism_gain's own comment), so unlike Influenza/Hepatitis it
  // has no "open a second front" escape valve against being boxed in —
  // this and the immune-deck dilution below (buildImmuneDeckCounts(),
  // cards.js) are its whole compensation for that, leaning fully into
  // "explosively fast" rather than "evasive". See cards.js
  // StealthDeck._buildFromLoadout.
  NOROVIRUS_VERTICAL_BONUS: 9,
  NOROVIRUS_HORIZONTAL_BONUS: 7,
  // The opposite lean for Hepatitis — its whole identity is a slow,
  // chronic, "silent" infection (see its own flavour text) rather than an
  // aggressive spreader, and it already has other strengths to lean on
  // instead (permanent Cytokine immunity, Latency, T-Cell Evasion — see
  // its abilities). Vertical is already at INFECT_CARDS' own floor (1) for
  // every band, so there's nothing left to cut there without removing the
  // card outright; horizontal is what actually gets rarer for it.
  HEPATITIS_HORIZONTAL_PENALTY: 1,

  // ── Cards / hand ─────────────────────────────────────────────────
  CARDS: {
    OFFER_COUNT: 3,    // cards offered each draft
    PICK_COUNT: 2,     // cards the player picks from the offer
    HAND_LIMIT: 8,
  },

  // ── Win / lose ───────────────────────────────────────────────────
  //  Win:  the virus reaches the bottom row of any active tissue board.
  //  Lose: the virus has no infected cells left anywhere (fully cleared).
  WIN: {
    BOTTOM_ROW_TISSUES_REQUIRED: 1, // reaching the bottom row of this many tissues wins
  },

  // ── Scoring — only ever computed/shown on a WIN, see _finalizeScore()
  //     (game.js). cellsInfectedTotal (the net cells-infected count, minus
  //     whatever NK Cell/T-Cell cleared back to healthy along the way) is
  //     the base; duration and difficulty scale it from there. ───────────
  SCORE: {
    PTS_PER_CELL: 10,
    WIN_BONUS: 500,
    PTS_PER_TISSUE_REACHED: 150, // per distinct tissue the virus ever reached (tropism_gain), not just active at the end
    // Wall-clock minutes -> multiplier on the cells-infected component,
    // piecewise-linear between these breakpoints — flat before the first
    // and after the last. Peaks for a 5-10min game (the target pace from
    // the balance pass); rushed or dragged-out games score lower.
    DURATION_MULT_CURVE: [
      { min: 0,  mult: 0.4 },
      { min: 2,  mult: 0.4 },
      { min: 5,  mult: 1.0 },
      { min: 10, mult: 1.0 },
      { min: 15, mult: 0.6 },
    ],
  },

};

Object.freeze(STEALTH_CONFIG);
