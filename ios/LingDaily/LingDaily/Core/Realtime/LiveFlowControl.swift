import Foundation

/// Drain the entire bounded backlog per wakeup, rather than pacing one frame
/// after each sleep. A 20ms frame is a unit of data, not a scheduler deadline.
enum LiveUploadBatch {
    static func take(nextFrame: () -> Data?, maximum: Int = 50) -> [Data] {
        var batch: [Data] = []
        while batch.count < maximum, let frame = nextFrame() { batch.append(frame) }
        return batch
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
struct LiveOutgoingBuffer {
    struct Item { let message: String; let audio: Bool }
    let capacity: Int
    private var items: [Item] = []
    private(set) var droppedAudioFrames = 0
    init(capacity: Int = 50) { self.capacity = max(1, capacity) }
    mutating func append(_ message: String, audio: Bool = false, priority: Bool = false) throws {
        if items.count >= capacity {
            if let index = items.firstIndex(where: \.audio) { items.remove(at: index); droppedAudioFrames += 1 }
            else if audio { droppedAudioFrames += 1; return }
            else { throw LiveProtocolError.overloaded }
        }
        let item = Item(message: message, audio: audio)
        if priority { items.insert(item, at: 0) } else { items.append(item) }
    }
    mutating func take() -> Item? { items.isEmpty ? nil : items.removeFirst() }
    mutating func clearAudio() { items.removeAll(where: \.audio) }
    mutating func clear() { items.removeAll(keepingCapacity: true) }
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
