import type { RosterDaySummaryDto, RosterValidationDto } from '@/api/generated/model'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { STAFFING_CATEGORY_LABELS } from './labels'

interface Props {
  validation: RosterValidationDto
  summary: RosterDaySummaryDto[]
}

/**
 * 근무표 실시간 검증 패널(§4.8 우측 고정) — 월별 인력산정(§4.2), 가산 예상 점수(§4.3),
 * 일별 주/야 미달일 요약(§4.5, 그리드 하단 요약행과 동일한 판정을 재사용). 셀 편집 시마다
 * GET /rosters가 재조회되므로(쿼리 무효화) 별도 재계산 트리거 없이 props만으로 항상 최신 상태다.
 */
export function ValidationPanel({ validation, summary }: Props) {
  if (validation.configMissing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="text-[15px] font-semibold text-muted-foreground">검증에 필요한 설정이 없습니다</div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          고시 파라미터 또는 이 달의 월별 현원(설정 A-6)이 등록되어야
          <br />
          인력산정·가산 점수를 계산할 수 있습니다.
        </p>
      </div>
    )
  }

  const { monthlyStaffing, bonusScore } = validation
  const shortageDays = summary.filter((s) => s.dayShortage || s.nightShortage)
  const pct =
    bonusScore?.target && bonusScore.target > 0
      ? Math.min(100, Math.round((bonusScore.estimated / bonusScore.target) * 100))
      : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="font-heading text-[15px] font-bold">월별 인력산정</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">직군별 환산 인원 vs 배치기준(§4.2)</p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {monthlyStaffing.map((item) => (
            <li key={item.category} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="text-foreground">{STAFFING_CATEGORY_LABELS[item.category]}</span>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'font-semibold tabular-nums',
                    item.met ? 'text-approve' : 'text-reject',
                  )}
                >
                  {item.actual}/{item.required}명
                </span>
                <Badge
                  className={cn(
                    'rounded-full px-2 py-0 text-[11px] font-semibold',
                    item.met ? 'bg-approve/10 text-approve' : 'bg-reject/10 text-reject',
                  )}
                >
                  {item.met ? '충족' : '미달'}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {bonusScore && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="font-heading text-[15px] font-bold">가산 예상 점수</h3>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-heading text-2xl font-bold">{bonusScore.estimated}</span>
            <span className="text-[13px] text-muted-foreground">
              점 / 목표 {bonusScore.target ?? '미설정'}{bonusScore.target != null && '점'}
            </span>
          </div>
          {pct !== null && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', pct >= 100 ? 'bg-approve' : 'bg-brand')}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <ul className="mt-3 flex flex-col gap-1 text-[12px] text-muted-foreground">
            <li>① 인력배치추가 — {bonusScore.breakdown.staffAddon}점</li>
            <li>② 야간직원배치 — {bonusScore.breakdown.nightAddon}점</li>
            <li>③ 간호사배치 — {bonusScore.breakdown.nurseAddon}점</li>
          </ul>
          {bonusScore.isPlanBased && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              ※ 출퇴근 태그 연동 전까지 근무표 계획 시간 기준 추정치입니다.
            </p>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="font-heading text-[15px] font-bold">일별 미달일</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">요양보호사 주/야 최소 인원 미달(§4.5)</p>
        {shortageDays.length === 0 ? (
          <div className="mt-3 text-[13px] text-muted-foreground">미달일이 없습니다.</div>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {shortageDays.map((s) => (
              <li
                key={s.workDate}
                className="rounded-md bg-warning/10 px-2 py-0.5 text-[12px] font-medium text-warning"
              >
                {Number(s.workDate.split('-')[2])}일
                {s.dayShortage && ' 주'}
                {s.nightShortage && ' 야'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
