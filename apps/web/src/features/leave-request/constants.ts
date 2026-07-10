import type { LeaveType, RequestStatus } from './types'

export const TYPE_META: Record<
  LeaveType,
  { name: string; title: string; sub: string; icon: string }
> = {
  ANNUAL: {
    name: '연차',
    title: '하루 종일 쉬기',
    sub: '연차 (하루 사용)',
    icon: '☀️',
  },
  HALF_AM: {
    name: '오전반차',
    title: '오전만 쉬기',
    sub: '오전 반차 (반나절 사용)',
    icon: '🌤️',
  },
  HALF_PM: {
    name: '오후반차',
    title: '오후만 쉬기',
    sub: '오후 반차 (반나절 사용)',
    icon: '🌇',
  },
  SUBSTITUTE: {
    name: '휴일대체',
    title: '휴일대체로 쉬기',
    sub: '유급휴일대체 (하루 사용)',
    icon: '🎁',
  },
}

export const STATUS_TEXT: Record<RequestStatus, string> = {
  PENDING: '대기중',
  APPROVED: '승인됨',
  REJECTED: '반려됨',
}
