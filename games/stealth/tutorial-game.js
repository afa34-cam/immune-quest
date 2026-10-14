// ═══════════════════════════════════════════════════════════════════
//  IMMUNE QUEST — Stealth Mission
//  tutorial-game.js — the scripted practice mission. No DOM code here;
//  the guide character and on-screen steps are in tutorial.js.
//
//  TutorialGame is the normal StealthGame (game.js) with every random
//  part replaced by the script below, so the mission plays out the same
//  way every time and every card type comes up:
//    - virus spread and spillover: the exact cells listed per turn
//    - immune system: the exact cards it draws each turn (it still
//      chooses where to play them, using the normal rules)
//    - mutations and the cards offered in Pick Cards
//  What's left (e.g. which cell a Horizontal Spread picks) uses a fixed
//  random seed. The player's moves are fixed too (tutorial.js only
//  allows the scripted ones), so the whole mission is repeatable.
//
//  Contents
//    1. Practice virus (loadout)
//    2. Turn script
//    3. TutorialGame
// ═══════════════════════════════════════════════════════════════════


// ═══ 1. Practice virus ═════════════════════════════════════════════
// A made-up virus with a bit of everything. Starts in the lung only.
const TUTORIAL_LOADOUT_BASE = {
  id: 'tutorial',
  name: 'Spike',
  icon: '🦠',
  color: '#b06bff',
  tissue: ['lung-tropism'],
  replication: 5,
  mutation: 'medium',
  abilities: ['latency', 'activate-tregs', 'mhc1-downreg'],
};

// Starting infection, as [col, row] (row 0 = top).
const TUTORIAL_SEED = { lung: [[1, 0], [2, 0], [2, 1]] };

const TUTORIAL_RNG_SEED = 20261014;


// ═══ 2. Turn script ════════════════════════════════════════════════
// One entry per turn:
//   spread    — cells infected in the Virus Spread phase, per tissue, in
//               order. A listed cell is only infected if it's healthy and
//               already touches infection (above, left or right), so the
//               spread always looks natural.
//   spillover — [{ from, to, row }]: infection crossing into the facing
//               edge cell of a neighbouring tissue.
//   immune    — the cards the immune system draws.
//   mutation  — { event, target } (event as in game.js; target = the
//               tissue or colour it applies to), or null for none.
//   offer     — the 3 cards offered in Pick Cards.
//   actions   — the player's moves, in order (tutorial.js only allows
//               these). pick: the 2 cards to keep; play: a hand card,
//               with its target (block: any cell of that Cytokine colour);
//               trade: 3 cards to give and the one to receive; end.
const TUTORIAL_TURNS = {
  1: {
    spread: { lung: [[3, 0], [1, 1], [2, 2]] },
    immune: ['immune-nkcell', 'immune-cytokine-blue'],
    mutation: null,
    offer: ['infect-vertical', 'infect-horizontal', 'spread-speed-plus'],
    actions: [
      { pick: ['infect-vertical', 'infect-horizontal'] },
      { play: 'infect-vertical', tissue: 'lung' },
      { end: true },
    ],
  },
  2: {
    spread: { lung: [[1, 2], [3, 2], [1, 3], [3, 3]] },
    immune: ['immune-antibody-lung', 'immune-cytokine-orange'],
    mutation: { event: 'tropism_gain', target: 'liver' },
    offer: ['antibody-escape-lung', 'spread-speed-plus', 'latency'],
    actions: [
      { pick: ['antibody-escape-lung', 'spread-speed-plus'] },
      { play: 'antibody-escape-lung' },
      { play: 'spread-speed-plus' },
      { end: true },
    ],
  },
  3: {
    spread: { lung: [[1, 4], [3, 4], [1, 5], [3, 5], [2, 4], [2, 5]], liver: [[2, 1], [2, 2]] },
    immune: ['immune-tcell-lung', 'immune-antiviral'],
    mutation: { event: 'cytokine_neutralise_gain', target: 'orange' },
    offer: ['mhc1-downreg-lung', 'latency', 'infect-vertical'],
    actions: [
      { pick: ['mhc1-downreg-lung', 'latency'] },
      { play: 'cytokine-neutralise-orange', tissue: 'lung', block: 'orange' },
      { play: 'mhc1-downreg-lung' },
      { end: true },
    ],
  },
  4: {
    spread: { lung: [[0, 3], [0, 4]], liver: [[2, 3], [1, 2], [3, 2]] },
    immune: ['immune-tcell-lung', 'immune-cytokine-red'],
    mutation: { event: 'speed_gain' },
    offer: ['activate-tregs', 'spread-speed-plus', 'infect-vertical'],
    actions: [
      { pick: ['activate-tregs', 'infect-vertical'] },
      { play: 'latency', tissue: 'lung', col: 1, row: 6 },
      { play: 'infect-horizontal', tissue: 'liver' },
      { play: 'activate-tregs' },
      { end: true },
    ],
  },
  5: {
    spread: { lung: [[0, 5], [1, 5]], liver: [[2, 4], [1, 3], [3, 3]] },
    spillover: [{ from: 'lung', to: 'liver', row: 4 }],
    immune: ['immune-sensing', 'vaccine-protein'],
    mutation: null,
    offer: ['spread-speed-plus', 'infect-horizontal', 'mhc1-downreg-liver'],
    actions: [
      { pick: ['spread-speed-plus', 'infect-horizontal'] },
      { play: 'infect-vertical', tissue: 'liver' },
      { end: true },
    ],
  },
  6: {
    spread: { liver: [[3, 5]] },
    immune: [],
    mutation: null,
    offer: ['infect-vertical', 'activate-tregs', 'spread-speed-plus'],
    actions: [
      { pick: ['infect-vertical', 'activate-tregs'] },
      { trade: { give: ['spread-speed-plus', 'infect-horizontal', 'activate-tregs'], receive: 'latency' } },
      { play: 'latency', tissue: 'lung', col: 1, row: 8 },
      { end: true },
    ],
  },
  7: {
    spread: { lung: [[1, 7], [0, 6], [2, 6]], liver: [[2, 5]] },
    immune: ['vaccine-mrna', 'immune-tcell-liver'],
    mutation: null,
    offer: ['antibody-escape-lung', 'spread-speed-plus', 'infect-horizontal'],
    actions: [
      { pick: ['antibody-escape-lung', 'spread-speed-plus'] },
      { play: 'antibody-escape-lung' },
      { play: 'spread-speed-plus' },
      { play: 'infect-vertical', tissue: 'lung' },
      { end: true },
    ],
  },
  // Turn 8's spread reaches the bottom row: mission complete.
  8: {
    spread: { lung: [[1, 8], [0, 8], [1, 9], [2, 7]] },
  },
};


