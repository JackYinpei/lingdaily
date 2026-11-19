export const SELECTED_NEWS_STORAGE_KEY = 'selectedNews';
export const TALK_MODE_STORAGE_KEY = 'talk-mode';

const TALK_MODES = new Set(['news', 'scenario']);

// Resolved inside each try: reading `localStorage` itself throws when the
// browser blocks storage access.
function resolveStorage(storage) {
    return storage ?? globalThis.localStorage;
}

export function saveSelectedNewsToStorage(news, storage) {
    try {
        resolveStorage(storage).setItem(SELECTED_NEWS_STORAGE_KEY, JSON.stringify(news));
    } catch (error) {
        console.error('Failed to save selectedNews to localStorage:', error);
    }
}

export function loadSelectedNewsFromStorage(storage) {
    try {
        const saved = resolveStorage(storage).getItem(SELECTED_NEWS_STORAGE_KEY);
        return saved ? JSON.parse(saved) : null;
    } catch (error) {
        console.error('Failed to load selectedNews from localStorage:', error);
        return null;
    }
}

export function clearSelectedNewsFromStorage(storage) {
    try {
        resolveStorage(storage).removeItem(SELECTED_NEWS_STORAGE_KEY);
    } catch (error) {
        console.error('Failed to clear selectedNews from localStorage:', error);
    }
}

export function saveTalkModeToStorage(mode, storage) {
    try {
        resolveStorage(storage).setItem(TALK_MODE_STORAGE_KEY, mode);
    } catch (error) {
        console.error('Failed to save talk-mode to localStorage:', error);
    }
}

export function loadTalkModeFromStorage(storage) {
    try {
        const saved = resolveStorage(storage).getItem(TALK_MODE_STORAGE_KEY);
        return TALK_MODES.has(saved) ? saved : null;
    } catch (error) {
        console.error('Failed to load talk-mode from localStorage:', error);
        return null;
    }
}
