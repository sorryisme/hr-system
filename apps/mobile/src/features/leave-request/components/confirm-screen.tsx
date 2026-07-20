import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { amountLabel, deductAmount, hasDeadlineWarning, hasPastSelected, rangeText } from '../domain'
import { TYPE_LABELS } from '../labels'
import type { LeaveRequestType } from '../types'

export function ConfirmScreen({
  type,
  selectedDays,
  month,
  todayOfMonth,
  balance,
  subBalance,
  onBack,
  onSubmit,
}: {
  type: LeaveRequestType
  selectedDays: number[]
  month: number
  todayOfMonth: number
  balance: number
  subBalance: number
  onBack: () => void
  onSubmit: (postApply: boolean) => void
}) {
  const isSub = type === 'SUBSTITUTE_HOLIDAY'
  const count = selectedDays.length
  const postApply = hasPastSelected(selectedDays, todayOfMonth)
  const deadlineWarning = hasDeadlineWarning(selectedDays, todayOfMonth, new Date().getHours())

  const before = isSub ? subBalance : balance
  const after = isSub ? subBalance - 1 : +(balance - deductAmount(type, count)).toFixed(1)

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
        <span className="text-base font-bold text-muted-foreground">3 / 3 단계</span>
      </div>
      <h2 className="mt-3 mb-4 text-2xl font-black leading-snug">이렇게 신청할까요?</h2>

      <Card className="rounded-3xl border-2 border-border px-6 py-5">
        <p className="text-base font-bold text-muted-foreground">신청 내용</p>
        <p className="mt-2 text-2xl font-black">{rangeText(selectedDays, month)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-2xl bg-approve/15 px-4 py-2 text-lg font-bold text-approve">
            {TYPE_LABELS[type].name} {amountLabel(type, count)}
          </span>
          {postApply ? (
            <span className="rounded-2xl bg-warning/15 px-4 py-2 text-lg font-bold text-warning">
              사후 신청
            </span>
          ) : null}
        </div>
        <Separator className="my-5" />
        <div className="flex items-center justify-between">
          <span className="text-lg text-secondary-foreground">{isSub ? '받은 휴일대체' : '남은 연차'}</span>
          <span className="text-xl font-black">
            {before}일 <span className="text-muted-foreground">→</span>{' '}
            <span className="text-approve">{after}일</span>
          </span>
        </div>
      </Card>

      {deadlineWarning ? (
        <div className="mt-3 rounded-2xl bg-warning/10 px-4.5 py-3.5 text-base leading-relaxed text-warning">
          ⏰ 쉬는 날이 코앞이에요. 원래는 전날 저녁 6시까지 신청하는 게 좋아요. 승인이 늦어질 수
          있어요.
        </div>
      ) : null}
      {postApply ? (
        <div className="mt-3 rounded-2xl bg-warning/10 px-4.5 py-3.5 text-base leading-relaxed text-warning">
          지나간 날짜예요. "사후 신청"으로 접수됩니다.
        </div>
      ) : null}
      <div className="mt-3 rounded-2xl bg-muted px-4.5 py-3.5 text-base leading-relaxed text-secondary-foreground">
        사유를 꼭 적지 않아도 됩니다. 필요하면 관리자가 여쭤봅니다.
      </div>

      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        <Button
          onClick={() => onSubmit(postApply)}
          className="h-auto w-full items-center justify-center gap-2 rounded-3xl bg-primary py-6 text-xl font-black text-primary-foreground shadow-lg hover:bg-primary/90"
        >
          신청하기
          <ArrowRight className="size-6" />
        </Button>
        <Button
          variant="outline"
          onClick={onBack}
          className="h-auto w-full rounded-3xl border-2 py-4.5 text-lg font-bold text-secondary-foreground"
        >
          다시 고치기
        </Button>
      </div>
    </div>
  )
}
