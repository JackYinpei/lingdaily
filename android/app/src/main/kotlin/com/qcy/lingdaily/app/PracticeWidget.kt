package com.qcy.lingdaily.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.qcy.lingdaily.MainActivity
import com.qcy.lingdaily.R
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.PracticeStats

/**
 * Home-screen widget: the rehearsal waiting to be continued, or an invitation to start one,
 * with the current streak. Tapping it opens the app there.
 */
class PracticeWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val app = (context.applicationContext as? LingDailyApplication)?.container ?: return
        val sessions = app.store.archive.sessions
        val unfinished = unfinished(sessions)
        val streak = PracticeStats.streak(sessions)
        val views = RemoteViews(context.packageName, R.layout.widget_practice)
        views.setTextViewText(R.id.widget_title, unfinished?.let { "继续和 ${it.scenario.partner} 的对话" } ?: "今天想练哪一场对话？")
        views.setTextViewText(R.id.widget_subtitle, when {
            unfinished != null -> "第 ${unfinished.stepIndex + 1} 步 · ${unfinished.step.goal}"
            streak > 0 -> "已连续练习 $streak 天"
            else -> "五分钟就够，开口说几句。"
        })
        val open = Intent(context, MainActivity::class.java).setAction(ACTION_CONTINUE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 2, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        manager.updateAppWidget(ids, views)
    }

    companion object {
        const val ACTION_CONTINUE = "com.qcy.lingdaily.CONTINUE"

        /** Latest unfinished rehearsal, unless a newer attempt at the same scenario was already completed. */
        fun unfinished(sessions: List<PracticeSession>): PracticeSession? = sessions.firstOrNull { session ->
            session.isAI && session.phase != PracticeSession.Phase.COMPLETED && sessions.none {
                it.scenario.id == session.scenario.id && it.phase == PracticeSession.Phase.COMPLETED && it.updatedAt > session.updatedAt
            }
        }

        /** Redraws every placed widget; called when the app leaves the screen. */
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, PracticeWidget::class.java))
            if (ids.isNotEmpty()) PracticeWidget().onUpdate(context, manager, ids)
        }
    }
}
