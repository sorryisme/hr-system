import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CODE_GUIDE_ROWS } from './labels'

/** 근무 표기 안내 모달 (목업 "표기 안내 전체 확인") — 근무종류·내용·표기형식 표 */
export function CodeGuideDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="rounded-full whitespace-nowrap" />
        }
      >
        표기 안내 전체 확인
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>근무 표기 안내</DialogTitle>
          <DialogDescription>근무표에 표시되는 코드와 표기 형식입니다.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-muted-foreground">
                <th className="border-b px-2.5 py-2.5">근무종류</th>
                <th className="border-b px-2.5 py-2.5">내용</th>
                <th className="border-b px-2.5 py-2.5 whitespace-nowrap">표기형식</th>
              </tr>
            </thead>
            <tbody>
              {CODE_GUIDE_ROWS.map((row) => (
                <tr key={`${row.kind}-${row.format}`} className="align-top">
                  <td className="border-b px-2.5 py-2.5 font-medium whitespace-nowrap">
                    {row.kind}
                  </td>
                  <td className="border-b px-2.5 py-2.5 whitespace-pre-line text-muted-foreground">
                    {row.detail}
                  </td>
                  <td className="border-b px-2.5 py-2.5 font-semibold whitespace-nowrap">
                    {row.format}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
