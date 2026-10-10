# Changelog

### 0.9.0

- The command's own output line now offers a clickable "Open the Reasoning Review pane" button
  whenever a scorecard exists, in addition to `/reasoning-review show`. Lets a person who closed
  the pane get it back with a click, without needing to know `show` exists or type it out. A click
  always presses the button, no keyboard focus needed — additive to `show`, not a replacement, for
  terminals where clicking doesn't reach the app either (see 0.7.2).

### 0.8.0

- Added `/reasoning-review show`: reopens the pane from the scorecard already computed this
  session, with no model call. Closing the pane discards it (normal pane behaviour), and until now
  the only way to see it again was `week`/`month`, which always generates a fresh assessment —
  so getting the pane back after closing it by mistake meant paying for a whole new model run just
  to look at it again.

### 0.7.2

- Added an "↑↓ to scroll" hint to both pane screens. Arrow-key scrolling only works once the pane
  has focus, and mouse-wheel scrolling depends on the terminal forwarding wheel events at all —
  common on macOS terminals, often not on Linux (no SGR mouse reporting, tmux without mouse mode,
  an SSH hop in between). Without the hint, a person on such a terminal had no way to discover that
  the arrow keys work even though the wheel does nothing.

### 0.7.1

- Raised the pane's requested inline height (`rows`) from 40 to 60. `rows` is only a request —
  the engine clamps it to whatever the terminal actually has spare — so asking for more costs
  nothing and reduces how often the Overview screen's content (What changed, Strongest, Needs
  attention, the "View full review" button) lands below the fold on a typical terminal size.

### 0.7.0

- Brought back the interactive two-screen Pane UI (Overview + Metrics), this time with the
  scroll/focus bugs that caused it to be dropped in 0.5.0 actually fixed: `$.ui.open` now passes
  `focus: true`, so the pane holds the keyboard as soon as it opens and the arrow keys scroll it
  immediately, and it requests a taller `rows` so the Metrics screen needs less scrolling in the
  first place. `/reasoning-review` still returns a short text reply alongside the pane (current
  signal, token usage) for surfaces that can't place a pane at all.

### 0.6.0

- Added a compact "Signals at a glance" table (one row per scored metric) at the top of the report.
- Dropped the per-metric ASCII bar and the redundant "Previous/Current/observations" recap line —
  that information is already in the section header.
- Capped displayed evidence per metric to 4 bullets, with a "+N more observations not shown" note
  instead of printing every observation when a metric has a lot of evidence.

### 0.5.0

- UI is now a single markdown report instead of an interactive pane — no pane to scroll or focus.
- Fixed a crash on older Claude Code hosts (`model.complete: ... (host check)`); now returns a
  clear "update Claude Code" message instead.
- README now documents mod version requirements, supported surfaces, and self-diagnosis steps.
