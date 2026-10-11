import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { compactTokens, displayModel, duration, effortProgress, filledCells, limitValue, resolveEffort, startupColor, startupTokens } from '../hooks/register'

test('turns model ids into display names and leaves other names alone', async () => {
  expect(displayModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(displayModel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
  expect(displayModel('Opus 5.5')).toBe('Opus 5.5')
})

test('resolves effort from the model setting first, then the global one', async () => {
  const settings = { effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } }
  expect(resolveEffort(settings, 'claude-opus-5-5')).toBe('xhigh')
  expect(resolveEffort(settings, 'claude-sonnet-5-5')).toBe('high')
  expect(resolveEffort({}, 'claude-opus-5-5')).toBe(null)
})

test('formats context sizes and fills the bar in proportion, clamped to the card', async () => {
  expect([compactTokens(812), compactTokens(162_900), compactTokens(1_000_000), compactTokens(1_500_000)]).toEqual([
    '812', '163k', '1M', '1.5M',
  ])
  expect([filledCells(0.16, 16), filledCells(0, 16), filledCells(1.2, 16)]).toEqual([3, 0, 16])
})

test('words a limit card from its window: percent used, then time to reset', async () => {
  expect([duration(59_000), duration(44 * 60_000), duration(125 * 60_000), duration(76 * 3_600_000)]).toEqual([
    '<1m', '44m', '2h 5m', '3d 4h',
  ])
  expect(limitValue({ percent: 1, resetIn: '4h 8m' })).toBe('1% · 4h 8m')
  expect(limitValue({ percent: 45, resetIn: null })).toBe('45%')
  expect(limitValue(null)).toBe('—')
})

test('counts startup as every row in use but the conversation', async () => {
  const row = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred') => ({ name, tokens, kind, color: 'text', isDeferred: kind === 'deferred' })
  expect(startupTokens([
    row('System prompt', 2_400, 'used'),
    row('MCP tools', 7_000, 'used'),
    row('Skills', 9_900, 'used'),
    row('MCP tools (deferred)', 116_900, 'deferred'),
    row('Messages', 3_200, 'used'),
    row('Free space', 938_100, 'free'),
    row('Autocompact buffer', 33_000, 'buffer'),
  ])).toBe(19_300)
})

test('fills the effort bar by level, low to max', async () => {
  expect(['low', 'medium', 'high', 'xhigh', 'max'].map(effortProgress)).toEqual([0.2, 0.4, 0.6, 0.8, 1])
  expect([effortProgress(null), effortProgress('turbo')]).toEqual([0, 0])
})

test('colors startup green, then yellow from 10% of the window, then red from 20%', async () => {
  expect([startupColor(3), startupColor(10), startupColor(19.9), startupColor(20)]).toEqual(['#72c590', '#f3d066', '#f3d066', '#f47067'])
})

async function mountBand($: Engine, on: On) {
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: undefined }))
  on('classic.SessionStart', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.classic.SessionStart({ source: 'startup', session_title: 'adding-session-name' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  return $.ui.mount({
    plugin: 'session-cards',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19 }, view: {} },
  })
}

test('heads the cards with the branch and the session name on one line', async ($, on) => {
  const ui = await mountBand($, on)
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text).slice(0, 5)).toEqual([
    'branch: ', 'main', ' · ', 'session: ', 'adding-session-name',
  ])
  expect(await ui.find({ type: 'Text', text: 'git' })).toBe(undefined)
})

test('leaves out the branch, the session name and the cards the user turned off', { options: { showBranch: false, showSession: false, showModel: false } }, async ($, on) => {
  const ui = await mountBand($, on)
  expect(await ui.find({ type: 'Text', text: 'main' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'adding-session-name' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'model' })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: 'effort' }))?.text).toBe('effort')
})
