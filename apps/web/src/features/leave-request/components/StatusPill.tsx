import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

const pillVariants = cva('inline-flex items-center rounded-full px-3.5 py-1 text-sm font-bold', {
  variants: {
    variant: {
      pending: 'bg-warning/15 text-warning',
      approved: 'bg-success/15 text-success',
      rejected: 'bg-destructive/10 text-destructive',
      post: 'bg-warning/15 text-warning text-xs px-2.5 py-1',
    },
  },
})

interface StatusPillProps extends VariantProps<typeof pillVariants> {
  className?: string
  children: ReactNode
}

export function StatusPill({ variant, className, children }: StatusPillProps) {
  return <span className={cn(pillVariants({ variant }), className)}>{children}</span>
}
