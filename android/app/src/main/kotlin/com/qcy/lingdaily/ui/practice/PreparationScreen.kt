package com.qcy.lingdaily.ui.practice

import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import com.qcy.lingdaily.core.model.PartnerCharacter
import com.qcy.lingdaily.core.model.PartnerTemperament
import com.qcy.lingdaily.core.model.playedBy
import com.qcy.lingdaily.core.model.PracticeLevel
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.ReviewPicker
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.AppTextField
import com.qcy.lingdaily.ui.Avatar
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.PreparationState
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.ReviewCard
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.Segmented
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.semibold
import com.qcy.lingdaily.ui.settings.SignInButton

private fun levelNote(level: PracticeLevel): String = when (level) {
    PracticeLevel.EASY -> "短句、常用词，对方更有耐心。"
    PracticeLevel.STANDARD -> "日常的语速和用词。"
    PracticeLevel.CHALLENGE -> "更地道，会追问，还可能出点小状况。"
}

@Composable
fun PreparationScreen(screen: Screen.Preparation) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val settings = app.settings
    val state = screen.state
    // The scenario as it will be played: the chosen person (「换个人」), before the learner's persona edit.
    val scenario = state.player?.let { screen.scenario.playedBy(it) } ?: screen.scenario
    val cast = app.catalog.cast(screen.scenario.id)
    val colors = Brand.colors
    val focus = LocalFocusManager.current
    val level = PracticeLevel.from(settings.practiceLevel) ?: PracticeLevel.STANDARD
    val temperament = PartnerTemperament.at(state.padX.toDouble(), state.padY.toDouble())
    val voiceMode = settings.preferVoicePractice

    LaunchedEffect(Unit) {
        if (state.reviewItems.isEmpty()) state.reviewItems = ReviewPicker.pick(app.store.archive, scenario)
    }

    ScreenScaffold(
        title = "准备对话", onBack = { navigator.close(screen) },
        bottomBar = {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (app.account.canPractice) {
                    Segmented(listOf(false to "文字", true to "语音通话"), voiceMode, Modifier.testTag("preparation-mode")) {
                        settings.preferVoicePractice = it
                    }
                    SolidButton(if (voiceMode) "进入语音通话" else "开始文字对话", modifier = Modifier.testTag("start-rehearsal"), onClick = {
                        focus.clearFocus()
                        val session = PracticeSession.start(scenario.withPersona(state.persona), goal = state.goal, context = state.context,
                            useAI = true, level = level, temperament = temperament,
                            reviewItems = if (settings.reviewWordsInPractice) state.reviewItems else emptyList())
                        // Leaving the conversation goes back to where this page was opened from.
                        navigator.replaceTop(Screen.Conversation(session, voiceMode = voiceMode, autoStartVoice = voiceMode))
                    })
                } else {
                    // Signing in here keeps the learner on this scenario instead of sending them to 我的.
                    SignInButton()
                }
            }
        },
    ) {
        ReadableColumn(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
                SceneHeader(scenario, state.persona)
                if (cast.size > 1) CastPicker(screen.scenario, cast, selected = scenario.partner) { person ->
                    state.player = person
                    state.persona = person.persona
                    state.editsPersona = false
                    state.padX = 0f
                    state.padY = 0f
                }
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("这次要说到", style = Type.headline, color = colors.ink)
                    scenario.steps.forEachIndexed { index, step ->
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("${index + 1}", style = Type.subheadline.semibold, color = colors.secondary, modifier = Modifier.width(18.dp))
                            Text(step.goal, style = Type.body, color = colors.ink)
                        }
                    }
                    TextAction("先过一遍三句话", icon = AppIcons.Check, modifier = Modifier.testTag("quick-review")) {
                        navigator.push(Screen.Review("快速过一遍", scenario.steps.map { ReviewCard(it.id, it.expression, it.meaning, it.goal) }, recordsResults = false))
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("难度", style = Type.headline, color = colors.ink)
                    Segmented(PracticeLevel.entries.map { it to it.label }, level, Modifier.testTag("practice-level")) { settings.practiceLevel = it.raw }
                    Text(levelNote(level), style = Type.caption, color = colors.secondary)
                }
                PartnerSection(scenario, state, temperament)
                if (settings.reviewWordsInPractice && state.reviewItems.isNotEmpty()) {
                    // "三个词回来找你": words from 词库 the partner will make room for.
                    Column(Modifier.testTag("review-words"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("试着用上", style = Type.headline, color = colors.ink)
                        for (item in state.reviewItems) WordLine(item.text, item.meaning)
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("你的目标", style = Type.headline, color = colors.ink)
                        Text("可选", style = Type.caption, color = colors.secondary)
                    }
                    AppTextField(state.goal, { state.goal = it }, "比如：${scenario.subtitle}", limit = 100, modifier = Modifier.testTag("personal-goal"))
                    if (state.addsContext) {
                        AppTextField(state.context, { state.context = it }, "比如：语气自然一点，不要太正式", limit = 500)
                    } else {
                        TextAction("补充一点背景", icon = AppIcons.Add) { state.addsContext = true }
                    }
                }
            }
        }
    }
}

