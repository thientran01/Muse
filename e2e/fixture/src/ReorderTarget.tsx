// Target for the reorder spec. Owned by e2e/reorder.spec.ts.
//
// Constraints this list has to satisfy, all of which fail SILENTLY if broken:
//
//  - Exactly three children, each rendering exactly one visible in-flow element.
//    At drag engage the overlay compares the live sibling count against the
//    count of significant JSX element children in source, and a mismatch aborts
//    the drag with no feedback at all. No portals, no decorative extra nodes.
//  - Static element children only — no `{items.map(...)}`, no `{cond && ...}`,
//    no fragments, and no significant text mixed in among the elements.
//  - Nothing CSS-pinned: no absolute/fixed positioning, no explicit grid
//    placement, no non-zero `order`. Those are refused synchronously.
//  - A static subtree. The settle observer watches childList + subtree +
//    characterData, so anything animating inside could resolve it early.
export default function ReorderTarget() {
  return (
    <section>
      <h2>Reorder</h2>
      <div className="flex flex-col">
        <div className="p-4">Alpha</div>
        <div className="p-4">Beta</div>
        <div className="p-4">Gamma</div>
      </div>
    </section>
  )
}
