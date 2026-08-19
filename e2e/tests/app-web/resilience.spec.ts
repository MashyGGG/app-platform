import { expect, test, type Page } from '@playwright/test'
import { wavTake } from '../../src/audio'
import { APP_URL } from '../../src/env'
import { arriveAtToday, signInWithOtp } from '../../src/flows'
import { apiContext, expectApiError, jsonOf, tempEmail } from '../../src/http'

/**
 * M4 — the two ways the scoring chain can let a student down, and the promise
 * that neither one costs them the day.
 *
 * - **AC-S6** — 评分失败（接口报错）: 保留今日题目并允许重录主开口.
 * - **AC-S10** — 评分超过 20s 但未报错: 展示降级提示，可选跳过直接 COMPLETED，
 *   `degraded_flag=true` 被记录.
 *
 * Both need a scoring call that misbehaves, and the stub provider is
 * deterministic and never fails — that is the whole point of it (IMPL §4.2). So
 * the misbehaviour is injected per request: a header on API contexts, a cookie
 * on browser contexts. Those hooks exist only when `SPEAKING_TEST_HOOKS=1`
 * (playwright.config.ts sets it) and are refused on a production deployment.
 *
 * The two are asserted SEPARATELY and never merged, for the reason SPEC §4.3
 * gives: 弱网 misread as 失败 corrupts the one signal that would tell us whether
 * the chain is slow or actually broken.
 */

const HOOK = 'x-speaking-test-hook'

interface TodayBody {
  prompt: { id: string; text: string }
  session: {
    id: string
    status: string
    winnerType: 'A' | 'B' | 'C' | null
    retryState: 'PENDING' | 'DONE' | 'SKIPPED'
    degradedFlag: boolean
  }
  limits: { degradeAfterMs: number }
}

/** Puts this browser context's scoring calls into `fail` or `slow` mode. */
async function useHook(page: Page, hook: 'fail' | 'slow' | null): Promise<void> {
  if (hook === null) {
    await page.context().clearCookies({ name: 'speaking-test-hook' })
    return
  }
  await page.context().addCookies([{ name: 'speaking-test-hook', value: hook, url: APP_URL }])
}

async function recordMainTake(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start recording' }).click()
  const stop = page.getByRole('button', { name: "I'm done" })
  await expect(stop).toBeEnabled({ timeout: 15_000 })
  await stop.click()
}

// --- AC-S6: 评分失败 ----------------------------------------------------------

test('AC-S6: a failed score keeps the question, says so, and lets the take be redone', async ({
  page,
}) => {
  await arriveAtToday(page, 'fail-ui')
  await page.getByTestId('warmup').getByRole('button', { name: 'Skip the warm-up' }).click()

  const question = await page.getByRole('heading', { level: 3 }).textContent()

  await useHook(page, 'fail')
  await recordMainTake(page)

  // 不得消耗当日完成资格 — and the student has to be TOLD that, or they will
  // assume the opposite and stop.
  await expect(page.getByTestId('scoring-failed')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("Today's question is still here")).toBeVisible()
  // 保留今日题目: the same question, not a new one, and no 收工 screen.
  expect(await page.getByRole('heading', { level: 3 }).textContent()).toBe(question)
  await expect(page.getByTestId('done')).toHaveCount(0)

  // 允许重录主开口 — the whole criterion, in one click.
  await useHook(page, null)
  await recordMainTake(page)
  await expect(page.getByTestId('winner')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('scoring-failed')).toHaveCount(0)
})

test('AC-S6: the failed session is FAILED, keeps its prompt, and wrote no completion', async () => {
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail('fail-api'))

  const before = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)

  await expectApiError(
    await ctx.post(`/api/speaking/sessions/${before.session.id}/audio`, {
      headers: { 'content-type': 'audio/wav', [HOOK]: 'fail' },
      data: wavTake(45),
    }),
    500,
    'INTERNAL',
  )

  const after = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  expect(after.session.id).toBe(before.session.id)
  expect(after.prompt.id).toBe(before.prompt.id)
  expect(after.session.status).toBe('FAILED')
  expect(after.session.winnerType).toBeNull()
  // A failure is not a degraded day: merging the two would be the exact loss of
  // signal SPEC §4.3 rules out.
  expect(after.session.degradedFlag).toBe(false)

  // 不得消耗当日完成资格 — nothing closed the day, so it is still there to redo.
  const scored = await jsonOf<{ winnerType: string }>(
    await ctx.post(`/api/speaking/sessions/${before.session.id}/audio`, {
      headers: { 'content-type': 'audio/wav' },
      data: wavTake(45),
    }),
    200,
  )
  expect(['A', 'B', 'C']).toContain(scored.winnerType)

  // …and the week still shows the day as unpractised until it is actually closed.
  const week = await jsonOf<{ completedDays: number }>(await ctx.get('/api/speaking/me/week'), 200)
  expect(week.completedDays).toBe(0)

  await ctx.dispose()
})

