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

Running `/reasoning-review week` opens an interactive pane. Each row expands on press to show the
evidence behind its score (abbreviated here; colors in the real pane: green for strong scores, red
for weak ones, and ↑/↓/→ colored the same way for trend):

```
Strong Senior, showing Staff-level architecture behaviour
Focus next: Root-cause debugging

You're getting better at challenging Claude's architectural suggestions. In the last few
tasks you caught coupling and ownership issues before implementation. One pattern to work
on: you tend to jump into implementation quickly when debugging — spend more time
establishing the failure boundary first.

Gap to next level: Show the same independent investigation in debugging that you already
show in architecture — isolate the failure before proposing a fix.

Engineering signals
──────────────────────────────────────────
▸ Architecture                 8.2  ↑
▸ Problem Solving               7.8  →
▸ Debugging                     6.9  ↓
▸ Code Quality                  8.0  ↑
▸ Technical Judgment            7.6  ↑
▸ AI Collaboration              8.4  ↑

Overall
──────────────────────────────────────────
▸ Overall – Engineering Capability   7.9  ↑
▸ Overall – Engineering Judgment     7.4  →
▸ Overall – AI Agency                8.1  ↑

Level: Senior+
Bands: Junior → Mid-level → Senior → Staff → Lead/Architect. A trailing + or - means the
evidence leans toward the next or previous band, not a clean fit for one.
```

Pressing a row (e.g. "Architecture") expands it in place:

```
▾ Architecture                 8.2  ↑
   Evidence from recent tasks
   • Challenged the proposed repository abstraction before implementation, citing
     caching and tenant-isolation consequences.
   • Identified coupling between the GraphQL client and the application layer before
     it was built, not after.
   Strong senior-level architectural reasoning; approaching Staff level.
```

Metrics with nothing to go on in the window (e.g. no security work happened) are left off the
list entirely — never guessed at or scored low for absence of evidence.

## What it reads, what it costs, where it goes

- Reads `~/.claude/projects/<this-project>/*.jsonl` — **only the current project's own history**,
  filtered to the requested window. It never reads another project's history, and never aggregates
  across projects (different codebases aren't comparable).
- Sends that transcript text to the model through your own session's own API usage (one
  `$.model.complete` call) — the same account/credits your Claude Code session already uses. No
  separate service, no external server.
- Stores the resulting scores in the plugin's own local store (for the trend arrows on your next
  run) — kept per project and per window size (week/month tracked separately), never synced or
  shared anywhere.
- Nothing is sent anywhere beyond that one model call. The result is shown only to you, in the pane,
  in that session.

## What it shows

A pane (`Reasoning Review`) with:

- A short narrative: one improving pattern, one thing to work on, a current signal, a focus-next.
- **Engineering signals** — 12 metrics (Technical Knowledge, Problem Solving, Debugging,
  Architecture, System Design, Code Quality, Testing, Security & Performance, Decision Making,
  Requirements, Engineering Judgment, AI Collaboration), each scored 0–10 where the window has
  real evidence (metrics with nothing to go on are left out, not guessed low).
- **Overall** — Engineering Capability, Engineering Judgment, and AI Agency (how much of the
  reasoning was genuinely yours vs. accepted from Claude without challenge).
- A trend arrow (↑ ↓ →) per score, compared against your previous run on this project and window.
- A current-level estimate with an explicit gap to the next band.

Every row expands on press to show the concrete evidence behind its score.

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
  unscored rather than guessed.
- Every score is grounded in specific, cited moments from the transcript.

## Developing

```
claude plugin validate .
claude plugin test .
```

See `claude plugin test`'s output for the full suite (pure-logic unit tests plus interactive pane
tests that press a row and assert its evidence expands).
