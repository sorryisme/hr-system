import type { RequestDetailDto, RequestLineDto } from '@/api/generated/model'
import { cn } from '@/lib/utils'
import { JOB_ROLE_LABELS } from './labels'

/** 결재자 후보가 여럿이면(취소 요청 — 누구든 결재 가능) 역할을 '/'로 이어붙인다 */
function approversLabel(line: RequestLineDto): string {
  const roles = [...new Set(line.approvers.map((a) => JOB_ROLE_LABELS[a.jobRole]))]
  return roles.join('/')
}

type StepState = 'done' | 'current' | 'upcoming' | 'rejected' | 'skipped'

function stepState(detail: RequestDetailDto, stepNo: number): StepState {
  if (stepNo <= detail.currentStep) return 'done'
  if (detail.status === 'REJECTED') {
    return stepNo === detail.currentStep + 1 ? 'rejected' : 'upcoming'
  }
  if (detail.status === 'APPROVED') {
    // 전결 확정 시 남은 단계는 생략(D-13)
    return detail.isFinalByDelegation ? 'skipped' : 'done'
  }
  return stepNo === detail.currentStep + 1 ? 'current' : 'upcoming'
}

const DOT_STYLES: Record<StepState, string> = {
  done: 'bg-approve border-approve',
  current: 'bg-background border-brand border-2',
  upcoming: 'bg-background border-border border-2',
  rejected: 'bg-reject border-reject',
  skipped: 'bg-paper-strong border-border border-2',
}

const STATE_LABELS: Record<StepState, string> = {
  done: '승인 완료',
  current: '결재 대기',
  upcoming: '예정',
  rejected: '반려',
  skipped: '전결 생략',
}

/** 결재 단계 표시(dot + connector). 단계 수 1~3 가변(§3.1) */
export function ApprovalStepper({ detail }: { detail: RequestDetailDto }) {
  return (
    <div>
      <div className="mb-2.5 text-sm font-bold">결재 단계</div>
      <div className="flex items-start">
        {detail.requestLines.map((line, i) => {
          const state = stepState(detail, line.stepNo)
          return (
            <div
              key={line.stepNo}
              className="relative flex flex-1 flex-col items-center gap-1.5 px-1"
            >
              {/* 연결선: 이전 단계 dot 중심 ↔ 현재 dot 중심 (칼럼 폭 균등 전제) */}
              {i > 0 && (
                <div className="absolute right-1/2 top-0 flex h-4 w-full items-center">
                  <div
                    className={cn(
                      'h-0.5 w-full',
                      line.stepNo <= detail.currentStep ? 'bg-approve' : 'bg-border',
                    )}
                  />
                </div>
              )}
              <div className={cn('relative size-4 rounded-full border', DOT_STYLES[state])} />
              <div className="text-center text-xs font-bold leading-tight">
                {line.stepNo}차
                <br />
                {approversLabel(line)}
              </div>
              <div
                className={cn(
                  'text-xs',
                  state === 'done' && 'text-approve',
                  state === 'rejected' && 'text-reject',
                  state === 'current' && 'font-bold text-brand',
                  (state === 'upcoming' || state === 'skipped') && 'text-muted-foreground',
                )}
              >
                {STATE_LABELS[state]}
                {line.stepNo === 2 && line.delegationEnabled && state !== 'skipped' && (
                  <span className="ml-1 text-brand">(전결)</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
