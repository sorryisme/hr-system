import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isCompleteCode } from '../domain'

export function CodeEntryScreen({
  code,
  error,
  onChangeCode,
  onSubmit,
}: {
  code: string
  error: string | null
  onChangeCode: (code: string) => void
  onSubmit: () => void
}) {
  const complete = isCompleteCode(code)

  return (
    <div className="flex flex-1 flex-col gap-1 p-5">
      <div className="mt-10 flex flex-col items-center text-center">
        <div className="flex size-20 items-center justify-center rounded-3xl bg-primary/10">
          <KeyRound className="size-10 text-primary" />
        </div>
        <h1 className="mt-6 text-3xl font-black">기기 등록</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
          시설에서 받은 등록 코드 6자리를
          <br />
          입력해주세요
        </p>
        <p className="mt-1 text-base text-muted-foreground">
          한 번만 등록하면 다음부터는 자동으로 열려요
        </p>
      </div>

      <Input
        value={code}
        onChange={(e) => onChangeCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && complete) onSubmit()
        }}
        inputMode="numeric"
        autoFocus
        placeholder="000000"
        aria-label="기기 등록 코드"
        className="mt-8 h-20 rounded-3xl border-2 text-center text-4xl font-black tracking-[0.5em]"
      />

      {error ? (
        <div className="mt-3 rounded-2xl bg-reject/10 px-4 py-3 text-center text-base font-bold text-reject">
          {error}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-2.5 pt-6">
        <Button
          onClick={onSubmit}
          disabled={!complete}
          className="h-auto w-full rounded-3xl bg-primary py-6 text-xl font-black text-primary-foreground shadow-lg hover:bg-primary/90"
        >
          등록하기
        </Button>
        <p className="text-center text-base text-muted-foreground">
          코드를 모르시면 관리자에게 문의해주세요
        </p>
      </div>
    </div>
  )
}
