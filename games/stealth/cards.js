// ═══════════════════════════════════════════════════════════════════
//  cards.js — Virus card definitions, deck building, and card effects.
//  Mirrors games/cancer/cards.js structure (id/name/targetType/apply),
//  playing offense instead of defense.
//
//  The loadout built in the Stealth Mission select screen (see
//  generateDeck() in index.html) lists which card TYPES this virus's kit
//  includes — one entry each. That's a kit spec, not a literal deck: here
//  we expand each included type into a proper multi-copy deck so there's
//  enough to draw/discard/reshuffle across a full game. Tropism cards are
//  excluded from the playable deck — they only decide which tissue boards
//  get seeded with the starting infection at game start.
//
//  Each card definition:
//    id, name, icon, count, tooltip, targetType,
//    apply(boards, target, state) → { text, count }
// ═══════════════════════════════════════════════════════════════════

// Cytokine Neutralisation is 3 colour-specific cards, not one generic
// card — each can only strip its own colour's shield; targeting the wrong
// colour just fails (no card consumed, per the normal invalid-target
// rule), same as any other mistargeted card. Only strips the ONE block the
// targeted cell belongs to (its cytokinePlacementId — see
// protectShape()/neutralizeCytokine(), board.js), not every same-coloured
// cell elsewhere in the tissue from a separate Cytokine play.
function _cytokineNeutraliseDef(color) {
  const label = `Cytokine Neutralisation (${color.charAt(0).toUpperCase() + color.slice(1)})`;
  const article = color === 'orange' ? 'an' : 'a';
  return {
    id: `cytokine-neutralise-${color}`, name: label, icon: '🔕',
    count: 3,
    tooltip: `Remove a block of ${color.charAt(0).toUpperCase() + color.slice(1)} cytokines from cells.`,
    targetType: 'immune-cell',
    apply(boards, target, state) {
      const board = boards[target.tissue];
      const cell = board.getCell(target.col, target.row);
      if (!cell || cell.state !== 'immune' || cell.cytokineColor !== color) {
        return { text: `Target must be ${article} ${color} cytokine-shielded cell.`, count: 0, ok: false };
      }
      const n = board.neutralizeCytokine(color, cell.cytokinePlacementId);
      return { text: label, count: 0, ok: n > 0 };
    },
  };
}

// T-Cell Evasion (MHC-I downregulation) — plays like any normal card (no
// immediate board effect), but primes a hidden defence on its own tissue:
// the NEXT time the immune system plays a T-Cell there, game.js's
// immune-response resolution auto-cancels it (no cells cleared) and
// consumes this priming instead of ever calling that T-Cell's own apply().
// Only stays primed for STEALTH_CONFIG.IMMUNE.MHC_EVASION_TURNS immune-
// response phases before expiring unused (see the decrement in
// _runImmuneResponse(), game.js) — was indefinite. Shows up in the virus's
// Active Cards banner for as long as it's primed (see renderVirusTraits(),
// game-ui.js), same as Tropism/Latency/Antibody Escape's own "still
// active" badges.
function _mhc1DownregDef(tissue) {
  return {
    id: `mhc1-downreg-${tissue}`, name: `T-Cell Evasion: ${_capitalize(tissue)}`, icon: '🚫',
    count: 2,
    tooltip: `Primes a hidden defence in ${tissue} for ${STEALTH_CONFIG.IMMUNE.MHC_EVASION_TURNS} turns. The next T cell card the immune system plays here in that time is fully cancelled.`,
    targetType: 'none', requiresTissue: tissue,
    apply(boards, target, state) {
      // Same "virus has to actually be there" restriction Antibody Escape
      // already has — priming a defence against a T-Cell in a tissue the
      // virus hasn't even reached doesn't make sense.
      if (!state.activeTissues.includes(tissue)) return { text: `The virus is not active in the ${tissue}.`, count: 0, ok: false };
      state.mhcActive = state.mhcActive || {};
      state.mhcActive[tissue] = STEALTH_CONFIG.IMMUNE.MHC_EVASION_TURNS;
      return { text: `T-Cell Evasion (${_capitalize(tissue)}) for ${STEALTH_CONFIG.IMMUNE.MHC_EVASION_TURNS} turns`, count: 0, ok: true };
    },
  };
}

// Horizontal Spread can target across a tissue boundary too, not just
// within one board — spillover (_runSpillover(), game.js) already treats
// adjacent tissues (liver-lung-intestine, ADJACENCY_ORDER) as connected
// sideways at their shared edge and does exactly this automatically; the
// player should be able to do the same thing deliberately with this card
// instead of only ever watching it happen passively. Mirrors
// _runSpillover()'s own column-mirroring exactly, just checked from the
// target's side: is `tissue`'s (col,row) sitting on the edge that faces a
// given neighbour, with that neighbour's own facing cell infected/dormant?
// Restricted to tissues the virus already actively infects (state.
// activeTissues), same as spillover itself — this only lets the virus
// spread sideways between fronts it already has, not open a brand new one.
function _crossTissueInfectedNeighbor(boards, tissue, col, row) {
  const order = STEALTH_CONFIG.BOARD.ADJACENCY_ORDER;
  const toIndex = order.indexOf(tissue);
  if (toIndex === -1) return false;
  return [order[toIndex - 1], order[toIndex + 1]].filter(Boolean).some(neighborTissue => {
    const neighborBoard = boards[neighborTissue];
    if (!neighborBoard) return false;
    const i = order.indexOf(neighborTissue);
    const entryCol = toIndex < i ? boards[tissue].cols - 1 : 0;
    if (col !== entryCol) return false;
    const fromEdgeCol = toIndex < i ? 0 : neighborBoard.cols - 1;
    const neighborCell = neighborBoard.getCell(fromEdgeCol, row);
    return neighborCell && (neighborCell.state === 'infected' || neighborCell.state === 'dormant');
  });
}

