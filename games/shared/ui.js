// ════════════════════════════════════════════════════════════════════════════════
//  SHARED UI SYSTEM — Header, Footer, Menu
//  Each game page sets a CONFIG object before including this file
// ════════════════════════════════════════════════════════════════════════════════

// Set by renderHeader() from config.fullscreenIconOnly, read back by
// setFullscreenButtonLabel() so a later fullscreen-state toggle keeps
// rendering the same icon-only/labelled form the button was created with.
let _fullscreenIconOnly = false;

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
  // Drops the "FULLSCREEN"/"EXIT FULLSCREEN" label, leaving just the icon
  // — opt-in per game rather than the default, since the label is the only
  // thing making that button's purpose obvious on games that don't already
  // have an icon-heavy header.
  fullscreenIconOnly: false,
  menuType: 'full', // 'full' for main hub, 'simple' for games
  
  // Menu items (only for simple menu in games)
  menuItems: [
    { label: '← BACK TO HUB', href: '../../index.html' }
  ]
};

// Merge user config with defaults
function initUI(userConfig) {
  const CONFIG = { ...DEFAULT_CONFIG, ...userConfig };
  
  renderHeader(CONFIG);
  renderFooter(CONFIG);
  
  if(CONFIG.menuType === 'full') {
    setupFullMenu();
  } else {
    setupSimpleMenu(CONFIG);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  HEADER
// ════════════════════════════════════════════════════════════════════════════════
function renderHeader(config) {
  const embedded = window.self !== window.top;

  // When this game is loaded inside the platform's game modal (iframe), by
  // default that modal already shows its own IMMUNEQUEST branding +
  // Fullscreen/Exit bar — rendering a second bar here would just duplicate
  // it. A game can opt out of this suppression (showHeaderWhenEmbedded) to
  // show its own branded header instead of the generic hub bar; the hub
  // hides its bar for exactly those games (see OWN_HEADER_GAMES).
  if (embedded && !config.showHeaderWhenEmbedded) return;

  const headerOuter = document.querySelector('.header-outer') || createHeaderOuter();

  let logoWrapContent = '';
  if(config.showBackLink) {
    // Embedded: a real navigation would just navigate the iframe itself
    // rather than closing the platform's game modal, so ask the parent to
    // close it instead. Standalone: normal link.
    const backLinkAttrs = embedded
      ? `href="javascript:void(0)" onclick="exitEmbeddedGame()"`
      : `href="${config.backLinkHref}"`;
    // Icon (the leading arrow) is split into its own span from the label
    // text so a page can bump just the icon's size (see .hdr-icon) without
    // also growing the text next to it — config.backLinkText ships as
    // "← LABEL", split on the first space.
    const backLinkSpace = config.backLinkText.indexOf(' ');
    const backLinkIcon = backLinkSpace === -1 ? config.backLinkText : config.backLinkText.slice(0, backLinkSpace);
    const backLinkLabel = backLinkSpace === -1 ? '' : config.backLinkText.slice(backLinkSpace + 1);
    logoWrapContent = `<a class="back-link" ${backLinkAttrs}><span class="hdr-icon">${backLinkIcon}</span> ${backLinkLabel}</a>
      <div style="width:1px; height:20px; background:var(--border);"></div>`;
  }

  const logoHtml = config.gameLogo
    .replace(/\n/g, '')
    .replace(/<span>/g, `<span style="color: ${config.gameLogoSpanColor};">`)
    .replace(/<\/span>/g, '</span>');

  let headerRightContent = '';
  if(config.showHelpButton) {
    headerRightContent += `<button class="help-btn" id="help-trigger" onclick="openHelp && openHelp()" title="Tutorial">?</button>`;
  }
  if(config.showMenuButton) {
    headerRightContent += `<button class="menu-btn" id="menu-trigger" onclick="openMenu()"><span class="hdr-icon">☰</span> MENU</button>`;
  }
  if(config.showFullscreenButton) {
    // Remembered so setFullscreenButtonLabel() (called later, on actual
    // fullscreen state changes) keeps rendering the same icon-only/labelled
    // form instead of resetting back to the labelled default.
    _fullscreenIconOnly = !!config.fullscreenIconOnly;
    headerRightContent += _fullscreenIconOnly
      ? `<button class="menu-btn icon-only" id="fullscreen-trigger" onclick="toggleGameFullscreen()" title="Fullscreen"><span class="hdr-icon">⛶</span></button>`
      : `<button class="menu-btn" id="fullscreen-trigger" onclick="toggleGameFullscreen()" title="Fullscreen"><span class="hdr-icon">⛶</span> FULLSCREEN</button>`;
  }

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

// Fullscreen target lives in the parent document (the hub's modal wrapper),
// so an embedded game asks the hub to toggle it rather than requesting
// fullscreen on its own (much smaller) iframe document. Standalone, there's
// no parent to ask — toggle fullscreen on this page directly.
function toggleGameFullscreen() {
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_toggle_fullscreen' }, '*');
    return;
  }
  if (document.fullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  } else {
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el).catch(() => {});
  }
}

// Keeps the header's Fullscreen button reading "Maximise"/"Minimise" to
// match its actual state. Embedded, the fullscreen target is the hub's
// modal wrapper (not this page), so the hub broadcasts state changes via
// postMessage (iq_fullscreen_state) rather than this page checking its own
// (meaningless, since it's just the iframe) document.fullscreenElement.
function setFullscreenButtonLabel(isFullscreen) {
  const btn = document.getElementById('fullscreen-trigger');
  if (!btn) return;
  const icon = isFullscreen ? '⤢' : '⛶';
  btn.innerHTML = _fullscreenIconOnly
    ? `<span class="hdr-icon">${icon}</span>`
    : `<span class="hdr-icon">${icon}</span> ${isFullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}`;
}

if (window.self !== window.top) {
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'iq_fullscreen_state') {
      setFullscreenButtonLabel(!!e.data.isFullscreen);
    }
  });
} else {
  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
    .forEach(evt => document.addEventListener(evt, () => setFullscreenButtonLabel(!!document.fullscreenElement)));
}

