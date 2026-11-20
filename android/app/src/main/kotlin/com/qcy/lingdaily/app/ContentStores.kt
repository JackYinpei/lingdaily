package com.qcy.lingdaily.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.TodayEpisode
import com.qcy.lingdaily.core.model.nowMillis
import com.qcy.lingdaily.core.network.PracticeApiClient
import com.qcy.lingdaily.core.network.PracticeNetworkException
import com.qcy.lingdaily.core.persistence.writeAtomically

/**
 * Built-in scenarios from the server, cached on the device. The four bundled ones are
 * the fallback, so the home page never starts empty, even offline on first launch.
 */
class ScenarioCatalogStore(private val file: File, private val api: PracticeApiClient) {
    var scenarios by mutableStateOf(cached() ?: ScenarioLibrary.all)
        private set
    private var refreshing = false
    private var refreshedAt: Long? = null

    fun scenario(id: String): PracticeScenario? = scenarios.firstOrNull { it.id == id }

    suspend fun refresh() {
        // The server marks the catalog fresh for 10 minutes; launch and return-to-app both ask for it.
        if (refreshing || refreshedAt?.let { nowMillis() - it < FRESH_MS } == true) return
        refreshing = true
        try {
            val fresh = try {
                api.scenarioCatalog()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                return
            }
            refreshedAt = nowMillis()
            if (fresh == scenarios) return
            scenarios = fresh
            withContext(Dispatchers.IO) {
                runCatching { file.writeAtomically(AppJson.encodeToString(ListSerializer(PracticeScenario.serializer()), fresh)) }
            }
        } finally {
            refreshing = false
        }
    }

    private fun cached(): List<PracticeScenario>? = runCatching {
        AppJson.decodeFromString(ListSerializer(PracticeScenario.serializer()), file.readText())
    }.getOrNull()?.takeIf { it.isNotEmpty() }
}

/** 「今日」: the latest daily podcast and its rehearsal. Kept in memory; refreshed on return to the app. */
class TodayStore(private val api: PracticeApiClient) {
    var episode by mutableStateOf<TodayEpisode?>(null)
        private set
    private var loadedAt: Long? = null
    private var refreshing = false

    suspend fun refresh(force: Boolean = false) {
        if (refreshing) return
        // Within 10 minutes only a missing rehearsal is worth asking for again.
        if (!force && episode?.scenario != null && loadedAt?.let { nowMillis() - it < FRESH_MS } == true) return
        refreshing = true
        try {
            episode = api.today()
            loadedAt = nowMillis()
        } catch (error: CancellationException) {
            throw error
        } catch (error: PracticeNetworkException) {
            if (error.kind == PracticeNetworkException.Kind.SIGNED_OUT) episode = null
        } catch (_: Exception) {
        } finally {
            refreshing = false
        }
    }

    fun clear() {
        episode = null
        loadedAt = null
    }
}

/** The daily podcasts of the last weeks for the player page. Kept in memory. */
class PodcastStore(private val api: PracticeApiClient) {
    var episodes by mutableStateOf(emptyList<TodayEpisode>())
        private set
    var isLoading by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    private var loadedAt: Long? = null

    suspend fun refresh(force: Boolean = false) {
        if (isLoading || (!force && episodes.isNotEmpty() && loadedAt?.let { nowMillis() - it < FRESH_MS } == true)) return
        isLoading = true
        failed = false
        try {
            episodes = api.podcasts()
            loadedAt = nowMillis()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            failed = true
        } finally {
            isLoading = false
        }
    }
}

private const val FRESH_MS = 600_000L
