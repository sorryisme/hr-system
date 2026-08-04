import { useEffect, useMemo, useRef, useState } from 'react'
import type { RosterCellDto, RosterResponseDto } from '@/api/generated/model'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { JOB_ROLE_LABELS } from '@/features/approvals/labels'
import { cn } from '@/lib/utils'
import { ApplyPresetDialog, type PresetTarget } from './apply-preset-dialog'
import { CellEditPopover, type CellSelection } from './cell-edit-popover'
import { CATEGORY_CHIP_CLASS, shiftCategory, subholLabel } from './labels'

interface DragRect {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

const DOW_KR = ['일', '월', '화', '수', '목', '금', '토']

export interface CellHighlight {
  employeeId: string
  dates: Set<string> // YYYY-MM-DD
}

interface Props {
  roster: RosterResponseDto
  /** 전월 근무표(있으면 앞부분에 전월 마지막 7일을 읽기 전용으로 함께 표기) */
  prevRoster?: RosterResponseDto | null
  highlight?: CellHighlight | null
}

interface DayMeta {
  day: number
  workDate: string
  dow: number
  /** 전월 미리보기 컬럼 여부 — 편집 불가 */
  readOnly: boolean
}

const LEAD_DAYS = 7
/** 하단 요약행 1개 높이(px) — 요약행 고정 시 위 행이 아래 행 위에 겹쳐 쌓이도록 bottom 오프셋 계산에 사용 */
const SUMMARY_ROW_HEIGHT = 38

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 엑셀형 근무표: 직원(세로) × 날짜(가로). 팀 구분행 + 하단 요약/과부족행 포함 */
export function ScheduleGrid({ roster, prevRoster, highlight }: Props) {
  const [year, month] = roster.yearMonth.split('-').map(Number)
  const [presetTarget, setPresetTarget] = useState<PresetTarget | null>(null)
  // 편집 가능 상태(§4.8)에서만 프리셋 적용·셀 편집 허용 — CLOSED는 마감취소 후에만
  const canEdit = roster.status === 'DRAFT'
  // 날짜 헤더 행 고정(freeze pane) 토글 — 끄면 표 전체가 함께 스크롤된다.
  const [lockHeaders, setLockHeaders] = useState(true)
  // 직원명 컬럼 고정 토글 — 날짜 헤더 고정과 독립적으로 켜고 끌 수 있다.
  const [lockEmployees, setLockEmployees] = useState(true)
  // 하단 요약행(근무 인원/요양보호사 주·야간) 고정 토글 — 다른 고정 토글과 독립적으로 켜고 끌 수 있다.
  const [lockSummary, setLockSummary] = useState(true)

  // 전월 마지막 LEAD_DAYS일 — 실제 전월 근무표 조회 성공 여부와 무관하게 날짜 계산은 항상 가능.
  // 데이터(셀·요약)는 있으면 채우고 없으면 빈 칸으로 둔다.
  const leadDays = useMemo<DayMeta[]>(() => {
    const monthStart = new Date(year, month - 1, 1)
    const list: DayMeta[] = []
    for (let i = LEAD_DAYS; i >= 1; i--) {
      const dt = new Date(monthStart)
      dt.setDate(dt.getDate() - i)
      list.push({
        day: dt.getDate(),
        workDate: `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`,
        dow: dt.getDay(),
        readOnly: true,
      })
    }
    return list
  }, [year, month])

  const currentDays = useMemo<DayMeta[]>(() => {
    const list: DayMeta[] = []
    for (let d = 1; d <= roster.daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay()
      list.push({ day: d, workDate: `${roster.yearMonth}-${pad2(d)}`, dow, readOnly: false })
    }
    return list
  }, [roster.daysInMonth, roster.yearMonth, year, month])

  const days = useMemo<DayMeta[]>(() => [...leadDays, ...currentDays], [leadDays, currentDays])

  // 셀 편집(§4.8): 셀 클릭 → 근무유형 팝오버, 드래그 → 사각 범위 일괄 선택.
  // 드래그 도중 재계산되는 사각형은 ref(진행 중 값) + state(렌더용 미리보기)로 나눠 둔다.
  const flatEmployees = useMemo(() => roster.teams.flatMap((t) => t.employees), [roster.teams])
  const dragRef = useRef<DragRect | null>(null)
  const dragAnchorRef = useRef<HTMLElement | null>(null)
  const [previewRect, setPreviewRect] = useState<DragRect | null>(null)
  const [popover, setPopover] = useState<{ anchor: HTMLElement; cells: CellSelection[] } | null>(
    null,
  )

  useEffect(() => {
    function handleWindowMouseUp() {
      const rect = dragRef.current
      dragRef.current = null
      setPreviewRect(null)
      if (!rect) return
      const r0 = Math.min(rect.startRow, rect.endRow)
      const r1 = Math.max(rect.startRow, rect.endRow)
      const c0 = Math.min(rect.startCol, rect.endCol)
      const c1 = Math.max(rect.startCol, rect.endCol)
      const cells: CellSelection[] = []
      for (let r = r0; r <= r1; r++) {
        const emp = flatEmployees[r]
        if (!emp) continue
        for (let c = c0; c <= c1; c++) {
          const d = days[c]
          if (d && !d.readOnly) cells.push({ employeeId: emp.id, workDate: d.workDate })
        }
      }
      if (cells.length > 0 && dragAnchorRef.current) {
        const anchor = dragAnchorRef.current
        // 팝오버를 열자마자 base-ui의 outside-press 감지가 등록되는데, 이 클릭을 마무리하는
        // 네이티브 click 이벤트가 그 직후에(mouseup 다음) 도착해 "바깥 클릭"으로 오인되어
        // 팝오버가 열리자마자 닫혀버린다. 현재 클릭의 이벤트 전파가 끝난 다음 틱에 열어
        // outside-press 리스너가 이 클릭 자체를 감지하지 않도록 한다.
        setTimeout(() => setPopover({ anchor, cells }), 0)
      }
    }
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => window.removeEventListener('mouseup', handleWindowMouseUp)
  }, [flatEmployees, days])

  const handleCellMouseDown = (row: number, col: number, el: HTMLElement) => {
    if (!canEdit) return
    setPopover(null)
    const rect: DragRect = { startRow: row, startCol: col, endRow: row, endCol: col }
    dragRef.current = rect
    dragAnchorRef.current = el
    setPreviewRect(rect)
  }

  const handleCellMouseEnter = (row: number, col: number, el: HTMLElement) => {
    if (!dragRef.current) return
    const rect: DragRect = { ...dragRef.current, endRow: row, endCol: col }
    dragRef.current = rect
    dragAnchorRef.current = el
    setPreviewRect(rect)
  }

  const selectedKeys = useMemo(() => {
    const set = new Set<string>()
    const rect = previewRect
    if (rect) {
      const r0 = Math.min(rect.startRow, rect.endRow)
      const r1 = Math.max(rect.startRow, rect.endRow)
      const c0 = Math.min(rect.startCol, rect.endCol)
      const c1 = Math.max(rect.startCol, rect.endCol)
      for (let r = r0; r <= r1; r++) {
        const emp = flatEmployees[r]
        if (!emp) continue
        for (let c = c0; c <= c1; c++) {
          const d = days[c]
          if (d && !d.readOnly) set.add(`${emp.id}|${d.workDate}`)
        }
      }
    } else if (popover) {
      for (const c of popover.cells) set.add(`${c.employeeId}|${c.workDate}`)
    }
    return set
  }, [previewRect, popover, flatEmployees, days])

  const rowIndexMap = useMemo(() => {
    const m = new Map<string, number>()
    flatEmployees.forEach((e, i) => m.set(e.id, i))
    return m
  }, [flatEmployees])

  // (직원, 날짜) → 셀. 전월 미리보기 칸은 prevRoster.cells로 채운다.
  const cellMap = useMemo(() => {
    const m = new Map<string, RosterCellDto>()
    for (const c of prevRoster?.cells ?? []) m.set(`${c.employeeId}|${c.workDate}`, c)
    for (const c of roster.cells) m.set(`${c.employeeId}|${c.workDate}`, c)
    return m
  }, [roster.cells, prevRoster])

  const summaryMap = useMemo(() => {
    const m = new Map<string, (typeof roster.summary)[number]>()
    for (const s of prevRoster?.summary ?? []) m.set(s.workDate, s)
    for (const s of roster.summary) m.set(s.workDate, s)
    return m
  }, [roster.summary, prevRoster])

  const headCellClass = 'w-[34px] min-w-[34px] px-0 py-1.5 text-center'
  const stickyNameClass = cn(
    'min-w-[124px] bg-card px-3 text-left shadow-[1px_0_0_var(--border)]',
    lockEmployees && 'sticky left-0 z-[2]',
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-end gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="lock-headers-toggle" className="text-[13px] text-muted-foreground">
            날짜 헤더 고정
          </Label>
          <Switch
            id="lock-headers-toggle"
            size="sm"
            checked={lockHeaders}
            onCheckedChange={setLockHeaders}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="lock-employees-toggle" className="text-[13px] text-muted-foreground">
            직원 헤더 고정
          </Label>
          <Switch
            id="lock-employees-toggle"
            size="sm"
            checked={lockEmployees}
            onCheckedChange={setLockEmployees}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="lock-summary-toggle" className="text-[13px] text-muted-foreground">
            하단 요약 고정
          </Label>
          <Switch
            id="lock-summary-toggle"
            size="sm"
            checked={lockSummary}
            onCheckedChange={setLockSummary}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-card">
        <table className="w-max border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th
                className={cn(
                  headCellClass,
                  stickyNameClass,
                  'bg-paper',
                  lockHeaders && 'sticky top-0',
                  lockHeaders && lockEmployees && 'z-[4]',
                  lockHeaders && !lockEmployees && 'z-[3]',
                )}
              >
                <span className="text-[13px] font-semibold text-muted-foreground">
                  직원 / 날짜
                </span>
              </th>
              {days.map((d, i) => (
                <th
                  key={d.workDate}
                  className={cn(
                    headCellClass,
                    'border-b border-border/60 bg-paper font-bold',
                    lockHeaders && 'sticky top-0 z-[3]',
                    d.readOnly && (lockHeaders ? 'bg-muted' : 'bg-muted/40'),
                    d.readOnly && i === LEAD_DAYS - 1 && 'border-r-2 border-r-border',
                  )}
                >
                  <div
                    className={cn(
                      'text-[13px] font-extrabold text-foreground',
                      d.readOnly && 'font-semibold text-muted-foreground',
                      !d.readOnly && d.dow === 0 && 'text-reject',
                      !d.readOnly && d.dow === 6 && 'text-shift-night',
                    )}
                  >
                    {d.day}
                  </div>
                  <div
                    className={cn(
                      'text-[10px] font-semibold text-muted-foreground',
                      !d.readOnly && d.dow === 0 && 'text-reject',
                      !d.readOnly && d.dow === 6 && 'text-shift-night',
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
                lockEmployees={lockEmployees}
                canEdit={canEdit}
                onApplyPreset={setPresetTarget}
                rowIndexMap={rowIndexMap}
                selectedKeys={selectedKeys}
                onCellMouseDown={handleCellMouseDown}
                onCellMouseEnter={handleCellMouseEnter}
              />
            ))}
          </tbody>

          <tfoot>
            <SummaryRow
              label="근무 인원"
              days={days}
              stickyNameClass={stickyNameClass}
              lockEmployees={lockEmployees}
              value={(d) => summaryMap.get(d.workDate)?.workingCount ?? 0}
              lockSummary={lockSummary}
              bottomPx={SUMMARY_ROW_HEIGHT * 2}
            />
            <SummaryRow
              label="요양보호사 · 주간"
              days={days}
              stickyNameClass={stickyNameClass}
              lockEmployees={lockEmployees}
              value={(d) => summaryMap.get(d.workDate)?.caregiverDay ?? 0}
              short={(d) => summaryMap.get(d.workDate)?.dayShortage ?? false}
              lockSummary={lockSummary}
              bottomPx={SUMMARY_ROW_HEIGHT}
            />
            <SummaryRow
              label="요양보호사 · 야간"
              days={days}
              stickyNameClass={stickyNameClass}
              lockEmployees={lockEmployees}
              value={(d) => summaryMap.get(d.workDate)?.caregiverNight ?? 0}
              short={(d) => summaryMap.get(d.workDate)?.nightShortage ?? false}
              lockSummary={lockSummary}
              bottomPx={0}
            />
          </tfoot>
        </table>
      </div>

      <ApplyPresetDialog
        rosterId={roster.id}
        yearMonth={roster.yearMonth}
        daysInMonth={roster.daysInMonth}
        employee={presetTarget}
        onOpenChange={(open) => !open && setPresetTarget(null)}
      />

      <CellEditPopover
        rosterId={roster.id}
        anchor={popover?.anchor ?? null}
        cells={popover?.cells ?? []}
        onClose={() => setPopover(null)}
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
  lockEmployees,
  canEdit,
  onApplyPreset,
  rowIndexMap,
  selectedKeys,
  onCellMouseDown,
  onCellMouseEnter,
}: {
  team: RosterResponseDto['teams'][number]
  days: DayMeta[]
  cellMap: Map<string, RosterCellDto>
  highlight?: CellHighlight | null
  stickyNameClass: string
  /** 직원명 컬럼 고정 여부 — 켜지면 아래 스크롤 시 뒷내용이 비치지 않도록 강조색을 불투명하게 표시 */
  lockEmployees: boolean
  canEdit: boolean
  onApplyPreset: (target: PresetTarget) => void
  rowIndexMap: Map<string, number>
  selectedKeys: Set<string>
  onCellMouseDown: (row: number, col: number, el: HTMLElement) => void
  onCellMouseEnter: (row: number, col: number, el: HTMLElement) => void
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
        // 직원명 컬럼이 고정된 상태에서는 반투명 강조색 뒤로 스크롤 내용이 비치므로 불투명 색상으로 대체
        const highlightOpaque = rowHighlighted && lockEmployees
        const row = rowIndexMap.get(emp.id) ?? -1
        return (
          <tr key={emp.id}>
            <td
              className={cn(
                stickyNameClass,
                'border-b border-border/50 py-1',
                highlightOpaque && 'bg-warning',
                rowHighlighted && !lockEmployees && 'bg-warning/10',
              )}
            >
              {canEdit ? (
                <ContextMenu>
                  <ContextMenuTrigger className="block cursor-context-menu">
                    <div
                      className={cn(
                        'text-sm font-bold',
                        highlightOpaque ? 'text-warning-foreground' : 'text-foreground',
                      )}
                    >
                      {emp.name}
                    </div>
                    <div
                      className={cn(
                        'text-[11px] font-medium',
                        highlightOpaque ? 'text-warning-foreground' : 'text-muted-foreground',
                      )}
                    >
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
                  <div
                    className={cn(
                      'text-sm font-bold',
                      highlightOpaque ? 'text-warning-foreground' : 'text-foreground',
                    )}
                  >
                    {emp.name}
                  </div>
                  <div
                    className={cn(
                      'text-[11px] font-medium',
                      highlightOpaque ? 'text-warning-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {JOB_ROLE_LABELS[emp.jobRole]}
                  </div>
                </>
              )}
            </td>
            {days.map((d, col) => {
              const cell = cellMap.get(`${emp.id}|${d.workDate}`)
              const isHighlighted = rowHighlighted && highlight?.dates.has(d.workDate)
              const isSelected = selectedKeys.has(`${emp.id}|${d.workDate}`)
              const editable = canEdit && !d.readOnly
              return (
                <td
                  key={d.workDate}
                  onMouseDown={
                    editable
                      ? (e) => {
                          e.preventDefault()
                          onCellMouseDown(row, col, e.currentTarget)
                        }
                      : undefined
                  }
                  onMouseEnter={
                    editable ? (e) => onCellMouseEnter(row, col, e.currentTarget) : undefined
                  }
                  className={cn(
                    'h-[38px] border-b border-r border-border/50 text-center align-middle',
                    (d.dow === 0 || d.dow === 6) && 'bg-paper/50',
                    d.readOnly && 'bg-muted/40',
                    d.readOnly && col === LEAD_DAYS - 1 && 'border-r-2 border-r-border',
                    isHighlighted && 'bg-warning/15 ring-2 ring-inset ring-warning',
                    editable && 'cursor-pointer select-none',
                    isSelected && 'bg-brand/15 ring-2 ring-inset ring-brand',
                  )}
                >
                  {cell && (
                    <span className={cn('inline-flex', d.readOnly && 'opacity-60')}>
                      <CellChip cell={cell} />
                    </span>
                  )}
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
  lockEmployees,
  value,
  short,
  lockSummary,
  bottomPx,
}: {
  label: string
  days: DayMeta[]
  stickyNameClass: string
  /** 직원명 컬럼 고정 여부 — 라벨 칸이 좌·하단에 동시에 고정될 때 z-index를 더 높여 겹침을 방지 */
  lockEmployees: boolean
  value: (d: DayMeta) => number
  short?: (d: DayMeta) => boolean
  /** 하단 요약행 고정 토글 — 켜지면 이 행이 스크롤 컨테이너 하단에 고정된다 */
  lockSummary: boolean
  /** 고정 시 다른 요약행과 겹치지 않도록 쌓는 bottom 오프셋(px) */
  bottomPx: number
}) {
  return (
    <tr>
      <td
        className={cn(
          stickyNameClass,
          'border-t border-border bg-paper text-[13px] font-bold text-muted-foreground',
          lockSummary && 'sticky',
          lockSummary && lockEmployees && 'z-[4]',
          lockSummary && !lockEmployees && 'z-[3]',
        )}
        style={lockSummary ? { bottom: bottomPx } : undefined}
      >
        {label}
      </td>
      {days.map((d, i) => {
        const isShort = short?.(d) ?? false
        return (
          <td
            key={d.workDate}
            className={cn(
              'h-[38px] border-t border-r border-border/50 bg-paper text-center align-middle text-[13px] font-extrabold text-muted-foreground',
              d.readOnly && (lockSummary ? 'bg-muted' : 'bg-muted/40'),
              d.readOnly && i === LEAD_DAYS - 1 && 'border-r-2 border-r-border',
              isShort && (lockSummary ? 'bg-reject text-reject-foreground' : 'bg-reject/10 text-reject'),
              lockSummary && 'sticky z-[3]',
            )}
            style={lockSummary ? { bottom: bottomPx } : undefined}
          >
            {value(d)}
          </td>
        )
      })}
    </tr>
  )
}
