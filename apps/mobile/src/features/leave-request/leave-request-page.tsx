import { useGetBalance, useGetMyRequests, useGetRosterStatus } from '@/api/generated/endpoints'
import type { MyLeaveRequestDto } from '@/api/generated/model'
import { getSessionUser } from '@/features/auth/session'
import { ConfirmScreen } from './components/confirm-screen'
import { DateSelectScreen } from './components/date-select-screen'
import { DoneScreen } from './components/done-screen'
import { HomeScreen } from './components/home-screen'
import { StatusScreen } from './components/status-screen'
import { TypeSelectScreen } from './components/type-select-screen'
import { addMonthOffset, MAX_MONTH_OFFSET } from './domain'
import type { LeaveRequest, LeaveRequestStatus, LeaveRequestType } from './types'
import { useLeaveRequest } from './use-leave-request'

function toYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function toLeaveRequestStatus(status: MyLeaveRequestDto['status']): LeaveRequestStatus {
  if (status === 'APPROVED') return 'APPROVED'
  if (status === 'REJECTED') return 'REJECTED'
  return 'PENDING' // PENDING · INTERIM_APPROVED — 결재 진행 중은 모두 대기중으로 표시
}

function toLeaveRequest(dto: MyLeaveRequestDto): LeaveRequest {
  return {
    id: dto.id,
    status: toLeaveRequestStatus(dto.status),
    type: dto.type as LeaveRequestType,
    dates: dto.targetDates,
    reason: dto.reason,
    postApply: dto.isRetroactive,
    pendingCancellation: dto.pendingCancellation,
    requiresCancellationApproval:
      dto.status === 'INTERIM_APPROVED' || dto.status === 'APPROVED',
  }
}

export function LeaveRequestPage() {
  const balanceQuery = useGetBalance()
  const requestsQuery = useGetMyRequests()

  if (balanceQuery.isPending || requestsQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center p-5">
        <p className="text-lg text-muted-foreground">불러오는 중이에요…</p>
      </div>
    )
  }

  if (balanceQuery.isError || requestsQuery.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center">
        <p className="text-lg font-bold text-reject">연차 정보를 불러오지 못했어요</p>
        <p className="text-base text-muted-foreground">잠시 후 다시 시도해 주세요</p>
      </div>
    )
  }

  const balance = balanceQuery.data.data
  const requests = requestsQuery.data.data

  return (
    <LeaveRequestScreens
      employeeName={getSessionUser()?.name ?? ''}
      balance={Number(balance.annual.remaining)}
      subBalance={Number(balance.substituteHoliday.remaining)}
      requests={requests.map(toLeaveRequest)}
    />
  )
}

function LeaveRequestScreens({
  employeeName,
  balance,
  subBalance,
  requests,
}: {
  employeeName: string
  balance: number
  subBalance: number
  requests: LeaveRequest[]
}) {
  const { state, submitting, cancelingId, actions } = useLeaveRequest()

  const now = new Date()
  const { year, month } = addMonthOffset(state.baseYear, state.baseMonth, state.monthOffset)
  const todayOfMonth = state.monthOffset === 0 ? now.getDate() : 0 // 기준 달을 보는 중이 아니면 "지난 날" 개념이 없음
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstWeekday = new Date(year, month - 1, 1).getDay()

  const rosterStatusQuery = useGetRosterStatus(
    { yearMonth: toYearMonth(year, month) },
    { query: { enabled: state.screen === 'step1' } },
  )
  const rosterStatus =
    state.screen !== 'step1'
      ? 'unknown'
      : rosterStatusQuery.isPending
        ? 'loading'
        : rosterStatusQuery.isError
          ? 'unknown' // 조회 실패 시 막지 않고 제출 시점 서버 검증에 맡긴다
          : rosterStatusQuery.data.data.exists
            ? 'exists'
            : 'missing'

  switch (state.screen) {
    case 'home':
      return (
        <HomeScreen
          employeeName={employeeName}
          balance={balance}
          subBalance={subBalance}
          recentRequests={requests.slice(0, 2)}
          onStartApply={actions.startApply}
          onGoStatus={actions.goStatus}
        />
      )
    case 'step1':
      return (
        <DateSelectScreen
          year={year}
          month={month}
          todayOfMonth={todayOfMonth}
          daysInMonth={daysInMonth}
          firstWeekday={firstWeekday}
          selectedDays={state.selectedDays}
          requests={requests}
          blockedMessage={state.blockedMessage}
          rosterStatus={rosterStatus}
          canGoPrevMonth={state.monthOffset > 0}
          canGoNextMonth={state.monthOffset < MAX_MONTH_OFFSET}
          onBack={actions.goHome}
          onToggleDay={actions.toggleDay}
          onBlockedDay={actions.showBlockedMessage}
          onPrevMonth={actions.prevMonth}
          onNextMonth={actions.nextMonth}
          onNext={actions.step1Next}
        />
      )
    case 'step2':
      return (
        <TypeSelectScreen
          selectedDayCount={state.selectedDays.length}
          balance={balance}
          subBalance={subBalance}
          onBack={actions.goStep1}
          onPick={actions.pickType}
        />
      )
    case 'step3':
      if (!state.selectedType) return null
      return (
        <ConfirmScreen
          type={state.selectedType}
          selectedDays={state.selectedDays}
          year={year}
          month={month}
          todayOfMonth={todayOfMonth}
          balance={balance}
          subBalance={subBalance}
          submitting={submitting}
          submitError={state.submitError}
          onBack={actions.goStep1}
          onSubmit={actions.submit}
        />
      )
    case 'done':
      return <DoneScreen onGoStatus={actions.goStatus} onGoHome={actions.goHome} />
    case 'status':
      return (
        <StatusScreen
          requests={requests}
          cancelingId={cancelingId}
          cancelMessage={state.cancelMessage}
          onBack={actions.goHome}
          onCancel={actions.cancelRequest}
        />
      )
  }
}
