import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { EPHEMERAL } from './muse/config'
import './index.css'

// The hosted demo is built with the dev React runtime (so fibers keep
// _debugSource for Canvas selection). StrictMode double-invokes renders/effects
// in dev, which is pure overhead in a shipped artifact and adds animation jank,
// so skip it there. Local `npm run dev` still gets StrictMode's checks.
const app = <App />
ReactDOM.createRoot(document.getElementById('root')!).render(
  EPHEMERAL ? app : <React.StrictMode>{app}</React.StrictMode>,
)
