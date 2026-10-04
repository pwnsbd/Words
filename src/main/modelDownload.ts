// Automatic download of the two default local models, so installing the
// app doesn't require separately hunting down and placing multi-gigabyte
// GGUF files by hand -- this fetches the exact same two files the README
// already points people at, just from inside the app instead of manually.
//
// Entirely non-blocking and entirely optional: the app already works fine
// without model files (an entry just saves without a reflection/embedding
// -- see llamacpp.ts), and that stays true here too. This only automates
// *getting* the files; it never gates anything on them being present.
//
// Uses Node's built-in https/fs rather than a new dependency -- this is a
// plain streamed download to a ".part" file, renamed into place only once
// it's actually complete, so a half-finished download (network drop, app
// closed mid-download) is never mistaken for a real, usable model file.

import { createWriteStream, existsSync } from 'fs'
import { mkdir, rename } from 'fs/promises'
import { join } from 'path'
import https from 'https'
import type { IncomingMessage } from 'http'
import type { ModelKey, DownloadProgress } from '../shared/types'

export type { DownloadProgress }

interface DefaultModel {
  key: ModelKey
  url: string
  // Used for a sane progress percentage on the (common) chance a redirect
  // or CDN response omits Content-Length -- not load-bearing otherwise.
  approxBytes: number
}

// Same two files the README recommends -- automating the download doesn't
// change the model choice, just who fetches the file.
const DEFAULT_MODELS: DefaultModel[] = [
  {
    key: 'reflection',
    url: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    approxBytes: 4_920_000_000
  },
  {
    key: 'embedding',
    url: 'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf',
    approxBytes: 639_150_592
  }
]

function followRedirects(
  url: string,
  onResponse: (res: IncomingMessage) => void,
  onError: (err: Error) => void,
  redirectsLeft = 5
): void {
  https
    .get(url, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume() // drain so the socket can be reused/closed cleanly
        if (redirectsLeft <= 0) {
          onError(new Error('too many redirects'))
          return
        }
        followRedirects(res.headers.location, onResponse, onError, redirectsLeft - 1)
        return
      }
      if (status !== 200) {
        res.resume()
        onError(new Error(`unexpected response ${status}`))
        return
      }
      onResponse(res)
    })
    .on('error', onError)
}

async function downloadOne(
  url: string,
  key: ModelKey,
  approxBytes: number,
  destPath: string,
  onProgress: (p: DownloadProgress) => void
): Promise<void> {
  const partialPath = `${destPath}.part`
  await mkdir(join(destPath, '..'), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    followRedirects(
      url,
      (res) => {
        const totalBytes = Number(res.headers['content-length']) || approxBytes
        let receivedBytes = 0
        const file = createWriteStream(partialPath)
        res.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length
          onProgress({ key, receivedBytes, totalBytes, done: false })
        })
        res.on('error', reject)
        file.on('error', reject)
        file.on('finish', () => file.close(() => resolve()))
        res.pipe(file)
      },
      reject
    )
  })

  await rename(partialPath, destPath)
}

// Downloads whichever of the two default models is missing under the
// filenames the app is actually configured to look for (respects
// WORDS_REFLECTION_MODEL_FILE/WORDS_EMBEDDING_MODEL_FILE, same as
// everywhere else). Downloads one at a time, not in parallel -- simpler
// progress reporting and doesn't split one connection's bandwidth in half
// for no benefit. Never throws: a failed download is reported through
// onProgress (done: true, error set) so the app keeps working exactly as
// it does today without that model, same as a missing file always has.
export async function downloadMissingModels(
  modelsDir: string,
  reflectionFilename: string,
  embeddingFilename: string,
  onProgress: (p: DownloadProgress) => void
): Promise<void> {
  for (const model of DEFAULT_MODELS) {
    // Custom filenames are supplied by the developer, never filled with a default model.
    if (model.key === 'reflection' && process.env.WORDS_REFLECTION_MODEL_FILE) continue
    if (model.key === 'embedding' && process.env.WORDS_EMBEDDING_MODEL_FILE) continue
    const filename = model.key === 'reflection' ? reflectionFilename : embeddingFilename
    const destPath = join(modelsDir, filename)
    if (existsSync(destPath)) continue
    try {
      await downloadOne(model.url, model.key, model.approxBytes, destPath, onProgress)
      onProgress({ key: model.key, receivedBytes: model.approxBytes, totalBytes: model.approxBytes, done: true })
    } catch (err) {
      onProgress({
        key: model.key,
        receivedBytes: 0,
        totalBytes: model.approxBytes,
        done: true,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
}