// ═══ 3. TutorialGame ═══════════════════════════════════════════════

// Small, fast seeded random number generator (mulberry32).
function _tutorialRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Runs fn with Math.random swapped for `rng`, so only the engine's own
// calls use the seed (the UI's random timings don't shift it).
function _withRng(rng, fn) {
  const original = Math.random;
  Math.random = rng;
  try { return fn(); } finally { Math.random = original; }
}

class TutorialGame extends StealthGame {
  constructor(loadout) {
    _withRng(_tutorialRng(TUTORIAL_RNG_SEED), () => super(loadout));
    // A fresh generator for play, so the decks' size (which changes how
    // many numbers the shuffles used) can't change what happens next.
    this._rng = _tutorialRng(TUTORIAL_RNG_SEED + 1);
    this.isTutorial = true;

    // Fixed starting infection instead of the random seed blob.
    Object.values(this.boards).forEach(board => board._init());
    Object.entries(TUTORIAL_SEED).forEach(([tissue, cells]) => {
      const board = this.boards[tissue];
      cells.forEach(([c, r]) => board._infect(board.getCell(c, r)));
    });

    // Scripted spread on every board; immune draws from the script.
    Object.values(this.boards).forEach(board => {
      board.spreadVirus = () => this._scriptedSpread(board);
    });
    this.immuneDeck.drawCards = () => (this._turnScript().immune || [])
      .map(id => ({ ...IMMUNE_CARD_DEFS[id] }));
  }

  _turnScript() { return TUTORIAL_TURNS[this.turn] || {}; }

  // Public entry points run with the seeded random generator.
  start()                      { return _withRng(this._rng, () => super.start()); }
  advance()                    { return _withRng(this._rng, () => super.advance()); }
  resolveDraft(picked)         { return _withRng(this._rng, () => super.resolveDraft(picked)); }
  tradeCards(give, receive)    { return _withRng(this._rng, () => super.tradeCards(give, receive)); }
  playCard(index, target)      { return _withRng(this._rng, () => super.playCard(index, target)); }
  endTurn()                    { return _withRng(this._rng, () => super.endTurn()); }

  // Virus Spread: wake dormant cells (as normal), then infect the
  // scripted cells that are healthy and touch infection.
  _scriptedSpread(board) {
    const cells = [], awoken = [];
    board.justSeeded = false;
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const cell = board.cells[r][c];
        if (cell.state === 'dormant' && --cell.dormantTurns <= 0) {
          cell.state = 'infected';
          cell.turnsInfected = 1;
          cells.push({ col: c, row: r });
          awoken.push({ col: c, row: r });
        }
      }
    }
    const planned = (this._turnScript().spread || {})[board.tissue] || [];
    planned.forEach(([c, r]) => {
      const cell = board.getCell(c, r);
      const touches = [[c, r - 1], [c - 1, r], [c + 1, r]]
        .some(([nc, nr]) => board.getCell(nc, nr)?.state === 'infected');
      if (cell && touches && board._infect(cell)) cells.push({ col: c, row: r });
    });
    return { cells, awoken };
  }

  // Spillover: only the scripted crossings.
  _runSpillover() {
    const order = STEALTH_CONFIG.BOARD.ADJACENCY_ORDER;
    const results = [];
    (this._turnScript().spillover || []).forEach(({ from, to, row }) => {
      const toBoard = this.boards[to];
      const col = order.indexOf(to) < order.indexOf(from) ? toBoard.cols - 1 : 0;
      if (this.activeTissues.includes(to) && toBoard._infect(toBoard.getCell(col, row))) {
        this.tissuesReached.add(to);
        results.push({ from, to, col, row });
      }
    });
    return results;
  }

  // No surprise immune trades.
  _maybeTradeImmuneHand() { return null; }

  // Mutations: the scripted one (or none), on the scripted tissue/colour.
  _rollMutation() {
    const m = this._turnScript().mutation;
    return m ? m.event : null;
  }

  _pickMutationTarget(options) {
    const target = (this._turnScript().mutation || {}).target;
    return options.includes(target) ? target : options[0];
  }

  // Pick Cards: the scripted offer.
  _runDraftPhase() {
    this.phase = 'play_cards';
    this.currentOffer = (this._turnScript().offer || []).map(id => ({ ...STEALTH_CARD_DEFS[id] }));
    // An empty offer (last turn) skips straight to Play Cards.
    if (!this.currentOffer.length) this.currentOffer = null;
  }

  // Practice only: no score, progress or analytics.
  _saveScore() {}
}
