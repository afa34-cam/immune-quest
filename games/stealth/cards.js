// ═══════════════════════════════════════════════════════════════════
//  IMMUNE QUEST — Stealth Mission
//  cards.js — every card in the game (the player's virus cards and the
//  immune system's cards), their effects, and both decks.
//
//  The loadout from the select screen (generateDeck(), index.html) lists
//  which virus card TYPES this virus has; StealthDeck below expands that
//  into a multi-copy deck. Tropism cards are loadout-only: they decide
//  which tissues start infected and never enter the deck.
//
//  Virus card:   { id, name, icon, count, tooltip, targetType,
//                  apply(boards, target, state) → { text, count, ok, cells? } }
//                  ok:false = invalid target; the card stays in hand and
//                  `text` is shown as the error hint.
//  Immune card:  { id, name, icon, tooltip,
//                  isUseful(game) → bool, apply(game, ctx) → effect info }
//                  ctx = { protectTurns, mrnaBoosted }
//
//  Contents
//    1. Virus card helpers
//    2. Virus card definitions (STEALTH_CARD_DEFS)
//    3. Immune card helpers & targeting
//    4. Immune card definitions (IMMUNE_CARD_DEFS)
//    5. Immune deck
//    6. Player (virus) deck
// ═══════════════════════════════════════════════════════════════════


// ═══ 1. Virus card helpers ═════════════════════════════════════════

// Cytokine Neutralisation — one card per colour. Target a cell shielded
// by that colour's Cytokine to remove that whole block (only that one
// play's cells — see neutralizeCytokine(), board.js). Any other target
// fails and the card stays in hand.
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
      const cells = board.neutralizeCytokine(color, cell.cytokinePlacementId);
      // `cells` drives the board animation (playSelectedCard(), game-ui.js).
      // Always at least the targeted cell, so ok is always true here.
      return { text: label, count: 0, ok: cells.length > 0, cells };
    },
  };
}

// T-Cell Evasion (MHC-I downregulation) — no immediate effect; primes its
// tissue so the next T-Cell the immune system plays there is cancelled
// (handled in _runImmuneResponse(), game.js). Expires after
// MHC_EVASION_TURNS immune phases. Only playable where the virus is active.
function _mhc1DownregDef(tissue) {
  return {
    id: `mhc1-downreg-${tissue}`, name: `T-Cell Evasion: ${_capitalize(tissue)}`, icon: '🚫',
    count: 2,
    tooltip: `Primes a hidden defence in ${tissue} for ${_pluralTurns(STEALTH_CONFIG.IMMUNE.MHC_EVASION_TURNS)}. The next T cell card the immune system plays here in that time is fully cancelled.`,
    targetType: 'none', requiresTissue: tissue,
    apply(boards, target, state) {
      if (!state.activeTissues.includes(tissue)) return { text: `The virus is not active in the ${tissue}. Select another card or select ‘End Turn’.`, count: 0, ok: false };
      state.mhcActive = state.mhcActive || {};
      state.mhcActive[tissue] = STEALTH_CONFIG.IMMUNE.MHC_EVASION_TURNS;
      return { text: `T-Cell Evasion (${_capitalize(tissue)}) for ${_pluralTurns(STEALTH_CONFIG.IMMUNE.MHC_EVASION_TURNS)}`, count: 0, ok: true };
    },
  };
}

// Antibody Escape (one per tissue): every Antibody shield in the tissue is
// removed, and its infected cells can't be cleared this turn. Only
// playable where the virus is active AND there's an Antibody shield to
// escape — otherwise it fails and the card stays in hand.
function _antibodyEscapeDef(tissue) {
  const Tissue = _capitalize(tissue);
  return {
    id: `antibody-escape-${tissue}`, name: `Antibody Escape: ${Tissue}`, icon: '🛡️', count: 3,
    tooltip: `Remove all antibodies in ${Tissue}.`,
    targetType: 'none', requiresTissue: tissue,
    apply(boards, target, state) {
      if (!state.activeTissues.includes(tissue)) return { text: `The virus is not active in the ${tissue}. Select another card or select ‘End Turn’.`, count: 0, ok: false };
      const board = boards[tissue];
      const hasAntibodies = board.cells.some(row => row.some(c => c.state === 'immune' && !c.cytokineColor));
      if (!hasAntibodies) return { text: `No antibodies to escape in the ${tissue}. Select another card to play or select ‘End Turn’.`, count: 0, ok: false };
      const n = board.grantEscapeImmunity(STEALTH_CONFIG.IMMUNE.ESCAPE_IMMUNITY_TURNS);
      const cleared = board.clearAntibodyProtection();
      const clearedText = cleared.length ? ` ${cleared.length} antibody cell(s) broken through.` : '';
      return { text: `Antibody Escape: ${n} infected ${tissue} cell(s) protected for ${_pluralTurns(STEALTH_CONFIG.IMMUNE.ESCAPE_IMMUNITY_TURNS)}.${clearedText}`, count: 0, ok: true, cells: cleared };
    },
  };
}

