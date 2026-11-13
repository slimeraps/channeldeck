import type { AutopostService } from '../services/autopost'
import type { JobType } from './runner'

/**
 * Autopost planner: on every tick, rules with empty slots in their look-ahead (or overdue
 * approvals) get one run that fills what it can. A rule whose bank is empty backs off for a
 * few minutes inside the service, so an empty bank doesn't make it run every tick.
 */
export function createPlannerJob(deps: {
  autopost: Pick<AutopostService, 'rulesWithWork' | 'planRule'>
}): JobType<number> {
  return {
    name: 'autopost-planner',
    concurrency: () => 1,
    key: (ruleId) => String(ruleId),
    findWork: (now) => deps.autopost.rulesWithWork(now),
    async run(ruleId) {
      await deps.autopost.planRule(ruleId)
    }
  }
}
