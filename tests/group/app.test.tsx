import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupApp, mountGroupApp } from '../../src/islands/group/GroupApp';
import { parseAmount } from '../../src/islands/group/ExpenseForm';
import { flush, group, savedGroups } from '../../src/islands/group/store';
import { resetDatabase } from '../../src/scripts/db';
import { listGroups, rememberGroup, saveGroup } from '../../src/scripts/group/groups';
import { addPerson, newGroup } from '../../src/scripts/group/model';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDatabase();
  localStorage.clear();
  group.value = null;
  savedGroups.value = [];
  document.head.innerHTML = '<link rel="icon" href="x" />';
  window.confirm = vi.fn(() => true);
});

afterEach(cleanup);

async function openApp() {
  render(<GroupApp />);
  await screen.findByLabelText('Nombre de la cuenta');
}

function addPeople(...names: string[]) {
  for (const name of names) {
    fireEvent.input(screen.getByLabelText('Nombre'), { target: { value: name } });
    fireEvent.submit(screen.getByLabelText('Nombre').closest('form')!);
  }
}

function addExpense(what: string, amount: string) {
  fireEvent.input(screen.getByLabelText('¿En qué?'), { target: { value: what } });
  fireEvent.input(screen.getByLabelText('¿Cuánto?'), { target: { value: amount } });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar gasto' }));
}

const personRow = (name: string) => screen.getByText(name, { selector: '.person strong' }).closest('li')!;

