// ═══════════════════════════════════════════════════════════════════
//  IMMUNE QUEST — Stealth Mission
//  game-ui.js — everything on screen during a mission. Reads StealthGame
//  (game.js) and renders it, and turns clicks into game.js calls. The
//  engine files (game.js, board.js, cards.js) never touch the DOM.
//
//  Contents
//    1. Shared state, hint texts & sound
//    2. Card faces & the card info pop-up
//    3. Mission start, main render (renderGame) & phase tracker
//    4. Layout — fitting the game stage to the screen
//    5. Virus banners — Active Cards & virus panel
//    6. Turn narration (mission log), board reveals, mutation toast &
//       the Immune System banner
//    7. Board rendering
//    8. Draft & trade pop-ups
//    9. Hand & playing cards
//   10. End screen
// ═══════════════════════════════════════════════════════════════════


// ═══ 1. Shared state, hint texts & sound ═══════════════════════════

let activeGame = null;
let selectedHandIndex = null;
// Error text from a failed play (e.g. wrong target), shown once in the
// hint banner. The card isn't spent (see playCard(), game.js).
let lastPlayError = null;

// Every hint shown in the hint banner beside Cards In Hand (see
// setPlayHint()) — edit wording here. Invalid-target errors come from the
// cards themselves (each card's apply() in cards.js returns its own text),
// apart from inactiveTissue below.
const HINT_TEXT = {
  waiting:      'Waiting for your turn…',                                     // immune system's turn (plain, no glow)
  pickCards:    'Select ‘Pick Cards’ to choose the cards to take in hand', // draft pop-up closed with an offer pending
  selectCard:   'Select a card to play it or select ‘End Turn’',               // your turn, 1–2 cards in hand
  selectOrTrade:'Select a card to play it, select ‘Trade 3▸1’ or select ‘End Turn’', // your turn, 3+ cards (Trade 3▸1 available)
  noCards:      'No cards in hand, ending turn…',                            // your turn, empty hand
  targetTissue: 'Click anywhere in the tissue you want to target.',           // after picking Horizontal/Vertical Spread
  targetCell:   'Click a cell on the board to target it.',                    // after picking any other targeted card
  inactiveTissue: tissue => `The virus is not active in the ${tissue}. Select another card or select ‘End Turn’.`, // tapped a greyed-out tissue
};

// Sound effects (CC0, assets/sfx/). Muted via the shared Settings toggle
// (iq_sound_muted — see gameSetSound(), games/shared/ui.js).
const SFX = {
  'mutation-loss': 'assets/sfx/mutation-loss.wav', // a mutation event that WEAKENS the virus (escape/latency/speed/tropism loss)
  'mutation-gain': 'assets/sfx/mutation-gain.wav', // a mutation event that STRENGTHENS the virus (escape/latency/speed/tropism gain)
  'virus-spread':  'assets/sfx/virus-spread.wav',  // one new cell infected during virus growth
  'poof':          'assets/sfx/poof.mp3',          // anything removed from the board — NK Cell/T-Cell clear, Antibody Escape, Cytokine Neutralisation
  'cytokine-place':'assets/sfx/cytokine-place.wav',// a Cytokine shield placed on the board
  'antibody-place':'assets/sfx/antibody-place.mp3',// an Antibody shield placed on the board
  'click':         'assets/sfx/click.wav',         // generic button press
  'powerup':       'assets/sfx/powerup.wav',       // replication speed increases
  'powerdown':     'assets/sfx/powerdown.wav',     // replication speed decreases
  'win':           'assets/sfx/win.wav',
  'lose':          'assets/sfx/lose.wav',
};
// Playback uses the Web Audio API: every sound is fetched and decoded once
// up front and played from memory, so it starts instantly (an <audio>
// element per play lagged noticeably, especially on iPad). Falls back to
// <audio> if Web Audio is unavailable or a sound isn't decoded yet.
const SFX_VOLUME = 0.5;
const _AudioCtx = window.AudioContext || window.webkitAudioContext;
const _audioCtx = _AudioCtx ? new _AudioCtx() : null;
const _sfxBuffers = {};
const _sfxPool = {};
if (_audioCtx) {
  Object.entries(SFX).forEach(([id, src]) => {
    fetch(src)
      .then(r => r.arrayBuffer())
      .then(data => new Promise((ok, fail) => _audioCtx.decodeAudioData(data, ok, fail)))
      .then(buffer => { _sfxBuffers[id] = buffer; })
      .catch(() => {}); // stays on the <audio> fallback
  });
}

function playSound(id) {
  if (localStorage.getItem('iq_sound_muted') === '1') return;
  const src = SFX[id];
  if (!src) return;
  const buffer = _sfxBuffers[id];
  if (_audioCtx && buffer) {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    const source = _audioCtx.createBufferSource();
    const gain = _audioCtx.createGain();
    gain.gain.value = SFX_VOLUME;
    source.buffer = buffer;
    source.connect(gain).connect(_audioCtx.destination);
    source.start();
    return;
  }
  // Fallback: clone a cached <audio> so overlapping plays don't cut off.
  const base = _sfxPool[id] || (_sfxPool[id] = new Audio(src));
  const instance = base.cloneNode();
  instance.volume = SFX_VOLUME;
  // Browsers may block audio before the first user interaction — ignore.
  instance.play().catch(() => {});
}

// Browsers (iPad especially) only allow audio to start after a user
// gesture — unlock the audio context on the first touch/click.
['pointerdown', 'keydown'].forEach(evt => document.addEventListener(evt, () => {
  if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume();
}, { passive: true }));

// "click" sound for every button: any element (or ancestor) with an
// onclick handler. Played on pointerdown — the moment the finger/button
// goes down — rather than on click, which only fires on release.
// Card faces and board cells are skipped — playing a card already has its
// own sound when it resolves (FLASH_SOUND).
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return; // primary button / touch only
  let el = e.target;
  while (el instanceof Element) {
    if (el.classList.contains('card-face') || el.classList.contains('tissue-cell')) return;
    if (el.disabled) return;
    if (el.onclick || el.hasAttribute('onclick')) {
      playSound('click');
      return;
    }
    el = el.parentElement;
  }
}, { passive: true });

// Fixed left-to-right board order, regardless of which tissues are active.
const TISSUE_ORDER = ['liver', 'lung', 'intestine'];
const STATE_LABEL  = { healthy: 'Healthy', infected: 'Infected', dormant: 'Dormant', immune: 'Antibody' };

function _cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Shows the ◂ ▸ arrows beside a horizontally scrolling card row when it
// overflows, and makes them scroll the row by most of a width.
// backArrowEl is optional.
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

// Adds a ◂ ▸ arrow pair around a card row that's rebuilt in JS (Active
// Cards / Immune System banners; the hand row has static arrows in
// index.html).
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



// ═══ 2. Card faces & the card info pop-up ══════════════════════════
// Card art is a transparent PNG per card id (assets/cards/small/), drawn
// on the dark --card-bg colour. Ids listed in NO_ART_IDS get a generated
// placeholder (icon + name) instead — empty now, every card has art.
const NO_ART_IDS = new Set([]);

function getCardArtPath(card) {
  if (NO_ART_IDS.has(card.id)) return null;
  return `assets/cards/small/${card.id}.png`;
}

// One card as a clickable face with an ⓘ button (opens the info pop-up)
// and an optional turns-remaining badge. `onClick` fires on the face.
// .card-face is an unclipped shell so the corner badges can overhang;
// .card-face-art inside it is the clipped, rounded card itself.
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
  el.appendChild(artEl);

  if (onClick) el.onclick = onClick;

  const infoBtn = document.createElement('button');
  infoBtn.className = 'card-info-btn';
  infoBtn.textContent = 'ⓘ';
  infoBtn.onclick = (e) => { e.stopPropagation(); openCardInfo(card, tissue); };
  el.appendChild(infoBtn);

  // Turns-remaining badge (bottom-right corner).
  if (badge) {
    const badgeEl = document.createElement('div');
    badgeEl.className = 'card-face-turns-badge';
    badgeEl.textContent = badge;
    el.appendChild(badgeEl);
  }

  return el;
}

// "The Biology" text in the card info pop-up — the real science behind
// each card (the "In This Game" text is the card's own tooltip).
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



// Tablet (iPad, Android tablet): no page header in game — its logo and
// buttons move into the board's top-left corner to give the board the
// height (see .compact-game-header, index.html).
function isTabletDevice() {
  const ua = navigator.userAgent;
  return /iPad/.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)   // iPadOS reports as a Mac
    || (/Android/.test(ua) && !/Mobile/.test(ua));
}

