import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, ModelUsage, Register } from 'claude-code'

import type {
  Confidence,
  Digest,
  HistoryEntry,
  MetricEntry,
  ReportBuckets,
  RunUsage,
  Screen,
  ViewDigest,
  ViewMetric,
} from '../types'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_TRANSCRIPT_CHARS = 180_000
const COMPRESSION_CHUNK_CHARS = 60_000
const PANE = 'reasoning-review'
const TREND_EPSILON = 0.4
const NEEDS_ATTENTION_MAX = 4

// The pane's default inline height is a third of the terminal — the Metrics screen (12 metrics +
// Overall + summary) routinely needs more than that. Requesting more up front means less scrolling
// in the common case; the engine still scrolls whatever doesn't fit, but only once the pane holds
// the keyboard (`focus: true` on $.ui.open below) — without it the arrow keys never reach the pane.
const PANE_ROWS = 40

type Anchors = { 2: string; 5: string; 8: string; 10: string }

const METRICS = [
  [
    'Technical Knowledge',
    'Understands concepts, internals, APIs, constraints; can explain why',
    {
      2: "Parrots terms without grasping mechanics; can't explain why something works, only that it does.",
      5: 'Understands common APIs/internals for the stack in use; explains typical behavior but not edge cases.',
      8: 'Explains internals and trade-offs accurately, including less common edge cases, unprompted.',
      10: "Reasons from first principles across unfamiliar internals; corrects subtle misconceptions, including Claude's.",
    },
  ],
  [
    'Problem Solving',
    'Decomposes problems, investigates, forms hypotheses, validates',
    {
      2: 'Jumps to a fix without decomposing the problem or forming a hypothesis.',
      5: 'Breaks a problem into steps and tests a hypothesis, though sometimes only after prompting.',
      8: 'Proactively decomposes ambiguous problems, forms and tests multiple hypotheses before committing.',
      10: 'Anticipates second-order effects and reframes the problem itself when the original framing was wrong.',
    },
  ],
  [
    'Debugging',
    'Uses evidence, isolates root causes, avoids random fixes',
    {
      2: 'Makes speculative changes hoping the symptom goes away; no evidence gathering.',
      5: 'Reproduces the issue and narrows scope with logs/prints before changing code.',
      8: 'Isolates root cause methodically using evidence; rejects plausible-but-wrong explanations.',
      10: 'Diagnoses root cause across system boundaries, distinguishing correlation from causation under pressure.',
    },
  ],
  [
    'Architecture',
    'Boundaries, coupling, scalability, extensibility, failure modes',
    {
      2: 'No sense of boundaries; couples unrelated concerns without noticing.',
      5: 'Recognizes and respects existing boundaries; keeps new code consistent with them.',
      8: 'Identifies coupling/scalability risks before they bite; proposes boundaries, not just follows them.',
      10: 'Designs for failure modes and extensibility several steps ahead, with explicit trade-off reasoning.',
    },
  ],
  [
    'System Design',
    'Data flow, APIs, state, reliability, observability, trade-offs',
    {
      2: 'Ignores data flow, state and failure handling; treats the happy path as the whole design.',
      5: 'Considers API shape and basic reliability (errors, retries) for the immediate feature.',
      8: 'Reasons explicitly about trade-offs across data flow, state, reliability and observability.',
      10: 'Designs systems that degrade gracefully and are observable by default; justifies trade-offs against alternatives actually considered.',
    },
  ],
  [
    'Code Quality',
    'Simplicity, maintainability, correctness, consistency',
    {
      2: 'Accepts inconsistent, hard-to-follow code as long as it runs.',
      5: 'Writes/keeps code simple and consistent with surrounding style; catches obvious correctness issues.',
      8: "Actively simplifies, flags maintainability risk, and pushes back on unnecessary complexity, including Claude's.",
      10: 'Consistently raises the bar on simplicity and correctness across the whole codebase, not just the diff.',
    },
  ],
  [
    'Testing',
    'Identifies meaningful test boundaries and failure scenarios',
    {
      2: 'Tests, if any, cover only the happy path.',
      5: 'Identifies the main failure scenarios worth testing for the feature at hand.',
      8: 'Identifies non-obvious boundaries and failure scenarios; argues for tests that would catch real regressions.',
      10: "Designs test strategy around the system's actual risk profile, not just coverage.",
    },
  ],
  [
    'Security & Performance',
    'Recognizes relevant risks without blindly optimizing',
    {
      2: 'Never considers security or performance implications, or over-optimizes without cause.',
      5: 'Flags the obvious risks (injection, auth, N+1 queries) when directly relevant.',
      8: 'Recognizes non-obvious risk without being prompted, and explicitly avoids premature optimization.',
      10: 'Weighs security/performance trade-offs quantitatively and justifies the chosen risk level.',
    },
  ],
  [
    'Decision Making',
    'Compares alternatives and makes context-appropriate decisions',
    {
      2: 'Takes the first suggestion offered without comparing alternatives.',
      5: 'Considers at least one alternative before committing to an approach.',
      8: 'Compares multiple alternatives against the actual context and states why one wins.',
      10: 'Makes context-appropriate calls under genuine ambiguity, and revisits them when new evidence arrives.',
    },
  ],
  [
    'Requirements',
    'Identifies ambiguity, assumptions and missing requirements',
    {
      2: "Implements exactly what was literally asked, missing obvious ambiguity.",
      5: 'Notices clear ambiguity and asks for clarification before implementing.',
      8: "Surfaces hidden assumptions and missing requirements the requester hadn't considered.",
      10: "Proactively reshapes the ask when the stated requirement doesn't serve the actual goal.",
    },
  ],
  [
    'Engineering Judgment',
    'Knows what not to build and when to accept trade-offs',
    {
      2: 'Builds whatever is suggested without weighing cost against benefit.',
      5: 'Occasionally pushes back on unnecessary scope or complexity.',
      8: 'Regularly says no to speculative work and justifies the trade-off being accepted.',
      10: "Consistently finds the minimum sufficient solution and defends it against scope creep from any source, including Claude.",
    },
  ],
  [
    'AI Collaboration',
    'Uses AI effectively while retaining technical ownership',
    {
      2: "Accepts Claude's output and claims without checking them.",
      5: 'Sometimes asks Claude to verify or justify a claim before accepting it.',
      8: "Regularly verifies Claude's claims (reads the file, runs it) and redirects when something's off.",
      10: 'Treats Claude as a tool under full direction — sets the approach, catches mistakes, retains ownership of every decision.',
    },
  ],
] as const satisfies readonly (readonly [string, string, Anchors])[]

