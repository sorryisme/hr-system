import { LogIn, LogOut } from 'lucide-react'
import type { AttendanceTodayResponseDto } from '@/api/generated/model'
import { Button } from '@/components/ui/button'
import { getSessionUser } from '@/features/auth/session'
import { cn } from '@/lib/utils'
import { formatShiftSentence } from '../domain'

export function AttendanceButtonScreen({
  today,
  isClockedIn,
  isTagging,
  onTag,
}: {
  today: AttendanceTodayResponseDto | undefined
  isClockedIn: boolean
  isTagging: boolean
  onTag: () => void
}) {
  const employeeName = getSessionUser()?.name ?? ''
  const Icon = isClockedIn ? LogOut : LogIn

  return (
    <div className="flex flex-1 flex-col gap-6 p-5">
      <div>
        <p className="text-lg text-muted-foreground">안녕하세요,</p>
        <p className="text-3xl font-black">{employeeName}</p>
      </div>

      <Button
        onClick={onTag}
        disabled={isTagging}
        className={cn(
          'h-auto flex-1 flex-col gap-4 rounded-3xl bg-primary text-primary-foreground shadow-lg hover:bg-primary/90',
        )}
      >
        <Icon className="size-12" />
        <span className="text-4xl font-black">
          {isTagging ? '처리 중이에요…' : isClockedIn ? '퇴근하기' : '출근하기'}
        </span>
      </Button>

      <p className="text-center text-lg font-medium text-muted-foreground">
        {formatShiftSentence(today?.shift ?? null)}
      </p>
    </div>
  )
}
