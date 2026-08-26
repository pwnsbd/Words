// One-off icon generation script — not part of the app's runtime. Run once
// to produce resources/icon.ico (Windows) and resources/icon.png from the
// hand-drawn SVG source. sharp/png-to-ico are dev-only, installed
// temporarily just for this.
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const svgPath = join(__dirname, '..', 'resources', 'icon.svg')
const outDir = join(__dirname, '..', 'resources')

async function main() {
  await mkdir(outDir, { recursive: true })

  // Windows .ico wants a handful of sizes bundled together.
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngBuffers = await Promise.all(
    sizes.map((size) => sharp(svgPath).resize(size, size).png().toBuffer())
  )

  // Also keep a standalone 256px PNG (used for the BrowserWindow icon in dev).
  await writeFile(join(outDir, 'icon.png'), pngBuffers[pngBuffers.length - 1])

  const icoBuffer = await pngToIco(pngBuffers)
  await writeFile(join(outDir, 'icon.ico'), icoBuffer)

  console.log('wrote resources/icon.png and resources/icon.ico')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
