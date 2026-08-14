'use client'

import {
  AudioOutlined,
  CheckCircleTwoTone,
  LoadingOutlined,
  SoundOutlined,
} from '@ant-design/icons'
import { Alert, Button, Card, Space, Spin, Tag } from 'antd'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { postBinary } from '@/lib/client-api'
import { track, msSinceNavigation } from '@/lib/telemetry'
import { Paragraph, Title } from '@/components/typography'
import { useRecorder } from './useRecorder'
// Types only — `lib/speaking/today.ts` is `server-only`, and `import type` is
// erased before the bundler ever sees it.
import type { RetryItemView, TodayView, WinnerView } from '@/lib/speaking/today'

type Phase = 'prompt' | 'recording' | 'scoring' | 'result'

function seconds(ms: number): number {
  return Math.floor(ms / 1000)
}

/**
 * P0 → P2 → P3 in one component and one route.
 *
 * "再试" must not leave the session (AC-S4) and there is no report page to jump
 * to (SPEC §4.3), so the whole beat sequence is one client component swapping
 * its own body. The server round trips are: create/read today (already done by
 * the page), and upload the take.
 */
export function TodaySession({ initial }: { initial: TodayView }) {
  const t = useTranslations()
  const recorder = useRecorder()

  const [phase, setPhase] = useState<Phase>(initial.session.winnerType ? 'result' : 'prompt')
  const [winner, setWinner] = useState<WinnerView | null>(
    initial.session.winnerType ? initial.session : null,
  )
  const [errorKey, setErrorKey] = useState<string | null>(null)

  const { minDurationMs, maxDurationMs } = initial.limits
  const longEnough = recorder.elapsedMs >= minDurationMs

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

  // The hard ceiling stops the take itself: 90 seconds is the format's limit as
  // much as the product's, and a take that runs past it would be rejected by the
  // upload gate after the student had already spoken it.
  const submitRef = useRef(submit)
  submitRef.current = submit
  useEffect(() => {
    if (phase !== 'recording' || recorder.elapsedMs < maxDurationMs) return
    void submitRef.current()
  }, [phase, recorder.elapsedMs, maxDurationMs])

  async function beginRecording() {
    setErrorKey(null)
    const started = await recorder.start()
    if (!started) return
    setPhase('recording')
    // AC-S2 — "从进入首页到开始录音 ≤10s"，含首次授权.
    track('home_to_recording_ms', { ms: msSinceNavigation() })
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
          onClick={beginRecording}
        >
          {t('today.startRecording')}
        </Button>
      ) : null}

      {phase === 'recording' ? (
        <Card>
          <Space direction="vertical" size="middle" className="w-full">
            <Space>
              <Tag color="red">{t('today.recording')}</Tag>
              <span data-testid="elapsed">
                {t('today.elapsed', { seconds: seconds(recorder.elapsedMs) })}
              </span>
            </Space>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {t('today.durationHint', {
                min: seconds(minDurationMs),
                max: seconds(maxDurationMs),
              })}
            </Paragraph>
            <Button type="primary" size="large" block disabled={!longEnough} onClick={submit}>
              {longEnough
                ? t('today.stopRecording')
                : t('today.keepGoing', {
                    seconds: seconds(minDurationMs - recorder.elapsedMs) + 1,
                  })}
            </Button>
          </Space>
        </Card>
      ) : null}

      {phase === 'scoring' ? (
        <Card>
          <Space>
            <Spin indicator={<LoadingOutlined spin />} />
            <span>{t('today.scoring')}</span>
          </Space>
        </Card>
      ) : null}

      {phase === 'result' && winner ? <WinnerCard winner={winner} /> : null}
    </Space>
  )
}

/**
 * AC-S3 — exactly one next step on screen. There is deliberately no second
 * card, no score, and no breakdown: a multi-dimensional report dilutes what the
 * student is supposed to do next (D16).
 */
function WinnerCard({ winner }: { winner: WinnerView }) {
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