const OVERALL_ANCHORS: Record<(typeof OVERALL_KEYS)[number], Anchors> = {
  'Engineering Capability': {
    2: 'Cannot operate without close direction; technical depth not evidenced this window.',
    5: 'Handles familiar problems competently across knowledge, problem solving, debugging.',
    8: 'Handles ambiguous or unfamiliar problems with real depth across most of these areas.',
    10: 'Demonstrates expert-level depth and judgment across nearly every area this window touched.',
  },
  'Engineering Judgment': {
    2: 'Accepts every suggestion and scope addition without weighing cost or trade-off.',
    5: 'Makes reasonable local calls and occasionally questions scope or requirements.',
    8: 'Consistently makes context-appropriate trade-offs and pushes back on unneeded complexity.',
    10: 'Judgment is the standout strength of the window — consistently right calls under real ambiguity.',
  },
  'AI Agency': {
    2: 'Accepted Claude\'s suggestions, architecture and conclusions without independently reasoning about or challenging them.',
    5: 'Mixed — sometimes verifies or redirects Claude, sometimes accepts claims at face value.',
    8: 'Regularly verifies Claude\'s claims and redirects or overrides it where warranted.',
    10: 'Fully independent: did the reasoning, verified every material claim, pushed back or redirected throughout.',
  },
}

const OVERALL_KEYS = ['Engineering Capability', 'Engineering Judgment', 'AI Agency'] as const

