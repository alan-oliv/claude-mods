// resetIn is stored formatted, so a card redraws once a minute rather than on every refresh.
export type LimitWindow = { percent: number; resetIn: string | null }

export type Snapshot = {
  title: string | null
  branch: string | null
  model: string
  effort: string | null
  context: { tokens: number; window: number; percent: number }
  limits: { fiveHour: LimitWindow | null; sevenDay: LimitWindow | null }
  costUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-cards': { snapshot: Snapshot | null }
  }
}
