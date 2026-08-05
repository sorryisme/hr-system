import { STATUS_LABELS, TYPE_LABELS } from './labels'
import type { LeaveRequest, LeaveRequestType } from './types'

/** 신청 화면에서 이동 가능한 최대 월 offset(0=이번 달). 근무표는 통상 익월 초까지만 확정되므로
 * 너무 먼 미래는 선택지에서 제외한다 — 실제 차단은 서버의 근무표 존재 여부 검증이 한다. */
export const MAX_MONTH_OFFSET = 2

/** 마법사 시작(또는 월 이동) 시점의 기준 연/월. 이 값을 위저드 상태에 고정해 두고 이후
 * addMonthOffset()으로만 파생시켜야, 날짜 선택 화면 렌더와 제출 시점에 각각 `new Date()`를
 * 다시 호출하다 자정을 넘겨 서로 다른 달을 계산하는 것을 막을 수 있다. */
export function currentYearMonth(now: Date = new Date()): { year: number; month: number } {
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/** baseYear/baseMonth에서 offset개월 이동한 연/월(순수 계산, 현재 시각을 다시 읽지 않는다).
 * 12월 + n처럼 연도가 넘어가는 경우도 처리 */
export function addMonthOffset(
  baseYear: number,
  baseMonth: number,
  offset: number,
): { year: number; month: number } {
  const d = new Date(baseYear, baseMonth - 1 + offset, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

/** 유형별 연차 차감량. 휴일대체는 연차가 아니라 유대 잔여에서 1건 차감(D-15) */
export function deductAmount(type: LeaveRequestType, dayCount: number): number {
  if (type === 'ANNUAL') return dayCount
  if (type === 'SUBSTITUTE_HOLIDAY') return 0
  return 0.5 * dayCount // 반차 (D-1: 0.5일)
}

/**
 * 대기/승인 상태 신청이 있는 날짜 집합(달력에 표시 중인 year/month로 한정) — 중복 신청 차단용 (US-01).
 * 신청은 여러 달에 걸친 이력을 포함할 수 있어 day-of-month만으로는 다른 달과 겹칠 수 있다.
 */
export function blockedDaySet(requests: LeaveRequest[], year: number, month: number): Set<number> {
  const set = new Set<number>()
  for (const r of requests) {
    if (r.status !== 'PENDING' && r.status !== 'APPROVED') continue
    for (const iso of r.dates) {
      const [y, m, d] = iso.split('-').map(Number)
      if (y === year && m === month) set.add(d)
    }
  }
  return set
}

/** 신청 건(dates: ISO)의 표시 텍스트. [21,22]→"7월 21~22일", 서로 다른 달이면 각 날짜를 나열 */
export function formatRequestDates(dates: string[]): string {
  const sorted = [...dates].sort()
  if (sorted.length === 0) return ''
  const parts = sorted.map((iso) => {
    const [, m, d] = iso.split('-').map(Number)
    return { month: m, day: d }
  })
  const sameMonth = parts.every((p) => p.month === parts[0].month)
  if (parts.length === 1) return `${parts[0].month}월 ${parts[0].day}일`
  if (sameMonth) {
    const days = parts.map((p) => p.day)
    const contiguous = days.every((v, i) => i === 0 || v === days[i - 1] + 1)
    return contiguous
      ? `${parts[0].month}월 ${days[0]}~${days[days.length - 1]}일`
      : `${parts[0].month}월 ${days.join(', ')}일`
  }
  return parts.map((p) => `${p.month}월 ${p.day}일`).join(', ')
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

/** year/month(1-indexed)/day → ISO(YYYY-MM-DD). 신규 신청 제출 시 day-of-month를 실제 날짜로 변환 */
export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function fmtDays(v: number): string {
  return `${v}일`
}

/** [21,22] → "2026년 7월 21~22일", [3,10] → "2026년 7월 3, 10일" */
export function rangeText(days: number[], year: number, month: number): string {
  const s = [...days].sort((a, b) => a - b)
  if (s.length === 0) return ''
  const prefix = `${year}년 ${month}월`
  if (s.length === 1) return `${prefix} ${s[0]}일`
  const contiguous = s.every((v, i) => i === 0 || v === s[i - 1] + 1)
  return contiguous ? `${prefix} ${s[0]}~${s[s.length - 1]}일` : `${prefix} ${s.join(', ')}일`
}

/** 신청 유형+수량 표기(예: "연차 2일") */
export function amountLabel(type: LeaveRequestType, dayCount: number): string {
  if (type === 'ANNUAL') return fmtDays(dayCount)
  if (type === 'SUBSTITUTE_HOLIDAY') return '1일'
  return fmtDays(0.5 * dayCount)
}

/** 유형+수량 표기. 대기중엔 "… 신청 (결재 대기중)" 접미 (US-02) */
export function typeLabel(req: LeaveRequest): string {
  const core = `${TYPE_LABELS[req.type].name} ${amountLabel(req.type, req.dates.length)}`
  return req.status === 'PENDING' ? `${core} 신청 (${STATUS_LABELS.PENDING})` : core
}
