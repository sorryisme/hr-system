import { Button } from '@/components/ui/button'

import { TYPE_META } from '../constants'
import type { LeaveType } from '../types'
import { deductAmount, fmtDays, hasDeadlineWarning, hasPastSelected, rangeText } from '../utils'

interface ConfirmScreenProps {
  selectedDays: number[]
  selectedType: LeaveType
  month: number
  today: number
  hour: number
  balance: number
  subBalance: number
  onSubmit: () => void
  onEdit: () => void
}

export function ConfirmScreen({
  selectedDays,
  selectedType,
  month,
  today,
  hour,
  balance,
  subBalance,
  onSubmit,
  onEdit,
}: ConfirmScreenProps) {
  const n = selectedDays.length
  const isSub = selectedType === 'SUBSTITUTE'
  const meta = TYPE_META[selectedType]
  const amt = selectedType === 'ANNUAL' ? `${n}일` : isSub ? '1일' : `${0.5 * n}일`

  const isPastApply = hasPastSelected(selectedDays, today)
  const isDeadlineWarning = hasDeadlineWarning(selectedDays, today, hour)

  const before = isSub ? subBalance : balance
  const after = isSub ? subBalance - 1 : +(balance - deductAmount(selectedType, n)).toFixed(1)

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={onEdit}
          className="flex size-11 items-center justify-center rounded-2xl bg-muted text-xl font-bold text-foreground"
        >
          ←
        </button>
        <span className="text-base font-bold text-muted-foreground">3 / 3 단계</span>
      </div>

      <h2 className="mt-3.5 mb-4 text-2xl font-bold leading-snug">이렇게 신청할까요?</h2>

      <div className="rounded-3xl border border-border bg-card p-6">
        <div className="text-sm font-bold text-muted-foreground">신청 내용</div>
        <div className="mt-2 text-xl font-bold">{rangeText(selectedDays, month)}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-2xl bg-success/10 px-4 py-2 text-base font-bold text-success">
            {meta.name} {amt}
          </span>
          {isPastApply && (
            <span className="rounded-2xl bg-warning/10 px-4 py-2 text-base font-bold text-warning">사후 신청</span>
          )}
        </div>
        <hr className="my-5 border-border" />
        <div className="flex items-center justify-between">
          <span className="text-base text-foreground">{isSub ? '받은 휴일대체' : '남은 연차'}</span>
          <span className="text-lg font-bold">
            {fmtDays(before)} <span className="text-muted-foreground">→</span>{' '}
            <span className="text-success">{fmtDays(after)}</span>
          </span>
        </div>
      </div>

      {isDeadlineWarning && (
        <div className="mt-3 rounded-2xl bg-warning/10 px-4 py-3.5 text-sm leading-relaxed text-warning">
          ⏰ 쉬는 날이 코앞이에요. 원래는 전날 저녁 6시까지 신청하는 게 좋아요. 승인이 늦어질 수 있어요.
        </div>
      )}
      {isPastApply && (
        <div className="mt-3 rounded-2xl bg-warning/10 px-4 py-3.5 text-sm leading-relaxed text-warning">
          지나간 날짜예요. "사후 신청"으로 접수됩니다.
        </div>
      )}
      <div className="mt-3 rounded-2xl bg-warning/5 px-4 py-3.5 text-sm leading-relaxed text-warning">
        사유를 꼭 적지 않아도 됩니다. 필요하면 관리자가 여쭤봅니다.
      </div>

      <div className="mt-auto flex flex-col gap-2.5 pt-3.5">
        <Button
          onClick={onSubmit}
          className="h-auto w-full rounded-3xl bg-success py-5 text-lg font-bold text-success-foreground hover:bg-success/90"
        >
          신청하기
        </Button>
        <Button variant="outline" onClick={onEdit} className="h-auto w-full rounded-3xl py-4 text-base">
          다시 고치기
        </Button>
      </div>
    </div>
  )
}
