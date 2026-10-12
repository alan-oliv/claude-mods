import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

async function mountBand($: Engine, on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })
  on('process.run', (_, e) => {
    const stdout = e.argv.includes('diff') ? '14\t10\tREADME.md\n-\t-\tdocs/hero.png\n' : 'main\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
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


test('draws the bands beneath it above its own cards', async ($, on) => {
  const ui = await mountBand($, on)
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text).slice(0, 2)).toEqual(['other band', '⎇ main'])
})
