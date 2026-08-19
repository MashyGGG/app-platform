import { expect, test } from '@playwright/test'
import { wavTake } from '../../src/audio'
import { APP_URL } from '../../src/env'
import { arriveAtToday, signInWithOtp } from '../../src/flows'
import { apiContext, expectApiError, jsonOf, tempEmail } from '../../src/http'
import type { TelemetryEvent } from '../../src/telemetry'

/**
 * M2 — `/today`: 今日一题 → 录音 → 同屏一个下一步.
 *
 * Covers AC-S1 (one question, no module list), AC-S2 (recording within ten
 * seconds of arriving), AC-S3 (exactly one winner) and AC-I2 (one session per
 * user per day). The scoring itself is the stub provider, which is deterministic
 * by design (IMPL §4.2) — without it none of this could be asserted at all.
 *
 * `/en` rather than the default `/zh` so the selectors read clearly.
 */

interface TodayBody {
  dateKey: string
  prompt: { id: string; text: string; checklist: string[] }
  session: {
    id: string
    status: string
    winnerType: 'A' | 'B' | 'C' | null
    retryState: 'PENDING' | 'DONE' | 'SKIPPED'
  }
  limits: { minDurationMs: number; maxDurationMs: number; retryMinDurationMs: number }
}

interface ScoreBody {
  sessionId: string
  winnerType: 'A' | 'B' | 'C'
  coachLineKey: string
  coachLineParams: Record<string, string | number>
  retryItems: { kind: string; text: string; audioUrl: string | null }[]
}

test('AC-S1: the landing page is one question and one record button — no module list', async ({
  page,
}) => {
  await arriveAtToday(page, 'today')

  await expect(page.getByText("Today's question")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()

  // "不展示任何模块/菜单列表" is the criterion, and it is an absence: no sidebar,
  // no course tree, no tabs. Asserting it here is what stops the page growing
  // one the next time something needs somewhere to live.
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByRole('menuitem')).toHaveCount(0)
  await expect(page.getByRole('tablist')).toHaveCount(0)
})

test('AC-S2 / AC-S3: one click starts recording, and the take comes back with exactly one next step', async ({
  page,
}) => {
  // The recorder reports why it could not open the microphone to the console and
  // only an i18n key to the screen, so without this a failure here reads as
  // "the Recording tag never appeared" with no cause attached.
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await arriveAtToday(page, 'today')

  // One click: request the microphone AND start capturing. No explainer modal in
  // between — that ladder is what SPEC §4.3 rules out to fit the 10s budget.
  await page.getByRole('button', { name: 'Start recording' }).click()
  // Exact: `getByText('Recording')` is a case-insensitive substring match, so it
  // also matches the "Start recording" button that is still on screen when the
  // microphone failed to open — and the assertion would pass on the failure.
  await expect(
    page.getByText('Recording', { exact: true }),
    `recording never started; browser console said: ${consoleErrors.join(' | ') || '(nothing)'}`,
  ).toBeVisible()

  const events = await page.evaluate<TelemetryEvent[]>(() => window.__appTelemetry ?? [])
  const started = events.find((event) => event.name === 'home_to_recording_ms')
  expect(started, 'the home_to_recording_ms event AC-S2 is measured by').toBeTruthy()
  expect(Number(started?.payload.ms)).toBeLessThanOrEqual(10_000)

  // The button stays disabled until the take is long enough to score, then says
  // so. (These servers run a shortened floor — see playwright.config.ts.)
  const stop = page.getByRole('button', { name: "I'm done" })
  await expect(stop).toBeEnabled({ timeout: 15_000 })
  await stop.click()

  const winner = page.getByTestId('winner')
  await expect(winner).toBeVisible({ timeout: 30_000 })
  // AC-S3: exactly one. A second correction on screen is the failure mode.
  await expect(winner).toHaveCount(1)
  await expect(winner).toHaveAttribute('data-winner', /^[ABC]$/)
  expect(await page.getByTestId('retry-item').count()).toBeGreaterThan(0)
})

