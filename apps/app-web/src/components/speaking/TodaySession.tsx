'use client'

import {
  AudioOutlined,
  CheckCircleTwoTone,
  LoadingOutlined,
  SmileTwoTone,
  SoundOutlined,
} from '@ant-design/icons'
import { Alert, Button, Card, Space, Spin, Tag } from 'antd'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { patchJson, postBinary, postJson } from '@/lib/client-api'
import { track, msSinceNavigation } from '@/lib/telemetry'
import { Paragraph, Title } from '@/components/typography'
import { WeekStrip } from './WeekStrip'
import { useRecorder } from './useRecorder'
// Types only — `lib/speaking/*.ts` is `server-only`, and `import type` is erased
// before the bundler ever sees it.
import type { RetryItemView, TodayView, WinnerView } from '@/lib/speaking/today'
import type { WeekView } from '@/lib/speaking/week'

/**
 * `result` and `retrying` are two beats of P3, not P3 and P4: the student who
 * presses 再说一遍 has not left the next step, they are doing it. That is exactly
 * what AC-S4 asks for — "允许不离开当前会话再次录音" — and why there is no route,
 * no modal and no report page anywhere in this file.
 *
 * `warmup` and `warmupSaving` are P1, which sits BEFORE P2 and is optional
 * (AC-S7): both live inside `prompt`'s screen rather than replacing it, so the
 * record button is on screen the whole time and 跳过热身 needs no state at all.
 */
type Phase =
  | 'prompt'
  | 'warmup'
  | 'warmupSaving'
  | 'recording'
  | 'scoring'
  | 'result'
  | 'retrying'
  | 'saving'
  | 'done'

/** Which of the three takes the microphone is currently open for. */
type TakeKind = 'main' | 'retry' | 'warmup'

/** Whether the optional P1 card is still on offer, and how it ended. */
type WarmupState = 'offered' | 'skipped' | 'done'

/** What both completion endpoints return. */
interface CompletionResult {
  sessionId: string
  status: string
  retryState: 'DONE' | 'SKIPPED'
  week: WeekView
}

function seconds(ms: number): number {
  return Math.floor(ms / 1000)
}

/**
 * P0 → P1 → P2 → P3 → P4 in one component and one route.
 *
 * "再试" must not leave the session (AC-S4) and there is no report page to jump
 * to (SPEC §4.3), so the whole beat sequence is one client component swapping
 * its own body. The server round trips are: create/read today (already done by
 * the page), the optional warm-up, upload the take, and close the day.
 */
