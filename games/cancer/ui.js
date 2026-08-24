// ═══════════════════════════════════════════════════════════════════
//  ui.js — Canvas renderer, input handling, HUD, card panel.
//
//  Renders both boards on a single <canvas> element.
//  No Phaser dependency in this draft — uses plain Canvas 2D API
//  so the game runs immediately in the browser without a build step.
//  Phaser.js can replace this renderer later for richer effects.
// ═══════════════════════════════════════════════════════════════════

// ── Globals ──────────────────────────────────────────────────────
let game        = null;
let selectedCardIndex = null;
let selectedBoard     = 'primary';  // 'primary' | 'secondary'
let difficulty        = 'normal';
let animFrame         = null;

const canvas  = document.getElementById('game-canvas');
const ctx     = canvas.getContext('2d');

// ── Cell colours per state ────────────────────────────────────
const CELL_COLOURS = {
  intestine: {
    healthy:    '#7a4a3a',
    cancerous:  '#6b4f7a',
    established:'#4a2d5e',
    cleared:    '#2a2a3a',
    protected:  '#1a3a5c',
    damaged:    '#3a2a1a',
  },
  liver: {
    healthy:    '#8a6030',
    cancerous:  '#3d4a38',
    established:'#2a3a28',
    cleared:    '#252520',
    protected:  '#1a3028',
    damaged:    '#3a2a18',
  },
  lymph: {
    healthy:    '#5a4a7a',
    cancerous:  '#3d2a5e',
    established:'#2d1a4e',
    cleared:    '#252030',
    protected:  '#1a2040',
    damaged:    '#3a2040',
  },
};

const CELL_BORDER = {
  healthy:    '#8a5a4a',
  cancerous:  '#9a6aaa',
  established:'#c040e0',
  cleared:    '#3a3a4a',
  protected:  '#00e5ff',
  damaged:    '#7a4a2a',
};

const CANCER_GLOW   = 'rgba(180, 60, 220, 0.35)';
const ESTAB_GLOW    = 'rgba(200, 40, 255, 0.55)';
const PROTECT_GLOW  = 'rgba(0, 229, 255, 0.25)';

// ── Layout helpers ────────────────────────────────────────────
const PANEL_W   = 220;
const HUD_H     = 52;
const STATUS_H  = 36;
const CELL_S    = 68;
const CELL_G    = 4;
const BOARD_PAD = 16;

function boardPixelWidth(cols)  { return cols * (CELL_S + CELL_G) - CELL_G; }
function boardPixelHeight(rows) { return rows * (CELL_S + CELL_G) - CELL_G; }

function primaryBoardOrigin() {
  const canvasW = canvas.width - PANEL_W;
  const canvasH = canvas.height - HUD_H - STATUS_H;
  const bw = boardPixelWidth(CONFIG.BOARD.COLS);
  const bh = boardPixelHeight(CONFIG.BOARD.ROWS);

  // If secondary board is active, shift primary left
  if (game && game.meta.isActive) {
    const sbw = boardPixelWidth(game.meta.secondaryBoard.cols) + BOARD_PAD * 2;
    return {
      x: Math.max(BOARD_PAD, (canvasW - bw - sbw) / 2),
      y: HUD_H + Math.max(BOARD_PAD, (canvasH - bh) / 2),
    };
  }
  return {
    x: (canvasW - bw) / 2,
    y: HUD_H + (canvasH - bh) / 2,
  };
}

function secondaryBoardOrigin() {
  if (!game || !game.meta.isActive) return null;
  const primary = primaryBoardOrigin();
  const pbw = boardPixelWidth(CONFIG.BOARD.COLS);
  return {
    x: primary.x + pbw + BOARD_PAD * 3,
    y: primary.y,
  };
}

// ── Resize ───────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  render();
}
window.addEventListener('resize', resizeCanvas);