// Every healthy edge cell of `tissue` that a neighbouring tissue's own
// infection could spread sideways into (see _crossTissueInfectedNeighbor
// above) — collected as candidates rather than checked against one
// player-picked cell, since Horizontal Spread no longer lets the player
// choose the exact cell (see infect-horizontal below — balance pass, virus
// was winning far too consistently; stealthDebugStats(), game.js).
function _crossTissueSpreadCandidates(boards, tissue) {
  const board = boards[tissue];
  const candidates = [];
  for (let r = 0; r < board.rows; r++) {
    [0, board.cols - 1].forEach(c => {
      const cell = board.getCell(c, r);
      if (cell && cell.state === 'healthy' && _crossTissueInfectedNeighbor(boards, tissue, c, r)) {
        candidates.push({ col: c, row: r });
      }
    });
  }
  return candidates;
}

const STEALTH_CARD_DEFS = {

  'infect-horizontal': {
    id: 'infect-horizontal', name: 'Horizontal Spread', icon: '↔️', count: 0, // count set per-difficulty, see StealthDeck
    tooltip: 'Infect a random healthy cell next to an already-infected cell in the same row.',
    // 'tissue' not 'cell' — the player picks WHICH tissue, not the exact
    // cell within it (balance pass: guaranteed player-chosen precision was
    // too strong — see stealthDebugStats(), game.js). apply() below picks
    // randomly among every valid candidate, same "no chosen cell" principle
    // passive spread and Latency's own wake-up already follow.
    targetType: 'tissue',
    apply(boards, target, state) {
      const board = boards[target.tissue];
      const inTissue = board.horizontalSpreadCandidates();
      // Cross-tissue edge candidates folded into the SAME random pool
      // (deduped against inTissue) rather than only a fallback once no
      // in-tissue candidate exists — otherwise they'd be systematically
      // under-picked relative to in-tissue ones. Restricted to tissues the
      // virus already actively infects, same as spillover itself (see
      // _crossTissueInfectedNeighbor's own comment) — this only lets the
      // virus spread sideways between fronts it already has.
      const crossTissue = state.activeTissues.includes(target.tissue)
        ? _crossTissueSpreadCandidates(boards, target.tissue).filter(cand => !inTissue.some(c => c.col === cand.col && c.row === cand.row))
        : [];
      const candidates = [...inTissue, ...crossTissue];
      if (!candidates.length) return { text: 'No valid horizontal spread target in that tissue.', count: 0, ok: false };
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const ok = board._infect(board.getCell(pick.col, pick.row));
      return {
        text: ok
          ? `Horizontal Spread: infected [${pick.col + 1},${pick.row + 1}] in ${target.tissue}.`
          : `No valid horizontal spread target in that tissue.`,
        count: ok ? 1 : 0, ok,
      };
    },
  },

  'infect-vertical': {
    id: 'infect-vertical', name: 'Vertical Spread', icon: '⬇️', count: 0, // count set per-difficulty, see StealthDeck
    tooltip: 'Infect a random healthy cell directly below an already-infected cell.',
    // See infect-horizontal above for why this targets a tissue, not a cell.
    targetType: 'tissue',
    apply(boards, target, state) {
      const board = boards[target.tissue];
      const candidates = board.verticalSpreadCandidates();
      if (!candidates.length) return { text: 'No valid vertical spread target in that tissue.', count: 0, ok: false };
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const ok = board._infect(board.getCell(pick.col, pick.row));
      return {
        text: ok
          ? `Vertical Spread: infected [${pick.col + 1},${pick.row + 1}] in ${target.tissue}.`
          : `No valid vertical spread target in that tissue.`,
        count: ok ? 1 : 0, ok,
      };
    },
  },

  'spread-speed-plus': {
    id: 'spread-speed-plus', name: 'Replication Boost +1', icon: '⚡', count: 4,
    tooltip: `Increases the replication speed by +${STEALTH_CONFIG.REPLICATION_BOOST.AMOUNT} for ${STEALTH_CONFIG.REPLICATION_BOOST.TURNS} turn.`,
    targetType: 'none',
    apply(boards, target, state) {
      // Tops up rather than stacks — same non-stacking convention as
      // Protein Vaccine's own temporary speed change (vaccine-protein,
      // below) — a second Boost while one's already active just refreshes
      // the timer instead of extending it further.
      state.replicationBoostTurns = STEALTH_CONFIG.REPLICATION_BOOST.TURNS;
      return { text: `Replication Boost +${STEALTH_CONFIG.REPLICATION_BOOST.AMOUNT}: replication speed increased for ${STEALTH_CONFIG.REPLICATION_BOOST.TURNS} turn.`, count: 0, ok: true };
    },
  },

  'latency': {
    id: 'latency', name: 'Latency', icon: '😴', count: 4,
    tooltip: 'Place a dormant cell. This is invisible to the immune system and wakes and infects nearby cells in the spread phase of a later turn. Must be placed within two rows of the current infection front.',
    targetType: 'cell',
    apply(boards, target, state) {
      const board = boards[target.tissue];
      const ok = board.placeDormant(target.col, target.row, 2);
      return {
        text: ok
          ? `Latency: dormant cell placed at [${target.col + 1},${target.row + 1}] in ${target.tissue}.`
          : `Target must be healthy and within two rows of the infection front.`,
        count: 0, ok,
      };
    },
  },

  // Counteracts ONE cytokine play — target a cell shielded by THIS card's
  // own colour (not Antibody, which is permanent and untouched by this;
  // not a different colour, which just fails like any invalid target) and
  // strip every cell on that board shielded by that colour. Three
  // colour-specific cards (mirroring the Cytokine cards' own colour
  // tiers) rather than one generic card that adapts to whatever you
  // target — see _cytokineNeutraliseDef below.
  'cytokine-neutralise-blue':   _cytokineNeutraliseDef('blue'),
  'cytokine-neutralise-orange': _cytokineNeutraliseDef('orange'),
  'cytokine-neutralise-red':    _cytokineNeutraliseDef('red'),

  'activate-tregs': {
    id: 'activate-tregs', name: 'Activate Tregs', icon: '🤐', count: 3,
    tooltip: 'The immune system can only play 1 card on its next turn.',
    targetType: 'none',
    apply(boards, target, state) {
      state.immuneCardCapTurns = 1;
      return { text: 'Activate Tregs: the immune system is limited to 1 card next turn.', count: 0, ok: true };
    },
  },

  'antibody-escape-lung': {
    id: 'antibody-escape-lung', name: 'Antibody Escape: Lung', icon: '🛡️', count: 3,
    tooltip: 'Remove all antibodies in Lung.',
    targetType: 'none', requiresTissue: 'lung',
    apply(boards, target, state) {
      // Boards now exist for every tissue regardless of active state (so
      // the immune side can pre-fortify one) — the real "is this usable"
      // check is whether the virus has actually reached lung yet, not
      // whether a board object exists there.
      if (!state.activeTissues.includes('lung')) return { text: 'The virus is not active in the lung.', count: 0, ok: false };
      const n = boards.lung.grantEscapeImmunity(STEALTH_CONFIG.IMMUNE.ESCAPE_IMMUNITY_TURNS);
      const cleared = boards.lung.clearAntibodyProtection();
      const clearedText = cleared.length ? ` ${cleared.length} antibody cell(s) broken through.` : '';
      return { text: `Antibody Escape: ${n} infected lung cell(s) protected for ${STEALTH_CONFIG.IMMUNE.ESCAPE_IMMUNITY_TURNS} turns.${clearedText}`, count: 0, ok: true, cells: cleared };
    },
  },

  'antibody-escape-liver': {
    id: 'antibody-escape-liver', name: 'Antibody Escape: Liver', icon: '🛡️', count: 3,
    tooltip: 'Remove all antibodies in Liver.',
    targetType: 'none', requiresTissue: 'liver',
    apply(boards, target, state) {
      if (!state.activeTissues.includes('liver')) return { text: 'The virus is not active in the liver.', count: 0, ok: false };
      const n = boards.liver.grantEscapeImmunity(STEALTH_CONFIG.IMMUNE.ESCAPE_IMMUNITY_TURNS);
      const cleared = boards.liver.clearAntibodyProtection();
      const clearedText = cleared.length ? ` ${cleared.length} antibody cell(s) broken through.` : '';
      return { text: `Antibody Escape: ${n} infected liver cell(s) protected for ${STEALTH_CONFIG.IMMUNE.ESCAPE_IMMUNITY_TURNS} turns.${clearedText}`, count: 0, ok: true, cells: cleared };
    },
  },

  'antibody-escape-intestine': {
    id: 'antibody-escape-intestine', name: 'Antibody Escape: Intestine', icon: '🛡️', count: 3,
    tooltip: 'Remove all antibodies in Intestine.',
    targetType: 'none', requiresTissue: 'intestine',
    apply(boards, target, state) {
      if (!state.activeTissues.includes('intestine')) return { text: 'The virus is not active in the intestine.', count: 0, ok: false };
      const n = boards.intestine.grantEscapeImmunity(STEALTH_CONFIG.IMMUNE.ESCAPE_IMMUNITY_TURNS);
      const cleared = boards.intestine.clearAntibodyProtection();
      const clearedText = cleared.length ? ` ${cleared.length} antibody cell(s) broken through.` : '';
      return { text: `Antibody Escape: ${n} infected intestine cell(s) protected for ${STEALTH_CONFIG.IMMUNE.ESCAPE_IMMUNITY_TURNS} turns.${clearedText}`, count: 0, ok: true, cells: cleared };
    },
  },

  'mhc1-downreg-lung':      _mhc1DownregDef('lung'),
  'mhc1-downreg-liver':     _mhc1DownregDef('liver'),
  'mhc1-downreg-intestine': _mhc1DownregDef('intestine'),
};