const RUBRIC_PROMPT = `You are assessing ONE developer's engineering ability, as evidenced ONLY by
how they reasoned while working with Claude Code on this project over the window described below.
This is self-facing only — nobody but the person running this ever sees it. It is not a productivity
report: ignore activity volume entirely (session count, message count, lines of code, how fast
anything happened).

Score the following 12 metrics, each 0–10. For each one, anchors are given for what 2, 5, 8 and
10 concretely mean — use them to place the score, don't just estimate a number in isolation. A
score between anchors (e.g. 6-7, between the 5 and 8 anchor) means the evidence sits between those
two descriptions.

${METRICS.map(
  ([name, desc, anchors]) =>
    `- ${name}: ${desc}\n  2 = ${anchors[2]}\n  5 = ${anchors[5]}\n  8 = ${anchors[8]}\n  10 = ${anchors[10]}`,
).join('\n')}

Then three overall scores, each 0–10:

- Engineering Capability — raw technical strength: depth across Technical Knowledge, Problem
  Solving, Debugging, Architecture, System Design.
  2 = ${OVERALL_ANCHORS['Engineering Capability'][2]}
  5 = ${OVERALL_ANCHORS['Engineering Capability'][5]}
  8 = ${OVERALL_ANCHORS['Engineering Capability'][8]}
  10 = ${OVERALL_ANCHORS['Engineering Capability'][10]}
- Engineering Judgment — quality of decisions: Decision Making, Requirements, Engineering
  Judgment, Security & Performance, knowing what not to build.
  2 = ${OVERALL_ANCHORS['Engineering Judgment'][2]}
  5 = ${OVERALL_ANCHORS['Engineering Judgment'][5]}
  8 = ${OVERALL_ANCHORS['Engineering Judgment'][8]}
  10 = ${OVERALL_ANCHORS['Engineering Judgment'][10]}
- AI Agency — this is the axis that most distinguishes someone genuinely operating at
  Senior/Staff/Lead level from someone whose output looks senior only because Claude did the
  thinking.
  2 = ${OVERALL_ANCHORS['AI Agency'][2]}
  5 = ${OVERALL_ANCHORS['AI Agency'][5]}
  8 = ${OVERALL_ANCHORS['AI Agency'][8]}
  10 = ${OVERALL_ANCHORS['AI Agency'][10]}

Then estimate a current level against this rubric:

- Junior — follows established patterns; needs direction on architecture; fixes symptoms more
  often than root causes; relies heavily on existing examples.
- Mid-level — independently implements features; can debug familiar systems; makes reasonable
  local design decisions; understands common trade-offs.
- Senior — handles ambiguous problems independently; identifies architectural consequences;
  investigates before implementing; challenges assumptions, including Claude's; considers
  maintainability, performance and failure modes.
- Staff — thinks beyond the immediate feature; defines boundaries and patterns for larger systems;
  identifies systemic problems; makes decisions involving significant trade-offs; influences
  technical direction; simplifies complex systems.
- Lead / Architect — shapes technical direction across teams/systems; balances business, technical
  and organizational constraints; establishes architectural principles; anticipates long-term
  consequences; evaluates competing system-level strategies.

Crucial scoring rules:

1. Never infer a skill just because the person used the right terminology. "Should we use a
   repository pattern here?" is weak evidence of anything. "The repository abstraction will hide
   tenant-specific query behaviour and make caching harder, so I'd rather keep this boundary at X"
   is strong evidence — it shows the reasoning behind the term, not just the term.
2. Absence of evidence is not evidence of poor ability. If this window never touches security, or
   never involves a debugging session, give that metric a null score and an empty evidence array
   rather than guessing low. Never manufacture a score to fill a gap — a null score is a correct,
   complete answer, not a missing one.
3. Ground every non-null score in specific, concrete moments from the transcript — aggregate every
   relevant moment across every session in the window, not just one. A non-null score with no
   evidence is not acceptable.
4. Every evidence string must be traceable to something that actually happened in the transcript —
   paraphrase the moment, don't invent one. "evidence" is the full list of observations behind the
   score, not a curated sample, so "observationCount" (see below) must equal evidence.length.
5. Report a "confidence" for every non-null score: "High" when there are several (3+) clear,
   unambiguous observations; "Medium" when there are a couple of observations or they require some
   interpretation; "Low" when there's only one thin or ambiguous observation. Confidence is about
   how solid the evidence is, not how good the score is — a metric can score 9 with Low confidence
   if it rests on a single strong-but-isolated moment.
6. Don't just threshold an average score into a level bucket — a current level like "Senior+" or
   "Staff-" is fine when the evidence is genuinely mixed between two bands. Weigh AI Agency
   explicitly: a high Engineering Capability score paired with a low AI Agency score should pull
   the level down, not just average out.

Respond with ONLY one JSON object, no prose before or after it, no markdown code fence, matching
exactly this shape (use these exact keys; a metric with no evidence gets "score": null, "evidence":
[], "confidence": null, "observationCount": 0):

{
  "metrics": {
    ${METRICS.map(
      ([name]) =>
        `"${name}": { "score": <number 0-10 or null>, "evidence": ["<concrete, specific observation>", "..."], "confidence": "High" | "Medium" | "Low" | null, "observationCount": <integer, equal to evidence.length>, "assessment": "<one short line explaining why this score and not one anchor band up or down>" }`,
    ).join(',\n    ')}
  },
  "overall": {
    "Engineering Capability": { "score": <number 0-10 or null>, "evidence": ["..."], "confidence": "High" | "Medium" | "Low" | null, "observationCount": <integer> },
    "Engineering Judgment": { "score": <number 0-10 or null>, "evidence": ["..."], "confidence": "High" | "Medium" | "Low" | null, "observationCount": <integer> },
    "AI Agency": { "score": <number 0-10 or null>, "evidence": ["..."], "confidence": "High" | "Medium" | "Low" | null, "observationCount": <integer> }
  },
  "level": "<e.g. 'Senior', 'Senior+', 'Staff-'>",
  "levelConfidence": "Low" | "Medium" | "High",
  "gap": "<specific, concrete behaviour that would need to show up to justify the next band up>",
  "narrative": "<2-4 sentences, second person, noting one improving pattern AND one thing to work on, each grounded in a specific moment from the transcript>",
  "currentSignal": "<short phrase, e.g. 'Strong Senior, showing Staff-level architecture behaviour'>",
  "focusNext": "<short phrase naming the single most useful thing to work on next>"
}`

// Older Claude Code hosts validate a plugin's $.model.complete call against a narrower schema and
// reject anything beyond { model, prompt } with "<plugin>: model.complete: takes { model, prompt }
// (host check)" — not a model/provider failure, a host-version mismatch this plugin can't work
// around (effort/maxTokens/timeoutMs aren't accepted at all), so it's surfaced as its own message
// rather than retried with a request that would just truncate the reply and fail to parse anyway.
export function isModelCompleteHostCheckFailure(err: unknown): boolean {
  return err instanceof Error && err.message.includes('model.complete') && err.message.includes('host check')
}

const HOST_VERSION_MESSAGE =
  "Your Claude Code version is too old to run /reasoning-review — it doesn't yet support the " +
  'model.complete options this plugin needs (effort, maxTokens, timeoutMs). Update Claude Code to ' +
  'the latest version and try again.'

function windowDays(args: string): number {
  return args.trim().toLowerCase() === 'month' ? 30 : 7
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: 'text'; text: string } =>
          !!block &&
          typeof block === 'object' &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string',
      )
      .map(block => block.text)
      .join('\n')
  }
  return ''
}

type ParsedLine = {
  type?: string
  isSidechain?: boolean
  timestamp?: string
  message?: { role?: string; content?: unknown }
}

