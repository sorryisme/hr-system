import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { rangeText, typeLabel } from '../domain'
import type { LeaveRequest } from '../types'
import { PostApplyPill, StatusPill } from './status-pill'

export function RequestCard({
  request,
  month,
  onCancel,
}: {
  request: LeaveRequest
  month: number
  onCancel?: (id: string) => void
}) {
  return (
    <Card className="gap-2.5 rounded-3xl border-2 border-border px-5 py-4.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <StatusPill status={request.status} />
        <span className="text-base text-muted-foreground">{typeLabel(request)}</span>
        {request.postApply ? <PostApplyPill /> : null}
      </div>
      <div className="text-xl font-bold">{rangeText(request.days, month)}</div>
      {request.reason ? (
        <div className="rounded-2xl bg-reject/10 px-3.5 py-2.5 text-base leading-relaxed text-reject">
          사유: {request.reason}
        </div>
      ) : null}
      {onCancel && request.status === 'PENDING' ? (
        <Button
          variant="outline"
          onClick={() => onCancel(request.id)}
          className="mt-1 h-auto w-full rounded-2xl border-2 py-3.5 text-base font-bold text-secondary-foreground"
        >
          신청 취소
        </Button>
      ) : null}
    </Card>
  )
}
