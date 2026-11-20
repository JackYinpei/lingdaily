import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Optional pairing with the local AI service started by `npm run ios:dev` (repo root).
// The file only exists while that process runs, so an ordinary Debug build talks to
// production. It holds a loopback address and a random pairing token, never a model key.
val devConnection: Map<*, *>? = rootProject.file("../.ios-dev/connection.json")
    .takeIf { it.isFile }
    ?.let { runCatching { JsonSlurper().parse(it) as? Map<*, *> }.getOrNull() }

// Release signing. `keystore.properties` and the keystore it names are not in Git; without
// them (CI, a fresh clone) the release APK is still built, only unsigned.
val keystoreProperties = Properties().apply {
    rootProject.file("keystore.properties").takeIf { it.isFile }?.inputStream()?.use(::load)
}

fun quoted(value: Any?): String = "\"" + (value as? String).orEmpty().replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.qcy.lingdaily"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.qcy.lingdaily"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (keystoreProperties.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "DEV_BASE_URL", quoted(devConnection?.get("baseURL")))
            buildConfigField("String", "DEV_ACCESS_TOKEN", quoted(devConnection?.get("accessToken")))
        }
        release {
            // Release never carries a pairing; production accepts account sessions only.
            buildConfigField("String", "DEV_BASE_URL", "\"\"")
            buildConfigField("String", "DEV_ACCESS_TOKEN", "\"\"")
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.session)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.test.junit)
}
