import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupApp } from '../../src/islands/group/GroupApp';
import { receiptSet, refreshReceipts } from '../../src/islands/group/receipts';
import { group, savedGroups } from '../../src/islands/group/store';
import { resetSync } from '../../src/islands/group/sync';
import { resetDatabase } from '../../src/scripts/db';
import { deleteGroup, rememberGroup, saveGroup } from '../../src/scripts/group/groups';
import { addPerson, newGroup, saveExpense } from '../../src/scripts/group/model';
import { deleteReceipt, loadReceipt, receiptIds, saveReceipt } from '../../src/scripts/group/receipts';
import { receiptFromFile } from '../../src/scripts/image';

vi.mock('../../src/scripts/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/scripts/image')>()),
  receiptFromFile: vi.fn(async () => 'data:image/jpeg;base64,BOLETA'),
}));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDatabase();
  resetSync();
  localStorage.clear();
  group.value = null;
  savedGroups.value = [];
  receiptSet.value = new Set();
});

afterEach(cleanup);

describe('receipts storage', () => {
  it('saves, lists, loads and deletes receipts per group', async () => {
    await saveReceipt('g1', 'e1', 'data:1');
    await saveReceipt('g1', 'e2', 'data:2');
    await saveReceipt('g10', 'e1', 'data:other');
    expect([...(await receiptIds('g1'))]).toEqual(['e1', 'e2']);
    expect(await loadReceipt('g1', 'e2')).toBe('data:2');
    await deleteReceipt('g1', 'e2');
    expect(await loadReceipt('g1', 'e2')).toBeNull();
    await deleteGroup('g1');
    expect([...(await receiptIds('g1'))]).toEqual([]);
    expect([...(await receiptIds('g10'))]).toEqual(['e1']);
  });

  it('refreshes the marks only for the open group', async () => {
    await refreshReceipts();
    expect(receiptSet.value.size).toBe(0);
    group.value = newGroup();
    await saveReceipt(group.value.id, 'e1', 'data:1');
    await refreshReceipts();
    expect([...receiptSet.value]).toEqual(['e1']);
  });
});

async function openTrip() {
  let trip = addPerson(addPerson(newGroup({ title: 'Cusco' }), 'Ana'), 'Beto');
  trip = saveExpense(trip, { id: 'hotel', what: 'Hotel', amount: 100, by: trip.people[0].id });
  await saveGroup(trip);
  rememberGroup(trip.id);
  render(<GroupApp />);
  await screen.findByText('Hotel');
  return trip;
}

const upload = () =>
  fireEvent.change(screen.getByText(/Subir foto|Cambiar foto/).closest('label')!.querySelector('input')!, {
    target: { files: [new File(['x'], 'boleta.jpg', { type: 'image/jpeg' })] },
  });

describe('expense details', () => {
  it('adds a shared note and a local receipt to an expense', async () => {
    const trip = await openTrip();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Hotel' }));
    fireEvent.input(screen.getByLabelText('Nota'), { target: { value: '  Hab. 204  ' } });
    upload();
    await screen.findByAltText('Boleta de Hotel');
    expect(screen.getByText('Detalle')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await screen.findByLabelText('Tiene foto de la boleta');
    expect(screen.getByText('Hab. 204')).toBeTruthy();
    expect(group.value!.expenses[0].note).toBe('Hab. 204');
    expect(await loadReceipt(trip.id, 'hotel')).toBe('data:image/jpeg;base64,BOLETA');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Hotel' }));
    await screen.findByAltText('Boleta de Hotel');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto' }));
    fireEvent.input(screen.getByLabelText('Nota'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByLabelText('Tiene foto de la boleta')).toBeNull());
    expect(group.value!.expenses[0].note).toBeUndefined();
    expect(await loadReceipt(trip.id, 'hotel')).toBeNull();
  });

  it('keeps the receipt when saving before it finished loading, and removes it with the expense', async () => {
    const trip = await openTrip();
    await saveReceipt(trip.id, 'hotel', 'data:old');
    fireEvent.click(screen.getByRole('button', { name: 'Editar Hotel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await loadReceipt(trip.id, 'hotel')).toBe('data:old');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Hotel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Borrar gasto' }));
    await waitFor(async () => expect(await loadReceipt(trip.id, 'hotel')).toBeNull());
  });

  it('adds a receipt to a new expense and explains unreadable images', async () => {
    const trip = await openTrip();
    vi.mocked(receiptFromFile).mockRejectedValueOnce(new Error('bad'));
    upload();
    await screen.findByText('No pudimos abrir esa imagen.');
    upload();
    await screen.findByAltText('Boleta de Gastos');
    fireEvent.input(screen.getByLabelText('¿En qué?'), { target: { value: 'Cena' } });
    fireEvent.input(screen.getByLabelText('¿Cuánto?'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar gasto' }));
    const cena = group.value!.expenses.find((expense) => expense.what === 'Cena')!;
    await waitFor(async () => expect(await loadReceipt(trip.id, cena.id)).toBe('data:image/jpeg;base64,BOLETA'));
    expect(screen.queryByAltText(/Boleta/)).toBeNull();
    fireEvent.change(screen.getByText('Subir foto').closest('label')!.querySelector('input')!, { target: { files: [] } });
  });
});
