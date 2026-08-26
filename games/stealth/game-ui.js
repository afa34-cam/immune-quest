// ═══════════════════════════════════════════════════════════════════
//  game-ui.js — Renders StealthGame (game.js) and wires up player
//  interaction. game.js/board.js/cards.js never touch the DOM directly;
//  everything here reads their state and renders it, or turns a click into
//  a game.js method call. Roughly, top to bottom:
//
//    Card rendering    — renderCardFace(), getCardArtPath(), the card info
//                         modal (openCardInfo()).
//    Page layout        — renderGame() (the main per-frame entry point),
//                         fitGameStage() and the align*() helpers that size
//                         #game-stage to fit under the header, and
//                         checkViewportGate() for the too-small/portrait
//                         lockout.
//    Turn narration      — runAutoPhase() steps through a phase's narration
//                         one line at a time (buildVirusGrowthSteps()/
//                         buildImmuneSteps()/buildMutationSteps() build the
//                         step lists); boardRevealMask/primeBoardRevealMask()
//                         keep not-yet-narrated board changes hidden until
//                         their own step reveals them.
//    Banners             — renderVirusTraits()/renderVirusInfoPanel() (the
//                         virus's own Active Cards + identity panel) and
//                         renderImmuneBanner() (the immune system's).
//    Board               — renderBoards()/_applyCellVisual().
//    Draft/Trade popups  — renderDraft()/renderTradeModal() and their
//                         confirm*()/toggle*() handlers.
//    Hand + play         — renderHand(), selectHandCard(), onCellClick(),
//                         playSelectedCard() — the player's own turn.
//    End screen           — renderEndScreen()/alignEndScreenBoard().
// ═══════════════════════════════════════════════════════════════════

let activeGame = null;
let selectedHandIndex = null;
// Set when a play attempt fails validation (e.g. targeting a cell an
// immune card already protects) — shown once in place of the usual play
// hint so the player knows why nothing happened, then cleared. The card
// itself is never spent on a failed attempt (see game.js playCard()).
let lastPlayError = null;

// Fixed left-to-right board order, regardless of which tissues are active.
const TISSUE_ORDER = ['liver', 'lung', 'intestine'];
const STATE_LABEL  = { healthy: 'Healthy', infected: 'Infected', dormant: 'Dormant', immune: 'Antibody' };

function _cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Shows/hides a pair of small pulsing arrows flanking a horizontally-
// scrollable card row, whenever there are more cards than currently fit —
// and wires each up to actually scroll the row on click, one roughly-a-
// page nudge at a time (back or forward), rather than being a purely
// visual hint while dragging/the wheel were the only real ways to move
// the row. Both arrows show together whenever the row overflows at all
// (not just once you've actually scrolled toward one end) — same simple
// "there's more here" hint the single forward arrow already gave, just
// now offered in both directions since a row can be scrolled back too.
// backArrowEl is optional — the few callers that don't have one yet
// (a future addition) just get the forward-only behavior this always had.
function updateScrollArrows(rowEl, backArrowEl, forwardArrowEl) {
  if (!rowEl) return;
  const overflowing = rowEl.scrollWidth > rowEl.clientWidth + 2;
  if (forwardArrowEl) {
    forwardArrowEl.classList.toggle('visible', overflowing);
    forwardArrowEl.onclick = () => rowEl.scrollBy({ left: rowEl.clientWidth * 0.8, behavior: 'smooth' });
  }
  if (backArrowEl) {
    backArrowEl.classList.toggle('visible', overflowing);
    backArrowEl.onclick = () => rowEl.scrollBy({ left: -rowEl.clientWidth * 0.8, behavior: 'smooth' });
  }
}

// Builds and wires up a back/forward scroll-arrow pair for a dynamically
// rebuilt card row (Active Cards / Immune System banners — the hand and
// draft popup rows have their own static HTML arrows instead, see
// index.html). Inserts the back arrow BEFORE cardsRow and the forward
// arrow after, so they flank it left/right in the flex row.
function appendScrollArrowPair(wrap, cardsRow) {
  const back = document.createElement('div');
  back.className = 'scroll-arrow scroll-arrow-back';
  back.textContent = '◂';
  wrap.appendChild(back);
  wrap.appendChild(cardsRow);
  const forward = document.createElement('div');
  forward.className = 'scroll-arrow';
  forward.textContent = '▸';
  wrap.appendChild(forward);
  updateScrollArrows(cardsRow, back, forward);
}

// ── Card art ─────────────────────────────────────────────────────
//  Cards ship as transparent PNGs (title/icon/flavour text baked in as
//  light-coloured text meant to sit on a dark navy backdrop — see the
//  --card-bg CSS var). One size now — the small in-play art — used
//  everywhere including the draft popup and the info modal; the separate
//  "large" art set is unused. Every card has real art now; this stays
//  empty as a fallback slot (renders a generated placeholder instead of
//  a broken image) for whenever a new card ships without art yet.
const NO_ART_IDS = new Set([]);

function getCardArtPath(card) {
  if (NO_ART_IDS.has(card.id)) return null;
  // T-Cell/Antibody's tissue is baked directly into their id now
  // (immune-tcell-lung, etc. — one fixed variant per tissue, see
  // cards.js _tcellDef/_antibodyDef), which already matches the asset
  // filenames 1:1, so no separate tissue-suffixing is needed here.
  return `assets/cards/small/${card.id}.png`;
}

// Renders one card as a clickable face (art or generated placeholder)
// with an (i) button that opens the info modal. `onClick` fires on the
// face itself (selection/play); the (i) button always opens info,
// independent of whatever the face's own click does.
//
// Two-layer DOM on purpose: .card-face (el, returned) is just a
// positioning shell with overflow:visible, and .card-face-art (artEl) is
// the actual card-shaped rectangle — border, rounded corners, the art
// image itself, all clipped via overflow:hidden. The corner badges
// (.card-info-btn/.card-face-turns-badge) are children of `el`, not
// `artEl`, specifically so they can hang half outside the card's own
// rounded-rect bounds without artEl's overflow:hidden cutting them off.
function renderCardFace(card, { tissue, extraClass = '', onClick, badge } = {}) {
  const el = document.createElement('div');
  el.className = `card-face ${extraClass}`.trim();

  const artEl = document.createElement('div');
  artEl.className = 'card-face-art';
  const art = getCardArtPath(card);
  if (art) {
    artEl.style.backgroundImage = `url('${art}')`;
  } else {
    artEl.classList.add('card-face-placeholder');
    artEl.innerHTML = `<div class="card-face-icon">${card.icon}</div><div class="card-face-name">${card.name}</div>`;
  }
  // No tissue-tag overlay any more — the card art itself already prints
  // the tissue name (e.g. "LUNG" baked into antibody-escape-lung.png), so
  // a second label on top of it was redundant. `tissue` is still passed
  // through to openCardInfo() below for the info-modal narration.
  el.appendChild(artEl);

  if (onClick) el.onclick = onClick;

  const infoBtn = document.createElement('button');
  infoBtn.className = 'card-info-btn';
  infoBtn.textContent = 'ⓘ';
  infoBtn.onclick = (e) => { e.stopPropagation(); openCardInfo(card, tissue); };
  el.appendChild(infoBtn);

  // Turns-remaining badge (e.g. an active Vaccine boost) — bottom-right,
  // mirroring the info button's top-right corner treatment.
  if (badge) {
    const badgeEl = document.createElement('div');
    badgeEl.className = 'card-face-turns-badge';
    badgeEl.textContent = badge;
    el.appendChild(badgeEl);
  }

  return el;
}

// The real immunology/virology each card is modelling — shown as its own
// "The Biology" section in the info modal, separate from "In This Game"
// (card.tooltip, or card.desc for the builder-only trait markers in
// VIRUS_CARDS), so a player can tell at a glance which part is the rules
// and which part is the science. Tissue-specific card families (T-Cell,
// Antibody, Antibody Escape, T-Cell Evasion) share one entry per id since
// the underlying biology doesn't differ by organ, just the wording of
// which cells/proteins are involved.
const CARD_BIOLOGY_TEXT = {
  'infect-horizontal': 'Once a virus gets into a tissue, it hijacks a cell’s own machinery to make copies of itself (replicate). Those copies burst out and infect the cells right next door, so an infection spreads outward from wherever it first took hold.',
  'infect-vertical': 'Once a virus gets into a tissue, it hijacks a cell’s own machinery to make copies of itself (replicate). Those copies burst out and infect the cells right next door, so an infection spreads outward from wherever it first took hold.',
  'spread-speed-plus': 'Viruses that replicate faster push out more virus particles per infected cell, so the infection spreads through a tissue more quickly. The trade-off is that faster, sloppier copying also produces more errors (mutations) in the new copies.',
  'latency': 'Some viruses (herpesviruses are the classic example) can go dormant inside a cell. They sit quietly without actively multiplying or triggering an immune alarm. At a later time, for example when the immune system is a bit weaker, they can reactivate and start spreading again. Sometimes this does not happen until years afterwards!',
  'cytokine-neutralise-blue': 'Cytokines are the messenger molecules of the immune system. These chemical alarm signals are released by cells to warn their neighbours and call in immune reinforcements. Some viruses carry proteins that block or break down these signals before they can spread the warning to nearby cells.',
  'cytokine-neutralise-orange': 'Cytokines are the messenger molecules of the immune system. These chemical alarm signals are released by cells to warn their neighbours and call in immune reinforcements. Some viruses carry proteins that block or break down these signals before they can spread the warning to nearby cells.',
  'cytokine-neutralise-red': 'Cytokines are the messenger molecules of the immune system. These chemical alarm signals are released by cells to warn their neighbours and call in immune reinforcements. Some viruses carry proteins that block or break down these signals before they can spread the warning to nearby cells.',
  'activate-tregs': 'Regulatory T cells (Tregs) normally act as a brake, keeping the immune system from overreacting and damaging the body’s own healthy tissue. Some viruses can hijack that brake to dial down the immune response specifically against themselves.',
  'antibody-escape-lung': 'Antibodies recognise a virus by the exact 3D shape of proteins on its surface. If the virus mutates those proteins, antibodies that used to lock onto it may no longer fit. This allows the virus to "escape" that antibody. Influenza virus is particularly good at this and rapidly changes its surface proteins. This is why every year the vaccine formulation needs to be updated, just so that our bodies make the right kind of antibodies to protect us from the latest variant.',
  'antibody-escape-liver': 'Antibodies recognise a virus by the exact 3D shape of proteins on its surface. If the virus mutates those proteins, antibodies that used to lock onto it may no longer fit. This allows the virus to "escape" that antibody. Influenza virus is particularly good at this and rapidly changes its surface proteins. This is why every year the vaccine formulation needs to be updated, just so that our bodies make the right kind of antibodies to protect us from the latest variant.',
  'antibody-escape-intestine': 'Antibodies recognise a virus by the exact 3D shape of proteins on its surface. If the virus mutates those proteins, antibodies that used to lock onto it may no longer fit. This allows the virus to "escape" that antibody. Influenza virus is particularly good at this and rapidly changes its surface proteins. This is why every year the vaccine formulation needs to be updated, just so that our bodies make the right kind of antibodies to protect us from the latest variant.',
  'mhc1-downreg-lung': 'Cells have molecules at their surface which are like windows into the cell. These molecules called MHC class I (or HLA class I in humans) allow the immune system to peek inside to make sure that the cell is healthy. If the cell is infected or diseased, immune cells called T cells can spot this and destroy the target cell.\n\nSome viruses try to close or obscure the windows so that the immune system can’t peek inside and spot the infection. So the T cells won’t be alerted to the virus, and it can keep replicating and spreading.',
  'mhc1-downreg-liver': 'Cells have molecules at their surface which are like windows into the cell. These molecules called MHC class I (or HLA class I in humans) allow the immune system to peek inside to make sure that the cell is healthy. If the cell is infected or diseased, immune cells called T cells can spot this and destroy the target cell.\n\nSome viruses try to close or obscure the windows so that the immune system can’t peek inside and spot the infection. So the T cells won’t be alerted to the virus, and it can keep replicating and spreading.',
  'mhc1-downreg-intestine': 'Cells have molecules at their surface which are like windows into the cell. These molecules called MHC class I (or HLA class I in humans) allow the immune system to peek inside to make sure that the cell is healthy. If the cell is infected or diseased, immune cells called T cells can spot this and destroy the target cell.\n\nSome viruses try to close or obscure the windows so that the immune system can’t peek inside and spot the infection. So the T cells won’t be alerted to the virus, and it can keep replicating and spreading.',
  'mhc1-downreg': 'Cells have molecules at their surface which are like windows into the cell. These molecules called MHC class I (or HLA class I in humans) allow the immune system to peek inside to make sure that the cell is healthy. If the cell is infected or diseased, immune cells called T cells can spot this and destroy the target cell.\n\nSome viruses try to close or obscure the windows so that the immune system can’t peek inside and spot the infection. So the T cells won’t be alerted to the virus, and it can keep replicating and spreading.',
  'immune-nkcell': 'Natural Killer (NK) cells are part of the immune system’s fast, "first response" team. They patrol for cells that look unhealthy, such as infected cells, and directly destroy them.',
  'immune-tcell-lung': 'Cells have molecules at their surface which are like windows into the cell. These molecules called MHC class I (or HLA class I in humans) allow the immune system to peek inside to make sure that the cell is healthy. If the cell is infected or diseased, immune cells called T cells can spot this and destroy the target cell before more virus can be produced.',
  'immune-tcell-liver': 'Cells have molecules at their surface which are like windows into the cell. These molecules called MHC class I (or HLA class I in humans) allow the immune system to peek inside to make sure that the cell is healthy. If the cell is infected or diseased, immune cells called T cells can spot this and destroy the target cell before more virus can be produced.',
  'immune-tcell-intestine': 'Cells have molecules at their surface which are like windows into the cell. These molecules called MHC class I (or HLA class I in humans) allow the immune system to peek inside to make sure that the cell is healthy. If the cell is infected or diseased, immune cells called T cells can spot this and destroy the target cell before more virus can be produced.',
  'immune-antibody-lung': 'Antibodies are Y-shaped proteins made by B cells that latch onto a virus and either block it from entering cells or flag it for destruction. Once your body has made antibodies against a virus, they can keep protecting you for years.',
  'immune-antibody-liver': 'Antibodies are Y-shaped proteins made by B cells that latch onto a virus and either block it from entering cells or flag it for destruction. Once your body has made antibodies against a virus, they can keep protecting you for years.',
  'immune-antibody-intestine': 'Antibodies are Y-shaped proteins made by B cells that latch onto a virus and either block it from entering cells or flag it for destruction. Once your body has made antibodies against a virus, they can keep protecting you for years.',
  'immune-cytokine-blue': 'Cytokines are the messenger molecules of the immune system. These chemical alarm signals are released by cells to warn their neighbours and call in immune reinforcements.',
  'immune-cytokine-orange': 'Cytokines are the messenger molecules of the immune system. These chemical alarm signals are released by cells to warn their neighbours and call in immune reinforcements.',
  'immune-cytokine-red': 'Cytokines are the messenger molecules of the immune system. These chemical alarm signals are released by cells to warn their neighbours and call in immune reinforcements.',
  'immune-sensing': 'Viruses carry DNA or RNA which is an instruction manual for how to make more virus copies. Cells have built-in sensors that detect the genetic material sitting somewhere it shouldn’t be. This is a strong sign of infection and could even tip-off the cell to an otherwise-hidden latent virus. These sensors will trigger an alarm response and alert the immune system.',
  'immune-antiviral': 'Antiviral drugs work by interfering with a specific step a virus needs to copy itself. For example, the drugs can block a protein that the virus uses to duplicate its own DNA or RNA (a virus instruction manual). This slows the infection down without killing the body’s own cells.',
  'vaccine-mrna': 'mRNA vaccines give your cells a temporary set of instructions to make one harmless piece of a virus. The cells present this to your immune system, which trains it to recognise real virus proteins if you’re ever infected.',
  'vaccine-protein': 'Protein-based vaccines inject one harmless piece of a virus’s own protein directly, training the immune system to recognise that protein. It’s a technique used for decades, including in the original hepatitis B and whooping cough vaccines.',
  'lung-tropism': '"Tropism" describes which cells or tissues a virus can infect. This depends on the surface proteins of the virus (a molecular "key") binding to receptor proteins on the body’s cell ("lock"). Different cells and organs have different receptor proteins, so a virus can only infect where its key fits in that cell’s lock.',
  'liver-tropism': '"Tropism" describes which cells or tissues a virus can infect. This depends on the surface proteins of the virus (a molecular "key") binding to receptor proteins on the body’s cell ("lock"). Different cells and organs have different receptor proteins, so a virus can only infect where its key fits in that cell’s lock.',
  'intestine-tropism': '"Tropism" describes which cells or tissues a virus can infect. This depends on the surface proteins of the virus (a molecular "key") binding to receptor proteins on the body’s cell ("lock"). Different cells and organs have different receptor proteins, so a virus can only infect where its key fits in that cell’s lock.',
  'antigenic-drift': 'Antigenic drift is the gradual build-up of small changes (mutations) in a virus’s surface proteins over time. These mutations change the 3D shape of the surface proteins just enough so that antibodies won’t recognise the virus anymore. Influenza virus makes these kinds of mutations especially fast, which is why past influenza virus infections or vaccinations don’t fully protect against this year’s strain.',
};

