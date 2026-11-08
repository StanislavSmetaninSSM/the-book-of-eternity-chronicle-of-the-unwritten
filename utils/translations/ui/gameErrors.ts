/**
 * Messages the game logic itself raises: load and recovery guards plus the couple of
 * input checks that used to carry their own `language === 'ru' ? ... : ...` pairs.
 */
export const gameErrors = {
  en: {
    "load_unavailable_while_game_changing": "Loading is unavailable while the game is changing. Wait for the current action and retry.",
    "interrupted_turn_recovery_needs_local_idle_game": "Interrupted-turn recovery requires a local checkpoint and an idle game.",
    "interrupted_turn_recovery_resume_state_changed": "The state changed or the game is busy; try again later.",
    "interrupted_turn_discard_unavailable": "Discarding an interrupted turn is unavailable while the game is changing. Try again after the current action.",
    "interrupted_turn_checkpoint_not_found": "No interrupted-turn checkpoint was found.",
    "interrupted_turn_checkpoint_changed": "The checkpoint changed or was removed. Review the current recovery before trying again.",
    "crash_recovery_unavailable_while_game_busy": "Recovery is unavailable during a turn or game update. Wait for it to finish and try again.",
    "crash_recovery_state_not_found": "No stable crash recovery state was found.",
    "crash_recovery_state_changed": "The game state changed while recovery was loading. Retry if you want to load the checkpoint.",
    "quest_reward_scaled_for_danger": "The world grows more dangerous. The reward for quest '{name}' has been increased from {old} XP to {new} XP to remain relevant.",
    "image_upload_unsupported_type": "Supported images: PNG, JPEG, WebP, GIF and BMP.",
    "image_upload_too_large": "The image must be no larger than 4 MiB."
  },
  ru: {
    "load_unavailable_while_game_changing": "Загрузка недоступна во время хода или изменения игры. Дождитесь завершения действия и повторите загрузку.",
    "interrupted_turn_recovery_needs_local_idle_game": "Возобновление доступно только для локального прерванного хода, когда игра не занята.",
    "interrupted_turn_recovery_resume_state_changed": "Состояние изменилось или игра занята; повторите запрос позже.",
    "interrupted_turn_discard_unavailable": "Отмена сохранённого прерванного хода недоступна во время изменения игры. Повторите запрос после завершения текущего действия.",
    "interrupted_turn_checkpoint_not_found": "Сохранённый прерванный ход не найден.",
    "interrupted_turn_checkpoint_changed": "Сохранённый ход изменился или был удалён. Проверьте текущее восстановление перед повтором.",
    "crash_recovery_unavailable_while_game_busy": "Восстановление недоступно во время хода или изменения игры. Дождитесь завершения и повторите запрос.",
    "crash_recovery_state_not_found": "Стабильное состояние для восстановления не найдено.",
    "crash_recovery_state_changed": "Состояние игры изменилось во время чтения восстановления. Повторите запрос, если хотите загрузить сохранение.",
    "quest_reward_scaled_for_danger": "Мир становится опаснее. Награда за квест «{name}» была увеличена с {old} XP до {new} XP, чтобы оставаться актуальной.",
    "image_upload_unsupported_type": "Поддерживаются изображения PNG, JPEG, WebP, GIF и BMP.",
    "image_upload_too_large": "Размер изображения не должен превышать 4 МиБ."
  }
};
