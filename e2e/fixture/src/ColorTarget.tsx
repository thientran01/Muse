// Target for the color spec. Owned by e2e/color.spec.ts.
//
// A background colour rather than text colour: the Fill row always renders for a
// non-SVG element, while the Text row only appears when the element has direct
// text-node children — one fewer precondition to hold true.
//
// The class must NOT be a var-themed token (`bg-[color:var(--x)]`): the row then
// renders a static "themed" span with no button at all, and there is nothing to
// click.
export default function ColorTarget() {
  return (
    <section>
      <h2>Color</h2>
      <div className="bg-white">Fill me</div>
    </section>
  )
}
