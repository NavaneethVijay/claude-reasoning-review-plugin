import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { Digest, HistoryEntry, MetricEntry, RunUsage, ViewDigest, ViewMetric } from '../types'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_TRANSCRIPT_CHARS = 180_000
const PANE = 'reasoning-review'
const TREND_EPSILON = 0.4

const METRICS = [
  ['Technical Knowledge', 'Understands concepts, internals, APIs, constraints; can explain why'],
  ['Problem Solving', 'Decomposes problems, investigates, forms hypotheses, validates'],
  ['Debugging', 'Uses evidence, isolates root causes, avoids random fixes'],
  ['Architecture', 'Boundaries, coupling, scalability, extensibility, failure modes'],
  ['System Design', 'Data flow, APIs, state, reliability, observability, trade-offs'],
  ['Code Quality', 'Simplicity, maintainability, correctness, consistency'],
  ['Testing', 'Identifies meaningful test boundaries and failure scenarios'],
  ['Security & Performance', 'Recognizes relevant risks without blindly optimizing'],
  ['Decision Making', 'Compares alternatives and makes context-appropriate decisions'],
  ['Requirements', 'Identifies ambiguity, assumptions and missing requirements'],
  ['Engineering Judgment', 'Knows what not to build and when to accept trade-offs'],
  ['AI Collaboration', 'Uses AI effectively while retaining technical ownership'],
] as const

const OVERALL_KEYS = ['Engineering Capability', 'Engineering Judgment', 'AI Agency'] as const

const RUBRIC_PROMPT = `You are assessing ONE developer's engineering ability, as evidenced ONLY by
how they reasoned while working with Claude Code on this project over the window described below.
This is self-facing only — nobody but the person running this ever sees it. It is not a productivity
report: ignore activity volume entirely (session count, message count, lines of code, how fast
anything happened).

Score the following 12 metrics, each 0–10:

${METRICS.map(([name, desc]) => `- ${name}: ${desc}`).join('\n')}

Then three overall scores, each 0–10:

- Engineering Capability — raw technical strength: depth across Technical Knowledge, Problem
  Solving, Debugging, Architecture, System Design.
- Engineering Judgment — quality of decisions: Decision Making, Requirements, Engineering
  Judgment, Security & Performance, knowing what not to build.
- AI Agency — 10 means fully independent (the person did the reasoning, verified Claude's claims,
  pushed back, redirected or overrode Claude where warranted); 0 means fully dependent (accepted
  Claude's suggestions, architecture and conclusions without independently reasoning about or
  challenging them). This is the axis that most distinguishes someone genuinely operating at
  Senior/Staff/Lead level from someone whose output looks senior only because Claude did the
  thinking.

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
   never involves a debugging session, give that metric a null score rather than guessing low.
3. Ground every non-null score in specific, concrete moments from the transcript — aggregate every
   relevant moment across every session in the window, not just one. A score with no evidence is
   not acceptable.
4. Don't just threshold an average score into a level bucket — a current level like "Senior+" or
   "Staff-" is fine when the evidence is genuinely mixed between two bands. Weigh AI Agency
   explicitly: a high Engineering Capability score paired with a low AI Agency score should pull
   the level down, not just average out.

Respond with ONLY one JSON object, no prose before or after it, no markdown code fence, matching
exactly this shape (use these exact keys; a metric with no evidence gets "score": null and
"evidence": []):

{
  "metrics": {
    ${METRICS.map(([name]) => `"${name}": { "score": <number 0-10 or null>, "evidence": ["<concrete, specific observation>", "..."], "assessment": "<one short line>" }`).join(',\n    ')}
  },
  "overall": {
    "Engineering Capability": { "score": <number 0-10 or null>, "evidence": ["..."] },
    "Engineering Judgment": { "score": <number 0-10 or null>, "evidence": ["..."] },
    "AI Agency": { "score": <number 0-10 or null>, "evidence": ["..."] }
  },
  "level": "<e.g. 'Senior', 'Senior+', 'Staff-'>",
  "levelConfidence": "Low" | "Medium" | "High",
  "gap": "<specific, concrete behaviour that would need to show up to justify the next band up>",
  "narrative": "<2-4 sentences, second person, noting one improving pattern AND one thing to work on, each grounded in a specific moment from the transcript>",
  "currentSignal": "<short phrase, e.g. 'Strong Senior, showing Staff-level architecture behaviour'>",
  "focusNext": "<short phrase naming the single most useful thing to work on next>"
}`

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

function toMetricEntry(raw: unknown): MetricEntry {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const score = typeof obj.score === 'number' && Number.isFinite(obj.score) ? obj.score : null
  const evidence = Array.isArray(obj.evidence) ? obj.evidence.filter((x): x is string => typeof x === 'string') : []
  const assessment = typeof obj.assessment === 'string' ? obj.assessment : undefined
  return { score, evidence, assessment }
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
    viewed[name] = { ...entry, trend: trendOf(entry.score, previous?.[name]?.score) }
  }
  return viewed
}

export function buildViewDigest(
  digest: Digest,
  previous: HistoryEntry | undefined,
  usage?: RunUsage,
): ViewDigest {
  return {
    ...digest,
    metrics: withTrend(digest.metrics, previous?.metrics),
    overall: withTrend(digest.overall, previous?.overall),
    usage,
  }
}

