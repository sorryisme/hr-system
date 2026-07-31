import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getGetRosterQueryKey, useApplyPreset, useListPresets } from '@/api/generated/endpoints'
import { ApiError } from '@/api/mutator'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface PresetTarget {
  id: string
  name: string
}

interface Props {
  rosterId: string
  yearMonth: string // YYYY-MM
  daysInMonth: number
  employee: PresetTarget | null
  onOpenChange: (open: boolean) => void
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return '요청 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

/**
 * 프리셋 적용 다이얼로그(§4.6/§4.8) — 직원 행 우클릭 → 패턴 + 조 + 시작일 + 적용 기간.
 * 이미 승인·수동 편집된 셀은 백엔드에서 건너뛰므로(§4.8 셀 보호 원칙) 결과의 skipped를 그대로 안내한다.
 */
export function ApplyPresetDialog({
  rosterId,
  yearMonth,
  daysInMonth,
  employee,
  onOpenChange,
}: Props) {
  const queryClient = useQueryClient()
  const monthStart = `${yearMonth}-01`
  const monthEnd = `${yearMonth}-${String(daysInMonth).padStart(2, '0')}`

  const [presetId, setPresetId] = useState('')
  const [teamNo, setTeamNo] = useState('')
  const [startDate, setStartDate] = useState(monthStart)
  const [endDate, setEndDate] = useState(monthEnd)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ appliedCount: number; skippedCount: number } | null>(
    null,
  )

  const presetsQuery = useListPresets({ query: { enabled: employee !== null } })
  const presets = presetsQuery.data?.data ?? []
  const preset = presets.find((p) => p.id === presetId)

  const applyMut = useApplyPreset({
    mutation: {
      onSuccess: async (r) => {
        setError(null)
        setResult({ appliedCount: r.data.appliedCount, skippedCount: r.data.skipped.length })
        await queryClient.invalidateQueries({ queryKey: getGetRosterQueryKey() })
      },
      onError: (e) => setError(errorMessage(e)),
    },
  })

  const reset = () => {
    setPresetId('')
    setTeamNo('')
    setStartDate(monthStart)
    setEndDate(monthEnd)
    setError(null)
    setResult(null)
  }

  const close = () => {
    onOpenChange(false)
    reset()
  }

  const canSubmit = presetId !== '' && teamNo !== '' && startDate !== '' && endDate !== ''

  return (
    <Dialog open={employee !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>프리셋 적용{employee ? ` — ${employee.name}` : ''}</DialogTitle>
          <DialogDescription>
            근무 패턴 · 조 · 시작일 · 적용 기간을 지정하면 해당 기간에 일괄 반영됩니다. 이미
            승인·수동 편집된 셀은 덮어쓰지 않고 건너뜁니다.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <div className="rounded-xl border border-approve/30 bg-approve/5 px-4 py-3 text-sm text-approve">
              {result.appliedCount}건 적용 완료
              {result.skippedCount > 0 &&
                ` · 승인/수동 편집 셀 ${result.skippedCount}건은 건너뛰었습니다`}
            </div>
            <DialogFooter>
              <Button onClick={close}>확인</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>근무 패턴</Label>
                <Select
                  value={presetId}
                  onValueChange={(v) => {
                    setPresetId(v ?? '')
                    setTeamNo('')
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="패턴 선택">
                      {(v: string | null) => presets.find((p) => p.id === v)?.name ?? '패턴 선택'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {presetsQuery.isSuccess && presets.length === 0 && (
                  <p className="text-xs text-muted-foreground">등록된 근무 패턴이 없습니다.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>조</Label>
                {preset ? (
                  <Select value={teamNo} onValueChange={(v) => setTeamNo(v ?? '')}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="조 선택">
                        {(v: string | null) => (v ? `${v}조` : '조 선택')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: preset.teamCount }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}조
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-8 w-full items-center rounded-lg border border-input bg-transparent px-2.5 text-sm text-muted-foreground opacity-50">
                    조 선택
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>시작일</Label>
                  <Input
                    type="date"
                    min={monthStart}
                    max={monthEnd}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>종료일</Label>
                  <Input
                    type="date"
                    min={startDate || monthStart}
                    max={monthEnd}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-reject/30 bg-reject/5 px-4 py-3 text-sm text-reject">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={applyMut.isPending}>
                취소
              </Button>
              <Button
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                disabled={!canSubmit || applyMut.isPending}
                onClick={() =>
                  employee &&
                  applyMut.mutate({
                    id: rosterId,
                    data: {
                      presetId,
                      teamNo: Number(teamNo),
                      employeeIds: [employee.id],
                      startDate,
                      endDate,
                    },
                  })
                }
              >
                {applyMut.isPending ? '적용 중…' : '적용'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
