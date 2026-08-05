import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { blockedDaySet, toIsoDate } from '../domain'
import { STATUS_LABELS, TYPE_LABELS } from '../labels'
import type { LeaveRequest } from '../types'

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function blockedLabel(day: number, requests: LeaveRequest[], year: number, month: number): string {
  const iso = toIsoDate(year, month, day)
  const req = requests.find(
    (r) => (r.status === 'PENDING' || r.status === 'APPROVED') && r.dates.includes(iso),
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
  monthDisabled,
  canGoPrevMonth,
  canGoNextMonth,
  onToggleDay,
  onBlockedDay,
  onPrevMonth,
  onNextMonth,
}: {
  year: number
  month: number
  todayOfMonth: number
  daysInMonth: number
  firstWeekday: number
  selectedDays: number[]
  requests: LeaveRequest[]
  /** 해당 월 근무표가 아직 없어 날짜 선택 자체를 막아야 하면 true */
  monthDisabled: boolean
  canGoPrevMonth: boolean
  canGoNextMonth: boolean
  onToggleDay: (day: number) => void
  onBlockedDay: (message: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
}) {
  const blocked = blockedDaySet(requests, year, month)

  return (
    <div className="rounded-3xl border-2 border-border bg-card p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <Button
          variant="secondary"
          size="icon"
          disabled={!canGoPrevMonth}
          onClick={onPrevMonth}
          className="size-10 rounded-xl bg-muted"
          aria-label="이전 달"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-lg font-bold">
          {year}년 {month}월
        </span>
        <Button
          variant="secondary"
          size="icon"
          disabled={!canGoNextMonth}
          onClick={onNextMonth}
          className="size-10 rounded-xl bg-muted"
          aria-label="다음 달"
        >
          <ChevronRight className="size-5" />
        </Button>
      </div>
      <div className="grid grid-cols-7 text-center text-sm font-bold text-muted-foreground">
        {DOW_LABELS.map((label, i) => (
          <span key={label} className={cn(i === 0 && 'text-reject', i === 6 && 'text-brand')}>
            {label}
          </span>
        ))}
      </div>
      <div className={cn('mt-1 grid grid-cols-7 gap-1', monthDisabled && 'opacity-40')}>
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
              disabled={monthDisabled}
              onClick={() =>
                isBlocked ? onBlockedDay(blockedLabel(day, requests, year, month)) : onToggleDay(day)
              }
              className={cn(
                'flex h-13.5 items-center justify-center rounded-2xl text-xl font-bold transition-colors disabled:pointer-events-none',
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
