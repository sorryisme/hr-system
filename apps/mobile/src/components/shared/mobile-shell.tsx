import { Outlet, useRouterState } from '@tanstack/react-router'
import { BottomNav } from './bottom-nav'

// 로그인(기기 등록) 여부에 따른 접근 제어는 각 라우트의 beforeLoad(requireAuth/
// redirectIfAuthenticated — features/auth/session.ts)가 담당한다(C-13/N-10).
// 하단 탭바는 로그인 화면에서는 숨긴다.
export function MobileShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const showNav = pathname !== '/login'

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-background">
      <main className="flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      {showNav && <BottomNav />}
    </div>
  )
}
