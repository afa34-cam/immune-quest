// ═══════════════════════════════════════════════════════════════════
//  IMMUNE QUEST — Stealth Mission
//  tutorial.js — the practice mission's guide, Spike the Virion: what
//  Spike says at each moment, the on-screen highlights, and which moves
//  the player may make. The scripted game itself (board, immune cards,
//  offers, the player's moves) is in tutorial-game.js.
//
//  How it hooks into the game (game-ui.js calls these while
//  activeTutorial is set):
//    runBeat(key, cont)  — before/after each automatic phase and when
//                          Pick Cards opens: Spike talks, then cont()
//    allows(kind, …)     — every click that changes the game asks first;
//                          only the scripted move is allowed
//    actionDone(kind)    — a scripted move was made: next step
//    refreshHighlights() — after anything is redrawn
//    onGameOver(state)   — the end screen
//
//  Contents
//    1. Spike (SVG character)
//    2. The script — what Spike says, when
//    3. Starting & leaving the tutorial
//    4. TutorialGuide — steps, highlights and move checks
// ═══════════════════════════════════════════════════════════════════


// ═══ 1. Spike (SVG character) ══════════════════════════════════════
// A round virion with spike proteins. Moods: happy, excited, worried,
// wink, thinking, evil (sly grin) and ninja (mask and headband — also
// the virus banner's picture during the mission). Gradient ids get a unique suffix per drawing
// (a gradient inside a hidden SVG wouldn't render for the others).
let _spikeSvgCount = 0;

function spikeSvg(mood = 'happy') {
  const id = `spk${++_spikeSvgCount}`;
  const ink = '#2a0f4d';
  const spikes = Array.from({ length: 10 }, (_, i) =>
    `<g transform="rotate(${i * 36} 60 60)"><rect x="57.5" y="15" width="5" height="14" rx="2" fill="#7d3fd6"/>` +
    `<circle cx="60" cy="14" r="6.5" fill="url(#${id}k)" stroke="#4a1a8a" stroke-width="1.5"/></g>`).join('');
  const openEye = (cx, look = [1, 2]) =>
    `<g class="spk-eye"><ellipse cx="${cx}" cy="57" rx="8.5" ry="10" fill="#fff"/>` +
    `<circle cx="${cx + look[0]}" cy="${57 + look[1]}" r="4.6" fill="${ink}"/>` +
    `<circle cx="${cx + look[0] + 2}" cy="${57 + look[1] - 2.5}" r="1.6" fill="#fff"/></g>`;
  const line = d => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;

  const faces = {
    happy:   openEye(47) + openEye(73) + line('M49 72 Q60 82 71 72'),
    excited: openEye(47, [0, 1]) + openEye(73, [0, 1]) +
             `<path d="M48 70 Q60 91 72 70 Z" fill="${ink}"/><path d="M54 80 Q60 87 66 80 Z" fill="#ff7eb6"/>`,
    worried: openEye(47, [0, 3]) + openEye(73, [0, 3]) + line('M50 78 Q60 71 70 78') +
             line('M38 44 L52 48') + line('M82 44 L68 48'),
    wink:    line('M40 59 Q47 52 54 59') + openEye(73) + line('M49 72 Q61 82 72 70'),
    thinking: openEye(47, [2, -2]) + openEye(73, [2, -2]) + line('M52 77 L68 75') + line('M66 43 Q73 38 80 43'),
    // Narrowed eyes under sharp brows, wide sneaky grin.
    evil: `<path d="M38 55 Q47 50 55 56 Q47 63 38 58 Z" fill="#fff"/><circle cx="48" cy="57" r="3.4" fill="${ink}"/>` +
          `<path d="M65 56 Q73 50 82 55 Q81 61 65 58 Z" fill="#fff"/><circle cx="72" cy="57" r="3.4" fill="${ink}"/>` +
          line('M36 46 L54 51') + line('M84 46 L66 51') + line('M46 71 Q61 84 76 70'),
    // Mask band across the eyes (clipped to the body), headband knot and
    // tails on the right, one wide eye and one narrowed, sly grin.
    ninja: `<g clip-path="url(#${id}c)"><path d="M24 45 Q60 37 96 45 L96 67 Q60 61 24 67 Z" fill="#1a0b2e"/>` +
           `<path d="M24 41 Q60 33 96 41 L96 46 Q60 38 24 46 Z" fill="#ff3b6b"/></g>` +
           `<path d="M92 43 Q106 34 116 38 Q106 41 99 46 Q110 46 117 54 Q104 52 93 47 Z" fill="#ff3b6b" stroke="#8a1236" stroke-width="1"/>` +
           `<circle cx="93" cy="44" r="3.4" fill="#ff3b6b" stroke="#8a1236" stroke-width="1"/>` +
           `<ellipse cx="46" cy="56" rx="7.5" ry="7" fill="#fff"/><circle cx="47" cy="56.5" r="3.6" fill="${ink}"/><circle cx="48.5" cy="55" r="1.2" fill="#fff"/>` +
           `<path d="M66 57 Q73 52 80 55 Q74 60 66 57 Z" fill="#fff"/><circle cx="73" cy="56.2" r="2.3" fill="${ink}"/>` +
           `<path d="M37 49 L54 52.5" stroke="#ff3b6b" stroke-width="2.8" stroke-linecap="round"/><path d="M83 48.5 L66 52.5" stroke="#ff3b6b" stroke-width="2.8" stroke-linecap="round"/>` +
           line('M47 75 Q62 84 75 71'),
  };

  return `<svg class="spike-svg" viewBox="0 0 120 120" aria-hidden="true">
    <defs>
      <radialGradient id="${id}b" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#e6c8ff"/><stop offset=".55" stop-color="#a45cf2"/><stop offset="1" stop-color="#6a2bc4"/></radialGradient>
      <radialGradient id="${id}k" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#ffd3e8"/><stop offset="1" stop-color="#ff5fa2"/></radialGradient>
      <clipPath id="${id}c"><circle cx="60" cy="60" r="34"/></clipPath>
    </defs>
    <g class="spk-spikes">${spikes}</g>
    <circle cx="60" cy="60" r="34" fill="url(#${id}b)" stroke="#4a1a8a" stroke-width="2.5"/>
    <circle cx="42" cy="40" r="3.2" fill="#fff" opacity=".35"/><circle cx="80" cy="82" r="2.4" fill="#fff" opacity=".2"/>
    ${mood === 'ninja' ? '' : '<ellipse cx="37" cy="70" rx="5" ry="3" fill="#ff7eb6" opacity=".55"/><ellipse cx="83" cy="70" rx="5" ry="3" fill="#ff7eb6" opacity=".55"/>'}
    ${faces[mood] || faces.happy}
  </svg>`;
}