// Card types that are loadout-only (seed which tissues start infected),
// never enter the playable deck.
const TROPISM_CARD_IDS = ['lung-tropism', 'liver-tropism', 'intestine-tropism'];

// ═══════════════════════════════════════════════════════════════════
//  IMMUNE CARDS — ONE shared deck/hand for the whole immune system, not
//  one per tissue board. T-Cell and Antibody are the only tissue-specific
//  cards among them — baked as one fixed variant per tissue (id/name
//  carry the tissue directly) so they can sit in the shared deck like
//  everything else while still always knowing their own target, instead
//  of being told which board to act on by an outer per-tissue loop.
//  Every other card (NK Cells, Cytokines, Sensing) picks its own target
//  tissue at play time; the vaccines and Antiviral have none (whole-body
//  effects). isUseful(game) → bool, apply(game, ctx) → { ...effect info }.
//  ctx = { protectTurns, mrnaBoosted } — protectTurns is this game's
//  effectiveCytokineProtectTurns() (game.js), the current virus's own
//  Cytokine shield duration; mrnaBoosted is whether the mRNA Vaccine's
//  boost is currently active (T-Cell extra row, bigger Cytokine shield) —
//  NK Cells is deliberately NEVER affected by it, unlike T-Cell.
// ═══════════════════════════════════════════════════════════════════

