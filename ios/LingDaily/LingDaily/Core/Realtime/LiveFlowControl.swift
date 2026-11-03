import Foundation

/// Drain the entire bounded backlog per wakeup, rather than pacing one frame
/// after each sleep. A 20ms frame is a unit of data, not a scheduler deadline.
enum LiveUploadBatch {
    static func take(nextFrame: () -> Data?, maximum: Int = 50) -> [Data] {
        var batch: [Data] = []
        while batch.count < maximum, let frame = nextFrame() { batch.append(frame) }
        return batch
    }

    /// Frames already waiting together go out as one message of up to 100 ms
    /// (the codec's limit), instead of one WebSocket message per 20 ms frame.
    /// Nothing waits for more audio, so latency is unchanged.
    static func messages(_ frames: [Data], framesPerMessage: Int = 5) -> [(pcm: Data, frames: Int)] {
        stride(from: 0, to: frames.count, by: max(1, framesPerMessage)).map { start in
            let group = frames[start..<min(start + max(1, framesPerMessage), frames.count)]
            return (group.reduce(into: Data()) { $0.append($1) }, group.count)
        }
    }
}

/// A batch can already have left the capture queue when mute occurs. Its epoch
/// must be rejected too, including after a quick mute/unmute in one connection.
struct LiveInputGate {
    private(set) var generation: UInt64 = 0
    private(set) var isOpen = false
    mutating func open() { generation &+= 1; isOpen = true }
    mutating func close() { generation &+= 1; isOpen = false }
    func accepts(_ epoch: UInt64) -> Bool { isOpen && epoch == generation }
}

struct LiveInputBuffer {
    let capacity: Int
    private var frames: [Data] = []
    private(set) var droppedFrames = 0
    init(capacity: Int = 50) { self.capacity = max(1, capacity) }
    mutating func append(_ incoming: [Data]) {
        let excess = max(0, frames.count + incoming.count - capacity)
        droppedFrames += excess
        frames = Array((frames + incoming).suffix(capacity))
    }
    mutating func take() -> Data? { frames.isEmpty ? nil : frames.removeFirst() }
    mutating func clear() { frames.removeAll(keepingCapacity: true) }
    var count: Int { frames.count }
}

/// Control messages are never discarded in favour of microphone frames.
/// Capacity counts 20 ms frames (a merged audio message weighs its frame count),
/// so the backlog stays bounded to the same duration of audio.
struct LiveOutgoingBuffer {
    struct Item {
        let message: String; let audio: Bool; let frames: Int
        var weight: Int { audio ? frames : 1 }
    }
    let capacity: Int
    private var items: [Item] = []
    private var weight = 0
    private(set) var droppedAudioFrames = 0
    init(capacity: Int = 50) { self.capacity = max(1, capacity) }
    mutating func append(_ message: String, audio: Bool = false, priority: Bool = false, frames: Int = 1) throws {
        let item = Item(message: message, audio: audio, frames: max(1, frames))
        while weight + item.weight > capacity {
            if let index = items.firstIndex(where: \.audio) {
                let dropped = items.remove(at: index)
                weight -= dropped.weight; droppedAudioFrames += dropped.frames
            } else if audio { droppedAudioFrames += item.frames; return }
            else if weight >= capacity { throw LiveProtocolError.overloaded }
            else { break }
        }
        weight += item.weight
        if priority { items.insert(item, at: 0) } else { items.append(item) }
    }
    mutating func take() -> Item? {
        guard !items.isEmpty else { return nil }
        let item = items.removeFirst()
        weight -= item.weight
        return item
    }
    mutating func clearAudio() { items.removeAll(where: \.audio); weight = items.count }
    mutating func clear() { items.removeAll(keepingCapacity: true); weight = 0 }
    var isEmpty: Bool { items.isEmpty }
    var count: Int { items.count }
}

enum LiveCaptureChunker {
    static let capacity = 4096
    static func length(remaining: Int) -> Int { min(max(0, remaining), capacity) }
}

enum LiveAudioRoutePolicy {
    enum Action { case ignore, reconfigure, stop }
    // AVAudioSession.RouteChangeReason raw values; Foundation-only and testable.
    static func action(reason: UInt) -> Action {
        switch reason {
        case 2, 7: return .stop // oldDeviceUnavailable / noSuitableRouteForCategory
        case 1, 4, 6, 8: return .reconfigure // new device / override / wake / route config
        default: return .ignore // category changes (including enabling voice processing)
        }
    }
}
