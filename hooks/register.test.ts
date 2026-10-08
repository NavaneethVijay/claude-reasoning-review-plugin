import { test, expect, mock } from 'claude-code/testing'

import { buildViewDigest, parseDigest, trendOf } from './register'

const PROJECT_DIR = '/home/test/.claude/projects/-work-project'

const METRIC_NAMES = [
  'Technical Knowledge',
  'Problem Solving',
  'Debugging',
  'Architecture',
  'System Design',
  'Code Quality',
  'Testing',
  'Security & Performance',
  'Decision Making',
  'Requirements',
  'Engineering Judgment',
  'AI Collaboration',
] as const

function emptyMetric() {
  return { score: null as number | null, evidence: [] as string[] }
}

function buildDigest(overrides: { architecture?: number; debugging?: number } = {}) {
  const metrics: Record<string, { score: number | null; evidence: string[]; assessment?: string }> = {}
  for (const name of METRIC_NAMES) metrics[name] = emptyMetric()
  metrics.Architecture = {
    score: overrides.architecture ?? 8,
    evidence: ['Challenged the proposed abstraction before implementation.'],
    assessment: 'Strong senior-level architectural reasoning.',
  }
  metrics.Debugging = {
    score: overrides.debugging ?? 6.9,
    evidence: ['Started implementing a fix before establishing the failure boundary.'],
    assessment: 'Jumps to implementation too quickly.',
  }

  return {
    metrics,
    overall: {
      'Engineering Capability': { score: 7.5, evidence: ['...'] },
      'Engineering Judgment': { score: 7.2, evidence: ['...'] },
      'AI Agency': { score: 8, evidence: ['...'] },
    },
    level: 'Senior',
    levelConfidence: 'Medium',
    gap: 'Show root-cause debugging before reaching for a fix.',
    narrative: "You're getting better at challenging Claude's architectural suggestions.",
    currentSignal: 'Strong Senior, showing Staff-level architecture behaviour.',
    focusNext: 'Root-cause debugging.',
  }
}

function mockSessionWithOneMessage(on: any) {
  const now = new Date().toISOString()
  const jsonl = JSON.stringify({
    type: 'user',
    isSidechain: false,
    timestamp: now,
    message: { role: 'user', content: 'why does this caching layer invalidate on write?' },
  })
  on('fs.list', () => ({
    value: [{ name: 'abc.jsonl', kind: 'file', size: jsonl.length, mtimeMs: Date.now(), isLink: false }],
  }))
  on('fs.read', () => ({ value: jsonl }))
}

function mockSessionWithCommandInvocationNoise(on: any) {
  const now = new Date().toISOString()
  const lines = [
    JSON.stringify({
      type: 'user',
      isSidechain: false,
      timestamp: now,
      message: { role: 'user', content: 'why does this caching layer invalidate on write?' },
    }),
    JSON.stringify({
      type: 'user',
      isSidechain: false,
      timestamp: now,
      message: {
        role: 'user',
        content: '<command-name>/reasoning-review</command-name>\n<command-args>week</command-args>',
      },
    }),
  ]
  const jsonl = lines.join('\n')
  on('fs.list', () => ({
    value: [{ name: 'abc.jsonl', kind: 'file', size: jsonl.length, mtimeMs: Date.now(), isLink: false }],
  }))
  on('fs.read', () => ({ value: jsonl }))
}

// --- pure-function unit tests (no engine needed) ---

test('parseDigest reads a clean JSON object', () => {
  const digest = parseDigest(JSON.stringify(buildDigest()))
  expect(digest?.level).toBe('Senior')
  expect(digest?.metrics.Architecture.score).toBe(8)
  expect(digest?.metrics.Testing.score).toBe(null)
})

test('parseDigest reads JSON wrapped in a stray code fence', () => {
  const digest = parseDigest(`here you go:\n\`\`\`json\n${JSON.stringify(buildDigest())}\n\`\`\``)
  expect(digest?.level).toBe('Senior')
})

test('parseDigest returns undefined for prose with no JSON', () => {
  expect(parseDigest('sorry, here is a paragraph instead of json')).toBeUndefined()
})

