import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeShiki from '@shikijs/rehype'
import { unified } from 'unified'
import type { Options as AutolinkOptions } from 'rehype-autolink-headings'
import type { Element, Root, Text } from 'hast'

export type Heading = { id: string; text: string; depth: 2 | 3 }

export type RenderedMarkdown = { html: string; headings: Heading[] }

/** Extracted so the object is checked against `Options` directly rather than
 *  through unified's `use()` overloads, which report the mismatch unusably. */
const AUTOLINK: Readonly<AutolinkOptions> = {
  behavior: 'append',
  // hast wants `className` as a list and aria-* as strings, not the JSX shapes.
  properties: { className: ['heading-anchor'], ariaHidden: 'true', tabIndex: -1 },
  content: { type: 'text', value: '#' },
}

/**
 * Collect the table of contents from the HAST *after* rehype-slug has run, so
 * the anchors in the TOC are the ids that actually exist in the HTML. Deriving
 * slugs a second time from the markdown source is how a TOC quietly starts
 * linking to nowhere the first time a heading contains punctuation.
 */
function collectHeadings(sink: Heading[]) {
  return () => (tree: Root) => {
    for (const node of tree.children) {
      if (node.type !== 'element') continue
      const el = node as Element
      if (el.tagName !== 'h2' && el.tagName !== 'h3') continue
      const id = typeof el.properties?.id === 'string' ? el.properties.id : ''
      if (!id) continue
      sink.push({ id, text: textOf(el), depth: el.tagName === 'h2' ? 2 : 3 })
    }
  }
}

function textOf(node: Element): string {
  let out = ''
  for (const child of node.children) {
    if (child.type === 'text') out += (child as Text).value
    else if (child.type === 'element') out += textOf(child as Element)
  }
  return out.trim()
}

/**
 * Markdown → HTML, at build time only. Shiki runs here rather than in the
 * browser: a syntax highlighter shipped to the client would be by far the
 * largest thing on a page whose entire job is to display text.
 */
export async function renderMarkdown(markdown: string): Promise<RenderedMarkdown> {
  const headings: Heading[] = []

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(collectHeadings(headings))
    .use(rehypeAutolinkHeadings, AUTOLINK)
    .use(rehypeShiki, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    })
    .use(rehypeStringify)
    .process(markdown)

  return { html: String(file), headings }
}
