import { describe, expect, it } from 'vitest'
import { TEST_HOOK_COOKIE, parseTestHook } from './test-hook'

/**
 * The parser behind the two injections AC-S6 and AC-S10 need. It is unit-tested
 * rather than left to the e2e suite that uses it because its failure mode is
 * silent in exactly one direction: a cookie that fails to parse makes the
 * degraded spec time out at sixty seconds with no clue why, while a stray value
 * that DID parse would 500 an unrelated spec.
 */

const jar = (value: string) => `theme=dark; ${TEST_HOOK_COOKIE}=${value}; other=1`

describe('parseTestHook', () => {
  it('reads the header', () => {
    expect(parseTestHook('slow', null)).toBe('slow')
    expect(parseTestHook('fail', null)).toBe('fail')
  })

  it('reads the cookie out of a jar with other cookies in it', () => {
    expect(parseTestHook(null, jar('fail'))).toBe('fail')
    expect(parseTestHook(null, `${TEST_HOOK_COOKIE}=slow`)).toBe('slow')
  })

  it('lets an explicit header win over the browser context cookie', () => {
    // One API call saying "fail this one" must not be overruled by the mode the
    // whole context happens to be in.
    expect(parseTestHook('fail', jar('slow'))).toBe('fail')
  })

  it.each([
    ['nothing at all', null, null],
    ['an empty header', '', null],
    ['an unknown value', 'explode', null],
    ['a cookie whose name merely ends the same way', null, 'my-speaking-test-hook=fail'],
    ['an unknown cookie value', null, jar('explode')],
  ])('is null for %s', (_label, header, cookieHeader) => {
    expect(parseTestHook(header, cookieHeader)).toBeNull()
  })

  it('tolerates case and padding rather than erroring on them', () => {
    expect(parseTestHook(' SLOW ', null)).toBe('slow')
  })
})