test('trendOf compares against the previous score with a dead zone', () => {
  expect(trendOf(8.2, 7.0)).toBe('↑')
  expect(trendOf(6.9, 7.4)).toBe('↓')
  expect(trendOf(7.5, 7.52)).toBe('→')
  expect(trendOf(7.5, undefined)).toBe(null)
  expect(trendOf(null, 7.5)).toBe(null)
})

test('buildViewDigest attaches a trend per metric and overall score', () => {
  const previous = { ...buildDigest({ architecture: 7, debugging: 7.4 }), timestamp: 't', days: 7 }
  const current = buildDigest({ architecture: 8.2, debugging: 6.9 })

  const view = buildViewDigest(current, previous)

  expect(view.metrics.Architecture.trend).toBe('↑')
  expect(view.metrics.Debugging.trend).toBe('↓')
  expect(view.metrics.Testing.trend).toBe(null)
  expect(view.overall['Engineering Capability'].trend).toBe('→')
})

test('buildViewDigest buckets metrics into improved/declined/consistent/needsAttention/noSignal', () => {
  const previous = { ...buildDigest({ architecture: 7, debugging: 7.4 }), timestamp: 't', days: 7 }
  const current = buildDigest({ architecture: 8.2, debugging: 3.9 })

  const view = buildViewDigest(current, previous)

  expect(view.report.improved).toEqual(['Architecture'])
  expect(view.report.declined).toEqual(['Debugging'])
  expect(view.report.needsAttention).toEqual(['Debugging'])
  expect(view.report.noSignal).toContain('Testing')
  expect(view.report.noSignal).not.toContain('Architecture')
})

test('buildViewDigest leaves movement buckets empty with no prior history, but still flags needsAttention', () => {
  const current = buildDigest({ architecture: 8.2, debugging: 3.9 })

  const view = buildViewDigest(current, undefined)

  expect(view.report.improved).toEqual([])
  expect(view.report.declined).toEqual([])
  expect(view.report.consistent).toEqual([])
  expect(view.report.needsAttention).toEqual(['Debugging'])
})

test('toMetricEntry-via-parseDigest preserves confidence and observationCount, ignoring confidence on a null score', () => {
  const raw = {
    ...buildDigest(),
    metrics: {
      ...buildDigest().metrics,
      Architecture: {
        score: 8,
        evidence: ['a', 'b', 'c'],
        confidence: 'High',
        observationCount: 3,
      },
      Testing: {
        score: null,
        evidence: [],
        confidence: 'High', // bogus: must be dropped since score is null
      },
    },
  }

  const digest = parseDigest(JSON.stringify(raw))

  expect(digest?.metrics.Architecture.confidence).toBe('High')
  expect(digest?.metrics.Architecture.observationCount).toBe(3)
  expect(digest?.metrics.Testing.confidence).toBeUndefined()
})

// --- engine-level tests ---

test('registers the /reasoning-review command on session start', async ($, on) => {
  mock.env(on, {})
  let registeredName: string | undefined
  on('command.register', ($, e) => {
    registeredName = e.name
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })

  expect(registeredName).toBe('reasoning-review')
})

test('reports no activity when the project has no recent sessions', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('fs.list', ($, e) => {
    expect(e.path).toBe(PROJECT_DIR)
    return { value: [] }
  })

  const result = await $.command.run({ command: 'reasoning-review', args: 'week' })

  expect(result.text).toContain('No Claude Code activity')
})

test('parses the digest and opens the pane', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  mockSessionWithOneMessage(on)

  const digest = buildDigest()
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: JSON.stringify(digest),
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))

  let opened: string | undefined
  on('ui.open', ($, e) => {
    opened = e.id
    return { value: { isPlaced: true } }
  })

  const result = await $.command.run({ command: 'reasoning-review', args: 'week' })

  expect(opened).toBe('reasoning-review')
  expect(result.text).toContain('Reasoning Review')
  expect(result.text).toContain('Strong Senior, showing Staff-level architecture behaviour.')
})

