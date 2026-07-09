import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomeComponent,
})

function HomeComponent() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <h1 className="text-2xl font-medium text-foreground">Care</h1>
    </div>
  )
}
