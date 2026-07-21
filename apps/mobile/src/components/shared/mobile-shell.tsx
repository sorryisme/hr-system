import { Outlet } from '@tanstack/react-router'

// 로그인(기기 등록) 여부에 따른 접근 제어는 각 라우트의 beforeLoad(requireAuth/
// redirectIfAuthenticated — features/auth/session.ts)가 담당한다(C-13/N-10).
export function MobileShell() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
      <Outlet />
    </div>
  )
}
