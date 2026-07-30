// Target for the scrub spec. Owned by e2e/scrub.spec.ts, which restores this
// file from the pristine copy before each test — no other spec may edit it.
//
// The <p> renders DIRECT text, which matters twice: it makes values.rendersText
// true so the Type section exists at all, and it makes 'type' the initially-open
// section, so a spec can reach the Size field without clicking a section header.
export default function ScrubTarget() {
  return (
    <section>
      <h2>Scrub</h2>
      <p className="text-base">Scrub my font size</p>
    </section>
  )
}
