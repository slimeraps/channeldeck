import { useEffect } from 'react'
import { getPage } from '@renderer/app/nav'
import { AppSidebar } from '@renderer/components/AppSidebar'
import { NewPostDialog } from '@renderer/components/NewPostDialog'
import { onEvent } from '@renderer/lib/ipc'
import { PlaceholderPage } from '@renderer/pages/PlaceholderPage'
import { SettingsPage } from '@renderer/pages/SettingsPage'
import { useUiStore } from '@renderer/stores/ui'

export function App(): React.JSX.Element {
  const pageId = useUiStore((s) => s.page)
  const openNewPost = useUiStore((s) => s.openNewPost)
  const page = getPage(pageId)

  // Cmd+N comes from the app menu in main, so it works whatever has focus.
  useEffect(() => onEvent('ui:newPost', () => openNewPost()), [openNewPost])

  return (
    <div className="flex h-full">
      <AppSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="app-drag flex h-12 shrink-0 items-center border-b px-8">
          <h1 className="text-sm font-semibold">{page.label}</h1>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {page.id === 'settings' ? <SettingsPage /> : <PlaceholderPage page={page} />}
        </div>
      </main>
      <NewPostDialog />
    </div>
  )
}
