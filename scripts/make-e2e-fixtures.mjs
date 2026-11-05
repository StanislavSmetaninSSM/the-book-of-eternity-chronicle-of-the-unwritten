// Regenerates the deterministic save fixtures used by the Playwright specs:
// a local full-party save and a legacy networked save that must load locally.
// Run with: node scripts/make-e2e-fixtures.mjs
import {mkdir, writeFile} from 'node:fs/promises';
import {createServer} from 'vite';

const vite = await createServer({configFile:false, server:{middlewareMode:true}, appType:'custom', logLevel:'silent'});
try {
  const {createInitialContext} = await vite.ssrLoadModule('/utils/gameContext.ts');

  const buildSave = ({secondPlayerName, networkFields, activePlayerIndex}) => {
    const context = createInitialContext({
      universe: 'fantasy',
      playerName: 'Aria',
      race: 'Human',
      charClass: 'Warrior',
      initialPrompt: 'Begin the chronicle.',
      startingYear: 1000,
      startingMonth: 'January',
      startingDay: 1,
      startTime: '08:00',
      weather: 'Clear',
    }, 'en');
    context.currentTurnNumber = 2;
    context.gameSettings.cooperativeGameType = 'FullParty';
    context.gameSettings.allowHistoryManipulation = true;
    const first = {...context.playerCharacter, playerId: 'e2e-first', name: 'Aria'};
    const second = {...first, playerId: 'e2e-second', name: secondPlayerName};
    context.playerCharacter = activePlayerIndex === 0 ? first : second;
    context.players = [first, second];
    context.activePlayerIndex = activePlayerIndex;

    const gameState = {
      playerCharacter: context.playerCharacter,
      players: [first, second],
      activePlayerIndex,
      currentLocationData: context.currentLocation,
      activeQuests: [],
      completedQuests: [],
      encounteredNPCs: [],
      encounteredFactions: [],
      enemiesData: [],
      alliesData: [],
      playerCustomStates: [],
      plotOutline: null,
      worldStateFlags: [],
      worldEventsLog: [],
      imageCache: {},
      temporaryStash: [],
      cinematics: [],
      ...networkFields,
    };

    return {
      gameContext: context,
      gameState,
      gameHistory: [
        {sender: 'gm', content: 'The chronicle of **Aetheria** begins.'},
        {sender: 'player', content: 'I look around the market square.'},
      ],
      gameLog: [],
      combatLog: [],
      lastJsonResponse: null,
      sceneImagePrompt: null,
      timestamp: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    };
  };

  const localSave = buildSave({secondPlayerName: 'Borin', networkFields: {}, activePlayerIndex: 0});
  const legacySave = buildSave({
    secondPlayerName: 'Cyra',
    activePlayerIndex: 1,
    networkFields: {
      networkRole: 'host',
      myPeerId: 'legacy-host',
      hostPeerId: 'legacy-host',
      peers: ['legacy-guest'],
      isConnectedToHost: true,
    },
  });

  await mkdir(new URL('../e2e/fixtures/', import.meta.url), {recursive: true});
  await writeFile(new URL('../e2e/fixtures/full-party-save.json', import.meta.url), JSON.stringify(localSave, null, 2));
  await writeFile(new URL('../e2e/fixtures/legacy-network-save.json', import.meta.url), JSON.stringify(legacySave, null, 2));
  console.log('Wrote e2e fixtures.');
} finally {
  await vite.close();
}
