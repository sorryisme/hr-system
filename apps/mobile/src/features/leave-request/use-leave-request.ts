import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  getGetBalanceQueryKey,
  getGetMyRequestsQueryKey,
  useCancelRequest,
  useSubmitRequest,
} from '@/api/generated/endpoints'
import { ApiError } from '@/api/mutator'
import { generateUuid } from '@/lib/uuid'
import { addMonthOffset, currentYearMonth, MAX_MONTH_OFFSET, toIsoDate } from './domain'
import type { LeaveRequestType, Screen } from './types'

interface State {
  screen: Screen
  /** 위저드 시작(또는 마지막 월 이동) 시점에 고정한 기준 연/월. 이후 이동은 monthOffset만
   * 바꾸고 이 값은 건드리지 않는다 — 화면 렌더와 제출이 각자 다른 시점의 `new Date()`를
   * 읽어 자정 경계에서 서로 다른 달을 계산하는 걸 막기 위함(§P2 리뷰). */
  baseYear: number
  baseMonth: number
  /** 날짜 선택 화면에서 보고 있는 달(0=기준 달 … MAX_MONTH_OFFSET=+2개월) */
  monthOffset: number
  selectedDays: number[]
  selectedType: LeaveRequestType | null
  blockedMessage: string | null
  submitError: string | null
  cancelMessage: string | null
}

function initialState(): State {
  const { year, month } = currentYearMonth()
  return {
    screen: 'home',
    baseYear: year,
    baseMonth: month,
    monthOffset: 0,
    selectedDays: [],
    selectedType: null,
    blockedMessage: null,
    submitError: null,
    cancelMessage: null,
  }
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

  /** 기준 연/월을 현재 시각으로 다시 고정한다 — 새 신청을 시작할 때만 호출(진행 중 월 이동과는 무관) */
  function resetWizard(screen: Screen) {
    const { year, month } = currentYearMonth()
    setState((s) => ({
      ...s,
      screen,
      baseYear: year,
      baseMonth: month,
      monthOffset: 0,
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

  /** 달 이동. 날짜 선택은 한 달 안에서만 하므로 이동 시 기존 선택은 초기화한다 */
  function prevMonth() {
    setState((s) =>
      s.monthOffset > 0
        ? { ...s, monthOffset: s.monthOffset - 1, selectedDays: [], blockedMessage: null }
        : s,
    )
  }

  function nextMonth() {
    setState((s) =>
      s.monthOffset < MAX_MONTH_OFFSET
        ? { ...s, monthOffset: s.monthOffset + 1, selectedDays: [], blockedMessage: null }
        : s,
    )
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

  /** 신청 제출(POST /leave/requests) → 잔여·목록 재조회 → 완료 화면. 진동 피드백(N-6).
   * 연/월은 반드시 state.baseYear/baseMonth+monthOffset(위저드가 들고 있는 고정값)에서 파생한다 —
   * 여기서 `new Date()`를 다시 읽으면 자정을 넘겨 제출할 때 화면에 보이던 달과 어긋날 수 있다. */
  async function submit() {
    if (!state.selectedType) return
    const type = state.selectedType
    const { year, month } = addMonthOffset(state.baseYear, state.baseMonth, state.monthOffset)
    const targetDates = [...state.selectedDays]
      .sort((a, b) => a - b)
      .map((day) => toIsoDate(year, month, day))

    try {
      await submitMutation.mutateAsync({
        data: { type, targetDates, idempotencyKey: generateUuid() },
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
      prevMonth,
      nextMonth,
      showBlockedMessage,
      pickType,
      submit,
      cancelRequest,
    },
  }
}
