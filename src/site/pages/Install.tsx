import { Callout, Code, CodeBlock, H1, H2, Lead, P } from '../ui'

export function Install() {
  return (
    <article>
      <H1>Install</H1>
      <Lead>
        Muse runs against a <strong>React 18 + Vite</strong> app in development. It's a Vite plugin
        plus a small overlay component you mount yourself.
      </Lead>

      <Callout>
        <strong>Not published to npm yet.</strong> Muse is in active development — the install steps
        below are the shape it'll ship as. For now, clone the repo and run it locally (see{' '}
        <a className="underline" href="https://github.com/thientran01/Muse">GitHub</a>).
      </Callout>

      <H2 id="add">1 · Add the package</H2>
      <CodeBlock label="terminal">npm install muse</CodeBlock>

      <H2 id="plugin">2 · Add the Vite plugin</H2>
      <P>
        The plugin adds the dev-only endpoints that read and write your source files. It never enters
        a production build.
      </P>
      <CodeBlock label="vite.config.ts">{`import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import muse from 'muse/vite'

export default defineConfig({
  plugins: [react(), muse()],
})`}</CodeBlock>

      <H2 id="mount">3 · Mount the overlay</H2>
      <P>
        Mount <Code>{'<MuseOverlay/>'}</Code> in dev only — it reads React's fiber debug info, which
        exists in development.
      </P>
      <CodeBlock label="main.tsx">{`import { MuseOverlay } from 'muse'
import 'muse/style.css'

root.render(
  <>
    <App />
    {import.meta.env.DEV && <MuseOverlay />}
  </>,
)`}</CodeBlock>

      <H2 id="run">4 · Run</H2>
      <CodeBlock label="terminal">npm run dev</CodeBlock>
      <P>
        Open your app, press <strong>L</strong> for Canvas Mode, or click the Muse button to start a
        chat. By default the chat uses the Claude CLI (your subscription); set{' '}
        <Code>ANTHROPIC_API_KEY</Code> to use the metered API instead. See{' '}
        <a className="underline" href="#/reference">Reference</a> for all options.
      </P>
    </article>
  )
}
