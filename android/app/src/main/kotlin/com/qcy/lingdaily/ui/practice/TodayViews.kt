package com.qcy.lingdaily.ui.practice

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import kotlin.math.max
import kotlin.math.roundToInt
import com.qcy.lingdaily.core.audio.PodcastPlayer
import com.qcy.lingdaily.core.model.AILearningItem
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.SavedExpression
import com.qcy.lingdaily.core.model.TodayEpisode
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.Avatar
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.Hairline
import com.qcy.lingdaily.ui.IconAction
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.SurfaceCard
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.medium
import com.qcy.lingdaily.ui.semibold

/** 「今日」: the latest daily podcast to listen to, its eight terms, and a rehearsal about one story. */
@Composable
fun TodayCard(episode: TodayEpisode, player: PodcastPlayer, onPractice: (PracticeScenario) -> Unit, onVocabulary: () -> Unit) {
    val colors = Brand.colors
    val heading = if (episode.date == LocalDate.now().toString()) "今日播客" else "最新播客 · ${episode.source.removePrefix("每日播客 ")}"
    SurfaceCard(spacing = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(heading, style = Type.caption.semibold, color = colors.accent, modifier = Modifier.weight(1f))
            episode.duration?.let {
                Text("${max(1, (it / 60.0).roundToInt())} 分钟", style = Type.caption, color = colors.secondary)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(episode.title, style = Type.headline, color = colors.ink)
            if (episode.summary.isNotEmpty()) {
                Text(episode.summary, style = Type.subheadline, color = colors.secondary, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (episode.playableURL != null) {
                val playing = player.isCurrent(episode) && player.isPlaying
                Row(
                    Modifier.heightIn(min = 44.dp).clip(CircleShape).background(colors.ink)
                        .clickable(role = Role.Button) { player.toggle(episode) }.padding(horizontal = 16.dp).testTag("today-play"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(if (playing) AppIcons.Pause else AppIcons.Play, null, Modifier.size(18.dp), tint = colors.onInk)
                    Spacer(Modifier.width(6.dp))
                    Text(if (playing) "暂停" else "收听", style = Type.subheadline.semibold, color = colors.onInk)
                }
            }
            if (episode.vocabulary.isNotEmpty()) {
                Box(
                    Modifier.heightIn(min = 44.dp).clip(CircleShape).border(1.5.dp, colors.line, CircleShape)
                        .clickable(role = Role.Button, onClick = onVocabulary).padding(horizontal = 16.dp).testTag("today-vocabulary"),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("${episode.vocabulary.size} 个生词", style = Type.subheadline.medium, color = colors.ink)
                }
            }
        }
        if (player.isCurrent(episode)) {
            LinearProgressIndicator(progress = { player.progress }, color = colors.accent, trackColor = colors.line, drawStopIndicator = {},
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "播放进度" })
        }
        player.errorMessage?.let { Text(it, style = Type.caption, color = colors.secondary) }
        episode.practiceScenario?.let { scenario ->
            Hairline()
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button) { onPractice(scenario) }.testTag("today-practice"),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(scenario, 36.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("和 ${scenario.partner} 聊聊这条新闻", style = Type.subheadline.semibold, color = colors.ink)
                    Text(scenario.title, style = Type.caption, color = colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Icon(AppIcons.ArrowForward, null, Modifier.size(20.dp), tint = colors.ink)
            }
        }
    }
}

/** The episode's eight terms, each one tap away from 词库. */
@Composable
fun TodayVocabularyScreen(screen: Screen.TodayVocabulary) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val store = app.store
    val speech = app.speech
    val episode = app.today.episode
    DisposableEffect(Unit) {
        speech.reset()
        onDispose { speech.stopAll() }
    }
    val unsaved = episode?.vocabulary.orEmpty().filter { !store.isSaved(it.term) }
    ScreenScaffold(
        title = "今日生词", onBack = { navigator.close(screen) },
        bottomBar = {
            SolidButton(if (unsaved.isEmpty()) "都在词库里了" else "全部加入词库", enabled = unsaved.isNotEmpty(),
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp).testTag("today-save-all"),
                onClick = { episode?.let { store.collect(unsaved.map { term -> AILearningItem(term.term, term.kind, term.meaning) }, it.source) } })
        },
    ) {
        if (episode == null) return@ScreenScaffold
        ReadableColumn(Modifier.verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(episode.title, style = Type.subheadline, color = Brand.colors.secondary)
                speech.errorMessage?.let { Text(it, style = Type.caption, color = Brand.colors.secondary) }
                for (term in episode.vocabulary) {
                    val saved = store.isSaved(term.term)
                    SurfaceCard(padding = 16.dp, spacing = 8.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(term.term, style = Type.english(Type.title3), color = Brand.colors.ink, modifier = Modifier.weight(1f))
                            IconAction(AppIcons.VolumeUp, "朗读", height = 36.dp) { speech.speak(term.term) }
                            IconAction(if (saved) AppIcons.Bookmark else AppIcons.BookmarkBorder, if (saved) "移出词库" else "加入词库",
                                tint = if (saved) Brand.colors.accent else Brand.colors.secondary, height = 36.dp) {
                                if (saved) store.removeExpression(SavedExpression.key(term.term))
                                else store.collect(listOf(AILearningItem(term.term, term.kind, term.meaning)), episode.source)
                            }
                        }
                        Text(term.meaning, style = Type.subheadline, color = Brand.colors.ink)
                        if (term.example.isNotEmpty()) {
                            SelectionContainer { Text(term.example, style = Type.english(Type.callout), color = Brand.colors.secondary) }
                        }
                    }
                }
            }
        }
    }
}
