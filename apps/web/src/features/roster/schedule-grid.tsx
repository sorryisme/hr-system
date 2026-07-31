import { useMemo, useState } from 'react'
import type { RosterCellDto, RosterResponseDto } from '@/api/generated/model'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { JOB_ROLE_LABELS } from '@/features/approvals/labels'
import { cn } from '@/lib/utils'
import { ApplyPresetDialog, type PresetTarget } from './apply-preset-dialog'
import { CATEGORY_CHIP_CLASS, shiftCategory, subholLabel } from './labels'

const DOW_KR = ['일', '월', '화', '수', '목', '금', '토']

export interface CellHighlight {
  employeeId: string
  dates: Set<string> // YYYY-MM-DD
}

interface Props {
  roster: RosterResponseDto
  highlight?: CellHighlight | null
}

interface DayMeta {
  day: number
  workDate: string
  dow: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 엑셀형 근무표: 직원(세로) × 날짜(가로). 팀 구분행 + 하단 요약/과부족행 포함 */
export function ScheduleGrid({ roster, highlight }: Props) {
  const [year, month] = roster.yearMonth.split('-').map(Number)
  const [presetTarget, setPresetTarget] = useState<PresetTarget | null>(null)
  // 편집 가능 상태(§4.8)에서만 프리셋 적용 허용 — CLOSED/CLOSING_APPROVAL은 결재 경유·상신 취소 후에만
  const canEdit = roster.status === 'DRAFT' || roster.status === 'COMPLETED'

  const days = useMemo<DayMeta[]>(() => {
    const list: DayMeta[] = []
    for (let d = 1; d <= roster.daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay()
      list.push({ day: d, workDate: `${roster.yearMonth}-${pad2(d)}`, dow })
    }
    return list
  }, [roster.daysInMonth, roster.yearMonth, year, month])

  // (직원, 날짜) → 셀
  const cellMap = useMemo(() => {
    const m = new Map<string, RosterCellDto>()
    for (const c of roster.cells) m.set(`${c.employeeId}|${c.workDate}`, c)
    return m
  }, [roster.cells])

  const summaryMap = useMemo(() => {
    const m = new Map<string, (typeof roster.summary)[number]>()
    for (const s of roster.summary) m.set(s.workDate, s)
    return m
  }, [roster.summary])

  const headCellClass = 'w-[34px] min-w-[34px] px-0 py-1.5 text-center'
  const stickyNameClass =
    'sticky left-0 z-[2] min-w-[124px] bg-card px-3 text-left shadow-[1px_0_0_var(--border)]'

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-card">
      <table className="w-max border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th className={cn(headCellClass, stickyNameClass, 'z-[4] bg-paper')}>
              <span className="text-[13px] font-semibold text-muted-foreground">직원 / 날짜</span>
            </th>
            {days.map((d) => (
              <th
                key={d.day}
                className={cn(
                  headCellClass,
                  'sticky top-0 z-[3] border-b border-border/60 bg-paper font-bold',
                )}
              >
                <div
                  className={cn(
                    'text-[13px] font-extrabold text-foreground',
                    d.dow === 0 && 'text-reject',
                    d.dow === 6 && 'text-shift-night',
                  )}
                >
                  {d.day}
                </div>
                <div
                  className={cn(
                    'text-[10px] font-semibold text-muted-foreground',
                    d.dow === 0 && 'text-reject',
                    d.dow === 6 && 'text-shift-night',
                  )}
                >
                  {DOW_KR[d.dow]}
                </div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {roster.teams.map((team) => (
            <TeamGroup
              key={team.teamId ?? 'none'}
              team={team}
              days={days}
              cellMap={cellMap}
              highlight={highlight}
              stickyNameClass={stickyNameClass}
              canEdit={canEdit}
              onApplyPreset={setPresetTarget}
            />
          ))}
        </tbody>

        <tfoot>
          <SummaryRow
            label="근무 인원"
            days={days}
            stickyNameClass={stickyNameClass}
            value={(d) => summaryMap.get(d.workDate)?.workingCount ?? 0}
          />
          <SummaryRow
            label="요양보호사 · 주간"
            days={days}
            stickyNameClass={stickyNameClass}
            value={(d) => summaryMap.get(d.workDate)?.caregiverDay ?? 0}
            short={(d) => summaryMap.get(d.workDate)?.dayShortage ?? false}
          />
          <SummaryRow
            label="요양보호사 · 야간"
            days={days}
            stickyNameClass={stickyNameClass}
            value={(d) => summaryMap.get(d.workDate)?.caregiverNight ?? 0}
            short={(d) => summaryMap.get(d.workDate)?.nightShortage ?? false}
          />
        </tfoot>
      </table>

      <ApplyPresetDialog
        rosterId={roster.id}
        yearMonth={roster.yearMonth}
        daysInMonth={roster.daysInMonth}
        employee={presetTarget}
        onOpenChange={(open) => !open && setPresetTarget(null)}
      />
    </div>
  )
}

function TeamGroup({
  team,
  days,
  cellMap,
  highlight,
  stickyNameClass,
  canEdit,
  onApplyPreset,
}: {
  team: RosterResponseDto['teams'][number]
  days: DayMeta[]
  cellMap: Map<string, RosterCellDto>
  highlight?: CellHighlight | null
  stickyNameClass: string
  canEdit: boolean
  onApplyPreset: (target: PresetTarget) => void
}) {
  return (
    <>
      <tr>
        <td
          colSpan={days.length + 1}
          className="border-y border-border bg-paper-strong px-3.5 py-1.5"
        >
          <span className="text-[13px] font-extrabold tracking-wide text-muted-foreground">
            {team.name}
          </span>
        </td>
      </tr>
      {team.employees.map((emp) => {
        const rowHighlighted = highlight?.employeeId === emp.id
        return (
          <tr key={emp.id}>
            <td
              className={cn(
                stickyNameClass,
                'border-b border-border/50 py-1',
                rowHighlighted && 'bg-warning/10',
              )}
            >
              {canEdit ? (
                <ContextMenu>
                  <ContextMenuTrigger className="block cursor-context-menu">
                    <div className="text-sm font-bold text-foreground">{emp.name}</div>
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {JOB_ROLE_LABELS[emp.jobRole]}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() => onApplyPreset({ id: emp.id, name: emp.name })}
                    >
                      프리셋 적용…
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ) : (
                <>
                  <div className="text-sm font-bold text-foreground">{emp.name}</div>
                  <div className="text-[11px] font-medium text-muted-foreground">
                    {JOB_ROLE_LABELS[emp.jobRole]}
                  </div>
                </>
              )}
            </td>
            {days.map((d) => {
              const cell = cellMap.get(`${emp.id}|${d.workDate}`)
              const isHighlighted = rowHighlighted && highlight?.dates.has(d.workDate)
              return (
                <td
                  key={d.day}
                  className={cn(
                    'h-[38px] border-b border-r border-border/50 text-center align-middle',
                    (d.dow === 0 || d.dow === 6) && 'bg-paper/50',
                    isHighlighted && 'bg-warning/15 ring-2 ring-inset ring-warning',
                  )}
                >
                  {cell && <CellChip cell={cell} />}
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}

function CellChip({ cell }: { cell: RosterCellDto }) {
  const category = shiftCategory(cell.shiftCode)
  const chipBase =
    'inline-flex items-center justify-center rounded-lg text-[12px] font-bold'
  const provisional = cell.isProvisional && 'border border-dashed border-current opacity-70'

  // 근무조정: 근무종류 + 조정 시각을 세로로 쌓아 표기 (주/야 + 출근 + 퇴근)
  if (cell.isTimeOverridden && cell.startTime && cell.endTime) {
    return (
      <span
        className={cn(
          chipBase,
          CATEGORY_CHIP_CLASS[category],
          provisional,
          'flex-col gap-0 px-1.5 py-1 leading-tight',
        )}
        title={`근무조정 ${cell.startTime}~${cell.endTime}`}
      >
        <b className="text-[11px] font-extrabold">{cell.cellLabel}</b>
        <small className="text-[8px] font-semibold">{cell.startTime}</small>
        <small className="text-[8px] font-semibold">{cell.endTime}</small>
      </span>
    )
  }

  // 유급휴일대체: "유(이월시간,분)"
  if (cell.shiftCode === 'SUB') {
    return (
      <span
        className={cn(chipBase, CATEGORY_CHIP_CLASS[category], provisional, 'h-[26px] px-1.5')}
        title="유급휴일대체"
      >
        {subholLabel(cell.carryableMinutes)}
      </span>
    )
  }

  const label = cell.cellLabel ?? cell.shiftCode
  const wide = label.length > 1
  return (
    <span
      className={cn(
        chipBase,
        CATEGORY_CHIP_CLASS[category],
        provisional,
        wide ? 'h-[26px] px-1.5' : 'h-[26px] w-[26px]',
      )}
      title={cell.startTime && cell.endTime ? `${cell.startTime}~${cell.endTime}` : undefined}
    >
      {label}
    </span>
  )
}

function SummaryRow({
  label,
  days,
  stickyNameClass,
  value,
  short,
}: {
  label: string
  days: DayMeta[]
  stickyNameClass: string
  value: (d: DayMeta) => number
  short?: (d: DayMeta) => boolean
}) {
  return (
    <tr>
      <td
        className={cn(
          stickyNameClass,
          'z-[2] border-t border-border bg-paper text-[13px] font-bold text-muted-foreground',
        )}
      >
        {label}
      </td>
      {days.map((d) => {
        const isShort = short?.(d) ?? false
        return (
          <td
            key={d.day}
            className={cn(
              'h-[38px] border-t border-r border-border/50 bg-paper text-center align-middle text-[13px] font-extrabold text-muted-foreground',
              isShort && 'bg-reject/10 text-reject',
            )}
          >
            {value(d)}
            {isShort ? '!' : ''}
          </td>
        )
      })}
    </tr>
  )
}
