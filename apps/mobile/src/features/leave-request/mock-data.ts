import type { LeaveRequest } from './types'

export const MOCK_EMPLOYEE_NAME = '김순자 선생님'

export const MOCK_INITIAL_BALANCE = 5 // 남은 연차 (일 단위, 반차로 0.5 가능)
export const MOCK_INITIAL_SUB_BALANCE = 1 // 받은 유급휴일대체 (건 단위)

const today = new Date()
const DAYS_IN_MONTH = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
const TODAY_OF_MONTH = today.getDate()

/** 이번 달 범위(1~말일)로 고정한 상대일. 모킹 데이터 전용. */
const d = (offset: number) => Math.min(DAYS_IN_MONTH, Math.max(1, TODAY_OF_MONTH + offset))

/** 서로 다른 두 날짜를 보장한다 — d()만 쓰면 월 경계 근처에서 같은 날로 겹칠 수 있다. */
function distinctPair(offsetA: number, offsetB: number): [number, number] {
  const a = d(offsetA)
  const b = a < DAYS_IN_MONTH ? Math.max(a + 1, d(offsetB)) : a - 1
  return a < b ? [a, b] : [b, a]
}

const pendingDays = distinctPair(3, 4)

/** 내 신청 목록 초기값(최신순). 실제 데이터는 apps/api 연동 시 대체. */
export const MOCK_REQUESTS: LeaveRequest[] = [
  {
    id: 'mock-1',
    status: 'PENDING',
    type: 'ANNUAL',
    days: pendingDays,
    reason: null,
    postApply: false,
  },
  {
    id: 'mock-2',
    status: 'REJECTED',
    type: 'HALF_AM',
    days: [d(-2)],
    reason: '당일 물리치료 일정이 겹칩니다.',
    postApply: false,
  },
  {
    id: 'mock-3',
    status: 'APPROVED',
    type: 'ANNUAL',
    days: [d(-9)],
    reason: null,
    postApply: false,
  },
]
