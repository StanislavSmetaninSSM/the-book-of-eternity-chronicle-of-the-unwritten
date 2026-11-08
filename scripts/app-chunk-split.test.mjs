import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const app = read('App.tsx');
const host = read('components/GameHost.tsx');

// The start screen used to pull the whole game UI in, and then the game hook with it. The
// shell now renders only the start screen; the host carries the hook, its managers and the
// in-game screens, and is fetched when a chronicle starts.
const lazyScreens = {
  SidePanel: "import('./SidePanel')",
  DetailRenderer: "import('./DetailRenderer/index')",
  CharacterSheet: "import('./CharacterSheet')",
  InventoryScreen: "import('./InventoryScreen')",
  StorageScreen: "import('./StorageScreen')",
  CinemaHall: "import('./CinemaHall')",
  CinemaPlayer: "import('./CinemaPlayer')",
  CombatTracker: "import('./CombatTracker')",
  LocationViewer: "import('./LocationViewer')",
  ImageCacheGallery: "import('./ImageCacheGallery')",
  TextReaderModal: "import('./TextReaderModal')",
};

test('the shell keeps the game host out of the first bundle', () => {
  assert.match(app, /const GameHost = React\.lazy\(\(\) => import\('\.\/components\/GameHost'\)\);/);
  // Only the request type may come from the host module: a type import is erased by the build.
  assert.ok(!/^import (?!type ).*from '\.\/components\/GameHost'/m.test(app), 'App.tsx must not import the host at runtime');
  assert.match(app, /^import type \{ GameStartRequest \} from '\.\/components\/GameHost';$/m);
  assert.ok(!app.includes("from './hooks/useGameLogic'"), 'the shell must not load the game hook');
  assert.ok(!app.includes("from './utils/responseProcessor'"), 'the shell must not load the turn processor');
  assert.match(app, /<Suspense fallback=/);

  // The host renders the game only; the start screen belongs to the shell.
  assert.ok(!host.includes("from './StartScreen'"), 'the host must not own the start screen');
  assert.ok(!host.includes('<StartScreen'), 'the host must not render the start screen');
  assert.match(host, /export type GameStartRequest/);
  assert.match(host, /onSettled: \(started: boolean\) => void/);
});

test('the in-game screens live in their own chunks inside the host', () => {
  for (const [name, importPath] of Object.entries(lazyScreens)) {
    assert.ok(host.includes(importPath), `${name} must be loaded on demand`);
    assert.ok(!new RegExp(`^import (\\{[^}]*\\b${name}\\b[^}]*\\}|${name}) from '\\./${name === 'DetailRenderer' ? 'DetailRenderer/index' : name}';`, 'm').test(host), `${name} must not be imported statically`);
  }
  const lazyCount = (host.match(/React\.lazy\(/g) || []).length;
  const suspenseCount = (host.match(/<Suspense /g) || []).length;
  assert.ok(lazyCount >= 11, `expected at least 11 lazy screens, found ${lazyCount}`);
  assert.ok(suspenseCount >= lazyCount, `each lazy screen needs a Suspense boundary (${suspenseCount} for ${lazyCount})`);
});
