package com.qcy.lingdaily.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.qcy.lingdaily.core.network.LingDailyService
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.PageTitle
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type

/**
 * Says what AI use sends to whom, before any of it is sent. Covers the whole app and can
 * only be left through one of its two buttons. Microphone permission is asked separately.
 */
@Composable
fun AIDataConsentPage(onDone: () -> Unit) {
    val settings = LocalApp.current.settings
    val links = LocalUriHandler.current
    var confirmedAdult by rememberSaveable { mutableStateOf(false) }
    BackHandler {}
    ReadableColumn(
        Modifier.fillMaxSize().background(Brand.colors.page)
            // Taps beside the text must not reach the page underneath.
            .pointerInput(Unit) { detectTapGestures {} }
            .windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState()),
    ) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            PageTitle("开始前，了解数据去向")
            val body = Type.subheadline.copy(lineHeight = Type.subheadline.lineHeight * 1.15f)
            Text("对话由 Google Gemini 生成。允许后，你输入的文字、场景描述、练习目标、相关对话上下文，以及语音通话中的麦克风音频，会发送给 Google，用于生成回复、转录、翻译、建议和纠错。", style = body, color = Brand.colors.ink)
            Text("文字请求经过 LingDaily 服务；实时音频可能经过我们管理的东京中转。LingDaily 不保存原始通话录音；文字记录、词库和自建场景保存在本机并同步到 Supabase。Google 对数据的处理遵循其服务条款和隐私政策。请勿输入敏感信息。", style = body, color = Brand.colors.ink)
            Text("你可以在「我的 → AI 数据使用」撤回。拒绝或撤回后仍可查看已有记录，AI 练习将不可用。文字模式里点麦克风听写时，录音在你停止后发送给 Google 转成文字，不会保存；朗读的句子同样由 Google 合成。麦克风权限会单独询问。", style = body, color = Brand.colors.ink)
            TextAction("阅读隐私政策", color = Brand.colors.accent) { links.openUri("${LingDailyService.BASE_URL}/privacy") }
            Row(
                Modifier.toggleable(confirmedAdult, role = Role.Switch) { confirmedAdult = it }.testTag("confirm-adult"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("我已年满 18 周岁", style = Type.subheadline, color = Brand.colors.ink, modifier = Modifier.weight(1f))
                Switch(confirmedAdult, onCheckedChange = null)
            }
            SolidButton("允许并继续", enabled = confirmedAdult, modifier = Modifier.testTag("allow-ai-data"), onClick = {
                settings.grantAIConsent()
                onDone()
            })
            SolidButton("暂不使用 AI", secondary = true, modifier = Modifier.testTag("decline-ai-data"), onClick = onDone)
        }
    }
}
