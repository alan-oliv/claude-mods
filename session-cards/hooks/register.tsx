import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Settings } from 'claude-code'

import type { LimitWindow, Snapshot } from '../types'

const snapshot = atom({ plugin: 'session-cards', key: 'snapshot' } as const, null)

const REFRESH_MS = 5000
const PADDING_X = 1
const MAX_VALUE = 24
const CARD_BG = '#1c1a18'
const LABEL = '#9a958c'
const CREAM = '#ece6d6'
const BLUE = '#6f9ff0'
const TAN = '#c8b08a'
const TRACK = '#4a4640'

// progress (0 to 1) turns the top line into a bar.
type Card = { label: string; value: string; accent: string; progress?: number }

export function displayModel(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id)
  if (!match) return id
  const [, family = '', major, minor] = match
  return `${family[0]?.toUpperCase()}${family.slice(1)} ${major}.${minor}`
}

// The session's effort as Claude Code resolves it: the model's own setting, else the global one. /effort saves here.
export function resolveEffort(settings: Settings, model: string): string | null {
  const perModel = (settings.modelSettings as Record<string, { effortLevel?: unknown }> | undefined)?.[model]?.effortLevel
  const effort = perModel ?? settings.effortLevel
  return typeof effort === 'string' ? effort : null
}

export function compactTokens(n: number): string {
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

export function limitValue(window: LimitWindow | null): string {
  if (window === null) return '—'
  return window.resetIn === null ? `${window.percent}%` : `${window.percent}% · ${window.resetIn}`
}

export function filledCells(progress: number, width: number): number {
  return Math.min(width, Math.max(0, Math.round(progress * width)))
}

function cards(s: Snapshot): Card[] {
  return [
    { label: 'GIT', value: s.branch ?? 'no git', accent: CREAM },
    { label: 'MODEL', value: displayModel(s.model), accent: BLUE },
    { label: 'EFFORT', value: s.effort ?? '—', accent: TAN },
    {
      label: 'CONTEXT',
      value: `${compactTokens(s.context.tokens)}/${compactTokens(s.context.window)}, ${s.context.percent}%`,
      accent: BLUE,
      progress: s.context.tokens / s.context.window,
    },
    { label: '5H LIMIT', value: limitValue(s.limits.fiveHour), accent: TAN, progress: (s.limits.fiveHour?.percent ?? 0) / 100 },
    {
      label: 'WEEKLY LIMIT',
      value: limitValue(s.limits.sevenDay),
      accent: CREAM,
      progress: (s.limits.sevenDay?.percent ?? 0) / 100,
    },
    { label: 'COST', value: s.costUsd === null ? '—' : `$${s.costUsd.toFixed(2)}`, accent: TAN },
  ]
}

function clip(value: string): string {
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value
}

function limitWindow(limit: SessionRateLimit | undefined, now: number): LimitWindow | null {
  if (!limit) return null
  return {
    percent: Math.round(limit.percentUsed),
    resetIn: limit.resetsAt ? duration(Date.parse(limit.resetsAt) - now) : null,
  }
}

async function readSnapshot($: EngineInterface): Promise<Snapshot> {
  const [head, model, settings, usage, now] = await Promise.all([
    $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD']),
    $.session.model(),
    $.settings.read(),
    $.session.usage(),
    $.clock.now(),
  ])
  // Empty until an API response reports the windows, and off a subscription.
  const fiveHour = usage.rateLimits.find(limit => limit.kind === 'five_hour')
  const sevenDay = usage.rateLimits.find(limit => limit.kind === 'seven_day')
  return {
    branch: head.exitCode === 0 ? head.stdout.trim() : null,
    model,
    effort: resolveEffort(settings, model),
    // tokens and percent are absent until the window's first response.
    context: { tokens: usage.context.tokens ?? 0, window: usage.context.window, percent: usage.context.percent ?? 0 },
    limits: { fiveHour: limitWindow(fiveHour, now), sevenDay: limitWindow(sevenDay, now) },
    costUsd: usage.cost?.usd ?? null,
  }
}

let shown = ''

async function refresh($: EngineInterface) {
  const next = await readSnapshot($)
  const key = JSON.stringify(next)
  if (key === shown) return
  shown = key
  await update($, snapshot, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(REFRESH_MS, () => void refresh($))
    await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (e.props.hasSurvey || s === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const shownCards = cards(s).map(card => ({ ...card, value: clip(card.value) }))
    // One width for every card, so they line up as a grid.
    const width = Math.max(...shownCards.map(c => Math.max(c.label.length, c.value.length))) + 2 * PADDING_X
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} width={e.props.bodyColumns}>
        {shownCards.map(({ label, value, accent, progress = 1 }) => (
          <Box flexDirection="column" width={width}>
            {/* A bottom-eighth bar in the row above sits right on the card's top edge. */}
            <Box flexDirection="row">
              <Text color={accent}>{'▁'.repeat(filledCells(progress, width))}</Text>
              <Text color={TRACK}>{'▁'.repeat(width - filledCells(progress, width))}</Text>
            </Box>
            <Box flexDirection="column" backgroundColor={CARD_BG} paddingX={PADDING_X} paddingY={1}>
              <Text color={LABEL} backgroundColor={CARD_BG}>{label}</Text>
              <Text color={accent} backgroundColor={CARD_BG}>{value}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
