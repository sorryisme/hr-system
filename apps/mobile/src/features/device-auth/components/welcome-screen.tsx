import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MOCK_EMPLOYEE_NAME } from '../mock-data'

export function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 bg-primary px-8 text-center">
      <div className="flex size-32 animate-in items-center justify-center rounded-full bg-white/15 zoom-in-50 duration-500">
        <Check className="size-16 text-primary-foreground" strokeWidth={3} />
      </div>
      <p className="mt-8 animate-in text-3xl font-black text-primary-foreground fade-in slide-in-from-bottom-2 delay-150 duration-500 fill-mode-both">
        등록 완료!
      </p>
      <p className="mt-3.5 animate-in text-xl leading-relaxed text-primary-foreground/90 fade-in slide-in-from-bottom-2 delay-300 duration-500 fill-mode-both">
        {MOCK_EMPLOYEE_NAME}, 반가워요.
        <br />
        다음부터는 앱만 열면 바로 들어와요.
      </p>
      <Button
        onClick={onStart}
        className="mt-11 h-auto animate-in rounded-2xl bg-white px-10 py-5 text-xl font-black text-primary fade-in slide-in-from-bottom-2 delay-500 duration-500 fill-mode-both hover:bg-white/90"
      >
        시작하기
      </Button>
    </div>
  )
}
