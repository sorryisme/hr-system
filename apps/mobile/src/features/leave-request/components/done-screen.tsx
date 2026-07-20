import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DoneScreen({
  onGoStatus,
  onGoHome,
}: {
  onGoStatus: () => void
  onGoHome: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 bg-primary px-8 text-center">
      <div className="flex size-32 animate-in items-center justify-center rounded-full bg-white/15 zoom-in-50 duration-500">
        <Check className="size-16 text-primary-foreground" strokeWidth={3} />
      </div>
      <p className="mt-8 animate-in text-3xl font-black text-primary-foreground fade-in slide-in-from-bottom-2 delay-150 duration-500 fill-mode-both">
        신청 완료!
      </p>
      <p className="mt-3.5 animate-in text-xl leading-relaxed text-primary-foreground/90 fade-in slide-in-from-bottom-2 delay-300 duration-500 fill-mode-both">
        승인되면 바로 알려드릴게요.
        <br />
        편히 계세요 :)
      </p>
      <Button
        onClick={onGoStatus}
        className="mt-11 h-auto animate-in rounded-2xl bg-white px-10 py-5 text-xl font-black text-primary fade-in slide-in-from-bottom-2 delay-500 duration-500 fill-mode-both hover:bg-white/90"
      >
        내 신청 보기
      </Button>
      <Button
        variant="link"
        onClick={onGoHome}
        className="mt-3.5 h-auto animate-in text-lg font-bold text-primary-foreground/85 fade-in slide-in-from-bottom-2 delay-700 duration-500 fill-mode-both"
      >
        홈으로
      </Button>
    </div>
  )
}
