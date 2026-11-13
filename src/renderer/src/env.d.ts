/// <reference types="vite/client" />
import type { ChannelDeckApi } from '@shared/ipc/api'

declare global {
  interface Window {
    /** Exposed by the sandboxed preload (src/preload/index.ts). The only bridge to main. */
    readonly api: ChannelDeckApi
  }
}

export {}
