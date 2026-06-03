import { Callout, Code, CodeBlock, H1, H2, Lead, P } from '../ui'

export function Install() {
  return (
    <article>
      <H1>Install</H1>
      <Lead>
        Add Muse to your running React app. It works on Vite, Next.js, and webpack, on React 18 or 19,
        and runs only in development.
      </Lead>

      <Callout>
        <strong>Two ways in.</strong> The skill wires Muse into your project for you and is the quickest
        start. To do it by hand, the{' '}
        <a className="underline" href="https://github.com/thientran01/Muse/blob/main/docs/HOSTING.md">
          host guide
        </a>{' '}
        covers every bundler step by step.
      </Callout>

      <H2 id="skill">1. Add the skill</H2>
      <P>
        Muse ships as an agent skill. Add it, then point your coding agent at your project and ask it to
        set Muse up.
      </P>
      <CodeBlock label="terminal">npx skills add thientran01/Muse</CodeBlock>
      <P>
        The skill reads your project, detects the bundler, copies the engine in, and wires the three
        pieces Muse needs: a build-time locator that maps a clicked element back to its source line, the dev-only
        endpoints that read and write that source, and the overlay itself. The wiring stays gated to
        development, so none of it reaches a production build.
      </P>

      <H2 id="manual">2. Or wire it by hand</H2>
      <P>
        Muse is three parts you add to the host: the <Code>data-muse-loc</Code> locator, a Babel plugin
        that stamps each element with its source position; the <Code>/api/muse/*</Code> backend that
        rewrites source; and <Code>{'<MuseOverlay/>'}</Code> mounted in development. On Vite that is two
        plugins and a mount.
      </P>
      <CodeBlock label="vite.config.ts">{`import react from '@vitejs/plugin-react'
import { musePlugin } from './muse-server/musePlugin'
import museLoc from './muse-babel/muse-loc.cjs'

export default defineConfig(({ command }) => ({
  plugins: [
    react({ babel: { plugins: command === 'serve' ? [museLoc] : [] } }),
    musePlugin(),
  ],
}))`}</CodeBlock>
      <CodeBlock label="App.tsx">{`import { MuseOverlay } from './muse/MuseOverlay'

root.render(
  <>
    <App />
    {import.meta.env.DEV && <MuseOverlay />}
  </>,
)`}</CodeBlock>
      <P>
        Next.js and webpack follow the same shape with their own locator and backend wiring: a{' '}
        <Code>turbopack.rules</Code> rule and a development API route on Next, a <Code>babel-loader</Code>{' '}
        rule on webpack. The full per-host guide lives in{' '}
        <a className="underline" href="https://github.com/thientran01/Muse/blob/main/docs/HOSTING.md">
          HOSTING.md
        </a>
        .
      </P>

      <H2 id="run">3. Run it</H2>
      <CodeBlock label="terminal">npm run dev</CodeBlock>
      <P>
        Open your app and click the Muse button in the corner. From there, click any element to shape it
        directly, or Shift-click to hand it to the chat partner. Chat runs on the Claude CLI by default,
        on your subscription; set <Code>ANTHROPIC_API_KEY</Code> to use the metered API instead. Canvas
        needs no key at all. The <a className="underline" href="#/reference">Reference</a> lists every
        option.
      </P>

      <H2 id="requirements">Requirements</H2>
      <P>
        React 18 or 19, in any host whose bundler runs a Babel transform: Vite, Next.js, or webpack. The
        components you want to edit live under <Code>src/</Code>, since that is the boundary
        Muse writes within. Everything is development only and never ships to a build.
      </P>
    </article>
  )
}