export function TodaySession({
  initial,
  week: initialWeek,
}: {
  initial: TodayView
  week: WeekView
}) {
  const t = useTranslations()
  const recorder = useRecorder()

  const [phase, setPhase] = useState<Phase>(startingPhase(initial))
  const [warmup, setWarmup] = useState<WarmupState>('offered')
  const [winner, setWinner] = useState<WinnerView | null>(
    initial.session.winnerType ? initial.session : null,
  )
  const [week, setWeek] = useState<WeekView>(initialWeek)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  /** AC-S6 — the scoring call came back an error; the day is still open. */
  const [scoringFailed, setScoringFailed] = useState(false)
  /** AC-S10 — the 20s line was crossed and the request has not come back. */
  const [degraded, setDegraded] = useState(false)

  /**
   * Set when the student ends the day from the degraded prompt while the scoring
   * request is STILL in flight (AC-S10 branch a). The request is deliberately
   * never cancelled — but a winner arriving after 收工 must not reopen the day
   * on screen, exactly as the server-side guard in `scoreMainTake` stops it
   * reopening in the database.
   */
  const abandoned = useRef(false)

  /**
   * The in-flight `PATCH …/degraded`, so the exit it authorises cannot outrun
   * it. `isCompletable` lets an unscored day be closed ONLY once the session is
   * DEGRADED, and the student can reach the skip button in the same tick the
   * record is fired — on a loaded server the skip then arrives first and is
   * refused for a day that is, in fact, degraded.
   */
  const degradeRecorded = useRef<Promise<unknown> | null>(null)

  const {
    minDurationMs,
    maxDurationMs,
    retryMinDurationMs,
    warmupMinDurationMs,
    warmupMaxDurationMs,
    degradeAfterMs,
  } = initial.limits

  // Three takes, three length windows: the main 开口 carries SPEC §4.1's 30–90 s
  // contract, the retry and the warm-up are different acts with their own floors
  // (see `lib/speaking/config.ts`).
  const activeTake = takeKindOf(phase)
  const bounds = {
    main: { floorMs: minDurationMs, ceilingMs: maxDurationMs },
    retry: { floorMs: retryMinDurationMs, ceilingMs: maxDurationMs },
    warmup: { floorMs: warmupMinDurationMs, ceilingMs: warmupMaxDurationMs },
  }[activeTake ?? 'main']
  const longEnough = recorder.elapsedMs >= bounds.floorMs

  /**
   * P1 跟读 — assessed against the sentence on screen and then let go (原则 B's
   * reference-text mode; see `lib/speaking/warmup.ts` for why nothing is stored).
   *
   * Every exit from here lands on the same screen the student could already see,
   * because the warm-up is optional: a warm-up that failed is not a day that
   * failed, so it never produces an error banner — it just stops offering.
   */
  const submitWarmup = useCallback(async () => {
    const take = await recorder.stop()
    if (!take) {
      setWarmup('skipped')
      setPhase('prompt')
      return
    }

    setPhase('warmupSaving')

    const result = await postBinary(
      `/api/speaking/sessions/${initial.session.id}/warmup`,
      take,
      'audio/wav',
    )

    setWarmup(result.ok ? 'done' : 'skipped')
    setPhase('prompt')
    if (result.ok) track('warmup_completed')
  }, [initial.session.id, recorder])

  const submit = useCallback(async () => {
    const take = await recorder.stop()
    if (!take) {
      setPhase('prompt')
      setErrorKey('today.nothingRecorded')
      return
    }

    abandoned.current = false
    setPhase('scoring')
    setErrorKey(null)
    setScoringFailed(false)
    setDegraded(false)

    const submittedAt = Date.now()
    // AC-S10 — 「不得让用户处于无提示的无限等待」. The timer only ADDS a way out;
    // it does not abort the request, which is why the result below is still
    // rendered when it eventually lands and the student is still here.
    degradeRecorded.current = null
    const slow = setTimeout(() => {
      setDegraded(true)
      track('score_degraded', { afterMs: degradeAfterMs })
      degradeRecorded.current = patchJson(
        `/api/speaking/sessions/${initial.session.id}/degraded`,
        {},
      )
    }, degradeAfterMs)

    const result = await postBinary<WinnerView>(
      `/api/speaking/sessions/${initial.session.id}/audio`,
      take,
      'audio/wav',
    )
    clearTimeout(slow)
    track('score_round_trip_ms', { ms: Date.now() - submittedAt })

    // 收工 already happened while this was in flight — leave P4 alone.
    if (abandoned.current) return

    setDegraded(false)

    if (!result.ok) {
      // AC-S6: the prompt and the day's allowance both survive — back to P2.
      setPhase('prompt')
      setScoringFailed(true)
      setErrorKey(result.failure.details?.audio?.[0] ?? result.failure.messageKey)
      return
    }

    setWinner(result.data)
    setPhase('result')
  }, [degradeAfterMs, initial.session.id, recorder])

  /** 再试 — the same microphone, the same screen, then 收工 (AC-S4 → AC-S5). */
  const submitRetry = useCallback(async () => {
    const take = await recorder.stop()
    if (!take) {
      // Back to the next step, not to P2: the student still has a correction to
      // act on, and the day is still open.
      setPhase('result')
      setErrorKey('today.nothingRecorded')
      return
    }

    setPhase('saving')
    setErrorKey(null)

    const result = await postBinary<CompletionResult>(
      `/api/speaking/sessions/${initial.session.id}/retry`,
      take,
      'audio/wav',
    )

    if (!result.ok) {
      setPhase('result')
      setErrorKey(result.failure.details?.audio?.[0] ?? result.failure.messageKey)
      return
    }

    setWeek(result.data.week)
    setPhase('done')
    track('session_completed', { retryState: result.data.retryState })
  }, [initial.session.id, recorder])

  /**
   * AC-S5 — 跳过也算今天练完. No confirmation dialog: 允许停 (D3).
   *
   * Reached from two places: the next-step card (the ordinary exit) and the
   * degraded prompt, where there is no next step yet and this is the whole of
   * AC-S10's 「可选跳过直接 COMPLETED」.
   */
  const skipRetry = useCallback(async () => {
    const wasWaiting = degraded
    abandoned.current = true
    setPhase('saving')
    setErrorKey(null)

    // The server will only close an unscored day that it knows is degraded, so
    // wait for that record to have landed. Ordinary skips never touch this — the
    // ref is null unless the 20s line was crossed.
    await degradeRecorded.current?.catch(() => undefined)

    const result = await postJson<CompletionResult>(
      `/api/speaking/sessions/${initial.session.id}/skip-retry`,
      {},
    )

    if (!result.ok) {
      // Back to whichever screen the student left: still waiting on a score, or
      // holding a next step they have not acted on.
      abandoned.current = false
      setPhase(wasWaiting ? 'scoring' : 'result')
      setErrorKey(result.failure.messageKey)
      return
    }

    setWeek(result.data.week)
    setDegraded(false)
    setPhase('done')
    track('session_completed', { retryState: result.data.retryState })
  }, [degraded, initial.session.id])

  // The hard ceiling stops the take itself: 90 seconds is the format's limit as
  // much as the product's, and a take that runs past it would be rejected by the
  // upload gate after the student had already spoken it. It applies to the retry
  // and the warm-up for the same reason — the ceiling is the upload budget.
  const stopRef = useRef<() => Promise<void>>(submit)
  stopRef.current =
    activeTake === 'retry' ? submitRetry : activeTake === 'warmup' ? submitWarmup : submit
  useEffect(() => {
    if (!activeTake) return
    if (recorder.elapsedMs < bounds.ceilingMs) return
    void stopRef.current()
  }, [activeTake, recorder.elapsedMs, bounds.ceilingMs])

  async function beginRecording(kind: TakeKind) {
    setErrorKey(null)
    setScoringFailed(false)
    const started = await recorder.start()
    if (!started) return
    setPhase(kind === 'main' ? 'recording' : kind === 'retry' ? 'retrying' : 'warmup')
    if (kind === 'main') {
      // AC-S2 — "从进入首页到开始录音 ≤10s"，含首次授权.
      track('home_to_recording_ms', { ms: msSinceNavigation() })
    } else if (kind === 'retry') {
      track('retry_started')
    } else {
      track('warmup_started')
    }
  }

  const alert = errorKey ? (
    <Alert
      type="error"
      showIcon
      message={t(errorKey)}
      // AC-S6 — 「保留今日题目并允许重录主开口，不得消耗当日完成资格」. Saying so is
      // part of meeting it: a student who is not told the day survived will
      // assume it did not, and the criterion is about what they can still do.
      description={scoringFailed ? t('today.failed.hint') : undefined}
      style={{ marginBottom: 16 }}
      data-testid={scoringFailed ? 'scoring-failed' : undefined}
    />
  ) : null

  return (
    <Space direction="vertical" size="large" className="w-full">
      <Card>
        <Paragraph type="secondary" style={{ marginBottom: 4 }}>
          {t('today.promptLabel')}
        </Paragraph>
        <Title level={3} style={{ marginTop: 0 }}>
          {initial.prompt.text}
        </Title>
      </Card>

      {alert}
      {recorder.errorKey ? <Alert type="warning" showIcon message={t(recorder.errorKey)} /> : null}

      {phase === 'prompt' && warmup === 'offered' ? (
        <WarmupCard
          sentence={initial.prompt.warmupSentence}
          modelAudioUrl={initial.prompt.modelAudioUrl}
          onStart={() => void beginRecording('warmup')}
          onSkip={() => setWarmup('skipped')}
          starting={recorder.state === 'requesting'}
        />
      ) : null}

      {phase === 'prompt' && warmup === 'done' ? (
        <Alert
          type="success"
          showIcon
          message={t('today.warmup.received')}
          data-testid="warmup-done"
        />
      ) : null}

      {phase === 'prompt' ? (
        <Button
          type="primary"
          size="large"
          block
          icon={<AudioOutlined />}
          loading={recorder.state === 'requesting'}
          onClick={() => void beginRecording('main')}
        >
          {t('today.startRecording')}
        </Button>
      ) : null}

      {activeTake ? (
        <Card>
          <Space direction="vertical" size="middle" className="w-full">
            <Space>
              <Tag color="red">{t('today.recording')}</Tag>
              <span data-testid="elapsed">
                {t('today.elapsed', { seconds: seconds(recorder.elapsedMs) })}
              </span>
            </Space>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {activeTake === 'warmup'
                ? t('today.warmup.recordingHint')
                : activeTake === 'retry'
                  ? t('today.retry.hint')
                  : t('today.durationHint', {
                      min: seconds(minDurationMs),
                      max: seconds(maxDurationMs),
                    })}
            </Paragraph>
            <Button
              type="primary"
              size="large"
              block
              disabled={!longEnough}
              onClick={() => void stopRef.current()}
            >
              {longEnough
                ? t(
                    activeTake === 'warmup'
                      ? 'today.warmup.stop'
                      : activeTake === 'retry'
                        ? 'today.retry.stop'
                        : 'today.stopRecording',
                  )
                : t('today.keepGoing', {
                    seconds: seconds(bounds.floorMs - recorder.elapsedMs) + 1,
                  })}
            </Button>
          </Space>
        </Card>
      ) : null}

      {phase === 'scoring' || phase === 'saving' || phase === 'warmupSaving' ? (
        <Card>
          <Space direction="vertical" size="middle" className="w-full">
            <Space>
              <Spin indicator={<LoadingOutlined spin />} />
              <span>{t(waitingMessageKey(phase))}</span>
            </Space>

            {/* AC-S10. Appears only after the line is crossed, and only ever ADDS
                an option — the spinner above stays, because the request is still
                running and its result is still welcome. */}
            {degraded ? (
              <Alert
                type="warning"
                showIcon
                data-testid="degraded"
                message={t('today.degraded.title')}
                description={t('today.degraded.message')}
                action={
                  <Button size="small" onClick={() => void skipRetry()}>
                    {t('today.degraded.skip')}
                  </Button>
                }
              />
            ) : null}
          </Space>
        </Card>
      ) : null}

      {phase === 'result' && winner ? (
        <WinnerCard
          winner={winner}
          onRetry={() => void beginRecording('retry')}
          onSkip={() => void skipRetry()}
          starting={recorder.state === 'requesting'}
        />
      ) : null}

      {phase === 'done' ? <DoneCard week={week} /> : null}
    </Space>
  )
}