// The same drawing as an image URL (for <img>, e.g. the virus panel).
function spikeImageUrl(mood = 'happy') {
  return 'data:image/svg+xml,' + encodeURIComponent(spikeSvg(mood).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
}


// ═══ 2. The script ═════════════════════════════════════════════════
// Beats are keyed by "turn:phase:start|end" (around each automatic
// phase), "turn:cards" (from Pick Cards to End Turn) and "end" (the end
// screen). Each step:
//   text  — what Spike says (HTML)
//   bio   — optional "Real biology" note
//   mood  — happy | excited | worried | wink | thinking | evil | ninja
//   hl    — what to highlight (see _resolveHighlight())
//   next  — label of the button that continues (default "Next")
//   act   — wait for the turn's next scripted move (tutorial-game.js)
//           instead of a button; Spike adds what to select.
const TUTORIAL_BEATS = {
  '1:virus_growth:start': [
    { mood: 'ninja', text: 'Hi, I’m <b>Spike</b>! In this practice mission you play as me as we try to sneak past the immune system.',
      bio: 'One virus particle is called a <b>virion</b>. The points on my surface are <b>spike proteins</b>. Real viruses such as flu and SARS-CoV-2 have them too and use them to get into cells.' },
    { text: 'These are three organs of the body: the <b>liver</b>, <b>lung</b> and <b>intestine</b>. Every square is a cell.', hl: ['#boards-wrap'],
      bio: 'A virus can’t copy itself. It has to get inside a living cell and use the cell’s machinery to make new virus particles.' },
    { mood: 'thinking', text: 'Our mission: infect one cell in the <b>bottom row</b> of any organ. I lose if the immune system clears all my infected cells, or boxes me in so I can’t spread.',
      hl: [{ row: ['lung', 9] }, { row: ['liver', 9] }, { row: ['intestine', 9] }] },
    { mood: 'evil', text: 'For now I can only infect the lung. That’s my <b>tropism</b>: the tissues a virus can infect. Grey tissues are off-limits… for now!',
      hl: [{ board: 'lung' }, { card: 'lung-tropism', in: '#virus-banner-top' }],
      bio: 'Spike proteins work like keys. A virus can only get into cells that have the matching lock (a <b>receptor</b>) on their surface.' },
    { mood: 'excited', text: 'This is me. <b>Replication speed</b> is how fast I copy myself: the higher it is, the more I spread each turn. <b>Mutation rate</b> is how often changes are made when I copy myself.',
      hl: ['#virus-info-panel'] },
    { mood: 'thinking', text: 'Every turn has five steps. The first three happen by themselves: <b>Virus Spread</b>, <b>Immune Response</b> and <b>Mutation</b>. Then it’s your turn to <b>Pick Cards</b> and <b>Play Cards</b>.',
      hl: ['#phase-col'] },
    { mood: 'happy', text: 'Everything that happens is written in the <b>mission log</b>. Select it to open or close it. Ready? Watch me spread!',
      hl: ['#narration-col'], next: 'Start' },
  ],
  '1:virus_growth:end': [
    { mood: 'ninja', text: 'That’s <b>Virus Spread</b>: my infected cells infect healthy cells below and beside them. Spreading down is most likely, and down is where the bottom row is!' },
  ],
  '1:immune_response:start': [
    { mood: 'worried', text: 'Uh-oh, the immune system has noticed me. The cards it plays appear in the <b>Immune System</b> banner.', hl: ['#immune-banner'] },
  ],
  '1:immune_response:end': [
    { mood: 'thinking', text: '<b>NK Cell</b> cleared one of my infected cells.', hl: [{ card: 'immune-nkcell', in: '#immune-banner' }],
      bio: '<b>Natural Killer (NK) cells</b> are part of the body’s first-response team. They destroy cells that look stressed or infected.' },
    { mood: 'worried', text: '<b>Cytokines</b> shields healthy cells so I can’t infect them for a few turns. <b>Blue</b> shields 1 cell, <b>Orange</b> a cross of 5 and <b>Red</b> a block of 9.',
      hl: [{ card: 'immune-cytokine-blue', in: '#immune-banner' }, { cells: ['lung', 'cytokine-blue'] }],
      bio: '<b>Cytokines</b> are messengers and chemical alarm signals. Infected cells release them to warn their neighbours and call in immune cells.' },
    { mood: 'wink', text: 'Tip: select <b>ⓘ</b> on any card to read what it does and the real biology behind it.' },
  ],
  '1:mutation:end': [
    { mood: 'thinking', text: '<b>Mutation</b>: each time I copy myself, mistakes creep into my genes (blueprint for how to copy). Some help me, some don’t. No mutation this time.',
      hl: [{ phase: 'mutation' }],
      bio: 'Viruses with genes made of RNA, like influenza virus, make lots of copying mistakes, so they mutate quickly. Other viruses, particularly if they have genes made of DNA, have proofreading to reduce these mistakes.' },
  ],
  '1:cards': [
    { mood: 'excited', act: true, text: 'Your turn! You’re offered 3 cards and keep 2. Let’s pick <b>Vertical Spread</b> and <b>Horizontal Spread</b>.' },
    { text: 'The cards you keep go into your hand, down here.', hl: ['#hand-panel'] },
    { act: true, mood: 'ninja', text: 'Play <b>Vertical Spread</b>. It infects a healthy cell right below one of my infected cells.' },
    { act: true, mood: 'wink', text: 'Nice! You don’t have to play every card. Keep Horizontal Spread for later.' },
  ],
  '2:immune_response:end': [
    { mood: 'worried', text: '<b>Antibody</b> shields a whole row of cells, and it doesn’t wear off!',
      hl: [{ card: 'immune-antibody-lung', in: '#immune-banner' }, { cells: ['lung', 'state-immune:not(.cytokine-blue):not(.cytokine-orange):not(.cytokine-red)'] }],
      bio: '<b>Antibodies</b> are Y-shaped proteins made by B cells. They stick to a virus’s surface proteins and stop it getting into cells.' },
    { mood: 'thinking', text: 'And an <b>Orange Cytokine</b>: a cross of 5 shielded cells.', hl: [{ cells: ['lung', 'cytokine-orange'] }] },
  ],
  '2:mutation:end': [
    { mood: 'excited', text: 'A lucky mutation! I gained <b>Tropism</b> for the liver, so now I can infect it too.', hl: [{ board: 'liver' }],
      bio: 'A small change in a spike protein (key) can let a virus fit a new receptor (lock), so it can infect new kinds of cells.' },
  ],
  '2:cards': [
    { act: true, text: 'Keep <b>Antibody Escape: Lung</b> and <b>Replication Boost</b>.' },
    { act: true, mood: 'evil', text: 'That antibody row is in my way! <b>Antibody Escape: Lung</b> removes every antibody in the lung.',
      bio: 'By changing the shape of its surface proteins, a virus can stop antibodies from recognising it. Influenza virus does this so often that the flu vaccine is updated every year.' },
    { act: true, mood: 'excited', text: '<b>Replication Boost</b> adds +1 to my replication speed for the next Virus Spread. Watch the speed go up.',
      bio: 'Copying faster makes more virus, but also more copying mistakes (mutations).' },
    { act: true, text: 'Keep Horizontal Spread for later.' },
  ],
  '3:virus_growth:end': [
    { mood: 'excited', text: 'The boost helped me spread two rows further!' },
  ],
  '3:immune_response:end': [
    { mood: 'worried', text: 'Ouch! A <b>T Cell</b> cleared a whole row of my infected cells.', hl: [{ card: 'immune-tcell-lung', in: '#immune-banner' }],
      bio: 'Cells show bits of the proteins inside them on their surface, on molecules called <b>MHC class I</b>. <b>T cells</b> check these and destroy cells that show signs of a virus.' },
    { mood: 'worried', text: '<b>Antiviral</b> lowered my replication speed by 1. For good!', hl: [{ card: 'immune-antiviral', in: '#immune-banner' }, '#virus-info-panel-speed'],
      bio: 'Antiviral medicines block a step a virus needs to copy itself, so the infection spreads more slowly or not at all.' },
  ],
  '3:mutation:end': [
    { mood: 'excited', text: 'Another mutation: I gained a <b>Cytokine Neutralisation (Orange)</b> card. It went straight into my hand.' },
  ],
  '3:cards': [
    { act: true, text: 'Keep <b>T-Cell Evasion: Lung</b> and <b>Latency</b>.' },
    { act: true, mood: 'ninja', text: 'Let’s get rid of that orange shield. <b>Cytokine Neutralisation (Orange)</b> removes a whole orange block.',
      bio: 'Some viruses make proteins that mop up cytokines, so the alarm signal never reaches the neighbouring cells.' },
    { act: true, mood: 'thinking', text: 'T cells could be back. <b>T-Cell Evasion: Lung</b> cancels the next T Cell the immune system plays in the lung.',
      bio: 'Some viruses hide the MHC class I “windows” on infected cells, so T cells can’t see that the cell is infected.' },
    { act: true, text: 'Keep Latency for next turn.' },
  ],
  '4:immune_response:end': [
    { mood: 'ninja', text: 'See? The immune system tried a T Cell in the lung, but my T-Cell Evasion cancelled it! The immune system played a <b>Red Cytokine</b>: a block of 9.',
      hl: [{ cells: ['lung', 'cytokine-red'] }] },
  ],
  '4:mutation:end': [
    { mood: 'excited', text: 'My replication speed went up by 1. Not every mutation is good, though: I could also lose speed, cards or even a tissue tropism.', hl: ['#virus-info-panel-speed'] },
  ],
  '4:cards': [
    { act: true, text: 'Keep <b>Activate Tregs</b> and <b>Vertical Spread</b>.' },
    { act: true, mood: 'evil', text: '<b>Latency</b> hides a sleeping (dormant) virus in a cell. The immune system can’t see it. Two turns later it wakes up and becomes infected.',
      bio: 'Some viruses, like herpes viruses, can hide quietly inside cells for months or even years and wake up later.' },
    { act: true, text: '<b>Horizontal Spread</b> infects a healthy cell next to one of my infected cells. Let’s use it in the liver.' },
    { act: true, mood: 'evil', text: '<b>Activate Tregs</b>: next turn the immune system can play only 1 card.',
      bio: '<b>Regulatory T cells (Tregs)</b> are the immune system’s brakes. They stop it overreacting. Some viruses press that brake to weaken the attack.' },
    { act: true, text: 'Done for this turn.' },
  ],
  '5:virus_growth:end': [
    { mood: 'ninja', text: '<b>Spillover!</b> The lung and liver sit side by side. Where my infection touches the edge, it can cross into the next tissue, if I have tropism for it.',
      hl: [{ cell: ['liver', 4, 4] }, { cell: ['lung', 0, 4] }] },
  ],
  '5:immune_response:end': [
    { mood: 'wink', text: 'Thanks to Tregs, the immune system could play only 1 card: a T Cell. The others had to wait, including <b>DNA/RNA Sensing</b>, which could have found my sleeping virus!' },
  ],
  '5:cards': [
    { act: true, text: 'Keep <b>Replication Boost</b> and <b>Horizontal Spread</b>.' },
    { act: true, mood: 'evil', text: 'Play <b>Vertical Spread</b> in the liver.' },
    { act: true, text: 'Keep the other two cards.' },
  ],
  '6:virus_growth:end': [
    { mood: 'ninja', text: 'My Latency cell woke up and is now infected, deep behind the immune system’s shields!', hl: [{ cell: ['lung', 1, 6] }] },
  ],
  '6:immune_response:end': [
    { mood: 'worried', text: '<b>Protein-based Vaccine</b>: my replication speed drops by 2 for 3 turns, and the immune system gets a free Antibody card for later.',
      hl: [{ card: 'vaccine-protein', in: '#immune-banner' }, '#virus-info-panel-speed'],
      bio: 'A protein vaccine contains a harmless piece of a virus’s protein. The immune system learns to recognise it so it is ready if the real virus turns up.' },
  ],
  '6:cards': [
    { act: true, text: 'Keep <b>Vertical Spread</b> and <b>Activate Tregs</b>.' },
    { act: true, mood: 'thinking', text: 'With 3 or more cards in hand you can trade 3 of them for 1 card of your choice. Let’s trade for another <b>Latency</b>.' },
    { act: true, text: 'Hide the new Latency in the lung.' },
    { act: true, text: 'Keep Vertical Spread for next turn.' },
  ],
  '7:immune_response:end': [
    { mood: 'worried', text: 'The immune system is going all out! <b>mRNA Vaccine</b> powers up T Cells and Cytokines for 3 turns. A powered-up T Cell clears 2 rows: it just did that in the liver.',
      hl: [{ card: 'vaccine-mrna', in: '#immune-banner' }],
      bio: 'An mRNA vaccine gives cells temporary instructions to make one harmless virus protein, which trains the immune system to recognise the real virus.' },
    { mood: 'thinking', text: 'The vaccine’s free <b>Antibody</b> shielded the bottom row of the lung.', hl: [{ row: ['lung', 9] }] },
    { mood: 'worried', text: 'And <b>DNA/RNA Sensing</b> found my hidden Latency cell and cleared it. Sleeping viruses aren’t always safe!',
      hl: [{ card: 'immune-sensing', in: '#immune-banner' }],
      bio: 'Cells have sensors that spot virus DNA or RNA in places it shouldn’t be, and raise the alarm.' },
  ],
  '7:cards': [
    { act: true, mood: 'ninja', text: 'One last push! Keep <b>Antibody Escape: Lung</b> and <b>Replication Boost</b>.' },
    { act: true, text: 'Break through that bottom-row antibody shield.' },
    { act: true, text: 'Boost my replication speed for the next spread.' },
    { act: true, text: 'And spread down in the lung.' },
    { act: true, text: 'No cards left, so the turn ends by itself. Fingers crossed!' },
  ],
  'end': [
    { mood: 'excited', text: 'We did it! I reached the bottom row. <b>Mission complete!</b>' },
    { mood: 'wink', text: 'You’ve now seen every card in the game. In a real mission the cards are random and the immune system plays to win. Choose a virus and try it for real. Good luck!', next: 'Finish' },
  ],
  // Only if something unexpected ends the practice early.
  'end-lost': [
    { mood: 'worried', text: 'Oh no, the immune system won this time! Select ‘Real Mission’ to choose a virus, or start the tutorial again from the select screen.', next: 'OK' },
  ],
};


// ═══ 3. Starting & leaving the tutorial ════════════════════════════
let activeTutorial = null;

// "Play the tutorial" on the select screen.
function startTutorial() {
  const base = TUTORIAL_LOADOUT_BASE;
  const loadout = {
    ...base,
    iconImg: spikeImageUrl('ninja'), // the virus banner gets ninja Spike
    deck: generateDeck(base.tissue, base.replication, base.mutation, base.abilities),
  };
  activeTutorial = new TutorialGuide();
  startMission({ loadout, tutorial: true });
}

// Called by exitMission() (game-ui.js).
function stopTutorial() {
  if (!activeTutorial) return;
  activeTutorial.destroy();
  activeTutorial = null;
}


// ═══ 4. TutorialGuide ══════════════════════════════════════════════
class TutorialGuide {
  constructor() {
    this.steps = null;      // current beat's steps
    this.index = 0;
    this.onBeatDone = null;
    this.doneBeats = new Set();
    this.actionIndex = 0;   // next scripted move of this turn
    this.actionTurn = 0;
    this._build();
  }

  // ── Coach panel ──
  _build() {
    const el = document.createElement('div');
    el.className = 'tut-coach';
    el.id = 'tut-coach';
    el.innerHTML = `
      <div class="tut-avatar" id="tut-avatar"></div>
      <div class="tut-bubble">
        <div class="tut-head"><span class="tut-name">Spike</span>
          <button class="tut-exit" onclick="leaveTutorial()" title="Leave the tutorial" aria-label="Leave the tutorial">✕</button></div>
        <div class="tut-text" id="tut-text"></div>
        <div class="tut-bio" id="tut-bio"></div>
        <div class="tut-todo" id="tut-todo"></div>
        <div class="tut-actions"><button class="tut-next" id="tut-next" onclick="activeTutorial && activeTutorial.next()">Next →</button></div>
        <div class="tut-leave"><span>Leave the tutorial?</span>
          <button class="tut-next" onclick="exitMission()">Leave</button>
          <button class="tut-next tut-stay" onclick="activeTutorial && activeTutorial.askLeave(false)">Stay</button></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    // One-off animations (the shake, the highlight flash) take their class
    // off when done; left on, they would replay every time Spike's panel
    // or a highlighted element is shown again.
    this._onAnimationEnd = e => {
      if (e.animationName === 'tut-shake') el.classList.remove('nudge');
      if (e.animationName === 'tut-hl-flash') e.target.classList.remove('tut-hl-flash');
    };
    document.addEventListener('animationend', this._onAnimationEnd);
    this._mood = null;
    this._setMood('happy');
    el.classList.add('hidden');
  }

  destroy() {
    document.removeEventListener('animationend', this._onAnimationEnd);
    this.el.remove();
    this._clearHighlights();
  }

  // Spike's ✕: ask (in the bubble) before leaving.
  askLeave(show = true) {
    this.el.classList.toggle('leaving', show);
  }

  _setMood(mood) {
    if (mood === this._mood) return;
    this._mood = mood;
    document.getElementById('tut-avatar').innerHTML = spikeSvg(mood);
  }

  // ── Beats ──
  runBeat(key, cont) {
    const steps = TUTORIAL_BEATS[key];
    if (!steps || this.doneBeats.has(key)) { cont(); return; }
    this.doneBeats.add(key);
    this.steps = steps;
    this.index = 0;
    this.onBeatDone = cont;
    this._show();
  }

  get step() { return this.steps ? this.steps[this.index] : null; }

  _show() {
    const step = this.step;
    if (!step) return;
    this._setMood(step.mood || 'happy');
    document.getElementById('tut-text').innerHTML = step.text;
    const bio = document.getElementById('tut-bio');
    bio.innerHTML = step.bio ? `<span class="tut-bio-label">Real biology</span>${step.bio}` : '';
    bio.style.display = step.bio ? '' : 'none';
    // Moves continue by themselves; everything else has a button.
    const nextBtn = document.getElementById('tut-next');
    nextBtn.parentElement.style.display = step.act ? 'none' : '';
    nextBtn.textContent = (step.next || 'Next') + ' →';
    this.el.classList.remove('hidden', 'leaving', 'nudge');
    // Replay the pop-in for each new step.
    this.el.classList.remove('pop'); void this.el.offsetWidth; this.el.classList.add('pop');
    this.refreshHighlights();
  }

  next() {
    if (!this.step || this.step.act) return;
    this._advance();
  }

  _advance() {
    this.index++;
    if (this.index < this.steps.length) { this._show(); return; }
    const cont = this.onBeatDone;
    this.steps = null;
    this.onBeatDone = null;
    this.el.classList.add('hidden');
    this._clearHighlights();
    if (cont) cont();
  }

  // ── Scripted moves ──
  // The move this turn's script expects now, if Spike is waiting for one.
  expected() {
    if (!this.step || !this.step.act || !activeGame) return null;
    if (this.actionTurn !== activeGame.turn) { this.actionTurn = activeGame.turn; this.actionIndex = 0; }
    return (TUTORIAL_TURNS[activeGame.turn]?.actions || [])[this.actionIndex] || null;
  }

  // Asked by game-ui.js before each move. A wrong move gives a nudge.
  allows(kind, detail) {
    const ok = this._allows(kind, detail);
    if (!ok) this.nudge();
    return ok;
  }

  _allows(kind, detail) {
    const a = this.expected();
    if (!a) return false;
    switch (kind) {
      case 'draftPick':    return !!a.pick && a.pick.includes(detail.id);
      case 'draftConfirm': return !!a.pick && [...a.pick].sort().join() === [...detail].sort().join();
      case 'selectCard':   return !!a.play && detail.id === a.play;
      case 'target': {
        if (!a.play || detail.tissue !== a.tissue) return false;
        if (a.block) return activeGame.boards[a.tissue].getCell(detail.col, detail.row)?.cytokineColor === a.block;
        if (a.col !== undefined) return detail.col === a.col && detail.row === a.row;
        return true;
      }
      case 'endTurn':      return !!a.end;
      case 'tradeOpen':    return !!a.trade;
      case 'tradeGive': {
        if (!a.trade) return false;
        // detail = the hand card; allowed while that card type still has
        // copies left to give.
        const wanted = a.trade.give.filter(id => id === detail.card.id).length;
        const chosen = tradeGiveSelected.filter(i => activeGame.hand[i].id === detail.card.id).length;
        return detail.selected || chosen < wanted;
      }
      case 'tradeReceive': return !!a.trade && detail === a.trade.receive;
      case 'tradeConfirm': return !!a.trade;
    }
    return false;
  }

  // The hand card to play when its highlighted target cell is clicked
  // without selecting the card first; null if that cell isn't the target.
  handIndexForTarget(tissue, col, row) {
    const a = this.expected();
    if (!a || !a.play || (a.col === undefined && !a.block)) return null;
    if (!this._allows('target', { tissue, col, row })) return null;
    const i = activeGame.hand.findIndex(c => c.id === a.play);
    return i === -1 ? null : i;
  }

  actionDone() {
    this.actionIndex++;
    this._advance();
  }

  nudge() {
    this.el.classList.remove('nudge'); void this.el.offsetWidth; this.el.classList.add('nudge');
    document.querySelectorAll('.tut-hl').forEach(el => {
      el.classList.remove('tut-hl-flash'); void el.offsetWidth; el.classList.add('tut-hl-flash');
    });
  }

  // ── Highlights & the "what to select" line ──
  _clearHighlights() {
    document.querySelectorAll('.tut-hl').forEach(el => el.classList.remove('tut-hl', 'tut-hl-flash', 'tut-hl-target'));
  }

  // Highlight descriptors: a CSS selector, or
  //   { board: tissue } · { cell: [tissue, col, row] } · { row: [tissue, row] }
  //   { cells: [tissue, cellClass] } · { card: id, in: selector }
  //   { phase: 'mutation' }
  _resolveHighlight(h) {
    if (typeof h === 'string') return [...document.querySelectorAll(h)];
    const cellSel = (t, extra = '') => `.tissue-cell[data-tissue="${t}"]${extra}`;
    if (h.board) return [...document.querySelectorAll(`.tissue-board[data-tissue="${h.board}"]`)];
    if (h.cell) return [...document.querySelectorAll(cellSel(h.cell[0], `[data-col="${h.cell[1]}"][data-row="${h.cell[2]}"]`))];
    if (h.row) return [...document.querySelectorAll(cellSel(h.row[0], `[data-row="${h.row[1]}"]`))];
    if (h.cells) return [...document.querySelectorAll(cellSel(h.cells[0], `.${h.cells[1]}`))];
    if (h.card) return [...document.querySelectorAll(`${h.in || ''} .card-face[data-card-id="${h.card}"]`)];
    if (h.phase) return [...document.querySelectorAll(`.phase-step[data-phase="${h.phase}"]`)];
    return [];
  }

  refreshHighlights() {
    this._clearHighlights();
    // The Trade pop-up is wide: shrink to just the "what to select" line
    // so Spike doesn't cover its buttons.
    this.el.classList.toggle('compact', document.getElementById('trade-popup-overlay').classList.contains('open'));
    const step = this.step;
    const todo = document.getElementById('tut-todo');
    if (!step) { todo.textContent = ''; return; }
    const { targets, text } = step.act ? this._actGuidance() : { targets: step.hl || [], text: '' };
    targets.forEach(h => this._resolveHighlight(h).forEach(el => {
      el.classList.add('tut-hl');
      // A cell to select (e.g. where to place Latency) gets a bolder marker.
      if (step.act && el.classList.contains('tissue-cell')) el.classList.add('tut-hl-target');
    }));
    todo.innerHTML = text ? `👉 ${text}` : '';
    todo.style.display = text ? '' : 'none';
  }

  // What to highlight and say for the expected move, given what's
  // already selected on screen.
  _actGuidance() {
    const a = this.expected();
    if (!a) return { targets: [], text: '' };
    const name = id => STEALTH_CARD_DEFS[id]?.name || id;
    const list = names => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];

    if (a.pick) {
      const overlay = document.getElementById('draft-popup-overlay');
      if (!overlay.classList.contains('open')) return { targets: ['#pick-cards-btn'], text: 'Select ‘Pick Cards’.' };
      const picked = JSON.parse(overlay.dataset.picked || '[]').map(i => activeGame.currentOffer[i]?.id);
      const left = a.pick.filter(id => !picked.includes(id));
      if (!left.length) return { targets: ['#draft-confirm'], text: 'Select ‘Select’.' };
      return { targets: left.map(id => ({ card: id, in: '#draft-cards' })), text: `Select ${list(left.map(name))}.` };
    }
    if (a.play) {
      const selected = selectedHandIndex !== null ? activeGame.hand[selectedHandIndex] : null;
      if (!selected || selected.id !== a.play) {
        const where = a.block ? `, then an ${a.block} shielded cell` : a.col !== undefined ? ', then the highlighted cell' : a.tissue ? `, then the ${a.tissue}` : '';
        // A fixed target cell is marked from the start, so "the highlighted
        // cell" is already visible.
        const targets = [{ card: a.play, in: '#hand-cards' }];
        if (a.col !== undefined) targets.push({ cell: [a.tissue, a.col, a.row] });
        return { targets, text: `Select ${name(a.play)}${where}.` };
      }
      if (a.block) return { targets: [{ cells: [a.tissue, `cytokine-${a.block}`] }], text: `Now select one of the ${a.block} shielded cells.` };
      if (a.col !== undefined) return { targets: [{ cell: [a.tissue, a.col, a.row] }], text: 'Now select the highlighted cell.' };
      return { targets: [{ board: a.tissue }], text: `Now select the ${a.tissue}.` };
    }
    if (a.trade) {
      const open = document.getElementById('trade-popup-overlay').classList.contains('open');
      if (!open) return { targets: ['#trade-btn'], text: 'Select ‘Trade 3▸1’.' };
      const givenIds = tradeGiveSelected.map(i => activeGame.hand[i].id);
      const toGive = [...a.trade.give];
      givenIds.forEach(id => { const k = toGive.indexOf(id); if (k !== -1) toGive.splice(k, 1); });
      if (toGive.length) {
        if (tradeActiveTab !== 'give') return { targets: ['#trade-tab-give'], text: 'Open the first tab.' };
        const targets = [];
        activeGame.hand.forEach((c, i) => {
          if (toGive.includes(c.id) && !tradeGiveSelected.includes(i)) targets.push(`#trade-give-${i}`);
        });
        return { targets, text: `Give ${list(toGive.map(name))}.` };
      }
      if (tradeReceiveSelected !== a.trade.receive) {
        if (tradeActiveTab !== 'receive') return { targets: ['#trade-tab-receive'], text: 'Open the second tab.' };
        return { targets: [`#trade-receive-${a.trade.receive}`], text: `Choose ${name(a.trade.receive)} to receive.` };
      }
      return { targets: ['#trade-confirm'], text: 'Select ‘Trade’.' };
    }
    if (a.end) return { targets: ['#end-turn-btn'], text: 'Select ‘End Turn’.' };
    return { targets: [], text: '' };
  }

  // ── End screen ──
  // Can run more than once for the same ending (the end screen re-renders).
  onGameOver(state) {
    const key = state === 'won' ? 'end' : 'end-lost';
    if (this.doneBeats.has(key)) return;
    this.steps = null;
    this.onBeatDone = null;
    this.runBeat(key, () => {});
  }
}

// Spike's ✕ button.
function leaveTutorial() {
  activeTutorial?.askLeave();
}
