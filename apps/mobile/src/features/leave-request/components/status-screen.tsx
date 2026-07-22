import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LeaveRequest } from '../types'
import { RequestCard } from './request-card'

export function StatusScreen({
  requests,
  cancelingId,
  cancelMessage,
  onBack,
  onCancel,
}: {
  requests: LeaveRequest[]
  cancelingId: string | undefined
  cancelMessage: string | null
  onBack: () => void
  onCancel: (id: string) => void
}) {
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
        <span className="text-xl font-black">내 신청 현황</span>
      </div>
      {cancelMessage ? (
        <div className="mt-3 rounded-2xl bg-brand/10 px-4 py-3 text-center text-base font-bold text-brand">
          {cancelMessage}
        </div>
      ) : null}
      <div className="mt-5 flex flex-col gap-3.5">
        {requests.length === 0 ? (
          <p className="py-10 text-center text-base text-muted-foreground">
            신청 내역이 없어요
          </p>
        ) : (
          requests.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              onCancel={onCancel}
              isCanceling={cancelingId === req.id}
            />
          ))
        )}
      </div>
    </div>
  )
}
