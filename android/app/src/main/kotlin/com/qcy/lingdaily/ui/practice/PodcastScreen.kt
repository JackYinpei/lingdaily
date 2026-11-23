package com.qcy.lingdaily.ui.practice

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import com.qcy.lingdaily.core.model.TodayEpisode
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.Avatar
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.Chip
import com.qcy.lingdaily.ui.Hairline
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.SurfaceCard
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.PageTitle
import com.qcy.lingdaily.ui.medium
import com.qcy.lingdaily.ui.semibold

/** 12:05, or 1:02:05 for an hour and more. */
fun clock(milliseconds: Long): String {
    val seconds = milliseconds / 1000
    return if (seconds >= 3600) "%d:%02d:%02d".format(seconds / 3600, seconds % 3600 / 60, seconds % 60)
    else "%d:%02d".format(seconds / 60, seconds % 60)
}

private val SPEEDS = listOf(0.8f, 1f, 1.25f, 1.5f)

/**
 * The daily podcast on its own page: what is playing with a seek bar, 15-second jumps and
 * speed, its terms and rehearsal, and the episodes of the last weeks underneath.
 */
@Composable
fun PodcastScreen(screen: Screen.Podcast) {
    val navigator = LocalNavigator.current
    ScreenScaffold(title = "每日播客", onBack = { navigator.close(screen) }) {
        ReadableColumn(Modifier.weight(1f)) { PodcastList() }
    }
}

/** 播客: the same page as a tab of its own, with the page title on top. */
@Composable
fun PodcastTab() {
    ReadableColumn(Modifier.fillMaxSize()) { PodcastList(title = "播客") }
}

@Composable
private fun PodcastList(title: String? = null) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val player = app.podcast
    val store = app.podcasts
    val colors = Brand.colors
    val scope = rememberCoroutineScope()
    LaunchedEffect(app.account.canPractice) {
        launch { store.refresh() }
        // 「今日」 (the newest episode with its rehearsal) needs an account.
        if (app.account.canPractice) app.today.refresh()
    }

    // What the page is about: the loaded episode, else today's, else the newest in the list.
    val current = player.episode ?: app.today.episode ?: store.episodes.firstOrNull()
    // 「今日」 carries the rehearsal; the list does not.
    val rehearsal = app.today.episode?.takeIf { it.date == current?.date }?.practiceScenario

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = if (title != null) 20.dp else 12.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (title != null) item(key = "title") { Box(Modifier.padding(bottom = 12.dp)) { PageTitle(title) } }
                if (current != null) item(key = "player") {
                    SurfaceCard(Modifier.padding(bottom = 12.dp), padding = 20.dp, spacing = 14.dp) {
                        Text(current.source.removePrefix("每日播客 ").ifEmpty { current.date }, style = Type.caption.semibold, color = colors.accent)
                        Text(current.title, style = Type.title2, color = colors.ink)
                        if (current.summary.isNotEmpty()) Text(current.summary, style = Type.subheadline, color = colors.secondary)
                        PlayerControls(current)
                        player.errorMessage?.let { Text(it, style = Type.caption, color = colors.accent) }
                        if (current.vocabulary.isNotEmpty()) {
                            Hairline()
                            TextAction("${current.vocabulary.size} 个生词", color = colors.ink, trailingIcon = AppIcons.ChevronRight,
                                modifier = Modifier.fillMaxWidth().testTag("podcast-vocabulary")) { navigator.push(Screen.TodayVocabulary(current)) }
                        }
                        if (rehearsal != null) {
                            Hairline()
                            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button) { navigator.push(Screen.Preparation(rehearsal)) },
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Avatar(rehearsal, 36.dp)
                                Column(Modifier.weight(1f)) {
                                    Text("和 ${rehearsal.partner} 聊聊这条新闻", style = Type.subheadline.semibold, color = colors.ink)
                                    Text(rehearsal.title, style = Type.caption, color = colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Icon(AppIcons.ArrowForward, null, Modifier.size(20.dp), tint = colors.ink)
                            }
                        }
                    }
                }
                item(key = "past") { Text("往期", style = Type.headline, color = colors.ink) }
                when {
                    store.episodes.isNotEmpty() -> items(store.episodes, key = { it.date }) { episode -> EpisodeRow(episode) }
                    store.isLoading -> item(key = "loading") {
                        Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(22.dp), color = colors.secondary, strokeWidth = 2.dp)
                        }
                    }
                    store.failed -> item(key = "failed") {
                        TextAction("往期播客没有加载出来，点此重试", style = Type.subheadline) { scope.launch { store.refresh(force = true) } }
                    }
                    else -> item(key = "empty") { Text("还没有往期播客。", style = Type.subheadline, color = colors.secondary) }
                }
    }
}