function _capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Shape tiers used by the Cytokine cards — lists of [dx, dy] offsets from a
// centre cell. Blue/Orange start at tiers 0/1 (1/5 cells); an active mRNA
// Vaccine boost shifts each up one shared tier (Blue -> 5-cell cross,
// Orange -> 9-cell block). Red starts at tier 2 (9 cells) but its own
// boost is a distinct shape (see CYTOKINE_RED_BOOST_SHAPE below) rather
// than continuing this same progression.
const CYTOKINE_SHAPE_TIERS = [
  [[0, 0]], // tier 0 — 1 cell
  [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]], // tier 1 — 5 cells (cross)
  [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]], // tier 2 — 9 cells (3x3)
];
// Red Cytokine's own boosted shape — a 4×2 block, requested explicitly
// instead of scaling up to a bigger diamond like the shared tiers do.
const CYTOKINE_RED_BOOST_SHAPE = [
  [-2, 0], [-1, 0], [0, 0], [1, 0],
  [-2, 1], [-1, 1], [0, 1], [1, 1],
];

// T-Cell clears an ENTIRE row of infected cells outright (no chance
// involved) — the row with the most infection, so it's always the most
// impactful row available. mRNA Vaccine makes it clear an extra row.
// Fixed to its own tissue's board directly (closure over `tissue`), unlike
// the old per-board version that relied on an outer loop to tell it which
// board it was acting on.
function _tcellDef(tissue) {
  return {
    id: `immune-tcell-${tissue}`, name: `T-Cell: ${_capitalize(tissue)}`, icon: '🔬', tissue,
    tooltip: `Clears an entire row of infected cells in ${_capitalize(tissue)}.`,
    isUseful(game) { return game.boards[tissue]._pickTCellRow() !== null; },
    apply(game, ctx) {
      const board = game.boards[tissue];
      const cleared = [];
      const row = board._pickTCellRow();
      if (row !== null) cleared.push(...board.clearRow(row).map(cell => ({ ...cell, tissue })));
      if (ctx.mrnaBoosted) {
        const extraRow = board._pickTCellRow();
        if (extraRow !== null) cleared.push(...board.clearRow(extraRow).map(cell => ({ ...cell, tissue })));
      }
      return { cleared };
    },
  };
}

// Antibody protects an ENTIRE row permanently — but only a row that has no
// virus present at all. That's just as true of a tissue the virus hasn't
// even reached yet (every row is virus-free by definition) as it is of an
// active one, so this doubles as pre-fortification: the immune system can
// play it on an inactive tissue ahead of a tropism_gain mutation, and the
// protection is still there — see seedInfection() (board.js) and
// tropism_gain (game.js) — the moment the virus actually arrives.
function _antibodyDef(tissue) {
  return {
    id: `immune-antibody-${tissue}`, name: `Antibody: ${_capitalize(tissue)}`, icon: '🛡️', tissue,
    tooltip: `Protects an entire row of cells in ${_capitalize(tissue)} from infection.`,
    isUseful(game) { return game.boards[tissue]._pickAntibodyRow() !== null; },
    apply(game) {
      const board = game.boards[tissue];
      const row = board._pickAntibodyRow();
      if (row === null) return { placed: false, protectedCells: [] };
      const protectedCells = board.protectRow(row, 0).map(cell => ({ ...cell, tissue })); // 0 turns = permanent
      return { placed: protectedCells.length > 0, protectedCells };
    },
  };
}

