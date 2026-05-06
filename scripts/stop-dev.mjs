import {
  clearRuntimePortSync,
  getRuntimePortStateSync
} from '../server/utils/runtimePorts.js'

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function stopPid(pid, label) {
  if (!isPidAlive(pid)) {
    console.log(`[stop-dev] ${label} PID ${pid} is not running`)
    return false
  }

  console.log(`[stop-dev] Sending SIGTERM to ${label} PID ${pid}`)
  process.kill(pid, 'SIGTERM')

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!isPidAlive(pid)) {
      console.log(`[stop-dev] ${label} PID ${pid} stopped`)
      return true
    }
    await wait(200)
  }

  console.log(`[stop-dev] Escalating to SIGKILL for ${label} PID ${pid}`)
  process.kill(pid, 'SIGKILL')
  await wait(100)
  return !isPidAlive(pid)
}

async function main() {
  const runtimeState = getRuntimePortStateSync()
  const targets = Object.entries(runtimeState)
    .filter(([, entry]) => entry?.pid)
    .map(([kind, entry]) => ({
      kind,
      pid: entry.pid,
      port: entry.port
    }))

  if (targets.length === 0) {
    console.log('[stop-dev] No tracked dr-claw dev processes found')
    return
  }

  for (const target of targets) {
    try {
      await stopPid(target.pid, `${target.kind} (port ${target.port})`)
    } catch (error) {
      console.warn(`[stop-dev] Failed to stop ${target.kind} PID ${target.pid}: ${error.message}`)
    } finally {
      clearRuntimePortSync(target.kind)
    }
  }
}

main().catch(error => {
  console.error('[stop-dev] Failed:', error.message)
  process.exitCode = 1
})