@Composable
private fun SceneHeader(scenario: PracticeScenario, persona: String) {
    val colors = Brand.colors
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(colors.tone(scenario.id)).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Avatar(scenario, 56.dp)
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(scenario.partner, style = Type.title3.semibold, color = colors.ink)
                Text(scenario.partnerRole, style = Type.subheadline, color = colors.inkOnTone)
            }
        }
        Text(scenario.title, style = Type.title, color = colors.ink)
        Text(scenario.setting, style = Type.body.copy(lineHeight = Type.body.lineHeight * 1.1f), color = colors.inkOnTone)
        PracticeScenario.cleanPersona(persona)?.let {
            Text("${scenario.partner}：$it", style = Type.subheadline, color = colors.inkOnTone, modifier = Modifier.testTag("partner-persona-summary"))
        }
    }
}

/** 「换个人」: the same role played by someone with another temper and way of talking. */
@Composable
private fun CastPicker(scenario: PracticeScenario, cast: List<PartnerCharacter>, selected: String, onPick: (PartnerCharacter) -> Unit) {
    val colors = Brand.colors
    val haptics = LocalHapticFeedback.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("和谁练", style = Type.headline, color = colors.ink)
            Text("同一个场景，换个人说话就不一样", style = Type.caption, color = colors.secondary)
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for (person in cast) {
                val isSelected = person.partner == selected
                Row(
                    Modifier.heightIn(min = 52.dp).clip(CircleShape).background(colors.surface)
                        .border(if (isSelected) 1.5.dp else 1.dp, if (isSelected) colors.accent else colors.line, CircleShape)
                        .clickable(role = Role.RadioButton) {
                            if (!isSelected) {
                                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                onPick(person)
                            }
                        }
                        .semantics(mergeDescendants = true) { this.selected = isSelected }
                        .testTag("cast-${person.partner}")
                        .padding(start = 8.dp, end = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Avatar(scenario.playedBy(person), 36.dp)
                    Column {
                        Text(person.partner, style = Type.subheadline.semibold, color = colors.ink)
                        Text(person.label, style = Type.caption, color = colors.secondary, maxLines = 1)
                    }
                }
            }
        }
    }
}

/** 对方的脾气: drag the partner around a two-axis pad, then optionally rewrite who they are. */
@Composable
private fun PartnerSection(scenario: PracticeScenario, state: PreparationState, temperament: PartnerTemperament) {
    val colors = Brand.colors
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("对方的脾气", style = Type.headline, color = colors.ink)
        TemperamentPad(scenario, state)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(temperament.label?.let { "${scenario.partner}：$it" } ?: "按场景设定。拖动头像，让对方更好商量或更难缠、更冷静或更激动。",
                style = Type.caption, color = colors.secondary, modifier = Modifier.weight(1f).clearAndSetSemantics {})
            if (!temperament.isScenario) {
                TextAction("回到场景设定", style = Type.caption, modifier = Modifier.testTag("reset-temperament")) {
                    scope.launch { glideToCentre(state) }
                }
            }
        }
        if (state.editsPersona) {
            AppTextField(state.persona, { state.persona = it }, "比如：觉得自己没错，嘴硬又不耐烦", limit = PracticeScenario.PERSONA_LIMIT,
                modifier = Modifier.testTag("partner-persona"))
        } else {
            TextAction(if (state.persona.isEmpty()) "描述一下对方的性格" else "改一改对方的性格", icon = AppIcons.Edit,
                modifier = Modifier.testTag("edit-persona")) { state.editsPersona = true }
        }
    }
}

private suspend fun glideToCentre(state: PreparationState) {
    val startX = state.padX
    val startY = state.padY
    Animatable(1f).animateTo(0f) {
        state.padX = startX * value
        state.padY = startY * value
    }
}

/**
 * A two-axis pad for how the partner behaves: 好商量 ↔ 不让步 across, 冷静 ↔ 情绪外放 up.
 * The knob is the partner's own avatar. Dragging is continuous; each axis has five levels and
 * entering a new one ticks, so the learner feels the steps the model can actually play.
 */
