> **Historical / superseded:** Multiplayer was removed in favor of single-player gameplay. This document records the former implementation and is not a current design or implementation plan.

# Статическая карта UI-маршрутов пользовательских действий

Генерация: `node scripts/client-edit-ui-map.mjs`. Поиск только явных JSX `prop={action}` в `App.tsx`; упоминания prop в компонентах — кандидаты, не доказанная цепочка вызовов. Алиасы, spread props, динамические вызовы и одинаковые названия props могут давать пропуски/ложные совпадения. Матрицы инвентаря, мира и прямых callbacks содержат семантический аудит; неизвестные маршруты остаются заблокированными, а не получают права по этому списку.

| Действие | Явные JSX props в App | Файлы компонентов, упоминающие эти props |
| --- | --- | --- |
| `clearAllCompletedFactionProjects` | `clearAllCompletedFactionProjects` | `components/DetailRenderer/FactionDetailsRenderer.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `clearAllCompletedNpcActivities` | `clearAllCompletedNpcActivities` | `components/CharacterSheet.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `clearAllHealedWounds` | `clearAllHealedWounds` | `components/CharacterSheet/ConditionsView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `clearHalfHistory` | `onClearHalfHistory` | `components/InputBar.tsx` |
| `clearNpcJournal` | `onClearNpcJournal` | `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts` |
| `clearNpcJournalsNow` | `clearNpcJournalsNow` | `components/GameMenuView.tsx`, `components/SidePanel.tsx` |
| `craftItem` | `craftItem` | `components/CraftingScreen.tsx`, `components/SidePanel.tsx` |
| `deleteActiveEffect` | `deleteActiveEffect`, `onDeleteActiveEffect` | `components/CharacterSheet/ConditionsView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `deleteActiveSkill` | `deleteActiveSkill`, `onDeleteActiveSkill` | `components/CharacterSheet/SkillsView.tsx`, `components/CharacterSheet.tsx`, `components/SidePanel.tsx` |
| `deleteCustomState` | `deleteCustomState`, `onDeleteCustomState` | `components/CharacterSheet/ConditionsView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `deleteFactionBonus` | `deleteFactionBonus` | `components/DetailRenderer/FactionDetailsRenderer.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `deleteFactionCustomState` | `deleteFactionCustomState` | `components/DetailRenderer/FactionDetailsRenderer.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `deleteFactionProject` | `deleteFactionProject` | `components/DetailRenderer/FactionDetailsRenderer.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `deleteLocationThreat` | `deleteLocationThreat` | `components/DetailRenderer/LocationDetailsRenderer.tsx`, `components/DetailRenderer/types.ts` |
| `deleteLogs` | `onDeleteLogs` | `components/GameLogView.tsx`, `components/SidePanel.tsx` |
| `deleteMessage` | `onDeleteMessage` | `components/ChatWindow.tsx` |
| `deleteNpcCustomState` | `deleteNpcCustomState`, `onDeleteNpcCustomState` | `components/CharacterSheet/ConditionsView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `deleteNpcJournalEntry` | `onDeleteNpcJournalEntry` | `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts` |
| `deleteOldestNpcJournalEntries` | `onDeleteOldestNpcJournalEntries` | `components/DetailRenderer/types.ts` |
| `deletePassiveSkill` | `deletePassiveSkill`, `onDeletePassiveSkill` | `components/CharacterSheet/SkillsView.tsx`, `components/CharacterSheet.tsx`, `components/SidePanel.tsx` |
| `deleteWorldEvent` | `deleteWorldEvent` | `components/SidePanel.tsx` |
| `deleteWorldEventsByTurnRange` | `deleteWorldEventsByTurnRange` | `components/SidePanel.tsx`, `components/WorldPanel.tsx` |
| `deleteWorldStateFlag` | `deleteWorldStateFlag` | `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `disassembleItem` | `disassembleItem` | `components/DetailRenderer/ItemDetailsRenderer.tsx`, `components/DetailRenderer/types.ts` |
| `disassembleNpcItem` | `disassembleNpcItem` | `components/DetailRenderer/ItemDetailsRenderer.tsx`, `components/DetailRenderer/types.ts` |
| `dropItem` | `onDropItem` | `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx` |
| `dropItemFromStash` | `dropItemFromStash` | `components/SidePanel.tsx` |
| `editChatMessage` | `editChatMessage` | `components/SidePanel.tsx` |
| `editFactionData` | `editFactionData`, `onEditFactionData` | `components/DetailRenderer/FactionDetailsRenderer.tsx`, `components/DetailRenderer/Shared/FactionChronicleView.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `editItemData` | `editItemData`, `onEditItemData` | `components/DetailRenderer/ItemDetailsRenderer.tsx`, `components/DetailRenderer/Shared/ItemJournalView.tsx`, `components/DetailRenderer/Shared/ItemTextContentView.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `editLocationData` | `editLocationData`, `onEditLocationData` | `components/DetailRenderer/LocationDetailsRenderer.tsx`, `components/DetailRenderer/types.ts`, `components/LocationLog.tsx`, `components/SidePanel.tsx` |
| `editNpcData` | `editNpcData`, `onEditNpcData` | `components/CharacterSheet/Header.tsx`, `components/CharacterSheet/NpcGoalsView.tsx`, `components/CharacterSheet/ProfileView.tsx`, `components/CharacterSheet/SkillsView.tsx`, `components/CharacterSheet.tsx`, `components/CombatTracker.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `editPlayerData` | `editPlayerData`, `onEditPlayerData` | `components/CharacterSheet/Header.tsx`, `components/CharacterSheet/ProfileView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/ActiveSkillDetailsRenderer.tsx`, `components/DetailRenderer/PassiveSkillDetailsRenderer.tsx`, `components/DetailRenderer/PlayerCharacterDetailsRenderer.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `editQuestData` | `editQuestData`, `onEditQuestData` | `components/DetailRenderer/QuestDetailsRenderer.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `editWeather` | `editWeather` | `components/SidePanel.tsx` |
| `editWorldState` | `editWorldState` | `components/SidePanel.tsx`, `components/WorldPanel.tsx` |
| `editWorldStateFlagData` | `editWorldStateFlagData` | `components/SidePanel.tsx` |
| `equipItem` | `onEquip` | `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx` |
| `forgetActiveWound` | `forgetActiveWound` | `components/CharacterSheet/ConditionsView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `forgetFaction` | `forgetFaction` | `components/SidePanel.tsx` |
| `forgetHealedWound` | `forgetHealedWound` | `components/CharacterSheet/ConditionsView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `forgetLocation` | `forgetLocation`, `onForgetLocation` | `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/LocationLog.tsx`, `components/SidePanel.tsx` |
| `forgetNpc` | `forgetNpc`, `onForgetNpc` | `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/NpcLog.tsx`, `components/SidePanel.tsx` |
| `forgetQuest` | `forgetQuest`, `onForgetQuest` | `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/QuestLog.tsx`, `components/SidePanel.tsx` |
| `handleEquipItemForNpc` | `handleEquipItemForNpc`, `onEquipItemForNpc` | `components/CharacterSheet.tsx`, `components/DetailRenderer/types.ts`, `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx`, `components/SidePanel.tsx` |
| `handleMergeItemsForNpc` | `handleMergeItemsForNpc`, `onMergeItemsForNpc` | `components/CharacterSheet.tsx`, `components/DetailRenderer/types.ts`, `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx`, `components/SidePanel.tsx` |
| `handleMoveItemForNpc` | `handleMoveItemForNpc`, `onMoveNpcItem` | `components/DetailRenderer/types.ts`, `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx`, `components/SidePanel.tsx` |
| `handleSplitItemForNpc` | `handleSplitItemForNpc`, `onSplitItemForNpc` | `components/CharacterSheet.tsx`, `components/DetailRenderer/types.ts`, `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx`, `components/SidePanel.tsx` |
| `handleTransferItem` | `handleTransferItem`, `onTransferItem` | `components/CharacterSheet.tsx`, `components/DetailRenderer/types.ts`, `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx`, `components/SidePanel.tsx` |
| `handleUnequipItemForNpc` | `handleUnequipItemForNpc`, `onUnequipItemForNpc` | `components/CharacterSheet.tsx`, `components/DetailRenderer/types.ts`, `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx`, `components/SidePanel.tsx` |
| `mergeItemStacks` | `onMergeItems` | `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx` |
| `moveFromStashToInventory` | `moveFromStashToInventory` | `components/SidePanel.tsx` |
| `moveItem` | `onMoveItem` | `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx` |
| `moveToLocationStorage` | `onMoveToStorage` | `components/StorageScreen.tsx` |
| `onDeleteCompletedActivity` | `onDeleteCompletedActivity` | `components/CharacterSheet.tsx`, `components/DetailRenderer/Shared/ActivityViewerModal.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `onDeleteCurrentActivity` | `onDeleteCurrentActivity` | `components/CharacterSheet.tsx`, `components/DetailRenderer/Shared/ActivityViewerModal.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `onDeleteNpcMemory` | `onDeleteNpcMemory` | `components/CharacterSheet/MemoriesView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `onEditNpcMemory` | `onEditNpcMemory` | `components/CharacterSheet/MemoriesView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `onRegenerateId` | `onRegenerateId` | `components/CharacterSheet/ProfileView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/FactionDetailsRenderer.tsx`, `components/DetailRenderer/ItemDetailsRenderer.tsx`, `components/DetailRenderer/LocationDetailsRenderer.tsx`, `components/DetailRenderer/QuestDetailsRenderer.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `placeAsStorage` | `placeAsStorage` | `components/DetailRenderer/ItemDetailsRenderer.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `retrieveFromLocationStorage` | `onRetrieveFromStorage` | `components/StorageScreen.tsx` |
| `revokeStorageAccess` | `onRevokeAccess` | `components/StorageScreen.tsx` |
| `setAutoCombatSkill` | `setAutoCombatSkill` | `components/CombatTracker.tsx`, `components/DetailRenderer/ActiveSkillDetailsRenderer.tsx`, `components/DetailRenderer/types.ts`, `components/SidePanel.tsx` |
| `shareStorageAccess` | `onShareAccess` | `components/StorageScreen.tsx` |
| `spendAttributePoint` | `onSpendAttributePoint` | `components/CharacterSheet/StatsView.tsx`, `components/CharacterSheet.tsx`, `components/SidePanel.tsx` |
| `splitItemStack` | `onSplitItem` | `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx` |
| `unequipItem` | `onUnequip` | `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx` |
| `updateActiveSkillSortOrder` | `updateActiveSkillSortOrder` | `components/CharacterSheet/SkillsView.tsx`, `components/CharacterSheet.tsx`, `components/SidePanel.tsx` |
| `updateItemSortOrder` | `updateItemSortOrder` | `components/DetailRenderer/types.ts`, `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx`, `components/SidePanel.tsx` |
| `updateItemSortSettings` | `updateItemSortSettings` | `components/DetailRenderer/types.ts`, `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx`, `components/SidePanel.tsx` |
| `updateNpcItemSortOrder` | `updateNpcItemSortOrder` | `components/CharacterSheet.tsx`, `components/DetailRenderer/types.ts`, `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx`, `components/SidePanel.tsx` |
| `updateNpcItemSortSettings` | `updateNpcItemSortSettings` | `components/CharacterSheet.tsx`, `components/DetailRenderer/types.ts`, `components/InventoryManagerUI.tsx`, `components/InventoryScreen.tsx`, `components/SidePanel.tsx` |
| `updateNpcPortrait` | `updateNpcPortrait` | `components/CharacterSheet/Header.tsx`, `components/CharacterSheet/ProfileView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/types.ts`, `components/NpcLog.tsx`, `components/SidePanel.tsx` |
| `updateNpcSortOrder` | `updateNpcSortOrder` | `components/NpcLog.tsx`, `components/SidePanel.tsx` |
| `updatePassiveSkillSortOrder` | `updatePassiveSkillSortOrder` | `components/CharacterSheet/SkillsView.tsx`, `components/CharacterSheet.tsx`, `components/SidePanel.tsx` |
| `updatePlayerPortrait` | `updatePlayerPortrait` | `components/CharacterSheet/Header.tsx`, `components/CharacterSheet/ProfileView.tsx`, `components/CharacterSheet.tsx`, `components/DetailRenderer/PlayerCharacterDetailsRenderer.tsx`, `components/DetailRenderer/index.tsx`, `components/DetailRenderer/types.ts`, `components/PartyStatus.tsx`, `components/PlayersPanel.tsx`, `components/SidePanel.tsx` |
