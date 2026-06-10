import styles from './ModuleCard.module.css'

// The CSS-Modules demo: every visual value here lives in ModuleCard.module.css —
// the classNames are just bindings. Select anything in this card and scrub; the
// engine resolves styles.card → the `.card` rule and writes the declaration there
// (the ModuleEdit path), leaving this JSX byte-identical.
export function ModuleCard() {
  return (
    <div className={styles.card}>
      <h3 className={styles.title}>Styled by a CSS Module</h3>
      <p className={styles.blurb}>
        This card's padding, colors, and type all live in ModuleCard.module.css. Scrub any of them and
        Muse edits the rule in that stylesheet, not the markup.
      </p>
      <span className={styles.badge}>writes to .module.css</span>
    </div>
  )
}