// Cytokine's own per-board targeting (_pickStrategicAntibodyTarget) already
// falls back to guarding the entry point when a board has no infection at
// all — so pre-fortifying an inactive tissue falls out of the existing
// per-board logic for free. This just decides WHICH tissue's board to ask:
// active tissues under real threat first (there's an actual infection
// front to defend), inactive ones only once no active tissue needs it.
function _cytokinePickTarget(game) {
  for (const t of game.activeTissues) {
    const target = game.boards[t]._pickStrategicAntibodyTarget();
    if (target) return { tissue: t, ...target };
  }
  const inactive = STEALTH_CONFIG.BOARD.TISSUES.filter(t => !game.activeTissues.includes(t));
  for (const t of inactive) {
    const target = game.boards[t]._pickStrategicAntibodyTarget();
    if (target) return { tissue: t, ...target };
  }
  return null;
}

function _cytokineDef(color, baseTier) {
  const cellWord = ({ 0: '1 healthy cell', 1: '5 healthy cells', 2: '9 healthy cells' })[baseTier];
  return {
    id: `immune-cytokine-${color}`, name: `Cytokine (${_capitalize(color)})`, icon: { blue: '🔵', orange: '🟠', red: '🔴' }[color], tier: baseTier,
    tooltip: `Shields ${cellWord} from infection. Duration depends on the virus: 3 turns against Norovirus, 4 against Influenza, and permanently against Hepatitis (only Cytokine Neutralisation removes it). A custom virus's own duration scales with its replication speed, from 3 turns at the slowest up to permanent at the fastest.`,
    isUseful(game) { return _cytokinePickTarget(game) !== null; },
    apply(game, ctx) {
      const target = _cytokinePickTarget(game);
      if (!target) return { protectedCells: [] };
      // Blue/Orange scale up one shared tier when boosted; Red's boost is
      // its own distinct shape (see CYTOKINE_RED_BOOST_SHAPE) instead of
      // continuing that same progression.
      const shape = !ctx.mrnaBoosted ? CYTOKINE_SHAPE_TIERS[baseTier]
        : color === 'red' ? CYTOKINE_RED_BOOST_SHAPE
        : CYTOKINE_SHAPE_TIERS[baseTier + 1];
      const board = game.boards[target.tissue];
      // Per-virus duration (0 = permanent) — see
      // effectiveCytokineProtectTurns(), game.js.
      const turns = ctx.protectTurns;
      const protectedCells = board.protectShape(target.col, target.row, shape, turns, color)
        .map(cell => ({ ...cell, tissue: target.tissue }));
      return { protectedCells };
    },
  };
}

// NK Cells clears exactly 1 infected cell — nowhere near T-Cell's whole
// row, but it can reach ANY active tissue rather than being locked to one,
// and (unlike T-Cell) never scales up with mRNA Vaccine's boost. Targets
// whichever active tissue's infection has advanced furthest (closest to
// the win condition), tie-broken randomly.
function _nkPickTarget(game) {
  let best = null;
  game.activeTissues.forEach(t => {
    const cell = game.boards[t]._pickDeepestInfectedCell();
    if (cell && (!best || cell.row > best.row)) best = { tissue: t, ...cell };
  });
  return best;
}

