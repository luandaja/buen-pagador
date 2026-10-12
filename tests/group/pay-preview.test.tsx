import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupApp } from '../../src/islands/group/GroupApp';
import { group, preview, readOnly, savedGroups } from '../../src/islands/group/store';
import { resetSync } from '../../src/islands/group/sync';
import { ViewerApp } from '../../src/islands/group/ViewerApp';
import { resetDatabase } from '../../src/scripts/db';
import { rememberGroup, saveGroup } from '../../src/scripts/group/groups';
import { addPerson, newGroup, saveExpense } from '../../src/scripts/group/model';
import { qrFromFile } from '../../src/scripts/image';

vi.mock('../../src/scripts/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/scripts/image')>()),
  qrFromFile: vi.fn(async () => 'data:image/jpeg;base64,QR'),
}));

const writeText = vi.fn(async () => {});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDatabase();
  resetSync();
  localStorage.clear();
  group.value = null;
  readOnly.value = false;
  preview.value = false;
  savedGroups.value = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(cleanup);

async function dinner() {
  let current = addPerson(addPerson(newGroup({ title: 'Cena' }), 'Ana'), 'Beto');
  current = saveExpense(current, { id: 'pizza', what: 'Pizza', amount: 60, by: current.people[0].id });
  await saveGroup(current);
  rememberGroup(current.id);
  return current;
}

const qrInput = () => screen.getByText(/Subir QR|Cambiar QR/).closest('label')!.querySelector('input')!;

describe('payment details for a group', () => {
  it('saves a note and a QR, and removes the QR', async () => {
    await dinner();
    render(<GroupApp />);
    const note = await screen.findByRole('textbox', { name: 'Datos para pagarle a Ana (opcional)' });
    fireEvent.input(note, { target: { value: 'Yape 999' } });
    expect(group.value!.payNote).toBe('Yape 999');

    fireEvent.change(qrInput(), { target: { files: [] } });
    fireEvent.change(qrInput(), { target: { files: [new File(['x'], 'qr.jpg')] } });
    await screen.findByAltText('QR para pagar');
    expect(group.value!.payQr).toBe('data:image/jpeg;base64,QR');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar QR' }));
    expect(group.value!.payQr).toBeNull();

    vi.mocked(qrFromFile).mockRejectedValueOnce(new Error('bad'));
    fireEvent.change(qrInput(), { target: { files: [new File(['x'], 'qr.jpg')] } });
    await screen.findByText('No pudimos abrir esa imagen del QR.');
  });

  it('names the generic title before anyone is added', async () => {
    await saveGroup(newGroup({ title: 'Vacía' }));
    render(<GroupApp />);
    expect(await screen.findByRole('textbox', { name: 'Datos para pagar (opcional)' })).toBeTruthy();
  });
});

describe('group preview', () => {
  it('shows the local group read-only with how to pay, and reloads on focus', async () => {
    const current = await dinner();
    await saveGroup({ ...current, payNote: 'Yape 999', payQr: 'data:image/jpeg;base64,QR' });
    render(<ViewerApp hash="#preview" />);
    await screen.findByText(/Vista previa/);
    expect(screen.getByRole('heading', { name: 'Cómo pagarle a Ana' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Descargar QR' }).getAttribute('download')).toBe('qr-para-pagar.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Copiar datos' }));
    await screen.findByRole('button', { name: 'Copiado ✓' });
    expect(writeText).toHaveBeenCalledWith('Yape 999');

    await saveGroup({ ...current, title: 'Cena editada' });
    window.dispatchEvent(new Event('focus'));
    await screen.findByText('Cena editada');
    expect(screen.queryByRole('heading', { name: /Cómo pagarle/ })).toBeNull();
  });

  it('explains there is nothing to preview yet', async () => {
    render(<ViewerApp hash="#preview" />);
    await screen.findByText('Nada que mostrar todavía');
    await waitFor(() => expect(readOnly.value).toBe(true));
  });
});
