package com.qcy.lingdaily.ui.settings

import android.Manifest
import android.os.Build
import android.text.format.DateUtils
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import com.qcy.lingdaily.BuildConfig
import com.qcy.lingdaily.app.SyncEngine
import com.qcy.lingdaily.core.network.AIModelCatalog
import com.qcy.lingdaily.core.network.AIModelFeature
import com.qcy.lingdaily.core.network.LingDailyService
import com.qcy.lingdaily.core.realtime.AIUsageSummary
import com.qcy.lingdaily.core.realtime.LivePause
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.Hairline
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.PageTitle
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.Segmented
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.SurfaceCard
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.semibold

@Composable
private fun ToggleRow(title: String, checked: Boolean, modifier: Modifier = Modifier, onChange: (Boolean) -> Unit) {
    Row(modifier.fillMaxWidth().heightIn(min = 44.dp).toggleable(checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = Type.subheadline, color = Brand.colors.ink, modifier = Modifier.weight(1f))
        Switch(checked, onCheckedChange = null)
    }
}

/** A value that opens a menu of choices. */
@Composable
private fun <T> MenuPicker(label: String, options: List<Pair<T, String>>, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(Modifier.heightIn(min = 44.dp).clickable(role = Role.DropdownList) { open = true }, verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = Type.subheadline, color = Brand.colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Icon(AppIcons.ChevronRight, null, Modifier.size(16.dp), tint = Brand.colors.secondary)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((value, title) in options) DropdownMenuItem(text = { Text(title, color = Brand.colors.ink) }, onClick = {
                open = false
                onSelect(value)
            })
        }
    }
}

/** 我的: account, appearance, practice choices, reminders, AI model and usage, privacy. */
@Composable
fun SettingsScreen() {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val settings = app.settings
    val account = app.account
    val sync = app.sync
    val colors = Brand.colors
    val links = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    var signingOut by remember { mutableStateOf(false) }
    var unsyncedOnSignOut by remember { mutableStateOf(false) }

    // Signing out removes this account's records from the device; they come back from the cloud on sign-in.
    fun finishSignOut() {
        sync.forgetAccountData()
        account.signOut()
    }

    ReadableColumn(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
            PageTitle("我的")
            if (!account.usesLocalDevelopment) {
                SurfaceCard(spacing = 14.dp) {
                    val session = account.session
                    if (session == null) SignInButton() else {
                        val failed = sync.status is SyncEngine.Status.Failed
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(session.email, style = Type.subheadline, color = colors.ink)
                            Text(when (val status = sync.status) {
                                SyncEngine.Status.Syncing -> "正在同步…"
                                is SyncEngine.Status.Failed -> status.message
                                SyncEngine.Status.Idle -> sync.lastSyncedAt?.let {
                                    "已同步 · ${DateUtils.getRelativeTimeSpanString(it, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)}"
                                } ?: "尚未同步"
                            }, style = Type.caption, color = if (failed) colors.accent else colors.secondary)
                        }
                        if (failed) TextAction("重新同步", color = colors.ink) { scope.launch { sync.syncNow() } }
                        Hairline()
                        TextAction(if (signingOut) "正在同步…" else "退出登录", color = colors.ink, enabled = !signingOut, modifier = Modifier.fillMaxWidth()) {
                            signingOut = true
                            scope.launch {
                                val clean = try {
                                    sync.flushBeforeSignOut()
                                } finally {
                                    signingOut = false
                                }
                                if (clean) finishSignOut() else unsyncedOnSignOut = true
                            }
                        }
                        Hairline()
                        // Account deletion lives one level down, in 账号与数据.
                        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button) { navigator.push(Screen.AccountData()) }.testTag("account-data"),
                            verticalAlignment = Alignment.CenterVertically) {
                            Text("账号与数据", style = Type.subheadline, color = colors.ink, modifier = Modifier.weight(1f))
                            Icon(AppIcons.ChevronRight, null, Modifier.size(18.dp), tint = colors.secondary)
                        }
                    }
                }
            }
            SurfaceCard(spacing = 12.dp) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("外观", style = Type.subheadline, color = colors.ink)
                    Segmented(listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色"), settings.appearance) { settings.appearance = it }
                }
                Hairline()
                ToggleRow("自动朗读对方的话", settings.autoReadReplies) { settings.autoReadReplies = it }
                Hairline()
                ToggleRow("放慢朗读", settings.slowSpeech) { settings.slowSpeech = it }
                Hairline()
                ToggleRow("练习时带上词库里的词", settings.reviewWordsInPractice, Modifier.testTag("review-words-toggle")) { settings.reviewWordsInPractice = it }
                Hairline()
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("停顿多久算说完", style = Type.subheadline, color = colors.ink, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    MenuPicker(LivePause.label(LivePause.valid(settings.livePauseMs)), LivePause.options.map { it to LivePause.label(it) },
                        onSelect = { settings.livePauseMs = it }, modifier = Modifier.testTag("live-pause"))
                }
            }
            ReminderCard()
            if (account.canPractice) AIModelCard()
            if (account.session != null && !account.usesLocalDevelopment) UsageCard()
            SurfaceCard(spacing = 4.dp) {
                TextAction("隐私政策", color = colors.ink, modifier = Modifier.fillMaxWidth()) { links.openUri("${LingDailyService.BASE_URL}/privacy") }
                Hairline()
                TextAction("帮助与联系", color = colors.ink, modifier = Modifier.fillMaxWidth()) { links.openUri("${LingDailyService.BASE_URL}/support") }
                Hairline()
                if (settings.aiConsentGranted) {
                    TextAction("撤回 AI 数据使用授权", color = colors.ink, modifier = Modifier.fillMaxWidth()) { settings.revokeAIConsent() }
                } else {
                    TextAction("AI 数据使用", color = colors.ink, modifier = Modifier.fillMaxWidth()) { app.consentRequested = true }
                }
            }
            Text("LingDaily ${BuildConfig.VERSION_NAME}" + if (account.usesLocalDevelopment) " · 本机开发服务" else "",
                style = Type.caption, color = colors.secondary, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }

    if (unsyncedOnSignOut) {
        AlertDialog(
            onDismissRequest = { unsyncedOnSignOut = false },
            title = { Text("还有内容没同步") },
            text = { Text("有 ${sync.pendingCount} 项改动还没上传到账号。退出会移除本机记录，这些改动会丢失。") },
            confirmButton = {
                TextButton(onClick = {
                    unsyncedOnSignOut = false
                    finishSignOut()
                }) { Text("仍然退出", color = colors.accent) }
            },
            dismissButton = { TextButton(onClick = { unsyncedOnSignOut = false }) { Text("取消", color = colors.ink) } },
        )
    }
}

