package com.qcy.lingdaily.ui.practice

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.SummaryLine
import com.qcy.lingdaily.core.model.learnerMessages
import com.qcy.lingdaily.core.model.nextSentenceReview
import com.qcy.lingdaily.core.model.summaryLines
import com.qcy.lingdaily.core.network.PracticeNetworkException
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.Avatar
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
import com.qcy.lingdaily.ui.medium

/** 复盘 of a past rehearsal, opened from its record. */
@Composable
fun SummaryScreen(screen: Screen.Summary) {
    val navigator = LocalNavigator.current
    ScreenScaffold(title = "练习复盘", onBack = { navigator.close(screen) },
        bottomBar = { SummaryActions(onRestart = null, onClose = { navigator.close(screen) }) }) {
        SummaryContent(screen.session)
    }
}

@Composable
fun SummaryActions(onRestart: (() -> Unit)?, onClose: () -> Unit) {
    Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (onRestart != null) {
            SolidButton("再练一次", onClick = onRestart, secondary = true, modifier = Modifier.weight(1f).testTag("restart-rehearsal"))
        }
        SolidButton("完成", onClick = onClose, modifier = Modifier.weight(1f).testTag("finish-rehearsal"))
    }
}

/**
 * What the learner takes away: facts about the rehearsal, every sentence they said with a
 * more natural version where there is one, and the words that went into 词库.
 */
@Composable
fun ColumnScope.SummaryContent(session: PracticeSession) {
    val app = LocalApp.current
    val store = app.store
    val account = app.account
    val colors = Brand.colors
    var reviewing by remember { mutableStateOf(false) }
    var reviewError by remember { mutableStateOf<String?>(null) }
    var reviewAttempt by remember { mutableIntStateOf(0) }
    // Review batches are saved into the archive as they arrive; read the newest copy from there.
    val reviewed = store.archive.sessions.firstOrNull { it.id == session.id } ?: session
    val newWords = session.collectedItems
    val reused = session.reusedReviewItems
    val lines = reviewed.summaryLines

    // Facts only: tasks, turns, retries and new words; zero counts are left out.
    val facts = buildList {
        add("${session.completedSteps} 个任务")
        add("开口 ${session.userTurns} 次")
        if (session.retryCount > 0) add("重说 ${session.retryCount} 次")
        if (newWords.isNotEmpty()) add("新词 ${newWords.size} 个")
    }.joinToString(" · ")

    val hasTextModel = app.aiSettings.settings.resolvedText != null

    LaunchedEffect(session.id, account.session?.userID, hasTextModel, reviewAttempt) {
        reviewing = false
        reviewError = null
        fun latest() = store.archive.sessions.firstOrNull { it.id == session.id }
        if (!hasTextModel || (latest() ?: session).nextSentenceReview == null) return@LaunchedEffect
        val owner = account.session?.userID
        reviewing = true
        try {
            while (true) {
                val request = (latest() ?: session).nextSentenceReview ?: break
                if (app.aiSettings.settings.resolvedText == null || account.session?.userID != owner) break
                val records = app.api.reviewSentences(request)
                if (account.session?.userID != owner) break
                val current = latest() ?: break
                store.save(current.applySentenceReviews(records) ?: throw PracticeNetworkException.invalidReply())
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (account.session?.userID == owner) reviewError = "表达建议暂时没有整理完，所有原话都已保留。${error.message.orEmpty()}"
        } finally {
            reviewing = false
        }
    }

    ReadableColumn(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState())) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(colors.tone(session.scenario.id)).padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Avatar(session.scenario, 56.dp)
                Text("和 ${session.scenario.partner} 的这场对话，\n你说完了。", style = Type.title, color = colors.ink)
                Text(facts, style = Type.subheadline, color = colors.inkOnTone)
            }
            if (reused.isNotEmpty()) {
                Column(Modifier.semantics(mergeDescendants = true) {}.testTag("summary-reused"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("这次你用上了", style = Type.headline, color = colors.ink)
                    for (item in reused) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(AppIcons.Check, null, Modifier.size(16.dp), tint = colors.accent)
                            WordLine(item.text, item.meaning)
                        }
                    }
                }
            }
            if (lines.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text("带走这几句", style = Type.headline, color = colors.ink)
                    Text("你说的全部 ${reviewed.learnerMessages.size} 句，按对话顺序保留。", style = Type.caption, color = colors.secondary)
                    if (reviewing) {
                        Row(Modifier.testTag("summary-review-loading"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CircularProgressIndicator(Modifier.size(16.dp), color = colors.secondary, strokeWidth = 2.dp)
                            Text("正在整理更自然的说法…", style = Type.caption, color = colors.secondary)
                        }
                    }
                    val error = reviewError
                    if (error != null) {
                        Text(error, style = Type.caption, color = colors.secondary)
                        SolidButton("重试表达建议", onClick = { reviewAttempt++ }, secondary = true, modifier = Modifier.testTag("retry-sentence-review"))
                    } else if (!hasTextModel && reviewed.nextSentenceReview != null) {
                        Text("在「接口设置」配置文字模型后，可为这些原话整理表达建议。", style = Type.caption, color = colors.secondary)
                    }
                    for (line in lines) Takeaway(line, session.scenario.title)
                }
            }
            if (newWords.isNotEmpty()) {
                Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("新进词库", style = Type.headline, color = colors.ink)
                    for (item in newWords) WordLine(item.text, item.meaning, Type.callout)
                }
            }
        }
    }
}

@Composable
private fun Takeaway(line: SummaryLine, source: String) {
    val colors = Brand.colors
    val store = LocalApp.current.store
    val saved = store.isSaved(line.text)
    SurfaceCard(Modifier.testTag("summary-line-${line.id}"), padding = 16.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("${line.goal} · 你说的", style = Type.caption, color = colors.secondary)
                SelectionContainer { Text(line.original, style = Type.english(Type.title3), color = colors.ink) }
                if (!line.isOwnWords) {
                    Text("更自然的说法", style = Type.caption.medium, color = colors.accent, modifier = Modifier.padding(top = 6.dp))
                    SelectionContainer { Text(line.text, style = Type.english(Type.title3), color = colors.ink) }
                }
                if (line.meaning.isNotEmpty()) Text(line.meaning, style = Type.subheadline, color = colors.secondary)
                if (line.note.isNotEmpty()) Text(line.note, style = Type.caption, color = colors.secondary)
            }
            IconAction(if (saved) AppIcons.Bookmark else AppIcons.BookmarkBorder,
                if (saved) "取消收藏" else if (line.isOwnWords) "收藏原句" else "收藏更自然的说法",
                tint = if (saved) colors.accent else colors.secondary) {
                store.toggleExpression(line.text, line.meaning, source)
            }
        }
    }
}