const IMMUNE_CARD_DEFS = {
  'immune-nkcell': {
    id: 'immune-nkcell', name: 'NK Cell', icon: '⚔️',
    tooltip: 'Clears 1 infected cell from any tissue.',
    isUseful(game) { return _nkPickTarget(game) !== null; },
    apply(game) {
      const target = _nkPickTarget(game);
      if (!target) return { cleared: [] };
      const cell = game.boards[target.tissue].getCell(target.col, target.row);
      // Straight back to a normal healthy cell, same as T-Cell's own clear
      // (see board.js clearRow()'s comment) — no dimmed 'cleared' look or
      // re-infection cooldown, just a plain healthy cell the "poof"
      // animation settles into.
      cell.state = 'healthy'; cell.turnsInfected = 0;
      return { cleared: [{ tissue: target.tissue, col: target.col, row: target.row }] };
    },
  },

  'immune-tcell-lung':      _tcellDef('lung'),
  'immune-tcell-liver':     _tcellDef('liver'),
  'immune-tcell-intestine': _tcellDef('intestine'),

  'immune-antibody-lung':      _antibodyDef('lung'),
  'immune-antibody-liver':     _antibodyDef('liver'),
  'immune-antibody-intestine': _antibodyDef('intestine'),

  'immune-cytokine-blue':   _cytokineDef('blue', 0),
  'immune-cytokine-orange': _cytokineDef('orange', 1),
  'immune-cytokine-red':    _cytokineDef('red', 2),

  'immune-sensing': {
    id: 'immune-sensing', name: 'DNA/RNA Sensing', icon: '🧬',
    tooltip: 'Reveals and clears a latent infected cell.',
    isUseful(game) { return game.activeTissues.some(t => game.boards[t].hasDormant()); },
    apply(game) {
      const tissue = game.activeTissues.find(t => game.boards[t].hasDormant());
      if (!tissue) return { revealed: false };
      const board = game.boards[tissue];
      for (let r = 0; r < board.rows; r++) {
        for (let c = 0; c < board.cols; c++) {
          if (board.cells[r][c].state === 'dormant') {
            // Same as T-Cell/NK Cell's own clear (see board.js clearRow()'s
            // comment) — straight back to a normal, immediately-infectable
            // healthy cell, no dimmed 'cleared' look or resistance window.
            board.cells[r][c].state = 'healthy';
            board.cells[r][c].dormantTurns = 0;
            return { revealed: true, tissue, col: c, row: r };
          }
        }
      }
      return { revealed: false };
    },
  },

  // The exact opposite of the virus's own Replication Boost — a PERMANENT
  // -1 effective speed (and reduced spread chance) for the rest of the
  // game, stacking on every successful play. Applied at the game level in
  // game.js _runImmuneResponse()/effectiveReplicationSpeed(), since an
  // antiviral response circulates through the whole body, not just
  // wherever it happened to be drawn.
  'immune-antiviral': {
    id: 'immune-antiviral', name: 'Antiviral', icon: '💊',
    tooltip: 'Permanently reduces the replication speed by -1. Stacks if played more than once.',
    isUseful(game) { return game.activeTissues.some(t => game.boards[t].infectedCount() > 0); },
    apply() {
      return { blocked: true };
    },
  },

  'vaccine-mrna': {
    id: 'vaccine-mrna', name: 'mRNA Vaccine', icon: '💉',
    tooltip: 'Powerup that increases the power of cytokines and T cells (clears 2 rows instead of 1).',
    isUseful(game) { return game.mrnaBoostTurns === 0; },
    // Mutates ctx.mrnaBoosted directly (not just game.mrnaBoostTurns) so
    // that if the immune system draws mRNA Vaccine and a T-Cell/Cytokine
    // in the SAME turn, the priority ordering in game.js
    // (_immunePlayPriority — mRNA resolves first) means that later card's
    // own apply(game, ctx) call already sees the boost, instead of it only
    // taking effect starting next turn.
    apply(game, ctx) {
      game.mrnaBoostTurns = STEALTH_CONFIG.VACCINE.MRNA_BOOST_TURNS;
      if (ctx) ctx.mrnaBoosted = true;
      return { activated: true };
    },
  },
  'vaccine-protein': {
    id: 'vaccine-protein', name: 'Protein-based Vaccine', icon: '🧪',
    tooltip: 'Grants 1 random bonus antibody card and reduces the virus\'s replication speed by -2 for 3 turns.',
    isUseful() { return true; }, // free value, no target required — always play it
    apply(game) {
      // Returned rather than pushed straight onto game.immuneHand here —
      // the turn-resolution loop that calls apply() (see
      // _runImmuneResponse(), game.js) rebuilds the hand from a snapshot
      // taken before this turn's plays, so a direct push here would just
      // get discarded when that rebuilt hand replaces the live array.
      const tissue = game.activeTissues[Math.floor(Math.random() * game.activeTissues.length)];
      const grantedCards = [{ ...IMMUNE_CARD_DEFS[`immune-antibody-${tissue}`] }];
      // Temporary — not a permanent loadout change, unlike Antiviral's own
      // (see immune-antiviral above) — tracked independently in its own
      // proteinVaccineTurns counter (game.js), so it stacks ADDITIVELY
      // with Antiviral's permanent penalty rather than sharing one pooled
      // counter with it. A fresh play tops this back up to the full
      // duration rather than stacking a second -2 on top of an
      // already-active one.
      game.proteinVaccineTurns = (game.proteinVaccineTurns || 0) + STEALTH_CONFIG.VACCINE.PROTEIN_SPEED_PENALTY_TURNS;
      return { bonusGranted: true, speedPenaltyApplied: true, grantedCards };
    },
  },
};

