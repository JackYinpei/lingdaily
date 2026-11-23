package com.qcy.lingdaily.ui

import android.graphics.Color as AndroidColor
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.qcy.lingdaily.app.AppContainer
import com.qcy.lingdaily.ui.learning.LearningScreen
import com.qcy.lingdaily.ui.learning.ReviewScreen
import com.qcy.lingdaily.ui.learning.SessionDetailScreen
import com.qcy.lingdaily.ui.practice.ConversationScreen
import com.qcy.lingdaily.ui.practice.PodcastScreen
import com.qcy.lingdaily.ui.practice.PodcastTab
import com.qcy.lingdaily.ui.practice.PracticeHomeScreen
import com.qcy.lingdaily.ui.practice.PreparationScreen
import com.qcy.lingdaily.ui.practice.ScenarioComposerScreen
import com.qcy.lingdaily.ui.practice.SummaryScreen
import com.qcy.lingdaily.ui.practice.TodayVocabularyScreen
import com.qcy.lingdaily.ui.settings.AIDataConsentPage
import com.qcy.lingdaily.ui.settings.AccountDataScreen
import com.qcy.lingdaily.ui.settings.InterestsOnboarding
import com.qcy.lingdaily.ui.settings.InterestsScreen
import com.qcy.lingdaily.ui.settings.SettingsScreen
import com.qcy.lingdaily.ui.settings.SignInScreen

private const val TABS_KEY = "tabs"

@Composable
fun LingDailyRoot(app: AppContainer) {
    LingDailyTheme(app.settings.appearance) {
        CompositionLocalProvider(LocalApp provides app, LocalNavigator provides app.navigator) {
            val navigator = app.navigator
            val holder = rememberSaveableStateHolder()
            var tab by rememberSaveable { mutableIntStateOf(0) }
            val dark = Brand.colors.isDark

            // Status and navigation bar icons follow the app's own appearance, not only the system's.
            val activity = LocalActivity.current as? ComponentActivity
            LaunchedEffect(dark, activity) {
                val style = if (dark) SystemBarStyle.dark(AndroidColor.TRANSPARENT)
                else SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                activity?.enableEdgeToEdge(style, style)
            }

            BackHandler(enabled = !navigator.isAtRoot) { navigator.pop() }

            // First run asks what the learner wants to practise; the AI consent waits until it is done.
            // The learner sees where AI data goes before the first AI call can be made.
            LaunchedEffect(app.account.canPractice, app.settings.learnerInterestsAsked) {
                if (app.settings.learnerInterestsAsked && app.account.canPractice && !app.settings.aiConsentGranted) {
                    app.consentRequested = true
                }
            }
            // A tapped reminder opens its scenario from the practice page.
            LaunchedEffect(app.reminders.pendingScenarioID) {
                if (app.reminders.pendingScenarioID != null) tab = 0
            }
            // State of pages that have been closed is no longer needed.
            val keys = navigator.stack.map { it.key }
            val known = remember { mutableSetOf<String>() }
            LaunchedEffect(keys) {
                (known - keys.toSet()).forEach(holder::removeState)
                known.clear()
                known += keys
            }

            Box(Modifier.fillMaxSize().background(Brand.colors.page)) {
                AnimatedContent(
                    targetState = navigator.stack.lastOrNull(),
                    contentKey = { it?.key ?: TABS_KEY },
                    transitionSpec = {
                        val forward = navigator.forward
                        (slideInHorizontally(tween(260)) { if (forward) it else -it / 4 } + fadeIn(tween(200)))
                            .togetherWith(slideOutHorizontally(tween(260)) { if (forward) -it / 4 else it } + fadeOut(tween(200)))
                            .apply { targetContentZIndex = if (forward) 1f else -1f }
                    },
                    label = "pages",
                ) { screen ->
                    holder.SaveableStateProvider(screen?.key ?: TABS_KEY) {
                        when (screen) {
                            null -> Tabs(tab) { tab = it }
                            is Screen.Preparation -> PreparationScreen(screen)
                            is Screen.Conversation -> ConversationScreen(screen)
                            is Screen.Composer -> ScenarioComposerScreen(screen)
                            is Screen.TodayVocabulary -> TodayVocabularyScreen(screen)
                            is Screen.Podcast -> PodcastScreen(screen)
                            is Screen.SessionDetail -> SessionDetailScreen(screen)
                            is Screen.Review -> ReviewScreen(screen)
                            is Screen.Summary -> SummaryScreen(screen)
                            is Screen.SignIn -> SignInScreen(screen)
                            is Screen.AccountData -> AccountDataScreen(screen)
                            is Screen.Interests -> InterestsScreen(screen)
                        }
                    }
                }
                if (!app.settings.learnerInterestsAsked) InterestsOnboarding(onDone = {})
                else if (app.consentRequested) AIDataConsentPage(onDone = { app.consentRequested = false })
                else UpdateDialog()
            }
        }
    }
}

@Composable
private fun Tabs(selected: Int, onSelect: (Int) -> Unit) {
    val holder = rememberSaveableStateHolder()
    Column(Modifier.fillMaxSize().background(Brand.colors.page)) {
        Column(Modifier.weight(1f).fillMaxWidth()
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))) {
            StorageBanner()
            holder.SaveableStateProvider("tab-$selected") {
                when (selected) {
                    0 -> PracticeHomeScreen()
                    1 -> PodcastTab()
                    2 -> LearningScreen()
                    else -> SettingsScreen()
                }
            }
        }
        // One opaque paper bar with a hairline, in light and dark, in every scroll position.
        Hairline()
        Row(
            Modifier.fillMaxWidth().background(Brand.colors.page)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                .height(58.dp),
        ) {
            TabItem("练习", AppIcons.Chat, selected == 0) { onSelect(0) }
            TabItem("播客", AppIcons.Headphones, selected == 1) { onSelect(1) }
            TabItem("学习", AppIcons.Book, selected == 2) { onSelect(2) }
            TabItem("我的", AppIcons.Person, selected == 3) { onSelect(3) }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(label: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    val color = if (selected) Brand.colors.accent else Brand.colors.secondary
    Column(
        Modifier.weight(1f).fillMaxSize().clickable(role = Role.Tab, onClick = onClick).semantics { this.selected = selected },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
        Icon(icon, null, Modifier.size(24.dp), tint = color)
        Text(label, style = Type.caption2.medium, color = color)
    }
}

/** Announces a newer version once; afterwards it stays on 练习 and 我的 until installed. */
@Composable
private fun UpdateDialog() {
    val app = LocalApp.current
    val links = LocalUriHandler.current
    val release = app.updates.available ?: return
    if (release.versionCode <= app.settings.updatePromptedVersion) return
    val dismiss = { app.settings.updatePromptedVersion = release.versionCode }
    AlertDialog(
        onDismissRequest = dismiss,
        title = { Text("发现新版本 ${release.versionName}") },
        text = { if (release.changelog.isNotEmpty()) Text(release.changelog) },
        confirmButton = {
            TextButton(onClick = {
                dismiss()
                links.openUri(release.apkUrl)
            }, modifier = Modifier.testTag("update-download")) { Text("下载更新", color = Brand.colors.accent) }
        },
        dismissButton = { TextButton(onClick = dismiss) { Text("稍后", color = Brand.colors.ink) } },
    )
}
