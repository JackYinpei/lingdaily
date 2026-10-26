import { z } from 'zod'
import { SCENARIO_CATEGORIES } from './practice'

// Built-in rehearsals served to the app by GET /api/ios/scenarios, so new ones ship
// without an App Store release. The first four mirror the app's bundled fallback
// (ios/.../ScenarioLibrary.swift); keep their ids, which sessions and colours reference.
// Partner names are gender-neutral and each has its own Live voice (see ../ios/live.js).
export const SCENARIO_CATALOG_VERSION = 2

const step = (id, goal, prompt, translation, hint, keywords, expression, meaning) =>
  ({ id, goal, prompt, translation, hint, keywords, expression, meaning })

export const SCENARIO_CATALOG = Object.freeze([
  {
    id: 'deadline', title: '把延期说清楚', subtitle: '向同事争取两天时间', category: '职场', symbol: 'calendar',
    partner: 'Alex', partnerRole: '你的项目同事',
    setting: '周三下午。你负责的新版注册页原定周五上线，页面已经做完，但今天测试发现部分安卓手机收不到验证码，修复加回归测试大约还要两天。你想和 Alex 把上线改到下周一，并承诺周五先给一个可以演示的版本。',
    steps: [
      step('explain', '说明情况', 'Hey, how is the sign-up page coming along? Are we still on track for Friday?', '注册页进展怎么样？周五还能按时上线吗？', '先说页面已经做完，再说测试发现了验证码的问题。', 'almost done · found a bug · verification code', 'The page is almost done, but testing found a bug: some Android users can\'t get the verification code.', '页面差不多做完了，但测试发现一个问题：部分安卓用户收不到验证码。'),
      step('request', '提出请求', 'Oh no. How much more time do you need to fix it?', '糟糕。修好它还需要多久？', '说出需要两天，再用商量的语气提出改到周一。', 'two more days · would it be possible · Monday', 'I need about two more days to fix and test it. Would it be possible to move the launch to Monday?', '我大概还需要两天来修复和测试。可以把上线改到周一吗？'),
      step('plan', '给出方案', 'Monday could work. How can we make sure everything is ready by then?', '周一也许可以。我们怎么确保到时一切准备好？', '提出周五先给演示版，让对方知道你有计划。', 'working demo · Friday · final version', 'I\'ll share a working demo on Friday and have the final version ready by Monday.', '我周五先给一个能演示的版本，周一准备好最终版。'),
    ],
  },
  {
    id: 'hotel', title: '入住出了点小状况', subtitle: '把问题变成可商量的方案', category: '旅行', symbol: 'suitcase.rolling',
    partner: 'Jamie', partnerRole: '酒店前台',
    setting: '你提前预订了安静的房间，入住后却发现房间临街。现在回到前台，试着说明问题并商量一个解决方案。',
    steps: [
      step('issue', '说明问题', 'Welcome back! Is everything okay with your room?', '欢迎回来！房间还好吗？', '礼貌地描述问题，不必一开始就道歉。', 'a bit noisy · facing the street', 'The room is a bit noisy because it\'s facing the street.', '房间临街，所以有点吵。'),
      step('alternative', '询问选择', 'I\'m sorry about that. What would you prefer?', '不好意思。你更希望换成什么样的房间？', '问问有没有更安静的房间。', 'available · quieter room', 'Do you have a quieter room available?', '还有更安静的房间吗？'),
      step('confirm', '确认安排', 'We have a room on the top floor. It will be ready in about an hour.', '顶楼还有一间，大约一小时后可以入住。', '接受方案，并确认行李怎么处理。', 'that works · leave my luggage', 'That works for me. Could I leave my luggage here while I wait?', '这样可以。等候的时候能把行李放在这里吗？'),
    ],
  },
  {
    id: 'introduction', title: '接住面试的追问', subtitle: '让经历有一个清楚的重点', category: '职场', symbol: 'person.crop.rectangle',
    partner: 'Taylor', partnerRole: '面试官',
    setting: '一场轻松的练习面试，你要介绍一次团队合作。可以讲自己的真实经历，也可以用这个：去年你在 5 人小组里负责推进一个活动报名小程序，上线前两周需求突然变了，你把任务拆成小块、每天同步进度，最后按时上线。',
    steps: [
      step('intro', '介绍经历', 'Could you tell me about a project you enjoyed working on?', '能介绍一个你喜欢参与的项目吗？', '选择一件具体的事情，说明你的角色。', 'worked on · responsible for', 'I worked on a small team, and I was responsible for keeping the project on track.', '我在一个小团队里，负责确保项目按计划推进。'),
      step('challenge', '回应追问', 'What was the biggest challenge, and how did you handle it?', '最大的挑战是什么？你是怎么处理的？', '先说问题，再说你采取的行动。', 'main challenge · requirements changed · broke it down', 'The main challenge was that the requirements changed two weeks before launch, so I broke the work down into smaller tasks.', '主要挑战是上线前两周需求变了，所以我把工作拆成了更小的任务。'),
      step('lesson', '总结收获', 'What would you do differently next time?', '下一次你会做出什么不同的选择？', '说一个具体改进，不必否定自己。', 'next time · communicate earlier', 'Next time, I\'d communicate potential delays earlier so the team can plan ahead.', '下次我会更早沟通可能的延期，让团队提前安排。'),
    ],
  },
  {
    id: 'coffee', title: '点单，多一点变化', subtitle: '当你想要的选项暂时没有', category: '日常', symbol: 'cup.and.saucer',
    partner: 'Sam', partnerRole: '咖啡师',
    setting: '你想点一杯燕麦奶拿铁，不过今天有个小变化。试着问清楚有哪些选择，再完成点单。',
    steps: [
      step('order', '表达需要', 'Hi there! What can I get for you today?', '你好！今天想喝点什么？', '礼貌地说出饮品和偏好。', 'could I get · oat milk', 'Could I get a small latte with oat milk, please?', '请给我一小杯燕麦奶拿铁，可以吗？'),
      step('change', '应对变化', 'We\'re out of oat milk today. Would you like something else?', '今天燕麦奶没有了。想换一种吗？', '先问问有哪些其他选择。', 'other options · available', 'What other milk options do you have available?', '你们还有哪些其他奶类可以选择？'),
      step('finish', '完成点单', 'We have soy milk and regular milk. Would either of those work?', '我们有豆奶和普通牛奶，这两种有合适的吗？', '选一种，并补充堂食或外带。', 'soy milk · to go', 'Soy milk would be great. Could I have it to go?', '豆奶就很好。可以帮我做成外带吗？'),
    ],
  },
  {
    id: 'flight', title: '航班取消了', subtitle: '改签到明天最早一班', category: '旅行', symbol: 'airplane',
    partner: 'Jordan', partnerRole: '机场柜台工作人员',
    setting: '晚上 8 点，你在机场得知飞往上海的航班因天气取消。你明早 10 点在上海有一个重要会议，想改签到明天最早的航班，并问清楚今晚的住宿怎么安排。',
    steps: [
      step('situation', '说明情况', 'Hi, how can I help you tonight?', '你好，今晚有什么可以帮你的？', '说航班取消了，你明天一早必须赶到上海。', 'was cancelled · need to be in Shanghai · tomorrow morning', 'My flight to Shanghai was cancelled, and I need to be there for a meeting at 10 tomorrow morning.', '我飞上海的航班取消了，我明早 10 点要在那边开会。'),
      step('rebook', '争取改签', 'I\'m sorry about that. The next available seat is on the 2 p.m. flight tomorrow.', '很抱歉。最近一班有座位的是明天下午两点。', '说下午太晚了，问有没有更早的航班，候补也可以。', 'too late · an earlier flight · waiting list', 'That\'s too late for me. Is there an earlier flight, or could you put me on the waiting list?', '那对我来说太晚了。有没有更早的航班，或者能帮我排候补吗？'),
      step('hotel', '问清安排', 'I can put you on the waiting list for the 7 a.m. flight. Is there anything else I can help with?', '我可以帮你排早上 7 点那班的候补。还有什么需要帮忙的吗？', '问今晚住哪里，航空公司是否安排酒店。', 'a hotel for tonight · does the airline cover', 'Thank you. Does the airline cover a hotel for tonight?', '谢谢。航空公司会安排今晚的酒店吗？'),
    ],
  },
  {
    id: 'pharmacy', title: '在药店说清症状', subtitle: '买到白天也能吃的药', category: '日常', symbol: 'cross.case',
    partner: 'Casey', partnerRole: '药剂师',
    setting: '你在国外出差，昨晚开始喉咙痛、有点发烧，今天白天还要开会。你走进酒店附近的药店，想说清症状，买到吃了不犯困的药，并问清楚怎么吃。',
    steps: [
      step('symptoms', '描述症状', 'Hi there, what can I help you with today?', '你好，今天需要什么帮助？', '说喉咙痛、有点发烧，从昨晚开始。', 'a sore throat · a slight fever · since last night', 'I\'ve had a sore throat and a slight fever since last night.', '我从昨晚开始喉咙痛，还有点发烧。'),
      step('needs', '说明需要', 'I see. Do you have any allergies, or are you taking any other medicine?', '明白了。你有过敏吗？或者正在吃别的药吗？', '说没有过敏，再说白天要开会，希望吃了不犯困。', 'no allergies · won\'t make me drowsy', 'No allergies. I have meetings all day, so I need something that won\'t make me drowsy.', '没有过敏。我一整天都要开会，需要吃了不会犯困的药。'),
      step('dosage', '确认用法', 'This one should help, and it won\'t make you sleepy.', '这个应该有用，而且不会让你犯困。', '问一天吃几次，饭前还是饭后。', 'how many times a day · before or after meals', 'Great. How many times a day should I take it, and before or after meals?', '好的。一天吃几次？饭前还是饭后？'),
    ],
  },
  {
    id: 'repair', title: '请房东来修水龙头', subtitle: '约一个你在家的时间', category: '日常', symbol: 'wrench.and.screwdriver',
    partner: 'Morgan', partnerRole: '你的房东',
    setting: '你租的公寓里，厨房水龙头已经漏水三天，晚上滴水声吵得你睡不好。你给房东 Morgan 打电话，想说明问题，请对方这周内派人维修，并约一个你在家的时间（你周四下午两点后在家）。',
    steps: [
      step('problem', '说明问题', 'Hi, it\'s Morgan. You said something needed fixing?', '你好，我是 Morgan。你说有东西需要修？', '说厨房水龙头漏水三天了，晚上还很吵。', 'the kitchen tap · has been leaking · keeps me up', 'Yes, the kitchen tap has been leaking for three days, and the dripping keeps me up at night.', '是的，厨房水龙头漏水三天了，晚上滴水声吵得我睡不着。'),
      step('ask', '提出请求', 'Oh, sorry to hear that. I can ask a plumber to take a look.', '哎，真抱歉。我可以找个水管工去看看。', '请对方尽快安排，最好这周内。', 'as soon as possible · this week', 'Thanks. Could you send someone as soon as possible, ideally this week?', '谢谢。能尽快派人来吗？最好这周内。'),
      step('time', '约好时间', 'Sure. When are you usually home?', '没问题。你一般什么时候在家？', '给出具体时间：周四下午两点以后。', 'on Thursday · after 2 p.m. · would that work', 'I\'m home on Thursday after 2 p.m. Would that work for the plumber?', '我周四下午两点以后在家。水管工那时方便吗？'),
    ],
  },
  {
    id: 'meeting', title: '会上提出不同意见', subtitle: '礼貌地建议先小范围试用', category: '职场', symbol: 'person.2',
    partner: 'Riley', partnerRole: '产品经理',
    setting: '周一的产品例会上，Riley 提议下个月把新功能直接推给所有用户。你担心还没做过小范围测试，出问题会影响很多人。你想礼貌地表达不同意见，建议先给 10% 的用户试用两周。',
    steps: [
      step('concern', '表达顾虑', 'So I\'m thinking we launch the new feature to all users next month. Any thoughts?', '我打算下个月把新功能推给所有用户。大家怎么看？', '先肯定这个想法，再说出还没测试过的担心。', 'I like the idea · a bit worried · haven\'t tested', 'I like the idea, but I\'m a bit worried because we haven\'t tested it with real users yet.', '我喜欢这个想法，但有点担心，因为我们还没让真实用户试过。'),
      step('proposal', '提出建议', 'Fair point. What would you suggest instead?', '有道理。那你有什么建议？', '建议先给 10% 的用户试用两周。', 'how about · start with · 10% of users', 'How about we start with 10% of users for two weeks and see how it goes?', '我们先给 10% 的用户用两周，看看效果怎么样？'),
      step('agree', '达成共识', 'That could slow us down a little. How would we decide when to go wider?', '这样可能会慢一点。我们怎么决定什么时候扩大范围？', '给一个明确的判断标准，比如反馈和使用数据。', 'if the feedback is good · roll it out · to everyone', 'If the feedback and usage numbers look good after two weeks, we can roll it out to everyone.', '如果两周后反馈和使用数据都不错，我们就推给所有人。'),
    ],
  },
  {
    id: 'neighbor', title: '和新邻居聊几句', subtitle: '从打招呼到约早餐', category: '社交', symbol: 'house',
    partner: 'Avery', partnerRole: '刚搬来的邻居',
    setting: '周六上午，你在电梯里遇到刚搬到隔壁的 Avery。你想打个招呼、简单介绍自己（你在这里住了两年），推荐街角那家早餐店，再约对方明天一起去。',
    steps: [
      step('hello', '打个招呼', 'Hi! I think I just moved in next door. I\'m Avery.', '你好！我好像刚搬到你隔壁。我叫 Avery。', '欢迎对方，说你的名字和在这里住了多久。', 'welcome to the building · I\'ve lived here for', 'Welcome to the building! I\'m Lin, and I\'ve lived here for about two years.', '欢迎入住！我叫林，在这里住了大概两年。'),
      step('recommend', '推荐地方', 'Nice to meet you! Do you know any good places to eat around here?', '很高兴认识你！附近有什么好吃的地方吗？', '推荐街角的早餐店，说说它好在哪里。', 'there\'s a great · around the corner · fresh', 'There\'s a great breakfast place around the corner. Their buns are fresh every morning.', '街角有家很棒的早餐店，他们的包子每天早上都是现做的。'),
      step('invite', '发出邀请', 'That sounds amazing. I\'d love to try it.', '听起来太棒了。我很想去试试。', '约对方明天早上一起去。', 'would you like to · tomorrow morning · together', 'Would you like to go together tomorrow morning? I can show you the way.', '明天早上要不要一起去？我可以带你过去。'),
    ],
  },
  {
    id: 'restaurant', title: '点餐时说清过敏', subtitle: '确认菜里没有花生', category: '旅行', symbol: 'fork.knife',
    partner: 'Quinn', partnerRole: '餐厅服务员',
    setting: '你在伦敦的一家餐厅吃晚饭，你对花生过敏。你想请服务员推荐一道菜，确认里面没有花生，再请厨房把酱汁单独放。',
    steps: [
      step('order', '请对方推荐', 'Good evening! Are you ready to order?', '晚上好！可以点餐了吗？', '请服务员推荐一道招牌菜。', 'what would you recommend', 'Yes. What would you recommend today?', '可以了。今天有什么推荐的？'),
      step('allergy', '说明过敏', 'Our grilled chicken with curry sauce is very popular.', '我们的咖喱酱烤鸡很受欢迎。', '说你对花生过敏，问酱汁里有没有花生。', 'allergic to peanuts · does it contain', 'That sounds good, but I\'m allergic to peanuts. Does the sauce contain any?', '听起来不错，但我对花生过敏。酱汁里有花生吗？'),
      step('request', '提出要求', 'Let me check with the kitchen. It may contain peanut oil.', '我去问一下厨房。里面可能有花生油。', '请厨房不用花生油，并把酱汁单独放。', 'without peanut oil · on the side', 'Could the kitchen make it without peanut oil and put the sauce on the side?', '能请厨房不用花生油，并把酱汁单独放吗？'),
    ],
  },
])

const field = max => z.string().trim().min(1).max(max)
export const catalogScenarioSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).refine(id => !id.startsWith('custom-') && !id.startsWith('today-')),
  title: field(30), subtitle: field(60), category: z.enum(SCENARIO_CATEGORIES), symbol: field(60),
  partner: field(40), partnerRole: field(40), setting: field(400),
  steps: z.array(z.object({
    id: field(40), goal: field(20), prompt: field(300), translation: field(300), hint: field(200),
    keywords: field(120), expression: field(300), meaning: field(300),
  }).strict()).length(3),
}).strict()
