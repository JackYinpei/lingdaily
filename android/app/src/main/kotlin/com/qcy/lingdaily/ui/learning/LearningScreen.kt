package com.qcy.lingdaily.ui.learning

import android.content.Intent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextAlign
import com.qcy.lingdaily.core.model.PracticeStats
import com.qcy.lingdaily.ui.semibold
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.SavedExpression
import com.qcy.lingdaily.core.model.session
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.AppTextField
import com.qcy.lingdaily.ui.Avatar
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.Chip
import com.qcy.lingdaily.ui.EmptyState
import com.qcy.lingdaily.ui.Hairline
import com.qcy.lingdaily.ui.IconAction
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.PageTitle
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.ReviewCard
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.Segmented
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.SurfaceCard
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.bold
import com.qcy.lingdaily.ui.medium
import com.qcy.lingdaily.ui.practice.BubbleTranslations
import com.qcy.lingdaily.ui.practice.FeedbackMeanings
import com.qcy.lingdaily.ui.practice.FeedbackNote
import com.qcy.lingdaily.ui.practice.MessageBubble

fun kindLabel(kind: String?): String = when (kind) {
    "word" -> "单词"
    "phrase" -> "短语"
    "grammar" -> "语法"
    "other" -> "其他"
    else -> "句子"
}

fun shortDate(millis: Long): String {
    val date = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalDate()
    return if (date.year == LocalDate.now().year) "${date.monthValue}月${date.dayOfMonth}日" else "${date.year}年${date.monthValue}月${date.dayOfMonth}日"
}

/** 学习: past rehearsals and the learner's 词库. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LearningScreen() {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val store = app.store
    val speech = app.speech
    val colors = Brand.colors
    val context = LocalContext.current
    val archive = store.archive
    var section by rememberSaveable { mutableIntStateOf(0) }
    var query by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<PracticeSession?>(null) }

    DisposableEffect(Unit) {
        speech.reset()
        onDispose { speech.stopAll() }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) { speech.stopAll() }

    // Kinds present in 词库, in a fixed order; sentences saved by hand have no kind.
    val kinds = remember(archive.expressions) {
        val present = archive.expressions.map { it.kind ?: "sentence" }.toSet()
        listOf("word", "phrase", "grammar", "other", "sentence").filter { it in present }
    }
    val filtered = remember(archive.expressions, query, kind) {
        val needle = query.trim().lowercase()
        archive.expressions.filter { item ->
            (kind == null || (item.kind ?: "sentence") == kind)
                && (needle.isEmpty() || item.text.lowercase().contains(needle) || item.meaning.lowercase().contains(needle))
        }
    }

    fun startReview() {
        speech.stopAll()
        val deck = app.settings.reviewLog.deck(filtered)
        navigator.push(Screen.Review("复习", deck.map { ReviewCard(it.id, it.text, it.meaning, "${kindLabel(it.kind)} · ${it.source}") }, recordsResults = true))
    }

    ReadableColumn(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 24.dp)) {
            item(key = "header") {
                Column(Modifier.padding(bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    PageTitle("学习", "练习 ${archive.sessions.size} 次 · 词库 ${archive.expressions.size} 条")
                    if (archive.sessions.isNotEmpty()) ProgressCard(archive.sessions)
                    Segmented(listOf(0 to "练习记录", 1 to "词库"), section, Modifier.testTag("learning-sections")) {
                        section = it
                        speech.stopAll()
                    }
                }
            }
            if (section == 0) {
                if (archive.sessions.isEmpty()) item(key = "empty") { EmptyState("还没有练习记录") }
                itemsIndexed(archive.sessions, key = { _, session -> session.id }) { index, session ->
                    var menu by remember { mutableStateOf(false) }
                    Box {
                        Column(Modifier.combinedClickable(role = Role.Button, onLongClickLabel = "更多操作", onLongClick = { menu = true }) {
                            navigator.push(Screen.SessionDetail(session.id, session))
                        }) {
                            Row(Modifier.padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                Avatar(session.scenario, 40.dp)
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(session.title, style = Type.headline, color = colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text("${session.scenario.partner} · ${shortDate(session.updatedAt)} · 开口 ${session.userTurns} 次", style = Type.caption, color = colors.secondary)
                                }
                                val done = session.phase == PracticeSession.Phase.COMPLETED
                                Text(if (done) "已完成" else "未完成", style = Type.caption.medium, color = if (done) colors.secondary else colors.accent)
                            }
                            if (index != archive.sessions.lastIndex) Hairline(Modifier.padding(start = 54.dp))
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("删除", color = colors.accent) }, leadingIcon = { Icon(AppIcons.Delete, null, tint = colors.accent) },
                                onClick = {
                                    menu = false
                                    deleting = session
                                })
                        }
                    }
                }
            } else if (archive.expressions.isEmpty()) {
                item(key = "empty") { EmptyState("词库还是空的") }
            } else {
                item(key = "tools") {
                    Column(Modifier.padding(top = 4.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (filtered.any { it.meaning.isNotEmpty() }) {
                            // Spaced review: what is due today first, then what has never been reviewed.
                            val due = app.settings.reviewLog.due(filtered).size
                            SolidButton(if (due > 0) "开始复习 · $due 个到期" else "开始复习", onClick = ::startReview, modifier = Modifier.testTag("start-review"))
                        }
                        AppTextField(query, { query = it }, "搜索词库", minHeight = 44.dp, textStyle = Type.subheadline,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                            modifier = Modifier.testTag("search-vocabulary"),
                            trailing = { if (query.isNotEmpty()) IconAction(AppIcons.Close, "清除搜索", iconSize = 16.dp) { query = "" } })
                        if (kinds.size > 1) {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Chip("全部", selected = kind == null) { kind = null }
                                for (value in kinds) Chip(kindLabel(value.takeIf { it != "sentence" }), selected = kind == value) { kind = if (kind == value) null else value }
                            }
                        }
                        speech.errorMessage?.let { Text(it, style = Type.caption, color = colors.secondary) }
                        if (filtered.isNotEmpty()) {
                            TextAction("导出这 ${filtered.size} 条", style = Type.caption, minHeight = 36.dp, modifier = Modifier.testTag("export-vocabulary")) {
                                // Plain text, one item per line, tab-separated: pastes into notes, sheets and flashcard apps.
                                val text = filtered.joinToString("\n") { listOf(it.text, it.meaning, kindLabel(it.kind), it.source).joinToString("\t") }
                                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain")
                                    .putExtra(Intent.EXTRA_SUBJECT, "LingDaily 词库").putExtra(Intent.EXTRA_TEXT, text), "导出词库"))
                            }
                        }
                    }
                }
                if (filtered.isEmpty()) item(key = "none") { EmptyState("没有找到") }
                items(filtered, key = { "expression-${it.id}" }) { expression ->
                    ExpressionCard(expression, source = archive.session(expression))
                }
            }
        }
    }

    deleting?.let { session ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除这次练习？") },
            text = { Text("删除后不能恢复。收藏的句子会保留。") },
            confirmButton = {
                TextButton(onClick = {
                    store.removeSession(session.id)
                    deleting = null
                }) { Text("删除", color = colors.accent) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消", color = colors.ink) } },
        )
    }
}

/**
 * Facts about the last week: days in a row with practice, and how many times the learner
 * spoke each day. No scores or levels.
 */
