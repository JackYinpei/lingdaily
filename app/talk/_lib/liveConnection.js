/**
 * Starts the token request only after output audio has been unlocked inside the
 * current user gesture. Keep this function synchronous until fetch is invoked:
 * callers can safely await the returned promise without losing that gesture.
 */
export function fetchRealtimeTokenAfterPriming({
    service,
    signal,
    fetchImpl = fetch,
}) {
    if (!service) throw new Error('Gemini Live service is not initialized');

    service.primeOutputAudio();
    return fetchImpl('/api/realtime-token', {
        method: 'POST',
        signal,
    }).then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.token) {
            throw new Error(data.error || 'Failed to get access token');
        }
        return data.token;
    });
}
