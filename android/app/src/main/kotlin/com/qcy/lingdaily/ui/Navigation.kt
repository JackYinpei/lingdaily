package com.qcy.lingdaily.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import java.time.LocalDate
import java.util.UUID
import com.qcy.lingdaily.app.AppContainer
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.ReviewTarget

/** One thing to recall: the learner sees the Chinese and says (or types) the English. */
data class ReviewCard(val id: String, val text: String, val meaning: String, val label: String)

/** What the learner has typed on the preparation page; kept while another page covers it. */
class PreparationState(scenario: PracticeScenario) {
    var goal by mutableStateOf("")
    var context by mutableStateOf("")
    var addsContext by mutableStateOf(false)
    var reviewItems by mutableStateOf(emptyList<ReviewTarget>())

    /** The partner's avatar on the 脾气 pad, each axis -1...1; the centre is the scenario's persona. */
    var padX by mutableFloatStateOf(0f)
    var padY by mutableFloatStateOf(0f)

    /** The partner's persona for this rehearsal; editing it never changes the saved scenario. */
    var persona by mutableStateOf(scenario.persona.orEmpty())
    var editsPersona by mutableStateOf(false)
}

class ComposerState {
    var description by mutableStateOf("")
    var examples by mutableStateOf(STARTER_EXAMPLES)

    /** Every idea shown so far, so a new batch never repeats one. */
    var shownIdeas by mutableStateOf(STARTER_EXAMPLES)

    /** The day of the real conversation; reminders go out the evening before and that morning. */
    var eventDay by mutableStateOf<LocalDate?>(null)

    companion object {
        val STARTER_EXAMPLES = listOf(
            "周五要跟房东谈退押金，他说墙上有划痕要扣钱",
            "下周一第一次和海外客户开视频会，要做自我介绍",
            "在机场航班取消了，要去柜台改签到明天早上",
        )
    }
}

/** A page pushed over the tabs. Each carries the state that must survive while it is covered. */
sealed class Screen {
    val key: String = UUID.randomUUID().toString()

    class Preparation(val scenario: PracticeScenario) : Screen() {
        val state = PreparationState(scenario)
    }

    class Conversation(val session: PracticeSession, val voiceMode: Boolean? = null, val autoStartVoice: Boolean = false) : Screen()

    class Composer : Screen() {
        val state = ComposerState()
    }

    class TodayVocabulary : Screen()
    class SessionDetail(val sessionID: UUID, val fallback: PracticeSession) : Screen()
    class Review(val title: String, val cards: List<ReviewCard>, val recordsResults: Boolean) : Screen()
    class Summary(val session: PracticeSession) : Screen()
    class SignIn : Screen()
    class AccountData : Screen()
}

/** The stack of pages above the tabs. Pushing and popping slide horizontally. */
class Navigator {
    val stack = mutableStateListOf<Screen>()

    /** True when the latest change went deeper; decides which way the pages slide. */
    var forward by mutableStateOf(true)
        private set

    val isAtRoot: Boolean get() = stack.isEmpty()

    fun push(screen: Screen) {
        forward = true
        stack += screen
    }

    fun pop() {
        if (stack.isEmpty()) return
        forward = false
        stack.removeAt(stack.lastIndex)
    }

    /** Leaves `screen` wherever it is in the stack, together with anything above it. */
    fun close(screen: Screen) {
        val index = stack.indexOf(screen)
        if (index < 0) return
        forward = false
        stack.removeRange(index, stack.size)
    }

    /** The current page turns into another one: going back skips the replaced page. */
    fun replaceTop(screen: Screen) {
        forward = true
        if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex)
        stack += screen
    }
}

val LocalNavigator = staticCompositionLocalOf<Navigator> { error("No navigator") }
val LocalApp = staticCompositionLocalOf<AppContainer> { error("No app container") }
