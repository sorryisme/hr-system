import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { TYPE_META, STATUS_TEXT } from '../constants'
import type { LeaveRequestItem } from '../types'
import { blockedDaySet, hasPastSelected } from '../utils'

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토']

interface DateSelectScreenProps {
  year: number
  month: number
  today: number
  selectedDays: number[]
  requests: LeaveRequestItem[]
  onToggleDay: (day: number) => void
  onBack: () => void
  onNext: () => void
}

export function DateSelectScreen({
  year,
  month,
  today,
  selectedDays,
  requests,
  onToggleDay,
  onBack,
  onNext,
}: DateSelectScreenProps) {
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null)
  const blocked = blockedDaySet(requests)
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function handleDayClick(day: number) {
    if (blocked.has(day)) {
      const req = requests.find(
        (r) => (r.status === 'PENDING' || r.status === 'APPROVED') && r.days.includes(day),
      )
      const what = req ? `${TYPE_META[req.type].name} · ${STATUS_TEXT[req.status]}` : '기존 신청'
      setBlockedMsg(`${month + 1}월 ${day}일은 이미 신청한 날이에요 (${what})`)
      return
    }
    setBlockedMsg(null)
    onToggleDay(day)
  }

  const cells: Array<{ day: number | null }> = []
  for (let i = 0; i < firstDow; i++) cells.push({ day: null })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d })

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={onBack}
          className="flex size-11 items-center justify-center rounded-2xl bg-muted text-xl font-bold text-foreground"
        >
          ←
        </button>
        <span className="text-base font-bold text-muted-foreground">1 / 3 단계</span>
      </div>

      <h2 className="mt-3.5 text-2xl font-bold leading-snug">쉬고 싶은 날을 골라 주세요</h2>
      <p className="mt-1 mb-2.5 text-base text-muted-foreground">
        여러 날을 눌러도 돼요 · 지난 날은 7일 전까지 신청돼요
      </p>

      <div className="rounded-3xl border border-border bg-card p-3.5">
        <div className="mb-2.5 text-center text-base font-bold">
          {year}년 {month + 1}월
        </div>
        <div className="grid grid-cols-7">
          {DOW_LABELS.map((label, i) => (
            <span
              key={label}
              className={cn('text-center text-sm font-bold text-muted-foreground', i === 0 && 'text-destructive')}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            if (cell.day === null) return <span key={`empty-${i}`} />
            const d = cell.day
            const dow = (firstDow + d - 1) % 7
            const isTooOld = d < today - 7
            const isBlocked = blocked.has(d)
            const isSelected = selectedDays.includes(d)
            const isPast = d < today

            return (
              <button
                key={d}
                type="button"
                disabled={isTooOld}
                onClick={() => handleDayClick(d)}
                className={cn(
                  'flex h-[54px] items-center justify-center rounded-2xl text-lg font-bold transition-colors',
                  dow === 0 && 'text-destructive',
                  isTooOld && 'cursor-default text-muted-foreground/50',
                  isBlocked && 'bg-muted text-muted-foreground line-through',
                  !isTooOld && !isBlocked && isSelected && 'bg-success text-success-foreground',
                  !isTooOld && !isBlocked && !isSelected && isPast && 'bg-warning/10 text-warning',
                )}
              >
                {d}
              </button>
            )
          })}
        </div>
      </div>

      {blockedMsg && (
        <div className="mt-2.5 rounded-2xl bg-destructive/10 px-4 py-3 text-center text-base font-bold text-destructive">
          {blockedMsg}
        </div>
      )}

      <div className="mt-auto pt-3">
        <div className="mb-2.5 min-h-[26px] text-center text-base font-bold text-success">
          {selectedDays.length > 0 &&
            `${selectedDays.length}일을 선택했어요${
              hasPastSelected(selectedDays, today) ? ' · 지난 날 포함(사후 신청)' : ''
            }`}
        </div>
        <Button
          disabled={selectedDays.length === 0}
          onClick={onNext}
          className="h-auto w-full rounded-3xl bg-success py-5 text-lg font-bold text-success-foreground hover:bg-success/90 disabled:bg-muted disabled:text-muted-foreground"
        >
          다음
        </Button>
      </div>
    </div>
  )
}
