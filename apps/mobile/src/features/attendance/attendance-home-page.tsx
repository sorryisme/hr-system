import { getSessionUser } from '@/features/auth/session'

// 출퇴근 기능(GPS 태그) 구현 전까지의 홈 탭 자리표시자.
export function AttendanceHomePage() {
  const employeeName = getSessionUser()?.name ?? ''

  return (
    <div className="flex flex-1 flex-col gap-6 p-5">
      <div>
        <p className="text-lg text-muted-foreground">안녕하세요,</p>
        <p className="text-3xl font-black">{employeeName}</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-xl font-bold">출퇴근 기능을 준비하고 있어요</p>
        <p className="text-base text-muted-foreground">
          곧 이 화면에서 출근·퇴근을 태그할 수 있어요
        </p>
      </div>
    </div>
  )
}