test('excludes its own slash-command invocations from the evidence it sends the model', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mockSessionWithCommandInvocationNoise(on)

  let promptSeen = ''
  on('model.complete', ($, e) => {
    promptSeen = typeof e.prompt === 'string' ? e.prompt : ''
    return {
      value: {
        isAnswered: true,
        text: JSON.stringify(buildDigest()),
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })

  await $.command.run({ command: 'reasoning-review', args: 'week' })

  expect(promptSeen).toContain('why does this caching layer invalidate on write?')
  expect(promptSeen).not.toContain('command-name')
})

test('runs twice in a row without error (persistence path)', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project-trend' }))
  on('session.model', () => ({ value: 'sonnet' }))
  mockSessionWithOneMessage(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const digests = [
    buildDigest({ architecture: 7, debugging: 7.4 }),
    buildDigest({ architecture: 8.2, debugging: 6.9 }),
  ]
  let call = 0
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: JSON.stringify(digests[call++]),
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))

  const first = await $.command.run({ command: 'reasoning-review', args: 'week' })
  expect(first.text).toContain('Reasoning Review')

  const second = await $.command.run({ command: 'reasoning-review', args: 'week' })
  expect(second.text).toContain('Reasoning Review')
})

test('falls back gracefully when the model does not return valid JSON', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  mockSessionWithOneMessage(on)

  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: 'sorry, here is a paragraph instead of json',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))

  const result = await $.command.run({ command: 'reasoning-review', args: 'week' })

  expect(result.text).toContain("Couldn't parse")
})

const PANE_PROPS = {
  title: 'Reasoning Review',
  isFocused: false,
  bodyColumns: 80,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('pane shows a placeholder before any scorecard has run', async $ => {
  const ui = await $.ui.mount({
    plugin: 'reasoning-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'reasoning-review',
    props: PANE_PROPS,
  })

  expect(await ui.find({ text: /Run \/reasoning-review/ })).toBeTruthy()
})

test('populated pane opens on the Overview screen with a headline score and strongest/weakest callouts', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mockSessionWithOneMessage(on)

  const digest = buildDigest()
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: JSON.stringify(digest),
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))

  await $.command.run({ command: 'reasoning-review', args: 'week' })

  const ui = await $.ui.mount({
    plugin: 'reasoning-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'reasoning-review',
    props: PANE_PROPS,
  })

  expect(await ui.find({ text: /Developer Review/ })).toBeTruthy()
  expect(await ui.find({ text: /Engineering Capability/ })).toBeTruthy()
  expect(await ui.find({ text: /Strongest/ })).toBeTruthy()
  expect(await ui.find({ text: /Needs attention/ })).toBeTruthy()
  // The Metrics screen's content isn't rendered until navigated to.
  expect(await ui.find({ text: /Challenged the proposed abstraction/ })).toBeFalsy()
})

test('populated pane navigates into Metrics, shows rows collapsed, and expands evidence on press', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mockSessionWithOneMessage(on)

  const digest = buildDigest()
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: JSON.stringify(digest),
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))

  await $.command.run({ command: 'reasoning-review', args: 'week' })

  const ui = await $.ui.mount({
    plugin: 'reasoning-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'reasoning-review',
    props: PANE_PROPS,
  })

  await ui.press({ key: 'view-full-review' })

  expect(await ui.find({ text: /Architecture/ })).toBeTruthy()
  expect(await ui.find({ text: /Challenged the proposed abstraction/ })).toBeFalsy()
  expect(await ui.find({ text: /leans toward the next or previous band/ })).toBeTruthy()

  await ui.press({ key: 'Architecture' })

  expect(await ui.find({ text: /Challenged the proposed abstraction/ })).toBeTruthy()
  expect(await ui.find({ text: /Why this score\?/ })).toBeTruthy()

  await ui.press({ key: 'back-to-overview' })

  expect(await ui.find({ text: /Developer Review/ })).toBeTruthy()
})

// --- adaptive compression (oversized windows) ---

function usage(inputTokens: number, outputTokens: number) {
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }
}

function promptText(prompt: unknown): string {
  return Array.isArray(prompt) ? prompt.map((b: { text: string }) => b.text).join('\n') : String(prompt)
}

