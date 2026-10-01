#!/usr/bin/env node
/**
 * Starts every service the project needs, from one command.
 *
 *   npm run dev
 *
 * The app is three separate processes. Running only the storefront leaves the
 * video editor and the Flask API dead, which breaks the Editor link and the
 * support chatbot. This script starts all three, labels their output, and
 * shuts every child down together so no orphans are left behind.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const IS_WINDOWS = process.platform === 'win32'

const color = (code) => `[${code}m`
const RESET = color(0)
const DIM = color(2)
const CYAN = color(36)
const GREEN = color(32)
const MAGENTA = color(35)

const SERVICES = [
  { name: 'api', label: 'API   ', color: CYAN, cwd: path.join(ROOT, 'appname'), command: '"..\\.venv\\Scripts\\python.exe" backend/app.py', url: 'http://127.0.0.1:5000' },
  { name: 'web', label: 'WEB   ', color: GREEN, cwd: path.join(ROOT, 'appname'), command: 'npm run dev', url: 'http://localhost:5173' },
  { name: 'editor', label: 'EDITOR', color: MAGENTA, cwd: path.join(ROOT, 'auto-editor'), command: 'npm run dev', url: 'http://localhost:3001' }
]

const children = new Map()
let shuttingDown = false

const prefixLines = (service, chunk) => {
  const text = chunk.toString()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    process.stdout.write(`${service.color}${service.label}${RESET} ${DIM}|${RESET} ${line}\n`)
  }
}

const shutdown = (code = 0) => {
  if (shuttingDown) return
  shuttingDown = true
  for (const [name, child] of children) {
    if (child.exitCode !== null || child.killed) continue
    if (IS_WINDOWS) {
      // Kill the whole tree; npm spawns node as a child on Windows.
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true, stdio: 'ignore' })
      } catch {
        child.kill()
      }
    } else {
      child.kill('SIGTERM')
    }
    children.delete(name)
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const web = SERVICES[1]
const editor = SERVICES[2]
const api = SERVICES[0]

console.log(`
${DIM}Starting Gene Academy services...${RESET}

  ${web.color}Storefront${RESET}  ${web.url}
  ${editor.color}Editor${RESET}      ${editor.url}
  ${api.color}Backend${RESET}     ${api.url}

${DIM}Open the storefront at ${web.url}
Press Ctrl+C to stop all three.${RESET}
`)

for (const service of SERVICES) {
  const child = spawn(service.command, {
    cwd: service.cwd,
    shell: true,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: '1' }
  })

  children.set(service.name, child)
  child.stdout?.on('data', (chunk) => prefixLines(service, chunk))
  child.stderr?.on('data', (chunk) => prefixLines(service, chunk))

  child.on('error', (error) => {
    console.error(`${service.color}${service.label}${RESET} failed to start: ${error.message}`)
    console.error(`${DIM}If this is a Python error, run: npm run setup${RESET}`)
    shutdown(1)
  })

  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`${service.color}${service.label}${RESET} exited (${signal || `code ${code}`}) - stopping the rest.`)
    shutdown(code ?? 1)
  })
}
