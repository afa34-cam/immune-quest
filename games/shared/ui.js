// ════════════════════════════════════════════════════════════════════════════════
//  IMMUNE QUEST — shared UI (platform page and every game)
//  The page sets a config object, then calls initUI(config).
//
//  Contents
//    1. Config defaults & initUI()
//    2. Header (logo, back link, MENU / ? / Restart / Fullscreen) & fullscreen
//    3. Footer
//    4. Menu — full (platform page; markup lives in index.html)
//    5. Menu — simple (games; built here), star rating, and the
//       settings / share / feedback actions
//    6. Utility
// ════════════════════════════════════════════════════════════════════════════════

// Remembers config.fullscreenIconOnly so later fullscreen-state updates
// keep the same button form.
let _fullscreenIconOnly = false;

// ════════════════════════════════════════════════════════════════════════════════
//  1. CONFIG DEFAULTS & initUI()
// ════════════════════════════════════════════════════════════════════════════════
const DEFAULT_CONFIG = {
  // Branding
  gameTitle: 'IMMUNE QUEST',
  gameLogo: 'IMMUNE<span>QUEST</span>',
  gameLogoColor: 'var(--accent)',
  gameLogoSpanColor: 'var(--accent2)',
  gameAccentColor: 'var(--stealth)',
  
  // Header
  showBackLink: false,
  backLinkText: '← BACK',
  backLinkHref: '#',
  
  // Menu
  showHelpButton: false,
  showMenuButton: true,
  // Fullscreen button shows only its icon (no "FULLSCREEN" label).
  fullscreenIconOnly: false,
  // ↺ button calling the page's restartMission() (Stealth).
  showRestartButton: false,
  showFooter: true,
  menuType: 'full', // 'full' for main hub, 'simple' for games
};

