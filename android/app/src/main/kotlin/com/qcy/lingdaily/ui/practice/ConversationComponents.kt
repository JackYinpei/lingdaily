package com.qcy.lingdaily.ui.practice

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import com.qcy.lingdaily.core.model.AIFeedback
import com.qcy.lingdaily.core.model.PracticeMessage
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.network.PracticeServing
import com.qcy.lingdaily.core.realtime.LiveSuggestion
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.Avatar
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.IconAction
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.medium
import com.qcy.lingdaily.ui.semibold

enum class TranslationState { IDLE, LOADING, FAILED }

/** The Chinese gloss of a partner line: stored with the message, or the scripted one of an opening prompt. */
fun translationOf(message: PracticeMessage, scenario: PracticeScenario): String? = message.translation
    ?: if (message.kind == PracticeMessage.Kind.PROMPT) scenario.steps.getOrNull(message.stepIndex)?.translation else null

/**
 * Which partner lines show their Chinese gloss. Lines without one (Live transcripts)
 * are translated once on first tap and saved with the message.
 */
class BubbleTranslations(private val api: PracticeServing, private val scope: CoroutineScope) {
    var shown by mutableStateOf(emptySet<UUID>())
        private set
    private var loading by mutableStateOf(emptySet<UUID>())
    private var failed by mutableStateOf(emptySet<UUID>())

    fun state(id: UUID): TranslationState = when (id) {
        in loading -> TranslationState.LOADING
        in failed -> TranslationState.FAILED
        else -> TranslationState.IDLE
    }

    fun toggle(message: PracticeMessage, scenario: PracticeScenario, save: (String) -> Unit) {
        val id = message.id
        if (id in shown) {
            shown = shown - id
            return
        }
        if (translationOf(message, scenario) != null) {
            shown = shown + id
            return
        }
        if (id in loading) return
        loading = loading + id
        failed = failed - id
        scope.launch {
            try {
                save(api.translate(message.text))
                shown = shown + id
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                failed = failed + id
            } finally {
                loading = loading - id
            }
        }
    }
}

/**
 * Chinese for Live notes, translated once per note and saved with it. Never asks for AI
 * consent from a history page: without consent the note simply stays English-only.
 */
class FeedbackMeanings(private val api: PracticeServing, private val scope: CoroutineScope, private val consent: () -> Boolean) {
    var loading by mutableStateOf(emptySet<UUID>())
        private set
    private val attempted = mutableSetOf<UUID>()

    fun fill(id: UUID, revised: String, save: (String) -> Unit) {
        if (!consent() || !attempted.add(id)) return
        loading = loading + id
        scope.launch {
            try {
                save(api.translate(revised))
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
            } finally {
                loading = loading - id
            }
        }
    }
}

