export async function sendTalkText({ input, restoring, connecting, connected, service, onError }) {
    if (!input.trim()) return false;
    if (restoring) {
        onError('正在恢复对话，请稍候再发送。');
        return false;
    }
    if (connecting) {
        onError('连接仍在建立，请连接完成后再发送。');
        return false;
    }
    if (service && connected) {
        try {
            if (await service.sendText(input) === true) return true;
        } catch {
            // Keep the draft if the socket closes during submission.
        }
    }
    onError('请先连接 Gemini Live，再发送消息。');
    return false;
}

export async function submitTextDraft({ draft, sendTextMessage, isComposing = false, onAccepted }) {
    const text = draft.trim();
    if (!text || isComposing) return false;
    try {
        const accepted = await sendTextMessage(text) === true;
        if (accepted) onAccepted();
        return accepted;
    } catch {
        return false;
    }
}
