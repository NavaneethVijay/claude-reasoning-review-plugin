# reasoning-review

A Claude Code **mod** that answers one question: **how have you actually been reasoning while
working with Claude, on this project, lately?**

Run `/reasoning-review week` or `/reasoning-review month` and it reads your own Claude Code session
history for the current project, and turns it into a scored engineering-skill assessment — grounded
in concrete evidence from what you actually typed and did, not a generic productivity summary.

It's for self-growth, not performance review by someone else: nobody but the person who runs it
ever sees the result.

> **This is a mod, not a plain plugin.** A mod registers its command dynamically from code
> (`hooks/hooks.json` + `$.command.register`), not from a static `commands/*.md` file, which is what
> lets it read your session history, call the model directly, and keep trend history across runs —
> see [What it reads, what it costs, where it goes](#what-it-reads-what-it-costs-where-it-goes). The
> trade-off: it needs a Claude Code host new enough to support mods. See
> [Requirements](#requirements) before you install.

## Why

LLM-assisted coding makes it easy to ship things without knowing whether *you* did the reasoning or
the model did. This mod tries to surface that honestly: it specifically scores **AI Agency** —
how much of the thinking was genuinely yours vs. accepted from Claude without challenge — alongside
the usual technical metrics, because that's the axis that most separates someone who looks senior
from someone who is operating at that level independently.

## Sample output

Running `/reasoning-review week` prints the full assessment straight into the conversation as one
markdown report — no separate pane to open, focus, or scroll; it reads and scrolls like any other
Claude Code response:

```
## Developer Review — Sep 30 – Oct 6 (week)

**Level:** Senior (confidence: Medium)
Strong Senior, showing Staff-level architecture behaviour.
**Engineering Capability:** 7.9 ↑ (+0.4)

### What changed
You're getting better at challenging Claude's architectural suggestions. In the last few
tasks you caught coupling and ownership issues before implementation.

**Strongest:** Architecture — 8.2 ↑
**Needs attention:** Debugging — 6.9 ↓

**Focus next:** Root-cause debugging.
**Gap to next level:** Show root-cause debugging before reaching for a fix.

---

### Summary
**Improved:** Architecture, AI Collaboration
**Declined:** Debugging
**Needs attention:** Debugging

---

### Engineering signals

#### Architecture — 8.2 ↑ (+0.7) · Confidence: High
████████████████░░░░

Strong senior-level architectural reasoning; approaching Staff level.

**Strong evidence**
- Challenged the proposed repository abstraction before implementation, citing
  caching and tenant-isolation consequences.
- Identified coupling between the GraphQL client and the application layer before
  it was built, not after.

Previous: 7.5 · Current: 8.2 · 2 observations

#### Debugging — 6.9 ↓ (-0.4) · Confidence: Medium
█████████████░░░░░░░
...
```

Every scored metric gets its own section — score, trend, delta, the evidence behind it, and a
deterministic Summary (Improved / Declined / Consistent / Needs attention — computed from real
score movement, never re-asked of the model). Metrics with nothing to go on in the window (e.g. no
security work happened) are never guessed at or scored low for absence of evidence — they're called
out explicitly ("Insufficient evidence this window...") rather than silently dropped.

## What it reads, what it costs, where it goes

- Reads `~/.claude/projects/<this-project>/*.jsonl` — **only the current project's own history**,
  filtered to the requested window. It never reads another project's history, and never aggregates
  across projects (different codebases aren't comparable).
- Sends that transcript text to the model through your own session's own API usage — the same
  account/credits your Claude Code session already uses. No separate service, no external server.
  The scoring call itself uses whichever model your session is actually running. If a window is too
  large to send in one shot (a very busy week, or one very long conversation), it's first condensed
  in parallel, cheap passes (a fixed, inexpensive model) that preserve chronology and concrete,
  citable detail — never just cutting off the oldest part of the window — before the single scoring
  call reads it.
- Stores the resulting scores in the plugin's own local store (for the trend arrows on your next
  run) — kept per project and per window size (week/month tracked separately), never synced or
  shared anywhere.
- Nothing is sent anywhere beyond that one model call. The result is printed only to you, in that
  session's conversation.

## What it shows

One markdown report, printed straight into the conversation — the headline Engineering Capability
score and trend, a short "what changed" narrative, and the single strongest and weakest metrics
this window, followed immediately by the full breakdown:

- A deterministic **Summary** — Improved / Declined / Consistent / Needs attention — computed in
  code from actual score deltas, never re-asked of the model, so it's traceable to real movement.
- **Engineering signals** — 12 metrics (Technical Knowledge, Problem Solving, Debugging,
  Architecture, System Design, Code Quality, Testing, Security & Performance, Decision Making,
  Requirements, Engineering Judgment, AI Collaboration), each scored 0–10 against explicit rubric
  anchors (what a 2, 5, 8, or 10 concretely looks like for that metric) where the window has real
  evidence. Metrics with nothing to go on are called out as insufficient evidence, not guessed low.
- **Overall** — Engineering Capability, Engineering Judgment, and AI Agency (how much of the
  reasoning was genuinely yours vs. accepted from Claude without challenge).
- A bar, trend arrow (↑ ↓ →), and numeric delta per score, compared against your previous run on
  this project and window.
- A current-level estimate with an explicit gap to the next band.

Every scored metric's section includes "Why this score?" in full — the evidence behind it as a
checklist, previous vs. current score, how many observations back it, and a confidence rating
(High/Medium/Low) for how solid that evidence actually is. Nothing is collapsed or hidden behind a
click; it's all there in the one scroll.

## Level bands

```
Junior → Mid-level → Senior → Staff → Lead / Architect
```

- **Junior** — follows established patterns; needs direction on architecture; fixes symptoms more
  often than root causes; relies heavily on existing examples.
- **Mid-level** — independently implements features; can debug familiar systems; makes reasonable
  local design decisions; understands common trade-offs.
- **Senior** — handles ambiguous problems independently; identifies architectural consequences;
  investigates before implementing; challenges assumptions, including Claude's; considers
  maintainability, performance and failure modes.
- **Staff** — thinks beyond the immediate feature; defines boundaries and patterns for larger
  systems; identifies systemic problems; makes decisions involving significant trade-offs;
  influences technical direction; simplifies complex systems.
- **Lead / Architect** — shapes technical direction across teams/systems; balances business,
  technical and organizational constraints; establishes architectural principles; anticipates
  long-term consequences; evaluates competing system-level strategies.

A level is never just an average score thresholded into a bucket. A trailing **+** or **-**
(e.g. `Senior-`, `Staff+`) means the evidence is genuinely mixed between two adjacent bands rather
than a clean fit for one — `Senior-` leans down toward Mid-level, `Senior+` leans up toward Staff.
The report's gap line always says, concretely, what would need to show up to justify the next band.

## Install

```
/plugin install reasoning-review --marketplace NavaneethVijay/claude-reasoning-review-plugin
```

(`/plugin install` is the right command for a mod too — a mod is still installed and managed as a
plugin; it's only how it registers its command and what it can do at runtime that's different from
a plain commands/*.md-only plugin.) Pick the **user** scope so it's available in every project.

### Requirements

Being a mod, this needs mod support in the Claude Code host you're running it in:

- **Terminal**: Claude Code **v2.1.287+**. Check with `claude --version`.
- **Desktop app**: **v2.1.286+**. Check with `/status` (the **Claude Code** row).
- **VS Code extension**: hooks run fine in its chat panel (only drawing a pane doesn't — this
  plugin doesn't use one), but the extension bundles its own engine copy on its own release
  cadence, and there's no `/status`/`--version` equivalent to check that embedded version
  directly. If `/reasoning-review` does nothing, this is the most likely reason.

**If `/reasoning-review` is installed but does nothing:** "installed" and "loaded" aren't the same
thing — a plugin can show up in `/plugin`'s Installed tab or `claude plugin list` while its mod is
silently refused (old engine version, an org policy, a crash on load). Check, in order:

1. Run `/plugin` and look for the **`mods active`** line (e.g. `1 mod active · reasoning-review`).
   If `reasoning-review` isn't named there, the mod never loaded — this is the real signal, not the
   Installed tab.
2. Run `claude plugin test` from an empty directory — it reports whether mods can load at all here
   (e.g. `hooks modules are turned off here`, or a remote kill-switch), separate from whether this
   mod specifically loaded.
3. Run `claude --debug-file ./mod-debug.log`, reproduce, then `grep reasoning-review
   ./mod-debug.log` for the exact refusal line, e.g. `hooks module reasoning-review@... not loaded:
   <reason>`.

If any of this points to an old engine version, the fix is updating Claude Code (or the VS Code
extension) — there's nothing the plugin itself can do if the host it's running in doesn't support
mods yet.

### Supported usage

`/reasoning-review` only ever returns a markdown text reply — it draws no pane, band, or any other
UI — so it works anywhere a mod's hooks run at all, with no surface-specific limitation:

| Where you run Claude Code | Works? |
| :- | :- |
| Terminal (`claude`, incl. an editor's integrated terminal, JetBrains plugin) | Yes |
| Desktop app (Code tab, not WSL) | Yes |
| VS Code extension's chat panel | Yes |
| `claude -p` / the Agent SDK | Yes |
| Remote Control (from claude.ai or the mobile app) | Yes, on the machine the session runs on |
| Cloud session | Yes, if the plugin reaches that cloud session |
| WSL session inside the Desktop app | No — plugins aren't available in WSL sessions at all |

Everywhere "Yes" above still needs a host engine version that supports mods at all — see
Requirements above.

## Updating

Installing it gets you a snapshot, not a live link to this repo — a push here doesn't reach anyone
who's already installed it. Whenever a new version has shipped (check `version` in `plugin.json`,
or just ask the maintainer), get it with:

```
claude plugin update reasoning-review
```

Then restart your Claude Code session — an update only takes effect in sessions started after it,
not ones already running.

## Usage

Run from inside the project you want assessed — never anywhere else, since it only reads that
project's own history:

```
/reasoning-review week
/reasoning-review month
```

With no recent activity on the current project, it says so plainly instead of fabricating a score.

## Scoring rules it follows

- Never infers a skill from terminology alone — only from the reasoning actually shown.
- Absence of evidence is never scored as poor ability; a metric untouched in the window is left
  unscored rather than guessed — never manufactured to fill a gap.
- Every score is grounded in specific, cited moments from the transcript, scored against explicit
  rubric anchors (2/5/8/10) rather than an isolated estimate.
- Every non-null score also carries a confidence (High/Medium/Low), reflecting how much and how
  clear the evidence behind it actually is — independent of how good or bad the score is.

## Changelog

### 0.5.0

- **UI changed from an interactive pane to a plain markdown report.** `/reasoning-review` used to
  open a two-screen pane (Overview, then a "View full review" button into Metrics with
  expand-on-press rows) via `ui.render`/`$.ui.open`. That pane couldn't be scrolled with the
  keyboard in some terminals, because opening it never requested focus (`$.ui.open` needs
  `focus: true` for scroll keys to reach it at all), and the Metrics screen is routinely taller
  than a pane's default height. Rather than patch focus/scrolling, the pane was removed entirely:
  the command now returns one complete markdown report straight into the conversation — everything
  (overview, summary, every metric's full evidence, overall scores, level/bands, usage) in one
  scroll, using the terminal's own scrollback. No UI code, no pane-focus edge cases.
- **Fixed a crash on older Claude Code hosts.** `$.model.complete` was called with `effort`,
  `maxTokens`, and `timeoutMs` — options some hosts don't recognize yet. An unsupported host
  rejects the call with `model.complete: takes { model, prompt } (host check)`, which previously
  propagated all the way up and crashed `/reasoning-review` with that raw engine error. This is now
  caught specifically (`isModelCompleteHostCheckFailure`) and returns a clear message instead:
  *"Your Claude Code version is too old to run /reasoning-review — ... Update Claude Code to the
  latest version and try again."* This was most commonly hit through the VS Code extension, whose
  embedded engine lags the CLI's release cadence.
- **Root-caused "installed but doesn't invoke" reports, and made the mod/plugin distinction explicit
  in this README.** Not a bug in the code: this is a *mod* (dynamic command registration via
  `hooks.json` + code, not a static `commands/*.md` file), which needs Claude Code v2.1.287+
  (terminal) or v2.1.286+ (Desktop app) — see Requirements and Supported usage above. Previously the
  README only said "plugin" throughout and buried the mod distinction in the Install section, which
  is exactly backwards from how confusing it is in practice — it's now called out at the top.
  "Installed"/listed and "mod loaded" are different signals; the self-diagnosis path (the `mods
  active` line in `/plugin`, `claude plugin test`, the debug log) is documented above instead of
  being rediscovered per bug report.

## Developing

```
claude plugin validate .
claude plugin test .
```

See `claude plugin test`'s output for the full suite (pure-logic unit tests plus engine-level tests
that run `/reasoning-review` and assert on the returned markdown report).

### Maintainer: releasing a change

1. Bump `version` in `.claude-plugin/plugin.json` — anyone checking `claude plugin list` relies on
   this to see whether they're behind.
2. `git publish` — a local alias for `git push && claude plugin update reasoning-review`, so your
   own installed copy updates in the same step. (This only updates *your* copy — see "Updating"
   above for why everyone else still has to pull their own update.)
3. Restart your own session to pick it up.
