import { expect, test } from '@playwright/test'
import { wavTake } from '../../src/audio'
import { APP_URL } from '../../src/env'
import { arriveAtToday, signInWithOtp } from '../../src/flows'
import { apiContext, jsonOf, tempEmail } from '../../src/http'

/**
 * M4 — P1 热身拍 (AC-S7).
 *
 * "WHERE 学生打开热身，THE 系统 SHALL 播放示范并接受一句跟读，且跳过热身不影响进入
 * 主开口. · 测法：两条路径都能到 P2."
 *
 * So the shape of this file is the criterion's own shape: two paths, one
 * destination. What is asserted is that BOTH arrive at the record button — not
 * that the warm-up scored anything, because 热身不打分.
 */

interface TodayBody {
  prompt: { id: string; text: string }
  session: { id: string; status: string }
  limits: { warmupMinDurationMs: number; warmupMaxDurationMs: number }
}

test('AC-S7: the warm-up offers a model to play and a line to read, and leads to P2', async ({
  page,
}) => {
  await arriveAtToday(page, 'warmup-take')

  const warmup = page.getByTestId('warmup')
  await expect(warmup).toBeVisible()
  // 播放示范: a real player with a real src (these servers serve a placeholder
  // for the 示范音 keys content ops has not recorded yet — see playwright.config).
  await expect(warmup.locator('audio')).toHaveAttribute('src', /.+/)

  await warmup.getByRole('button', { name: 'Read it aloud' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()

  const stop = page.getByRole('button', { name: "That's it" })
  await expect(stop).toBeEnabled({ timeout: 15_000 })
  await stop.click()

  // 接受一句跟读 — acknowledged, and nothing more: no score, no next step, no
  // second correction competing with the one P3 is going to show (AC-S3).
  await expect(page.getByTestId('warmup-done')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('winner')).toHaveCount(0)

  // Path one arrives at P2.
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
})

test('AC-S7: skipping the warm-up leads to the same P2', async ({ page }) => {
  await arriveAtToday(page, 'warmup-skip')

  await page.getByTestId('warmup').getByRole('button', { name: 'Skip the warm-up' }).click()
  await expect(page.getByTestId('warmup')).toHaveCount(0)

  // Path two arrives at the same place — and all the way through the main take,
  // because "不影响进入主开口" is about the take, not just the button.
  await page.getByRole('button', { name: 'Start recording' }).click()
  const stop = page.getByRole('button', { name: "I'm done" })
  await expect(stop).toBeEnabled({ timeout: 15_000 })
  await stop.click()

  await expect(page.getByTestId('winner')).toBeVisible({ timeout: 30_000 })
})

test('AC-S7: the warm-up is optional at the API too — a scored take never needed one', async () => {
  // The strongest form of "跳过热身不影响进入主开口": the upload endpoint does not
  // look at the session's status at all, so there is nothing for a skipped
  // warm-up to have left undone.
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail('warmup-optional'))

  const today = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)
  expect(today.session.status).toBe('NOT_STARTED')

  const scored = await jsonOf<{ winnerType: string }>(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/audio`, {
      headers: { 'content-type': 'audio/wav' },
      data: wavTake(45),
    }),
    200,
  )
  expect(['A', 'B', 'C']).toContain(scored.winnerType)

  await ctx.dispose()
})

test('AC-S7: a warm-up take moves the session to WARMUP and leaves the day untouched', async () => {
  const ctx = await apiContext(APP_URL)
  await signInWithOtp(ctx, tempEmail('warmup-api'))

  const today = await jsonOf<TodayBody>(await ctx.get('/api/speaking/today'), 200)

  const warmed = await jsonOf<{ status: string; accuracy: number }>(
    await ctx.post(`/api/speaking/sessions/${today.session.id}/warmup`, {
      headers: { 'content-type': 'audio/wav' },
      data: wavTake(3),
    }),
    200,
  )
  expect(warmed.status).toBe('WARMUP')

  // The day is still ahead of the student: same session, same prompt, no winner.
  const after = await jsonOf<TodayBody & { session: { winnerType: string | null } }>(
    await ctx.get('/api/speaking/today'),
    200,
  )
  expect(after.session.id).toBe(today.session.id)
  expect(after.prompt.id).toBe(today.prompt.id)
  expect(after.session.status).toBe('WARMUP')
  expect(after.session.winnerType).toBeNull()

  await ctx.dispose()
})