async function readSessionLines(
  $: EngineInterface,
  path: string,
  cutoffMs: number,
): Promise<string[]> {
  const raw = await $.fs.read(path).catch(() => undefined)
  if (typeof raw !== 'string') return []

  const lines: string[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let parsed: ParsedLine
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed.isSidechain) continue
    if (parsed.type !== 'user' && parsed.type !== 'assistant') continue
    if (!parsed.timestamp) continue
    const ts = Date.parse(parsed.timestamp)
    if (Number.isNaN(ts) || ts < cutoffMs) continue

    const role = parsed.message?.role ?? parsed.type
    const text = textOfContent(parsed.message?.content).trim()
    if (!text) continue
    if (text.startsWith('<')) continue // slash-command invocations and local-command wrappers, not human prose
    lines.push(`${role === 'user' ? 'Human' : 'Claude'}: ${text}`)
  }
  return lines
}

type SessionBlock = { id: string; lines: string[] }

function blockText(block: SessionBlock): string {
  return [`--- session ${block.id} ---`, ...block.lines].join('\n')
}

function chunksText(chunk: SessionBlock[]): string {
  return chunk.map(blockText).join('\n')
}

// Packs whole sessions into chunks ≤ chunkChars, never splitting a session
// across chunks — except a single session whose own text alone exceeds
// chunkChars, which is sub-chunked by line (never mid-line) into ordered
// "(part N/M)" blocks so chronology and provenance survive.
function chunkSessions(blocks: SessionBlock[], chunkChars: number): SessionBlock[][] {
  const expanded: SessionBlock[] = []
  for (const block of blocks) {
    if (blockText(block).length <= chunkChars) {
      expanded.push(block)
      continue
    }
    const parts: string[][] = []
    let current: string[] = []
    let currentLen = 0
    for (const line of block.lines) {
      if (currentLen > 0 && currentLen + line.length + 1 > chunkChars) {
        parts.push(current)
        current = []
        currentLen = 0
      }
      current.push(line)
      currentLen += line.length + 1
    }
    if (current.length > 0) parts.push(current)
    parts.forEach((lines, i) => expanded.push({ id: `${block.id} (part ${i + 1}/${parts.length})`, lines }))
  }

  const chunks: SessionBlock[][] = []
  let chunk: SessionBlock[] = []
  let chunkLen = 0
  for (const block of expanded) {
    const len = blockText(block).length
    if (chunkLen > 0 && chunkLen + len > chunkChars) {
      chunks.push(chunk)
      chunk = []
      chunkLen = 0
    }
    chunk.push(block)
    chunkLen += len
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

const COMPRESSION_PROMPT = `Condense the following transcript excerpt from a developer's Claude Code
sessions. This is raw material for a later engineering-skill assessment: preserve every concrete,
specific moment that shows how the developer reasoned (a hypothesis stated, a trade-off argued, a
root cause found, an assumption challenged, Claude's claim verified or rejected, etc.) — these are
the only evidence a later reviewer can cite. Cut only redundant restatement, routine tool-call
noise, and filler. Keep it as a chronological narrative in the same "Human: ..." / "Claude: ..."
turn format, in original order, not a bullet list of isolated facts — a decision made early and
acted on later must still read as connected. Keep every "--- session <id> ---" marker exactly
where it occurs. Output only the condensed transcript text, no commentary.

Transcript excerpt:
`

async function compressChunk(
  $: EngineInterface,
  chunk: SessionBlock[],
): Promise<{ text: string; usage: ModelUsage } | undefined> {
  const result = await $.model
    .complete({
      model: 'haiku',
      prompt: `${COMPRESSION_PROMPT}${chunksText(chunk)}`,
      effort: 'low',
      maxTokens: 4000,
      timeoutMs: 60_000,
    })
    .catch(() => undefined)
  if (!result || !result.isAnswered) return undefined
  return { text: result.text.trim(), usage: result.usage }
}

function buildWindowTranscript(
  chunks: SessionBlock[][],
  compressed: (string | undefined)[],
): { transcript: string; fellBackCount: number } {
  let fellBackCount = 0
  const parts = chunks.map((chunk, i) => {
    const text = compressed[i]
    if (text !== undefined) return text
    fellBackCount += 1
    return chunksText(chunk)
  })
  return { transcript: parts.join('\n\n'), fellBackCount }
}

function sumUsage(
  compressionUsages: ModelUsage[],
  final: ModelUsage,
  context: { rawContextChars: number; sentContextChars: number; contextTruncated: boolean },
): RunUsage {
  const usage = [...compressionUsages, final].reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.input_tokens,
      outputTokens: acc.outputTokens + u.output_tokens,
      cacheReadTokens: acc.cacheReadTokens + u.cache_read_input_tokens,
      cacheCreationTokens: acc.cacheCreationTokens + u.cache_creation_input_tokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  )
  return { ...usage, compressionCalls: compressionUsages.length || undefined, ...context }
}

const CONFIDENCE_VALUES = new Set<Confidence>(['High', 'Medium', 'Low'])

function toMetricEntry(raw: unknown): MetricEntry {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const score = typeof obj.score === 'number' && Number.isFinite(obj.score) ? obj.score : null
  const evidence = Array.isArray(obj.evidence) ? obj.evidence.filter((x): x is string => typeof x === 'string') : []
  const assessment = typeof obj.assessment === 'string' ? obj.assessment : undefined
  const confidence =
    score !== null && typeof obj.confidence === 'string' && CONFIDENCE_VALUES.has(obj.confidence as Confidence)
      ? (obj.confidence as Confidence)
      : undefined
  const observationCount =
    typeof obj.observationCount === 'number' && Number.isFinite(obj.observationCount)
      ? obj.observationCount
      : evidence.length
  return { score, evidence, assessment, confidence, observationCount }
}

export function parseDigest(text: string): Digest | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (!match) return undefined
    try {
      parsed = JSON.parse(match[1])
    } catch {
      return undefined
    }
  }

  if (!parsed || typeof parsed !== 'object') return undefined
  const obj = parsed as Record<string, unknown>
  if (typeof obj.level !== 'string' || typeof obj.metrics !== 'object' || typeof obj.overall !== 'object') {
    return undefined
  }

  const rawMetrics = obj.metrics as Record<string, unknown>
  const rawOverall = obj.overall as Record<string, unknown>
  const metrics: Record<string, MetricEntry> = {}
  for (const [name] of METRICS) metrics[name] = toMetricEntry(rawMetrics?.[name])
  const overall: Record<string, MetricEntry> = {}
  for (const key of OVERALL_KEYS) overall[key] = toMetricEntry(rawOverall?.[key])

  return {
    metrics,
    overall,
    level: obj.level,
    levelConfidence: typeof obj.levelConfidence === 'string' ? obj.levelConfidence : undefined,
    gap: typeof obj.gap === 'string' ? obj.gap : undefined,
    narrative: typeof obj.narrative === 'string' ? obj.narrative : undefined,
    currentSignal: typeof obj.currentSignal === 'string' ? obj.currentSignal : undefined,
    focusNext: typeof obj.focusNext === 'string' ? obj.focusNext : undefined,
  }
}

