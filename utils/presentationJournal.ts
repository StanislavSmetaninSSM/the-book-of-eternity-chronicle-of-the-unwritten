import type { Cinematic, GameState, ImageCacheEntry } from '../types';

// Local presentation edits are replayed until an authoritative snapshot
// includes them. This avoids undoing a completed film or image on sync.
export class PresentationJournal {
    private images = new Map<string, ImageCacheEntry | null>();
    private films = new Map<string, Cinematic | null>();

    record(before: GameState | null, after: GameState | null): void {
        if (!before || !after) return;
        const oldImages = before.imageCache || {}, newImages = after.imageCache || {};
        for (const key of new Set([...Object.keys(oldImages), ...Object.keys(newImages)])) {
            if (oldImages[key] !== newImages[key]) this.images.set(key, newImages[key] ?? null);
        }
        const oldFilms = new Map((before.cinematics || []).map(film => [film.id, film]));
        const newFilms = new Map((after.cinematics || []).map(film => [film.id, film]));
        for (const id of new Set([...oldFilms.keys(), ...newFilms.keys()])) {
            if (oldFilms.get(id) !== newFilms.get(id)) this.films.set(id, newFilms.get(id) ?? null);
        }
    }

    // Remove entries only when the host actually confirms the desired value.
    acknowledge(authoritative: GameState): void {
        const equal = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
        const images = authoritative.imageCache || {};
        for (const [key, value] of this.images) if (equal(images[key] ?? null, value)) this.images.delete(key);
        const films = new Map((authoritative.cinematics || []).map(film => [film.id, film]));
        for (const [key, value] of this.films) if (equal(films.get(key) ?? null, value)) this.films.delete(key);
    }

    apply(state: GameState): GameState {
        if (!this.images.size && !this.films.size) return state;
        const images = { ...(state.imageCache || {}) };
        for (const [key, value] of this.images) { if (value === null) delete images[key]; else images[key] = value; }
        const films = [...(state.cinematics || [])];
        for (const [key, value] of this.films) {
            const index = films.findIndex(film => film.id === key);
            if (value === null) { if (index >= 0) films.splice(index, 1); }
            else if (index >= 0) films[index] = value;
            else films.push(value);
        }
        return { ...state, imageCache: images, cinematics: films };
    }

    matches(state: GameState): boolean {
        const images = state.imageCache || {};
        for (const [key, value] of this.images) if ((images[key] ?? null) !== value) return false;
        const films = new Map((state.cinematics || []).map(film => [film.id, film]));
        for (const [key, value] of this.films) if ((films.get(key) ?? null) !== value) return false;
        return true;
    }

    clear(): void { this.images.clear(); this.films.clear(); }
}