/** Opt-in daily reminder. Days with practice are skipped; permission is asked only when it is turned on. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReminderCard() {
    val app = LocalApp.current
    val settings = app.settings
    val colors = Brand.colors
    val scope = rememberCoroutineScope()
    var denied by remember { mutableStateOf(false) }
    var pickingTime by remember { mutableStateOf(false) }
    fun reschedule() = app.reminders.rescheduleDaily(app.practicedToday)

    SurfaceCard(spacing = 8.dp) {
        ToggleRow("每天提醒我练习", settings.dailyReminderEnabled, Modifier.testTag("daily-reminder")) { turnOn ->
            if (!turnOn) {
                settings.dailyReminderEnabled = false
                reschedule()
                return@ToggleRow
            }
            scope.launch {
                val allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || app.requestPermission(Manifest.permission.POST_NOTIFICATIONS)
                denied = !allowed
                settings.dailyReminderEnabled = allowed
                reschedule()
            }
        }
        if (settings.dailyReminderEnabled) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("提醒时间", style = Type.subheadline, color = colors.ink, modifier = Modifier.weight(1f))
                TextAction("%02d:%02d".format(settings.dailyReminderHour, settings.dailyReminderMinute), color = colors.accent,
                    style = Type.subheadline.semibold) { pickingTime = true }
            }
            Text("当天已经练过就不再提醒。", style = Type.caption, color = colors.secondary)
        }
        if (denied) Text("通知没有打开，可以在系统设置里允许 LingDaily 发送通知。", style = Type.caption, color = colors.secondary)
    }

    if (pickingTime) {
        val picker = rememberTimePickerState(settings.dailyReminderHour, settings.dailyReminderMinute, is24Hour = true)
        AlertDialog(
            onDismissRequest = { pickingTime = false },
            title = { Text("提醒时间") },
            text = { TimePicker(picker) },
            confirmButton = {
                TextButton(onClick = {
                    settings.dailyReminderHour = picker.hour
                    settings.dailyReminderMinute = picker.minute
                    pickingTime = false
                    reschedule()
                }) { Text("确定", color = colors.accent) }
            },
            dismissButton = { TextButton(onClick = { pickingTime = false }) { Text("取消", color = colors.ink) } },
        )
    }
}

/** A card whose content comes from the service: spinner, a retry line, or the content. */
@Composable
private fun <T> LoadedCard(title: String, trailing: String? = null, load: suspend () -> T, content: @Composable (T) -> Unit) {
    val colors = Brand.colors
    var value by remember { mutableStateOf<T?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableStateOf(0) }
    LaunchedEffect(attempt) {
        failed = false
        try {
            value = load()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            failed = true
        }
    }
    SurfaceCard(spacing = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = Type.subheadline, color = colors.ink, modifier = Modifier.weight(1f))
            if (trailing != null) Text(trailing, style = Type.caption, color = colors.secondary)
        }
        val loaded = value
        when {
            loaded != null -> content(loaded)
            failed -> TextAction("加载失败，点此重试", style = Type.caption) { attempt++ }
            else -> Box(Modifier.fillMaxWidth().heightIn(min = 44.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(20.dp), color = colors.secondary, strokeWidth = 2.dp)
            }
        }
    }
}

