import { useNavigate } from '@tanstack/react-router'
import { CodeEntryScreen } from './components/code-entry-screen'
import { WelcomeScreen } from './components/welcome-screen'
import { useDeviceAuth } from './use-device-auth'

export function DeviceAuthPage() {
  const { state, isSubmitting, actions } = useDeviceAuth()
  const navigate = useNavigate()

  if (state.screen === 'welcome') {
    return (
      <WelcomeScreen
        employeeName={state.user?.name ?? ''}
        onStart={() => navigate({ to: '/' })}
      />
    )
  }

  return (
    <CodeEntryScreen
      code={state.code}
      error={state.error}
      isSubmitting={isSubmitting}
      onChangeCode={actions.changeCode}
      onSubmit={actions.submit}
    />
  )
}
