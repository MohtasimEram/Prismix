/**
 * Moves the item at [from] so it sits just before what is at [before] in the original
 * list (`list.length` = the end). Returns a new list; the same one when nothing moves
 * (dropped on itself or right after itself) or an index is out of range.
 */
export function moveBefore<T>(list: readonly T[], from: number, before: number): T[] {
  const inRange = Number.isInteger(from) && Number.isInteger(before) && from >= 0 && from < list.length && before >= 0 && before <= list.length;
  if (!inRange || before === from || before === from + 1) return list as T[];
  const out = [...list];
  const [moved] = out.splice(from, 1);
  out.splice(before > from ? before - 1 : before, 0, moved as T);
  return out;
}