// ── Main render loop ─────────────────────────────────────────
function render() {
  if (!game || game.state === 'intro') return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  ctx.fillStyle = '#070c18';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Blueprint grid
  drawGrid();

  // Primary board
  const po = primaryBoardOrigin();
  drawBoard(game.primaryBoard, po.x, po.y, 'intestine', 'primary');

  // Secondary board (if active)
  if (game.meta.isActive) {
    const so = secondaryBoardOrigin();
    drawBoard(game.meta.secondaryBoard, so.x, so.y, game.meta.site, 'secondary');
    drawMetaSiteLabel(so);
  }

  // Primary board label
  drawBoardLabel(po, 'INTESTINAL EPITHELIUM', '#c8876a');
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(0,180,255,0.04)';
  ctx.lineWidth   = 1;
  for (let x = 0; x < canvas.width; x += 44) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 44) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function drawBoard(board, ox, oy, type, boardId) {
  const colours = CELL_COLOURS[type] || CELL_COLOURS.intestine;
  const data    = board.toRenderData();

  data.forEach(row => {
    row.forEach(cell => {
      const cx = ox + cell.col * (CELL_S + CELL_G);
      const cy = oy + cell.row * (CELL_S + CELL_G);
      drawCell(ctx, cx, cy, cell, colours, boardId);
    });
  });

  // Board border
  const bw = boardPixelWidth(board.cols);
  const bh = boardPixelHeight(board.rows);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(ox - 2, oy - 2, bw + 4, bh + 4);
}

function drawCell(ctx, x, y, cell, colours, boardId) {
  const r  = 6;   // border radius
  const s  = CELL_S;
  const st = cell.established ? 'established' : cell.state;

  // Glow for cancerous cells
  if (cell.state === 'cancerous') {
    ctx.shadowColor = cell.established ? ESTAB_GLOW : CANCER_GLOW;
    ctx.shadowBlur  = cell.established ? 18 : 10;
  } else if (cell.state === 'protected') {
    ctx.shadowColor = PROTECT_GLOW;
    ctx.shadowBlur  = 12;
  } else {
    ctx.shadowBlur  = 0;
  }

  // Fill
  ctx.fillStyle = colours[st] || colours.healthy;
  roundRect(ctx, x, y, s, s, r);
  ctx.fill();

  // Barrier ticks
  if (cell.barrierTurns > 0) {
    ctx.strokeStyle = '#ff9f1c';
    ctx.lineWidth   = 2;
    ctx.setLineDash([4, 4]);
    roundRect(ctx, x + 2, y + 2, s - 4, s - 4, r - 1);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Border
  ctx.strokeStyle = CELL_BORDER[st] || CELL_BORDER.healthy;
  ctx.lineWidth   = cell.established ? 2 : 1;
  ctx.shadowBlur  = 0;
  roundRect(ctx, x, y, s, s, r);
  ctx.stroke();

  // Damaged indicator
  if (cell.damagedTurns > 0) {
    ctx.fillStyle = 'rgba(255,100,0,0.25)';
    roundRect(ctx, x, y, s, s, r);
    ctx.fill();
    ctx.fillStyle = '#ff9f1c';
    ctx.font = '10px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('✕', x + s / 2, y + s - 8);
  }

  // Established marker
  if (cell.established) {
    ctx.fillStyle = 'rgba(200,40,255,0.4)';
    ctx.beginPath();
    ctx.arc(x + s - 10, y + 10, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Protected shield icon
  if (cell.state === 'protected') {
    ctx.fillStyle = 'rgba(0,229,255,0.5)';
    ctx.font      = '18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🛡', x + s / 2, y + s / 2);
  }

  // Cleared fade
  if (cell.state === 'cleared') {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, x, y, s, s, r);
    ctx.fill();
  }

  ctx.shadowBlur   = 0;
  ctx.textBaseline = 'alphabetic';
}

function drawBoardLabel(origin, text, colour) {
  const bw = boardPixelWidth(CONFIG.BOARD.COLS);
  ctx.fillStyle    = colour;
  ctx.font         = '9px Orbitron, monospace';
  ctx.textAlign    = 'center';
  ctx.letterSpacing = '2px';
  ctx.globalAlpha  = 0.5;
  ctx.fillText(text, origin.x + bw / 2, origin.y - 8);
  ctx.globalAlpha  = 1;
}

function drawMetaSiteLabel(origin) {
  if (!game.meta.isActive) return;
  const bw = boardPixelWidth(game.meta.secondaryBoard.cols);
  const colour = game.meta.site === 'liver' ? '#b5813e' : '#8a7aaa';
  ctx.fillStyle   = colour;
  ctx.font        = '9px Orbitron, monospace';
  ctx.textAlign   = 'center';
  ctx.globalAlpha = 0.6;
  ctx.fillText(game.meta.siteNameCapital.toUpperCase(), origin.x + bw / 2, origin.y - 8);
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Click / touch handling ────────────────────────────────────
canvas.addEventListener('click', onCanvasClick);
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  onCanvasClick({ clientX: t.clientX, clientY: t.clientY });
}, { passive: false });