// One message whose content alone is `charCount` characters, prefixed with `marker` so a
// compression mock can identify which session/chunk it came from.
function makeOneBigMessageFile(marker: string, charCount: number) {
  const now = new Date().toISOString()
  const padding = 'lorem ipsum filler text '.repeat(Math.ceil(charCount / 24)).slice(0, charCount - marker.length - 1)
  const content = `${marker} ${padding}`
  return JSON.stringify({ type: 'user', isSidechain: false, timestamp: now, message: { role: 'user', content } })
}

// A single session with many short lines, so a chunker that sub-splits a too-big session does so
// between lines, not mid-line. `markerStart`/`markerEnd` tag the first and last line.
function makeManyLineSessionFile(markerStart: string, markerEnd: string, lineCount: number, lineChars: number) {
  const now = new Date().toISOString()
  const lines: string[] = []
  for (let i = 0; i < lineCount; i++) {
    const label = i === 0 ? markerStart : i === lineCount - 1 ? markerEnd : `filler-${i}`
    const content = `${label} ${'z'.repeat(Math.max(0, lineChars - label.length - 1))}`
    lines.push(JSON.stringify({ type: 'user', isSidechain: false, timestamp: now, message: { role: 'user', content } }))
  }
  return lines.join('\n')
}

function mockMultiSessionFiles(on: any, files: { name: string; jsonl: string }[]) {
  on('fs.list', () => ({
    value: files.map(f => ({ name: f.name, kind: 'file', size: f.jsonl.length, mtimeMs: Date.now(), isLink: false })),
  }))
  on('fs.read', ($: unknown, e: { path: string }) => {
    const name = e.path.split('/').pop()
    return { value: files.find(f => f.name === name)?.jsonl ?? '' }
  })
}

const MARKERS = ['EARLY_MARKER', 'MID_MARKER_1', 'MID_MARKER_2', 'LATE_MARKER']

function mockFourOversizedSessions(on: any) {
  mockMultiSessionFiles(
    on,
    MARKERS.map((marker, i) => ({ name: `${String.fromCharCode(97 + i)}.jsonl`, jsonl: makeOneBigMessageFile(marker, 50_000) })),
  )
}

test('compresses an oversized window and keeps evidence from both the earliest and latest session', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mockFourOversizedSessions(on)

  let compressionCalls = 0
  let finalPrompt = ''
  on('model.complete', ($, e) => {
    const text = promptText(e.prompt)
    if (e.model === 'haiku') {
      compressionCalls++
      const marker = MARKERS.find(m => text.includes(m)) ?? 'NONE'
      return { value: { isAnswered: true, text: `Human: condensed excerpt preserving ${marker}`, usage: usage(10, 5) } }
    }
    finalPrompt = text
    return { value: { isAnswered: true, text: JSON.stringify(buildDigest()), usage: usage(20, 10) } }
  })

  const result = await $.command.run({ command: 'reasoning-review', args: 'week' })

  expect(compressionCalls).toBeGreaterThan(0)
  expect(finalPrompt).toContain('EARLY_MARKER')
  expect(finalPrompt).toContain('LATE_MARKER')
  expect(result.text).toContain('Reasoning Review')
})

test('sub-chunks a single session that alone exceeds the chunk budget, preserving order', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mockMultiSessionFiles(on, [
    { name: 'giant.jsonl', jsonl: makeManyLineSessionFile('EARLY_IN_SESSION', 'LATE_IN_SESSION', 50, 5000) },
  ])

  let compressionCalls = 0
  let finalPrompt = ''
  on('model.complete', ($, e) => {
    const text = promptText(e.prompt)
    if (e.model === 'haiku') {
      compressionCalls++
      const marker = text.includes('EARLY_IN_SESSION')
        ? 'EARLY_IN_SESSION'
        : text.includes('LATE_IN_SESSION')
          ? 'LATE_IN_SESSION'
          : 'MIDDLE'
      return { value: { isAnswered: true, text: `Human: condensed excerpt preserving ${marker}`, usage: usage(10, 5) } }
    }
    finalPrompt = text
    return { value: { isAnswered: true, text: JSON.stringify(buildDigest()), usage: usage(20, 10) } }
  })

  await $.command.run({ command: 'reasoning-review', args: 'week' })

  expect(compressionCalls).toBeGreaterThan(1)
  const earlyIndex = finalPrompt.indexOf('EARLY_IN_SESSION')
  const lateIndex = finalPrompt.indexOf('LATE_IN_SESSION')
  expect(earlyIndex).toBeGreaterThan(-1)
  expect(lateIndex).toBeGreaterThan(-1)
  expect(earlyIndex).toBeLessThan(lateIndex)
})

