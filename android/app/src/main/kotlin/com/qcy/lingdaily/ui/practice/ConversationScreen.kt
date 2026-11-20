package com.qcy.lingdaily.ui.practice

import android.media.AudioManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlin.math.max
import kotlinx.coroutines.launch
import com.qcy.lingdaily.core.model.PracticeMessage
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.ReviewPicker
import com.qcy.lingdaily.core.model.prefix
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.Avatar
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.Chip
import com.qcy.lingdaily.ui.Hairline
import com.qcy.lingdaily.ui.IconAction
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.StepProgress
import com.qcy.lingdaily.ui.SurfaceCard
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.medium
import com.qcy.lingdaily.ui.semibold

/**
 * One rehearsal: typed turns with coaching after each answer, or a Live voice call with
 * subtitles. Both modes share the transcript and can be switched at any time.
 */
@Composable
fun ConversationScreen(screen: Screen.Conversation) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val settings = app.settings
    val store = app.store
    val speech = app.speech
    val colors = Brand.colors
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    // The archive's copy is newer when this page is rebuilt for a rehearsal already in progress.
    val initial = remember { store.archive.sessions.firstOrNull { it.id == screen.session.id } ?: screen.session }
    val model = remember { PracticeViewModel(initial, app.api, store, app.scope) }
    val live = remember { LivePracticeController(app) }
    val translations = remember { BubbleTranslations(app.api, app.scope) }
    val meanings = remember { FeedbackMeanings(app.api, app.scope) { settings.aiConsentGranted } }
    var voiceMode by remember { mutableStateOf(initial.isAI && (screen.voiceMode ?: settings.preferVoicePractice)) }
    var draft by remember { mutableStateOf(initial.draft.orEmpty()) }
    var dictationPrefix by remember { mutableStateOf("") }
    var dictationActive by remember { mutableStateOf(false) }
    var submittingDictation by remember { mutableStateOf(false) }
    var showsLeaveConfirmation by remember { mutableStateOf(false) }
    var hintLevel by remember { mutableIntStateOf(0) }
    var inputFocused by remember { mutableStateOf(false) }
    val inputFocus = remember { FocusRequester() }
    val exit = remember { object { var saved = false } }

    val session = model.session
    val inCall = live.state != LivePracticeController.State.DISCONNECTED
    val completed = session.phase == PracticeSession.Phase.COMPLETED
    val showsSummary = completed && !inCall
    val practiceStep = session.suggestedStep ?: session.step
    // Read aloud in the voice this partner has in a call.
    val onListen: ((String) -> Unit)? = if (voiceMode) null else ({ text -> speech.speak(text, session.scenario.partner) })

    fun saveAndStop() {
        if (exit.saved) return
        exit.saved = true
        live.stop()
        dictationActive = false
        speech.stopAll()
        model.pause()
        // Leaving by the back button, the back gesture or the system all keep the unsent draft.
        model.keepDraft(draft)
        if (model.session.userTurns > 0) {
            store.save(model.session)
            // A day with practice gets no "today" reminder.
            app.reminders.rescheduleDaily(app.practicedToday)
        }
    }

    fun leavePractice() {
        saveAndStop()
        navigator.close(screen)
    }

    fun requestClose() {
        if (inCall) showsLeaveConfirmation = true else leavePractice()
    }

    /** 再练一次 from the summary: same scenario, goal and level; this tap also starts the call. */
    fun restart() {
        speech.stopAll()
        draft = ""
        hintLevel = 0
        exit.saved = false
        model.restart(if (settings.reviewWordsInPractice) ReviewPicker.pick(store.archive, model.session.scenario) else emptyList())
        if (voiceMode) live.start(model) else model.requestPending()
    }

    fun setVoiceMode(enabled: Boolean) {
        if (enabled == voiceMode) return
        voiceMode = enabled
        dictationActive = false
        speech.stopAll()
        focus.clearFocus()
        settings.preferVoicePractice = enabled
        if (enabled) model.enterLive() else {
            live.stop()
            model.enterText()
        }
    }

    fun sendDraft() {
        dictationActive = false
        speech.stopAll()
        if (!model.send(draft)) return
        draft = ""
        hintLevel = 0
        focus.clearFocus()
    }

    fun submit() {
        if (speech.isRequestingPermission || speech.isFinalizing || submittingDictation) return
        if (!speech.isRecording) return sendDraft()
        submittingDictation = true
        val prefix = dictationPrefix
        scope.launch {
            val result = speech.finishRecording()
            submittingDictation = false
            if (!dictationActive || voiceMode) return@launch
            draft = (prefix + result).prefix(800)
            sendDraft()
        }
    }

    BackHandler { requestClose() }
    DisposableEffect(Unit) {
        speech.reset()
        exit.saved = false
        if (voiceMode) {
            model.enterLive()
            // The learner already chose 进入语音通话: the call starts without a second tap.
            if (screen.autoStartVoice) live.start(model)
        } else {
            model.requestPending()
        }
        onDispose { saveAndStop() }
    }
    // A voice call goes on behind another app (with its notification); everything else stops,
    // and so does a call that could not get its background permission.
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        dictationActive = false
        if (!live.continuesInBackground) live.stop()
        speech.stopAll()
        if (live.state == LivePracticeController.State.DISCONNECTED) model.pause()
        model.keepDraft(draft)
        store.save(model.session)
    }
    // Learners talk without touching the screen; auto-lock would end the call.
    val view = LocalView.current
    val activity = LocalActivity.current
    DisposableEffect(inCall) {
        view.keepScreenOn = inCall
        activity?.volumeControlStream = if (inCall) AudioManager.STREAM_VOICE_CALL else AudioManager.USE_DEFAULT_STREAM_TYPE
        onDispose {
            view.keepScreenOn = false
            activity?.volumeControlStream = AudioManager.USE_DEFAULT_STREAM_TYPE
        }
    }
    LaunchedEffect(speech.transcript) {
        val text = speech.transcript
        if (dictationActive && !voiceMode && text.isNotEmpty()) draft = (dictationPrefix + text).prefix(800)
    }
    // Text mode reads each new partner line aloud when the learner wants that.
    val messageCount = session.messages.size
    val spoken = remember { object { var count = messageCount } }
    LaunchedEffect(messageCount) {
        val isNew = messageCount > spoken.count
        spoken.count = messageCount
        val last = session.messages.lastOrNull()
        if (isNew && !voiceMode && settings.autoReadReplies && last?.role == PracticeMessage.Role.PARTNER
            && lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) speech.speak(last.text, session.scenario.partner)
    }

    ScreenScaffold(
        title = "",
        onBack = ::requestClose,
        titleContent = if (completed) null else ({
            Row(Modifier.semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Avatar(session.scenario, 28.dp)
                Column {
                    Text(session.scenario.partner, style = Type.subheadline.semibold, color = colors.ink, maxLines = 1)
                    Text(session.scenario.partnerRole, style = Type.caption2, color = colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }),
        actions = {
            if (!completed) {
                if (!voiceMode) {
                    val on = settings.autoReadReplies
                    IconAction(if (on) AppIcons.VolumeUp else AppIcons.VolumeOff, if (on) "关闭自动朗读" else "开启自动朗读", tint = colors.ink) {
                        settings.autoReadReplies = !on
                        if (on) speech.stopAll()
                    }
                }
                ModeSwitch(voiceMode, ::setVoiceMode)
            }
        },
        header = {
            if (!completed) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${session.stepIndex + 1}/${session.scenario.steps.size} · ${session.step.goal}", style = Type.caption.medium,
                        color = colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    StepProgress(session.stepIndex, session.scenario.steps.size, Modifier.width(96.dp))
                }
                Hairline()
            }
        },
        bottomBar = {
            when {
                showsSummary -> SummaryActions(onRestart = ::restart, onClose = ::leavePractice)
                voiceMode -> VoiceControls(session, live, speakerTipShown = settings.speakerTipShown,
                    onSpeakerTipSeen = { settings.speakerTipShown = true },
                    onConnect = {
                        dictationActive = false
                        speech.stopAll()
                        model.pause()
                        live.start(model)
                    })
                session.pendingAIRequest != null -> Unit
                session.phase == PracticeSession.Phase.REVIEW -> Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    speech.errorMessage?.let { Text(it, style = Type.caption, color = colors.secondary) }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SolidButton("再说一次", icon = AppIcons.Refresh, secondary = true, modifier = Modifier.weight(1f).testTag("retry-utterance"), onClick = {
                            speech.stopAll()
                            model.beginRetry()
                            hintLevel = 0
                            scope.launch { runCatching { inputFocus.requestFocus() } }
                        })
                        SolidButton(if (session.stepIndex + 1 == session.scenario.steps.size) "完成" else "下一步",
                            modifier = Modifier.weight(1f).testTag("next-mission"), onClick = {
                                speech.stopAll()
                                model.advance()
                                hintLevel = 0
                            })
                    }
                }
                else -> Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    speech.errorMessage?.let { Text(it, style = Type.caption, color = colors.secondary) }
                    if (session.phase == PracticeSession.Phase.RETRY) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("换个说法，再说一次", style = Type.subheadline.semibold, color = colors.ink, modifier = Modifier.weight(1f))
                            TextAction("算了", minHeight = 32.dp) {
                                speech.stopAll()
                                draft = ""
                                focus.clearFocus()
                                model.cancelRetry()
                            }
                        }
                    }
                    Hints(practiceStep.hint, practiceStep.keywords, practiceStep.expression, hintLevel) { hintLevel = it }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val recording = speech.isRecording
                        val micEnabled = !(speech.isRequestingPermission || speech.isFinalizing || submittingDictation || (!recording && draft.length >= 800))
                        Box(
                            Modifier.size(44.dp).alpha(if (micEnabled) 1f else 0.4f).clip(CircleShape)
                                .background(if (recording) colors.accent else colors.surface)
                                .then(if (recording) Modifier else Modifier.border(1.dp, colors.line, CircleShape))
                                .clickable(enabled = micEnabled, role = Role.Button) {
                                    focus.clearFocus()
                                    if (recording) scope.launch { speech.finishRecording() } else {
                                        dictationPrefix = if (draft.isEmpty()) "" else "$draft "
                                        dictationActive = true
                                        scope.launch {
                                            if (dictationActive && !voiceMode) speech.startRecording(max(1, 800 - dictationPrefix.length))
                                        }
                                    }
                                }
                                .semantics { contentDescription = if (recording) "停止听写" else "开始英语听写" },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(if (recording) AppIcons.Stop else AppIcons.Mic, null, Modifier.size(22.dp), tint = if (recording) colors.onInk else colors.ink)
                        }
                        val canSubmit = draft.isNotBlank() && !speech.isRequestingPermission && !speech.isFinalizing && !submittingDictation
                        AnswerField(
                            value = draft, onValueChange = { draft = it.prefix(800) },
                            placeholder = if (session.phase == PracticeSession.Phase.RETRY) "换一种说法…" else "用英语回答…",
                            enabled = !speech.isFinalizing && !submittingDictation, canSubmit = canSubmit, onSubmit = ::submit,
                            modifier = Modifier.weight(1f).focusRequester(inputFocus).onFocusChanged { inputFocused = it.isFocused },
                        )
                    }
                    if (speech.isRecording) {
                        Text("正在听写", style = Type.caption2, color = colors.accent, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                    } else if (speech.isFinalizing || submittingDictation) {
                        Text("正在整理最后一句…", style = Type.caption2, color = colors.secondary, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        },
    ) {
        if (showsSummary) {
            SummaryContent(session)
            return@ScreenScaffold
        }
        val listState = rememberLazyListState()
        val pending = !voiceMode && session.pendingAIRequest != null
        val anchor = 1 + session.messages.size + if (pending) 1 else 0
        // Stays on the newest line as it grows, when a hint opens and when the keyboard comes up.
        val lastText = if (voiceMode) session.messages.lastOrNull()?.text else null
        LaunchedEffect(anchor, lastText, session.phase, hintLevel, inputFocused, live.suggestion != null) {
            runCatching { listState.animateScrollToItem(anchor) }
        }
        ReadableColumn(Modifier.weight(1f)) {
            LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                item(key = "setting") {
                    Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 8.dp), horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val style = Type.footnote
                        Text(session.scenario.setting, style = style, color = colors.secondary, textAlign = TextAlign.Center)
                        if (session.personalGoal.isNotEmpty()) Text("你的目标：${session.personalGoal}", style = style, color = colors.secondary, textAlign = TextAlign.Center)
                        if (session.context.isNotEmpty()) Text("背景：${session.context}", style = style, color = colors.secondary, textAlign = TextAlign.Center)
                    }
                }
                items(session.messages, key = { it.id }) { message ->
                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        MessageBubble(message, session.scenario,
                            showTranslation = message.id in translations.shown,
                            translationState = translations.state(message.id),
                            onTranslate = { translations.toggle(message, session.scenario) { model.applyTranslation(it, message.id) } },
                            onListen = onListen)
                        session.feedback(message.id)?.let { feedback ->
                            FeedbackNote(feedback, session.scenario.title, onListen, meaningLoading = message.id in meanings.loading) {
                                meanings.fill(message.id, feedback.revised) { meaning ->
                                    model.applyFeedbackMeaning(meaning, message.id)
                                    store.fillMeaning(feedback.revised, meaning)
                                }
                            }
                        }
                    }
                }
                if (pending) item(key = "pending") {
                    if (model.isLoading) TypingBubble(session.scenario) else SurfaceCard(spacing = 12.dp) {
                        Text("没收到 ${session.scenario.partner} 的回复", style = Type.headline, color = colors.ink)
                        Text(model.errorMessage ?: "网络可能断开了，已发送的内容都还在。", style = Type.subheadline, color = colors.secondary)
                        SolidButton("再试一次", onClick = model::requestPending, modifier = Modifier.testTag("retry-ai-request"))
                    }
                }
                item(key = "latest") { Spacer(Modifier.height(1.dp)) }
            }
        }
    }

    if (showsLeaveConfirmation) {
        AlertDialog(
            onDismissRequest = { showsLeaveConfirmation = false },
            title = { Text("离开这次通话？") },
            confirmButton = {
                TextButton(onClick = {
                    showsLeaveConfirmation = false
                    leavePractice()
                }) { Text("结束并返回", color = colors.accent) }
            },
            dismissButton = { TextButton(onClick = { showsLeaveConfirmation = false }) { Text("继续练习", color = colors.ink) } },
        )
    }
}