// Horizontal Spread can also cross into a neighbouring tissue, the same
// way spillover does (_runSpillover(), game.js): true if (col, row) of
// `tissue` is on the edge facing a neighbour whose facing cell is
// infected/dormant.
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

// Every healthy edge cell of `tissue` that a neighbouring tissue's
// infection could spread sideways into.
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


// ═══ 2. Virus card definitions ═════════════════════════════════════
//  targetType: 'none' (plays immediately), 'tissue' (click anywhere in a
//  tissue), 'cell' (click a cell), 'immune-cell' (click a shielded cell).
//  `cells` in a result is what the board animates.

const STEALTH_CARD_DEFS = {

  // Spread cards: the player picks the tissue, the card picks a random
  // valid cell in it.
  'infect-horizontal': {
    id: 'infect-horizontal', name: 'Horizontal Spread', icon: '↔️', count: 0, // count set per-difficulty, see StealthDeck
    tooltip: 'Infect a random healthy cell next to an already-infected cell in the same row.',
    targetType: 'tissue',
    apply(boards, target, state) {
      const board = boards[target.tissue];
      const inTissue = board.horizontalSpreadCandidates();
      // Cross-tissue edge cells join the same random pool (only between
      // tissues the virus already infects).
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
        cells: ok ? [{ col: pick.col, row: pick.row }] : [],
      };
    },
  },

  'infect-vertical': {
    id: 'infect-vertical', name: 'Vertical Spread', icon: '⬇️', count: 0, // count set per-difficulty, see StealthDeck
    tooltip: 'Infect a random healthy cell directly below an already-infected cell.',
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
        cells: ok ? [{ col: pick.col, row: pick.row }] : [],
      };
    },
  },

  // +AMOUNT replication speed for the next spread phase only. Several in
  // one turn stack; all are used up by that one phase.
  'spread-speed-plus': {
    id: 'spread-speed-plus', name: 'Replication Boost +1', icon: '⚡', count: 4,
    tooltip: `Increases the replication speed by +${STEALTH_CONFIG.REPLICATION_BOOST.AMOUNT} for the next spread phase. Stacks if played more than once in the same turn.`,
    targetType: 'none',
    apply(boards, target, state) {
      state.replicationBoostAmount = (state.replicationBoostAmount || 0) + STEALTH_CONFIG.REPLICATION_BOOST.AMOUNT;
      return { text: `Replication Boost +${STEALTH_CONFIG.REPLICATION_BOOST.AMOUNT}: replication speed increased for the next spread phase.`, count: 0, ok: true };
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

  'antibody-escape-lung':      _antibodyEscapeDef('lung'),
  'antibody-escape-liver':     _antibodyEscapeDef('liver'),
  'antibody-escape-intestine': _antibodyEscapeDef('intestine'),

  'mhc1-downreg-lung':      _mhc1DownregDef('lung'),
  'mhc1-downreg-liver':     _mhc1DownregDef('liver'),
  'mhc1-downreg-intestine': _mhc1DownregDef('intestine'),
};

// Loadout-only cards (decide which tissues start infected); never in the deck.
const TROPISM_CARD_IDS = ['lung-tropism', 'liver-tropism', 'intestine-tropism'];


// ═══ 3. Immune card helpers & targeting ════════════════════════════
//  The immune system has ONE shared deck and hand. T-Cell and Antibody
//  come in one fixed variant per tissue; every other card picks its own
//  target when played. Vaccines and Antiviral affect the whole body.

function _capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// "1 turn" / "N turns" for text built from a config value.
function _pluralTurns(n) { return `${n} turn${n === 1 ? '' : 's'}`; }

// Cytokine shapes as [dx, dy] offsets from an anchor cell.
// Blue = tier 0 (1 cell), Orange = tier 1 (5-cell cross), Red = tier 2
// (3×3). An mRNA Vaccine boost moves Blue/Orange up one tier; Red's boost
// is its own 4×2 shape (CYTOKINE_RED_BOOST_SHAPE).
const CYTOKINE_SHAPE_TIERS = [
  [[0, 0]], // tier 0 — 1 cell
  [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]], // tier 1 — 5 cells (cross)
  [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]], // tier 2 — 9 cells (3x3)
];
const CYTOKINE_RED_BOOST_SHAPE = [
  [-2, 0], [-1, 0], [0, 0], [1, 0],
  [-2, 1], [-1, 1], [0, 1], [1, 1],
];

