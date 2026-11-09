/*
 * The game-master rulebook: the JSON schema and the per-stage instruction blocks.
 *
 * prompts/mainPromptModule.js re-exports this module. The text is stored as one file per
 * section so the browser fetches the rulebook in parallel and a rules edit only invalidates
 * the section it touched. Joining the sections with a newline reproduces the reviewed guide
 * byte for byte; scripts/prompt-separation.test.mjs pins its digest and
 * scripts/split-main-prompt.mjs --check runs that gate on demand.
 */
import { section as section1 } from './section-01.js';
import { section as section2 } from './section-02.js';
import { section as section3 } from './section-03.js';
import { section as section4 } from './section-04.js';
import { section as section5 } from './section-05.js';
import { section as section6 } from './section-06.js';
import { section as section7 } from './section-07.js';
import { section as section8 } from './section-08.js';
import { section as section9 } from './section-09.js';
import { section as section10 } from './section-10.js';
import { section as section11 } from './section-11.js';
import { section as section12 } from './section-12.js';
import { section as section13 } from './section-13.js';

/**
 * The complete guide. It is deliberately independent of the turn: every {{context.path}}
 * reference stays symbolic and is resolved from the CurrentGameContext document the stage
 * prompt carries. The context argument is accepted for call-site symmetry only.
 */
export const getGameMasterGuideRules = () => GAME_MASTER_GUIDE_SECTIONS.join('\n');

/** The rulebook as its sections, in document order. */
export const GAME_MASTER_GUIDE_SECTIONS = [
  section1,
  section2,
  section3,
  section4,
  section5,
  section6,
  section7,
  section8,
  section9,
  section10,
  section11,
  section12,
  section13,
];
