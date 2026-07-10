export type LeaveType = 'ANNUAL' | 'HALF_AM' | 'HALF_PM' | 'SUBSTITUTE'

export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface LeaveRequestItem {
  id: string
  status: RequestStatus
  type: LeaveType
  days: number[]
  reason: string | null
  postApply: boolean
}

export type WizardScreen = 'home' | 'step1' | 'step2' | 'step3' | 'done' | 'status'
