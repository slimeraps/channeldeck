import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { newEdit } from '@shared/editOps'
import type { CanvasKind } from '@shared/geometry'
import type { EditSpec } from '@shared/schemas/edit'
import type { EditProjectSummary } from '@shared/schemas/editor'
import type { ClipView } from '@shared/schemas/twitch'
import { invoke } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/stores/ui'
import { useVideoEditor } from '@renderer/stores/videoEditor'
import { editorKey } from './useEditorSources'

const projectsKey = [...editorKey, 'projects'] as const

/** How long after the last change the open project is saved. */
const AUTOSAVE_MS = 800

export function useEditProjects(): UseQueryResult<EditProjectSummary[]> {
  return useQuery({ queryKey: projectsKey, queryFn: () => invoke('editor:listProjects') })
}

/** Opens a saved project in the editor. */
export async function openProject(id: number): Promise<void> {
  const project = await invoke('editor:getProject', { id })
  useVideoEditor
    .getState()
    .open(project.spec, { kind: 'project', id: project.id, name: project.name })
}

/** Makes a project from an edit, opens it, and goes to the Editor page. */
export async function startProject(spec: EditSpec, name?: string): Promise<void> {
  const project = await invoke('editor:createProject', { spec, ...(name ? { name } : {}) })
  useVideoEditor
    .getState()
    .open(project.spec, { kind: 'project', id: project.id, name: project.name })
  useUiStore.getState().setPage('editor')
}

/**
 * Banked clips as a new project, joined oldest first (Clips page: Edit… / Edit together…).
 * Clips that aren't on disk are left out.
 */
export async function editClips(
  clips: readonly ClipView[],
  canvas: CanvasKind = 'vertical'
): Promise<void> {
  const usable = [...clips]
    .filter((c) => c.landscapePath ?? c.portraitPath)
    .sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc))
  if (usable.length === 0) {
    toast.error(
      clips.length === 1
        ? "That clip isn't downloaded yet."
        : 'None of those clips are downloaded yet.'
    )
    return
  }
  if (usable.length < clips.length) {
    toast.message(
      `${clips.length - usable.length} clip(s) aren't downloaded yet and were left out.`
    )
  }
  // The file's real length (Twitch's listed length can be off by a little, or a lot).
  const pieces = await Promise.all(
    usable.map(async (c) => {
      const path = (c.landscapePath ?? c.portraitPath) as string
      const source = await invoke('editor:source', { path })
      return { path, durationSec: source.durationSec, clipId: c.id }
    })
  )
  await startProject(newEdit(pieces, canvas))
}

export function useRenameProject(): UseMutationResult<
  unknown,
  Error,
  { id: number; name: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; name: string }) => invoke('editor:renameProject', vars),
    onSuccess: (_out, vars) => {
      void qc.invalidateQueries({ queryKey: projectsKey })
      const { origin, rename } = useVideoEditor.getState()
      if (origin?.kind === 'project' && origin.id === vars.id) rename(vars.name.trim())
    },
    onError: (e) => toast.error(e.message)
  })
}

export function useDeleteProject(): UseMutationResult<unknown, Error, number> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => invoke('editor:deleteProject', { id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectsKey })
      toast.success('Project deleted')
    },
    onError: (e) => toast.error(e.message)
  })
}

/**
 * Saves the open project a moment after each change, and once more when it closes, so an
 * edit is never lost. Returns `flush`, which saves right away (before closing).
 */
export function useProjectAutosave(): () => Promise<void> {
  const qc = useQueryClient()
  const spec = useVideoEditor((s) => s.spec)
  const origin = useVideoEditor((s) => s.origin)
  const pending = useRef<{ id: number; spec: EditSpec } | null>(null)
  /** The project's edit as last opened or saved: unchanged edits aren't saved again. */
  const baseline = useRef<{ id: number; spec: EditSpec } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const job = pending.current
    pending.current = null
    if (!job) return
    try {
      await invoke('editor:saveProject', job)
      if (baseline.current?.id === job.id) baseline.current = job
      void qc.invalidateQueries({ queryKey: projectsKey })
    } catch (e) {
      toast.error(`Couldn't save the project: ${(e as Error).message}`)
    }
  }
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })

  useEffect(() => {
    if (!spec || origin?.kind !== 'project') return
    if (baseline.current?.id !== origin.id) {
      baseline.current = { id: origin.id, spec }
      return
    }
    if (spec === baseline.current.spec) return
    pending.current = { id: origin.id, spec }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flushRef.current(), AUTOSAVE_MS)
  }, [spec, origin])

  // Leaving the page saves whatever is still waiting.
  useEffect(() => () => void flushRef.current(), [])

  return flush
}
