# Manual checks

Things to check by hand on a real device after pushing — they can't be
verified from the development environment. Tick them off as you go.

Devices: **iPad web app** = opened from the Home Screen icon ·
**iPad Safari** = in a Safari tab · **Laptop** = desktop browser.

## Platform page

- [ ] iPad Safari + Laptop: the games list fits on screen without
      scrolling (try a short browser window too).
- [ ] iPad web app: the strip behind the time/battery is solid navy (no
      black, no fuzz); the header's logo and buttons sit just below it.
- [ ] iPad web app: the "Stealth mission unlocked" pop-up is fully visible
      (not under the status bar).
- [ ] iPad web app: no Fullscreen buttons anywhere (header, game window bar,
      Stealth header and menu). Laptop: they're still there and work.
- [ ] iPad Safari: the "Play full-screen / Add to Home Screen" guide appears
      after ~1.5 s. Tick "Don't show again" and close it (OK, ✕ or tap
      outside): it stops for good. Settings → "Add to Home Screen" still
      opens it, with the box ticked; untick + close turns it back on.
      Laptop: never appears.
- [ ] Menu → About (platform page and Stealth) shows "Version 0.22".
- [ ] Menu → Feedback: the "Send →" button has its cyan outline style.
- [ ] New app icon in the browser tab and on the iPad Home Screen (delete
      and re-add the Home Screen icon to pick it up).
- [ ] Relapses happen only occasionally (at most once a day), can hit
      either game, and clear when that game is won again.

## Stealth Mission

- [ ] iPad web app: no large black box above the game; no black line at
      the bottom; the hand banner isn't under the home indicator.
- [ ] End screen → "To Patient": returns to the platform page WITH its
      header (and the game window is closed).
- [ ] Menu has only About / Settings / Share / Feedback (no Stealth tab).
- [ ] Header ↺ Restart: only shown during a mission; asks "Restart? This
      mission will be lost." mid-game (Cancel keeps playing); on the
      win/lose screen it restarts straight away.
- [ ] End screen: the mission log tab sits beside the board, level with the
      top row of cells; it opens/closes and keeps the open/closed state
      you had during the game.
- [ ] Tap/click sounds play straight away (no delay), incl. on iPad.
- [ ] Cytokine placement looks sensible (blocks the open edges beside and
      below the infection, biggest shape first).
- [ ] Organ icons show above LIVER / LUNG / INTESTINE with no overlap.

- [ ] Mission log arrow: folded it points sideways at "Mission Log";
      unfolded it turns to point down. The label and arrow stay exactly in
      place when folding/unfolding (also the very first time, while the
      green dot is showing). On the win/lose tab the arrow points down at
      the vertical label. The Pick Cards pop-up's minimise button shows the
      same down arrow.
- [ ] iPad: the corner buttons (☰ ? ↺ ⛶ and "← Immune Quest") are a bit
      bigger and easy to tap; the ☰ icon is centred in its button.
- [ ] Pick Cards pop-up: the ⓘ badge on the big cards is larger and fully
      visible.
- [ ] Menu (platform page and Stealth) opens on the Settings tab.

### Hint banner (Stealth)

- [ ] 1–2 cards in hand: "Select a card to play it or select ‘End Turn’".
- [ ] 3+ cards in hand: "Select a card to play it, select ‘Trade 3▸1’ or
      select ‘End Turn’".
- [ ] Close the Pick Cards pop-up: "Select ‘Pick Cards’ to choose the
      cards to take in hand"; reopen it: the hint disappears.
- [ ] Select a card, then tap a greyed-out tissue: "The virus is not active
      in the {tissue}. Select another card or select ‘End Turn’." (pink); the
      card stays in hand. Same for Antibody Escape / T-Cell Evasion on a
      tissue the virus isn't in.
- [ ] Antibody Escape on a tissue with no antibodies: "No antibodies to
      escape in the {tissue}. Select another card to play or select ‘End
      Turn’." and the card stays in hand.

### Latest (not yet reviewed)

- [ ] Card banners are slimmer; the ⓘ and turns badges aren't cut off
      (also when a card is hovered/lifted).
- [ ] iPad: Stealth has no page header in game; top-left shows the logo,
      then Menu, ?, ↺ Restart and Fullscreen (Safari only) as square
      buttons on one line, then "← Immune Quest" exactly as wide as that
      line. Does it look good enough to keep? Restart → the header returns.
      Laptop: normal header, unchanged.
