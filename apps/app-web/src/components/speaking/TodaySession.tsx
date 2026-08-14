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
import { postBinary, postJson } from '@/lib/client-api'
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
 */
type Phase = 'prompt' | 'recording' | 'scoring' | 'result' | 'retrying' | 'saving' | 'done'

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
 * P0 → P2 → P3 → P4 in one component and one route.
 *
 * "再试" must not leave the session (AC-S4) and there is no report page to jump
 * to (SPEC §4.3), so the whole beat sequence is one client component swapping
 * its own body. The server round trips are: create/read today (already done by
 * the page), upload the take, and close the day.
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
  const [winner, setWinner] = useState<WinnerView | null>(
    initial.session.winnerType ? initial.session : null,
  )
  const [week, setWeek] = useState<WeekView>(initialWeek)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  const { minDurationMs, maxDurationMs, retryMinDurationMs } = initial.limits
  const isRetry = phase === 'retrying'
  const floorMs = isRetry ? retryMinDurationMs : minDurationMs
  const longEnough = recorder.elapsedMs >= floorMs

  const submit = useCallback(async () => {
    const take = await recorder.stop()
    if (!take) {
      setPhase('prompt')
      setErrorKey('today.nothingRecorded')
      return
    }

    setPhase('scoring')
    setErrorKey(null)

    const submittedAt = Date.now()
    const result = await postBinary<WinnerView>(
      `/api/speaking/sessions/${initial.session.id}/audio`,
      take,
      'audio/wav',
    )
    track('score_round_trip_ms', { ms: Date.now() - submittedAt })

    if (!result.ok) {
      // AC-S6: the prompt and the day's allowance both survive — back to P2.
      setPhase('prompt')
      setErrorKey(result.failure.details?.audio?.[0] ?? result.failure.messageKey)
      return
    }

    setWinner(result.data)
    setPhase('result')
  }, [initial.session.id, recorder])

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

  /** AC-S5 — 跳过也算今天练完. No confirmation dialog: 允许停 (D3). */
  const skipRetry = useCallback(async () => {
    setPhase('saving')
    setErrorKey(null)

    const result = await postJson<CompletionResult>(
      `/api/speaking/sessions/${initial.session.id}/skip-retry`,
      {},
    )

    if (!result.ok) {
      setPhase('result')
      setErrorKey(result.failure.messageKey)
      return
    }

    setWeek(result.data.week)
    setPhase('done')
    track('session_completed', { retryState: result.data.retryState })
  }, [initial.session.id])

  // The hard ceiling stops the take itself: 90 seconds is the format's limit as
  // much as the product's, and a take that runs past it would be rejected by the
  // upload gate after the student had already spoken it. It applies to the retry
  // for the same reason — the ceiling is the upload budget.
  const stopRef = useRef(submit)
  stopRef.current = isRetry ? submitRetry : submit
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'retrying') return
    if (recorder.elapsedMs < maxDurationMs) return
    void stopRef.current()
  }, [phase, recorder.elapsedMs, maxDurationMs])

  async function beginRecording(next: 'recording' | 'retrying') {
    setErrorKey(null)
    const started = await recorder.start()
    if (!started) return
    setPhase(next)
    if (next === 'recording') {
      // AC-S2 — "从进入首页到开始录音 ≤10s"，含首次授权.
      track('home_to_recording_ms', { ms: msSinceNavigation() })
    } else {
      track('retry_started')
    }
  }

  const alert = errorKey ? (
    <Alert type="error" showIcon message={t(errorKey)} style={{ marginBottom: 16 }} />
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

      {phase === 'prompt' ? (
        <Button
          type="primary"
          size="large"
          block
          icon={<AudioOutlined />}
          loading={recorder.state === 'requesting'}
          onClick={() => void beginRecording('recording')}
        >
          {t('today.startRecording')}
        </Button>
      ) : null}

      {phase === 'recording' || phase === 'retrying' ? (
        <Card>
          <Space direction="vertical" size="middle" className="w-full">
            <Space>
              <Tag color="red">{t('today.recording')}</Tag>
              <span data-testid="elapsed">
                {t('today.elapsed', { seconds: seconds(recorder.elapsedMs) })}
              </span>
            </Space>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {isRetry
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
              onClick={() => void (isRetry ? submitRetry() : submit())}
            >
              {longEnough
                ? t(isRetry ? 'today.retry.stop' : 'today.stopRecording')
                : t('today.keepGoing', { seconds: seconds(floorMs - recorder.elapsedMs) + 1 })}
            </Button>
          </Space>
        </Card>
      ) : null}

      {phase === 'scoring' || phase === 'saving' ? (
        <Card>
          <Space>
            <Spin indicator={<LoadingOutlined spin />} />
            <span>{t(phase === 'scoring' ? 'today.scoring' : 'today.saving')}</span>
          </Space>
        </Card>
      ) : null}

      {phase === 'result' && winner ? (
        <WinnerCard
          winner={winner}
          onRetry={() => void beginRecording('retrying')}
          onSkip={() => void skipRetry()}
          starting={recorder.state === 'requesting'}
        />
      ) : null}

      {phase === 'done' ? <DoneCard week={week} /> : null}
    </Space>
  )
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
