import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  getGetRosterQueryKey,
  getListRequestsQueryKey,
  useApproveRequest,
  useListRequests,
  useRejectRequest,
} from '@/api/generated/endpoints'
import { InboxStatusFilter, type RequestListItemDto } from '@/api/generated/model'
import { ApiError } from '@/api/mutator'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getSessionUser } from '@/features/auth/session'
import {
  formatTargetDates,
  JOB_ROLE_LABELS,
  TYPE_LABELS,
} from '@/features/approvals/labels'
import { cn } from '@/lib/utils'

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return '요청 처리에 실패했습니다.'
}

interface Props {
  yearMonth: string
  selectedId: string | null
  onSelect: (request: RequestListItemDto | null) => void
}

// 결재 승인 → 근무표 반영은 결재 응답과 비동기다(fire-and-forget 도메인 이벤트, domain-event-bus).
// 응답 직후 재조회가 반영 쓰기를 앞지를 수 있어, 한 번 더 지연 재조회해 확정 반영을 확실히 픽업한다.
// (권위 있는 정합성은 백엔드 아웃박스/reconcile 후속 과제 — 근무표 상태머신 로그 #3)
const REFLECTION_SETTLE_MS = 600

/**
 * 근무표 우측 패널의 "결재함" 탭 콘텐츠(aside 셸은 RosterSidePanel이 소유). 대기 신청을
 * 승인하면 결재 이벤트(request.approved)로 근무표 셀이 갱신되므로, 처리 후 목록·근무표
 * 쿼리를 함께 무효화한다.
 * 현재 보고 있는 달(yearMonth)의 대상일을 가진 결재만 노출한다 — 타 월 결재를
 * "위 근무표에 반영"한다고 오인시키지 않기 위함.
 * 결재선 단계별 권한 검증은 서버가 수행하며 상세 화면은 /approvals 에 있다.
 */
export function RosterApprovalSidebar({ yearMonth, selectedId, onSelect }: Props) {
  const queryClient = useQueryClient()
  const listQuery = useListRequests({ status: InboxStatusFilter.PENDING })
  const monthPrefix = `${yearMonth}-`
  const items = (listQuery.data?.data.items ?? []).filter((r) =>
    r.targetDates.some((d) => d.startsWith(monthPrefix)),
  )
  const pendingCount = items.length

  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectText, setRejectText] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListRequestsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetRosterQueryKey() }),
    ])
    // 비동기 반영이 뒤늦게 끝나는 경우까지 확실히 갱신(위 상수 주석 참고)
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: getGetRosterQueryKey() })
    }, REFLECTION_SETTLE_MS)
  }

  const mutationOptions = {
    onSuccess: async () => {
      setActionError(null)
      setRejectingId(null)
      setRejectText('')
      onSelect(null)
      await invalidate()
    },
    onError: async (e: unknown) => {
      setActionError(errorMessage(e))
      await invalidate()
    },
  }
  const approveMut = useApproveRequest({ mutation: mutationOptions })
  const rejectMut = useRejectRequest({ mutation: mutationOptions })
  const busy = approveMut.isPending || rejectMut.isPending

  const user = getSessionUser()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-5 pt-5">
        <div className="flex items-baseline gap-2">
          <h2 className="font-heading text-lg font-bold">결재함</h2>
          <span className="text-sm font-semibold text-warning">{pendingCount}</span>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          이 달 대상 대기 결재입니다. 승인하면 위 근무표에 반영되고, 카드를 누르면 대상 셀이 강조됩니다.
        </p>
        {actionError && (
          <div className="mt-3 rounded-lg border border-reject/30 bg-reject/5 px-3 py-2 text-[13px] text-reject">
            {actionError}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {listQuery.isPending ? (
          <div className="py-12 text-center text-sm text-muted-foreground">불러오는 중…</div>
        ) : listQuery.isError ? (
          <div className="py-12 text-center text-sm text-reject">
            결재 목록을 불러오지 못했습니다.
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-[15px] font-medium text-muted-foreground">
            이 달 대상 대기 결재가 없습니다 👏
          </div>
        ) : (
          items.map((r) => {
            const selected = r.id === selectedId
            const isSelf = !!user && user.id === r.requester.id
            const isRejecting = rejectingId === r.id
            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(selected ? null : r)}
                onKeyDown={(e) => {
                  // 반려 Textarea·버튼에서 올라온 Space/Enter가 카드 선택을 토글하지 않도록,
                  // 카드 자체에 포커스가 있을 때만 처리한다
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(selected ? null : r)
                  }
                }}
                className={cn(
                  'cursor-pointer rounded-2xl border bg-card p-4 transition-colors',
                  selected
                    ? 'border-approve ring-3 ring-approve/15'
                    : 'border-border hover:border-border/60',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-bold">{r.requester.name}</span>
                  <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {JOB_ROLE_LABELS[r.requester.jobRole]}
                  </span>
                  {r.isRetroactive && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
                      사후 신청
                    </span>
                  )}
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">
                  {TYPE_LABELS[r.type]} · {formatTargetDates(r.targetDates)}
                </div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  {r.currentStep}/{r.totalSteps} 단계 진행
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>

                {isRejecting ? (
                  <div
                    className="mt-3 flex flex-col gap-2"
                    onClick={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    <Textarea
                      value={rejectText}
                      onChange={(e) => setRejectText(e.target.value)}
                      placeholder="반려 사유 (신청자에게 전달됩니다)"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => {
                          setRejectingId(null)
                          setRejectText('')
                        }}
                      >
                        취소
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 bg-reject text-reject-foreground hover:bg-reject/90"
                        disabled={busy || rejectText.trim().length === 0}
                        onClick={() =>
                          rejectMut.mutate({ id: r.id, data: { comment: rejectText.trim() } })
                        }
                      >
                        반려 확정
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="mt-3 flex gap-2"
                    onClick={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 border-reject text-reject hover:bg-reject/5 hover:text-reject"
                      disabled={busy}
                      onClick={() => {
                        setActionError(null)
                        setRejectingId(r.id)
                        setRejectText('')
                      }}
                    >
                      반려
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 bg-approve text-approve-foreground hover:bg-approve/90"
                      disabled={busy || isSelf}
                      title={isSelf ? '본인 신청은 승인할 수 없습니다' : undefined}
                      onClick={() => {
                        setActionError(null)
                        approveMut.mutate({ id: r.id, data: {} })
                      }}
                    >
                      승인
                    </Button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