// Moves the header's logo group and buttons into #game-corner (on) or
// back into the header (off). Moving the real elements keeps their click
// handlers and ids (the Fullscreen icon updates by id).
function setCompactGameHeader(on) {
  const corner = document.getElementById('game-corner');
  const header = document.querySelector('.header-outer header');
  if (!corner || !header) return;
  document.documentElement.classList.toggle('compact-game-header', on);
  const from = on ? header : corner, to = on ? corner : header;
  const logoWrap = from.querySelector('.logo-wrap');
  const buttons = from.querySelector('.header-right');
  if (logoWrap) to.appendChild(logoWrap);
  if (buttons) to.appendChild(buttons);
  // One grid column per square button (Fullscreen may not be offered), so
  // the back button below spans exactly that row's width.
  if (on && buttons) corner.style.setProperty('--corner-cols', buttons.children.length);
}

// ═══ 3. Mission start & main render ════════════════════════════════
// Called from "Start Mission" on the select screen.
function startMission() {
  let payload;
  try { payload = JSON.parse(localStorage.getItem('iq_stealth_loadout')); } catch (e) { payload = null; }
  if (!payload) return;

  // Tell the platform page a mission actually started (analytics).
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_mission_started' }, '*');
  }

  document.getElementById('select-screen').style.display = 'none';
  document.getElementById('game-screen').classList.add('visible');
  document.body.classList.add('in-game');
  setCompactGameHeader(isTabletDevice());

  activeGame = new StealthGame(payload);
  narratedPhaseRef = null;
  document.getElementById('narration-feed').innerHTML = '';
  document.getElementById('narration-col')?.classList.remove('has-unread');
  activeGame.start();
  renderGame();
}

// Main render — draws the whole game screen from the current state.
// Automatic phases are narrated line by line in the mission log and then
// advance on their own (runAutoPhase()).
function renderGame() {
  if (!activeGame) return;
  const g = activeGame;
  renderPhaseTracker();
  renderVirusTraits();
  renderVirusInfoPanel();

  // A new automatic phase first hides the board changes it hasn't
  // narrated yet (revealed step by step later — see runAutoPhase()).
  // Must happen before renderBoards() so they never flash up early.
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

  // A win/loss can be decided as soon as a phase resolves. Narrate that
  // final phase first; the render after it finishes shows the end screen.
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
    // Hand stays visible (not playable); no draft offer yet.
    hideDraftPopup();
    renderHand();
    // Narrate each phase instance exactly once.
    if (isNewPhaseInstance) {
      narratedPhaseRef = phaseKey;
      if (g.phase === 'virus_growth') appendTurnMarker(g.turn);
      runAutoPhase();
    }
  } else if (g.phase === 'play_cards' && g.currentOffer) {
    // Hand stays visible (not playable) behind the draft pop-up.
    renderHand();
    renderDraft();
  } else {
    hideDraftPopup();
    renderHand();
  }
  // Fit the stage last, once the hand's height is final.
  fitGameStage();
  resetTurnReminder();
}

// "Your turn" reminder: after 5–10 s of inactivity on the player's turn,
// the draft Select button (or the hand banners) start pulsing.
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

// Phase tracker — the 5 steps of a turn down the left side. The engine's
// one 'play_cards' phase is shown as two steps: Pick Cards (draft open),
// then Play Cards.
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
    // While Pick Cards is current, clicking it reopens the draft pop-up.
    const reopen = s.phase === 'pick_cards' && current === 'pick_cards';
    return `
    <div class="phase-step${s.phase === current ? ' current' : ''}${reopen ? ' reopenable' : ''}" data-phase="${s.phase}"${reopen ? ' onclick="showDraftPopup()"' : ''}>
      <span class="phase-step-icon">${s.icon}</span>${s.label}
    </div>
  `;
  }).join('');
}



// ═══ 4. Layout — fitting the game stage to the screen ══════════════
// The board, banners, phase panel and mission log all sit inside one
// #game-stage, laid out at a fixed natural size and then scaled as a
// single unit (fitGameStage()) — so they can never drift out of line.
// The align*() helpers fine-tune the layout at natural size first.

// Lines the phase panel's top up with the board's first row of cells.
function alignPhasePanel() {
  const panel = document.getElementById('phase-panel');
  const cell = document.querySelector('.tissue-cell');
  if (!panel || !cell) return;
  panel.style.marginTop = '0px';
  const diff = cell.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  panel.style.marginTop = Math.max(0, diff) + 'px';
}

// Makes the Immune System, Active Cards and Cards In Hand banners exactly
// as wide as the three boards together (measured first board left edge to
// last board right edge), and trims the column to that width so the
// mission log sits right beside the board.
function alignBannerWidths() {
  const boards = document.querySelectorAll('.tissue-board');
  const immuneBanner = document.getElementById('immune-banner');
  const virusBanner = document.getElementById('virus-banner-top');
  const handPanel = document.getElementById('hand-panel');
  const gameLeftCol = document.querySelector('.game-left-col');
  if (!boards.length || !immuneBanner || !virusBanner || !handPanel || !gameLeftCol) return;
  // Reset before measuring, so an old cap doesn't affect this pass.
  gameLeftCol.style.maxWidth = '';
  gameLeftCol.style.minWidth = '';
  const first = boards[0].getBoundingClientRect();
  const last = boards[boards.length - 1].getBoundingClientRect();
  const width = last.right - first.left;
  if (!width) return;
  immuneBanner.style.width = width + 'px';
  virusBanner.style.width = width + 'px';
  handPanel.style.width = width + 'px';

  const sideCol = document.querySelector('.side-col');
  if (sideCol) {
    const sideColWidth = sideCol.getBoundingClientRect().width;
    const columnGap = parseFloat(getComputedStyle(gameLeftCol).columnGap) || 0;
    // Pinned both ways: Safari can squeeze the flex column narrower than
    // the boards, which pushed the mission log on top of the last board.
    const colWidth = (sideColWidth + columnGap + width) + 'px';
    gameLeftCol.style.maxWidth = colWidth;
    gameLeftCol.style.minWidth = colWidth;
  }
}

// Mission log height (width is fixed in CSS):
//   collapsed — just its header (natural height), top-aligned;
//   open — the board column's full height (the feed scrolls inside).
// On the end screen "full height" is the board's cell grid, since the log
// starts level with its top row (alignNarrationToBoard()).
function alignNarrationHeight() {
  const leftCol = document.querySelector('.game-left-col');
  const narrationCol = document.getElementById('narration-col');
  if (!leftCol || !narrationCol) return;
  if (narrationCol.classList.contains('collapsed')) {
    narrationCol.style.height = '';
    return;
  }
  const grid = document.querySelector('.tissue-grid');
  const gameOver = document.getElementById('game-screen').classList.contains('game-over');
  // Squash the log first so its old height can't stretch the row (and so
  // the board column) before it's measured.
  narrationCol.style.height = '0px';
  const fullHeight = (gameOver && grid ? grid : leftCol).getBoundingClientRect().height;
  narrationCol.style.height = fullHeight + 'px';
}

// End screen only (both steps clear themselves during play). Measured on
// screen, converted to stage pixels. Run after every fit/end-screen
// alignment.
//   1. Moves the mission log down so its top lines up with the board's top
//      row of cells (the board itself is pushed below the end-screen panel).
//   2. Shifts the row sideways so the boards themselves (not boards + log
//      tab) are centred under the panel — but never pushes an open log off
//      the right edge.
function alignNarrationToBoard() {
  const narrationCol = document.getElementById('narration-col');
  const mainRow = document.querySelector('.game-main-row');
  const viewport = document.getElementById('game-stage-viewport');
  const boards = document.querySelectorAll('.tissue-board');
  const cell = document.querySelector('.tissue-cell');
  if (!narrationCol || !mainRow || !viewport) return;
  const gameOver = document.getElementById('game-screen').classList.contains('game-over');
  if (!gameOver || !cell || !boards.length) {
    narrationCol.style.marginTop = '';
    mainRow.style.left = '';
    return;
  }

  // 1. Level with the top row.
  const currentTop = parseFloat(narrationCol.style.marginTop) || 0;
  const diff = (cell.getBoundingClientRect().top - narrationCol.getBoundingClientRect().top) / gameStageScale;
  narrationCol.style.marginTop = Math.max(0, currentTop + diff) + 'px';

  // 2. Boards centred (8px margin kept on the right).
  const vp = viewport.getBoundingClientRect();
  const boardsCentre = (boards[0].getBoundingClientRect().left + boards[boards.length - 1].getBoundingClientRect().right) / 2;
  let shift = (vp.left + vp.right) / 2 - boardsCentre;
  const overflow = narrationCol.getBoundingClientRect().right + shift - (vp.right - 8);
  if (overflow > 0) shift -= overflow;
  mainRow.style.left = ((parseFloat(mainRow.style.left) || 0) + shift / gameStageScale) + 'px';
}

