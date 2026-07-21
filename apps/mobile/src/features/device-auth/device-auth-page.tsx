import { CodeEntryScreen } from './components/code-entry-screen'
import { WelcomeScreen } from './components/welcome-screen'
import { useDeviceAuth } from './use-device-auth'

export function DeviceAuthPage({ onStart }: { onStart: () => void }) {
  const { state, actions } = useDeviceAuth()

  if (state.screen === 'welcome') {
    return <WelcomeScreen onStart={onStart} />
  }

  return (
    <CodeEntryScreen
      code={state.code}
      error={state.error}
      onChangeCode={actions.changeCode}
      onSubmit={actions.submit}
    />
  )
}