// Merge user config with defaults
function initUI(userConfig) {
  const CONFIG = { ...DEFAULT_CONFIG, ...userConfig };
  
  renderHeader(CONFIG);
  if(CONFIG.showFooter) renderFooter(CONFIG);
  
  if(CONFIG.menuType === 'full') {
    setupFullMenu();
  } else {
    setupSimpleMenu(CONFIG);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  2. HEADER & FULLSCREEN
// ════════════════════════════════════════════════════════════════════════════════
function renderHeader(config) {
  const embedded = window.self !== window.top;

  // Inside the platform's game modal, the platform shows its own bar, so
  // no header here — unless the game asks for its own
  // (showHeaderWhenEmbedded; the platform then hides its bar —
  // OWN_HEADER_GAMES, index.html).
  if (embedded && !config.showHeaderWhenEmbedded) return;

  const headerOuter = document.querySelector('.header-outer') || createHeaderOuter();

  let logoWrapContent = '';
  if(config.showBackLink) {
    // Embedded: ask the platform to close the game modal (a normal link
    // would only navigate the iframe). Standalone: a normal link.
    const backLinkAttrs = embedded
      ? `href="javascript:void(0)" onclick="exitEmbeddedGame()"`
      : `href="${config.backLinkHref}"`;
    // The arrow gets its own span (.hdr-icon) so it can be sized apart
    // from the label ("← LABEL" is split on the first space).
    const backLinkSpace = config.backLinkText.indexOf(' ');
    const backLinkIcon = backLinkSpace === -1 ? config.backLinkText : config.backLinkText.slice(0, backLinkSpace);
    const backLinkLabel = backLinkSpace === -1 ? '' : config.backLinkText.slice(backLinkSpace + 1);
    logoWrapContent = `<a class="back-link" ${backLinkAttrs}><span class="hdr-icon">${backLinkIcon}</span> ${backLinkLabel}</a>
      <div style="width:1px; height:1.25rem; background:var(--border);"></div>`;
  }

  const logoHtml = config.gameLogo
    .replace(/\n/g, '')
    .replace(/<span>/g, `<span style="color: ${config.gameLogoSpanColor};">`)
    .replace(/<\/span>/g, '</span>');

  let helpHtml = '', menuHtml = '', restartHtml = '', fullscreenHtml = '';
  if(config.showHelpButton) {
    helpHtml = `<button class="help-btn" id="help-trigger" onclick="openHelp && openHelp()" title="Tutorial">?</button>`;
  }
  if(config.showMenuButton) {
    menuHtml = `<button class="menu-btn" id="menu-trigger" onclick="openMenu()"><span class="hdr-icon">☰</span> MENU</button>`;
  }
  // Standalone: no button where the browser has no Fullscreen API (e.g.
  // iPhone Safari). Embedded: the platform handles fullscreen.
  // Never in a Home Screen web app — it's full-screen already, and iPadOS
  // element fullscreen there adds a black band.
  const fullscreenSupported = !isRunningAsWebApp()
    && (embedded || !!(document.fullscreenEnabled || document.webkitFullscreenEnabled));
  if(config.showFullscreenButton && fullscreenSupported) {
    _fullscreenIconOnly = !!config.fullscreenIconOnly;
    fullscreenHtml = _fullscreenIconOnly
      ? `<button class="menu-btn icon-only" id="fullscreen-trigger" onclick="toggleGameFullscreen()" title="Fullscreen"><span class="hdr-icon">⛶</span></button>`
      : `<button class="menu-btn" id="fullscreen-trigger" onclick="toggleGameFullscreen()" title="Fullscreen"><span class="hdr-icon">⛶</span> FULLSCREEN</button>`;
  }
  // Restart (games with a restartMission() — Stealth). The page decides
  // when it's visible (Stealth: in a mission only).
  if(config.showRestartButton) {
    restartHtml = `<button class="menu-btn icon-only" id="restart-trigger" onclick="restartMission()" title="Restart mission" aria-label="Restart mission"><span class="hdr-icon">↺</span></button>`;
  }
  // Same order on every page of the platform: MENU, ?, (Restart,) Fullscreen.
  const headerRightContent = menuHtml + helpHtml + restartHtml + fullscreenHtml;

  const headerHtml = `
    <div class="logo-wrap">
      ${logoWrapContent}
      <div class="logo" style="color: ${config.gameLogoColor};">${logoHtml}</div>
    </div>
    <div class="header-right">
      ${headerRightContent}
    </div>
  `;

  const header = headerOuter.querySelector('header');
  if(header) {
    header.innerHTML = headerHtml;
  } else {
    const newHeader = document.createElement('header');
    newHeader.innerHTML = headerHtml;
    headerOuter.appendChild(newHeader);
  }

  document.body.insertBefore(headerOuter, document.body.firstChild);
}

function createHeaderOuter() {
  const outer = document.createElement('div');
  outer.className = 'header-outer';
  return outer;
}

// Asks the platform hub to close the game modal — used instead of a plain
// link when embedded, since the hub (not the iframe) owns the modal.
function exitEmbeddedGame() {
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_close_game' }, '*');
  }
}

// "Back to Patient" from anywhere in a game: embedded, close the game
// window (navigating would load the platform INSIDE the game frame, with
// no header); standalone, go to the platform page.
function backToPlatform(href) {
  if (window.self !== window.top) exitEmbeddedGame();
  else window.location.href = href;
}

// True when the platform is open as a Home Screen web app. Inside the
// platform's game iframe, the top (same-origin) page is checked instead.
function isRunningAsWebApp() {
  const check = w => w.navigator.standalone === true
    || w.matchMedia('(display-mode: standalone)').matches
    || w.matchMedia('(display-mode: fullscreen)').matches;
  try { return check(window.top); } catch (e) { return check(window); }
}

// Embedded games only act on messages from the Immune Quest page around
// them (same site; 'null' only when testing from local files), not from
// another site that has put the game in a frame.
function isFromPlatform(e) {
  return e.source === window.parent
    && (e.origin === location.origin || (location.protocol === 'file:' && e.origin === 'null'));
}

// Safe-area inset (home indicator) reported by the platform page while
// embedded — env() is always 0 inside an iframe. Stored as --safe-bottom so
// a game can keep its own content clear of it; layouts re-fit on change.
if (window.self !== window.top) {
  window.addEventListener('message', (e) => {
    if (!isFromPlatform(e) || !e.data || e.data.type !== 'iq_safe_area') return;
    document.documentElement.style.setProperty('--safe-bottom', (Number(e.data.bottom) || 0) + 'px');
    window.dispatchEvent(new Event('resize'));
  });
}

// Embedded: ask the platform to toggle fullscreen (its modal is the
// fullscreen target). Standalone: toggle this page.
function toggleGameFullscreen() {
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_toggle_fullscreen' }, '*');
    return;
  }
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  } else {
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
  }
}