describe('group page', () => {
  it('asks for people before expenses', async () => {
    await openApp();
    expect(screen.getByText('Primero agrega a las personas.')).toBeTruthy();
    expect(screen.queryByText(/Todavía no hay gastos/)).toBeNull();
    expect(screen.getByLabelText('Nombre').getAttribute('placeholder')).toBe('Tu nombre');
  });

  it('splits expenses, marks who paid and remembers the group', async () => {
    await openApp();
    fireEvent.input(screen.getByLabelText('Nombre de la cuenta'), { target: { value: 'Cusco' } });
    addPeople('Ana', 'Beto', '  ', 'Caro');
    expect(within(personRow('Ana')).getByText('Cobra y reparte')).toBeTruthy();

    addExpense('Hotel', '100');
    expect(screen.getByText('Pagó Ana · Entre todos')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('¿Quién pagó?'), { target: { value: group.value!.people[1].id } });
    fireEvent.click(screen.getByRole('button', { name: 'Ana', pressed: true }));
    addExpense('Taxi', '30,00');
    expect(screen.getByText('Pagó Beto · Entre Beto y Caro')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ana', pressed: true })).toBeTruthy();

    expect(within(personRow('Caro')).getByText('Debe S/ 48.33')).toBeTruthy();
    expect(screen.getByText('S/ 66.66', { selector: '.progress-hero' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Caro: marcar como pagado' }));
    expect(within(personRow('Caro')).getByText('Pagó S/ 48.33')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Beto: marcar como pagado' }));
    expect(screen.getByText('¡Cuentas claras!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Beto: deshacer' }));

    await flush();
    const [stored] = await listGroups();
    expect(stored).toMatchObject({ title: 'Cusco', expenses: [{ what: 'Hotel' }, { what: 'Taxi', amount: 30 }] });
    expect(document.title).toBe('🧾 Cusco · El Buen Pagador');
  });

  it('rejects incomplete expenses and keeps at least one person in the split', async () => {
    await openApp();
    addPeople('Ana');
    addExpense('', '10');
    expect(screen.getByRole('alert').textContent).toBe('Pon en qué fue y un monto mayor a 0.');
    addExpense('Pan', '0');
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ana', pressed: true }));
    expect(screen.getByRole('button', { name: 'Ana', pressed: true })).toBeTruthy();
  });

  it('edits, cancels and deletes an expense', async () => {
    await openApp();
    addPeople('Ana', 'Beto');
    addExpense('Cena', '80');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Cena' }));
    expect((screen.getByLabelText('¿Cuánto?') as HTMLInputElement).value).toBe('80');
    fireEvent.input(screen.getByLabelText('¿Cuánto?'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('S/ 90', { selector: '.expense-amount' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Editar Cena' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Agregar gasto' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Editar Cena' }));
    fireEvent.click(screen.getByRole('button', { name: 'Borrar gasto' }));
    expect(screen.queryByText('Cena')).toBeNull();
  });

  it('removes people who are not in any expense', async () => {
    await openApp();
    addPeople('Ana', 'Beto');
    addExpense('Cena', '80');
    addPeople('Dani');
    expect(screen.queryByRole('button', { name: 'Quitar a Ana' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar a Dani' }));
    expect(screen.queryByText('Dani')).toBeNull();
  });

  it('picks a listed or typed emoji for the group', async () => {
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: 'Usar ✈️' }));
    expect(screen.getByLabelText('Emoji y colores de la cuenta').textContent).toBe('✈️');
    fireEvent.input(screen.getByLabelText('Otro emoji'), { target: { value: 'ab' } });
    expect(screen.getByLabelText('Emoji y colores de la cuenta').textContent).toBe('✈️');
    fireEvent.input(screen.getByLabelText('Otro emoji'), { target: { value: '🦙' } });
    expect(screen.getByLabelText('Emoji y colores de la cuenta').textContent).toBe('🦙');
    expect(document.querySelector('link[rel="icon"]')!.getAttribute('href')).toContain('🦙');
    fireEvent.input(screen.getByLabelText('Moneda'), { target: { value: '$' } });
    expect(group.value!.currency).toBe('$');
  });

  it('picks a palette and closes the menu with Escape or a click outside', async () => {
    await openApp();
    const picker = document.querySelector<HTMLDetailsElement>('.emoji-picker')!;
    picker.open = true;
    fireEvent.click(screen.getByRole('button', { name: 'Colores Selva' }));
    expect(group.value!.palette).toBe('selva');
    await waitFor(() => expect(document.documentElement.dataset.palette).toBe('selva'));
    expect(screen.getByRole('button', { name: 'Colores Selva' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.pointerDown(screen.getByLabelText('Otro emoji'));
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(picker.open).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(picker.open).toBe(false);
    picker.open = true;
    fireEvent.pointerDown(document.body);
    expect(picker.open).toBe(false);
  });

  it('switches, creates and deletes saved groups', async () => {
    const lima = { ...addPerson(newGroup({ title: 'Lima', emoji: '🍣' }), 'Ana'), updatedAt: 1 };
    const cusco = { ...newGroup({ title: 'Cusco' }), updatedAt: 2 };
    await saveGroup(lima);
    await saveGroup(cusco);
    rememberGroup(cusco.id);
    await openApp();
    expect((screen.getByLabelText('Nombre de la cuenta') as HTMLInputElement).value).toBe('Cusco');
    await screen.findByText('Mis cuentas (2)');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir Lima' }));
    await waitFor(() => expect((screen.getByLabelText('Nombre de la cuenta') as HTMLInputElement).value).toBe('Lima'));

    fireEvent.click(screen.getByRole('button', { name: 'Nueva cuenta' }));
    await waitFor(() => expect((screen.getByLabelText('Nombre de la cuenta') as HTMLInputElement).value).toBe(''));

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    const [, limaRemove] = screen.getAllByRole('button', { name: 'Borrar de este dispositivo' });
    fireEvent.click(limaRemove);
    expect(await listGroups()).toHaveLength(2);
    fireEvent.click(limaRemove);
    await screen.findByText('Mis cuentas (1)');
  });

  it('resets to a new group when the open one is deleted', async () => {
    const cusco = addPerson(newGroup({ title: 'Cusco' }), 'Ana');
    await saveGroup(cusco);
    rememberGroup(cusco.id);
    await openApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Borrar de este dispositivo' }));
    await waitFor(() => expect((screen.getByLabelText('Nombre de la cuenta') as HTMLInputElement).value).toBe(''));
    await screen.findByText('Mis cuentas (0)');
  });

  it('saves when the page is hidden and mounts into a root element', async () => {
    const root = document.createElement('main');
    root.innerHTML = '<p>Cargando…</p>';
    document.body.append(root);
    mountGroupApp(root);
    await waitFor(() => expect(root.querySelector('#groupTitle')).toBeTruthy());
    fireEvent.input(root.querySelector('#groupTitle')!, { target: { value: 'Playa' } });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(async () => expect((await listGroups()).map((saved) => saved.title)).toEqual(['Playa']));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    root.remove();
  });
});

describe('parseAmount', () => {
  it('accepts decimals with comma or dot and rejects the rest', () => {
    expect(parseAmount('12,345')).toBe(12.35);
    expect(parseAmount('7.5')).toBe(7.5);
    expect(parseAmount('-1')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});