function takeKindOf(phase: Phase): TakeKind | null {
  if (phase === 'recording') return 'main'
  if (phase === 'retrying') return 'retry'
  if (phase === 'warmup') return 'warmup'
  return null
}

function waitingMessageKey(phase: Phase): string {
  if (phase === 'scoring') return 'today.scoring'
  if (phase === 'warmupSaving') return 'today.warmup.saving'
  return 'today.saving'
}

/**
 * A day that is already closed opens straight on P4 — the student came back to
 * see they had finished, not to be handed the record button again. A scored but
 * unfinished day resumes at its next step (the retry is still available).
 */
function startingPhase(initial: TodayView): Phase {
  if (initial.session.status === 'COMPLETED') return 'done'
  return initial.session.winnerType ? 'result' : 'prompt'
}

/**
 * P1 热身 (AC-S7) — 「播放示范并接受一句跟读，且跳过热身不影响进入主开口」.
 *
 * Optional in the strongest sense the layout can express: the 开始录音 button
 * sits below this card the entire time it is on screen, so the second of the two
 * paths the criterion demands is not a branch the student has to find. 跳过 is a
 * link rather than a button for the same reason skipping the retry is — offered,
 * not discouraged.
 */
function WarmupCard({
  sentence,
  modelAudioUrl,
  onStart,
  onSkip,
  starting,
}: {
  sentence: string
  modelAudioUrl: string | null
  onStart: () => void
  onSkip: () => void
  starting: boolean
}) {
  const t = useTranslations()

  return (
    <Card data-testid="warmup" size="small" title={t('today.warmup.title')}>
      <Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {t('today.warmup.hint')}
      </Paragraph>
      <Paragraph strong style={{ marginBottom: 12 }}>
        {sentence}
      </Paragraph>

      {modelAudioUrl ? (
        <audio controls preload="none" src={modelAudioUrl} style={{ height: 32, width: '100%' }} />
      ) : null}

      <Space direction="vertical" size="small" className="mt-4 w-full">
        <Button icon={<AudioOutlined />} block loading={starting} onClick={onStart}>
          {t('today.warmup.start')}
        </Button>
        <Button type="link" block onClick={onSkip}>
          {t('today.warmup.skip')}
        </Button>
      </Space>
    </Card>
  )
}

