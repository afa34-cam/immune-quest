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
      after ~1.5 s; "Don't show again" stops it for good; Settings →
      "Add to Home Screen" still opens it. Laptop: never appears.
- [ ] New app icon in the browser tab and on the iPad Home Screen (delete
      and re-add the Home Screen icon to pick it up).
- [ ] Relapses happen only occasionally (at most once a day), can hit
      either game, and clear when that game is won again.

## Stealth Mission

- [ ] iPad web app: no large black box above the game; no black line at
      the bottom; the hand banner isn't under the home indicator.
- [ ] End screen → "To Patient": returns to the platform page WITH its
      header (and the game window is closed).
- [ ] Menu has only About / Settings / Share / Feedback (no Stealth tab),
      opening on About.
- [ ] Header ↺ Restart: only shown during a mission; asks "Restart? This
      mission will be lost." mid-game (Cancel keeps playing); on the
      win/lose screen it restarts straight away.
- [ ] End screen: the mission log tab sits beside the board, level with the
      top row of cells; it opens/closes and keeps the open/closed state
      you had during the game.
- [ ] Tap/click sounds play straight away (no delay), incl. on iPad.
- [ ] Mission log opening: on a wide screen it opens to the right without
      moving the board; on iPad it opens inline.
- [ ] Cytokine placement looks sensible (blocks the open edges beside and
      below the infection, biggest shape first).
- [ ] Organ icons show above LIVER / LUNG / INTESTINE with no overlap.

- [ ] Mission log « / » icons are bigger; the Pick Cards pop-up's minimise
      button uses the same » icon at the same size.
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
      Turn’." and the card
      stays in hand.

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
