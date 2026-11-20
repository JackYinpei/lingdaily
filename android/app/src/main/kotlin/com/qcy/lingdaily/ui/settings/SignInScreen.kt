package com.qcy.lingdaily.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import com.qcy.lingdaily.app.AccountStore
import com.qcy.lingdaily.core.network.LingDailyService
import com.qcy.lingdaily.ui.AppTextField
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type

/** The one account entry point, shared by the practice home, the preparation page and the profile page. */
@Composable
fun SignInButton(modifier: Modifier = Modifier) {
    val navigator = LocalNavigator.current
    SolidButton("登录 / 注册", onClick = { navigator.push(Screen.SignIn()) }, modifier = modifier.testTag("sign-in"))
}

@Composable
fun PasswordField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier,
                  enabled: Boolean = true, imeAction: ImeAction = ImeAction.Done, onDone: () -> Unit = {}) {
    var visible by rememberSaveable { mutableStateOf(false) }
    AppTextField(
        value, onValueChange, placeholder, modifier = modifier, limit = 256, enabled = enabled,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
            keyboardType = KeyboardType.Password, imeAction = imeAction),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        trailing = { TextAction(if (visible) "隐藏" else "显示", style = Type.caption, modifier = Modifier.padding(horizontal = 8.dp)) { visible = !visible } },
    )
}

/**
 * Email and password of the LingDaily account (the same one as on the web). A new address
 * can register here; when the service asks for it, the address is confirmed by email first.
 */
@Composable
fun SignInScreen(screen: Screen.SignIn) {
    val account = LocalApp.current.account
    val navigator = LocalNavigator.current
    val focus = LocalFocusManager.current
    val links = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    var registering by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    val address = email.trim()
    val ready = address.contains("@") && password.length >= (if (registering) 6 else 1) && !account.isSigningIn

    fun submit() {
        if (!ready) return
        focus.clearFocus()
        notice = null
        scope.launch {
            if (!registering) {
                if (account.signIn(address, password)) navigator.close(screen)
                return@launch
            }
            when (account.register(address, password)) {
                AccountStore.Registration.SIGNED_IN -> navigator.close(screen)
                AccountStore.Registration.CONFIRM_EMAIL -> {
                    registering = false
                    notice = "注册邮件已发到 $address。点开邮件里的链接确认后，回到这里登录。"
                }
                AccountStore.Registration.FAILED -> Unit
            }
        }
    }

    ScreenScaffold(title = if (registering) "注册" else "登录", onBack = { navigator.close(screen) }, backEnabled = !account.isSigningIn) {
        ReadableColumn(Modifier.verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(if (registering) "创建 LingDaily 账号" else "登录 LingDaily", style = Type.title, color = Brand.colors.ink)
                Text("练习记录、词库和自建场景会同步到这个账号，网页版也能看到。", style = Type.subheadline, color = Brand.colors.secondary)
                AppTextField(email, { email = it }, "邮箱", limit = 254, enabled = !account.isSigningIn,
                    modifier = Modifier.testTag("sign-in-email"),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
                        keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }))
                PasswordField(password, { password = it }, if (registering) "密码（至少 6 位）" else "密码",
                    modifier = Modifier.testTag("sign-in-password"), enabled = !account.isSigningIn, onDone = ::submit)
                notice?.let { Text(it, style = Type.footnote, color = Brand.colors.ink) }
                account.errorMessage?.let { Text(it, style = Type.footnote, color = Brand.colors.accent) }
                SolidButton(
                    if (account.isSigningIn) (if (registering) "正在注册…" else "正在登录…") else if (registering) "注册并登录" else "登录",
                    onClick = ::submit, enabled = ready, busy = account.isSigningIn, modifier = Modifier.testTag("sign-in-submit"))
                TextAction(if (registering) "已有账号？去登录" else "没有账号？用邮箱注册", color = Brand.colors.ink,
                    enabled = !account.isSigningIn, modifier = Modifier.fillMaxWidth().testTag("sign-in-switch")) {
                    registering = !registering
                    notice = null
                    account.errorMessage = null
                }
                if (!registering) {
                    Text("在 iPhone 上用 Apple 登录的账号没有密码，暂时不能在这里登录。", style = Type.caption, color = Brand.colors.secondary)
                }
                TextAction("隐私政策", style = Type.caption) { links.openUri("${LingDailyService.BASE_URL}/privacy") }
            }
        }
    }
}