- [ ] iPad: the four icons in that grid (☰ ? ↺ ⛶, now drawn as line icons)
      all look the same size; in Safari fullscreen, ⛶ switches to an
      "exit" icon.

### Round: rotation, top fuzz, end screen

- [ ] iPad: on the patient screen, turn the iPad to portrait and back to
      landscape: the patient image comes back.
- [ ] iPad web app: the top of the page is no longer fuzzy; the header sits
      a little lower, clear of the status bar's blur. Pop-ups and the
      unlock message also start below it.
- [ ] Stealth: the closed mission log is just its header bar
      ("« Mission Log"), as wide as the open log; opened, the lines show
      underneath and it runs the full height of the game screen.
      Opening/closing it never moves or resizes the board (laptop + iPad).
      Is the board still big enough on iPad now the log always takes its
      full width?
- [ ] Win/lose screen: the mission log is a narrow vertical tab again,
      "Mission Log" on one line, reading top to bottom (with the pulsing green dot if there are unread lines), and
      the board is centred under the You Win / Game Over panel. Opening the
      log there keeps it on screen (the board shifts left only as much as
      needed).
- [ ] Platform page: the icon before the blinking status (e.g. ☣ Critical
      condition) is bigger and lines up with the text, for every status.
- [ ] Laptop: the ↺ Restart icon in the Stealth header is bigger; the
      button is still the same height as the others.
- [ ] Win/lose screen on iPad: the normal Stealth header comes back (not the
      corner grid); "Play Again" switches back to the corner grid.
- [ ] Win/lose screen: the ← and ↺ icons are centred in their buttons; the
      buttons are solid (board doesn't show through); all header and end
      screen buttons light up cyan on hover (the ? used to be green).
- [ ] Win/lose screen on iPad Safari: the mission log sits beside the
      intestine board, not on top of it.

### Tutorial (Stealth)

- [ ] Select screen: a purple "New here? Play the tutorial" button with
      Spike (a purple virus with pink-tipped spikes) sits above the viruses.
- [ ] The practice mission plays the same way every time and ends with
      "Tutorial Complete" on turn 8. It doesn't change your high score,
      "games played" or Stealth's cleared status.
- [ ] Spike's panel (bottom-right) never covers what it asks you to
      select, including the Pick Cards and Trade pop-ups (laptop and iPad).
- [ ] Only the move Spike asks for works; anything else gives a little
      shake. The ⓘ card info, mission log and menu still work as normal.
- [ ] Every card type comes up and each "Real biology" note reads well
      (check the science and the tone for your audience).
- [ ] Spike's ✕ (and the header ↺ Restart) leaves the tutorial and goes
      back to the select screen; starting it again begins from the start.
- [ ] End screen: "Real Mission" goes to the select screen; no score shown.
- [ ] In the tutorial, the virus panel (bottom-left) shows ninja Spike
      (mask, red headband, sly grin) and the name just "Spike". Spike's
      own panel header just says "Spike".
- [ ] "Tutorial Complete" is centred in the end panel.
- [ ] Spike's ✕ asks "Leave the tutorial?" in his bubble: Stay keeps
      playing, Leave goes back to the virus selection.
- [ ] Turn 4 Latency (and turn 6): the cell to select is bright purple
      with a white ring and pulses, before and after selecting the card.
- [ ] Spike's moods include ninja (mask, no tooth) and evil (sly grin).
- [ ] Select screen: the tutorial button shows ninja Spike, gently bobbing.
- [ ] Tutorial, turn 4: after tapping a wrong card or cell, tapping the highlighted cell still places the Latency (also works without selecting the card first).

### Messages between the platform page and games (security fix)

The platform page now only listens to its own game window, and games only
to the platform page. Check everything that crosses between them still
works (laptop and iPad web app):
- [ ] Win a Stealth mission: the platform shows it as completed, with score.
- [ ] Stealth menu → Settings: tracking toggle and "Reset progress" work.
- [ ] Stealth menu → Share and Feedback (Send) work.
- [ ] Fullscreen button inside Stealth (laptop) and "← Immune Quest" / To
      Patient close the game window.
- [ ] The Infection Game (Unity) still loads and records a win.
