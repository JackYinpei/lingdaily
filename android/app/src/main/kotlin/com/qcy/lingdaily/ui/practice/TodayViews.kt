package com.qcy.lingdaily.ui.practice

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.qcy.lingdaily.core.model.AILearningItem
import com.qcy.lingdaily.core.model.SavedExpression
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.IconAction
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.SurfaceCard
import com.qcy.lingdaily.ui.Type

/** The episode's eight terms, each one tap away from 词库. */
@Composable
fun TodayVocabularyScreen(screen: Screen.TodayVocabulary) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val store = app.store
    val speech = app.speech
    val episode = screen.episode ?: app.podcasts.episodes.firstOrNull()
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
