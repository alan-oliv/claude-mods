import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Settings } from 'claude-code'

import type { LimitWindow, Snapshot } from '../types'

const snapshot = atom({ plugin: 'session-cards', key: 'snapshot' } as const, null)

const REFRESH_MS = 5000
const PADDING_X = 1
const MAX_VALUE = 24
const CARD_BG = '#2a2927'
const LABEL = '#9d9db1'
const VALUE = '#ffffff'
const LINE = '#e5e6f2'
const BLUE = '#6eb3ff'
const PURPLE = '#c394ff'
const GREEN = '#72c590'
const YELLOW = '#f3d066'
const ORANGE = '#fbaa60'
const TRACK = '#3c3d4e'

// progress (0 to 1) turns the top line into a bar.
type Card = { option: string; label: string; value: string; line: string; valueColor?: string; progress?: number }

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
    { option: 'showGit', label: 'git', value: s.branch ?? 'no git', line: LINE },
    { option: 'showModel', label: 'model', value: displayModel(s.model), line: BLUE, valueColor: BLUE },
    { option: 'showEffort', label: 'effort', value: s.effort ?? '—', line: PURPLE, valueColor: PURPLE },
    {
      option: 'showContext',
      label: 'context',
      value: `${compactTokens(s.context.tokens)}/${compactTokens(s.context.window)}, ${s.context.percent}%`,
      line: GREEN,
      valueColor: GREEN,
      progress: s.context.tokens / s.context.window,
    },
    { option: 'showFiveHourLimit', label: '5h limit', value: limitValue(s.limits.fiveHour), line: YELLOW, valueColor: YELLOW, progress: (s.limits.fiveHour?.percent ?? 0) / 100 },
    {
      option: 'showWeeklyLimit',
      label: 'weekly limit',
      value: limitValue(s.limits.sevenDay),
      line: ORANGE,
      valueColor: ORANGE,
      progress: (s.limits.sevenDay?.percent ?? 0) / 100,
    },
    { option: 'showCost', label: 'cost', value: s.costUsd === null ? '—' : `$${s.costUsd.toFixed(2)}`, line: LINE },
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
    title,
    branch: head.exitCode === 0 ? head.stdout.trim() : null,
    model,
    effort: resolveEffort(settings, model),
    // tokens and percent are absent until the window's first response.
    context: { tokens: usage.context.tokens ?? 0, window: usage.context.window, percent: usage.context.percent ?? 0 },
    limits: { fiveHour: limitWindow(fiveHour, now), sevenDay: limitWindow(sevenDay, now) },
    costUsd: usage.cost?.usd ?? null,
  }
}

// Only classic hook inputs carry the name (/rename or --name), so a rename shows from the next prompt.
let title: string | null = null
let shown = ''

async function refresh($: EngineInterface) {
  const next = await readSnapshot($)
  const key = JSON.stringify(next)
  if (key === shown) return
  shown = key
  await update($, snapshot, () => next)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    $.clock.every(REFRESH_MS, () => void refresh($))
    await refresh($)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    title = e.session_title ?? null
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    title = e.session_title ?? null
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
    const shownCards = cards(s).filter(card => options[card.option]).map(card => {
      const value = clip(card.value)
      return { ...card, value, width: Math.max(card.label.length, value.length) + 2 * PADDING_X }
    })
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {options.showSession && s.title && (
          <Box marginTop={2}>
            <Text color={LABEL}>session: </Text>
            <Text color={VALUE} wrap="truncate-end">{s.title}</Text>
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {shownCards.map(({ label, value, width, line, valueColor = VALUE, progress = 1 }) => (
            <Box flexDirection="column" width={width}>
              {/* A bottom-eighth bar in the row above sits right on the card's top edge. */}
              <Box flexDirection="row">
                <Text color={line}>{'▁'.repeat(filledCells(progress, width))}</Text>
                <Text color={TRACK}>{'▁'.repeat(width - filledCells(progress, width))}</Text>
              </Box>
              <Box flexDirection="column" backgroundColor={CARD_BG} paddingX={PADDING_X} paddingY={1}>
                <Text color={LABEL} backgroundColor={CARD_BG}>{label}</Text>
                <Text color={valueColor} backgroundColor={CARD_BG}>{value}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
