import { expect, test, type Browser, type Page } from '@playwright/test';

async function device(browser: Browser) {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  return context.newPage();
}

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

async function copied(page: Page, button: string) {
  await page.getByRole('button', { name: button }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

const live = (page: Page) => expect(page.locator('.group-share [role=status]')).toHaveText('En vivo');

test('two phones add expenses to the same trip and a friend follows read-only', async ({ browser }) => {
  const owner = await device(browser);
  await owner.goto('/cuenta');
  await owner.getByLabel('Nombre de la cuenta').fill('Playa');
  await owner.getByLabel('Emoji y colores de la cuenta').click();
  await owner.getByRole('button', { name: 'Colores Playa' }).click();
  await owner.keyboard.press('Escape');
  await addPeople(owner, 'Ana', 'Beto', 'Caro');
  await owner.getByText('Agregar detalle').click();
  await owner.getByLabel('Nota').fill('Airbnb frente al mar');
  await addExpense(owner, 'Casa', '300');
  await owner.getByRole('button', { name: 'Crear links' }).click();
  await live(owner);
  const editUrl = await copied(owner, 'Copiar link para editar');
  const viewUrl = await copied(owner, 'Copiar link para ver');
  expect(editUrl).toMatch(/\/cuenta#edit=/);

  const guest = await device(browser);
  await guest.goto(editUrl);
  await expect(guest.getByLabel('Nombre de la cuenta')).toHaveValue('Playa');
  await expect(guest).toHaveURL(/\/cuenta$/);
  await expect(guest.locator('.expense-row', { hasText: 'Casa' })).toBeVisible();

  await guest.getByLabel('¿Quién pagó?').selectOption({ label: 'Beto' });
  await addExpense(guest, 'Cena', '90');
  await addExpense(owner, 'Gasolina', '60');
  await live(guest);
  await live(owner);

  await owner.reload();
  await guest.reload();
  for (const page of [owner, guest]) {
    for (const what of ['Casa', 'Cena', 'Gasolina']) await expect(page.locator('.expense-row', { hasText: what })).toBeVisible();
    await expect(page.locator('.person', { hasText: 'Caro' })).toContainText('Debe S/ 150');
  }

  await guest.getByRole('button', { name: 'Caro: marcar como pagado' }).click();
  await live(guest);

  const friend = await device(browser);
  await friend.goto(viewUrl);
  await expect(friend.getByText('Solo lectura · se actualiza solo')).toBeVisible();
  await expect(friend.locator('html')).toHaveAttribute('data-palette', 'playa');
  await expect(friend.locator('body')).toHaveCSS('background-color', 'rgb(14, 107, 115)');
  await expect(friend.locator('.person', { hasText: 'Caro' })).toContainText('Pagó S/ 150');
  await expect(friend.locator('#app').getByRole('button', { name: /^(?!Ver detalle de )/ })).toHaveCount(0);
  await expect(friend.locator('.expense-row', { hasText: 'Casa' })).toContainText('Airbnb frente al mar');
  await friend.getByRole('button', { name: 'Ver detalle de Casa' }).click();
  await expect(friend.locator('.expense-detail')).toContainText('Le toca a cada uno');
  await expect(friend.getByRole('textbox')).toHaveCount(0);
});
