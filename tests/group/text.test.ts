import { describe, expect, it } from 'vitest';
import { addPerson, computeBalances, newGroup, saveExpense, toggleSettled, type Group } from '../../src/scripts/group/model';
import { amongText, listNames, payerName, statusText, summaryText, toggleLabel } from '../../src/scripts/group/text';

function group(): Group {
  let current = newGroup();
  for (const name of ['Ana', 'Beto', 'Caro']) current = addPerson(current, name);
  const [ana, beto, caro] = current.people.map((person) => person.id);
  current = saveExpense(current, { id: 'e1', what: 'Cena', amount: 90, by: beto });
  current = saveExpense(current, { id: 'e2', what: 'Taxi', amount: 20, by: ana, for: [ana, caro] });
  return current;
}

const texts = (current: Group) => computeBalances(current).map((balance) => [statusText(balance, 'S/'), toggleLabel(balance)]);

describe('status text', () => {
  it('describes each person', () => {
    expect(texts(group())).toEqual([
      ['Cobra y reparte', 'Ana: marcar como pagado'],
      ['Le deben S/ 60', 'Beto: marcar como recibido'],
      ['Debe S/ 40', 'Caro: marcar como pagado'],
    ]);
  });

  it('describes settled and partially settled people', () => {
    let current = group();
    const [, beto, caro] = current.people.map((person) => person.id);
    current = toggleSettled(toggleSettled(current, beto), caro);
    expect(texts(current).slice(1)).toEqual([
      ['Recibió S/ 60', 'Beto: deshacer'],
      ['Pagó S/ 40', 'Caro: deshacer'],
    ]);
    current = saveExpense(current, { id: 'e3', what: 'Museo', amount: 30, by: current.people[0].id });
    expect(texts(current).slice(1).map(([text]) => text)).toEqual([
      'Recibió S/\u00a060 · debe S/\u00a010 más',
      'Pagó S/\u00a040 · debe S/\u00a010 más',
    ]);
  });

  it('says when someone is even', () => {
    const current = addPerson(addPerson(newGroup(), 'Ana'), 'Beto');
    expect(texts(current)[1][0]).toBe('Está a mano');
  });

  it('says what is still owed to someone who was partly paid back', () => {
    let current = group();
    const [ana, beto] = current.people.map((person) => person.id);
    current = toggleSettled(current, beto);
    current = saveExpense(current, { id: 'e3', what: 'Bus', amount: 20, by: beto, for: [ana, beto] });
    expect(texts(current)[1][0]).toBe('Recibió S/\u00a060 · le deben S/\u00a010 más');
  });
});

describe('expense text', () => {
  it('names who paid and who shares it', () => {
    const current = group();
    const [cena, taxi] = current.expenses;
    expect(amongText(cena, current.people)).toBe('Entre todos');
    expect(amongText(taxi, current.people)).toBe('Entre Ana y Caro');
    expect(payerName(cena, current.people)).toBe('Beto');
    expect(payerName({ ...cena, by: 'gone' }, current.people)).toBe('—');
  });

  it('joins names in Spanish', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['Ana'])).toBe('Ana');
    expect(listNames(['Ana', 'Beto', 'Caro'])).toBe('Ana, Beto y Caro');
  });
});

describe('summary text', () => {
  it('lists totals and each person, with the view link when shared', () => {
    const current = { ...group(), title: 'Cena', emoji: '🍕' };
    expect(summaryText(current, 'https://x/c#id.key')).toBe(
      [
        '🍕 Cena',
        'Gastado: S/ 110',
        'Falta cobrar: S/ 40 (0/2 pagaron)',
        '',
        '💰 Ana: Cobra y reparte',
        '• Beto: Le deben S/ 60',
        '• Caro: Debe S/ 40',
        '',
        'Detalle: https://x/c#id.key',
      ].join('\n').replace(/S\/ /g, 'S/ '),
    );
  });

  it('celebrates when everyone paid and names untitled groups', () => {
    let current = { ...group(), title: ' ' };
    for (const person of current.people.slice(1)) current = toggleSettled(current, person.id);
    const text = summaryText(current);
    expect(text.split('\n').slice(0, 3)).toEqual(['🧾 Cuenta sin nombre', 'Gastado: S/ 110', '¡Cuentas claras! Todos pagaron.']);
    expect(text).toContain('✓ Caro: Pagó S/ 40');
    expect(text).not.toContain('Detalle');
  });
});
