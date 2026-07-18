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
    return data.counts.rejected
  }

  return (
    <div className="flex min-h-svh flex-col bg-paper">
      {/* 브랜드 톱바 */}
      <header className="flex h-16 items-center gap-9 bg-brand px-7">
        <span className="text-xl font-extrabold text-brand-foreground">늘봄링크</span>
        <nav className="flex gap-7 self-stretch">
          {['근무표', '근태현황', '결재함', '시설정보'].map((item) => (
            <span
              key={item}
              className={
                item === '결재함'
                  ? 'flex items-center border-b-[3px] border-brand-foreground font-bold text-brand-foreground'
                  : 'flex items-center font-medium text-brand-foreground/60'
              }
            >
              {item}
            </span>
          ))}
        </nav>
        <span className="ml-auto text-sm font-medium text-brand-foreground">
          관리자 모드 (인증 미적용)
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="px-7 pt-6">
          <h1 className="mb-4 text-2xl font-extrabold">결재함</h1>
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
        </div>

        <div className="flex min-h-0 flex-1 border-t">
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
      </main>
    </div>
  )
}
