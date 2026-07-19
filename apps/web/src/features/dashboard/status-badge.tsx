import type { ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const statusBadgeVariants = cva('border-transparent', {
  variants: {
    tone: {
      success: 'bg-approve/10 text-approve',
      warning: 'bg-warning/10 text-warning',
      error: 'bg-destructive/10 text-destructive',
    },
  },
})

export type StatusTone = 'success' | 'warning' | 'error'

export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusTone
  children: ReactNode
}) {
  return (
    <Badge variant="outline" className={cn(statusBadgeVariants({ tone }))}>
      {children}
    </Badge>
  )
}