/**
 * AC-S3 — exactly one next step on screen. There is deliberately no second
 * card, no score, and no breakdown: a multi-dimensional report dilutes what the
 * student is supposed to do next (D16).
 *
 * The two buttons under it are not a second next step; they are the two ways out
 * of this one, and 跳过 is as legitimate an exit as 再说一遍 (已确认决策 5).
 */
function WinnerCard({
  winner,
  onRetry,
  onSkip,
  starting,
}: {
  winner: WinnerView
  onRetry: () => void
  onSkip: () => void
  starting: boolean
}) {
  const t = useTranslations()

  return (
    <Card
      data-testid="winner"
      data-winner={winner.winnerType ?? ''}
      title={
        <Space>
          <CheckCircleTwoTone twoToneColor="#52c41a" />
          {t(`today.winner.${winner.winnerType}`)}
        </Space>
      }
    >
      <Paragraph>
        {winner.coachLineKey ? t(winner.coachLineKey, winner.coachLineParams) : null}
      </Paragraph>

      <Space direction="vertical" size="small" className="w-full">
        {winner.retryItems.map((item, index) => (
          <RetryItem key={`${item.kind}-${index}`} item={item} />
        ))}
      </Space>

      <Space direction="vertical" size="small" className="mt-6 w-full">
        <Button
          type="primary"
          size="large"
          block
          icon={<AudioOutlined />}
          loading={starting}
          onClick={onRetry}
        >
          {t('today.retry.start')}
        </Button>
        {/* Plain text, not a ghost of the primary button: skipping is offered,
            not discouraged. A day the student chose to end still counts. */}
        <Button type="link" block onClick={onSkip}>
          {t('today.retry.skip')}
        </Button>
      </Space>
    </Card>
  )
}

