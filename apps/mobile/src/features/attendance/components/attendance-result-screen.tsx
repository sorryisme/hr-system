import { Phone } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TagResult } from '../types'

/** 태그 성공: 전체화면 초록 + 완료 문구. 실패: 원인 문구 + 관리자 호출 버튼(C-11) */
export function AttendanceResultScreen({
  result,
  adminCallPhone,
  onConfirm,
}: {
  result: TagResult
  adminCallPhone: string | null | undefined
  onConfirm: () => void
}) {
  const isSuccess = result.kind === 'success'

  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center',
        isSuccess ? 'bg-approve text-approve-foreground' : 'bg-reject text-reject-foreground',
      )}
    >
      {isSuccess ? (
        <p className="text-3xl font-black">
          {result.label} · {result.time}
        </p>
      ) : (
        <>
          <p className="text-2xl font-black">태그에 실패했어요</p>
          <p className="text-lg font-medium">{result.message}</p>
        </>
      )}

      <div className="mt-8 flex w-full flex-col gap-3">
        {!isSuccess && adminCallPhone && (
          <a
            href={`tel:${adminCallPhone}`}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'lg' }),
              'h-auto gap-2 rounded-3xl py-4 text-lg font-bold',
            )}
          >
            <Phone className="size-5" />
            관리자에게 전화하기
          </a>
        )}
        <Button
          onClick={onConfirm}
          size="lg"
          variant="secondary"
          className="h-auto rounded-3xl bg-background py-4 text-lg font-bold text-foreground hover:bg-background/90"
        >
          확인
        </Button>
      </div>
    </div>
  )
}
