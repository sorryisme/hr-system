import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  getGetRequestQueryKey,
  getListRequestsQueryKey,
  useApproveRequest,
  useGetRequest,
  useRejectRequest,
} from '@/api/generated/endpoints'
import { ApiError } from '@/api/mutator'
import { Button } from '@/components/ui/button'
import { getSessionUser } from '@/features/auth/session'
import { StatusBadge, TypeBadge } from './badges'
import { ApprovalStepper } from './approval-stepper'
import { RejectForm } from './reject-form'
import { SignatureBoxes } from './signature-boxes'
import {
  JOB_ROLE_LABELS,
  formatDateTime,
  formatTargetDates,
} from './labels'

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return '요청 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

export function RequestDetailPanel({ requestId }: { requestId: string | null }) {
  if (requestId === null) {
    return (
      <aside className="w-[460px] shrink-0 border-l bg-card">
        <div className="px-6 py-16 text-center text-[15px] text-muted-foreground">
          좌측 목록에서 신청 항목을 선택하세요.
        </div>
      </aside>
    )
  }
  return <RequestDetailContent key={requestId} requestId={requestId} />
}

function RequestDetailContent({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient()
  const detailQuery = useGetRequest(requestId)
  const detail = detailQuery.data?.data

  const [rejecting, setRejecting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // 처리 후 서버 진실 재조회(invalidation-only) — 탭 카운트·목록·상세 동시 갱신
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListRequestsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetRequestQueryKey(requestId) }),
    ])
  }
  const mutationOptions = {
    onSuccess: async () => {
      setActionError(null)
      setRejecting(false)
      await invalidate()
    },
    onError: async (error: unknown) => {
      setActionError(errorMessage(error))
      // 409(경합/종결)면 화면이 이미 낡은 것 — 서버 상태로 동기화
      await invalidate()
    },
  }
  const approveMutation = useApproveRequest({ mutation: mutationOptions })
  const rejectMutation = useRejectRequest({ mutation: mutationOptions })
  const pending = approveMutation.isPending || rejectMutation.isPending

  // 결재자 = 로그인 사용자(서버도 JWT 세션으로 동일하게 식별·검증 — D-6, NOT_YOUR_STEP).
  // 현재 단계의 결재자/대결자 또는 상위 단계 결재자(하위 결재 허용: 2차→1차, 3차→1·2차)가
  // 아니면 버튼을 비활성화해 불필요한 409를 예방한다
  const user = getSessionUser()
  const currentLine = detail?.requestLines.find((l) => l.stepNo === detail.currentStep + 1)
  const isMyTurn =
    !!user &&
    !!detail &&
    !!currentLine &&
    user.id !== detail.requester.id &&
    (currentLine.approvers.some((a) => a.id === user.id) ||
      currentLine.deputy?.id === user.id ||
      detail.requestLines.some(
        (l) => l.stepNo > currentLine.stepNo && l.approvers.some((a) => a.id === user.id),
      ))

  const isOpen = detail?.status === 'PENDING' || detail?.status === 'INTERIM_APPROVED'
  const rejectHistory = detail?.histories.find((h) => h.action === 'REJECT')

  // 임의 전결(D-13): 2차 단계의 결재자/대결자 본인만 선택 가능(서버 동일 검증).
  // 스냅샷 delegation ON이면 일반 승인이 이미 전결 확정이라 별도 버튼 불필요
  const canDelegate =
    isMyTurn &&
    !!user &&
    !!detail &&
    !!currentLine &&
    currentLine.stepNo === 2 &&
    detail.totalSteps > 2 &&
    !currentLine.delegationEnabled &&
    (currentLine.approvers.some((a) => a.id === user.id) || currentLine.deputy?.id === user.id)

  return (
    <aside className="w-[460px] shrink-0 overflow-y-auto border-l bg-card">
      {!detail ? (
        <div className="px-6 py-16 text-center text-[15px] text-muted-foreground">
          {detailQuery.isError ? '상세 정보를 불러오지 못했습니다.' : '불러오는 중…'}
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[19px] font-extrabold">{detail.requester.name}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {JOB_ROLE_LABELS[detail.requester.jobRole]}
              </div>
            </div>
            <StatusBadge
              status={detail.status}
              isFinalByDelegation={detail.isFinalByDelegation}
            />
          </div>

          <div className="flex items-center gap-2">
            <TypeBadge type={detail.type} />
            {detail.isRetroactive && (
              <span className="text-xs text-muted-foreground">사후 신청 (D-3)</span>
            )}
          </div>

          <div className="flex flex-col gap-2.5 rounded-xl border bg-paper p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">대상일</span>
              <span className="font-semibold">{formatTargetDates(detail.targetDates)}</span>
            </div>
            {detail.type === 'SHIFT_CHANGE' && detail.desiredShift && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">변경 희망</span>
                <span className="font-semibold text-brand">{detail.desiredShift.label}</span>
              </div>
            )}
            {detail.leaveDays !== null && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">차감량</span>
                <span className="font-semibold">{detail.leaveDays}일</span>
              </div>
            )}
            <div className="text-sm text-muted-foreground">사유</div>
            <div className="text-[15px] leading-relaxed">
              {detail.reason ?? '(입력 없음)'}
            </div>
            <div className="flex justify-between border-t pt-2 text-[13px]">
              <span className="text-muted-foreground">신청일시</span>
              <span>{formatDateTime(detail.createdAt)}</span>
            </div>
          </div>

          <ApprovalStepper detail={detail} />
          <SignatureBoxes detail={detail} />

          {rejectHistory && (
            <div className="rounded-xl border border-reject/30 bg-reject/5 px-4 py-3.5">
              <div className="mb-1.5 text-[13px] font-bold text-reject">반려 사유</div>
              <div className="text-sm leading-relaxed text-reject/90">
                {rejectHistory.comment}
              </div>
            </div>
          )}

          {actionError && (
            <div className="rounded-xl border border-reject/30 bg-reject/5 px-4 py-3 text-sm text-reject">
              {actionError}
            </div>
          )}

          {isOpen && (
            <div className="flex flex-col gap-3 border-t pt-4">
              <div className="flex justify-between text-[13px]">
                <span className="text-muted-foreground">결재자</span>
                <span className="font-semibold">
                  {user ? `${user.name} ${JOB_ROLE_LABELS[user.jobRole]}` : '(로그인 필요)'}
                </span>
              </div>

              {!isMyTurn && (
                <div className="rounded-xl border bg-paper px-4 py-3 text-sm text-muted-foreground">
                  현재 로그인 계정은 이 단계를 결재할 권한이 없습니다(해당 단계
                  결재자·대결자 또는 상위 단계 결재자만 가능).
                </div>
              )}

              {rejecting ? (
                <RejectForm
                  pending={pending}
                  onCancel={() => setRejecting(false)}
                  onConfirm={(comment) => {
                    rejectMutation.mutate({ id: requestId, data: { comment } })
                  }}
                />
              ) : (
                <div className="flex flex-col gap-2.5">
                  <div className="flex gap-2.5">
                    <Button
                      variant="outline"
                      className="h-11 flex-1 border-reject text-reject hover:bg-reject/5 hover:text-reject"
                      disabled={pending || !isMyTurn}
                      onClick={() => setRejecting(true)}
                    >
                      반려
                    </Button>
                    <Button
                      className="h-11 flex-1 bg-approve text-approve-foreground hover:bg-approve/90"
                      disabled={pending || !isMyTurn}
                      onClick={() => approveMutation.mutate({ id: requestId, data: {} })}
                    >
                      {pending ? '처리 중…' : '승인'}
                    </Button>
                  </div>
                  {canDelegate && (
                    <Button
                      variant="outline"
                      className="h-11 w-full border-brand text-brand hover:bg-brand/5 hover:text-brand"
                      disabled={pending}
                      onClick={() =>
                        approveMutation.mutate({
                          id: requestId,
                          data: { delegated: true },
                        })
                      }
                    >
                      전결 승인 — 이후 단계 생략 (D-13)
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
