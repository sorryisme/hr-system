import { Link } from '@tanstack/react-router'
import { CalendarDays, Home } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: '홈', icon: Home },
  { to: '/leave', label: '휴가', icon: CalendarDays },
] as const

const linkClassName =
  'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2.5 text-muted-foreground transition-colors'
const activeLinkClassName = 'text-primary'

export function BottomNav() {
  return (
    <nav className="flex shrink-0 border-t border-border bg-background">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: true }}
          className={linkClassName}
          activeProps={{ className: cn(linkClassName, activeLinkClassName) }}
        >
          <Icon className="size-6" />
          <span className="text-sm font-bold">{label}</span>
        </Link>
      ))}
    </nav>
  )
}
