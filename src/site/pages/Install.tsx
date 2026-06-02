import { Callout, Code, CodeBlock, H1, H2, Lead, P } from '../ui'

export function Install() {
  return (
    <article>
      <H1>Install</H1>
      <Lead>
        Muse runs against a <strong>React 18 + Vite</strong> app in development. It is a Vite plugin
        plus a small overlay you mount yourself. Two minutes, tops.
      </Lead>

      <Callout>
        <strong>Not on npm yet.</strong> Muse is still cooking. The steps below are the shape it will
        ship as. For now, clone the repo and run it locally from{' '}
        <a className="underline" href="https://github.com/thientran01/Muse">GitHub</a>.
      </Callout>

      <H2 id="add">1. Add the package</H2>
      <CodeBlock label="terminal">npm install muse</CodeBlock>

      <H2 id="plugin">2. Add the Vite plugin</H2>
      <P>
        This wires up the dev-only endpoints that read and write your source. It never enters a
        production build.
      </P>
      <CodeBlock label="vite.config.ts">{`import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import muse from 'muse/vite'

export default defineConfig({
  plugins: [react(), muse()],
})`}</CodeBlock>

      <H2 id="mount">3. Mount the overlay</H2>
      <P>
        Mount <Code>{'<MuseOverlay/>'}</Code> in dev only. It reads React's fiber debug info, which is
        there in development.
      </P>
      <CodeBlock label="main.tsx">{`import { MuseOverlay } from 'muse'
import 'muse/style.css'

root.render(
  <>
    <App />
    {import.meta.env.DEV && <MuseOverlay />}
  </>,
)`}</CodeBlock>

      <H2 id="run">4. Run it</H2>
      <CodeBlock label="terminal">npm run dev</CodeBlock>
      <P>
        Open your app and press <strong>L</strong> for Canvas Mode, or click the Muse button to start a
        chat. The chat runs on the Claude CLI by default (your subscription). Set{' '}
        <Code>ANTHROPIC_API_KEY</Code> if you would rather use the metered API. The{' '}
        <a className="underline" href="#/reference">Reference</a> has the full list.
      </P>
    </article>
  )
}