// Keeps the Fullscreen button's icon/label in step with the real state.
// Embedded, the platform reports the state by postMessage
// (iq_fullscreen_state).
function setFullscreenButtonLabel(isFullscreen) {
  const btn = document.getElementById('fullscreen-trigger');
  if (!btn) return;
  const icon = isFullscreen ? '⤢' : '⛶';
  btn.classList.toggle('is-fullscreen', isFullscreen);
  btn.innerHTML = _fullscreenIconOnly
    ? `<span class="hdr-icon">${icon}</span>`
    : `<span class="hdr-icon">${icon}</span> ${isFullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}`;
}

if (window.self !== window.top) {
  window.addEventListener('message', (e) => {
    if (isFromPlatform(e) && e.data && e.data.type === 'iq_fullscreen_state') {
      setFullscreenButtonLabel(!!e.data.isFullscreen);
    }
  });
} else {
  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
    .forEach(evt => document.addEventListener(evt, () => setFullscreenButtonLabel(!!(document.fullscreenElement || document.webkitFullscreenElement))));
}

// ════════════════════════════════════════════════════════════════════════════════
//  3. FOOTER
// ════════════════════════════════════════════════════════════════════════════════
function renderFooter(config) {
  let footer = document.querySelector('footer');
  
  if(!footer) {
    footer = document.createElement('footer');
    document.body.appendChild(footer);
  }
  
  footer.innerHTML = `© 2026`;
}

// ════════════════════════════════════════════════════════════════════════════════
//  4. MENU — FULL (platform page; the modal's markup is in index.html)
// ════════════════════════════════════════════════════════════════════════════════
function setupFullMenu() {
  // Full menu is already in the page HTML from the original index
  // Just ensure openMenu/closeMenu functions work
}

// Locks a tabbed modal's tab-content area to a fixed height (the tallest
// tab's own natural height) so switching tabs doesn't resize the modal.
// Must run while the modal is actually visible (display:none collapses
// all descendants to 0), so callers add the "open" class first.
function lockModalTabHeight(modal) {
  if(!modal) return;
  const contents = modal.querySelectorAll('.modal-tab-content');
  if(!contents.length) return;
  const prevActive = modal.querySelector('.modal-tab-content.active');
  let maxH = 0;
  contents.forEach(c => {
    c.classList.add('active');
    maxH = Math.max(maxH, c.getBoundingClientRect().height);
    c.classList.remove('active');
  });
  contents.forEach(c => { c.style.minHeight = maxH + 'px'; });
  if(prevActive) prevActive.classList.add('active');
}

// Opens the menu on its Settings tab (games: gtab-settings; platform page:
// tab-settings via its own switchTab() — on game pages switchTab is
// something else, e.g. Stealth's virus builder, hence the id checks).
function openMenu() {
  const modal = document.getElementById('menu-modal');
  if(modal) {
    if(document.getElementById('gtab-settings')) switchGameTab('settings');
    else if(document.getElementById('tab-settings') && typeof switchTab === 'function') switchTab('settings');
    modal.classList.add('open');
    lockModalTabHeight(modal);
  }
}