function openCardInfo(card, tissue) {
  const imgEl = document.getElementById('card-info-image');
  const art = getCardArtPath(card);
  imgEl.className = 'card-info-image';
  imgEl.innerHTML = '';
  if (art) {
    imgEl.style.backgroundImage = `url('${art}')`;
  } else {
    imgEl.style.backgroundImage = 'none';
    imgEl.classList.add('card-face-placeholder');
    imgEl.innerHTML = `<div class="card-face-icon">${card.icon}</div><div class="card-face-name">${card.name}</div>`;
  }

  document.getElementById('card-info-title').textContent = card.name;
  document.getElementById('card-info-game-text').textContent = card.tooltip || card.desc || '';
  document.getElementById('card-info-bio-text').textContent =
    CARD_BIOLOGY_TEXT[card.id] || 'No biology note for this one yet.';
  document.getElementById('card-info-overlay').classList.add('open');
}

function closeCardInfo() {
  document.getElementById('card-info-overlay').classList.remove('open');
}

// ── Entry point: called directly from "Begin Infiltration →" — no
//    separate loadout/handoff screen in between. ──
function startMission() {
  let payload;
  try { payload = JSON.parse(localStorage.getItem('iq_stealth_loadout')); } catch (e) { payload = null; }
  if (!payload) return;

  // Tells the hub a mission has actually begun, distinct from just opening
  // Stealth from the game grid (that's already counted separately, as a
  // pageview, the moment the hub's iframe loads — see trackPlay(),
  // index.html). Only meaningful when embedded in the hub; a standalone
  // load (window.self === window.top) has no parent to tell.
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_mission_started' }, '*');
  }

  document.getElementById('select-screen').style.display = 'none';
  document.getElementById('game-screen').classList.add('visible');
  document.body.classList.add('in-game');

  activeGame = new StealthGame(payload);
  narratedPhaseRef = null;
  document.getElementById('narration-feed').innerHTML = '';
  activeGame.start();
  renderGame();
}

// ── Main render loop — always renders straight onto the game board, never
//    behind a popup. Autonomous phases (virus growth, immune response,
//    mutation) narrate their events into the mission log on the left, one
//    line at a time, then auto-advance — see runAutoPhase() below. ──
function renderGame() {
  if (!activeGame) return;
  const g = activeGame;
  renderPhaseTracker();
  renderVirusTraits();
  renderVirusInfoPanel();

  // Keyed by turn+phase (not the phase-data object itself, which can be
  // null on a no-mutation turn) — computed here, before renderBoards()
  // below, so a fresh immune_response phase can prime its board-reveal
  // mask (see primeBoardRevealMask()) BEFORE the first paint. Priming
  // has to happen ahead of that first renderBoards() call, or the whole
  // turn's board changes would already show fully resolved on screen
  // instead of staying hidden until each card's own narration step
  // reveals them (see revealBoardCells(), runAutoPhase()).
  const phaseKey = `${g.turn}-${g.phase}`;
  const isNewPhaseInstance = narratedPhaseRef !== phaseKey;
  if (g.phase === 'immune_response' && isNewPhaseInstance) {
    primeBoardRevealMask(g);
  } else if (g.phase === 'virus_growth' && isNewPhaseInstance) {
    primeVirusGrowthRevealMask(g);
  } else if (g.phase !== 'immune_response' && g.phase !== 'virus_growth') {
    boardRevealMask = {}; // nothing left to hide outside those two phases
  }

  renderBoards();
  renderImmuneBanner();

  // A win/loss can be set the instant virus_growth/immune_response/
  // mutation resolves (see _checkWin()/_checkLoss() in game.js) — before
  // that phase's own narration has played at all. Cutting straight to the
  // end screen at that point would skip the player ever seeing the turn
  // that actually ended the game (e.g. the final spread that reached the
  // bottom row). So: if this phase instance hasn't been narrated yet,
  // let it run normally below regardless of state — runAutoPhase()'s own
  // completion callback calls advance() (a no-op once state isn't
  // 'playing') then renderGame() again, and THAT call is what actually
  // shows the end screen, since isNewPhaseInstance is false by then
  // (narratedPhaseRef already covers this exact turn+phase).
  const narratingFinalPhase = isNewPhaseInstance && ['virus_growth', 'immune_response', 'mutation'].includes(g.phase);
  if ((g.state === 'won' || g.state === 'lost') && !narratingFinalPhase) {
    clearTimeout(autoPhaseTimer);
    renderEndScreen();
    return;
  }
  document.getElementById('end-screen').classList.remove('visible');
  document.getElementById('end-screen').style.paddingTop = '';
  document.getElementById('game-screen').classList.remove('game-over');
  const gameLeftCol = document.querySelector('.game-left-col');
  if (gameLeftCol) gameLeftCol.style.marginTop = '';

  if (['virus_growth', 'immune_response', 'mutation'].includes(g.phase)) {
    // Hand stays visible (just not interactive) even on the autonomous
    // phases — there's no draft offer yet, so the popup stays closed.
    hideDraftPopup();
    renderHand();
    // Start narrating exactly once per phase instance, even across repeat
    // "nothing happened" turns.
    if (isNewPhaseInstance) {
      narratedPhaseRef = phaseKey;
      if (g.phase === 'virus_growth') appendTurnMarker(g.turn);
      runAutoPhase();
    }
  } else if (g.phase === 'play_cards' && g.currentOffer) {
    // Hand stays visible (non-interactive — it's not play time yet) behind
    // the draft popup, instead of disappearing while the offer is up.
    renderHand();
    renderDraft();
  } else {
    hideDraftPopup();
    renderHand();
  }
  // Run after renderHand() above (whichever branch), not before — the hand
  // panel's own height depends on whether play-hint currently has text in
  // it, so measuring earlier would underestimate how much room the board
  // actually needs to leave for it. Also handles alignPhasePanel() (used to
  // run separately, right after renderBoards() above) internally now —
  // see fitGameStage()'s own comment.
  fitGameStage();
  resetTurnReminder();
}

// ── "Your turn" reminder pulse — waits for actual inactivity ───────────
//  The pick/play-cards banners get a static highlight the instant it's
//  the player's turn, but the attention-grabbing pulse only kicks in
//  after 5-10s of them doing nothing — jumping straight to a pulse the
//  moment the turn starts is more distracting than helpful.
let turnReminderTimer = null;
const TURN_REMINDER_MIN_MS = 5000;
const TURN_REMINDER_MAX_MS = 10000;

function resetTurnReminder() {
  clearTimeout(turnReminderTimer);
  document.querySelectorAll('.turn-reminder').forEach(el => el.classList.remove('turn-reminder'));

  const g = activeGame;
  if (!g || g.state !== 'playing') return;
  const picking = g.phase === 'play_cards' && !!g.currentOffer;
  const playing = g.phase === 'play_cards' && !g.currentOffer;
  if (!picking && !playing) return;

  const delay = TURN_REMINDER_MIN_MS + Math.random() * (TURN_REMINDER_MAX_MS - TURN_REMINDER_MIN_MS);
  turnReminderTimer = setTimeout(() => {
    if (picking) {
      document.getElementById('draft-confirm').classList.add('turn-reminder');
    } else {
      document.getElementById('hand-panel').classList.add('turn-reminder');
      document.getElementById('virus-banner-top').classList.add('turn-reminder');
    }
  }, delay);
}

// ── Phase tracker — narrow always-visible list of the 5 turn steps.
//    "Play cards" covers two sub-states (draft offer, then hand) that the
//    engine treats as one 'play_cards' phase — split here for clarity. ──
const PHASE_STEPS = [
  { phase: 'virus_growth', icon: '🦠', label: 'Virus Spread' },
  { phase: 'immune_response', icon: '🛡️', label: 'Immune Response' },
  { phase: 'mutation', icon: '🧬', label: 'Mutation' },
  { phase: 'pick_cards', icon: '👉', label: 'Pick Cards' },
  { phase: 'play_cards', icon: '▶', label: 'Play Cards' },
];

function renderPhaseTracker() {
  const g = activeGame;
  const col = document.getElementById('phase-col');
  if (!col) return;
  const current = g.phase === 'play_cards'
    ? (g.currentOffer ? 'pick_cards' : 'play_cards')
    : g.phase;

  col.innerHTML = PHASE_STEPS.map(s => {
    // Pick Cards is the one phase with a dismissible popup — clicking its
    // step while it's current reopens it if the player closed it.
    const reopen = s.phase === 'pick_cards' && current === 'pick_cards';
    return `
    <div class="phase-step${s.phase === current ? ' current' : ''}${reopen ? ' reopenable' : ''}" data-phase="${s.phase}"${reopen ? ' onclick="showDraftPopup()"' : ''}>
      <span class="phase-step-icon">${s.icon}</span>${s.label}
    </div>
  `;
  }).join('');
}

// Aligns the phase panel's top edge to the board's actual top cell row,
// measured live rather than approximated with a fixed CSS formula — the
// organ art/title above the grid doesn't scale in exact lockstep with it.
// Only ever called from fitGameStage(), always at #game-stage's natural
// (transform:none) size — see that function's own comment for why that
// matters: a diff measured here is applied directly as a local marginTop,
// which is only valid pre-transform.
function alignPhasePanel() {
  const panel = document.getElementById('phase-panel');
  const cell = document.querySelector('.tissue-cell');
  if (!panel || !cell) return;
  panel.style.marginTop = '0px';
  const diff = cell.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  panel.style.marginTop = Math.max(0, diff) + 'px';
}

// Keeps the Immune System / Active Cards / Cards In Hand banners exactly
// as wide as the board itself (and therefore as each other too).
// .tissue-board deliberately no longer stretches to fill its grid column
// (so the 3 boards sit close together instead of spread across the whole
// row — see its own flex-basis comment), which left these banners' old
// width:100% stretching across a grid column that's now wider than the
// board actually renders. Measured live (like alignPhasePanel above)
// rather than hand-derived from the boards' own fixed flex-basis, so this
// keeps working automatically if that number, the gap, or the board count
// ever changes. Deliberately NOT #boards-wrap's own rect — as a CSS grid
// item it stretches to fill its whole grid cell by default
// (justify-self:stretch) and only centers the (narrower) boards inside
// that via justify-content, so its own bounding box is the same too-wide
// span the boards themselves no longer fill. Measuring the actual boards'
// span (first board's left to last board's right) gets the real width;
// margin:0 auto on the banners centers them the same way within that same
// grid cell, landing them exactly over the boards. Same natural-size-only
// caveat as alignPhasePanel above — only ever called from fitGameStage().
function alignBannerWidths() {
  const boards = document.querySelectorAll('.tissue-board');
  const immuneBanner = document.getElementById('immune-banner');
  const virusBanner = document.getElementById('virus-banner-top');
  const handPanel = document.getElementById('hand-panel');
  const gameLeftCol = document.querySelector('.game-left-col');
  if (!boards.length || !immuneBanner || !virusBanner || !handPanel || !gameLeftCol) return;
  // Reset before measuring — same "start from the unconstrained state"
  // pattern as fitGameStage()'s own transform reset — so a stale cap from
  // a previous (possibly differently-sized) pass never influences this one.
  gameLeftCol.style.maxWidth = '';
  const first = boards[0].getBoundingClientRect();
  const last = boards[boards.length - 1].getBoundingClientRect();
  const width = last.right - first.left;
  if (!width) return;
  immuneBanner.style.width = width + 'px';
  virusBanner.style.width = width + 'px';
  handPanel.style.width = width + 'px';

  // .game-left-col{flex:1} grows to fill the row (needed so its CSS grid's
  // "auto" board column sizes correctly — see its own CSS comment) which
  // leaves genuine dead space to the right of the board whenever the row
  // has more width available than the board formula actually wants. That
  // read as narration-col (positioned right after this column) sticking to
  // the screen edge instead of the board. Clamping this column's own
  // rendered width down to exactly what its content needs — side-col plus
  // the grid's column-gap plus the board span just measured — collapses
  // that dead space, landing narration-col snug against the board with a
  // fixed gap instead.
  const sideCol = document.querySelector('.side-col');
  if (sideCol) {
    const sideColWidth = sideCol.getBoundingClientRect().width;
    const columnGap = parseFloat(getComputedStyle(gameLeftCol).columnGap) || 0;
    gameLeftCol.style.maxWidth = (sideColWidth + columnGap + width) + 'px';
  }
}

// Caps the mission log to the board column's own rendered height (itself
// dynamic — the board scales with the viewport), so a long narration
// history scrolls INSIDE the log (.narration-feed's own overflow-y) once
// it outgrows the available space, instead of growing the whole page past
// the Cards In Hand banner below it.
function alignNarrationHeight() {
  const leftCol = document.querySelector('.game-left-col');
  const narrationCol = document.getElementById('narration-col');
  if (!leftCol || !narrationCol) return;
  narrationCol.style.maxHeight = leftCol.getBoundingClientRect().height + 'px';
}

