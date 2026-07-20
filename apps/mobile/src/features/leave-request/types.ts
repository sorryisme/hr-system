export type LeaveRequestType = 'ANNUAL' | 'HALF_AM' | 'HALF_PM' | 'SUBSTITUTE_HOLIDAY'

export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface LeaveRequest {
  id: string
  status: LeaveRequestStatus
  type: LeaveRequestType
  /** 선택한 일(day-of-month) 목록. 오름차순으로 정렬되어 있다고 가정하지 않는다. */
  days: number[]
  reason: string | null
  /** 과거 날짜 포함 신청 여부 (D-3 사후 신청) */
  postApply: boolean
}

export type Screen = 'home' | 'step1' | 'step2' | 'step3' | 'done' | 'status'
