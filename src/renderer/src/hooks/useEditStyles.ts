import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { EditStyle } from '@shared/schemas/editor'
import { invoke } from '@renderer/lib/ipc'
import { editorKey } from './useEditorSources'

export const stylesKey = [...editorKey, 'styles'] as const

/** The saved edit styles (autopost rules pick one). */
export function useEditStyles(): UseQueryResult<EditStyle[]> {
  return useQuery({ queryKey: stylesKey, queryFn: () => invoke('editor:listStyles') })
}
