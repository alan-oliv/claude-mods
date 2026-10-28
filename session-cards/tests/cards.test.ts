import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { compactTokens, displayModel, duration, effortProgress, filledCells, limitColor, limitValue, PALETTES, resolveEffort, startupColor, startupTokens } from '../hooks/register'

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

test('colors the monthly limit green, then yellow, then red as it fills', async () => {
  const p = PALETTES.colorful!
  expect([limitColor(0, p), limitColor(59, p), limitColor(60, p), limitColor(85, p), limitColor(120, p)]).toEqual([
    '#72c590', '#72c590', '#f3d066', '#f47067', '#f47067',
  ])
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
  const p = PALETTES.colorful!
  expect([startupColor(3, p), startupColor(10, p), startupColor(19.9, p), startupColor(20, p)]).toEqual(['#72c590', '#f3d066', '#f3d066', '#f47067'])
})

test('mono keeps only the red for a startup that is too much', async () => {
  const p = PALETTES.mono!
  expect([startupColor(3, p), startupColor(19.9, p), startupColor(20, p)]).toEqual(['#e5e6f2', '#e5e6f2', '#f47067'])
})

async function mountBand($: Engine, on: On, { isRepo = true } = {}) {
  on('process.run', (_, e) => {
    const stdout = e.argv.includes('diff') ? '14\t10\tREADME.md\n-\t-\tdocs/hero.png\n' : '/code/claude-mods\nmain\n'
    return { value: { exitCode: isRepo ? 0 : 128, stdout: isRepo ? stdout : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.cwd', () => ({ value: '/scratch/notes' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/alan' : undefined }))
  on('fs.read', () => ({ value: JSON.stringify({ oauthAccount: { emailAddress: 'alan@example.com' } }) }))
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

test('heads the cards with a badge of the repo folder and branch, a badge of files and lines changed, then the session name', async ($, on) => {
  const ui = await mountBand($, on)
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text).slice(0, 9)).toEqual([
    'claude-mods ', '⎇ main', '🗋 2 • ', '+14 ', '-10', 'account: ', 'alan@example.com', 'session: ', 'adding-session-name',
  ])
  expect(await ui.find({ type: 'Text', text: 'git' })).toBe(undefined)
})

test('names the working folder alone when it is not in a repo', async ($, on) => {
  const ui = await mountBand($, on, { isRepo: false })
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text).slice(0, 3)).toEqual(['notes', 'account: ', 'alan@example.com'])
})

test('leaves out the folder and branch, the account, the session name and the cards the user turned off', { options: { showBranch: false, showAccount: false, showSession: false, showModel: false } }, async ($, on) => {
  const ui = await mountBand($, on)
  expect(await ui.find({ type: 'Text', text: 'claude-mods ' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '⎇ main' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '+14 ' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'alan@example.com' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'adding-session-name' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'model' })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: 'effort' }))?.text).toBe('effort')
})
