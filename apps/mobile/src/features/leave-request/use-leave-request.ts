import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  getGetBalanceQueryKey,
  getGetMyRequestsQueryKey,
  useCancelRequest,
  useSubmitRequest,
} from '@/api/generated/endpoints'
import { ApiError } from '@/api/mutator'
import { toIsoDate } from './domain'
import type { LeaveRequestType, Screen } from './types'

interface State {
  screen: Screen
  selectedDays: number[]
  selectedType: LeaveRequestType | null
  blockedMessage: string | null
  submitError: string | null
  cancelMessage: string | null
}

const initialState: State = {
  screen: 'home',
  selectedDays: [],
  selectedType: null,
  blockedMessage: null,
  submitError: null,
  cancelMessage: null,
}

/**
 * 화면 전환·선택 상태만 로컬로 관리한다. 연차 잔여·신청 목록은 이 훅이 들고 있지 않고
 * GET /leave/balance, GET /leave/requests 조회 결과를 그대로 props로 받아 쓴다(leave-request-page.tsx) —
 * submit()/cancelRequest()가 실제로 서버에 반영되므로, 반영 후에는 재조회로 최신값을 받는다.
 */
export function useLeaveRequest() {
  const [state, setState] = useState<State>(initialState)
  const queryClient = useQueryClient()
  const submitMutation = useSubmitRequest()
  const cancelMutation = useCancelRequest()

  function resetWizard(screen: Screen) {
    setState((s) => ({
      ...s,
      screen,
      selectedDays: [],
      selectedType: null,
      blockedMessage: null,
      submitError: null,
    }))
  }

  function goHome() {
    resetWizard('home')
  }

  function startApply() {
    resetWizard('step1')
  }

  function goStep1() {
    setState((s) => ({ ...s, screen: 'step1', blockedMessage: null }))
  }

  function goStatus() {
    setState((s) => ({ ...s, screen: 'status', cancelMessage: null }))
  }

  function step1Next() {
    setState((s) => (s.selectedDays.length > 0 ? { ...s, screen: 'step2' } : s))
  }

  function toggleDay(day: number) {
    setState((s) => {
      const exists = s.selectedDays.includes(day)
      const selectedDays = exists
        ? s.selectedDays.filter((d) => d !== day)
        : [...s.selectedDays, day]
      return { ...s, selectedDays, blockedMessage: null }
    })
  }

  function showBlockedMessage(label: string) {
    setState((s) => ({ ...s, blockedMessage: label }))
  }

  function pickType(type: LeaveRequestType) {
    setState((s) => ({ ...s, selectedType: type, screen: 'step3', submitError: null }))
  }

  async function invalidateLeaveQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetBalanceQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetMyRequestsQueryKey() }),
    ])
  }

  /** 신청 제출(POST /leave/requests) → 잔여·목록 재조회 → 완료 화면. 진동 피드백(N-6) */
  async function submit() {
    if (!state.selectedType) return
    const type = state.selectedType
    const now = new Date()
    const targetDates = [...state.selectedDays]
      .sort((a, b) => a - b)
      .map((day) => toIsoDate(now.getFullYear(), now.getMonth() + 1, day))

    try {
      await submitMutation.mutateAsync({
        data: { type, targetDates, idempotencyKey: crypto.randomUUID() },
      })
      if (navigator.vibrate) navigator.vibrate([30, 40, 30])
      await invalidateLeaveQueries()
      setState((s) => ({ ...s, screen: 'done', submitError: null }))
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '신청에 실패했어요. 다시 시도해 주세요.'
      setState((s) => ({ ...s, submitError: message }))
    }
  }

  /**
   * 대기 건 취소(POST /leave/requests/:id/cancel) → 목록 재조회 (US-03).
   * PENDING 건은 즉시 취소되지만, 1차 이상 승인된 건은 관리자 승인이 필요한 취소 요청만
   * 접수된다(result: CANCELLATION_REQUESTED) — 목록에서 바로 사라지지 않으므로 안내 메시지를 띄운다.
   */
  async function cancelRequest(id: string) {
    try {
      const response = await cancelMutation.mutateAsync({ id })
      await invalidateLeaveQueries()
      const cancelMessage =
        response.data.result === 'CANCELLATION_REQUESTED'
          ? '취소 요청을 접수했어요. 관리자 승인 후 취소돼요.'
          : null
      setState((s) => ({ ...s, cancelMessage }))
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '취소에 실패했어요. 다시 시도해 주세요.'
      setState((s) => ({ ...s, cancelMessage: message }))
    }
  }

  const cancelingId = cancelMutation.isPending ? cancelMutation.variables?.id : undefined

  return {
    state,
    submitting: submitMutation.isPending,
    cancelingId,
    actions: {
      goHome,
      startApply,
      goStep1,
      goStatus,
      step1Next,
      toggleDay,
      showBlockedMessage,
      pickType,
      submit,
      cancelRequest,
    },
  }
}