export function trendOf(current: number | null, previous: number | null | undefined): ViewMetric['trend'] {
  if (current === null || previous === null || previous === undefined) return null
  const diff = current - previous
  if (diff > TREND_EPSILON) return '↑'
  if (diff < -TREND_EPSILON) return '↓'
  return '→'
}

function withTrend(entries: Record<string, MetricEntry>, previous: Record<string, MetricEntry> | undefined) {
  const viewed: Record<string, ViewMetric> = {}
  for (const [name, entry] of Object.entries(entries)) {
    const previousScore = previous?.[name]?.score ?? null
    const delta = entry.score !== null && previousScore !== null ? entry.score - previousScore : null
    viewed[name] = { ...entry, trend: trendOf(entry.score, previous?.[name]?.score), delta, previousScore }
  }
  return viewed
}

// Deterministic, computed from the already-scored metrics — never re-asked of the model, so every
// bucket here is directly traceable back to the score (and delta) that put it there.
function buildReport(metrics: Record<string, ViewMetric>): ReportBuckets {
  const report: ReportBuckets = { improved: [], declined: [], consistent: [], needsAttention: [], noSignal: [] }
  for (const [name] of METRICS) {
    const metric = metrics[name]
    if (!metric || metric.score === null) {
      report.noSignal.push(name)
      continue
    }
    if (metric.trend === '↑') report.improved.push(name)
    else if (metric.trend === '↓') report.declined.push(name)
    else if (metric.trend === '→') report.consistent.push(name)
    if (metric.score <= NEEDS_ATTENTION_MAX) report.needsAttention.push(name)
  }
  return report
}

export function buildViewDigest(
  digest: Digest,
  previous: HistoryEntry | undefined,
  usage?: RunUsage,
  days: number = previous?.days ?? 7,
  generatedAt: string = new Date().toISOString(),
): ViewDigest {
  const metrics = withTrend(digest.metrics, previous?.metrics)
  return {
    ...digest,
    metrics,
    overall: withTrend(digest.overall, previous?.overall),
    usage,
    report: buildReport(metrics),
    days,
    generatedAt,
  }
}

function formatWindowRange(generatedAtIso: string, days: number): string {
  const end = new Date(generatedAtIso)
  const start = new Date(end.getTime() - days * MS_PER_DAY)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function formatContextLine(usage: RunUsage): string {
  const sent = usage.sentContextChars.toLocaleString()
  const base =
    usage.sentContextChars === usage.rawContextChars
      ? `Context: ${sent} chars sent`
      : `Context: ${sent} of ${usage.rawContextChars.toLocaleString()} chars sent (condensed)`
  return usage.contextTruncated ? `${base} — truncated, some content dropped` : base
}

function formatDelta(delta: number | null): string {
  if (delta === null) return ''
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '±'
  return `${sign}${Math.abs(delta).toFixed(1)}`
}

const BAR_WIDTH = 20

function barText(score: number | null): string {
  if (score === null) return '░'.repeat(BAR_WIDTH)
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((score / 10) * BAR_WIDTH)))
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

function strongestMetric(metrics: Record<string, ViewMetric>): readonly [string, ViewMetric] | undefined {
  let best: readonly [string, ViewMetric] | undefined
  for (const [name] of METRICS) {
    const metric = metrics[name]
    if (!metric || metric.score === null) continue
    if (!best || metric.score > best[1].score!) best = [name, metric]
  }
  return best
}

function weakestMetric(metrics: Record<string, ViewMetric>): readonly [string, ViewMetric] | undefined {
  let worst: readonly [string, ViewMetric] | undefined
  for (const [name] of METRICS) {
    const metric = metrics[name]
    if (!metric || metric.score === null) continue
    if (!worst || metric.score < worst[1].score!) worst = [name, metric]
  }
  return worst
}

