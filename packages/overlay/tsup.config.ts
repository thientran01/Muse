import { defineConfig } from 'tsup'

// Bundles the overlay from the repo's own src/muse + server source into a
// self-contained dist/. react/react-dom/vite are peers (host-provided); @babel/*
// stays a runtime dependency; Phosphor's used icons tree-shake INTO the bundle
// (so the host never sees the 48MB barrel). Node built-ins auto-externalize.
export default defineConfig({
  entry: {
    index: 'src/index.ts', //           .           — <MuseOverlay/> + configureMuse (client)
    vite: 'src/vite.ts', //             ./vite       — musePlugin (Vite dev middleware)
    next: 'src/next.ts', //             ./next       — createMuseWebRouter (+ createMuseContext)
    standalone: 'src/standalone.ts', // ./standalone — startStandaloneServer (Node http)
  },
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  splitting: false,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'vite',
    '@babel/parser',
    '@babel/traverse',
    '@babel/types',
  ],
})
