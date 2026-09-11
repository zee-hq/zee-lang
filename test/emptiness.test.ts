import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('emptiness / blank / none (ZEE-23 / §8g)', () => {
  it('treats empty and Unicode whitespace as blank on String', () => {
    expect(
      execute(`
        (
          "".isBlank(),
          "  \\t\\n".isBlank(),
          "\u00a0".isBlank(),
          "zee".isBlank(),
          "  a".isNotBlank()
        )
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: false },
        { type: 'bool', value: true },
      ],
    })
  })

  it('isNoneOrEmpty on Option of String, List, T[], and Map', () => {
    expect(
      execute(`
        const empty: List<i32> = []
        const buf: i32[] = []
        var ages: Map<String, i32> = {}
        const noneS: Option<String> = None
        const noneL: Option<List<i32>> = None
        const noneA: Option<i32[]> = None
        const noneM: Option<Map<String, i32>> = None
        const xs = [1]
        (
          noneS.isNoneOrEmpty(),
          Some("").isNoneOrEmpty(),
          Some("  ").isNoneOrEmpty(),
          noneL.isNoneOrEmpty(),
          Some(empty).isNoneOrEmpty(),
          Some(xs).isNoneOrEmpty(),
          noneA.isNoneOrEmpty(),
          Some(buf).isNoneOrEmpty(),
          noneM.isNoneOrEmpty(),
          Some(ages).isNoneOrEmpty()
        )
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: false },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: false },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
      ],
    })
  })

  it('isNoneOrBlank only on Option<String> and does not coerce Some spaces to None', () => {
    expect(
      execute(`
        const noneS: Option<String> = None
        const padded: Option<String> = Some("  ")
        (noneS.isNoneOrBlank(), padded.isNoneOrBlank(), padded.isNone(), padded.isSome())
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: false },
        { type: 'bool', value: true },
      ],
    })
  })

  it('rejects isBlank on List, isNoneOrEmpty on Option<i32>, and isNull', () => {
    expect(() => execute('const xs = [1]\nxs.isBlank()')).toThrow(/isBlank|String|field/)
    expect(() =>
      execute(`
        const n: Option<i32> = None
        n.isNoneOrEmpty()
      `),
    ).toThrow(/isNoneOrEmpty|String|List|Map|field/)
    expect(() => execute('const xs = [1]\nxs.isNull()')).toThrow(/isNull|field/)
  })
})
