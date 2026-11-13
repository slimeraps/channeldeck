import { PAGES } from '@renderer/app/nav'
import { NewPostButton } from '@renderer/components/NewPostButton'
import { useAppInfo } from '@renderer/hooks/useAppInfo'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/stores/ui'

export function AppSidebar(): React.JSX.Element {
  const page = useUiStore((s) => s.page)
  const setPage = useUiStore((s) => s.setPage)
  const appInfo = useAppInfo()

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Space for the macOS traffic lights; also drags the window. */}
      <div className="app-drag h-12 shrink-0" />

      <div className="px-3 pb-3">
        <div className="mb-3 px-2 text-sm font-semibold tracking-tight">ChannelDeck</div>
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
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="px-5 py-3 text-xs text-muted-foreground" data-testid="app-version">
        {appInfo.data ? `v${appInfo.data.version}` : appInfo.isError ? 'IPC unavailable' : '…'}
      </div>
    </aside>
  )
}
