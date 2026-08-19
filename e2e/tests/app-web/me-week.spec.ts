import { expect, test, type APIRequestContext } from '@playwright/test'
import { wavTake } from '../../src/audio'
import { APP_URL } from '../../src/env'
import { signInWithOtp } from '../../src/flows'
import { apiContext, expectApiError, jsonOf, tempEmail } from '../../src/http'

/**
 * M3 — 收工 (AC-S5) and the 7 天句 (AC-S8) across the API boundary.
 *
 * AC-S8's own 测法 — "构造 4A/2B/1C → 文案等于「把话说清 … 4 次」模板" — is a
 * *seven-day* history, and one account gets one session per calendar day by the
 * very constraint AC-I2 rests on. So the counting rule is a Vitest table
 * (`packages/shared/src/speaking/progress.test.ts`) and what is checked here is
 * the half that only a running system can answer: that a completed day reaches
 * the week endpoint, lands on the right calendar cell, and produces a real
 * template line rather than a raw key.
 */

interface TodayBody {
  dateKey: string
  session: {
    id: string
    status: string
    winnerType: 'A' | 'B' | 'C' | null
    retryState: 'PENDING' | 'DONE' | 'SKIPPED'
  }
}

interface WeekBody {
  days: { date: string; completed: boolean; winnerType: string | null; retryState: string | null }[]
  completedDays: number
  progress: { key: string; params: { count: number; days: number } } | null
}

interface CompletionBody {
  sessionId: string
  status: string
  retryState: 'DONE' | 'SKIPPED'
  week: WeekBody
}

/** Signs in, then speaks — leaving the session on P3 with a winner on it. */
async function scoredSession(label: string): Promise<{ ctx: APIRequestContext; today: TodayBody }> {
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail(label))

  const today = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  await jsonOf(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/audio`, {
      headers: { 'content-type': 'audio/wav' },
      data: wavTake(45),
    }),
    200,
  )

  return { ctx, today }
}

test('AC-S5: skipping the retry marks the day COMPLETED with retry_state=SKIPPED', async () => {
  const { ctx, today } = await scoredSession('week-skip')

  const done = await jsonOf<CompletionBody>(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/skip-retry`),
    200,
  )
  expect(done.status).toBe('COMPLETED')
  expect(done.retryState).toBe('SKIPPED')

  // AC-S5's 测法, second half: "/today 返回已完成态".
  const after = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  expect(after.session.id).toBe(today.session.id)
  expect(after.session.status).toBe('COMPLETED')
  expect(after.session.retryState).toBe('SKIPPED')

  await ctx.dispose()
})

test('AC-S5: a retry take also closes the day, as DONE', async () => {
  const { ctx, today } = await scoredSession('week-retry')

  const done = await jsonOf<CompletionBody>(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/retry`, {
      headers: { 'content-type': 'audio/wav' },
      // Far shorter than the 30 s main take: the retry is "再读 ≤3 个词", and a
      // floor that demanded half a minute would reject what the coach line asked
      // for. This length passing IS that rule.
      data: wavTake(4),
    }),
    200,
  )
  expect(done.retryState).toBe('DONE')

  const after = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  expect(after.session.status).toBe('COMPLETED')
  expect(after.session.retryState).toBe('DONE')

  await ctx.dispose()
})

test('AC-S8: a completed day produces the template line and fills today’s cell', async () => {
  const { ctx, today } = await scoredSession('week-line')

  const done = await jsonOf<CompletionBody>(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/skip-retry`),
    200,
  )

  // The completion response and the endpoint must agree — the client shows the
  // former on P4 and the latter on /me, and a disagreement is a student being
  // told two different things about the same week.
  const week = await jsonOf<WeekBody>(await ctx.get('/api/speaking/me/week'), 200)
  expect(week).toEqual(done.week)

  expect(week.days).toHaveLength(7)
  expect(week.completedDays).toBe(1)
  // Today is the last cell, and it is the one that just got filled.
  const last = week.days.at(-1)
  expect(last?.date).toBe(today.dateKey)
  expect(last?.completed).toBe(true)
  expect(last?.retryState).toBe('SKIPPED')
  expect(week.days.slice(0, 6).some((day) => day.completed)).toBe(false)

  // 纯模板：the server ships a key, never prose (IMPL §8-Q3). One completion, so
  // the count is one and the key is whichever winner the stub picked.
  expect(week.progress?.key).toMatch(/^me\.progress\.[ABC]$/)
  expect(week.progress?.params).toEqual({ count: 1, days: 7 })
  expect(`me.progress.${last?.winnerType}`).toBe(week.progress?.key)

  await ctx.dispose()
})

