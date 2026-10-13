import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupApp } from '../../src/islands/group/GroupApp';
import { group, readOnly, savedGroups } from '../../src/islands/group/store';
import { resetSync, startSharing } from '../../src/islands/group/sync';
import { mountViewerApp, ViewerApp } from '../../src/islands/group/ViewerApp';
import { resetGroupStore } from '../../src/lib/group-store';
import { MemoryReceiptStore, receiptPath, resetReceiptStore } from '../../src/lib/receipt-store';
import { resetDatabase } from '../../src/scripts/db';
import { listGroups, rememberGroup, saveGroup } from '../../src/scripts/group/groups';
import { saveReceipt } from '../../src/scripts/group/receipts';
import { addPerson, newGroup, saveExpense, type GroupLink } from '../../src/scripts/group/model';
import { useApiFetch } from '../helpers/api';

const writeText = vi.fn(async () => {});

function trip() {
  let current = addPerson(addPerson(newGroup({ title: 'Cusco', emoji: '✈️', palette: 'atardecer' }), 'Ana'), 'Beto');
  current = saveExpense(current, { id: 'hotel', what: 'Hotel', amount: 100, by: current.people[0].id });
  return current;
}

async function sharedLink(): Promise<GroupLink> {
  group.value = trip();
  await startSharing();
  const link = group.value!.share!;
  group.value = null;
  return link;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDatabase();
  resetGroupStore();
  resetReceiptStore();
  resetSync();
  localStorage.clear();
  group.value = null;
  readOnly.value = false;
  savedGroups.value = [];
  useApiFetch();
  window.confirm = vi.fn(() => true);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  history.replaceState(null, '', '/cuenta');
});

afterEach(() => {
  cleanup();
  resetSync();
});

