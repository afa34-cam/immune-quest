// ═══════════════════════════════════════════════════════════════════
//  IMMUNE QUEST — Cancer Game
//  config.js — All game constants in one place.
//  Change values here to tune gameplay without touching game logic.
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {

  // ── Board ──────────────────────────────────────────────────────
  BOARD: {
    COLS: 7,
    ROWS: 8,
    CELL_SIZE: 72,        // px — resize cells here
    CELL_GAP:  4,         // px — gap between cells
    ORIGIN_COL: 3,        // starting tumour column (0-indexed, centre)
    ORIGIN_ROW: 0,        // starting tumour row (top)
  },

  // ── Secondary board (metastasis) ──────────────────────────────
  META_BOARD: {
    // Normal / Advanced / Expert
    COLS:       { normal: 5, advanced: 5, expert: 5 },
    ROWS:       { normal: 4, advanced: 4, expert: 5 },
    LIVER_PROB: 0.70,     // 70% liver, 30% lymph node
  },

  // ── Difficulty ─────────────────────────────────────────────────
  DIFFICULTY: {
    normal: {
      cards_drawn:            3,
      mutation_prob_early:    0.20,   // halved from standard 0.40
      mutation_prob_late:     0.40,
      meta_trigger_row:       5,      // 1-indexed: row 5 = index 4
      established_turns:      5,
      side_effects_active:    false,
    },
    advanced: {
      cards_drawn:            2,
      mutation_prob_early:    0.40,
      mutation_prob_late:     0.40,
      meta_trigger_row:       5,
      established_turns:      4,
      side_effects_active:    true,
    },
    expert: {
      cards_drawn:            2,
      mutation_prob_early:    0.40,
      mutation_prob_late:     0.60,   // 1.5× standard
      meta_trigger_row:       4,
      established_turns:      3,
      side_effects_active:    true,
    },
  },

  // ── Cancer spread ──────────────────────────────────────────────
  SPREAD: {
    TIMER_NORMAL:      2,   // turns between spread attempts for normal cells
    TIMER_ESTABLISHED: 1,   // established cells spread every turn
    WEIGHT_DOWN:       0.50,
    WEIGHT_SIDE:       0.25, // each side
    WEIGHT_UP:         0.00,
    // Established tumour: turns present before becoming established
    // (set per-difficulty above)
  },

  // ── Mutation table ─────────────────────────────────────────────
  MUTATION: {
    // Weights used to pick outcome (normalised to 1.0 each phase)
    early: {
      none:               0.60,
      resistance:         0.15,
      growth_accel:       0.15,
      immune_evasion:     0.05,
      metastasis:         0.05,
    },
    late: {
      none:               0.30,
      resistance:         0.25,
      growth_accel:       0.25,
      immune_evasion:     0.10,
      metastasis:         0.10,
    },
    LATE_TURN_THRESHOLD: 8,   // turns before "late game" probabilities kick in
    EVASION_DURATION:    3,   // turns immune evasion lasts
    EVASION_MULT:        0.5, // effectiveness multiplier during evasion
  },

  // ── Cards ──────────────────────────────────────────────────────
  CARDS: {
    DECK_SIZE:          30,
    HAND_LIMIT:         7,   // max cards in hand at once
    // Side effect durations (turns)
    CHEMO_PENALTY_TURNS:   3,
    STEROID_PENALTY_TURNS: 2,
    RADIO_DAMAGE_TURNS:    2,
    VACCINE_BOOST_TURNS:   4,
  },

  // ── Win/lose ───────────────────────────────────────────────────
  WIN: {
    TARGET_WIN_RATE: 0.70,   // design target (used for balancing reference)
  },

  // ── Colours (CSS custom properties mirror) ────────────────────
  COLOURS: {
    HEALTHY:      '#c8876a',   // warm pink-beige
    CANCEROUS:    '#6b4f7a',   // purple-grey
    ESTABLISHED:  '#4a2d5e',   // deep purple
    CLEARED:      '#2a2a3a',   // dark grey
    PROTECTED:    '#1a3a5c',   // cyan-tinted dark
    DAMAGED:      '#3a2a1a',   // damaged (radiotherapy)
    LIVER_HEALTHY:'#b5813e',   // warm brown-yellow
    LIVER_CANCER: '#3d4a38',   // grey-green
    LN_HEALTHY:   '#8a7aaa',   // pale lavender
    LN_CANCER:    '#3d2a5e',   // dark purple
  },

  // ── UI ─────────────────────────────────────────────────────────
  UI: {
    FONT_FAMILY: '"Orbitron", monospace',
    FONT_BODY:   '"Nunito", sans-serif',
    PANEL_WIDTH:  220,   // px — right-side card hand panel
    HUD_HEIGHT:   60,    // px — top HUD bar
  },
};

// Freeze to prevent accidental mutation
Object.freeze(CONFIG);
