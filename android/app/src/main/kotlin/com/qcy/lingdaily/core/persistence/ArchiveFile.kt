package com.qcy.lingdaily.core.persistence

import java.io.File
import java.io.IOException
import kotlinx.serialization.encodeToString
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.PracticeArchive

class ArchiveException(message: String) : IOException(message)

/** Writes a file so that a crash mid-write leaves the previous contents intact. */
internal fun File.writeAtomically(text: String) {
    parentFile?.mkdirs()
    val temporary = File(parentFile, "$name.tmp")
    temporary.writeText(text)
    if (!temporary.renameTo(this)) {
        temporary.delete()
        throw IOException("Could not replace $name")
    }
}

/** The learner's rehearsals, 词库 and own scenarios on this device, as one versioned JSON file. */
class ArchiveFile(private val file: File) {
    fun load(): PracticeArchive {
        if (!file.exists()) return PracticeArchive()
        val archive = AppJson.decodeFromString<PracticeArchive>(file.readText())
        if (archive.schemaVersion !in 1..2) throw ArchiveException("记录来自更新版本，当前版本不能修改这些记录。")
        if (!archive.sessions.all { it.isValid }) throw ArchiveException("练习记录格式异常，原文件已保留。")
        return archive.copy(schemaVersion = 2)
    }

    fun save(archive: PracticeArchive) {
        if (archive.schemaVersion != 2) throw ArchiveException("记录来自更新版本，当前版本不能修改这些记录。")
        if (!archive.sessions.all { it.isValid }) throw ArchiveException("练习记录格式异常，原文件已保留。")
        file.writeAtomically(AppJson.encodeToString(archive))
    }
}