function onCanvasClick(e) {
  if (!game || game.phase !== 'play_cards') return;
  if (selectedCardIndex === null) return;

  const { boardId, col, row } = getClickedCell(e.clientX, e.clientY);
  if (col === null) return;

  const card     = game.hand[selectedCardIndex];
  const target   = buildTarget(card, col, row, boardId);
  const result   = game.playCard(selectedCardIndex, target);

  if (result.ok) {
    selectedCardIndex = null;
    updateUI();
    render();
    setStatusMsg(result.result.text);
  } else {
    setStatusMsg(result.reason);
  }
}

function buildTarget(card, col, row, boardId) {
  const t = { col, row, boardId, boardType: boardId };
  if (card.targetType === 'row') t.row = row;
  if (card.targetType === 'col') t.col = col;
  if (card.targetType === 'none') { t.col = 0; t.row = 0; }
  // Cytokines: default to single mode; player can hold Shift for row mode
  if (card.targetType === 'cytokine') {
    t.mode     = 'single';
    t.startCol = col;
  }
  return t;
}

function getClickedCell(cx, cy) {
  // Check primary board
  const po = primaryBoardOrigin();
  let result = hitTestBoard(cx, cy, po, game.primaryBoard, 'primary');
  if (result.col !== null) return result;

  // Check secondary board
  if (game.meta.isActive) {
    const so = secondaryBoardOrigin();
    result = hitTestBoard(cx, cy, so, game.meta.secondaryBoard, 'secondary');
    if (result.col !== null) return result;
  }

  return { boardId: null, col: null, row: null };
}

function hitTestBoard(cx, cy, origin, board, boardId) {
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const bx = origin.x + c * (CELL_S + CELL_G);
      const by = origin.y + r * (CELL_S + CELL_G);
      if (cx >= bx && cx < bx + CELL_S && cy >= by && cy < by + CELL_S) {
        return { boardId, col: c, row: r };
      }
    }
  }
  return { boardId: null, col: null, row: null };
}

// ── Card panel ────────────────────────────────────────────────
function updateCardPanel() {
  const list = document.getElementById('card-list');
  list.innerHTML = '';

  if (!game) return;

  game.hand.forEach((card, i) => {
    const item = document.createElement('div');
    item.className = 'card-item' + (i === selectedCardIndex ? ' selected' : '');
    item.style.color = card.colour || '#ddeeff';
    item.style.borderColor = i === selectedCardIndex ? card.colour : '';
    item.innerHTML = `
      <div class="card-top">
        <span class="card-icon-sm">${card.icon || '🃏'}</span>
        <span class="card-name-sm">${card.name}</span>
      </div>
      <div class="card-cat">${card.category} · ${card.rarity}</div>
      <span class="card-rarity">${card.rarity === 'rare' ? '★★★' : card.rarity === 'uncommon' ? '★★' : '★'}</span>
    `;
    item.addEventListener('click', () => selectCard(i));
    item.addEventListener('mouseenter', e => showCardTooltip(e, card));
    item.addEventListener('mouseleave',  hideCardTooltip);
    list.appendChild(item);
  });
}

function selectCard(i) {
  if (game.phase !== 'play_cards') return;
  selectedCardIndex = i === selectedCardIndex ? null : i;
  updateCardPanel();
  const card = game.hand[i];
  if (card && card.targetType === 'none') {
    // Auto-apply cards that don't need a board target
    const result = game.playCard(i, { col: 0, row: 0, boardType: 'primary' });
    selectedCardIndex = null;
    updateUI(); render();
    if (result.ok) setStatusMsg(result.result.text);
  } else if (selectedCardIndex !== null) {
    setStatusMsg(`${game.hand[i]?.name} selected — click a target on the board.`);
  }
}

function showCardTooltip(e, card) {
  const tt = document.getElementById('card-tooltip');
  document.getElementById('tt-name').textContent  = card.name;
  document.getElementById('tt-name').style.color  = card.colour || '#00e5ff';
  document.getElementById('tt-body').textContent  = card.tooltip || '';
  tt.classList.add('visible');
  positionTooltip(e.clientX, e.clientY);
}

function hideCardTooltip() {
  document.getElementById('card-tooltip').classList.remove('visible');
}