// T-Cell (one per tissue): clears every infected cell in the deepest
// infected row (_pickTCellRow(), board.js). Boosted by mRNA Vaccine, it
// also clears the row above. Not played on a tissue where the virus is
// already boxed in — clearing there would only reopen it.
function _tcellDef(tissue) {
  return {
    id: `immune-tcell-${tissue}`, name: `T-Cell: ${_capitalize(tissue)}`, icon: '🔬', tissue,
    tooltip: `Clears an entire row of infected cells in ${_capitalize(tissue)}.`,
    isUseful(game) { return game.boards[tissue].hasSpreadTarget() && game.boards[tissue]._pickTCellRow() !== null; },
    apply(game, ctx) {
      const board = game.boards[tissue];
      const cleared = [];
      const row = board._pickTCellRow();
      if (row !== null) cleared.push(...board.clearRow(row).map(cell => ({ ...cell, tissue })));
      if (ctx.mrnaBoosted && row !== null && row - 1 >= 0) {
        cleared.push(...board.clearRow(row - 1).map(cell => ({ ...cell, tissue })));
      }
      return { cleared };
    },
  };
}

// Deepest row reached by infection in a tissue adjacent to `tissue` — the
// row where a spillover into `tissue` would land. -1 if neither neighbour
// is infected. (Liver and intestine aren't adjacent.)
function _adjacentThreatRow(boards, tissue) {
  const order = STEALTH_CONFIG.BOARD.ADJACENCY_ORDER;
  const i = order.indexOf(tissue);
  if (i === -1) return -1;
  return [order[i - 1], order[i + 1]].filter(Boolean)
    .reduce((max, n) => Math.max(max, boards[n] ? boards[n]._deepestInfectedRow() : -1), -1);
}

// As _adjacentThreatRow(), plus the edge column of `tissue` facing that
// neighbour — the exact cell a spillover would land on. null if none.
function _adjacentThreatCell(boards, tissue) {
  const order = STEALTH_CONFIG.BOARD.ADJACENCY_ORDER;
  const i = order.indexOf(tissue);
  if (i === -1) return null;
  let best = null;
  [order[i - 1], order[i + 1]].filter(Boolean).forEach(n => {
    const row = boards[n] ? boards[n]._deepestInfectedRow() : -1;
    if (row < 0 || (best && row <= best.row)) return;
    const col = order.indexOf(tissue) < order.indexOf(n) ? boards[tissue].cols - 1 : 0;
    best = { row, col };
  });
  return best;
}

// Antibody (one per tissue): permanently shields a whole virus-free row
// (_pickAntibodyRow(), board.js). Works on tissues the virus hasn't
// reached yet too — the shield is still there when it arrives.
function _antibodyDef(tissue) {
  return {
    id: `immune-antibody-${tissue}`, name: `Antibody: ${_capitalize(tissue)}`, icon: '🛡️', tissue,
    tooltip: `Protects an entire row of cells in ${_capitalize(tissue)} from infection.`,
    isUseful(game) { return game.boards[tissue]._pickAntibodyRow(_adjacentThreatRow(game.boards, tissue)) !== null; },
    apply(game) {
      const board = game.boards[tissue];
      const row = board._pickAntibodyRow(_adjacentThreatRow(game.boards, tissue));
      if (row === null) return { placed: false, protectedCells: [] };
      const protectedCells = board.protectRow(row, 0).map(cell => ({ ...cell, tissue })); // 0 turns = permanent
      return { placed: protectedCells.length > 0, protectedCells };
    },
  };
}

