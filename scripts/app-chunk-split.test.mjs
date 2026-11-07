import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');

// App used to import every in-game screen statically, so a visitor who only looked at the
// start screen downloaded the whole game UI (side panel, detail renderer, character sheet...).
const lazyScreens = {
  SidePanel: "import('./components/SidePanel')",
  DetailRenderer: "import('./components/DetailRenderer/index')",
  CharacterSheet: "import('./components/CharacterSheet')",
  InventoryScreen: "import('./components/InventoryScreen')",
  StorageScreen: "import('./components/StorageScreen')",
  CinemaHall: "import('./components/CinemaHall')",
  CinemaPlayer: "import('./components/CinemaPlayer')",
  CombatTracker: "import('./components/CombatTracker')",
  LocationViewer: "import('./components/LocationViewer')",
  ImageCacheGallery: "import('./components/ImageCacheGallery')",
  TextReaderModal: "import('./components/TextReaderModal')",
};

test('the in-game screens live in their own chunks', () => {
  for (const [name, importPath] of Object.entries(lazyScreens)) {
    const staticImport = new RegExp(`^import (\\{[^}]*\\b${name}\\b[^}]*\\}|${name}) from '\\./components/${name === 'DetailRenderer' ? 'DetailRenderer/index' : name}';`, 'm');
    assert.ok(!staticImport.test(source), `${name} must not be imported statically`);
    assert.ok(source.includes(importPath), `${name} must be loaded on demand`);
  }

  // Every lazy screen keeps a Suspense boundary; otherwise React suspends without a fallback.
  const lazyCount = (source.match(/React\.lazy\(/g) || []).length;
  const suspenseCount = (source.match(/<Suspense /g) || []).length;
  assert.ok(lazyCount >= 11, `expected at least 11 lazy screens, found ${lazyCount}`);
  assert.ok(suspenseCount >= lazyCount, `each lazy screen needs a Suspense boundary (${suspenseCount} for ${lazyCount})`);
});
