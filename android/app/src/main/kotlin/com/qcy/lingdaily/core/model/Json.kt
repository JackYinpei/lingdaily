package com.qcy.lingdaily.core.model

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.UUID
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json

/**
 * One JSON shape for the device archive, the service and cloud sync. It is the shape the
 * iOS app syncs, so a rehearsal started on one platform opens on the other: absent
 * optionals are omitted, defaults such as empty lists are written, unknown keys are ignored.
 */
val AppJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

typealias Uuid = @Serializable(with = UuidSerializer::class) UUID

/** A point in time as epoch milliseconds, the precision of the wire format. */
typealias Millis = @Serializable(with = IsoMillisSerializer::class) Long

fun nowMillis(): Long = System.currentTimeMillis()

object UuidSerializer : KSerializer<UUID> {
    private val pattern = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("LingDailyUUID", PrimitiveKind.STRING)

    // Upper case, as Swift writes them: a session edited on either platform keeps the same ids.
    override fun serialize(encoder: Encoder, value: UUID) = encoder.encodeString(value.toString().uppercase())

    override fun deserialize(decoder: Decoder): UUID {
        val text = decoder.decodeString()
        if (!pattern.matches(text)) throw SerializationException("Invalid UUID")
        return UUID.fromString(text)
    }
}

/** ISO 8601 with milliseconds in UTC when written; any ISO 8601 offset date-time when read. */
object IsoMillisSerializer : KSerializer<Long> {
    private val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("LingDailyDate", PrimitiveKind.STRING)

    fun format(millis: Long): String = formatter.format(Instant.ofEpochMilli(millis))

    fun parse(text: String): Long? = try {
        OffsetDateTime.parse(text).toInstant().toEpochMilli()
    } catch (_: DateTimeParseException) {
        null
    }

    override fun serialize(encoder: Encoder, value: Long) = encoder.encodeString(format(value))

    override fun deserialize(decoder: Decoder): Long =
        parse(decoder.decodeString()) ?: throw SerializationException("Invalid date")
}

/** The first `count` UTF-16 units (what the service counts), never half of a surrogate pair. */
fun String.prefix(count: Int): String {
    if (length <= count) return this
    val end = if (count > 0 && Character.isHighSurrogate(this[count - 1])) count - 1 else count
    return substring(0, end)
}