@Composable
private fun ProgressCard(sessions: List<PracticeSession>) {
    val colors = Brand.colors
    val days = remember(sessions) { PracticeStats.daily(sessions) }
    val streak = remember(sessions) { PracticeStats.streak(sessions) }
    val total = days.sumOf { it.turns }
    val peak = maxOf(1, days.maxOf { it.turns })
    SurfaceCard(Modifier.testTag("progress-card"), padding = 16.dp, spacing = 14.dp) {
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(if (streak > 0) "连续练习 $streak 天" else "今天还没开口", style = Type.headline, color = colors.ink)
                Text("近 7 天开口 $total 次", style = Type.caption, color = colors.secondary)
            }
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {
            contentDescription = days.joinToString("，") { "${it.date.monthValue}月${it.date.dayOfMonth}日 ${it.turns} 次" }
        }, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
            for ((index, day) in days.withIndex()) {
                val today = index == days.lastIndex
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.fillMaxWidth().height(48.dp), contentAlignment = Alignment.BottomCenter) {
                        // A day without practice keeps a hairline, so the week reads as seven days.
                        Box(Modifier.fillMaxWidth().height(if (day.turns == 0) 2.dp else (6 + 42 * day.turns / peak).dp)
                            .clip(RoundedCornerShape(4.dp)).background(if (day.turns == 0) colors.line else if (today) colors.accent else colors.ink.copy(alpha = 0.55f)))
                    }
                    Text(if (today) "今天" else "一二三四五六日"[day.date.dayOfWeek.value - 1].toString(), style = Type.caption2,
                        color = if (today) colors.accent else colors.secondary, textAlign = TextAlign.Center)
                }
            }
        }
    }
}

