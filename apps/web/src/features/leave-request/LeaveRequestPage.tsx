import { useState } from 'react'

import { ConfirmScreen } from './components/ConfirmScreen'
import { DateSelectScreen } from './components/DateSelectScreen'
import { DoneScreen } from './components/DoneScreen'
import { HomeScreen } from './components/HomeScreen'
import { StatusScreen } from './components/StatusScreen'
import { TypeSelectScreen } from './components/TypeSelectScreen'
import { MOCK_INITIAL_BALANCE, MOCK_INITIAL_REQUESTS, MOCK_INITIAL_SUB_BALANCE, MOCK_USER } from './mock-data'
import type { LeaveRequestItem, LeaveType, WizardScreen } from './types'
import { deductAmount } from './utils'

const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth()
const TODAY = now.getDate()

export function LeaveRequestPage() {
  const [screen, setScreen] = useState<WizardScreen>('home')
  const [selectedDays, setSelectedDays] = useState<number[]>([])
  const [selectedType, setSelectedType] = useState<LeaveType | null>(null)
  const [balance, setBalance] = useState(MOCK_INITIAL_BALANCE)
  const [subBalance, setSubBalance] = useState(MOCK_INITIAL_SUB_BALANCE)
  const [requests, setRequests] = useState<LeaveRequestItem[]>(MOCK_INITIAL_REQUESTS)

  function resetFlow() {
    setSelectedDays([])
    setSelectedType(null)
  }

  function handleToggleDay(day: number) {
    setSelectedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  function handlePickType(type: LeaveType) {
    setSelectedType(type)
    setScreen('step3')
  }

  function handleSubmit() {
    if (!selectedType) return
    const days = [...selectedDays].sort((a, b) => a - b)
    const isPastApply = days.some((d) => d < TODAY)

    setRequests((prev) => [
      {
        id: crypto.randomUUID(),
        status: 'PENDING',
        type: selectedType,
        days,
        reason: null,
        postApply: isPastApply,
      },
      ...prev,
    ])

    if (selectedType === 'SUBSTITUTE') {
      setSubBalance((prev) => prev - 1)
    } else {
      setBalance((prev) => +(prev - deductAmount(selectedType, days.length)).toFixed(1))
    }

    setScreen('done')
  }

  function handleCancel(id: string) {
    const req = requests.find((r) => r.id === id)
    if (!req || req.status !== 'PENDING') return

    setRequests((prev) => prev.filter((r) => r.id !== id))
    if (req.type === 'SUBSTITUTE') {
      setSubBalance((prev) => prev + 1)
    } else {
      setBalance((prev) => +(prev + deductAmount(req.type, req.days.length)).toFixed(1))
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-care-cream px-5 py-8">
      {screen === 'home' && (
        <HomeScreen
          userName={MOCK_USER.name}
          balance={balance}
          subBalance={subBalance}
          requests={requests}
          month={MONTH + 1}
          onStartApply={() => {
            resetFlow()
            setScreen('step1')
          }}
          onGoStatus={() => setScreen('status')}
        />
      )}

      {screen === 'step1' && (
        <DateSelectScreen
          year={YEAR}
          month={MONTH}
          today={TODAY}
          selectedDays={selectedDays}
          requests={requests}
          onToggleDay={handleToggleDay}
          onBack={() => setScreen('home')}
          onNext={() => selectedDays.length > 0 && setScreen('step2')}
        />
      )}

      {screen === 'step2' && (
        <TypeSelectScreen
          selectedDays={selectedDays}
          balance={balance}
          subBalance={subBalance}
          onBack={() => setScreen('step1')}
          onPick={handlePickType}
        />
      )}

      {screen === 'step3' && selectedType && (
        <ConfirmScreen
          selectedDays={selectedDays}
          selectedType={selectedType}
          month={MONTH + 1}
          today={TODAY}
          hour={now.getHours()}
          balance={balance}
          subBalance={subBalance}
          onSubmit={handleSubmit}
          onEdit={() => setScreen('step1')}
        />
      )}

      {screen === 'done' && (
        <DoneScreen onGoStatus={() => setScreen('status')} onGoHome={() => setScreen('home')} />
      )}

      {screen === 'status' && (
        <StatusScreen
          requests={requests}
          month={MONTH + 1}
          onBack={() => setScreen('home')}
          onCancel={handleCancel}
        />
      )}
    </div>
  )
}
