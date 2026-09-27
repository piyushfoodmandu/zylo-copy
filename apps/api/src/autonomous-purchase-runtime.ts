import { randomUUID } from 'node:crypto'
import type { AutonomousPurchaseWorker } from './autonomous-purchase-worker.ts'
import { logger } from './logger.ts'

type RuntimeLoop = {
  stop(): Promise<void>
}

const loops = new Set<RuntimeLoop>()

export const startAutonomousPurchaseRuntime = ({
  worker,
  pollIntervalMs = 1_000,
  leaseSeconds = 60
}: {
  worker: AutonomousPurchaseWorker
  pollIntervalMs?: number
  leaseSeconds?: number
}) => {
  const leaseOwner = `arro-autonomous-worker:${process.pid}:${randomUUID()}`
  let timer: NodeJS.Timeout | undefined
  let stopped = false
  let active: Promise<void> | undefined

  const schedule = (delayMs: number) => {
    if (stopped) return
    timer = setTimeout(run, delayMs)
    timer.unref()
  }

  const run = () => {
    if (stopped || active) return
    active = worker.runOnce({ leaseOwner, leaseSeconds })
      .then((result) => {
        if (result.status !== 'idle') {
          logger.info({
            jobId: result.job.jobId,
            status: result.status,
            ...(result.status === 'completed' ? { purchaseId: result.purchase.purchaseId } : {}),
            ...('errorCode' in result ? { errorCode: result.errorCode } : {})
          }, 'Autonomous purchase worker cycle completed')
        }
      })
      .catch((error) => {
        logger.error({ error }, 'Autonomous purchase worker cycle failed')
      })
      .finally(() => {
        active = undefined
        schedule(pollIntervalMs)
      })
  }

  const loop: RuntimeLoop = {
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      await active
      loops.delete(loop)
    }
  }
  loops.add(loop)
  schedule(0)
  return loop
}

export const closeRuntimeAutonomousPurchaseWorkers = async () => {
  await Promise.all([...loops].map((loop) => loop.stop()))
}