/**
 * P4 收工 — 「今天练完了」 + the 7 天句 (SPEC §4.3, AC-S5 / AC-S8).
 *
 * The week line lands here rather than only on `/me` because this is the moment
 * it means something: the student just finished, and 「能感到在进步」 is one of
 * D9's three companion experiences to the core loop. The link to `/me` is the
 * only navigation this page ever grows, and only after the day is done — AC-S1's
 * "不展示任何模块/菜单列表" is about the landing screen.
 */
function DoneCard({ week }: { week: WeekView }) {
  const t = useTranslations()

  return (
    <Card
      data-testid="done"
      title={
        <Space>
          <SmileTwoTone twoToneColor="#52c41a" />
          {t('today.done.title')}
        </Space>
      }
    >
      <Paragraph data-testid="progress-line">
        {week.progress ? t(week.progress.key, week.progress.params) : t('me.empty')}
      </Paragraph>

      <WeekStrip days={week.days} />

      <Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
        <Link href="/me">{t('today.done.seeWeek')}</Link>
      </Paragraph>
    </Card>
  )
}

function RetryItem({ item }: { item: RetryItemView }) {
  return (
    <Space data-testid="retry-item" wrap>
      {item.kind === 'word' ? <SoundOutlined /> : null}
      <strong>{item.text}</strong>
      {item.ipa ? <span className="text-gray-500">{item.ipa}</span> : null}
      {/* AC-I3: every winner-A word must be playable. `audioUrl` is null only
          until the M5 TTS fallback covers words with no recording. */}
      {item.audioUrl ? (
        <audio controls preload="none" src={item.audioUrl} style={{ height: 32 }} />
      ) : null}
    </Space>
  )
}