// ════════════════════════════════════════════════════════════════════════════════
//  FOOTER
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
//  MENU — FULL (for main hub, uses existing modal in page HTML)
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

function openMenu() {
  const modal = document.getElementById('menu-modal');
  if(modal) {
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
//  MENU — SIMPLE (for game pages) — tabbed, matching the main hub's own
//  menu: a game-specific landing tab (quick actions), then the same
//  About/Settings/Share/Feedback tabs the hub offers. Content here mirrors
//  the hub's tabs so it reads identically; actions (share, feedback,
//  settings) delegate to the hub via postMessage when embedded, since
//  those need the hub's own URL/context to be correct (e.g. sharing the
//  hub link, not this game's iframe URL) — see gameShare() etc. below.
// ════════════════════════════════════════════════════════════════════════════════
function setupSimpleMenu(config) {
  let modal = document.getElementById('menu-modal');
  if(!modal) {
    modal = document.createElement('div');
    modal.id = 'menu-modal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }

  const embedded = window.self !== window.top;
  // Every landing button carries its own icon span now (font-size set by
  // .menu-item-icon, ui.css) instead of a same-size character inline with
  // the label text — lets the icon read bigger without also blowing up
  // the label's own font size.
  let landingHtml = '';
  if(config.showHelpButton) {
    landingHtml += `<button class="menu-item" onclick="openHelp && openHelp(); closeMenu();"><span class="menu-item-icon">?</span> Tutorial</button>`;
  }
  if(config.showFullscreenButton) {
    landingHtml += `<button class="menu-item" onclick="toggleGameFullscreen()"><span class="menu-item-icon">⛶</span> Fullscreen</button>`;
  }
  // Not every game defines a restart/exit-to-select flow — only offer it
  // for ones that do (currently exitMission(), from stealth's game-ui.js).
  if(typeof exitMission === 'function') {
    landingHtml += `<button class="menu-item" onclick="exitMission(); closeMenu();"><span class="menu-item-icon">↺</span> Restart</button>`;
  }
  if(config.showBackLink) {
    const backAction = embedded ? 'exitEmbeddedGame()' : `window.location.href='${config.backLinkHref}'`;
    landingHtml += `<button class="menu-item" onclick="${backAction}"><span class="menu-item-icon">←</span> Back to Patient</button>`;
  }

  const landingLabel = (config.gameTitle || 'Game').split(' ')[0];

  modal.innerHTML = `
    <div class="modal" style="max-width:640px;">
      <div class="modal-header">
        <div class="modal-title">Menu</div>
        <button class="modal-close" onclick="closeMenu()">✕</button>
      </div>
      <div class="modal-tabs">
        <div class="modal-tab active" onclick="switchGameTab('landing')">${landingLabel}</div>
        <div class="modal-tab" onclick="switchGameTab('settings')">Settings</div>
        <div class="modal-tab" onclick="switchGameTab('about')">About</div>
        <div class="modal-tab" onclick="switchGameTab('share')">Share</div>
        <div class="modal-tab" onclick="switchGameTab('feedback')">Feedback</div>
      </div>
      <div class="modal-body">

        <div class="modal-tab-content active" id="gtab-landing">
          <div class="menu-modal-body" style="padding:0;">${landingHtml}</div>
        </div>

        <div class="modal-tab-content" id="gtab-about">
          <div class="modal-section">
            <div class="modal-section-title">About</div>
            <div class="about-text">
              <strong style="color:var(--text)">Immune Quest</strong> is a free educational game platform designed to empower young people with trustworthy knowledge about infections, the immune system, vaccines, and treatments.<br><br>
              <span style="color:var(--muted)">Version 1.0 © 2026<br> Developed by Arwen Altenburg with Claude (Sonnet 4.6, 5) & Google Gemini.</span>
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
            <div style="font-size:11px; color:var(--muted); line-height:1.5; margin-top:8px;">
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
            <div class="feedback-rating-row" style="margin-top:6px;">
              <span class="feedback-rating-label">Rate Immune Quest (optional)</span>
              <div class="star-rating" id="game-feedback-rating" data-value="0">
                <span class="star" data-value="1">★</span>
                <span class="star" data-value="2">★</span>
                <span class="star" data-value="3">★</span>
                <span class="star" data-value="4">★</span>
                <span class="star" data-value="5">★</span>
              </div>
            </div>
            <textarea class="feedback-area" id="game-feedback-text" placeholder="Tell us what you think, report a bug, or suggest a new feature..." style="margin-top:10px;"></textarea>
            <button class="feedback-submit" onclick="gameSubmitFeedback()">Send →</button>
            <div id="game-feedback-confirm" style="font-size:10px;color:var(--accent3);display:none;">✓ Thanks for your feedback!</div>
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

// Star rating — plain click/hover-painted spans, own copy of the same pair
// of functions index.html defines for its own feedback tab (small enough,
// and different enough in ID, that sharing one implementation across the
// two separate menu systems wasn't worth the indirection).
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
  const names = ['landing', 'settings', 'about', 'share', 'feedback'];
  document.querySelectorAll('#menu-modal .modal-tab').forEach((t, i) => {
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('#menu-modal .modal-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('gtab-' + name)?.classList.add('active');
}

// Settings/Share/Feedback actions delegate to the hub when embedded, since
// they need the hub's own URL/DOM (e.g. sharing the hub link, not this
// game's iframe URL) — see the iq_set_tracking/iq_reset_progress/iq_share/
// iq_submit_feedback handlers in the hub's own postMessage listener.
// Standalone, there's no parent to delegate to, so fall back to acting on
// this page directly.
function gameSetTracking(on) {
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_set_tracking', on }, '*');
  } else {
    localStorage.setItem('iq_no_track', on ? '0' : '1');
  }
}

// Purely a local playback preference (unlike tracking above) — localStorage
// is already shared between the hub and a same-origin game iframe, so there
// is no cross-page state to delegate to a parent for; every game just reads
// this key directly before playing a sound.
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

// Confirms a share action back in this page's own UI — mainly for "copy
// link", where the label needs to flip to "Copied!" even though the
// clipboard write happened on the hub's document, not this one.
function gameShareDone(kind) {
  if (kind === 'copy') {
    const label = document.getElementById('game-copy-label');
    if (label) { label.textContent = 'Copied!'; setTimeout(() => label.textContent = 'Copy link', 2000); }
  }
}

// Same anonymous Cloudflare Worker + Google Sheet index.html's own
// submitFeedback() posts to — see feedback-worker/README.md at the repo
// root for setup. Only reachable from here when the game is opened
// standalone (window.self === window.top); embedded (the normal case,
// launched from the hub) relays through the hub's OWN submitFeedback()
// instead, via postMessage below, so every game funnels through that one
// Worker call rather than each needing its own copy of the endpoint URL.
const GAME_FEEDBACK_ENDPOINT = 'https://immune-quest-feedback.YOUR-SUBDOMAIN.workers.dev';

function gameSubmitFeedback() {
  const textEl = document.getElementById('game-feedback-text');
  const text = textEl?.value.trim();
  const ratingEl = document.getElementById('game-feedback-rating');
  const rating = parseInt(ratingEl?.dataset.value || '0', 10);
  if (!text && !rating) return;
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'iq_submit_feedback', text, rating }, '*');
  } else {
    fetch(GAME_FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    if (e.data && e.data.type === 'iq_share_done') gameShareDone(e.data.kind);
  });
}

// ════════════════════════════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════════════════════════════
function ensureSharedStyles() {
  if(document.getElementById('shared-ui-styles')) return;
  // Some games (e.g. stealth) link ui.css directly in <head> so their own
  // local :root overrides — loaded after it — win the cascade. Appending a
  // second copy here would land after those overrides and silently undo
  // them, so skip injection when a ui.css link already exists.
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
