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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.runtime.Composable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
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
import com.qcy.lingdaily.core.network.normalizePhone
import com.qcy.lingdaily.ui.AppTextField
import com.qcy.lingdaily.ui.Brand
import com.qcy.lingdaily.ui.LocalApp
import com.qcy.lingdaily.ui.LocalNavigator
import com.qcy.lingdaily.ui.ReadableColumn
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.Segmented
import com.qcy.lingdaily.ui.ScreenScaffold
import com.qcy.lingdaily.ui.SolidButton
import com.qcy.lingdaily.ui.TextAction
import com.qcy.lingdaily.ui.Type

/** The one account entry point, shared by the profile page. */
@Composable
fun SignInButton(modifier: Modifier = Modifier, secondary: Boolean = false) {
    val navigator = LocalNavigator.current
    SolidButton("登录 / 注册", onClick = { navigator.push(Screen.SignIn()) }, secondary = secondary, modifier = modifier.testTag("sign-in"))
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
 * Phone number or email, plus password, of the LingDaily account (the same one as on the web).
 * Phone: one form; an unknown number is registered on the spot (no SMS) unless the learner
 * unticks it. Email: sign in, or register and maybe confirm the address by email first.
 */
@Composable
fun SignInScreen(screen: Screen.SignIn) {
    val account = LocalApp.current.account
    val navigator = LocalNavigator.current
    val focus = LocalFocusManager.current
    val links = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    var registering by rememberSaveable { mutableStateOf(false) }
    var usesPhone by rememberSaveable { mutableStateOf(true) }
    var autoRegister by rememberSaveable { mutableStateOf(true) }
    var email by rememberSaveable { mutableStateOf("") }
    var phoneInput by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    val address = email.trim()
    val phone = normalizePhone(phoneInput)
    val ready = (if (usesPhone) phone != null else address.contains("@")) &&
        password.length >= (if (registering && !usesPhone) 6 else 1) && !account.isSigningIn

    fun submit() {
        if (!ready) return
        focus.clearFocus()
        notice = null
        scope.launch {
            if (usesPhone) {
                val number = phone ?: return@launch
                if (account.signInWithPhone(number, password, autoRegister)) navigator.close(screen)
                return@launch
            }
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

    val registeringEmail = registering && !usesPhone
    ScreenScaffold(title = if (registeringEmail) "注册" else "登录", onBack = { navigator.close(screen) }, backEnabled = !account.isSigningIn) {
        ReadableColumn(Modifier.verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Segmented(listOf(true to "手机号", false to "邮箱"), usesPhone, Modifier.testTag("sign-in-method")) {
                    if (!account.isSigningIn && it != usesPhone) {
                        usesPhone = it
                        notice = null
                        account.errorMessage = null
                    }
                }
                if (usesPhone) {
                    AppTextField(phoneInput, { phoneInput = it }, "手机号", limit = 32, enabled = !account.isSigningIn,
                        modifier = Modifier.testTag("sign-in-phone"),
                        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }))
                } else {
                    AppTextField(email, { email = it }, "邮箱", limit = 254, enabled = !account.isSigningIn,
                        modifier = Modifier.testTag("sign-in-email"),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
                            keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }))
                }
                PasswordField(password, { password = it }, if (registeringEmail) "密码（至少 6 位）" else "密码",
                    modifier = Modifier.testTag("sign-in-password"), enabled = !account.isSigningIn, onDone = ::submit)
                if (usesPhone) {
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = !account.isSigningIn, role = Role.Checkbox) { autoRegister = !autoRegister }
                            .testTag("sign-in-auto-register"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(autoRegister, onCheckedChange = null, enabled = !account.isSigningIn,
                            colors = CheckboxDefaults.colors(checkedColor = Brand.colors.ink, checkmarkColor = Brand.colors.surface))
                        Text("未注册的手机号自动注册", style = Type.footnote, color = Brand.colors.ink, modifier = Modifier.padding(start = 8.dp))
                    }
                }
                notice?.let { Text(it, style = Type.footnote, color = Brand.colors.ink) }
                account.errorMessage?.let { Text(it, style = Type.footnote, color = Brand.colors.accent) }
                SolidButton(
                    if (account.isSigningIn) (if (registeringEmail) "正在注册…" else "正在登录…") else if (registeringEmail) "注册并登录" else "登录",
                    onClick = ::submit, enabled = ready, busy = account.isSigningIn, modifier = Modifier.testTag("sign-in-submit"))
                if (!usesPhone) {
                    TextAction(if (registering) "已有账号？去登录" else "没有账号？注册", color = Brand.colors.ink,
                        enabled = !account.isSigningIn, modifier = Modifier.fillMaxWidth().testTag("sign-in-switch")) {
                        registering = !registering
                        notice = null
                        account.errorMessage = null
                    }
                }
                TextAction("隐私政策", style = Type.caption) { links.openUri("${LingDailyService.BASE_URL}/privacy") }
            }
        }
    }
}
