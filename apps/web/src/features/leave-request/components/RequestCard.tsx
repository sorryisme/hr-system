import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { STATUS_TEXT } from '../constants'
import type { LeaveRequestItem } from '../types'
import { rangeText, typeLabel } from '../utils'
import { StatusPill } from './StatusPill'

const PILL_VARIANT = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const

interface RequestCardProps {
  request: LeaveRequestItem
  month: number
  onCancel?: () => void
}

export function RequestCard({ request, month, onCancel }: RequestCardProps) {
  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <StatusPill variant={PILL_VARIANT[request.status]}>{STATUS_TEXT[request.status]}</StatusPill>
        <span className="text-base text-muted-foreground">{typeLabel(request)}</span>
        {request.postApply && <StatusPill variant="post">사후 신청</StatusPill>}
      </div>
      <div className="mt-2 text-xl font-bold">{rangeText(request.days, month)}</div>
      {request.reason && (
        <div className={cn('mt-2.5 rounded-2xl bg-destructive/10 px-3.5 py-2.5 text-sm leading-relaxed text-destructive')}>
          사유: {request.reason}
        </div>
      )}
      {onCancel && request.status === 'PENDING' && (
        <Button variant="outline" className="mt-3.5 h-11 w-full rounded-2xl text-base" onClick={onCancel}>
          신청 취소
        </Button>
      )}
    </div>
  )
}
