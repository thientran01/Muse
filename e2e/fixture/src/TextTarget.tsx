// Target for the text-edit spec. Owned by e2e/text-edit.spec.ts.
//
// The <p> must have EXACTLY ONE significant JSXText child and no element
// children. The engine refuses anything else, and the refusals are distinct:
// zero text children reads "this text comes from data, not static text", more
// than one reads "this text mixes static + data". The <strong> below is a
// sibling of the <p>, deliberately outside it, so the editable node stays clean
// while the file still contains other markup for the untouched-lines assertion.
export default function TextTarget() {
  return (
    <section>
      <h2>Text</h2>
      <p>Edit this copy</p>
      <strong>Not the target</strong>
    </section>
  )
}