function closeMenu() {
  const modal = document.getElementById('menu-modal');
  if(modal) {
    modal.classList.remove('open');
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  5. MENU — SIMPLE (game pages): the same About / Settings / Share /
//  Feedback tabs as the platform (game actions live in the header).
//  When embedded, the actions are passed to the platform page (they need
//  its URL — e.g. sharing the platform link, not the iframe's).
// ════════════════════════════════════════════════════════════════════════════════
function setupSimpleMenu(config) {
  let modal = document.getElementById('menu-modal');
  if(!modal) {
    modal = document.createElement('div');
    modal.id = 'menu-modal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal" style="max-width:40rem;">
      <div class="modal-header">
        <div class="modal-title">Menu</div>
        <button class="modal-close" onclick="closeMenu()">✕</button>
      </div>
      <div class="modal-tabs">
        <div class="modal-tab active" onclick="switchGameTab('about')">About</div>
        <div class="modal-tab" onclick="switchGameTab('settings')">Settings</div>
        <div class="modal-tab" onclick="switchGameTab('share')">Share</div>
        <div class="modal-tab" onclick="switchGameTab('feedback')">Feedback</div>
      </div>
      <div class="modal-body">

        <div class="modal-tab-content active" id="gtab-about">
          <div class="modal-section">
            <div class="modal-section-title">About</div>
            <div class="about-text">
              <strong style="color:var(--text)">Immune Quest</strong> is a free educational game platform designed to empower young people with trustworthy knowledge about infections, the immune system, vaccines, and treatments.<br><br>
              <span style="color:var(--muted)">Version 0.23<br>© 2026 · Developed by Arwen Altenburg with Claude (Sonnet 4.6, 5, Opus 5.5) & Google Gemini.</span>
            </div>
          </div>
        </div>

        <div class="modal-tab-content" id="gtab-settings">
          <div class="modal-section">
            <div class="modal-section-title">Privacy</div>
            <div class="toggle-row">
              <div>
                <div class="toggle-label">Share anonymous play stats</div>
                <div class="toggle-sub">Helps us understand how the game is used. No personal data collected.</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="game-toggle-tracking" onchange="gameSetTracking(this.checked)">
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div style="font-size:0.8125rem; color:var(--muted); line-height:1.5; margin-top:0.5rem;">
              We use <a href="https://www.goatcounter.com" target="_blank" rel="noopener" style="color:var(--accent3);">GoatCounter</a>, a privacy-first analytics tool, to count which games are opened and how often. It uses no cookies and never stores IP addresses or any other personal data — every visit is completely anonymous. These numbers help us show evidence of public engagement when reporting to the University and funding bodies.
            </div>
          </div>
          <div class="modal-section">
            <div class="modal-section-title" style="display:flex; justify-content:space-between; align-items:center;">
              Sound effects
              <label class="toggle-switch">
                <input type="checkbox" id="game-toggle-sound" onchange="gameSetSound(this.checked)">
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="modal-section">
            <div class="modal-section-title">Progress (this device)</div>
            <div class="modal-btn" style="cursor:pointer; align-self:flex-start;" onclick="gameResetProgress()">
              <span class="modal-btn-icon">↺</span> Reset all progress
            </div>
          </div>
        </div>

        <div class="modal-tab-content" id="gtab-share">
          <div class="modal-section">
            <div class="modal-section-title">Share Immune Quest</div>
            <div class="share-grid">
              <a class="modal-btn" onclick="gameShare('twitter')"><span class="modal-btn-icon">𝕏</span> X / Twitter</a>
              <a class="modal-btn" onclick="gameShare('whatsapp')"><span class="modal-btn-icon">💬</span> WhatsApp</a>
              <a class="modal-btn" onclick="gameShare('email')"><span class="modal-btn-icon">✉</span> Email</a>
              <a class="modal-btn" onclick="gameShare('copy')"><span class="modal-btn-icon">🔗</span> <span id="game-copy-label">Copy link</span></a>
            </div>
          </div>
        </div>

        <div class="modal-tab-content" id="gtab-feedback">
          <div class="modal-section">
            <div class="modal-section-title">Send feedback</div>
            <div class="feedback-rating-row" style="margin-top:0.375rem;">
              <span class="feedback-rating-label">Rate Immune Quest (optional)</span>
              <div class="star-rating" id="game-feedback-rating" data-value="0">
                <span class="star" data-value="1">★</span>
                <span class="star" data-value="2">★</span>
                <span class="star" data-value="3">★</span>
                <span class="star" data-value="4">★</span>
                <span class="star" data-value="5">★</span>
              </div>
            </div>
            <textarea class="feedback-area" id="game-feedback-text" placeholder="Tell us what you think, report a bug, or suggest a new feature..." style="margin-top:0.625rem;"></textarea>
            <button class="feedback-submit" onclick="gameSubmitFeedback()">Send →</button>
            <div id="game-feedback-confirm" style="font-size:0.75rem;color:var(--accent3);display:none;">✓ Thanks for your feedback!</div>
          </div>
        </div>

      </div>
    </div>
  `;

  const toggleEl = document.getElementById('game-toggle-tracking');
  if (toggleEl) toggleEl.checked = localStorage.getItem('iq_no_track') !== '1';

  const soundToggleEl = document.getElementById('game-toggle-sound');
  if (soundToggleEl) soundToggleEl.checked = localStorage.getItem('iq_sound_muted') !== '1';

  setupStarRating('game-feedback-rating');
}

// Star rating (plain spans; the chosen value is in data-value). Used by
// both the platform's feedback tab and the games' menus.
function paintStarRating(containerId, value) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.star').forEach(s => s.classList.toggle('filled', +s.dataset.value <= value));
}
function setupStarRating(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.star').forEach(s => {
    s.onclick = () => { container.dataset.value = s.dataset.value; paintStarRating(containerId, +s.dataset.value); };
    s.onmouseenter = () => paintStarRating(containerId, +s.dataset.value);
  });
  container.onmouseleave = () => paintStarRating(containerId, +container.dataset.value);
}

function switchGameTab(name) {
  const names = ['about', 'settings', 'share', 'feedback'];
  document.querySelectorAll('#menu-modal .modal-tab').forEach((t, i) => {
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('#menu-modal .modal-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('gtab-' + name)?.classList.add('active');
}

// Settings/Share/Feedback: embedded, passed to the platform page
// (iq_set_tracking / iq_reset_progress / iq_share / iq_submit_feedback);
// standalone, done here.
function gameSetTracking(on) {
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_set_tracking', on }, '*');
  } else {
    localStorage.setItem('iq_no_track', on ? '0' : '1');
  }
}

// Sound on/off — the setting is shared localStorage, read by every game.
function gameSetSound(on) {
  localStorage.setItem('iq_sound_muted', on ? '0' : '1');
}

function gameResetProgress() {
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_reset_progress' }, '*');
    return;
  }
  Object.keys(localStorage).filter(k => k.startsWith('iq_')).forEach(k => localStorage.removeItem(k));
  location.reload();
}

function gameShare(kind) {
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_share', kind }, '*');
    return;
  }
  const url = encodeURIComponent(location.href);
  if (kind === 'twitter') window.open('https://twitter.com/intent/tweet?text=Can+you+stop+the+spread%3F+Play+Immune+Quest+%E2%80%94+a+free+educational+game+about+viruses%2C+bacteria+%26+the+immune+system!&url=' + url, '_blank');
  else if (kind === 'whatsapp') window.open('https://wa.me/?text=Can+you+stop+the+spread%3F+Play+Immune+Quest+%E2%80%94+' + url, '_blank');
  else if (kind === 'email') location.href = 'mailto:?subject=Immune+Quest&body=Can+you+stop+the+spread%3F+Play+this+free+educational+game+about+viruses+and+the+immune+system%3A+' + url;
  else if (kind === 'copy') {
    navigator.clipboard.writeText(location.href).then(() => gameShareDone('copy'));
  }
}

// Confirms a share in this page's UI (e.g. "Copied!"), since the
// clipboard write happened on the platform page.
function gameShareDone(kind) {
  if (kind === 'copy') {
    const label = document.getElementById('game-copy-label');
    if (label) { label.textContent = 'Copied!'; setTimeout(() => label.textContent = 'Copy link', 2000); }
  }
}

// Feedback: embedded games pass it to the platform's submitFeedback();
// standalone pages post straight to the same anonymous Google Apps Script
// endpoint (setup: feedback-apps-script/README.md).
const GAME_FEEDBACK_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwBJVOQ3tAi_5TDrMexUD_KIYuj2MDPN5jLyXPlwukk_SEzGnINQVTPCX-a8geL6Cr9/exec';

function gameSubmitFeedback() {
  const textEl = document.getElementById('game-feedback-text');
  const text = textEl?.value.trim();
  const ratingEl = document.getElementById('game-feedback-rating');
  const rating = parseInt(ratingEl?.dataset.value || '0', 10);
  if (!text && !rating) return;
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_submit_feedback', text, rating }, '*');
  } else {
    // no-cors + plain-text body = a CORS "simple request" (no preflight).
    fetch(GAME_FEEDBACK_ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({ rating, text }),
    }).catch(() => {});
  }
  textEl.value = '';
  if (ratingEl) { ratingEl.dataset.value = '0'; paintStarRating('game-feedback-rating', 0); }
  const confirmEl = document.getElementById('game-feedback-confirm');
  if (confirmEl) confirmEl.style.display = 'block';
}

if (window.self !== window.top) {
  window.addEventListener('message', (e) => {
    if (isFromPlatform(e) && e.data && e.data.type === 'iq_share_done') gameShareDone(e.data.kind);
  });
}

// ════════════════════════════════════════════════════════════════════════════════
//  6. UTILITY
// ════════════════════════════════════════════════════════════════════════════════
function ensureSharedStyles() {
  if(document.getElementById('shared-ui-styles')) return;
  // Skip if the page already links ui.css itself (its own overrides come
  // after it; injecting another copy would undo them).
  const alreadyLinked = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some(l => (l.getAttribute('href') || '').includes('ui.css'));
  if(alreadyLinked) return;

  const styleLink = document.createElement('link');
  styleLink.id = 'shared-ui-styles';
  styleLink.rel = 'stylesheet';
  styleLink.href = '../shared/ui.css';
  document.head.appendChild(styleLink);
}

ensureSharedStyles();
