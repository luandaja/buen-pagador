import { expect, test, type Page } from '@playwright/test';

async function addPeople(page: Page, ...names: string[]) {
  const input = page.getByLabel('Nombre', { exact: true });
  for (const name of names) {
    await input.fill(name);
    await input.press('Enter');
    await expect(page.locator('.person strong', { hasText: name })).toBeVisible();
  }
}

async function addExpense(page: Page, what: string, amount: string) {
  await page.getByLabel('¿En qué?').fill(what);
  await page.getByLabel('¿Cuánto?').fill(amount);
  await page.getByRole('button', { name: 'Agregar gasto' }).click();
  await expect(page.locator('.expense-row', { hasText: what })).toBeVisible();
}

const person = (page: Page, name: string) => page.locator('.person', { hasText: name });

test('splits a trip, marks who paid and keeps it after reload', async ({ page }) => {
  await page.goto('/cuenta');
  await page.getByLabel('Nombre de la cuenta').fill('Viaje a Cusco');
  await page.getByLabel('Emoji de la cuenta').click();
  await page.getByRole('button', { name: 'Usar ✈️' }).click();
  await addPeople(page, 'Ana', 'Beto', 'Caro');

  await addExpense(page, 'Hotel', '100');
  await page.getByLabel('¿Quién pagó?').selectOption({ label: 'Beto' });
  await page.getByRole('button', { name: 'Ana', pressed: true }).click();
  await addExpense(page, 'Taxi', '30');

  await expect(person(page, 'Caro')).toContainText('Debe S/ 48.33');
  await expect(page.locator('.progress-hero')).toHaveText('S/ 66.66');

  await page.getByRole('button', { name: 'Caro: marcar como pagado' }).click();
  await expect(person(page, 'Caro')).toContainText('Pagó S/ 48.33');
  await expect(page.locator('.progress-hero')).toHaveText('S/ 18.33');
  await expect(page).toHaveTitle('✈️ Viaje a Cusco · El Buen Pagador');

  await expect.poll(() => page.evaluate(() => localStorage.getItem('buen-pagador:current-group'))).not.toBeNull();
  await page.waitForFunction(async () => {
    const id = localStorage.getItem('buen-pagador:current-group');
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('buen-pagador');
      request.onsuccess = () => resolve(request.result);
    });
    const stored = await new Promise<{ people: { settled: number }[] }>((resolve) => {
      const request = db.transaction('groups').objectStore('groups').get(id!);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return stored.people[2].settled > 0;
  });
  await page.reload();
  await expect(person(page, 'Caro')).toContainText('Pagó S/ 48.33');
  await expect(page.getByLabel('Emoji de la cuenta')).toHaveText('✈️');
});

test('navigates between the court and the groups', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByRole('link', { name: 'Cuentas' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Cancha' }).click();
  await expect(page.locator('#dropzone')).toBeVisible();
});
