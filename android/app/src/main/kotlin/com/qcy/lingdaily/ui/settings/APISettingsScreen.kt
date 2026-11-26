package com.qcy.lingdaily.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import com.qcy.lingdaily.core.network.AIProviderConfiguration
import com.qcy.lingdaily.core.network.AIProviderKind
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
import com.qcy.lingdaily.ui.SurfaceCard
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type
import com.qcy.lingdaily.ui.medium
import com.qcy.lingdaily.ui.semibold

private enum class ModelSlot { TEXT, LIVE }

/**
 * BYOK provider configuration: Google Gemini & OpenAI API keys, optional custom base URLs,
 * text & realtime voice model IDs, model list fetching, and active provider selection.
 */
@Composable
fun APISettingsScreen(screen: Screen.APISettings) {
    val app = LocalApp.current
    val navigator = LocalNavigator.current
    val store = app.aiSettings
    val settings = store.settings
    val colors = Brand.colors
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()

    var activeTab by rememberSaveable { mutableStateOf(settings.textProvider) }
    var showKey by rememberSaveable(activeTab) { mutableStateOf(false) }
    var fetching by remember { mutableStateOf(false) }
    var fetchNotice by remember(activeTab) { mutableStateOf<String?>(null) }
    var fetchError by remember(activeTab) { mutableStateOf<String?>(null) }
    val fetchedModels = remember { mutableStateMapOf<AIProviderKind, List<String>>() }
    var pickerSlot by remember { mutableStateOf<ModelSlot?>(null) }

    val config = settings.configuration(activeTab)
    val availableModels = fetchedModels[activeTab].orEmpty()

    fun updateCurrent(transform: (AIProviderConfiguration) -> AIProviderConfiguration) {
        store.update { current ->
            current.withConfiguration(activeTab, transform(current.configuration(activeTab)))
        }
    }

    fun fetchModels(openSlot: ModelSlot = ModelSlot.TEXT) {
        if (fetching || config.apiKey.trim().isEmpty()) return
        focus.clearFocus()
        fetching = true
        fetchNotice = null
        fetchError = null
        val provider = activeTab
        val apiKey = config.apiKey
        val baseURL = config.baseURL
        scope.launch {
            try {
                val list = app.api.fetchAvailableModels(provider, apiKey, baseURL)
                fetchedModels[provider] = list
                if (list.isEmpty()) {
                    fetchError = "接口返回了空的模型列表，可直接手动输入模型名称。"
                } else {
                    fetchNotice = "已拉取 ${list.size} 个模型，点选即可填入。"
                    pickerSlot = openSlot
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                fetchError = error.message ?: "拉取模型列表失败，请检查密钥与接口地址。"
            } finally {
                fetching = false
            }
        }
    }

    ScreenScaffold(title = "接口设置", onBack = { navigator.close(screen) }) {
        ReadableColumn(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(
                Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                // Provider configuration editor
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Segmented(
                        options = listOf(AIProviderKind.GEMINI to "Google Gemini", AIProviderKind.OPENAI to "OpenAI"),
                        selected = activeTab,
                        modifier = Modifier.testTag("api-provider-tab"),
                    ) { activeTab = it }

                    SurfaceCard(spacing = 16.dp) {
                        // API Key
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("API Key", style = Type.subheadline.semibold, color = colors.ink)
                            AppTextField(
                                value = config.apiKey,
                                onValueChange = { value -> updateCurrent { it.copy(apiKey = value) } },
                                placeholder = if (activeTab == AIProviderKind.GEMINI) "粘贴 Google Gemini API Key" else "粘贴 OpenAI API Key",
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

                        // Base URL
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("接口地址", style = Type.subheadline.semibold, color = colors.ink)
                                Text("可选", style = Type.caption, color = colors.secondary)
                            }
                            AppTextField(
                                value = config.baseURL,
                                onValueChange = { value -> updateCurrent { it.copy(baseURL = value) } },
                                placeholder = "留空使用官方地址，可填自定义反代",
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

                        // Text Model
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("文字模型", style = Type.subheadline.semibold, color = colors.ink, modifier = Modifier.weight(1f))
                                if (availableModels.isNotEmpty()) {
                                    TextAction("选择模型", color = colors.accent, style = Type.caption.medium, minHeight = 32.dp) {
                                        pickerSlot = ModelSlot.TEXT
                                    }
                                }
                            }
                            AppTextField(
                                value = config.textModel,
                                onValueChange = { value -> updateCurrent { it.copy(textModel = value) } },
                                placeholder = if (activeTab == AIProviderKind.GEMINI) "例：gemini-2.5-flash" else "例：gpt-4o-mini",
                                limit = 120,
                                keyboardOptions = KeyboardOptions(
                                    capitalization = KeyboardCapitalization.None,
                                    autoCorrectEnabled = false,
                                    keyboardType = KeyboardType.Ascii,
                                    imeAction = ImeAction.Next,
                                ),
                                modifier = Modifier.testTag("api-text-model-field"),
                                trailing = if (config.textModel.isNotEmpty()) ({
                                    IconAction(AppIcons.Close, "清空文字模型", width = 36.dp, height = 36.dp, iconSize = 16.dp) {
                                        updateCurrent { it.copy(textModel = "") }
                                    }
                                }) else null,
                            )
                        }

                        // Live Voice Model
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("实时语音模型", style = Type.subheadline.semibold, color = colors.ink, modifier = Modifier.weight(1f))
                                if (availableModels.isNotEmpty()) {
                                    TextAction("选择模型", color = colors.accent, style = Type.caption.medium, minHeight = 32.dp) {
                                        pickerSlot = ModelSlot.LIVE
                                    }
                                }
                            }
                            AppTextField(
                                value = config.liveModel,
                                onValueChange = { value -> updateCurrent { it.copy(liveModel = value) } },
                                placeholder = if (activeTab == AIProviderKind.GEMINI) {
                                    "例：gemini-2.5-flash-native-audio-latest"
                                } else {
                                    "例：gpt-4o-realtime-preview"
                                },
                                limit = 120,
                                keyboardOptions = KeyboardOptions(
                                    capitalization = KeyboardCapitalization.None,
                                    autoCorrectEnabled = false,
                                    keyboardType = KeyboardType.Ascii,
                                    imeAction = ImeAction.Done,
                                ),
                                modifier = Modifier.testTag("api-live-model-field"),
                                trailing = if (config.liveModel.isNotEmpty()) ({
                                    IconAction(AppIcons.Close, "清空实时语音模型", width = 36.dp, height = 36.dp, iconSize = 16.dp) {
                                        updateCurrent { it.copy(liveModel = "") }
                                    }
                                }) else null,
                            )
                        }

                        // Fetch model list action
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (fetching) {
                                CircularProgressIndicator(Modifier.size(16.dp), color = colors.ink, strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                            }
                            TextAction(
                                text = if (fetching) "正在拉取模型列表…" else "从接口拉取模型列表",
                                icon = if (fetching) null else AppIcons.Refresh,
                                color = colors.ink,
                                style = Type.subheadline.medium,
                                enabled = config.apiKey.trim().isNotEmpty() && !fetching,
                                modifier = Modifier.testTag("fetch-models"),
                                onClick = { fetchModels() },
                            )
                        }
                        fetchNotice?.let { Text(it, style = Type.caption, color = colors.secondary) }
                        fetchError?.let { Text(it, style = Type.caption, color = colors.accent) }
                    }
                }

                // Active provider selectors
                SurfaceCard(spacing = 14.dp) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("文字对话服务商", style = Type.subheadline.semibold, color = colors.ink)
                        Segmented(
                            options = listOf(AIProviderKind.GEMINI to "Gemini", AIProviderKind.OPENAI to "OpenAI"),
                            selected = settings.textProvider,
                            modifier = Modifier.testTag("text-provider-select"),
                        ) { chosen -> store.update { it.copy(textProvider = chosen) } }
                    }
                    Hairline()
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("语音通话服务商", style = Type.subheadline.semibold, color = colors.ink)
                        Segmented(
                            options = listOf(AIProviderKind.GEMINI to "Gemini", AIProviderKind.OPENAI to "OpenAI"),
                            selected = settings.voiceProvider,
                            modifier = Modifier.testTag("voice-provider-select"),
                        ) { chosen -> store.update { it.copy(voiceProvider = chosen) } }
                    }
                }

                Text(
                    "密钥仅加密保存在本机（登录账号后会加密同步到你的个人账号），对话直连你配置的模型接口。",
                    style = Type.caption,
                    color = colors.secondary,
                )
            }
        }
    }

    pickerSlot?.let { initialSlot ->
        ModelPickerDialog(
            provider = activeTab,
            models = availableModels,
            initialSlot = initialSlot,
            currentTextModel = config.textModel,
            currentLiveModel = config.liveModel,
            onPick = { slot, modelId ->
                updateCurrent { current ->
                    when (slot) {
                        ModelSlot.TEXT -> current.copy(textModel = modelId)
                        ModelSlot.LIVE -> current.copy(liveModel = modelId)
                    }
                }
                pickerSlot = null
            },
            onDismiss = { pickerSlot = null },
        )
    }
}

