import { Callout, Code, CodeBlock, H1, H2, Lead, P } from '../ui'

export function Install() {
  return (
    <article>
      <H1>Install</H1>
      <Lead>
        Muse runs against a <strong>React 18 + Vite</strong> app in development. It is a Vite plugin
        plus a small overlay you mount yourself, and setup runs about two minutes.
      </Lead>

      <Callout>
        <strong>Still pre-release.</strong> These steps are the shape Muse will ship as. For now, clone
        the repo from <a className="underline" href="https://github.com/thientran01/Muse">GitHub</a> and
        run it locally.
      </Callout>

      <H2 id="add">1. Add the package</H2>
      <CodeBlock label="terminal">npm install muse</CodeBlock>

      <H2 id="plugin">2. Add the Vite plugin</H2>
      <P>
        The plugin adds the dev-only endpoints that read and write your source, and it stays out of
        production builds.
      </P>
      <CodeBlock label="vite.config.ts">{`import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import muse from 'muse/vite'

export default defineConfig({
  plugins: [react(), muse()],
})`}</CodeBlock>

      <H2 id="mount">3. Mount the overlay</H2>
      <P>
        Mount <Code>{'<MuseOverlay/>'}</Code> in development, where React's fiber debug info lives.
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
        Open your app and press <strong>L</strong> for Canvas Mode, or click the Muse button to chat.
        Chat runs on the Claude CLI by default, on your subscription; set <Code>ANTHROPIC_API_KEY</Code>{' '}
        to use the metered API instead. The <a className="underline" href="#/reference">Reference</a>{' '}
        lists every option.
      </P>
    </article>
  )
}
