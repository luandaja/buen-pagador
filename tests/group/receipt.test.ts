import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addPerson, computeBalances, computeGroupTotals, itemizedShares, newGroup, saveExpense, splitByWeight, toCents, type Group } from '../../src/scripts/group/model';
import { checkReceipt, draftItems, normalizeParsed, parseJsonReply, parseReceiptText, splitUnits, toAmount, type DraftItem } from '../../src/scripts/group/receipt';

const aiReply = JSON.parse(readFileSync(resolve('tests/fixtures/receipt-ai.json'), 'utf8'));
const ocrText = readFileSync(resolve('tests/fixtures/receipt-ocr.txt'), 'utf8');

function friends(): Group {
  let group = newGroup({ title: 'Punta Hermosa' });
  for (const name of ['Ana', 'Beto', 'Caro', 'Dani']) group = addPerson(group, name);
  return group;
}

describe('reading a receipt with AI', () => {
  it('normalizes the reply of the model', () => {
    const parsed = normalizeParsed(aiReply);
    expect(parsed.items).toHaveLength(14);
    expect(parsed.items.reduce((sum, item) => sum + toCents(item.amount), 0)).toBe(45190);
    expect(parsed).toMatchObject({ merchant: 'TP Punta Hermosa', tip: 45.19, total: 497.09 });
    expect(parsed.items[11]).toEqual({ what: 'Agua San Luis Con Gas 350Ml', quantity: 3, amount: 18 });
  });

  it('drops junk lines and keeps sane values', () => {
    const parsed = normalizeParsed({
      merchant: '  ** Café ** ',
      items: [{ name: '', amount: 3 }, { name: 'Pan:', amount: '2,50', quantity: 200 }, { what: 'Gratis', amount: 0 }, null, { name: 'Caro', amount: -1 }],
      tip: 'x',
      total: 0,
    });
    expect(parsed).toEqual({ merchant: 'Café', items: [{ what: 'Pan', quantity: 1, amount: 2.5 }], tip: 0, total: null });
    expect(normalizeParsed(null)).toEqual({ merchant: '', items: [], tip: 0, total: null });
    expect(toAmount(1e9)).toBeNull();
  });

  it('fixes lines where the model wrote the unit price, and ignores impossible totals', () => {
    const parsed = normalizeParsed({ items: [{ name: 'Agua', quantity: 3, unitPrice: 6, amount: 6 }, { name: 'Pan', quantity: 2, unitPrice: 2, amount: 4 }], total: 3 });
    expect(parsed.items.map((item) => item.amount)).toEqual([18, 4]);
    expect(parsed.total).toBeNull();
  });

  it('adds charges on top and subtracts discounts into the shared extras', () => {
    const parsed = normalizeParsed({ items: [{ name: 'Leche', quantity: 2, amount: 9 }, { name: 'Pan', amount: 1 }], charges: 1.8, discount: 0.8, tip: 0, total: 11 });
    expect(parsed).toMatchObject({ tip: 1, total: 11 });
    expect(normalizeParsed({ items: [{ name: 'Pan', amount: 10 }], discount: 2, total: 8 })).toMatchObject({ tip: 0, total: 8 });
  });

  it('ignores charges the prices already include when items and tip match the total', () => {
    const parsed = normalizeParsed({ items: [{ name: 'Menú', amount: 30 }], charges: 5.4, tip: 3, total: 33 });
    expect(parsed).toMatchObject({ tip: 3, total: 33 });
  });

  it('finds the JSON inside a chatty reply', () => {
    expect(parseJsonReply('Claro:\n```json\n{"total": 10}\n```')).toEqual({ total: 10 });
    expect(parseJsonReply('no json')).toBeNull();
    expect(parseJsonReply('{ broken')).toBeNull();
    expect(parseJsonReply('{"a": }')).toBeNull();
  });
});

