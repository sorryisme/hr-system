import { useQueryClient } from '@tanstack/react-query'
import { getGetRosterQueryKey, useListShiftTypes, useUpdateEntries } from '@/api/generated/endpoints'
import { ApiError } from '@/api/mutator'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { CATEGORY_CHIP_CLASS, shiftCategory } from './labels'

export interface CellSelection {
  employeeId: string
  workDate: string
}

interface Props {
  rosterId: string
  anchor: HTMLElement | null
  cells: CellSelection[]
  onClose: () => void
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return '적용에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

/**
 * 셀 편집 팝오버(§4.8) — 셀 클릭/드래그로 선택한 칸에 근무유형을 일괄 적용.
 * 프리셋 적용과 달리 셀 보호 원칙 없이 항상 덮어쓴다(관리자의 명시적 직접 입력).
 */
export function CellEditPopover({ rosterId, anchor, cells, onClose }: Props) {
  const queryClient = useQueryClient()
  const open = cells.length > 0 && anchor !== null

  const shiftTypesQuery = useListShiftTypes({ query: { enabled: open } })
  const shiftTypes = shiftTypesQuery.data?.data ?? []

  const updateMut = useUpdateEntries({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getGetRosterQueryKey() })
        onClose()
      },
    },
  })

  const apply = (shiftCode: string) => {
    updateMut.mutate({
      id: rosterId,
      data: {
        entries: cells.map((c) => ({
          employeeId: c.employeeId,
          workDate: c.workDate,
          shiftCode,
        })),
      },
    })
  }

  return (
    <Popover open={open} onOpenChange={(next) => !next && onClose()}>
      <PopoverContent anchor={anchor} align="start" className="w-48 p-1.5">
        <div className="px-1.5 pb-1 text-xs font-semibold text-muted-foreground">
          근무유형 선택{cells.length > 1 ? ` · ${cells.length}칸` : ''}
        </div>

        {shiftTypesQuery.isSuccess && shiftTypes.length === 0 && (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">등록된 근무유형이 없습니다.</p>
        )}

        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {shiftTypes.map((s) => {
            const category = shiftCategory(s.code)
            return (
              <button
                key={s.code}
                type="button"
                disabled={updateMut.isPending}
                onClick={() => apply(s.code)}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent disabled:opacity-50"
              >
                <span
                  className={cn(
                    'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-bold',
                    CATEGORY_CHIP_CLASS[category],
                  )}
                >
                  {s.cellLabel ?? s.code}
                </span>
                <span className="text-foreground">{s.label}</span>
              </button>
            )
          })}
        </div>

        {updateMut.isError && (
          <p className="px-1.5 pt-1 text-xs text-reject">{errorMessage(updateMut.error)}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
