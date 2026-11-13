import { useQueryClient } from '@tanstack/react-query'
import { FileVideo } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { isVideoPath } from '@shared/constants/limits'
import { getPage } from '@renderer/app/nav'
import { AppSidebar } from '@renderer/components/AppSidebar'
import { PostEditor } from '@renderer/components/post-editor/PostEditor'
import { ReauthBanner } from '@renderer/components/ReauthBanner'
import { accountsKey } from '@renderer/hooks/useAccounts'
import { postsKey } from '@renderer/hooks/usePosts'
import { clipsKey, twitchKey } from '@renderer/hooks/useTwitch'
import { onEvent } from '@renderer/lib/ipc'
import { autopostKey, layoutsKey } from '@renderer/hooks/useAutopost'
import { templatesKey } from '@renderer/hooks/useTemplates'
import { AutopostPage } from '@renderer/pages/AutopostPage'
import { CalendarPage } from '@renderer/pages/CalendarPage'
import { TemplatesPage } from '@renderer/pages/TemplatesPage'
import { ChannelsPage } from '@renderer/pages/ChannelsPage'
import { ClipsPage } from '@renderer/pages/ClipsPage'
import { PlaceholderPage } from '@renderer/pages/PlaceholderPage'
import { QueuePage } from '@renderer/pages/QueuePage'
import { SettingsPage } from '@renderer/pages/SettingsPage'
import { useProgressStore } from '@renderer/stores/progress'
import { useUiStore } from '@renderer/stores/ui'

function PageContent({ id }: { id: ReturnType<typeof getPage>['id'] }): React.JSX.Element {
  switch (id) {
    case 'queue':
      return <QueuePage />
    case 'channels':
      return <ChannelsPage />
    case 'clips':
      return <ClipsPage />
    case 'autopost':
      return <AutopostPage />
    case 'templates':
      return <TemplatesPage />
    case 'calendar':
      return <CalendarPage />
    case 'settings':
      return <SettingsPage />
    default:
      return <PlaceholderPage page={getPage(id)} />
  }
}

function hasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files')
}

export function App(): React.JSX.Element {
  const pageId = useUiStore((s) => s.page)
  const openNewPost = useUiStore((s) => s.openNewPost)
  const editorOpen = useUiStore((s) => s.editor.open)
  const queryClient = useQueryClient()
  const page = getPage(pageId)
  const [dragging, setDragging] = useState(false)

  // Cmd+N comes from the app menu in main, so it works whatever has focus.
  useEffect(() => onEvent('ui:newPost', () => openNewPost()), [openNewPost])

  // Main tells us when channels or posts change.
  useEffect(() => {
    const offAccounts = onEvent(
      'accounts:changed',
      () => void queryClient.invalidateQueries({ queryKey: accountsKey })
    )
    const offPosts = onEvent('posts:changed', () => {
      void queryClient.invalidateQueries({ queryKey: postsKey })
      void queryClient.invalidateQueries({ queryKey: accountsKey })
      void queryClient.invalidateQueries({ queryKey: autopostKey })
    })
    const offProgress = onEvent('posts:progress', ({ postId, sentBytes, totalBytes }) =>
      useProgressStore.getState().set(postId, sentBytes, totalBytes)
    )
    const offTwitch = onEvent('twitch:changed', () => {
      void queryClient.invalidateQueries({ queryKey: twitchKey })
      void queryClient.invalidateQueries({ queryKey: clipsKey })
      void queryClient.invalidateQueries({ queryKey: autopostKey })
      void queryClient.invalidateQueries({ queryKey: layoutsKey })
    })
    const offDeviceCode = onEvent('twitch:deviceCode', (info) =>
      useUiStore.getState().setDeviceCode(info)
    )
    const offTemplates = onEvent(
      'templates:changed',
      () => void queryClient.invalidateQueries({ queryKey: templatesKey })
    )
    return () => {
      offAccounts()
      offPosts()
      offProgress()
      offTwitch()
      offDeviceCode()
      offTemplates()
    }
  }, [queryClient])

  // Dropping a video anywhere on the window opens a new post with it filled in.
  const onDrop = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragging(false)
    if (editorOpen) return
    const file = e.dataTransfer.files[0]
    const path = file ? window.api.getPathForFile(file) : ''
    if (path && isVideoPath(path)) openNewPost(path)
    else toast.error('Drop a video file (MP4, MOV, M4V, WebM, MKV…) to start a post.')
  }

  return (
    <div
      className="relative flex h-full"
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        if (!editorOpen) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.relatedTarget) setDragging(false)
      }}
      onDrop={onDrop}
    >
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

      {dragging ? (
        <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm">
          <FileVideo className="size-10" aria-hidden />
          <p className="text-sm font-medium">Drop to start a new post</p>
        </div>
      ) : null}

      <PostEditor />
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </div>
  )
}
