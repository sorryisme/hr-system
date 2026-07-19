import { createFileRoute, redirect } from '@tanstack/react-router'

// 앱 홈 = 대시보드. 미로그인이면 /dashboard의 requireAuth가 /login으로 보낸다
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' })
  },
})
