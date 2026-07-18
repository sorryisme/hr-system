import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** 반려 인라인 폼 — 사유 필수(US-04). 빈 사유는 제출 버튼 비활성으로 차단 */
export function RejectForm({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean
  onCancel: () => void
  onConfirm: (comment: string) => void
}) {
  const [comment, setComment] = useState('')

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-sm font-bold text-reject">반려 사유 (필수 입력)</Label>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="반려 사유를 입력하세요"
        maxLength={500}
        className="min-h-20 border-reject/40 bg-reject/5"
      />
      <div className="flex gap-2.5">
        <Button variant="outline" className="h-11 flex-1" onClick={onCancel} disabled={pending}>
          취소
        </Button>
        <Button
          className="h-11 flex-1 bg-reject text-reject-foreground hover:bg-reject/90"
          disabled={pending || comment.trim().length === 0}
          onClick={() => onConfirm(comment.trim())}
        >
          반려 확정
        </Button>
      </div>
    </div>
  )
}
