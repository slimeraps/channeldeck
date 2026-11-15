import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { EditorAsset, EditorSource, EditorStrips } from '@shared/schemas/editor'
import { invoke } from '@renderer/lib/ipc'

export const editorKey = ['editor'] as const

/** Source info for every file in the edit, by path (missing while loading or on error). */
export function useEditorSources(paths: readonly string[]): {
  sources: Map<string, EditorSource>
  errors: Map<string, string>
} {
  const unique = [...new Set(paths)]
  const results = useQueries({
    queries: unique.map((path) => ({
      queryKey: [...editorKey, 'source', path],
      queryFn: () => invoke('editor:source', { path }),
      staleTime: Infinity,
      retry: false
    }))
  })
  const sources = new Map<string, EditorSource>()
  const errors = new Map<string, string>()
  results.forEach((r, i) => {
    const path = unique[i] as string
    if (r.data) sources.set(path, r.data)
    if (r.error) errors.set(path, r.error.message)
  })
  return { sources, errors }
}

/** Filmstrips and waveforms for the timeline, by path (made in the background, cached). */
export function useEditorStrips(paths: readonly string[]): Map<string, EditorStrips> {
  const unique = [...new Set(paths)]
  const results = useQueries({
    queries: unique.map((path) => ({
      queryKey: [...editorKey, 'strips', path],
      queryFn: () => invoke('editor:strips', { path }),
      staleTime: Infinity,
      retry: false
    }))
  })
  const strips = new Map<string, EditorStrips>()
  results.forEach((r, i) => {
    if (r.data) strips.set(unique[i] as string, r.data)
  })
  return strips
}

export const assetsKey = [...editorKey, 'assets'] as const

/** The sticker and logo library. */
export function useEditorAssets(): UseQueryResult<EditorAsset[]> {
  return useQuery({ queryKey: assetsKey, queryFn: () => invoke('editor:listAssets') })
}
