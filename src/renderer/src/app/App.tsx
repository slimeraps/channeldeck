import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { getPage } from '@renderer/app/nav'
import { AppSidebar } from '@renderer/components/AppSidebar'
import { NewPostDialog } from '@renderer/components/NewPostDialog'
import { ReauthBanner } from '@renderer/components/ReauthBanner'
import { accountsKey } from '@renderer/hooks/useAccounts'
import { onEvent } from '@renderer/lib/ipc'
import { ChannelsPage } from '@renderer/pages/ChannelsPage'
import { PlaceholderPage } from '@renderer/pages/PlaceholderPage'
import { SettingsPage } from '@renderer/pages/SettingsPage'
import { useUiStore } from '@renderer/stores/ui'

function PageContent({ id }: { id: ReturnType<typeof getPage>['id'] }): React.JSX.Element {
  switch (id) {
    case 'channels':
      return <ChannelsPage />
    case 'settings':
      return <SettingsPage />
    default:
      return <PlaceholderPage page={getPage(id)} />
  }
}

export function App(): React.JSX.Element {
  const pageId = useUiStore((s) => s.page)
  const openNewPost = useUiStore((s) => s.openNewPost)
  const queryClient = useQueryClient()
  const page = getPage(pageId)

  // Cmd+N comes from the app menu in main, so it works whatever has focus.
  useEffect(() => onEvent('ui:newPost', () => openNewPost()), [openNewPost])

  // Main tells us when channels change (added, removed, sign-in expired).
  useEffect(
    () =>
      onEvent(
        'accounts:changed',
        () => void queryClient.invalidateQueries({ queryKey: accountsKey })
      ),
    [queryClient]
  )

  return (
    <div className="flex h-full">
      <AppSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="app-drag flex h-12 shrink-0 items-center border-b px-8">
          <h1 className="text-sm font-semibold">{page.label}</h1>
        </header>
        <ReauthBanner />
        <div className="min-h-0 flex-1 overflow-auto">
          <PageContent id={page.id} />
        </div>
      </main>
      <NewPostDialog />
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </div>
  )
}
