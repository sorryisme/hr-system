import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hasPastSelected } from '../domain'
import type { LeaveRequest } from '../types'
import { CalendarGrid } from './calendar'

export function DateSelectScreen({
  year,
  month,
  todayOfMonth,
  daysInMonth,
  firstWeekday,
  selectedDays,
  requests,
  blockedMessage,
  rosterStatus,
  canGoPrevMonth,
  canGoNextMonth,
  onBack,
  onToggleDay,
  onBlockedDay,
  onPrevMonth,
  onNextMonth,
  onNext,
}: {
  year: number
  month: number
  todayOfMonth: number
  daysInMonth: number
  firstWeekday: number
  selectedDays: number[]
  requests: LeaveRequest[]
  blockedMessage: string | null
  /** 조회 중인 월의 근무표 상태. 'loading'/'unknown'(조회 실패)이면 아직 막지 않고 제출 시점 검증에 맡긴다 */
  rosterStatus: 'exists' | 'missing' | 'loading' | 'unknown'
  canGoPrevMonth: boolean
  canGoNextMonth: boolean
  onBack: () => void
  onToggleDay: (day: number) => void
  onBlockedDay: (message: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  onNext: () => void
}) {
  const count = selectedDays.length
  const rosterMissing = rosterStatus === 'missing'

  return (
    <div className="flex flex-1 flex-col gap-1 p-5">
      <div className="flex items-center gap-3.5">
        <Button
          variant="secondary"
          size="icon"
          onClick={onBack}
          className="size-12 rounded-2xl bg-muted"
        >
          <ArrowLeft className="size-6" />
        </Button>
        <span className="text-base font-bold text-muted-foreground">1 / 3 단계</span>
      </div>
      <h2 className="mt-3 text-2xl font-black leading-snug">쉬고 싶은 날을 골라 주세요</h2>
      <p className="mb-2 text-base text-muted-foreground">
        여러 날을 눌러도 돼요 · 지난 날은 7일 전까지 신청돼요
      </p>

      <CalendarGrid
        year={year}
        month={month}
        todayOfMonth={todayOfMonth}
        daysInMonth={daysInMonth}
        firstWeekday={firstWeekday}
        selectedDays={selectedDays}
        requests={requests}
        monthDisabled={rosterMissing}
        canGoPrevMonth={canGoPrevMonth}
        canGoNextMonth={canGoNextMonth}
        onToggleDay={onToggleDay}
        onBlockedDay={onBlockedDay}
        onPrevMonth={onPrevMonth}
        onNextMonth={onNextMonth}
      />

      {rosterMissing ? (
        <div className="mt-2.5 rounded-2xl bg-warning/10 px-4 py-3 text-center text-base font-bold text-warning">
          이 달 근무표가 아직 준비되지 않아 신청할 수 없어요. 담당자에게 문의해 주세요.
        </div>
      ) : blockedMessage ? (
        <div className="mt-2.5 rounded-2xl bg-reject/10 px-4 py-3 text-center text-base font-bold text-reject">
          {blockedMessage}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-2.5 pt-3">
        <p className="min-h-6 text-center text-lg font-bold text-approve">
          {count > 0
            ? `${count}일을 선택했어요${hasPastSelected(selectedDays, todayOfMonth) ? ' · 지난 날 포함(사후 신청)' : ''}`
            : ''}
        </p>
        <Button
          onClick={onNext}
          disabled={count === 0 || rosterMissing}
          className="h-auto w-full rounded-3xl bg-primary py-6 text-xl font-black text-primary-foreground shadow-lg hover:bg-primary/90"
        >
          다음
        </Button>
      </div>
    </div>
  )
}
