import { PAGES } from '@renderer/app/nav'
import { BrandLogo } from '@renderer/components/brand/BrandLogo'
import { NewPostButton } from '@renderer/components/NewPostButton'
import { QuotaMeter } from '@renderer/components/QuotaMeter'
import { useAppInfo } from '@renderer/hooks/useAppInfo'
import { useSettings } from '@renderer/hooks/useSettings'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/stores/ui'

export function AppSidebar(): React.JSX.Element {
  const page = useUiStore((s) => s.page)
  const setPage = useUiStore((s) => s.setPage)
  const appInfo = useAppInfo()
  const settings = useSettings()

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Space for the macOS traffic lights; also drags the window. */}
      <div className="app-drag h-12 shrink-0" />

      <div className="px-3 pb-3">
        <div className="mb-4 px-2">
          <BrandLogo className="h-8 text-sidebar-foreground" />
        </div>
        <NewPostButton className="app-no-drag w-full" />
      </div>

      <nav aria-label="Main" className="flex-1 space-y-0.5 px-3">
        {PAGES.map(({ id, label, icon: Icon }) => {
          const active = id === page
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
              )}
            >
              <Icon className={cn('size-4', active && 'text-brand')} aria-hidden />
              {label}
            </button>
          )
        })}
      </nav>

      {settings.data?.settings.dryRun ? (
        <button
          type="button"
          onClick={() => setPage('settings')}
          className="mx-3 mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-200"
        >
          <span className="font-medium">Dry Run is on.</span> Nothing is really uploaded.
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setPage('settings')}
        className="mx-3 mb-1 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent/60"
        title="YouTube quota used today (all channels share it)"
      >
        <QuotaMeter />
      </button>
      <div className="px-5 py-3 text-xs text-muted-foreground" data-testid="app-version">
        {appInfo.data ? `v${appInfo.data.version}` : appInfo.isError ? 'IPC unavailable' : '…'}
      </div>
    </aside>
  )
}
