package com.qcy.lingdaily.ui.practice

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import java.time.LocalTime
import com.qcy.lingdaily.core.model.LearnerInterests
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.Avatar
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.Chip
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.StepProgress
import com.qcy.lingdaily.ui.SurfaceCard
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.medium
import com.qcy.lingdaily.ui.semibold

private fun greeting(hour: Int = LocalTime.now().hour): String = when (hour) {
    in 5..10 -> "早上好"
    in 11..12 -> "中午好"
    in 13..17 -> "下午好"
    in 18..22 -> "晚上好"
    else -> "夜深了"
}

@Composable
fun PracticeHomeScreen() {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val archive = app.store.archive
    val aiSettings = app.aiSettings.settings
    val reminders = app.reminders
    val settings = app.settings
    // Built-in scenarios, the ones matching the learner's first-run picks first.
    val picks = LearnerInterests.picks(settings.learnerInterests)
    val catalog = remember(app.catalog.scenarios, app.catalog.extras, picks) {
        LearnerInterests.ranked(app.catalog.scenarios, app.catalog.extras, picks)
    }
    val today = LocalDate.now()
    val colors = Brand.colors

    // Own scenarios with a real conversation coming up come first, soonest first.
    val ownScenarios = remember(archive.scenarios, reminders.events, today) {
        archive.scenarios.withIndex().sortedWith(compareBy(
            { reminders.eventDay(it.value.id)?.takeIf { day -> !day.isBefore(today) } ?: LocalDate.MAX },
            { it.index },
        )).map { it.value }
    }
    // Latest unfinished rehearsal, unless a newer attempt at the same scenario was already completed.
    val unfinished = remember(archive.sessions) {
        archive.sessions.firstOrNull { session ->
            session.isAI && session.phase != PracticeSession.Phase.COMPLETED && archive.sessions.none {
                it.scenario.id == session.scenario.id && it.phase == PracticeSession.Phase.COMPLETED && it.updatedAt > session.updatedAt
            }
        }
    }
    // Scenarios with at least one completed rehearsal.
    val finished = remember(archive.sessions) {
        archive.sessions.filter { it.phase == PracticeSession.Phase.COMPLETED }.map { it.scenario.id }.toSet()
    }
    // The best few unfinished matches get a 「适合你」 mark.
    val recommended = remember(catalog, finished, picks) {
        LearnerInterests.recommended(catalog.filter { it.id !in finished }, app.catalog.extras, picks)
    }
    // Categories that have at least one scenario: everyday life and school first, work last.
    val categories = remember(ownScenarios, catalog) {
        val present = (ownScenarios + catalog).map { it.category }.toSet()
        val preferred = listOf("日常", "学习", "社交", "旅行", "职场")
        preferred.filter { it in present } + (present - preferred.toSet()).sorted()
    }
    // A category that no longer has scenarios falls back to showing everything.
    val activeCategory = settings.homeCategory.takeIf { it in categories }
    fun shows(scenario: PracticeScenario) = activeCategory == null || scenario.category == activeCategory

    LaunchedEffect(Unit) {
        app.catalog.refresh()
    }
    LaunchedEffect(reminders.pendingScenarioID) {
        val id = reminders.pendingScenarioID ?: return@LaunchedEffect
        reminders.pendingScenarioID = null
        if (!navigator.isAtRoot) return@LaunchedEffect
        (archive.scenarios.firstOrNull { it.id == id } ?: app.catalog.scenario(id))?.let { navigator.push(Screen.Preparation(it)) }
    }

    fun open(scenario: PracticeScenario) = navigator.push(Screen.Preparation(scenario))
    fun delete(scenario: PracticeScenario) {
        reminders.cancelEvent(scenario.id)
        app.store.removeScenario(scenario.id)
    }

    ReadableColumn(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(greeting(), style = Type.largeTitle, color = Brand.colors.ink, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(12.dp))
                    Row(
                        Modifier.heightIn(min = 44.dp).clip(CircleShape).background(Brand.colors.ink)
                            .clickable(role = Role.Button) { navigator.push(Screen.Composer()) }
                            .padding(horizontal = 16.dp).testTag("create-scenario"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(AppIcons.Add, null, Modifier.size(18.dp), tint = Brand.colors.onInk)
                        Spacer(Modifier.width(4.dp))
                        Text("新场景", style = Type.subheadline.semibold, color = Brand.colors.onInk)
                    }
                }
            }
            app.updates.available?.let { release ->
                val links = androidx.compose.ui.platform.LocalUriHandler.current
                SurfaceCard(Modifier.clip(RoundedCornerShape(20.dp)).clickable(role = Role.Button) { links.openUri(release.apkUrl) }.testTag("update-banner"), padding = 16.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("有新版本 ${release.versionName}，点此下载更新", style = Type.subheadline.semibold, color = colors.accent, modifier = Modifier.weight(1f))
                        Icon(AppIcons.ChevronRight, null, Modifier.size(18.dp), tint = colors.accent)
                    }
                }
            }
            if (!aiSettings.isAnyConfigured) {
                SurfaceCard(spacing = 12.dp) {
                    Text("先配置模型接口", style = Type.headline, color = Brand.colors.ink)
                    Text("填入 Google Gemini 或 OpenAI 的 API Key 与模型名称即可开始对话", style = Type.subheadline, color = Brand.colors.secondary)
                    SolidButton("配置接口", onClick = { navigator.push(Screen.APISettings()) }, modifier = Modifier.testTag("configure-api"))
                }
            }
            unfinished?.let { session -> ContinueCard(session) { navigator.push(Screen.Conversation(session)) } }
            if (categories.size > 1) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).semantics { contentDescription = "场景分类" },
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val chip = @Composable { title: String, value: String ->
                        Chip(title, selected = (activeCategory ?: "") == value, minHeight = 44.dp, style = Type.subheadline,
                            horizontalPadding = 16.dp, unselectedBackground = Brand.colors.surface,
                            modifier = Modifier.testTag("category-$title")) { settings.homeCategory = value }
                    }
                    chip("全部", "")
                    for (name in categories) chip(name, name)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                for (scenario in ownScenarios.filter { it.id !in finished && shows(it) }) {
                    SceneItem(scenario, onOpen = { open(scenario) }, onDelete = { delete(scenario) }) {
                        SceneCard(scenario, isCustom = true, eventDay = reminders.eventDay(scenario.id))
                    }
                }
                for (scenario in catalog.filter { it.id !in finished && shows(it) }) {
                    SceneItem(scenario, onOpen = { open(scenario) }) { SceneCard(scenario, recommended = scenario.id in recommended) }
                }
            }
            val practised = ownScenarios.filter { it.id in finished && shows(it) }.map { it to true } +
                catalog.filter { it.id in finished && shows(it) }.map { it to false }
            if (practised.isNotEmpty()) {
                // Finished scenarios fold away so new ones stay on top; still one tap to practise again.
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("练过的", style = Type.subheadline.semibold, color = Brand.colors.secondary)
                    for ((scenario, isCustom) in practised) {
                        SceneItem(scenario, onOpen = { open(scenario) }, onDelete = if (isCustom) ({ delete(scenario) }) else null) {
                            CompactSceneCard(scenario, isCustom)
                        }
                    }
                }
            }
        }
    }
}

