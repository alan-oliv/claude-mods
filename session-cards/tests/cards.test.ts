import { expect, test } from 'claude-code/testing'

import { compactTokens, displayModel, duration, filledCells, limitValue, resolveEffort } from '../hooks/register'

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
