import { Button } from '@/components/ui/button'

import { fmtDays } from '../utils'
import type { LeaveRequestItem } from '../types'
import { RequestCard } from './RequestCard'

interface HomeScreenProps {
  userName: string
  balance: number
  subBalance: number
  requests: LeaveRequestItem[]
  month: number
  onStartApply: () => void
  onGoStatus: () => void
}

export function HomeScreen({
  userName,
  balance,
  subBalance,
  requests,
  month,
  onStartApply,
  onGoStatus,
}: HomeScreenProps) {
  return (
    <div className="flex flex-1 flex-col">
      <div>
        <div className="text-lg text-muted-foreground">안녕하세요,</div>
        <div className="mt-0.5 text-2xl font-bold">{userName}</div>
      </div>

      <div className="mt-5 flex gap-3">
        <div className="flex-1 rounded-3xl bg-success/10 px-5 py-4">
          <div className="text-sm text-success">남은 연차</div>
          <div className="mt-1 text-3xl font-bold text-success">{fmtDays(balance)}</div>
        </div>
        <div className="flex-1 rounded-3xl bg-warning/10 px-5 py-4">
          <div className="text-sm text-warning">받은 휴일대체</div>
          <div className="mt-1 text-3xl font-bold text-warning">{fmtDays(subBalance)}</div>
        </div>
      </div>

      <Button
        onClick={onStartApply}
        className="mt-5 h-auto w-full justify-between rounded-3xl bg-success px-6 py-6 text-left text-success-foreground hover:bg-success/90"
      >
        <span>
          <span className="block text-2xl font-bold">휴가 신청하기</span>
          <span className="mt-1 block text-sm opacity-85">3번만 누르면 끝나요</span>
        </span>
        <span className="text-3xl font-bold">→</span>
      </Button>

      <div className="mt-6 flex items-center justify-between">
        <span className="text-lg font-bold">내 신청 현황</span>
        <Button variant="link" className="h-auto p-0 text-success" onClick={onGoStatus}>
          전체 보기 →
        </Button>
      </div>

      <div className="mt-3.5 flex flex-col gap-3">
        {requests.slice(0, 2).map((r) => (
          <RequestCard key={r.id} request={r} month={month} />
        ))}
      </div>
    </div>
  )
}
