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
  ocrOnDevice: vi.fn(async () => [
    { text: 'Duo Carretillero 1 47.90', band: { top: 0.2, bottom: 0.22 } },
    { text: 'Pollo Saltado 1 37.90', band: { top: 0.25, bottom: 0.27 } },
  ]),
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
  Element.prototype.scrollTo = vi.fn();
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

describe('receipt photo', () => {
  it('shows the photo, finds lines on the device and highlights the chosen item', async () => {
    await openFriends();
    uploadReceipt();
    await screen.findByAltText('Foto de la boleta');
    const locate = await screen.findByRole('button', { name: 'Ver Pollo Saltado en la boleta' });
    expect(screen.queryByRole('button', { name: 'Ver Filete Light en la boleta' })).toBeNull();
    fireEvent.click(locate);
    const band = document.querySelector<HTMLElement>('.receipt-band')!;
    expect(band.style.top).toBe('25.0%');
    expect(band.style.height).toBe('2.0%');
    expect(locate.getAttribute('aria-pressed')).toBe('true');
    fireEvent.focusIn(within(items()[0]).getByLabelText('Ítem'));
    expect(document.querySelector<HTMLElement>('.receipt-band')!.style.top).toBe('20.0%');
    expect(screen.getByText('2×')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar' }));
    expect(screen.getByText('3×')).toBeTruthy();
    for (let step = 0; step < 4; step++) fireEvent.click(screen.getByRole('button', { name: 'Ampliar' }));
    expect(screen.getByRole('button', { name: 'Ampliar' })).toHaveProperty('disabled', true);
    for (let step = 0; step < 5; step++) fireEvent.click(screen.getByRole('button', { name: 'Reducir' }));
    expect(screen.getByText('1×')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reducir' })).toHaveProperty('disabled', true);
  });

  it('opens the photo full screen with its own zoom and closes it', async () => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    await openFriends();
    uploadReceipt();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver en grande' }));
    const viewer = document.querySelector('.receipt-viewer')!;
    expect(viewer.querySelector('img')).toBeTruthy();
    fireEvent.click(within(viewer as HTMLElement).getByRole('button', { name: 'Ampliar' }));
    expect((viewer.querySelector('.receipt-viewer-image') as HTMLElement).style.width).toBe('150%');
    fireEvent.click(within(viewer as HTMLElement).getByRole('button', { name: 'Cerrar' }));
    expect(document.querySelector('.receipt-viewer')).toBeNull();
  });

  it('brings back the saved photo and its marks when reopening the receipt', async () => {
    const friends = await openFriends();
    uploadReceipt();
    await screen.findByRole('button', { name: 'Ver Pollo Saltado en la boleta' });
    items().forEach((_, index) => assign(index, 'Entre todos'));
    fireEvent.click(save());
    await screen.findByText(/14 ítems \+ propina/);
    fireEvent.click(screen.getByRole('button', { name: 'Editar TP Punta Hermosa' }));
    expect(await screen.findByAltText('Foto de la boleta')).toHaveProperty('src', 'data:image/jpeg;base64,FOTO');
    expect(screen.getByRole('button', { name: 'Ver Pollo Saltado en la boleta' })).toBeTruthy();
    expect(group.value!.expenses[0].items![1].band).toEqual({ top: 0.25, bottom: 0.27 });
    expect(friends.id).toBe(group.value!.id);
  });
});

describe('receipt splitter', () => {
  it('saves with items still unassigned, charges them to whoever paid and lets you assign them later', async () => {
    const friends = await openFriends();
    uploadReceipt();
    await screen.findByText('Leída con IA. Revisa los montos.');
    expect(screen.getByText('Puedes guardar y asignarlos después. Mientras tanto los cubre quien pagó la cuenta.')).toBeTruthy();
    assign(0, 'Beto');
    fireEvent.click(save());
    await screen.findByText('Pagó Ana · 14 ítems + propina · 13 sin asignar');
    const owes = computeBalances(group.value!).find((balance) => balance.person.name === 'Beto')!;
    expect(owes.share).toBeGreaterThan(47.9);
    expect(owes.share).toBeLessThan(60);
    fireEvent.click(screen.getByRole('button', { name: 'Editar TP Punta Hermosa' }));
    expect(await screen.findByText('Asignados 1 de 14')).toBeTruthy();
    expect(friends.id).toBe(group.value!.id);
  });

  it('corrects the quantity of a line and splits it into units', async () => {
    await openFriends();
    uploadReceipt();
    await screen.findByText('Leída con IA. Revisa los montos.');
    const first = within(items()[0]);
    expect(first.getByRole('button', { name: 'Menos unidades de Duo Carretillero' })).toHaveProperty('disabled', true);
    fireEvent.click(first.getByRole('button', { name: 'Más unidades de Duo Carretillero' }));
    expect(first.getByText('×2')).toBeTruthy();
    const water = within(items()[11]);
    fireEvent.click(water.getByRole('button', { name: /Menos unidades/ }));
    fireEvent.click(water.getByRole('button', { name: /Menos unidades/ }));
    expect(water.queryByRole('button', { name: /Separar/ })).toBeNull();
    fireEvent.click(first.getByRole('button', { name: 'Separar ×2' }));
    expect(items()).toHaveLength(15);
    expect(within(items()[0]).getByLabelText('Importe Duo Carretillero')).toHaveProperty('value', '23.95');
  });

  it('reads the receipt and saves a split that matches the photo', async () => {
    const friends = await openFriends();
    uploadReceipt();
    await screen.findByText('Leída con IA. Revisa los montos.');
    expect(items()).toHaveLength(14);
    expect(screen.getByText('Asignados 0 de 14')).toBeTruthy();
    expect(screen.getByText(/Falta asignar 14 ítems/)).toBeTruthy();
    expect(screen.getByText('Cuadra con la boleta: S/ 497.09 ✓')).toBeTruthy();
    expect(save().disabled).toBe(false);

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
