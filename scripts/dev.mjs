import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const app = args[0] && !args[0].startsWith('-') ? resolve(root, args.shift()) : process.cwd()
const require = createRequire(join(app, 'package.json'))
let vite
try {
  vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
} catch {
  console.error(`Install frontend dependencies first: npm --prefix "${app}" ci`)
  process.exit(1)
}

const backend = join(root, 'backend')
const venvPython = join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = process.env.PYTHON || (existsSync(venvPython) ? venvPython : 'python')
const children = []
let stopping = false

async function stop(code) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  await Promise.all(children.map(child => new Promise(done => {
    if (!child.pid) return done()
    if (process.platform === 'win32') {
      // Include Uvicorn's reloader and worker in the shutdown.
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      killer.once('error', done)
      killer.once('exit', done)
    } else {
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* Already stopped. */ }
      done()
    }
  })))
}

function start(name, command, commandArgs, cwd) {
  console.log(`[dev] Starting ${name}`)
  const child = spawn(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  })
  children.push(child)
  child.once('error', error => {
    console.error(`[dev] Could not start ${name}: ${error.message}`)
    void stop(1)
  })
  child.once('exit', (code, signal) => {
    if (stopping) return
    console.error(`[dev] ${name} stopped (${signal || code}); stopping development servers.`)
    void stop(code ?? 1)
  })
}

process.on('SIGINT', () => { void stop(0) })
process.on('SIGTERM', () => { void stop(0) })

start('backend on http://localhost:8000', python,
  ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000'], backend)
start('Vite', process.execPath, [vite, ...args], app)