@Composable
fun MessageBubble(
    message: PracticeMessage,
    scenario: PracticeScenario,
    showTranslation: Boolean = false,
    translationState: TranslationState = TranslationState.IDLE,
    onTranslate: (() -> Unit)? = null,
    onListen: ((String) -> Unit)? = null,
) {
    val colors = Brand.colors
    val shape = RoundedCornerShape(20.dp)
    if (message.role == PracticeMessage.Role.USER) {
        Column(Modifier.fillMaxWidth().padding(start = 48.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (message.kind == PracticeMessage.Kind.RETRY) Text("再说一次", style = Type.caption2, color = colors.secondary)
            SelectionContainer {
                Text(message.text, style = Type.english(), color = colors.onInk,
                    modifier = Modifier.clip(shape).background(colors.ink).padding(horizontal = 16.dp, vertical = 11.dp))
            }
        }
        return
    }
    val translation = translationOf(message, scenario)
    Row(Modifier.fillMaxWidth().padding(end = 32.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Avatar(scenario, 28.dp)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Column(Modifier.clip(shape).background(colors.surface).padding(horizontal = 16.dp, vertical = 11.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SelectionContainer { Text(message.text, style = Type.english(), color = colors.ink) }
                if (showTranslation && translation != null) Text(translation, style = Type.subheadline, color = colors.secondary)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (onListen != null) IconAction(AppIcons.VolumeUp, "朗读", width = 40.dp, height = 32.dp, iconSize = 16.dp) { onListen(message.text) }
                if (onTranslate != null) {
                    val label = when (translationState) {
                        TranslationState.LOADING -> "翻译中…"
                        TranslationState.FAILED -> "翻译失败，重试"
                        TranslationState.IDLE -> if (showTranslation) "隐藏中文" else "中文"
                    }
                    TextAction(label, style = Type.caption, minHeight = 32.dp, enabled = translationState != TranslationState.LOADING,
                        modifier = Modifier.padding(horizontal = 4.dp), onClick = onTranslate)
                }
            }
        }
    }
}

/** Coaching sits directly under the sentence it is about, like a margin note. */
@Composable
fun FeedbackNote(
    feedback: AIFeedback,
    source: String,
    onListen: ((String) -> Unit)? = null,
    meaningLoading: Boolean = false,
    /** Live notes arrive without Chinese; asked for once when the note appears. */
    onNeedsMeaning: (() -> Unit)? = null,
) {
    val colors = Brand.colors
    val store = LocalApp.current.store
    val saved = store.isSaved(feedback.revised)
    LaunchedEffect(feedback.revised, feedback.meaning.isEmpty()) {
        if (feedback.meaning.isEmpty()) onNeedsMeaning?.invoke()
    }
    Column(
        Modifier.padding(start = 36.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(colors.surface)
            .drawBehind { drawRect(colors.accent, size = Size(3.dp.toPx(), size.height)) }.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(feedback.note, style = Type.subheadline, color = colors.ink)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("更自然的说法", style = Type.caption.semibold, color = colors.accent)
            SelectionContainer { Text(feedback.revised, style = Type.english(Type.title3), color = colors.ink) }
            if (feedback.meaning.isNotEmpty()) Text(feedback.meaning, style = Type.subheadline, color = colors.secondary)
            else if (meaningLoading) Text("正在翻译…", style = Type.caption, color = colors.secondary)
        }
        val items = feedback.items.orEmpty()
        if (items.isNotEmpty()) {
            Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("已加入词库", style = Type.caption.semibold, color = colors.accent)
                for (item in items) WordLine(item.text, item.meaning, Type.callout)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (onListen != null) {
                TextAction("听", icon = AppIcons.VolumeUp, style = Type.caption.medium, minHeight = 36.dp) { onListen(feedback.revised) }
                Spacer(Modifier.width(16.dp))
            }
            TextAction(if (saved) "已收藏" else "收藏", icon = if (saved) AppIcons.Bookmark else AppIcons.BookmarkBorder,
                color = if (saved) colors.accent else colors.secondary, style = Type.caption.medium, minHeight = 36.dp,
                modifier = Modifier.testTag("save-expression")) {
                store.toggleExpression(feedback.revised, feedback.meaning, source)
            }
        }
    }
}

/** The partner is writing. Three dots that pulse in turn; still when the system has animations turned off. */
@Composable
fun TypingDots() {
    val transition = rememberInfiniteTransition(label = "typing")
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        repeat(3) { index ->
            val alpha by transition.animateFloat(0.3f, 1f, infiniteRepeatable(tween(600), RepeatMode.Reverse, StartOffset(index * 200)), label = "dot")
            Box(Modifier.size(7.dp).alpha(alpha).clip(CircleShape).background(Brand.colors.secondary))
        }
    }
}

/**
 * Help when the learner is stuck in a call: the idea in Chinese first, the
 * English model answer only on request, so the learner still forms the sentence.
 */
@Composable
fun LiveSuggestionCard(suggestion: LiveSuggestion, partner: String, onDismiss: () -> Unit) {
    val colors = Brand.colors
    var showsReply by rememberSaveable(suggestion) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(colors.surface).padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("可以这样回应 $partner", style = Type.caption.semibold, color = colors.accent, modifier = Modifier.weight(1f))
            IconAction(AppIcons.Close, "收起建议", width = 36.dp, height = 36.dp, iconSize = 16.dp, onClick = onDismiss)
        }
        Column(Modifier.padding(end = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(suggestion.hint, style = Type.subheadline, color = colors.ink)
            Text(suggestion.keywords, style = Type.caption, color = colors.secondary)
            if (showsReply) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SelectionContainer { Text(suggestion.reply, style = Type.english(), color = colors.ink) }
                    Text(suggestion.meaning, style = Type.caption, color = colors.secondary)
                }
            } else {
                TextAction("看参考说法", color = colors.ink, style = Type.caption.medium, minHeight = 32.dp,
                    modifier = Modifier.testTag("live-suggestion-reply")) { showsReply = true }
            }
        }
    }
}

/** `label` names the group for screen readers, e.g. "Alex 正在回复". */
@Composable
fun TypingBubble(scenario: PracticeScenario) {
    Row(Modifier.semantics(mergeDescendants = true) { contentDescription = "${scenario.partner} 正在回复" }.testTag("ai-request-state"),
        verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Avatar(scenario, 28.dp)
        Box(Modifier.clip(RoundedCornerShape(18.dp)).background(Brand.colors.surface).padding(horizontal = 16.dp, vertical = 14.dp)) { TypingDots() }
    }
}