test('AC-S4 / AC-S5: the retry happens in place, and finishing it closes the day', async ({
  page,
}) => {
  await arriveAtToday(page, 'today')

  await page.getByRole('button', { name: 'Start recording' }).click()
  const stop = page.getByRole('button', { name: "I'm done" })
  await expect(stop).toBeEnabled({ timeout: 15_000 })
  await stop.click()
  await expect(page.getByTestId('winner')).toBeVisible({ timeout: 30_000 })

  // AC-S4's 测法 is literally "再试过程无路由跳转到独立报告页", so the URL is the
  // assertion — pinned before the retry and unchanged through all of it.
  const url = page.url()
  expect(url).toMatch(/\/en\/today$/)

  await page.getByRole('button', { name: 'Say it again' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  expect(page.url()).toBe(url)

  const finish = page.getByRole('button', { name: 'Done', exact: true })
  await expect(finish).toBeEnabled({ timeout: 15_000 })
  await finish.click()

  // AC-S5: 收工文案, and the week line that comes with it (AC-S8's template on
  // its first day of data).
  const done = page.getByTestId('done')
  await expect(done).toBeVisible({ timeout: 30_000 })
  expect(page.url()).toBe(url)
  // The winner card is gone: the next step was taken, so there is nothing left
  // on screen to act on.
  await expect(page.getByTestId('winner')).toHaveCount(0)
  await expect(page.getByTestId('progress-line')).not.toBeEmpty()

  // Coming back later lands on the finished day rather than the record button.
  await page.reload()
  await expect(page.getByTestId('done')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start recording' })).toHaveCount(0)
})

test('AC-S5: skipping the retry still finishes the day', async ({ page }) => {
  await arriveAtToday(page, 'today')

  await page.getByRole('button', { name: 'Start recording' }).click()
  const stop = page.getByRole('button', { name: "I'm done" })
  await expect(stop).toBeEnabled({ timeout: 15_000 })
  await stop.click()
  await expect(page.getByTestId('winner')).toBeVisible({ timeout: 30_000 })

  // 已确认决策 5 — 跳过也算今天练完. No confirmation step in between: an "are you
  // sure?" here would be the app arguing with 允许停 (D3).
  await page.getByRole('button', { name: "Skip — I'm done for today" }).click()

  await expect(page.getByTestId('done')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('winner')).toHaveCount(0)
})

test('AC-S3: the upload endpoint returns one winner and material to act on', async () => {
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail('today-api'))

  const today = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  expect(today.session.winnerType).toBeNull()

  const scored = await jsonOf<ScoreBody>(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/audio`, {
      headers: { 'content-type': 'audio/wav' },
      data: wavTake(45),
    }),
    200,
  )

  expect(['A', 'B', 'C']).toContain(scored.winnerType)
  expect(scored.retryItems.length).toBeGreaterThan(0)
  // The server ships an i18n key, never prose — the same discipline the error
  // envelope follows, and what makes AC-S8's "no LLM" claim checkable.
  expect(scored.coachLineKey).toMatch(/^today\.coach\./)

  if (scored.winnerType === 'A') {
    // AC-I3: ≤3 words, each playable.
    expect(scored.retryItems.length).toBeLessThanOrEqual(3)
    for (const item of scored.retryItems) {
      expect(item.audioUrl, `${item.text} has no audio`).toBeTruthy()
      const audio = await ctx.get(item.audioUrl as string)
      expect(audio.status()).toBe(200)
      expect(audio.headers()['content-type']).toMatch(/^audio\//)
    }
  }

  await ctx.dispose()
})

test('the same audio always scores the same way — the stub is deterministic', async () => {
  // IMPL §4.2: this is the property every assertion above rests on. If the stub
  // drifted, AC-S3 would still pass while meaning nothing.
  const first = await apiContext(APP_URL)
  const second = await apiContext(APP_URL)
  await signInWithOtp(first, tempEmail('today-det-1'))
  await signInWithOtp(second, tempEmail('today-det-2'))

  const take = wavTake(45)
  const results = await Promise.all(
    [first, second].map(async (ctx) => {
      const today = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
      return jsonOf<ScoreBody>(
        await ctx.post(`/api/speaking/sessions/${today.session.id}/audio`, {
          headers: { 'content-type': 'audio/wav' },
          data: take,
        }),
        200,
      )
    }),
  )

  expect(results[0]?.winnerType).toBe(results[1]?.winnerType)
  expect(results[0]?.coachLineKey).toBe(results[1]?.coachLineKey)

  await first.dispose()
  await second.dispose()
})

test('AC-I2: the same day returns the same session and the same prompt', async () => {
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail('today-idem'))

  const first = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  const second = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  // POST /sessions is the same operation by another verb: a user has exactly one
  // session per calendar day, so "create" can only ever hand back this one.
  const created = await jsonOf<TodayBody>(await ctx.post('/api/speaking/sessions'), 200)

  expect(second.session.id).toBe(first.session.id)
  expect(created.session.id).toBe(first.session.id)
  expect(created.prompt.id).toBe(first.prompt.id)

  await ctx.dispose()
})

test('AC-I2: concurrent first visits still produce one session', async () => {
  // The lookup alone cannot deliver this — four requests arriving together all
  // miss the read. Only the `@@unique([userId, dateKey])` constraint decides a
  // winner, and this is the test that would notice if it were dropped.
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail('today-race'))

  const racers = await Promise.all(
    Array.from({ length: 4 }, async () =>
      jsonOf<TodayBody>(await ctx.post('/api/speaking/sessions'), 200),
    ),
  )
  expect(new Set(racers.map((body) => body.session.id)).size).toBe(1)

  await ctx.dispose()
})

test('a take outside the length window is refused with the contracted envelope', async () => {
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail('today-short'))

  const today = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  const body = await expectApiError(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/audio`, {
      headers: { 'content-type': 'audio/wav' },
      data: wavTake(0.5),
    }),
    400,
    'VALIDATION_FAILED',
  )
  expect(body.details?.audio?.[0]).toBe('errors.audioTooShort')

  await ctx.dispose()
})

test('a session id that is not yours reads as if it does not exist', async () => {
  const mine = await apiContext(APP_URL)
  const theirs = await apiContext(APP_URL)
  await signInWithOtp(mine, tempEmail('today-mine'))
  await signInWithOtp(theirs, tempEmail('today-theirs'))

  const victim = await jsonOf<TodayBody>(await theirs.get('/api/speaking/today'), 200)

  // 404, not 403: a 403 would confirm the id exists.
  await expectApiError(
    await mine.post(`/api/speaking/sessions/${victim.session.id}/audio`, {
      headers: { 'content-type': 'audio/wav' },
      data: wavTake(45),
    }),
    404,
    'NOT_FOUND',
  )

  await mine.dispose()
  await theirs.dispose()
})

test('a signed-out visitor cannot reach /today', async ({ page }) => {
  await page.goto('/en/today')
  await expect(page).toHaveURL(/\/en\/login/)
})
