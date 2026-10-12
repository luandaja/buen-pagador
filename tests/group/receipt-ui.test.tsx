import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupApp } from '../../src/islands/group/GroupApp';
import { group, savedGroups } from '../../src/islands/group/store';
import { resetSync } from '../../src/islands/group/sync';
import { resetDatabase } from '../../src/scripts/db';
import { rememberGroup, saveGroup } from '../../src/scripts/group/groups';
import { addPerson, computeBalances, newGroup, toCents } from '../../src/scripts/group/model';
import { readReceipt } from '../../src/scripts/group/read-receipt';
import { loadReceipt } from '../../src/scripts/group/receipts';
import { normalizeParsed } from '../../src/scripts/group/receipt';

vi.mock('../../src/scripts/group/read-receipt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/scripts/group/read-receipt')>()),
  readReceipt: vi.fn(),
}));

const parsed = normalizeParsed(JSON.parse(readFileSync(resolve('tests/fixtures/receipt-ai.json'), 'utf8')));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDatabase();
  resetSync();
  localStorage.clear();
  group.value = null;
  savedGroups.value = [];
  vi.mocked(readReceipt).mockReset();
  vi.mocked(readReceipt).mockResolvedValue({ parsed, source: 'ai', photo: 'data:image/jpeg;base64,FOTO' });
});

afterEach(cleanup);

async function openFriends() {
  let friends = newGroup({ title: 'Punta Hermosa' });
  for (const name of ['Ana', 'Beto', 'Caro', 'Dani']) friends = addPerson(friends, name);
  await saveGroup(friends);
  rememberGroup(friends.id);
  render(<GroupApp />);
  await screen.findByText('📷 Subir boleta');
  return friends;
}

const uploadReceipt = () =>
  fireEvent.change(screen.getByText('📷 Subir boleta').closest('label')!.querySelector('input')!, {
    target: { files: [new File(['x'], 'boleta.jpg', { type: 'image/jpeg' })] },
  });

const items = () => screen.getAllByRole('listitem').filter((node) => node.classList.contains('receipt-item'));
const save = () => screen.getByRole('button', { name: 'Guardar boleta' }) as HTMLButtonElement;

function assign(index: number, name: string) {
  fireEvent.click(within(items()[index]).getByRole('button', { name }));
}

