// ═══════════════════════════════════════════════════════════════════
//  IMMUNE QUEST — Stealth Mission (play as the virus)
//  config.js — every tunable game constant, in one place.
//
//  Contents
//    1. Board
//    2. Difficulty bands (from replication speed)
//    3. Mutation frequency
//    4. Virus spread
//    5. Immune system
//    6. Vaccines
//    7. Spillover between tissues
//    8. Mutation table
//    9. Player deck composition
//   10. Replication speed limits
//   11. Cards / hand
//   12. Win condition
//   13. Scoring
// ═══════════════════════════════════════════════════════════════════

const STEALTH_CONFIG = {

  // ── 1. Board — one sub-board per tissue, 5 wide × 10 deep ─────────
  BOARD: {
    COLS: 5,
    ROWS: 10,
    TISSUES: ['lung', 'liver', 'intestine'],
    // Left-to-right on screen. Also defines which tissues touch for
    // spillover: only neighbours in this list (liver and intestine don't).
    ADJACENCY_ORDER: ['liver', 'lung', 'intestine'],
    // Chance for each optional cell of the starting seed block to be
    // infected — see seedInfection(), board.js.
    SEED_CELL_CHANCE: 0.5,
  },

  // ── 2. Difficulty bands — chosen by the virus's replication speed ──
  //  immune_response_strength: how hard the immune system pushes back.
  //  cytokine_protect_turns: how long a Cytokine shield lasts (0 = permanent).
  //    Only custom (builder) viruses use this; the three named viruses have
  //    fixed durations — see effectiveCytokineProtectTurns(), game.js.
  //  score_mult: multiplies the final score — beating a faster virus's
  //    stronger immune response is worth more.
  DIFFICULTY: {
    slow:   { speed: [1, 3],  immune_response_strength: 0.35, cytokine_protect_turns: 3, score_mult: 0.8 },
    medium: { speed: [4, 6],  immune_response_strength: 0.50, cytokine_protect_turns: 4, score_mult: 1.0 },
    fast:   { speed: [7, 8],  immune_response_strength: 0.65, cytokine_protect_turns: 5, score_mult: 1.2 },
    extreme:{ speed: [9, 10], immune_response_strength: 0.80, cytokine_protect_turns: 0, score_mult: 1.4 },
  },

  // ── 3. Mutation frequency — by the virus's Low/Medium/High mutation
  //     rate. Per-turn chance that a mutation is rolled at all; the roll
  //     itself can still land on 'none' (see MUTATION below). 'high' is
  //     Influenza's, so it mutates almost every turn. ──────────────────
  MUTATION_PROB_BY_RATE: { low: 0.15, medium: 0.30, high: 0.90 },

  // ── 4. Virus spread (automatic, phase 1 each turn) ────────────────
  SPREAD: {
    // Chance an infected cell spreads down / to each side per spread
    // phase. Down is higher: it drives toward the win line.
    WEIGHT_DOWN: 0.48,
    WEIGHT_SIDE: 0.24,
    // Subtracted from both chances while Antiviral / Protein Vaccine's
    // speed penalty is active (clamped to 0–1) — see _rollSpreadTargets(),
    // board.js.
    BOOST_CHANCE_BONUS: 0.15,
    // Cascading: a cell infected this phase can itself spread straight
    // away, with each hop's chance multiplied by CASCADE_DECAY
    // (40%, 16%, 6%, …). CASCADE_MAX_DEPTH is a hard stop on top.
    CASCADE_DECAY: 0.4,
    CASCADE_MAX_DEPTH: 5,
  },

  // ── 5. Immune system (automatic, phase 2 each turn) ───────────────
  //  Draws from its own weighted deck (cards.js IMMUNE_CARD_DEFS /
  //  buildImmuneDeckCounts) and plays every card in hand that is useful
  //  right now, holding the rest.
  IMMUNE: {
    HAND_LIMIT: 6,
    DRAW_PER_TURN: 2,
    // Turns the early extra NK Cell / Blue Cytokine copies stay in the
    // deck (EARLY_DILUTION_BONUS, cards.js).
    EARLY_DILUTION_TURNS: 5,
    // Antibody Escape's protection lasts only the turn it's played — its
    // real value is the immediate break-through of Antibody rows.
    ESCAPE_IMMUNITY_TURNS: 1,
    // T-Cell Evasion stays primed for this many immune phases.
    MHC_EVASION_TURNS: 1,
    // Each Antiviral permanently lowers replication speed by this much.
    ANTIVIRAL_PENALTY_AMOUNT: 1,
  },

  // ── 6. Vaccines (part of the immune deck) ─────────────────────────
  VACCINE: {
    MRNA_BOOST_TURNS: 3,             // boosts T-Cell rows + Cytokine shape size for N turns
    MRNA_TCELL_EXTRA_ROWS: 1,        // extra row a boosted T-Cell clears
    PROTEIN_SPEED_PENALTY_TURNS: 3,  // Protein Vaccine's replication-speed penalty duration
    PROTEIN_SPEED_PENALTY_AMOUNT: 2, // deeper than Antiviral's −1, but temporary
  },

  // ── 7. Spillover between neighbouring tissues ─────────────────────
  //  Each turn, every border row where the source tissue's edge cell is
  //  infected/dormant gets its own independent roll to infect the facing
  //  cell of the neighbouring tissue (if the virus has tropism for it).
  //  See _runSpillover() / _spilloverCandidates(), game.js.
  SPILLOVER: {
    CHANCE: 0.20, // per eligible border row, per turn (kept below WEIGHT_SIDE)
  },

  // ── 8. Mutation table (phase 3) ───────────────────────────────────
  //  Relative weights. Each non-'none' entry helps either the virus
  //  (gain) or the immune system (loss). Some entries only apply to
  //  certain viruses — _effectiveMutationTable(), game.js, zeroes them
  //  for the rest:
  //    latency_gain / latency_loss — viruses with Latency (Hepatitis)
  //    escape_loss                 — Influenza only
  //    tropism_gain                — everyone except Norovirus
  MUTATION: {
    none:          0.38,
    speed_gain:    0.10,
    speed_loss:    0.07,
    escape_gain:   0.10,
    escape_loss:   0.07,
    latency_gain:  0.10,
    latency_loss:  0.06,
    // Adds a random-colour Cytokine Neutralisation card to the hand.
    cytokine_neutralise_gain: 0.10,
    // Loses one active tissue. Base weight, scaled by how many tissues
    // are active (TROPISM_LOSS_MULT_BY_ACTIVE_TISSUES) — very rare when
    // it's the virus's only one.
    tropism_loss:  0.05,
    // Gains a new tissue — high, so a second front opens early before
    // the first gets boxed in.
    tropism_gain:  0.40,
  },

  // Multiplier on tropism_loss by current active-tissue count (1–3).
  TROPISM_LOSS_MULT_BY_ACTIVE_TISSUES: { 1: 0.1, 2: 0.8, 3: 1.3 },

  // ── 9. Player deck composition ────────────────────────────────────
  //  Spread cards per difficulty band — deliberately rare. Vertical
  //  (toward the win line) is rarest. See StealthDeck._buildFromLoadout,
  //  cards.js.
  INFECT_CARDS: {
    slow:    { horizontal: 2, vertical: 1 },
    medium:  { horizontal: 2, vertical: 1 },
    fast:    { horizontal: 3, vertical: 1 },
    extreme: { horizontal: 3, vertical: 1 },
  },
  // Norovirus: extra spread cards (it can never gain a second tissue, so
  // speed is its compensation).
  NOROVIRUS_VERTICAL_BONUS: 9,
  NOROVIRUS_HORIZONTAL_BONUS: 7,
  // Hepatitis: fewer horizontal spread cards (slow, "silent" infection —
  // it has permanent Cytokine immunity, Latency and T-Cell Evasion instead).
  HEPATITIS_HORIZONTAL_PENALTY: 1,

  // ── 10. Replication speed ─────────────────────────────────────────
  // Replication Boost: +AMOUNT for the next spread phase only (stacks if
  // played more than once in a turn) — see replicationBoostAmount, game.js.
  REPLICATION_BOOST: {
    AMOUNT: 1,
  },
  // Ceiling for effectiveReplicationSpeed(), game.js.
  MAX_REPLICATION_SPEED: 10,

  // ── 11. Cards / hand ──────────────────────────────────────────────
  CARDS: {
    OFFER_COUNT: 3, // cards offered each draft
    PICK_COUNT: 2,  // cards the player keeps from the offer
    HAND_LIMIT: 8,
  },

  // ── 12. Win / lose ────────────────────────────────────────────────
  //  Win:  the virus reaches the bottom row of an active tissue.
  //  Lose: no infected cells left anywhere.
  WIN: {
    BOTTOM_ROW_TISSUES_REQUIRED: 1,
  },

  // ── 13. Scoring (wins only) — see _finalizeScore(), game.js ───────
  SCORE: {
    PTS_PER_CELL: 10,             // per net cell infected
    WIN_BONUS: 500,
    PTS_PER_TISSUE_REACHED: 150,  // per tissue the virus ever reached
    // Game length in minutes → multiplier on the cells component
    // (linear between points). Best for a 5–10 minute game.
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