// Current #game-stage transform:scale() factor — the single source of
// truth for converting a visual (getBoundingClientRect) measurement back
// into the local px units anything INSIDE the stage needs to write its own
// CSS in (position:absolute top/left, margin-top, etc). Anything outside
// the stage (the end-screen panel, draft/trade popups — see the HTML
// comment where #game-stage closes) never needs this; getBoundingClientRect
// there already IS real viewport pixels.
let gameStageScale = 1;

// Modest cap on how far #game-stage is allowed to grow on a huge monitor —
// mirrors the old vh/vw formula's own (much higher) cap, just centralised
// here instead of duplicated per element now that there's only one scale
// value for the whole stage.
const GAME_STAGE_MAX_SCALE = 1.25;

// Replaces the old fitBoardToViewport()'s iterative --board-max-h shrink
// hack, which only ever shrank the BOARD — every banner then had to
// separately re-measure and chase whatever size that left it at
// (alignBannerWidths()), and any drift between those two independent
// passes (a stale measurement, a render that skipped one of them, a mid-
// resize race) is exactly what showed up as overlapping banners/boards.
// There is nothing left to chase: the board, every banner, the phase panel
// and the mission log are now all descendants of one fixed-size #game-stage
// box (see its own CSS, near .game-main-row) — alignPhasePanel()/
// alignBannerWidths()/alignNarrationHeight() below just fine-tune THAT
// box's internal layout once, at its one true natural (unscaled) size, and
// then a single transform:scale() shrinks or grows the whole assembled
// result together to fit whatever viewport it's actually shown on. Boards
// and banners physically cannot end up different sizes from each other —
// they're the same scaled unit.
function fitGameStage() {
  const viewport = document.getElementById('game-stage-viewport');
  const stage = document.getElementById('game-stage');
  if (!viewport || !stage || !document.querySelector('.tissue-grid')) return;

  // Always start from the unconstrained, unscaled state before measuring —
  // same "start from the unconstrained state" pattern used throughout this
  // file (alignBannerWidths()'s own gameLeftCol.maxWidth reset below is
  // the same idea) — so a stale scale/height from a previous (possibly
  // differently-sized) pass never influences this one.
  stage.style.transform = '';
  viewport.style.height = '';

  // These three run against the stage's true natural size (transform is
  // 'none' right now) — see each function's own comment for why that's a
  // hard requirement, not just a convenience.
  alignPhasePanel();
  alignBannerWidths();
  alignNarrationHeight();

  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const availW = viewport.clientWidth || rect.width;
  // Available height: from the stage's current top (already below the
  // header/select-screen padding) down to the bottom of the window, minus
  // a little breathing room.
  const availH = Math.max(120, window.innerHeight - rect.top - 8);

  gameStageScale = Math.min(availW / rect.width, availH / rect.height, GAME_STAGE_MAX_SCALE);
  if (!isFinite(gameStageScale) || gameStageScale <= 0) gameStageScale = 1;

  stage.style.transform = `scale(${gameStageScale})`;
  viewport.style.height = (rect.height * gameStageScale) + 'px';

  // The mutation toast is position:absolute INSIDE the stage and was
  // measuring/positioning itself against the scale this just changed —
  // redo it now, but only if it's actually showing (repositioning a
  // hidden element is harmless but pointless work every single resize).
  const toast = document.getElementById('mutation-toast');
  if (toast && toast.classList.contains('open')) alignMutationToast();
}

// Minimum viewport size the board+banner layout can legibly fit into —
// below either threshold (or in portrait) checkViewportGate() below shows
// the "please rotate / make your window bigger" message instead of the
// game, rather than letting fitGameStage() scale it down into something
// too small to actually read or tap. Deliberately generous over the
// stage's own natural size (see .tissue-board etc.) — this isn't "the
// smallest scale that technically fits", it's "the smallest scale that's
// still comfortably playable".
const MIN_GAME_WIDTH = 820;
const MIN_GAME_HEIGHT = 480;

// Drives .orientation-lock (see its own CSS) — checked on load and on
// every resize/orientation change, for BOTH the select screen and the
// in-game one (.header-outer/.wrap are hidden together, same as before).
// Deliberately JS-driven rather than a pure `@media(orientation:portrait)`
// query: that only ever catches aspect ratio, not an absolute-size problem
// like a small-but-landscape desktop window — the game needs to catch both,
// and needs different copy for each ("rotate your device" doesn't make
// sense for a resizable browser window).
function checkViewportGate() {
  const w = window.innerWidth, h = window.innerHeight;
  const portrait = h > w;
  const tooSmall = w < MIN_GAME_WIDTH || h < MIN_GAME_HEIGHT;
  const blocked = portrait || tooSmall;
  document.documentElement.classList.toggle('viewport-blocked', blocked);

  const textEl = document.querySelector('.orientation-lock-text');
  if (textEl) {
    textEl.innerHTML = portrait
      ? 'Rotate your device to landscape<br>to play Stealth Mission.'
      : 'Please make your browser window larger<br>to play Stealth Mission.';
  }

  if (!blocked && activeGame) {
    fitGameStage();
    // fitGameStage() just computed a fresh gameStageScale for the new
    // window size — if the win/lose panel is up, re-sync its scale and
    // the board's push-down margin to match (see alignEndScreenBoard()),
    // same reasoning as renderEndScreen()'s own call order. Not folded
    // into fitGameStage() itself: alignEndScreenBoard() setting the
    // margin changes #game-stage's own natural height, so it has to run
    // AFTER fitGameStage() has already locked in this pass's scale, not
    // before or during.
    if (document.getElementById('end-screen').classList.contains('visible')) alignEndScreenBoard();
  }
}
window.addEventListener('resize', checkViewportGate);
window.addEventListener('orientationchange', checkViewportGate);
// Safety net for the "resizes itself a moment after starting" glitch —
// fitGameStage() (called from checkViewportGate() above) measures
// #game-stage's actual rendered size, but that size isn't final the
// instant startMission() first renders: the Google Fonts stylesheet
// (index.html <head>) loads with display:swap, so labels/titles briefly
// render in a fallback font with different metrics until the real one
// swaps in, and organ/card art images report their real intrinsic size
// only once each has actually finished loading — either can quietly
// change the stage's natural size AFTER the first fit already locked in a
// transform based on the earlier (temporary) one. Re-fitting once each of
// these actually settles catches both without needing to guess a delay.
document.fonts.ready.then(checkViewportGate);
window.addEventListener('load', checkViewportGate);

// ── Virus top banner — identity/speed (the build from the start) plus
//    whatever's currently active, kept live since replication/mutation can
//    change mid-game (mutations, Protein Vaccine). ──
function renderVirusTraits() {
  const g = activeGame;
  const wrap = document.getElementById('virus-banner-top');
  if (!wrap) return;
  // Only pulse once cards are actually being played, not during pick_cards
  // (draft) — there only the Select button should glow, see renderDraft().
  wrap.classList.toggle('turn-active', g.phase === 'play_cards' && !g.currentOffer);

  wrap.innerHTML = '';

  // Label sits beside the cards, not on its own header row above them —
  // that way the cards get the banner's full height instead of sharing it
  // with a text row. Virus identity/speed/mutation live in virus-info-panel
  // now, so they don't need repeating here too.
  const label = document.createElement('span');
  label.className = 'banner-label banner-label-side';
  label.innerHTML = 'Active<br>Cards';
  wrap.appendChild(label);

  // Played/active cards — tropism (always active from turn 1) plus
  // whatever's currently in effect, checked against live state every
  // render (same pattern as the immune banner's power-ups).
  const cardsRow = document.createElement('div');
  cardsRow.className = 'virus-banner-cards';
  cardsRow.id = 'virus-banner-cards';

  const addCard = (id, powerUp, badge) => {
    const def = STEALTH_CARD_DEFS[id] || VIRUS_CARDS[id] && { id, name: VIRUS_CARDS[id].name, icon: VIRUS_CARDS[id].icon, tooltip: VIRUS_CARDS[id].desc };
    if (!def) return;
    const face = renderCardFace(def, { badge });
    if (powerUp) face.classList.add('power-up');
    cardsRow.appendChild(face);
  };

  g.activeTissues.forEach(t => addCard(`${t}-tropism`, false));
  // Both temporary now (balance pass — see replicationBoostTurns/
  // immuneCardCapTurns, game.js), so both get a real turns-remaining
  // badge, same treatment as Latency/T-Cell Evasion below.
  if (g.replicationBoostTurns > 0) addCard('spread-speed-plus', true, g.replicationBoostTurns);
  // Global (not per-tissue) — shown once, not inside the tissue loop below.
  if (g.immuneCardCapTurns > 0) addCard('activate-tregs', true, g.immuneCardCapTurns);
  g.activeTissues.forEach(t => {
    const board = g.boards[t];
    // No countdown badge — ESCAPE_IMMUNITY_TURNS is just 1 turn, so in
    // practice this reads as an instant effect that's gone by the next
    // render rather than something worth a "turns left" number.
    const escaped = board.cells.some(row => row.some(c => c.escapeImmune > 0));
    if (escaped) addCard(`antibody-escape-${t}`, true);
    if (board.hasDormant()) {
      // Soonest-to-wake cell, not the furthest — that's the one about to
      // actually matter.
      const wakeTurns = board.cells.reduce((min, row) =>
        row.reduce((m, c) => (c.state === 'dormant' && c.dormantTurns > 0) ? Math.min(m, c.dormantTurns) : m, min), Infinity);
      addCard('latency', true, Number.isFinite(wakeTurns) ? wakeTurns : undefined);
    }
    if (g.mhcActive && g.mhcActive[t]) {
      const n = g.mhcActive[t];
      addCard(`mhc1-downreg-${t}`, true, n);
    }
  });
  if (!cardsRow.children.length) cardsRow.innerHTML = '<span class="banner-empty">— none —</span>';

  appendScrollArrowPair(wrap, cardsRow);
}

// ── Virus identity panel — right of Cards In Hand, same row: name,
//    replication speed and mutation rate as plain muted text (not cards,
//    they're traits), with the preset's real art when it has one instead
//    of just the emoji icon. ──
function renderVirusInfoPanel() {
  const g = activeGame;
  const l = g.loadout;
  const wrap = document.getElementById('virus-info-panel');
  if (!wrap) return;
  wrap.style.setProperty('--virus-color', l.color || 'var(--stealth)');

  const iconEl = document.getElementById('virus-info-panel-icon');
  iconEl.innerHTML = l.iconImg ? `<img src="${l.iconImg}" alt="">` : (l.icon || '🦠');
  document.getElementById('virus-info-panel-name').textContent = l.name;
  document.getElementById('virus-info-panel-mutation').innerHTML =
    `<span class="virus-info-panel-label">Mutation Rate</span> <span class="virus-info-panel-accent">${_cap(l.mutation)}</span>`;

  // Its own emphasised badge, not plain text — replication speed can
  // change mid-game (mutations, Replication Boost, Antiviral/Protein
  // Vaccine), unlike mutation rate. Shows the EFFECTIVE speed (matching
  // game.js _runVirusGrowth()'s own calc exactly). Replication Boost is
  // temporary (see replicationBoostTurns, game.js) and gets its own
  // "currently boosted" colour below, same treatment as Antiviral/Protein
  // Vaccine's temporary penalty already gets.
  const speedEl = document.getElementById('virus-info-panel-speed');
  // Built once, then only the number itself is touched on later renders —
  // flashSpeedDelta() appends its floating +1/-1 stream as children of
  // .virus-info-panel-speed-value, and those floaters run for up to 6s
  // (see SPEED_STREAM_SPAWN_WINDOW_MS/DURATION_MS below); rebuilding this
  // whole subtree via innerHTML on every render (which happens well within
  // that window — e.g. the very next phase, ~1s after End Turn) was
  // destroying the floaters mid-flight, cutting the animation off.
  let valueEl = speedEl.querySelector('.virus-info-panel-speed-value');
  if (!valueEl) {
    speedEl.innerHTML = `<span class="virus-info-panel-label">Replication Speed</span> <span class="virus-info-panel-speed-value"><span class="speed-num"></span></span>`;
    valueEl = speedEl.querySelector('.virus-info-panel-speed-value');
  }
  valueEl.querySelector('.speed-num').textContent = g.effectiveReplicationSpeed();
  valueEl.classList.toggle('speed-penalized', g.antiviralPenalty > 0 || g.proteinVaccineTurns > 0);
  valueEl.classList.toggle('speed-boosted', g.replicationBoostTurns > 0);
}

// A short staggered STREAM of floating "+1"/"-1" (was a single one-shot
// pop) rising off the speed badge, called right when something actually
// changes it (Replication Boost, a speed_gain/speed_loss mutation,
// Antiviral, Protein Vaccine) — the persistent green/pink badge colour
// (see renderVirusInfoPanel above) shows the ongoing state, this calls out
// the moment it changed, roughly in line with the number itself rather
// than scattered across the board.
// Spawns one every STAGGER ms for a full SPAWN_WINDOW_MS — a continuous
// stream for that whole window, not a quick burst — see flashSpeedDelta().
// DURATION_MS is each individual floater's own travel time (also drives
// .speed-delta-flash's animation-duration, index.html — keep in sync).
// Because each floater takes DURATION_MS to finish on its own, the very
// last one (spawned at SPAWN_WINDOW_MS) doesn't actually disappear until
// SPAWN_WINDOW_MS + DURATION_MS after the stream starts — later than the
// nominal "3 second" stream, which is fine, expected, not a bug.
const SPEED_STREAM_SPAWN_WINDOW_MS = 3000;
const SPEED_STREAM_STAGGER_MS = 250;
const SPEED_STREAM_COUNT = Math.floor(SPEED_STREAM_SPAWN_WINDOW_MS / SPEED_STREAM_STAGGER_MS) + 1;
const SPEED_STREAM_DURATION_MS = 3000;

