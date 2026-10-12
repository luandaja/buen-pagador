import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addPerson, type Band, computeBalances, computeGroupTotals, itemizedShares, newGroup, saveExpense, splitByWeight, toCents, type Group } from '../../src/scripts/group/model';
import { checkReceipt, draftFromExpense, draftItems, expenseFromDraft, locateDraft, locateItems, normalizeParsed, parseJsonReply, parseReceiptLines, parseReceiptText, splitUnits, toAmount, toBand, type DraftItem } from '../../src/scripts/group/receipt';

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

  it('keeps where each line sits in the photo, in fractions or per mille', () => {
    const parsed = normalizeParsed({ items: [{ name: 'Pan', amount: 2, top: 0.1, bottom: 0.15 }, { name: 'Té', amount: 3, top: 400, bottom: 450 }, { name: 'Mal', amount: 1, top: 0.5, bottom: 0.4 }, { name: 'Sin', amount: 1 }] });
    expect(parsed.items.map((item) => item.band)).toEqual([{ top: 0.1, bottom: 0.15 }, { top: 0.4, bottom: 0.45 }, undefined, undefined]);
    expect(toBand(-1, 0.2)).toBeUndefined();
    expect(toBand(0.2, 2000)).toBeUndefined();
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

  it('locates items read on the device by their OCR line', () => {
    const parsed = parseReceiptLines([{ text: 'Pan 2 1.50', band: { top: 0.3, bottom: 0.32 } }, { text: '3.00' }]);
    expect(parsed.items).toEqual([{ what: 'Pan', quantity: 2, amount: 3, band: { top: 0.3, bottom: 0.32 } }]);
    expect(draftItems(parsed)[0].band).toEqual({ top: 0.3, bottom: 0.32 });
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

describe('locating items in the photo', () => {
  const line = (text: string, top: number) => ({ text, band: { top, bottom: top + 0.02 } });
  const ocr = [
    line('TIENDA EJEMPLO', 0.02),
    line('RUC 123', 0.05),
    line('Fecha 01/01', 0.08),
    line('Lomo saltado', 0.3),
    line('42.00', 0.32),
    line('Chicha morada 1 9.50', 0.36),
    line('xx garbled xx', 0.4),
    line('Café americano 1 7.00', 0.44),
    line('TOTAL 58.50', 0.5),
  ];

  it('finds each item past the header, joins a name with its amount line below, and fills gaps between neighbours', () => {
    const items: { what: string; amount: number; band?: Band }[] = [
      { what: 'Lomo saltado', amount: 42 },
      { what: 'Chicha morada', amount: 9.5 },
      { what: 'Pisco sour', amount: 18 },
      { what: 'Café americano', amount: 7 },
    ];
    expect(locateItems(items, ocr).map((item) => item.band)).toEqual([
      { top: 0.3, bottom: 0.34 },
      { top: 0.36, bottom: 0.38 },
      { top: 0.38, bottom: 0.44 },
      { top: 0.44, bottom: 0.46 },
    ]);
  });

  it('leaves items it cannot place and keeps bands already known', () => {
    expect(locateItems<{ what: string; amount: number; band?: Band }>([{ what: 'Nada parecido', amount: 99 }], ocr)[0].band).toBeUndefined();
    expect(locateItems([{ what: 'Zzz', amount: 1 }, { what: 'Zzz', amount: 2 }], [])).toEqual([{ what: 'Zzz', amount: 1 }, { what: 'Zzz', amount: 2 }]);
    const known = { id: 'k', what: 'Lomo saltado', amount: '42.00', quantity: 1, for: [], band: { top: 0.9, bottom: 0.95 } };
    const fresh = { id: 'f', what: 'Café americano', amount: '7.00', quantity: 1, for: [] };
    expect(locateDraft([known, fresh], ocr).map((item) => item.band)).toEqual([{ top: 0.9, bottom: 0.95 }, { top: 0.44, bottom: 0.46 }]);
  });
});

describe('splitting a receipt', () => {
  it('keeps the photo band when splitting units and when saving and reopening', () => {
    const band = { top: 0.5, bottom: 0.55 };
    const units = splitUnits({ id: 'w', what: 'Agua', amount: '6.00', quantity: 2, for: [], band });
    expect(units.map((item) => item.band)).toEqual([band, band]);
    const expense = expenseFromDraft({ what: 'Cena', by: 'a', items: [{ ...units[0], for: ['a'] }], tip: '', total: '3' }, { id: 'e' });
    expect(expense.items![0].band).toEqual(band);
    expect(draftFromExpense(expense).items[0].band).toEqual(band);
  });

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