/** A scenario card that opens on tap; the learner's own scenarios can be deleted with a long press. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SceneItem(scenario: PracticeScenario, onOpen: () -> Unit, onDelete: (() -> Unit)? = null, card: @Composable () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box(
        Modifier.clip(RoundedCornerShape(24.dp))
            .combinedClickable(role = Role.Button, onLongClickLabel = if (onDelete != null) "更多操作" else null,
                onLongClick = if (onDelete != null) ({ menu = true }) else null, onClick = onOpen)
            .testTag("scene-${scenario.id}"),
    ) {
        card()
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text("删除这个场景", color = Brand.colors.accent) },
                leadingIcon = { Icon(AppIcons.Delete, null, tint = Brand.colors.accent) },
                onClick = {
                    menu = false
                    onDelete?.invoke()
                },
            )
        }
    }
}

@Composable
private fun ContinueCard(session: PracticeSession, onClick: () -> Unit) {
    SurfaceCard(Modifier.clip(RoundedCornerShape(20.dp)).clickable(role = Role.Button, onClick = onClick).testTag("continue-rehearsal"), padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Avatar(session.scenario, 44.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("继续和 ${session.scenario.partner} 的对话", style = Type.headline, color = Brand.colors.ink)
                StepProgress(session.stepIndex, session.scenario.steps.size)
                Text("第 ${session.stepIndex + 1} 步 · ${session.step.goal}", style = Type.caption, color = Brand.colors.secondary)
            }
            Icon(AppIcons.ChevronRight, null, Modifier.size(20.dp), tint = Brand.colors.secondary)
        }
    }
}

/** Leads with the person and their first line — what the learner will actually face. */
@Composable
fun SceneCard(scenario: PracticeScenario, isCustom: Boolean = false, eventDay: LocalDate? = null, recommended: Boolean = false) {
    val colors = Brand.colors
    val today = LocalDate.now()
    // The day of the real conversation, when the learner set one.
    val eventLabel = when {
        eventDay == null || eventDay.isBefore(today) -> null
        eventDay == today -> "今天要用"
        eventDay == today.plusDays(1) -> "明天要用"
        else -> "${eventDay.monthValue}月${eventDay.dayOfMonth}日要用"
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(colors.tone(scenario.id)).padding(20.dp)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(scenario, 40.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(scenario.partner, style = Type.subheadline.semibold, color = colors.ink)
                Text(scenario.partnerRole, style = Type.caption, color = colors.inkOnTone)
            }
            if (eventLabel != null) Text(eventLabel, style = Type.caption.semibold, color = colors.accent)
            else if (recommended) Text("适合你 · ${scenario.category}", style = Type.caption.semibold, color = colors.accent)
            else Text(if (isCustom) "我的 · ${scenario.category}" else scenario.category, style = Type.caption.medium, color = colors.inkOnTone)
        }
        Text("“${scenario.steps[0].prompt}”", style = Type.english(Type.title3), color = colors.ink)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(scenario.title, style = Type.headline, color = colors.ink, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            Icon(AppIcons.ArrowForward, null, Modifier.size(20.dp), tint = colors.ink)
        }
    }
}

/** One-line card for a scenario already practised to the end. */
@Composable
fun CompactSceneCard(scenario: PracticeScenario, isCustom: Boolean = false) {
    val colors = Brand.colors
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(colors.tone(scenario.id))
            .padding(horizontal = 16.dp, vertical = 12.dp).semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(scenario, 32.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(scenario.title, style = Type.subheadline.semibold, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${scenario.partner} · ${if (isCustom) "我的 · " else ""}${scenario.category}", style = Type.caption,
                color = colors.inkOnTone, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(AppIcons.ChevronRight, null, Modifier.size(18.dp), tint = colors.inkOnTone)
    }
}
