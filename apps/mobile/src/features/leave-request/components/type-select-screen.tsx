import { ArrowLeft, Gift, Sun, Sunrise, Sunset } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { typeDisabledReason } from '../domain'
import { TYPE_LABELS } from '../labels'
import type { LeaveRequestType } from '../types'

const TYPE_ORDER: LeaveRequestType[] = ['ANNUAL', 'HALF_AM', 'HALF_PM', 'SUBSTITUTE_HOLIDAY']

const TYPE_ICON: Record<LeaveRequestType, { icon: typeof Sun; className: string }> = {
  ANNUAL: { icon: Sun, className: 'bg-approve/15 text-approve' },
  HALF_AM: { icon: Sunrise, className: 'bg-warning/15 text-warning' },
  HALF_PM: { icon: Sunset, className: 'bg-brand/15 text-brand' },
  SUBSTITUTE_HOLIDAY: { icon: Gift, className: 'bg-reject/15 text-reject' },
}

export function TypeSelectScreen({
  selectedDayCount,
  balance,
  subBalance,
  onBack,
  onPick,
}: {
  selectedDayCount: number
  balance: number
  subBalance: number
  onBack: () => void
  onPick: (type: LeaveRequestType) => void
}) {
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
        <span className="text-base font-bold text-muted-foreground">2 / 3 단계</span>
      </div>
      <h2 className="mt-3 mb-4 text-2xl font-black leading-snug">어떻게 쉬실 건가요?</h2>

      <div className="flex flex-col gap-3">
        {TYPE_ORDER.map((type) => {
          const meta = TYPE_LABELS[type]
          const { icon: Icon, className } = TYPE_ICON[type]
          const reason = typeDisabledReason(type, selectedDayCount, balance, subBalance)

          return (
            <div key={type}>
              <button
                type="button"
                disabled={!!reason}
                onClick={() => onPick(type)}
                className={cn(
                  'flex w-full items-center gap-4 rounded-3xl border-2 border-border bg-card px-5 py-5 text-left transition-colors',
                  !reason && 'hover:border-primary hover:bg-primary/5',
                  reason && 'cursor-not-allowed border-muted bg-muted/40',
                )}
              >
                <span
                  className={cn(
                    'flex size-14 flex-none items-center justify-center rounded-2xl',
                    reason ? 'opacity-45' : className,
                  )}
                >
                  <Icon className="size-7" />
                </span>
                <span>
                  <span className={cn('block text-xl font-black', reason && 'text-muted-foreground')}>
                    {meta.title}
                  </span>
                  <span className="mt-0.5 block text-base text-muted-foreground">{meta.sub}</span>
                </span>
              </button>
              {reason ? (
                <p className="px-2 pt-1.5 text-sm font-bold text-reject">{reason}</p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