function flashSpeedDelta(delta) {
  // Scoped to #virus-info-panel-speed specifically, not just the bare
  // class — the select screen's own virus preview (#virus-detail-traits)
  // reuses this exact same class for its own (hidden, once in-game) speed
  // badge, and being earlier in the DOM it's what a bare
  // '.virus-info-panel-speed-value' query matches — every pulse/floater
  // was landing on that invisible element instead of the real one.
  const badge = document.querySelector('#virus-info-panel-speed .virus-info-panel-speed-value');
  if (!badge) return;
  // The number itself grows then shrinks back — restart the animation
  // even if it's still mid-way through a previous one (two changes in
  // quick succession shouldn't need to wait each other out).
  badge.classList.remove('speed-pulse');
  void badge.offsetWidth; // force reflow so re-adding the class restarts the animation
  badge.classList.add('speed-pulse');
  setTimeout(() => badge.classList.remove('speed-pulse'), 700);

  // How far the stream rises: measured live from the badge up to the
  // phase panel's own bottom edge (the "phases" banner at the top of this
  // same column), not a fixed guess — the real on-screen distance depends
  // on #game-stage's current scale (see fitGameStage()), and both the
  // badge and the phase panel live inside that same scaled subtree. Both
  // rects below are in real/visual (post-transform) pixels, so the gap
  // between them has to be converted back to local (pre-transform) pixels
  // by dividing by gameStageScale before it's usable as a CSS value here —
  // same reasoning as alignMutationToast()'s own conversion above.
  const phasePanel = document.getElementById('phase-panel');
  let riseDistance = 90;
  if (phasePanel) {
    const badgeRect = badge.getBoundingClientRect();
    const phaseRect = phasePanel.getBoundingClientRect();
    riseDistance = Math.max(40, (badgeRect.top - phaseRect.bottom) / gameStageScale);
  }

  const dirCls = delta > 0 ? 'up' : 'down';
  const label = (delta > 0 ? '+' : '') + delta;
  for (let i = 0; i < SPEED_STREAM_COUNT; i++) {
    const el = document.createElement('span');
    el.className = 'speed-delta-flash ' + dirCls;
    el.textContent = label;
    // No starting-position jitter — every floater spawns from the exact
    // same spot (left:50%, the CSS default), hidden behind the
    // replication-speed number itself. --drift-x (applied progressively
    // through the rise, see the keyframe) is what makes each one wander
    // off its own straight line as it climbs, so the stream still reads as
    // a loose column rather than perfectly overlapping copies — just not
    // from the very first frame.
    el.style.setProperty('--rise-distance', riseDistance + 'px');
    el.style.setProperty('--drift-x', (Math.random() * 24 - 12) + 'px');
    el.style.animationDelay = (i * SPEED_STREAM_STAGGER_MS) + 'ms';
    badge.appendChild(el);
    setTimeout(() => el.remove(), i * SPEED_STREAM_STAGGER_MS + SPEED_STREAM_DURATION_MS);
  }
}

// ── Mission log / narrator — the always-visible left-hand banner that
//    replaces the old Continue-gated popup. Each autonomous phase (virus
//    growth, immune response, mutation) reveals its events here one line
//    at a time, paced so the player has time to actually read them, then
//    auto-advances to the next phase — the board itself is never blocked. ──
const NARRATION_STEP_DELAY = 1100;  // ms between narration lines
const NARRATION_IDLE_DELAY = 550;   // ms for a "nothing happened" line
const NARRATION_END_PAUSE  = 1200;  // ms pause after the last line before auto-advancing
// Each card the immune system plays gets extra time on screen — with
// several tissues acting in one turn, the default pace blew past cards
// before the player could actually read what got played. Balance pass:
// bumped further — even one card at a time was going by too fast to
// register which card it was before the board had already moved on.
const NARRATION_IMMUNE_CARD_DELAY = 3200;
// Virus-spread cells reveal one at a time (see the flatCells stagger in
// runAutoPhase()'s next()) rather than every new cell for the turn
// flashing in at once — this is the delay between each one.
const VIRUS_SPREAD_CELL_STAGGER_MS = 450;
// A card's own board reveal (flash + cell state swap) waits this long
// after that same step's other reveals — its mission-log line AND its
// card face appearing in the Immune System banner (see revealImmuneCard,
// below) — instead of firing in the same instant. Both of those render
// synchronously the moment this step runs; the board's own flash is
// bright/immediate too, so with no gap it routinely registered with the
// player before they'd actually seen which card just appeared in the
// banner, reading as "the board updated before the card was played" even
// though all three come from the exact same step.
const BOARD_REVEAL_DELAY_MS = 400;

// Matches .cell-tcell-poof's own CSS animation length exactly (0.9s — see
// cell-crumple-chip/cell-poof-cloud, index.html), used by runAutoPhase()
// to guarantee the poof has fully finished before any later step starts.
const POOF_ANIMATION_MS = 900;

let narratedPhaseRef = null;
let autoPhaseTimer = null;

// Which not-yet-narrated immune_response cells should still display their
// PRE-turn look instead of the live (already-resolved) model — keyed
// "tissue|col|row" -> snapshot { state, cytokineColor, protectedTurns }
// captured before this turn's cards ran (see preTurnBoardState/
// beforeStates in game.js _runImmuneResponse()). Populated all at once by
// primeBoardRevealMask() right as a new immune_response phase starts
// narrating, then drained one played card's cells at a time by
// revealBoardCells() (called from runAutoPhase()'s next()) at the exact
// moment that card's own narration line/highlight fires — otherwise every
// card played this turn would appear to resolve on the board at once,
// the instant the phase starts, regardless of how the narration itself
// is paced (see renderBoards()'s own use of this mask).
let boardRevealMask = {};

// Cells NK Cell/T-Cell/DNA-RNA Sensing cleared this turn — kept lightly
// tinted (see .tissue-cell.cell-recently-cleared, CSS) well past their own
// brief crumple/poof animation, since an emptied cell otherwise looks
// identical to any other healthy cell and the play was easy to miss.
// Replaced wholesale by primeBoardRevealMask() the moment the NEXT
// immune_response phase starts — the same moment the Immune System
// banner's card face for THIS play disappears too. Only actually shown
// during immune_response/mutation, not once it becomes the player's own
// turn (see _applyCellVisual()'s own showRecentlyCleared check) — this set
// itself still holds the full list the whole time regardless, it's purely
// a display gate, not a shorter-lived version of the tracking.
let recentlyClearedCells = new Set();

function primeBoardRevealMask(g) {
  boardRevealMask = {};
  recentlyClearedCells = new Set();
  if (!g.lastImmune) return;
  g.lastImmune.played.forEach(p => {
    (p.beforeStates || []).forEach(b => {
      boardRevealMask[`${b.tissue}|${b.col}|${b.row}`] = b;
    });
    if (_immuneFlashClass(p.id) === 'cell-tcell-poof') {
      p.cells.forEach(c => recentlyClearedCells.add(`${c.tissue}|${c.col}|${c.row}`));
    }
  });
}

// Same "hide until this cell's own reveal moment" masking as
// primeBoardRevealMask() above, but for virus_growth — a newly-spread
// cell's pre-turn state doesn't need a captured snapshot the way an
// immune play's does (arbitrary prior cytokine/antibody state): it's
// always knowable just from which list the cell came from. Normal spread
// and spillover cells were always plain healthy immediately before; a
// woken dormant cell (in `awoken`) was always dormant — it no longer
// force-infects a neighbour on waking (balance pass — see spreadVirus(),
// board.js), so every awoken entry really was dormant, nothing else.
// Primed once when a new virus_growth phase instance starts narrating (see
// renderGame()), same timing as the immune_response version — without
// this, every new cell for the turn would already show live (infected) on
// the very first paint, and the staggered reveal in runAutoPhase()'s
// next() would just be replaying pop animations on cells already visible
// instead of actually revealing them one at a time.
function primeVirusGrowthRevealMask(g) {
  boardRevealMask = {};
  if (!g.lastGrowth) return;
  Object.entries(g.lastGrowth.perTissue).forEach(([t, info]) => {
    const awoken = info.awoken || [];
    info.cells.forEach(c => {
      const wasAwoken = awoken.some(a => a.col === c.col && a.row === c.row);
      boardRevealMask[`${t}|${c.col}|${c.row}`] = { state: wasAwoken ? 'dormant' : 'healthy' };
    });
  });
  (g.lastGrowth.spillovers || []).forEach(s => {
    boardRevealMask[`${s.to}|${s.col}|${s.row}`] = { state: 'healthy' };
  });
}

// Cell chrome (class/title/cytokine badge) shared between renderBoards()'s
// initial paint and revealBoardCells()'s later per-cell update, so a
// card's cells switch from their pre-turn snapshot to their live state
// without a full board rebuild.
function _applyCellVisual(el, cellData, tissue, col, row) {
  // Preserve any transient flash class (e.g. cell-tcell-poof, added by
  // highlightCells() a moment earlier and self-removed after 1s via
  // setTimeout) — runAutoPhase() calls revealBoardCells() (which lands
  // here) immediately after highlightCells() for the same step, so a
  // blanket className overwrite wiped the flash class before its
  // animation ever got to play.
  const preserved = [...el.classList].filter(c =>
    c !== 'tissue-cell' && c !== 'cell-recently-cleared' && !c.startsWith('state-') && !c.startsWith('cytokine-'));
  // Only shown during immune_response/mutation, not once it's the
  // player's own turn (pick_cards/play_cards) — the set itself still
  // tracks which cells qualify the whole time (see recentlyClearedCells'
  // own comment), this just gates whether that's currently visible. The
  // class coming off re-triggers .tissue-cell's own existing background/
  // box-shadow transition (see its base rule, CSS), so it fades out
  // rather than cutting off abruptly.
  const showRecentlyCleared = activeGame && (activeGame.phase === 'immune_response' || activeGame.phase === 'mutation');
  const recentlyCleared = showRecentlyCleared && cellData.state === 'healthy' && recentlyClearedCells.has(`${tissue}|${col}|${row}`);
  el.className = ['tissue-cell', 'state-' + cellData.state, cellData.cytokineColor ? 'cytokine-' + cellData.cytokineColor : null,
    recentlyCleared ? 'cell-recently-cleared' : null, ...preserved]
    .filter(Boolean).join(' ');
  el.title = cellData.cytokineColor
    ? `${_cap(cellData.cytokineColor)} Cytokine shield [${col + 1},${row + 1}]`
    : `${STATE_LABEL[cellData.state]} [${col + 1},${row + 1}]`;
  const oldBadge = el.querySelector('.cytokine-turns-badge');
  if (oldBadge) oldBadge.remove();
  if (cellData.cytokineColor && cellData.protectedTurns > 0) {
    const badge = document.createElement('span');
    badge.className = 'cytokine-turns-badge';
    badge.textContent = cellData.protectedTurns;
    el.appendChild(badge);
  }
}

// Un-hides one played card's cells at the moment its own narration step
// fires — drops them from boardRevealMask and syncs that cell's DOM,
// alongside that same step's highlightCells() flash (see runAutoPhase()).
//
// `afterStates` (when given — only immune_response steps have this, see
// buildImmuneSteps()) is a snapshot of each cell taken RIGHT AFTER this
// specific card's own effect resolved (see game.js _runImmuneResponse()),
// and is what actually gets rendered here in preference to the board's
// current LIVE state. Every card played this turn already resolved
// synchronously before any of it is narrated, so if a LATER card this same
// turn touched one of these same cells again (e.g. NK Cell clears the last
// infected cell in a row, then Antibody protects that now-empty row a few
// cards later), the live cell would already show THAT later result too —
// reading as "the antibody appeared before its own turn" during what's
// supposed to be NK's own reveal. Falls back to the live cell when there's
// no afterStates entry for it (virus_growth/mutation reveals, which have
// no such multi-card-same-cell conflict to guard against).
function revealBoardCells(cells, afterStates) {
  cells.forEach(({ tissue, col, row }) => {
    delete boardRevealMask[`${tissue}|${col}|${row}`];
    const board = activeGame && activeGame.boards[tissue];
    const snapshot = afterStates && afterStates.find(s => s.tissue === tissue && s.col === col && s.row === row);
    const cell = snapshot || (board && board.cells[row] && board.cells[row][col]);
    const el = document.querySelector(`.tissue-cell[data-tissue="${tissue}"][data-col="${col}"][data-row="${row}"]`);
    if (!el || !cell) return;
    _applyCellVisual(el, cell, tissue, col, row);
  });
}
// Set by runAutoPhase() when the mutation phase's own step just opened a
// real mutation toast — holds off the normal NARRATION_END_PAUSE auto-
// advance (which would otherwise show the pick-cards popup right on top of
// a toast the player hasn't finished reading yet — see MUTATION_TOAST_
// DURATION vs. NARRATION_STEP_DELAY, they're not remotely the same length)
// until hideMutationToast() actually runs, whether that's its own timeout
// or the player dismissing it early. null whenever nothing is waiting on it.
let mutationAdvanceCallback = null;

// How many of this immune_response turn's played cards have been narrated
// so far — renderImmuneBanner() only shows that many, so a card appears
// there at the same moment its log line/cell flash do (see
// step.revealImmuneCard, runAutoPhase()) instead of the banner dumping
// every card played this turn all at once while the rest of the turn was
// still trickling in. Keyed by phaseKey so it resets exactly once per
// immune_response instance, however renderImmuneBanner() happens to be
// called relative to runAutoPhase() starting.
let immuneBannerRevealCount = 0;
let immuneBannerRevealPhaseKey = null;

// Newest line goes at the top, so the player never has to scroll down to
// see what just happened — older history scrolls off the bottom instead.
// Tracks the group currently being filled (e.g. "Immune System" + the
// cards played that turn) so they render as one block with a single
// highlight line on the left, instead of each line getting its own.
let activeNarrationGroup = null;
// Every line/group added between one appendTurnMarker() call and the next
// nests inside this wrapper instead of going straight into the feed, so
// "— Turn N —" reads as a header sitting above that turn's whole event
// list instead of getting buried underneath it as later events insert
// above it (newest-first) — see appendTurnMarker below.
let currentTurnGroup = null;

function appendNarrationLine(html, cls = '', opts = {}) {
  const feed = document.getElementById('narration-feed');
  if (!feed) return;
  const line = document.createElement('div');
  line.className = `narration-line ${cls}`.trim();
  line.innerHTML = html;

  if (opts.newTurn) {
    const group = document.createElement('div');
    group.className = 'narration-turn-group';
    group.appendChild(line); // the "— Turn N —" header itself
    feed.insertBefore(group, feed.firstChild);
    feed.scrollTop = 0;
    currentTurnGroup = group;
    activeNarrationGroup = null;
    return line;
  }

  // Everything below nests inside the active turn group (right after its
  // header) rather than at the very top of the feed, once one exists —
  // falls back to the feed itself for any line that somehow arrives before
  // the first turn marker.
  const container = currentTurnGroup || feed;
  const afterEl = currentTurnGroup ? currentTurnGroup.firstChild.nextSibling : container.firstChild;

  if (opts.startGroup) {
    const group = document.createElement('div');
    // The group's own border/background come from opts.groupCls (e.g.
    // "line-immune"), kept separate from the header line's own cls (which
    // may carry extra header-only styling like line-immune-header) so
    // that header-specific styling doesn't leak onto the whole block.
    group.className = `narration-group ${opts.groupCls || cls}`.trim();
    group.appendChild(line);
    container.insertBefore(group, afterEl);
    feed.scrollTop = 0;
    activeNarrationGroup = group;
    return line;
  }
  if (opts.inGroup && activeNarrationGroup) {
    activeNarrationGroup.appendChild(line);
    feed.scrollTop = 0;
    return line;
  }
  // Newest action goes right under the group's header instead of at the
  // bottom, so a turn's card plays read newest-first, same as the feed
  // itself — the header (the group's first child) always stays put.
  if (opts.insertAfterHeader && activeNarrationGroup) {
    activeNarrationGroup.insertBefore(line, activeNarrationGroup.children[1] || null);
    feed.scrollTop = 0;
    return line;
  }
  activeNarrationGroup = null;
  container.insertBefore(line, afterEl);
  feed.scrollTop = 0;
  return line;
}

