import { atom, read, update } from 'claude-code'
import type { ContextCategory, EngineInterface, Register, SessionRateLimit, Settings } from 'claude-code'

import type { DiffStat, LimitWindow, Snapshot } from '../types'

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
const RED = '#f47067'
const TRACK = '#3c3d4e'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
// Share of the window, in percent, where the startup turns heavy and where it is too much (a full bar).
const STARTUP_HEAVY = 10
const STARTUP_TOO_MUCH = 20

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

export function effortProgress(effort: string | null): number {
  return (EFFORTS.indexOf(effort ?? '') + 1) / EFFORTS.length
}

export function startupColor(percent: number): string {
  if (percent >= STARTUP_TOO_MUCH) return RED
  return percent >= STARTUP_HEAVY ? YELLOW : GREEN
}

// Messages is the conversation; every other row in use was there before the first prompt.
export function startupTokens(categories: readonly ContextCategory[]): number {
  return categories.filter(c => c.kind === 'used' && c.name !== 'Messages').reduce((sum, c) => sum + c.tokens, 0)
}

// Binary files read "-" for both counts.
export function diffStat(numstat: string): DiffStat {
  const rows = numstat.split('\n').filter(Boolean).map(line => line.split('\t'))
  return {
    files: rows.length,
    added: rows.reduce((sum, [added]) => sum + (Number(added) || 0), 0),
    removed: rows.reduce((sum, [, removed]) => sum + (Number(removed) || 0), 0),
  }
}

export function filledCells(progress: number, width: number): number {
  return Math.min(width, Math.max(0, Math.round(progress * width)))
}

function cards(s: Snapshot): Card[] {
  const startupPercent = ((s.startup ?? 0) / s.context.window) * 100
  return [
    { option: 'showModel', label: 'model', value: displayModel(s.model), line: BLUE, valueColor: BLUE },
    { option: 'showEffort', label: 'effort', value: s.effort ?? '—', line: PURPLE, valueColor: PURPLE, progress: effortProgress(s.effort) },
    {
      option: 'showContext',
      label: 'context',
      value: `${compactTokens(s.context.tokens)}/${compactTokens(s.context.window)}, ${s.context.percent}%`,
      line: GREEN,
      valueColor: GREEN,
      progress: s.context.tokens / s.context.window,
    },
    {
      option: 'showStartup',
      label: 'startup',
      value: s.startup === null ? '—' : `${compactTokens(s.startup)}, ${Math.round(startupPercent)}%`,
      line: startupColor(startupPercent),
      valueColor: startupColor(startupPercent),
      progress: startupPercent / STARTUP_TOO_MUCH,
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
  const [head, diff, model, settings, usage, now] = await Promise.all([
    $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD']),
    // Without --no-optional-locks, diff rewrites the index every refresh and can collide with the user's own git.
    $.process.run(['git', '--no-optional-locks', 'diff', 'HEAD', '--numstat']),
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
    changes: diff.exitCode === 0 ? diffStat(diff.stdout) : null,
    model,
    effort: resolveEffort(settings, model),
    // tokens and percent are absent until the window's first response.
    context: { tokens: usage.context.tokens ?? 0, window: usage.context.window, percent: usage.context.percent ?? 0 },
    limits: { fiveHour: limitWindow(fiveHour, now), sevenDay: limitWindow(sevenDay, now) },
    costUsd: usage.cost?.usd ?? null,
    startup,
  }
}

// Measured per turn, not on the timer: even the summary breakdown sizes every tool, skill and memory file.
async function measureStartup($: EngineInterface) {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  startup = context.breakdown ? startupTokens(context.breakdown.categories) : null
}

// Only classic hook inputs carry the name (/rename or --name), so a rename shows from the next prompt.
let title: string | null = null
let startup: number | null = null
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
    // A reload starts the module over and classic.SessionStart does not fire again, so take the name from the last snapshot.
    title ??= (await read($, snapshot))?.title ?? null
    $.clock.every(REFRESH_MS, () => void refresh($))
    await measureStartup($)
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
    await measureStartup($)
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
    const branch = options.showBranch ? s.branch : null
    const session = options.showSession ? s.title : null
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {(branch || session) && (
          <Box marginTop={2} columnGap={1}>
            {branch && (
              <Box backgroundColor={CARD_BG} paddingX={PADDING_X} flexShrink={0}>
                <Text color={GREEN} backgroundColor={CARD_BG}>{`⎇ ${branch}`}</Text>
              </Box>
            )}
            {branch && s.changes && (
              <Box backgroundColor={CARD_BG} paddingRight={PADDING_X} flexShrink={0}>
                <Text color={LABEL} backgroundColor={CARD_BG}>{`🗋 ${s.changes.files} • `}</Text>
                <Text color={GREEN} backgroundColor={CARD_BG}>{`+${s.changes.added} `}</Text>
                <Text color={RED} backgroundColor={CARD_BG}>{`-${s.changes.removed}`}</Text>
              </Box>
            )}
            {session && (
              <Box>
                <Text color={LABEL}>session: </Text>
                <Text color={VALUE} wrap="truncate-end">{session}</Text>
              </Box>
            )}
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
