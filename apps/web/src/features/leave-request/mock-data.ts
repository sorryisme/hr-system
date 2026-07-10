import type { LeaveRequestItem } from './types'

/**
 * 임시 목데이터. apps/api에 휴가 신청/잔여일수 API가 준비되면
 * 이 파일을 제거하고 Orval 생성 클라이언트 호출로 교체한다.
 */
export const MOCK_USER = {
  name: '김순자 선생님',
  facility: '돌봄손길 요양원',
}

export const MOCK_INITIAL_BALANCE = 5
export const MOCK_INITIAL_SUB_BALANCE = 1

export const MOCK_INITIAL_REQUESTS: LeaveRequestItem[] = [
  {
    id: 'mock-1',
    status: 'PENDING',
    type: 'ANNUAL',
    days: [21, 22],
    reason: null,
    postApply: false,
  },
  {
    id: 'mock-2',
    status: 'REJECTED',
    type: 'HALF_AM',
    days: [15],
    reason: '당일 물리치료 일정이 겹칩니다.',
    postApply: false,
  },
  {
    id: 'mock-3',
    status: 'APPROVED',
    type: 'ANNUAL',
    days: [3],
    reason: null,
    postApply: false,
  },
]
