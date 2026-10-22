import { expect, test, type Page } from '@playwright/test';

async function teamPhoto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#88aabb';
    context.fillRect(0, 0, 800, 600);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}

async function addFace(page: Page) {
  await page.getByRole('button', { name: 'Corregir caras' }).click();
  const stage = page.locator('#stage');
  const box = (await stage.boundingBox())!;
  await stage.click({ position: { x: box.width * 0.4, y: box.height * 0.4 } });
  await expect(page.locator('#faces > *')).toHaveCount(1);
}

test('editor shares an encrypted link the viewer can read and follow', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'team.jpg', mimeType: 'image/jpeg', buffer: await teamPhoto(page) });
  await expect(page.locator('#stageWrap')).toBeVisible();
  await expect(page.locator('#scanning')).toBeHidden({ timeout: 30_000 });

  await addFace(page);
  await page.locator('#cost').fill('100');
  await page.locator('#linkAction').click();
  const urlText = page.locator('#publicUrl');
  await expect(urlText).toHaveText(/\/view#[A-Za-z0-9]{10}\.[\w-]{43}$/, { timeout: 10_000 });
  const publicUrl = (await urlText.textContent())!;

  const viewer = await context.newPage();
  await viewer.goto(publicUrl);
  await expect(viewer.locator('#panel')).toContainText('0/1');
  await expect(viewer.locator('#panel')).toContainText('S/ 100');
  await expect(viewer.locator('#faces > *')).toHaveCount(1);

  await page.getByRole('button', { name: 'Marcar pagos' }).click();
  await page.locator('#faces > *').first().click();
  await expect(page.locator('#syncStatus')).not.toHaveText(/…/, { timeout: 10_000 });
  await expect
    .poll(async () => {
      await viewer.reload();
      return viewer.locator('#panel').textContent();
    }, { timeout: 15_000 })
    .toContain('1/1');
});

test('a game without photo starts from the group list, charges a fixed share and hides the cost', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('#startPeople').fill('Jueves 9 pm\n1. Juan\n2. Pedro ✅\n3. Luis\n4. Ana\n5. Rosa');
  await page.getByRole('button', { name: 'Empezar sin foto' }).click();
  await expect(page.locator('#faces > *')).toHaveCount(5);
  await page.getByRole('button', { name: 'Editar personas' }).click();
  await page.getByRole('button', { name: 'Agregar persona' }).click();
  await page.keyboard.type('Carla');
  await page.getByRole('button', { name: 'Marcar pagos' }).click();
  await expect(page.locator('#faces > *')).toHaveCount(6);

  await page.locator('#cost').fill('100');
  await page.locator('#quota').fill('20');
  await page.getByLabel('Ocultar el costo: el grupo solo ve su cuota').check();
  await page.locator('#faces > *').first().click();
  await page.locator('#linkAction').click();
  const urlText = page.locator('#publicUrl');
  await expect(urlText).toHaveText(/\/view#/, { timeout: 10_000 });

  const viewer = await context.newPage();
  await viewer.goto((await urlText.textContent())!);
  await expect(viewer.locator('#faces > *')).toHaveCount(6);
  await expect(viewer.locator('#faces')).toContainText('Carla');
  await expect(viewer.getByRole('img', { name: 'Juan: pagó' })).toBeVisible();
  await expect(viewer.locator('#panel')).toContainText('Tu cuota');
  await expect(viewer.locator('#panel')).toContainText('S/ 20');
  await expect(viewer.locator('#panel')).toContainText('1/6');
  await expect(viewer.locator('#panel')).not.toContainText('100');
});

test('footer shows the app version and the court keeps its colors', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(35, 64, 200)');
  await expect(page.locator('.app-footer')).toHaveText(/^© 2026 luandaja · v\d+\.\d+\.\d+$/);
});