// --- AC-S10: 慢但没报错 -------------------------------------------------------

test('AC-S10: past the line the student is offered a way out, and taking it closes the day', async ({
  page,
}) => {
  await arriveAtToday(page, 'slow-ui')
  await page.getByTestId('warmup').getByRole('button', { name: 'Skip the warm-up' }).click()

  await useHook(page, 'slow')
  await recordMainTake(page)

  // 不得让用户处于无提示的无限等待. The prompt is an ADDITION, not a replacement:
  // the request is still running and the spinner still says so.
  const degraded = page.getByTestId('degraded')
  await expect(degraded).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Listening to your answer...')).toBeVisible()
  // …and it is not the failure message. Different cause, different words.
  await expect(page.getByTestId('scoring-failed')).toHaveCount(0)

  // 可选跳过直接 COMPLETED — while the score is still in flight.
  await degraded.getByRole('button', { name: 'Finish for today' }).click()
  await expect(page.getByTestId('done')).toBeVisible({ timeout: 30_000 })

  // The late result must not reopen the day, on screen or in the database. The
  // injected stall is 9s and the day was closed well inside it, so waiting for
  // it to land is what makes this assertion mean anything.
  await page.waitForTimeout(12_000)
  await expect(page.getByTestId('done')).toBeVisible()
  await expect(page.getByTestId('winner')).toHaveCount(0)

  const today = await jsonOf<TodayBody>(await page.request.get('/api/speaking/today'), 200)
  expect(today.session.status).toBe('COMPLETED')
  expect(today.session.retryState).toBe('SKIPPED')
  // degraded_flag=true 被记录 — the day was slow, and that stays true however it
  // ended. It is the only evidence the scoring chain needs watching.
  expect(today.session.degradedFlag).toBe(true)

  // Reloading lands on the finished day, not back on the record button.
  await page.reload()
  await expect(page.getByTestId('done')).toBeVisible()
})

test('AC-S10: waiting it out still works — the slow score is rendered when it lands', async ({
  page,
}) => {
  // Branch (b) of SPEC §4.3's degraded state: 「保留 pending 请求、结果返回后仍可
  // 当屏展示（若用户还在页面）」. Skipping is offered, never forced.
  await arriveAtToday(page, 'slow-wait')
  await page.getByTestId('warmup').getByRole('button', { name: 'Skip the warm-up' }).click()

  await useHook(page, 'slow')
  await recordMainTake(page)

  await expect(page.getByTestId('degraded')).toBeVisible({ timeout: 20_000 })

  const winner = page.getByTestId('winner')
  await expect(winner).toBeVisible({ timeout: 30_000 })
  await expect(winner).toHaveAttribute('data-winner', /^[ABC]$/)
  // The warning goes when the reason for it does.
  await expect(page.getByTestId('degraded')).toHaveCount(0)
})

test('AC-S10: the degraded flag is recorded without ending the day', async () => {
  // What the client PATCHes at the 20s mark, on its own: a record, not a
  // decision. The day is left exactly where it was.
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail('degraded-api'))

  const today = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  expect(today.limits.degradeAfterMs).toBeGreaterThan(0)

  await jsonOf(await ctx.patch(`/api/speaking/sessions/${today.session.id}/degraded`), 200)

  const after = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  expect(after.session.degradedFlag).toBe(true)
  expect(after.session.id).toBe(today.session.id)

  // A degraded day can be closed without ever having been scored — that is the
  // one exception `isCompletable` makes to "a day needs a next step first".
  const done = await jsonOf<{ status: string; retryState: string }>(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/skip-retry`),
    200,
  )
  expect(done.status).toBe('COMPLETED')
  expect(done.retryState).toBe('SKIPPED')

  await ctx.dispose()
})

test('an unscored, undegraded day cannot be skipped into completion', async () => {
  // The guard the exception above is an exception TO. Without it, a day could be
  // marked practised having never been spoken, and AC-S8's 7-day sentence would
  // be counting silence.
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail('skip-unscored'))

  const today = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  const body = await expectApiError(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/skip-retry`),
    400,
    'VALIDATION_FAILED',
  )
  expect(body.details?.session?.[0]).toBe('errors.sessionNotScored')

  await ctx.dispose()
})

test("the degraded endpoint is not a way to touch someone else's session", async () => {
  const mine = await apiContext(APP_URL)
  const theirs = await apiContext(APP_URL)
  await signInWithOtp(mine, tempEmail('degraded-mine'))
  await signInWithOtp(theirs, tempEmail('degraded-theirs'))

  const victim = await jsonOf<TodayBody>(await theirs.get('/api/speaking/today'), 200)

  // 404, not 403: a 403 would confirm the id exists.
  await expectApiError(
    await mine.patch(`/api/speaking/sessions/${victim.session.id}/degraded`),
    404,
    'NOT_FOUND',
  )

  await mine.dispose()
  await theirs.dispose()
})
