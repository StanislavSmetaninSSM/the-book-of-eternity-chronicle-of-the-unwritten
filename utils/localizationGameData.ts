
import { fantasyWorld } from './translations/worlds/fantasy';
import { sciFiWorld } from './translations/worlds/sci_fi';
import { postApocalypseWorld } from './translations/worlds/post_apocalypse';
import { urbanMythWorld } from './translations/worlds/modern';
import { europe13thCenturyWorld } from './translations/worlds/history/europe_13th_century';
import { antiquityWorld } from './translations/worlds/history/antiquity';
import { kingArthursBritainWorld } from './translations/worlds/myths/britain';
import { trojanWarWorld } from './translations/worlds/myths/trojan_war';

// FIX: Export 'standardCalendarStructure' to make it available for import.
export const standardCalendarStructure = {
  startingMonthName: 'month_jan',
  startingDayOfMonth: 1,
  startingTimeOfDay: '08:00',
  months: [
    { name: 'month_jan', days: 31 }, { name: 'month_feb', days: 28 }, { name: 'month_mar', days: 31 },
    { name: 'month_apr', days: 30 }, { name: 'month_may', days: 31 }, { name: 'month_jun', days: 30 },
    { name: 'month_jul', days: 31 }, { name: 'month_aug', days: 31 }, { name: 'month_sep', days: 30 },
    { name: 'month_oct', days: 31 }, { name: 'month_nov', days: 30 }, { name: 'month_dec', days: 31 }
  ],
  daysInWeek: 7,
  dayNames: [
    { name: 'day_mon' }, { name: 'day_tue' }, { name: 'day_wed' }, { name: 'day_thu' }, 
    { name: 'day_fri' }, { name: 'day_sat' }, { name: 'day_sun' }
  ],
};

export const gameData = {
  fantasy: { 
    ...fantasyWorld, 
    calendar: {
      startingYear: 1024,
      ...standardCalendarStructure,
      startingMonthName: 'fantasy_month_1_name',
      months: [
        { name: 'fantasy_month_1_name', days: 30, description: 'fantasy_month_1_desc' },
        { name: 'fantasy_month_2_name', days: 31, description: 'fantasy_month_2_desc' },
        { name: 'fantasy_month_3_name', days: 30, description: 'fantasy_month_3_desc' },
        { name: 'fantasy_month_4_name', days: 31, description: 'fantasy_month_4_desc' },
        { name: 'fantasy_month_5_name', days: 30, description: 'fantasy_month_5_desc' },
        { name: 'fantasy_month_6_name', days: 31, description: 'fantasy_month_6_desc' },
        { name: 'fantasy_month_7_name', days: 31, description: 'fantasy_month_7_desc' },
        { name: 'fantasy_month_8_name', days: 30, description: 'fantasy_month_8_desc' },
        { name: 'fantasy_month_9_name', days: 31, description: 'fantasy_month_9_desc' },
        { name: 'fantasy_month_10_name', days: 30, description: 'fantasy_month_10_desc' },
        { name: 'fantasy_month_11_name', days: 31, description: 'fantasy_month_11_desc' },
        { name: 'fantasy_month_12_name', days: 30, description: 'fantasy_month_12_desc' }
      ],
      dayNames: [
        { name: 'fantasy_day_1_name', description: 'fantasy_day_1_desc' },
        { name: 'fantasy_day_2_name', description: 'fantasy_day_2_desc' },
        { name: 'fantasy_day_3_name', description: 'fantasy_day_3_desc' },
        { name: 'fantasy_day_4_name', description: 'fantasy_day_4_desc' },
        { name: 'fantasy_day_5_name', description: 'fantasy_day_5_desc' },
        { name: 'fantasy_day_6_name', description: 'fantasy_day_6_desc' },
        { name: 'fantasy_day_7_name', description: 'fantasy_day_7_desc' }
      ]
    } 
  },
  sci_fi: { 
    ...sciFiWorld, 
    calendar: {
      startingYear: 2384,
      ...standardCalendarStructure
    }
  },
  post_apocalypse: { 
    ...postApocalypseWorld, 
    calendar: {
      startingYear: 2088,
      ...standardCalendarStructure
    }
  },
  urban_myth: { 
    ...urbanMythWorld, 
    calendar: {
      startingYear: 2026,
      ...standardCalendarStructure
    }
  },
  history: {
    europe_13th_century: { 
      ...europe13thCenturyWorld, 
      calendar: {
        startingYear: 1250,
        ...standardCalendarStructure
      } 
    },
    antiquity: { 
      ...antiquityWorld, 
      calendar: {
        startingYear: 250,
        ...standardCalendarStructure
      } 
    },
  },
  myths: {
    king_arthurs_britain: { 
      ...kingArthursBritainWorld, 
      calendar: {
        startingYear: 480,
        ...standardCalendarStructure
      } 
    },
    trojan_war: { 
      ...trojanWarWorld, 
      calendar: {
        startingYear: -1194, // Representing 1194 BC
        ...standardCalendarStructure
      } 
    },
  },
  custom: {}
};