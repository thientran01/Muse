import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { isEphemeral } from './muse/config'
import './index.css'
// Zoo tokens load globally (not just on the Styling page) so a Design-tokens
// popover edit of a --zoo-* var applies whichever page is open.
import './site/zoo/zoo.css'

// The hosted demo is built with the dev React runtime (so fibers keep
// _debugSource for Canvas selection). StrictMode double-invokes renders/effects
// in dev, which is pure overhead in a shipped artifact and adds animation jank,
// so skip it there. Local `npm run dev` still gets StrictMode's checks.
//
// Wrapped in a component rather than branching inside render(): the config flags
// are read lazily now (config.ts), and a read in a top-level statement is exactly
// the module-scope snapshot the lint forbids. This site's value comes from a
// build-time Vite var, so the race can't bite here — but leaving one module-scope
// read in the tree means the rule has an exception, and the first exception is
// where the rule stops being checkable.
function Root() {
  return isEphemeral() ? <App /> : <React.StrictMode><App /></React.StrictMode>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />)