/** Keyboard or phone: the two ways to hold the conversation. */
@Composable
private fun ModeSwitch(voiceMode: Boolean, onChange: (Boolean) -> Unit) {
    val colors = Brand.colors
    Row(Modifier.size(88.dp, 36.dp).clip(RoundedCornerShape(10.dp)).background(colors.line.copy(alpha = 0.7f)).padding(3.dp).testTag("conversation-mode")) {
        val option = @Composable { value: Boolean, icon: ImageVector, label: String ->
            Box(
                Modifier.weight(1f).fillMaxSize().clip(RoundedCornerShape(8.dp))
                    .background(if (voiceMode == value) colors.surface else Color.Transparent)
                    .clickable(role = Role.Tab) { onChange(value) }
                    .semantics {
                        contentDescription = label
                        selected = voiceMode == value
                    },
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, Modifier.size(18.dp), tint = colors.ink) }
        }
        option(false, AppIcons.Keyboard, "文字")
        option(true, AppIcons.Phone, "语音通话")
    }
}

/** Three explicit levels instead of a cycling button: meaning → keywords → a sample line. */
@Composable
private fun Hints(hint: String, keywords: String, expression: String, level: Int, onLevel: (Int) -> Unit) {
    val colors = Brand.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (level > 0) {
            SelectionContainer {
                Text(when (level) { 1 -> hint; 2 -> keywords; else -> expression },
                    style = if (level == 3) Type.english() else Type.subheadline, color = colors.ink,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(colors.surface).padding(12.dp))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("提示", style = Type.caption, color = colors.secondary)
            listOf("意思", "关键词", "参考说法").forEachIndexed { index, label ->
                val value = index + 1
                Chip(label, selected = level == value, minHeight = 30.dp,
                    modifier = Modifier.testTag(if (index == 0) "practice-hint" else "practice-hint-$value")) {
                    onLevel(if (level == value) 0 else value)
                }
            }
        }
    }
}

