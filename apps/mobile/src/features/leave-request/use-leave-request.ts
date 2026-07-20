import { useState } from 'react'
import { deductAmount } from './domain'
import { MOCK_INITIAL_BALANCE, MOCK_INITIAL_SUB_BALANCE, MOCK_REQUESTS } from './mock-data'
import type { LeaveRequest, LeaveRequestType, Screen } from './types'

interface State {
  screen: Screen
  selectedDays: number[]
  selectedType: LeaveRequestType | null
  balance: number
  subBalance: number
  requests: LeaveRequest[]
  blockedMessage: string | null
}

const initialState: State = {
  screen: 'home',
  selectedDays: [],
  selectedType: null,
  balance: MOCK_INITIAL_BALANCE,
  subBalance: MOCK_INITIAL_SUB_BALANCE,
  requests: MOCK_REQUESTS,
  blockedMessage: null,
}

export function useLeaveRequest() {
  const [state, setState] = useState<State>(initialState)

  function resetWizard(screen: Screen) {
    setState((s) => ({ ...s, screen, selectedDays: [], selectedType: null, blockedMessage: null }))
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
    setState((s) => ({ ...s, screen: 'status' }))
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
    setState((s) => ({ ...s, selectedType: type, screen: 'step3' }))
  }

  /** 신청 생성(PENDING) + 잔여 차감 + 완료 화면. 진동 피드백(N-6) */
  function submit(postApply: boolean) {
    if (navigator.vibrate) navigator.vibrate([30, 40, 30])
    setState((s) => {
      if (!s.selectedType) return s
      const type = s.selectedType
      const days = [...s.selectedDays].sort((a, b) => a - b)
      const newRequest: LeaveRequest = {
        id: crypto.randomUUID(),
        status: 'PENDING',
        type,
        days,
        reason: null,
        postApply,
      }
      const subBalance = type === 'SUBSTITUTE_HOLIDAY' ? s.subBalance - 1 : s.subBalance
      const balance =
        type === 'SUBSTITUTE_HOLIDAY'
          ? s.balance
          : +(s.balance - deductAmount(type, days.length)).toFixed(1)
      return {
        ...s,
        screen: 'done',
        requests: [newRequest, ...s.requests],
        balance,
        subBalance,
      }
    })
  }

  /** 대기 건 취소: 목록에서 제거 + 차감했던 잔여 복원 (US-03) */
  function cancelRequest(id: string) {
    setState((s) => {
      const req = s.requests.find((r) => r.id === id)
      if (!req || req.status !== 'PENDING') return s
      const requests = s.requests.filter((r) => r.id !== id)
      const subBalance = req.type === 'SUBSTITUTE_HOLIDAY' ? s.subBalance + 1 : s.subBalance
      const balance =
        req.type === 'SUBSTITUTE_HOLIDAY'
          ? s.balance
          : +(s.balance + deductAmount(req.type, req.days.length)).toFixed(1)
      return { ...s, requests, balance, subBalance }
    })
  }

  return {
    state,
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
