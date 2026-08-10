'use client'

import { Typography } from 'antd'

/**
 * antd's compound statics (`Typography.Title`, `Typography.Paragraph`, …) are lost
 * across the React Server Component client boundary: in a Server Component
 * `Typography.Title` reads as `undefined` and React throws "Element type is
 * invalid". Re-exporting each static as its own export of a `'use client'` module
 * gives every one of them its own client reference, which Server Components can
 * render normally.
 *
 * Server Components must import Title/Paragraph/Text from here, never from 'antd'.
 */
export const Title = Typography.Title
export const Paragraph = Typography.Paragraph
export const Text = Typography.Text
export const Link = Typography.Link
