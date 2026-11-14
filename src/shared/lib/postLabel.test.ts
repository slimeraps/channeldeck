import { describe, expect, it } from 'vitest'
import { postLabel, sentence } from './postLabel'

describe('postLabel', () => {
  it('quotes the title, or says "a video" when titles are hidden', () => {
    expect(postLabel('MW4 Day 9', false)).toBe('"MW4 Day 9"')
    expect(postLabel('', false)).toBe('"Untitled"')
    expect(postLabel('MW4 Day 9', true)).toBe('a video')
  })

  it('capitalizes a label that starts a sentence', () => {
    expect(sentence(`${postLabel('x', true)} is now public.`)).toBe('A video is now public.')
    expect(sentence(`${postLabel('x', false)} is now public.`)).toBe('"x" is now public.')
  })
})
