package com.qcy.lingdaily.ui.practice

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.AppTextField
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.ComposerState
import com.qcy.lingdaily.ui.IconAction
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.medium
import com.qcy.lingdaily.ui.settings.SignInButton

/** Describe a real upcoming conversation; the server turns it into a three-step scenario saved on this device. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScenarioComposerScreen(screen: Screen.Composer) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val state = screen.state
    val colors = Brand.colors
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var refreshError by remember { mutableStateOf<String?>(null) }
    var notificationsDenied by remember { mutableStateOf(false) }
    var pickingDay by remember { mutableStateOf(false) }
    val trimmed = state.description.trim()

    fun refreshIdeas() {
        if (refreshing) return
        refreshing = true
        refreshError = null
        val avoid = state.shownIdeas
        scope.launch {
            try {
                val ideas = app.api.scenarioIdeas(avoid)
                state.examples = ideas
                state.shownIdeas = state.shownIdeas + ideas
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                refreshError = error.message
            } finally {
                refreshing = false
            }
        }
    }

    fun generate() {
        if (trimmed.isEmpty() || isLoading) return
        focus.clearFocus()
        errorMessage = null
        isLoading = true
        // Leaving the page cancels this scope, and with it the request.
        scope.launch {
            try {
                val scenario = app.api.createScenario(trimmed)
                app.store.addScenario(scenario)
                state.eventDay?.let { app.reminders.scheduleEvent(scenario, it) }
                // Straight on to the preparation page; back from there returns to the home page.
                navigator.replaceTop(Screen.Preparation(scenario))
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                errorMessage = error.message
                isLoading = false
            }
        }
    }

    // A scenario being generated is not abandoned by an accidental back.
    BackHandler(enabled = isLoading) {}
    ScreenScaffold(
        title = "新场景", onBack = { navigator.close(screen) }, backEnabled = !isLoading,
        bottomBar = {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                errorMessage?.let { Text(it, style = Type.footnote, color = colors.accent) }
                if (app.account.canPractice) {
                    SolidButton(if (isLoading) "正在布置场景…" else "生成场景", onClick = ::generate, enabled = trimmed.isNotEmpty() && !isLoading,
                        busy = isLoading, modifier = Modifier.testTag("generate-scenario"))
                } else {
                    SignInButton()
                }
            }
        },
    ) {
        ReadableColumn(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Text("想练哪一场对话？", style = Type.title, color = colors.ink)
                AppTextField(state.description, { state.description = it }, "比如：${ComposerState.STARTER_EXAMPLES[0]}", limit = 300,
                    singleLine = false, minHeight = 132.dp, enabled = !isLoading, modifier = Modifier.testTag("scenario-description"))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("试试这些", style = Type.caption, color = colors.secondary, modifier = Modifier.weight(1f))
                        if (app.account.canPractice) {
                            if (refreshing) CircularProgressIndicator(Modifier.padding(end = 6.dp).size(14.dp), color = colors.ink, strokeWidth = 2.dp)
                            TextAction(if (refreshing) "正在想…" else "换一批", icon = if (refreshing) null else AppIcons.Refresh, color = colors.ink,
                                style = Type.caption.medium, enabled = !refreshing && !isLoading, modifier = Modifier.testTag("refresh-ideas"), onClick = ::refreshIdeas)
                        }
                    }
                    refreshError?.let { Text(it, style = Type.caption, color = colors.secondary) }
                    for (example in state.examples) {
                        Text(example, style = Type.subheadline, color = colors.ink,
                            modifier = Modifier.alpha(if (isLoading) 0.5f else 1f).clip(RoundedCornerShape(20.dp)).border(1.dp, colors.line, RoundedCornerShape(20.dp))
                                .clickable(enabled = !isLoading, role = Role.Button) { state.description = example }
                                .padding(horizontal = 14.dp, vertical = 10.dp))
                    }
                }
                // Optional: when the real conversation happens. Asks for notifications only when tapped.
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val day = state.eventDay
                    if (day != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("什么时候用得上", style = Type.subheadline, color = colors.ink, modifier = Modifier.weight(1f))
                            TextAction("${day.monthValue}月${day.dayOfMonth}日", color = colors.accent, style = Type.subheadline.medium,
                                modifier = Modifier.testTag("event-day")) { pickingDay = true }
                            IconAction(AppIcons.Close, "不用提醒", iconSize = 16.dp) { state.eventDay = null }
                        }
                        Text("前一晚和当天早上提醒你再过一遍。", style = Type.caption, color = colors.secondary)
                    } else {
                        TextAction("什么时候用得上？加个提醒", icon = AppIcons.Bell, enabled = !isLoading, modifier = Modifier.testTag("add-event-day")) {
                            scope.launch {
                                val allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || app.requestPermission(Manifest.permission.POST_NOTIFICATIONS)
                                notificationsDenied = !allowed
                                if (allowed) state.eventDay = LocalDate.now().plusDays(1)
                            }
                        }
                        if (notificationsDenied) {
                            Text("通知没有打开，可以在系统设置里允许 LingDaily 发送通知。", style = Type.caption, color = colors.secondary)
                        }
                    }
                }
            }
        }
    }

    if (pickingDay) {
        val today = remember { LocalDate.now() }
        val picker = rememberDatePickerState(
            initialSelectedDateMillis = (state.eventDay ?: today).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : SelectableDates {
                // The picker works in UTC days; only today and later can be chosen.
                override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                    !Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate().isBefore(today)
                override fun isSelectableYear(year: Int): Boolean = year >= today.year
            },
        )
        DatePickerDialog(
            onDismissRequest = { pickingDay = false },
            confirmButton = {
                TextButton(onClick = {
                    picker.selectedDateMillis?.let { state.eventDay = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }
                    pickingDay = false
                }) { Text("确定", color = colors.accent) }
            },
            dismissButton = { TextButton(onClick = { pickingDay = false }) { Text("取消", color = colors.ink) } },
        ) { DatePicker(picker, showModeToggle = false) }
    }
}
