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

test('runs twice in a row without error (persistence path)', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project-trend' }))
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

test('populated pane shows rows collapsed, and expands evidence on press', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/work/project' }))
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

  expect(await ui.find({ text: /Architecture/ })).toBeTruthy()
  expect(await ui.find({ text: /Challenged the proposed abstraction/ })).toBeFalsy()
  expect(await ui.find({ text: /leans toward the next or previous band/ })).toBeTruthy()

  await ui.press({ key: 'Architecture' })

  expect(await ui.find({ text: /Challenged the proposed abstraction/ })).toBeTruthy()
})
