import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Deliberately no StrictMode. The app's own main.tsx enables it whenever
// EPHEMERAL is off — i.e. exactly the real-write configuration this suite runs
// in — and the double-invoked render fires ScrubField's onPreview twice per
// nudge. Harmless to the DOM, but it doubles every effect a spec might count.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
