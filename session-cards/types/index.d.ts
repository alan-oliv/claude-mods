// resetIn is stored formatted, so a card redraws once a minute rather than on every refresh.
export type LimitWindow = { percent: number; resetIn: string | null }

export type DiffStat = { files: number; added: number; removed: number }

export type Snapshot = {
  title: string | null
  folder: string | null
  branch: string | null
  changes: DiffStat | null
  model: string
  effort: string | null
  context: { tokens: number; window: number; percent: number }
  limits: { fiveHour: LimitWindow | null; sevenDay: LimitWindow | null; monthly: LimitWindow | null }
  costUsd: number | null
  startup: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-cards': { snapshot: Snapshot | null }
  }
}
