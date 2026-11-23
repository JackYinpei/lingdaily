package com.qcy.lingdaily.app

import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeStep

/** Bundled offline fallback; mirrors the same ids and personas in app/lib/ios/scenarioCatalog.js. */
object ScenarioLibrary {
    val deadline = PracticeScenario(
        id = "deadline", title = "把延期说清楚", subtitle = "向同事争取两天时间", category = "职场", symbol = "calendar",
        partner = "Alex", partnerRole = "你的项目同事",
        setting = "周三下午。你负责的新版注册页原定周五上线，页面已经做完，但今天测试发现部分安卓手机收不到验证码，修复加回归测试大约还要两天。你想和 Alex 把上线改到下周一，并承诺周五先给一个可以演示的版本。",
        steps = listOf(
            PracticeStep("explain", "说明情况", "Hey, how is the sign-up page coming along? Are we still on track for Friday?", "注册页进展怎么样？周五还能按时上线吗？", "先说页面已经做完，再说测试发现了验证码的问题。", "almost done · found a bug · verification code", "The page is almost done, but testing found a bug: some Android users can't get the verification code.", "页面差不多做完了，但测试发现一个问题：部分安卓用户收不到验证码。"),
            PracticeStep("request", "提出请求", "Oh no. How much more time do you need to fix it?", "糟糕。修好它还需要多久？", "说出需要两天，再用商量的语气提出改到周一。", "two more days · would it be possible · Monday", "I need about two more days to fix and test it. Would it be possible to move the launch to Monday?", "我大概还需要两天来修复和测试。可以把上线改到周一吗？"),
            PracticeStep("plan", "给出方案", "Monday could work. How can we make sure everything is ready by then?", "周一也许可以。我们怎么确保到时一切准备好？", "提出周五先给演示版，让对方知道你有计划。", "working demo · Friday · final version", "I'll share a working demo on Friday and have the final version ready by Monday.", "我周五先给一个能演示的版本，周一准备好最终版。"),
        ),
        persona = "在意按期上线的同事，语速快、讲效率，会追问能不能先上一部分",
    )

    val hotel = PracticeScenario(
        id = "hotel", title = "入住出了点小状况", subtitle = "把问题变成可商量的方案", category = "旅行", symbol = "suitcase.rolling",
        partner = "Jamie", partnerRole = "酒店前台",
        setting = "你提前预订了安静的房间，入住后却发现房间临街。现在回到前台，试着说明问题并商量一个解决方案。",
        steps = listOf(
            PracticeStep("issue", "说明问题", "Welcome back! Is everything okay with your room?", "欢迎回来！房间还好吗？", "礼貌地描述问题，不必一开始就道歉。", "a bit noisy · facing the street", "The room is a bit noisy because it's facing the street.", "房间临街，所以有点吵。"),
            PracticeStep("alternative", "询问选择", "I'm sorry about that. What would you prefer?", "不好意思。你更希望换成什么样的房间？", "问问有没有更安静的房间。", "available · quieter room", "Do you have a quieter room available?", "还有更安静的房间吗？"),
            PracticeStep("confirm", "确认安排", "We have a room on the top floor. It will be ready in about an hour.", "顶楼还有一间，大约一小时后可以入住。", "接受方案，并确认行李怎么处理。", "that works · leave my luggage", "That works for me. Could I leave my luggage here while I wait?", "这样可以。等候的时候能把行李放在这里吗？"),
        ),
        persona = "客气但手里没有空房的前台，说话标准礼貌，先强调已经按你的预订安排",
    )

    val introduction = PracticeScenario(
        id = "introduction", title = "接住面试的追问", subtitle = "让经历有一个清楚的重点", category = "职场", symbol = "person.crop.rectangle",
        partner = "Taylor", partnerRole = "面试官",
        setting = "一场轻松的练习面试，你要介绍一次团队合作。可以讲自己的真实经历，也可以用这个：去年你在 5 人小组里负责推进一个活动报名小程序，上线前两周需求突然变了，你把任务拆成小块、每天同步进度，最后按时上线。",
        steps = listOf(
            PracticeStep("intro", "介绍经历", "Could you tell me about a project you enjoyed working on?", "能介绍一个你喜欢参与的项目吗？", "选择一件具体的事情，说明你的角色。", "worked on · responsible for", "I worked on a small team, and I was responsible for keeping the project on track.", "我在一个小团队里，负责确保项目按计划推进。"),
            PracticeStep("challenge", "回应追问", "What was the biggest challenge, and how did you handle it?", "最大的挑战是什么？你是怎么处理的？", "先说问题，再说你采取的行动。", "main challenge · requirements changed · broke it down", "The main challenge was that the requirements changed two weeks before launch, so I broke the work down into smaller tasks.", "主要挑战是上线前两周需求变了，所以我把工作拆成了更小的任务。"),
            PracticeStep("lesson", "总结收获", "What would you do differently next time?", "下一次你会做出什么不同的选择？", "说一个具体改进，不必否定自己。", "next time · communicate earlier", "Next time, I'd communicate potential delays earlier so the team can plan ahead.", "下次我会更早沟通可能的延期，让团队提前安排。"),
        ),
        persona = "专业友善的面试官，节奏稳，会追问细节和你具体做了什么",
    )

    val coffee = PracticeScenario(
        id = "coffee", title = "点单，多一点变化", subtitle = "当你想要的选项暂时没有", category = "日常", symbol = "cup.and.saucer",
        partner = "Sam", partnerRole = "咖啡师",
        setting = "你想点一杯燕麦奶拿铁，不过今天有个小变化。试着问清楚有哪些选择，再完成点单。",
        steps = listOf(
            PracticeStep("order", "表达需要", "Hi there! What can I get for you today?", "你好！今天想喝点什么？", "礼貌地说出饮品和偏好。", "could I get · oat milk", "Could I get a small latte with oat milk, please?", "请给我一小杯燕麦奶拿铁，可以吗？"),
            PracticeStep("change", "应对变化", "We're out of oat milk today. Would you like something else?", "今天燕麦奶没有了。想换一种吗？", "先问问有哪些其他选择。", "other options · available", "What other milk options do you have available?", "你们还有哪些其他奶类可以选择？"),
            PracticeStep("finish", "完成点单", "We have soy milk and regular milk. Would either of those work?", "我们有豆奶和普通牛奶，这两种有合适的吗？", "选一种，并补充堂食或外带。", "soy milk · to go", "Soy milk would be great. Could I have it to go?", "豆奶就很好。可以帮我做成外带吗？"),
        ),
        persona = "二十出头的兼职生，早高峰一个人顶班。说话快，爱说 \"Sure thing\" \"Gotcha\"，忙中会让你等一下，但真心想帮你找替代",
    )

    val all = listOf(deadline, hotel, introduction, coffee)
}
