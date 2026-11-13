import { describe, expect, it } from 'vitest'
import { EVENT_CHANNELS, INVOKE_CHANNELS, isEventChannel, isInvokeChannel } from './channels'
import { eventContract, invokeContract } from './contract'

describe('IPC contract', () => {
  it('declares a schema for exactly the invoke channels the preload allows', () => {
    expect(Object.keys(invokeContract).sort()).toEqual([...INVOKE_CHANNELS].sort())
  })

  it('declares a schema for exactly the event channels the preload allows', () => {
    expect(Object.keys(eventContract).sort()).toEqual([...EVENT_CHANNELS].sort())
  })

  it('recognizes known channels and rejects anything else', () => {
    expect(isInvokeChannel('app:getInfo')).toBe(true)
    expect(isInvokeChannel('fs:readFile')).toBe(false)
    expect(isInvokeChannel(42)).toBe(false)
    expect(isEventChannel('ui:newPost')).toBe(true)
    expect(isEventChannel('app:getInfo')).toBe(false)
  })

  it('validates app:ping input strictly', () => {
    const schema = invokeContract['app:ping'].input
    expect(schema.safeParse({ message: 'hi' }).success).toBe(true)
    expect(schema.safeParse({ message: '' }).success).toBe(false)
    expect(schema.safeParse({ message: 'x'.repeat(201) }).success).toBe(false)
    expect(schema.safeParse({ message: 'hi', extra: true }).success).toBe(false)
    expect(schema.safeParse('hi').success).toBe(false)
  })

  it('rejects any payload on channels that take none', () => {
    expect(invokeContract['app:getInfo'].input.safeParse(undefined).success).toBe(true)
    expect(invokeContract['app:getInfo'].input.safeParse({ path: '/etc' }).success).toBe(false)
  })
})
