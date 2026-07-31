import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getGetTodayQueryKey, useClockIn, useClockOut, useGetToday } from '@/api/generated/endpoints'
import { ApiError } from '@/api/mutator'
import { formatKoreanTime } from './domain'
import { getCurrentPosition } from './use-geolocation'
import type { TagResult } from './types'

/**
 * 오늘 상태(useGetToday)는 서버가 단일 진실 소스이므로 로컬에는 태그 처리 중 여부와
 * 결과 화면 표시만 둔다. 성공·실패 모두 진동으로 이중 피드백한다(N-6).
 */
export function useAttendance() {
  const todayQuery = useGetToday()
  const clockInMutation = useClockIn()
  const clockOutMutation = useClockOut()
  const queryClient = useQueryClient()
  const [result, setResult] = useState<TagResult | null>(null)

  const isTagging = clockInMutation.isPending || clockOutMutation.isPending
  const isClockedIn = todayQuery.data?.data.status === 'CLOCKED_IN'

  async function handleTag() {
    try {
      const { lat, lng } = await getCurrentPosition()
      const response = isClockedIn
        ? await clockOutMutation.mutateAsync({ data: { lat, lng } })
        : await clockInMutation.mutateAsync({ data: { lat, lng } })

      navigator.vibrate?.(200)
      setResult({
        kind: 'success',
        label: isClockedIn ? '퇴근 완료' : '출근 완료',
        time: formatKoreanTime(response.data.clockAt),
      })
      await queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() })
    } catch (error) {
      navigator.vibrate?.([100, 50, 100])
      const message = error instanceof ApiError || error instanceof Error
        ? error.message
        : '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'
      setResult({ kind: 'error', message })
    }
  }

  function dismissResult() {
    setResult(null)
  }

  return {
    today: todayQuery.data?.data,
    isLoadingToday: todayQuery.isPending,
    isErrorToday: todayQuery.isError,
    isTagging,
    isClockedIn,
    result,
    handleTag,
    dismissResult,
  }
}