function appendTurnMarker(turn) {
  appendNarrationLine(`— Turn ${turn} —`, 'turn-marker', { newTurn: true });
}

// Brief flash/pop on cells a narrated card just touched — the cell is
// already in its final state, this just draws the eye to it in sequence,
// synced with its narration line. `flashClass` picks the animation so
// virus growth (green pop) reads differently from immune plays (cyan
// flash) at a glance.
// Every transient per-cell flash class any play can add — see
// _immuneFlashClass() and playSelectedCard()'s own cell-antibody-escape-poof
// call below.
const ALL_CELL_FLASH_CLASSES = [
  'cell-tcell-poof', 'cell-antibody-flash', 'cell-immune-flash', 'cell-antibody-escape-poof',
];

function highlightCells(tissue, cells, flashClass = 'cell-immune-flash') {
  cells.forEach(({ col, row }) => {
    const el = document.querySelector(`.tissue-cell[data-tissue="${tissue}"][data-col="${col}"][data-row="${row}"]`);
    if (!el) return;
    // If an earlier step's flash is still mid-animation on this same cell
    // — two different immune plays landing on it within one turn, e.g. NK
    // Cell clearing it and then Cytokine re-protecting it a moment later —
    // drop that stale class first. Each flash only self-removes on its own
    // 1s timer, and _applyCellVisual()'s preserved-class carry-over would
    // otherwise stack it alongside this step's own flash/state, which
    // visually read as this step's animation glitching into whatever the
    // earlier one was showing (e.g. NK's crumple/poof replaced mid-flight
    // by a cytokine's bell icon).
    ALL_CELL_FLASH_CLASSES.forEach(c => el.classList.remove(c));
    el.classList.add(flashClass);
    setTimeout(() => el.classList.remove(flashClass), 1000);
  });
}

function buildVirusGrowthSteps(g) {
  const organs = [];
  const groups = [];
  const explodeOrgans = [];
  const explodeGroups = [];
  Object.entries(g.lastGrowth.perTissue).forEach(([t, info]) => {
    const awoken = info.awoken || [];
    // Cells the dormant wake-up already infected get their own "exploding"
    // line below — excluded here so a tissue whose only new cell this turn
    // was an explosion doesn't also claim a redundant "Virus spread" line.
    const normalCells = info.cells.filter(cell =>
      !awoken.some(a => a.col === cell.col && a.row === cell.row));
    if (normalCells.length) {
      organs.push(_cap(t));
      groups.push({ tissue: t, cells: normalCells });
    }
    if (awoken.length) {
      explodeOrgans.push(_cap(t));
      explodeGroups.push({ tissue: t, cells: awoken });
    }
  });
  (g.lastGrowth.spillovers || []).forEach(s => {
    if (!organs.includes(_cap(s.to))) organs.push(_cap(s.to));
    groups.push({ tissue: s.to, cells: [{ col: s.col, row: s.row }] });
  });

  // Turn 1 gets its own opening line ahead of whatever this turn's spread
  // narration says, so the mission log always opens with a clear "the
  // mission has begun" beat instead of jumping straight into spread/
  // no-spread reporting.
  const intro = g.turn === 1 ? [{ html: 'Virus infiltration started', cls: 'line-virus', idle: true }] : [];

  if (!organs.length && !explodeOrgans.length) {
    // Turn 1 stands alone as just the intro line — "No spread this turn"
    // right underneath it reads as a non sequitur (of course it hasn't
    // spread yet, it just started).
    if (g.turn === 1) return intro;
    // Note: this can only be shown while the game is still 'playing' — if
    // every infected cell were genuinely boxed in with nowhere left to go,
    // _checkLoss() would already have ended the game before this narration
    // ever renders. So whenever this line appears, room to spread DID
    // exist; the chance rolls (see board.js _rollSpreadTargets) just
    // didn't connect this turn.
    return [...intro, { html: 'No spread this turn', cls: 'line-virus', idle: true }];
  }

  const steps = [...intro];
  // One line covering every organ that got new infected cells this turn
  // (direct growth and spillover alike), not a separate line per organ.
  if (organs.length) {
    steps.push({
      html: `Virus spread in ${organs.join(', ')}`,
      cls: 'line-virus', groups, flashClass: 'cell-infect-pop',
    });
  }
  if (explodeOrgans.length) {
    steps.push({
      html: `Latent cell(s) became active in ${explodeOrgans.join(', ')}`,
      cls: 'line-virus', groups: explodeGroups, flashClass: 'cell-explode-pop',
    });
  }
  return steps;
}

// Each immune card that visibly touches cells gets its own flash so the
// mechanism reads at a glance instead of every play looking the same:
// Antibody pops+glows into place, T-Cell/NK Cells "poof" the virus away
// (same animation — NK is just a smaller, single-cell version of the same
// idea), anything else (Sensing, Cytokines) keeps the generic cyan flash.
// T-Cell/Antibody ids carry their tissue now (immune-tcell-lung, etc. —
// see cards.js _tcellDef/_antibodyDef), hence startsWith rather than an
// exact match.
function _immuneFlashClass(cardId) {
  if (cardId.startsWith('immune-antibody')) return 'cell-antibody-flash';
  if (cardId.startsWith('immune-tcell') || cardId === 'immune-nkcell') return 'cell-tcell-poof';
  return 'cell-immune-flash';
}

function buildImmuneSteps(g) {
  const steps = [];
  // One flat list now instead of nested per-tissue — a played card's own
  // tissue (T-Cell/Antibody always have one; NK Cells/Cytokine/Sensing
  // only if that particular play happened to touch a tissue at all) comes
  // from the card itself if set, else from whichever tissue its cells
  // actually landed on (every played card only ever touches cells within
  // ONE tissue per play, even the cross-tissue ones).
  g.lastImmune.played.forEach(p => {
    const tissue = p.tissue || (p.cells[0] && p.cells[0].tissue);
    // T-Cell/Antibody's own name already bakes in their tissue (e.g.
    // "T-Cell: Lung", used elsewhere when the card shows without an
    // adjacent tissue label of its own — hand, banners) — here the line
    // already leads with its own tissue span, so repeating it in the name
    // too read as "Lung — T-Cell: Lung". Strip just that trailing
    // "colon tissue" suffix.
    const suffix = tissue ? `: ${_cap(tissue)}` : null;
    const name = suffix && p.name.endsWith(suffix) ? p.name.slice(0, -suffix.length) : p.name;
    // Both of the speed-penalty cards get an explicit magnitude in their
    // own narration line (not just the badge flash) so the effect is
    // clearly spelled out, not just implied. Protein Vaccine also states
    // its duration since it wears off; Antiviral doesn't (it's permanent —
    // see ANTIVIRAL_PENALTY_AMOUNT/PROTEIN_SPEED_PENALTY_AMOUNT, config.js
    // — but the tooltip already says so, no need to repeat it here too).
    const label = p.id === 'vaccine-protein'
      ? `${name} — Replication Speed −${STEALTH_CONFIG.VACCINE.PROTEIN_SPEED_PENALTY_AMOUNT} for ${STEALTH_CONFIG.VACCINE.PROTEIN_SPEED_PENALTY_TURNS} turns`
      : p.id === 'immune-antiviral'
      ? `${name} — Replication Speed −${STEALTH_CONFIG.IMMUNE.ANTIVIRAL_PENALTY_AMOUNT}`
      : name;
    const html = tissue ? `<span class="narration-tissue">${_cap(tissue)}</span> — ${label}` : label;
    steps.push({
      html, cls: 'line-immune', tissue, cells: p.cells, afterStates: p.afterStates, flashClass: _immuneFlashClass(p.id), inGroup: true, slow: true,
      // Antiviral and Protein Vaccine both flash the effective-speed badge
      // the same way Replication Boost's own +1 does, just by their own
      // (different) magnitudes — see ANTIVIRAL_PENALTY_AMOUNT/
      // PROTEIN_SPEED_PENALTY_AMOUNT, config.js.
      speedDelta: p.id === 'immune-antiviral' ? -STEALTH_CONFIG.IMMUNE.ANTIVIRAL_PENALTY_AMOUNT
                : p.id === 'vaccine-protein' ? -STEALTH_CONFIG.VACCINE.PROTEIN_SPEED_PENALTY_AMOUNT
                : undefined,
      revealImmuneCard: true,
    });
  });
  // Deliberately no narration step for g.lastImmune.traded — trading is
  // the immune system reshuffling its OWN hand, something the player has
  // no visibility into for their own hand either, so revealing it (even
  // without naming the card received) would leak hidden information. If
  // trading was the only thing that happened this immune turn, the
  // fallback below ("No cards played this turn") is exactly the right
  // cover — nothing observable on the board did happen.
  if (!steps.length) {
    steps.push({
      html: 'No cards played this turn',
      cls: 'line-immune', idle: true, inGroup: true,
    });
  }
  // Header always shows, even on a turn nothing was played, so the phase
  // reads the same way every time — it and every card below it share one
  // highlight line on the left instead of each getting its own.
  steps.unshift({ html: 'Immune System', cls: 'line-immune line-immune-header', groupCls: 'line-immune', idle: true, startGroup: true });
  // Deliberately no narration for a T-Cell Evasion block (see game.js
  // _runImmuneResponse()) — same "don't leak the immune system's hidden
  // hand contents" reasoning as the trade case above: the T-Cell being
  // deflected reveals the immune system was holding one for this tissue,
  // and it stays in their hand afterward (only the priming is consumed),
  // so nothing observable actually changed on the board this turn either.
  return steps;
}

function buildMutationSteps(g) {
  // The popup now shows every turn, even when nothing happened — a turn
  // with no mutation attempt at all (the outer mutation_prob roll, see
  // _runMutationPhase(), game.js) never populated g.lastMutation, so a
  // stand-in "no mutation" object is built here for showMutationToast()
  // to render the same way it renders the table's own 'none' outcome.
  const m = g.lastMutation || { event: 'none', category: null, direction: null, text: 'The virus did not mutate', tissue: null, color: null };
  // mutationData captures this specific mutation object (not just a flag),
  // so the line stays clickable to reopen the details on demand for as
  // long as it sits in the mission log — even after later turns overwrite
  // g.lastMutation with a different event.
  // speedDelta triggers the same floating +1/-1 pulse (flashSpeedDelta(),
  // see runAutoPhase()'s next()) that card-driven speed changes already
  // get — without it, a mutation-driven speed_gain/speed_loss silently
  // updates the badge's number with no visual cue at all, which read as
  // "the mutation didn't actually do anything" even though it did.
  const speedDelta = m.event === 'speed_gain' ? 1 : m.event === 'speed_loss' ? -1 : null;
  return [{
    html: m.text, cls: 'line-mutation',
    mutationPopup: true, mutationData: m,
    speedDelta,
  }];
}

// Maps a mutation event to the in-deck card it visually corresponds to, so
// the toast can show the player the actual card face instead of just text —
// gain and loss share the same card id (e.g. Antibody Escape gained vs lost
// both show that tissue's Antibody Escape card), the toast's own direction
// label/colour is what distinguishes them. Tropism's card (${tissue}-
// tropism) and Replication Speed loss's (replication-loss) are both
// VIRUS_CARDS-only builder markers, not STEALTH_CARD_DEFS entries — see
// showMutationToast()'s own def lookup below, which checks both.
function _mutationCardId(m) {
  switch (m.event) {
    case 'escape_gain':
    case 'escape_loss':
      return m.tissue ? `antibody-escape-${m.tissue}` : null;
    case 'latency_gain':
    case 'latency_loss':
      return 'latency';
    case 'speed_gain':
      return 'spread-speed-plus';
    case 'speed_loss':
      return 'replication-loss';
    case 'tropism_gain':
    case 'tropism_loss':
      return m.tissue ? `${m.tissue}-tropism` : null;
    case 'cytokine_neutralise_gain':
      return m.color ? `cytokine-neutralise-${m.color}` : null;
    default:
      return null;
  }
}

const MUTATION_CATEGORY_ICON = { 'Replication Speed': '⚡', 'Tropism': '🧬' };

let mutationToastTimer = null;
// Was 8000, then 3000 (too snappy, not enough time to read), then 5000 —
// trimmed slightly since 5s ran a bit long. Still easy to bring back on
// demand (click its mission-log line to reopen it, see the
// narration-line-clickable wiring below) and easy to dismiss early (✕, or
// clicking anywhere outside it).
const MUTATION_TOAST_DURATION = 4000;

// .mutation-toast is positioned against .game-left-col (its nearest
// position:relative ancestor), but that box spans both the phase-panel
// column and every row below the boards too — so plain CSS top:50%/left:50%
// centers on the whole left column, not on the cell grid. Measured live
// (same pattern as alignBannerWidths above) against the boards' own span
// rather than #boards-wrap's rect, since #boards-wrap stretches to fill its
// grid cell (justify-self:stretch) and is wider than the boards actually
// render.
function alignMutationToast() {
  const toast = document.getElementById('mutation-toast');
  const boards = document.querySelectorAll('.tissue-board');
  const gameLeftCol = document.querySelector('.game-left-col');
  if (!toast || !boards.length || !gameLeftCol) return;
  const first = boards[0].getBoundingClientRect();
  const last = boards[boards.length - 1].getBoundingClientRect();
  const colRect = gameLeftCol.getBoundingClientRect();
  const centerX = (first.left + last.right) / 2 - colRect.left;
  const centerY = (first.top + first.bottom) / 2 - colRect.top;
  // All four rects above are measured post-transform (getBoundingClientRect
  // always reports real on-screen pixels), but .game-left-col now lives
  // inside #game-stage's own transform:scale() (see fitGameStage()) — a
  // style written directly in those visual pixels would get scaled a
  // SECOND time by that same ancestor transform. Dividing by the stage's
  // current scale converts back to the local (pre-transform) pixels
  // top/left are actually interpreted in.
  toast.style.left = (centerX / gameStageScale) + 'px';
  toast.style.top = (centerY / gameStageScale) + 'px';
}