describe('share box', () => {
  it('creates links, copies them and stops sharing', async () => {
    const current = trip();
    await saveGroup(current);
    rememberGroup(current.id);
    render(<GroupApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Crear links' }));
    const copyEdit = await screen.findByRole('button', { name: 'Copiar link para editar' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('En vivo'));
    expect(screen.getByText('El link vence en 90 días si nadie lo cambia. Cada cambio lo renueva.')).toBeTruthy();

    fireEvent.click(copyEdit);
    await screen.findByRole('button', { name: 'Copiado ✓' });
    expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/\/cuenta#edit=[A-Za-z0-9]{10}\.[\w-]{43}\.[\w-]{32}$/));
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link para ver' }));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/\/c#[A-Za-z0-9]{10}\.[\w-]{43}$/));

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar los links para todos' }));
    expect(group.value!.share).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar los links para todos' }));
    await screen.findByRole('button', { name: 'Crear links' });
  });

  it('joins from the edit link in the address bar and cleans it', async () => {
    const link = await sharedLink();
    globalThis.indexedDB = new IDBFactory();
    resetDatabase();
    history.replaceState(null, '', `/cuenta#edit=${link.id}.${link.key}.${link.token}`);
    render(<GroupApp />);
    await waitFor(() => expect((screen.getByLabelText('Nombre de la cuenta') as HTMLInputElement).value).toBe('Cusco'));
    expect(location.hash).toBe('');
    expect(screen.getByRole('button', { name: 'Dejar de sincronizar aquí' })).toBeTruthy();
    await waitFor(async () => expect((await listGroups()).map((saved) => saved.title)).toEqual(['Cusco']));
  });
});

describe('summary', () => {
  it('copies the summary when the browser cannot share, and uses the share sheet when it can', async () => {
    const current = trip();
    await saveGroup(current);
    rememberGroup(current.id);
    render(<GroupApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Compartir resumen' }));
    await screen.findByRole('button', { name: 'Copiado ✓' });
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('✈️ Cusco'));

    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Crear links' }));
    await screen.findByRole('button', { name: 'Copiar link para ver' });
    fireEvent.click(screen.getByRole('button', { name: /Compartir resumen|Copiado/ }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'Resumen de Cusco', text: expect.stringContaining('Detalle: ') }));
    share.mockRejectedValueOnce(new Error('AbortError'));
    fireEvent.click(screen.getByRole('button', { name: /Compartir resumen|Copiado/ }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    Reflect.deleteProperty(navigator, 'share');
  });

  it('is hidden until there are expenses', async () => {
    render(<GroupApp />);
    await screen.findByLabelText('Nombre de la cuenta');
    expect(screen.queryByRole('button', { name: 'Compartir resumen' })).toBeNull();
  });
});

const PHOTO = 'data:image/jpeg;base64,BOLETA';
const sharedPhoto = (link: GroupLink, expenseId = 'hotel') => new MemoryReceiptStore().get(receiptPath(link.id, expenseId));

async function sharedWithPhoto(): Promise<GroupLink> {
  const current = trip();
  await saveReceipt(current.id, 'hotel', PHOTO);
  group.value = current;
  await startSharing();
  const link = group.value!.share!;
  await waitFor(async () => expect(await sharedPhoto(link)).toBeTruthy());
  return link;
}

function otherDevice() {
  globalThis.indexedDB = new IDBFactory();
  resetDatabase();
  group.value = null;
}

describe('shared receipt photos', () => {
  it('uploads the photo encrypted when sharing and shows it on the read-only link', async () => {
    const link = await sharedWithPhoto();
    expect(await sharedPhoto(link)).not.toContain('BOLETA');
    otherDevice();
    render(<ViewerApp hash={`#${link.id}.${link.key}`} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Hotel' }));
    expect((await screen.findByAltText('Foto de la boleta')).getAttribute('src')).toBe(PHOTO);
  });

  it('keeps working without the photo when it cannot be fetched', async () => {
    const link = await sharedWithPhoto();
    await new MemoryReceiptStore().remove(receiptPath(link.id, 'hotel'));
    otherDevice();
    render(<ViewerApp hash={`#${link.id}.${link.key}`} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Hotel' }));
    await screen.findByText('Le toca a cada uno');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByAltText('Foto de la boleta')).toBeNull();
  });

  it('lets an editor on another device see the photo and remove it for everyone', async () => {
    const link = await sharedWithPhoto();
    const shared = group.value!;
    otherDevice();
    await saveGroup(shared);
    rememberGroup(shared.id);
    render(<GroupApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Hotel' }));
    await screen.findByAltText('Boleta de Hotel');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => expect(await sharedPhoto(link)).toBeNull());
  });

  it('does not upload the photo again when an edit leaves it alone', async () => {
    const link = await sharedLink();
    const shared = { ...trip(), id: 'mine', share: link };
    await saveGroup(shared);
    await saveReceipt(shared.id, 'hotel', PHOTO);
    rememberGroup(shared.id);
    render(<GroupApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Hotel' }));
    await screen.findByAltText('Boleta de Hotel');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await sharedPhoto(link)).toBeNull();
  });
});

describe('public viewer', () => {
  it('shows the group read-only', async () => {
    const link = await sharedLink();
    render(<ViewerApp hash={`#${link.id}.${link.key}`} />);
    expect(screen.getByRole('status').textContent).toContain('Abriendo');
    await screen.findByText('Cusco');
    expect(screen.getByText('Solo lectura · se actualiza solo')).toBeTruthy();
    expect(screen.getByText('Debe S/ 50')).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Ver detalle de Hotel']);
    expect(screen.queryByLabelText('¿En qué?')).toBeNull();
    expect(document.title).toBe('✈️ Cusco · El Buen Pagador');
    expect(document.documentElement.dataset.palette).toBe('atardecer');
  });

  it('polls for changes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const link = await sharedLink();
    render(<ViewerApp hash={`#${link.id}.${link.key}`} />);
    await screen.findByText('Cusco');
    const spy = vi.spyOn(globalThis, 'fetch');
    await vi.advanceTimersByTimeAsync(15_000);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.stringContaining('since='), expect.anything()));
    vi.useRealTimers();
  });

  it('explains broken, missing and unreachable links', async () => {
    render(<ViewerApp hash="#broken" />);
    expect(screen.getByText('Link incompleto')).toBeTruthy();
    cleanup();

    render(<ViewerApp hash={`#AAAAAAAAAA.${'k'.repeat(43)}`} />);
    await screen.findByText('Este link ya no existe');
    cleanup();

    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    render(<ViewerApp hash={`#AAAAAAAAAA.${'k'.repeat(43)}`} />);
    await screen.findByText('Sin conexión');
  });

  it('mounts into the page root', async () => {
    const link = await sharedLink();
    history.replaceState(null, '', `/c#${link.id}.${link.key}`);
    const root = document.createElement('main');
    root.innerHTML = '<p>Abriendo…</p>';
    document.body.append(root);
    mountViewerApp(root);
    await waitFor(() => expect(root.textContent).toContain('Cusco'));
    root.remove();
  });
});