@Composable
private fun PlayerControls(episode: TodayEpisode) {
    val player = LocalApp.current.podcast
    val colors = Brand.colors
    val loaded = player.isCurrent(episode)
    val duration = if (loaded) player.durationMs else (episode.duration ?: 0) * 1000L
    // While the thumb is held, it shows where the learner is pointing, not where playback is.
    var dragging by remember { mutableStateOf<Float?>(null) }
    val fraction = dragging ?: if (loaded) player.progress else 0f

    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Slider(
            value = fraction, onValueChange = { dragging = it },
            onValueChangeFinished = {
                dragging?.let(player::seekTo)
                dragging = null
            },
            enabled = loaded && duration > 0,
            colors = SliderDefaults.colors(thumbColor = colors.accent, activeTrackColor = colors.accent, inactiveTrackColor = colors.line,
                disabledThumbColor = colors.line, disabledActiveTrackColor = colors.line, disabledInactiveTrackColor = colors.line),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "播放进度" }.testTag("podcast-seek"),
        )
        Row {
            Text(clock((duration * fraction).toLong()), style = Type.caption, color = colors.secondary, modifier = Modifier.weight(1f))
            Text(if (duration > 0) clock(duration) else "--:--", style = Type.caption, color = colors.secondary)
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        JumpButton("−15", "后退 15 秒", enabled = loaded) { player.skip(-15_000) }
        val playing = loaded && player.isPlaying
        Box(
            Modifier.size(64.dp).clip(CircleShape).background(colors.ink)
                .clickable(enabled = episode.playableURL != null, role = Role.Button) { player.toggle(episode) }
                .semantics { contentDescription = if (playing) "暂停" else "播放" }.testTag("podcast-play"),
            contentAlignment = Alignment.Center,
        ) { Icon(if (playing) AppIcons.Pause else AppIcons.Play, null, Modifier.size(30.dp), tint = colors.onInk) }
        JumpButton("+15", "前进 15 秒", enabled = loaded) { player.skip(15_000) }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        Text("语速", style = Type.caption, color = colors.secondary)
        for (value in SPEEDS) {
            Chip(if (value == 1f) "1×" else "${value.toString().trimEnd('0').trimEnd('.')}×", selected = player.speed == value, minHeight = 30.dp,
                modifier = Modifier.testTag("podcast-speed-$value")) { player.changeSpeed(value) }
        }
    }
    if (episode.playableURL == null) Text("这期播客暂时没有音频。", style = Type.caption, color = colors.secondary)
}

@Composable
private fun JumpButton(label: String, description: String, enabled: Boolean, onClick: () -> Unit) {
    val colors = Brand.colors
    Box(
        Modifier.size(48.dp).clip(CircleShape).border(1.5.dp, colors.line, CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Text(label, style = Type.subheadline.medium, color = if (enabled) colors.ink else colors.secondary) }
}

@Composable
private fun EpisodeRow(episode: TodayEpisode) {
    val player = LocalApp.current.podcast
    val colors = Brand.colors
    val loaded = player.isCurrent(episode)
    val playing = loaded && player.isPlaying
    SurfaceCard(Modifier.clip(androidx.compose.foundation.shape.RoundedCornerShape(20.dp))
        .clickable(enabled = episode.playableURL != null, role = Role.Button) { player.toggle(episode) }.testTag("episode-${episode.date}"), padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                val length = episode.duration?.let { " · ${maxOf(1, Math.round(it / 60.0).toInt())} 分钟" }.orEmpty()
                Text(episode.source.removePrefix("每日播客 ").ifEmpty { episode.date } + length, style = Type.caption.medium,
                    color = if (loaded) colors.accent else colors.secondary)
                Text(episode.title, style = Type.subheadline.semibold, color = colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (episode.summary.isNotEmpty()) Text(episode.summary, style = Type.caption, color = colors.secondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (episode.playableURL != null) {
                Icon(if (playing) AppIcons.Pause else AppIcons.Play, if (playing) "暂停" else "播放", Modifier.size(22.dp),
                    tint = if (loaded) colors.accent else colors.ink)
            }
        }
    }
}