const digestAtom = atom({ plugin: 'reasoning-review', key: 'digest' } as const, null as ViewDigest | null)
const expandedAtom = atom({ plugin: 'reasoning-review', key: 'expanded' } as const, {} as Record<string, boolean>)

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

function renderRow(
  { Box, Button, Text }: Elements['terminal'],
  name: string,
  metric: ViewMetric,
  isExpanded: boolean,
  toggle: () => void,
) {
  const scoreText = metric.score === null ? ' — ' : metric.score.toFixed(1).padStart(4)

  return (
    <Box flexDirection="column" marginBottom={1} key={name}>
      <Box flexDirection="row">
        <Button plain key={name} label={isExpanded ? '▾' : '▸'} onPress={toggle} />
        <Text> {name.padEnd(26)}</Text>
        <Text color={scoreColor(metric.score)} bold>
          {scoreText}
        </Text>
        <Text>  </Text>
        <Text color={trendColor(metric.trend)} bold>
          {metric.trend ?? ' '}
        </Text>
      </Box>
      {isExpanded && (
        <Box flexDirection="column" marginLeft={3} marginTop={1}>
          <Text color="subtle">Evidence from recent tasks</Text>
          {metric.evidence.length === 0 && <Text dimColor>  (none recorded)</Text>}
          {metric.evidence.map(item => (
            <Text key={item}>• {item}</Text>
          ))}
          {metric.assessment && (
            <Text color="subtle" italic>
              {metric.assessment}
            </Text>
          )}
        </Box>
      )}
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
    const { Box, Text } = components
    const digest = await read($, digestAtom)
    const expanded = await read($, expandedAtom)

    if (!digest) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Run /reasoning-review week (or month) to generate a scorecard.</Text>
        </Box>
      )
    }

    const toggle = (name: string) => () => update($, expandedAtom, cur => ({ ...cur, [name]: !cur[name] }))
    const DIVIDER = '─'.repeat(44)
    const sectionHeader = (title: string) => (
      <Box flexDirection="column" marginTop={2} marginBottom={1}>
        <Text color="claude" bold>
          {title}
        </Text>
        <Text color="subtle">{DIVIDER}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
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
        {digest.narrative && (
          <Box marginTop={1}>
            <Text>{digest.narrative}</Text>
          </Box>
        )}
        {digest.gap && (
          <Box marginTop={1}>
            <Text color="subtle">Gap to next level: {digest.gap}</Text>
          </Box>
        )}

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
            </Text>
          )}
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

    const allLines: string[] = []
    for (const file of sessionFiles) {
      const lines = await readSessionLines($, `${projectDir}/${file.name}`, cutoffMs)
      if (lines.length === 0) continue
      allLines.push(`--- session ${file.name.replace('.jsonl', '')} ---`, ...lines)
    }

    if (allLines.length === 0) {
      return { text: `No Claude Code activity on this project in the last ${windowLabel}.` }
    }

    let transcript = allLines.join('\n')
    let truncatedNote = ''
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      transcript = transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS)
      truncatedNote =
        '\n\n(Note: the window held more conversation than fits here; this covers the most recent portion of it.)'
    }

    const projectName = root.split('/').filter(Boolean).at(-1) ?? root
    const windowBlock = `Project: ${projectName}
Window: last ${windowLabel} (${days} days)
${truncatedNote}

Transcript:
${transcript}`

    const result = await $.model.complete({
      model: 'sonnet',
      prompt: [
        { text: RUBRIC_PROMPT, cache: true },
        { text: windowBlock },
      ],
      effort: 'high',
      maxTokens: 8000,
      timeoutMs: 180_000,
    })

    if (!result.isAnswered) {
      return { text: `Couldn't generate the assessment right now (${result.reason}). Try again shortly.` }
    }

    const digest = parseDigest(result.text)
    if (!digest) {
      return { text: "Couldn't parse the model's assessment this time — try again." }
    }

    const usage: RunUsage = {
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheReadTokens: result.usage.cache_read_input_tokens,
      cacheCreationTokens: result.usage.cache_creation_input_tokens,
    }

    const historyKey = `history:${root}:${days}`
    const entry: HistoryEntry = { timestamp: new Date().toISOString(), days, ...digest }
    const existingHistory = await $.store.get(historyKey).catch(() => undefined)
    const priorHistory = Array.isArray(existingHistory) ? (existingHistory as HistoryEntry[]) : []
    const previous = priorHistory.at(-1)
    const updatedHistory = [...priorHistory, entry].slice(-24)
    await $.store.set(historyKey, updatedHistory).catch(() => undefined)

    const viewDigest = buildViewDigest(digest, previous, usage)
    await update($, digestAtom, () => viewDigest)
    await $.ui.open({ id: PANE, title: 'Reasoning Review' })

    const totalInputTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens
    const usageLine = `Tokens: ${totalInputTokens.toLocaleString()} in (${usage.cacheReadTokens.toLocaleString()} cached, ${usage.cacheCreationTokens.toLocaleString()} newly cached), ${usage.outputTokens.toLocaleString()} out`

    return {
      text: `Scorecard updated for the last ${windowLabel} — see the "Reasoning Review" pane.\nCurrent signal: ${digest.currentSignal ?? digest.level}\n${usageLine}`,
    }
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : {
          text: `/reasoning-review hit an unexpected error and could not finish: ${next.error.message ?? next.error.kind}`,
        },
  )
}
