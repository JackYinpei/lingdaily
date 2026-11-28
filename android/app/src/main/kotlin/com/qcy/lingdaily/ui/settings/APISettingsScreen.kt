package com.qcy.lingdaily.ui.settings

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.qcy.lingdaily.core.network.AIProviderConfiguration
import com.qcy.lingdaily.core.network.AIProviderKind
import com.qcy.lingdaily.core.network.AISettings
import com.qcy.lingdaily.ui.AppIcons
import com.qcy.lingdaily.ui.AppTextField
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.Hairline
import com.qcy.lingdaily.ui.IconAction
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.Segmented
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.SurfaceCard
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.semibold

/** What 保存 stores: trimmed fields, default models in empty slots, one provider for text and voice. */
private fun AISettings.forSaving(): AISettings = copy(
    voiceProvider = textProvider,
    gemini = gemini.sanitized().withDefaultModels(AIProviderKind.GEMINI),
    openai = openai.sanitized().withDefaultModels(AIProviderKind.OPENAI),
)

/**
 * BYOK provider configuration: the provider used for both text and voice, its API key, an
 * optional base URL and the models (prefilled with the newest ones). Nothing applies until 保存.
 */
@Composable
fun APISettingsScreen(screen: Screen.APISettings) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val store = app.aiSettings
    val colors = Brand.colors
    val focus = LocalFocusManager.current
    val context = LocalContext.current

    var draft by remember { mutableStateOf(store.settings.forSaving()) }
    var showKey by rememberSaveable { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    val provider = draft.provider
    val config = draft.configuration(provider)
    val dirty = draft.forSaving().copy(updatedAt = 0L) != store.settings.forSaving().copy(updatedAt = 0L)

    fun updateCurrent(transform: (AIProviderConfiguration) -> AIProviderConfiguration) {
        draft = draft.withConfiguration(provider, transform(config))
    }

    fun save() {
        focus.clearFocus()
        val saved = draft.forSaving()
        store.update { saved }
        val message = if (saved.configuration(saved.provider).apiKey.isEmpty()) {
            "已保存。填写 API Key 后才能使用 AI 功能"
        } else {
            "已保存，文字对话和语音通话都使用 ${saved.provider.title}"
        }
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
        navigator.close(screen)
    }

    fun leave() {
        if (dirty) confirmLeave = true else navigator.close(screen)
    }

    BackHandler(enabled = dirty) { confirmLeave = true }

    ScreenScaffold(
        title = "接口设置",
        onBack = ::leave,
        bottomBar = {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 8.dp)) {
                SolidButton("保存", onClick = ::save, modifier = Modifier.testTag("save-api-settings"))
            }
        },
    ) {
        ReadableColumn(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(
                Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("使用的服务商", style = Type.subheadline.semibold, color = colors.ink)
                    Segmented(
                        options = listOf(AIProviderKind.GEMINI to "Google Gemini", AIProviderKind.OPENAI to "OpenAI"),
                        selected = provider,
                        modifier = Modifier.testTag("api-provider-tab"),
                    ) { chosen ->
                        draft = draft.copy(textProvider = chosen, voiceProvider = chosen)
                        showKey = false
                    }
                    Text("文字对话和语音通话都使用这里选中的服务商。", style = Type.caption, color = colors.secondary)
                }

                SurfaceCard(spacing = 16.dp) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("API Key", style = Type.subheadline.semibold, color = colors.ink)
                        AppTextField(
                            value = config.apiKey,
                            onValueChange = { value -> updateCurrent { it.copy(apiKey = value) } },
                            placeholder = "粘贴 ${provider.title} API Key",
                            limit = 512,
                            keyboardOptions = KeyboardOptions(
                                capitalization = KeyboardCapitalization.None,
                                autoCorrectEnabled = false,
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Next,
                            ),
                            visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(),
                            modifier = Modifier.testTag("api-key-field"),
                            trailing = {
                                if (config.apiKey.isNotEmpty()) {
                                    IconAction(AppIcons.Close, "清空 API Key", width = 36.dp, height = 36.dp, iconSize = 16.dp) {
                                        updateCurrent { it.copy(apiKey = "") }
                                    }
                                }
                                TextAction(
                                    text = if (showKey) "隐藏" else "显示",
                                    style = Type.caption,
                                    modifier = Modifier.padding(horizontal = 8.dp),
                                ) { showKey = !showKey }
                            },
                        )
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("接口地址", style = Type.subheadline.semibold, color = colors.ink)
                            Text("可选", style = Type.caption, color = colors.secondary)
                        }
                        AppTextField(
                            value = config.baseURL,
                            onValueChange = { value -> updateCurrent { it.copy(baseURL = value) } },
                            placeholder = "留空走默认的东京中转，也可填自己的地址",
                            limit = 512,
                            keyboardOptions = KeyboardOptions(
                                capitalization = KeyboardCapitalization.None,
                                autoCorrectEnabled = false,
                                keyboardType = KeyboardType.Uri,
                                imeAction = ImeAction.Next,
                            ),
                            modifier = Modifier.testTag("api-base-url-field"),
                            trailing = if (config.baseURL.isNotEmpty()) ({
                                IconAction(AppIcons.Close, "清空接口地址", width = 36.dp, height = 36.dp, iconSize = 16.dp) {
                                    updateCurrent { it.copy(baseURL = "") }
                                }
                            }) else null,
                        )
                    }

                    Hairline()

                    ModelField(
                        title = "文字模型",
                        value = config.textModel,
                        defaultModel = provider.defaultTextModel,
                        note = "用于文字练习、复盘、生成场景和翻译。",
                        tag = "api-text-model-field",
                        imeAction = ImeAction.Next,
                    ) { value -> updateCurrent { it.copy(textModel = value) } }

                    ModelField(
                        title = "实时语音模型",
                        value = config.liveModel,
                        defaultModel = provider.defaultLiveModel,
                        note = "用于语音通话。",
                        tag = "api-live-model-field",
                        imeAction = ImeAction.Done,
                    ) { value -> updateCurrent { it.copy(liveModel = value) } }
                }

                Text(
                    "密钥仅加密保存在本机（登录账号后会加密同步到你的个人账号），对话直连你配置的模型接口。",
                    style = Type.caption,
                    color = colors.secondary,
                )
            }
        }
    }

    if (confirmLeave) {
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text("保存修改？") },
            text = { Text("接口设置有未保存的修改。") },
            confirmButton = { TextButton(onClick = { confirmLeave = false; save() }) { Text("保存", color = colors.ink) } },
            dismissButton = {
                TextButton(onClick = { confirmLeave = false; navigator.close(screen) }) { Text("不保存", color = colors.secondary) }
            },
        )
    }
}

@Composable
private fun ModelField(
    title: String,
    value: String,
    defaultModel: String,
    note: String,
    tag: String,
    imeAction: ImeAction,
    onChange: (String) -> Unit,
) {
    val colors = Brand.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = Type.subheadline.semibold, color = colors.ink)
        AppTextField(
            value = value,
            onValueChange = onChange,
            placeholder = defaultModel,
            limit = 120,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Ascii,
                imeAction = imeAction,
            ),
            modifier = Modifier.testTag(tag),
            trailing = if (value.trim() != defaultModel) ({
                TextAction(text = "恢复默认", style = Type.caption, modifier = Modifier.padding(horizontal = 8.dp)) { onChange(defaultModel) }
            }) else null,
        )
        Text("${note}默认 $defaultModel（目前最新），一般不用改。", style = Type.caption, color = colors.secondary)
    }
}