// Temporary, dismissible notification for a mutation phase's outcome —
// paced to appear alongside that turn's mission-log line (see the
// mutationPopup step flag in runAutoPhase's next()). Auto-expires on its
// own after MUTATION_TOAST_DURATION but the player can also close it early.
function showMutationToast(m) {
  const toast = document.getElementById('mutation-toast');
  const cardSlot = document.getElementById('mutation-toast-card');
  if (!toast || !cardSlot || !m) return;
  alignMutationToast();

  cardSlot.innerHTML = '';
  // Neither 'gain' nor 'loss' — the outer mutation_prob roll missing
  // entirely, or the weighted table itself landing on 'none' (see
  // buildMutationSteps()) — shown as its own neutral state rather than
  // defaulting to (mis)reading as a loss.
  const isNeutral = m.direction !== 'gain' && m.direction !== 'loss';
  const cardId = _mutationCardId(m);
  // Tropism's card only exists in VIRUS_CARDS (a builder-only marker, never
  // a STEALTH_CARD_DEFS/playable-deck entry — see TROPISM_CARD_IDS, cards.js)
  // and doesn't carry its own `id`, unlike STEALTH_CARD_DEFS entries, so
  // renderCardFace()'s art lookup (keyed off card.id) needs it added here.
  const def = cardId && (STEALTH_CARD_DEFS[cardId]
    || (VIRUS_CARDS[cardId] && { id: cardId, ...VIRUS_CARDS[cardId] }));
  if (def) {
    cardSlot.appendChild(renderCardFace(def, { tissue: m.tissue }));
  } else {
    const generic = document.createElement('div');
    generic.className = 'mutation-toast-generic';
    const arrowGlyph = m.direction === 'gain' ? '▲' : m.direction === 'loss' ? '▼' : '–';
    generic.innerHTML = `<div class="mutation-toast-generic-icon">${MUTATION_CATEGORY_ICON[m.category] || '🧬'}</div>
      <div class="mutation-toast-generic-arrow ${isNeutral ? 'neutral' : m.direction}">${arrowGlyph}</div>`;
    cardSlot.appendChild(generic);
  }

  const dirEl = document.getElementById('mutation-toast-direction');
  dirEl.textContent = m.direction === 'gain' ? 'GAINED' : m.direction === 'loss' ? 'LOST' : 'NO CHANGE';
  dirEl.className = 'mutation-toast-direction ' + (isNeutral ? 'neutral' : m.direction);
  // No category line at all when there's nothing to categorise (the
  // no-mutation case, m.category null) — "NO CHANGE" (direction, above)
  // and m.text ("The virus did not mutate", below) already say this;
  // a third line ("No Mutation") just repeated it a third time, and in
  // the brightest colour of the three (var(--text)) at that.
  const categoryEl = document.getElementById('mutation-toast-category');
  categoryEl.textContent = m.category || '';
  categoryEl.style.display = m.category ? '' : 'none';
  document.getElementById('mutation-toast-text').textContent = m.text;

  toast.classList.remove('gain', 'loss', 'neutral', 'open');
  void toast.offsetWidth; // force reflow so the entrance animation replays if a toast is already showing
  toast.classList.add(isNeutral ? 'neutral' : m.direction, 'open');

  clearTimeout(mutationToastTimer);
  mutationToastTimer = setTimeout(hideMutationToast, MUTATION_TOAST_DURATION);
}

function hideMutationToast() {
  clearTimeout(mutationToastTimer);
  const toast = document.getElementById('mutation-toast');
  if (toast) toast.classList.remove('open');

  // If the mutation phase is sitting there waiting on this toast (see
  // runAutoPhase()), closing it — whether that's this function's own
  // timeout firing or the player clicking ✕ early — is what unblocks the
  // advance to pick-cards. A still-brief NARRATION_END_PAUSE afterwards
  // keeps the transition from feeling like a jump-cut, but the player
  // dismissing early no longer has to sit through the rest of
  // MUTATION_TOAST_DURATION first — that's the whole point.
  if (mutationAdvanceCallback) {
    const cb = mutationAdvanceCallback;
    mutationAdvanceCallback = null;
    autoPhaseTimer = setTimeout(cb, NARRATION_END_PAUSE);
  }
}

// Dismiss-on-click-outside — the toast has no backdrop (see its own HTML
// comment: the board/hand stay usable while it's up), so there's no
// backdrop element to hang an onclick off; a single document-level
// listener is the standard way to close a backdrop-less popup on an
// outside click instead. Excludes .narration-line-clickable: that's the
// mission-log line whose own onclick calls showMutationToast() to
// (re)open this same toast — without the exclusion, that click would
// bubble up to this listener right after opening it and immediately
// close it again, since the line itself sits outside #mutation-toast.
document.addEventListener('click', (e) => {
  const toast = document.getElementById('mutation-toast');
  if (!toast || !toast.classList.contains('open')) return;
  if (toast.contains(e.target) || e.target.closest('.narration-line-clickable')) return;
  hideMutationToast();
});

function runAutoPhase() {
  const g = activeGame;
  clearTimeout(autoPhaseTimer);
  const steps = g.phase === 'virus_growth' ? buildVirusGrowthSteps(g)
    : g.phase === 'immune_response' ? buildImmuneSteps(g)
    : buildMutationSteps(g);

  let i = 0;
  let mutationPopupShown = false;
  function next() {
    if (i >= steps.length) {
      const advance = () => { activeGame.advance(); renderGame(); };
      if (mutationPopupShown) {
        // Don't auto-advance on the usual short timer — the mutation toast
        // (still open, MUTATION_TOAST_DURATION >> NARRATION_END_PAUSE) is
        // what the player is actually looking at right now, and advancing
        // straight to the pick-cards popup underneath it read as the two
        // popups colliding. hideMutationToast() calls this once the toast
        // actually closes, whenever that is.
        // The toast can close (auto-expire, or the player dismissing it
        // early via ✕ or clicking outside) BEFORE this point is ever
        // reached — narration steps after the mutation line can still take
        // several more seconds to finish. hideMutationToast() had nothing
        // to call back then (mutationAdvanceCallback wasn't set yet), so
        // without this check the advance would just never happen — stuck
        // waiting on a toast that's already gone. Checking here catches
        // that: if it's already closed, advance right now instead of
        // arming a callback nothing will ever trigger.
        const toastEl = document.getElementById('mutation-toast');
        if (toastEl && !toastEl.classList.contains('open')) {
          autoPhaseTimer = setTimeout(advance, NARRATION_END_PAUSE);
        } else {
          mutationAdvanceCallback = advance;
        }
      } else {
        autoPhaseTimer = setTimeout(advance, NARRATION_END_PAUSE);
      }
      return;
    }
    const step = steps[i];
    const lineEl = appendNarrationLine(step.html, step.cls, { startGroup: step.startGroup, inGroup: step.inGroup, groupCls: step.groupCls });
    if (step.tissue && step.cells && step.cells.length) {
      // See BOARD_REVEAL_DELAY_MS's own comment — gives the line above AND
      // this same step's Immune System banner reveal (further down) a
      // moment to actually register before the board reacts.
      setTimeout(() => {
        highlightCells(step.tissue, step.cells, step.flashClass);
        revealBoardCells(step.cells, step.afterStates);
      }, BOARD_REVEAL_DELAY_MS);
    }
    // A single line can span multiple tissues (e.g. "Virus spread in Lung,
    // Liver") — flattened into one ordered list and revealed one cell at a
    // time (VIRUS_SPREAD_CELL_STAGGER_MS apart) instead of every new cell
    // for the turn flashing in at once, so a multi-cell spread reads as a
    // sequence rather than one indistinct burst.
    let groupStaggerMs = 0;
    if (step.groups) {
      const flatCells = [];
      step.groups.forEach(gr => gr.cells.forEach(c => flatCells.push({ tissue: gr.tissue, ...c })));
      flatCells.forEach((c, idx) => {
        setTimeout(() => {
          // highlightCells() before revealBoardCells() (not the reverse) —
          // same order the immune-response path above uses, and for the
          // same reason: the flash class needs to land on the cell while
          // it's still showing its PRE-reveal look, so _applyCellVisual()
          // (called by revealBoardCells()) has something to preserve the
          // class onto once it swaps the cell over to its live state.
          highlightCells(c.tissue, [c], step.flashClass);
          revealBoardCells([c]);
        }, idx * VIRUS_SPREAD_CELL_STAGGER_MS);
      });
      // -1 cell's worth: the last cell's own stagger delay is when it
      // STARTS revealing, not how long after that its flash needs to
      // finish — highlightCells() already holds the flash for ~1s on its
      // own past that point.
      groupStaggerMs = Math.max(0, flatCells.length - 1) * VIRUS_SPREAD_CELL_STAGGER_MS;
    }
    if (step.speedDelta) flashSpeedDelta(step.speedDelta);
    // Reveals this one card in the Immune System banner at the exact
    // moment its own log line/cell flash appear, instead of the banner
    // dumping every card the immune system played this turn all at once
    // while the log/board effects were still trickling in one by one —
    // see immuneBannerRevealCount, renderImmuneBanner().
    if (step.revealImmuneCard) { immuneBannerRevealCount++; renderImmuneBanner(); }
    if (step.mutationPopup) { showMutationToast(step.mutationData); mutationPopupShown = true; }
    // Stays clickable for as long as the line sits in the mission log
    // (this turn's or any earlier turn's) so the player can bring the
    // toast back after dismissing or letting it auto-expire — bound to
    // this line's own captured mutation snapshot, not live game state, so
    // it still shows the right details even after later mutations happen.
    if (step.mutationPopup && lineEl) {
      lineEl.classList.add('narration-line-clickable');
      lineEl.title = 'Click to view mutation details';
      lineEl.onclick = () => showMutationToast(step.mutationData);
    }
    i++;
    const baseDelay = step.idle ? NARRATION_IDLE_DELAY : step.slow ? NARRATION_IMMUNE_CARD_DELAY : NARRATION_STEP_DELAY;
    // Don't advance to the next step (or the next phase) until the last
    // staggered cell above has actually had its own moment on screen —
    // otherwise a big multi-cell spread would have the narration/phase
    // move on while cells were still trickling in.
    // NK Cell/T-Cell's own crumple-into-cloud "poof" (see .cell-tcell-poof,
    // index.html — a 0.9s CSS animation, plus the BOARD_REVEAL_DELAY_MS it
    // waits before even starting) needs to fully finish playing on its
    // cell before ANY later step starts touching the board — otherwise the
    // next card's own reveal can land on that same cell mid-animation and
    // stomp it, showing that later card's icon instead of letting the poof
    // finish cleanly. NARRATION_IMMUNE_CARD_DELAY already comfortably
    // covers this in practice, but this makes the guarantee explicit and
    // exact rather than incidental, so it holds even if that constant ever
    // changes.
    const minPoofDelay = step.flashClass === 'cell-tcell-poof' && step.cells && step.cells.length
      ? BOARD_REVEAL_DELAY_MS + POOF_ANIMATION_MS + 200 : 0;
    const delay = Math.max(baseDelay, groupStaggerMs + NARRATION_STEP_DELAY, minPoofDelay);
    autoPhaseTimer = setTimeout(next, delay);
  }
  next();
}

// ── Immune status banner (near the top) ────────────────────────────
//  Two kinds of badge:
//   - Power-ups: shown as long as the effect is CURRENTLY ACTIVE (checked
//     against live game state every render), not just the turn it fired.
//   - This turn's plays: whatever each tissue's hand actually played.
function renderImmuneBanner() {
  const g = activeGame;
  const wrap = document.getElementById('immune-banner');
  // Always visible, even before turn 1's first immune response — an empty
  // "— none —" state (below) reads better than the banner disappearing.
  wrap.style.display = 'flex';
  wrap.classList.toggle('turn-active', g.phase === 'immune_response');
  wrap.innerHTML = '';

  // First render of a new immune_response instance starts the reveal back
  // at 0 — see immuneBannerRevealCount's own comment above.
  const phaseKey = `${g.turn}-${g.phase}`;
  if (g.phase === 'immune_response' && phaseKey !== immuneBannerRevealPhaseKey) {
    immuneBannerRevealPhaseKey = phaseKey;
    immuneBannerRevealCount = 0;
  }

  // Label sits beside the cards, not on its own header row above them —
  // same treatment as the virus's Active Cards banner.
  const title = document.createElement('span');
  title.className = 'immune-banner-title banner-label-side';
  title.innerHTML = 'Immune<br>System';
  wrap.appendChild(title);

  // Played/active cards — real card-faces, not icons: whatever's currently
  // boosted (mRNA vaccine) plus whatever was actually played this turn.
  const cardsRow = document.createElement('div');
  cardsRow.className = 'immune-banner-cards';
  cardsRow.id = 'immune-banner-cards';

  if (g.lastImmune) {
    const addCard = (id, tissue, name, powerUp, badge, active) => {
      const def = IMMUNE_CARD_DEFS[id];
      if (!def) return;
      const card = { ...def, name: name || def.name };
      const face = renderCardFace(card, { tissue, badge });
      if (powerUp) face.classList.add('power-up');
      // The one card whose own reveal step is what's CURRENTLY playing out
      // on the board right now (see .immune-banner-card-active, CSS) —
      // every played card this turn stays visible here once revealed, not
      // just the latest one, so on a multi-card turn it's easy to glance
      // at an EARLIER card's still-showing face and read it as "what's
      // happening now" when the board has actually already moved on to a
      // later card. This highlight is the disambiguator.
      if (active) face.classList.add('immune-banner-card-active');
      cardsRow.appendChild(face);
    };

    // One flat list now instead of nested per-tissue/vaccine lists — see
    // buildImmuneSteps() above for the same tissue-derivation logic. While
    // the turn is still actively narrating, only show as many as have been
    // individually revealed so far (see immuneBannerRevealCount) — once the
    // phase has moved on, show the whole list regardless (nothing left to
    // stagger). No dedup here — playing the same card twice in one turn
    // (e.g. 2x NK Cell) gets two separate faces.
    g.lastImmune.played.forEach((p, idx) => {
      if (g.phase === 'immune_response' && idx >= immuneBannerRevealCount) return;
      const tissue = p.tissue || (p.cells[0] && p.cells[0].tissue);
      const active = g.phase === 'immune_response' && idx === immuneBannerRevealCount - 1;
      addCard(p.id, tissue, p.name, false, undefined, active);
    });

    // A fresh play of one of these ids is already shown by the loop above
    // (and its "still active" counter already reflects that same play),
    // so the "still active" entries below skip it rather than showing a
    // second, redundant face for the one play.
    const playedThisTurn = id => g.lastImmune.played.some(p => p.id === id);

    // Still-active boost — badge shows how many turns it has left so the
    // player isn't left guessing when it'll wear off.
    if (g.mrnaBoostTurns > 0 && !playedThisTurn('vaccine-mrna')) {
      addCard('vaccine-mrna', null, null, true, g.mrnaBoostTurns);
    }
    // Protein Vaccine's own temporary speed penalty — same "still active"
    // treatment as mRNA above. Antiviral has no equivalent entry here: its
    // penalty is now PERMANENT (see antiviralPenalty, game.js), same as
    // the virus's own Replication Boost, which likewise only shows in the
    // "just played" loop above for the one turn it's played, not as an
    // ongoing badge afterward.
    if (g.proteinVaccineTurns > 0 && !playedThisTurn('vaccine-protein')) {
      addCard('vaccine-protein', null, null, true, g.proteinVaccineTurns);
    }
    // Cytokine shields — stays shown for as long as ANY cell it protected
    // is still guarded (protectedTurns ticks down per-cell, see board.js
    // tickTimers()), not just the turn it was played; the shield routinely
    // outlasts that single-turn "played" entry above. One card per DISTINCT
    // remaining-turn count among that colour's protected cells, not one
    // card per cell — most of the time every cell shares one timer and
    // collapses to a single card, but a fresh same-colour play landing
    // while an earlier one is still counting down leaves two genuinely
    // different countdowns live at once, and collapsing those into a
    // single "longest" badge would hide that the shorter one is about to
    // expire.
    ['blue', 'orange', 'red'].forEach(color => {
      const id = `immune-cytokine-${color}`;
      if (playedThisTurn(id)) return;
      const turnsSet = new Set();
      g.activeTissues.forEach(t => {
        g.boards[t].cells.forEach(row => row.forEach(c => {
          if (c.cytokineColor === color && c.protectedTurns > 0) turnsSet.add(c.protectedTurns);
        }));
      });
      [...turnsSet].sort((a, b) => b - a).forEach(turns => addCard(id, null, null, true, turns));
    });
    // Antibody shields — permanent (no protectedTurns countdown, unlike
    // Cytokine above), so there's no "turns left" badge to show, but it
    // still needs its own "still active" entry here or (like Antiviral/
    // Replication Boost, which really ARE meant to only flash for the one
    // turn played) it would vanish from the banner the moment the turn it
    // was played on ends, despite the shield itself still visibly guarding
    // cells on the board. !c.cytokineColor excludes cells a Cytokine (not
    // plain Antibody) protected — those already get their own card above.
    g.activeTissues.forEach(t => {
      const id = `immune-antibody-${t}`;
      if (playedThisTurn(id)) return;
      const stillProtected = g.boards[t].cells.some(row => row.some(c => c.state === 'immune' && !c.cytokineColor));
      if (stillProtected) addCard(id, t, null, true, undefined, false);
    });
  }

  if (!cardsRow.children.length) cardsRow.innerHTML = '<span class="banner-empty">— none —</span>';

  appendScrollArrowPair(wrap, cardsRow);
}

