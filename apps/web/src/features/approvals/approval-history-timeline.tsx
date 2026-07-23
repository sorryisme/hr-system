import type { RequestDetailDto } from '@/api/generated/model'
import { cn } from '@/lib/utils'
import { ACTION_LABELS, JOB_ROLE_LABELS, formatDateTime } from './labels'

const DOT_STYLES: Record<string, string> = {
  REJECT: 'bg-reject',
  CANCEL: 'bg-muted-foreground',
}

/** 제출→승인→반려/취소까지 전체 진행 이력을 시간순으로 보여준다(§3.4 histories, append-only) */
export function ApprovalHistoryTimeline({ detail }: { detail: RequestDetailDto }) {
  if (detail.histories.length === 0) return null

  return (
    <div>
      <div className="mb-2.5 text-sm font-bold">진행 이력</div>
      <ol className="flex flex-col">
        {detail.histories.map((h, i) => (
          <li key={h.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn('mt-1 size-2 shrink-0 rounded-full', DOT_STYLES[h.action] ?? 'bg-approve')} />
              {i < detail.histories.length - 1 && <div className="w-px flex-1 bg-border" />}
            </div>
            <div className={cn('flex-1 pb-3', i === detail.histories.length - 1 && 'pb-0')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {ACTION_LABELS[h.action]}
                  {h.stepNo !== null && ` · ${h.stepNo}차`}
                  {h.isDelegatedFinal && ' (전결)'}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(h.actedAt)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {h.actor.name} {JOB_ROLE_LABELS[h.actor.jobRole]}
              </div>
              {h.comment && (
                <div className="mt-1 text-sm leading-relaxed text-foreground/80">
                  {h.comment}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