// Where a Cytokine of this `shape` should go. Active tissues first, most
// urgent (infection deepest, closest to the bottom row) first: the shape
// goes wherever it blocks the most of that tissue's frontier (see
// _bestCytokineAnchor(), board.js). Only if no active tissue has any
// frontier left does it pre-fortify a tissue the virus hasn't reached
// yet, covering the cell where the virus would enter (_pickEntryCell()).
// Returns { tissue, anchor } or { tissue, entry }, or null if there's
// nowhere useful to play it.
function _cytokinePickPlacement(game, shape) {
  const byUrgency = [...game.activeTissues].sort((a, b) =>
    game.boards[b]._deepestInfectedRow() - game.boards[a]._deepestInfectedRow());
  for (const t of byUrgency) {
    const anchor = game.boards[t]._bestCytokineAnchor(shape);
    if (anchor) return { tissue: t, anchor };
  }
  const inactive = STEALTH_CONFIG.BOARD.TISSUES.filter(t => !game.activeTissues.includes(t));
  for (const t of inactive) {
    const threat = _adjacentThreatCell(game.boards, t);
    const entry = game.boards[t]._pickEntryCell(threat ? threat.row : -1, threat ? threat.col : null);
    if (entry) return { tissue: t, entry };
  }
  return null;
}

// Which tissue's Antibody the Protein Vaccine grants: the most urgent
// active tissue that still has a row worth shielding, else an inactive one.
function _vaccineAntibodyPickTissue(game) {
  const byUrgency = [...game.activeTissues].sort((a, b) =>
    game.boards[b]._deepestInfectedRow() - game.boards[a]._deepestInfectedRow());
  for (const t of byUrgency) {
    if (game.boards[t]._pickAntibodyRow() !== null) return t;
  }
  const inactive = STEALTH_CONFIG.BOARD.TISSUES.filter(t => !game.activeTissues.includes(t));
  for (const t of inactive) {
    if (game.boards[t]._pickAntibodyRow() !== null) return t;
  }
  return null;
}

// Cytokine (one per colour): shields a shape of healthy cells for the
// virus's Cytokine duration (ctx.protectTurns; 0 = permanent).
function _cytokineDef(color, baseTier) {
  const cellWord = ({ 0: '1 healthy cell', 1: '5 healthy cells', 2: '9 healthy cells' })[baseTier];
  return {
    id: `immune-cytokine-${color}`, name: `Cytokine (${_capitalize(color)})`, icon: { blue: '🔵', orange: '🟠', red: '🔴' }[color], tier: baseTier,
    tooltip: `Shields ${cellWord} from infection. Duration depends on the virus: 3 turns against Norovirus, 4 against Influenza, and permanently against Hepatitis (only Cytokine Neutralisation removes it). A custom virus's own duration scales with its replication speed, from 3 turns at the slowest up to permanent at the fastest.`,
    // Useful whenever even a single cell could go somewhere worthwhile.
    isUseful(game) { return _cytokinePickPlacement(game, CYTOKINE_SHAPE_TIERS[0]) !== null; },
    apply(game, ctx) {
      const shape = !ctx.mrnaBoosted ? CYTOKINE_SHAPE_TIERS[baseTier]
        : color === 'red' ? CYTOKINE_RED_BOOST_SHAPE
        : CYTOKINE_SHAPE_TIERS[baseTier + 1];
      const placement = _cytokinePickPlacement(game, shape);
      if (!placement) return { protectedCells: [] };
      const board = game.boards[placement.tissue];
      const turns = ctx.protectTurns;
      const cells = placement.anchor
        ? board.placeShape(placement.anchor.col, placement.anchor.row, shape, turns, color)
        : board.protectShapeCovering(placement.entry.col, placement.entry.row, shape, turns, color);
      return { protectedCells: cells.map(cell => ({ ...cell, tissue: placement.tissue })) };
    },
  };
}

// NK Cell target: the deepest clearable infected cell across all active
// tissues, skipping tissues where the virus is already boxed in. null if
// there's nowhere worth playing it.
function _nkPickTarget(game) {
  let best = null;
  game.activeTissues.forEach(t => {
    const board = game.boards[t];
    if (!board.hasSpreadTarget()) return;
    const cell = board._pickDeepestInfectedCell();
    if (cell && (!best || cell.row > best.row)) best = { tissue: t, ...cell };
  });
  return best;
}


// ═══ 4. Immune card definitions ════════════════════════════════════

