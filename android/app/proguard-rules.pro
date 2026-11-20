# kotlinx.serialization and OkHttp ship their own consumer rules.
# Keep serializers of the app's own wire and archive models.
-keepclassmembers class com.qcy.lingdaily.** {
    *** Companion;
}
-keepclasseswithmembers class com.qcy.lingdaily.** {
    kotlinx.serialization.KSerializer serializer(...);
}