describe('receipt splitter', () => {
  it('reads the receipt, refuses orphans and saves a split that matches the photo', async () => {
    const friends = await openFriends();
    uploadReceipt();
    await screen.findByText('Leída con IA. Revisa los montos.');
    expect(items()).toHaveLength(14);
    expect(screen.getByText('Asignados 0 de 14')).toBeTruthy();
    expect(screen.getByText(/Falta asignar 14 ítems/)).toBeTruthy();
    expect(screen.getByText('Cuadra con la boleta: S/ 497.09 ✓')).toBeTruthy();
    expect(save().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Separar ×3' }));
    expect(items()).toHaveLength(16);
    const names = ['Ana', 'Beto', 'Caro', 'Dani'];
    items().forEach((_, index) => assign(index, index % 5 === 4 ? 'Entre todos' : names[index % 4]));
    expect(screen.getByText('Asignados 16 de 16')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('¿Quién pagó la cuenta?'), { target: { value: friends.people[1].id } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());

    await screen.findByText('Pagó Beto · 16 ítems + propina');
    const [expense] = group.value!.expenses;
    expect(expense).toMatchObject({ what: 'TP Punta Hermosa', amount: 497.09, tip: 45.19, by: friends.people[1].id });
    const shares = computeBalances(group.value!).reduce((sum, balance) => sum + toCents(balance.share), 0);
    expect(shares).toBe(49709);
    await waitFor(async () => expect(await loadReceipt(friends.id, expense.id)).toBe('data:image/jpeg;base64,FOTO'));
  });

  it('shows the gap with the receipt total and closes it as an item or as tip', async () => {
    await openFriends();
    uploadReceipt();
    await screen.findByText('Leída con IA. Revisa los montos.');
    fireEvent.click(within(items()[0]).getByRole('button', { name: /Quitar/ }));
    expect(screen.getByText('Faltan S/ 47.90 para llegar al total de la boleta.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sumar a propina y cargos' }));
    expect((screen.getByLabelText('Propina y cargos') as HTMLInputElement).value).toBe('93.09');
    expect(screen.getByText('Cuadra con la boleta: S/ 497.09 ✓')).toBeTruthy();

    fireEvent.input(screen.getByLabelText('Propina y cargos'), { target: { value: '45.19' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar como ítem' }));
    expect(within(items().at(-1)!).getByLabelText('Ítem')).toHaveProperty('value', 'Diferencia');

    fireEvent.input(screen.getByLabelText('Total de la boleta (con propina)'), { target: { value: '400' } });
    expect(screen.getByText('Sobran S/ 97.09 respecto al total de la boleta.')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Total de la boleta (con propina)'), { target: { value: '' } });
    expect(screen.getByText('Escribe el total de la boleta para comprobar que cuadre.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('📷 Subir boleta')).toBeTruthy();
  });

  it('lets you type the items when the receipt cannot be read, then edit and delete the expense', async () => {
    vi.mocked(readReceipt).mockRejectedValueOnce(new Error('ocr'));
    await openFriends();
    uploadReceipt();
    await screen.findByText('No pudimos leer la boleta. Agrega los ítems a mano.');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar ítem' }));
    fireEvent.input(within(items()[0]).getByLabelText('Ítem'), { target: { value: 'Pizza' } });
    fireEvent.input(within(items()[0]).getByLabelText('Importe Pizza'), { target: { value: '40' } });
    assign(0, 'Entre todos');
    fireEvent.input(screen.getByLabelText('¿En qué?'), { target: { value: 'Cena' } });
    fireEvent.input(screen.getByLabelText('Total de la boleta (con propina)'), { target: { value: '40' } });
    fireEvent.click(save());
    await screen.findByText('Pagó Ana · 1 ítem');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Cena' }));
    expect((screen.getByLabelText('Total de la boleta (con propina)') as HTMLInputElement).value).toBe('40.00');
    fireEvent.click(screen.getByRole('button', { name: 'Borrar gasto' }));
    await waitFor(() => expect(group.value!.expenses).toHaveLength(0));
  });

  it('reads on the device when the AI is not available', async () => {
    vi.mocked(readReceipt).mockResolvedValueOnce({ parsed: { ...parsed, total: null }, source: 'device', photo: 'data:x' });
    await openFriends();
    fireEvent.change(screen.getByText('📷 Subir boleta').closest('label')!.querySelector('input')!, { target: { files: [] } });
    expect(readReceipt).not.toHaveBeenCalled();
    uploadReceipt();
    await screen.findByText('Leída en tu celular. Revisa los ítems y montos.');
    expect(screen.getByText('Escribe el total de la boleta para comprobar que cuadre.')).toBeTruthy();
  });

  it('lets you read on the device only, and remembers it', async () => {
    await openFriends();
    expect(screen.getByText(/se envía a un servicio de IA/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Leer solo en mi celular'));
    expect(screen.getByText(/no sale de tu celular/)).toBeTruthy();
    uploadReceipt();
    await screen.findByText('Leída con IA. Revisa los montos.');
    expect(vi.mocked(readReceipt).mock.calls[0][1]).toBe(true);
    expect(localStorage.getItem('buen-pagador:receipt-local-only')).toBe('1');
  });

  it('hides the upload until there are people', async () => {
    await saveGroup(newGroup({ title: 'Vacía' }));
    render(<GroupApp />);
    await screen.findByLabelText('Nombre de la cuenta');
    expect(screen.queryByText('📷 Subir boleta')).toBeNull();
  });
});
