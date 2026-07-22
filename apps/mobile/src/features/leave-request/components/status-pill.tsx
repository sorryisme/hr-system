import { cva } from 'class-variance-authority'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { STATUS_LABELS } from '../labels'
import type { LeaveRequestStatus } from '../types'

const statusPillVariants = cva('h-auto rounded-full border-transparent px-3.5 py-1.5 text-base font-bold', {
  variants: {
    status: {
      PENDING: 'bg-warning/15 text-warning',
      APPROVED: 'bg-approve/15 text-approve',
      REJECTED: 'bg-reject/15 text-reject',
    },
  },
})

export function StatusPill({ status }: { status: LeaveRequestStatus }) {
  return (
    <Badge variant="outline" className={cn(statusPillVariants({ status }))}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

export function PostApplyPill() {
  return (
    <Badge
      variant="outline"
      className="h-auto rounded-full border-transparent bg-warning/15 px-2.5 py-1 text-sm font-bold text-warning"
    >
      사후 신청
    </Badge>
  )
}

/** 1차 이상 승인된 건의 취소 요청이 관리자 승인을 기다리는 중임을 표시 */
export function CancellationPendingPill() {
  return (
    <Badge
      variant="outline"
      className="h-auto rounded-full border-transparent bg-brand/15 px-2.5 py-1 text-sm font-bold text-brand"
    >
      취소 승인 대기중
    </Badge>
  )
}
