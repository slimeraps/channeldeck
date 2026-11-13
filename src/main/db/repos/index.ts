import type { Settings } from '@shared/schemas/settings'
import type { Db } from '../client'
import { createAccountsRepo } from './accounts'
import {
  createAutopostRulesRepo,
  createGamesRepo,
  createLayoutPresetsRepo,
  createSeriesRepo,
  createTemplatesRepo
} from './catalog'
import { createClipsRepo } from './clips'
import { type Clock, systemClock } from './common'
import { createEventLogRepo } from './eventLog'
import { createPostStepsRepo } from './postSteps'
import { createPostsRepo } from './posts'
import { createQuotaRepo } from './quota'
import { createSettingsStore, type SettingsWarning } from './settings'
import { createTwitchAccountsRepo } from './twitchAccounts'

export interface RepoOptions {
  defaults: Settings
  clock?: Clock
  onSettingsWarning?: (warning: SettingsWarning) => void
}

export function createRepos(
  db: Db,
  { defaults, clock = systemClock, onSettingsWarning }: RepoOptions
) {
  return {
    accounts: createAccountsRepo(db, clock),
    twitchAccounts: createTwitchAccountsRepo(db, clock),
    clips: createClipsRepo(db, clock),
    games: createGamesRepo(db, clock),
    layoutPresets: createLayoutPresetsRepo(db, clock),
    autopostRules: createAutopostRulesRepo(db, clock),
    templates: createTemplatesRepo(db, clock),
    series: createSeriesRepo(db, clock),
    posts: createPostsRepo(db, clock),
    postSteps: createPostStepsRepo(db, clock),
    quota: createQuotaRepo(db, clock),
    eventLog: createEventLogRepo(db, clock),
    settings: createSettingsStore(db, defaults, clock, onSettingsWarning)
  }
}

export type Repos = ReturnType<typeof createRepos>

export { DuplicateError, NotFoundError } from './common'
export { InvalidPostTransitionError } from '../../domain/postState'
