package com.qcy.lingdaily.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.qcy.lingdaily.app.Settings
import com.qcy.lingdaily.core.model.LearnerInterest
import com.qcy.lingdaily.core.model.LearnerInterests
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.PageTitle
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.semibold

private const val GOALS_TITLE = "你练英语，主要为了什么？"
private const val FEARS_TITLE = "开口时，你最怕哪种场面？"

/**
 * First run: why the learner practises and which speaking moments they find hard, on two short
 * multi-choice pages over the whole app. Skipping keeps the catalog order. Same as the iOS app.
 */
@Composable
fun InterestsOnboarding(onDone: () -> Unit) {
    val settings = LocalApp.current.settings
    var picks by rememberSaveable { mutableStateOf(LearnerInterests.picks(settings.learnerInterests)) }
    var page by rememberSaveable { mutableIntStateOf(0) }
    BackHandler { if (page == 1) page = 0 }
    Column(
        Modifier.fillMaxSize().background(Brand.colors.page)
            // Taps beside the options must not reach the page underneath.
            .pointerInput(Unit) { detectTapGestures {} }
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.End) {
            TextAction("跳过", modifier = Modifier.testTag("skip-interests")) {
                finish(settings, LearnerInterests.picks(settings.learnerInterests))
                onDone()
            }
        }
        ReadableColumn(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                if (page == 0) {
                    PageTitle(GOALS_TITLE, "可以多选。我们先把这些场合的对话放在前面。")
                    InterestOptions(LearnerInterests.goals, picks) { picks = it }
                } else {
                    PageTitle(FEARS_TITLE, "可以多选。我们会多安排这样的人陪你练。")
                    InterestOptions(LearnerInterests.fears, picks) { picks = it }
                }
            }
        }
        ReadableColumn {
            SolidButton(if (page == 0) "下一步" else "开始练习",
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp).testTag("interests-next"), onClick = {
                    if (page == 0) page = 1 else {
                        finish(settings, picks)
                        onDone()
                    }
                })
        }
    }
}

/** 「我的 → 练习偏好」: both questions on one page. */
@Composable
fun InterestsScreen(@Suppress("UNUSED_PARAMETER") screen: Screen.Interests) {
    val settings = LocalApp.current.settings
    val navigator = LocalNavigator.current
    var picks by rememberSaveable { mutableStateOf(LearnerInterests.picks(settings.learnerInterests)) }
    ScreenScaffold(
        title = "练习偏好",
        onBack = { navigator.pop() },
        bottomBar = {
            SolidButton("保存", modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp).testTag("interests-save"), onClick = {
                finish(settings, picks)
                navigator.pop()
            })
        },
    ) {
        ReadableColumn(Modifier.verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                PageTitle("你想练什么", "首页会把适合你的场景排在前面，「换一批」也会按这里出题。")
                Section(GOALS_TITLE) { InterestOptions(LearnerInterests.goals, picks) { picks = it } }
                Section(FEARS_TITLE) { InterestOptions(LearnerInterests.fears, picks) { picks = it } }
            }
        }
    }
}

/** The picked labels for 我的, or what choosing does. */
fun interestSummary(raw: String): String {
    val picks = LearnerInterests.picks(raw).toSet()
    val labels = LearnerInterests.all.filter { it.id in picks }.map { it.label }
    return if (labels.isEmpty()) "选一选你想练的场合，首页按它排序" else labels.joinToString(" · ")
}

private fun finish(settings: Settings, picks: List<String>) {
    // Stored in the question order so the value only changes when the picks do.
    val ordered = LearnerInterests.all.map { it.id }.filter { it in picks }
    settings.learnerInterests = LearnerInterests.raw(ordered)
    settings.learnerInterestsAsked = true
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = Type.headline, color = Brand.colors.ink)
        content()
    }
}

@Composable
private fun InterestOptions(options: List<LearnerInterest>, picks: List<String>, onChange: (List<String>) -> Unit) {
    val colors = Brand.colors
    val shape = RoundedCornerShape(16.dp)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (option in options) {
            val selected = option.id in picks
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = 60.dp).clip(shape).background(colors.surface)
                    .border(if (selected) 1.5.dp else 1.dp, if (selected) colors.accent else colors.line, shape)
                    .clickable(role = Role.Checkbox) { onChange(if (selected) picks - option.id else picks + option.id) }
                    .semantics { this.selected = selected }
                    .testTag("interest-${option.id}")
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(option.label, style = if (selected) Type.body.semibold else Type.body, color = colors.ink)
                    if (option.detail.isNotEmpty()) Text(option.detail, style = Type.caption, color = colors.secondary)
                }
                Spacer(Modifier.size(8.dp))
                Box(
                    Modifier.size(24.dp).clip(CircleShape)
                        .background(if (selected) colors.accent else colors.page)
                        .border(1.5.dp, if (selected) colors.accent else colors.line, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    if (selected) Icon(AppIcons.Check, null, Modifier.size(16.dp), tint = colors.onInk)
                }
            }
        }
    }
}
