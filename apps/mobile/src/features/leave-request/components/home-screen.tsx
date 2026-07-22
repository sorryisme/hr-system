import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LeaveRequest } from '../types'
import { RequestCard } from './request-card'

export function HomeScreen({
  employeeName,
  balance,
  subBalance,
  recentRequests,
  onStartApply,
  onGoStatus,
}: {
  employeeName: string
  balance: number
  subBalance: number
  recentRequests: LeaveRequest[]
  onStartApply: () => void
  onGoStatus: () => void
}) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-5">
      <div>
        <p className="text-lg text-muted-foreground">안녕하세요,</p>
        <p className="text-3xl font-black">{employeeName}</p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 rounded-3xl bg-approve/10 px-5 py-4.5">
          <p className="text-base font-medium text-approve/80">남은 연차</p>
          <p className="mt-1 text-3xl font-black text-approve">{balance}일</p>
        </div>
        <div className="flex-1 rounded-3xl bg-warning/10 px-5 py-4.5">
          <p className="text-base font-medium text-warning/80">받은 휴일대체</p>
          <p className="mt-1 text-3xl font-black text-warning">{subBalance}일</p>
        </div>
      </div>

      <Button
        onClick={onStartApply}
        className="h-auto w-full justify-between rounded-3xl bg-primary px-6 py-7 text-left shadow-lg hover:bg-primary/90"
      >
        <span>
          <span className="block text-2xl font-black text-primary-foreground">휴가 신청하기</span>
          <span className="mt-1 block text-base font-medium text-primary-foreground/85">
            3번만 누르면 끝나요
          </span>
        </span>
        <ArrowRight className="size-8 text-primary-foreground" />
      </Button>

      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <span className="text-lg font-black">내 신청 현황</span>
          <Button
            variant="link"
            onClick={onGoStatus}
            className="h-auto p-0 text-base font-bold text-primary"
          >
            전체 보기 →
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {recentRequests.map((req) => (
            <RequestCard key={req.id} request={req} />
          ))}
        </div>
      </div>
    </div>
  )
}
