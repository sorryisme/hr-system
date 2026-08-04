import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  getGetRosterQueryKey,
  useCreateRoster,
  useGetRoster,
} from '@/api/generated/endpoints'
import type { RequestListItemDto } from '@/api/generated/model'
import { ApiError } from '@/api/mutator'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CodeGuideDialog } from './code-guide-dialog'
import { CATEGORY_CHIP_CLASS, LEGEND_ITEMS } from './labels'
import { RosterSidePanel } from './roster-side-panel'
import { RosterToolbar } from './roster-toolbar'
import { ScheduleGrid, type CellHighlight } from './schedule-grid'

function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 근무표 · 결재 관리(관리자 웹) — 목업 "근무표 승인" 화면 */
export function RosterPage() {
  const queryClient = useQueryClient()
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [selected, setSelected] = useState<RequestListItemDto | null>(null)

  const rosterQuery = useGetRoster({ yearMonth }, { query: { retry: false } })
  const roster = rosterQuery.data?.data
  const [, monthStr] = yearMonth.split('-')

  // 전월 마지막 며칠(§ 근무표 앞부분 미리보기) 표기를 위해 전월 근무표도 함께 조회.
  // 전월 근무표가 없어도(404) 근무표 자체 사용에는 영향이 없어야 하므로 별도 쿼리로 분리.
  const prevRosterQuery = useGetRoster(
    { yearMonth: shiftMonth(yearMonth, -1) },
    { query: { retry: false } },
  )
  const prevRoster = prevRosterQuery.data?.data

  const createMut = useCreateRoster({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetRosterQueryKey() }),
    },
  })

  // 선택한 결재 건의 대상 셀(신청자 × 대상일) 강조
  const highlight = useMemo<CellHighlight | null>(() => {
    if (!selected) return null
    return { employeeId: selected.requester.id, dates: new Set(selected.targetDates) }
  }, [selected])

  const notFound =
    rosterQuery.error instanceof ApiError && rosterQuery.error.status === 404

  const changeMonth = (delta: number) => {
    setYearMonth((ym) => shiftMonth(ym, delta))
    setSelected(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 월 이동 헤더 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => changeMonth(-1)} aria-label="이전 달">
            <ChevronLeft className="size-4" />
          </Button>
          <div className="min-w-[128px] text-center font-heading text-xl font-bold">
            {yearMonth.split('-')[0]}년 {Number(monthStr)}월
          </div>
          <Button variant="outline" size="icon" onClick={() => changeMonth(1)} aria-label="다음 달">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {roster && <RosterToolbar roster={roster} />}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-border">
        {/* 메인: 근무표 */}
        <main className="flex min-w-0 flex-1 flex-col gap-3 bg-background p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-heading text-2xl font-bold">{Number(monthStr)}월 근무표</h1>
              <p className="text-sm text-muted-foreground">
                승인된 연차·반차·근무조정은 근무표에 자동으로 반영됩니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-2">
                {LEGEND_ITEMS.map((item) => (
                  <span
                    key={item.text}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground"
                  >
                    <span
                      className={cn(
                        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md px-1 text-[10px] font-extrabold',
                        CATEGORY_CHIP_CLASS[item.category],
                      )}
                    >
                      {item.label}
                    </span>
                    {item.text}
                  </span>
                ))}
              </div>
              <CodeGuideDialog />
            </div>
          </div>

          {rosterQuery.isPending ? (
            <div className="flex flex-1 items-center justify-center text-[15px] text-muted-foreground">
              불러오는 중…
            </div>
          ) : notFound ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="text-[15px] text-muted-foreground">
                {yearMonth.split('-')[0]}년 {Number(monthStr)}월 근무표가 아직 없습니다.
              </div>
              <Button
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                disabled={createMut.isPending}
                onClick={() => createMut.mutate({ data: { yearMonth } })}
              >
                {createMut.isPending ? '생성 중…' : '이번 달 근무표 생성'}
              </Button>
              {createMut.error instanceof ApiError && (
                <div className="text-sm text-reject">{createMut.error.message}</div>
              )}
            </div>
          ) : rosterQuery.isError ? (
            <div className="flex flex-1 items-center justify-center text-[15px] text-reject">
              근무표를 불러오지 못했습니다. API 서버가 실행 중인지 확인해 주세요.
            </div>
          ) : roster ? (
            <ScheduleGrid roster={roster} prevRoster={prevRoster} highlight={highlight} />
          ) : null}
        </main>

        {/* 사이드: 검증·결재함. 결재함 탭은 근무표 유무와 무관하게 항상 동작해야 하므로
            로딩·미생성 상태에서도 패널 자체는 유지한다(검증 탭만 roster 데이터에 의존). */}
        <RosterSidePanel
          roster={roster}
          yearMonth={yearMonth}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
        />
      </div>
    </div>
  )
}
