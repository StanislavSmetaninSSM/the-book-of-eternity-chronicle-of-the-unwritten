import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('./fixtures/full-party-save.json', import.meta.url));

async function importZLayerSave(page: import('@playwright/test').Page): Promise<void> {
  const save = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const template = save.gameState.currentLocationData;
  const surface = {
    ...template,
    locationId: 'e2e-surface',
    name: 'Surface Entrance',
    coordinates: { x: 0, y: 0, z: 0 },
    adjacencyMap: [{
      name: 'Stairs Down',
      shortDescription: 'A stairway descends below the surface.',
      linkType: 'Stairs Down',
      linkState: 'Safe',
      targetLocationId: 'e2e-lower',
      targetCoordinates: { x: 0, y: 0, z: -1 },
    }],
  };
  const lower = {
    ...template,
    locationId: 'e2e-lower',
    name: 'Lower Chamber',
    coordinates: { x: 0, y: 0, z: -1 },
    adjacencyMap: [],
  };
  save.gameContext.currentLocation = surface;
  save.gameContext.visitedLocations = [surface, lower];
  save.gameContext.worldMap = { 'e2e-surface': surface, 'e2e-lower': lower };
  save.gameState.currentLocationData = surface;

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'z-layer-save.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(save)),
  });
}

test('map switches z layers and exposes a vertical link to a location at the same x/y', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importZLayerSave(page);
  await expect(page.getByTestId('chat-window')).toBeVisible();

  await page.getByTestId('side-tab-Map').click();
  const selector = page.getByTestId('map-z-selector');
  await expect(selector).toHaveValue('0');
  await expect(page.getByTestId('map-location-e2e-surface')).toBeVisible();
  await expect(page.getByTestId('map-location-e2e-lower')).toHaveCount(0);
  const downLink = page.getByTestId('map-vertical-link-e2e-surface--1');
  await expect(downLink).toBeVisible();

  await downLink.click();
  await expect(selector).toHaveValue('-1');
  await expect(page.getByTestId('map-location-e2e-lower')).toBeVisible();
  await expect(page.getByTestId('map-location-e2e-surface')).toHaveCount(0);
  await page.getByTestId('map-location-e2e-lower').click();
  const locationDialog = page.getByRole('dialog').last();
  await locationDialog.getByRole('button', { name: 'Information' }).click();
  await expect(page.getByTestId('location-coordinates')).toHaveText('(0, 0, -1)');
  expect(errors).toEqual([]);
});