/**
 * Lets the learner pick a model per feature from the server's allowed list.
 * The choice is stored on this device; none means the server default.
 */
@Composable
private fun AIModelCard() {
    val app = LocalApp.current
    val settings = app.settings
    LoadedCard<AIModelCatalog>("AI 模型", load = { app.api.modelCatalog() }) { catalog ->
        AIModelFeature.entries.forEachIndexed { index, feature ->
            if (index > 0) Hairline()
            val options = catalog.feature(feature)
            val chosen = settings.model(feature)?.takeIf { id -> id != options.defaultModel && options.choices.any { it.id == id } }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(feature.title, style = Type.subheadline, color = Brand.colors.ink)
                Spacer(Modifier.width(12.dp))
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    MenuPicker<String?>(chosen ?: "默认（${options.defaultModel}）",
                        listOf<Pair<String?, String>>(null to "默认（${options.defaultModel}）") +
                            options.choices.filter { it.id != options.defaultModel }.map { it.id to "${it.id} · ${it.note}" },
                        onSelect = { settings.setModel(feature, it) }, modifier = Modifier.testTag("model-${feature.raw}"))
                }
            }
        }
    }
}

private val usageLabels = mapOf("practice" to "文字对话", "scenario" to "生成场景", "ideas" to "换一批",
    "translate" to "单句翻译", "suggest" to "卡住时的建议", "live" to "语音通话")

/** The learner's own AI token usage over the last 30 days (no prices). */
@Composable
private fun UsageCard() {
    val app = LocalApp.current
    val colors = Brand.colors
    val number = remember { NumberFormat.getIntegerInstance(Locale.CHINA) }
    LoadedCard<AIUsageSummary>("我的用量", trailing = "近 30 天", load = { app.api.usageSummary() }) { summary ->
        Text("${number.format(summary.total.totalTokens)} tokens · ${summary.total.calls} 次", style = Type.title3.semibold, color = colors.ink)
        for (group in summary.byFeature) {
            Row {
                Text(usageLabels[group.key] ?: group.key, style = Type.caption, color = colors.secondary, modifier = Modifier.weight(1f))
                Text("${number.format(group.totalTokens)} · ${group.calls} 次", style = Type.caption, color = colors.ink)
            }
        }
        if (summary.byFeature.isEmpty()) Text("还没有用量记录。", style = Type.caption, color = colors.secondary)
    }
}

/**
 * 账号与数据: which account this is, and — one step further — account deletion, which is
 * explained first and then confirmed with the account's password.
 */
@Composable
fun AccountDataScreen(screen: Screen.AccountData) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val account = app.account
    val colors = Brand.colors
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    var showsDeletion by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    fun delete() {
        if (deleting || password.isEmpty()) return
        focus.clearFocus()
        deleting = true
        errorMessage = null
        scope.launch {
            try {
                account.deleteAccount(password)
                app.sync.forgetAccountData()
                navigator.close(screen)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                errorMessage = error.message
            } finally {
                deleting = false
            }
        }
    }

    // A deletion in progress is not left half-way by an accidental back.
    BackHandler(enabled = deleting) {}
    ScreenScaffold(title = "账号与数据", onBack = { navigator.close(screen) }, backEnabled = !deleting) {
        ReadableColumn(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                SurfaceCard { Text(account.session?.email.orEmpty(), style = Type.subheadline, color = colors.ink) }
                if (!showsDeletion) {
                    TextAction("删除账号", style = Type.footnote, modifier = Modifier.align(Alignment.CenterHorizontally).testTag("delete-account")) { showsDeletion = true }
                } else {
                    SurfaceCard(spacing = 14.dp) {
                        Text("删除账号", style = Type.headline, color = colors.ink)
                        Text("账号和全部练习记录、词库、自建场景（含网页版和 iPhone 版）将永久删除，无法撤销。", style = Type.subheadline, color = colors.secondary)
                        PasswordField(password, { password = it }, "输入密码确认", enabled = !deleting, onDone = ::delete,
                            modifier = Modifier.testTag("delete-account-password"))
                        errorMessage?.let { Text(it, style = Type.caption, color = colors.accent) }
                        SolidButton(if (deleting) "正在删除…" else "永久删除账号", onClick = ::delete, enabled = password.isNotEmpty() && !deleting,
                            busy = deleting, modifier = Modifier.testTag("confirm-delete-account"))
                        TextAction("不删了", color = colors.ink, enabled = !deleting, modifier = Modifier.fillMaxWidth()) {
                            showsDeletion = false
                            password = ""
                            errorMessage = null
                        }
                    }
                }
            }
        }
    }
}
