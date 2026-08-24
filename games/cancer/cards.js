// ═══════════════════════════════════════════════════════════════════
//  cards.js — Card definitions, deck building, and card effects.
//
//  Each card definition:
//    id          unique string key
//    name        display name
//    category    'immune' | 'treatment'
//    rarity      'common' | 'uncommon' | 'rare'
//    count       copies in a standard deck
//    tooltip     plain-language description for teenage audience
//    effect(board, target, difficulty) → { result text, changed cells[] }
// ═══════════════════════════════════════════════════════════════════

const CARD_DEFS = {

  // ── IMMUNE CELL CARDS ──────────────────────────────────────────

  cytotoxic_t: {
    id: 'cytotoxic_t',
    name: 'Cytotoxic T cell',
    category: 'immune',
    rarity: 'common',
    count: 6,
    colour: '#00e5ff',
    icon: '🔬',
    tooltip: 'A killer T cell trained to recognise your specific tumour. It scans cells for abnormal proteins and destroys anything that matches.',
    // Target: a row index. Clears all cancerous cells in that row.
    targetType: 'row',
    apply(board, target, state) {
      const cleared = board.clearCancerousInRow(target.row);
      return {
        text: `Cytotoxic T cell: cleared ${cleared} cancerous cell(s) in row ${target.row + 1}.`,
        count: cleared,
      };
    },
  },

  nk_cell: {
    id: 'nk_cell',
    name: 'NK cell',
    category: 'immune',
    rarity: 'common',
    count: 5,
    colour: '#00e5ff',
    icon: '⚡',
    tooltip: "Natural Killer cells don't need training — they destroy any cell that's hiding its identity. Cancer cells often try to go invisible; NK cells call their bluff.",
    // Target: a row. Clears cancerous cells in that row.
    // Ignores immune evasion mutation.
    targetType: 'row',
    ignoresEvasion: true,
    apply(board, target, state) {
      const cleared = board.clearCancerousInRow(target.row, { ignoreEvasion: true });
      return {
        text: `NK cell: cleared ${cleared} cancerous cell(s) in row ${target.row + 1}. Immune evasion ignored.`,
        count: cleared,
      };
    },
  },

  macrophage: {
    id: 'macrophage',
    name: 'Macrophage (M1)',
    category: 'immune',
    rarity: 'common',
    count: 5,
    colour: '#00e5ff',
    icon: '🫁',
    tooltip: 'An activated macrophage engulfs tumour cells and sends alarm signals to recruit more immune cells to the area.',
    // Target: single cell. Clears it + draws 1 extra card.
    targetType: 'cell',
    apply(board, target, state) {
      const cleared = board.clearCell(target.col, target.row);
      if (cleared) state.drawBonus = (state.drawBonus || 0) + 1;
      return {
        text: cleared
          ? `Macrophage: cleared cell [${target.col + 1},${target.row + 1}]. Draw +1 card.`
          : `Macrophage: target cell is not cancerous.`,
        count: cleared ? 1 : 0,
      };
    },
  },

  neutrophil: {
    id: 'neutrophil',
    name: 'Neutrophil',
    category: 'immune',
    rarity: 'common',
    count: 4,
    colour: '#00e5ff',
    icon: '💥',
    tooltip: 'Your fastest first responders. Neutrophils rush to tumours, releasing toxic chemicals that damage and kill cancer cells.',
    // Target: single cell. Clears it; if established tumour counts as 2 plays.
    targetType: 'cell',
    apply(board, target, state) {
      const cell = board.getCell(target.col, target.row);
      if (!cell || cell.state !== 'cancerous') {
        return { text: 'Neutrophil: target is not cancerous.', count: 0 };
      }
      if (cell.established) {
        board.clearCell(target.col, target.row);
        return { text: `Neutrophil: cleared established tumour cell [${target.col + 1},${target.row + 1}] in one hit.`, count: 1 };
      }
      board.clearCell(target.col, target.row);
      return { text: `Neutrophil: cleared cell [${target.col + 1},${target.row + 1}].`, count: 1 };
    },
  },

  cytokines: {
    id: 'cytokines',
    name: 'Cytokines (IFN-γ / IL-2)',
    category: 'immune',
    rarity: 'uncommon',
    count: 4,
    colour: '#a855f7',
    icon: '📡',
    tooltip: 'Chemical messengers that turbocharge your immune cells. IFN-γ and IL-2 tell your defenders to work harder and faster.',
    // Two modes selectable by player:
    //   'single' — protects 1 healthy cell (blocks cancer spread into it for 2 turns)
    //   'row'    — protects 3 cells in a horizontal row
    targetType: 'cytokine',   // special UI: player picks single or row then target
    apply(board, target, state) {
      if (target.mode === 'row') {
        const protected_ = board.protectRow(target.row, 3, target.startCol);
        return { text: `Cytokines: protected ${protected_} cells in row ${target.row + 1}.`, count: protected_ };
      } else {
        const protected_ = board.protectCell(target.col, target.row);
        return { text: `Cytokines: protected cell [${target.col + 1},${target.row + 1}].`, count: protected_ ? 1 : 0 };
      }
    },
  },

  dendritic: {
    id: 'dendritic',
    name: 'Dendritic cell',
    category: 'immune',
    rarity: 'uncommon',
    count: 3,
    colour: '#a855f7',
    icon: '🧬',
    tooltip: "The immune system's teacher. Dendritic cells capture tumour fragments and show them to T cells, training them to recognise the cancer.",
    // No target needed — shuffles 2 discarded cytotoxic_t cards back into deck.
    targetType: 'none',
    apply(board, target, state) {
      const recycled = state.deck.recycleFromDiscard('cytotoxic_t', 2);
      return {
        text: `Dendritic cell: recycled ${recycled} Cytotoxic T cell card(s) from discard back into deck.`,
        count: recycled,
      };
    },
  },

  // ── TREATMENT CARDS ────────────────────────────────────────────

  monoclonal_ab: {
    id: 'monoclonal_ab',
    name: 'Monoclonal antibody therapy',
    category: 'treatment',
    rarity: 'uncommon',
    count: 2,
    colour: '#ff9f1c',
    icon: '🛡️',
    tooltip: 'Lab-made antibodies designed to lock onto specific proteins on cancer cells, flagging them for destruction or blocking their growth signals.',
    // Target: a row. Places a barrier on ALL healthy cells in that row —
    // cancer cannot spread into them for 3 turns.
    targetType: 'row',
    apply(board, target, state) {
      const blocked = board.barrierRow(target.row);
      return {
        text: `Monoclonal antibody: barrier placed on row ${target.row + 1} — ${blocked} cell(s) protected from spread for 3 turns.`,
        count: blocked,
      };
    },
  },

  car_t: {
    id: 'car_t',
    name: 'CAR T-cell therapy',
    category: 'treatment',
    rarity: 'rare',
    count: 1,
    colour: '#ff4d6d',
    icon: '🧪',
    tooltip: "Your own T cells, reprogrammed in a lab to hunt this exact cancer. One of the most powerful — and most intense — treatments available.",
    // Target: centre of a 3×3 area. Clears all cancerous cells in it.
    // Expert difficulty: player skips card draw next turn.
    targetType: 'cell',
    apply(board, target, state) {
      const cleared = board.clearArea(target.col, target.row, 3, 3);
      if (state.difficulty === 'expert') {
        state.skipDrawNextTurn = true;
      }
      const sideNote = state.difficulty === 'expert' ? ' (card draw skipped next turn — cytokine storm)' : '';
      return {
        text: `CAR T-cell therapy: cleared ${cleared} cancerous cell(s) in 3×3 area${sideNote}.`,
        count: cleared,
      };
    },
  },

  vaccine: {
    id: 'vaccine',
    name: 'Cancer vaccine',
    category: 'treatment',
    rarity: 'rare',
    count: 2,
    colour: '#39ff14',
    icon: '💉',
    tooltip: "Unlike vaccines for infections, this one trains your immune system to attack cancer cells it already has. It primes your defences for the fight ahead.",
    // Power-up: for next 4 turns, all immune cell cards clear 1 additional
    // adjacent cell and cytokines protect a larger area.
    targetType: 'none',
    apply(board, target, state) {
      state.vaccineBoostTurns = CONFIG.CARDS.VACCINE_BOOST_TURNS;
      return {
        text: `Cancer vaccine: immune cells boosted for ${CONFIG.CARDS.VACCINE_BOOST_TURNS} turns — each card clears +1 adjacent cell.`,
        count: 0,
      };
    },
  },

  radiotherapy: {
    id: 'radiotherapy',
    name: 'Radiotherapy',
    category: 'treatment',
    rarity: 'uncommon',
    count: 2,
    colour: '#ff9f1c',
    icon: '☢️',
    tooltip: 'Focused beams of radiation that shred the DNA of fast-dividing cancer cells. Powerful, but nearby healthy cells take some damage too.',
    // Target: a column. Clears all cancerous cells in that column + 1 adjacent.
    // Side effect (all difficulties): healthy cells in those columns become
    // 'damaged' for 2 turns — cannot be protected.
    targetType: 'col',
    apply(board, target, state) {
      const cols = [target.col];
      if (target.col + 1 < CONFIG.BOARD.COLS) cols.push(target.col + 1);
      let cleared = 0;
      cols.forEach(c => { cleared += board.clearCancerousInCol(c); });
      cols.forEach(c => { board.damageHealthyInCol(c, CONFIG.CARDS.RADIO_DAMAGE_TURNS); });
      return {
        text: `Radiotherapy: cleared ${cleared} cancerous cell(s) across ${cols.length} column(s). Healthy cells in those columns damaged for ${CONFIG.CARDS.RADIO_DAMAGE_TURNS} turns.`,
        count: cleared,
      };
    },
  },

  chemotherapy: {
    id: 'chemotherapy',
    name: 'Chemotherapy',
    category: 'treatment',
    rarity: 'rare',
    count: 1,
    colour: '#ff4d6d',
    icon: '⚗️',
    tooltip: 'Drugs that kill rapidly dividing cells across the whole body. Highly effective against cancer — but your immune cells divide quickly too, so they take a hit.',
    // Clears all cancerous cells on board EXCEPT top row.
    // Side effect (all difficulties): immune cell cards deal half damage for 3 turns.
    targetType: 'none',
    apply(board, target, state) {
      const cleared = board.clearAllCancerous({ exceptRow: 0 });
      state.immunePenaltyTurns = CONFIG.CARDS.CHEMO_PENALTY_TURNS;
      state.immunePenaltyMult  = 0.5;
      return {
        text: `Chemotherapy: cleared ${cleared} cancerous cell(s) (top row preserved). Immune cards at 50% for ${CONFIG.CARDS.CHEMO_PENALTY_TURNS} turns.`,
        count: cleared,
      };
    },
  },

  steroids: {
    id: 'steroids',
    name: 'Steroids (corticosteroids)',
    category: 'treatment',
    rarity: 'uncommon',
    count: 2,
    colour: '#ff9f1c',
    icon: '💊',
    tooltip: "Reduce inflammation and calm the side effects of other treatments. Useful for managing the battle — but they also quiet your immune system temporarily.",
    // Removes established status from all cancerous cells.
    // Side effect (all difficulties): immune cards at 50% for 2 turns.
    targetType: 'none',
    apply(board, target, state) {
      const reset = board.resetEstablished();
      state.immunePenaltyTurns = CONFIG.CARDS.STEROID_PENALTY_TURNS;
      state.immunePenaltyMult  = 0.5;
      return {
        text: `Steroids: ${reset} established tumour cell(s) reverted to normal. Immune cards at 50% for ${CONFIG.CARDS.STEROID_PENALTY_TURNS} turns.`,
        count: reset,
      };
    },
  },
};