function evidenceLabel(confidence: Confidence | undefined): string {
  if (confidence === 'High') return 'Strong evidence'
  if (confidence === 'Medium') return 'Some evidence'
  if (confidence === 'Low') return 'Limited evidence'
  return 'Evidence'
}

const digestAtom = atom({ plugin: 'reasoning-review', key: 'digest' } as const, null as ViewDigest | null)
const expandedAtom = atom({ plugin: 'reasoning-review', key: 'expanded' } as const, {} as Record<string, boolean>)
const screenAtom = atom({ plugin: 'reasoning-review', key: 'screen' } as const, 'overview' as Screen)

function scoreColor(score: number | null): string {
  if (score === null) return 'subtle'
  if (score >= 8) return 'success'
  if (score >= 6) return 'text'
  if (score >= 4) return 'warning'
  return 'error'
}

function trendColor(trend: ViewMetric['trend']): string {
  if (trend === '↑') return 'success'
  if (trend === '↓') return 'error'
  return 'subtle'
}

function confidenceColor(confidence: Confidence | undefined): string {
  if (confidence === 'High') return 'success'
  if (confidence === 'Medium') return 'warning'
  if (confidence === 'Low') return 'error'
  return 'subtle'
}

function renderRow(
  { Box, Button, Text }: Elements['terminal'],
  name: string,
  metric: ViewMetric,
  isExpanded: boolean,
  toggle: () => void,
) {
  const scoreText = metric.score === null ? ' — ' : metric.score.toFixed(1).padStart(4)
  const deltaText = formatDelta(metric.delta)
  const observationCount = metric.observationCount ?? metric.evidence.length
  const DIVIDER = '─'.repeat(34)

  return (
    <Box flexDirection="column" marginBottom={1} key={name}>
      <Box flexDirection="row">
        <Button plain key={name} label={isExpanded ? '▾' : '▸'} onPress={toggle} />
        <Text> {name.padEnd(24)}</Text>
        <Text color={scoreColor(metric.score)} bold>
          {scoreText}
        </Text>
        <Text>  </Text>
        <Text color={trendColor(metric.trend)} bold>
          {metric.trend ?? ' '}
        </Text>
        {deltaText && (
          <Text color={trendColor(metric.trend)}> {deltaText}</Text>
        )}
      </Box>
      <Box marginLeft={3}>
        <Text color={scoreColor(metric.score)}>{barText(metric.score)}</Text>
      </Box>
      {isExpanded && (
        <Box flexDirection="column" marginLeft={3} marginTop={1}>
          <Text bold>Why this score?</Text>
          <Text color="subtle">{DIVIDER}</Text>
          <Box marginTop={1} flexDirection="column">
            <Text bold>{evidenceLabel(metric.confidence)}</Text>
            {metric.evidence.length === 0 && <Text dimColor>  (none recorded)</Text>}
            {metric.evidence.map(item => (
              <Text key={item} color="success">
                ✓ {item}
              </Text>
            ))}
            {metric.assessment && (
              <Text color="subtle" italic>
                {metric.assessment}
              </Text>
            )}
          </Box>
          <Text color="subtle">{DIVIDER}</Text>
          <Text>
            Previous: {metric.previousScore === null ? '—' : metric.previousScore.toFixed(1)}
            {'   '}
            Current: {metric.score === null ? '—' : metric.score.toFixed(1)}
          </Text>
          <Box marginTop={1}>
            <Text>
              {observationCount} observation{observationCount === 1 ? '' : 's'}
            </Text>
          </Box>
          <Text>
            Confidence:{' '}
            <Text color={confidenceColor(metric.confidence)} bold>
              {metric.confidence ?? '—'}
            </Text>
          </Text>
        </Box>
      )}
    </Box>
  )
}

