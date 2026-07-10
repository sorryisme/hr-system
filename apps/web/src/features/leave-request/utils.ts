import { TYPE_META } from './constants'
import type { LeaveRequestItem, LeaveType } from './types'

/** 유형별 연차 차감량. 휴일대체는 연차가 아니라 유대 잔여에서 1건 차감 */
export function deductAmount(type: LeaveType, dayCount: number): number {
  if (type === 'ANNUAL') return dayCount
  if (type === 'SUBSTITUTE') return 0
  return 0.5 * dayCount
}

/** 대기/승인 상태 신청이 있는 날짜 집합 — 중복 신청 차단용 */
export function blockedDaySet(requests: LeaveRequestItem[]): Set<number> {
  const set = new Set<number>()
  for (const r of requests) {
    if (r.status === 'PENDING' || r.status === 'APPROVED') {
      r.days.forEach((d) => set.add(d))
    }
  }
  return set
}

/** 유형 선택 가능 여부. 불가하면 사유 문자열, 가능하면 null */
export function typeDisabledReason(
  type: LeaveType,
  selectedDays: number[],
  balance: number,
  subBalance: number,
): string | null {
  const n = selectedDays.length
  if (type === 'ANNUAL') {
    if (n > balance) return `남은 연차가 ${balance}일입니다. ${n}일을 신청할 수 없어요.`
  } else if (type === 'HALF_AM' || type === 'HALF_PM') {
    if (n > 1) return '반차는 하루만 선택할 수 있어요.'
    if (balance < 0.5) return '남은 연차가 부족해요.'
  } else if (type === 'SUBSTITUTE') {
    if (subBalance < 1) return '받은 휴일대체가 없어요.'
    if (n > 1) return '휴일대체는 하루만 선택할 수 있어요.'
  }
  return null
}

/** 선택 날짜에 과거일 포함 여부 — "사후 신청" 라벨 */
export function hasPastSelected(selectedDays: number[], today: number): boolean {
  return selectedDays.some((d) => d < today)
}

/** 마감 임박 경고 여부 — 당일 또는 (내일 && 18시 이후). 차단하지 않음 */
export function hasDeadlineWarning(selectedDays: number[], today: number, hour: number): boolean {
  return selectedDays.some((d) => d === today || (d === today + 1 && hour >= 18))
}

export function fmtDays(v: number): string {
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

/** 유형+수량 표기. 대기중엔 "… 신청 (결재 대기중)" 접미 */
export function typeLabel(request: LeaveRequestItem): string {
  const meta = TYPE_META[request.type]
  const amt =
    request.type === 'ANNUAL'
      ? `${request.days.length}일`
      : request.type === 'SUBSTITUTE'
        ? '1일'
        : `${0.5 * request.days.length}일`
  const core = `${meta.name} ${amt}`
  return request.status === 'PENDING' ? `${core} 신청 (결재 대기중)` : core
}
