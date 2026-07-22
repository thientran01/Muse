// Target for the reorder-then-gap spec. Owned by e2e/reorder-then-gap.spec.ts.
//
// A flex container so the panel exposes gap fields at all (they only render for
// a flex/grid computed display), with NO gap class to start: a bare `gap-*` is
// not absorbed by a `gap-y-*` edit, so starting from zero keeps the expected
// output a single unambiguous token.
export default function GapTarget() {
  return (
    <section>
      <h2>Gap</h2>
      <div className="flex flex-col">
        <div className="p-4">One</div>
        <div className="p-4">Two</div>
        <div className="p-4">Three</div>
      </div>
    </section>
  )
}
