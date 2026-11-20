package com.qcy.lingdaily.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.prefix

/** Readable column on tablets; full width on phones. */
fun Modifier.readableColumn(): Modifier = fillMaxWidth().then(Modifier.widthIn(max = 620.dp))

/** Centres a readable column inside the available width. */
@Composable
fun ReadableColumn(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = 620.dp).fillMaxWidth(), content = content)
    }
}

/** The only button style: filled ink for the main action, outlined for the alternative. */
@Composable
fun SolidButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    secondary: Boolean = false,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    busy: Boolean = false,
) {
    val colors = Brand.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val foreground = if (secondary) colors.ink else colors.onInk
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .alpha(if (!enabled) 0.35f else if (pressed) 0.7f else 1f)
            .clip(CircleShape)
            .background(if (secondary) Color.Transparent else colors.ink)
            .then(if (secondary) Modifier.border(1.5.dp, colors.line, CircleShape) else Modifier)
            .clickable(interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) {
            androidx.compose.material3.CircularProgressIndicator(Modifier.size(18.dp), color = foreground, strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
        } else if (icon != null) {
            Icon(icon, null, Modifier.size(20.dp), tint = foreground)
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = Type.headline, color = foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A conversation partner is a person, not a feature icon: initial on the scenario tone. */
@Composable
fun Avatar(scenario: PracticeScenario, size: Dp = 40.dp, modifier: Modifier = Modifier) {
    val colors = Brand.colors
    Box(
        modifier.size(size).clip(CircleShape).background(colors.tone(scenario.id))
            .border(1.dp, colors.ink.copy(alpha = 0.08f), CircleShape).clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Text(scenario.partner.prefix(1), color = colors.ink,
            style = TextStyle(fontSize = (size.value * 0.44f).sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Serif))
    }
}

@Composable
fun PageTitle(title: String, subtitle: String? = null) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = Type.largeTitle, color = Brand.colors.ink)
        if (subtitle != null) Text(subtitle, style = Type.subheadline, color = Brand.colors.secondary)
    }
}

@Composable
fun EmptyState(title: String) {
    Text(title, style = Type.subheadline, color = Brand.colors.secondary, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(vertical = 56.dp, horizontal = 24.dp))
}

@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Brand.colors.line))
}

/** Card container: surface, 20 dp corners, hairline border. */
@Composable
fun SurfaceCard(
    modifier: Modifier = Modifier,
    padding: Dp = 18.dp,
    spacing: Dp = 0.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier.fillMaxWidth().clip(shape).background(Brand.colors.surface).border(1.dp, Brand.colors.line, shape).padding(padding),
        verticalArrangement = Arrangement.spacedBy(spacing), content = content,
    )
}

/** Shown wherever saving to this device has failed, with a way to try again. */
@Composable
fun StorageBanner() {
    val store = LocalApp.current.store
    val error = store.storageError ?: return
    Column(Modifier.fillMaxWidth().background(Brand.colors.surface)) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(error, style = Type.caption, color = Brand.colors.ink, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(12.dp))
            TextAction("重试", color = Brand.colors.accent, style = Type.caption.bold, minHeight = 32.dp) { store.retrySave() }
        }
        Hairline()
    }
}

@Composable
fun StepProgress(current: Int, total: Int, modifier: Modifier = Modifier) {
    Row(modifier.semantics(mergeDescendants = true) { contentDescription = "第 ${current + 1} 步，共 $total 步" },
        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        repeat(total) { index ->
            Box(Modifier.weight(1f).height(4.dp).clip(CircleShape)
                .background(if (index <= current) Brand.colors.accent else Brand.colors.line))
        }
    }
}

/** A plain text action with a touch target of at least 44 dp. */
@Composable
fun TextAction(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Brand.colors.secondary,
    style: TextStyle = Type.subheadline,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    minHeight: Dp = 44.dp,
    trailingIcon: ImageVector? = null,
    onClick: () -> Unit,
) {
    Row(
        modifier.heightIn(min = minHeight).alpha(if (enabled) 1f else 0.4f).clip(RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, Modifier.size(18.dp), tint = color)
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = style, color = color)
        if (trailingIcon != null) {
            Spacer(Modifier.width(2.dp))
            Icon(trailingIcon, null, Modifier.size(16.dp), tint = color)
        }
    }
}

@Composable
fun IconAction(
    icon: ImageVector,
    description: String,
    modifier: Modifier = Modifier,
    tint: Color = Brand.colors.secondary,
    enabled: Boolean = true,
    width: Dp = 44.dp,
    height: Dp = 44.dp,
    iconSize: Dp = 20.dp,
    onClick: () -> Unit,
) {
    Box(
        modifier.size(width, height).alpha(if (enabled) 1f else 0.4f).clip(CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, Modifier.size(iconSize), tint = tint)
    }
}

