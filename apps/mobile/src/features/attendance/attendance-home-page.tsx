import { AttendanceButtonScreen } from './components/attendance-button-screen'
import { AttendanceResultScreen } from './components/attendance-result-screen'
import { useAttendance } from './use-attendance'

export function AttendanceHomePage() {
  const {
    today,
    isLoadingToday,
    isErrorToday,
    isTagging,
    isClockedIn,
    result,
    handleTag,
    dismissResult,
  } = useAttendance()

  if (isLoadingToday) {
    return (
      <div className="flex flex-1 items-center justify-center p-5">
        <p className="text-lg text-muted-foreground">불러오는 중이에요…</p>
      </div>
    )
  }

  if (isErrorToday) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center">
        <p className="text-lg font-bold text-reject">출퇴근 정보를 불러오지 못했어요</p>
        <p className="text-base text-muted-foreground">잠시 후 다시 시도해 주세요</p>
      </div>
    )
  }

  if (result) {
    return (
      <AttendanceResultScreen
        result={result}
        adminCallPhone={today?.adminCallPhone}
        onConfirm={dismissResult}
      />
    )
  }

  return (
    <AttendanceButtonScreen
      today={today}
      isClockedIn={isClockedIn}
      isTagging={isTagging}
      onTag={handleTag}
    />
  )
}
