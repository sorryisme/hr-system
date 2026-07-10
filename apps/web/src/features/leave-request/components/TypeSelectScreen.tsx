import { cn } from '@/lib/utils'

import { TYPE_META } from '../constants'
import type { LeaveType } from '../types'
import { typeDisabledReason } from '../utils'

const TYPES: LeaveType[] = ['ANNUAL', 'HALF_AM', 'HALF_PM', 'SUBSTITUTE']

interface TypeSelectScreenProps {
  selectedDays: number[]
  balance: number
  subBalance: number
  onBack: () => void
  onPick: (type: LeaveType) => void
}

export function TypeSelectScreen({ selectedDays, balance, subBalance, onBack, onPick }: TypeSelectScreenProps) {
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
        <span className="text-base font-bold text-muted-foreground">2 / 3 단계</span>
      </div>

      <h2 className="mt-3.5 mb-4 text-2xl font-bold leading-snug">어떻게 쉬실 건가요?</h2>

      <div className="flex flex-col gap-3">
        {TYPES.map((type) => {
          const meta = TYPE_META[type]
          const reason = typeDisabledReason(type, selectedDays, balance, subBalance)
          return (
            <div key={type}>
              <button
                type="button"
                disabled={!!reason}
                onClick={() => onPick(type)}
                className={cn(
                  'flex w-full items-center gap-4 rounded-3xl border-2 border-border bg-card p-5 text-left transition-colors',
                  !reason && 'hover:border-success',
                  reason && 'cursor-not-allowed border-muted bg-muted/40',
                )}
              >
                <span
                  className={cn(
                    'flex size-14 shrink-0 items-center justify-center rounded-2xl bg-muted text-2xl',
                    reason && 'opacity-45',
                  )}
                >
                  {meta.icon}
                </span>
                <span>
                  <span className={cn('block text-lg font-bold', reason && 'text-muted-foreground')}>
                    {meta.title}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{meta.sub}</span>
                </span>
              </button>
              {reason && <div className="mt-1.5 px-2 text-sm font-bold text-destructive">{reason}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