// Current scale of #game-stage. Code that positions things INSIDE the
// stage divides on-screen measurements by this to get stage pixels.
let gameStageScale = 1;

// Upper limit on how far the stage grows on very large screens.
const GAME_STAGE_MAX_SCALE = 1.25;

// Scales #game-stage to fit the space below the header.
//   1. Reset to natural size and run the align*() helpers.
//   2. Scale = smallest of width ratio, height ratio and the max.
function fitGameStage() {
  const viewport = document.getElementById('game-stage-viewport');
  const stage = document.getElementById('game-stage');
  if (!viewport || !stage || !document.querySelector('.tissue-grid')) return;

  // Start from natural size so a previous scale doesn't affect this pass.
  stage.style.transform = '';
  viewport.style.height = '';

  alignPhasePanel();
  alignBannerWidths();
  alignNarrationHeight();

  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const availW = viewport.clientWidth || rect.width;
  // Height from the stage's top to the window bottom, minus a small margin
  // and the iPad home-indicator area (--safe-bottom, from the platform page).
  const safeBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')) || 0;
  const availH = Math.max(120, window.innerHeight - rect.top - 8 - safeBottom);

  gameStageScale = Math.min(availW / rect.width, availH / rect.height, GAME_STAGE_MAX_SCALE);
  if (!isFinite(gameStageScale) || gameStageScale <= 0) gameStageScale = 1;

  stage.style.transform = `scale(${gameStageScale})`;
  viewport.style.height = (rect.height * gameStageScale) + 'px';

  // The mutation toast is positioned against the scale — redo it if open.
  const toast = document.getElementById('mutation-toast');
  if (toast && toast.classList.contains('open')) alignMutationToast();

  alignNarrationToBoard();
}

// Below this window size (or in portrait) the game shows a "rotate /
// enlarge your window" message instead of a too-small board.
const MIN_GAME_WIDTH = 820;
const MIN_GAME_HEIGHT = 480;

// Toggles the rotate/enlarge message (.orientation-lock) on load and
// resize. Done in JS because a CSS orientation query can't catch a small
// landscape window.
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
    // Re-sync the end screen to the new scale (after fitGameStage()).
    if (document.getElementById('end-screen').classList.contains('visible')) alignEndScreenBoard();
  }
}
window.addEventListener('resize', checkViewportGate);
window.addEventListener('orientationchange', checkViewportGate);
// Re-fit once web fonts and images have loaded — both can change the
// stage's natural size after the first fit.
document.fonts.ready.then(checkViewportGate);
window.addEventListener('load', checkViewportGate);



// ═══ 5. Virus banners — Active Cards & virus panel ═════════════════
// Active Cards banner: the virus's tropism plus every effect currently in
// force, re-checked against live state on every render.
function renderVirusTraits() {
  const g = activeGame;
  const wrap = document.getElementById('virus-banner-top');
  if (!wrap) return;
  // Pulses only during Play Cards (during the draft only Select glows).
  wrap.classList.toggle('turn-active', g.phase === 'play_cards' && !g.currentOffer);

  wrap.innerHTML = '';

  // Side label, so the cards get the banner's full height.
  const label = document.createElement('span');
  label.className = 'banner-label banner-label-side';
  label.innerHTML = 'Active<br>Cards';
  wrap.appendChild(label);

  // Cards: tropism plus every effect currently in force.
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
  // Replication Boost: shown until the spread phase that uses it is done.
  // (The live value is already reset during that phase, so read the
  // phase's own record.)
  const replicationBoostActive = g.phase === 'virus_growth' && g.lastGrowth
    ? g.lastGrowth.replicationBoostUsed > 0
    : g.replicationBoostAmount > 0;
  if (replicationBoostActive) addCard('spread-speed-plus', true);
  // Activate Tregs, with turns remaining.
  if (g.immuneCardCapTurns > 0) addCard('activate-tregs', true, g.immuneCardCapTurns);
  g.activeTissues.forEach(t => {
    const board = g.boards[t];
    // Antibody Escape (no countdown — it only lasts the current turn).
    const escaped = board.cells.some(row => row.some(c => c.escapeImmune > 0));
    if (escaped) addCard(`antibody-escape-${t}`, true);
    // Latency: shown while dormant cells exist, and during the spread phase
    // in which one woke up (by then it's already infected, so use the
    // phase's own record).
    const wokeDuringThisGrowth = g.phase === 'virus_growth' && g.lastGrowth
      && g.lastGrowth.perTissue[t] && (g.lastGrowth.perTissue[t].awoken || []).length > 0;
    if (board.hasDormant() || wokeDuringThisGrowth) {
      // Badge: turns until the soonest dormant cell wakes (none if the
      // card is only showing because one just woke).
      const wakeTurns = board.cells.reduce((min, row) =>
        row.reduce((m, c) => (c.state === 'dormant' && c.dormantTurns > 0) ? Math.min(m, c.dormantTurns) : m, min), Infinity);
      addCard('latency', true, Number.isFinite(wakeTurns) ? wakeTurns : undefined);
    }
    // T-Cell Evasion, with turns remaining. During the immune phase, use
    // the value from before that phase so the card stays visible while
    // the T-Cell it blocks is narrated.
    const mhcBeforeThisPhase = g.phase === 'immune_response' && g.lastImmune ? g.lastImmune.mhcActiveBefore : null;
    const mhcTurns = (mhcBeforeThisPhase && mhcBeforeThisPhase[t]) || (g.mhcActive && g.mhcActive[t]);
    if (mhcTurns) {
      addCard(`mhc1-downreg-${t}`, true, mhcTurns);
    }
  });
  if (!cardsRow.children.length) cardsRow.innerHTML = '<span class="banner-empty">— none —</span>';

  appendScrollArrowPair(wrap, cardsRow);
}

// Virus panel (left of Active Cards): name, art, replication speed badge
// and mutation rate.
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

  // Speed badge shows the EFFECTIVE speed: pink while Antiviral/Protein
  // Vaccine penalise it, green while a Replication Boost is active.
  // During a spread phase, use that phase's recorded values (the live
  // boost has already been reset).
  const duringThisGrowth = g.phase === 'virus_growth' && g.lastGrowth;
  const displaySpeed = duringThisGrowth ? g.lastGrowth.effectiveSpeedUsed : g.effectiveReplicationSpeed();
  const boostActive = duringThisGrowth ? g.lastGrowth.replicationBoostUsed > 0 : g.replicationBoostAmount > 0;
  const speedEl = document.getElementById('virus-info-panel-speed');
  // Built once; later renders only update the number, so floating
  // +1/−1 animations inside it aren't destroyed mid-flight.
  let valueEl = speedEl.querySelector('.virus-info-panel-speed-value');
  if (!valueEl) {
    speedEl.innerHTML = `<span class="virus-info-panel-label">Replication Speed</span> <span class="virus-info-panel-speed-value"><span class="speed-num"></span></span>`;
    valueEl = speedEl.querySelector('.virus-info-panel-speed-value');
  }
  valueEl.querySelector('.speed-num').textContent = displaySpeed;
  valueEl.classList.toggle('speed-penalized', g.antiviralPenalty > 0 || g.proteinVaccineTurns > 0);
  valueEl.classList.toggle('speed-boosted', boostActive);
}

// When replication speed changes: the number pulses and a stream of
// "+1"/"−1" floats up from the badge towards the phase panel. One floater
// every STAGGER ms for SPAWN_WINDOW_MS; each takes DURATION_MS to rise
// (keep in sync with .speed-delta-flash's animation in index.html).
const SPEED_STREAM_SPAWN_WINDOW_MS = 3000;
const SPEED_STREAM_STAGGER_MS = 250;
const SPEED_STREAM_COUNT = Math.floor(SPEED_STREAM_SPAWN_WINDOW_MS / SPEED_STREAM_STAGGER_MS) + 1;
const SPEED_STREAM_DURATION_MS = 3000;

function flashSpeedDelta(delta) {
  // delta is never 0 here; its sign picks the sound.
  playSound(delta > 0 ? 'powerup' : 'powerdown');
  // Scoped to the in-game panel (the select screen has a hidden badge
  // with the same class).
  const badge = document.querySelector('#virus-info-panel-speed .virus-info-panel-speed-value');
  if (!badge) return;
  // Pulse the number (restarting the animation if it's already running).
  badge.classList.remove('speed-pulse');
  void badge.offsetWidth; // force reflow so re-adding the class restarts the animation
  badge.classList.add('speed-pulse');
  setTimeout(() => badge.classList.remove('speed-pulse'), 700);

  // Rise height: from the badge up to the phase panel, converted from
  // screen pixels to stage pixels (÷ gameStageScale).
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
    // All start behind the number; --drift-x makes each wander sideways
    // as it rises.
    el.style.setProperty('--rise-distance', riseDistance + 'px');
    el.style.setProperty('--drift-x', (Math.random() * 24 - 12) + 'px');
    el.style.animationDelay = (i * SPEED_STREAM_STAGGER_MS) + 'ms';
    badge.appendChild(el);
    setTimeout(() => el.remove(), i * SPEED_STREAM_STAGGER_MS + SPEED_STREAM_DURATION_MS);
  }
}