function renderReportList({ Box, Text }: Elements['terminal'], label: string, color: string, items: string[]) {
  if (items.length === 0) return null
  return (
    <Box flexDirection="column" marginBottom={1} key={label}>
      <Text color={color} bold>
        {label}
      </Text>
      {items.map(item => (
        <Text key={item}> • {item}</Text>
      ))}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'reasoning-review',
      description: 'Scored engineering-skill assessment from your Claude Code sessions this week or month',
      argumentHint: '<week|month>',
    })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const components = $.ui.resolve(e)
    const { Box, Text, Button } = components
    const digest = await read($, digestAtom)
    const expanded = await read($, expandedAtom)
    const screen = await read($, screenAtom)

    if (!digest) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Run /reasoning-review week (or month) to generate a scorecard.</Text>
        </Box>
      )
    }

    const toggle = (name: string) => () => update($, expandedAtom, cur => ({ ...cur, [name]: !cur[name] }))
    const goToScreen = (next: Screen) => () => update($, screenAtom, () => next)
    const DIVIDER = '─'.repeat(44)
    const sectionHeader = (title: string) => (
      <Box flexDirection="column" marginTop={2} marginBottom={1}>
        <Text color="claude" bold>
          {title}
        </Text>
        <Text color="subtle">{DIVIDER}</Text>
      </Box>
    )

    if (screen === 'overview') {
      const capability = digest.overall['Engineering Capability']
      const strongest = strongestMetric(digest.metrics)
      const weakest = weakestMetric(digest.metrics)
      const whatChanged = digest.narrative ?? digest.currentSignal

      return (
        <Box flexDirection="column">
          <Text bold color="claude">
            Developer Review
          </Text>
          <Text color="subtle">{formatWindowRange(digest.generatedAt, digest.days)}</Text>

          {capability?.score !== null && (
            <Box flexDirection="column" marginTop={2}>
              <Text color="subtle">Engineering Capability</Text>
              <Box flexDirection="row">
                <Text bold color={scoreColor(capability.score)}>
                  {capability.score!.toFixed(1)}
                </Text>
                <Text>  </Text>
                <Text color={trendColor(capability.trend)} bold>
                  {capability.trend ?? ' '} {formatDelta(capability.delta)}
                </Text>
              </Box>
            </Box>
          )}

          <Box marginTop={1}>
            <Text color="subtle">{DIVIDER}</Text>
          </Box>

          {whatChanged && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>What changed</Text>
              <Text>{whatChanged}</Text>
            </Box>
          )}

          {strongest && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="success">
                Strongest
              </Text>
              <Box flexDirection="row">
                <Text>{strongest[0].padEnd(24)}</Text>
                <Text bold>{strongest[1].score!.toFixed(1)}</Text>
                <Text color={trendColor(strongest[1].trend)}> {strongest[1].trend ?? ''}</Text>
              </Box>
            </Box>
          )}

          {weakest && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="warning">
                Needs attention
              </Text>
              <Box flexDirection="row">
                <Text>{weakest[0].padEnd(24)}</Text>
                <Text bold>{weakest[1].score!.toFixed(1)}</Text>
                <Text color={trendColor(weakest[1].trend)}> {weakest[1].trend ?? ''}</Text>
              </Box>
            </Box>
          )}

          <Box marginTop={2}>
            <Button key="view-full-review" label="View full review" onPress={goToScreen('metrics')} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Button key="back-to-overview" plain label="← Overview" onPress={goToScreen('overview')} />
        </Box>

        {digest.currentSignal && (
          <Text bold color="claude">
            {digest.currentSignal}
          </Text>
        )}
        {digest.focusNext && (
          <Text>
            Focus next: <Text color="warning">{digest.focusNext}</Text>
          </Text>
        )}
        {digest.gap && (
          <Box marginTop={1}>
            <Text color="subtle">Gap to next level: {digest.gap}</Text>
          </Box>
        )}

        <Box flexDirection="column">
          {sectionHeader('Summary')}
          {renderReportList(components, 'Improved', 'success', digest.report.improved)}
          {renderReportList(components, 'Declined', 'error', digest.report.declined)}
          {renderReportList(components, 'Consistent', 'subtle', digest.report.consistent)}
          {renderReportList(components, 'Needs attention', 'warning', digest.report.needsAttention)}
          {digest.report.improved.length === 0 &&
            digest.report.declined.length === 0 &&
            digest.report.consistent.length === 0 && (
              <Text dimColor>No prior window to compare against yet — run this again next period for trends.</Text>
            )}
          {digest.report.noSignal.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="subtle">
                Insufficient evidence this window (no score given, not guessed): {digest.report.noSignal.join(', ')}
              </Text>
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          {sectionHeader('Engineering signals')}
          {METRICS.map(([name]) => digest.metrics[name])
            .map((metric, i) => (metric.score === null ? null : [METRICS[i][0], metric] as const))
            .filter((row): row is readonly [string, ViewMetric] => row !== null)
            .map(([name, metric]) => renderRow(components, name, metric, !!expanded[name], toggle(name)))}
        </Box>

        <Box flexDirection="column">
          {sectionHeader('Overall')}
          {OVERALL_KEYS.map(key => [key, digest.overall[key]] as const)
            .filter((row): row is readonly [string, ViewMetric] => row[1]?.score !== null)
            .map(([name, metric]) =>
              renderRow(components, `Overall – ${name}`, metric, !!expanded[`overall:${name}`], toggle(`overall:${name}`)),
            )}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            Level: <Text color="claude">{digest.level}</Text>
          </Text>
          <Text color="subtle">
            Bands: Junior → Mid-level → Senior → Staff → Lead/Architect. A trailing + or - means
            the evidence leans toward the next or previous band, not a clean fit for one.
          </Text>
          {digest.usage && (
            <Text color="subtle">
              Last run: {(
                digest.usage.inputTokens +
                digest.usage.cacheReadTokens +
                digest.usage.cacheCreationTokens
              ).toLocaleString()}{' '}
              input tokens ({digest.usage.cacheReadTokens.toLocaleString()} from cache,{' '}
              {digest.usage.cacheCreationTokens.toLocaleString()} newly cached),{' '}
              {digest.usage.outputTokens.toLocaleString()} output tokens
              {digest.usage.compressionCalls
                ? ` (includes ${digest.usage.compressionCalls} compression pass${
                    digest.usage.compressionCalls === 1 ? '' : 'es'
                  })`
                : ''}
            </Text>
          )}
          {digest.usage && <Text color="subtle">{formatContextLine(digest.usage)}</Text>}
        </Box>
      </Box>
    )
  })

  on('command.run', { command: 'reasoning-review' }, async ($, e) => {
    const days = windowDays(e.args)
    const cutoffMs = Date.now() - days * MS_PER_DAY
    const windowLabel = days === 30 ? 'month' : 'week'

    const root = await $.session.root()
    const home = await $.env.get('HOME')
    if (!home) return { text: 'Could not resolve your home directory; cannot read session history.' }

    const projectDir = `${home}/.claude/projects/${root.replace(/\//g, '-')}`
    const entries = await $.fs.list(projectDir).catch(() => undefined)
    if (!entries) {
      return { text: `No session history found for this project yet (looked in ${projectDir}).` }
    }

    const sessionFiles = entries
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
      .filter(entry => entry.mtimeMs >= cutoffMs)

    if (sessionFiles.length === 0) {
      return { text: `No Claude Code activity on this project in the last ${windowLabel}.` }
    }

    const sessionBlocks: SessionBlock[] = []
    for (const file of sessionFiles) {
      const lines = await readSessionLines($, `${projectDir}/${file.name}`, cutoffMs)
      if (lines.length === 0) continue
      sessionBlocks.push({ id: file.name.replace('.jsonl', ''), lines })
    }

    if (sessionBlocks.length === 0) {
      return { text: `No Claude Code activity on this project in the last ${windowLabel}.` }
    }

    let transcript = sessionBlocks.map(blockText).join('\n')
    const rawContextChars = transcript.length
    let note = ''
    let contextTruncated = false
    const compressionUsages: ModelUsage[] = []

    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      const chunks = chunkSessions(sessionBlocks, COMPRESSION_CHUNK_CHARS)
      const compressedResults = await Promise.all(chunks.map(chunk => compressChunk($, chunk)))
      for (const r of compressedResults) if (r) compressionUsages.push(r.usage)

      const { transcript: assembled, fellBackCount } = buildWindowTranscript(
        chunks,
        compressedResults.map(r => r?.text),
      )
      transcript = assembled

      if (fellBackCount > 0) {
        note = `\n\n(Note: ${fellBackCount} of ${chunks.length} window segments could not be condensed and are included in full.)`
      }

      if (transcript.length > MAX_TRANSCRIPT_CHARS) {
        transcript = transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS)
        contextTruncated = true
        note =
          '\n\n(Note: the window held more conversation than fits here even after condensing; this covers the most recent portion of it.)'
      }
    }

    const projectName = root.split('/').filter(Boolean).at(-1) ?? root
    const windowBlock = `Project: ${projectName}
Window: last ${windowLabel} (${days} days)
${note}

Transcript:
${transcript}`

    let result: Awaited<ReturnType<EngineInterface['model']['complete']>>
    try {
      result = await $.model.complete({
        model: await $.session.model(),
        prompt: [
          { text: RUBRIC_PROMPT, cache: true },
          { text: windowBlock },
        ],
        effort: 'high',
        maxTokens: 8000,
        timeoutMs: 180_000,
      })
    } catch (err) {
      if (!isModelCompleteHostCheckFailure(err)) throw err
      return { text: HOST_VERSION_MESSAGE }
    }

    if (!result.isAnswered) {
      return { text: `Couldn't generate the assessment right now (${result.reason}). Try again shortly.` }
    }

    const digest = parseDigest(result.text)
    if (!digest) {
      return { text: "Couldn't parse the model's assessment this time — try again." }
    }

    const usage = sumUsage(compressionUsages, result.usage, {
      rawContextChars,
      sentContextChars: transcript.length,
      contextTruncated,
    })

    const historyKey = `history:${root}:${days}`
    const entry: HistoryEntry = { timestamp: new Date().toISOString(), days, ...digest }
    const existingHistory = await $.store.get(historyKey).catch(() => undefined)
    const priorHistory = Array.isArray(existingHistory) ? (existingHistory as HistoryEntry[]) : []
    const previous = priorHistory.at(-1)
    const updatedHistory = [...priorHistory, entry].slice(-24)
    await $.store.set(historyKey, updatedHistory).catch(() => undefined)

    const viewDigest = buildViewDigest(digest, previous, usage, days, entry.timestamp)
    await update($, digestAtom, () => viewDigest)
    await update($, screenAtom, () => 'overview')
    // `focus: true` is the fix: without it the pane opens but never gets the keyboard, so the
    // arrow keys that scroll a tall tree (the Metrics screen) never reach it. `rows` requests more
    // than the pane's default third of the terminal, since that default routinely wasn't enough.
    await $.ui.open({ id: PANE, title: 'Reasoning Review', focus: true, rows: PANE_ROWS })

    const totalInputTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens
    const compressionClause = usage.compressionCalls
      ? ` (includes ${usage.compressionCalls} compression pass${usage.compressionCalls === 1 ? '' : 'es'})`
      : ''
    const usageLine = `Tokens: ${totalInputTokens.toLocaleString()} in (${usage.cacheReadTokens.toLocaleString()} cached, ${usage.cacheCreationTokens.toLocaleString()} newly cached), ${usage.outputTokens.toLocaleString()} out${compressionClause}`

    return {
      text: `Scorecard updated for the last ${windowLabel} — see the "Reasoning Review" pane.\nCurrent signal: ${digest.currentSignal ?? digest.level}\n${usageLine}\n${formatContextLine(usage)}`,
    }
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : {
          text: `/reasoning-review hit an unexpected error and could not finish: ${next.error.message ?? next.error.kind}`,
        },
  )
}
