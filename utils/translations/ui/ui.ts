import { common } from './common';
import { ui as ui_overrides } from './ui_overrides';
import { details } from './details';
import { item } from './item';
import { quest } from './quest';
import { skill } from './skill';
import { combat } from './combat';
import { npc } from './npc';
import { location } from './location';
import { status } from './status';
import { about } from './about';
import { weather } from './weather';
import { faction } from './faction';
import { players } from './players';
import { startScreen } from './startScreen';
import { settings } from './settings';
import { help } from './help';
import { calendar } from './calendar';

export const ui = {
  en: {
    ...common.en,
    ...ui_overrides.en,
    ...details.en,
    ...item.en,
    ...quest.en,
    ...skill.en,
    ...combat.en,
    ...npc.en,
    ...location.en,
    ...status.en,
    ...about.en,
    ...help.en,
    ...weather.en,
    ...faction.en,
    ...players.en,
    ...startScreen.en,
    ...settings.en,
    ...calendar.en,    
  },
  ru: {
    ...common.ru,
    ...ui_overrides.ru,
    ...details.ru,
    ...item.ru,
    ...quest.ru,
    ...skill.ru,
    ...combat.ru,
    ...npc.ru,
    ...location.ru,
    ...status.ru,
    ...about.ru,
    ...help.ru,
    ...weather.ru,
    ...faction.ru,
    ...players.ru,
    ...startScreen.ru,
    ...settings.ru,
    ...calendar.ru,    
  }
};