@Composable
private fun TemperamentPad(scenario: PracticeScenario, state: PreparationState) {
    val colors = Brand.colors
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val knob = 40.dp
    val inset = with(density) { (knob / 2 + 8.dp).toPx() }
    val temperament = PartnerTemperament.at(state.padX.toDouble(), state.padY.toDouble())

    fun step(pushback: Int = 0, emotion: Int = 0): Boolean {
        val next = temperament.moved(pushback, emotion)
        state.padX = next.x.toFloat()
        state.padY = next.y.toFloat()
        return true
    }

    fun moveTo(position: Offset, size: IntSize) {
        val before = PartnerTemperament.at(state.padX.toDouble(), state.padY.toDouble())
        val spanX = max(size.width - inset * 2, 1f)
        val spanY = max(size.height - inset * 2, 1f)
        state.padX = ((position.x - inset) / spanX * 2 - 1).coerceIn(-1f, 1f)
        state.padY = (1 - (position.y - inset) / spanY * 2).coerceIn(-1f, 1f)
        if (PartnerTemperament.at(state.padX.toDouble(), state.padY.toDouble()) != before) {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        }
    }

    val shape = RoundedCornerShape(20.dp)
    Box(
        Modifier.fillMaxWidth().height(176.dp).clip(shape).background(colors.surface).border(1.dp, colors.line, shape)
            .drawBehind {
                val line = colors.line
                drawLine(line, Offset(size.width / 2, 30.dp.toPx()), Offset(size.width / 2, size.height - 30.dp.toPx()), 1.dp.toPx())
                drawLine(line, Offset(16.dp.toPx(), size.height / 2), Offset(size.width - 16.dp.toPx(), size.height / 2), 1.dp.toPx())
            }
            // Consumes the drag itself, so a drag that starts on the pad moves the partner instead of scrolling the page.
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    down.consume()
                    moveTo(down.position, size)
                    drag(down.id) { change ->
                        change.consume()
                        moveTo(change.position, size)
                    }
                    // The centre is a single setting, so it snaps there.
                    if (PartnerTemperament.at(state.padX.toDouble(), state.padY.toDouble()).isScenario) scope.launch { glideToCentre(state) }
                }
            }
            .clearAndSetSemantics {
                contentDescription = "对方的脾气"
                stateDescription = temperament.label ?: "按场景设定"
                customActions = listOf(
                    CustomAccessibilityAction("更好商量") { step(pushback = -1) },
                    CustomAccessibilityAction("更不让步") { step(pushback = 1) },
                    CustomAccessibilityAction("更冷静") { step(emotion = -1) },
                    CustomAccessibilityAction("更情绪外放") { step(emotion = 1) },
                )
            }
            .testTag("partner-temperament"),
    ) {
        // Under the knob, so the partner is never hidden by a label.
        val label = Type.caption2
        Text("情绪外放", style = label, color = colors.secondary, modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp))
        Text("冷静", style = label, color = colors.secondary, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp))
        Text("好商量", style = label, color = colors.secondary, modifier = Modifier.align(Alignment.CenterStart).padding(start = 14.dp).offset(y = (-12).dp))
        Text("不让步", style = label, color = colors.secondary, modifier = Modifier.align(Alignment.CenterEnd).padding(end = 14.dp).offset(y = (-12).dp))
        Box(Modifier.fillMaxSize()) {
            Avatar(scenario, knob, Modifier.then(KnobPosition(state.padX, state.padY, inset)).border(1.5.dp, colors.ink, CircleShape))
        }
    }
}

/** Places the knob so that (-1, -1) and (1, 1) keep it fully inside the pad. */
private data class KnobPosition(val x: Float, val y: Float, val inset: Float) : androidx.compose.ui.layout.LayoutModifier {
    override fun androidx.compose.ui.layout.MeasureScope.measure(
        measurable: androidx.compose.ui.layout.Measurable, constraints: androidx.compose.ui.unit.Constraints,
    ): androidx.compose.ui.layout.MeasureResult {
        val placeable = measurable.measure(constraints.copy(minWidth = 0, minHeight = 0))
        return layout(constraints.maxWidth, constraints.maxHeight) {
            val spanX = max(constraints.maxWidth - inset * 2, 1f)
            val spanY = max(constraints.maxHeight - inset * 2, 1f)
            placeable.place(
                (inset + (x + 1) / 2 * spanX - placeable.width / 2f).roundToInt(),
                (inset + (1 - y) / 2 * spanY - placeable.height / 2f).roundToInt(),
            )
        }
    }
}

/** An English expression with its Chinese meaning beside it. */
@Composable
fun WordLine(text: String, meaning: String, style: androidx.compose.ui.text.TextStyle = Type.body) {
    val colors = Brand.colors
    Text(androidx.compose.ui.text.buildAnnotatedString {
        pushStyle(Type.english(style).toSpanStyle().copy(color = colors.ink))
        append(text)
        pop()
        pushStyle(Type.footnote.toSpanStyle().copy(color = colors.secondary))
        append("  $meaning")
        pop()
    }, style = style)
}
