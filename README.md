# reasoning-review

A Claude Code plugin that answers one question: **how have you actually been reasoning while
working with Claude, on this project, lately?**

Run `/reasoning-review week` or `/reasoning-review month` and it reads your own Claude Code session
history for the current project, and turns it into a scored engineering-skill assessment — grounded
in concrete evidence from what you actually typed and did, not a generic productivity summary.

It's for self-growth, not performance review by someone else: nobody but the person who runs it
ever sees the result.

## Why

LLM-assisted coding makes it easy to ship things without knowing whether *you* did the reasoning or
the model did. This plugin tries to surface that honestly: it specifically scores **AI Agency** —
how much of the thinking was genuinely yours vs. accepted from Claude without challenge — alongside
the usual technical metrics, because that's the axis that most separates someone who looks senior
from someone who is operating at that level independently.

## Sample output

Running `/reasoning-review week` opens an interactive pane on an **Overview** screen — a ~10-second
read on how the window went:

```
Developer Review
Sep 30 – Oct 6

Engineering Capability
7.9  ↑ +0.4
──────────────────────────────────────────

What changed
You're getting better at challenging Claude's architectural suggestions. In the last few
tasks you caught coupling and ownership issues before implementation.

Strongest
Architecture                8.2  ↑

Needs attention
Debugging                   6.9  ↓

[ View full review ]
```

Pressing "View full review" drills into the **Metrics** screen: every scored dimension as a bar,
with its delta, plus a deterministic Summary (Improved / Declined / Consistent / Needs attention —
computed from real score movement, never re-asked of the model):

```
← Overview

Summary
──────────────────────────────────────────
Improved
 • Architecture
 • AI Collaboration

Declined
 • Debugging

Needs attention
 • Debugging

Engineering signals
──────────────────────────────────────────
▸ Architecture                 8.2  ↑ +0.7
   ████████████████░░░░
▸ Debugging                    6.9  ↓ -0.4
   █████████████░░░░░░░
```

Pressing a row expands "Why this score?" — the evidence behind it, not just the number:

```
▾ Architecture                 8.2  ↑ +0.7
   ████████████████░░░░
   Why this score?
   ──────────────────────────────
   Strong evidence
   ✓ Challenged the proposed repository abstraction before implementation, citing
     caching and tenant-isolation consequences.
   ✓ Identified coupling between the GraphQL client and the application layer before
     it was built, not after.
   Strong senior-level architectural reasoning; approaching Staff level.
   ──────────────────────────────
   Previous: 7.5   Current: 8.2
   2 observations
   Confidence: High
```

Metrics with nothing to go on in the window (e.g. no security work happened) are never guessed at
or scored low for absence of evidence — they're called out explicitly ("Insufficient evidence this
window...") rather than silently dropped.

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
- Nothing is sent anywhere beyond that one model call. The result is shown only to you, in the pane,
  in that session.

## What it shows

A pane (`Reasoning Review`) with two screens:

**Overview** — the headline Engineering Capability score and trend, a short "what changed"
narrative, and the single strongest and weakest metrics this window. A "View full review" button
drills into Metrics.

**Metrics** — the full breakdown:

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

Every row expands into "Why this score?" — the evidence behind it as a checklist, previous vs.
current score, how many observations back it, and a confidence rating (High/Medium/Low) for how
solid that evidence actually is.

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
The pane's gap line always says, concretely, what would need to show up to justify the next band.

## Install

```
/plugin install reasoning-review --marketplace NavaneethVijay/claude-reasoning-review-plugin
```

Pick the **user** scope so it's available in every project.

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

## Developing

```
claude plugin validate .
claude plugin test .
```

See `claude plugin test`'s output for the full suite (pure-logic unit tests plus interactive pane
tests that press a row and assert its evidence expands).

### Maintainer: releasing a change

1. Bump `version` in `.claude-plugin/plugin.json` — anyone checking `claude plugin list` relies on
   this to see whether they're behind.
2. `git publish` — a local alias for `git push && claude plugin update reasoning-review`, so your
   own installed copy updates in the same step. (This only updates *your* copy — see "Updating"
   above for why everyone else still has to pull their own update.)
3. Restart your own session to pick it up.
