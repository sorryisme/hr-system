import { STATUS_LABELS, TYPE_LABELS } from './labels'
import type { LeaveRequest, LeaveRequestType } from './types'

/** 유형별 연차 차감량. 휴일대체는 연차가 아니라 유대 잔여에서 1건 차감(D-15) */
export function deductAmount(type: LeaveRequestType, dayCount: number): number {
  if (type === 'ANNUAL') return dayCount
  if (type === 'SUBSTITUTE_HOLIDAY') return 0
  return 0.5 * dayCount // 반차 (D-1: 0.5일)
}

/** 대기/승인 상태 신청이 있는 날짜 집합 — 중복 신청 차단용 (US-01) */
export function blockedDaySet(requests: LeaveRequest[]): Set<number> {
  const set = new Set<number>()
  for (const r of requests) {
    if (r.status === 'PENDING' || r.status === 'APPROVED') {
      for (const d of r.days) set.add(d)
    }
  }
  return set
}

/** 2단계 각 유형의 선택 가능 여부. 불가하면 사유 문자열, 가능하면 null (US-01, C-2) */
export function typeDisabledReason(
  type: LeaveRequestType,
  selectedDayCount: number,
  balance: number,
  subBalance: number,
): string | null {
  if (type === 'ANNUAL') {
    if (selectedDayCount > balance) {
      return `남은 연차가 ${balance}일입니다. ${selectedDayCount}일을 신청할 수 없어요.`
    }
  } else if (type === 'HALF_AM' || type === 'HALF_PM') {
    if (selectedDayCount > 1) return '반차는 하루만 선택할 수 있어요.'
    if (balance < 0.5) return '남은 연차가 부족해요.'
  } else if (type === 'SUBSTITUTE_HOLIDAY') {
    if (subBalance < 1) return '받은 휴일대체가 없어요.' // C-2
    if (selectedDayCount > 1) return '휴일대체는 하루만 선택할 수 있어요.'
  }
  return null
}

/** 선택 날짜에 과거일 포함 여부 — "사후 신청" 라벨 (D-3) */
export function hasPastSelected(selectedDays: number[], todayOfMonth: number): boolean {
  return selectedDays.some((d) => d < todayOfMonth)
}

/** 마감 임박 경고 여부 — 당일 또는 (내일 && 18시 이후). 차단하지 않음 (D-4) */
export function hasDeadlineWarning(
  selectedDays: number[],
  todayOfMonth: number,
  currentHour: number,
): boolean {
  return selectedDays.some(
    (d) => d === todayOfMonth || (d === todayOfMonth + 1 && currentHour >= 18),
  )
}

function fmtDays(v: number): string {
  return `${v}일`
}

/** [21,22] → "7월 21~22일", [3,10] → "7월 3, 10일" */
export function rangeText(days: number[], month: number): string {
  const s = [...days].sort((a, b) => a - b)
  if (s.length === 0) return ''
  if (s.length === 1) return `${month}월 ${s[0]}일`
  const contiguous = s.every((v, i) => i === 0 || v === s[i - 1] + 1)
  return contiguous ? `${month}월 ${s[0]}~${s[s.length - 1]}일` : `${month}월 ${s.join(', ')}일`
}

/** 신청 유형+수량 표기(예: "연차 2일") */
export function amountLabel(type: LeaveRequestType, dayCount: number): string {
  if (type === 'ANNUAL') return fmtDays(dayCount)
  if (type === 'SUBSTITUTE_HOLIDAY') return '1일'
  return fmtDays(0.5 * dayCount)
}

/** 유형+수량 표기. 대기중엔 "… 신청 (결재 대기중)" 접미 (US-02) */
export function typeLabel(req: LeaveRequest): string {
  const core = `${TYPE_LABELS[req.type].name} ${amountLabel(req.type, req.days.length)}`
  return req.status === 'PENDING' ? `${core} 신청 (${STATUS_LABELS.PENDING})` : core
}