/** The answer box with its send button inside the same capsule. */
@Composable
private fun AnswerField(value: String, onValueChange: (String) -> Unit, placeholder: String, enabled: Boolean,
                        canSubmit: Boolean, onSubmit: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Brand.colors
    BasicTextField(
        value = value, onValueChange = onValueChange, enabled = enabled, maxLines = 4,
        textStyle = Type.body.copy(color = colors.ink), cursorBrush = SolidColor(colors.accent),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = false, imeAction = ImeAction.Send),
        keyboardActions = KeyboardActions(onSend = { onSubmit() }),
        modifier = modifier.testTag("practice-input"),
        decorationBox = { inner ->
            Row(Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(colors.surface).border(1.dp, colors.line, RoundedCornerShape(22.dp)),
                verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f).padding(start = 16.dp, top = 10.dp, bottom = 10.dp)) {
                    if (value.isEmpty()) Text(placeholder, style = Type.body, color = colors.secondary, maxLines = 1)
                    inner()
                }
                Box(
                    Modifier.size(44.dp).alpha(if (canSubmit) 1f else 0.25f).clip(CircleShape)
                        .clickable(enabled = canSubmit, role = Role.Button, onClick = onSubmit)
                        .semantics { contentDescription = "发送" }.testTag("send-answer"),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(Modifier.size(34.dp).clip(CircleShape).background(colors.ink), contentAlignment = Alignment.Center) {
                        Icon(AppIcons.ArrowUp, null, Modifier.size(18.dp), tint = colors.onInk)
                    }
                }
            }
        },
    )
}

