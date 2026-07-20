import { ConfirmScreen } from './components/confirm-screen'
import { DateSelectScreen } from './components/date-select-screen'
import { DoneScreen } from './components/done-screen'
import { HomeScreen } from './components/home-screen'
import { StatusScreen } from './components/status-screen'
import { TypeSelectScreen } from './components/type-select-screen'
import { useLeaveRequest } from './use-leave-request'

export function LeaveRequestPage() {
  const { state, actions } = useLeaveRequest()

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1 // 표시용 1-indexed
  const todayOfMonth = now.getDate()
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstWeekday = new Date(year, month - 1, 1).getDay()

  switch (state.screen) {
    case 'home':
      return (
        <HomeScreen
          balance={state.balance}
          subBalance={state.subBalance}
          recentRequests={state.requests.slice(0, 2)}
          month={month}
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
          requests={state.requests}
          blockedMessage={state.blockedMessage}
          onBack={actions.goHome}
          onToggleDay={actions.toggleDay}
          onBlockedDay={actions.showBlockedMessage}
          onNext={actions.step1Next}
        />
      )
    case 'step2':
      return (
        <TypeSelectScreen
          selectedDayCount={state.selectedDays.length}
          balance={state.balance}
          subBalance={state.subBalance}
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
          month={month}
          todayOfMonth={todayOfMonth}
          balance={state.balance}
          subBalance={state.subBalance}
          onBack={actions.goStep1}
          onSubmit={actions.submit}
        />
      )
    case 'done':
      return <DoneScreen onGoStatus={actions.goStatus} onGoHome={actions.goHome} />
    case 'status':
      return (
        <StatusScreen
          requests={state.requests}
          month={month}
          onBack={actions.goHome}
          onCancel={actions.cancelRequest}
        />
      )
  }
}
