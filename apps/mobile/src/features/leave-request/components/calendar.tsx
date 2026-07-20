import { cn } from '@/lib/utils'
import { blockedDaySet } from '../domain'
import { STATUS_LABELS, TYPE_LABELS } from '../labels'
import type { LeaveRequest } from '../types'

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function blockedLabel(day: number, requests: LeaveRequest[], month: number): string {
  const req = requests.find(
    (r) => (r.status === 'PENDING' || r.status === 'APPROVED') && r.days.includes(day),
  )
  const what = req ? `${TYPE_LABELS[req.type].name} · ${STATUS_LABELS[req.status]}` : '기존 신청'
  return `${month}월 ${day}일은 이미 신청한 날이에요 (${what})`
}

export function CalendarGrid({
  year,
  month, // 1-indexed (표시용)
  todayOfMonth,
  daysInMonth,
  firstWeekday, // 0(일)~6(토)
  selectedDays,
  requests,
  onToggleDay,
  onBlockedDay,
}: {
  year: number
  month: number
  todayOfMonth: number
  daysInMonth: number
  firstWeekday: number
  selectedDays: number[]
  requests: LeaveRequest[]
  onToggleDay: (day: number) => void
  onBlockedDay: (message: string) => void
}) {
  const blocked = blockedDaySet(requests)

  return (
    <div className="rounded-3xl border-2 border-border bg-card p-4">
      <div className="mb-2.5 text-center text-lg font-bold">
        {year}년 {month}월
      </div>
      <div className="grid grid-cols-7 text-center text-sm font-bold text-muted-foreground">
        {DOW_LABELS.map((label, i) => (
          <span key={label} className={cn(i === 0 && 'text-reject', i === 6 && 'text-brand')}>
            {label}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: firstWeekday }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1
          const dow = (firstWeekday + i) % 7
          const isTooOld = day < todayOfMonth - 7
          const isBlocked = blocked.has(day)
          const isSelected = selectedDays.includes(day)
          const isPast = day < todayOfMonth

          if (isTooOld) {
            return (
              <span
                key={day}
                className="flex h-13.5 items-center justify-center rounded-2xl text-xl font-bold text-border"
              >
                {day}
              </span>
            )
          }

          return (
            <button
              key={day}
              type="button"
              onClick={() =>
                isBlocked ? onBlockedDay(blockedLabel(day, requests, month)) : onToggleDay(day)
              }
              className={cn(
                'flex h-13.5 items-center justify-center rounded-2xl text-xl font-bold transition-colors',
                dow === 0 && 'text-reject',
                dow === 6 && 'text-brand',
                isBlocked && 'bg-muted text-muted-foreground line-through',
                !isBlocked && isSelected && 'bg-primary text-primary-foreground shadow-lg',
                !isBlocked && !isSelected && isPast && 'bg-warning/10 text-warning',
              )}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}
