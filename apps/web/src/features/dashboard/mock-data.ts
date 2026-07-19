import type { StatusTone } from './status-badge'

export const STAFFING_ROWS: { role: string; tone: StatusTone; label: string }[] = [
  { role: '요양보호사', tone: 'success', label: '충족 18.4 / 17.6' },
  { role: '간호(조무)사', tone: 'error', label: '미달 3.1 / 3.6' },
  { role: '사회복지사', tone: 'success', label: '충족 2.0 / 2.0' },
]

export const SHIFT_COUNTS = {
  day: { actual: 9, standard: 8 },
  night: { actual: 1, standard: 2 },
}

export const PENDING_APPROVAL_COUNT = 3

export const BONUS_SCORE = {
  label: '인력배치추가 + 야간 + 간호사',
  value: 82,
  expected: 4.9,
  target: 6.0,
}

export const VIOLATIONS: { tone: StatusTone; label: string }[] = [
  { tone: 'error', label: '7/22 야간 인원 미달 (1/2)' },
  { tone: 'warning', label: '간호조무사 월 기준시간 미달 1명' },
]

export const LEAVE_EXPIRY_ROWS: {
  name: string
  remainingDays: number
  tone: StatusTone
  label: string
}[] = [
  { name: '박현우', remainingDays: 5, tone: 'warning', label: '60일 전 · 사용 필요' },
  { name: '정하늘', remainingDays: 2, tone: 'error', label: '30일 전 · 조치 필요' },
]

export const VIOLATION_ALERT = {
  title: '고시 기준 미달 경고',
  description:
    '이번 달 간호(조무)사 근무시간이 장기요양보험 고시 기준에 미달합니다. 근무표 편집기에서 확인하세요.',
}
