// ============================================================
//  Heuristic observation — the instant opener
// ------------------------------------------------------------
//  When a fresh element is selected we render a read of it
//  IMMEDIATELY, before the LLM /observe call returns. This is that
//  read: a tag-bucketed one-liner + 3 starter chips, nudged by a
//  few cheap className signals. It only has to be plausible for the
//  ~700ms before the real observation swaps in.
// ============================================================
import type { ObserveResult, SelectedElement } from './types'

const has = (cls: string, re: RegExp) => re.test(cls)

type Bucket = 'heading' | 'action' | 'text' | 'container' | 'media' | 'other'

function bucketFor(tag: string): Bucket {
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'button' || tag === 'a') return 'action'
  if (['p', 'span', 'label', 'li', 'blockquote'].includes(tag)) return 'text'
  if (['div', 'section', 'header', 'footer', 'main', 'article', 'aside', 'nav', 'ul', 'form'].includes(tag))
    return 'container'
  if (['img', 'svg', 'video', 'picture', 'figure'].includes(tag)) return 'media'
  return 'other'
}

function observationFor(bucket: Bucket, tag: string, cls: string): string {
  switch (bucket) {
    case 'heading':
      return has(cls, /\bfont-(bold|extrabold|black|semibold)\b/)
        ? "Heavy already — the real question is whether the space around it earns that weight."
        : "This heading sets the section's tone; its weight and scale do the talking."
    case 'action':
      return has(cls, /\bbg-(?!transparent)\w/)
        ? "It's got a filled treatment — color and padding decide how hard it pulls."
        : "Reads a little quiet for a call-to-action — there's room to give it more pull."
    case 'text':
      return "Body copy — size, color, and line length drive how readable this feels."
    case 'container':
      return has(cls, /\b(shadow|ring-\d|border)\b/)
        ? "Framed like a card already; the spacing inside is what makes it feel contained."
        : "A container doing quiet structural work — spacing and background set the rhythm."
    case 'media':
      return "An image — radius, ratio, and framing decide how polished it lands."
    default:
      return `Selected <${tag}> — tell me how you want it to feel.`
  }
}

function chipsFor(bucket: Bucket, cls: string): string[] {
  switch (bucket) {
    case 'heading':
      return ['Make it bolder', 'Tone it down', 'Tighten the spacing']
    case 'action':
      return ['Make it pop', 'Try a different color', 'Adjust the padding']
    case 'text':
      return ['Improve readability', 'Soften the color', 'Change the size']
    case 'container':
      return has(cls, /\b(shadow|ring-\d)\b/)
        ? ['Flatten it', 'More breathing room', 'Tighten it up']
        : ['More breathing room', 'Tighten it up', 'Add a subtle background']
    case 'media':
      return ['Round the corners', 'Add a soft shadow', 'Adjust the framing']
    default:
      return ['Make it pop', 'Simplify it', 'More breathing room']
  }
}

/** Synchronous, no network — the placeholder opener shown the instant an
 * element is selected. The LLM read replaces it shortly after. */
export function heuristicObservation(target: SelectedElement): ObserveResult {
  const tag = target.tag || 'element'
  const cls = target.classNames || ''
  const bucket = bucketFor(tag)
  return { observation: observationFor(bucket, tag, cls), chips: chipsFor(bucket, cls) }
}