// ═══ 6. Turn narration, board reveals & Immune System banner ═══════
// Each automatic phase (spread, immune response, mutation) is told in the
// mission log one line at a time. The engine has already resolved the
// whole phase, so board changes are hidden (boardRevealMask) and revealed
// in step with their log line. Then the game advances by itself.

// Timings (ms)
const NARRATION_STEP_DELAY = 1100;  // ms between narration lines
const NARRATION_IDLE_DELAY = 550;   // ms for a "nothing happened" line
const NARRATION_END_PAUSE  = 1200;  // ms pause after the last line before auto-advancing
// Extra time for each immune card, so the player can see which card it was.
const NARRATION_IMMUNE_CARD_DELAY = 3200;
// Delay between newly infected cells appearing one by one.
const VIRUS_SPREAD_CELL_STAGGER_MS = 450;
// Delay between a step's log line / banner card and its board change, so
// the player sees which card was played before the board reacts.
const BOARD_REVEAL_DELAY_MS = 400;

// Length of the T-Cell/NK "poof" animation (.cell-tcell-poof, index.html);
// later steps wait for it to finish.
const POOF_ANIMATION_MS = 900;

let narratedPhaseRef = null;
let autoPhaseTimer = null;

// Set when the cell that wins the game is revealed: remaining reveals
// stop, so the win screen appears at that moment.
let stopRevealAfterWin = false;

// True if this revealed cell is the one that won the game (bottom row
// of an active tissue). The state is already 'won' before any reveal, so
// this identifies the exact moment.
function _isWinningCellReveal(g, tissue, cell) {
  return g.state === 'won' && g.activeTissues.includes(tissue)
    && g.boards[tissue] && cell.row === g.boards[tissue].rows - 1;
}

// Cells still showing their pre-phase look: "tissue|col|row" → snapshot
// { state, cytokineColor, protectedTurns }. Filled when a phase starts,
// emptied cell by cell by revealBoardCells(). renderBoards() draws these
// snapshots instead of the live state.
let boardRevealMask = {};

// Cells cleared by NK Cell / T-Cell this immune phase, tinted
// (.cell-recently-cleared) during the immune and mutation phases so the
// clear isn't missed. Reset when the next immune phase starts.
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

// Same masking for a spread phase: new cells were healthy before (or
// dormant, for woken cells; spillover cells were healthy).
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

