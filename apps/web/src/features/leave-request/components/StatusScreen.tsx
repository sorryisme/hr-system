import type { LeaveRequestItem } from '../types'
import { RequestCard } from './RequestCard'

interface StatusScreenProps {
  requests: LeaveRequestItem[]
  month: number
  onBack: () => void
  onCancel: (id: string) => void
}

export function StatusScreen({ requests, month, onBack, onCancel }: StatusScreenProps) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={onBack}
          className="flex size-11 items-center justify-center rounded-2xl bg-muted text-xl font-bold text-foreground"
        >
          ←
        </button>
        <span className="text-xl font-bold">내 신청 현황</span>
      </div>

      <div className="mt-5 flex flex-col gap-3.5">
        {requests.map((r) => (
          <RequestCard key={r.id} request={r} month={month} onCancel={() => onCancel(r.id)} />
        ))}
      </div>
    </div>
  )
}
