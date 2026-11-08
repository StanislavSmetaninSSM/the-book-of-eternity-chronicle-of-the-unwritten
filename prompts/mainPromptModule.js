/*
 * The rulebook lives in ./mainPromptModule/, one file per top-level section, so the guide
 * downloads as several parallel chunks instead of one multi-megabyte file. This re-export
 * keeps `import './mainPromptModule.js'` working for the client, the relay rule bundle and
 * the prompt tests; edit the section files, not this one.
 */
export { getGameMasterGuideRules, GAME_MASTER_GUIDE_SECTIONS } from './mainPromptModule/index.js';
