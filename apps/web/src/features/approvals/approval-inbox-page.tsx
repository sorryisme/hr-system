import { useState } from 'react'
import { useListRequests } from '@/api/generated/endpoints'
import { InboxStatusFilter } from '@/api/generated/model'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RequestDetailPanel } from './request-detail-panel'
import { RequestList } from './request-list'

const TABS: { value: InboxStatusFilter; label: string }[] = [
  { value: InboxStatusFilter.PENDING, label: '대기' },
  { value: InboxStatusFilter.APPROVED, label: '승인' },
  { value: InboxStatusFilter.REJECTED, label: '반려' },
  { value: InboxStatusFilter.CANCELED, label: '취소' },
]

/** 관리자 웹 결재함(A-3) — 목업 1a: 목록 + 우측 상세 패널 분할형 */
export function ApprovalInboxPage() {
  const [tab, setTab] = useState<InboxStatusFilter>(InboxStatusFilter.PENDING)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const listQuery = useListRequests({ status: tab })
  const data = listQuery.data?.data

  const countOf = (filter: InboxStatusFilter) => {
    if (!data) return null
    if (filter === InboxStatusFilter.PENDING) return data.counts.pending
    if (filter === InboxStatusFilter.APPROVED) return data.counts.approved
    if (filter === InboxStatusFilter.REJECTED) return data.counts.rejected
    return data.counts.canceled
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as InboxStatusFilter)
          setSelectedId(null)
        }}
      >
        <TabsList variant="line">
          {TABS.map(({ value, label }) => {
            const count = countOf(value)
            return (
              <TabsTrigger key={value} value={value}>
                {label}
                {count !== null && (
                  <span className="ml-1 text-xs text-muted-foreground">{count}</span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
        {listQuery.isPending ? (
          <div className="flex-1 px-5 py-16 text-center text-[15px] text-muted-foreground">
            불러오는 중…
          </div>
        ) : listQuery.isError ? (
          <div className="flex-1 px-5 py-16 text-center text-[15px] text-reject">
            목록을 불러오지 못했습니다. API 서버가 실행 중인지 확인해 주세요.
          </div>
        ) : (
          <RequestList
            items={data?.items ?? []}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
        <RequestDetailPanel requestId={selectedId} />
      </div>
    </div>
  )
}