const IMMUNE_CARD_DEFS = {
  // Clears one infected cell in any tissue. Not boosted by mRNA Vaccine.
  'immune-nkcell': {
    id: 'immune-nkcell', name: 'NK Cell', icon: '⚔️',
    tooltip: 'Clears 1 infected cell from any tissue.',
    isUseful(game) { return _nkPickTarget(game) !== null; },
    apply(game) {
      const target = _nkPickTarget(game);
      if (!target) return { cleared: [] };
      const cell = game.boards[target.tissue].getCell(target.col, target.row);
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

  // Finds and clears one dormant (Latency) cell.
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
            board.cells[r][c].state = 'healthy';
            board.cells[r][c].dormantTurns = 0;
            return { revealed: true, tissue, col: c, row: r };
          }
        }
      }
      return { revealed: false };
    },
  },

  // Permanent −1 replication speed per play, stacking. The effect itself
  // is applied in game.js (_runImmuneResponse / effectiveReplicationSpeed).
  'immune-antiviral': {
    id: 'immune-antiviral', name: 'Antiviral', icon: '💊',
    tooltip: 'Permanently reduces the replication speed by -1. Stacks if played more than once.',
    isUseful(game) { return game.activeTissues.some(t => game.boards[t].infectedCount() > 0); },
    apply() {
      return { blocked: true };
    },
  },

  // Boosts T-Cells and Cytokines for MRNA_BOOST_TURNS. Held until a T-Cell
  // or Cytokine in hand can use the boost right now, so no boosted turns
  // are wasted. It resolves first in a turn (_immunePlayPriority(),
  // game.js) and sets ctx.mrnaBoosted, so cards played after it in the
  // same turn are already boosted.
  'vaccine-mrna': {
    id: 'vaccine-mrna', name: 'mRNA Vaccine', icon: '💉',
    tooltip: 'Powerup that increases the power of cytokines and T cells (clears 2 rows instead of 1).',
    isUseful(game) {
      if (game.mrnaBoostTurns > 0) return false;
      return game.immuneHand.some(c =>
        (c.id.startsWith('immune-tcell-') || c.id.startsWith('immune-cytokine-')) && c.isUseful(game));
    },
    apply(game, ctx) {
      game.mrnaBoostTurns = STEALTH_CONFIG.VACCINE.MRNA_BOOST_TURNS;
      if (ctx) ctx.mrnaBoosted = true;
      return { activated: true };
    },
  },

  // Adds a free Antibody card to the immune hand and lowers replication
  // speed by PROTEIN_SPEED_PENALTY_AMOUNT for PROTEIN_SPEED_PENALTY_TURNS
  // (separate from, and on top of, Antiviral's permanent penalty).
  'vaccine-protein': {
    id: 'vaccine-protein', name: 'Protein-based Vaccine', icon: '🧪',
    tooltip: 'Grants a bonus Antibody card for wherever it\'s needed most and reduces the virus\'s replication speed by -2 for 3 turns.',
    isUseful() { return true; }, // free value, no target required — always play it
    apply(game) {
      // The granted card is returned (not pushed to game.immuneHand here) —
      // _runImmuneResponse() rebuilds the hand after this turn's plays.
      const tissue = _vaccineAntibodyPickTissue(game) || STEALTH_CONFIG.BOARD.TISSUES[0];
      const grantedCards = [{ ...IMMUNE_CARD_DEFS[`immune-antibody-${tissue}`] }];
      game.proteinVaccineTurns = (game.proteinVaccineTurns || 0) + STEALTH_CONFIG.VACCINE.PROTEIN_SPEED_PENALTY_TURNS;
      return { bonusGranted: true, speedPenaltyApplied: true, grantedCards };
    },
  },
};


// ═══ 5. Immune deck ════════════════════════════════════════════════