// Deck composition weighted by the specific virus's own loadout — a
// fast/high-replication virus draws more Antiviral and mRNA Vaccine; a
// slow one leans on more Antibody. High mutation (or the Latency ability)
// pulls in more Sensing; Tregs/Cytokine-Resistance abilities pull in more
// Cytokine (Blue). Baseline counts are a first pass, not final numbers —
// still subject to the wider balance pass.
// Baseline weighting, per the balance-pass reference table: NK Cells,
// Antiviral and Sensing sit at a flat standard count for every virus
// (the table just says "yes" — no bias either way); both vaccines are
// deliberately less frequent than everything else; Cytokines are
// deliberately more frequent. T-Cell vs Antibody then gets tipped one way
// or the other per named preset below — Norovirus stays neutral between
// the two (also just "yes"/"yes"), so no override needed for it.
function buildImmuneDeckCounts(loadout) {
  const counts = {
    'immune-nkcell': 2,
    // Matches Antibody's own base count below — the other big row-clearer,
    // no reason it should be three times rarer.
    'immune-tcell-lung': 3, 'immune-tcell-liver': 3, 'immune-tcell-intestine': 3,
    // Bumped from 1 each — balance pass: trial runs were coming in too easy
    // for the virus, and Antibody's permanent row-block is a big part of
    // actually pressuring it.
    'immune-antibody-lung': 3, 'immune-antibody-liver': 3, 'immune-antibody-intestine': 3,
    // Equal odds across all 3 colours now (was 6/3/2, blue-heavy) — balance
    // pass: no reason the immune system should draw the weakest shield
    // (Blue, 1 cell) three times as often as the strongest (Red, 9 cells).
    'immune-cytokine-blue': 2, 'immune-cytokine-orange': 4, 'immune-cytokine-red': 4,
    'immune-sensing': 2, 'immune-antiviral': 2,
    'vaccine-mrna': 1, 'vaccine-protein': 1,
  };
  const abilities = loadout.abilities || [];

  // Influenza — weighted towards Antibodies. Bumped from +1 — the virus
  // side already leans hard into frequent Antibody Escape for Influenza
  // (countOverride 7, plus Antigenic Drift biasing its own mutation rolls
  // toward escape_gain — see StealthDeck._buildFromLoadout and
  // _effectiveMutationTable, game.js), so the immune system should be
  // reaching for the card that escape actually counters correspondingly
  // more often too, not just occasionally.
  if (loadout.id === 'influenza') {
    counts['immune-antibody-lung'] += 2; counts['immune-antibody-liver'] += 2; counts['immune-antibody-intestine'] += 2;
  }
  // Hepatitis — weighted towards T-Cells, more heavily than Influenza's
  // own Antibody bonus (was +1, then +2) — Hepatitis is meant to be the
  // harder, more "persistent chronic infection" matchup of the three
  // (targeting a lower win rate than Influenza/Norovirus in the balance
  // pass); +2 alone wasn't moving its win rate down enough.
  if (loadout.id === 'hepatitis') {
    counts['immune-tcell-lung'] += 3; counts['immune-tcell-liver'] += 3; counts['immune-tcell-intestine'] += 3;
  }
  // Norovirus can never open a second tissue (see MUTATION.tropism_gain's
  // comment, config.js), so being boxed in on its one tissue is a much
  // bigger existential risk for it than for the other two — diluting how
  // often the immune system draws the row-clearers (Antibody/T-Cell) by
  // boosting the weaker cards it faces instead compensates for that,
  // alongside its own spread-speed bonuses above (generateDeck-level).
  if (loadout.id === 'norovirus') {
    counts['immune-nkcell'] += 5; counts['immune-cytokine-blue'] += 6;
  }

  if (loadout.mutation === 'high') { counts['immune-sensing'] += 2; counts['vaccine-protein'] += 1; }

  if (abilities.includes('latency')) counts['immune-sensing'] += 2;

  return counts;
}

// Extra NK Cell / Blue Cytokine copies (both single-cell effects), on top
// of buildImmuneDeckCounts()'s own baseline — a bigger deck means T-Cell/
// Antibody's SHARE of it (and so how often the immune system actually
// draws the row-clearer that matters) drops, which is the point: row-
// clears from a fresh mission's very first few turns were wiping out a
// beachhead the virus hadn't had time to establish. But that's only a
// risk early on — ImmuneDeck tags these specific copies (see below) so
// StealthGame can prune whichever ones are still unplayed once EARLY_
// DILUTION_TURNS has passed (see game.js _runImmuneResponse()), restoring
// T-Cell/Antibody's normal draw share for the rest of the game rather than
// diluting it for the whole match.
const EARLY_DILUTION_BONUS = { 'immune-nkcell': 2, 'immune-cytokine-blue': 2 };

class ImmuneDeck {
  constructor(loadout) {
    this.draw    = [];
    this.discard = [];
    const counts = buildImmuneDeckCounts(loadout);
    Object.entries(counts).forEach(([id, count]) => {
      const def = IMMUNE_CARD_DEFS[id];
      for (let i = 0; i < count; i++) this.draw.push({ ...def });
    });
    Object.entries(EARLY_DILUTION_BONUS).forEach(([id, count]) => {
      const def = IMMUNE_CARD_DEFS[id];
      for (let i = 0; i < count; i++) this.draw.push({ ...def, __earlyDilution: true });
    });
    this._shuffle(this.draw);
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  drawCards(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (this.draw.length === 0) this._reshuffleDiscard();
      if (this.draw.length === 0) break;
      out.push(this.draw.pop());
    }
    return out;
  }

  _reshuffleDiscard() {
    if (this.discard.length === 0) return;
    this.draw = [...this.discard];
    this.discard = [];
    this._shuffle(this.draw);
  }

  discardCard(card) { this.discard.push(card); }

  // Strips any still-unplayed EARLY_DILUTION_BONUS copies from both the
  // draw pile and the discard pile (a discarded one can still be reshuffled
  // back into draw later otherwise) — called once by _runImmuneResponse()
  // (game.js) the first turn past EARLY_DILUTION_TURNS. Copies already in
  // the immune system's HAND are left alone; this only stops MORE of them
  // from being drawn going forward, it doesn't claw back one already dealt.
  pruneEarlyDilution() {
    this.draw = this.draw.filter(c => !c.__earlyDilution);
    this.discard = this.discard.filter(c => !c.__earlyDilution);
  }
}

// ── Deck: draft-based (offer N, pick M) rather than blind draw ──────
class StealthDeck {
  constructor(loadoutDeckIds, activeTissues = [], difficultyName = 'medium', virusId = null) {
    this.draw    = [];
    this.discard = [];
    this._buildFromLoadout(loadoutDeckIds, activeTissues, difficultyName, virusId);
    this._shuffle(this.draw);
  }

