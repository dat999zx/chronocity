// isomorphic-git's browser build uses the global Node `Buffer` without importing it. Import this module first.
import { Buffer } from 'buffer'

;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
