# reasoning-review

A Claude Code **mod** that answers one question: **how have you actually been reasoning while
working with Claude, on this project, lately?**

Run `/reasoning-review week` or `/reasoning-review month` and it reads your own Claude Code session
history for the current project, and turns it into a scored engineering-skill assessment — grounded
in concrete evidence from what you actually typed and did, not a generic productivity summary.

It's for self-growth, not performance review by someone else: nobody but the person who runs it
ever sees the result.

> **This is a mod, not a plain plugin** — it registers `/reasoning-review` dynamically from code
> rather than a static `commands/*.md` file. See [Requirements](#requirements) before you install.

## Why

LLM-assisted coding makes it easy to ship things without knowing whether *you* did the reasoning or
the model did. This mod tries to surface that honestly: it specifically scores **AI Agency** —
how much of the thinking was genuinely yours vs. accepted from Claude without challenge — alongside
the usual technical metrics, because that's the axis that most separates someone who looks senior
from someone who is operating at that level independently.

## Sample output

Running `/reasoning-review week` opens a **"Reasoning Review" pane** with an Overview screen —
the headline Engineering Capability score and trend, a short "what changed" narrative, and the
single strongest and weakest metrics this window — and a "View full review" button into a Metrics
screen with the full per-metric breakdown:

```
Developer Review
Sep 30 – Oct 6

Engineering Capability
7.9  ↑ +0.4
────────────────────────────────────────────

What changed
You're getting better at challenging Claude's architectural suggestions. In the last few
tasks you caught coupling and ownership issues before implementation.

Strongest
Architecture              8.2  ↑

Needs attention
Debugging                 6.9  ↓

                                           [ View full review ]
```

The Metrics screen lists every scored metric as a collapsed row (score, trend, delta, a bar);
pressing one expands "Why this score?" — the full evidence list, previous vs. current score,
observation count, and confidence (High/Medium/Low). Nothing is truncated: every observation the
model cited is there once you expand it. The pane opens with keyboard focus, so the arrow keys
scroll it immediately — no extra step to focus it first, and a tree taller than the pane's frame
(the Metrics screen routinely is) scrolls rather than getting cut off.

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

An interactive **"Reasoning Review" pane** with two screens. **Overview** — the headline
Engineering Capability score and trend, a short "what changed" narrative, and the single strongest
and weakest metrics this window, with a button into the full breakdown. **Metrics** —

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

Each metric row is collapsed by default; pressing it expands "Why this score?" — the full evidence
behind it as a checklist, previous vs. current score, how many observations back it, and a
confidence rating (High/Medium/Low) for how solid that evidence actually is. The pane opens with
keyboard focus, so the arrow keys scroll and navigate it right away, and a screen taller than the
pane's frame scrolls instead of getting cut off.

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
- **VS Code extension**: no `/status`/`--version` equivalent to check its bundled engine version
  directly, so an outdated extension is the most likely reason `/reasoning-review` does nothing.

**If `/reasoning-review` does nothing:** installed and loaded aren't the same thing. Check:

1. `/plugin` → the **`mods active`** line should name `reasoning-review`. If it doesn't, the mod
   didn't load (update Claude Code, or the VS Code extension).
2. `claude plugin test` → reports whether mods can load at all here.
3. `claude --debug-file ./mod-debug.log`, reproduce, then `grep reasoning-review ./mod-debug.log`
   for the exact refusal reason.

### Supported usage

`/reasoning-review` always returns a short text reply (current signal, token usage) and opens the
"Reasoning Review" pane with the full scorecard. The pane itself draws on every surface; a surface
that can't place one at all still gets the text reply:

| Where you run Claude Code | Works? |
| :- | :- |
| Terminal (`claude`, incl. an editor's integrated terminal, JetBrains plugin) | Yes, full pane |
| Desktop app (Code tab, not WSL) | Yes, full pane |
| VS Code extension's chat panel | Yes, full pane |
| `claude -p` / the Agent SDK | Text reply only — no interactive surface to open a pane on |
| Remote Control (from claude.ai or the mobile app) | Yes, on the machine the session runs on |
| Cloud session | Yes, if the plugin reaches that cloud session |
| WSL session inside the Desktop app | No — plugins aren't available in WSL sessions at all |

Everywhere "Yes" above still needs a host engine version that supports mods at all — see
Requirements above.

## Updating

Installing it gets you a snapshot, not a live link to this repo — a push here doesn't reach anyone
who's already installed it. Whenever a new version has shipped (check `version` in `plugin.json`,
[CHANGELOG.md](./CHANGELOG.md), or just ask the maintainer), get it with:

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
/reasoning-review show
```

With no recent activity on the current project, it says so plainly instead of fabricating a score.

Closing the pane (its own close mark, or ctrl+x x) discards it — the normal way panes work — and
`week`/`month` always generate a fresh scorecard, calling the model again. `show` reopens the pane
from whatever was last computed this session, for free, with no new model call; it's there so
closing the pane by mistake doesn't mean paying for a whole new assessment just to see it again.
`/reasoning-review`'s own output line also carries an "Open the Reasoning Review pane" button once
a scorecard exists, so a click does the same thing `show` does — no need to know `show` exists.

## Scoring rules it follows

- Never infers a skill from terminology alone — only from the reasoning actually shown.
- Absence of evidence is never scored as poor ability; a metric untouched in the window is left
  unscored rather than guessed — never manufactured to fill a gap.
- Every score is grounded in specific, cited moments from the transcript, scored against explicit
  rubric anchors (2/5/8/10) rather than an isolated estimate.
- Every non-null score also carries a confidence (High/Medium/Low), reflecting how much and how
  clear the evidence behind it actually is — independent of how good or bad the score is.

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## Developing

```
claude plugin validate .
claude plugin test .
```

See `claude plugin test`'s output for the full suite (pure-logic unit tests, engine-level tests that
run `/reasoning-review` and assert on its text reply, plus pane-mount tests that exercise the
Overview/Metrics screens and the expand/collapse and navigation buttons).

### Maintainer: releasing a change

1. Bump `version` in `.claude-plugin/plugin.json` — anyone checking `claude plugin list` relies on
   this to see whether they're behind.
2. Add an entry to [CHANGELOG.md](./CHANGELOG.md) under the new version.
3. `git publish` — a local alias for `git push && claude plugin update reasoning-review`, so your
   own installed copy updates in the same step. (This only updates *your* copy — see "Updating"
   above for why everyone else still has to pull their own update.)
4. Restart your own session to pick it up.
