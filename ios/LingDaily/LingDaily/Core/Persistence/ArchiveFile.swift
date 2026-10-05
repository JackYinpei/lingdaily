import Foundation

enum ArchiveError: LocalizedError {
    case unsupportedVersion, invalidSession
    var errorDescription: String? {
        switch self {
        case .unsupportedVersion: return "记录来自更新版本，当前版本不能修改这些记录。"
        case .invalidSession: return "练习记录格式异常，原文件已保留。"
        }
    }
}

struct ArchiveFile {
    let url: URL

    func load() throws -> PracticeArchive {
        guard FileManager.default.fileExists(atPath: url.path) else { return PracticeArchive() }
        var archive = try JSONDecoder().decode(PracticeArchive.self, from: Data(contentsOf: url))
        guard (1...2).contains(archive.schemaVersion) else { throw ArchiveError.unsupportedVersion }
        guard archive.sessions.allSatisfy(\.isValid) else { throw ArchiveError.invalidSession }
        archive.schemaVersion = 2
        return archive
    }

    func save(_ archive: PracticeArchive) throws {
        guard archive.schemaVersion == 2 else { throw ArchiveError.unsupportedVersion }
        guard archive.sessions.allSatisfy(\.isValid) else { throw ArchiveError.invalidSession }
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(archive)
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
        #else
        try data.write(to: url, options: .atomic)
        #endif
        var resourceURL = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try resourceURL.setResourceValues(values)
    }
}