// How many copies of each immune card are in the deck for this virus.
// Baseline: NK Cell, Antiviral and Sensing standard; vaccines rare;
// Cytokines common. Each named virus then tips the balance (below).
function buildImmuneDeckCounts(loadout) {
  const counts = {
    'immune-nkcell': 2,
    'immune-tcell-lung': 3, 'immune-tcell-liver': 3, 'immune-tcell-intestine': 3,
    'immune-antibody-lung': 3, 'immune-antibody-liver': 3, 'immune-antibody-intestine': 3,
    'immune-cytokine-blue': 2, 'immune-cytokine-orange': 4, 'immune-cytokine-red': 4,
    'immune-sensing': 2, 'immune-antiviral': 2,
    'vaccine-mrna': 1, 'vaccine-protein': 1,
  };
  const abilities = loadout.abilities || [];

  // Influenza: more Antibodies (counters its frequent Antibody Escape).
  if (loadout.id === 'influenza') {
    counts['immune-antibody-lung'] += 2; counts['immune-antibody-liver'] += 2; counts['immune-antibody-intestine'] += 2;
  }
  // Hepatitis: more T-Cells — the hardest, most persistent matchup.
  if (loadout.id === 'hepatitis') {
    counts['immune-tcell-lung'] += 3; counts['immune-tcell-liver'] += 3; counts['immune-tcell-intestine'] += 3;
  }
  // Norovirus: extra weak cards dilute the row-clearers — it can never
  // open a second tissue, so getting boxed in is a bigger risk for it.
  if (loadout.id === 'norovirus') {
    counts['immune-nkcell'] += 5; counts['immune-cytokine-blue'] += 6;
  }

  if (loadout.mutation === 'high') { counts['immune-sensing'] += 2; counts['vaccine-protein'] += 1; }

  if (abilities.includes('latency')) counts['immune-sensing'] += 2;

  return counts;
}

// Extra single-cell cards added for the first EARLY_DILUTION_TURNS turns
// only, so early row-clears don't wipe out a fresh infection. Unplayed
// copies are removed after that (ImmuneDeck.pruneEarlyDilution()).
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

  // Removes unplayed early-dilution copies from the draw and discard piles
  // (copies already in hand stay).
  pruneEarlyDilution() {
    this.draw = this.draw.filter(c => !c.__earlyDilution);
    this.discard = this.discard.filter(c => !c.__earlyDilution);
  }
}


// ═══ 6. Player (virus) deck — draft-based: offer N, pick M ═════════
class StealthDeck {
  constructor(loadoutDeckIds, activeTissues = [], difficultyName = 'medium', virusId = null) {
    this.draw    = [];
    this.discard = [];
    this._buildFromLoadout(loadoutDeckIds, activeTissues, difficultyName, virusId);
    this._shuffle(this.draw);
  }

  // Expands the loadout's card types into copies. Spread cards are always
  // included, with counts by difficulty band (config.js INFECT_CARDS) plus
  // per-virus adjustments.
  _buildFromLoadout(loadoutDeckIds, activeTissues, difficultyName, virusId) {
    const includedTypes = new Set(loadoutDeckIds.filter(id => !TROPISM_CARD_IDS.includes(id)));
    includedTypes.add('infect-horizontal');
    includedTypes.add('infect-vertical');
    const infectCounts = STEALTH_CONFIG.INFECT_CARDS[difficultyName] || STEALTH_CONFIG.INFECT_CARDS.medium;
    const verticalBonus = virusId === 'norovirus' ? STEALTH_CONFIG.NOROVIRUS_VERTICAL_BONUS : 0;
    const horizontalBonus = virusId === 'norovirus' ? STEALTH_CONFIG.NOROVIRUS_HORIZONTAL_BONUS
                           : virusId === 'hepatitis' ? -STEALTH_CONFIG.HEPATITIS_HORIZONTAL_PENALTY : 0;

    // Per-virus copy counts: Hepatitis gets fewer Replication Boosts;
    // Antibody Escape is very common for Influenza, rare for Norovirus.
    // Cards for tissues the virus hasn't reached yet are still included.
    const antibodyEscapeIds = ['antibody-escape-lung', 'antibody-escape-liver', 'antibody-escape-intestine'];
    const countOverrides = {};
    if (virusId === 'hepatitis') countOverrides['spread-speed-plus'] = 2;
    if (virusId === 'influenza') antibodyEscapeIds.forEach(id => { countOverrides[id] = 7; });
    if (virusId === 'norovirus') antibodyEscapeIds.forEach(id => { countOverrides[id] = 1; });

    includedTypes.forEach(id => {
      const def = STEALTH_CARD_DEFS[id];
      if (!def) return;
      // Spread counts never drop below 1 copy.
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

  // Draws OFFER_COUNT cards for the player to choose from (resolve with
  // resolveDraft()). Avoids offering the same card type twice: duplicates
  // are set aside and returned to the draw pile, unless nothing else is
  // left in the deck.
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

  // Picked cards go to the hand; the rest are discarded.
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
}
