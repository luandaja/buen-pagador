import { beforeEach, describe, expect, it } from 'vitest';
import { forgetVisit, listVisits, rememberVisit } from '../src/scripts/visited';

const visit = (id: string, seenAt = 1) => ({ id, key: 'k', title: id, seenAt });

describe('visited links', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the latest visit first without duplicates', () => {
    rememberVisit(visit('a'));
    rememberVisit(visit('b'));
    rememberVisit(visit('a', 2));
    expect(listVisits().map(({ id, seenAt }) => [id, seenAt])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    forgetVisit('a');
    expect(listVisits().map(({ id }) => id)).toEqual(['b']);
  });

  it('caps the list and ignores corrupt data', () => {
    for (let index = 0; index < 40; index++) rememberVisit(visit(String(index)));
    expect(listVisits()).toHaveLength(30);
    localStorage.setItem('buen-pagador:visited', '{oops');
    expect(listVisits()).toEqual([]);
    localStorage.setItem('buen-pagador:visited', '{}');
    expect(listVisits()).toEqual([]);
  });
});