@Composable
private fun VoiceControls(session: PracticeSession, live: LivePracticeController, speakerTipShown: Boolean,
                          onSpeakerTipSeen: () -> Unit, onConnect: () -> Unit) {
    val colors = Brand.colors
    val active = live.state == LivePracticeController.State.ACTIVE
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        live.suggestion?.let { LiveSuggestionCard(it, session.scenario.partner, live::dismissSuggestion) }
        if (active && live.usesSpeaker && !speakerTipShown) {
            // Without this the learner talks over the partner, hears no reaction and thinks the call is broken.
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(colors.surface).padding(start = 14.dp).testTag("speaker-tip"),
                verticalAlignment = Alignment.CenterVertically) {
                Text("外放时，想插话请先点「打断」；戴耳机可以直接说。", style = Type.caption, color = colors.ink, modifier = Modifier.weight(1f))
                IconAction(AppIcons.Close, "知道了", iconSize = 16.dp, onClick = onSpeakerTipSeen)
            }
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)) {
            if (live.status.isNotEmpty()) {
                Text(live.status, style = Type.caption.medium, color = colors.secondary, modifier = Modifier.testTag("live-status"))
            }
            if (active && live.playing) {
                // On the loudspeaker this is how to talk over the partner without echo.
                Box(
                    Modifier.heightIn(min = 44.dp).clip(CircleShape).border(1.5.dp, colors.ink, CircleShape)
                        .clickable(role = Role.Button) {
                            onSpeakerTipSeen()
                            live.interruptPartner()
                        }.padding(horizontal = 16.dp).testTag("live-interrupt"),
                    contentAlignment = Alignment.Center,
                ) { Text("打断", style = Type.subheadline.semibold, color = colors.ink) }
            } else if (active && live.suggestion == null) {
                TextAction(if (live.suggesting) "正在想…" else "卡住了？", color = colors.accent, style = Type.subheadline.medium,
                    enabled = !live.suggesting, modifier = Modifier.testTag("live-suggest")) { live.requestSuggestion() }
            }
        }
        (live.suggestionError ?: live.errorMessage)?.let {
            Text(it, style = Type.caption, color = colors.secondary, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (live.state == LivePracticeController.State.DISCONNECTED) {
                SolidButton(if (session.live?.model == null) "开始通话" else "重新连接", onClick = onConnect, modifier = Modifier.testTag("live-connect"))
            } else {
                SolidButton(if (live.muted) "取消静音" else "静音", icon = if (live.muted) AppIcons.MicOff else AppIcons.Mic, secondary = true,
                    enabled = active, onClick = live::toggleMute, modifier = Modifier.weight(1f).testTag("live-mute"))
                SolidButton("结束", onClick = { live.stop() }, modifier = Modifier.weight(1f).testTag("live-end"))
            }
        }
    }
}