// ── Deck builder ─────────────────────────────────────────────────

class Deck {
  constructor() {
    this.draw    = [];
    this.discard = [];
    this._build();
    this._shuffle(this.draw);
  }

  _build() {
    Object.values(CARD_DEFS).forEach(def => {
      for (let i = 0; i < def.count; i++) {
        this.draw.push({ ...def });
      }
    });
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  drawCards(n) {
    const hand = [];
    for (let i = 0; i < n; i++) {
      if (this.draw.length === 0) {
        if (this.discard.length === 0) break;
        this.draw = [...this.discard];
        this.discard = [];
        this._shuffle(this.draw);
      }
      hand.push(this.draw.pop());
    }
    return hand;
  }

  discardCard(card) {
    this.discard.push(card);
  }

  recycleFromDiscard(cardId, count) {
    let recycled = 0;
    for (let i = this.discard.length - 1; i >= 0 && recycled < count; i--) {
      if (this.discard[i].id === cardId) {
        const [card] = this.discard.splice(i, 1);
        const pos = Math.floor(Math.random() * (this.draw.length + 1));
        this.draw.splice(pos, 0, card);
        recycled++;
      }
    }
    return recycled;
  }

  get drawCount()    { return this.draw.length; }
  get discardCount() { return this.discard.length; }
}
