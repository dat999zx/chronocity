// The history worker imports these, but Vite's dependency scan doesn't follow `new Worker(new URL(...))`, so without
// this the first folder drop in dev makes Vite re-optimize and reload the page mid-replay.
export default { optimizeDeps: { include: ['isomorphic-git', 'buffer'] } }
