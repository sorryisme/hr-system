import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  getGetRosterQueryKey,
  useClose,
  useComplete,
  useRejectClose,
  useSubmitClose,
} from '@/api/generated/endpoints'
import type { RosterResponseDto, ValidationFindingDto } from '@/api/generated/model'
import { ApiError } from '@/api/mutator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { findingText, ROSTER_STATUS_LABELS } from './labels'

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return '요청 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

const STATUS_BADGE: Record<RosterResponseDto['status'], string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  COMPLETED: 'bg-brand/10 text-brand',
  CLOSING_APPROVAL: 'bg-warning/15 text-warning',
  CLOSED: 'bg-approve/10 text-approve',
}

/** 근무표 상태 배지 + 상태머신 전이 액션(§4.8): 작성완료 · 마감상신 · 마감승인/반려 */
export function RosterToolbar({ roster }: { roster: RosterResponseDto }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [violations, setViolations] = useState<ValidationFindingDto[]>([])
  const [forceOpen, setForceOpen] = useState(false)
  const [forceReason, setForceReason] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetRosterQueryKey() })

  const onSuccess = async (data: { violations: ValidationFindingDto[] }) => {
    setError(null)
    setViolations(data.violations ?? [])
    await invalidate()
  }
  const onError = async (e: unknown) => {
    setError(errorMessage(e))
    await invalidate()
  }

  const completeMut = useComplete({ mutation: { onSuccess: (r) => onSuccess(r.data), onError } })
  const submitMut = useSubmitClose({ mutation: { onSuccess: (r) => onSuccess(r.data), onError } })
  const rejectMut = useRejectClose({
    mutation: {
      onSuccess: async (r) => {
        setRejectOpen(false)
        setRejectReason('')
        await onSuccess(r.data)
      },
      onError,
    },
  })
  const closeMut = useClose({
    mutation: {
      onSuccess: async (r) => {
        setForceOpen(false)
        setForceReason('')
        await onSuccess(r.data)
      },
      onError: async (e: unknown) => {
        // 위반이 있으면 강행 사유를 받아 재시도(D-19)
        if (e instanceof ApiError && e.code === 'ROSTER_HAS_VIOLATIONS') {
          setForceOpen(true)
          return
        }
        await onError(e)
      },
    },
  })

  const pending =
    completeMut.isPending || submitMut.isPending || closeMut.isPending || rejectMut.isPending

  const blocking = violations.filter((v) => v.severity === 'BLOCK')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge className={cn('rounded-full px-3 py-1 text-[13px] font-bold', STATUS_BADGE[roster.status])}>
          {ROSTER_STATUS_LABELS[roster.status]}
        </Badge>

        <div className="flex flex-1 flex-wrap justify-end gap-2">
          {roster.status === 'DRAFT' && (
            <Button
              className="bg-brand text-brand-foreground hover:bg-brand/90"
              disabled={pending}
              onClick={() => completeMut.mutate({ id: roster.id })}
            >
              작성 완료
            </Button>
          )}

          {roster.status === 'COMPLETED' && (
            <Button
              className="bg-brand text-brand-foreground hover:bg-brand/90"
              disabled={pending}
              onClick={() => submitMut.mutate({ id: roster.id })}
            >
              마감 상신
            </Button>
          )}

          {roster.status === 'CLOSING_APPROVAL' && (
            <>
              <Button
                variant="outline"
                className="border-reject text-reject hover:bg-reject/5 hover:text-reject"
                disabled={pending}
                onClick={() => setRejectOpen(true)}
              >
                마감 반려
              </Button>
              <Button
                className="bg-approve text-approve-foreground hover:bg-approve/90"
                disabled={pending}
                onClick={() => closeMut.mutate({ id: roster.id, data: { force: false } })}
              >
                마감 승인
              </Button>
            </>
          )}

          {roster.status === 'CLOSED' && (
            <span className="text-sm font-medium text-muted-foreground">
              마감 완료된 근무표입니다. 변경은 결재를 통해서만 가능합니다.
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-reject/30 bg-reject/5 px-4 py-3 text-sm text-reject">
          {error}
        </div>
      )}

      {blocking.length > 0 && roster.status !== 'CLOSED' && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
          <div className="text-sm font-bold text-warning">
            최소 인원 미달 {blocking.length}건 — 마감 시 강행 사유가 필요합니다(D-19)
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {blocking.slice(0, 12).map((v, i) => (
              <li
                key={`${v.ruleCode}-${i}`}
                className="rounded-md bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {findingText(v.detail)}
              </li>
            ))}
            {blocking.length > 12 && (
              <li className="px-2 py-0.5 text-xs text-muted-foreground">
                외 {blocking.length - 12}건
              </li>
            )}
          </ul>
        </div>
      )}

      {/* 강행 마감 사유 입력(위반 존재 시) */}
      <Dialog open={forceOpen} onOpenChange={setForceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>강행 마감 사유</DialogTitle>
            <DialogDescription>
              최소 인원 미달이 있는 근무표를 마감합니다. 사유는 마감 이력에 기록됩니다(D-19).
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={forceReason}
            onChange={(e) => setForceReason(e.target.value)}
            placeholder="예) 대체 인력 채용 진행 중, 시설장 구두 승인"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setForceOpen(false)} disabled={pending}>
              취소
            </Button>
            <Button
              className="bg-approve text-approve-foreground hover:bg-approve/90"
              disabled={pending || forceReason.trim().length === 0}
              onClick={() =>
                closeMut.mutate({
                  id: roster.id,
                  data: { force: true, reason: forceReason.trim() },
                })
              }
            >
              {pending ? '처리 중…' : '강행 마감'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 마감 반려 사유 입력 */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>마감 반려 사유</DialogTitle>
            <DialogDescription>
              작성자에게 반환됩니다(작성 중 상태로 복귀). 사유 입력이 필요합니다.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="예) 야간 인원 배치를 다시 확인해 주세요."
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={pending}>
              취소
            </Button>
            <Button
              className="bg-reject text-reject-foreground hover:bg-reject/90"
              disabled={pending || rejectReason.trim().length === 0}
              onClick={() =>
                rejectMut.mutate({ id: roster.id, data: { reason: rejectReason.trim() } })
              }
            >
              {pending ? '처리 중…' : '반려 확정'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