describe('reading a receipt on the device', () => {
  it('pulls item lines out of noisy OCR text', () => {
    const parsed = parseReceiptText(ocrText);
    const names = parsed.items.map((item) => item.what);
    expect(names).toEqual(expect.arrayContaining(['Duo Mi Causa', 'Leche De Tigre', 'Coca Cola Regular', 'Agua san Luis Con', 'Ceviche']));
    expect(names).not.toContain('RC');
    expect(parsed.items.find((item) => item.what === 'Agua san Luis Con')).toEqual({ what: 'Agua san Luis Con', quantity: 3, amount: 18 });
    expect(parsed.items.length).toBeGreaterThanOrEqual(8);
    expect(parsed).toMatchObject({ tip: 0, total: null });
  });

  it('multiplies the unit price when the line total is missing or unreadable', () => {
    expect(parseReceiptText('pan con pollo 2 5.50\nzzz\nTotal 1 11.00').items).toEqual([{ what: 'Pan con pollo', quantity: 2, amount: 11 }]);
    expect(parseReceiptText('Agua 3 6.00\n99.00').items[0].amount).toBe(18);
  });
});

function assignedDraft(group: Group) {
  const [ana, beto, caro, dani] = group.people.map((person) => person.id);
  const items = draftItems(normalizeParsed(aiReply));
  const water = items.findIndex((item) => item.quantity === 3);
  const all = [...items.slice(0, water), ...splitUnits(items[water]), ...items.slice(water + 1)];
  const owners = [[ana], [beto], [caro], [dani], [ana, beto, caro, dani], [ana], [beto], [caro, dani], [dani], [ana, beto, caro, dani], [ana], [beto], [caro], [dani], [ana, beto, caro, dani], [caro]];
  return all.map((item, index) => ({ ...item, for: owners[index] }));
}

describe('splitting a receipt', () => {
  it('splits units of the same line to the cent', () => {
    const [water] = splitUnits({ id: 'w', what: 'Agua', amount: '10.00', quantity: 3, for: [] });
    expect(splitUnits({ id: 'w', what: 'Agua', amount: '10.00', quantity: 3, for: [] }).map((item) => item.amount)).toEqual(['3.34', '3.33', '3.33']);
    expect(water.quantity).toBe(1);
  });

  it('blocks saving while an item has no owner or the sum does not match the photo', () => {
    const items = draftItems(normalizeParsed(aiReply));
    expect(checkReceipt(items, '45.19', '497.09')).toEqual({ orphans: 14, sum: 497.09, difference: 0, ready: false });
    const assigned = assignedDraft(friends());
    expect(checkReceipt(assigned, '45.19', '497.09')).toEqual({ orphans: 0, sum: 497.09, difference: 0, ready: true });
    expect(checkReceipt(assigned, '40', '497.09')).toMatchObject({ difference: 5.19, ready: false });
    expect(checkReceipt(assigned, '45.19', '')).toMatchObject({ difference: null, ready: false });
    expect(checkReceipt([], '0', '0').ready).toBe(false);
  });

  it('charges every cent of items and tip to someone, matching the receipt total', () => {
    let group = friends();
    const items = assignedDraft(group).map((item: DraftItem) => ({ id: item.id, what: item.what, amount: Number(item.amount), for: item.for }));
    group = saveExpense(group, { id: 'cena', what: 'Cena', amount: 497.09, by: group.people[0].id, items, tip: 45.19 });

    const shares = itemizedShares(group.expenses[0], group.people);
    expect([...shares.values()].reduce((sum, cents) => sum + cents, 0)).toBe(49709);

    const balances = computeBalances(group);
    expect(balances.reduce((sum, balance) => sum + toCents(balance.share), 0)).toBe(49709);
    const collectorShare = toCents(balances[0].share);
    expect(toCents(computeGroupTotals(group).pending)).toBe(49709 - collectorShare);
    expect(balances.every((balance) => balance.share > 0)).toBe(true);
  });

  it('spreads the tip by what each one ate, and evenly when nobody ate anything', () => {
    expect(splitByWeight(100, [3, 1])).toEqual([75, 25]);
    expect(splitByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitByWeight(10, [0, 0])).toEqual([5, 5]);
    const group = friends();
    const tipOnly = saveExpense(group, { id: 't', what: 'Propina', amount: 4, by: group.people[0].id, items: [], tip: 4 });
    expect(computeBalances(tipOnly).map((balance) => balance.share)).toEqual([1, 1, 1, 1]);
  });

  it('shares items of people who left among everyone, and counts them as referenced', () => {
    const group = friends();
    const expense = { id: 'x', what: 'X', amount: 8, by: group.people[0].id, items: [{ id: 'i', what: 'Pan', amount: 8, for: ['gone'] }] };
    expect([...itemizedShares(expense, group.people).values()]).toEqual([200, 200, 200, 200]);
  });
});