test('a day can only be closed after it has been scored', async () => {
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail('week-unscored'))
  const today = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)

  // Skipping straight past the microphone would write a completion with no
  // winner_type into the very history the 7-day sentence counts.
  const body = await expectApiError(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/skip-retry`),
    400,
    'VALIDATION_FAILED',
  )
  expect(body.details?.session?.[0]).toBe('errors.sessionNotScored')

  const week = await jsonOf<WeekBody>(await ctx.get('/api/speaking/me/week'), 200)
  expect(week.completedDays).toBe(0)
  expect(week.progress).toBeNull()

  await ctx.dispose()
})

test('closing an already-closed day is idempotent, and a spoken retry outranks a later skip', async () => {
  const { ctx, today } = await scoredSession('week-idem')

  await jsonOf(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/retry`, {
      headers: { 'content-type': 'audio/wav' },
      data: wavTake(4),
    }),
    200,
  )
  // A double-tapped button, or a student who pressed 跳过 after already speaking:
  // the day stays DONE and stays one completion.
  const again = await jsonOf<CompletionBody>(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/skip-retry`),
    200,
  )
  expect(again.retryState).toBe('DONE')
  expect(again.week.completedDays).toBe(1)

  await ctx.dispose()
})

test("another student's session cannot be completed on their behalf", async () => {
  const { ctx: theirs, today } = await scoredSession('week-victim')
  const mine = await apiContext(APP_URL)
  await signInWithOtp(mine, tempEmail('week-attacker'))

  // 404, not 403: a 403 would confirm the id exists.
  await expectApiError(
    await mine.post(`/api/speaking/sessions/${today.session.id}/skip-retry`),
    404,
    'NOT_FOUND',
  )

  const week = await jsonOf<WeekBody>(await theirs.get('/api/speaking/me/week'), 200)
  expect(week.completedDays).toBe(0)

  await mine.dispose()
  await theirs.dispose()
})

test('AC-S8: /me renders the sentence, and nothing to practise from', async ({ page }) => {
  await page.goto('/en/auth')
  await page.getByLabel('Email').fill(tempEmail('me-page'))
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByLabel('Code')).toHaveValue(/^\d{6}$/)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/today$/)

  await page.goto('/en/me')

  // Before any completion the page says so in words rather than showing a
  // template with a zero in it.
  await expect(page.getByTestId('progress-line')).toHaveText(/Practise a few days/)
  await expect(page.getByTestId('week-day')).toHaveCount(7)
  // Read-only (SPEC §5.3): /me is where you see progress, not a second place to
  // practise from — and definitely not a way to go back and fill in a past day.
  await expect(page.getByRole('button', { name: /record/i })).toHaveCount(0)

  await page.goto('/en/today')
  await page.getByRole('button', { name: 'Start recording' }).click()
  const stop = page.getByRole('button', { name: "I'm done" })
  await expect(stop).toBeEnabled({ timeout: 15_000 })
  await stop.click()
  await expect(page.getByTestId('winner')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: "Skip — I'm done for today" }).click()
  await expect(page.getByTestId('done')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('link', { name: 'See how this week has gone' }).click()
  await expect(page).toHaveURL(/\/en\/me$/)

  const line = page.getByTestId('progress-line')
  await expect(line).toHaveText(/This week you have mostly been working on/)
  // A missing translation renders the key itself — the one sentence this page
  // exists to show, shown as `me.progress.A`.
  await expect(line).not.toHaveText(/me\.progress\./)
  await expect(page.locator('[data-testid="week-day"][data-completed="true"]')).toHaveCount(1)
})

test('a signed-out visitor cannot reach /me', async ({ page }) => {
  await page.goto('/en/me')
  await expect(page).toHaveURL(/\/en\/login/)
})