test('falls back to a chunk\'s raw text when its compression call fails, and still completes', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mockFourOversizedSessions(on)

  let finalPrompt = ''
  on('model.complete', ($, e) => {
    const text = promptText(e.prompt)
    if (e.model === 'haiku') {
      if (text.includes('MID_MARKER_1')) return { value: { isAnswered: false, reason: 'api-error' } }
      const marker = MARKERS.find(m => text.includes(m)) ?? 'NONE'
      return { value: { isAnswered: true, text: `Human: condensed excerpt preserving ${marker}`, usage: usage(10, 5) } }
    }
    finalPrompt = text
    return { value: { isAnswered: true, text: JSON.stringify(buildDigest()), usage: usage(20, 10) } }
  })

  const result = await $.command.run({ command: 'reasoning-review', args: 'week' })

  expect(result.text).toContain('Reasoning Review')
  expect(result.text).not.toContain('unexpected error')
  // the failed chunk's own raw (uncompressed) text survives, marker and all
  expect(finalPrompt).toContain('MID_MARKER_1')
  // the other three chunks were condensed rather than kept raw
  expect(finalPrompt).toContain('EARLY_MARKER')
  expect(finalPrompt).toContain('LATE_MARKER')
})

test('aggregates token usage across all compression calls plus the final call', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mockFourOversizedSessions(on)

  on('model.complete', ($, e) => {
    if (e.model === 'haiku') {
      return { value: { isAnswered: true, text: 'Human: condensed excerpt.', usage: usage(100, 20) } }
    }
    return { value: { isAnswered: true, text: JSON.stringify(buildDigest()), usage: usage(500, 200) } }
  })

  const result = await $.command.run({ command: 'reasoning-review', args: 'week' })

  // 4 compression calls @ 100 in / 20 out, plus 1 final call @ 500 in / 200 out
  expect(result.text).toContain('900 in')
  expect(result.text).toContain('280 out')
  expect(result.text).toContain('includes 4 compression passes')
})

test("uses the session's own model for the final scoring call, while compression stays on haiku", async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'opus' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mockFourOversizedSessions(on)

  const modelsSeen: string[] = []
  on('model.complete', ($, e) => {
    modelsSeen.push(e.model)
    if (typeof e.prompt === 'string') {
      return { value: { isAnswered: true, text: 'Human: condensed excerpt.', usage: usage(10, 5) } }
    }
    return { value: { isAnswered: true, text: JSON.stringify(buildDigest()), usage: usage(20, 10) } }
  })

  await $.command.run({ command: 'reasoning-review', args: 'week' })

  expect(modelsSeen.filter(m => m === 'haiku').length).toBe(4)
  expect(modelsSeen.filter(m => m === 'opus').length).toBe(1)
})

test('reports context length sent vs. raw when nothing needed compressing', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mockSessionWithOneMessage(on)

  on('model.complete', () => ({
    value: { isAnswered: true, text: JSON.stringify(buildDigest()), usage: usage(20, 10) },
  }))

  const result = await $.command.run({ command: 'reasoning-review', args: 'week' })

  expect(result.text).toMatch(/Context: [\d,]+ chars sent/)
  expect(result.text).not.toContain('condensed')
})

test('reports a smaller sent length than raw length when the window was condensed', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mockFourOversizedSessions(on)

  on('model.complete', ($, e) => {
    if (e.model === 'haiku') {
      return { value: { isAnswered: true, text: 'Human: condensed excerpt.', usage: usage(10, 5) } }
    }
    return { value: { isAnswered: true, text: JSON.stringify(buildDigest()), usage: usage(20, 10) } }
  })

  const result = await $.command.run({ command: 'reasoning-review', args: 'week' })

  expect(result.text).toMatch(/Context: [\d,]+ of [\d,]+ chars sent \(condensed\)/)
})
