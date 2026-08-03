import { useState } from 'react'
import type { RequestListItemDto, RosterResponseDto } from '@/api/generated/model'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RosterApprovalSidebar } from './roster-approval-sidebar'
import { ValidationPanel } from './validation-panel'

type SideTab = 'validation' | 'approvals'

interface Props {
  /** 조회 중이거나 해당 월 근무표가 아직 없으면 undefined — 검증 탭만 이 값에 의존한다 */
  roster: RosterResponseDto | undefined
  yearMonth: string
  selectedId: string | null
  onSelect: (request: RequestListItemDto | null) => void
}

/** 근무표 우측 고정 패널(§4.8) — 실시간 검증(기본 탭)·결재함 전환. 폭·테두리는 이 컴포넌트가 소유한다. */
export function RosterSidePanel({ roster, yearMonth, selectedId, onSelect }: Props) {
  const [tab, setTab] = useState<SideTab>('validation')

  return (
    <aside className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-border bg-paper">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as SideTab)}
        className="shrink-0 px-4 pt-4"
      >
        <TabsList variant="line">
          <TabsTrigger value="validation">검증</TabsTrigger>
          <TabsTrigger value="approvals">결재함</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'validation' ? (
        roster ? (
          <ValidationPanel validation={roster.validation} summary={roster.summary} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-muted-foreground">
            근무표를 불러오면 검증 결과가 표시됩니다.
          </div>
        )
      ) : (
        <RosterApprovalSidebar yearMonth={yearMonth} selectedId={selectedId} onSelect={onSelect} />
      )}
    </aside>
  )
}
