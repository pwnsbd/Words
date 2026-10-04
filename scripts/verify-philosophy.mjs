import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import electron from 'electron'
await build({ entryPoints: ['scripts/verify-philosophy.ts'], outfile: 'out/main/verify-philosophy.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external' })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['out/main/verify-philosophy.mjs'], { stdio: 'inherit', env, windowsHide: true })
child.on('error', error => { console.error(error); process.exit(1) })
child.on('exit', code => process.exit(code ?? 1))
