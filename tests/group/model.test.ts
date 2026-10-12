import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());
import {
  addPerson,
  beneficiaries,
  computeBalances,
  computeGroupTotals,
  isValidEmoji,
  newGroup,
  removeExpense,
  removePerson,
  renamePerson,
  saveExpense,
  splitCents,
  toggleSettled,
  type Group,
} from '../../src/scripts/group/model';

function trip(): Group {
  let group = newGroup({ title: 'Cusco' });
  for (const name of ['Ana', 'Beto', 'Caro']) group = addPerson(group, name);
  return group;
}

const ids = (group: Group) => group.people.map((person) => person.id);
const summary = (group: Group) => computeBalances(group).map((balance) => [balance.status, balance.net, balance.pending]);

function hotelAndTaxi() {
  let group = trip();
  const [ana, beto, caro] = ids(group);
  group = saveExpense(group, { id: 'e1', what: 'Hotel', amount: 100, by: ana });
  group = saveExpense(group, { id: 'e2', what: 'Taxi', amount: 30, by: beto, for: [beto, caro] });
  return { group, ana, beto, caro };
}

describe('splitCents', () => {
  it('spreads the remainder over the first parts', () => {
    expect(splitCents(1000, 3)).toEqual([334, 333, 333]);
    expect(splitCents(0, 2)).toEqual([0, 0]);
    expect(splitCents(100, 0)).toEqual([]);
  });
});

describe('people', () => {
  it('orders people and expenses by creation even within the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const group = saveExpense(saveExpense(trip(), { id: 'b', what: 'B', amount: 1, by: 'x' }), { id: 'a', what: 'A', amount: 1, by: 'x' });
    expect(group.people.map((person) => person.at)).toEqual([1000, 1001, 1002]);
    expect(group.expenses.map((expense) => expense.at)).toEqual([1000, 1001]);
  });

  it('adds trimmed names with distinct emojis and ignores blanks', () => {
    const group = addPerson(trip(), '   ');
    expect(group.people.map((person) => person.name)).toEqual(['Ana', 'Beto', 'Caro']);
    expect(new Set(group.people.map((person) => person.emoji)).size).toBe(3);
  });

  it('renames and refuses blank names', () => {
    const group = trip();
    const [ana] = ids(group);
    expect(renamePerson(group, ana, ' Anita ').people[0].name).toBe('Anita');
    expect(renamePerson(group, ana, ' ')).toBe(group);
  });

  it('only removes people without expenses', () => {
    const { group, ana, beto } = hotelAndTaxi();
    expect(removePerson(group, ana)).toBe(group);
    expect(removePerson(group, beto)).toBe(group);
    const free = addPerson(group, 'Dani');
    expect(removePerson(free, free.people[3].id).people).toHaveLength(3);
  });
});

describe('expenses', () => {
  it('adds, edits and removes', () => {
    const group = trip();
    const [ana] = ids(group);
    const added = saveExpense(group, { id: 'e1', what: 'Hotel', amount: 300, by: ana });
    const edited = saveExpense(added, { id: 'e1', what: 'Hotel', amount: 330, by: ana });
    expect(edited.expenses).toEqual([{ id: 'e1', what: 'Hotel', amount: 330, by: ana }]);
    expect(added.expenses[0].at).toBeGreaterThan(0);
    expect(removeExpense(edited, 'e1').expenses).toEqual([]);
  });

  it('splits among everyone when "for" is empty or only has people who left', () => {
    const group = trip();
    expect(beneficiaries({ id: 'e', what: 'x', amount: 1, by: 'a', for: [] }, group.people)).toEqual(ids(group));
    expect(beneficiaries({ id: 'e', what: 'x', amount: 1, by: 'a', for: ['gone'] }, group.people)).toEqual(ids(group));
  });
});

describe('balances', () => {
  it('computes what each one owes the collector to the cent', () => {
    const { group } = hotelAndTaxi();
    expect(summary(group)).toEqual([
      ['collector', 66.66, 66.66],
      ['owes', -18.33, -18.33],
      ['owes', -48.33, -48.33],
    ]);
    expect(computeGroupTotals(group)).toEqual({ spent: 130, pending: 66.66, settledPeople: 0, peopleToSettle: 2 });
  });

  it('marks people the collector owes, and people who are even', () => {
    let group = trip();
    const [ana, beto] = ids(group);
    group = saveExpense(group, { id: 'e1', what: 'Cena', amount: 90, by: beto });
    group = saveExpense(group, { id: 'e2', what: 'Taxi', amount: 20, by: ana, for: [ana, beto] });
    expect(summary(group).map(([status]) => status)).toEqual(['collector', 'owed', 'owes']);
    expect(computeBalances(trip()).map((balance) => balance.status)).toEqual(['collector', 'even', 'even']);
    expect(computeGroupTotals(trip())).toEqual({ spent: 0, pending: 0, settledPeople: 0, peopleToSettle: 0 });
  });

  it('ignores expenses paid by someone who is no longer in the group', () => {
    const group = saveExpense(trip(), { id: 'e1', what: 'Hotel', amount: 30, by: 'gone' });
    expect(summary(group)).toEqual([
      ['collector', -10, -10],
      ['owes', -10, -10],
      ['owes', -10, -10],
    ]);
  });
});

describe('paid / not paid', () => {
  it('toggles a debtor to settled and back', () => {
    const { group, caro } = hotelAndTaxi();
    const paid = toggleSettled(group, caro);
    expect(summary(paid)[2]).toEqual(['settled', -48.33, 0]);
    expect(computeGroupTotals(paid)).toMatchObject({ pending: 18.33, settledPeople: 1 });
    expect(summary(toggleSettled(paid, caro))[2]).toEqual(['owes', -48.33, -48.33]);
  });

  it('shows what is still missing after a new expense, and settles the rest on the next toggle', () => {
    const { group, ana, caro } = hotelAndTaxi();
    const later = saveExpense(toggleSettled(group, caro), { id: 'e3', what: 'Museo', amount: 30, by: ana });
    expect(summary(later)[2]).toEqual(['owes', -58.33, -10]);
    expect(summary(toggleSettled(later, caro))[2]).toEqual(['settled', -58.33, 0]);
  });

  it('does nothing for the collector, people who are even or unknown ids', () => {
    const { group, ana } = hotelAndTaxi();
    expect(toggleSettled(group, ana)).toBe(group);
    expect(toggleSettled(group, 'nobody')).toBe(group);
    const even = trip();
    expect(toggleSettled(even, even.people[1].id)).toBe(even);
  });
});

describe('group emoji', () => {
  it('accepts exactly one emoji', () => {
    expect(isValidEmoji('✈️')).toBe(true);
    expect(isValidEmoji(' 👨‍👩‍👧 ')).toBe(true);
    expect(isValidEmoji('🍕🍕')).toBe(false);
    expect(isValidEmoji('a')).toBe(false);
    expect(isValidEmoji('')).toBe(false);
  });
});
