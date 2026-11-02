import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { QUIET_ZONE_MODULES, qrMatrix } from "../src/features/qr/qr-matrix"

const WIDTH = 640
const HEIGHT = 480
const DIR = join(import.meta.dirname, ".fake-camera")

/**
 * Writes a Y4M video of a QR code (encoded by the app's own encoder) for
 * Chromium's fake camera (`--use-file-for-fake-video-capture`). Grey
 * background, white label, black modules, like a label on a shelf. Returns the
 * file path. Only luminance carries the picture; chroma is neutral.
 */
export function qrVideo(name: string, text: string): string {
  const { size, path } = qrMatrix(text)
  const module = 8
  const full = (size + QUIET_ZONE_MODULES * 2) * module
  const left = Math.floor((WIDTH - full) / 2)
  const top = Math.floor((HEIGHT - full) / 2)

  const luma = Buffer.alloc(WIDTH * HEIGHT, 150)
  for (let y = 0; y < full; y++) luma.fill(255, (top + y) * WIDTH + left, (top + y) * WIDTH + left + full)
  for (const [, col, row] of path.matchAll(/M(\d+) (\d+)/g)) {
    const x0 = left + (Number(col) + QUIET_ZONE_MODULES) * module
    const y0 = top + (Number(row) + QUIET_ZONE_MODULES) * module
    for (let y = 0; y < module; y++) luma.fill(0, (y0 + y) * WIDTH + x0, (y0 + y) * WIDTH + x0 + module)
  }
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2) * 2, 128)
  const frame = Buffer.concat([Buffer.from("FRAME\n"), luma, chroma])

  mkdirSync(DIR, { recursive: true })
  const file = join(DIR, `${name}.y4m`)
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F10:1 Ip A1:1 C420jpeg\n`)
  writeFileSync(file, Buffer.concat([header, frame, frame, frame, frame, frame]))
  return file
}

/** Chromium flags for a fake camera playing `file`, with the permission prompt auto-accepted. */
export function fakeCameraArgs(file: string, { acceptPrompt = true } = {}): string[] {
  return [
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${file}`,
    ...(acceptPrompt ? ["--use-fake-ui-for-media-stream"] : []),
  ]
}
