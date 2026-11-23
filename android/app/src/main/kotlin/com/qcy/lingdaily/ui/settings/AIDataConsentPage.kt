package com.qcy.lingdaily.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
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
            Text("允许后，你输入的文字、练习内容和语音通话的麦克风音频会发送给 AI 服务，用于生成回复、转录、翻译和纠错。", style = body, color = Brand.colors.ink)
            Text("我们不保存通话录音；练习记录、词库和自建场景会同步到你的账号。请勿输入敏感信息。", style = body, color = Brand.colors.ink)
            Text("可在「我的 → AI 数据使用」撤回，撤回后 AI 练习不可用。", style = body, color = Brand.colors.secondary)
            TextAction("阅读隐私政策", color = Brand.colors.accent) { links.openUri("${LingDailyService.BASE_URL}/privacy") }
            SolidButton("允许并继续", modifier = Modifier.testTag("allow-ai-data"), onClick = {
                settings.grantAIConsent()
                onDone()
            })
            SolidButton("暂不使用 AI", secondary = true, modifier = Modifier.testTag("decline-ai-data"), onClick = onDone)
        }
    }
}
