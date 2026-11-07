> **Historical / superseded:** Multiplayer was removed in favor of single-player gameplay. This document records the former implementation and is not a current design or implementation plan.

# Матрица прямых пользовательских callbacks hook

Для всех строк текущее решение: **временно заблокировать player/spectator**, доступны host/none при действующих проверках настроек; право удалённой команды не предоставлено. Все будущие команды требуют проверки соединения, session/base revision, operation ID, атомарности, commit/ACK и конфликта. Изменение имени, отсутствие или дубли ID не дают права угадывать цель. Удаления и массовые очистки необратимы без сохранённой истории; их политика требует отдельного решения. Обычная синхронизация context после commit общая для всех state-полей; в таблице дополнительно отмечены прямые записи в `gameContextRef` внутри updater, которые пока сами по себе не являются commit.

| Публичный callback | Цель, текущая запись и прямые side effects | Безопасная предпосылка и конфликт для будущей команды |
| --- | --- | --- |
| `editLocationData` | locationId, field/value; текущая/посещённая локация и карта, context; несколько setters | Уникальный locationId, разрешённые поля/права и единая revision копий; concurrent смена локации/редактирование. |
| `deleteLocationThreat` | locationId/threatId; карта, current, visited и context | Уникальные locationId/threatId, право и CAS всех копий; удаление активности и новых данных необратимо. |
| `updatePlayerPortrait` | playerId; portrait/prompt, imageCache | Свой уникальный playerId, допустимый тип/размер изображения и права; замена/удаление прежнего ключа и другая правка портрета. |
| `updateNpcPortrait` | NPCId; portrait/prompt, imageCache | Уникальный NPCId, права и лимиты; одновременная замена или удаление NPC. |
| `deleteActiveSkill` | displayed player, skillName; activeSkills и skillMasteryData | Подтверждённый playerId, однозначный стабильный ID навыка или строгая база; дубли имён и новые mastery. |
| `deletePassiveSkill` | displayed player, skillName; passiveSkills | Подтверждённый playerId, однозначный навык/CAS; дубли и новый навык с тем же именем. |
| `deleteActiveEffect` | player/NPC + effectId; active effects, context напрямую | Уникальный владелец/effectId, права; не удалять эффекты по совпадению имени и не считать удаление заменой лечения раны. |
| `forgetHealedWound` | player/NPC + woundId; wounds, context напрямую | История заживших ран должна сохраняться; без согласованного архивирования и прав отклонять. |
| `forgetActiveWound` | player/NPC + woundId; wounds и эффекты с sourceWoundId, context | Уникальный woundId и владелец, права и база; рана самостоятельна, снимать лишь связанные эффекты. |
| `clearAllHealedWounds` | player/NPC; wounds, context | Сохранение истории и точный набор/CAS; новые раны не удалять, политика требует решения. |
| `onEditNpcMemory` | NPCId + memory; unlockedMemories, context | Уникальные NPCId/memoryId, права, whitelist/CAS; не перезаписать параллельную память. |
| `onDeleteNpcMemory` | NPCId/memoryId; unlockedMemories, context | Уникальные ID и права; необратимое удаление, concurrent edit конфликт. |
| `clearAllCompletedFactionProjects` | factionId; completedProjects, context | Уникальный factionId, права и точный набор/CAS; сохранять активные проекты. |
| `clearAllCompletedNpcActivities` | NPCId; completedActivities, context | Уникальный NPCId, права и точный набор/CAS; сохранять активные занятия. |
| `onDeleteCurrentActivity` | NPCId; currentActivity | Уникальный NPCId/activityId, право и ожидаемая версия занятия; новое занятие не удалять. |
| `onDeleteCompletedActivity` | NPCId + activityName/completionTurn; completedActivities | Стабильный ID записи либо строгий CAS; одинаковые name/turn могут удалить несколько записей. |
| `deleteFactionProject` | factionId/projectId; activeProjects, context | Уникальные ID, права и CAS; следствия активного проекта и связанные действия проверить до удаления. |
| `deleteFactionCustomState` | factionId + stateIdOrName; customStates, context | Однозначные ID, права и CAS; не использовать fallback по имени при неоднозначности. |
| `deleteCustomState` | displayed player + idOrName; playerCustomStates и context | Подтверждённый playerId/stateId, права/CAS; fallback по имени и дубликаты запрещены для команды. |
| `deleteNpcCustomState` | NPCId + idOrName; customStates, context | Уникальные NPCId/stateId, права/CAS; не выбирать по имени. |
| `deleteFactionBonus` | factionId + bonusIdentifier; structuredBonuses, context | Уникальные factionId/bonusId, права/CAS; не удалять по совпавшему описанию. |
| `clearNpcJournalsNow` | все NPC; journalEntries, context | Отдельное административное право, подтверждение и точная база всех журналов; новые записи/смена NPC — конфликт. |

Маршруты App и связанных компонентов описаны также в [матрице мира и истории](client-edit-world-history-matrix.md); одноимённые менеджерские функции могут быть перекрыты прямым hook callback и не являются доказательством для него. `scripts/client-all-manager-actions-guard.test.mjs` перечисляет эти 22 имени и проверяет production guard с контролируемыми setters; это не исчерпывающий UI/browser или семантический тест. Ранее невключённый `deleteFactionCompletedProject` теперь возвращается публичным hook и подключён к вкладке «Completed» панели фракции (`scripts/faction-completed-project-deletion.test.mjs`, `e2e/faction-projects.spec.ts`).