@Composable
private fun ExpressionCard(expression: SavedExpression, source: PracticeSession?) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val colors = Brand.colors
    SurfaceCard(Modifier.padding(vertical = 6.dp), padding = 16.dp, spacing = 8.dp) {
        SelectionContainer { Text(expression.text, style = Type.english(Type.title3), color = colors.ink) }
        if (expression.meaning.isNotEmpty()) Text(expression.meaning, style = Type.subheadline, color = colors.secondary)
        Row(verticalAlignment = Alignment.CenterVertically) {
            val origin = "${kindLabel(expression.kind)} · ${expression.source}"
            Box(Modifier.weight(1f)) {
                if (source != null) {
                    // Back to the conversation where this came up.
                    TextAction(origin, style = Type.caption, minHeight = 36.dp, trailingIcon = AppIcons.ChevronRight) {
                        app.speech.stopAll()
                        navigator.push(Screen.SessionDetail(source.id, source))
                    }
                } else {
                    Text(origin, style = Type.caption, color = colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            IconAction(AppIcons.VolumeUp, "朗读", height = 36.dp) { app.speech.speak(expression.text) }
            IconAction(AppIcons.Bookmark, "移出词库", tint = colors.accent, height = 36.dp) { app.store.removeExpression(expression.id) }
        }
    }
}

/** One past rehearsal: the whole conversation with its coaching notes, and a way back into it. */
@Composable
fun SessionDetailScreen(screen: Screen.SessionDetail) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val store = app.store
    val speech = app.speech
    val colors = Brand.colors
    val session = store.archive.sessions.firstOrNull { it.id == screen.sessionID } ?: screen.fallback
    val translations = remember { BubbleTranslations(app.api, app.scope) }
    val meanings = remember { FeedbackMeanings(app.api, app.scope) { app.settings.aiConsentGranted } }
    var showDelete by remember { mutableStateOf(false) }
    val startsNew = !session.isAI || session.phase == PracticeSession.Phase.COMPLETED

    DisposableEffect(Unit) {
        speech.reset()
        onDispose { speech.stopAll() }
    }

    ScreenScaffold(
        title = session.scenario.title, onBack = { navigator.close(screen) },
        actions = { IconAction(AppIcons.Delete, "删除这次练习") { showDelete = true } },
        bottomBar = {
            Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SolidButton(if (startsNew) "再练一次" else "继续这次对话", modifier = Modifier.weight(1f).testTag("resume-rehearsal"), onClick = {
                    speech.stopAll()
                    navigator.push(Screen.Conversation(
                        if (startsNew) PracticeSession.start(session.scenario, goal = session.personalGoal, context = session.context, useAI = true,
                            attitude = session.partnerAttitude, temperament = session.partnerTemperament)
                        else session))
                })
                if (session.phase == PracticeSession.Phase.COMPLETED) {
                    SolidButton("复盘", secondary = true, modifier = Modifier.weight(1f).testTag("review-rehearsal"), onClick = {
                        speech.stopAll()
                        navigator.push(Screen.Summary(session))
                    })
                }
            }
        },
    ) {
        ReadableColumn(Modifier.weight(1f)) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                item(key = "header") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Avatar(session.scenario, 48.dp)
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(session.title, style = Type.title3.bold, color = colors.ink)
                                Text("${session.scenario.partner} · ${shortDate(session.createdAt)} · 开口 ${session.userTurns} 次 · 重说 ${session.retryCount} 次",
                                    style = Type.caption, color = colors.secondary)
                            }
                        }
                        speech.errorMessage?.let { Text(it, style = Type.caption, color = colors.secondary) }
                    }
                }
                items(session.messages, key = { it.id }) { message ->
                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        MessageBubble(message, session.scenario,
                            showTranslation = message.id in translations.shown,
                            translationState = translations.state(message.id),
                            onTranslate = {
                                translations.toggle(message, session.scenario) { text ->
                                    val latest = store.archive.sessions.firstOrNull { it.id == session.id } ?: session
                                    latest.applyTranslation(text, message.id)?.let(store::save)
                                }
                            },
                            onListen = { speech.speak(it, session.scenario.partner) })
                        session.feedback(message.id)?.let { feedback ->
                            FeedbackNote(feedback, session.scenario.title, { speech.speak(it, session.scenario.partner) }, meaningLoading = message.id in meanings.loading) {
                                meanings.fill(message.id, feedback.revised) { meaning ->
                                    val latest = store.archive.sessions.firstOrNull { it.id == session.id } ?: session
                                    latest.applyFeedbackMeaning(meaning, message.id)?.let(store::save)
                                    store.fillMeaning(feedback.revised, meaning)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showDelete) {
        AlertDialog(
            onDismissRequest = { showDelete = false },
            title = { Text("删除这次练习？") },
            text = { Text("删除后不能恢复。收藏的句子会保留。") },
            confirmButton = {
                TextButton(onClick = {
                    showDelete = false
                    store.removeSession(session.id)
                    navigator.close(screen)
                }) { Text("删除", color = colors.accent) }
            },
            dismissButton = { TextButton(onClick = { showDelete = false }) { Text("取消", color = colors.ink) } },
        )
    }
}
