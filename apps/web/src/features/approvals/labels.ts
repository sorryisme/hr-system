import type {
  ApprovalAction,
  ApprovalRequestStatus,
  ApprovalRequestType,
  JobRole,
  RequestListItemDto,
} from '@/api/generated/model'

export const TYPE_LABELS: Record<ApprovalRequestType, string> = {
  ANNUAL: '연차',
  HALF_AM: '오전반차',
  HALF_PM: '오후반차',
  SUBSTITUTE_HOLIDAY: '휴일대체',
  SHIFT_CHANGE: '근무조정',
  CANCEL: '취소신청',
}

export const STATUS_LABELS: Record<ApprovalRequestStatus, string> = {
  PENDING: '대기',
  INTERIM_APPROVED: '중간승인',
  APPROVED: '승인',
  REJECTED: '반려',
  CANCELED: '취소',
  CANCELED_AFTER_APPROVAL: '승인 후 취소',
}

export const ACTION_LABELS: Record<ApprovalAction, string> = {
  SUBMIT: '제출',
  APPROVE: '승인',
  REJECT: '반려',
  CANCEL: '취소',
}

export const JOB_ROLE_LABELS: Record<JobRole, string> = {
  DIRECTOR: '시설장',
  OFFICE_MANAGER: '사무국장',
  SOCIAL_WORKER: '사회복지사',
  NURSE: '간호사',
  NURSE_AIDE: '간호조무사',
  PHYSICAL_THERAPIST: '물리치료사',
  OCCUPATIONAL_THERAPIST: '작업치료사',
  CAREGIVER: '요양보호사',
  CLERK: '사무원',
  DIETITIAN: '영양사',
  COOK: '조리원',
  HYGIENIST: '위생원',
  JANITOR: '관리인',
}

/** '2026-07-21' → '7월 21일' */
export function formatTargetDate(isoDate: string): string {
  const [, m, d] = isoDate.split('-')
  return `${Number(m)}월 ${Number(d)}일`
}

export function formatTargetDates(dates: string[]): string {
  if (dates.length === 0) return '-'
  if (dates.length === 1) return formatTargetDate(dates[0])
  return `${formatTargetDate(dates[0])} ~ ${formatTargetDate(dates[dates.length - 1])} (${dates.length}일)`
}

/** ISO datetime → '7/15 09:12' */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 결재단계 요약: '2/3 단계 완료' 등. 목록 행 둘째 줄(§3.3 A-3) */
export function stageSummary(item: RequestListItemDto): string {
  if (item.status === 'APPROVED') {
    return item.isFinalByDelegation ? '전결 승인' : '최종 승인'
  }
  if (item.status === 'REJECTED') return `${item.currentStep + 1}차 반려`
  if (item.status === 'CANCELED' || item.status === 'CANCELED_AFTER_APPROVAL') {
    return STATUS_LABELS[item.status]
  }
  return `${item.currentStep}/${item.totalSteps} 단계 완료`
}
