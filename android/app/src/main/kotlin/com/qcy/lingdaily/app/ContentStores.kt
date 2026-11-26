package com.qcy.lingdaily.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.PartnerCharacter
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.ScenarioCatalog
import com.qcy.lingdaily.core.model.ScenarioExtras
import com.qcy.lingdaily.core.model.TodayEpisode
import com.qcy.lingdaily.core.model.nowMillis
import com.qcy.lingdaily.core.model.parseScenarioCatalog
import com.qcy.lingdaily.core.network.PracticeApiClient
import com.qcy.lingdaily.core.persistence.writeAtomically

/**
 * Built-in scenarios from the server, cached on the device. Before the first refresh (or
 * offline), all 25 bundled scenarios and their `tags` & `cast` load directly from
 * `R.raw.scenario_catalog`.
 */
class ScenarioCatalogStore(
    private val file: File,
    private val api: PracticeApiClient,
    bundledCatalog: () -> String = { "" },
) {
    private val extrasFile = File(file.parentFile, "scenario-catalog-extras.json")
    private val initial: ScenarioCatalog = loadInitial(bundledCatalog)

    var scenarios by mutableStateOf(initial.scenarios)
        private set

    /** Interest tags and alternate cast by scenario id. */
    var extras by mutableStateOf(initial.extras)
        private set

    private var refreshing = false
    private var refreshedAt: Long? = null

    fun scenario(id: String): PracticeScenario? = scenarios.firstOrNull { it.id == id }

    /** Who can play this scenario's partner; empty when there is no choice. */
    fun cast(scenarioID: String): List<PartnerCharacter> = extras[scenarioID]?.cast.orEmpty()

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
            if (fresh.scenarios == scenarios && fresh.extras == extras) return
            scenarios = fresh.scenarios
            extras = fresh.extras
            withContext(Dispatchers.IO) {
                runCatching { file.writeAtomically(AppJson.encodeToString(ListSerializer(PracticeScenario.serializer()), fresh.scenarios)) }
                runCatching {
                    extrasFile.writeAtomically(AppJson.encodeToString(ListSerializer(ScenarioExtras.serializer()), fresh.extras.values.toList()))
                }
            }
        } finally {
            refreshing = false
        }
    }

    private fun loadInitial(bundledCatalog: () -> String): ScenarioCatalog {
        val diskScenarios = cached()
        if (diskScenarios != null) {
            return ScenarioCatalog(diskScenarios, cachedExtras())
        }
        val bundled = runCatching { parseScenarioCatalog(bundledCatalog()) }.getOrNull()
        if (bundled != null && bundled.scenarios.isNotEmpty()) return bundled
        return ScenarioCatalog(ScenarioLibrary.all, emptyMap())
    }

    private fun cached(): List<PracticeScenario>? = runCatching {
        AppJson.decodeFromString(ListSerializer(PracticeScenario.serializer()), file.readText())
    }.getOrNull()?.takeIf { it.isNotEmpty() }

    private fun cachedExtras(): Map<String, ScenarioExtras> = runCatching {
        AppJson.decodeFromString(ListSerializer(ScenarioExtras.serializer()), extrasFile.readText())
    }.getOrDefault(emptyList()).associate { it.id to it.cleaned() }
}

/** The daily podcasts of the last weeks for the player page, plus per-episode news rehearsals in memory. */
class PodcastStore(private val api: PracticeApiClient) {
    var episodes by mutableStateOf(emptyList<TodayEpisode>())
        private set
    var isLoading by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    /** Generated 3-step news rehearsals cached in memory keyed by `episode.date`. */
    val rehearsals = mutableStateMapOf<String, PracticeScenario>()
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

    fun clearRehearsals() {
        rehearsals.clear()
    }
}

private const val FRESH_MS = 600_000L
