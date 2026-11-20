// AGP 9 compiles Kotlin itself (built-in Kotlin); the Kotlin Android plugin is not applied.
// The Kotlin plugins below pin the compiler version used by that built-in support.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