@Composable
private fun ModelPickerDialog(
    provider: AIProviderKind,
    models: List<String>,
    initialSlot: ModelSlot,
    currentTextModel: String,
    currentLiveModel: String,
    onPick: (ModelSlot, String) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = Brand.colors
    var slot by remember { mutableStateOf(initialSlot) }
    var filter by remember { mutableStateOf("") }
    val filtered = remember(models, filter) {
        val q = filter.trim().lowercase()
        if (q.isEmpty()) models else models.filter { it.lowercase().contains(q) }
    }
    val currentId = if (slot == ModelSlot.TEXT) currentTextModel.trim() else currentLiveModel.trim()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("${provider.title} 模型列表") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Segmented(
                    options = listOf(ModelSlot.TEXT to "填入文字模型", ModelSlot.LIVE to "填入实时语音模型"),
                    selected = slot,
                ) { slot = it }
                if (models.size > 6) {
                    AppTextField(
                        value = filter,
                        onValueChange = { filter = it },
                        placeholder = "筛选模型名称…",
                        minHeight = 40.dp,
                        textStyle = Type.subheadline,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.None,
                            autoCorrectEnabled = false,
                        ),
                    )
                }
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 300.dp)) {
                    if (filtered.isEmpty()) {
                        item {
                            Text("没有匹配的模型", style = Type.caption, color = colors.secondary, modifier = Modifier.padding(vertical = 16.dp))
                        }
                    }
                    items(filtered, key = { it }) { id ->
                        val selected = id == currentId
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 42.dp).clickable(role = Role.Button) { onPick(slot, id) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                id,
                                style = if (selected) Type.subheadline.semibold else Type.subheadline,
                                color = if (selected) colors.accent else colors.ink,
                                modifier = Modifier.weight(1f),
                            )
                            if (selected) {
                                Icon(AppIcons.Check, null, Modifier.size(16.dp), tint = colors.accent)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("关闭", color = colors.ink) }
        },
    )
}
