import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const aiReply = readFileSync('tests/fixtures/receipt-ai.json', 'utf8');

async function addPeople(page: Page, ...names: string[]) {
  const input = page.getByLabel('Nombre', { exact: true });
  for (const name of names) {
    await input.fill(name);
    await input.press('Enter');
    await expect(page.locator('.person strong', { hasText: name })).toBeVisible();
  }
}

async function photo(page: Page, width = 300, height = 500): Promise<Buffer> {
  const base64 = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.fillRect(0, 0, w, h);
      return canvas.toDataURL('image/jpeg').split(',')[1];
    },
    [width, height],
  );
  return Buffer.from(base64, 'base64');
}

test('splits a restaurant receipt by item so every cent, tip included, is charged to someone', async ({ page }) => {
  await page.route('**/api/receipt', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: aiReply }));
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await page.goto('/cuenta');
  await page.getByLabel('Nombre de la cuenta').fill('Punta Hermosa');
  await addPeople(page, 'Ana', 'Beto', 'Caro', 'Dani');

  await page.locator('.receipt-upload input[type=file]').setInputFiles({ name: 'boleta.jpg', mimeType: 'image/jpeg', buffer: await photo(page) });
  await expect(page.getByText('Leída con IA. Revisa los montos.')).toBeVisible();
  await expect(page.getByAltText('Foto de la boleta')).toBeVisible();
  await expect(page.getByText('Cuadra con la boleta: S/ 497.09 ✓')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar boleta' })).toBeDisabled();

  await page.getByRole('button', { name: 'Separar ×3' }).click();
  const items = page.locator('.receipt-item');
  await expect(items).toHaveCount(16);
  const names = ['Ana', 'Beto', 'Caro', 'Dani'];
  for (let index = 0; index < 16; index++) {
    await items.nth(index).getByRole('button', { name: index % 5 === 4 ? 'Entre todos' : names[index % 4], exact: true }).click();
  }
  await expect(page.getByText('Asignados 16 de 16')).toBeVisible();
  await page.getByLabel('¿Quién pagó la cuenta?').selectOption({ label: 'Beto' });
  await page.getByRole('button', { name: 'Guardar boleta' }).click();

  await expect(page.locator('.expense-row', { hasText: 'TP Punta Hermosa' })).toContainText('16 ítems + propina');
  await expect(page.locator('.progress-sub')).toContainText('Gastado S/ 497.09');
  const shares = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('buen-pagador');
      request.onsuccess = () => resolve(request.result);
    });
    const [stored] = await new Promise<{ expenses: { amount: number; items: unknown[] }[] }[]>((resolve) => {
      const request = db.transaction('groups').objectStore('groups').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    return { amount: stored.expenses[0].amount, items: stored.expenses[0].items.length };
  });
  expect(shares).toEqual({ amount: 497.09, items: 16 });
});

test('previews what payers will see, with payment details and link lifetime', async ({ page, context }) => {
  await page.goto('/cuenta');
  await page.getByLabel('Nombre de la cuenta').fill('Cena');
  await addPeople(page, 'Ana', 'Beto');
  await page.getByLabel('¿En qué?').fill('Pizza');
  await page.getByLabel('¿Cuánto?').fill('60');
  await page.getByRole('button', { name: 'Agregar gasto' }).click();
  await page.getByRole('textbox', { name: 'Datos para pagarle a Ana' }).fill('Yape 999 888 777');

  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Vista previa' }).click()]);
  await expect(preview.getByText('Vista previa · Así lo verán quienes abran el link.')).toBeVisible();
  await expect(preview.getByRole('heading', { name: 'Cómo pagarle a Ana' })).toBeVisible();
  await expect(preview.locator('.pay-note')).toHaveText('Yape 999 888 777');
  await expect(preview.locator('.person', { hasText: 'Beto' })).toContainText('Debe S/ 30');

  await page.getByRole('button', { name: 'Crear links' }).click();
  await expect(page.getByText('El link vence en 90 días si nadie lo cambia. Cada cambio lo renueva.')).toBeVisible();
});

test('previews the court before sharing it', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'team.jpg', mimeType: 'image/jpeg', buffer: await photo(page, 800, 600) });
  await expect(page.locator('#scanning')).toBeHidden({ timeout: 30_000 });
  await page.locator('#cost').fill('80');
  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Vista previa' }).click()]);
  await expect(preview.locator('#viewerBadge')).toHaveText('Vista previa');
  await expect(preview.locator('#viewTitle')).toBeVisible();
});
