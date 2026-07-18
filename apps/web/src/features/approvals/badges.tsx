import { cva } from 'class-variance-authority'
import type {
  ApprovalRequestStatus,
  ApprovalRequestType,
} from '@/api/generated/model'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { STATUS_LABELS, TYPE_LABELS } from './labels'

const typeBadgeVariants = cva('border-transparent', {
  variants: {
    type: {
      ANNUAL: 'bg-approve/10 text-approve',
      HALF_AM: 'bg-approve/10 text-approve',
      HALF_PM: 'bg-approve/10 text-approve',
      SUBSTITUTE_HOLIDAY: 'bg-approve/15 text-approve',
      SHIFT_CHANGE: 'bg-brand/10 text-brand',
      CANCEL: 'bg-muted text-muted-foreground',
    },
  },
})

export function TypeBadge({ type }: { type: ApprovalRequestType }) {
  return (
    <Badge variant="outline" className={cn(typeBadgeVariants({ type }))}>
      {TYPE_LABELS[type]}
    </Badge>
  )
}

const statusBadgeVariants = cva('border-transparent', {
  variants: {
    status: {
      PENDING: 'bg-paper-strong text-foreground',
      INTERIM_APPROVED: 'bg-brand/10 text-brand',
      APPROVED: 'bg-approve/10 text-approve',
      REJECTED: 'bg-reject/10 text-reject',
      CANCELED: 'bg-muted text-muted-foreground',
      CANCELED_AFTER_APPROVAL: 'bg-muted text-muted-foreground',
    },
  },
})

export function StatusBadge({
  status,
  isFinalByDelegation = false,
}: {
  status: ApprovalRequestStatus
  isFinalByDelegation?: boolean
}) {
  return (
    <Badge variant="outline" className={cn(statusBadgeVariants({ status }))}>
      {STATUS_LABELS[status]}
      {status === 'APPROVED' && isFinalByDelegation ? ' (전결)' : ''}
    </Badge>
  )
}
