# reasoning-review

A Claude Code **mod** that answers one question: **how have you actually been reasoning while
working with Claude, on this project, lately?**

Run `/reasoning-review week` or `/reasoning-review month` and it reads your own Claude Code session
history for the current project and turns it into a scored engineering-skill assessment — grounded
in concrete evidence from what you actually typed and did, not a generic productivity summary.

It's for self-growth, not performance review by someone else: nobody but the person who runs it
ever sees the result.

> **This is a mod, not a plain plugin** — it registers `/reasoning-review` dynamically from code
> (`hooks/register.tsx`) rather than a static `commands/*.md` file. See [Requirements](#requirements)
> before you install.

## Why

It's easy to ship a good week of work with Claude and not actually know how much of it was yours —
whether you decomposed the problem and Claude executed it, or Claude decided and you went along.
The code looks the same either way. Only you were in the room for the difference, and it's easy to
lose track of which one happened, week over week.

This mod is a way of checking in with yourself honestly. Alongside the usual technical metrics, it
scores **AI Agency** — how much of the thinking was genuinely yours vs. accepted from Claude
without challenge — because that's the axis that most separates someone who looks senior from
someone who is operating at that level independently. No one else ever sees it; it's just a mirror
for your own growth.

## How it works

```
/reasoning-review week|month
            │
            ▼
  read ~/.claude/projects/<project>/*.jsonl
  (window-filtered; sidechains and the command's own
   invocations stripped — only human/assistant turns)
            │
            ▼
  over 180k chars? ──── no ───────────────┐
            │ yes                         │
            ▼                             │
  chunk by session (never split one) ──▶  │
  compress each chunk in parallel          │
  (haiku, low effort, preserves evidence)  │
            │                             │
            └──────────────┬──────────────┘
                           ▼
          one scoring call, your session's own model,
          rubric prompt (cached) + the window transcript
                           │
                           ▼
          parse JSON digest: 12 metrics + 3 overall
          scores + level / gap / narrative
                           │
                           ▼
          merge with this project+window's stored history
          → trends computed in code, never re-asked of the model
                           │
                           ▼
          state (digest/screen/expanded) → "Reasoning Review"
          Pane (Overview screen ⇄ Metrics screen)
```

Everything after "one scoring call" runs locally in the mod — no separate service, no external
server. The scoring call uses your own session's model and your session's own API usage; the
result and the local history store (for trend arrows) never leave your machine.

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
observation count, and confidence (High/Medium/Low).

## What it shows

- **Overview** — headline Engineering Capability score and trend, a short "what changed"
  narrative, and the single strongest/weakest metric this window.
- **Metrics** — a deterministic **Summary** (Improved / Declined / Consistent / Needs attention,
  computed from score deltas, never re-asked of the model), then **12 engineering signals**
  (Technical Knowledge, Problem Solving, Debugging, Architecture, System Design, Code Quality,
  Testing, Security & Performance, Decision Making, Requirements, Engineering Judgment, AI
  Collaboration), each scored 0–10 against explicit rubric anchors. Metrics with nothing to go on
  are called out as insufficient evidence, never guessed low.
- **Overall** — Engineering Capability, Engineering Judgment, and AI Agency, plus a current-level
  estimate with an explicit gap to the next band.

Every score carries a trend arrow and delta against your previous run on this project+window, and
expands into its full evidence list, confidence rating, and previous-vs-current comparison.

## Level bands

```
Junior → Mid-level → Senior → Staff → Lead / Architect
```

- **Junior** — follows established patterns; needs direction on architecture; fixes symptoms more
  often than root causes.
- **Mid-level** — independently implements features; debugs familiar systems; makes reasonable
  local design decisions.
- **Senior** — handles ambiguous problems independently; identifies architectural consequences;
  challenges assumptions, including Claude's.
- **Staff** — thinks beyond the immediate feature; defines boundaries/patterns for larger systems;
  influences technical direction.
- **Lead / Architect** — shapes technical direction across teams/systems; establishes architectural
  principles; evaluates competing system-level strategies.

A level is never just an average score thresholded into a bucket. A trailing **+** or **-**
(e.g. `Senior-`, `Staff+`) means the evidence is genuinely mixed between two adjacent bands. The
report's gap line always says, concretely, what would need to show up to justify the next band.

## Install

```
/plugin install reasoning-review --marketplace NavaneethVijay/claude-reasoning-review-plugin
```

Pick the **user** scope so it's available in every project.

### Requirements

Being a mod, this needs mod support in the host:

| Host | Minimum version | Check |
| :- | :- | :- |
| Terminal | v2.1.287+ | `claude --version` |
| Desktop app | v2.1.286+ | `/status` → **Claude Code** row |
| VS Code extension | — | no version check available; an outdated bundled engine is the likely cause if the command does nothing |

If `/reasoning-review` does nothing after installing: check `/plugin` for `reasoning-review` under
**mods active** — if it's missing, the host didn't load the mod (update it).

### Supported usage

`/reasoning-review` always returns a short text reply (current signal, token usage) and opens the
pane where the surface supports one:

| Where you run Claude Code | Works? |
| :- | :- |
| Terminal (incl. editor-integrated terminals, JetBrains) | Yes, full pane |
| Desktop app (Code tab, not WSL) | Yes, full pane |
| VS Code extension's chat panel | Yes, full pane |
| `claude -p` / the Agent SDK | Text reply only |
| Remote Control (claude.ai / mobile) | Yes, on the machine the session runs on |
| Cloud session | Yes, if the plugin reaches that session |
| WSL session inside the Desktop app | No — plugins aren't available in WSL sessions |

## Usage

Run from inside the project you want assessed — it only reads that project's own history:

```
/reasoning-review week
/reasoning-review month
/reasoning-review show
```

`week`/`month` always generate a fresh scorecard (a new model call). `show` reopens the pane from
whatever was last computed this session, for free. The command's own output line also carries an
"Open the Reasoning Review pane" button once a scorecard exists.

With no recent activity on the current project, it says so plainly instead of fabricating a score.

## Scoring rules it follows

- Never infers a skill from terminology alone — only from the reasoning actually shown.
- Absence of evidence is never scored as poor ability; an untouched metric is left unscored.
- Every score is grounded in specific, cited moments from the transcript, against explicit rubric
  anchors (2/5/8/10).
- Every non-null score carries a confidence (High/Medium/Low), independent of the score itself.

## Updating

Installing it gets you a snapshot, not a live link to this repo. Get a new version with:

```
claude plugin update reasoning-review
```

then restart your Claude Code session — an update only takes effect in sessions started after it.
See `version` in `plugin.json` or [CHANGELOG.md](./CHANGELOG.md) for what's new.

## Developing

```
claude plugin validate .
claude plugin test .
```

`claude plugin test`'s output covers the full suite: pure-logic unit tests, engine-level tests that
run `/reasoning-review` and assert on its text reply, and pane-mount tests for the Overview/Metrics
screens.

### Releasing

1. Bump `version` in `.claude-plugin/plugin.json`.
2. Add an entry to [CHANGELOG.md](./CHANGELOG.md).
3. `git publish` (local alias for `git push && claude plugin update reasoning-review`) — updates
   your own installed copy; everyone else still pulls their own update.
4. Restart your own session to pick it up.