/** A capsule that is filled with ink when selected and outlined otherwise. */
@Composable
fun Chip(
    title: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    minHeight: Dp = 32.dp,
    style: TextStyle = Type.caption.medium,
    horizontalPadding: Dp = 12.dp,
    unselectedBackground: Color = Color.Transparent,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = Brand.colors
    Box(
        modifier.defaultMinSize(minHeight = minHeight).clip(CircleShape)
            .background(if (selected) colors.ink else unselectedBackground)
            .then(if (selected) Modifier else Modifier.border(1.dp, colors.line, CircleShape))
            .clickable(enabled = enabled, role = Role.Tab, onClick = onClick)
            .semantics { this.selected = selected }
            .padding(horizontal = horizontalPadding),
        contentAlignment = Alignment.Center,
    ) {
        Text(title, style = if (selected) style.semibold else style, color = if (selected) colors.onInk else colors.ink)
    }
}

/** Two or three exclusive choices side by side. */
@Composable
fun <T> Segmented(options: List<Pair<T, String>>, selected: T, modifier: Modifier = Modifier, onSelect: (T) -> Unit) {
    val colors = Brand.colors
    Row(
        modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(12.dp)).background(colors.line.copy(alpha = 0.7f)).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        for ((value, label) in options) {
            val isSelected = value == selected
            Box(
                Modifier.weight(1f).fillMaxSize().clip(RoundedCornerShape(9.dp))
                    .background(if (isSelected) colors.surface else Color.Transparent)
                    .clickable(role = Role.Tab) { onSelect(value) }
                    .semantics { this.selected = isSelected },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = if (isSelected) Type.subheadline.semibold else Type.subheadline, color = colors.ink, maxLines = 1)
            }
        }
    }
}

/** Single- or multi-line text entry on a surface card, limited to `limit` characters. */
@Composable
fun AppTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    limit: Int = Int.MAX_VALUE,
    singleLine: Boolean = true,
    minHeight: Dp = 50.dp,
    enabled: Boolean = true,
    textStyle: TextStyle = Type.body,
    keyboardOptions: KeyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: androidx.compose.ui.text.input.VisualTransformation = androidx.compose.ui.text.input.VisualTransformation.None,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val colors = Brand.colors
    val shape = RoundedCornerShape(14.dp)
    BasicTextField(
        value = value,
        onValueChange = { onValueChange(it.prefix(limit)) },
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        singleLine = singleLine,
        textStyle = textStyle.copy(color = colors.ink),
        cursorBrush = SolidColor(colors.accent),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = visualTransformation,
        decorationBox = { inner ->
            Row(
                Modifier.heightIn(min = minHeight).clip(shape).background(colors.surface).border(1.dp, colors.line, shape)
                    .padding(start = 16.dp, end = if (trailing == null) 16.dp else 4.dp, top = if (singleLine) 0.dp else 14.dp, bottom = if (singleLine) 0.dp else 14.dp),
                verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
            ) {
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(placeholder, style = textStyle, color = colors.secondary, maxLines = if (singleLine) 1 else 4, overflow = TextOverflow.Ellipsis)
                    inner()
                }
                trailing?.invoke(this)
            }
        },
    )
}

/**
 * A pushed page: back button and title on top, scrolling content, and an optional bar
 * pinned to the bottom that stays above the keyboard.
 */
@Composable
fun ScreenScaffold(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    backEnabled: Boolean = true,
    titleContent: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    header: @Composable ColumnScope.() -> Unit = {},
    bottomBar: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Brand.colors
    Column(
        modifier.fillMaxSize().background(colors.page)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)),
    ) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconAction(AppIcons.Back, "返回", tint = colors.ink, enabled = backEnabled, iconSize = 26.dp, onClick = onBack)
            Box(Modifier.weight(1f).padding(horizontal = 4.dp), contentAlignment = Alignment.CenterStart) {
                if (titleContent != null) titleContent()
                else Text(title, style = Type.headline, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            actions()
            Spacer(Modifier.width(8.dp))
        }
        header()
        Column(Modifier.weight(1f).fillMaxWidth(), content = content)
        Box(Modifier.fillMaxWidth().background(colors.page)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom).union(WindowInsets.ime.only(WindowInsetsSides.Bottom)))) {
            if (bottomBar != null) ReadableColumn { bottomBar() }
        }
    }
}

val PagePadding = PaddingValues(horizontal = 20.dp)
