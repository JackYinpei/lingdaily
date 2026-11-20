package com.qcy.lingdaily.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Paper, ink, and one accent — the same palette as the iOS app (docs/ios/02-design-system.md).
 * Ink = actions and the learner's own words; accent = state (progress, selected, saved).
 * This is the only place colours are defined.
 */
@Immutable
data class BrandColors(
    val page: Color,
    val surface: Color,
    val ink: Color,
    val onInk: Color,
    val secondary: Color,
    val line: Color,
    val accent: Color,
    private val tones: List<Color>,
    val isDark: Boolean,
) {
    /** Secondary text on scenario tones; `secondary` alone is too faint there. */
    val inkOnTone: Color get() = ink.copy(alpha = 0.72f)

    /**
     * Each scenario owns one muted tone, used for its card and its partner's avatar.
     * Other scenarios reuse the same four tones, picked by a stable hash of their id
     * (the same hash as iOS, so a person keeps their colour on both).
     */
    fun tone(scenarioID: String): Color = when (scenarioID) {
        "deadline" -> tones[0]
        "hotel" -> tones[1]
        "introduction" -> tones[2]
        "coffee" -> tones[3]
        else -> tones[scenarioID.codePoints().sum().mod(tones.size)]
    }
}

private val LightBrand = BrandColors(
    page = Color(0xFFF6F2EA), surface = Color(0xFFFFFDF8), ink = Color(0xFF1E1C19), onInk = Color(0xFFFFFDF8),
    secondary = Color(0xFF6F6A62), line = Color(0xFFE6DFD3), accent = Color(0xFFC2451E),
    tones = listOf(Color(0xFFDCE6D3), Color(0xFFD6E2EE), Color(0xFFF0E2B6), Color(0xFFF1D8CA)), isDark = false,
)

private val DarkBrand = BrandColors(
    page = Color(0xFF151412), surface = Color(0xFF211F1B), ink = Color(0xFFF2EEE6), onInk = Color(0xFF151412),
    secondary = Color(0xFFA39D93), line = Color(0xFF35322C), accent = Color(0xFFF08A64),
    tones = listOf(Color(0xFF28332A), Color(0xFF232E38), Color(0xFF37301F), Color(0xFF3A2A23)), isDark = true,
)

private val LocalBrand = staticCompositionLocalOf { LightBrand }

object Brand {
    val colors: BrandColors
        @Composable @ReadOnlyComposable get() = LocalBrand.current
}

/** Text sizes named after their role. All in sp, so they follow the system font size. */
object Type {
    val largeTitle = TextStyle(fontSize = 32.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold)
    val title = TextStyle(fontSize = 26.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold)
    val title2 = TextStyle(fontSize = 22.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold)
    val title3 = TextStyle(fontSize = 19.sp, lineHeight = 27.sp)
    val headline = TextStyle(fontSize = 17.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)
    val body = TextStyle(fontSize = 16.sp, lineHeight = 24.sp)
    val callout = TextStyle(fontSize = 15.sp, lineHeight = 22.sp)
    val subheadline = TextStyle(fontSize = 14.sp, lineHeight = 21.sp)
    val footnote = TextStyle(fontSize = 13.sp, lineHeight = 19.sp)
    val caption = TextStyle(fontSize = 12.sp, lineHeight = 17.sp)
    val caption2 = TextStyle(fontSize = 11.sp, lineHeight = 15.sp)

    /** English learning content reads like a book; UI chrome stays in the system face. */
    fun english(style: TextStyle = body): TextStyle = style.copy(fontFamily = FontFamily.Serif)
}

val TextStyle.semibold: TextStyle get() = copy(fontWeight = FontWeight.SemiBold)
val TextStyle.medium: TextStyle get() = copy(fontWeight = FontWeight.Medium)
val TextStyle.bold: TextStyle get() = copy(fontWeight = FontWeight.Bold)

/** `appearance` is the learner's choice in 「我的」: system, light or dark. */
@Composable
fun LingDailyTheme(appearance: String, content: @Composable () -> Unit) {
    val dark = when (appearance) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    val brand = if (dark) DarkBrand else LightBrand
    // Material components (switches, dialogs, pickers, menus) take the same palette.
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = brand.accent, onPrimary = brand.onInk, primaryContainer = brand.accent, onPrimaryContainer = brand.onInk,
        secondary = brand.ink, onSecondary = brand.onInk, secondaryContainer = brand.line, onSecondaryContainer = brand.ink,
        tertiary = brand.accent, onTertiary = brand.onInk,
        background = brand.page, onBackground = brand.ink,
        surface = brand.surface, onSurface = brand.ink, surfaceVariant = brand.line, onSurfaceVariant = brand.secondary,
        surfaceTint = Color.Transparent, surfaceContainer = brand.surface, surfaceContainerHigh = brand.surface,
        surfaceContainerHighest = brand.line, surfaceContainerLow = brand.surface, surfaceContainerLowest = brand.surface,
        outline = brand.secondary, outlineVariant = brand.line, error = brand.accent, onError = brand.onInk,
    )
    MaterialTheme(colorScheme = scheme) {
        CompositionLocalProvider(
            LocalBrand provides brand,
            LocalContentColor provides brand.ink,
            LocalTextSelectionColors provides TextSelectionColors(brand.accent, brand.accent.copy(alpha = 0.3f)),
            content = content,
        )
    }
}
