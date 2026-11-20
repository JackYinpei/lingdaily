package com.qcy.lingdaily.ui.learning

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.launch
import com.qcy.lingdaily.core.model.RecallMatcher
import com.qcy.lingdaily.core.model.prefix
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.AppTextField
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.IconAction
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.ReviewCard
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.StepProgress
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.medium
import com.qcy.lingdaily.ui.semibold

/**
 * Active recall without a model call: the learner sees the Chinese and says or types the
 * English. It reports what was heard and whether the expression was in it — never a
 * pronunciation score.
 */
@Composable
fun ReviewScreen(screen: Screen.Review) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val speech = app.speech
    val colors = Brand.colors
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    val cards = screen.cards
    var index by remember { mutableIntStateOf(0) }
    var answer by remember { mutableStateOf("") }
    var attempt by remember { mutableStateOf<String?>(null) }
    var revealed by remember { mutableStateOf(false) }
    var recalled by remember { mutableIntStateOf(0) }
    var dictating by remember { mutableStateOf(false) }
    val card = cards.getOrNull(index)

    DisposableEffect(Unit) {
        speech.reset()
        onDispose { speech.stopAll() }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) {
        dictating = false
        speech.stopAll()
    }
    LaunchedEffect(speech.transcript) {
        if (dictating && speech.transcript.isNotEmpty()) answer = speech.transcript.prefix(300)
    }

    fun reveal(heard: String?) {
        val current = card ?: return
        if (revealed) return
        dictating = false
        speech.stopAll()
        focus.clearFocus()
        attempt = heard
        val ok = heard != null && RecallMatcher.matches(current.text, heard)
        if (ok) recalled++
        // 词库 keeps a local log of how each item went; a quick run-through before a rehearsal does not.
        if (screen.recordsResults) app.settings.reviewLog = app.settings.reviewLog.record(current.id, ok)
        revealed = true
    }

    fun submit() {
        val text = answer.trim()
        if (text.isEmpty()) return
        if (!speech.isRecording) return reveal(text)
        scope.launch {
            val heard = speech.finishRecording()
            dictating = false
            reveal(if (heard.isEmpty()) text else heard.prefix(300))
        }
    }

    fun toggleDictation() {
        focus.clearFocus()
        if (speech.isRecording) {
            scope.launch {
                val text = speech.finishRecording()
                dictating = false
                if (text.isNotEmpty()) answer = text.prefix(300)
            }
        } else {
            answer = ""
            dictating = true
            scope.launch { if (dictating) speech.startRecording(300) }
        }
    }

    ScreenScaffold(
        title = screen.title, onBack = { navigator.close(screen) },
        bottomBar = {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    card == null -> SolidButton("完成", onClick = { navigator.close(screen) }, modifier = Modifier.testTag("review-done"))
                    revealed -> SolidButton(if (index + 1 == cards.size) "看看结果" else "下一个", modifier = Modifier.testTag("review-next"), onClick = {
                        speech.stopAll()
                        index++
                        answer = ""
                        attempt = null
                        revealed = false
                    })
                    else -> {
                        // Same pattern as the conversation composer: dictation, typing, send; or just look.
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val recording = speech.isRecording
                            val micEnabled = !speech.isRequestingPermission && !speech.isFinalizing
                            Box(
                                Modifier.size(44.dp).alpha(if (micEnabled) 1f else 0.4f).clip(CircleShape)
                                    .background(if (recording) colors.accent else colors.surface)
                                    .then(if (recording) Modifier else Modifier.border(1.dp, colors.line, CircleShape))
                                    .clickable(enabled = micEnabled, role = Role.Button, onClick = ::toggleDictation)
                                    .semantics { contentDescription = if (recording) "停止听写" else "开始英语听写" },
                                contentAlignment = Alignment.Center,
                            ) { Icon(if (recording) AppIcons.Stop else AppIcons.Mic, null, Modifier.size(22.dp), tint = if (recording) colors.onInk else colors.ink) }
                            AppTextField(answer, { answer = it }, "说出或写出英文…", limit = 300, minHeight = 44.dp,
                                modifier = Modifier.weight(1f).testTag("review-input"),
                                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = false, imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { submit() }),
                                trailing = {
                                    IconAction(AppIcons.ArrowUp, "对一下", tint = colors.ink, enabled = answer.isNotBlank(),
                                        modifier = Modifier.testTag("review-submit"), onClick = ::submit)
                                })
                        }
                        TextAction("想不起来，看答案", modifier = Modifier.fillMaxWidth().testTag("review-reveal")) { reveal(null) }
                    }
                }
            }
        },
    ) {
        ReadableColumn(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                if (card == null) {
                    Text("过完了", style = Type.title, color = colors.ink)
                    Text("说出来 $recalled / ${cards.size} 个", style = Type.subheadline, color = colors.secondary, modifier = Modifier.testTag("review-result"))
                    return@Column
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(card.label, style = Type.caption, color = colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text("${index + 1} / ${cards.size}", style = Type.caption, color = colors.secondary, modifier = Modifier.padding(start = 8.dp))
                }
                StepProgress(index, cards.size)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("用英语怎么说？", style = Type.subheadline, color = colors.secondary)
                    Text(card.meaning, style = Type.title2, color = colors.ink)
                }
                if (revealed) {
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(colors.surface)
                            .drawBehind { drawRect(colors.accent, size = Size(3.dp.toPx(), size.height)) }.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        attempt?.let { heard ->
                            val ok = RecallMatcher.matches(card.text, heard)
                            Column(Modifier.testTag("review-attempt"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(if (ok) "说出来了" else "和原句有点不同", style = Type.caption.semibold, color = if (ok) colors.accent else colors.secondary)
                                Text(heard, style = Type.english(), color = colors.ink)
                            }
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("原句", style = Type.caption.semibold, color = colors.accent)
                            SelectionContainer { Text(card.text, style = Type.english(Type.title3), color = colors.ink) }
                            TextAction("听", icon = AppIcons.VolumeUp, style = Type.caption.medium) { speech.speak(card.text) }
                        }
                    }
                }
                speech.errorMessage?.let { Text(it, style = Type.caption, color = colors.secondary) }
            }
        }
    }
}
