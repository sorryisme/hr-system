import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import {
  BONUS_SCORE,
  LEAVE_EXPIRY_ROWS,
  PENDING_APPROVAL_COUNT,
  SHIFT_COUNTS,
  STAFFING_ROWS,
  VIOLATIONS,
  VIOLATION_ALERT,
} from './mock-data'
import { StatusBadge } from './status-badge'

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>① 인력충족 현황</CardTitle>
            <CardDescription>이번 달, 직군별 환산 인원 대비 법정 기준</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {STAFFING_ROWS.map((row) => (
                <div key={row.role} className="flex items-center justify-between text-sm">
                  <span>{row.role}</span>
                  <StatusBadge tone={row.tone}>{row.label}</StatusBadge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>② 오늘 주/야 근무자</CardTitle>
            <CardDescription>실 배치 vs 설정 기준</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              <div>
                <div className="text-xs text-muted-foreground">주간</div>
                <div className="font-heading text-3xl font-bold">
                  {SHIFT_COUNTS.day.actual}
                  <span className="text-sm font-medium text-muted-foreground">
                    {' '}
                    / {SHIFT_COUNTS.day.standard} 기준
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">야간</div>
                <div className="font-heading text-3xl font-bold text-destructive">
                  {SHIFT_COUNTS.night.actual}
                  <span className="text-sm font-medium text-muted-foreground">
                    {' '}
                    / {SHIFT_COUNTS.night.standard} 기준
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>③ 미결재 신청</CardTitle>
            <CardDescription>결재함 대기 건</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-heading text-3xl font-bold">
              {PENDING_APPROVAL_COUNT}
              <span className="text-sm font-medium text-muted-foreground">건</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>④ 가산 점수</CardTitle>
            <CardDescription>예상 점수 vs 목표 점수</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={BONUS_SCORE.value}>
              <ProgressLabel>{BONUS_SCORE.label}</ProgressLabel>
              <ProgressValue />
            </Progress>
            <div className="mt-2 text-xs text-muted-foreground">
              예상 {BONUS_SCORE.expected}점 / 목표 {BONUS_SCORE.target}점
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>⑤ 고시기준 위반 경고</CardTitle>
            <CardDescription>근무표 편집기에서 확인</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1.5">
              {VIOLATIONS.map((violation) => (
                <StatusBadge key={violation.label} tone={violation.tone}>
                  {violation.label}
                </StatusBadge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>⑥ 연차 소멸 임박자</CardTitle>
            <CardDescription>입사일 기준 60일/30일 규칙</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1.5">
              {LEAVE_EXPIRY_ROWS.map((row) => (
                <div key={row.name} className="flex items-center justify-between text-sm">
                  <span>
                    {row.name} · 잔여 {row.remainingDays}일
                  </span>
                  <StatusBadge tone={row.tone}>{row.label}</StatusBadge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Alert className="border-warning/30 bg-warning/10">
        <AlertTitle className="text-warning">{VIOLATION_ALERT.title}</AlertTitle>
        <AlertDescription className="text-warning/90">
          {VIOLATION_ALERT.description}
        </AlertDescription>
      </Alert>
    </div>
  )
}