// ── Boards — always all 3 tissues; inactive ones render greyed out ──
function renderBoards() {
  const wrap = document.getElementById('boards-wrap');
  wrap.innerHTML = '';

  TISSUE_ORDER.forEach(tissue => {
    const board = activeGame.boards[tissue];
    // Every tissue has a board now, active or not (see the StealthGame
    // constructor) — activeTissues, not board presence, says whether the
    // virus can currently spread here.
    const isActive = activeGame.activeTissues.includes(tissue);
    const boardEl = document.createElement('div');
    boardEl.className = 'tissue-board' + (isActive ? '' : ' inactive');
    boardEl.dataset.tissue = tissue;
    // Large organ art sits in-flow above the title; the colored line around
    // tissue-grid-wrap (see CSS) is what signals active/inactive now, so no
    // "not targeted" text is needed.
    // tissue-board-header (not .tissue-board itself) is the sizing
    // container for the organ/title below — see its CSS comment for why
    // that split matters.
    boardEl.innerHTML = `
      <div class="tissue-board-header">
        <img class="tissue-board-organ" src="assets/organs/${tissue}.png" alt="">
        <div class="tissue-board-title">${tissue}</div>
      </div>
    `;

    const gridWrap = document.createElement('div');
    gridWrap.className = 'tissue-grid-wrap';

    const grid = document.createElement('div');
    grid.className = 'tissue-grid';
    grid.style.gridTemplateColumns = `repeat(${STEALTH_CONFIG.BOARD.COLS}, 1fr)`;

    // Real cell data even while inactive — not a blank placeholder grid —
    // so a tissue the immune system pre-fortified with Antibody/Cytokine
    // before the virus ever arrived actually shows that protection
    // (see .tissue-board.inactive .tissue-cell.state-healthy in the CSS
    // for how a plain healthy cell in an inactive board still reads as
    // muted/"not in play" without hiding real protected cells the same
    // way).
    board.toRenderData().forEach(row => row.forEach(cell => {
      const cellEl = document.createElement('div');
      // Cells this turn's immune plays touched but haven't been narrated
      // yet still show their PRE-turn look (see boardRevealMask above)
      // instead of jumping straight to the live model.
      const masked = boardRevealMask[`${tissue}|${cell.col}|${cell.row}`];
      _applyCellVisual(cellEl, masked || cell, tissue, cell.col, cell.row);
      cellEl.dataset.tissue = tissue;
      cellEl.dataset.col = cell.col;
      cellEl.dataset.row = cell.row;
      // Nothing to target on a tissue the virus can't currently spread in.
      if (isActive) cellEl.onclick = () => onCellClick(tissue, cell.col, cell.row);
      grid.appendChild(cellEl);
    }));

    gridWrap.appendChild(grid);
    boardEl.appendChild(gridWrap);
    wrap.appendChild(boardEl);
  });
}

// ── Draft (offer N, pick M) ─────────────────────────────────────────
// A dismissible popup, not an inline panel — the player can hide it to
// see the full board. Closing it doesn't lose the offer: it minimises
// into the Pick Cards entry in the mission log, which reopens it.
function showDraftPopup() {
  document.getElementById('draft-popup-overlay').classList.add('open');
  updatePickCardsButton(false);
  updatePickCardsEntry(false);
}

function hideDraftPopup() {
  document.getElementById('draft-popup-overlay').classList.remove('open');
  const g = activeGame;
  const stillPending = g && g.phase === 'play_cards' && !!g.currentOffer;
  updatePickCardsButton(stillPending);
  updatePickCardsEntry(stillPending);
}

// Shows/hides the Pick Cards button in the hand panel — appears the
// moment the draft popup is minimised with an offer still pending, and
// disappears again the moment it's reopened or the offer's resolved.
function updatePickCardsButton(show) {
  const btn = document.getElementById('pick-cards-btn');
  if (btn) btn.style.display = show ? '' : 'none';
}

// Shows/hides the Pick Cards reminder in the mission log — a second way
// back into the popup alongside the hand panel's own button, for whenever
// the player's eyes are already on the log rather than the hand. Inserted
// as the CURRENT turn's own topmost line (right after that turn's
// "— Turn N —" header, in currentTurnGroup — see appendNarrationLine/
// appendTurnMarker) rather than as a permanent element sitting above the
// whole log, so it reads as part of that turn instead of floating
// disconnected above turn 1's own header. Removed/recreated from the DOM
// each time rather than just toggling display, so it can't be left behind
// in a now-stale turn's group once a new turn starts.
function updatePickCardsEntry(show) {
  const existing = document.getElementById('narration-pick-entry');
  if (existing) existing.remove();
  if (!show || !currentTurnGroup) return;
  const el = document.createElement('div');
  el.id = 'narration-pick-entry';
  el.className = 'narration-line narration-pick-entry narration-line-clickable line-player';
  el.textContent = '👉 Pick two cards';
  el.onclick = showDraftPopup;
  currentTurnGroup.insertBefore(el, currentTurnGroup.firstChild.nextSibling);
}

function renderDraft() {
  const overlay = document.getElementById('draft-popup-overlay');
  // Auto-opens on a fresh offer — renderDraft() only runs once per offer
  // (renderGame() isn't re-triggered by picking/hiding), so this never
  // fights with the player having manually closed it.
  showDraftPopup();
  // Only the Select button pulses here, not the whole popup — picking
  // isn't the final commit yet (see hand-panel, which highlights in full).
  document.getElementById('draft-confirm').classList.add('turn-active');

  const offer = activeGame.currentOffer;
  const pickCount = Math.min(STEALTH_CONFIG.CARDS.PICK_COUNT, offer.length);
  overlay.dataset.picked = '[]';

  const list = document.getElementById('draft-cards');
  list.innerHTML = '';
  offer.forEach((card, i) => {
    const el = renderCardFace(card, { onClick: () => toggleDraftPick(i, pickCount) });
    el.id = 'draft-card-' + i;
    list.appendChild(el);
  });
  updateScrollArrows(list, document.getElementById('draft-cards-arrow-back'), document.getElementById('draft-cards-arrow'));
}

function toggleDraftPick(i, pickCount) {
  resetTurnReminder();
  const overlay = document.getElementById('draft-popup-overlay');
  let picked = JSON.parse(overlay.dataset.picked);
  const el = document.getElementById('draft-card-' + i);

  if (picked.includes(i)) {
    picked = picked.filter(p => p !== i);
    el.classList.remove('selected');
  } else if (picked.length < pickCount) {
    picked.push(i);
    el.classList.add('selected');
  }
  overlay.dataset.picked = JSON.stringify(picked);

  const confirmBtn = document.getElementById('draft-confirm');
  confirmBtn.disabled = picked.length !== pickCount;
}

function confirmDraft() {
  const overlay = document.getElementById('draft-popup-overlay');
  const picked = JSON.parse(overlay.dataset.picked);
  activeGame.resolveDraft(picked);
  hideDraftPopup();
  // Everything the virus does this turn — drafting, then each card played —
  // groups under one "Virus" header with a single highlight line on the
  // left, same treatment as the "Immune System" block.
  appendNarrationLine('Virus', 'line-player line-player-header', { startGroup: true, groupCls: 'line-player' });
  appendNarrationLine('Drafted cards', 'line-player', { insertAfterHeader: true });
  renderGame();
}

// ── Trade (3 cards of choice for 1 card of choice) ──────────────────
// A free action, doesn't cost the turn — reuses the draft popup's own
// look (see .draft-popup in CSS) as two TABS (give up / receive) instead
// of one long popup, each a wrapping multi-row grid (.trade-cards-grid)
// rather than a single horizontal-scrolling strip — "receive" especially
// can offer a long list of card types at once.
let tradeGiveSelected = [];   // hand indexes chosen to give up
let tradeReceiveSelected = null; // card id chosen to receive
let tradeActiveTab = 'give';  // 'give' | 'receive'

function openTradeModal() {
  if (activeGame.phase !== 'play_cards' || activeGame.currentOffer) return;
  if (activeGame.hand.length < 3) return;
  tradeGiveSelected = [];
  tradeReceiveSelected = null;
  tradeActiveTab = 'give';
  renderTradeModal();
  document.getElementById('trade-popup-overlay').classList.add('open');
}

function hideTradeModal() {
  document.getElementById('trade-popup-overlay').classList.remove('open');
}

function switchTradeTab(tab) {
  tradeActiveTab = tab;
  renderTradeModal();
}

// Every distinct card type that exists anywhere in this virus's own deck
// right now (draw pile, discard pile, or hand) — "any card in the deck,"
// not a random draw, and naturally scoped to cards this loadout actually
// includes without duplicating StealthDeck's own loadout-parsing logic.
// Horizontal/Vertical Spread are deliberately excluded even though they're
// always in the deck (see StealthDeck._buildFromLoadout(), cards.js): the
// whole point of keeping their draft-offer counts "deliberately rare"/
// "extremely rare" (config.js, INFECT_CARDS) is undermined if trading lets
// a player just pick one up on demand — they should only ever come from a
// draft pick landing on one, same as any other rare draw.
const TRADE_EXCLUDED_IDS = ['infect-horizontal', 'infect-vertical'];
function getTradeableCardIds() {
  const ids = new Set();
  [...activeGame.deck.draw, ...activeGame.deck.discard, ...activeGame.hand].forEach(c => {
    if (!TRADE_EXCLUDED_IDS.includes(c.id)) ids.add(c.id);
  });
  return [...ids];
}

// Priority order for the "receive" tab's grid — tissue-paired (Antibody
// Escape next to that same tissue's T-Cell Evasion), liver/lung/intestine,
// then the non-tissue "filler" cards. This is a PRIORITY, not a literal
// layout — arrangeTradeReceiveIds() below does the actual row placement,
// keeping every tissue's own cards grouped and never split across the
// two rows, using filler cards to top up whatever's left of a row. Cards
// not itemised here (shouldn't happen) sort to the end rather than
// disappearing. Horizontal/Vertical Spread are never offered here at all
// — see TRADE_EXCLUDED_IDS above.
const TRADE_RECEIVE_ORDER = [
  'antibody-escape-liver', 'mhc1-downreg-liver',
  'antibody-escape-lung', 'mhc1-downreg-lung',
  'antibody-escape-intestine', 'mhc1-downreg-intestine',
  'spread-speed-plus', 'latency', 'activate-tregs',
  'cytokine-neutralise-red', 'cytokine-neutralise-orange', 'cytokine-neutralise-blue',
];

// Arranges the receive grid so each tissue's own cards always sit next to
// each other and never get split across the two rows (see
// renderTradeModal()'s own gridTemplateColumns, which always makes exactly
// 2 rows) — a fixed order alone can't guarantee that once the actual pool
// size varies per game, since a tissue's pair could land right on a row
// boundary. Non-tissue cards (Replication Boost, Latency, Activate Tregs,
// the 3 Cytokine Neutralisations) have no such pairing to protect, so they
// act as flexible single-slot filler, backfilled onto whichever row still
// has room after every tissue's own cards are placed — e.g. Replication
// Boost sitting at the end of row 1 just to round it out.
function arrangeTradeReceiveIds(ids) {
  const sorted = [...ids].sort((a, b) => TRADE_RECEIVE_ORDER.indexOf(a) - TRADE_RECEIVE_ORDER.indexOf(b));
  const tissueOf = id => (id.match(/-(liver|lung|intestine)$/) || [])[1] || null;

  const byTissue = { liver: [], lung: [], intestine: [] };
  const fillers = [];
  sorted.forEach(id => {
    const t = tissueOf(id);
    if (t) byTissue[t].push(id); else fillers.push(id);
  });
  const tissueClusters = ['liver', 'lung', 'intestine'].map(t => byTissue[t]).filter(c => c.length);

  const cols = Math.max(1, Math.ceil(ids.length / 2));
  const rows = [[], []];
  tissueClusters.forEach(cluster => {
    const row = rows[0].length + cluster.length <= cols ? rows[0] : rows[1];
    row.push(...cluster);
  });
  fillers.forEach(id => {
    const row = rows[0].length < cols ? rows[0] : rows[1];
    row.push(id);
  });
  return [...rows[0], ...rows[1]];
}

function renderTradeModal() {
  const giveWrap = document.getElementById('trade-give-cards');
  giveWrap.innerHTML = '';
  activeGame.hand.forEach((card, i) => {
    const el = renderCardFace(card, { onClick: () => toggleTradeGive(i) });
    el.id = 'trade-give-' + i;
    if (tradeGiveSelected.includes(i)) el.classList.add('selected');
    giveWrap.appendChild(el);
  });
  document.getElementById('trade-give-count').textContent = `(${tradeGiveSelected.length}/3)`;

  const receiveWrap = document.getElementById('trade-receive-cards');
  receiveWrap.innerHTML = '';
  const receiveIds = arrangeTradeReceiveIds(getTradeableCardIds());
  receiveIds.forEach(id => {
    const def = STEALTH_CARD_DEFS[id];
    if (!def) return;
    const el = renderCardFace(def, { onClick: () => toggleTradeReceive(id) });
    el.id = 'trade-receive-' + id;
    if (tradeReceiveSelected === id) el.classList.add('selected');
    receiveWrap.appendChild(el);
  });
  // Always exactly 2 rows, split as evenly as possible, rather than a
  // fixed column count — the tradeable pool size varies per game (which
  // cards this virus's deck/hand/discard actually contain right now, see
  // getTradeableCardIds()), so a fixed grid left ragged/uneven rows
  // whenever the count wasn't a clean multiple of it.
  receiveWrap.style.gridTemplateColumns = `repeat(${Math.max(1, Math.ceil(receiveIds.length / 2))}, 70px)`;

  document.getElementById('trade-tab-give').classList.toggle('active', tradeActiveTab === 'give');
  document.getElementById('trade-tab-give').classList.toggle('complete', tradeGiveSelected.length === 3);
  document.getElementById('trade-tab-receive').classList.toggle('active', tradeActiveTab === 'receive');
  document.getElementById('trade-tab-receive').classList.toggle('complete', !!tradeReceiveSelected);
  document.getElementById('trade-tab-panel-give').classList.toggle('active', tradeActiveTab === 'give');
  document.getElementById('trade-tab-panel-receive').classList.toggle('active', tradeActiveTab === 'receive');

  document.getElementById('trade-confirm').disabled =
    !(tradeGiveSelected.length === 3 && tradeReceiveSelected);
}