  _buildFromLoadout(loadoutDeckIds, activeTissues, difficultyName, virusId) {
    const includedTypes = new Set(loadoutDeckIds.filter(id => !TROPISM_CARD_IDS.includes(id)));
    // Horizontal/vertical spread are always in the kit — they're the core
    // action — but how many of each scales with difficulty (see config.js:
    // vertical is kept extremely rare in every band; norovirus specifically
    // gets a bonus on top since it's explosively contagious in real life).
    includedTypes.add('infect-horizontal');
    includedTypes.add('infect-vertical');
    const infectCounts = STEALTH_CONFIG.INFECT_CARDS[difficultyName] || STEALTH_CONFIG.INFECT_CARDS.medium;
    const verticalBonus = virusId === 'norovirus' ? STEALTH_CONFIG.NOROVIRUS_VERTICAL_BONUS : 0;
    const horizontalBonus = virusId === 'norovirus' ? STEALTH_CONFIG.NOROVIRUS_HORIZONTAL_BONUS
                           : virusId === 'hepatitis' ? -STEALTH_CONFIG.HEPATITIS_HORIZONTAL_PENALTY : 0;

    // Per-virus count overrides for cards every kit now includes by default
    // (see generateDeck(), index.html) but that should show up at
    // different frequencies per the balance-pass reference table:
    // Replication Boost is less frequent for the slow-replicating
    // Hepatitis; Antibody Escape is very frequent for Influenza, quite
    // rare for Norovirus. Deliberately NOT gated by activeTissues (unlike
    // before) — a virus can hold escape/MHC-I cards for a tissue it
    // hasn't reached yet, same as the immune system can pre-fortify one.
    // Influenza's count bumped further (was 6) as part of leaning into
    // "frequent mutation + frequent Antibody Escape" as its whole identity.
    const antibodyEscapeIds = ['antibody-escape-lung', 'antibody-escape-liver', 'antibody-escape-intestine'];
    const countOverrides = {};
    if (virusId === 'hepatitis') countOverrides['spread-speed-plus'] = 2;
    // Trimmed back from 9 — combined with the mutation-driven escape_gain
    // (Antigenic Drift, boosted by the 0.90 mutation rate), 9 drawn cards
    // ON TOP of that overshot the 70% win-rate target; the mutation rate
    // itself stays at 0.90 ("nearly every turn") since that was explicit.
    if (virusId === 'influenza') antibodyEscapeIds.forEach(id => { countOverrides[id] = 7; });
    if (virusId === 'norovirus') antibodyEscapeIds.forEach(id => { countOverrides[id] = 1; });

    includedTypes.forEach(id => {
      const def = STEALTH_CARD_DEFS[id];
      if (!def) return;
      // Floored at 1 — a penalty (Hepatitis) should make the card RARE,
      // not remove it outright; only a bonus should ever be able to push
      // a count down to 0 or below on its own.
      const count = id === 'infect-horizontal' ? Math.max(1, infectCounts.horizontal + horizontalBonus)
                  : id === 'infect-vertical'   ? Math.max(1, infectCounts.vertical + verticalBonus)
                  : countOverrides[id] !== undefined ? countOverrides[id]
                  : def.count;
      for (let i = 0; i < count; i++) this.draw.push({ ...def });
    });
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // Draws OFFER_COUNT cards to choose from without removing them from the
  // deck yet — caller must resolve the picks via resolveDraft(). Prefers
  // distinct card types for this one offer — the deck holds several copies
  // of most card types, so a fully random draw routinely offered 2 (or all
  // 3) of the exact same card. A duplicate hit here just gets set aside and
  // tried past, then returned to the draw pile afterwards (not discarded),
  // so this only smooths out THIS offer's presentation — it doesn't touch
  // any card type's overall odds across the game. Falls back to allowing a
  // duplicate once every other card in the deck has already been tried and
  // set aside, so a deck that's down to one dominant type still fills the
  // offer instead of coming up short.
  offerDraft() {
    const n = Math.min(STEALTH_CONFIG.CARDS.OFFER_COUNT, this.draw.length + this.discard.length);
    const offer = [];
    const setAside = [];
    const seenIds = new Set();
    while (offer.length < n) {
      if (this.draw.length === 0) this._reshuffleDiscard();
      if (this.draw.length === 0) break;
      const card = this.draw.pop();
      if (seenIds.has(card.id) && (this.draw.length + this.discard.length) > 0) {
        setAside.push(card);
        continue;
      }
      seenIds.add(card.id);
      offer.push(card);
    }
    this.draw.push(...setAside);
    return offer;
  }

  // Player picks a subset of the offered cards into hand; the rest go to discard.
  resolveDraft(offer, pickedIndexes) {
    const picked = [];
    offer.forEach((card, i) => {
      if (pickedIndexes.includes(i)) picked.push(card);
      else this.discard.push(card);
    });
    return picked;
  }

  _reshuffleDiscard() {
    if (this.discard.length === 0) return;
    this.draw = [...this.discard];
    this.discard = [];
    this._shuffle(this.draw);
  }

  discardCard(card) { this.discard.push(card); }

  get drawCount()    { return this.draw.length; }
  get discardCount() { return this.discard.length; }
}
