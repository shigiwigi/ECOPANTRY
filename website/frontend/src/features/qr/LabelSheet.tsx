import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { formatCode, labelPayload } from "./batch-label"
import { formatCalendarDate } from "./dates"
import { QrCode } from "./QrCode"

export interface LabelData {
  code: string
  ingredientName: string
  /** ISO date (YYYY-MM-DD), or null when no expiry is recorded. */
  expiresOn: string | null
}

/**
 * One batch label, 63.5 × 38.1 mm: the size of common 21-per-sheet A4 label
 * paper (3 × 7). The QR code is 30 mm including its quiet zone, about 0.9 mm per
 * module, which phone cameras read comfortably from 10–30 cm. Text is the
 * ingredient, the batch code (for typing in if the QR is damaged) and the
 * use-by date. Nothing else: no quantities, suppliers or people.
 */
export function BatchLabel({ label, guides }: { label: LabelData; guides: boolean }) {
  const longName = label.ingredientName.length > 22
  return (
    <div
      className={cn(
        "flex h-[38.1mm] w-[63.5mm] items-center gap-[2mm] overflow-hidden bg-label-paper p-[2.5mm] leading-tight text-label-ink [break-inside:avoid] [print-color-adjust:exact]",
        guides && "border border-dashed border-label-ink/35",
      )}
    >
      <QrCode
        value={labelPayload(label.code)}
        label={`QR code for batch ${formatCode(label.code)}`}
        className="size-[30mm] shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[6pt] font-semibold tracking-[0.08em] uppercase">EcoPantry batch</p>
        <p className={cn("mt-[0.8mm] font-bold break-words", longName ? "line-clamp-3 text-[8pt]" : "line-clamp-2 text-[10pt]")}>
          {label.ingredientName}
        </p>
        <p className="mt-[1.5mm] text-[6pt] tracking-[0.06em] uppercase">Batch</p>
        <p className="font-mono text-[8.5pt] font-semibold whitespace-nowrap">{formatCode(label.code)}</p>
        {label.expiresOn && (
          <>
            <p className="mt-[1mm] text-[6pt] tracking-[0.06em] uppercase">Use by</p>
            <p className="text-[9pt] font-bold whitespace-nowrap">{formatCalendarDate(label.expiresOn)}</p>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The labels as they will print, rendered straight into <body> and hidden on
 * screen. While it exists, printing shows only this sheet (see `.print-sheet`
 * in globals.css), so the portal navigation, header and page never print.
 */
export function PrintSheet({ labels, guides }: { labels: LabelData[]; guides: boolean }) {
  if (labels.length === 0) return null
  return createPortal(
    <div className="print-sheet" aria-hidden>
      <div className="grid grid-cols-[repeat(3,63.5mm)] gap-x-[2.5mm]">
        {labels.map((label, index) => (
          <BatchLabel key={index} label={label} guides={guides} />
        ))}
      </div>
    </div>,
    document.body,
  )
}