// Applies a cell's state to its board element (classes, tooltip,
// Cytokine countdown badge). Used by both renderBoards() and
// revealBoardCells().
function _applyCellVisual(el, cellData, tissue, col, row) {
  // Keep any running flash/animation class (e.g. cell-tcell-poof).
  const preserved = [...el.classList].filter(c =>
    c !== 'tissue-cell' && c !== 'cell-recently-cleared' && !c.startsWith('state-') && !c.startsWith('cytokine-'));
  // "Recently cleared" tint only during the immune and mutation phases;
  // removing the class fades it out via the cell's CSS transition.
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

// Reveals one step's cells: removes them from the mask and redraws them.
// `afterStates` (immune steps) is each cell right after THIS card — used
// instead of the live state, which may already include a later card's
// effect on the same cell.
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
// While a mutation toast is open, the phase waits here instead of
// auto-advancing (so the draft pop-up doesn't cover the toast); called by
// hideMutationToast(). null when nothing is waiting.
let mutationAdvanceCallback = null;

// How many of this immune phase's played cards the Immune System banner
// shows so far — each appears together with its log line.
let immuneBannerRevealCount = 0;
let immuneBannerRevealPhaseKey = null;

// The log is newest-first. activeNarrationGroup is the block being filled
// (e.g. "Immune System" plus that turn's cards — one highlight bar).
let activeNarrationGroup = null;
// The current "— Turn N —" wrapper; that turn's lines go inside it,
// below the header.
let currentTurnGroup = null;

function appendNarrationLine(html, cls = '', opts = {}) {
  const feed = document.getElementById('narration-feed');
  if (!feed) return;
  // Flag new activity on the collapsed log's tab (cleared on expand).
  const col = document.getElementById('narration-col');
  if (col?.classList.contains('collapsed')) col.classList.add('has-unread');
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

  // Lines go inside the current turn group, just below its header.
  const container = currentTurnGroup || feed;
  const afterEl = currentTurnGroup ? currentTurnGroup.firstChild.nextSibling : container.firstChild;

  if (opts.startGroup) {
    const group = document.createElement('div');
    // The block's styling comes from opts.groupCls, so header-only styling
    // on the first line doesn't spread to the whole block.
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
  // Newest line right under the block's header.
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

// Opens/closes the mission log (closed by default), then re-fits the
// stage (its height changes; on the end screen its width too).
function toggleNarration() {
  const col = document.getElementById('narration-col');
  const btn = document.getElementById('narration-toggle');
  if (!col) return;
  const collapsed = col.classList.toggle('collapsed');
  col.classList.remove('has-unread');
  if (btn) {
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? 'Show mission log' : 'Hide mission log';
    btn.querySelector('.narration-toggle-icon').textContent = collapsed ? '«' : '»';
  }
  fitGameStage();
}

function appendTurnMarker(turn) {
  appendNarrationLine(`— Turn ${turn} —`, 'turn-marker', { newTurn: true });
}

// Cell flash animations. highlightCells() briefly animates the cells a
// narrated step touched; every flash class is listed here so a stale one
// can be cleared first.
const ALL_CELL_FLASH_CLASSES = [
  'cell-tcell-poof', 'cell-antibody-flash', 'cell-immune-flash', 'cell-antibody-escape-poof', 'cell-cytokine-flash',
  'cell-cytokine-neutralise-poof-blue', 'cell-cytokine-neutralise-poof-orange', 'cell-cytokine-neutralise-poof-red',
];

// Sound for each flash (Sensing's generic flash is silent). Played once
// per highlightCells() call: spread calls it per cell, a T-Cell row or
// Antibody Escape once for all its cells.
const FLASH_SOUND = {
  'cell-infect-pop': 'virus-spread',
  'cell-explode-pop': 'virus-spread',
  'cell-tcell-poof': 'poof',
  'cell-antibody-escape-poof': 'poof',
  'cell-cytokine-neutralise-poof-blue': 'poof',
  'cell-cytokine-neutralise-poof-orange': 'poof',
  'cell-cytokine-neutralise-poof-red': 'poof',
  'cell-cytokine-flash': 'cytokine-place',
  'cell-antibody-flash': 'antibody-place',
};

function highlightCells(tissue, cells, flashClass = 'cell-immune-flash') {
  if (cells.length && FLASH_SOUND[flashClass]) playSound(FLASH_SOUND[flashClass]);
  cells.forEach(({ col, row }) => {
    const el = document.querySelector(`.tissue-cell[data-tissue="${tissue}"][data-col="${col}"][data-row="${row}"]`);
    if (!el) return;
    // Drop a flash still running from an earlier step on this cell, so two
    // animations don't mix.
    ALL_CELL_FLASH_CLASSES.forEach(c => el.classList.remove(c));
    el.classList.add(flashClass);
    setTimeout(() => el.classList.remove(flashClass), 1000);
  });
}

// Log steps for a spread phase: woken latent cells first (that's the
// order they resolve in), then one line for all tissues that grew.
function buildVirusGrowthSteps(g) {
  const organs = [];
  const groups = [];
  const explodeOrgans = [];
  const explodeGroups = [];
  Object.entries(g.lastGrowth.perTissue).forEach(([t, info]) => {
    const awoken = info.awoken || [];
    // Woken cells get their own line, not the "Virus spread" one.
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

  // Turn 1 opens with "Virus infiltration started".
  const intro = g.turn === 1 ? [{ html: 'Virus infiltration started', cls: 'line-virus', idle: true }] : [];

  if (!organs.length && !explodeOrgans.length) {
    // Turn 1: just the intro line.
    if (g.turn === 1) return intro;
    // (A virus with nowhere to spread would already have lost, so "No
    // spread" only ever means the chance rolls missed.)
    return [...intro, { html: 'No spread this turn', cls: 'line-virus', idle: true }];
  }

  const steps = [...intro];
  if (explodeOrgans.length) {
    steps.push({
      html: `Latent cell(s) became active in ${explodeOrgans.join(', ')}`,
      cls: 'line-virus', groups: explodeGroups, flashClass: 'cell-explode-pop',
    });
  }
  // One line for every tissue with new cells (growth and spillover).
  if (organs.length) {
    steps.push({
      html: `Virus spread in ${organs.join(', ')}`,
      cls: 'line-virus', groups, flashClass: 'cell-infect-pop',
    });
  }
  return steps;
}

// Board animation per immune card: Antibody pops in, T-Cell/NK Cell
// "poof", Cytokine and Sensing get the cyan flash (Cytokine has its own
// class only so it can have its own sound).
function _immuneFlashClass(cardId) {
  if (cardId.startsWith('immune-antibody')) return 'cell-antibody-flash';
  if (cardId.startsWith('immune-tcell') || cardId === 'immune-nkcell') return 'cell-tcell-poof';
  if (cardId.startsWith('immune-cytokine')) return 'cell-cytokine-flash';
  return 'cell-immune-flash';
}

// Log steps for an immune phase: an "Immune System" header, then one line
// per card played, in play order.
function buildImmuneSteps(g) {
  const steps = [];
  g.lastImmune.played.forEach(p => {
    const tissue = p.tissue || (p.cells[0] && p.cells[0].tissue);
    // "Lung — T-Cell", not "Lung — T-Cell: Lung".
    const suffix = tissue ? `: ${_cap(tissue)}` : null;
    const name = suffix && p.name.endsWith(suffix) ? p.name.slice(0, -suffix.length) : p.name;
    // Speed cards state the actual change (none if speed was already at
    // its minimum).
    const label = p.id === 'vaccine-protein'
      ? (p.speedDelta ? `${name} — Replication Speed −${STEALTH_CONFIG.VACCINE.PROTEIN_SPEED_PENALTY_AMOUNT} for ${STEALTH_CONFIG.VACCINE.PROTEIN_SPEED_PENALTY_TURNS} turns` : `${name} — already at minimum speed, no effect`)
      : p.id === 'immune-antiviral'
      ? (p.speedDelta ? `${name} — Replication Speed −${STEALTH_CONFIG.IMMUNE.ANTIVIRAL_PENALTY_AMOUNT}` : `${name} — already at minimum speed, no effect`)
      : name;
    const html = tissue ? `<span class="narration-tissue">${_cap(tissue)}</span> — ${label}` : label;
    steps.push({
      html, cls: 'line-immune', tissue, cells: p.cells, afterStates: p.afterStates, flashClass: _immuneFlashClass(p.id), inGroup: true, slow: true,
      // Only animate the speed badge if the speed really changed.
      speedDelta: p.speedDelta || undefined,
      revealImmuneCard: true,
    });
  });
  // Immune trades and T-Cell Evasion blocks are deliberately not narrated:
  // they'd reveal the immune system's hidden hand.
  if (!steps.length) {
    steps.push({
      html: 'No cards played this turn',
      cls: 'line-immune', idle: true, inGroup: true,
    });
  }
  steps.unshift({ html: 'Immune System', cls: 'line-immune line-immune-header', groupCls: 'line-immune', idle: true, startGroup: true });
  return steps;
}

function buildMutationSteps(g) {
  // One step per mutation phase, even with no mutation.
  const m = g.lastMutation || { event: 'none', category: null, direction: null, text: 'The virus did not mutate', tissue: null, color: null, speedDelta: null };
  // The log line stays clickable to reopen this mutation's details.
  // speedDelta animates the speed badge only if the speed really changed.
  return [{
    html: m.text, cls: 'line-mutation',
    mutationPopup: true, mutationData: m,
    speedDelta: m.speedDelta || undefined,
  }];
}

// Which card face the mutation toast shows (gain and loss share a card;
// the toast's label shows the direction). Tropism and replication-loss
// cards exist only in VIRUS_CARDS (index.html).
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
// The toast closes itself after this long (or ✕ / click outside); its
// mission-log line reopens it.
const MUTATION_TOAST_DURATION = 4000;

// Centres the mutation toast over the three boards (measured), in stage
// pixels.
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
  toast.style.left = (centerX / gameStageScale) + 'px';
  toast.style.top = (centerY / gameStageScale) + 'px';
}

// Mutation toast — shown with the mutation phase's log line.
function showMutationToast(m) {
  const toast = document.getElementById('mutation-toast');
  const cardSlot = document.getElementById('mutation-toast-card');
  if (!toast || !cardSlot || !m) return;
  alignMutationToast();

  cardSlot.innerHTML = '';
  // No mutation: a neutral style, neither gain nor loss.
  const isNeutral = m.direction !== 'gain' && m.direction !== 'loss';
  const cardId = _mutationCardId(m);
  // VIRUS_CARDS entries have no id of their own — add it for the art lookup.
  const def = cardId && (STEALTH_CARD_DEFS[cardId]
    || (VIRUS_CARDS[cardId] && { id: cardId, ...VIRUS_CARDS[cardId] }));
  if (def) {
    cardSlot.appendChild(renderCardFace(def, { tissue: m.tissue }));
  } else {
    const generic = document.createElement('div');
    generic.className = 'mutation-toast-generic';
    // Category icon, plus ▲/▼ for gain/loss (icon only for no mutation).
    const arrowHtml = isNeutral ? '' : (() => {
      const arrowGlyph = m.direction === 'gain' ? '▲' : '▼';
      return `<div class="mutation-toast-generic-arrow ${m.direction}">${arrowGlyph}</div>`;
    })();
    generic.innerHTML = `<div class="mutation-toast-generic-icon">${MUTATION_CATEGORY_ICON[m.category] || '🧬'}</div>${arrowHtml}`;
    cardSlot.appendChild(generic);
  }

  const dirEl = document.getElementById('mutation-toast-direction');
  dirEl.textContent = m.direction === 'gain' ? 'GAINED' : m.direction === 'loss' ? 'LOST' : 'NO CHANGE';
  dirEl.className = 'mutation-toast-direction ' + (isNeutral ? 'neutral' : m.direction);
    // No category line for "no mutation" (it would only repeat the text).
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

  // If the phase is waiting on this toast, continue after a short pause.
  if (mutationAdvanceCallback) {
    const cb = mutationAdvanceCallback;
    mutationAdvanceCallback = null;
    autoPhaseTimer = setTimeout(cb, NARRATION_END_PAUSE);
  }
}

// Close the toast on any click outside it — except the mission-log line
// that reopens it.
document.addEventListener('click', (e) => {
  const toast = document.getElementById('mutation-toast');
  if (!toast || !toast.classList.contains('open')) return;
  if (toast.contains(e.target) || e.target.closest('.narration-line-clickable')) return;
  hideMutationToast();
});

// Narrates the current automatic phase step by step: each step adds a log
// line, then (after BOARD_REVEAL_DELAY_MS) animates and reveals its board
// cells. When all steps are done the game advances to the next phase —
// after the mutation toast closes, if one is showing.
function runAutoPhase() {
  const g = activeGame;
  clearTimeout(autoPhaseTimer);
  stopRevealAfterWin = false;
  const steps = g.phase === 'virus_growth' ? buildVirusGrowthSteps(g)
    : g.phase === 'immune_response' ? buildImmuneSteps(g)
    : buildMutationSteps(g);

  let i = 0;
  let mutationPopupShown = false;
  function next() {
    // The winning cell was revealed — stop narrating.
    if (stopRevealAfterWin) return;
    if (i >= steps.length) {
      const advance = () => { activeGame.advance(); renderGame(); };
      if (mutationPopupShown) {
        // Wait for the mutation toast to close before advancing (so the
        // draft pop-up doesn't cover it) — unless it already has.
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
      setTimeout(() => {
        highlightCells(step.tissue, step.cells, step.flashClass);
        revealBoardCells(step.cells, step.afterStates);
      }, BOARD_REVEAL_DELAY_MS);
    }
    // Spread steps: reveal every new cell one at a time, across tissues.
    let groupStaggerMs = 0;
    if (step.groups) {
      const flatCells = [];
      step.groups.forEach(gr => gr.cells.forEach(c => flatCells.push({ tissue: gr.tissue, ...c })));
      flatCells.forEach((c, idx) => {
        setTimeout(() => {
          // An earlier cell may already have won the game.
          if (stopRevealAfterWin) return;
          // Flash first, then reveal, so the flash class carries over.
          highlightCells(c.tissue, [c], step.flashClass);
          revealBoardCells([c]);
          // Show the win screen the moment the winning cell appears.
          if (_isWinningCellReveal(activeGame, c.tissue, c)) {
            stopRevealAfterWin = true;
            clearTimeout(autoPhaseTimer);
            renderGame();
          }
        }, idx * VIRUS_SPREAD_CELL_STAGGER_MS);
      });
      // Time until the last cell starts its reveal.
      groupStaggerMs = Math.max(0, flatCells.length - 1) * VIRUS_SPREAD_CELL_STAGGER_MS;
    }
    if (step.speedDelta) flashSpeedDelta(step.speedDelta);
    // Show this card in the Immune System banner together with its line.
    if (step.revealImmuneCard) { immuneBannerRevealCount++; renderImmuneBanner(); }
    if (step.mutationPopup) {
      showMutationToast(step.mutationData);
      mutationPopupShown = true;
      // Mutation sound by direction (a speed mutation also plays the
      // speed sound — intentional).
      if (step.mutationData && step.mutationData.direction === 'loss') playSound('mutation-loss');
      if (step.mutationData && step.mutationData.direction === 'gain') playSound('mutation-gain');
    }
    // The mutation's log line stays clickable to reopen its details.
    if (step.mutationPopup && lineEl) {
      lineEl.classList.add('narration-line-clickable');
      lineEl.title = 'Click to view mutation details';
      lineEl.onclick = () => showMutationToast(step.mutationData);
    }
    i++;
    const baseDelay = step.idle ? NARRATION_IDLE_DELAY : step.slow ? NARRATION_IMMUNE_CARD_DELAY : NARRATION_STEP_DELAY;
    // Next step waits for: the base delay, every staggered cell, and a
    // T-Cell/NK "poof" animation to finish (so a later step can't
    // interrupt it on the same cell).
    const minPoofDelay = step.flashClass === 'cell-tcell-poof' && step.cells && step.cells.length
      ? BOARD_REVEAL_DELAY_MS + POOF_ANIMATION_MS + 200 : 0;
    const delay = Math.max(baseDelay, groupStaggerMs + NARRATION_STEP_DELAY, minPoofDelay);
    autoPhaseTimer = setTimeout(next, delay);
  }
  next();
}

// False if the virus already undid this immune play in the same turn
// (Antibody Escape / Cytokine Neutralisation), so the banner stops showing
// it. Other cards can't be undone.
function _immunePlayStillReflected(g, p) {
  if (p.id.startsWith('immune-antibody-')) {
    return p.cells.some(c => {
      const cell = g.boards[c.tissue]?.cells[c.row]?.[c.col];
      return cell && cell.state === 'immune' && !cell.cytokineColor;
    });
  }
  const cytokineMatch = p.id.match(/^immune-cytokine-(blue|orange|red)$/);
  if (cytokineMatch) {
    const color = cytokineMatch[1];
    return p.cells.some(c => {
      const cell = g.boards[c.tissue]?.cells[c.row]?.[c.col];
      return cell && cell.state === 'immune' && cell.cytokineColor === color;
    });
  }
  return true;
}

// Immune System banner (above the board):
//   - each card played this immune phase, revealed one by one with its
//     log line; the one being shown on the board right now pulses
//   - effects still in force: mRNA / Protein Vaccine (turns left),
//     Cytokine shields (turns left), Antibody shields
// Shields are found on every board, including inactive tissues.
function renderImmuneBanner() {
  const g = activeGame;
  const wrap = document.getElementById('immune-banner');
  // Always shown ("— none —" when empty).
  wrap.style.display = 'flex';
  wrap.classList.toggle('turn-active', g.phase === 'immune_response');
  wrap.innerHTML = '';

  // A new immune phase starts the reveal count again.
  const phaseKey = `${g.turn}-${g.phase}`;
  if (g.phase === 'immune_response' && phaseKey !== immuneBannerRevealPhaseKey) {
    immuneBannerRevealPhaseKey = phaseKey;
    immuneBannerRevealCount = 0;
  }

  // Side label, like the Active Cards banner.
  const title = document.createElement('span');
  title.className = 'immune-banner-title banner-label-side';
  title.innerHTML = 'Immune<br>System';
  wrap.appendChild(title);

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
      // Pulses on the card currently playing out on the board.
      if (active) face.classList.add('immune-banner-card-active');
      cardsRow.appendChild(face);
    };

    // This turn's plays: during the immune phase only the ones narrated so
    // far; afterwards all of them. Repeats each get their own face.
    g.lastImmune.played.forEach((p, idx) => {
      if (g.phase === 'immune_response' && idx >= immuneBannerRevealCount) return;
      // Hide a play the virus has since undone (not during its own reveal).
      if (g.phase !== 'immune_response' && !_immunePlayStillReflected(g, p)) return;
      const tissue = p.tissue || (p.cells[0] && p.cells[0].tissue);
      const active = g.phase === 'immune_response' && idx === immuneBannerRevealCount - 1;
      // turnsBadge: full duration at the moment of play.
      addCard(p.id, tissue, p.name, false, p.turnsBadge, active);
    });

    // "Still in force" entries below skip a card just shown above.
    const playedThisTurn = id => g.lastImmune.played.some(p => p.id === id);

    // mRNA Vaccine boost, turns left.
    if (g.mrnaBoostTurns > 0 && !playedThisTurn('vaccine-mrna')) {
      addCard('vaccine-mrna', null, null, true, g.mrnaBoostTurns);
    }
    // Protein Vaccine speed penalty, turns left. (Antiviral is permanent
    // and only shown the turn it's played.)
    if (g.proteinVaccineTurns > 0 && !playedThisTurn('vaccine-protein')) {
      addCard('vaccine-protein', null, null, true, g.proteinVaccineTurns);
    }
    // Cytokine shields: one card per colour per distinct turns-left value
    // (two blocks of the same colour can expire at different times).
    ['blue', 'orange', 'red'].forEach(color => {
      const id = `immune-cytokine-${color}`;
      // Skip only the turns-left value(s) of this turn's fresh play of
      // this colour; an older block of the same colour still shows.
      const freshPlay = g.lastImmune.played.find(p => p.id === id);
      const freshTurns = new Set();
      if (freshPlay) {
        freshPlay.cells.forEach(c => {
          const cell = g.boards[c.tissue]?.cells[c.row]?.[c.col];
          if (cell && cell.protectedTurns > 0) freshTurns.add(cell.protectedTurns);
        });
      }
      const turnsSet = new Set();
      STEALTH_CONFIG.BOARD.TISSUES.forEach(t => {
        g.boards[t].cells.forEach(row => row.forEach(c => {
          if (c.cytokineColor === color && c.protectedTurns > 0 && !freshTurns.has(c.protectedTurns)) turnsSet.add(c.protectedTurns);
        }));
      });
      [...turnsSet].sort((a, b) => b - a).forEach(turns => addCard(id, null, null, true, turns));
    });
    // Antibody shields (permanent, no badge) — one card per tissue that
    // still has any.
    STEALTH_CONFIG.BOARD.TISSUES.forEach(t => {
      const id = `immune-antibody-${t}`;
      if (playedThisTurn(id)) return;
      const stillProtected = g.boards[t].cells.some(row => row.some(c => c.state === 'immune' && !c.cytokineColor));
      if (stillProtected) addCard(id, t, null, true, undefined, false);
    });
  }

  if (!cardsRow.children.length) cardsRow.innerHTML = '<span class="banner-empty">— none —</span>';

  appendScrollArrowPair(wrap, cardsRow);
}



// ═══ 7. Board rendering ════════════════════════════════════════════
// All three tissues are always drawn; inactive ones are greyed out.
function renderBoards() {
  const wrap = document.getElementById('boards-wrap');
  wrap.innerHTML = '';

  TISSUE_ORDER.forEach(tissue => {
    const board = activeGame.boards[tissue];
    const isActive = activeGame.activeTissues.includes(tissue);
    const boardEl = document.createElement('div');
    boardEl.className = 'tissue-board' + (isActive ? '' : ' inactive');
    boardEl.dataset.tissue = tissue;
    // Organ art and title above the grid. The header (not the board) is
    // the CSS size container for them — see .tissue-board-header.
    boardEl.innerHTML = `
      <div class="tissue-board-header">
        <img class="tissue-board-organ" src="assets/organs/${tissue}.png" alt="" width="1024" height="1024">
        <div class="tissue-board-title">${tissue}</div>
      </div>
    `;

    const gridWrap = document.createElement('div');
    gridWrap.className = 'tissue-grid-wrap';

    const grid = document.createElement('div');
    grid.className = 'tissue-grid';
    grid.style.gridTemplateColumns = `repeat(${STEALTH_CONFIG.BOARD.COLS}, 1fr)`;

    // Real cells even on inactive tissues, so pre-placed shields show.
    board.toRenderData().forEach(row => row.forEach(cell => {
      const cellEl = document.createElement('div');
      // Not yet narrated: draw the pre-phase snapshot.
      const masked = boardRevealMask[`${tissue}|${cell.col}|${cell.row}`];
      _applyCellVisual(cellEl, masked || cell, tissue, cell.col, cell.row);
      cellEl.dataset.tissue = tissue;
      cellEl.dataset.col = cell.col;
      cellEl.dataset.row = cell.row;
      // Nothing to target on a tissue the virus can't currently spread in.
      cellEl.onclick = () => onCellClick(tissue, cell.col, cell.row);
      grid.appendChild(cellEl);
    }));

    gridWrap.appendChild(grid);
    boardEl.appendChild(gridWrap);
    wrap.appendChild(boardEl);
  });
}



// ═══ 8. Draft & trade pop-ups ══════════════════════════════════════
// Draft: pick PICK_COUNT of OFFER_COUNT cards. The pop-up can be closed to
// see the board; the offer stays, reopened from the Pick Cards button, the
// phase tracker, or the mission log.
function showDraftPopup() {
  document.getElementById('draft-popup-overlay').classList.add('open');
  updatePickCardsButton(false);
  updatePickCardsEntry(false);
  updateDraftHint();
}

function hideDraftPopup() {
  document.getElementById('draft-popup-overlay').classList.remove('open');
  const g = activeGame;
  const stillPending = g && g.phase === 'play_cards' && !!g.currentOffer;
  updatePickCardsButton(stillPending);
  updatePickCardsEntry(stillPending);
  updateDraftHint();
}

// While a draft offer is pending: no hint while its pop-up is open; once
// it's closed (to look at the board), point the player to Pick Cards.
function updateDraftHint() {
  const g = activeGame;
  if (!g || g.phase !== 'play_cards' || !g.currentOffer) return;
  const open = document.getElementById('draft-popup-overlay').classList.contains('open');
  setPlayHint(open ? '' : HINT_TEXT.pickCards);
}

// Pick Cards button in the hand panel — shown while the draft is closed
// with an offer still pending.
function updatePickCardsButton(show) {
  const btn = document.getElementById('pick-cards-btn');
  if (btn) btn.style.display = show ? '' : 'none';
}

// "👉 Pick two cards" line at the top of the current turn in the mission
// log — another way to reopen the draft. Rebuilt each time so it never
// lingers in an old turn.
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
  // Opens automatically for a new offer (this runs once per offer).
  showDraftPopup();
  // Only the Select button pulses.
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
  // The virus's actions this turn go under one "Virus" header in the log.
  appendNarrationLine('Virus', 'line-player line-player-header', { startGroup: true, groupCls: 'line-player' });
  appendNarrationLine('Drafted cards', 'line-player', { insertAfterHeader: true });
  renderGame();
}

// Trade 3▸1: give up 3 hand cards for 1 card of your choice. Free action.
// Uses the draft pop-up's look, with two tabs (give / receive).
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

// Card types on offer to receive: every type in this virus's deck (draw,
// discard or hand) — except Horizontal/Vertical Spread, which stay
// draft-only so they remain rare.
const TRADE_EXCLUDED_IDS = ['infect-horizontal', 'infect-vertical'];
function getTradeableCardIds() {
  const ids = new Set();
  [...activeGame.deck.draw, ...activeGame.deck.discard, ...activeGame.hand].forEach(c => {
    if (!TRADE_EXCLUDED_IDS.includes(c.id)) ids.add(c.id);
  });
  return [...ids];
}

// Preferred order in the receive grid: each tissue's Antibody Escape next
// to its T-Cell Evasion (liver, lung, intestine), then the other cards.
const TRADE_RECEIVE_ORDER = [
  'antibody-escape-liver', 'mhc1-downreg-liver',
  'antibody-escape-lung', 'mhc1-downreg-lung',
  'antibody-escape-intestine', 'mhc1-downreg-intestine',
  'spread-speed-plus', 'latency', 'activate-tregs',
  'cytokine-neutralise-red', 'cytokine-neutralise-orange', 'cytokine-neutralise-blue',
];

// Lays the receive cards out in exactly 2 rows, keeping each tissue's
// cards together on one row and using the other cards to fill the gaps.
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
  // Exactly 2 rows. Sizes are design px (100px cards — keep in sync with
  // .trade-popup .trade-cards-grid .card-face in index.html), written as
  // rem so they scale with the page.
  const receiveCols = Math.max(1, Math.ceil(receiveIds.length / 2));
  const RECEIVE_CARD_WIDTH = 100;
  const RECEIVE_CARD_GAP = 16; // matches #trade-receive-cards's own gap (index.html)
  receiveWrap.style.gridTemplateColumns = `repeat(${receiveCols}, ${RECEIVE_CARD_WIDTH / 16}rem)`;

  // Size the pop-up to fit the widest row. FIXED_CHROME = grid padding
  // (8×2) + pop-up padding (18×2); the 2 × 1px borders are added in px
  // because hairlines don't scale.
  const FIXED_CHROME = 52;
  const gridContentWidth = receiveCols * RECEIVE_CARD_WIDTH + (receiveCols - 1) * RECEIVE_CARD_GAP;
  const tradePopupEl = document.querySelector('.trade-popup');
  if (tradePopupEl) tradePopupEl.style.width = `calc(${(gridContentWidth + FIXED_CHROME) / 16}rem + 2px)`;

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
  // Card faces are skipped by the global click sound, so play it here.
  playSound('click');
  const idx = tradeGiveSelected.indexOf(i);
  if (idx !== -1) tradeGiveSelected.splice(idx, 1);
  else if (tradeGiveSelected.length < 3) tradeGiveSelected.push(i);
  // After the 3rd card, switch to the receive tab.
  if (tradeGiveSelected.length === 3) tradeActiveTab = 'receive';
  renderTradeModal();
}

function toggleTradeReceive(id) {
  playSound('click'); // see toggleTradeGive()'s own comment above
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



// ═══ 9. Hand & playing cards ═══════════════════════════════════════
// The hand is shown in every phase but is only playable during Play
// Cards (End Turn and Trade are disabled otherwise).
function renderHand() {
  const g = activeGame;
  // endingTurn: End Turn has been pressed and the turn is about to end —
  // no more plays.
  const interactive = g.phase === 'play_cards' && !g.currentOffer && !endingTurn;
  const handPanel = document.getElementById('hand-panel');
  handPanel.style.display = 'flex';
  handPanel.classList.toggle('turn-active', interactive);
  const list = document.getElementById('hand-cards');
  list.innerHTML = '';
  selectedHandIndex = null;
  _syncTissueTargetingClass();

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

  const picking = g.phase === 'play_cards' && !!g.currentOffer;
  // Hint banner: a plain "waiting" box on the immune system's turn; during
  // the draft, hidden while its pop-up is open (updateDraftHint()).
  if (lastPlayError) {
    setPlayHint(lastPlayError, 'error');
    lastPlayError = null;
  } else if (picking) {
    updateDraftHint();
  } else if (!interactive) {
    setPlayHint(HINT_TEXT.waiting, 'waiting');
  } else {
    setPlayHint(!g.hand.length ? HINT_TEXT.noCards
      : g.hand.length >= 3 ? HINT_TEXT.selectOrTrade
      : HINT_TEXT.selectCard);
  }

  // Empty hand on your turn: end the turn automatically.
  if (interactive && !g.hand.length) endStealthTurn();
}

// Spread cards target a whole tissue, so while one is selected the board
// highlights whole tissues on hover instead of single cells
// (.targeting-tissue). Called whenever the selected card changes.
function _syncTissueTargetingClass() {
  const card = selectedHandIndex !== null ? activeGame.hand[selectedHandIndex] : null;
  document.getElementById('boards-wrap')?.classList.toggle('targeting-tissue', !!card && card.targetType === 'tissue');
}

// Shows the hint banner beside Cards In Hand with `text` (hidden when
// empty). kind: 'hint' (green glow), 'error' (pink glow) or 'waiting'
// (plain box, muted text). New text replays the pop-in.
function setPlayHint(text, kind = 'hint') {
  const hintEl = document.getElementById('play-hint');
  const banner = document.getElementById('hint-banner');
  if (!hintEl || !banner) return;
  const isError = kind === 'error';
  const changed = hintEl.textContent !== text || banner.dataset.kind !== kind;
  banner.dataset.kind = kind;
  hintEl.textContent = text;
  hintEl.classList.toggle('play-hint-error', isError);
  banner.classList.toggle('error', isError);
  banner.classList.toggle('waiting', kind === 'waiting');
  banner.classList.toggle('visible', !!text);
  if (text && changed) {
    banner.classList.remove('pop');
    void banner.offsetWidth; // restart the pop animation
    banner.classList.add('pop');
  }
}

function selectHandCard(i) {
  resetTurnReminder();
  document.querySelectorAll('#hand-cards .card-face').forEach(el => el.classList.remove('selected'));
  const card = activeGame.hand[i];
  if (selectedHandIndex === i) { selectedHandIndex = null; _syncTissueTargetingClass(); return; }
  selectedHandIndex = i;
  document.getElementById('hand-card-' + i).classList.add('selected');

  if (card.targetType === 'none') {
    playSelectedCard({});
  } else if (card.targetType === 'tissue') {
    // Spread cards: the player picks a tissue — any cell in it will do.
    setPlayHint(HINT_TEXT.targetTissue);
  } else {
    setPlayHint(HINT_TEXT.targetCell);
  }
  _syncTissueTargetingClass();
}

function onCellClick(tissue, col, row) {
  if (selectedHandIndex === null) return;
  // Greyed-out tissue: explain instead of doing nothing (card stays selected).
  if (!activeGame.activeTissues.includes(tissue)) {
    setPlayHint(HINT_TEXT.inactiveTissue(tissue), 'error');
    return;
  }
  const card = activeGame.hand[selectedHandIndex];
  if (card.targetType === 'tissue') {
    playSelectedCard({ tissue });
  } else {
    playSelectedCard({ tissue, col, row });
  }
}

// The player's own mission-log line for a card (shorter than the game
// log's text, which is the fallback). speedDelta = actual speed change
// from a Replication Boost (0 at max speed).
function formatCardPlayText(card, target, result, speedDelta) {
  switch (card.id) {
    case 'infect-horizontal': return 'Played horizontal spread';
    case 'infect-vertical': return 'Played vertical spread';
    case 'spread-speed-plus':
      return speedDelta
        ? `Played replication boost +${STEALTH_CONFIG.REPLICATION_BOOST.AMOUNT} for 1 turn`
        : `Played replication boost — already at maximum speed, no effect`;
    case 'latency': return 'Played latency - activates next turn';
    case 'antibody-escape-lung':
    case 'antibody-escape-liver':
    case 'antibody-escape-intestine':
      // Targets the tissue printed on the card.
      return `Played antibody escape (${card.requiresTissue || target.tissue})`;
    case 'activate-tregs': return 'Played T reg activation - immune system limited to 1 card next turn';
    default: return result.text;
  }
}

function playSelectedCard(target) {
  if (selectedHandIndex === null) return;
  const card = activeGame.hand[selectedHandIndex];
  // Measure the actual speed change (a Boost at max speed does nothing).
  const speedBeforePlay = activeGame.effectiveReplicationSpeed();
  const res = activeGame.playCard(selectedHandIndex, target);
  const speedDelta = card.id === 'spread-speed-plus' ? activeGame.effectiveReplicationSpeed() - speedBeforePlay : undefined;
  if (res.ok) {
    appendNarrationLine(formatCardPlayText(card, target, res.result, speedDelta), 'line-player', { insertAfterHeader: true });
    lastPlayError = null;
  } else {
    // Invalid target: the card stays in hand; show why in the hint banner.
    lastPlayError = res.result.text;
  }
  selectedHandIndex = null;
  _syncTissueTargetingClass();
  renderGame();
  // Effects after renderGame(), which rebuilds the board and badge.
  const touchedCells = res.ok && res.result.cells && res.result.cells.length;
  if (touchedCells) {
    // Spread cards pop new infection in; Cytokine Neutralisation gets a
    // poof in its shield colour; Antibody Escape gets its own poof.
    const cytokineColorMatch = card.id.match(/^cytokine-neutralise-(blue|orange|red)$/);
    const flashClass = (card.id === 'infect-horizontal' || card.id === 'infect-vertical')
      ? 'cell-infect-pop'
      : cytokineColorMatch
      ? `cell-cytokine-neutralise-poof-${cytokineColorMatch[1]}`
      : 'cell-antibody-escape-poof';
    highlightCells(card.requiresTissue || target.tissue, res.result.cells, flashClass);
  }
  const gotSpeedCue = res.ok && card.id === 'spread-speed-plus' && speedDelta;
  if (gotSpeedCue) flashSpeedDelta(speedDelta);
  // Plays with no board or speed effect still get a click sound.
  if (res.ok && !touchedCells && !gotSpeedCue) playSound('click');
}

// End Turn waits this long before the next turn starts, so the last
// card's board animation can finish (also when the turn ends itself on
// an empty hand).
const END_TURN_ANIMATION_BUFFER_MS = 1000;
let endTurnTimer = null;
// True during that wait — blocks further plays and a second End Turn.
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



// ═══ 10. End screen ════════════════════════════════════════════════
function renderEndScreen() {
  const el = document.getElementById('end-screen');
  // Can re-run for the same finished game — play the sound only once.
  const alreadyShown = el.classList.contains('visible');
  el.classList.add('visible');
  if (!alreadyShown) playSound(activeGame.state === 'won' ? 'win' : 'lose');
  // .game-over hides every banner so the final board is the focus. The
  // inline display set by the normal renders has to be cleared too.
  document.getElementById('game-screen').classList.add('game-over');
  document.getElementById('immune-banner').style.display = '';
  document.getElementById('hand-panel').style.display = '';
  hideDraftPopup();
  // Normal header on tablets too (startMission() switches the compact
  // corner back on for the next game).
  setCompactGameHeader(false);

  const won = activeGame.state === 'won';
  const titleText = document.getElementById('end-title-text');
  titleText.textContent = won ? 'You Win' : 'Game Over';
  titleText.classList.toggle('win', won);
  titleText.classList.toggle('lose', !won);

  // Explanatory line on a loss only (hidden on a win so it adds no gap).
  const endCopy = document.getElementById('end-copy');
  endCopy.textContent = won ? '' : 'The infection has been stopped by the immune system. Quite good that we have such a powerful system to protect us from pesky pathogens!';
  endCopy.style.display = won ? 'none' : '';

  // Score block on a win only. isNewHighScore was recorded when the
  // score was saved (the stored best has been overwritten since).
  document.getElementById('end-score-block').classList.toggle('visible', won);
  if (won) {
    document.getElementById('end-score-value').textContent = activeGame.score;
    document.getElementById('end-score-badge').classList.toggle('visible', activeGame.isNewHighScore);
  }

  // Order matters: content first; then push the board below the panel;
  // fit the stage (the end screen changes its shape); then align again
  // with the corrected scale — otherwise the board's bottom rows can be
  // clipped.
  alignEndScreenBoard();
  fitGameStage();
  alignEndScreenBoard();
}

// Places the end-screen panel below the header, scales it like the board,
// and pushes the board down just below it.
function alignEndScreenBoard() {
  const endScreen = document.getElementById('end-screen');
  const headerOuter = document.querySelector('.header-outer');
  const leftCol = document.querySelector('.game-left-col');
  const panel = document.querySelector('.end-screen-panel');
  if (!endScreen || !leftCol || !panel) return;

  // Keep the panel clear of the header (measured).
  if (headerOuter) {
    endScreen.style.paddingTop = '0px';
    const headerDiff = headerOuter.getBoundingClientRect().bottom + 16;
    endScreen.style.paddingTop = Math.max(0, headerDiff) + 'px';
  }

  leftCol.style.marginTop = '0px';
  // Scale the panel with the stage (set before measuring — the rect
  // includes the transform).
  panel.style.transform = `scale(${gameStageScale})`;

  const gap = 20;
  // The panel is outside the scaled stage (real pixels); the board column
  // is inside it, so convert the margin to stage pixels.
  const diff = panel.getBoundingClientRect().bottom + gap - leftCol.getBoundingClientRect().top;
  leftCol.style.marginTop = (Math.max(0, diff) / gameStageScale) + 'px';

  alignNarrationToBoard(); // the board just moved — keep the log level with it
}

// Header ↺ button: back to the virus select screen. Asks first while a
// mission is still in progress (a one-tap header button is easy to hit).
function restartMission() {
  if (!activeGame) return;
  if (activeGame.state === 'playing' && !confirm('Restart? This mission will be lost.')) return;
  exitMission();
}

// Leaves the mission and returns to the virus select screen.
function exitMission() {
  setCompactGameHeader(false);
  clearTimeout(autoPhaseTimer);
  narratedPhaseRef = null;
  boardRevealMask = {};
  document.getElementById('end-screen').classList.remove('visible');
  document.getElementById('game-screen').classList.remove('visible', 'game-over');
  document.body.classList.remove('in-game');
  activeGame = null;
  backToSelect();
}