function positionTooltip(x, y) {
  const tt = document.getElementById('card-tooltip');
  tt.style.left = Math.min(x - 230, window.innerWidth - 240) + 'px';
  tt.style.top  = Math.max(y - 80, 60) + 'px';
}

// ── HUD and status updates ────────────────────────────────────
function updateHUD() {
  if (!game) return;
  document.getElementById('h-turn').textContent  = game.turn;
  document.getElementById('h-cells').textContent = game.primaryBoard.cancerousCount() +
    (game.meta.isActive ? ' + ' + game.meta.secondaryBoard.cancerousCount() : '');
  document.getElementById('h-score').textContent = game.score;
  document.getElementById('h-deck').textContent  = game.deck.drawCount;
  document.getElementById('s-deck').textContent  = game.deck.drawCount;
  document.getElementById('s-discard').textContent = game.deck.discardCount;

  // Phase badge
  const phases = { cancer_growth:'cancer', draw_cards:'draw', play_cards:'play', mutation:'mutate' };
  const pLabel  = { cancer_growth:'Cancer growth', draw_cards:'Draw', play_cards:'Play cards', mutation:'Mutation' };
  document.getElementById('phase-display').innerHTML =
    `<span class="phase-badge ${phases[game.phase] || 'draw'}">${pLabel[game.phase] || ''}</span>`;

  // Effects bar
  const effects = [];
  if (game.isEvasionActive)  effects.push({ cls:'danger',  text:`Immune evasion: ${game.evasionTurns}t` });
  if (game.isPenaltyActive)  effects.push({ cls:'warning', text:`Immune −50%: ${game.immunePenaltyTurns}t` });
  if (game.isVaccineActive)  effects.push({ cls:'success', text:`Vaccine boost: ${game.vaccineBoostTurns}t` });
  if (game.resistantCard)    effects.push({ cls:'danger',  text:`Resistant: ${game.resistantCard}` });
  if (game.meta.isActive)    effects.push({ cls:'info',    text:`Metastasis: ${game.meta.siteNameCapital}` });

  document.getElementById('effects-bar').innerHTML = effects
    .map(e => `<span class="effect-pill ${e.cls}">${e.text}</span>`)
    .join('');
}

function setStatusMsg(msg) {
  document.getElementById('s-msg').textContent = msg || '';
}

function updateUI() {
  updateHUD();
  updateCardPanel();
}

// ── Game control functions (called from HTML) ─────────────────
function selectDiff(d, el) {
  difficulty = d;
  document.querySelectorAll('.diff-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
}

function startGame() {
  hide('screen-intro');
  show('hud'); show('card-panel'); show('status-bar');
  resizeCanvas();

  game = new CancerGame(difficulty);
  game.start();

  updateUI();
  setStatusMsg('Select a card from your hand, then click a target on the board.');
  animFrame = requestAnimationFrame(renderLoop);
}

function renderLoop() {
  render();
  updateUI();

  // Check for state transitions
  if (game.state === 'metastasis') {
    document.getElementById('meta-site-name').textContent = game.meta.siteNameCapital;
    document.getElementById('meta-body').textContent      = game.meta.eventMessage;
    show('screen-meta');
    cancelAnimationFrame(animFrame);
    return;
  }
  if (game.state === 'won') {
    document.getElementById('win-score').textContent = game.score;
    show('screen-win');
    hide('hud'); hide('card-panel'); hide('status-bar');
    cancelAnimationFrame(animFrame);
    return;
  }
  if (game.state === 'lost') {
    document.getElementById('lose-score').textContent = game.score;
    show('screen-lose');
    hide('hud'); hide('card-panel'); hide('status-bar');
    cancelAnimationFrame(animFrame);
    return;
  }

  animFrame = requestAnimationFrame(renderLoop);
}

function endTurn() {
  if (!game || game.phase !== 'play_cards') return;
  selectedCardIndex = null;
  game.endTurn();
  updateUI(); render();
}

function acknowledgeMetastasis() {
  hide('screen-meta');
  game.acknowledgeMetastasis();
  show('hud'); show('card-panel'); show('status-bar');
  updateUI(); render();
  animFrame = requestAnimationFrame(renderLoop);
}

function restartGame() {
  hide('screen-win'); hide('screen-lose');
  show('screen-intro');
  if (animFrame) cancelAnimationFrame(animFrame);
  game = null;
}

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

// ── Init ──────────────────────────────────────────────────────
resizeCanvas();
