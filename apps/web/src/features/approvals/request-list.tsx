import type { RequestListItemDto } from '@/api/generated/model'
import { cn } from '@/lib/utils'
import { TypeBadge } from './badges'
import {
  JOB_ROLE_LABELS,
  formatDateTime,
  formatTargetDates,
  stageSummary,
} from './labels'

const GRID = 'grid grid-cols-[1.1fr_1.3fr_1.4fr_1.6fr_1.2fr] items-center gap-2'

/** 결재함 좌측 목록(목업 1a). 행 클릭 → 우측 상세 패널 */
export function RequestList({
  items,
  selectedId,
  onSelect,
}: {
  items: RequestListItemDto[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (items.length === 0) {
    return (
      <div className="px-5 py-16 text-center text-[15px] text-muted-foreground">
        해당 상태의 신청 내역이 없습니다.
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className={cn(GRID, 'border-b bg-paper-strong px-5 py-3.5')}>
        {['신청자', '종류', '대상일', '사유', '신청일시'].map((h) => (
          <div key={h} className="text-[13px] font-bold text-muted-foreground">
            {h}
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              'block w-full border-b px-5 py-3.5 text-left transition-colors hover:bg-paper',
              selectedId === item.id && 'bg-paper',
            )}
          >
            <div className={GRID}>
              <div>
                <div className="text-[15px] font-bold">{item.requester.name}</div>
                <div className="text-[13px] text-muted-foreground">
                  {JOB_ROLE_LABELS[item.requester.jobRole]}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <TypeBadge type={item.type} />
                {item.isRetroactive && (
                  <span className="text-xs text-muted-foreground">사후 신청</span>
                )}
              </div>
              <div className="text-sm">
                {formatTargetDates(item.targetDates)}
                {item.type === 'SHIFT_CHANGE' && item.desiredShift && (
                  <div className="text-[13px] text-brand">→ {item.desiredShift.label} 희망</div>
                )}
              </div>
              <div className="truncate pr-3 text-sm text-foreground/80">
                {item.reason ?? '-'}
              </div>
              <div className="text-[13px] text-muted-foreground">
                {formatDateTime(item.createdAt)}
              </div>
            </div>
            <div className="mt-1.5 text-[13px] text-muted-foreground">
              결재단계: {stageSummary(item)}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
