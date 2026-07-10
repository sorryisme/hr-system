interface DoneScreenProps {
  onGoStatus: () => void
  onGoHome: () => void
}

export function DoneScreen({ onGoStatus, onGoHome }: DoneScreenProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-3xl bg-success px-8 py-16 text-center text-success-foreground">
      <div className="flex size-28 items-center justify-center rounded-full bg-success-foreground/15">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="mt-8 text-2xl font-bold">신청 완료!</div>
      <div className="mt-3.5 text-base leading-relaxed opacity-90">
        승인되면 바로 알려드릴게요.
        <br />
        편히 계세요 :)
      </div>
      <button
        type="button"
        onClick={onGoStatus}
        className="mt-9 rounded-2xl bg-success-foreground px-8 py-4 text-lg font-bold text-success"
      >
        내 신청 보기
      </button>
      <button type="button" onClick={onGoHome} className="mt-3 text-base font-bold opacity-85">
        홈으로
      </button>
    </div>
  )
}
