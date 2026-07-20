import { Outlet } from '@tanstack/react-router'

export function MobileShell() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
      <Outlet />
    </div>
  )
}
