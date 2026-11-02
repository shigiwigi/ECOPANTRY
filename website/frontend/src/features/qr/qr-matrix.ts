import qrcode from "qrcode-generator"

/** The QR specification asks for a light margin four modules wide on every side. */
export const QUIET_ZONE_MODULES = 4

export interface QrMatrix {
  size: number
  /** One SVG path for every dark module, in module units. */
  path: string
}

/**
 * Encodes `text` as a QR code. Error correction level Q survives about 25%
 * damage, which suits labels that get handled, smudged or partly covered.
 * Text that is entirely QR-alphanumeric (like batch label payloads) is encoded
 * in alphanumeric mode, which makes a smaller symbol than byte mode.
 */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, "Q")
  qr.addData(text, /^[0-9A-Z $%*+\-./:]*$/.test(text) ? "Alphanumeric" : "Byte")
  qr.make()
  const size = qr.getModuleCount()
  let path = ""
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
    }
  }
  return { size, path }
}
