import type { AttendanceShiftSummaryDto } from '@/api/generated/model'

const koreanTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

/** "2026-08-01T12:52:00.000Z" → "오후 9시 52분" */
export function formatKoreanTime(iso: string): string {
  const parts = koreanTimeFormatter.formatToParts(new Date(iso))
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? ''
  const hour = parts.find((p) => p.type === 'hour')?.value ?? ''
  const minute = parts.find((p) => p.type === 'minute')?.value ?? ''
  return `${period} ${hour}시 ${minute}분`
}

/** 홈 화면(B-2) "오늘은 야간 근무입니다 · 17:50~다음날 09:00" 문장 */
export function formatShiftSentence(shift: AttendanceShiftSummaryDto | null): string {
  if (!shift) return '오늘 배정된 근무가 없어요'
  if (!shift.startTime || !shift.endTime) return `오늘은 ${shift.label}입니다`
  const end = shift.crossesMidnight ? `다음날 ${shift.endTime}` : shift.endTime
  return `오늘은 ${shift.label}입니다 · ${shift.startTime}~${end}`
}
