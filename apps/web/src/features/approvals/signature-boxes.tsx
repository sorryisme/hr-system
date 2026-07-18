import { PenLine } from 'lucide-react'
import type { RequestDetailDto } from '@/api/generated/model'
import { cn } from '@/lib/utils'
import { JOB_ROLE_LABELS } from './labels'

/** 결재란·서명(D-12). 스토리지 미도입 — 스냅샷 경로가 있으면 서명 완료 표시로 대체 */
export function SignatureBoxes({ detail }: { detail: RequestDetailDto }) {
  return (
    <div>
      <div className="mb-2.5 text-sm font-bold">결재란 · 서명</div>
      <div className="flex gap-3">
        {detail.requestLines.map((line) => {
          const approveHistory = detail.histories.find(
            (h) => h.action === 'APPROVE' && h.stepNo === line.stepNo,
          )
          const rejectHistory = detail.histories.find(
            (h) => h.action === 'REJECT' && h.stepNo === line.stepNo,
          )
          return (
            <div key={line.stepNo} className="flex-1">
              <div
                className={cn(
                  'flex h-16 items-center justify-center rounded-lg border text-sm',
                  approveHistory?.signatureSnapshotPath
                    ? 'border-approve/40 bg-approve/5 text-approve'
                    : rejectHistory
                      ? 'border-reject/40 bg-reject/5 text-reject'
                      : 'border-dashed text-muted-foreground',
                )}
              >
                {approveHistory?.signatureSnapshotPath ? (
                  <span className="inline-flex items-center gap-1 font-bold">
                    <PenLine className="size-4" />
                    {approveHistory.actor.name}
                    {approveHistory.isDelegatedFinal && ' (전결)'}
                  </span>
                ) : rejectHistory ? (
                  <span className="font-bold">반려</span>
                ) : (
                  '미결재'
                )}
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {line.stepNo}차 · {line.approver.name} {JOB_ROLE_LABELS[line.approver.jobRole]}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