function toggleTradeGive(i) {
  const idx = tradeGiveSelected.indexOf(i);
  if (idx !== -1) tradeGiveSelected.splice(idx, 1);
  else if (tradeGiveSelected.length < 3) tradeGiveSelected.push(i);
  // Once the 3rd card's picked, move straight to choosing what to receive
  // instead of leaving the player on a now-done step.
  if (tradeGiveSelected.length === 3) tradeActiveTab = 'receive';
  renderTradeModal();
}

function toggleTradeReceive(id) {
  tradeReceiveSelected = tradeReceiveSelected === id ? null : id;
  renderTradeModal();
}

function confirmTrade() {
  if (tradeGiveSelected.length !== 3 || !tradeReceiveSelected) return;
  const res = activeGame.tradeCards(tradeGiveSelected, tradeReceiveSelected);
  hideTradeModal();
  if (res.ok) {
    appendNarrationLine(res.result.text, 'line-player', { insertAfterHeader: true });
  }
  renderGame();
}

// ── Hand ─────────────────────────────────────────────────────────
// Shown on every phase (not just play_cards) so the banner never
// disappears — only actually interactive once it's really the player's
// turn to act; otherwise cards are unclickable and End Turn is disabled.
function renderHand() {
  const g = activeGame;
  // !endingTurn — once End Turn has fired (button click or the hand
  // auto-emptying), the turn is only PENDING for END_TURN_ANIMATION_BUFFER_MS
  // (see endStealthTurn()) while g.phase briefly still reads 'play_cards' —
  // without this, a card played in that gap would sneak in an extra play
  // the player already committed past.
  const interactive = g.phase === 'play_cards' && !g.currentOffer && !endingTurn;
  const handPanel = document.getElementById('hand-panel');
  handPanel.style.display = 'flex';
  handPanel.classList.toggle('turn-active', interactive);
  const list = document.getElementById('hand-cards');
  list.innerHTML = '';
  selectedHandIndex = null;

  g.hand.forEach((card, i) => {
    const el = renderCardFace(card, interactive ? { onClick: () => selectHandCard(i) } : {});
    el.id = 'hand-card-' + i;
    if (!interactive) el.classList.add('inactive');
    list.appendChild(el);
  });
  updateScrollArrows(list, document.getElementById('hand-cards-arrow-back'), document.getElementById('hand-cards-arrow'));

  const endTurnBtn = document.getElementById('end-turn-btn');
  endTurnBtn.disabled = !interactive;

  const tradeBtn = document.getElementById('trade-btn');
  tradeBtn.disabled = !interactive || g.hand.length < 3;

  // A pending draft offer is the one "not interactive" state that isn't
  // actually idle — the player has something to do, just via the Pick
  // Cards button/popup rather than the hand itself. Left blank here rather
  // than repeating a "pick cards" prompt — #pick-cards-btn (see
  // updatePickCardsButton()) is the actual entry point for that now.
  const picking = g.phase === 'play_cards' && !!g.currentOffer;
  const hintEl = document.getElementById('play-hint');
  if (lastPlayError) {
    hintEl.textContent = lastPlayError;
    hintEl.classList.add('play-hint-error');
    lastPlayError = null;
  } else {
    hintEl.classList.remove('play-hint-error');
    hintEl.textContent = picking
      ? ''
      : !interactive
        ? 'Waiting for your turn…'
        : g.hand.length
          ? 'Select a card to play it.'
          : 'No cards in hand — ending turn…';
  }

  // No cards left to play — end the turn automatically instead of making
  // the player click the button for a hand that has nothing left to do.
  if (interactive && !g.hand.length) endStealthTurn();
}

function selectHandCard(i) {
  resetTurnReminder();
  document.querySelectorAll('#hand-cards .card-face').forEach(el => el.classList.remove('selected'));
  const card = activeGame.hand[i];
  if (selectedHandIndex === i) { selectedHandIndex = null; return; }
  selectedHandIndex = i;
  document.getElementById('hand-card-' + i).classList.add('selected');

  if (card.targetType === 'none') {
    playSelectedCard({});
  } else if (card.targetType === 'tissue') {
    // Horizontal/Vertical Spread — the player picks WHICH tissue, not the
    // exact cell (balance pass: guaranteed player-chosen precision was too
    // strong — see stealthDebugStats(), game.js) — any cell click within
    // that tissue's board works, onCellClick() below only reads the tissue.
    document.getElementById('play-hint').textContent = 'Click anywhere in the tissue you want to target.';
  } else {
    document.getElementById('play-hint').textContent = 'Click a cell on the board to target it.';
  }
}

function onCellClick(tissue, col, row) {
  if (selectedHandIndex === null) return;
  if (!activeGame.boards[tissue]) return; // inactive/greyed-out tissue — not targetable
  const card = activeGame.hand[selectedHandIndex];
  if (card.targetType === 'tissue') {
    playSelectedCard({ tissue });
  } else {
    playSelectedCard({ tissue, col, row });
  }
}

// Short player-facing narration per card, independent of the more
// detailed (coordinate-level) text used internally for activeGame.log.
// Undefined cardIds (e.g. Antigenic Drift, not covered by a short form
// yet) just fall back to that detailed text.
function formatCardPlayText(card, target, result) {
  switch (card.id) {
    case 'infect-horizontal': return 'Played horizontal spread';
    case 'infect-vertical': return 'Played vertical spread';
    case 'spread-speed-plus': return 'Played replication boost';
    case 'latency': return 'Played latency - activates next turn';
    case 'antibody-escape-lung':
    case 'antibody-escape-liver':
    case 'antibody-escape-intestine':
      // These target the tissue baked into the card itself (requiresTissue),
      // not a player-picked target — targetType is 'none' for this card.
      return `Played antibody escape (${card.requiresTissue || target.tissue})`;
    case 'activate-tregs': return 'Played T reg activation - immune system limited to 1 card next turn';
    default: return result.text;
  }
}

function playSelectedCard(target) {
  if (selectedHandIndex === null) return;
  const card = activeGame.hand[selectedHandIndex];
  const res = activeGame.playCard(selectedHandIndex, target);
  if (res.ok) {
    appendNarrationLine(formatCardPlayText(card, target, res.result), 'line-player', { insertAfterHeader: true });
    lastPlayError = null;
  } else {
    // Invalid target — the card stays in hand (see playCard()), just tell
    // the player why so an immune-protected cell etc. doesn't read as
    // "nothing happened."
    lastPlayError = res.result.text;
  }
  selectedHandIndex = null;
  renderGame();
  // After renderGame() (not before) — the board's just been rebuilt, and
  // renderVirusInfoPanel() rebuilds the speed badge's innerHTML every
  // render, which would wipe out the flash if it were appended first.
  if (res.ok && res.result.cells && res.result.cells.length) {
    highlightCells(card.requiresTissue || target.tissue, res.result.cells, 'cell-antibody-escape-poof');
  }
  if (res.ok && card.id === 'spread-speed-plus') flashSpeedDelta(1);
}

// How long a just-played card's own board animation needs before the
// board gets torn down and rebuilt for the next turn's virus_growth
// phase — matches highlightCells()'s own flash-removal timeout (see
// playSelectedCard()'s cell-antibody-escape-poof flash, ~0.9s CSS
// animation). Without this, endTurn() (which resolves the whole next
// turn synchronously) and the renderGame() right after it would tear
// down/rebuild the board — and kick off virus_growth's own narration and
// highlightCells() calls — while a card just played this turn (e.g.
// Antibody Escape clearing antibody cells) was still mid-animation,
// cutting it short and overlapping it with the new phase's own flashes.
// Applies whether End Turn was clicked manually or triggered
// automatically once the hand empties (see renderHand()) — the latter
// fires immediately after the last card's own play, with no pause of its
// own otherwise.
const END_TURN_ANIMATION_BUFFER_MS = 1000;
let endTurnTimer = null;
// True for the length of that buffer — see renderHand()'s own use of
// this to stop the player sneaking in an extra card play (or a second,
// stacked End Turn) during the gap between committing to end the turn
// and the turn actually advancing.
let endingTurn = false;

function endStealthTurn() {
  clearTimeout(endTurnTimer);
  endingTurn = true;
  renderHand();
  endTurnTimer = setTimeout(() => {
    endingTurn = false;
    activeGame.endTurn();
    renderGame();
  }, END_TURN_ANIMATION_BUFFER_MS);
}

// ── End screen ─────────────────────────────────────────────────────
function renderEndScreen() {
  const el = document.getElementById('end-screen');
  el.classList.add('visible');
  // Hides every banner around the board (see .game-over, index.html) so
  // the final board is the whole story — cleared the moment a new game
  // starts (renderGame()'s normal-state branch). immune-banner/hand-panel
  // both set their own inline display:flex on every normal render
  // (renderImmuneBanner()/renderHand()) — an inline style always beats a
  // stylesheet rule regardless of specificity, so .game-over's display:none
  // would otherwise get silently overridden by whichever of those last ran.
  document.getElementById('game-screen').classList.add('game-over');
  document.getElementById('immune-banner').style.display = '';
  document.getElementById('hand-panel').style.display = '';
  hideDraftPopup();

  const won = activeGame.state === 'won';
  const titleText = document.getElementById('end-title-text');
  titleText.textContent = won ? 'You Win' : 'Game Over';
  titleText.classList.toggle('win', won);
  titleText.classList.toggle('lose', !won);

  // No extra line on a win — the title and score already say everything
  // that needs saying; only the lose case gets an explanatory sentence.
  // Hidden outright (not just left empty) on a win — .end-screen-panel's
  // flex gap still applies around an empty-but-present <p>, which otherwise
  // doubled up the space between the title and the score block below it.
  const endCopy = document.getElementById('end-copy');
  endCopy.textContent = won ? '' : 'The infection has been stopped by the immune system. Quite good that we have such a powerful system to protect us from pesky pathogens!';
  endCopy.style.display = won ? 'none' : '';

  // Score is never shown during play — it only appears here, and only on
  // a win, in its own highlighted block rather than trailing text in the
  // sentence above. isNewHighScore is captured once at _saveScore() time
  // (game.js), not recomputed here — by now localStorage's own best has
  // already been overwritten to match this run's score on a new high, so
  // comparing against it here would always say "yes" even on a repeat.
  document.getElementById('end-score-block').classList.toggle('visible', won);
  if (won) {
    document.getElementById('end-score-value').textContent = activeGame.score;
    document.getElementById('end-score-badge').classList.toggle('visible', activeGame.isNewHighScore);
  }

  // Every piece of panel content (title/copy/score) is set above BEFORE
  // either of these run — alignEndScreenBoard() measures the panel's real
  // (now final) height to push the board clear of it, and fitGameStage()
  // then re-measures #game-stage's natural size — which includes that
  // push — to lock the viewport to it. Doing this in the other order (as
  // before) locked the viewport's height in against a shorter, pre-score-
  // block measurement of the panel, so the board ended up pushed down
  // further than the locked viewport height allowed for, and its bottom
  // rows got clipped by #game-stage-viewport's own overflow:hidden.
  alignEndScreenBoard();
  fitGameStage();
  // alignEndScreenBoard()'s panel scale/margin above used whatever
  // gameStageScale held from the last NORMAL-gameplay frame — the
  // end screen hides every banner around the board (see above), which
  // changes #game-stage's natural shape, so that scale is usually stale by
  // the time this end screen is the thing actually being fit. The
  // fitGameStage() call just above computed a fresh, correct scale for
  // THIS (end-screen) stage shape; re-running alignEndScreenBoard() now
  // re-applies the panel scale and board push-down margin against that
  // corrected value, same as checkViewportGate()'s resize handler already
  // does on every later resize — without this, the gap only fixed itself
  // the moment the player first resized the window, not on the initial
  // win/lose paint.
  alignEndScreenBoard();
}

function alignEndScreenBoard() {
  const endScreen = document.getElementById('end-screen');
  const headerOuter = document.querySelector('.header-outer');
  const leftCol = document.querySelector('.game-left-col');
  const panel = document.querySelector('.end-screen-panel');
  if (!endScreen || !leftCol || !panel) return;

  // Keep the panel clear of the site header — a fixed CSS padding-top
  // guess drifted out of sync with the header's actual rendered height
  // (viewport width, font load, etc.), the same reasoning as
  // alignPhasePanel() above. Set before measuring the panel's own
  // position below, since this padding is what moves the panel down.
  if (headerOuter) {
    endScreen.style.paddingTop = '0px';
    const headerDiff = headerOuter.getBoundingClientRect().bottom + 16;
    endScreen.style.paddingTop = Math.max(0, headerDiff) + 'px';
  }

  leftCol.style.marginTop = '0px';
  // Scale the panel to match the board's own gameStageScale, so the banner
  // shrinks/grows together with the board instead of staying fixed-size —
  // see .end-screen-panel's CSS comment. Set before measuring the panel's
  // rect below: getBoundingClientRect() reflects the transform, so the
  // gap math that follows automatically works off the panel's real
  // on-screen (post-scale) size with no other change needed. Uses
  // whatever gameStageScale currently holds — the value from the last
  // fitGameStage() pass — which renderEndScreen()'s own call order (this
  // function, then a fresh fitGameStage()) immediately refines, and which
  // checkViewportGate()'s resize handler also re-syncs afterward.
  panel.style.transform = `scale(${gameStageScale})`;

  const gap = 20;
  // panel (#end-screen-panel) is OUTSIDE #game-stage's transform:scale()
  // (a sibling — see the HTML comment where #game-stage closes), so its
  // own rect is already real viewport pixels; leftCol (.game-left-col) is
  // INSIDE it, though, so the gap this needs to leave has to be converted
  // back to local (pre-transform) pixels the same way alignMutationToast()
  // does, or the applied margin ends up scaled a second time.
  const diff = panel.getBoundingClientRect().bottom + gap - leftCol.getBoundingClientRect().top;
  leftCol.style.marginTop = (Math.max(0, diff) / gameStageScale) + 'px';
}

function exitMission() {
  clearTimeout(autoPhaseTimer);
  narratedPhaseRef = null;
  boardRevealMask = {};
  document.getElementById('end-screen').classList.remove('visible');
  document.getElementById('game-screen').classList.remove('visible', 'game-over');
  document.body.classList.remove('in-game');
  activeGame = null;
  backToSelect();
}
