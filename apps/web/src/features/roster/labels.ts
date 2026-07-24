import type { RosterStatus } from '@/api/generated/model'

// 근무표 셀 표기·색 매핑. 표시 문자(cellLabel)는 백엔드가 이미 계산해 내려주므로
// 프론트는 shiftCode → 색 카테고리(index.css의 shift-* 토큰)만 정한다.

export type ShiftCategory =
  | 'day'
  | 'night'
  | 'off'
  | 'annual'
  | 'half'
  | 'subhol'
  | 'sick'
  | 'absent'

// shift_type.code → 색 카테고리. 근무조정(시간조정)은 원래 근무(D/N)에 override 시각이
// 붙는 형태라 별도 코드가 없다 → 기반 근무 색을 그대로 쓴다.
const CODE_CATEGORY: Record<string, ShiftCategory> = {
  D: 'day',
  N: 'night',
  NF: 'night',
  OFF: 'off',
  AL: 'annual',
  HAM: 'half',
  HPM: 'half',
  SUB: 'subhol',
  SICK: 'sick',
  ABS: 'absent',
}

export function shiftCategory(code: string): ShiftCategory {
  return CODE_CATEGORY[code] ?? 'off'
}

// 카테고리 → Tailwind 유틸(디자인 토큰만 사용, 임의 색상값 금지)
export const CATEGORY_CHIP_CLASS: Record<ShiftCategory, string> = {
  day: 'bg-shift-day-bg text-shift-day',
  night: 'bg-shift-night-bg text-shift-night',
  off: 'bg-shift-off-bg text-shift-off',
  annual: 'bg-shift-annual-bg text-shift-annual ring-1 ring-shift-annual/60',
  half: 'bg-shift-half-bg text-shift-half',
  subhol: 'bg-shift-subhol-bg text-shift-subhol',
  sick: 'bg-shift-sick-bg text-shift-sick',
  absent: 'bg-shift-absent-bg text-shift-absent',
}

// 범례/표기 안내에 쓰는 순서 있는 목록
export const LEGEND_ITEMS: { category: ShiftCategory; label: string; text: string }[] = [
  { category: 'day', label: '주', text: '주간' },
  { category: 'night', label: '야', text: '야간' },
  { category: 'off', label: '휴', text: '휴무' },
  { category: 'annual', label: '연', text: '연차' },
  { category: 'half', label: '오전', text: '오전반차' },
  { category: 'half', label: '오후', text: '오후반차' },
  { category: 'subhol', label: '유', text: '휴일대체' },
  { category: 'sick', label: '병', text: '병가' },
  { category: 'absent', label: '결', text: '결근' },
]

// 표기 안내 모달 표: 근무종류 / 내용 / 표기형식 (목업 "표기 안내 전체 확인")
export const CODE_GUIDE_ROWS: { kind: string; detail: string; format: string }[] = [
  { kind: '주간', detail: '주간근무 08:50~18:00, 8시간\n휴게시간 70분', format: '주' },
  {
    kind: '야간(주야비)',
    detail: '야간근무 17:50~익일 09:00, 9시간 40분\n휴게시간 주간 90분, 야간 240분',
    format: '야',
  },
  {
    kind: '야간(야간전담)',
    detail: '야간근무 18:00~익일 09:00, 8시간\n휴게시간 주간 180분, 야간 240분',
    format: '야',
  },
  { kind: '휴무', detail: '휴일', format: '휴' },
  { kind: '연차(월차)', detail: '유급휴일 8시간', format: '연' },
  { kind: '오전반차', detail: '유급휴일 4시간', format: '오전' },
  { kind: '오후반차', detail: '유급휴일 4시간', format: '오후' },
  { kind: '유급휴일대체', detail: '유급휴일대체', format: '유(이월인정시간,분)' },
  { kind: '근무조정', detail: '조기출근, 퇴근 등', format: '주or야(출근시간,퇴근시간)' },
  { kind: '병가', detail: '유급병가', format: '병' },
  { kind: '결근', detail: '결근', format: '결' },
]

export const ROSTER_STATUS_LABELS: Record<RosterStatus, string> = {
  DRAFT: '작성 중',
  COMPLETED: '작성 완료',
  CLOSING_APPROVAL: '마감 상신',
  CLOSED: '마감 완료',
}

// 유대 셀: carryableMinutes(150) → "유(2,30)"
export function subholLabel(carryableMinutes: number | null): string {
  if (carryableMinutes == null) return '유'
  const h = Math.floor(carryableMinutes / 60)
  const m = carryableMinutes % 60
  return `유(${h},${m})`
}

// 검증 위반(daily_staffing_rule 미달 등) 요약 문구
export function findingText(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return ''
  const date = typeof detail.date === 'string' ? detail.date : null
  const period = detail.period === 'NIGHT' ? '야간' : detail.period === 'DAY' ? '주간' : null
  const actual = typeof detail.actual === 'number' ? detail.actual : null
  const required = typeof detail.required === 'number' ? detail.required : null
  const parts: string[] = []
  if (date) parts.push(`${Number(date.split('-')[2])}일`)
  if (period) parts.push(period)
  if (actual !== null && required !== null) parts.push(`${actual}/${required}명`)
  return parts.join(' · ')
}
