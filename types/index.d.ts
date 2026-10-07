export type MetricEntry = {
  score: number | null
  evidence: string[]
  assessment?: string
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

export type ViewMetric = MetricEntry & { trend: Trend }

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
}

declare module 'claude-code' {
  interface PluginState {
    'reasoning-review': {
      digest: ViewDigest | null
      expanded: Record<string, boolean>
    }
  }
}
