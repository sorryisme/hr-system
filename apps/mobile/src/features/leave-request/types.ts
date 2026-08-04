export type LeaveRequestType = 'ANNUAL' | 'HALF_AM' | 'HALF_PM' | 'SUBSTITUTE_HOLIDAY'

export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface LeaveRequest {
  id: string
  status: LeaveRequestStatus
  type: LeaveRequestType
  /** 신청 대상 일자(ISO YYYY-MM-DD) 목록. 오름차순으로 정렬되어 있다고 가정하지 않는다. */
  dates: string[]
  reason: string | null
  /** 과거 날짜 포함 신청 여부 (D-3 사후 신청) */
  postApply: boolean
  /** 1차 이상 승인된 건의 취소 요청이 관리자 승인을 기다리는 중인지 여부 */
  pendingCancellation: boolean
  /**
   * 백엔드 상태가 INTERIM_APPROVED 또는 APPROVED라 취소 시 즉시 취소되지 않고
   * 별도 결재(취소 신청)를 거쳐야 하는지 여부. INTERIM_APPROVED는 화면상 status가
   * 'PENDING'으로 접혀 보이므로(leave-request-page.tsx), 버튼 문구는 status가 아니라
   * 이 값으로 판단해야 한다.
   */
  requiresCancellationApproval: boolean
}

export type Screen = 'home' | 'step1' | 'step2' | 'step3' | 'done' | 'status'
