export type Confidence = 'High' | 'Medium' | 'Low'

export type MetricEntry = {
  score: number | null
  evidence: string[]
  assessment?: string
  confidence?: Confidence
  observationCount?: number
}

export type Digest = {
  metrics: Record<string, MetricEntry>
  overall: Record<string, MetricEntry>
  level: string
  levelConfidence?: string
  gap?: string
  narrative?: string
  currentSignal?: string
  focusNext?: string
}

export type HistoryEntry = Digest & { timestamp: string; days: number }

export type Trend = '↑' | '↓' | '→' | null

export type ViewMetric = MetricEntry & { trend: Trend; delta: number | null; previousScore: number | null }

export type ReportBuckets = {
  improved: string[]
  declined: string[]
  consistent: string[]
  needsAttention: string[]
  noSignal: string[]
}

export type RunUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export type ViewDigest = {
  metrics: Record<string, ViewMetric>
  overall: Record<string, ViewMetric>
  level: string
  levelConfidence?: string
  gap?: string
  narrative?: string
  currentSignal?: string
  focusNext?: string
  usage?: RunUsage
  report: ReportBuckets
  generatedAt: string
  days: number
}

export type Screen = 'overview' | 'metrics'

declare module 'claude-code' {
  interface PluginState {
    'reasoning-review': {
      digest: ViewDigest | null
      expanded: Record<string, boolean>
      screen: Screen
    }
  }
}
