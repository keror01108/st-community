// Community Feed for SillyTavern
// Generates fake community posts (Naver Cafe, DCInside, Reddit, X, 2ch, Weibo, Tieba)
// reacting to the current chat, either as a "work" (readers) or as a "world" (inhabitants).
// The player can post / comment (as a bystander or as {{user}}) and get reactions,
// continue threads, load more posts, edit every prompt, and pick any output language.

const MODULE = 'st_community';
const INJECT_KEY = 'st_community_pins';
const MAX_THREAD_ITEMS_IN_PROMPT = 60;

// extension_prompt_types / roles are not exported via getContext(); values from script.js
const PROMPT_IN_CHAT = 1;
const ROLE_SYSTEM = 0;

const defaultSettings = Object.freeze({
    profileId: '',               // '' main API · ST connection profile id · 'api:<id>' an API added in the panel
    customApis: [],              // [{ id, name, kind: openai|claude|google, url, key, model }]
    modelOverrides: {},          // ST profile id → model used for community generation
    language: 'native',          // 'native' | a language name (English) | 'custom'
    customLanguage: '',
    translateTo: '',             // '' (off) | a language name | 'custom'
    customTranslate: '',
    postCount: 4,
    commentCount: 5,
    continueCount: 5,
    contextMessages: 20,
    storyMsgChars: 1500,         // story log: longest part of one chat message sent (0 = no limit)
    tailEnabled: false,          // 맨 밑 프롬프트: one more message at the very end of every request
    tailRole: 'user',            // 'user' | 'assistant'
    npcPosts: 'auto',
    mentionScope: 'all',         // 언급 범위: all | char (only {{char}}) | user (only {{user}}) | none (nobody from the story)
    customSpaces: [],            // [{ id, platform, name, desc, locale: { mode: inherit|story|country|custom, country, custom } }]
    spaceSelected: {},           // platform → space id ('' = 기본)
    nickMode: 'random',          // empty nickname box: 'random' (instant, community style) · 'ai' (fits the person and the post)
    minReasoning: false,         // ask reasoning models to think as little as possible            // story side characters posting themselves: auto | on | off
    translateConn: '',           // '' = translate in the same call · 'main' · ST profile id · 'api:<id>'
    translateModel: '',          // model for that translation connection ('' = the connection's own model)
    translateWhen: 'auto',       // 'auto' = with every generation · 'manual' = only from a post's 번역 button
    trDisplay: 'replace',        // 'replace' = translation instead of the original · 'both' = original above, translation below
    extMemory: true,             // read memory / summaries other extensions inject (Memoria, VectFox, …)
    extMemoryChoice: {},         // injection key → true/false (unset: memory-looking keys on, others off)
    extMemoryMax: 8000,
    maxTokens: 4000,
    includeCard: true,
    // Tags whose whole block (tag + content) is removed from chat messages before they reach the community prompt
    excludeTags: 'status, statusbar, status_bar, status-bar, statusblock, statuspanel, state, stats, hud, infobar, info_bar, details, UpdateVariable, update_variable, variable, variables, vars, mvu, thinking, think, reasoning, analysis, cot, options, choices, 상태창, 상태, 状态栏, 状态, 变量更新',
    excludeSkipNarrator: true,   // also skip narrator / system notes (/sys)
    includeWorldInfo: true,      // default WI mode for new chats: true → auto, false → off
    wiMaxChars: 12000,
    autoEnabled: false,          // new posts / threads every N AI replies
    autoEvery: 5,
    autoReplyEnabled: false,     // new comments / reses on watched posts every N AI replies
    autoReplyEvery: 1,
    autoReplyMax: 2,             // watched posts continued per turn (round-robin)
    autoWatchNew: false,         // posts made by automatic generation are watched right away
    crossRef: false,             // let every generation see other recent posts of the same community
    crossRefCount: 6,
    autoPlatform: 'last',        // last | random | <platform id>
    pinDepth: 4,
    extraInstruction: '',
    defaultMode: 'meta',         // meta | world
    defaultPlatform: 'naver',
    prompts: {},                 // user overrides of DEFAULT_PROMPTS
    stores: {},                  // feed file index: storeId → { chat, owner, size, deletedAt }
    topics: '공포: 괴담, 무서운 경험담, 미스터리\n낚시: 어그로성 제목, 반전 있는 낚시글\n웃음: 웃긴 썰, 드립, 짤 설명\n연애: 연애 상담, 썸, 이별, 짝사랑\n고민: 인생·학교·직장 고민 상담\n정보: 정보 공유, 꿀팁, 후기\n질문: 궁금한 거 물어보는 글\n썰: 경험담, 목격담\n논쟁: 의견 대립, 키배 유발 주제',
    topicSelected: [],           // names of selected topics
    topicRenames: {},            // old topic name → [{ to: new name, at: when renamed }] (boards made before keep showing)
    topicMix: 'each',            // each: assign one topic per post | mix: let the model mix them
    topicScope: 'all',           // all: manual + auto generation | auto: auto generation only
    threadCap: 1000,             // max posts per thread on capped platforms (2ch, Reddit)
    theme: 'theme',              // light | dark | theme (follow SillyTavern theme)
    compactUi: false,
    secOpen: { conn: true },
    maxFeeds: 0,                 // feeds kept per chat (0 = no limit); pinned / watched feeds are never dropped     // settings sections left open (key → true)
    fullscreen: false,           // panel fills the whole window (PC; phones are always full)            // 간략한 화면: community/space/board in one picker, some header buttons in ⋯
    foldPrefs: {},               // { short?: bool, tall?: bool } — unset: folded on short screens only
});

// Languages shown in the selectors. Value = English name used in prompts.
const LANGUAGES = [
    ['Korean', '한국어'],
    ['English', '영어'],
    ['Japanese', '일본어'],
    ['Simplified Chinese', '중국어 (간체)'],
    ['Traditional Chinese', '중국어 (번체)'],
    ['Spanish', '스페인어'],
    ['Russian', '러시아어'],
    ['French', '프랑스어'],
    ['German', '독일어'],
    ['Portuguese (Brazilian)', '포르투갈어 (브라질)'],
    ['Italian', '이탈리아어'],
    ['Vietnamese', '베트남어'],
    ['Thai', '태국어'],
    ['Indonesian', '인도네시아어'],
    ['Turkish', '튀르키예어'],
    ['Arabic', '아랍어'],
    ['Polish', '폴란드어'],
    ['Ukrainian', '우크라이나어'],
    ['Hindi', '힌디어'],
];

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------
const PLATFORMS = {
    naver: { name: 'Naver Cafe', brand: false, label: '네이버 카페', icon: 'fa-mug-hot', lang: 'Korean', anon: '익명', now: '방금 전', thread: false, hasTitle: true },
    dcinside: { name: 'DCInside', brand: false, label: '디시인사이드', icon: 'fa-ghost', lang: 'Korean', anon: 'ㅇㅇ', now: '방금', thread: false, hasTitle: true },
    reddit: { name: 'Reddit', brand: true, label: 'Reddit', icon: 'fa-reddit-alien', lang: 'English', anon: 'throwaway', now: 'just now', thread: false, hasTitle: true, capped: true },
    twitter: { name: 'X (Twitter)', brand: true, label: 'X (트위터)', icon: 'fa-x-twitter', lang: 'the language most natural for the story setting and its fandom (if unclear, Korean)', anon: 'user', now: 'now', thread: false, hasTitle: false },
    fivech: { name: '2channel / 5channel', brand: false, label: '2ch / 5ch', icon: 'fa-hashtag', lang: 'Japanese', anon: '名無しさん', now: null, thread: true, hasTitle: true, capped: true, flat: true },
    weibo: { name: 'Sina Weibo', brand: true, label: '웨이보', icon: 'fa-weibo', lang: 'Simplified Chinese', anon: '微博用户', now: '刚刚', thread: false, hasTitle: false },
    discord: { name: 'Discord', brand: true, label: '디스코드', icon: 'fa-discord', lang: 'the language most natural for the story setting and its fandom (if unclear, Korean)', anon: 'user', now: '오늘', thread: false, hasTitle: false, flat: true, chat: true },
    tdgall: { name: '투디갤 (tdgall.com)', brand: false, label: '투디갤', icon: 'fa-snowflake', lang: 'Korean', anon: 'ㅇㅇ', now: '방금', thread: false, hasTitle: true },
    kkangtong: { name: '깡통 (Korean AI-chat community)', brand: false, label: '깡통', icon: 'fa-robot', lang: 'Korean', anon: '깡', now: '방금', thread: false, hasTitle: true },
    blind: { name: 'Blind (Korean anonymous workplace community)', brand: false, label: '블라인드', icon: 'fa-user-secret', lang: 'Korean', anon: '회사 비공개', now: '방금', thread: false, hasTitle: true },
    everytime: { name: 'Everytime (Korean university community)', brand: false, label: '에브리타임', icon: 'fa-graduation-cap', lang: 'Korean', anon: '익명', now: '방금', thread: false, hasTitle: true },
    tieba: { name: 'Baidu Tieba', brand: false, label: '바이두 티에바', icon: 'fa-paw', lang: 'Simplified Chinese', anon: '匿名用户', now: '刚刚', thread: true, hasTitle: true },
};

const MODES = {
    meta: { label: '작품 반응', icon: 'fa-book-open' },
    world: { label: '세계관 속', icon: 'fa-earth-asia' },
};

// ---------------------------------------------------------------------------
// Prompt templates (model-facing → English). Users can override each one.
// Variables: {{char}} {{user}} {{platform}} {{language}} {{translation}} {{count}} {{comments}}
// ---------------------------------------------------------------------------
const DEFAULT_PROMPTS = {
    system: `You are an expert simulator of online communities. You write realistic, lively, varied posts and comments exactly as they would appear on {{platform}}. You follow the requested JSON format strictly. This is fiction; write freely in the platform's authentic voice, but do not produce slurs or real-person defamation.`,

    mode_meta: `MODE: READER COMMUNITY (META).
Treat the story above as a serialized work of fiction (web novel / webtoon / ongoing serial) that the public reads as it updates. The most recent messages are the newest episode. {{user}} is the protagonist and {{char}} a main character.
- Readers/fans react to the latest developments: hype, screaming, theories and predictions, character analysis, shipping, favorite lines, complaints about pacing or plot, memes, jokes, fan art or fanfic mentions, arguments between fans, lurkers, newcomers asking questions.
- Readers know everything shown in the story so far, and nothing beyond it. They may misremember details or speculate wildly.
- Vary sentiment and opinions; include at least one dissenting or critical voice.
- Readers do not exist inside the story and cannot affect it.`,

    mode_world: `MODE: IN-WORLD COMMUNITY.
Treat the story's setting as a real world in which {{platform}} (or its in-world equivalent) exists. Write posts by ordinary inhabitants of this world.
- Most posts are everyday life in this world: local news, gossip, complaints, hobbies, school/work, food, events, weather, trends — all consistent with the setting's culture, era, geography, factions and technology.
- About one third of the posts (at least one) should involve {{char}} and/or {{user}} INDIRECTLY: acquaintances, coworkers, classmates, family friends, neighbors, fans, rivals, or strangers who witnessed them or heard rumors about recent events in the story.
- Posters only know what they could plausibly see or hear. Private scenes stay private, or appear only as vague or distorted rumors. Strangers usually do not know names; they describe appearance or behavior instead, unless the characters are publicly known.
- If the setting has no internet (e.g. medieval fantasy), keep this platform's format and culture but adapt usernames, slang and topics to the world (an in-world message board, magic crystal network, notice board, etc.).
- Nobody in this world knows they are in a story. Never mention readers, authors, chapters, or roleplay.`,

    topic_assign: `Each post must be about its assigned topic below. Interpret the topic in this platform's culture and in the context of this story/world, and let it decide the post's subject and tone (topic names and notes may be written in any language; follow their intent). The post still follows the mode rules above.
{{topics}}`,

    topic_mix: `Every post must be about one or more of these topics (mix them across the posts, interpreted in this platform's culture and in the context of this story/world; topic names and notes may be written in any language). The posts still follow the mode rules above.
{{topics}}`,

    thread_next: `The thread shown in <thread> has reached the {{cap}}-post limit and is now closed. Write ONE follow-up thread (part {{part}}) on the same board.
- Its title follows the platform's convention for continuation threads (2ch: the same title with "Part{{part}}" or "★{{part}}"; Reddit: the same title with "Part {{part}}", "[Continued]" or "Megathread #{{part}}").
- Its opening post mentions the previous thread naturally (2ch: a "前スレ" line and maybe a short recap or template; Reddit: "Previous thread:" and a short recap).
- It has {{count}} comments in which the regulars carry the conversation on from where the previous thread stopped; new posters may join.
Output exactly one post.`,

    player_write: `Write ONE {{kind}} for this platform on behalf of the author described below. The human player will review and post it.
Author: {{author}}
- Stay in the author's own voice. A story character writes with their own personality, knowledge, opinions and current situation as of the latest story messages, and only reveals what they would choose to reveal online.
- Follow the platform's culture, formatting and length conventions for a {{kind}}.
- If a draft is given, keep its intent and improve or expand it rather than replacing it with something unrelated.
Output ONLY a JSON object, no code fences: {"title": "post title, or empty when the platform has none / for comments", "body": "text, use \\n for line breaks"}`,

    cross_ref: `Other recent posts on this community are listed below for awareness. Posters may naturally mention, quote, link, compare or argue about them (e.g. "saw this in the other thread", "the OP of that post again"), but do not copy them and do not force references into every post.`,

    dm_continue: `<thread> is a private Discord DM conversation between {{me}} and {{partner}}. Write the next {{count}} messages FROM {{partnerName}} only, reacting to the latest messages (or opening the conversation naturally if it is empty). Several short consecutive messages are fine, like real chat. Do not write messages for the other side. {{partnerName}} only knows what they would plausibly know in the story, and speaks in their own voice. Set "author" to "{{partnerName}}" and "reply_to" to -1 unless replying to a specific earlier message.`,

    tail: '',
    inject_dm: `[Private Discord direct messages these people actually exchanged. Both sides remember them; let them shape knowledge, mood and dialogue when relevant. Nobody else has seen them unless shared.]`,

    amount_posts: `Write {{count}} posts. Each post has roughly {{comments}} comments (vary it: popular posts more, boring ones fewer). Add replies to some comments where natural, unless the platform style says otherwise.`,

    continue: `Continue the post/thread shown in <thread>. Write {{count}} NEW comments that naturally follow the existing ones, in chronological order. Earlier posters may come back with the same voice; new posters may join. React to the most recent comments first. Do not repeat or paraphrase earlier comments. Keep the platform's culture and the same mode rules.`,

    react_focus: `The player has just posted the item marked as the latest player item. Most of the new comments should respond to it directly (replying, agreeing, arguing, joking, asking follow-up questions, or misunderstanding it), but keep it natural for the platform; a few posters may ignore it.`,

    player_user: `Items marked [PLAYER as {{user}}] were written by the human player, posting as {{user}} under the nickname shown. Other posters only know what the post itself reveals about the author. In the in-world mode they may recognize {{user}} only if the content or nickname makes it obvious.`,

    player_char: `Items marked [CHARACTER: name] were written by that story character themself (the character named in the mark), under the nickname shown. The content reflects that character's own voice, knowledge and intentions. Other posters only know what the post itself reveals; they may or may not realize who wrote it. Characters writing now: {{name}}.`,

    player_mob: `Items marked [PLAYER] were written by the human player as an ordinary community member (a bystander, not a story character). Treat them like any other poster.`,

    language_native: `Write all posts and comments in {{language}}.`,

    language_fixed: `Write all posts and comments in {{language}}, while keeping the platform's culture, formatting and slang flavor, naturally adapted into {{language}}. Every word must be {{language}}: never mix in words, set phrases, slang or parenthetical originals from another language (for example no "绝了", "(原文)" or "姊妹快跑 (…)"); only personal names and brand names may stay as they are.`,
    language_foreign: `This is a {{language}}-localized version of {{platform}}, whose users normally write in {{native}}. The platform guide's example words, slang and emoji tags are written in {{native}} — never copy them; express the same nuance with natural {{language}} (emoji tags too, e.g. [눈물] or [tears] instead of [泪]). Do not borrow slang that belongs to {{language}}-speaking sites either (for Korean: 원덬, 덬, 글쓴덬, 갤러, 념글, 개추, ㅇㅇ and similar terms from Korean communities). Write the way a skilled translator would localize these posts, so it still reads as {{platform}} culture.`,

    npc_on: `Named side characters (NPCs) from the story — friends, family, classmates, coworkers, rivals and other people who appear in the story or the world information, but not {{char}} or {{user}} — DO use this community. Let one or two of them post or comment as themselves under fitting handles, in their own voice, knowing only what they would know. They may talk about {{char}}/{{user}} from their own point of view.`,
    only_char: `STRICT — ONLY {{char}}: posts and comments may mention and discuss {{char}} (what {{char}} did, said or seems like), but must not mention, name, describe, quote, impersonate or allude to {{user}} or any other character or person from the story or the world information — not by name, nickname, title, appearance, role or pronoun — and none of them posts or comments. Where the story involves {{user}} or others, talk about {{char}} alone and leave the other people out completely. This overrides every rule above that asks for anyone else.`,
    only_user: `STRICT — ONLY {{user}}: posts and comments may mention and discuss {{user}} (what {{user}} did, said or seems like), but must not mention, name, describe, quote, impersonate or allude to {{char}} or any other character or person from the story or the world information — not by name, nickname, title, appearance, role or pronoun — and none of them posts or comments. Where the story involves {{char}} or others, talk about {{user}} alone and leave the other people out completely. This overrides every rule above that asks for anyone else.`,
    no_mention: `STRICT — NO STORY PEOPLE: do not mention, name, describe, quote, impersonate or allude to {{char}}, {{user}}, or any other character or person from the story or the world information — not by name, nickname, title, appearance, role or pronoun — and none of them posts or comments. No post or comment is about them or about what they did. This overrides every rule above that asks for them. Instead write ordinary community content for this platform, mode and topic: in the reader mode, talk about the work only in general terms without its characters (updates, pacing, art or writing style, the fandom, unrelated chatter); in the in-world mode, everyday life, the setting, places, trends and happenings that involve no story characters.`,
    npc_off: `Named side characters (NPCs) from the story — anyone who appears in the story or the world information besides {{char}} and {{user}} — do NOT post or comment themselves. Every poster is an ordinary member with no name in the story; story characters may only be mentioned, rumored about or described by others.`,
    community_space: `COMMUNITY SPACE (made by the user): this happens in "{{space}}" on {{platform}}. About it: {{about}}
Set "board" to "{{space}}". Its members are the kind of people who would join it, and its culture, in-jokes and usual topics color every post and comment. Any chosen topics still decide each post's subject — seen through this community (e.g. a dating-advice post written by members of a game community).`,
    setting_country: `COMMUNITY LOCATION: this community's users live in {{country}}. They write as {{country}} users of this platform would — local culture, slang, places, prices and currency, school and work systems, time zone and trends. If the story is set somewhere else, they see its events from {{country}}: as foreign news, an imported or translated work, travel, or rumors that reached them online. If the story world is fictional, treat {{country}} as the real-world culture this community is modeled on.`,
    setting_custom: `COMMUNITY SETTING (given by the user): {{setting}}
Follow it for who the users are and where and when they live, even where it differs from the story's own setting.`,
    reasoning_min: `Answer right away. Do not think out loud, do not write a reasoning, analysis or <think> section, and do not plan step by step before answering — output only what is asked for.`,
    translate_separate: `Translate the "text" of every item into natural {{translation}}. Keep the tone, slang, emoji, line breaks (\n) and formatting such as >>12 anchors, #hashtags#, [emoji] tags and @mentions. Keep personal names as they are, or transliterate them only when that is how {{translation}} speakers would write them. If a text is already in {{translation}}, return "" for it. Reply with JSON only, in this exact shape: {"items":[{"id":0,"text":"..."}]}`,
    translation: `ALSO fill "body_tr" for every post and comment with a natural {{translation}} translation that keeps the tone and slang. If the original is already in {{translation}}, leave "body_tr" empty. Likewise fill "title_tr" with the translated post title (empty when the post has no title or the title is already in {{translation}}), and each "desc_tr" in "media" with the translated photo / video description (empty when it is already in {{translation}}).`,

    inject_authored: `[Online posts that story characters wrote themselves. Each name before "(posting as ...)" is the story character who actually wrote that post or comment on that community, and they remember doing it. Other lines are replies from other users, which those characters may have read. Let this shape the characters' knowledge, mood and dialogue when relevant (they may mention it, check the reactions, regret it, or be confronted about it by someone who saw it).]`,

    inject_world: `[Public online chatter currently circulating inside the story world. Characters may or may not have seen these posts. Use them only as background flavor, rumors, or plot hooks when natural; do not quote them unless a character is actually reading them.]`,

    inject_meta: `[Out-of-world reader reactions to the story so far. The characters are completely unaware of these. Treat them only as optional inspiration for pacing, tension, or ideas; never break the fourth wall.]`,

    format_posts: `OUTPUT FORMAT: Return ONLY a JSON object, with no code fences and no commentary, matching:
{
  "board": "community / board / subreddit / topic name",
  "posts": [
    {
      "author": "display name or nickname",
      "handle": "username, @id, IP fragment, or poster ID (may be empty)",
      "title": "post title (empty for X/Twitter and Weibo)",
      "title_tr": "",
      "body": "post text; use \\n for line breaks",
      "body_tr": "",
      "media": [ { "type": "photo", "desc": "", "desc_tr": "" } ],
      "time": "relative time as shown on the platform, written in the output language",
      "likes": 0, "views": 0, "shares": 0,
      "tags": ["optional flair / category / hashtag"],
      "comments": [
        {
          "author": "", "handle": "", "body": "", "body_tr": "", "time": "", "likes": 0,
          "replies": [ { "author": "", "handle": "", "body": "", "body_tr": "", "time": "", "likes": 0 } ]
        }
      ]
    }
  ]
}
Numbers must be plain integers. Escape double quotes inside strings. Every poster must feel like a distinct person with their own voice.
List the posts from oldest to newest: the last post in "posts" is the most recent one, and the "time" values fit that order.
"media" lists the photos, screenshots and videos attached to a post, in order. "type" is "photo" or "video"; "desc" describes what that photo or video shows in one or two short sentences in the output language, without brackets (e.g. a selfie, food, a street or scenery shot, a screenshot of a chat or article, fan art, merch, an evidence photo; for a video: what happens in the clip — a short fancam, a vlog moment, a funny clip, CCTV or dashcam footage). A post may have several (a photo dump, before/after shots, a few clips). Use an empty list when the post has no picture or video — add them where they suit the community and the post, not on every post. The body may refer to them ("사진 보셈", "pic related", "영상 ㄱㄱ").`,

    format_comments: `OUTPUT FORMAT: Return ONLY a JSON object, with no code fences and no commentary, matching:
{
  "comments": [
    { "reply_to": -1, "author": "", "handle": "", "body": "use \\n for line breaks", "body_tr": "", "time": "", "likes": 0 }
  ]
}
"reply_to" is the number N of an existing top-level comment [cN] that this comment replies under, or -1 for a new top-level comment. Numbers must be plain integers. Escape double quotes inside strings.`,

    guide_naver: `Naver Cafe (Korean fan/community cafe). Board name like "자유게시판", "후기게시판", "질문게시판". Nicknames are cute or hobby-related (e.g. 별빛고양이, 달달한우유). Tone: mostly polite Korean (해요체) mixed with casual reactions (ㅋㅋㅋ, ㅠㅠ, 헐). Posts have a title, body, view count, like count. Comments can have replies. Cafe culture: greetings, "정보 공유", long reviews, emotional support, mild disagreements.`,
    guide_dcinside: `DCInside gallery (Korean anonymous forum). Board name ends with "갤러리" (e.g. "XX 마이너 갤러리"). Many anonymous posters with nickname "ㅇㅇ" and a partial IP as handle (e.g. "118.235"), some fixed nicknames. Tone: blunt banmal, internet slang, sarcasm, short punchy titles, memes (ㅋㅋ, ㄹㅇ, 개추, 념글, ~노, ~누), mild swearing. Fights and trolling are common but no slurs or hate speech. Titles are short.`,
    guide_reddit: `Reddit. Board is a subreddit name (e.g. "r/NovelNameFans"). Usernames like u/throwaway_8812, u/SleepyOtter. Posts have a title, body (may include "EDIT:" lines), score (upvotes). Comments are threaded with replies; top comments are witty, analytical, or pun threads. Use Reddit culture: "this", "OP", "TIL", "/s", flairs in tags.`,
    guide_twitter: `X (Twitter). Set "board" to a trending hashtag or topic. Each post is a short tweet (under 280 characters), with display name and @handle, no title. Use hashtags, emoji, fandom slang, screaming caps, "RT if...", short threads. Metrics: likes, retweets (shares), views. Comments are replies to the tweet.`,
    guide_fivech: `2channel / 5channel (Japanese anonymous textboard). Each post object is one THREAD: "title" is the thread title (e.g. 【悲報】..., 【朗報】..., ○○について語るスレ Part3), "body" is the opener (>>1). Comments are the following replies in order (>>2, >>3...); the "replies" field must stay empty and "reply_to" must be -1 — reply with anchors like ">>1" or ">>5" in the body instead. Author is usually "名無しさん" (or a board-specific default name); "handle" is a random 8-character ID like "aB3dE9fG". Use 草, w, ワロタ, ガチ, kaomoji, light AA. Tone: cynical, joking, chaotic.`,
    guide_weibo: `Sina Weibo. Set "board" to a super-topic or trending topic (超话 / 热搜). Posts by bloggers with display names (e.g. 吃瓜群众小王), no title, using #话题# hashtags (with # on both sides), emoji like [doge] [允悲] [泪], words like 绝了, 磕到了, 破防了, 吃瓜, yyds. Metrics: likes, comments, reposts (shares). Comments may have replies.`,
    guide_discord: `Discord server. Set "board" to the server name (a fan server in reader mode, a local / guild / school / work server in the in-world mode). Each post object is one CHANNEL: "title" is the channel name without "#" (e.g. 잡담, 정보, 스포일러, 짤방, 공지, 오프라인), "body" is the first message of the shown chat log and "author" its sender. "comments" are the following chat messages in order — short, casual, fast, several messages in a row from the same person are normal; "replies" stays empty. Use "reply_to" to point at an earlier message only when someone uses Discord's reply. Usernames look like Discord display names; emoji, :custom_emoji:, @mentions, lowercase, typos, "ㅋㅋ", stickers described in brackets. "time" like "오늘 오후 3:12".`,
    guide_tdgall: `투디갤 (tdgall.com), a Korean anonymous community for 2D works — anime, manga, light novels, subculture/mobile games, webtoons — that split off from DCInside. Everyone posts anonymously: set "author" to "ㅇㅇ" and "handle" to a random 4-character code of letters/digits (e.g. "k7Qa"); a person keeps the same code inside one post. Put the board in tags[0]: one of 투디, 웹툰, 소설, 게임, AI, 괴담, 남극. Tone: casual banmal, fast fandom slang and chosung abbreviations (ㅋㅋ, ㅠㅠ, ㄹㅇ, ㄱㅊ), title prefixes such as ㅃ (off-topic chatter), ㅂㅎ (dislike post — replies agree rather than argue), ㅅㅍ (spoiler), ㅂㅇ (translation). Community words: 펭도리 (asking for a source or character name), 소주 (claiming a character as one's spouse), 자표, 갤메이저/갤마이너, 유입 (newcomer, treated warily). Typical posts: short reactions, questions, rants about creators or pacing, shipping, fan theories, recommendation requests. No real-person photos, doxxing or slurs.`,
    guide_kkangtong: `깡통, a Korean anonymous community about AI chatting and roleplay (mainly SillyTavern). Users share and discuss character bots (봇·캐릭터 카드), prompts and presets, Quick Replies (QR), extensions and scripts they built, NovelAI (NAI) image prompts and artist tags (작가 태그) for art styles, AI model and API news and tips, chat logs (로그), and chat about their favorite bots and characters (덕질). Everyone posts anonymously: a post's "author" is "깡". In comments, anonymous commenters are numbered in order of first appearance in that post — "깡1", "깡2", "깡3", … — and the same person keeps the same number in that post; the post's own writer appears as "글쓴 깡" (never a number). Leave "handle" empty. Only an official notice from the admins may use the author "운영깡". Put the board in tags[0]: one of 일반, 뉴스, 정보/팁, 로그, AI봇, 프롬프트, QR, 그림체, 음악, 자료, 확장, 질문, 추천/지식, 덕질, 제작/협업. Users call each other "깡" and add it to a role: 운영깡 (the admins), 제작깡 / 공유깡 (people who make and share bots, prompts or extensions), 너깡, 나깡, 질문깡, 로그깡 and so on (e.g. "제작깡 고마워", "나깡도 이거 씀"). Tone: casual banmal and 음슴체, ㅋㅋ, ㄹㅇ, gratitude to 제작깡, bug reports and fixes, model comparisons (Claude, Gemini, GPT, DeepSeek…), token and cost talk, sharing tips. In the reader-reaction mode, decide what the story is to these users from how it reads: it may be an AI chat log someone shared, or a novel, webtoon/manga, anime or game they are into — do not assume it is always a chat log. Users react to it as fans do, and may also connect it to their own AI chatting (making a bot of a character, prompts for that mood, NAI art of a scene, sharing their own logs). In the in-world mode, people living in the story world use 깡통 for their own AI chatting and talk about what is happening around them. Never mention, recommend or discuss RisuAI (리스 / 리수) in any way — this site does not cover it. Site rule: NEVER use ㅠㅠ / ㅜㅜ (or any ㅠ / ㅜ crying jamo) and NEVER use baby talk (애기어 — e.g. 고마워용, 해쪄, 넹, 웅웅, 했어염, 뿌잉, lisping or cutesy word endings); express feelings in plain words instead (e.g. "감동이다", "슬프네"). Rules like 투디갤: no real-person photos, no doxxing, no slurs, credit the 제작깡 when sharing their work.`,
    guide_blind: `Blind (블라인드), a Korean anonymous community for verified office workers. Everyone is anonymous, but each post and comment shows the writer's workplace: set "author" to the company or organization name only (e.g. "삼성전자", "네이버", "공무원", "스타트업", "대학병원" — use workplaces that fit the setting and the person; if the setting has no real companies, invent fitting in-world employers) and "handle" to a short random nickname code of 4–6 letters/digits (e.g. "kD8a2"). Put the topic channel in tags[0]: one of 블라블라, 회사생활, 이직·커리어, 연애, 결혼생활, 주식·투자, 부동산, 썸·연애, 육아, 여행, 고민 (or a company lounge like "○○ 라운지"). Tone: blunt, cynical office-worker Korean, often 음슴체/반말 (~함, ~임, ~인듯), salary and workload complaints, 연봉, 성과급, 야근, 팀장, 이직, workplace politics, relationship and marriage advice, comment fights ("ㄹㅇ", "부럽다", "어디 회사임?"). Comments by the post's writer show up as the same company. No real-person defamation, no slurs.`,
    guide_everytime: `Everytime (에브리타임), the Korean university students' anonymous community and timetable app. Set "board" to the school name (an in-world university if the setting needs one, e.g. "한빛대학교"). Put the board in tags[0]: one of 자유게시판, 비밀게시판, 새내기게시판, 졸업생게시판, 정보게시판, 연애게시판, 시사·이슈, 동아리·학회, 장터게시판. Post "author" is "익명". In comments, anonymous commenters are numbered in order of first appearance — "익명1", "익명2", … (the same person keeps the same number in that post) — and the post's own writer appears as "익명(글쓴이)". Tone: university students' casual Korean, 음슴체 (~함, ~임, ~ㅠ), ㅋㅋ, ㅠㅠ; topics: 과제, 시험, 학점, 교수님, 학식, 수강신청, 동기, 선배, CC, 썸, 알바, 취준, 기숙사, campus gossip. Short punchy titles. "likes" is 공감 count, "shares" is 스크랩 count. No real-person defamation.`,
    guide_tieba: `Baidu Tieba. Set "board" to the bar name WITHOUT the trailing 吧. Each post object is a THREAD with a title and the 楼主 (OP) body as floor 1. Comments are the following floors (2楼, 3楼...) and their "replies" are 楼中楼 replies. Culture: 沙发, 板凳, 前排, 顶, 楼主好人, 233, 水贴, 吧务, heated debates, long analysis posts.`,
};

// Labels for the prompt editor
const PROMPT_LABELS = {
    system: '시스템 프롬프트',
    mode_meta: '모드: 작품 반응',
    mode_world: '모드: 세계관 속',
    topic_assign: '글 주제: 글마다 배정할 때 ({{topics}}=주제 목록)',
    topic_mix: '글 주제: 섞어서 쓸 때 ({{topics}}=주제 목록)',
    thread_next: '후속 스레 작성 지시 ({{cap}}=상한, {{part}}=몇 번째)',
    player_write: 'AI로 쓰기 (내 신분으로 대신 쓰기)',
    cross_ref: '다른 게시글 참고 지시',
    amount_posts: '새 글 생성: 개수 지시',
    continue: '이어서 생성 지시',
    react_focus: '내 글/댓글에 반응하라는 지시',
    player_user: '유저로 쓴 글 설명',
    player_char: '캐릭터로 쓴 글 설명 ({{name}}=캐릭터 이름)',
    player_mob: '모브로 쓴 글 설명',
    language_native: '언어: 커뮤니티 원어',
    language_fixed: '언어: 지정 언어',
    language_foreign: '언어: 외국 커뮤니티를 다른 언어로 쓸 때',
    translation: '번역 지시 (글 만들 때 같이)',
    translate_separate: '번역: 따로 번역할 때',
    reasoning_min: '추론 최소화 지시',
    community_space: '내가 만든 카페·갤러리',
    setting_country: '배경: 나라를 골랐을 때',
    setting_custom: '배경: 직접 입력했을 때',
    npc_on: '주변 인물(NPC): 직접 글 쓰기',
    npc_off: '주변 인물(NPC): 글 쓰지 않기',
    only_char: '언급 범위: 캐릭터만',
    only_user: '언급 범위: 유저만',
    no_mention: '언급 범위: 아무도 언급 안 함 (인물 언급 금지)',
    inject_authored: '본편 반영: 캐릭터/유저가 쓴 글',
    inject_world: '본편 반영: 세계관 속 글',
    inject_meta: '본편 반영: 독자 반응',
    format_posts: '출력 형식: 새 글',
    format_comments: '출력 형식: 댓글 추가',
    guide_naver: '스타일: 네이버 카페',
    guide_dcinside: '스타일: 디시인사이드',
    guide_reddit: '스타일: Reddit',
    guide_twitter: '스타일: X (트위터)',
    guide_fivech: '스타일: 2ch / 5ch',
    guide_weibo: '스타일: 웨이보',
    guide_blind: '스타일: 블라인드',
    guide_everytime: '스타일: 에브리타임',
    guide_tieba: '스타일: 바이두 티에바',
    guide_discord: '스타일: 디스코드',
    guide_tdgall: '스타일: 투디갤',
    guide_kkangtong: '스타일: 깡통',
    dm_continue: '디스코드 DM 이어가기 지시',
    inject_dm: '본편 반영: 디스코드 DM',
    tail: '맨 밑 프롬프트 (켰을 때만 — 요청 맨 끝 메시지)',
};

// ---------------------------------------------------------------------------
// Settings / storage helpers
// ---------------------------------------------------------------------------
function ctx() {
    return SillyTavern.getContext();
}

// Formats an API added in the panel can speak (sent through SillyTavern's reverse-proxy route)
const API_KINDS = {
    openai: {
        label: 'OpenAI 호환', source: 'openai', example: 'https://api.openai.com/v1',
        hint: 'OpenAI 공식, 리버스 프록시, OpenRouter, DeepSeek, 로컬 서버 등 /v1/chat/completions 형식이면 다 돼요. 주소는 /v1 까지만 적어 주세요.',
        strip: /\/(chat\/)?completions\/?$/i,
    },
    claude: {
        label: 'Claude (Anthropic) 호환', source: 'claude', example: 'https://api.anthropic.com/v1',
        hint: 'Anthropic 공식 API 또는 Claude 리버스 프록시 (/v1/messages 형식). 주소는 /v1 까지만 적어 주세요.',
        strip: /\/messages\/?$/i,
    },
    google: {
        label: 'Gemini (Google) 호환', source: 'makersuite', example: 'https://generativelanguage.googleapis.com',
        hint: 'Google AI Studio 또는 Gemini 리버스 프록시. 주소는 도메인(또는 프록시 기본 주소)까지만 적어 주세요.',
        strip: /\/v1(beta|alpha)?(\/models.*)?\/?$/i,
    },
    vertex: {
        label: 'Vertex AI (Google Cloud)', source: 'vertexai', example: 'https://프록시 주소 (리버스 프록시 방식일 때만)',
        hint: '실리태번의 API 연결 화면(Chat Completion → Google Vertex AI)에 저장해 둔 키나 서비스 계정 JSON을 그대로 써요. 키를 여기에 따로 적지 않아요. Vertex 리버스 프록시라면 인증 방식을 "리버스 프록시"로 고르세요.',
        strip: /(?!)/,   // keep the proxy address exactly as SillyTavern's own proxy field would take it
    },
};
// Vertex: ST reads the express key / service account from its own secret store; a proxy uses address + password
const VERTEX_MODES = {
    express: 'Express — 실리태번에 저장한 Vertex API 키',
    full: 'Full — 실리태번에 저장한 서비스 계정 JSON',
    proxy: '리버스 프록시 — 주소 + 비밀번호',
};
// ST has no model list for Vertex, so offer the common Gemini names (any other name can be typed)
const VERTEX_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

function vertexUsesProxy(a) {
    return a?.kind === 'vertex' && a.vxMode === 'proxy';
}

/** Short "where it goes" text for an added API. */
function apiWhere(a) {
    if (a?.kind === 'vertex' && !vertexUsesProxy(a)) return `${a.vxMode === 'full' ? '서비스 계정' : 'Express'} · ${a.vxRegion || 'us-central1'}`;
    return apiHost(a?.url);
}

const cleanSpaceLists = new WeakSet();

function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE]) {
        extensionSettings[MODULE] = structuredClone(defaultSettings);
    }
    const s = extensionSettings[MODULE];
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(s, key)) s[key] = structuredClone(defaultSettings[key]);
    }
    // Migrate v1.0 language values
    if (s.language === 'korean') s.language = 'Korean';
    if (s.language === 'native_ko') { s.language = 'native'; if (!s.translateTo) s.translateTo = 'Korean'; }
    if (!s.prompts || typeof s.prompts !== 'object') s.prompts = {};
    if (!Array.isArray(s.customApis)) s.customApis = [];
    s.customApis = s.customApis.filter(a => a && typeof a === 'object' && typeof a.id === 'string' && typeof a.url === 'string');
    for (const a of s.customApis) {
        if (!hasKey(API_KINDS, a.kind)) a.kind = 'openai';
        for (const k of ['name', 'key', 'model']) if (typeof a[k] !== 'string') a[k] = '';
        if (a.kind === 'vertex') {
            if (!hasKey(VERTEX_MODES, a.vxMode)) a.vxMode = 'express';
            a.vxRegion = /^[a-z0-9-]{2,40}$/.test(String(a.vxRegion ?? '')) ? a.vxRegion : 'us-central1';
            a.vxProject = String(a.vxProject ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 64);
        }
    }
    if (!s.modelOverrides || typeof s.modelOverrides !== 'object' || Array.isArray(s.modelOverrides)) s.modelOverrides = {};
    if (!s.extMemoryChoice || typeof s.extMemoryChoice !== 'object' || Array.isArray(s.extMemoryChoice)) s.extMemoryChoice = {};
    if (!s.secOpen || typeof s.secOpen !== 'object' || Array.isArray(s.secOpen)) s.secOpen = {};
    if (Object.hasOwn(s, 'noMention')) {   // before 1.40: one on/off switch for "nobody"
        if (s.noMention === true) s.mentionScope = 'none';
        delete s.noMention;
    }
    if (!['all', 'char', 'user', 'none'].includes(s.mentionScope)) s.mentionScope = 'all';
    if (!s.topicRenames || typeof s.topicRenames !== 'object' || Array.isArray(s.topicRenames)) s.topicRenames = {};
    for (const k of Object.keys(s.topicRenames)) {
        const v = s.topicRenames[k];
        if (typeof v === 'string') s.topicRenames[k] = [{ to: v, at: Date.now() }];   // 1.37.0 kept only the new name
        else if (!Array.isArray(v)) delete s.topicRenames[k];
        else s.topicRenames[k] = v.filter(e => e && typeof e.to === 'string' && Number.isFinite(e.at));
    }
    if (!Array.isArray(s.customSpaces)) s.customSpaces = [];
    if (!cleanSpaceLists.has(s.customSpaces)) {   // once per list, not on every getSettings()
        s.customSpaces = s.customSpaces
            .filter(x => x && typeof x.id === 'string' && x.id && typeof x.name === 'string' && x.name.trim() && hasKey(PLATFORMS, x.platform))
            .map(x => ({ id: x.id.slice(0, 64), platform: x.platform, name: x.name.slice(0, 40), desc: typeof x.desc === 'string' ? x.desc.slice(0, 500) : '', locale: cleanLocale(x.locale, true) }));
        cleanSpaceLists.add(s.customSpaces);
    }
    if (!s.spaceSelected || typeof s.spaceSelected !== 'object' || Array.isArray(s.spaceSelected)) s.spaceSelected = {};
    return s;
}

function saveSettings() {
    ctx().saveSettingsDebounced();
}

function getPrompt(key) {
    const custom = getSettings().prompts?.[key];
    return (typeof custom === 'string' && custom.trim()) ? custom : DEFAULT_PROMPTS[key];
}

function fillTpl(template, vars) {
    const filled = String(template ?? '').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    try {
        return ctx().substituteParams ? ctx().substituteParams(filled) : filled;
    } catch {
        return filled;
    }
}

function hasChat() {
    const c = ctx();
    return !!c.getCurrentChatId?.() && (c.characterId !== undefined || !!c.groupId);
}

// ---------------------------------------------------------------------------
// Feed storage: a JSON file in the user's SillyTavern files folder (data/<user>/user/files/).
// The chat file only keeps a small pointer (storeId + owner) plus pins and per-chat settings.
// Branches / checkpoints copy chat metadata but get a fresh `integrity` id from SillyTavern;
// when the owner doesn't match, the feeds are copied into a new file (cut at the branch point).
// ---------------------------------------------------------------------------
const FILE_PREFIX = 'stcm-feed-';
const feedState = {
    key: null,        // owner key of the chat the cache belongs to
    chatId: null,     // chat the cache belongs to (cache validity)
    storeId: null,
    feeds: [],
    ready: false,
    loading: null,    // Promise while loading
    lastWritten: '',  // JSON last uploaded, to skip no-op writes
    timer: null,
    writing: Promise.resolve(),
    error: false,
    retryTimer: null,
    gen: 0,           // +1 on every load: results that started before a reload must not land in stale objects
};

/** Feed files whose last save failed: storeId → { feeds, chat }. Kept across chat switches (the only copy of
 *  those changes) and retried until the server has them; opening that chat again uses this copy. */
const unsavedStores = new Map();

/** 임시 저장: a failed save also leaves a copy in this browser, so closing the page doesn't lose it.
 *  Removed as soon as the server has the file. Too big for the browser's storage → told so. */
const LOCAL_KEY = (storeId) => `stcm_unsaved_${storeId}`;
function keepLocalCopy(storeId, feeds, chat) {
    try {
        const json = JSON.stringify({ storeId, chat, savedAt: Date.now(), feeds });
        if (json.length > 4_500_000) throw new Error('too big');
        localStorage.setItem(LOCAL_KEY(storeId), json);
        return true;
    } catch {
        try { localStorage.removeItem(LOCAL_KEY(storeId)); } catch { /* ignore */ }
        return false;
    }
}
function dropLocalCopy(storeId) {
    try { localStorage.removeItem(LOCAL_KEY(storeId)); } catch { /* ignore */ }
}
function readLocalCopy(storeId) {
    try {
        const d = JSON.parse(localStorage.getItem(LOCAL_KEY(storeId)) ?? 'null');
        return d && d.storeId === storeId && Array.isArray(d.feeds) ? d : null;
    } catch {
        return null;
    }
}

// ---- save status in the panel header: 저장 중… / 저장됨 / 저장 실패 · 다시 시도 ----
let saveShownTimer = null;
function setSaveState(state) {
    const el = document.getElementById('stcm_save');
    if (!el) return;
    clearTimeout(saveShownTimer);
    el.dataset.state = state;
    el.disabled = state !== 'error';
    if (state === 'pending' || state === 'saving') {
        el.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span> 저장 중…</span>';
        el.title = '피드를 서버에 저장하는 중이에요';
    } else if (state === 'saved') {
        el.innerHTML = '<i class="fa-solid fa-check"></i><span> 저장됨</span>';
        el.title = '서버에 저장했어요';
        saveShownTimer = setTimeout(() => setSaveState('idle'), 2000);
    } else if (state === 'error') {
        el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span> 저장 실패 · 다시 시도</span>';
        el.title = '서버에 저장하지 못했어요. 누르면 지금 다시 저장해요 (잠시 뒤 자동으로도 다시 시도해요)';
    } else {
        el.innerHTML = '';
        el.title = '';
    }
}

/** Something not on the server yet (waiting, uploading or failed — in any chat). */
function hasUnsaved() {
    return !!(feedState.timer || feedState.saving || unsavedStores.size);
}

/** Save again now (the 저장 실패 button, or the automatic retry): every file still waiting, any chat. */
function retrySave() {
    clearTimeout(feedState.retryTimer);
    feedState.retryTimer = null;
    if (feedState.ready && feedState.storeId && feedState.timer) {
        clearTimeout(feedState.timer);
        feedState.timer = null;
        queueWrite(feedState.storeId, feedState.feeds, feedState.chatId ?? '');
    }
    for (const [storeId, u] of [...unsavedStores]) {
        if (storeId === feedState.storeId && feedState.ready) {
            if (!feedState.timer) queueWrite(storeId, feedState.feeds, feedState.chatId ?? '');   // the copy loaded now is the newest
        } else {
            queueWrite(storeId, u.feeds, u.chat);
        }
    }
}

function chatOwnerKey() {
    const c = ctx();
    const integrity = c.chatMetadata?.integrity;
    return integrity ? `i:${integrity}` : `c:${c.getCurrentChatId?.() ?? ''}`;
}

function fileNameFor(storeId) {
    return `${FILE_PREFIX}${storeId}.json`;
}

function newStoreId() {
    const id = ctx().uuidv4 ? ctx().uuidv4() : `${Date.now().toString(36)}${randomId(10)}`;
    return String(id).replace(/[^a-zA-Z0-9-]/g, '');
}

function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

async function uploadStore(storeId, feeds) {
    const json = JSON.stringify({ version: 1, storeId, savedAt: Date.now(), feeds });
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({ name: fileNameFor(storeId), data: toBase64(json) }),
    });
    if (!res.ok) throw new Error(`파일 저장 실패 (${res.status})`);
    return json.length;
}

async function downloadStore(storeId) {
    const res = await fetch(`/user/files/${fileNameFor(storeId)}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`파일 읽기 실패 (${res.status})`);
    const data = await res.json();
    return Array.isArray(data?.feeds) ? data.feeds : [];
}

async function deleteStoreFile(storeId) {
    const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({ path: `user/files/${fileNameFor(storeId)}` }),
    });
    return res.ok || res.status === 404;
}

/** Index of store files in extension settings, used for cleanup after chats are deleted. */
function storeIndex() {
    const s = getSettings();
    if (!s.stores || typeof s.stores !== 'object') s.stores = {};
    return s.stores;
}

function indexStore(storeId, patch) {
    const idx = storeIndex();
    idx[storeId] = { ...(idx[storeId] ?? {}), ...patch, updated: Date.now() };
    saveSettings();
}

/** Debounced write of the in-memory feeds to the current store file. */
function scheduleFeedWrite() {
    if (!feedState.ready) return;
    if (!feedState.storeId) {
        if (!feedState.feeds.length) return;
        // first feed in this chat: create its file and remember it in the chat
        const st = getChatStore();
        st.storeId = newStoreId();
        st.storeOwner = chatOwnerKey();
        feedState.storeId = st.storeId;
        indexStore(st.storeId, { chat: ctx().getCurrentChatId?.() ?? '', owner: st.storeOwner });
        ctx().saveMetadata();
    }
    clearTimeout(feedState.timer);
    const storeId = feedState.storeId;
    const feeds = feedState.feeds;
    const chat = feedState.chatId ?? '';   // the chat these feeds belong to, even if another is open when it runs
    if (unsavedStores.has(storeId)) unsavedStores.set(storeId, { feeds, chat });   // the copy to keep is the newest one
    feedState.timer = setTimeout(() => { feedState.timer = null; queueWrite(storeId, feeds, chat); }, 700);
    setSaveState('pending');
}

/** Upload one store file (one at a time). Resolves true when it is on the server (or already was).
 *  Only the newest request per file is sent: an older one still waiting in line is skipped, so a stale copy can
 *  never overwrite newer content. */
const latestWrite = new Map();   // storeId → number of the newest request
let writeSeq = 0;
function queueWrite(storeId, feeds, chat = feedState.chatId ?? '') {
    const seq = ++writeSeq;
    latestWrite.set(storeId, seq);
    const job = feedState.writing.then(async () => {
        if (latestWrite.get(storeId) !== seq) return true;   // a newer request for this file follows
        const json = JSON.stringify(feeds);
        const done = () => {   // this file is on the server now
            unsavedStores.delete(storeId);
            dropLocalCopy(storeId);
            const wasError = feedState.error;
            feedState.error = unsavedStores.size > 0;
            if (wasError && !feedState.error) {
                clearTimeout(feedState.retryTimer);
                feedState.retryTimer = null;
                toastr.success('커뮤니티 피드를 다시 저장했어요.');
            }
            if (!feedState.timer) setSaveState(feedState.error ? 'error' : 'saved');   // a newer change waits: keep 저장 중
        };
        if (storeId === feedState.storeId && json === feedState.lastWritten) {
            // same as what the server has (e.g. a failed change was undone): nothing to send, nothing pending
            if (unsavedStores.has(storeId) || feedState.error) done();
            else if (!feedState.timer && !feedState.saving) setSaveState('idle');
            return true;
        }
        feedState.saving = true;
        setSaveState('saving');
        try {
            const size = await uploadStore(storeId, feeds);
            if (storeId === feedState.storeId) feedState.lastWritten = json;
            indexStore(storeId, { size, chat });
            done();
            return true;
        } catch (e) {
            console.error(`[${MODULE}] failed to save feed file`, e);
            const firstFail = !unsavedStores.has(storeId);
            unsavedStores.set(storeId, { feeds, chat });   // keep this copy even if the chat is left
            const local = keepLocalCopy(storeId, feeds, chat);   // …and in this browser, even if the page is closed
            if (!feedState.error) {
                toastr.error(`커뮤니티 피드를 서버에 저장하지 못했어요. 잠시 뒤 다시 시도해요.${local ? ' (이 브라우저에 임시로 저장해 뒀어요)' : ' 피드가 커서 브라우저 임시 저장도 못 했어요. 페이지를 닫지 말아 주세요.'}`, '커뮤니티');
            } else if (firstFail && !local) {
                toastr.warning('이 피드는 커서 브라우저 임시 저장을 못 했어요. 저장될 때까지 페이지를 닫지 말아 주세요.', '커뮤니티');
            }
            feedState.error = true;
            setSaveState('error');
            clearTimeout(feedState.retryTimer);
            feedState.retryTimer = setTimeout(retrySave, 20000);
            return false;
        } finally {
            feedState.saving = false;
        }
    });
    feedState.writing = job.then(() => undefined);
    return job;
}

/** Write any pending change right away (before switching chats). */
async function flushFeedWrite() {
    if (feedState.timer) {
        clearTimeout(feedState.timer);
        feedState.timer = null;
        if (feedState.ready && feedState.storeId) await queueWrite(feedState.storeId, feedState.feeds, feedState.chatId ?? '');
    }
    // a failed save stays in unsavedStores and keeps being retried, whichever chat is open
    await feedState.writing;
}

/** A branch keeps only what existed up to its branch point: feeds, posts, comments and replies made later go.
 *  Older data has no time stamp on comments; those stay. */
function trimToBranchPoint(feeds, chatLen, dropUnknown = false) {
    const lateItem = (o) => (Number.isInteger(o?.at) && o.at >= chatLen) || (dropUnknown && unknownTime(o, chatLen));
    const out = feeds.filter(f => (Number(f.atMessage) || 0) < chatLen);
    for (const f of out) {
        const posts = f.data?.posts ?? [];
        // posts are added at the end, so everything from the first late one on goes
        const cut = posts.findIndex(o => Number.isInteger(o?.at) && o.at >= chatLen);
        if (cut >= 0) {
            posts.length = cut;
            for (const p of posts) for (const k of ['prevIdx', 'nextIdx']) if (p[k] != null && p[k] >= cut) delete p[k];
        }
        for (const p of posts) {
            const list = p.comments ?? [];
            if (!list.some(c => lateItem(c))) {
                for (const c of list) if (Array.isArray(c.replies)) c.replies = c.replies.filter(r => !lateItem(r));
                continue;
            }
            // keep the rest; "replying to" numbers follow the comments that stay
            const map = new Map();
            const kept = [];
            list.forEach((c, i) => { if (!lateItem(c)) { map.set(i, kept.length); kept.push(c); } });
            for (const c of kept) {
                if (c.ref != null) { if (map.has(c.ref)) c.ref = map.get(c.ref); else delete c.ref; }
                if (Array.isArray(c.replies)) c.replies = c.replies.filter(r => !lateItem(r));
            }
            p.comments = kept;
        }
    }
    return out;
}

/** A comment from before v1.31.1 has no time stamp. From v1.33 it gets "existed by message N" (atMax) the first
 *  time its chat is opened, so a branch made at or after N keeps it for sure; earlier branches can't tell. */
function unknownTime(o, chatLen) {
    return !Number.isInteger(o?.at) && !(Number.isInteger(o?.atMax) && o.atMax < chatLen);
}

function countUnknown(feeds, chatLen) {
    let n = 0;
    for (const f of feeds) {
        if ((Number(f.atMessage) || 0) >= chatLen) continue;
        for (const p of f.data?.posts ?? []) {
            if (Number.isInteger(p.at) && p.at >= chatLen) break;
            for (const c of p.comments ?? []) {
                if (unknownTime(c, chatLen)) n++;
                for (const r of c.replies ?? []) if (unknownTime(r, chatLen)) n++;
            }
        }
    }
    return n;
}

/** Give old comments without a time stamp an upper bound: they existed by the newest message right now. */
function stampLegacy(feeds, chatLen) {
    const atMax = Math.max(0, chatLen - 1);
    let n = 0;
    const stamp = (o) => { if (o && !Number.isInteger(o.at) && !Number.isInteger(o.atMax)) { o.atMax = atMax; n++; } };
    for (const f of feeds) for (const p of f.data?.posts ?? []) for (const c of p.comments ?? []) {
        stamp(c);
        for (const r of c.replies ?? []) stamp(r);
    }
    return n;
}

/** Load (or migrate / fork) the feeds of the chat that is open now. */
function loadFeedsForCurrentChat() {
    const run = (async () => {
        feedState.ready = false;
        feedState.gen++;
        feedState.error = unsavedStores.size > 0;
        setSaveState(feedState.error ? 'error' : 'idle');
        feedState.feeds = [];
        feedState.storeId = null;
        feedState.lastWritten = '';
        if (!hasChat()) { feedState.key = null; feedState.chatId = null; return; }

        const c = ctx();
        const key = chatOwnerKey();
        const chatId = c.getCurrentChatId();
        feedState.key = key;
        feedState.chatId = chatId;
        const st = getChatStore();
        const chatLen = c.chat?.length ?? 0;
        let feeds = [];
        let metaChanged = false;

        const legacy = Object.getOwnPropertyDescriptor(st, 'feeds');
        const isLegacy = !!(legacy && legacy.enumerable && Array.isArray(legacy.value));
        const before = { storeId: st.storeId, storeOwner: st.storeOwner, pins: st.pins };   // put back if the copy fails
        if (isLegacy) {
            // v1.5 and older kept feeds inside the chat file → move them out (removed only once the file is saved)
            feeds = legacy.value;
            metaChanged = true;
        } else if (st.storeId && unsavedStores.has(st.storeId)) {
            // its last save failed: this copy is newer than the server file (it keeps being retried)
            feeds = unsavedStores.get(st.storeId).feeds;
        } else if (st.storeId && readLocalCopy(st.storeId)) {
            // a copy left in this browser by a save that failed before the page was closed
            const local = readLocalCopy(st.storeId);
            const { Popup, POPUP_RESULT } = c;
            const when = new Date(local.savedAt).toLocaleString();
            const restore = Popup?.show?.confirm
                ? (await Popup.show.confirm('저장 못 한 커뮤니티 피드', `${esc(when)}에 서버에 저장하지 못한 이 채팅의 커뮤니티 피드가 이 브라우저에 남아 있어요.<br><b>확인</b>: 그 내용으로 되살려 서버에 저장해요.<br><b>취소</b>: 버리고 서버에 있는 내용을 열어요.`)) === POPUP_RESULT.AFFIRMATIVE
                : confirm('서버에 저장하지 못한 커뮤니티 피드가 이 브라우저에 남아 있어요. 되살릴까요?');
            if (feedState.chatId !== chatId) return;
            if (restore) {
                feeds = local.feeds;
                unsavedStores.set(st.storeId, { feeds, chat: chatId });   // saved below like any failed copy
            } else {
                dropLocalCopy(st.storeId);
                try {
                    feeds = (await downloadStore(st.storeId)) ?? [];
                } catch (e) {
                    console.error(`[${MODULE}] failed to load feed file`, e);
                    toastr.error('커뮤니티 피드 파일을 불러오지 못했어요.', '커뮤니티');
                    if (feedState.chatId === chatId) feedState.chatId = null;
                    return;
                }
            }
        } else if (st.storeId) {
            try {
                feeds = (await downloadStore(st.storeId)) ?? [];
            } catch (e) {
                console.error(`[${MODULE}] failed to load feed file`, e);
                toastr.error('커뮤니티 피드 파일을 불러오지 못했어요.', '커뮤니티');
                if (feedState.chatId === chatId) feedState.chatId = null;   // next ensureFeedsReady() retries
                return;   // stay not-ready so nothing overwrites the file
            }
        }
        if (feedState.chatId !== chatId) return;   // chat switched meanwhile

        // Owner recorded by chat id (no integrity at the time) counts as the same chat
        const sameOwner = st.storeOwner === key || st.storeOwner === `c:${chatId}`;
        const forked = !!(st.storeId && st.storeOwner && !sameOwner);
        if (sameOwner && st.storeOwner !== key) { st.storeOwner = key; metaChanged = true; }
        let pinsForked = null;
        if (forked) {
            // Branch / checkpoint: keep only what existed up to the branch point.
            // Old comments without a time stamp may be from after it: ask whether to keep them.
            let dropUnknown = false;
            const unknown = countUnknown(feeds, chatLen);
            const { Popup, POPUP_RESULT } = c;
            if (unknown && Popup?.show?.confirm) {
                dropUnknown = (await Popup.show.confirm('브랜치로 커뮤니티 피드 복사',
                    `언제 달렸는지 기록이 없는 예전 댓글이 ${unknown}개 있어요. 갈라진 시점 이후에 달린 것일 수도 있어요.<br><b>확인</b>을 누르면 빼고 복사하고, <b>취소</b>를 누르면 그대로 둬요.<br><small>(새 버전에서 달린 댓글은 시점에 맞게 알아서 빠져요.)</small>`)) === POPUP_RESULT.AFFIRMATIVE;
                if (feedState.chatId !== chatId) return;
            }
            // its own deep copy: the parent's data (maybe a not-yet-saved copy still being retried) stays untouched
            feeds = trimToBranchPoint(structuredClone(feeds), chatLen, dropUnknown);
            const ids = new Set(feeds.map(f => f.id));
            const lens = new Map(feeds.map(f => [f.id, f.data.posts.length]));
            pinsForked = (st.pins ?? []).filter(p => ids.has(p.feedId) && p.postIdx < lens.get(p.feedId));
        }
        const needNewFile = forked || isLegacy || (!st.storeId && feeds.length > 0);
        if (needNewFile) {
            // write the copy first; the chat only switches to it once the server has it
            const newId = newStoreId();
            const ok = await queueWrite(newId, feeds, chatId);
            if (feedState.chatId !== chatId) return;
            if (!ok) {
                st.storeId = before.storeId;
                st.storeOwner = before.storeOwner;
                st.pins = before.pins;
                feedState.chatId = null;   // stay not-ready: nothing is lost, the next open tries again
                toastr.error('커뮤니티 피드를 옮겨 저장하지 못해서 지금은 열지 않았어요. 원래 데이터는 그대로 있어요. 잠시 뒤 다시 열어 주세요.', '커뮤니티');
                return;
            }
            if (isLegacy) delete st.feeds;
            if (pinsForked) st.pins = pinsForked;
            st.storeId = newId;
            st.storeOwner = key;
            metaChanged = true;
        }
        if (st.storeId && !st.storeOwner) { st.storeOwner = key; metaChanged = true; }

        feedState.storeId = st.storeId ?? null;   // null: chat without feeds yet, file made on first save
        feedState.feeds = feeds;
        attachFeeds(st);
        feedState.ready = true;
        // a copy whose save failed is not on the server: lastWritten stays empty so the next save sends it
        feedState.lastWritten = unsavedStores.has(st.storeId) && unsavedStores.get(st.storeId).feeds === feeds ? '' : JSON.stringify(feeds);
        // old comments: remember they existed by now (later branches from here keep them for sure)
        if (!forked && stampLegacy(feeds, chatLen)) scheduleFeedWrite();
        else if (st.storeId && unsavedStores.get(st.storeId)?.feeds === feeds) scheduleFeedWrite();   // a kept copy: send it
        if (metaChanged) {
            indexStore(st.storeId, { chat: chatId ?? '', owner: key, from: forked ? 'branch' : undefined });
            await c.saveMetadata();
        }
        if (forked) refreshInjection();
    })();
    feedState.loading = run;
    return run;
}

async function ensureFeedsReady() {
    if (feedState.loading) {
        try { await feedState.loading; } catch { /* reported already */ }
    }
    if (hasChat() && feedState.chatId !== ctx().getCurrentChatId()) await loadFeedsForCurrentChat();
    return feedState.ready;
}

/** Expose the cached feeds as store.feeds without putting them into the chat file. */
function attachFeeds(st) {
    const d = Object.getOwnPropertyDescriptor(st, 'feeds');
    if (d && !d.enumerable && d.get) return;
    if (d && d.enumerable) return;   // legacy data, migrated by the loader
    Object.defineProperty(st, 'feeds', {
        configurable: true,
        enumerable: false,   // not serialized into the chat file / not copied into branches
        get: () => (feedState.ready && feedState.chatId === ctx().getCurrentChatId?.() ? feedState.feeds : []),
        set: (v) => { if (feedState.ready && feedState.chatId === ctx().getCurrentChatId?.()) feedState.feeds = Array.isArray(v) ? v : []; },
    });
}

const COUNTRIES = [
    ['KR', '한국', 'South Korea'], ['JP', '일본', 'Japan'], ['US', '미국', 'the United States'], ['CN', '중국', 'mainland China'],
    ['TW', '대만', 'Taiwan'], ['HK', '홍콩', 'Hong Kong'], ['GB', '영국', 'the United Kingdom'], ['FR', '프랑스', 'France'],
    ['DE', '독일', 'Germany'], ['IT', '이탈리아', 'Italy'], ['ES', '스페인', 'Spain'], ['RU', '러시아', 'Russia'],
    ['CA', '캐나다', 'Canada'], ['AU', '호주', 'Australia'], ['BR', '브라질', 'Brazil'], ['MX', '멕시코', 'Mexico'],
    ['IN', '인도', 'India'], ['VN', '베트남', 'Vietnam'], ['TH', '태국', 'Thailand'], ['PH', '필리핀', 'the Philippines'], ['ID', '인도네시아', 'Indonesia'],
];

/** Background object from storage → a safe shape. Spaces may 'inherit' the chat's. */
function cleanLocale(loc, allowInherit) {
    const modes = allowInherit ? ['inherit', 'story', 'country', 'custom'] : ['story', 'country', 'custom'];
    const mode = modes.includes(loc?.mode) ? loc.mode : (allowInherit ? 'inherit' : 'story');
    const country = mode === 'country' && typeof loc.country === 'string' && COUNTRIES.some(c => c[0] === loc.country) ? loc.country : '';
    const custom = mode === 'custom' && typeof loc.custom === 'string' ? loc.custom.slice(0, 600) : '';
    if (mode === 'country' && !country) return { mode: allowInherit ? 'inherit' : 'story', country: '', custom: '' };
    if (mode === 'custom' && !custom.trim()) return { mode: allowInherit ? 'inherit' : 'story', country: '', custom: '' };
    if (loc && loc.mode === mode && loc.country === country && loc.custom === custom) return loc;   // already clean
    return { mode, country, custom };
}

function getChatStore() {
    const { chatMetadata } = ctx();
    if (!chatMetadata) return null;
    if (!chatMetadata[MODULE]) chatMetadata[MODULE] = {};
    const st = chatMetadata[MODULE];
    attachFeeds(st);
    st.pins ??= [];
    st.counter ??= 0;
    st.unread ??= 0;
    st.pinsEnabled ??= true;
    st.identity ??= { as: 'mob', nick: '', charName: '' };
    st.wi ??= { mode: getSettings().includeWorldInfo === false ? 'off' : 'auto', picks: {} };
    st.wi.picks ??= {};
    st.lastMode ??= null;
    st.locale = cleanLocale(st.locale, false);   // this chat's community background
    // free-text backgrounds written in this chat (newest first), so you can switch between them
    if (!Array.isArray(st.localeCustoms) || st.localeCustoms.some(x => typeof x !== 'string')) {
        st.localeCustoms = (Array.isArray(st.localeCustoms) ? st.localeCustoms : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.slice(0, 600)).slice(0, LOCALE_CUSTOM_MAX);
    }
    if (st.locale.mode === 'custom' && !st.localeCustoms.includes(st.locale.custom)) st.localeCustoms.unshift(st.locale.custom);
    if (st.localeCustoms.length > LOCALE_CUSTOM_MAX) st.localeCustoms.length = LOCALE_CUSTOM_MAX;
    st.lastPlatform ??= null;
    return st;
}

async function saveChatStore() {
    scheduleFeedWrite();   // first, while this chat's copy is surely the one loaded
    await ctx().saveMetadata();
}

function getFeed(feedId) {
    return getChatStore()?.feeds.find(f => f.id === feedId) ?? null;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let excludeCache = { src: null, re: null, selfRe: null, openRe: null };

/** Regexes for the user's tag blocklist (cached until the setting changes). */
function excludeRegexes() {
    const src = String(getSettings().excludeTags ?? '');
    if (excludeCache.src === src) return excludeCache;
    const names = src.split(/[,\n]/).map(t => t.trim().replace(/^<\/?|\/?>$/g, '')).filter(Boolean).map(escapeRegex);
    if (!names.length) {
        excludeCache = { src, re: null, selfRe: null, openRe: null };
        return excludeCache;
    }
    const alt = names.join('|');
    excludeCache = {
        src,
        // <tag ...> ... </tag>   (tag names compared case-insensitively)
        // innermost first: the body may not contain another opening of the same tag (outer ones go on the next pass)
        re: new RegExp(`<\\s*(${alt})(?=[\\s>/])[^>]*>(?:(?!<\\s*\\1(?=[\\s>/]))[\\s\\S])*?<\\s*\\/\\s*\\1\\s*>`, 'giu'),
        // <tag ... />
        selfRe: new RegExp(`<\\s*(?:${alt})(?=[\\s>/])[^>]*\\/\\s*>`, 'giu'),
        // an opening tag that is never closed (status block cut at the end of a message): drop to the end
        openRe: new RegExp(`<\\s*(?:${alt})(?=[\\s>/])[^>]*>[\\s\\S]*$`, 'iu'),
    };
    return excludeCache;
}

/** Chat message → plain story text for the community prompt (no status bars, code, HTML). */
function cleanStoryText(text) {
    let t = String(text ?? '');
    t = t.replace(/<!--[\s\S]*?-->/g, ' ');
    t = t.replace(/```[\s\S]*?```/g, ' ');
    const { re, selfRe, openRe } = excludeRegexes();
    if (re) {
        // repeat for nested blocks of listed tags
        for (let i = 0; i < 8; i++) {
            const before = t;
            t = t.replace(re, ' ');
            if (t === before) break;
        }
        t = t.replace(selfRe, ' ');
        t = t.replace(openRe, ' ');
    }
    return stripMarkup(t);
}

/** Messages that must not be read: hidden (/hide), system, and optionally narrator notes. */
function isReadableMessage(m) {
    if (!m || !m.mes) return false;
    if (m.is_system) return false;                       // hidden messages and system messages
    if (m.extra?.isSmallSys) return false;
    if (getSettings().excludeSkipNarrator && m.extra?.type === 'narrator') return false;
    return true;
}

function stripMarkup(text) {
    return String(text ?? '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** 메시지당 최대 글자 수: 0 = 자르지 않음, 그 외에는 적은 글자 수 그대로 (정수로). Saving and using go through this. */
function normMsgChars(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 1000000) : 0;
}
function storyMsgLimit() {
    return normMsgChars(getSettings().storyMsgChars);
}

function truncate(text, n) {
    text = String(text ?? '');
    return text.length > n ? text.slice(0, cutPoint(text, n)) + '…' : text;
}

/** Where to cut so no character is split: the last letter boundary at or before n (emoji, 👨‍👩‍👧, flags, 한글 자모 stay whole).
 *  Boundaries are found from the start of the text (a piece cut out of the middle can pair 🇰🇷🇰🇷 wrongly);
 *  segmenting is lazy, so it stops at n and the rest of a long text is never looked at. */
let graphemes = null;
function cutPoint(text, n) {
    n = Math.max(0, Math.floor(n));
    if (graphemes === null) graphemes = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : false;
    if (graphemes) {
        let cut = 0;
        for (const g of graphemes.segment(text)) {
            const end = g.index + g.segment.length;
            if (end > n) break;
            cut = end;
        }
        return cut;
    }
    const c = text.charCodeAt(n - 1);   // no Segmenter: at least don't split a surrogate pair
    return c >= 0xD800 && c <= 0xDBFF ? n - 1 : n;
}

function hashColor(name) {
    let h = 0;
    for (const ch of String(name ?? '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return `hsl(${h % 360} 55% 55%)`;
}

function num(n, style) {
    n = Number(n) || 0;
    if (style === 'ko') {
        if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + '만';
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + '천';
        return String(n);
    }
    if (style === 'zh') {
        if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
        return String(n);
    }
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
}

function nowLabel(platformId, langName = resolvedLanguage()) {
    const p = PLATFORMS[platformId];
    const w = uiWords(platformId, langName);
    if (w && platformId !== 'fivech') return w.now;
    if (p.now) return p.now;
    // 2ch-style timestamp
    const d = new Date();
    const wd = '日月火水木金土'[d.getDay()];
    const z = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}/${z(d.getMonth() + 1)}/${z(d.getDate())}(${wd}) ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

function randomId(len = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

/** Escape, then add light platform-specific highlighting. */
function fmt(text, platform) {
    let html = esc(text);
    if (platform === 'fivech') {
        html = html.replace(/&gt;&gt;(\d+)/g, '<span class="stcm-anchor">&gt;&gt;$1</span>');
    }
    if (platform === 'weibo') {
        html = html.replace(/#([^#\n]{1,40})#/g, '<span class="stcm-tag">#$1#</span>');
        html = html.replace(/\[([^\]\n]{1,6})\]/g, '<span class="stcm-emo">[$1]</span>');
    }
    if (platform === 'twitter' || platform === 'reddit') {
        html = html.replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, '$1<span class="stcm-tag">$2</span>');
    }
    html = html.replace(/(^|\s)(@[\w.]+)/g, '$1<span class="stcm-tag">$2</span>');
    return html.replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// Language helpers
// ---------------------------------------------------------------------------
function resolvedLanguage() {
    const s = getSettings();
    if (s.language === 'native') return null;
    if (s.language === 'custom') return s.customLanguage?.trim() || null;
    return s.language;
}

function resolvedTranslation() {
    const s = getSettings();
    if (!s.translateTo) return null;
    if (s.translateTo === 'custom') return s.customTranslate?.trim() || null;
    return s.translateTo;
}

// The language each community is written in by default (Discord / X follow the story)
const NATIVE_LANG = { naver: 'ko', dcinside: 'ko', tdgall: 'ko', kkangtong: 'ko', blind: 'ko', everytime: 'ko', reddit: 'en', fivech: 'ja', weibo: 'zh', tieba: 'zh' };
const LANG_LABEL = { ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese' };

function langCode(name) {
    const s = String(name ?? '').toLowerCase();
    if (!s) return '';
    if (/korean|한국|조선/.test(s)) return 'ko';
    if (/japanese|日本|일본/.test(s)) return 'ja';
    if (/chinese|中文|汉语|漢語|중국|mandarin|cantonese/.test(s)) return 'zh';
    if (/english|영어/.test(s)) return 'en';
    return 'other';
}

/** Which label set a skin uses: '' = the platform's own language, else ko / en / ja / zh. */
function uiLang(platformId, langName) {
    const code = langCode(langName);
    const native = NATIVE_LANG[platformId];
    if (!code || !native || code === native) return '';
    return code === 'other' ? 'en' : code;
}

// Fixed UI words of the Chinese / Japanese skins when the feed is written in another language
const UI_WORDS = {
    ko: { via: '웨이보 앱', bar: ' 티에바', lz: '글쓴이', floor: (n) => `${n}층`, name: '이름:', now: '방금', anon: { fivech: '이름 없음', weibo: '웨이보 유저', tieba: '익명 유저', reddit: 'throwaway' }, over: (n) => `이 스레드는 ${n}을 넘었어요.<br>새 스레드를 세워 주세요.` },
    en: { via: 'via Weibo app', bar: ' Bar', lz: 'OP', floor: (n) => `#${n}`, name: 'Name:', now: 'just now', anon: { fivech: 'Anonymous', weibo: 'Weibo user', tieba: 'Anonymous user', reddit: 'throwaway' }, over: (n) => `This thread has passed ${n} posts.<br>Please start a new thread.` },
    ja: { via: 'Weiboアプリから', bar: 'バー', lz: 'スレ主', floor: (n) => `${n}階`, name: '名前：', now: 'たった今', anon: { fivech: '名無しさん', weibo: 'Weiboユーザー', tieba: '匿名ユーザー', reddit: 'throwaway' }, over: (n) => `このスレッドは${n}を超えました。<br>新しいスレッドを立ててください。` },
    zh: { via: '来自 微博客户端', bar: '吧', lz: '楼主', floor: (n) => `${n}楼`, name: '名字：', now: '刚刚', anon: { fivech: '无名氏', weibo: '微博用户', tieba: '匿名用户', reddit: 'throwaway' }, over: (n) => `本帖已超过${n}楼。<br>请开新帖。` },
};

/** UI words for a feed (or for the current language setting when no feed yet). */
function uiWords(platformId, langName) {
    const l = uiLang(platformId, langName);
    return l ? UI_WORDS[l] : null;
}

/** Output language of a feed: the one it was made in (older feeds: the current setting). '' / null = native. */
function feedLang(feed) {
    return feed && typeof feed.lang === 'string' ? feed.lang : resolvedLanguage();
}

/** "Write in X" rules shared by every prompt. */
function languageRules(platformId, fixed) {
    if (!fixed) return [fillTpl(getPrompt('language_native'), { language: PLATFORMS[platformId].lang })];
    const parts = [fillTpl(getPrompt('language_fixed'), { language: fixed })];
    const native = NATIVE_LANG[platformId];
    if (native && langCode(fixed) !== native) {
        parts.push(fillTpl(getPrompt('language_foreign'), { language: fixed, native: LANG_LABEL[native], platform: PLATFORMS[platformId].name }));
    }
    return parts;
}

function languageInstruction(platformId, fixed = resolvedLanguage()) {
    const tr = resolvedTranslation();
    const parts = languageRules(platformId, fixed);
    if (tr && !translateSeparately() && getSettings().translateWhen !== 'manual') parts.push(fillTpl(getPrompt('translation'), { translation: tr }));
    else parts.push('Leave "body_tr" empty.');   // no translation, or another model translates afterwards
    return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------
function baseVars(platformId) {
    const c = ctx();
    return {
        char: c.name2 || 'Character',
        user: c.name1 || 'User',
        platform: PLATFORMS[platformId].name,
    };
}

// ---------------------------------------------------------------------------
// Memory from other extensions: Memoria, 코끼리를 생각하지마, VectFox, Summarize, Vector Storage…
// They all hand their text to SillyTavern with setExtensionPrompt; the community reads the same slots.
// ---------------------------------------------------------------------------
const EXT_MEMORY_LABELS = {
    memoria_ledger: 'Memoria — 장기기억',
    long_memory_main: '코끼리를 생각하지마 — 기억',
    long_memory_anchor: '코끼리를 생각하지마 — 앵커',
    long_memory_recall: '코끼리를 생각하지마 — 회상',
    '3_vectfox': 'VectFox — 채팅 검색',
    '3_vectfox_lorebook': 'VectFox — 로어북',
    '3_vectfox_eventbase': 'VectFox — 이벤트',
    '3_vectfox_summarizer': 'VectFox — 요약',
    '1_memory': '요약 (Summarize)',
    '3_vectors': '벡터 저장소 — 채팅',
    '4_vectors_data_bank': '벡터 저장소 — 데이터 뱅크',
    '2_floating_prompt': "작가 노트 (Author's Note)",
    DEPTH_PROMPT: '캐릭터 노트',
};
const EXT_MEMORY_PATTERN = /memor|summar|vector|vectfox|long_memory|ledger|recall|chroma|rag\b|lore/i;

function extMemoryLabel(key) {
    if (EXT_MEMORY_LABELS[key]) return EXT_MEMORY_LABELS[key];
    for (const [k, v] of Object.entries(EXT_MEMORY_LABELS)) if (key.startsWith(`${k}_`)) return `${v} (${key})`;
    return key;
}

function extMemoryDefaultOn(key) {
    return EXT_MEMORY_PATTERN.test(key) && !/^2_floating_prompt|^DEPTH_PROMPT/.test(key);
}

function extMemoryChosen(key) {
    const v = getSettings().extMemoryChoice[key];
    return typeof v === 'boolean' ? v : extMemoryDefaultOn(key);
}

/** Non-empty injection slots of other extensions right now: [{ key, label, text, on }]. */
async function extMemorySlots() {
    const slots = ctx().extensionPrompts ?? {};
    const out = [];
    for (const [key, p] of Object.entries(slots)) {
        if (key.startsWith('st_community')) continue;   // our own pins
        const raw = typeof p?.value === 'string' ? p.value.trim() : '';
        if (!raw) continue;
        if (typeof p.filter === 'function') {
            try { if (!(await p.filter())) continue; } catch { /* keep it */ }
        }
        let text = raw;
        try { text = ctx().substituteParams ? ctx().substituteParams(raw) : raw; } catch { /* raw */ }
        text = cleanStoryText(text).trim();
        if (text) out.push({ key, label: extMemoryLabel(key), text, on: extMemoryChosen(key) });
    }
    return out;
}

async function buildExtMemoryBlock() {
    const s = getSettings();
    if (!s.extMemory) return '';
    const picked = (await extMemorySlots()).filter(x => x.on);
    if (!picked.length) return '';
    const max = Math.max(500, Number(s.extMemoryMax) || 8000);
    const per = Math.max(400, Math.floor(max / picked.length));
    return truncate(picked.map(x => `(${x.label})\n${truncate(x.text, per)}`).join('\n\n'), max);
}

/** The pick list shown in the settings (extension drawer or the panel's ⚙ view). */
async function renderExtMemoryList() {
    const box = document.getElementById('stcm_set_extmem_list');
    if (!box) return;
    const slots = await extMemorySlots();
    if (!slots.length) {
        box.innerHTML = '<small class="stcm-help">지금은 다른 확장이 넣은 기억이 없어요. 본 채팅에서 한 번 답변을 받으면 (요약 확장이 작동하면) 여기에 나타나요.</small>';
        return;
    }
    box.innerHTML = slots.map(x => `<label class="checkbox_label stcm-extmem-item"><input type="checkbox" data-extmem="${esc(x.key)}" ${x.on ? 'checked' : ''}><span><b>${esc(x.label)}</b> <small>${esc(truncate(x.text.replace(/\s+/g, ' '), 90))} · ${x.text.length.toLocaleString()}자</small></span></label>`).join('');
}

async function buildContextBlock() {
    const c = ctx();
    const s = getSettings();
    const parts = [];
    const charName = c.name2 || 'Character';
    const userName = c.name1 || 'User';

    if (s.includeCard) {
        try {
            const f = c.getCharacterCardFields?.() ?? {};
            if (c.groupId) {
                const group = c.groups?.find(g => g.id === c.groupId);
                const names = (group?.members ?? [])
                    .map(av => c.characters.find(ch => ch.avatar === av)?.name)
                    .filter(Boolean);
                if (names.length) parts.push(`[Group members]\n${names.join(', ')}`);
            }
            if (f.description) parts.push(`[Character: ${charName}]\n${truncate(f.description, 4000)}`);
            if (f.personality) parts.push(`[${charName}'s personality]\n${truncate(f.personality, 1500)}`);
            if (f.scenario) parts.push(`[Scenario]\n${truncate(f.scenario, 2000)}`);
            if (f.persona) parts.push(`[Protagonist / user persona: ${userName}]\n${truncate(f.persona, 2000)}`);
        } catch (e) {
            console.warn(`[${MODULE}] card fields failed`, e);
        }
    }

    const recent = (c.chat ?? [])
        .filter(isReadableMessage)
        .map(m => ({ name: m.name, text: cleanStoryText(m.mes) }))
        .filter(m => m.text)
        .slice(-Math.max(1, s.contextMessages));

    const wiParts = [];
    const wiMode = getChatStore()?.wi?.mode ?? (s.includeWorldInfo ? 'auto' : 'off');
    if ((wiMode === 'auto' || wiMode === 'both') && typeof c.getWorldInfoPrompt === 'function') {
        try {
            const f = c.getCharacterCardFields?.() ?? {};
            const chatForWI = recent.map(m => `${m.name}: ${m.text}`).reverse();
            const wi = await c.getWorldInfoPrompt(chatForWI, c.maxContext || 8192, true, {
                personaDescription: f.persona ?? '',
                characterDescription: f.description ?? '',
                characterPersonality: f.personality ?? '',
                characterDepthPrompt: f.charDepthPrompt ?? '',
                scenario: f.scenario ?? '',
                creatorNotes: f.creatorNotes ?? '',
                trigger: 'quiet',
            });
            const wiText = stripMarkup(wi?.worldInfoString ?? '');
            if (wiText) wiParts.push(wiText);
        } catch (e) {
            console.warn(`[${MODULE}] world info scan failed`, e);
        }
    }
    if (wiMode === 'manual' || wiMode === 'both') {
        const picked = await collectPickedWorldInfo();
        for (const t of picked) {
            if (!wiParts.some(x => x.includes(t))) wiParts.push(t);
        }
    }
    if (wiParts.length) parts.push(`[World information]\n${truncate(wiParts.join('\n\n'), Number(s.wiMaxChars) || 12000)}`);

    // Long-term memory / summaries kept by other extensions (covers older or hidden messages too)
    try {
        const mem = await buildExtMemoryBlock();
        if (mem) parts.push(`[Long-term memory — summaries and recalled past events from the story (from memory extensions)]\n${mem}`);
    } catch (e) {
        console.warn(`[${MODULE}] memory slots failed`, e);
    }

    const log = recent
        .map(m => `${m.name}: ${storyMsgLimit() ? truncate(m.text, storyMsgLimit()) : m.text}`)
        .join('\n\n');
    parts.push(`[Story so far — most recent messages, oldest first]\n${log || '(no messages yet)'}`);

    return parts.join('\n\n');
}

/** Whether named side characters of the story post themselves (world mode only: readers are outside the story). */
function npcRule(mode, vars) {
    // 언급 범위: only {{char}}, only {{user}}, or nobody from the story (side characters never post then)
    const scope = getSettings().mentionScope;
    if (scope === 'none') return fillTpl(getPrompt('no_mention'), vars);
    if (scope === 'char') return fillTpl(getPrompt('only_char'), vars);
    if (scope === 'user') return fillTpl(getPrompt('only_user'), vars);
    const v = getSettings().npcPosts;
    if (mode !== 'world' || (v !== 'on' && v !== 'off')) return '';
    return fillTpl(getPrompt(v === 'on' ? 'npc_on' : 'npc_off'), vars);
}

function commonBlocks(mode, platformId, lang = resolvedLanguage(), spaceId = currentSpace(platformId)) {
    const vars = baseVars(platformId);
    const npc = npcRule(mode, vars);
    const scene = sceneText(platformId, spaceId);
    return {
        system: fillTpl(getPrompt('system'), vars),
        task: fillTpl(getPrompt(mode === 'world' ? 'mode_world' : 'mode_meta'), vars) + (npc ? `\n${npc}` : ''),
        taskBase: fillTpl(getPrompt(mode === 'world' ? 'mode_world' : 'mode_meta'), vars),   // without the NPC rule (the player writes)
        style: fillTpl(getPrompt(`guide_${platformId}`), vars) + (scene ? `\n\n${scene}` : ''),
        language: languageInstruction(platformId, lang),
        extra: getSettings().extraInstruction?.trim() || '',
        vars,
    };
}

// ---------------------------------------------------------------------------
// Post topics
// ---------------------------------------------------------------------------
function parseTopics() {
    const out = [];
    const seen = new Set();
    for (const raw of String(getSettings().topics ?? '').split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const m = line.match(/^([^:：]+)[:：]\s*(.*)$/);
        const name = (m ? m[1] : line).trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({ name, desc: m ? m[2].trim() : '' });
    }
    return out;
}

/** Board = the topic chips picked above (자유 = none). null when topics only steer auto generation. */
function currentBoardKey() {
    const s = getSettings();
    if (s.topicScope === 'auto') return null;
    const names = new Set(parseTopics().map(t => t.name));
    return [...new Set(s.topicSelected ?? [])].filter(n => names.has(n)).sort().join('|');
}

function feedBoardKey(f) {
    const key = typeof f?.boardKey === 'string' ? f.boardKey : [...new Set(f?.topics ?? [])].sort().join('|');   // older feeds: the topics they were made with
    return renamedBoardKey(key, Number(f?.createdAt) || 0);
}

/** A board key with renamed topics under their new names: a board made as "연애" shows under "로맨스" after a rename.
 *  Only renames made after the feed was made count, so a new "연애" topic added later is its own board again. */
function renamedBoardKey(key, madeAt = 0) {
    const map = getSettings().topicRenames;
    if (!key || !map || !Object.keys(map).length) return key;
    const now = (n) => {
        // every rename after the last one followed (each step is later in time, so this always ends)
        let since = madeAt;
        for (;;) {
            const next = (hasKey(map, n) ? map[n] : []).filter(e => e.at > since).sort((a, b) => a.at - b.at)[0];
            if (!next) return n;
            n = next.to;
            since = next.at;
        }
    };
    return [...new Set(key.split('|').map(now))].sort().join('|');
}

function boardLabel(key) {
    return key ? key.split('|').join(' + ') : '자유';
}

/** "공포판" / "공포 서버" */
function boardName(key, platform) {
    return PLATFORMS[platform]?.chat ? `${boardLabel(key)} 서버` : `${boardLabel(key)}판`;
}

function selectedTopics() {
    const sel = new Set(getSettings().topicSelected ?? []);
    return parseTopics().filter(t => sel.has(t.name));
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Returns { text, names } for the topic block, or null when no topic applies. */
function buildTopicBlock(count, background) {
    const s = getSettings();
    if (s.topicScope === 'auto' && !background) return null;
    const topics = selectedTopics();
    if (!topics.length) return null;
    const fmtTopic = (t) => `${t.name}${t.desc ? ` — ${t.desc}` : ''}`;
    if (s.topicMix === 'mix') {
        return {
            names: topics.map(t => t.name),
            text: fillTpl(getPrompt('topic_mix'), { topics: topics.map(t => `- ${fmtTopic(t)}`).join('\n') }),
        };
    }
    // One topic per post, spread as evenly as possible
    const plan = [];
    let pool = [];
    for (let i = 0; i < count; i++) {
        if (!pool.length) pool = shuffle(topics);
        plan.push(pool.pop());
    }
    return {
        names: [...new Set(plan.map(t => t.name))],
        text: fillTpl(getPrompt('topic_assign'), { topics: plan.map((t, i) => `Post ${i + 1}: ${fmtTopic(t)}`).join('\n') }),
    };
}

// ---------------------------------------------------------------------------
// Cross-reference: other recent posts of the same community (same platform + mode in this chat)
// ---------------------------------------------------------------------------
function crossRefOn(post) {
    return !!(getSettings().crossRef || post?.crossRef);
}

function buildCrossRefBlock(platformId, mode, excludePost = null) {
    const store = getChatStore();
    const limit = Math.max(1, Math.min(20, Number(getSettings().crossRefCount) || 6));
    const items = [];
    const feeds = (store?.feeds ?? []).filter(f => f.platform === platformId && f.mode === mode);
    for (let fi = feeds.length - 1; fi >= 0 && items.length < limit; fi--) {
        const posts = feeds[fi].data.posts;
        for (let pi = posts.length - 1; pi >= 0 && items.length < limit; pi--) {
            const p = posts[pi];
            if (p === excludePost) continue;
            const lines = [`- ${p.title ? `"${truncate(p.title, 80)}" — ` : ''}${authorLabel(p)}: ${truncate(p.body, 220)}`];
            for (const c of p.comments.slice(-2)) lines.push(`    ↳ ${authorLabel(c)}: ${truncate(c.body, 100)}`);
            if (feeds[fi].data.board) lines[0] += `  [${truncate(feeds[fi].data.board, 40)}]`;
            items.push(lines.join('\n'));
        }
    }
    if (!items.length) return '';
    return `<other_posts>\n${fillTpl(getPrompt('cross_ref'), baseVars(platformId))}\n${items.join('\n')}\n</other_posts>`;
}

/** Prompt for brand new posts (optionally avoiding titles already in a feed). */
async function buildPostsPrompt({ mode, platformId, topic, avoidFeed, background = false }) {
    const s = getSettings();
    const topicBlock = buildTopicBlock(Number(s.postCount) || 4, background);
    const b = commonBlocks(mode, platformId, avoidFeed ? feedLang(avoidFeed) : resolvedLanguage(), avoidFeed ? feedSpace(avoidFeed) : currentSpace(platformId));
    const storyText = await buildContextBlock();

    const store = getChatStore();
    const prevFeeds = avoidFeed ? [avoidFeed] : (store?.feeds ?? []).filter(f => f.platform === platformId && f.mode === mode).slice(-2);
    const prevTitles = prevFeeds.flatMap(f => (f.data?.posts ?? []).map(x => x.title || truncate(x.body, 60))).filter(Boolean);

    const user = [
        `<story_context>\n${storyText}\n</story_context>`,
        `<task>\n${b.task}\n</task>`,
        `<platform_style>\n${b.style}\n</platform_style>`,
        avoidFeed?.data?.board ? `<board>\nPosts go on the same board: ${avoidFeed.data.board}. Keep "board" unchanged.\n</board>` : '',
        `<amount>\n${fillTpl(getPrompt('amount_posts'), { ...b.vars, count: s.postCount, comments: s.commentCount })}\n</amount>`,
        `<language>\n${b.language}\n</language>`,
        prevTitles.length ? `<avoid_repetition>\nThese posts already exist; write new, different ones:\n- ${prevTitles.slice(-15).join('\n- ')}\n</avoid_repetition>` : '',
        topicBlock ? `<topics>\n${topicBlock.text}\n</topics>` : '',
        getSettings().crossRef ? buildCrossRefBlock(platformId, mode) : '',
        topic ? `<user_request>\nThe user asked to focus on the following (it may be written in any language; follow its intent):\n${topic}\n</user_request>` : '',
        b.extra ? `<extra_instructions>\n${b.extra}\n</extra_instructions>` : '',
        getPrompt('format_posts'),
    ].filter(Boolean).join('\n\n');

    return { system: b.system, user, topicNames: topicBlock?.names ?? [] };
}

function playerMark(o, userName) {
    if (!o?.isMe) return '';
    if (o.as === 'char') return ` [CHARACTER: ${o.charName || 'unknown'}]`;
    return o.as === 'user' ? ` [PLAYER as ${userName}]` : ' [PLAYER]';
}

function whoLine(o) {
    return `${o.author || 'anon'}${o.handle ? ` (${o.handle})` : ''}`;
}

/** The post's photos / videos for prompts: commenters can react to what they show. */
function photoLine(post) {
    return postMedia(post).filter(m => m.desc.trim()).map(m => `\n[Attached ${m.type === 'video' ? 'video' : 'photo'}: ${truncate(m.desc.trim(), 400)}]`).join('');
}

/** Serialize one post and its comments for the continuation prompt. */
function serializeThread(feed, postIdx) {
    const post = feed.data.posts[postIdx];
    const userName = ctx().name1 || 'User';
    const lines = [];
    if (feed.data.board) lines.push(`Board: ${feed.data.board}`);

    if (feed.platform === 'fivech') {
        let n = 1;
        const items = [`>>${n} ${whoLine(post)}${playerMark(post, userName)}\nThread title: ${post.title}\n${post.body}${photoLine(post)}`];
        for (const c of post.comments) {
            items.push(`>>${++n} ${whoLine(c)}${playerMark(c, userName)}\n${c.body}${photoLine(c)}`);
            for (const r of c.replies) items.push(`>>${++n} ${whoLine(r)}${playerMark(r, userName)}\n${r.body}${photoLine(r)}`);
        }
        const head = items[0];
        const tail = items.slice(1).slice(-MAX_THREAD_ITEMS_IN_PROMPT);
        if (items.length - 1 > tail.length) lines.push(head, '(… older posts omitted …)', ...tail);
        else lines.push(...items);
        lines.push(`\nThe next post number is >>${n + 1}.`);
        return lines.join('\n\n');
    }

    if (PLATFORMS[feed.platform]?.chat) {
        if (post.kind === 'dm') lines.push(`Private Discord DM between ${dmSideEn(post.dm?.me)} and ${dmSideEn(post.dm?.partner)}.`);
        else {
            lines.push(`Channel: #${String(post.title || 'general').replace(/^#\s*/, '')}`);
            if (post.body || post.author) lines.push(`[first] ${whoLine(post)}${playerMark(post, userName)}: ${post.body}${photoLine(post)}`);
        }
        const start = Math.max(0, post.comments.length - MAX_THREAD_ITEMS_IN_PROMPT);
        if (start > 0) lines.push('(… older messages omitted …)');
        post.comments.slice(start).forEach((c, k) => {
            const i = start + k;
            lines.push(`[c${i}] ${whoLine(c)}${playerMark(c, userName)}${c.ref != null ? ` (replying to c${c.ref})` : ''}: ${c.body}`);
            for (const r of c.replies) lines.push(`    ↳ ${whoLine(r)}${playerMark(r, userName)}: ${r.body}`);
        });
        if (!post.comments.length && post.kind === 'dm') lines.push('(no messages yet)');
        return lines.join('\n');
    }

    lines.push(`[POST] ${whoLine(post)}${playerMark(post, userName)}${post.title ? `\nTitle: ${post.title}` : ''}\n${post.body}${photoLine(post)}`);
    const start = Math.max(0, post.comments.length - MAX_THREAD_ITEMS_IN_PROMPT);
    if (start > 0) lines.push('(… older comments omitted …)');
    post.comments.slice(start).forEach((c, k) => {
        const i = start + k;
        lines.push(`[c${i}] ${whoLine(c)}${playerMark(c, userName)}: ${c.body}${photoLine(c)}`);
        for (const r of c.replies) lines.push(`    ↳ ${whoLine(r)}${playerMark(r, userName)}: ${r.body}${photoLine(r)}`);
    });
    return lines.join('\n');
}

function threadHasPlayer(post) {
    const items = [post, ...post.comments, ...post.comments.flatMap(c => c.replies)];
    return {
        user: items.some(o => o.isMe && o.as === 'user'),
        mob: items.some(o => o.isMe && o.as === 'mob'),
        chars: [...new Set(items.filter(o => o.isMe && o.as === 'char').map(o => o.charName).filter(Boolean))],
    };
}

/** Prompt for continuing comments on an existing post. */
async function buildContinuePrompt({ feed, postIdx, count, playerJustPosted }) {
    const b = commonBlocks(feed.mode, feed.platform, feedLang(feed), feedSpace(feed));
    const postRef = feed.data.posts[postIdx];
    const storyText = await buildContextBlock();
    // the post may have moved / gone while the context was built: use where it is now
    postIdx = feed.data.posts.indexOf(postRef);
    if (postIdx < 0) throw new Error('그 사이 글이 지워졌어요');
    const post = postRef;
    const shown = post.comments.slice();   // what the [cN] numbers below point at
    const pl = threadHasPlayer(post);

    const playerNotes = [];
    if (pl.user) playerNotes.push(fillTpl(getPrompt('player_user'), b.vars));
    if (pl.chars.length) playerNotes.push(fillTpl(getPrompt('player_char'), { ...b.vars, name: pl.chars.join(', ') }));
    if (pl.mob) playerNotes.push(fillTpl(getPrompt('player_mob'), b.vars));
    if (playerJustPosted) playerNotes.push(fillTpl(getPrompt('react_focus'), b.vars));

    const user = [
        `<story_context>\n${storyText}\n</story_context>`,
        `<task>\n${b.task}\n</task>`,
        `<platform_style>\n${b.style}\n</platform_style>`,
        crossRefOn(post) && post.kind !== 'dm' ? buildCrossRefBlock(feed.platform, feed.mode, post) : '',
        `<thread>\n${serializeThread(feed, postIdx)}\n</thread>`,
        playerNotes.length ? `<player>\n${playerNotes.join('\n')}\n</player>` : '',
        post.kind === 'dm'
            ? `<continue>\n${fillTpl(getPrompt('dm_continue'), { ...b.vars, count, me: dmSideEn(post.dm?.me), partner: dmSideEn(post.dm?.partner), partnerName: dmSideName(post.dm?.partner) })}\n</continue>`
            : `<continue>\n${fillTpl(getPrompt('continue'), { ...b.vars, count })}\n</continue>`,
        `<language>\n${b.language}\n</language>`,
        b.extra ? `<extra_instructions>\n${b.extra}\n</extra_instructions>` : '',
        getPrompt('format_comments'),
    ].filter(Boolean).join('\n\n');

    return { system: b.system, user, shown };
}

// ---------------------------------------------------------------------------
// Model call + parsing
// ---------------------------------------------------------------------------
/** 맨 밑 프롬프트: the last message of a request (user or assistant role), when it is on and not empty. */
function tailMessage() {
    const s = getSettings();
    if (!s.tailEnabled) return null;
    const text = fillTpl(getPrompt('tail'), {}).trim();
    if (!text) return null;
    return { role: s.tailRole === 'assistant' ? 'assistant' : 'user', content: text };
}

async function callModel(system, user, signal, connValue, modelOverride = '', { noTail = false } = {}) {
    const c = ctx();
    const s = getSettings();
    const tail = noTail ? null : tailMessage();
    const conn = resolveConnection(connValue);
    const forced = String(modelOverride ?? '').trim();
    // 추론 최소화: an instruction for every model, plus SillyTavern's lowest reasoning effort where a request can carry it
    if (s.minReasoning) system = `${system}\n\n${getPrompt('reasoning_min')}`;
    const lowEffort = s.minReasoning ? { reasoning_effort: 'min', include_reasoning: false } : {};

    if (conn.type === 'api') {
        if (!conn.api) throw new Error('골라 둔 API가 지워졌어요. 커뮤니티 창의 API 설정에서 다시 골라 주세요.');
        return callCustomApi(forced ? { ...conn.api, model: forced } : conn.api, system, user, signal, lowEffort, tail);
    }
    if (conn.type === 'profile') {
        if (!connectionManagerOn()) throw new Error('Connection Manager 확장이 꺼져 있어요. 커뮤니티 창의 API 설정에서 다른 연결을 고르거나, 확장을 다시 켜 주세요.');
        if (!conn.profile) throw new Error('골라 둔 연결 프로필이 없어졌어요. 커뮤니티 창의 API 설정에서 다시 골라 주세요.');
        const svc = c.ConnectionManagerRequestService;
        const messages = [
            { role: 'system', content: system },
            { role: 'user', content: user },
            ...(tail ? [tail] : []),
        ];
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const model = forced || String(s.modelOverrides[conn.profile.id] ?? '').trim();
        const prompt = svc.constructPrompt(messages, conn.profile.id);
        const vertex = vertexProfileFields(conn.profile);
        let res;
        try {
            res = await svc.sendRequest(conn.profile.id, prompt, Number(s.maxTokens) || 4000, {
            stream: false,
            signal,
            extractData: true,
            // Merging the preset rebuilds the request from the preset's (or the MAIN API's) settings.
            // Vertex loses its sign-in fields that way (→ 400), and a preset made for another API mixes in
            // that API's fields — so in those cases send a clean request instead.
            includePreset: !vertex && presetFitsProfile(conn.profile),
            includeInstruct: true,
        }, { ...(vertex ?? {}), ...(model ? { model } : {}), ...lowEffort });
        } catch (e) {
            if (e?.name === 'AbortError' || e?.cause?.name === 'AbortError' || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            // ST wraps the real reason in .cause ("API request failed")
            const msg = String(e?.cause?.message || e?.message || e);
            const viaProxy = !!conn.profile.proxy && conn.profile.proxy !== 'None';
            const hint = vertex && !viaProxy
                ? ` — Vertex AI: 실리태번 API 연결 화면(Chat Completion → Google Vertex AI)에서 인증 방식(${vertex.vertexai_auth_mode === 'full' ? '전체(서비스 계정)' : 'Express(API 키)'})과 키/서비스 계정 JSON, 지역(${vertex.vertexai_region}), 모델 이름이 맞는지 확인해 주세요.`
                : '';
            throw new Error(`${conn.profile.name ?? '연결 프로필'}: ${msg}${hint}`, { cause: e });
        }
        if (typeof res === 'string') return res;
        return res?.content ?? '';
    }

    // Fallback: main API (generateRaw takes no AbortSignal, so check afterwards)
    const out = await c.generateRaw({
        systemPrompt: system,
        prompt: tail ? [{ role: 'user', content: user }, tail] : user,
        responseLength: Number(s.maxTokens) || 4000,
        trimNames: false,
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return out;
}

/**
 * When the reply was cut off (token limit), pull every complete object out of the array under `key`.
 * Returns [] if nothing complete is found.
 */
function salvageArray(raw, key) {
    const text = String(raw ?? '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
    const m = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(text);
    if (!m) return [];
    const out = [];
    let depth = 0;
    let inStr = false;
    let esc2 = false;
    let start = -1;
    for (let i = m.index + m[0].length; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc2) esc2 = false;
            else if (ch === '\\') esc2 = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') { if (depth === 0) start = i; depth++; continue; }
        if (ch === '}') {
            depth--;
            if (depth === 0 && start >= 0) {
                const chunk = text.slice(start, i + 1);
                try { out.push(JSON.parse(chunk)); } catch {
                    try { out.push(JSON.parse(escapeControlCharsInStrings(chunk).replace(/,\s*([}\]])/g, '$1'))); } catch { /* skip */ }
                }
                start = -1;
            }
            continue;
        }
        if (ch === ']' && depth === 0) break;
    }
    return out;
}

function extractJson(raw) {
    let text = String(raw ?? '');
    text = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
    text = text.replace(/```(?:json)?/gi, '');
    try { return JSON.parse(text.trim()); } catch { /* text around it, or slightly broken */ }
    // the outermost object — or array, when the answer is a bare list — inside the text
    const tryRange = (open, close) => {
        const start = text.indexOf(open);
        const end = text.lastIndexOf(close);
        if (start < 0 || end <= start) return undefined;
        const json = text.slice(start, end + 1);
        try { return JSON.parse(json); } catch { /* fall through */ }
        try { return JSON.parse(escapeControlCharsInStrings(json).replace(/,\s*([}\]])/g, '$1')); } catch { return undefined; }
    };
    const o = text.indexOf('{');
    const a = text.indexOf('[');
    const order = a >= 0 && (o < 0 || a < o) ? [['[', ']'], ['{', '}']] : [['{', '}'], ['[', ']']];
    for (const [open, close] of order) {
        const v = tryRange(open, close);
        if (v !== undefined) return v;
    }
    if (o < 0 && a < 0) throw new Error('JSON을 찾지 못했어요');
    throw new SyntaxError('JSON 형식이 깨졌어요');
}

/** Models sometimes emit raw line breaks inside JSON strings; escape them. */
function escapeControlCharsInStrings(json) {
    let out = '';
    let inStr = false;
    let escaped = false;
    for (const ch of json) {
        if (inStr) {
            if (escaped) { out += ch; escaped = false; continue; }
            if (ch === '\\') { out += ch; escaped = true; continue; }
            if (ch === '"') { inStr = false; out += ch; continue; }
            if (ch === '\n') { out += '\\n'; continue; }
            if (ch === '\r') continue;
            if (ch === '\t') { out += '\\t'; continue; }
            out += ch;
        } else {
            if (ch === '"') inStr = true;
            out += ch;
        }
    }
    return out;
}

const toInt = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 1e12) : 0;
};

/** Only whitelisted fields survive; flags such as isMe / as / charName / prevIdx can't come from the model. */
function normItem(o) {
    o = o && typeof o === 'object' ? o : {};
    return {
        author: String(o.author ?? '').slice(0, 200),
        handle: String(o.handle ?? '').slice(0, 200),
        body: String(o.body ?? ''),
        body_tr: String(o.body_tr ?? o.body_ko ?? ''),
        time: String(o.time ?? '').slice(0, 100),
        likes: toInt(o.likes),
    };
}

function normPost(p) {
    return {
        ...normItem(p),
        title: String(p?.title ?? '').slice(0, 500),
        title_tr: String(p?.title_tr ?? '').slice(0, 500),
        // photos / screenshots / videos attached to the post, as text descriptions (no real files)
        media: cleanMedia(p),
        views: toInt(p?.views),
        shares: toInt(p?.shares),
        tags: Array.isArray(p?.tags) ? p.tags.slice(0, 10).map(t => String(t).slice(0, 60)) : [],
        comments: Array.isArray(p?.comments) ? p.comments.map((cm, ci) => ({
            ...normItem(cm),
            replies: Array.isArray(cm?.replies) ? cm.replies.map(normItem) : [],
            // chat-style platforms (Discord) show which earlier message was replied to
            ...(Number.isInteger(cm?.reply_to) && cm.reply_to >= 0 && cm.reply_to < ci ? { ref: cm.reply_to } : {}),
        })) : [],
    };
}

function parseFeed(raw) {
    let data;
    try {
        data = extractJson(raw);
    } catch (e) {
        const posts = salvageArray(raw, 'posts');
        if (!posts.length) throw e;
        const board = /"board"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String(raw))?.[1] ?? '';
        data = { board: board.replace(/\\"/g, '"'), posts };
        toastr.warning(`응답이 중간에 잘려서 완성된 글 ${posts.length}개만 살렸어요. 최대 토큰을 늘리면 좋아요.`, '커뮤니티');
    }
    if (!Array.isArray(data.posts)) throw new Error('posts 배열이 없어요');
    return { board: String(data.board ?? '').slice(0, 200), posts: data.posts.slice(0, 50).map(normPost) };
}

function parseComments(raw) {
    let data;
    try {
        data = extractJson(raw);
    } catch (e) {
        const comments = salvageArray(raw, 'comments');
        if (!comments.length) throw e;
        data = { comments };
        toastr.warning(`응답이 중간에 잘려서 완성된 댓글 ${comments.length}개만 살렸어요.`, '커뮤니티');
    }
    const list = Array.isArray(data.comments) ? data.comments : (Array.isArray(data) ? data : null);
    if (!list) throw new Error('comments 배열이 없어요');
    return list.slice(0, 200).map(c => ({ ...normItem(c), reply_to: replyNumber(c?.reply_to) }));
}

/** reply_to from the model: a whole number (or a digit string) ≥ 0; anything else (null, "", true…) = a new comment. */
function replyNumber(v) {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : -1;
    if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v);
    return -1;
}

// ---------------------------------------------------------------------------
// Generation flows
// ---------------------------------------------------------------------------
let busy = false;
let abortCtl = null;

/** Shared wrapper: busy state, abort, chat-switch guard, error UI. */
async function runJob(label, background, job) {
    if (hasChat() && !(await ensureFeedsReady())) {
        if (!background) toastr.error('피드 파일을 불러오지 못해서 지금은 생성할 수 없어요. 채팅을 다시 열어 보세요.', '커뮤니티');
        return null;
    }
    if (busy) {
        if (!background) toastr.info('이미 생성 중이에요.');
        return null;
    }
    if (!hasChat()) {
        toastr.warning('먼저 채팅을 열어주세요.');
        return null;
    }
    const chatIdAtStart = ctx().getCurrentChatId();
    const genAtStart = feedState.gen;
    busy = true;
    abortCtl = new AbortController();
    setBusyUI(true, label);
    try {
        const res = await job({
            signal: abortCtl.signal,
            // same chat AND the same loaded copy (A→B→A reloads A: older objects must not be written to)
            stillSameChat: () => ctx().getCurrentChatId() === chatIdAtStart && feedState.gen === genAtStart,
        });
        if (res?.id && res?.data?.posts) scheduleTranslate(res.id);   // runs after the lock is released
        return res;
    } catch (e) {
        if (abortCtl?.signal.aborted) {
            toastr.info('생성을 멈췄어요.');
        } else if (e?.isParse) {
            console.error(`[${MODULE}] parse failed`, e.cause, e.raw);
            if (background) toastr.error(`응답 해석 실패: ${esc(e.message)}`, '커뮤니티');
            else showError(`응답을 해석하지 못했어요: ${e.message}`, e.raw);
        } else {
            console.error(`[${MODULE}] generation failed`, e);
            const cause = e?.cause?.message || e?.message || String(e);
            if (background) toastr.error(`생성 실패: ${esc(cause)}`, '커뮤니티');
            else showError(`생성 실패: ${cause}`);
        }
        return null;
    } finally {
        busy = false;
        abortCtl = null;
        setBusyUI(false);
    }
}

// ---------------------------------------------------------------------------
// Separate translation: another connection translates new posts after they are generated
// ---------------------------------------------------------------------------
function translateSeparately() {
    return !!resolvedTranslation() && !!getSettings().translateConn;
}

const trTried = new WeakSet();   // items already sent once this session (empty answer = already in that language)
const trTriedTitle = new WeakSet();   // same for post titles
const trTriedImage = new WeakSet();   // same for photo descriptions
let trChain = Promise.resolve();

function scheduleTranslate(feedId) {
    if (!translateSeparately() || getSettings().translateWhen === 'manual') return;
    trChain = trChain.then(() => translateFeed(feedId)).catch((e) => {
        console.warn(`[${MODULE}] translation failed`, e);
        toastr.error(`번역 실패: ${esc(truncate(String(e?.message ?? e), 300))}`, '커뮤니티');
    });
}

/** Language to translate into: the setting, or Korean for a post's 번역 button when none is set. */
function trTarget() {
    return resolvedTranslation() || 'Korean';
}

/** Connection + model a translation uses: the translation connection, else the generation one. */
function trConnection() {
    const s = getSettings();
    return s.translateConn ? { conn: s.translateConn, model: s.translateModel } : { conn: s.profileId, model: '' };
}

/**
 * Translate items [{ o, postIdx, field: 'body' | 'title' }] in small batches; returns the post indexes touched.
 * `mark` (optional) records attempts so the automatic pass doesn't resend texts that need no translation.
 */
async function translateItems(feedId, todo, { target, conn, model, mark = null, chatId = ctx().getCurrentChatId?.() } = {}) {
    const touched = new Set();
    const gen = feedState.gen;
    if (!todo.length) return touched;
    const system = fillTpl(getPrompt('translate_separate'), { translation: target });
    const batches = [];
    let cur = [];
    let size = 0;
    for (const t of todo) {
        const len = String(t.o[t.field]).length;
        if (cur.length && (size + len > 5000 || cur.length >= 30)) { batches.push(cur); cur = []; size = 0; }
        cur.push(t);
        size += len;
    }
    if (cur.length) batches.push(cur);
    for (const batch of batches) {
        if (ctx().getCurrentChatId?.() !== chatId || feedState.gen !== gen || !getFeed(feedId)) return touched;
        batch.forEach(t => mark?.(t, true));
        const user = JSON.stringify({ items: batch.map((t, id) => ({ id, text: t.o[t.field] })) });
        let raw;
        try {
            raw = await callModel(system, user, null, conn, model);
        } catch (e) {
            batch.forEach(t => mark?.(t, false));   // the request failed: try these again next time
            throw e;
        }
        if (ctx().getCurrentChatId?.() !== chatId || feedState.gen !== gen) return touched;
        let data;
        try { data = extractJson(raw); } catch { data = null; }
        const list = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : null);
        if (!list) {
            // unreadable answer: nothing was translated — let these be tried again later
            batch.forEach(t => mark?.(t, false));
            throw new Error('번역 응답을 읽지 못했어요 (형식이 달라요)');
        }
        const answered = new Set();
        for (const r of list) {
            const t = batch[Number(r?.id)];
            if (t && typeof r?.text === 'string') answered.add(t);   // "" = already in that language: done
            const text = typeof r?.text === 'string' ? r.text.trim() : '';
            if (!t || !text || text === String(t.o[t.field]).trim()) continue;
            if (t.field === 'title') t.o.title_tr = text.slice(0, 500);
            else if (t.field === 'desc') t.o.desc_tr = text.slice(0, 1000);
            else { t.o.body_tr = text.slice(0, 8000); delete t.o.body_ko; }
            touched.add(t.postIdx);
        }
        batch.forEach(t => { if (!answered.has(t)) mark?.(t, false); });   // left out of the answer: try again later
    }
    return touched;
}

/** Automatic pass after a generation (translation connection set, "자동 번역"). */
async function translateFeed(feedId) {
    const feed = getFeed(feedId);
    const target = resolvedTranslation();
    if (!feed || !target || !translateSeparately() || getSettings().translateWhen === 'manual') return;
    const todo = [];
    feed.data.posts.forEach((p, i) => {
        if (String(p.title ?? '').trim() && !p.title_tr && !trTriedTitle.has(p)) todo.push({ o: p, postIdx: i, field: 'title' });
        for (const o of [p, ...p.comments, ...p.comments.flatMap(cm => cm.replies)]) {
            for (const m of postMedia(o)) if (String(m.desc ?? '').trim() && !m.desc_tr && !trTriedImage.has(m)) todo.push({ o: m, postIdx: i, field: 'desc' });
        }
        for (const o of [p, ...p.comments, ...p.comments.flatMap(cm => cm.replies)]) {
            if (o && String(o.body ?? '').trim() && !o.body_tr && !o.body_ko && !trTried.has(o)) todo.push({ o, postIdx: i, field: 'body' });
        }
    });
    if (!todo.length) return;
    const mark = (t, on) => { const set = t.field === 'title' ? trTriedTitle : t.field === 'desc' ? trTriedImage : trTried; if (on) set.add(t.o); else set.delete(t.o); };
    const chatId = ctx().getCurrentChatId?.();
    const touched = await translateItems(feedId, todo, { target, ...trConnection(), mark, chatId });
    if (!touched.size || ctx().getCurrentChatId?.() !== chatId) return;   // chat switched meanwhile: don't save into the new one
    await saveChatStore();
    if (isOpen() && view === 'feed' && currentFeedId === feedId) {
        // the 번역 button appears with the first translation; afterwards update only the posts that changed
        if (!document.getElementById('stcm_tr_toggle')) showFeed(feedId, { keepScroll: true });
        else for (const i of touched) updatePost(feedId, i);
    }
}

// ---------------------------------------------------------------------------
// One post: 번역 / 원문 toggle, 재번역, 번역 수정
// ---------------------------------------------------------------------------
// Keyed by the post object itself, so deleting or adding posts never moves the choice to another post
const trView = new WeakMap();        // post → true (translation) / false (original); unset = the 번역 bar button
let itemPost = new WeakMap();      // post / comment object → its post (rebuilt on every render)
const trBusy = new WeakSet();      // posts being translated now

function indexItems(feed) {
    itemPost = new WeakMap();
    for (const p of feed?.data.posts ?? []) {
        itemPost.set(p, p);
        for (const cm of p.comments) { itemPost.set(cm, p); for (const r of cm.replies) itemPost.set(r, p); }
    }
}

/** Is this post / comment shown translated right now? */
function trOn(o) {
    const post = itemPost.get(o);
    const v = post ? trView.get(post) : undefined;
    return v ?? showTr;
}

function postHasTr(p) {
    return !!(p.title_tr || [p, ...p.comments, ...p.comments.flatMap(cm => cm.replies)].some(o => postMedia(o).some(m => m.desc_tr)) || p.body_tr || p.body_ko || p.comments.some(cm => cm.body_tr || cm.body_ko || cm.replies.some(r => r.body_tr || r.body_ko)));
}

function postTrItems(p, i, force) {
    const out = [];
    if (String(p.title ?? '').trim() && (force || !p.title_tr)) out.push({ o: p, postIdx: i, field: 'title' });
    for (const o of [p, ...p.comments, ...p.comments.flatMap(cm => cm.replies)]) {
        for (const m of postMedia(o)) if (String(m.desc ?? '').trim() && (force || !m.desc_tr)) out.push({ o: m, postIdx: i, field: 'desc' });
    }
    for (const o of [p, ...p.comments, ...p.comments.flatMap(cm => cm.replies)]) {
        if (String(o.body ?? '').trim() && (force || !(o.body_tr || o.body_ko))) out.push({ o, postIdx: i, field: 'body' });
    }
    return out;
}

async function translatePost(feedId, idx, { force = false } = {}) {
    const feed = getFeed(feedId);
    const post = feed?.data.posts[idx];
    if (!post) return;
    if (trBusy.has(post)) return;
    const todo = postTrItems(post, idx, force);
    if (!todo.length) { trView.set(post, true); updatePost(feedId, idx); return; }
    trBusy.add(post);
    updatePost(feedId, idx);   // shows "번역 중…"
    const chatId = ctx().getCurrentChatId?.();
    try {
        const touched = await translateItems(feedId, todo, { target: trTarget(), ...trConnection(), chatId });
        if (ctx().getCurrentChatId?.() !== chatId) return;   // chat switched meanwhile
        if (touched.size) await saveChatStore();
        else toastr.info('번역할 내용이 없거나, 이미 그 언어예요.');
        trView.set(post, true);
    } catch (e) {
        toastr.error(`번역 실패: ${esc(truncate(String(e?.message ?? e), 300))}`, '커뮤니티');
    } finally {
        trBusy.delete(post);
        const at = getFeed(feedId)?.data.posts.indexOf(post);
        if (at >= 0) updatePost(feedId, at);
    }
}

async function editTranslation(o, field, label) {
    const { Popup } = ctx();
    const cur = field === 'title' ? (o.title_tr ?? '') : (o.body_tr || o.body_ko || '');
    const original = field === 'title' ? o.title : o.body;
    const val = Popup?.show?.input
        ? await Popup.show.input(label, `<small>원문: ${esc(truncate(original, 200))}</small>`, cur, { rows: field === 'title' ? 2 : 8 })
        : prompt(label, cur);
    if (val == null) return false;   // cancelled
    const text = String(val).trim();
    if (field === 'title') o.title_tr = text.slice(0, 500);
    else { o.body_tr = text.slice(0, 8000); delete o.body_ko; }
    return true;
}

function parseOrThrow(fn, raw) {
    try {
        return fn(raw);
    } catch (e) {
        const err = new Error(e.message);
        err.isParse = true;
        err.raw = raw;
        err.cause = e;
        throw err;
    }
}

/** Own key of a lookup table (not "__proto__", "toString"… from the prototype). */
function hasKey(obj, k) {
    return typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);
}

/** Generated posts: their comments and replies were made at the same message as the post. */
function stampGenerated(posts, at, withPost = true) {
    for (const p of posts) {
        if (withPost) p.at = at;
        for (const c of p.comments ?? []) {
            c.at = at;
            for (const r of c.replies ?? []) r.at = at;
        }
    }
}

/** Index of the newest chat message right now. */
function msgNow() { return (ctx().chat?.length ?? 1) - 1; }

/** Last chat message this feed got posts at (it grows as the same board keeps generating). */
function feedLastAt(feed) {
    let at = Number(feed.atMessage) || 0;
    for (const p of feed.data.posts) if (Number.isInteger(p.at) && p.at > at) at = p.at;
    return at;
}

function newFeedObject({ platformId, mode, topic, data }) {
    return {
        id: ctx().uuidv4 ? ctx().uuidv4() : String(Date.now()) + randomId(4),
        platform: platformId,
        mode,
        topic: topic || '',
        lang: resolvedLanguage() || '',   // fixed output language at creation ('' = the community's own)
        boardKey: currentBoardKey() ?? '',   // topic board it belongs to ('' = 자유)
        space: currentSpace(platformId),    // user-made cafe / gallery ('' = 기본)
        createdAt: Date.now(),
        atMessage: (ctx().chat?.length ?? 1) - 1,
        data: data ?? { board: '', posts: [] },
    };
}

/** 지난 피드 개수 제한 (설정, 0 = 없음): drop the oldest feeds over it — never one that is 📌 pinned or has a 👁 watched post.
 *  Returns how many were dropped. */
function pruneFeeds(store, keepId = null) {
    const max = Math.floor(Number(getSettings().maxFeeds) || 0);
    if (max <= 0 || store.feeds.length <= max) return 0;
    const pinned = new Set(store.pins.map(p => p.feedId));
    // the feed just made / written to always stays (the limit may be passed for a while if all others are kept)
    const keep = (f) => f.id === keepId || pinned.has(f.id) || f.data.posts.some(p => p.watch);
    let over = store.feeds.length - max;
    const gone = new Set();
    for (const f of store.feeds) {   // oldest first
        if (over <= 0) break;
        if (keep(f)) continue;
        gone.add(f.id);
        over--;
    }
    if (gone.size) store.feeds = store.feeds.filter(f => !gone.has(f.id));
    return gone.size;
}

async function addFeed(feed, opts = {}) {
    addFeedNow(feed, opts);
    await saveChatStore();
}

/** Put a feed into this chat's list right now (no waiting); saved with the next save. */
function addFeedNow(feed, { remember = true } = {}) {
    const store = getChatStore();
    store.feeds.push(feed);
    pruneFeeds(store, feed.id);   // pinned feeds and the new one are kept, so the 📌 list never changes here
    if (remember) {   // background (auto) feeds don't change which board the panel opens on
        store.lastMode = feed.mode;
        store.lastPlatform = feed.platform;
    }
}

/** Generate a brand new feed. */
const lastAdded = new WeakMap();   // feed → posts the latest generation added (for auto-watch)

async function generateFeed({ mode, platformId, topic = '', background = false }) {
    // Generating again on the same board adds to it (newest on top, older posts behind 과거 글 더보기);
    // on Discord a topic is a server and new channels open there. A changed output language starts afresh.
    const board = latestFeedFor(platformId, mode);
    if (board && (PLATFORMS[platformId]?.chat || feedLang(board) === (resolvedLanguage() || ''))) {
        return generateMorePosts(board.id, topic, { background });
    }
    // where the feed goes is fixed now: picking another board / cafe while the model writes must not move it
    const pick = { boardKey: currentBoardKey() ?? '', space: currentSpace(platformId), lang: resolvedLanguage() || '' };
    return runJob(`${PLATFORMS[platformId].label} 글을 불러오는 중…`, background, async ({ signal, stillSameChat }) => {
        const { system, user, topicNames } = await buildPostsPrompt({ mode, platformId, topic, background });
        const raw = await callModel(system, user, signal);
        if (!stillSameChat()) { toastr.info('채팅이 바뀌어서 결과를 버렸어요.'); return null; }
        const data = parseOrThrow(parseFeed, raw);
        const feed = { ...newFeedObject({ platformId, mode, topic, data }), ...pick };
        stampGenerated(feed.data.posts, feed.atMessage, false);   // the posts go by the feed's own time
        stampBatch(feed, feed.data.posts, true);
        if (spaceById(feed.space)) feed.data.board = spaceById(feed.space).name;
        feed.topics = topicNames;
        await addFeed(feed, { remember: !background });

        if (background) {
            const store = getChatStore();
            if (!isOpen()) { store.unread += 1; await saveChatStore(); }
            toastr.success(`${PLATFORMS[platformId].label}에 새 글이 올라왔어요`, '커뮤니티', { onclick: () => openPanel(feed.id) });
            updateBadge();
            // Don't yank the reader away from what they're reading; only show it if nothing is open
            if (isOpen() && view === 'feed' && !getFeed(currentFeedId) && feed.platform === selPlatform && feed.mode === selMode) showFeed(feed.id);
        } else {
            showFeed(feed.id);
        }
        return feed;
    });
}

/** Background posts landed on the feed being read: show them unless the reader is typing a reply. */
function updatePostsAppended(feed) {
    if (document.activeElement?.closest?.('#stcm_feed .stcm-composer, #stcm_feed .stcm-compose-view')) return;
    showFeed(feed.id, { keepScroll: true });
}

/** Append more posts to an existing feed. */
async function generateMorePosts(feedId, topic = '', { background = false } = {}) {
    const feed = getFeed(feedId);
    if (!feed) return null;
    const chat = !!PLATFORMS[feed.platform]?.chat;
    return runJob(chat ? '새 채널을 여는 중…' : '글을 더 불러오는 중…', background, async ({ signal, stillSameChat }) => {
        const { system, user, topicNames } = await buildPostsPrompt({ mode: feed.mode, platformId: feed.platform, topic, avoidFeed: feed, background });
        if (topicNames.length) feed.topics = [...new Set([...(feed.topics ?? []), ...topicNames])];
        const raw = await callModel(system, user, signal);
        if (!stillSameChat()) return null;
        const data = parseOrThrow(parseFeed, raw);
        if (!getFeed(feed.id)) return null;
        const first = feed.data.posts.length;
        stampGenerated(data.posts, msgNow());   // which chat message they were made at (branches trim by it)
        stampBatch(feed, data.posts, true);     // a new round: the board's older posts get older
        feed.data.posts.push(...data.posts);
        feed.updatedAt = Date.now();
        lastAdded.set(feed, data.posts);
        if (!feed.data.board && data.board) feed.data.board = data.board;
        if (chat && data.posts.length && !background) dsSel.set(feed.id, first);   // open the first new channel
        if (background && !isOpen()) getChatStore().unread += 1;
        await saveChatStore();
        if (background) {
            toastr.success(`${PLATFORMS[feed.platform].label}에 ${chat ? `새 채널 ${data.posts.length}개` : `새 글 ${data.posts.length}개`}가 생겼어요`, '커뮤니티', { onclick: () => openPanel(feed.id) });
            updateBadge();
            if (isOpen() && view === 'feed' && currentFeedId === feed.id) updatePostsAppended(feed);
        } else {
            if (isOpen()) {
                showFeed(feed.id, chat ? {} : { keepScroll: true });
                // boards list the newest on top: go up to the new posts
                if (!chat && view === 'feed' && currentFeedId === feed.id) document.getElementById('stcm_feed')?.scrollTo({ top: 0, behavior: 'smooth' });
            }
            toastr.success(chat ? `새 채널 ${data.posts.length}개가 열렸어요.` : `새 글 ${data.posts.length}개가 맨 위에 올라왔어요.`, '', { timeOut: 1500 });
        }
        return feed;
    });
}

// ---------------------------------------------------------------------------
// Thread caps (2ch / Reddit) and follow-up threads
// ---------------------------------------------------------------------------
function threadCap(platformId) {
    if (!PLATFORMS[platformId]?.capped) return Infinity;
    return Math.max(10, Number(getSettings().threadCap) || 1000);
}

/** Posts in a thread, counting the opener as #1. */
function threadCount(post) {
    return 1 + post.comments.length + post.comments.reduce((a, c) => a + c.replies.length, 0);
}

function isThreadFull(feed, post) {
    return threadCount(post) >= threadCap(feed.platform);
}

async function generateNextThread(feedId, postIdx, { background = false } = {}) {
    const feed = getFeed(feedId);
    const prev = feed?.data.posts[postIdx];
    if (!prev) return null;
    if (prev.nextIdx != null && feed.data.posts[prev.nextIdx]) {
        if (!background) scrollToPostSmooth(prev.nextIdx);
        return feed;
    }
    const part = (Number(prev.part) || 1) + 1;
    const count = Math.max(1, Number(getSettings().continueCount) || 5);
    return runJob('후속 스레를 세우는 중…', background, async ({ signal, stillSameChat }) => {
        if (prev.nextIdx != null && feed.data.posts[prev.nextIdx]) return feed;   // made meanwhile
        const b = commonBlocks(feed.mode, feed.platform, feedLang(feed), feedSpace(feed));
        const storyText = await buildContextBlock();
        const user = [
            `<story_context>\n${storyText}\n</story_context>`,
            `<task>\n${b.task}\n</task>`,
            `<platform_style>\n${b.style}\n</platform_style>`,
            crossRefOn(prev) ? buildCrossRefBlock(feed.platform, feed.mode, prev) : '',
            `<thread>\n${serializeThread(feed, postIdx)}\n</thread>`,
            `<continue>\n${fillTpl(getPrompt('thread_next'), { ...b.vars, count, part, cap: threadCap(feed.platform) })}\n</continue>`,
            `<language>\n${b.language}\n</language>`,
            b.extra ? `<extra_instructions>\n${b.extra}\n</extra_instructions>` : '',
            getPrompt('format_posts'),
        ].filter(Boolean).join('\n\n');
        const raw = await callModel(b.system, user, signal);
        if (!stillSameChat()) return null;
        const data = parseOrThrow(parseFeed, raw);
        const next = data.posts[0];
        if (!next) throw new Error('후속 스레가 비어 있어요');
        if (!getFeed(feed.id)) return null;
        postIdx = feed.data.posts.indexOf(prev);
        if (postIdx < 0) return null;
        next.part = part;
        next.prevIdx = postIdx;
        if (!next.title) next.title = `${prev.title || ''} Part${part}`.trim();
        // settings carry over to the new thread; watching moves along
        if (prev.watch) { next.watch = true; delete prev.watch; }
        if (prev.crossRef) next.crossRef = true;
        stampGenerated([next], msgNow());
        stampBatch(feed, [next], true);
        feed.data.posts.push(next);
        prev.nextIdx = feed.data.posts.length - 1;
        await saveChatStore();
        if (isOpen() && view === 'feed' && currentFeedId === feed.id) showFeed(feed.id, { keepScroll: true });
        toastr.success(background ? `후속 스레가 섰어요: ${esc(truncate(next.title, 40))}` : '후속 스레가 섰어요. "다음 스레" 링크로 이동할 수 있어요.', '', { timeOut: 2500 });
        return feed;
    });
}

/** Append more comments to a post (continuation, or reaction to the player). */
async function generateMoreComments(feedId, postIdx, { playerJustPosted = false, background = false } = {}) {
    const feed = getFeed(feedId);
    if (!feed?.data.posts[postIdx]) return null;
    if (isThreadFull(feed, feed.data.posts[postIdx])) return generateNextThread(feedId, postIdx, { background });
    const room = threadCap(feed.platform) - threadCount(feed.data.posts[postIdx]);
    const count = Math.max(1, Math.min(room, Number(getSettings().continueCount) || 5));
    const label = playerJustPosted ? '반응을 기다리는 중…' : (PLATFORMS[feed.platform].thread ? '스레드를 이어가는 중…' : '댓글을 더 불러오는 중…');
    const postRef = feed.data.posts[postIdx];
    return runJob(label, background, async ({ signal, stillSameChat }) => {
        // the model answers "reply_to" with the comment numbers it was shown; `shown` is which comment each was,
        // taken when the prompt was written, so a comment deleted before or after can't shift a reply
        const { system, user, shown } = await buildContinuePrompt({ feed, postIdx: feed.data.posts.indexOf(postRef), count, playerJustPosted });
        const raw = await callModel(system, user, signal);
        if (!stillSameChat()) return null;
        const list = parseOrThrow(parseComments, raw);
        // the post (or its feed) may have been deleted or moved while generating
        if (!getFeed(feed.id)) return null;
        postIdx = feed.data.posts.indexOf(postRef);
        if (postIdx < 0) return null;
        const post = postRef;
        const flat = !!PLATFORMS[feed.platform]?.flat;
        const chat = !!PLATFORMS[feed.platform]?.chat;
        const at = msgNow();
        for (const c of list) {
            if (isThreadFull(feed, post)) break;
            const { reply_to, ...item } = c;
            item.at = at;   // branches drop comments made after their branch point
            if (post.kind === 'dm' && !item.author) item.author = dmSideName(post.dm?.partner);
            // where that comment is now (-1: deleted meanwhile → a plain comment)
            const target = reply_to >= 0 && reply_to < shown.length ? post.comments.indexOf(shown[reply_to]) : -1;
            if (!flat && target >= 0) {
                post.comments[target].replies.push(item);
            } else {
                if (chat && target >= 0) item.ref = target;
                post.comments.push({ ...item, replies: [] });
            }
        }
        postRef.autoAt = Date.now();
        if (background && !isOpen()) { const st = getChatStore(); st.unread = (st.unread || 0) + 1; updateBadge(); }
        await saveChatStore();
        updatePost(feed.id, postIdx);
        if (isPinned(feed.id, postIdx)) refreshInjection();   // pinned text includes the newest replies
        return feed;
    });
}

// ---------------------------------------------------------------------------
// Player posts & comments
// ---------------------------------------------------------------------------
function playerItem(platformId, { as, nick, charName, body, title }, langName = resolvedLanguage()) {
    const userName = ctx().name1 || 'User';
    const p = PLATFORMS[platformId];
    const anon = uiWords(platformId, langName)?.anon?.[platformId] ?? p.anon;
    const author = nick?.trim() || (as === 'user' ? userName : as === 'char' ? charName : anon);
    let handle = '';
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    if (platformId === 'fivech') handle = randomId(8);
    else if (TD_SKINS[platformId]?.codes) handle = randomId(4);
    else if (platformId === 'twitter') handle = nick?.trim() || as !== 'mob' ? author.replace(/\s+/g, '_') : `user${digits}${randomId(3).toLowerCase()}`;
    else if (platformId === 'reddit') handle = nick?.trim() || as !== 'mob' ? author.replace(/\s+/g, '_') : `throwaway_${digits}`;
    const item = { isMe: true, as, author, handle, body, body_tr: '', time: nowLabel(platformId, langName), likes: 0 };
    if (as === 'char') item.charName = charName;
    if (title !== undefined) Object.assign(item, { title, tags: [], views: 1, shares: 0, comments: [] });
    return item;
}

// ---------------------------------------------------------------------------
// Nicknames: an empty box gets a community-style name; the same identity keeps its name inside one post
// ---------------------------------------------------------------------------
// Communities where everyone is anonymous by design: the platform default (ㅇㅇ, 名無しさん, 익명…) is the right name
const ANON_PLATFORMS = new Set(['dcinside', 'tdgall', 'kkangtong', 'fivech', 'everytime']);
const NICK_WORDS = {
    ko: {
        a: ['달달한', '졸린', '행복한', '반짝이는', '수줍은', '바삭한', '포근한', '말랑한', '심심한', '용감한', '느긋한', '새벽의', '작은', '푸른', '노란', '배고픈', '조용한', '까칠한', '엉뚱한', '따뜻한'],
        n: ['우유', '고양이', '곰돌이', '토끼', '구름', '별빛', '감자', '호떡', '펭귄', '다람쥐', '복숭아', '붕어빵', '민트', '도토리', '햄스터', '여우', '라떼', '고등어', '두부', '해파리'],
    },
    en: {
        a: ['quiet', 'lazy', 'salty', 'curious', 'sleepy', 'random', 'lost', 'brave', 'cosmic', 'grumpy', 'tiny', 'midnight', 'spicy', 'gentle', 'rusty'],
        n: ['otter', 'potato', 'pancake', 'falcon', 'badger', 'noodle', 'walrus', 'pickle', 'mango', 'raccoon', 'comet', 'teapot', 'gecko', 'biscuit', 'lantern'],
    },
    ja: {
        a: ['ねむい', 'ゆるい', 'しずかな', 'まったり', 'ひとりぼっちの', 'はらぺこ', 'ちいさな'],
        n: ['ねこ', 'たぬき', 'おにぎり', 'ペンギン', 'うさぎ', 'みかん', 'くらげ'],
    },
    zh: {
        a: ['熬夜的', '快乐的', '吃瓜的', '咸鱼', '佛系', '暴躁', '安静的', '爱笑的'],
        n: ['小熊', '奶茶', '柠檬', '橘猫', '汤圆', '饺子', '星星', '兔子'],
    },
};
const BLIND_ORGS = ['IT 스타트업', '중견기업', '대기업', '공기업', '외국계', '금융권', '공무원', '대학병원', '게임회사', '제조업', '유통업', '컨설팅', '연구소', '스타트업'];

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

/** Language the community is being written in, as ko / en / ja / zh. */
function nickLang(platformId, langName) {
    const code = langCode(langName);
    if (code && code !== 'other') return code;
    return NATIVE_LANG[platformId] ?? 'ko';
}

/** Instant random name in the community's style: { author, handle }. */
function randomNick(platformId, langName) {
    const lang = nickLang(platformId, langName);
    const w = NICK_WORDS[lang] ?? NICK_WORDS.ko;
    const digits = () => String(Math.floor(10 + Math.random() * 9990));
    const en = NICK_WORDS.en;
    const handleEn = () => `${pick(en.a)}_${pick(en.n)}${digits()}`;
    switch (platformId) {
        case 'blind': return { author: pick(BLIND_ORGS), handle: randomId(5) };
        case 'reddit': {
            const h = `${cap(pick(en.a))}_${cap(pick(en.n))}_${digits()}`;
            return { author: h, handle: h };
        }
        case 'twitter': return { author: lang === 'en' ? `${cap(pick(en.a))} ${cap(pick(en.n))}` : `${pick(w.a)}${pick(w.n)}`, handle: handleEn() };
        case 'discord': return { author: lang === 'en' ? `${pick(en.a)}${pick(en.n)}` : `${pick(w.n)}${Math.random() < 0.5 ? digits() : ''}`, handle: '' };
        default: {
            const sep = lang === 'en' ? '_' : '';
            return { author: `${pick(w.a)}${sep}${pick(w.n)}${Math.random() < 0.35 ? digits() : ''}`, handle: '' };
        }
    }
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/** Handle that goes with an anonymous / typed name (IP fragment, ID, code…). */
function anonHandle(platformId) {
    if (platformId === 'dcinside') return `${Math.floor(1 + Math.random() * 222)}.${Math.floor(Math.random() * 256)}`;
    if (platformId === 'fivech') return randomId(8);
    if (TD_SKINS[platformId]?.codes) return randomId(4);
    if (platformId === 'blind') return randomId(5);
    return '';
}

/** Latest name this identity used in one post (post itself, comments, replies). */
function nickInPost(post, { as, charName }) {
    let found = null;
    const check = (o) => {
        if (!o?.isMe || o.as !== as) return;
        if (as === 'char' && (o.charName || '') !== (charName || '')) return;
        found = { author: o.author, handle: o.handle ?? '' };
    };
    check(post);
    for (const cm of post?.comments ?? []) { check(cm); for (const r of cm.replies ?? []) check(r); }
    return found;
}

/**
 * The name this identity already uses here: inside the post — or, on Discord, anywhere in the server
 * (one person keeps one name across channels; DMs don't count).
 */
function rememberedNick(post, identity, feed = null) {
    const chat = !!(feed && PLATFORMS[feed.platform]?.chat);
    if (!post && !chat) return null;
    const own = post ? nickInPost(post, identity) : null;
    if (own || !chat) return own;
    let hit = null;
    for (const p of feed.data.posts) if (p.kind !== 'dm') hit = nickInPost(p, identity) ?? hit;
    return hit;
}

/** Ask the model for one fitting name (AI mode); null when it fails. */
async function aiNick({ platformId, identity, text, langName }) {
    const lang = LANG_LABEL[nickLang(platformId, langName)] ?? 'Korean';
    const system = 'You invent usernames for online communities. Reply with JSON only.';
    const user = [
        `Community: ${PLATFORMS[platformId]?.name}`,
        `Poster: ${describeAuthor({ ...identity, nick: '' }, platformId)}`,
        text ? `What they are posting: ${truncate(text, 500)}` : '',
        `Make ONE display name / username that this person would plausibly use on this community, matching their personality and the community's naming culture, written the way ${lang}-speaking users of it would. Do not use their real name. ${platformId === 'blind' ? 'On Blind the display name is the workplace (company / organization type) and the handle is a short random code.' : ''}`,
        'JSON: {"nickname": "...", "handle": "username/@id if the community shows one, else empty"}',
    ].filter(Boolean).join('\n');
    try {
        const raw = await callModel(system, user, null, getSettings().profileId, '');
        const d = extractJson(raw);
        const author = String(d?.nickname ?? '').replace(/[\n\r]/g, ' ').trim().slice(0, 40);
        if (!author) return null;
        const handle = String(d?.handle ?? '').replace(/[\s@]/g, '').slice(0, 40);
        return { author, handle };
    } catch (e) {
        console.warn(`[${MODULE}] AI nickname failed`, e);
        return null;
    }
}

/**
 * Name + handle for something the player writes. Typed nickname → used as is. Otherwise the name this identity
 * already has in the post, else the community default (anonymous boards) or a new random / AI name.
 */
async function resolveNick({ feed, post = null, identity, text = '', item }) {
    const pid = feed.platform;
    const typed = identity.nick?.trim();
    const prev = rememberedNick(post, identity, feed);
    if (typed) {   // playerItem already used the typed name; same name as before in this post → same handle / ID too
        if (prev && prev.author === typed) item.handle = prev.handle;
        else if (ANON_PLATFORMS.has(pid) || pid === 'blind') item.handle = item.handle || anonHandle(pid);
        return;
    }
    if (prev?.author) { item.author = prev.author; item.handle = prev.handle; return; }
    if (NUMBERED_ANON[pid]) { if (!post) item.author = NUMBERED_ANON[pid].base; return; }   // a new post is 익명 / 깡; comments are numbered by the caller
    if (ANON_PLATFORMS.has(pid)) {
        // anonymous boards: nobody shows a real name — ㅇㅇ / 名無しさん / 익명 with a fresh ID
        item.author = uiWords(pid, feedLang(feed))?.anon?.[pid] ?? PLATFORMS[pid].anon;
        item.handle = anonHandle(pid);
        return;
    }
    const lang = feedLang(feed);
    let got = null;
    if (getSettings().nickMode === 'ai') {
        const showPill = !busy;   // don't touch the pill of a generation that is running
        if (showPill) setBusyUI(true, '닉네임 짓는 중…');
        try { got = await aiNick({ platformId: pid, identity, text, langName: lang }); } finally { if (showPill) setBusyUI(false); }
    }
    got ??= randomNick(pid, lang);
    item.author = got.author;
    item.handle = got.handle || (pid === 'reddit' || pid === 'twitter' ? got.author.replace(/\s+/g, '_') : item.handle);
}

async function rememberIdentity(id) {
    setIdentity(id);
    await saveChatStore();
}

/** The identity the composer starts with next time (this chat's metadata; saved with the next save). */
function setIdentity({ as, nick, charName }) {
    const store = getChatStore();
    // board-given labels (익명3, 깡2, 글쓴 깡…) belong to one post; don't carry them as your nickname
    const keep = Object.keys(NUMBERED_ANON).some(pf => isAnonLabel(pf, nick)) ? '' : (nick ?? '');
    store.identity = { as, nick: keep, charName: charName ?? store.identity?.charName ?? '' };
}

/** Validate identity; returns false if a character name is required but missing. */
function checkIdentity(id) {
    if (id.as === 'char' && !id.charName?.trim()) {
        toastr.warning('어느 캐릭터로 쓸지 이름을 적어 주세요.');
        return false;
    }
    return true;
}

async function submitPlayerPost(args) {
    if (submitting) return;
    submitting = true;
    try { await submitPlayerPostNow(args); } finally { submitting = false; }
}

async function submitPlayerPostNow({ title, body, identity, react, board, category, media = [], draftId = '' }) {
    if (!body.trim()) { toastr.warning('내용을 입력해 주세요.'); return; }
    if (!(await ensureFeedsReady())) return;
    if (!checkIdentity(identity)) return;

    // Which copy this goes into is fixed now; the only wait (an AI nickname) comes before anything is changed
    const start = workTarget();
    let feed = getFeed(currentFeedId);   // the board on screen when it matches the selection, else a new feed
    const isNew = !feedMatchesSelection(feed);
    if (isNew) feed = newFeedObject({ platformId: selPlatform, mode: selMode, data: { board: spaceById(currentSpace(selPlatform))?.name || board?.trim() || '', posts: [] } });
    const pf = PLATFORMS[feed.platform];
    // 익명 / 깡 / 깡3… in the box is a board-given label, not a chosen name: a new post gets the board's own
    if (isAnonLabel(feed.platform, identity.nick)) identity = { ...identity, nick: '' };
    const post = playerItem(feed.platform, { ...identity, body: body.trim(), title: pf.hasTitle || pf.chat ? (title.trim() || (pf.chat ? '잡담' : '')) : '' }, feedLang(feed));
    if (category) post.tags = [category];
    const att = cleanMedia({ media });
    if (att.length) post.media = att;
    await resolveNick({ feed, identity, text: `${title}\n${body}`, item: post });   // may wait for an AI nickname

    // still the same chat, the same loaded copy, the same board? Otherwise nothing is written anywhere:
    // the text is kept for the write form
    if (!stillTarget(start, isNew ? [] : [feed])) {
        forgetComposeForm(start.chatId);   // the kept record takes it over (no second copy in the form memory)
        keepPostDraft(start.chatId, { id: draftId, title, body, media: att, identity, react, board, category, platform: feed.platform, mode: feed.mode, feedId: isNew ? '' : feed.id, space: feedSpace(feed), boardKey: feedBoardKey(feed), madeAt: Date.now() });
        return;
    }
    // from here on no waiting until everything is in this chat's list
    post.at = msgNow();
    stampBatch(feed, [post], false);   // your post joins the newest round ("방금"); it ages with the next one
    if (isNew) addFeedNow(feed);
    setIdentity(identity);
    feed.data.posts.push(post);
    dropUnposted(start.chatId, draftId);   // a kept post that is now posted
    forgetComposeForm(start.chatId);
    const postIdx = feed.data.posts.length - 1;
    if (pf.chat) dsSel.set(feed.id, postIdx);
    openPosts.add(`${feed.id}:${postIdx}`);   // your own new post opens right away
    await saveChatStore();   // the file write is scheduled before this waits
    if (!stillTarget(start, [feed], post)) return;   // saved for its chat; no drawing / reactions in another one
    const at = feed.data.posts.indexOf(post);   // a post above may have been deleted during the wait
    showFeed(feed.id, { scrollToPost: at });
    if (react) await generateMoreComments(feed.id, at, { playerJustPosted: true });
}

/** Boards that number anonymous commenters per post (익명1, 익명2… / 깡1, 깡2…). op: what the post's own writer shows as. */
const NUMBERED_ANON = { everytime: { base: '익명', op: '익명(글쓴이)' }, kkangtong: { base: '깡', op: '글쓴 깡' } };

/** 익명 / 깡 / 익명N / 깡N / writer label: names the board gives out, not ones you chose. */
function isAnonLabel(platform, name) {
    const cfg = NUMBERED_ANON[platform];
    const n = String(name ?? '').trim();
    return !!cfg && (n === cfg.base || n === cfg.op || new RegExp(`^${cfg.base}\\d+$`).test(n));
}

/** A name you typed yourself earlier in this post (not a board-given label) — it is kept. */
function customNickInPost(post, identity, feed) {
    const prev = rememberedNick(post, identity, feed)?.author;
    return !!prev && !isAnonLabel(feed.platform, prev);
}

/** What the nickname box shows for this identity in a post: your own earlier name, but not a board-given label
 *  (that one is worked out again when you post, e.g. 글쓴 깡 on your own post). */
function prefillNick(post, identity, feed) {
    const prev = rememberedNick(post, identity, feed)?.author ?? '';
    return feed && isAnonLabel(feed.platform, prev) ? '' : prev;
}

/** Your comment's name there: the post's own writer (same identity) → its writer label; else the number this
 *  identity already has in the post, or the next one. */
function numberedName(post, platform = 'everytime', identity = null) {
    const cfg = NUMBERED_ANON[platform] ?? NUMBERED_ANON.everytime;
    const same = (o) => !identity || (o?.as === identity.as && (identity.as !== 'char' || (o.charName || '') === (identity.charName || '')));
    if (post.isMe && cfg.op && same(post)) return cfg.op;
    const re = new RegExp(`^${cfg.base}(\\d+)$`);
    const all = post.comments.flatMap(cm => [cm, ...cm.replies]);
    const mine = all.find(o => o.isMe && same(o) && re.test(o.author ?? ''));
    if (mine) return mine.author;
    const max = all.reduce((m, o) => Math.max(m, Number(re.exec(o.author ?? '')?.[1] ?? 0)), 0);
    return `${cfg.base}${max + 1}`;
}

/** What a player's text is being written into: this chat and the copy of its feeds loaded now. */
function workTarget() {
    return { chatId: feedState.chatId, gen: feedState.gen };
}

/** After a wait: is it still that chat, that loaded copy, and are the feed / post still in it? (A chat switch,
 *  a re-open, an import "바꾸기" or a deletion all fail this — then nothing is written into a stale copy.) */
function stillTarget(start, feeds = [], post = null) {
    if (feedState.chatId !== start.chatId || feedState.gen !== start.gen || !feedState.ready) return false;
    if (ctx().getCurrentChatId?.() !== start.chatId) return false;
    if (feeds.some(f => !feedState.feeds.includes(f))) return false;
    return !post || feeds.some(f => f.data.posts.includes(post));
}

/** Posts / comments that couldn't be placed (the chat or feed changed while they were being sent), kept per chat
 *  until this page is closed: chatId → { posts: [...], comments: [...] }. A record stays until it is posted or
 *  thrown away (filling a form with it doesn't remove it); nothing is written over another one. */
const unposted = new Map();
function unpostedOf(chatId) {
    if (!unposted.has(chatId)) unposted.set(chatId, { posts: [], comments: [] });
    return unposted.get(chatId);
}
function findUnposted(chatId, id) {
    const u = unposted.get(chatId);
    return u?.posts.find(d => d.id === id) ?? u?.comments.find(d => d.id === id) ?? null;
}
/** A kept record by its id, in whichever chat it belongs to. */
function findUnpostedAny(id) {
    for (const chatId of unposted.keys()) {
        const d = findUnposted(chatId, id);
        if (d) return d;
    }
    return null;
}

/** Edits made in a form that was filled from a kept record go into that record (so a later visit shows them). */
function syncComposeDraft(view) {
    const d = view?.dataset?.draft ? findUnpostedAny(view.dataset.draft) : null;
    if (!d) return;
    Object.assign(d, {
        title: view.querySelector('.stcm-cp-title')?.value ?? d.title,
        body: view.querySelector('.stcm-cp-body')?.value ?? d.body,
        media: readMediaRows(view),
        board: view.querySelector('.stcm-cp-board')?.value ?? d.board,
        category: view.querySelector('.stcm-cp-cat')?.value ?? d.category,
        react: view.querySelector('.stcm-cp-react')?.checked ?? d.react,
        identity: readIdentity(view),
    });
}
function syncCommentDraft() {
    const d = composer?.draft?.unpostedId ? findUnpostedAny(composer.draft.unpostedId) : null;
    if (!d) return;
    d.body = composer.draft.body ?? d.body;
    if (Array.isArray(composer.draft.media)) d.media = cleanMedia({ media: composer.draft.media });
    if (composer.draft.react != null) d.react = composer.draft.react;
    if (composer.draft.as) d.identity = { as: composer.draft.as, nick: composer.draft.nick ?? '', charName: composer.draft.charName ?? '' };
    // the comment it answers (or none) as it is now
    const post = getFeed(composer.feedId)?.data.posts[composer.postIdx];
    if (post) {
        const c = composer.replyTo != null ? post.comments[composer.replyTo] : null;
        d.reply = c ? { author: c.author, body: c.body, handle: c.handle ?? '', time: c.time ?? '' } : null;
    }
}

function dropUnposted(chatId, id) {
    const u = unposted.get(chatId);
    if (!u || !id) return;
    u.posts = u.posts.filter(d => d.id !== id);
    u.comments = u.comments.filter(d => d.id !== id);
    if (!u.posts.length && !u.comments.length) unposted.delete(chatId);
}
function keepUnposted(list, d) {
    const rec = { ...d, id: d.id || `u${Date.now().toString(36)}${randomId(4)}`, shown: false };
    const k = list.findIndex(x => x.id === rec.id);
    if (k >= 0) list[k] = rec; else list.push(rec);
    return rec;
}

/** A kept post / comment as plain text: title, body and its photos / videos. */
function draftText(d) {
    const media = cleanMedia(d).map(m => `[${m.type === 'video' ? '영상' : '사진'}] ${m.desc}`);
    return [d.title, d.body, ...media].map(x => String(x ?? '').trim()).filter(Boolean).join('\n\n');
}

/** Copy the whole text (a fallback when there is nowhere to put it back). */
function copyText(text) {
    navigator.clipboard?.writeText(text).then(() => toastr.success('복사했어요.', '', { timeOut: 1500 }), () => toastr.error('복사하지 못했어요.'));
}

/** Where a post draft was going: "네이버 카페 · 세계관 속 · 별빛 카페 · 공포판". */
function draftWhere(d) {
    const sp = d.space ? spaceById(d.space)?.name : '';
    return [PLATFORMS[d.platform]?.label ?? d.platform, MODES[d.mode]?.label ?? d.mode, sp, d.boardKey ? boardName(d.boardKey, d.platform) : ''].filter(Boolean).join(' · ');
}

function keepPostDraft(chatId, d) {
    const rec = keepUnposted(unpostedOf(chatId).posts, d);
    toastr.warning(`그 사이 채팅이나 피드가 바뀌어서 글을 올리지 않았어요. 그 채팅에서 원래 올리던 곳(${esc(draftWhere(rec))})의 글쓰기 창을 열면 쓴 내용이 그대로 다시 채워져요. (눌러서 전체 복사)`, '커뮤니티', { timeOut: 10000, onclick: () => copyText(draftText(rec)) });
}

function keepCommentDraft(chatId, d) {
    keepUnposted(unpostedOf(chatId).comments, d);
    toastr.warning(`그 사이 채팅이나 피드가 바뀌어서 댓글을 올리지 않았어요. 그 채팅에서 원래 글이 있는 피드를 열면 댓글 창에 그대로 다시 채워져요. (눌러서 전체 복사)<br><small>${esc(truncate(draftText(d), 120))}</small>`, '커뮤니티', { timeOut: 15000, escapeHtml: false, onclick: () => copyText(draftText(d)) });
}

/** The same item as before: the only one that matches. -1: not there; -2: several look the same (don't guess —
 *  an old index proves nothing once something above it was deleted). */
function pickLike(list, same) {
    let found = -1;
    for (let i = 0; i < list.length; i++) {
        if (!same(list[i])) continue;
        if (found >= 0) return -2;
        found = i;
    }
    return found;
}

/** The post a comment was written on (the loaded copy may be a new one): its index now, -1 gone, -2 unclear. */
function findPostLike(feed, key) {
    return pickLike(feed.data.posts, p => !!p && (p.title ?? '') === key.title && p.body === key.body && (p.author ?? '') === key.author && (p.time ?? '') === (key.time ?? p.time ?? ''));
}

/** Put a kept comment back into its comment box. Returns the post index, or null when its post can't be told. */
function openCommentDraft(feed, d) {
    const idx = findPostLike(feed, d.post);
    if (idx < 0) return null;
    const post = feed.data.posts[idx];
    const ri = d.reply ? pickLike(post.comments, c => !!c && c.author === d.reply.author && c.body === d.reply.body && (c.handle ?? '') === (d.reply.handle ?? c.handle ?? '') && (c.time ?? '') === (d.reply.time ?? c.time ?? '')) : -1;
    const chatLike = PLATFORMS[feed.platform]?.chat;
    d.shown = true;
    composer = { cid: newComposerId(), feedId: feed.id, postIdx: idx, replyTo: ri >= 0 ? ri : null, place: ri >= 0 && !chatLike ? `c${ri}` : 'end', draft: { body: d.body, react: d.react, media: d.media ?? [], ...d.identity, unpostedId: d.id } };
    openPosts.add(`${feed.id}:${idx}`);
    const why = !d.reply || ri >= 0 ? ''
        : ri === -2 ? ' (같은 내용의 댓글이 여러 개라 어느 댓글에 답글을 달던 건지 알 수 없어서, 일반 댓글로 들어가요. 답글로 달려면 그 댓글의 "답글"을 눌러 주세요)'
        : ' (답글 달던 댓글이 없어져서 일반 댓글로 들어가요)';
    toastr.info(`올리지 못했던 댓글을 다시 채워 뒀어요.${why}`, '', { timeOut: why ? 7000 : 3500 });
    return idx;
}

/** Opening a feed: a kept comment goes back into its box once per visit to the chat (not again after closing it). */
function restoreCommentDraft(feed) {
    const u = unposted.get(feedState.chatId);
    if (!u?.comments.length || !feed || composer) return null;
    for (const d of u.comments) {
        if (d.shown || d.feedId !== feed.id) continue;
        const idx = openCommentDraft(feed, d);
        d.shown = true;   // its post gone / unclear: it stays in the list above the posts instead
        if (idx != null) return idx;
    }
    return null;
}

/** Kept comments of this feed (or of a feed that is gone) that aren't in a comment box: listed above the posts. */
function unpostedNotice(feed) {
    const u = unposted.get(feedState.chatId);
    // (a comment box whose feed is gone doesn't count as holding it)
    const inBox = composer && getFeed(composer.feedId) ? composer.draft?.unpostedId : null;
    const list = (u?.comments ?? []).filter(d => (d.feedId === feed?.id || !getFeed(d.feedId)) && inBox !== d.id);
    if (!list.length) return '';
    return `<div class="stcm-unposted">${list.map(d => {
        const here = feed && d.feedId === feed.id ? findPostLike(feed, d.post) : -1;
        const where = here >= 0 ? '' : here === -2 ? ' <small>(같은 글이 여러 개라 원래 글을 알 수 없어요)</small>' : !getFeed(d.feedId) ? ' <small>(원래 피드가 없어졌어요)</small>' : ' <small>(원래 글이 없어졌어요)</small>';
        const id = esc(d.id);
        return `<div class="row"><i class="fa-regular fa-comment-dots"></i><span class="tx"><b>올리지 못한 댓글</b>${where} ${esc(truncate(draftText(d), 80))}</span>
            ${here >= 0 ? `<a class="stcm-link" data-act="unposted-open" data-draft="${id}">다시 쓰기</a>` : ''}
            <a class="stcm-link" data-act="unposted-copy" data-draft="${id}">복사</a>
            <a class="stcm-link" data-act="unposted-drop" data-draft="${id}">버리기</a></div>`;
    }).join('')}</div>`;
}

let submitting = false;   // one player post / comment at a time (an AI nickname can take a moment)

async function submitPlayerComment(args) {
    if (submitting) return;
    submitting = true;
    try { await submitPlayerCommentNow(args); } finally { submitting = false; }
}

async function submitPlayerCommentNow({ feedId, postIdx, replyTo, body, identity, react, media = [], draftId = '' }) {
    const feed = getFeed(feedId);
    const post = feed?.data.posts[postIdx];
    if (!post) return;
    const att = commentMediaOn(feed, post) ? cleanMedia({ media }) : [];
    if (!body.trim() && !att.length) { toastr.warning('내용을 입력해 주세요.'); return; }
    if (!checkIdentity(identity)) return;
    if (isThreadFull(feed, post)) { toastr.warning('이 스레드는 꽉 찼어요. 후속 스레에 써 주세요.'); return; }

    // fixed now: the copy, the post and the comment replied to (the object, not its number)
    const start = workTarget();
    const replyTarget = replyTo != null && replyTo >= 0 ? post.comments[replyTo] ?? null : null;
    const item = playerItem(feed.platform, { ...identity, body: body.trim() }, feedLang(feed));
    if (att.length) item.media = att;
    if (post.kind === 'dm') { /* a DM's sender name is fixed by the DM itself */ }
    else if (NUMBERED_ANON[feed.platform] && (!identity.nick?.trim() || isAnonLabel(feed.platform, identity.nick)) && !customNickInPost(post, identity, feed)) item.author = numberedName(post, feed.platform, identity);
    else await resolveNick({ feed, post, identity, text: body, item });   // may wait for an AI nickname

    if (!stillTarget(start, [feed], post)) {
        keepCommentDraft(start.chatId, {
            id: draftId,
            feedId: feed.id,
            post: { title: post.title ?? '', body: post.body, author: post.author ?? '', time: post.time ?? '' },
            reply: replyTarget ? { author: replyTarget.author, body: replyTarget.body, handle: replyTarget.handle ?? '', time: replyTarget.time ?? '' } : null,
            body: body.trim(), media: att, identity: { as: identity.as, nick: identity.nick ?? '', charName: identity.charName ?? '' }, react,
        });
        return;
    }
    // no waiting from here until the comment is in the list
    item.at = msgNow();
    setIdentity(identity);
    const ri = replyTarget ? post.comments.indexOf(replyTarget) : -1;   // -1: deleted meanwhile → a plain comment
    if (ri >= 0 && !PLATFORMS[feed.platform]?.flat) {
        post.comments[ri].replies.push(item);
    } else {
        const c = { ...item, replies: [] };
        if (PLATFORMS[feed.platform]?.chat && ri >= 0) c.ref = ri;
        post.comments.push(c);
    }
    composer = null;
    dropUnposted(start.chatId, draftId);   // a kept comment that is now posted
    await saveChatStore();   // the file write is scheduled before this waits
    if (!stillTarget(start, [feed], post)) return;   // saved for its chat; no drawing / reactions in another one
    postIdx = feed.data.posts.indexOf(post);   // a post above may have been deleted during the wait
    updatePost(feed.id, postIdx);
    if (isPinned(feed.id, postIdx)) refreshInjection();
    if (react) await generateMoreComments(feed.id, postIdx, { playerJustPosted: true });
}

async function deleteItem(feedId, postIdx, ci, ri) {
    const feed = getFeed(feedId);
    const post = feed?.data.posts[postIdx];
    if (!post) return;
    const target = ci == null ? post : (ri == null ? post.comments[ci] : post.comments[ci]?.replies[ri]);
    if (!target) return;   // generated posts / comments can be deleted as well as your own
    if (ci == null) {
        // Delete the whole post (generated or your own); drop pins pointing at it and shift later ones
        feed.data.posts.splice(postIdx, 1);
        for (const p of feed.data.posts) {
            for (const k of ['prevIdx', 'nextIdx']) {
                if (p[k] == null) continue;
                if (p[k] === postIdx) delete p[k];
                else if (p[k] > postIdx) p[k] -= 1;
            }
        }
        const store = getChatStore();
        store.pins = store.pins
            .filter(p => !(p.feedId === feedId && p.postIdx === postIdx))
            .map(p => (p.feedId === feedId && p.postIdx > postIdx) ? { ...p, postIdx: p.postIdx - 1 } : p);
        if (composer?.feedId === feedId) {
            if (composer.postIdx === postIdx) composer = null;
            else if (composer.postIdx > postIdx) composer.postIdx -= 1;
        }
        // view state keyed by post index (Discord pane, expanded rows)
        const sel = dsSel.get(feedId);
        if (Number.isInteger(sel) && sel >= postIdx) dsSel.set(feedId, Math.max(0, sel - (sel > postIdx ? 1 : 0)));
        for (const key of [...openPosts]) {
            const [fid, n] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))];
            if (fid !== feedId || n < postIdx) continue;
            openPosts.delete(key);
            if (n > postIdx) openPosts.add(`${fid}:${n - 1}`);
        }
        refreshInjection();
    } else if (ri == null) {
        post.comments.splice(ci, 1);
        // an open comment box that answers a comment below keeps pointing at the same one
        if (composer?.feedId === feedId && composer.postIdx === postIdx && composer.replyTo != null) {
            if (composer.replyTo === ci) { composer.replyTo = null; composer.place = 'end'; }
            else if (composer.replyTo > ci) { composer.replyTo -= 1; composer.place = 'end'; }
        }
        // Discord replies point at comments by index: drop / shift them
        for (const c of post.comments) {
            if (c.ref == null) continue;
            if (c.ref === ci) delete c.ref;
            else if (c.ref > ci) c.ref -= 1;
        }
    } else {
        post.comments[ci]?.replies.splice(ri, 1);
    }
    // a box placed under a specific comment / res may now sit on the wrong one: move it to the end
    if (ci != null && composer?.feedId === feedId && composer.postIdx === postIdx && !['end', 'op'].includes(composer.place ?? 'end')) composer.place = 'end';
    await saveChatStore();
    if (ci == null) { showFeed(feedId, { keepScroll: true }); return; }
    updatePost(feedId, postIdx);
    if (isPinned(feedId, postIdx)) refreshInjection();
}

// ---------------------------------------------------------------------------
// "AI로 쓰기": the model writes a post / comment as the identity the player picked
// ---------------------------------------------------------------------------
function describeAuthor(identity, platformId) {
    const userName = ctx().name1 || 'User';
    const nick = identity.nick?.trim();
    if (identity.as === 'char') {
        return `the story character ${identity.charName} themself${nick ? `, posting under the nickname "${nick}"` : ''}.`;
    }
    if (identity.as === 'user') {
        return `the story protagonist ${userName} (the user's persona) themself${nick ? `, posting under the nickname "${nick}"` : ''}.`;
    }
    return `an ordinary member of this community, not a story character${nick ? `, nickname "${nick}"` : ` (default name "${PLATFORMS[platformId].anon}")`}. Give them a believable personality of their own.`;
}

function playerLanguage(platformId, fixed = resolvedLanguage()) {
    return languageRules(platformId, fixed).join('\n');
}

/** Topic for a player-written post: one of the selected topic chips (when the scope allows manual use). */
function pickPlayerTopic() {
    if (getSettings().topicScope === 'auto') return null;
    const topics = selectedTopics();
    return topics.length ? topics[Math.floor(Math.random() * topics.length)] : null;
}

async function aiWrite({ kind, mode, platformId, identity, instruction, draft, feed, postIdx, replyTo, anchorN, topic, dmTo, photo = null }) {
    return runJob(photo ? '사진 묘사 쓰는 중…' : '글을 쓰는 중…', false, async ({ signal, stillSameChat }) => {
        const b = commonBlocks(mode, platformId, resolvedLanguage(), feed?.id && feed.platform === platformId ? feedSpace(feed) : currentSpace(platformId));
        const storyText = await buildContextBlock();
        const dmPost = feed && postIdx != null && feed.data.posts[postIdx]?.kind === 'dm';
        const kindLabel = dmPost || kind === 'dm' ? 'direct message'
            : PLATFORMS[platformId]?.chat ? 'chat message'
            : ({ post: platformId === 'fivech' ? 'thread (title + opening post)' : 'post', comment: 'comment', reply: 'reply' }[kind] ?? kind);
        const parts = [
            `<story_context>\n${storyText}\n</story_context>`,
            `<task>\n${b.taskBase}\n</task>`,
            `<platform_style>\n${b.style}\n</platform_style>`,
        ];
        if (feed && postIdx != null && crossRefOn(feed.data.posts[postIdx])) parts.push(buildCrossRefBlock(platformId, mode, feed.data.posts[postIdx]));
        else if (!(feed && postIdx != null) && getSettings().crossRef) parts.push(buildCrossRefBlock(platformId, mode));
        if (feed && postIdx != null) {
            parts.push(`<thread>\n${serializeThread(feed, postIdx)}\n</thread>`);
            const target = replyTo != null ? feed.data.posts[postIdx].comments[replyTo] : null;
            if (target) parts.push(`<reply_target>\nThe new text replies to this comment by ${target.author || 'anon'}: ${truncate(target.body, 400)}\n</reply_target>`);
            if (anchorN) parts.push(`<reply_target>\nThe new post replies to >>${anchorN}; start with that anchor.\n</reply_target>`);
        } else if (feed?.data?.board) {
            parts.push(`<board>\nThe post goes on: ${feed.data.board}\n</board>`);
        }
        if (dmTo) parts.push(`<dm>\nA private Discord direct message from the author to ${dmTo}. It opens a new DM conversation.\n</dm>`);
        if (topic) parts.push(`<topic>\nWrite it about this topic (it may be written in any language; follow its intent): ${topic.name}${topic.desc ? ` — ${topic.desc}` : ''}\n</topic>`);
        if (draft?.trim()) parts.push(`<draft>\n${draft.trim()}\n</draft>`);
        if (instruction?.trim()) parts.push(`<user_request>\nThe player's instruction for this text (it may be written in any language; follow its intent):\n${instruction.trim()}\n</user_request>`);
        parts.push(`<language>\n${playerLanguage(platformId, feed && feed.platform === platformId ? feedLang(feed) : resolvedLanguage())}\n</language>`);
        if (b.extra) parts.push(`<extra_instructions>\n${b.extra}\n</extra_instructions>`);
        if (photo) {
            // only the picture: what this author's photo / screenshot shows
            const what = photo.target === 'comment' ? (platformId === 'fivech' ? 'new res (reply post in the thread)' : 'new comment') : 'post';
            parts.push(photo.target === 'comment'
                ? `<new_${platformId === 'fivech' ? 'res' : 'comment'}>\nThe ${what} being written in the thread above:\n${draft?.trim() || '(no text yet)'}\n</new_${platformId === 'fivech' ? 'res' : 'comment'}>`
                : `<post>\n${photo.title?.trim() ? `Title: ${photo.title.trim()}\n` : ''}${draft?.trim() || '(no text yet)'}\n</post>`);
            const video = photo.kind === 'video';
            const others = (photo.others ?? []).filter(m => m.desc?.trim());
            if (others.length) parts.push(`<other_attachments>\nThe ${what} already has: ${others.map(m => `[${m.type === 'video' ? 'video' : 'photo'}] ${truncate(m.desc.trim(), 200)}`).join(' / ')}\nThis one is another, different ${video ? 'video' : 'picture'}.\n</other_attachments>`);
            if (photo.current?.trim()) parts.push(`<current_${video ? 'video' : 'photo'}_description>\n${photo.current.trim()}\n</current_${video ? 'video' : 'photo'}_description>`);
            parts.push(video
                ? `The author of the ${what} above (${describeAuthor(identity, platformId)}) attaches a short video to it. Describe what the video shows — the scene, what happens, notable sound — in one or two short sentences, in the same language as the ${what}, fitting it, the thread, the community and the story world. No brackets, no quotes. ${photo.current?.trim() ? 'Improve the current description, keeping its idea.' : ''} Reply with JSON only: {"image": "..."}`
                : `The author of the ${what} above (${describeAuthor(identity, platformId)}) attaches a photo or screenshot to it. Describe what the picture shows — what is in it, framing, mood — in one or two short sentences, in the same language as the ${what}, fitting it, the thread, the community and the story world. No brackets, no quotes. ${photo.current?.trim() ? 'Improve the current description, keeping its idea.' : ''} Reply with JSON only: {"image": "..."}`);
            const raw = await callModel(b.system, parts.filter(x => !x.startsWith('<draft>')).join('\n\n'), signal);
            if (!stillSameChat()) return null;
            let image = '';
            try { image = String(extractJson(raw)?.image ?? ''); } catch {
                image = String(raw ?? '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/gi, '').trim();
            }
            image = image.replace(/^\[|\]$/g, '').trim().slice(0, 1000);
            if (!image) throw Object.assign(new Error('빈 묘사가 왔어요'), { isParse: true, raw });
            return { image };
        }
        parts.push(fillTpl(getPrompt('player_write'), { ...b.vars, kind: kindLabel, author: describeAuthor(identity, platformId) }));
        // an empty nickname box (and no name in this post yet) gets a fitting suggestion in the same answer
        const post = feed && postIdx != null ? feed.data?.posts?.[postIdx] : null;
        const wantNick = kind !== 'dm' && post?.kind !== 'dm' && !identity.nick?.trim() && !ANON_PLATFORMS.has(platformId) && !rememberedNick(post, identity, feed);
        if (wantNick) parts.push(`Also add "nickname" to the JSON: the display name this author would plausibly use on this community (fitting their personality and the community's naming culture${platformId === 'blind' ? '; on Blind this is their workplace, e.g. a company or organization type' : ''}), not their real name.`);

        const raw = await callModel(b.system, parts.join('\n\n'), signal);
        if (!stillSameChat()) return null;
        let title = '';
        let body = '';
        let nickname = '';
        try {
            const data = extractJson(raw);
            title = String(data.title ?? '').slice(0, 500);
            body = String(data.body ?? '');
            nickname = String(data.nickname ?? '').replace(/[\n\r]/g, ' ').trim().slice(0, 40);
        } catch {
            body = String(raw ?? '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/gi, '').trim();
        }
        if (!body.trim()) throw Object.assign(new Error('빈 글이 왔어요'), { isParse: true, raw });
        return { title, body, nickname };
    });
}

// ---------------------------------------------------------------------------
// Pins → prompt injection
// ---------------------------------------------------------------------------
function storyAuthor(o) {
    if (!o?.isMe) return null;
    if (o.as === 'char') return o.charName || null;
    if (o.as === 'user') return ctx().name1 || 'User';
    return null;
}

function authorLabel(o) {
    const who = storyAuthor(o);
    if (who) return `${who} (posting as "${o.author || who}")`;
    return o.author || 'anon';
}

function postHasStoryAuthor(post) {
    return [post, ...post.comments, ...post.comments.flatMap(c => c.replies)].some(o => storyAuthor(o));
}

/** Text of a pinned post. Player-character items are always kept, with what they replied to. */
function postToPinText(post) {
    const lines = [];
    const head = post.title ? `"${post.title}" — ` : '';
    const att = (o, n) => postMedia(o).filter(m => m.desc.trim()).map(m => ` [${m.type === 'video' ? 'video' : 'photo'}: ${truncate(m.desc.trim(), n)}]`).join('');
    lines.push(`${head}${authorLabel(post)}: ${truncate(post.body, 500)}${att(post, 200)}`);
    const comments = post.comments ?? [];
    const keep = new Set([0, 1, 2, comments.length - 1]);
    comments.forEach((c, i) => {
        if (storyAuthor(c) || c.replies.some(r => storyAuthor(r))) {
            keep.add(i);
            // 2ch-style threads answer with later posts instead of nested replies
            for (let k = 1; k <= 3 && i + k < comments.length; k++) keep.add(i + k);
        }
    });
    if (storyAuthor(post)) for (let k = 0; k < Math.min(6, comments.length); k++) keep.add(k);
    let skipped = false;
    comments.forEach((c, i) => {
        if (!keep.has(i)) { skipped = true; return; }
        if (skipped) { lines.push('  ↳ …'); skipped = false; }
        lines.push(`  ↳ ${authorLabel(c)}: ${truncate(c.body, storyAuthor(c) ? 400 : 150)}${att(c, 150)}`);
        const rs = c.replies.filter(r => storyAuthor(r));
        const others = c.replies.filter(r => !storyAuthor(r)).slice(0, storyAuthor(c) ? 3 : 1);
        for (const r of c.replies) {
            if (rs.includes(r) || others.includes(r)) lines.push(`      ↳ ${authorLabel(r)}: ${truncate(r.body, storyAuthor(r) ? 400 : 120)}${att(r, 120)}`);
        }
    });
    return lines.join('\n');
}

function refreshInjection() {
    const c = ctx();
    const s = getSettings();
    const store = hasChat() ? getChatStore() : null;
    const pins = store?.pinsEnabled ? (store?.pins ?? []) : [];

    if (!pins.length) {
        c.setExtensionPrompt(INJECT_KEY, '', PROMPT_IN_CHAT, pinDepth(s), false, ROLE_SYSTEM);
        return;
    }

    const authored = [];
    const dms = [];
    const world = [];
    const meta = [];
    for (const p of pins) {
        const feed = store.feeds.find(f => f.id === p.feedId);
        const post = feed?.data.posts[p.postIdx];
        // Feeds may not be loaded yet (they live in a separate file); fall back to what the pin cached
        if (post) {
            p.kind = post.kind === 'dm' ? 'dm' : undefined;
            p.text = post.kind === 'dm' ? dmToPinText(post) : postToPinText(post);
            p.authored = postHasStoryAuthor(post);
            p.where = `${PLATFORMS[p.platform]?.name ?? p.platform}${feed.data.board ? ` / ${feed.data.board}` : ''}`;
        }
        const where = p.where ?? (PLATFORMS[p.platform]?.name ?? p.platform);
        const entry = `(${where})\n${p.text}`;
        if (p.kind === 'dm') dms.push(p.text);
        else if (p.authored) authored.push(entry);
        else if (p.mode === 'world') world.push(entry);
        else meta.push(p.text);
    }

    const vars = { char: c.name2 || 'Character', user: c.name1 || 'User' };
    const blocks = [];
    if (dms.length) blocks.push(`${fillTpl(getPrompt('inject_dm'), vars)}\n${dms.join('\n\n')}`);
    if (authored.length) blocks.push(`${fillTpl(getPrompt('inject_authored'), vars)}\n${authored.join('\n\n')}`);
    if (world.length) blocks.push(`${fillTpl(getPrompt('inject_world'), vars)}\n${world.join('\n\n')}`);
    if (meta.length) blocks.push(`${fillTpl(getPrompt('inject_meta'), vars)}\n${meta.join('\n\n')}`);
    c.setExtensionPrompt(INJECT_KEY, blocks.join('\n\n'), PROMPT_IN_CHAT, pinDepth(s), false, ROLE_SYSTEM);
}

/** 반영 글 삽입 깊이: 0 is a real choice (right after the last message), only junk falls back to 4. */
function pinDepth(s) {
    const n = Number(s.pinDepth);
    return Number.isFinite(n) && String(s.pinDepth ?? '').trim() !== '' ? Math.max(0, Math.min(50, Math.round(n))) : 4;
}

async function togglePin(feedId, postIdx) {
    const store = getChatStore();
    const feed = store.feeds.find(f => f.id === feedId);
    if (!feed) return;
    const idx = store.pins.findIndex(p => p.feedId === feedId && p.postIdx === postIdx);
    if (idx >= 0) {
        store.pins.splice(idx, 1);
        toastr.info('반영을 해제했어요.');
    } else {
        const post = feed.data.posts[postIdx];
        store.pins.push({
            feedId, postIdx,
            platform: feed.platform,
            mode: feed.mode,
            kind: post.kind === 'dm' ? 'dm' : undefined,
            text: post.kind === 'dm' ? dmToPinText(post) : postToPinText(post),
        });
        if (post.kind === 'dm') {
            toastr.success(`${esc(dmSubtitle(post))} DM을 본편에 반영할게요.`);
            await saveChatStore();
            refreshInjection();
            return;
        }
        const authors = [...new Set([post, ...post.comments, ...post.comments.flatMap(c => c.replies)].map(storyAuthor).filter(Boolean))];
        toastr.success(authors.length
            ? `${esc(authors.join(', '))}이(가) 이 글을 썼다는 걸 본편에 반영할게요.`
            : (feed.mode === 'world' ? '세계에 퍼진 소문으로 반영할게요.' : '독자 반응을 참고로 반영할게요.'));
    }
    await saveChatStore();
    refreshInjection();
}

function isPinned(feedId, postIdx) {
    return !!getChatStore()?.pins.some(p => p.feedId === feedId && p.postIdx === postIdx);
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
let showTr = false;

/** Post title as shown: the translation while 번역 보기 is on (when there is one). */
function ttl(p) {
    if (!(p?.title_tr && trOn(p))) return p?.title ?? '';
    return getSettings().trDisplay === 'both' ? `${p.title} — ${p.title_tr}` : p.title_tr;
}
let composer = null;   // { cid, feedId, postIdx, replyTo, place, draft } — cid: this comment box's own id
function newComposerId() { return `c${Date.now().toString(36)}${randomId(5)}`; }

/** A post's attached photos / videos, shown as their descriptions: [사진 내용], ▶ [영상 내용]. */
function imgBox(o) {
    const list = postMedia(o).filter(m => m.desc.trim());
    if (!list.length) return '';
    const showTr = trOn(o);
    const both = getSettings().trDisplay === 'both';
    return list.map(m => {
        const tr = String(m.desc_tr ?? '').trim();
        const on = !!tr && showTr;
        const video = m.type === 'video';
        return `<div class="stcm-img${video ? ' video' : ''}"><i class="fa-${video ? 'solid fa-film' : 'regular fa-image'}"></i><span>${video ? '▶ ' : ''}[${esc(on && !both ? tr : m.desc)}]${on && both ? `<span class="stcm-tr-below">[${esc(tr)}]</span>` : ''}</span></div>`;
    }).join('');
}

/** 사진·영상: a post's list of attached media ({ type: 'photo' | 'video', desc, desc_tr }).
 *  Older posts kept one photo in image / image_tr: that becomes the first item (and is saved that way). */
const MEDIA_MAX = 10;
function postMedia(p) {
    if (!p || typeof p !== 'object') return [];
    if (Array.isArray(p.media)) return p.media;
    if (!Object.hasOwn(p, 'image') && !Object.hasOwn(p, 'image_tr')) return [];
    p.media = cleanMedia(p);
    delete p.image;
    delete p.image_tr;
    return p.media;
}

/** Media from the model, a saved post or an imported file: "media" (objects or plain strings), older "image",
 *  also "images" / "videos" lists — every field rebuilt with known types. */
function cleanMedia(p) {
    const out = [];
    const add = (type, desc, tr = '') => {
        const d = String(desc ?? '').replace(/^\s*\[|\]\s*$/g, '').trim().slice(0, 1000);
        if (d && out.length < MEDIA_MAX) out.push({ type: type === 'video' ? 'video' : 'photo', desc: d, desc_tr: String(tr ?? '').trim().slice(0, 1000) });
    };
    const kindOf = (t) => (/video|clip|movie|gif|영상|動画|视频|視頻/i.test(String(t ?? '')) ? 'video' : 'photo');
    if (Array.isArray(p?.media)) {
        for (const m of p.media) {
            if (typeof m === 'string') add('photo', m);
            else if (m && typeof m === 'object') add(kindOf(m.type ?? m.kind), m.desc ?? m.description ?? m.text, m.desc_tr ?? m.description_tr ?? m.text_tr);
        }
    }
    if (typeof p?.image === 'string') add('photo', p.image, p.image_tr);
    for (const [key, type] of [['images', 'photo'], ['videos', 'video']]) {
        if (Array.isArray(p?.[key])) for (const m of p[key]) add(type, typeof m === 'string' ? m : (m?.desc ?? m?.description), typeof m === 'object' ? (m?.desc_tr ?? '') : '');
    }
    if (typeof p?.video === 'string') add('video', p.video, p.video_tr);
    return out;
}

/** 2ch reses and Reddit comments you write can carry photos / videos too (not in a DM). */
const COMMENT_MEDIA = new Set(['fivech', 'reddit']);
function commentMediaOn(feed, post) {
    return COMMENT_MEDIA.has(feed?.platform) && post?.kind !== 'dm';
}

/** One photo / video row of a write form / comment box, as HTML. mid: the row's own id (kept when the box is
 *  drawn again), so an AI description that comes back later goes into that very row — or nowhere if it was removed. */
function mediaRowHtml(type, desc = '', mid = '') {
    const video = type === 'video';
    const id = /^[a-zA-Z0-9]{1,20}$/.test(String(mid)) ? mid : `m${Date.now().toString(36)}${randomId(5)}`;
    return `<div class="stcm-cp-media" data-type="${video ? 'video' : 'photo'}" data-mid="${id}"><div class="stcm-cp-media-head"><i class="fa-${video ? 'solid fa-film' : 'regular fa-image'}"></i> <b>${video ? '영상' : '사진'}</b>
            <button data-act="ai-photo" title="글과 고른 신분에 맞춰 AI가 ${video ? '영상' : '사진'} 묘사를 써 줘요"><i class="fa-solid fa-wand-magic-sparkles"></i> AI로 묘사</button>
            <button data-act="cp-media-del" title="이 ${video ? '영상' : '사진'} 빼기"><i class="fa-solid fa-xmark"></i></button></div>
        <textarea rows="2" maxlength="1000" placeholder="${video ? '영상 묘사 — 예: 축제 불꽃놀이를 찍은 짧은 영상. 터질 때마다 사람들 환호성' : '사진 묘사 — 예: 축제 야시장 사진. 사람들 사이로 등불이 줄지어 걸려 있음'}">${esc(desc)}</textarea></div>`;
}

/** Add a photo / video row to a write form or comment box. */
function addMediaRow(root, type, desc = '', mid = '') {
    const list = root.querySelector('.stcm-cp-medialist');
    if (!list) return null;
    list.insertAdjacentHTML('beforeend', mediaRowHtml(type, desc, mid));
    return list.lastElementChild;
}

/** The write form being filled in, per chat (until it is posted or thrown away, or the page is closed):
 *  leaving for another menu, switching boards or closing the panel keeps it, and an AI answer that comes back
 *  meanwhile lands in it. */
const composeDrafts = new Map();   // chatId → { formId, title, body, board, category, media, identity, react, inst, unpostedId }
const aiPendingForms = new Set();  // forms waiting for an AI answer: kept even while still empty

function readComposeForm(view) {
    return {
        title: view.querySelector('.stcm-cp-title')?.value ?? '',
        body: view.querySelector('.stcm-cp-body')?.value ?? '',
        board: view.querySelector('.stcm-cp-board')?.value ?? '',
        category: view.querySelector('.stcm-cp-cat')?.value ?? '',
        media: readMediaRows(view, null, true),
        identity: readIdentity(view),
        react: view.querySelector('.stcm-cp-react')?.checked !== false,
        inst: view.querySelector('.stcm-cp-inst')?.value ?? '',
        unpostedId: view.dataset.draft || '',
        formId: view.dataset.fid || '',
    };
}

/** Remember the write form (an empty one is forgotten; a posted / thrown-away one is never written back). */
function saveComposeForm(view) {
    const chatId = view?.dataset?.chat;
    if (!chatId || view.dataset.done) return;
    const d = readComposeForm(view);
    const empty = !d.title.trim() && !d.body.trim() && !d.board.trim() && !d.inst.trim() && !d.media.length && !d.unpostedId;
    if (empty && !aiPendingForms.has(d.formId)) composeDrafts.delete(chatId); else composeDrafts.set(chatId, d);
}

/** After an AI request: a form that is still empty (the AI failed / gave nothing) is not kept. */
function settleComposeForm(chatId, formId) {
    const d = composeDrafts.get(chatId);
    if (!d || d.formId !== formId || aiPendingForms.has(formId)) return;
    const empty = !d.title.trim() && !d.body.trim() && !d.board.trim() && !d.inst.trim() && !d.media.length && !d.unpostedId;
    if (empty) composeDrafts.delete(chatId);
}

/** The write form is done (posted / thrown away / taken over by a kept record): forget it. */
function forgetComposeForm(chatId) {
    composeDrafts.delete(chatId);
    const v = document.querySelector(`#stcm_feed .stcm-compose-view[data-chat="${CSS.escape(String(chatId ?? ''))}"]`);
    if (v) v.dataset.done = '1';
}

/** An AI answer for the write form it was asked from: into that form if it is open, else into the kept copy of it.
 *  A form that was posted or thrown away meanwhile (a new one has another id) gets nothing. */
function updateComposeForm(chatId, formId, fn) {
    const v = document.querySelector(`#stcm_feed .stcm-compose-view[data-chat="${CSS.escape(String(chatId ?? ''))}"][data-fid="${CSS.escape(String(formId ?? ''))}"]:not([data-done])`);
    if (v) saveComposeForm(v);
    const d = composeDrafts.get(chatId);
    if (!d || !formId || d.formId !== formId) return false;
    fn(d);
    if (v) {
        // show it in the open form
        const t = v.querySelector('.stcm-cp-title');
        if (t) t.value = d.title ?? '';
        v.querySelector('.stcm-cp-body').value = d.body ?? '';
        const nick = v.querySelector('.stcm-cp-nick');
        if (nick) nick.value = d.identity?.nick ?? nick.value;
        for (const m of d.media) {
            const row = m.mid ? v.querySelector(`.stcm-cp-media[data-mid="${CSS.escape(m.mid)}"] textarea`) : null;
            if (row) row.value = m.desc;
        }
        syncComposeDraft(v);
        saveComposeForm(v);
    }
    return true;
}

/** A form's photos / videos, in order. skip: a row not to count; keepEmpty: also rows not filled in yet
 *  (a comment box drawn again keeps them). */
function readMediaRows(root, skip = null, keepEmpty = false) {
    return [...(root?.querySelectorAll('.stcm-cp-media') ?? [])]
        .filter(r => r !== skip)
        .map(r => ({ type: r.dataset.type === 'video' ? 'video' : 'photo', desc: r.querySelector('textarea')?.value.trim() ?? '', ...(keepEmpty ? { mid: r.dataset.mid } : {}) }))
        .filter(m => keepEmpty || m.desc);
}

// ---------------------------------------------------------------------------
// Board time: every new round of posts on a board makes the earlier rounds older
// (1시간 전 → 6시간 전 → 13시간 전 → past a day only the date). Boards list the most recent post on top.
// ---------------------------------------------------------------------------
/** Round number of every post (old saves without one: a new round starts where the chat message changes). */
function postBatches(posts) {
    const out = [];
    let legacy = -1;
    let lastAt;
    for (const p of posts) {
        if (Number.isInteger(p.batch) && p.batch >= 0) { out.push(p.batch); continue; }
        if (legacy < 0 || p.at !== lastAt) legacy++;
        lastAt = p.at;
        out.push(legacy);
    }
    return out;
}

/** Give posts their round: a new round after the newest one (generated), or the newest round itself (your own post). */
function stampBatch(feed, posts, newRound) {
    if (PLATFORMS[feed.platform]?.chat) return;   // Discord: channels keep their own order and times
    const fresh = new Set(posts);
    const top = postBatches(feed.data.posts.filter(p => !fresh.has(p))).reduce((a, b) => Math.max(a, b), -1);
    const b = newRound ? top + 1 : Math.max(0, top);
    for (const p of posts) p.batch = b;
    if (newRound) feed.batchAt = Date.now();
}

/** How much time passes on the board per later round: 5–7 hours, fixed per board and round. */
function batchStep(feedId, b) {
    let h = 7;
    for (const ch of `${feedId}:${b}`) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return 300 + (h % 121);
}

const AGO_UNIT = { 초: 's', 秒: 's', 분: 'm', 分: 'm', 分钟: 'm', 分鐘: 'm', 시간: 'h', 時間: 'h', 小时: 'h', 小時: 'h', 일: 'd', 日: 'd', 天: 'd' };
const AGO_MIN = { s: 0, m: 1, h: 60, d: 1440 };
const enUnit = (u) => ({ s: 's', m: 'm', h: 'h', d: 'd' })[u.toLowerCase().replace(/^(sec|second)s?$/, 's').replace(/^(min|minute)s?$/, 'm').replace(/^(hr|hour)s?$/, 'h').replace(/^days?$/, 'd')];

/** "3시간 전", "2h", "5 hr. ago", "3時間前", "14:32"… → minutes ago and how it was written; null when not a relative time. */
function parseAgo(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (/^(방금(\s*전)?|지금)$/.test(s)) return { min: 0, style: 'ko' };
    if (/^(just now|now)$/i.test(s)) return { min: 0, style: 'en' };
    if (/^(たった今|今)$/.test(s)) return { min: 0, style: 'ja' };
    if (/^(刚刚|剛剛|刚才|剛才)$/.test(s)) return { min: 0, style: 'zh' };
    if (s === '어제') return { min: 1440, style: 'ko' };
    if (/^yesterday$/i.test(s)) return { min: 1440, style: 'en' };
    if (s === '昨日') return { min: 1440, style: 'ja' };
    if (s === '昨天') return { min: 1440, style: 'zh' };
    let m;
    if ((m = /^an?\s+(minute|hour|day)\s+ago$/i.exec(s))) return { min: AGO_MIN[enUnit(m[1])], style: 'en' };
    const mk = (n, u, style) => ({ min: Math.min(Number(n), 9999) * AGO_MIN[u], style });
    if ((m = /^(\d{1,4})\s*(초|분|시간|일)\s*전$/.exec(s))) return mk(m[1], AGO_UNIT[m[2]], 'ko');
    if ((m = /^(\d{1,4})\s*(秒|分|時間|日)前$/.exec(s))) return mk(m[1], AGO_UNIT[m[2]], 'ja');
    if ((m = /^(\d{1,4})\s*(秒|分钟|分鐘|小时|小時|天)前$/.exec(s))) return mk(m[1], AGO_UNIT[m[2]], 'zh');
    if ((m = /^(\d{1,4})\s*(sec|min|hr)\.?\s*ago$/i.exec(s)) && /\./.test(s)) return mk(m[1], enUnit(m[2]), 'reddit');
    if ((m = /^(\d{1,4})\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\s*ago$/i.exec(s))) return mk(m[1], enUnit(m[2]), 'en');
    if ((m = /^(\d{1,4})\s*([smhd])$/i.exec(s))) return mk(m[1], m[2].toLowerCase(), 'short');
    if ((m = /^(\d{1,2}):(\d{2})$/.exec(s)) && Number(m[1]) < 24 && Number(m[2]) < 60) {
        const clock = Number(m[1]) * 60 + Number(m[2]);   // today's clock time (디시 style): later = newer
        return { min: 1440 - clock, style: 'clock', clock };
    }
    return null;
}

/** A relative time written again in the same style. */
function agoLabel(min, style) {
    const n = min < 60 ? Math.max(1, Math.floor(min)) : Math.floor(min / 60);
    const hr = min >= 60;
    if (min < 1) return { ko: '방금', ja: 'たった今', zh: '刚刚', short: 'now' }[style] ?? 'just now';
    switch (style) {
        case 'ko': return `${n}${hr ? '시간' : '분'} 전`;
        case 'ja': return `${n}${hr ? '時間' : '分'}前`;
        case 'zh': return `${n}${hr ? '小时' : '分钟'}前`;
        case 'reddit': return `${n} ${hr ? 'hr.' : 'min.'} ago`;
        case 'short': return `${n}${hr ? 'h' : 'm'}`;
        default: return `${n} ${hr ? 'hour' : 'minute'}${n === 1 ? '' : 's'} ago`;
    }
}

/** Only the date (past a day), counted back from when the board's newest round came. */
function agoDate(feed, daysBack, style) {
    const anchor = new Date(Number(feed.batchAt) || Number(feed.updatedAt) || Number(feed.createdAt) || Date.now());
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - daysBack);
    const y = d.getFullYear() !== anchor.getFullYear() ? d.getFullYear() : null;
    const mo = d.getMonth() + 1;
    const dd = d.getDate();
    const z = (x) => String(x).padStart(2, '0');
    if (style === 'ja') return `${y ? `${y}/` : ''}${mo}/${dd}`;
    if (style === 'zh') return `${y ? `${y}年` : ''}${mo}月${dd}日`;
    if (style === 'en' || style === 'reddit' || style === 'short') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y ? { year: 'numeric' } : {}) });
    return `${y ? `${y}.` : ''}${z(mo)}.${z(dd)}`;
}

/** Each post's time on the board now: { order: indexes most recent first, time: i → text shown }. */
function boardTimes(feed) {
    // one drawing asks for every post's time: work it out once, and forget it as soon as the drawing is done
    const posts = feed?.data?.posts;
    const hit = timesCache.get(feed);
    if (hit && hit.posts === posts && hit.len === posts?.length) return hit.val;
    const val = computeBoardTimes(feed);
    if (feed && typeof feed === 'object') {
        if (!timesCache.size) queueMicrotask(() => timesCache.clear());
        timesCache.set(feed, { posts, len: posts?.length, val });
    }
    return val;
}
const timesCache = new Map();

function computeBoardTimes(feed) {
    const posts = feed?.data?.posts ?? [];
    const batches = postBatches(posts);
    const anchor = Number(feed?.batchAt) || Number(feed?.updatedAt) || Number(feed?.createdAt) || Date.now();
    const parsed = posts.map(p => parseAgo(p.time) ?? parseDate(p.time, anchor));
    // per round: its oldest and most recent relative time (those move back as rounds pass; written dates don't)
    const span = new Map();
    batches.forEach((b, i) => {
        const r = span.get(b) ?? { lo: Infinity, hi: 0 };
        const a = parsed[i];
        if (a && a.style !== 'date') { r.lo = Math.min(r.lo, a.min); r.hi = Math.max(r.hi, a.min); }
        span.set(b, r);
    });
    const rounds = [...span.keys()].sort((a, b) => b - a);   // newest round first
    // each older round goes back 5–7 hours, and always behind the oldest post of the round after it
    const off = new Map();
    let acc = 0;
    let newerHi = 0;   // the oldest relative time so far, shifts included
    rounds.forEach((b, k) => {
        const r = span.get(b);
        if (k) acc += batchStep(feed.id, rounds[k - 1]);
        if (r.lo !== Infinity) {
            if (k) acc = Math.max(acc, newerHi - r.lo + 10);
            newerHi = r.hi + acc;
        }
        off.set(b, acc);
    });
    // a time that can't be read keeps its place in the round: as recent as the post written before it
    const age = new Array(posts.length);
    const lastIn = new Map();
    posts.forEach((p, i) => {
        const a = parsed[i];
        const b = batches[i];
        if (a) age[i] = a.style === 'date' ? a.min : a.min + off.get(b);
        else age[i] = lastIn.has(b) ? lastIn.get(b) : (span.get(b).lo !== Infinity ? span.get(b).hi + off.get(b) : off.get(b));
        lastIn.set(b, age[i]);
    });
    // newer round first; inside a round, the more recent time first (then the later-written one)
    const order = posts.map((p, i) => i).sort((x, y) => batches[y] - batches[x] || age[x] - age[y] || y - x);
    const time = (i) => {
        const a = parsed[i];
        const p = posts[i];
        const shift = off.get(batches[i]) ?? 0;
        if (!a || a.style === 'date') return String(p?.time ?? '');   // a written date, a 2ch stamp, unreadable: as written
        if (a.style === 'clock') {
            const c = a.clock - shift;
            if (c >= 0) return shift ? `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}` : String(p.time);
            return agoDate(feed, Math.ceil(-c / 1440), 'ko');
        }
        const total = a.min + shift;
        if (total >= 1440) return agoDate(feed, Math.max(1, Math.floor(total / 1440)), a.style);
        return shift ? agoLabel(total, a.style) : String(p.time);
    };
    return { order, time };
}

/** A written date ("2020-01-01", "2026/10/26(月) 12:34:56", "10.26", "10월 26일", "10月26日") → minutes before anchor. */
function parseDate(raw, anchor) {
    const s = String(raw ?? '').trim();
    const now = new Date(anchor);
    let y;
    let mo;
    let d;
    let m;
    if ((m = /^(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/.exec(s))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    else if ((m = /^(\d{1,2})\s*(?:[./]|월|月)\s*(\d{1,2})\s*(?:일|日)?\.?(?:\s|$|\()/.exec(`${s} `))) [mo, d] = [Number(m[1]), Number(m[2])];
    else return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const hm = /(\d{1,2}):(\d{2})/.exec(s.slice(m[0].length));
    const at = (yy) => new Date(yy, mo - 1, d, hm ? Number(hm[1]) : 0, hm ? Number(hm[2]) : 0).getTime();   // no time: start of that day
    let t = at(y ?? now.getFullYear());
    // "12.30" seen in January: last year (compared by day — today's date without a time is today)
    if (y == null && new Date(now.getFullYear(), mo - 1, d) > new Date(now.getFullYear(), now.getMonth(), now.getDate())) t = at(now.getFullYear() - 1);
    return { min: Math.max(0, Math.round((anchor - t) / 60000)), style: 'date' };
}

/** The time shown for one post on its board. */
function postTime(feed, i) {
    if (!feed || PLATFORMS[feed.platform]?.chat) return String(feed?.data?.posts?.[i]?.time ?? '');
    return boardTimes(feed).time(i);
}

/** 과거 글 더보기: a board shows its newest posts; older ones wait behind a button. Watched (👁) posts always show. */
const PAGE_SIZE = 10;
const pageShown = new Map();   // feedId → how many unwatched posts are shown

/** Indexes of the posts hidden for now (empty when the whole board is shown). */
function pagedOut(feed) {
    const out = new Set();
    if (!feed || PLATFORMS[feed.platform]?.chat) return out;
    if (TD_SKINS[feed.platform]) {
        const st = tdState(feed.id);   // 투디갤·깡통: filters, search and 개념글 sorting look at every post
        if (st.cat !== '전체' || st.filter !== 'all' || st.q.trim() || st.sort === 'best') return out;
    }
    const limit = pageShown.get(feed.id) ?? PAGE_SIZE;
    let shown = 0;
    for (const i of boardTimes(feed).order) {   // most recent first
        const p = feed.data.posts[i];
        if (p.watch) continue;
        if (shown < limit) shown++;
        else out.add(i);
    }
    return out;
}

/** The 과거 글 더보기 button under a board: shown with the number of posts not drawn yet. */
function applyPaging(feed, root) {
    const hidden = pagedOut(feed);
    const btn = (root.querySelector ? root : document).querySelector?.('.stcm-older');
    if (btn) {
        btn.classList.toggle('stcm-hide', !hidden.size);
        const b = btn.querySelector('button');
        if (b) b.innerHTML = `<i class="fa-solid fa-angles-down"></i> 과거 글 더보기 <small>(${hidden.size}개)</small>`;
    }
    return hidden;
}

/** Show a post that is still behind 과거 글 더보기 (opening it from 📌, a thread link…). */
function revealPost(feed, idx) {
    if (!pagedOut(feed).has(idx)) return false;
    let n = 0;
    for (const i of boardTimes(feed).order) {
        if (!feed.data.posts[i].watch) n++;
        if (i === idx) break;
    }
    pageShown.set(feed.id, Math.max(n, pageShown.get(feed.id) ?? PAGE_SIZE));
    return true;
}

/** Boards list the most recent post on top, by the time shown (the data keeps writing order, so indexes stay the same).
 *  Posts behind 과거 글 더보기 are not drawn at all until they are asked for. */
function newestFirst(feed, fn) {
    const posts = feed.data.posts;
    if (renderOnly != null) return posts[renderOnly] ? [fn(posts[renderOnly], renderOnly)] : [];
    const hidden = pagedOut(feed);
    const out = [];
    for (const i of boardTimes(feed).order) if (!hidden.has(i)) out.push(fn(posts[i], i));
    return out;
}

/** Set while one post is re-drawn (a new comment, a translation…): the renderers then build only that post. */
let renderOnly = null;

function txt(o, platform) {
    const tr = o.body_tr || o.body_ko;
    if (!(trOn(o) && tr && String(tr).trim())) return fmt(o.body, platform);
    if (getSettings().trDisplay === 'both') return `${fmt(o.body, platform)}<span class="stcm-tr-below">${fmt(tr, platform)}</span>`;
    return fmt(tr, platform);
}

function avatar(name, cls = '') {
    const ch = Array.from(String(name || '?').trim())[0] || '?';
    return `<span class="stcm-avatar ${cls}" style="background:${hashColor(name)}">${esc(ch)}</span>`;
}

function meBadge(o) {
    if (!o?.isMe) return '';
    if (o.as === 'char') return `<span class="stcm-me char">${esc(o.charName || '캐릭터')}</span>`;
    return `<span class="stcm-me">${o.as === 'user' ? esc(ctx().name1 || '유저') : '나'}</span>`;
}

/** Small "reply" / "delete" links on a comment. ci = top-level index, ri = reply index. */
/** "DM" / "채널" / "스레" / "글" — what one post is called on this platform. */
function postKindLabel(feed, post) {
    if (post?.kind === 'dm') return 'DM';
    const pf = PLATFORMS[feed?.platform];
    if (pf?.chat) return '채널';
    if (feed?.platform === 'fivech') return '스레';
    return '글';
}

function itemLinks(feed, i, ci, ri, o, n = null) {
    const links = [];
    if (ri == null && feed.platform !== 'fivech') {
        links.push(`<a class="stcm-link" data-act="reply" data-feed="${esc(feed.id)}" data-idx="${i}" data-ci="${ci}">답글</a>`);
    }
    if (feed.platform === 'fivech') {
        const place = ci == null ? 'op' : (ri == null ? `c${ci}` : `r${ci}.${ri}`);
        links.push(`<a class="stcm-link" data-act="anchor" data-feed="${esc(feed.id)}" data-idx="${i}" data-n="${n}" data-place="${place}">&gt;&gt;${n}</a>`);
    }
    if (o && ci != null && (o.body_tr || o.body_ko) && trOn(o)) {
        links.push(`<a class="stcm-link" data-act="tr-edit-item" data-feed="${esc(feed.id)}" data-idx="${i}" data-ci="${ci}"${ri != null ? ` data-ri="${ri}"` : ''}>번역 수정</a>`);
    }
    if (o && ci != null) {   // any comment / reply / message can be edited or removed, generated ones too
        links.push(`<a class="stcm-link" data-act="edit-item" data-feed="${esc(feed.id)}" data-idx="${i}" data-ci="${ci}"${ri != null ? ` data-ri="${ri}"` : ''}>수정</a>`);
        links.push(`<a class="stcm-link danger" data-act="del-item" data-feed="${esc(feed.id)}" data-idx="${i}" data-ci="${ci}"${ri != null ? ` data-ri="${ri}"` : ''}>삭제</a>`);
    }
    return links.length ? `<span class="stcm-links">${links.join('')}</span>` : '';
}

function postActions(feed, i) {
    const post = feed.data.posts[i];
    const on = isPinned(feed.id, i);
    const thread = PLATFORMS[feed.platform].thread;
    const chat = PLATFORMS[feed.platform].chat;
    const full = isThreadFull(feed, post);
    const hasNext = post.nextIdx != null && feed.data.posts[post.nextIdx];
    const cap = threadCap(feed.platform);
    return `${threadNav(feed, i)}<div class="stcm-actions" data-k="${i}.act">
        ${cap !== Infinity ? `<span class="stcm-count ${full ? 'full' : ''}">${threadCount(post)} / ${cap}</span>` : ''}
        ${full ? '' : `<button data-act="comment" data-feed="${esc(feed.id)}" data-idx="${i}"><i class="fa-regular fa-pen-to-square"></i>${chat ? '메시지 보내기' : (thread ? '레스 쓰기' : '댓글 쓰기')}</button>`}
        ${full
            ? `<button data-act="more" data-feed="${esc(feed.id)}" data-idx="${i}" class="stcm-next"><i class="fa-solid fa-arrow-turn-down"></i>${hasNext ? '후속 스레로 이동' : '후속 스레 작성'}</button>`
            : `<button data-act="more" data-feed="${esc(feed.id)}" data-idx="${i}"><i class="fa-solid fa-angles-down"></i>${chat ? '대화 이어가기' : (thread ? '스레드 이어가기' : '댓글 더 보기')}</button>`}
        <button class="stcm-tog ${post.watch ? 'on' : ''}" data-act="watch" data-feed="${esc(feed.id)}" data-idx="${i}" title="${post.watch ? '자동 이어가기 끄기' : '본 채팅이 진행되면 이 글에 자동으로 레스/댓글 달기'}"><i class="fa-solid fa-eye"></i><span class="lbl">${post.watch ? '지켜보는 중' : '지켜보기'}</span></button>
        ${post.kind === 'dm' ? '' : `<button class="stcm-tog icon ${crossRefOn(post) ? 'on' : ''}" data-act="crossref" data-feed="${esc(feed.id)}" data-idx="${i}" title="${getSettings().crossRef ? '전체 설정에서 켜져 있어요' : (post.crossRef ? '이 글만 다른 글 참고 끄기' : '이 글을 이어갈 때 다른 게시글도 참고')}"><i class="fa-solid fa-link"></i></button>`}
        ${trButtons(feed, i)}
        <button class="stcm-pin ${on ? 'on' : ''}" data-act="pin" data-feed="${esc(feed.id)}" data-idx="${i}" title="본편에 반영"><i class="fa-solid fa-thumbtack"></i>${on ? '반영 중' : '반영'}</button>
        ${post.kind === 'dm' ? '' : `<button class="icon" data-act="edit-post" data-feed="${esc(feed.id)}" data-idx="${i}" title="${esc(postKindLabel(feed, post))} 수정 (제목·본문·사진·영상)"><i class="fa-solid fa-pencil"></i></button>`}
        <button data-act="del-post" data-feed="${esc(feed.id)}" data-idx="${i}" title="${esc(postKindLabel(feed, post))} 삭제"><i class="fa-solid fa-trash-can"></i></button>
    </div>`;
}

function trButtons(feed, i) {
    const post = feed.data.posts[i];
    const fid = esc(feed.id);
    if (trBusy.has(post)) return `<button disabled><i class="fa-solid fa-spinner fa-spin"></i> 번역 중…</button>`;
    const has = postHasTr(post);
    const shown = has && trOn(post);
    return `<button class="stcm-tog ${shown ? 'on' : ''}" data-act="tr-post" data-feed="${fid}" data-idx="${i}" title="${shown ? '원문 보기' : (has ? '번역 보기' : `${esc(trTarget())}로 번역`)}"><i class="fa-solid fa-language"></i>${shown ? '원문' : '번역'}</button>
        ${shown ? `<button class="icon" data-act="tr-redo" data-feed="${fid}" data-idx="${i}" title="다시 번역"><i class="fa-solid fa-rotate"></i></button>
        <button class="icon" data-act="tr-edit" data-feed="${fid}" data-idx="${i}" title="이 글의 번역 고치기"><i class="fa-solid fa-pen"></i></button>` : ''}`;
}

function threadNav(feed, i) {
    const post = feed.data.posts[i];
    const links = [];
    if (post.prevIdx != null && feed.data.posts[post.prevIdx]) {
        links.push(`<a class="stcm-link" data-act="goto-post" data-idx="${post.prevIdx}"><i class="fa-solid fa-arrow-up"></i> 이전 스레: ${esc(truncate(feed.data.posts[post.prevIdx].title, 40))}</a>`);
    }
    if (post.nextIdx != null && feed.data.posts[post.nextIdx]) {
        links.push(`<a class="stcm-link" data-act="goto-post" data-idx="${post.nextIdx}"><i class="fa-solid fa-arrow-down"></i> 다음 스레: ${esc(truncate(feed.data.posts[post.nextIdx].title, 40))}</a>`);
    }
    const closed = isThreadFull(feed, post)
        ? (feed.platform === 'fivech'
            ? `<div class="stcm-5-res stcm-closed"><div class="stcm-5-head"><span class="n">${threadCap('fivech') + 1}</span> ${esc((uiWords('fivech', feed.lang) ?? UI_WORDS.ja).name)}<span class="name">${threadCap('fivech') + 1}</span> <span class="id">Over ${threadCap('fivech')} Thread</span></div><div class="stcm-body">${(uiWords('fivech', feed.lang) ?? UI_WORDS.ja).over(threadCap('fivech'))}</div></div>`
            : `<div class="stcm-closed-banner"><i class="fa-solid fa-lock"></i> This thread has reached the comment limit and is locked.</div>`)
        : '';
    return closed + (links.length ? `<div class="stcm-thread-nav">${links.join('')}</div>` : '');
}

function characterNames() {
    const c = ctx();
    if (c.groupId) {
        const group = c.groups?.find(g => g.id === c.groupId);
        return (group?.members ?? []).map(av => c.characters.find(ch => ch.avatar === av)?.name).filter(Boolean);
    }
    return c.name2 ? [c.name2] : [];
}

/** What the nickname box means on this community. */
function nickHint(platformId) {
    if (platformId === 'blind') return '회사 이름 (비우면 랜덤 직장)';
    if (platformId === 'everytime') return '닉네임 (비우면 익명 · 댓글은 익명N)';
    if (platformId === 'kkangtong') return '닉네임 (비우면 깡 · 댓글은 깡N)';
    if (platformId === 'dcinside' || TD_SKINS[platformId]) return '닉네임 (비우면 ㅇㅇ)';
    if (platformId === 'fivech') return '닉네임 (비우면 名無しさん)';
    return getSettings().nickMode === 'ai' ? '닉네임 (비우면 AI가 어울리는 이름)' : '닉네임 (비우면 랜덤 닉네임)';
}

/** Feed a post object belongs to (composer only knows the post). */
function feedOfPost(post) {
    const store = hasChat() ? getChatStore() : null;
    return store?.feeds.find(f => f.data.posts.includes(post)) ?? null;
}

function identityControls(draft, post = null) {
    const store = getChatStore();
    let id = draft?.as ? draft : (store?.identity ?? { as: 'mob', nick: '', charName: '' });
    // inside a post: the name this identity already used there comes back
    if (post && !draft?.as) {
        id = { ...id, nick: prefillNick(post, id, feedOfPost(post)) };
    }
    const userName = esc(ctx().name1 || '유저');
    const names = characterNames();
    const charName = id.charName || (names.length === 1 ? names[0] : '');
    return `<div class="stcm-cp-row">
        <select class="stcm-cp-as">
            <option value="mob" ${id.as === 'mob' || !id.as ? 'selected' : ''}>제3자(모브)로</option>
            <option value="user" ${id.as === 'user' ? 'selected' : ''}>${userName}(으)로</option>
            <option value="char" ${id.as === 'char' ? 'selected' : ''}>캐릭터로</option>
        </select>
        <input class="stcm-cp-char" type="text" list="stcm_char_names" maxlength="60" value="${esc(charName)}" placeholder="캐릭터 이름" style="${id.as === 'char' ? '' : 'display:none'}">
        <input class="stcm-cp-nick" type="text" maxlength="40" value="${esc(id.nick)}" placeholder="${esc(nickHint(selPlatform))}">
    </div>
    <datalist id="stcm_char_names">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;
}

/** Composer rendered at a given spot of a post: 'end' (under the buttons), 'op', 'c<ci>', 'r<ci>.<ri>'. */
function slotAt(feed, i, place) {
    if (!composer || composer.feedId !== feed.id || composer.postIdx !== i) return '';
    if ((composer.place ?? 'end') !== place) return '';
    return composerSlot(feed, i);
}

function composerSlot(feed, i) {
    if (!composer || composer.feedId !== feed.id || composer.postIdx !== i) return '';
    const post = feed.data.posts[i];
    const target = composer.replyTo != null ? post.comments[composer.replyTo] : null;
    const thread = PLATFORMS[feed.platform].thread;
    const chat = PLATFORMS[feed.platform].chat;
    const isDm = post.kind === 'dm';
    const ph = isDm ? `@${dmPartnerLabel(post)}에게 메시지 보내기` : chat ? `#${String(post.title || '일반').replace(/^#\s*/, '')}에 메시지 보내기` : (thread ? '레스 내용 (>>번호 로 앵커)' : '댓글 내용');
    // In a DM the sender is fixed: the side that started it
    const ident = isDm ? `<div class="stcm-cp-target">보내는 사람: <b>${esc(dmSideName(post.dm?.me))}</b> → <b>${esc(dmPartnerLabel(post))}</b></div>` : identityControls(composer.draft, post);
    const kept = composer.draft?.unpostedId && findUnposted(feedState.chatId, composer.draft.unpostedId);
    const withMedia = commentMediaOn(feed, post);
    return `<div class="stcm-composer" data-feed="${esc(feed.id)}" data-idx="${i}">
        ${kept ? `<div class="stcm-cp-hint stcm-unposted-hint">올리지 못했던 댓글이에요. 등록하면 보관 목록에서 빠져요 · <a class="stcm-link" data-act="unposted-drop" data-draft="${esc(kept.id)}">보관 목록에서 버리기</a></div>` : ''}
        ${ident}
        ${target ? `<div class="stcm-cp-target">↳ <b>${esc(target.author)}</b>님에게 ${chat ? '답장' : '답글'} <a class="stcm-link" data-act="reply-cancel">취소</a></div>` : ''}
        <textarea class="stcm-cp-body" rows="3" placeholder="${esc(ph)}">${esc(composer.draft?.body ?? '')}</textarea>
        ${withMedia ? `<div class="stcm-cp-medialist">${(composer.draft?.media ?? []).map(m => mediaRowHtml(m.type, m.desc, m.mid)).join('')}</div>` : ''}
        <div class="stcm-cp-ai">
            <input class="stcm-cp-inst" type="text" maxlength="500" value="${esc(composer.draft?.inst ?? '')}" placeholder="AI에게 지시 (선택) — 비우면 알아서">
            <button data-act="ai-write-comment" title="고른 신분으로 AI가 써 줘요. 칸에 글이 있으면 그걸 다듬어요."><i class="fa-solid fa-wand-magic-sparkles"></i> AI로 쓰기</button>
        </div>
        <div class="stcm-cp-foot">
            ${withMedia ? `<button data-act="cp-photo" class="stcm-cp-photo" title="${thread ? '레스' : '댓글'}에 사진 한 장 더 붙이기 (사진 대신 묘사가 들어가요)"><i class="fa-regular fa-image"></i> 사진</button>
            <button data-act="cp-video" class="stcm-cp-photo" title="${thread ? '레스' : '댓글'}에 영상 하나 더 붙이기 (영상 대신 묘사가 들어가요)"><i class="fa-solid fa-film"></i> 영상</button>` : ''}
            <label class="stcm-cp-check"><input type="checkbox" class="stcm-cp-react" ${composer.draft?.react === false ? '' : 'checked'}> 반응 생성</label>
            <button data-act="cancel-comment">취소</button>
            <button class="primary" data-act="submit-comment"><i class="fa-solid fa-paper-plane"></i> 등록</button>
        </div>
    </div>`;
}

function postFooter(feed, i) {
    return postActions(feed, i) + slotAt(feed, i, 'end');
}

// ---------------------------------------------------------------------------
// Title list: posts start folded; the title row opens the body and reactions
// ---------------------------------------------------------------------------
const FOLD_SKIP = new Set(['tdgall', 'kkangtong', 'discord']);   // 투디갤·깡통 have their own board list, Discord shows one channel at a time

function foldable(feed) {
    return !!feed && !FOLD_SKIP.has(feed.platform);
}

function isPostOpen(feed, i) {
    return openPosts.has(`${feed.id}:${i}`);
}

function postSummaryHtml(feed, p, i) {
    const pf = feed.platform;
    const n = p.comments.reduce((a, c) => a + 1 + c.replies.length, 0);
    const titled = !!String(p.title ?? '').trim() && pf !== 'twitter';
    const title = titled ? ttl(p) : truncate((trOn(p) && p.body_tr) || p.body, 90);
    let tag = '';
    if (pf === 'naver' || pf === 'blind' || pf === 'everytime') tag = p.tags?.[0] || '';
    if (pf === 'reddit') tag = p.tags?.[0] || '';
    const cnt = pf === 'fivech' ? `(${n + 1})`
        : pf === 'reddit' ? `${n} comments`
        : (pf === 'twitter' || pf === 'weibo') ? `<i class="fa-regular fa-comment"></i> ${n}`
        : pf === 'tieba' ? `${n}`
        : `[${n}]`;
    const who = pf === 'reddit' ? `u/${String(p.handle || p.author || 'anon').replace(/^u\//, '')}`
        : pf === 'twitter' ? `${p.author || ''}` : (p.author || '');
    const extra = pf === 'fivech' || pf === 'tieba' ? '' : (Number(p.likes) ? ` · ♥ ${num(p.likes)}` : '');
    return `<div class="stcm-psum" data-act="post-toggle" data-feed="${esc(feed.id)}" data-idx="${i}" role="button" tabindex="0" aria-expanded="${isPostOpen(feed, i) ? 'true' : 'false'}">
        ${tag ? `<span class="tag">${esc(tag)}</span>` : ''}
        <span class="tt">${p.isMe ? '<i class="fa-solid fa-pen-nib mine"></i> ' : ''}${!titled && pf === 'twitter' ? `<b>${esc(who)}</b> ` : ''}${esc(title)}</span>
        <span class="cnt">${cnt}</span>
        <span class="mt">${titled || pf !== 'twitter' ? `${esc(who)}${who ? ' · ' : ''}` : ''}${esc(postTime(feed, i))}${extra}</span>
        <i class="fa-solid fa-chevron-down chev"></i>
    </div>`;
}

/** Add the title row to every post of a rendered feed (root = feed element or a template fragment). */
function applyFolding(feed, root) {
    if (!foldable(feed) || !root) return;
    root.querySelectorAll('article[data-post]').forEach((art) => {
        const i = Number(art.dataset.post);
        const p = feed.data.posts[i];
        if (!p || art.querySelector(':scope > .stcm-psum')) return;
        art.classList.add('stcm-fold');
        art.classList.toggle('open', !!isPostOpen(feed, i));
        art.insertAdjacentHTML('afterbegin', postSummaryHtml(feed, p, i));
    });
}

function setPostOpen(feedId, idx, open) {
    const key = `${feedId}:${idx}`;
    if (open) openPosts.add(key); else openPosts.delete(key);
    const art = document.querySelector(`#stcm_feed article.stcm-fold[data-post="${idx}"]`);
    if (!art) return;
    art.classList.toggle('open', open);
    art.querySelector(':scope > .stcm-psum')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function togglePost(feedId, idx) {
    const open = !openPosts.has(`${feedId}:${idx}`);
    // a comment box inside stays (hidden) with its text; it is there again when the post reopens
    if (!open) captureDraft();
    setPostOpen(feedId, idx, open);
    if (!open) {
        // keep the folded title in view when the reader was further down inside the post
        const feedEl = document.getElementById('stcm_feed');
        const row = feedEl?.querySelector(`article[data-post="${idx}"] > .stcm-psum`);
        if (row && row.getBoundingClientRect().top < feedEl.getBoundingClientRect().top) scrollToPostSmooth(idx, false);
    }
}

function setAllOpen(feed, open) {
    if (!open) captureDraft();
    feed.data.posts.forEach((_, i) => setPostOpen(feed.id, i, open));
    updateFoldAllButton(feed);
}

function updateFoldAllButton(feed) {
    const b = document.getElementById('stcm_fold_all');
    if (!b || !feed) return;
    const allOpen = feed.data.posts.length > 0 && feed.data.posts.every((_, i) => openPosts.has(`${feed.id}:${i}`));
    b.dataset.open = allOpen ? '1' : '';
    b.innerHTML = allOpen ? '<i class="fa-solid fa-angles-up"></i> 모두 접기' : '<i class="fa-solid fa-angles-down"></i> 모두 펴기';
}

// ---------------------------------------------------------------------------
// Renderers per platform
// ---------------------------------------------------------------------------
/** 투디갤-style board (투디갤, 깡통): category sidebar, list rows that open in place. */
function tdBoard(feed) {
    const skinCfg = TD_SKINS[feed.platform] ?? TD_SKINS.tdgall;
    const cats = skinCfg.cats;
    const d = feed.data;
    const st = tdState(feed.id);
    const items = d.posts.map((p, i) => ({ p, i }));
    const base = tdBaseNo(feed.id);
    const bt = boardTimes(feed);
    const no = new Map(bt.order.map((i, k) => [i, bt.order.length - k]));   // post numbers go up with time
    const order = st.sort === 'best'
        ? [...items].sort((a, b) => (b.p.likes || 0) - (a.p.likes || 0))
        : bt.order.map(i => items[i]);   // most recent first, like a real board
    const best = tdBestList(feed);
    const bi = Math.max(0, Math.min(st.best, best.length - 1));
    const counts = {};
    for (const { p } of items) counts[tdCatOf(p, feed.platform)] = (counts[tdCatOf(p, feed.platform)] ?? 0) + 1;
    const fid = esc(feed.id);
    const anon = PLATFORMS[feed.platform]?.anon || 'ㅇㅇ';
    const opLabel = NUMBERED_ANON[feed.platform]?.op;
    const who = (o) => `<b${opLabel && o.author === opLabel ? ' class="op"' : ''}>${esc(o.author || anon)}</b>${o.handle && skinCfg.codes ? `<small class="stcm-td-code">${esc(o.handle)}</small>` : ''}${meBadge(o)}`;
    const catList = cats.map(c => `<button class="stcm-td-catitem ${c === st.cat ? 'active' : ''}" data-act="td-cat" data-feed="${fid}" data-cat="${esc(c)}"><span class="ico">${skinCfg.icons[c] ?? '•'}</span><span>${c === '전체' ? '전체 글' : esc(c)}</span>${c !== '전체' && counts[c] ? `<small>${counts[c]}</small>` : ''}${c === '전체' ? '<i class="fa-solid fa-chevron-right"></i>' : ''}</button>`).join('');
    const chips = cats.map(c => `<button class="stcm-td-chip ${c === st.cat ? 'active' : ''}" data-act="td-cat" data-feed="${fid}" data-cat="${esc(c)}"><span class="ico">${skinCfg.icons[c] ?? '•'}</span>${esc(c)}</button>`).join('');
    const anyVisible = items.some(({ p }) => tdVisible(feed, p));
    const hiddenOld = pagedOut(feed);   // behind 과거 글 더보기: not drawn
    const rows = order.filter(({ i }) => (renderOnly != null ? i === renderOnly : !hiddenOld.has(i))).map(({ p, i }) => {
        const cat = tdCatOf(p, feed.platform);
        const n = tdCount(p);
        const open = openPosts.has(`${feed.id}:${i}`) || (composer && composer.feedId === feed.id && composer.postIdx === i);
        return `<article class="stcm-td-post ${open ? 'open' : ''} ${tdVisible(feed, p) ? '' : 'stcm-hide'}" data-post="${i}">
            <div class="stcm-td-row" data-act="td-toggle" data-feed="${fid}" data-idx="${i}">
                <span class="no">${base + (no.get(i) ?? i + 1)}</span>
                <span class="cat">${esc(cat)}</span>
                <span class="tt">${p.isMe ? '<i class="fa-solid fa-pen-nib stcm-td-mine"></i>' : ''}${esc(ttl(p) || truncate(p.body, 40))}${n ? ` <em>[${n}]</em>` : ''}</span>
                <span class="au">${esc(p.author || anon)}</span>
                <span class="tm">${esc(bt.time(i))}</span>
                <span class="vw">${num(p.views, 'ko')}</span>
                <span class="rc">${num(p.likes)}</span>
            </div>
            <div class="stcm-td-detail">
                <div class="stcm-td-dhead">
                    <span class="stcm-td-badge">${esc(cat)}</span>
                    <h3>${esc(ttl(p))}</h3>
                    <div class="stcm-td-meta">${who(p)}<span>${esc(bt.time(i))}</span><span>조회 ${num(p.views, 'ko')}</span><span>${skinCfg.heart ? '♡' : '추천'} ${num(p.likes)}</span><span>댓글 ${n}</span></div>
                </div>
                <div class="stcm-body">${txt(p, feed.platform)}</div>${imgBox(p)}
                <div class="stcm-td-rec">${skinCfg.heart
                    ? `<span class="heart"><i class="fa-regular fa-heart"></i> ${num(p.likes)}</span>`   // 깡통: one heart button
                    : `<span class="star"><i class="fa-solid fa-star"></i> 추천 <b>${num(p.likes)}</b></span>`}</div>
                <div class="stcm-td-comments">
                ${p.comments.length ? `<div class="stcm-td-ctitle">댓글 <b>${n}</b></div>` : ''}
                ${p.comments.map((c, ci) => `
                    <div class="stcm-td-c" data-k="${i}.${ci}"><div class="h">${who(c)}<span>${esc(c.time)}</span></div><div class="stcm-body">${txt(c, feed.platform)}</div>${itemLinks(feed, i, ci, null, c)}</div>
                    ${c.replies.map((r, ri) => `<div class="stcm-td-c reply" data-k="${i}.${ci}.${ri}"><div class="h"><i class="fa-solid fa-reply fa-rotate-180"></i> ${who(r)}<span>${esc(r.time)}</span></div><div class="stcm-body">${txt(r, feed.platform)}</div>${itemLinks(feed, i, ci, ri, r)}</div>`).join('')}
                    ${slotAt(feed, i, `c${ci}`)}
                `).join('')}
                </div>
                ${postFooter(feed, i)}
            </div>
        </article>`;
    }).join('');
    const bestPost = best[bi];
    const banner = best.length ? `<div class="stcm-td-best">
            <span class="lbl"><i class="fa-solid fa-star"></i> 개념글</span>
            <a class="tt" data-act="td-open" data-feed="${fid}" data-idx="${bestPost.i}">${esc(ttl(bestPost.p) || truncate(bestPost.p.body, 40))}${tdCount(bestPost.p) ? ` <em>[${tdCount(bestPost.p)}]</em>` : ''}</a>
            <span class="pager"><button data-act="td-best" data-feed="${fid}" data-dir="-1" aria-label="이전"><i class="fa-solid fa-chevron-left"></i></button>${bi + 1}/${best.length}<button data-act="td-best" data-feed="${fid}" data-dir="1" aria-label="다음"><i class="fa-solid fa-chevron-right"></i></button></span>
        </div>` : '';
    return `<div class="stcm-skin stcm-tdgall stcm-td-${feed.platform}">
        <div class="stcm-td-brand"><span class="logo"><span class="mark">${skinCfg.mark}</span>${esc(skinCfg.name)}</span>${d.board && String(d.board).trim() !== skinCfg.name ? `<span class="board">${esc(d.board)}</span>` : ''}</div>
        <div class="stcm-td-layout">
            <aside class="stcm-td-side">
                <div class="stcm-td-sidehead"><i class="fa-solid fa-folder-open"></i> 카테고리</div>
                <div class="stcm-td-catlist">${catList}</div>
            </aside>
            <div class="stcm-td-mainc">
                <div class="stcm-td-card stcm-td-toolbar">
                    <div class="stcm-td-sorts">
                        <button class="${st.sort !== 'best' ? 'active' : ''}" data-act="td-sort" data-feed="${fid}" data-sort="latest"><i class="fa-regular fa-clock"></i> 최신</button>
                        <button class="${st.sort === 'best' ? 'active' : ''}" data-act="td-sort" data-feed="${fid}" data-sort="best"><i class="fa-regular fa-star"></i> 개념글</button>
                    </div>
                    <label class="stcm-td-search"><input type="search" class="stcm-td-q" data-feed="${fid}" value="${esc(st.q)}" placeholder="검색어"><i class="fa-solid fa-magnifying-glass"></i></label>
                </div>
                <div class="stcm-td-chips">${chips}</div>
                ${banner}
                <div class="stcm-td-card stcm-td-table">
                    <div class="stcm-td-filter">필터
                        <span class="seg">${[['all', '전체'], ['best', '개념'], ['me', '내 글']].map(([k, l]) => `<button class="${st.filter === k ? 'active' : ''}" data-act="td-filter" data-feed="${fid}" data-filter="${k}">${l}</button>`).join('')}</span>
                    </div>
                    <div class="stcm-td-head"><span class="no">번호</span><span class="cat">카테고리</span><span class="tt">제목</span><span class="au">글쓴이</span><span class="tm">날짜</span><span class="vw">조회</span><span class="rc">${skinCfg.heart ? '♡' : '추천'}</span></div>
                    ${rows || '<div class="stcm-empty">글이 없어요.</div>'}
                    <div class="stcm-td-none ${anyVisible || !items.length ? 'stcm-hide' : ''}">조건에 맞는 글이 없어요.</div>
                </div>
            </div>
        </div>
        <button class="stcm-td-write" data-act="td-write" data-feed="${fid}"><i class="fa-solid fa-pen-to-square"></i> 글쓰기</button>
    </div>`;
}

const renderers = {
    naver(feed) {
        const d = feed.data;
        return `<div class="stcm-skin stcm-naver">
            <div class="stcm-n-top"><i class="fa-solid fa-mug-hot"></i> ${esc(d.board || '카페')}</div>
            ${newestFirst(feed, (p, i) => `
            <article class="stcm-n-post" data-post="${i}">
                <div class="stcm-n-board">${esc(p.tags?.[0] || '자유게시판')}</div>
                <h3>${esc(ttl(p))}</h3>
                <div class="stcm-n-meta">${avatar(p.author)}<b>${esc(p.author)}</b>${meBadge(p)}<span>${esc(postTime(feed, i))}</span><span>조회 ${num(p.views, 'ko')}</span></div>
                <div class="stcm-body">${txt(p, 'naver')}</div>${imgBox(p)}
                <div class="stcm-n-foot"><span><i class="fa-regular fa-heart"></i> 좋아요 ${num(p.likes, 'ko')}</span><span><i class="fa-regular fa-comment"></i> 댓글 ${p.comments.reduce((a, c) => a + 1 + c.replies.length, 0)}</span></div>
                <div class="stcm-n-comments">
                ${p.comments.map((c, ci) => `
                    <div class="stcm-n-c" data-k="${i}.${ci}">${avatar(c.author, 'sm')}<div><b>${esc(c.author)}</b>${meBadge(c)}<div class="stcm-body">${txt(c, 'naver')}</div><small>${esc(c.time)}</small>${itemLinks(feed, i, ci, null, c)}</div></div>
                    ${c.replies.map((r, ri) => `<div class="stcm-n-c reply" data-k="${i}.${ci}.${ri}"><span class="stcm-ret">ㄴ</span>${avatar(r.author, 'sm')}<div><b>${esc(r.author)}</b>${meBadge(r)}<div class="stcm-body">${txt(r, 'naver')}</div><small>${esc(r.time)}</small>${itemLinks(feed, i, ci, ri, r)}</div></div>`).join('')}
                    ${slotAt(feed, i, `c${ci}`)}
                `).join('')}
                </div>
                ${postFooter(feed, i)}
            </article>`).join('')}
        </div>`;
    },

    dcinside(feed) {
        const d = feed.data;
        const who = (o) => `${esc(o.author || 'ㅇㅇ')}${o.handle ? `<span class="stcm-ip">(${esc(o.handle)})</span>` : ''}${meBadge(o)}`;
        return `<div class="stcm-skin stcm-dc">
            <div class="stcm-dc-top">${esc(d.board || '갤러리')}</div>
            ${newestFirst(feed, (p, i) => `
            <article class="stcm-dc-post" data-post="${i}">
                <h3>${esc(ttl(p))} <span class="stcm-dc-cnt">[${p.comments.reduce((a, c) => a + 1 + c.replies.length, 0)}]</span></h3>
                <div class="stcm-dc-meta"><span>${who(p)}</span><span>${esc(postTime(feed, i))}</span><span>조회 ${num(p.views)}</span><span>추천 ${num(p.likes)}</span></div>
                <div class="stcm-body">${txt(p, 'dcinside')}</div>${imgBox(p)}
                <div class="stcm-dc-rec"><span class="up">개추 ${num(p.likes)}</span><span class="down">비추 ${Math.floor((Number(p.likes) || 0) / 7)}</span></div>
                <div class="stcm-dc-comments">
                ${p.comments.map((c, ci) => `
                    <div class="stcm-dc-c" data-k="${i}.${ci}"><div class="nick">${who(c)}</div><div class="stcm-body">${txt(c, 'dcinside')}${itemLinks(feed, i, ci, null, c)}</div><div class="time">${esc(c.time)}</div></div>
                    ${c.replies.map((r, ri) => `<div class="stcm-dc-c reply" data-k="${i}.${ci}.${ri}"><div class="nick">↳ ${who(r)}</div><div class="stcm-body">${txt(r, 'dcinside')}${itemLinks(feed, i, ci, ri, r)}</div><div class="time">${esc(r.time)}</div></div>`).join('')}
                    ${slotAt(feed, i, `c${ci}`)}
                `).join('')}
                </div>
                ${postFooter(feed, i)}
            </article>`).join('')}
        </div>`;
    },

    reddit(feed) {
        const d = feed.data;
        const sub = String(d.board || 'r/community').startsWith('r/') ? d.board : `r/${d.board}`;
        const uname = (o) => `u/${String(o.handle || o.author || 'anon').replace(/^u\//, '')}`;
        const comment = (c, i, ci, ri) => `
            <div class="stcm-r-c" style="--depth:${ri == null ? 0 : 1}" data-k="${i}.${ci}${ri == null ? '' : '.' + ri}">
                <div class="stcm-r-cmeta">${avatar(c.handle || c.author, 'sm')}<b>${esc(uname(c))}</b>${meBadge(c)}<span>· ${esc(c.time)}</span></div>
                <div class="stcm-body">${txt(c, 'reddit')}</div>${imgBox(c)}
                <div class="stcm-r-cact"><i class="fa-solid fa-arrow-up"></i> ${num(c.likes)} <i class="fa-solid fa-arrow-down"></i>${itemLinks(feed, i, ci, ri, c)}</div>
                ${ri == null ? (c.replies ?? []).map((r, rj) => comment(r, i, ci, rj)).join('') + slotAt(feed, i, `c${ci}`) : ''}
            </div>`;
        return `<div class="stcm-skin stcm-reddit">
            <div class="stcm-r-top"><i class="fa-brands fa-reddit-alien"></i> ${esc(sub)}</div>
            ${newestFirst(feed, (p, i) => `
            <article class="stcm-r-post" data-post="${i}">
                <div class="stcm-r-meta"><b>${esc(sub)}</b> · Posted by ${esc(uname(p))}${meBadge(p)} · ${esc(postTime(feed, i))}</div>
                <h3>${esc(ttl(p))}${p.tags?.[0] ? ` <span class="stcm-flair">${esc(p.tags[0])}</span>` : ''}</h3>
                <div class="stcm-body">${txt(p, 'reddit')}</div>${imgBox(p)}
                <div class="stcm-r-act"><span class="vote"><i class="fa-solid fa-arrow-up"></i> ${num(p.likes)} <i class="fa-solid fa-arrow-down"></i></span><span><i class="fa-regular fa-comment"></i> ${p.comments.reduce((a, c) => a + 1 + c.replies.length, 0)} Comments</span></div>
                <div class="stcm-r-comments">${p.comments.map((c, ci) => comment(c, i, ci, null)).join('')}</div>
                ${postFooter(feed, i)}
            </article>`).join('')}
        </div>`;
    },

    twitter(feed) {
        const d = feed.data;
        const handle = (o) => `@${esc(String(o.handle || o.author || 'user').replace(/^@/, ''))}`;
        const tweet = (o, isReply, links = '', replyCount = 0, key = '', tm = o.time) => `
            <div class="stcm-t-tweet ${isReply ? 'reply' : ''}" data-k="${key}">
                ${avatar(o.author)}
                <div class="stcm-t-main">
                    <div class="stcm-t-head"><b>${esc(o.author)}</b>${meBadge(o)}<span>${handle(o)} · ${esc(tm)}</span></div>
                    <div class="stcm-body">${txt(o, 'twitter')}</div>${imgBox(o)}
                    <div class="stcm-t-act">
                        <span><i class="fa-regular fa-comment"></i> ${num(replyCount)}</span>
                        <span><i class="fa-solid fa-retweet"></i> ${num(o.shares)}</span>
                        <span><i class="fa-regular fa-heart"></i> ${num(o.likes)}</span>
                        ${o.views ? `<span><i class="fa-solid fa-chart-simple"></i> ${num(o.views)}</span>` : ''}
                    </div>
                    ${links}
                </div>
            </div>`;
        return `<div class="stcm-skin stcm-twitter">
            <div class="stcm-t-top"><i class="fa-brands fa-x-twitter"></i> ${esc(d.board || 'Trending')}</div>
            ${newestFirst(feed, (p, i) => `
            <article class="stcm-t-thread" data-post="${i}">
                ${tweet(p, false, '', p.comments.length, `${i}.op`, postTime(feed, i))}
                ${p.comments.map((c, ci) => tweet(c, true, itemLinks(feed, i, ci, null, c), c.replies.length, `${i}.${ci}`) + c.replies.map((r, ri) => tweet(r, true, itemLinks(feed, i, ci, ri, r), 0, `${i}.${ci}.${ri}`)).join('') + (slotAt(feed, i, `c${ci}`) ? `<div class="stcm-t-foot">${slotAt(feed, i, `c${ci}`)}</div>` : '')).join('')}
                <div class="stcm-t-foot">${postFooter(feed, i)}</div>
            </article>`).join('')}
        </div>`;
    },

    fivech(feed) {
        const d = feed.data;
        const w = uiWords('fivech', feed.lang) ?? UI_WORDS.ja;
        const res = (o, n, links, key, tm = o.time) => `
            <div class="stcm-5-res" data-k="${key}">
                <div class="stcm-5-head"><span class="n">${n}</span> ${esc(w.name)}<span class="name">${esc(o.author || w.anon.fivech)}</span>${meBadge(o)} <span class="date">${esc(tm)}</span> <span class="id">ID:${esc(o.handle || '????????')}</span></div>
                <div class="stcm-body">${txt(o, 'fivech')}</div>${imgBox(o)}
                ${links}
            </div>`;
        return `<div class="stcm-skin stcm-5ch">
            <div class="stcm-5-top">${esc(d.board || '板')}</div>
            ${newestFirst(feed, (p, i) => {
                let n = 1;
                const all = [res(p, n, itemLinks(feed, i, null, null, p, 1), `${i}.op`, postTime(feed, i)) + slotAt(feed, i, 'op')];
                p.comments.forEach((c, ci) => {
                    all.push(res(c, ++n, itemLinks(feed, i, ci, null, c, n), `${i}.${ci}`) + slotAt(feed, i, `c${ci}`));
                    c.replies.forEach((r, ri) => {
                        all.push(res(r, ++n, itemLinks(feed, i, ci, ri, r, n), `${i}.${ci}.${ri}`) + slotAt(feed, i, `r${ci}.${ri}`));
                    });
                });
                return `<article class="stcm-5-thread" data-post="${i}">
                    <h3>${esc(ttl(p))} <small>(${n})</small></h3>
                    ${all.join('')}
                    ${postFooter(feed, i)}
                </article>`;
            }).join('')}
        </div>`;
    },

    weibo(feed) {
        const d = feed.data;
        return `<div class="stcm-skin stcm-weibo">
            <div class="stcm-w-top"><i class="fa-brands fa-weibo"></i> ${esc(d.board || '微博')}</div>
            ${newestFirst(feed, (p, i) => `
            <article class="stcm-w-post" data-post="${i}">
                <div class="stcm-w-head">${avatar(p.author)}<div><b>${esc(p.author)}</b>${meBadge(p)}<small>${esc(postTime(feed, i))} ${esc(uiWords('weibo', feed.lang)?.via ?? '来自 微博客户端')}</small></div></div>
                ${p.title ? `<h3>${esc(ttl(p))}</h3>` : ''}
                <div class="stcm-body">${txt(p, 'weibo')}</div>${imgBox(p)}
                <div class="stcm-w-act"><span><i class="fa-solid fa-share"></i> ${num(p.shares, 'zh')}</span><span><i class="fa-regular fa-comment"></i> ${num(p.comments.length, 'zh')}</span><span><i class="fa-regular fa-thumbs-up"></i> ${num(p.likes, 'zh')}</span></div>
                <div class="stcm-w-comments">
                ${p.comments.map((c, ci) => `
                    <div class="stcm-w-c" data-k="${i}.${ci}">${avatar(c.author, 'sm')}<div><b>${esc(c.author)}</b>${meBadge(c)}：<span class="stcm-body">${txt(c, 'weibo')}</span><small>${esc(c.time)} <i class="fa-regular fa-thumbs-up"></i> ${num(c.likes, 'zh')}</small>${itemLinks(feed, i, ci, null, c)}
                    ${c.replies.length ? `<div class="stcm-w-replies">${c.replies.map((r, ri) => `<div data-k="${i}.${ci}.${ri}"><b>${esc(r.author)}</b>${meBadge(r)}：${txt(r, 'weibo')}${itemLinks(feed, i, ci, ri, r)}</div>`).join('')}</div>` : ''}
                    ${slotAt(feed, i, `c${ci}`)}
                    </div></div>`).join('')}
                </div>
                ${postFooter(feed, i)}
            </article>`).join('')}
        </div>`;
    },

    discord(feed) {
        const d = feed.data;
        const sel = dsSelected(feed);
        const chans = [];
        const dms = [];
        d.posts.forEach((p, i) => (p.kind === 'dm' ? dms : chans).push(i));
        const nameOf = (p) => (p.kind === 'dm' ? dmPartnerLabel(p) : String(ttl(p) || '일반').replace(/^#\s*/, ''));
        const msgHtml = (o, i, ci, ri, p) => {
            const refTo = p && o.ref != null ? p.comments[o.ref] : null;
            const canDm = !o.isMe && o.author && p?.kind !== 'dm';
            return `<div class="stcm-ds-msg" data-k="${i}.${ci ?? 'op'}${ri != null ? '.' + ri : ''}">
                ${avatar(o.author)}
                <div class="stcm-ds-mbody">
                    ${refTo ? `<div class="stcm-ds-ref"><i class="fa-solid fa-reply"></i> <b>${esc(refTo.author)}</b> ${esc(truncate(refTo.body, 60))}</div>` : ''}
                    <div class="stcm-ds-mhead"><b style="color:${hashColor(o.author)}">${esc(o.author || 'user')}</b>${meBadge(o)}<span>${esc(o.time)}</span>${canDm ? `<a class="stcm-link" data-act="dm-new" data-feed="${esc(feed.id)}" data-to="${esc(o.author)}" title="이 사람에게 DM">DM</a>` : ''}</div>
                    <div class="stcm-body">${txt(o, 'discord')}</div>${imgBox(o)}
                    ${ci != null ? itemLinks(feed, i, ci, ri, o) : ''}
                </div>
            </div>`;
        };
        const side = `<nav class="stcm-ds-side">
            <div class="stcm-ds-server"><i class="fa-brands fa-discord"></i> ${esc(d.board || '서버')}</div>
            <div class="stcm-ds-sec">채널</div>
            ${chans.map(i => `<button class="stcm-ds-ch ${i === sel ? 'active' : ''}" data-act="ds-open" data-feed="${esc(feed.id)}" data-idx="${i}"><i class="fa-solid fa-hashtag"></i><span>${esc(nameOf(d.posts[i]))}</span></button>`).join('') || '<div class="stcm-ds-empty">채널 없음</div>'}
            <div class="stcm-ds-sec">다이렉트 메시지 <button class="stcm-ds-add" data-act="dm-new" data-feed="${esc(feed.id)}" title="새 DM"><i class="fa-solid fa-plus"></i></button></div>
            ${dms.map(i => `<button class="stcm-ds-ch dm ${i === sel ? 'active' : ''}" data-act="ds-open" data-feed="${esc(feed.id)}" data-idx="${i}">${avatar(nameOf(d.posts[i]), 'sm')}<span>${esc(nameOf(d.posts[i]))}</span></button>`).join('') || '<div class="stcm-ds-empty">없음</div>'}
        </nav>`;
        const panes = d.posts.map((p, i) => {
            if (renderOnly != null && i !== renderOnly) return '';   // re-drawing one channel
            const isDm = p.kind === 'dm';
            const head = isDm
                ? `<i class="fa-solid fa-at"></i> ${esc(nameOf(p))} <small>${esc(dmSubtitle(p))}</small>`
                : `<i class="fa-solid fa-hashtag"></i> ${esc(nameOf(p))}`;
            const first = !isDm && (p.body || p.author) ? msgHtml(p, i, null, null, null) : '';
            const msgs = p.comments.map((c, ci) => msgHtml(c, i, ci, null, p) + c.replies.map((r, ri) => msgHtml(r, i, ci, ri, p)).join('')).join('');
            return `<article class="stcm-ds-pane ${i === sel ? '' : 'stcm-hide'}" data-post="${i}">
                <div class="stcm-ds-head">${head}</div>
                <div class="stcm-ds-msgs">${first}${msgs || (isDm ? '<div class="stcm-ds-empty">아직 메시지가 없어요. 아래에서 보내거나 "대화 이어가기"로 상대가 먼저 말을 걸게 해 보세요.</div>' : '')}</div>
                ${postFooter(feed, i)}
            </article>`;
        }).join('');
        return `<div class="stcm-skin stcm-discord"><div class="stcm-ds-wrap">${side}<div class="stcm-ds-main">${panes || '<div class="stcm-ds-empty">채널이 없어요.</div>'}</div></div></div>`;
    },

    tdgall(feed) { return tdBoard(feed); },
    kkangtong(feed) { return tdBoard(feed); },

    blind(feed) {
        const d = feed.data;
        const who = (o, op) => `<span class="co">${esc(o.author || '회사 비공개')}</span>${o.handle ? `<span class="nick">· ${esc(o.handle)}</span>` : ''}${op && o.author && o.author === op.author && o.handle === op.handle ? '<span class="stcm-bl-op">작성자</span>' : ''}${meBadge(o)}`;
        return `<div class="stcm-skin stcm-blind">
            <div class="stcm-bl-top"><i class="fa-solid fa-user-secret"></i> 블라인드${d.board && !/^블라인드$/i.test(String(d.board).trim()) ? ` <span>· ${esc(d.board)}</span>` : ''}</div>
            ${newestFirst(feed, (p, i) => {
                const n = p.comments.reduce((a, cm) => a + 1 + cm.replies.length, 0);
                return `<article class="stcm-bl-post" data-post="${i}">
                <div class="stcm-bl-ch">${esc(p.tags?.[0] || '블라블라')}</div>
                <h3>${esc(ttl(p))}</h3>
                <div class="stcm-bl-meta">${who(p)}<span class="tm">${esc(postTime(feed, i))}</span></div>
                <div class="stcm-body">${txt(p, 'blind')}</div>${imgBox(p)}
                <div class="stcm-bl-foot"><span><i class="fa-regular fa-eye"></i> ${num(p.views, 'ko')}</span><span><i class="fa-regular fa-thumbs-up"></i> ${num(p.likes, 'ko')}</span><span><i class="fa-regular fa-comment"></i> ${n}</span></div>
                <div class="stcm-bl-comments">
                ${p.comments.map((cm, ci) => `
                    <div class="stcm-bl-c" data-k="${i}.${ci}"><div class="h">${who(cm, p)}<span class="tm">${esc(cm.time)}</span></div><div class="stcm-body">${txt(cm, 'blind')}</div><div class="f"><span><i class="fa-regular fa-thumbs-up"></i> ${num(cm.likes, 'ko')}</span>${itemLinks(feed, i, ci, null, cm)}</div></div>
                    ${cm.replies.map((r, ri) => `<div class="stcm-bl-c reply" data-k="${i}.${ci}.${ri}"><div class="h"><i class="fa-solid fa-turn-up fa-rotate-90"></i> ${who(r, p)}<span class="tm">${esc(r.time)}</span></div><div class="stcm-body">${txt(r, 'blind')}</div><div class="f"><span><i class="fa-regular fa-thumbs-up"></i> ${num(r.likes, 'ko')}</span>${itemLinks(feed, i, ci, ri, r)}</div></div>`).join('')}
                    ${slotAt(feed, i, `c${ci}`)}
                `).join('')}
                </div>
                ${postFooter(feed, i)}
            </article>`;
            }).join('')}
        </div>`;
    },

    everytime(feed) {
        const d = feed.data;
        const nameCls = (o) => (/글쓴이/.test(String(o.author ?? '')) ? 'op' : '');
        return `<div class="stcm-skin stcm-everytime">
            <div class="stcm-et-top"><i class="fa-solid fa-graduation-cap"></i> ${esc(d.board || '에브리타임')}</div>
            ${newestFirst(feed, (p, i) => {
                const n = p.comments.reduce((a, cm) => a + 1 + cm.replies.length, 0);
                const hot = (Number(p.likes) || 0) >= 10;
                return `<article class="stcm-et-post" data-post="${i}">
                <div class="stcm-et-board">${esc(p.tags?.[0] || '자유게시판')}${hot ? ' <span class="hot">HOT</span>' : ''}</div>
                <div class="stcm-et-head"><span class="stcm-et-pic"><i class="fa-solid fa-user"></i></span><div><b>${esc(p.author || '익명')}</b>${meBadge(p)}<small>${esc(postTime(feed, i))}</small></div></div>
                <h3>${esc(ttl(p))}</h3>
                <div class="stcm-body">${txt(p, 'everytime')}</div>${imgBox(p)}
                <div class="stcm-et-foot"><span class="like"><i class="fa-regular fa-thumbs-up"></i> ${num(p.likes, 'ko')}</span><span class="cmt"><i class="fa-regular fa-comment"></i> ${n}</span><span class="scrap"><i class="fa-regular fa-star"></i> ${num(p.shares, 'ko')}</span></div>
                <div class="stcm-et-comments">
                ${p.comments.map((cm, ci) => `
                    <div class="stcm-et-c" data-k="${i}.${ci}"><div class="h"><span class="stcm-et-pic sm"><i class="fa-solid fa-user"></i></span><b class="${nameCls(cm)}">${esc(cm.author || '익명')}</b>${meBadge(cm)}<span class="lk">${Number(cm.likes) ? `<i class="fa-regular fa-thumbs-up"></i> ${num(cm.likes, 'ko')}` : ''}</span></div><div class="stcm-body">${txt(cm, 'everytime')}</div><small>${esc(cm.time)}</small>${itemLinks(feed, i, ci, null, cm)}
                    ${cm.replies.length ? `<div class="stcm-et-replies">${cm.replies.map((r, ri) => `<div class="stcm-et-c reply" data-k="${i}.${ci}.${ri}"><div class="h"><i class="fa-solid fa-turn-up fa-rotate-90"></i><b class="${nameCls(r)}">${esc(r.author || '익명')}</b>${meBadge(r)}</div><div class="stcm-body">${txt(r, 'everytime')}</div><small>${esc(r.time)}</small>${itemLinks(feed, i, ci, ri, r)}</div>`).join('')}</div>` : ''}
                    ${slotAt(feed, i, `c${ci}`)}
                    </div>`).join('')}
                </div>
                ${postFooter(feed, i)}
            </article>`;
            }).join('')}
        </div>`;
    },

    tieba(feed) {
        const d = feed.data;
        const w = uiWords('tieba', feed.lang) ?? UI_WORDS.zh;
        const bar = String(d.board || (w === UI_WORDS.zh ? '贴' : '')).replace(/吧$/, '').replace(/\s*(티에바|Bar|バー)$/i, '');
        return `<div class="stcm-skin stcm-tieba">
            <div class="stcm-tb-top"><i class="fa-solid fa-paw"></i> ${esc(bar)}${esc(w.bar)}</div>
            ${newestFirst(feed, (p, i) => {
                let floor = 1;
                return `<article class="stcm-tb-thread" data-post="${i}">
                <h3>${esc(ttl(p))}</h3>
                <div class="stcm-tb-floor op">
                    <div class="stcm-tb-user">${avatar(p.author)}<b>${esc(p.author)}</b><span class="lz">${esc(w.lz)}</span>${meBadge(p)}</div>
                    <div class="stcm-body">${txt(p, 'tieba')}</div>${imgBox(p)}
                    <small>${w.floor(floor)} · ${esc(postTime(feed, i))}</small>
                </div>
                ${p.comments.map((c, ci) => `
                <div class="stcm-tb-floor" data-k="${i}.${ci}">
                    <div class="stcm-tb-user">${avatar(c.author)}<b>${esc(c.author)}</b>${c.author === p.author ? `<span class="lz">${esc(w.lz)}</span>` : ''}${meBadge(c)}</div>
                    <div class="stcm-body">${txt(c, 'tieba')}</div>
                    <small>${w.floor(++floor)} · ${esc(c.time)}</small>${itemLinks(feed, i, ci, null, c)}
                    ${c.replies.length ? `<div class="stcm-tb-lzl">${c.replies.map((r, ri) => `<div data-k="${i}.${ci}.${ri}"><b>${esc(r.author)}</b>${meBadge(r)}：${txt(r, 'tieba')} <small>${esc(r.time)}</small>${itemLinks(feed, i, ci, ri, r)}</div>`).join('')}</div>` : ''}
                    ${slotAt(feed, i, `c${ci}`)}
                </div>`).join('')}
                ${postFooter(feed, i)}
            </article>`;
            }).join('')}
        </div>`;
    },
};


// ---------------------------------------------------------------------------
// Discord: selected channel / DM per feed, DM helpers
// ---------------------------------------------------------------------------
const dsSel = new Map();       // feedId → index of the channel / DM shown
const openPosts = new Set();   // `${feedId}:${idx}` posts expanded in the title list
/** Boards drawn with the 투디갤 look. cats[1] is where a post without a known category goes. */
const TD_SKINS = {
    tdgall: {
        name: '투디갤', mark: '🐧', codes: true,
        cats: ['전체', '투디', '웹툰', '소설', '게임', 'AI', '괴담', '남극'],
        icons: { '전체': '📌', '투디': '💬', '웹툰': '📺', '소설': '📖', '게임': '🎮', 'AI': '🤖', '괴담': '👻', '남극': '🐧' },
        alias: {},
    },
    kkangtong: {
        name: '깡통', mark: '🥫', codes: false, heart: true,
        cats: ['전체', '일반', '뉴스', '정보/팁', '로그', 'AI봇', '프롬프트', 'QR', '그림체', '음악', '자료', '확장', '질문', '추천/지식', '덕질', '제작/협업'],
        icons: { '전체': '📌', '일반': '💬', '뉴스': '📰', '정보/팁': '💡', '로그': '📜', 'AI봇': '🤖', '프롬프트': '📝', 'QR': '⚡', '그림체': '🎨', '음악': '🎵', '자료': '📦', '확장': '🧩', '질문': '❓', '추천/지식': '📚', '덕질': '💖', '제작/협업': '🛠️' },
        alias: { '정보': '정보/팁', '팁': '정보/팁', '봇': 'AI봇', 'ai봇': 'AI봇', '캐릭터': 'AI봇', '프롬': '프롬프트', '프리셋': '프롬프트', '퀵리플': 'QR', '퀵리플라이': 'QR', '그림': '그림체', '작가태그': '그림체', '추천': '추천/지식', '지식': '추천/지식', '제작': '제작/협업', '협업': '제작/협업', '잡담': '일반', '자유': '일반' },
    },
};
function tdCats(platform) { return (TD_SKINS[platform] ?? TD_SKINS.tdgall).cats; }
const tdStates = new Map();   // feedId → { cat, sort, q, filter, best }

function tdState(feedId) {
    if (!tdStates.has(feedId)) tdStates.set(feedId, { cat: '전체', sort: 'latest', q: '', filter: 'all', best: 0 });
    return tdStates.get(feedId);
}

/** Stable, believable post numbers per feed. */
function tdBaseNo(feedId) {
    let h = 0;
    for (const ch of String(feedId)) h = (h * 33 + ch.codePointAt(0)) >>> 0;
    return 100000 + (h % 60000);
}

function tdBestList(feed) {
    return feed.data.posts.map((p, i) => ({ p, i }))
        .filter(x => (x.p.likes || 0) > 0)
        .sort((a, b) => (b.p.likes || 0) - (a.p.likes || 0))
        .slice(0, 10);
}

function tdVisible(feed, p) {
    const st = tdState(feed.id);
    if (st.cat !== '전체' && tdCatOf(p, feed.platform) !== st.cat) return false;
    if (st.filter === 'me' && !(p.isMe || p.comments.some(c => c.isMe || c.replies.some(r => r.isMe)))) return false;
    if (st.filter === 'best') {
        const cut = tdBestList(feed).at(-1)?.p.likes ?? Infinity;
        if ((p.likes || 0) < cut || !(p.likes > 0)) return false;
    }
    const q = st.q.trim().toLowerCase();
    if (q && !`${p.title} ${p.title_tr ?? ''} ${p.body} ${p.body_tr ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
}

/** Re-apply tab / filter / search without re-rendering (no jumps, keeps typing focus). */
function tdApply(feedId) {
    const feed = getFeed(feedId);
    const skin = document.querySelector('#stcm_feed .stcm-tdgall');
    if (!feed || !skin) return;
    const st = tdState(feedId);
    // a filter / search looks at every post, clearing it goes back to the newest ones:
    // when that changes which posts must be drawn, draw the board again (keeping the search box as it was)
    const hidden = pagedOut(feed);
    const drawn = new Set([...skin.querySelectorAll('.stcm-td-post')].map(a => Number(a.dataset.post)));
    const want = feed.data.posts.map((_, i) => i).filter(i => !hidden.has(i));
    if (want.length !== drawn.size || want.some(i => !drawn.has(i))) {
        const q = document.activeElement?.classList?.contains('stcm-td-q') ? document.activeElement : null;
        const caret = q ? [q.selectionStart, q.selectionEnd] : null;
        showFeed(feedId, { keepScroll: true });
        if (caret) {
            const nq = document.querySelector('#stcm_feed .stcm-td-q');
            if (nq) { nq.focus({ preventScroll: true }); try { nq.setSelectionRange(...caret); } catch { /* ignore */ } }
        }
        return;
    }
    let shown = 0;
    skin.querySelectorAll('.stcm-td-post').forEach(a => {
        const p = feed.data.posts[Number(a.dataset.post)];
        const vis = p ? tdVisible(feed, p) : false;
        a.classList.toggle('stcm-hide', !vis);
        if (vis) shown++;
    });
    skin.querySelector('.stcm-td-none')?.classList.toggle('stcm-hide', shown > 0 || !feed.data.posts.length);
    applyPaging(feed, document.getElementById('stcm_feed'));
    skin.querySelectorAll('[data-act="td-cat"]').forEach(b => b.classList.toggle('active', b.dataset.cat === st.cat));
    skin.querySelectorAll('[data-act="td-filter"]').forEach(b => b.classList.toggle('active', b.dataset.filter === st.filter));
}

function tdCount(p) {
    return p.comments.reduce((a, c) => a + 1 + c.replies.length, 0);
}

function tdCatOf(p, platform = 'tdgall') {
    const skin = TD_SKINS[platform] ?? TD_SKINS.tdgall;
    const t = String(p?.tags?.[0] ?? '').replace(/(갤러리|갤|게시판|탭)$/, '').trim().toLowerCase();
    const hit = skin.cats.find(c => c !== '전체' && (c.toLowerCase() === t || c.toLowerCase().replace(/\s/g, '') === t.replace(/\s/g, '')));
    return hit ?? skin.alias[t.replace(/\s/g, '')] ?? skin.cats[1];
}

function dsSelected(feed) {
    const n = feed.data.posts.length;
    const s = dsSel.get(feed.id);
    if (Number.isInteger(s) && s >= 0 && s < n) return s;
    const firstChannel = feed.data.posts.findIndex(p => p.kind !== 'dm');
    return firstChannel >= 0 ? firstChannel : 0;
}

/** Display name of one side of a DM ({ as, name|charName, nick }). */
function dmSideName(side) {
    if (!side) return '?';
    if (side.nick?.trim()) return side.nick.trim();
    if (side.as === 'user') return ctx().name1 || '유저';
    if (side.as === 'char') return side.charName || side.name || '캐릭터';
    return side.name || '익명';
}

/** English description of a DM side for prompts. */
function dmSideEn(side) {
    const shown = dmSideName(side);
    if (side?.as === 'user') return `${ctx().name1 || 'User'} (the story protagonist${shown !== (ctx().name1 || '') ? `, shown as "${shown}"` : ''})`;
    if (side?.as === 'char') {
        const real = side.charName || side.name || 'a character';
        return `${real} (a story character${shown !== real ? `, shown as "${shown}"` : ''})`;
    }
    return `${shown} (an ordinary server member, not a story character)`;
}

function dmPartnerLabel(p) {
    return p.dm?.partner ? dmSideName(p.dm.partner) : (p.title || 'DM');
}

function dmSubtitle(p) {
    return `${dmSideName(p.dm?.me)} ↔ ${dmSideName(p.dm?.partner)}`;
}

/** Who is speaking in a DM item, as a story-level label for pins. */
function dmSpeakerLabel(post, o) {
    if (o.isMe) return storyAuthor(o) ? authorLabel(o) : dmSideName(post.dm?.me);
    const partner = post.dm?.partner;
    if (partner?.as === 'char') return `${partner.charName || partner.name} (posting as "${o.author || dmSideName(partner)}")`;
    if (partner?.as === 'user') return `${ctx().name1 || 'User'} (posting as "${o.author || dmSideName(partner)}")`;
    return o.author || dmSideName(partner);
}

function dmToPinText(post) {
    const me = post.dm?.me;
    const partner = post.dm?.partner;
    const lines = [`Discord DM between ${dmSideEn(me)} and ${dmSideEn(partner)}:`];
    const items = post.comments.flatMap(c => [c, ...c.replies]);
    const shown = items.length > 24 ? [...items.slice(0, 4), null, ...items.slice(-18)] : items;
    for (const o of shown) {
        if (!o) { lines.push('  …'); continue; }
        lines.push(`  ${dmSpeakerLabel(post, o)}: ${truncate(o.body, 300)}`);
    }
    return lines.join('\n');
}

/** Names offered as DM recipients: story characters + people seen in this server's channels. */
function dmCandidateNames(feed) {
    const names = new Set(characterNames());
    for (const p of feed?.data.posts ?? []) {
        if (p.kind === 'dm') continue;
        for (const o of [p, ...p.comments, ...p.comments.flatMap(c => c.replies)]) if (o.author && !o.isMe) names.add(o.author);
    }
    return [...names].slice(0, 60);
}

let dmDraft = null;   // { feedId }

function showDmCompose(feedId, toName = '') {
    const feed = getFeed(feedId);
    if (!feed) return;
    leaveFeed();
    view = 'dm-new';
    dmDraft = { feedId };
    const names = dmCandidateNames(feed);
    const isChar = toName && characterNames().includes(toName);
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">새 DM · <b>${esc(feed.data.board || '디스코드')}</b></span>`;
    el.innerHTML = `<div class="stcm-compose-view stcm-dm-view">
        <p class="stcm-cp-hint">보내는 사람과 받는 사람을 고르세요. 첫 메시지를 비워 두고 "상대가 먼저 말 걸기"를 켜면 상대가 먼저 DM을 보내요.</p>
        <label class="stcm-cp-check">보내는 사람</label>
        ${identityControls()}
        <label class="stcm-cp-check">받는 사람</label>
        <div class="stcm-cp-row">
            <select class="stcm-dm-to-as">
                <option value="char" ${isChar || (!toName && characterNames().length) ? 'selected' : ''}>캐릭터</option>
                <option value="user">${esc(ctx().name1 || '유저')}</option>
                <option value="mob" ${toName && !isChar ? 'selected' : ''}>서버 멤버</option>
            </select>
            <input class="stcm-dm-to-name" type="text" list="stcm_dm_names" maxlength="60" value="${esc(toName || (characterNames().length === 1 ? characterNames()[0] : ''))}" placeholder="이름">
            <input class="stcm-dm-to-nick" type="text" maxlength="40" placeholder="표시 닉네임 (선택)">
        </div>
        <datalist id="stcm_dm_names">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        <textarea class="stcm-cp-body" rows="4" placeholder="첫 메시지 (비워도 돼요)"></textarea>
        <div class="stcm-cp-ai">
            <input class="stcm-cp-inst" type="text" maxlength="500" placeholder="AI에게 지시 (선택) — 예: 어제 일 사과하는 DM">
            <button data-act="ai-write-dm"><i class="fa-solid fa-wand-magic-sparkles"></i> AI로 쓰기</button>
        </div>
        <div class="stcm-cp-foot">
            <label class="stcm-cp-check"><input type="checkbox" class="stcm-cp-react" checked> 답장 / 상대가 먼저 말 걸기</label>
            <button data-act="dm-cancel">취소</button>
            <button class="primary" data-act="dm-create"><i class="fa-solid fa-paper-plane"></i> DM 시작</button>
        </div>
    </div>`;
    const sel = el.querySelector('.stcm-dm-to-as');
    const nameInput = el.querySelector('.stcm-dm-to-name');
    const sync = () => { nameInput.style.display = sel.value === 'user' ? 'none' : ''; };
    sel.addEventListener('change', sync);
    sync();
    el.scrollTop = 0;
}

function readDmTarget(box) {
    const as = box.querySelector('.stcm-dm-to-as')?.value;
    const name = (box.querySelector('.stcm-dm-to-name')?.value ?? '').trim();
    const nick = (box.querySelector('.stcm-dm-to-nick')?.value ?? '').trim();
    if (as === 'user') return { as: 'user', name: ctx().name1 || 'User', nick };
    if (as === 'char') return { as: 'char', charName: name, name, nick };
    return { as: 'mob', name, nick };
}

async function createDm(box) {
    const feed = getFeed(dmDraft?.feedId);
    if (!feed) return;
    const me = readIdentity(box);
    if (!checkIdentity(me)) return;
    const partner = readDmTarget(box);
    if (partner.as !== 'user' && !partner.name) { toastr.warning('받는 사람 이름을 적어 주세요.'); return; }
    if (partner.as === me.as && (me.as === 'user' || (me.as === 'char' && partner.charName === me.charName))) { toastr.warning('자기 자신에게는 DM을 보낼 수 없어요.'); return; }
    const body = box.querySelector('.stcm-cp-body').value.trim();
    const react = box.querySelector('.stcm-cp-react').checked;
    if (!body && !react) { toastr.warning('첫 메시지를 쓰거나 "상대가 먼저 말 걸기"를 켜 주세요.'); return; }
    const gen = feedState.gen;
    const chatAt = feedState.chatId;
    const post = {
        kind: 'dm',
        dm: { me: { as: me.as, nick: me.nick, charName: me.charName }, partner },
        author: '', handle: '', title: dmSideName(partner), body: '', body_tr: '', time: '', likes: 0, views: 0, shares: 0, tags: [],
        comments: [],
    };
    if (body) post.comments.push({ ...playerItem(feed.platform, { ...me, body }, feedLang(feed)), replies: [], at: msgNow() });
    post.at = msgNow();
    feed.data.posts.push(post);   // in this chat's list before any wait
    const idx = feed.data.posts.length - 1;
    dsSel.set(feed.id, idx);
    await rememberIdentity(me);   // also saves the list with the new DM
    if (feedState.gen !== gen) {
        // another chat: the DM was already in its list and its save was queued. Same chat re-loaded / replaced:
        // only if the DM made it into the copy loaded now
        if (feedState.chatId !== chatAt) toastr.info('그 사이 채팅이 바뀌어서, DM은 원래 채팅에 저장만 해 뒀어요.', '커뮤니티');
        else if (!feedState.feeds.some(f => f.data.posts.includes(post))) toastr.error('그 사이 피드가 바뀌어서 DM이 들어가지 못했어요.', '커뮤니티');
        return;
    }
    showFeed(feed.id, { keepScroll: true });
    if (react) await generateMoreComments(feed.id, idx, { playerJustPosted: !!body });
}

function openDsPane(feedId, idx) {
    dsSel.set(feedId, idx);
    const feedEl = document.getElementById('stcm_feed');
    feedEl.querySelectorAll('.stcm-discord .stcm-ds-pane').forEach(a => a.classList.toggle('stcm-hide', Number(a.dataset.post) !== idx));
    feedEl.querySelectorAll('.stcm-discord .stcm-ds-ch').forEach(b => b.classList.toggle('active', Number(b.dataset.idx) === idx));
    if (composer && composer.feedId === feedId && composer.postIdx !== idx) {
        const prev = composer.postIdx;
        composer = null;
        updatePost(feedId, prev);
    }
    // show the newest messages of the opened channel
    const pane = feedEl.querySelector(`.stcm-ds-pane[data-post="${idx}"] .stcm-actions`);
    if (pane) {
        const fr = feedEl.getBoundingClientRect();
        const r = pane.getBoundingClientRect();
        if (r.bottom > fr.bottom || r.top < fr.top) feedEl.scrollBy({ top: r.bottom - fr.bottom + 12, behavior: 'auto' });
    }
}

// ---------------------------------------------------------------------------
// World info selection
// ---------------------------------------------------------------------------
const WI_MODES = {
    off: '사용 안 함',
    auto: '자동 (채팅에서 지금 켜지는 항목)',
    manual: '직접 고른 항목만',
    both: '자동 + 직접 고른 항목',
};

function getWorldNames() {
    const c = ctx();
    try {
        const names = c.getWorldInfoNames?.();
        if (Array.isArray(names) && names.length) return names;
    } catch { /* fall through */ }
    // Fallback for older builds: read the world info editor dropdown
    const opts = [...document.querySelectorAll('#world_editor_select option, #world_info option')]
        .map(o => o.textContent.trim())
        .filter(t => t && t !== '--- None ---' && t !== '--- Pick to Edit ---');
    return [...new Set(opts)];
}

/** Books linked to the current chat / character / global selection, for labels. */
function linkedBooks() {
    const c = ctx();
    const out = {};
    const add = (name, tag) => { if (name) (out[name] ??= []).push(tag); };
    add(c.chatMetadata?.world_info, '채팅');
    if (c.characterId !== undefined) {
        const ch = c.characters?.[c.characterId];
        add(ch?.data?.extensions?.world, '캐릭터');
    } else if (c.groupId) {
        const group = c.groups?.find(g => g.id === c.groupId);
        for (const av of group?.members ?? []) add(c.characters.find(ch => ch.avatar === av)?.data?.extensions?.world, '캐릭터');
    }
    document.querySelectorAll('#world_info option:checked').forEach(o => add(o.textContent.trim(), '전역'));
    for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
    return out;
}

function entryLabel(e) {
    const keys = Array.isArray(e.key) ? e.key.filter(Boolean).join(', ') : '';
    return e.comment?.trim() || keys || `#${e.uid}`;
}

async function loadBookEntries(name) {
    const data = await ctx().loadWorldInfo(name);
    const entries = Object.values(data?.entries ?? {});
    entries.sort((a, b) => (a.displayIndex ?? a.order ?? 0) - (b.displayIndex ?? b.order ?? 0));
    return entries;
}

async function collectPickedWorldInfo() {
    const picks = getChatStore()?.wi?.picks ?? {};
    const out = [];
    for (const [book, uids] of Object.entries(picks)) {
        if (!uids?.length) continue;
        try {
            const entries = await loadBookEntries(book);
            const set = new Set(uids.map(String));
            for (const e of entries) {
                if (set.has(String(e.uid)) && e.content?.trim()) out.push(stripMarkup(e.content));
            }
        } catch (err) {
            console.warn(`[${MODULE}] failed to load world info "${book}"`, err);
        }
    }
    return out;
}

function wiPickCount() {
    const picks = getChatStore()?.wi?.picks ?? {};
    return Object.values(picks).reduce((a, u) => a + (u?.length ?? 0), 0);
}

let wiOpenBooks = new Set();
let wiFilter = '';

async function showWorldInfo() {
    if (!hasChat()) { toastr.warning('먼저 채팅을 열어주세요.'); return; }
    leaveFeed();
    view = 'wi';
    syncSelectors();
    const store = getChatStore();
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">참고할 월드 인포 (이 채팅) · 고른 항목 ${wiPickCount()}개</span>`;

    const names = getWorldNames();
    const linked = linkedBooks();
    const sorted = [...names].sort((a, b) => (linked[b] ? 1 : 0) - (linked[a] ? 1 : 0) || a.localeCompare(b));
    const filter = wiFilter.trim().toLowerCase();

    const books = await Promise.all(sorted.map(async (name) => {
        const open = wiOpenBooks.has(name) || (filter && true);
        let entries = null;
        if (open) {
            try { entries = await loadBookEntries(name); } catch { entries = []; }
        }
        return { name, open, entries };
    }));
    if (view !== 'wi') return;

    const picks = store.wi.picks;
    const rows = books.map(({ name, open, entries }) => {
        const picked = new Set((picks[name] ?? []).map(String));
        let list = entries ?? [];
        if (filter) list = list.filter(e => (name + ' ' + entryLabel(e) + ' ' + (e.content ?? '')).toLowerCase().includes(filter));
        if (filter && !list.length && !name.toLowerCase().includes(filter)) return '';
        const tags = (linked[name] ?? []).map(t => `<span class="stcm-wi-tag">${esc(t)}</span>`).join('');
        return `<div class="stcm-wi-book ${open ? 'open' : ''}" data-book="${esc(name)}">
            <div class="stcm-wi-head" data-act="wi-book">
                <i class="fa-solid ${open ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                <b>${esc(name)}</b>${tags}
                <span class="stcm-wi-count">${picked.size ? `${picked.size}개 선택` : ''}</span>
            </div>
            ${open ? `<div class="stcm-wi-entries">
                <div class="stcm-wi-tools">
                    <a class="stcm-link" data-act="wi-all" data-book="${esc(name)}">전체 선택</a>
                    <a class="stcm-link" data-act="wi-enabled" data-book="${esc(name)}">켜진 항목만</a>
                    <a class="stcm-link" data-act="wi-none" data-book="${esc(name)}">선택 해제</a>
                </div>
                ${list.length ? list.map(e => `
                <label class="stcm-wi-entry ${e.disable ? 'disabled' : ''}">
                    <input type="checkbox" class="stcm-wi-check" data-book="${esc(name)}" data-uid="${esc(e.uid)}" ${picked.has(String(e.uid)) ? 'checked' : ''}>
                    <span class="stcm-wi-title">${e.constant ? '<i class="fa-solid fa-circle stcm-wi-const" title="상시"></i>' : ''}${esc(entryLabel(e))}${e.disable ? ' <small>(꺼짐)</small>' : ''}</span>
                    <small class="stcm-wi-preview">${esc(truncate(stripMarkup(e.content), 120))}</small>
                </label>`).join('') : '<div class="stcm-empty" style="padding:10px">항목이 없어요.</div>'}
            </div>` : ''}
        </div>`;
    }).join('');

    el.innerHTML = `<div class="stcm-wi">
        <label class="stcm-wi-mode">참고 방식
            <select id="stcm_wi_mode">${Object.entries(WI_MODES).map(([k, l]) => `<option value="${k}" ${store.wi.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </label>
        <p class="stcm-cp-hint">${store.wi.mode === 'auto' || store.wi.mode === 'off'
            ? '항목을 골라 두면 <b>직접 고른 항목</b> 방식으로 바꿨을 때 쓰여요.'
            : '고른 항목은 키워드와 상관없이 항상 내용 전체가 들어가요. 실리태번 본편의 켜짐/꺼짐은 바뀌지 않아요.'}</p>
        <input id="stcm_wi_filter" type="text" placeholder="책·항목 검색" value="${esc(wiFilter)}">
        ${(() => {
            // picks for books that were renamed or deleted in SillyTavern
            const known = new Set(names);
            const orphans = Object.keys(picks).filter(b => !known.has(b) && picks[b]?.length);
            return orphans.length && names.length ? `<div class="stcm-import">
                <div><i class="fa-solid fa-triangle-exclamation"></i> 목록에 없는 책에서 고른 항목이 있어요 (이름이 바뀌었거나 지워진 책): <b>${orphans.map(esc).join(', ')}</b></div>
                <div class="stcm-cp-foot"><button data-act="wi-orphans">그 선택 지우기</button></div>
            </div>` : '';
        })()}
        ${names.length ? rows : '<div class="stcm-empty">월드 인포 목록을 찾지 못했어요.</div>'}
    </div>`;
    const f = document.getElementById('stcm_wi_filter');
    f.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) { wiFilter = f.value; showWorldInfo(); }
    });
}

async function setBookPicks(book, uids) {
    const store = getChatStore();
    if (uids.length) store.wi.picks[book] = uids.map(String);
    else delete store.wi.picks[book];
    await saveChatStore();
}

async function onFeedChange(e) {
    if (onApiChange(e)) return;
    const t = e.target;
    if (t.classList.contains('stcm-sp-locale')) {
        t.closest('.stcm-space-form')?.querySelector('.stcm-sp-custom')?.classList.toggle('stcm-hide', t.value !== 'custom');
        return;
    }
    if (t.classList.contains('stcm-cp-as') || t.classList.contains('stcm-cp-char')) {
        const row = t.closest('.stcm-cp-row');
        const sel = row?.querySelector('.stcm-cp-as');
        const charInput = row?.querySelector('.stcm-cp-char');
        if (t.classList.contains('stcm-cp-as')) {
            if (charInput) charInput.style.display = t.value === 'char' ? '' : 'none';
            if (t.value === 'char') charInput?.focus();
        }
        // in a post's comment box: show the name this identity already uses there (or empty → new name)
        const box = t.closest('.stcm-composer');
        const post = box ? getFeed(box.dataset.feed)?.data.posts[Number(box.dataset.idx)] : null;
        const nickInput = row?.querySelector('.stcm-cp-nick');
        if (post && nickInput) nickInput.value = prefillNick(post, { as: sel?.value, charName: (charInput?.value ?? '').trim() }, getFeed(box.dataset.feed));
        return;
    }
    if (t.id === 'stcm_wi_mode') {
        const store = getChatStore();
        store.wi.mode = t.value;
        await saveChatStore();
        showWorldInfo();
        return;
    }
    if (t.classList.contains('stcm-wi-check')) {
        const store = getChatStore();
        const book = t.dataset.book;
        const set = new Set((store.wi.picks[book] ?? []).map(String));
        if (t.checked) set.add(String(t.dataset.uid)); else set.delete(String(t.dataset.uid));
        await setBookPicks(book, [...set]);
        if (t.checked && store.wi.mode === 'auto') {
            store.wi.mode = 'both';
            await saveChatStore();
            toastr.info('참고 방식을 "자동 + 직접 고른 항목"으로 바꿨어요.');
            showWorldInfo();
            return;
        }
        if (t.checked && store.wi.mode === 'off') {
            store.wi.mode = 'manual';
            await saveChatStore();
            toastr.info('참고 방식을 "직접 고른 항목만"으로 바꿨어요.');
            showWorldInfo();
            return;
        }
        const head = t.closest('.stcm-wi-book')?.querySelector('.stcm-wi-count');
        if (head) head.textContent = set.size ? `${set.size}개 선택` : '';
        const info = document.querySelector('#stcm_feedbar .stcm-fb-info');
        if (info) info.textContent = `참고할 월드 인포 (이 채팅) · 고른 항목 ${wiPickCount()}개`;
    }
}

async function onWorldInfoClick(el) {
    const act = el.dataset.act;
    if (act === 'wi-book') {
        const name = el.closest('.stcm-wi-book').dataset.book;
        if (wiOpenBooks.has(name)) wiOpenBooks.delete(name); else wiOpenBooks.add(name);
        const scroll = document.getElementById('stcm_feed').scrollTop;
        await showWorldInfo();
        document.getElementById('stcm_feed').scrollTop = scroll;
        return true;
    }
    if (act === 'wi-orphans') {
        const store = getChatStore();
        const known = new Set(getWorldNames());
        for (const b of Object.keys(store.wi.picks)) if (!known.has(b)) delete store.wi.picks[b];
        await saveChatStore();
        await showWorldInfo();
        return true;
    }
    if (act === 'wi-all' || act === 'wi-none' || act === 'wi-enabled') {
        const book = el.dataset.book;
        const entries = await loadBookEntries(book);
        const uids = act === 'wi-none' ? [] : entries.filter(e => act === 'wi-all' || !e.disable).map(e => e.uid);
        await setBookPicks(book, uids);
        const store = getChatStore();
        if (uids.length && store.wi.mode === 'auto') store.wi.mode = 'both';
        if (uids.length && store.wi.mode === 'off') store.wi.mode = 'manual';
        await saveChatStore();
        const scroll = document.getElementById('stcm_feed').scrollTop;
        await showWorldInfo();
        document.getElementById('stcm_feed').scrollTop = scroll;
        return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Panel UI
// ---------------------------------------------------------------------------
let currentFeedId = null;
const feedScroll = new Map();   // feedId → scrollTop, restored when coming back
let view = 'feed';   // feed | history | pins | compose | wi | topics | api | settings | spaces
let selMode = 'meta';
let selPlatform = 'naver';

const THEMES = {
    theme: { label: '테마 따라가기', icon: 'fa-palette' },
    light: { label: '라이트', icon: 'fa-sun' },
    dark: { label: '나이트', icon: 'fa-moon' },
};

function applyTheme() {
    const s = getSettings();
    const t = THEMES[s.theme] ? s.theme : 'theme';
    const ov = document.getElementById('stcm_overlay');
    if (ov) {
        ov.classList.remove('stcm-t-theme', 'stcm-t-light', 'stcm-t-dark');
        ov.classList.add(`stcm-t-${t}`);
    }
    const btn = document.querySelector('#stcm_btn_theme i');
    if (btn) btn.className = `fa-solid ${THEMES[t].icon}`;
    const sel = document.getElementById('stcm_set_theme');
    if (sel) sel.value = t;
}

/** Folding is remembered separately for short (phone landscape, small window) and tall screens. */
function screenClass() {
    return window.innerHeight < 600 ? 'short' : 'tall';
}

function isFolded() {
    const s = getSettings();
    const pref = s.foldPrefs?.[screenClass()];
    if (pref === true || pref === false) return pref;
    return screenClass() === 'short';
}

/** 간략한 화면: community / space / board live in a bottom sheet, rarely used header buttons in ⋯.
 *  The real controls are moved (not copied), so every listener keeps working. */
const MENU_BTNS = ['stcm_btn_history', 'stcm_btn_pins', 'stcm_btn_wi', 'stcm_btn_theme', 'stcm_btn_fold'];
function applyCompact() {
    const ov = document.getElementById('stcm_overlay');
    if (!ov) return;
    const on = !!getSettings().compactUi;
    const $ = (id) => document.getElementById(id);
    if (ov.classList.contains('stcm-compact') === on && ov.dataset.compactDone) return;
    ov.dataset.compactDone = '1';
    ov.classList.toggle('stcm-compact', on);
    closeSheet();
    closeMoreMenu();
    if (on) {
        $('stcm_cpick').appendChild($('stcm_modes'));
        $('stcm_sheet_pf').appendChild($('stcm_platforms'));
        $('stcm_sheet_sp').appendChild($('stcm_spaces'));
        $('stcm_sheet_bd').appendChild($('stcm_boards'));
        for (const id of MENU_BTNS) $('stcm_more_menu').appendChild($(id));
    } else {
        $('stcm_cpick').after($('stcm_modes'));
        $('stcm_modes').after($('stcm_platforms'));
        $('stcm_platforms').after($('stcm_spaces'));
        $('stcm_topics').after($('stcm_boards'));
        $('stcm_btn_write').after($('stcm_btn_fold'));
        $('stcm_btn_settings').after($('stcm_btn_theme'));
        $('stcm_btn_theme').after($('stcm_btn_wi'));
        $('stcm_btn_wi').after($('stcm_btn_history'));
        $('stcm_btn_history').after($('stcm_btn_pins'));
    }
    updatePicker();
}

function closeSheet() {
    const el = document.getElementById('stcm_sheet');
    if (!el?.classList.contains('show')) return false;
    el.classList.remove('show');
    return true;
}

function closeMoreMenu() {
    const el = document.getElementById('stcm_more_menu');
    if (!el?.classList.contains('show')) return false;
    el.classList.remove('show');
    document.getElementById('stcm_btn_more')?.setAttribute('aria-expanded', 'false');
    return true;
}

const PF_COLOR = { naver: '#03c75a', dcinside: '#3b4890', tdgall: '#3d6ea8', kkangtong: '#d98a1c', blind: '#e0352b', everytime: '#c62917', reddit: '#ff4500', twitter: '', fivech: '#b5452f', weibo: '#e6162d', discord: '#5865f2', tieba: '#3388ff' };
/** The one-line picker: "☕ 네이버 카페 › 별의 노래 게임 카페 ▾". */
function updatePicker() {
    const b = document.getElementById('stcm_btn_pick');
    const p = PLATFORMS[selPlatform];
    if (!b || !p) return;
    const sp = spaceById(currentSpace(selPlatform));
    const color = PF_COLOR[selPlatform] ? ` style="color:${PF_COLOR[selPlatform]}"` : '';
    b.innerHTML = `<i class="${p.brand ? 'fa-brands' : 'fa-solid'} ${p.icon}"${color}></i><b>${esc(p.label)}</b>${sp ? `<span class="sep">›</span><span class="sp">${esc(sp.name)}</span>` : ''}<i class="fa-solid fa-caret-down cv"></i>`;
}

/** 전체화면: the panel fills the whole window (on phones it always does). */
function applyFullscreen() {
    const on = !!getSettings().fullscreen;
    document.getElementById('stcm_overlay')?.classList.toggle('stcm-full', on);
    const b = document.getElementById('stcm_btn_full');
    if (b) {
        b.querySelector('i').className = `fa-solid ${on ? 'fa-compress' : 'fa-expand'}`;
        b.title = on ? '전체화면 끄기' : '전체화면 (창 가득 채우기)';
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
    }
    // the visible feed got taller / shorter: Discord's pinned channel list follows (ResizeObserver does it too)
}

function applyFold() {
    const folded = isFolded();
    document.getElementById('stcm_overlay')?.classList.toggle('folded', folded);
    const i = document.querySelector('#stcm_btn_fold i');
    if (i) i.className = `fa-solid ${folded ? 'fa-chevron-down' : 'fa-chevron-up'}`;
}

function isOpen() {
    return document.getElementById('stcm_overlay')?.classList.contains('open');
}

function languageOptions(includeNative, includeOff) {
    return [
        includeOff ? '<option value="">번역 안 함</option>' : '',
        includeNative ? '<option value="native">커뮤니티 원어 (2ch=일본어, 웨이보=중국어…)</option>' : '',
        ...LANGUAGES.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`),
        '<option value="custom">직접 입력…</option>',
    ].join('');
}

function buildOverlay() {
    if (document.getElementById('stcm_overlay')) return;
    const html = `
    <dialog id="stcm_overlay" aria-label="커뮤니티">
      <div class="stcm-modal" tabindex="-1">
        <div class="stcm-header">
          <div class="stcm-title"><i class="fa-solid fa-comments"></i><span class="stcm-title-text"> 커뮤니티</span></div>
          <button id="stcm_save" class="stcm-save" data-state="idle" disabled></button>
          <div class="stcm-hbtns">
            <button id="stcm_btn_write" title="글쓰기"><i class="fa-solid fa-pen"></i></button>
            <button id="stcm_btn_fold" title="위쪽 메뉴 접기/펴기"><i class="fa-solid fa-chevron-up"></i><span class="stcm-mlbl">위쪽 메뉴 접기/펴기</span></button>
            <button id="stcm_btn_api" title="API 설정 (연결 프로필)"><i class="fa-solid fa-plug"></i></button>
            <button id="stcm_btn_settings" title="설정"><i class="fa-solid fa-gear"></i></button>
            <button id="stcm_btn_theme" title="화면 테마"><i class="fa-solid fa-circle-half-stroke"></i><span class="stcm-mlbl">화면 테마</span></button>
            <button id="stcm_btn_wi" title="참고할 월드 인포"><i class="fa-solid fa-book-atlas"></i><span class="stcm-mlbl">월드 인포</span></button>
            <button id="stcm_btn_history" title="지난 피드"><i class="fa-solid fa-clock-rotate-left"></i><span class="stcm-mlbl">지난 피드</span></button>
            <button id="stcm_btn_pins" title="반영 중인 글"><i class="fa-solid fa-thumbtack"></i><span class="stcm-mlbl">반영 중인 글</span><span id="stcm_pin_count"></span></button>
            <button id="stcm_btn_full" title="전체화면 (창 가득 채우기)"><i class="fa-solid fa-expand"></i></button>
            <button id="stcm_btn_more" title="더 보기 (지난 피드 · 반영 · 월드 인포 · 테마)" aria-haspopup="menu"><i class="fa-solid fa-ellipsis"></i><span id="stcm_more_dot"></span></button>
            <button id="stcm_btn_close" title="닫기"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="stcm-more-menu" id="stcm_more_menu" role="menu"></div>
        </div>
        <div class="stcm-controls">
          <div class="stcm-cpick" id="stcm_cpick"><button id="stcm_btn_pick" class="stcm-pick" title="커뮤니티 · 카페 · 판 고르기"></button></div>
          <div class="stcm-seg" id="stcm_modes">
            ${Object.entries(MODES).map(([id, m]) => `<button data-mode="${id}" title="${m.label}"><i class="fa-solid ${m.icon}"></i><span class="stcm-mode-lbl"> ${m.label}</span></button>`).join('')}
          </div>
          <div class="stcm-chips" id="stcm_platforms">
            ${Object.entries(PLATFORMS).map(([id, p]) => `<button data-platform="${id}" class="pf-${id}"><i class="${p.brand ? 'fa-brands' : 'fa-solid'} ${p.icon}"></i> ${p.label}</button>`).join('')}
          </div>
          <div class="stcm-chips stcm-topics stcm-spaces" id="stcm_spaces"></div>
          <div class="stcm-chips stcm-topics" id="stcm_topics"></div>
          <div class="stcm-chips stcm-topics stcm-boards stcm-hide" id="stcm_boards"></div>
          <div class="stcm-genrow">
            <input id="stcm_topic" type="text" placeholder="주제/요청 (선택) — 예: 방금 고백 장면 반응, 축제 날 시장 풍경" />
            <span class="stcm-gbreak"></span>
            <select id="stcm_lang" title="생성 언어">${languageOptions(true, false)}</select>
            <select id="stcm_locale" title="커뮤니티 배경 (이 채팅)"></select>
            <span class="stcm-genbtns">
              <button id="stcm_btn_gen" class="stcm-gen"><i class="fa-solid fa-wand-magic-sparkles"></i> 생성</button>
              <button id="stcm_btn_stop" class="stcm-stop"><i class="fa-solid fa-stop"></i> 중지</button>
            </span>
          </div>
        </div>
        <div class="stcm-feedbar" id="stcm_feedbar"></div>
        <div class="stcm-feed" id="stcm_feed"></div>
        <div class="stcm-errbox" id="stcm_errbox"></div>
        <input type="file" id="stcm_import_file" accept=".json,application/json" hidden>
        <div class="stcm-busy" id="stcm_busy"><i class="fa-solid fa-spinner fa-spin"></i> <span></span></div>
        <div class="stcm-sheet-bg" id="stcm_sheet">
          <div class="stcm-sheet" role="dialog" aria-label="커뮤니티 고르기">
            <button class="stcm-sheet-grip" data-sheet-close title="닫기"></button>
            <div class="stcm-sheet-h">커뮤니티</div>
            <div id="stcm_sheet_pf"></div>
            <div id="stcm_sheet_sp"></div>
            <div id="stcm_sheet_bd"></div>
          </div>
        </div>
      </div>
    </dialog>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const ov = document.getElementById('stcm_overlay');
    ov.addEventListener('click', (e) => { if (e.target === ov) closePanel(); });
    // Esc on a modal <dialog> fires "cancel"; our keydown handler decides what Esc does
    ov.addEventListener('cancel', (e) => e.preventDefault());
    document.getElementById('stcm_btn_close').addEventListener('click', closePanel);
    document.getElementById('stcm_btn_history').addEventListener('click', showHistory);
    document.getElementById('stcm_btn_pins').addEventListener('click', showPins);
    document.getElementById('stcm_btn_fold').addEventListener('click', () => {
        const s = getSettings();
        s.foldPrefs = { ...(s.foldPrefs ?? {}), [screenClass()]: !isFolded() };
        saveSettings();
        applyFold();
    });
    document.getElementById('stcm_btn_theme').addEventListener('click', () => {
        const s = getSettings();
        const order = ['theme', 'light', 'dark'];
        s.theme = order[(order.indexOf(s.theme) + 1) % order.length];
        saveSettings();
        applyTheme();
        toastr.info(`화면: ${THEMES[s.theme].label}`, '', { timeOut: 1200 });
    });
    document.getElementById('stcm_btn_wi').addEventListener('click', () => { wiFilter = ''; showWorldInfo(); });
    document.getElementById('stcm_btn_more').addEventListener('click', (e) => {
        e.stopPropagation();
        closeSheet();
        const open = document.getElementById('stcm_more_menu').classList.toggle('show');
        e.currentTarget.setAttribute('aria-expanded', String(open));
    });
    // any item in the ⋯ menu does its job (its own listener) and closes the menu
    document.getElementById('stcm_more_menu').addEventListener('click', () => closeMoreMenu());
    ov.addEventListener('click', (e) => {
        if (!e.target.closest?.('#stcm_more_menu, #stcm_btn_more')) closeMoreMenu();
    });
    document.getElementById('stcm_btn_pick').addEventListener('click', () => {
        closeMoreMenu();
        document.getElementById('stcm_sheet').classList.add('show');
    });
    document.getElementById('stcm_sheet').addEventListener('click', (e) => {
        // tap outside the sheet, the grip, or pick a space / board → close (a community pick keeps it open)
        if (e.target.id === 'stcm_sheet' || e.target.closest('[data-sheet-close]')
            || e.target.closest('#stcm_spaces button, #stcm_boards button[data-board]')) setTimeout(closeSheet, 0);
    }, true);   // capture: the chip rows re-render on click, so check before they do
    document.getElementById('stcm_btn_api').addEventListener('click', showApi);
    document.getElementById('stcm_save').addEventListener('click', () => { if (feedState.error) retrySave(); });
    document.getElementById('stcm_btn_full').addEventListener('click', () => {
        const st = getSettings();
        st.fullscreen = !st.fullscreen;
        saveSettings();
        applyFullscreen();
    });
    document.getElementById('stcm_btn_settings').addEventListener('click', showSettingsView);
    document.getElementById('stcm_btn_write').addEventListener('click', showCompose);
    document.getElementById('stcm_btn_stop').addEventListener('click', () => abortCtl?.abort());
    document.getElementById('stcm_btn_gen').addEventListener('click', () => {
        const topic = document.getElementById('stcm_topic').value.trim();
        generateFeed({ mode: selMode, platformId: selPlatform, topic });
    });
    document.getElementById('stcm_topic').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) document.getElementById('stcm_btn_gen').click();
    });
    document.getElementById('stcm_lang').addEventListener('change', async (e) => {
        const s = getSettings();
        if (e.target.value === 'custom') {
            const { Popup } = ctx();
            const val = Popup?.show?.input
                ? await Popup.show.input('생성 언어', '언어 이름을 적어 주세요 (예: Catalan, 경상도 사투리 한국어)', s.customLanguage || '')
                : prompt('언어 이름', s.customLanguage || '');
            if (val && String(val).trim()) s.customLanguage = String(val).trim();
            else { e.target.value = s.language; return; }
        }
        s.language = e.target.value;
        saveSettings();
        syncLanguageSelectors();
    });
    document.getElementById('stcm_modes').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-mode]');
        if (!b) return;
        if (selMode === b.dataset.mode && (view === 'feed' || view === 'compose')) return;
        selMode = b.dataset.mode;
        onSelectorChange();
    });
    document.getElementById('stcm_platforms').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-platform]');
        if (!b) return;
        if (selPlatform === b.dataset.platform && (view === 'feed' || view === 'compose')) return;
        selPlatform = b.dataset.platform;
        onSelectorChange();
    });
    document.getElementById('stcm_feed').addEventListener('click', onFeedClick);
    // visible feed height, for sticky side panels (Discord channel list) that must fit on screen
    if (window.ResizeObserver) {
        const feedEl = document.getElementById('stcm_feed');
        new ResizeObserver(() => feedEl.style.setProperty('--stcm-feed-h', `${feedEl.clientHeight}px`)).observe(feedEl);
    }
    document.getElementById('stcm_feed').addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('stcm-psum')) { e.preventDefault(); e.target.click(); }
    });
    document.getElementById('stcm_feed').addEventListener('change', onFeedChange);
    document.getElementById('stcm_feed').addEventListener('input', (e) => {
        if (e.target.closest?.('.stcm-api-view')) { onApiChange(e); return; }
        if (!e.target.classList?.contains('stcm-td-q')) return;
        tdState(e.target.dataset.feed).q = e.target.value;
        tdApply(e.target.dataset.feed);
    });
    document.getElementById('stcm_import_file').addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        await readImportFile(f);
    });
    document.getElementById('stcm_errbox').addEventListener('click', (e) => {
        if (e.target.closest('[data-act="err-close"], [data-act="err-api"]')) document.getElementById('stcm_errbox').classList.remove('show');
        if (e.target.closest('[data-act="err-api"]')) showApi();
    });
    document.getElementById('stcm_locale').addEventListener('change', (e) => onLocaleChange(e.target));
    document.getElementById('stcm_spaces').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.spaceAct === 'edit') { spaceEdit = null; showSpaceEditor(); return; }
        if (b.dataset.spaceAct === 'settings') { spaceEdit = { id: currentSpace(selPlatform) }; showSpaceEditor(); return; }
        if (b.dataset.space == null) return;
        setCurrentSpace(selPlatform, b.dataset.space);
        renderSpaceChips();
        if (view === 'compose') showCompose(); else showFeed(null);
    });
    document.getElementById('stcm_boards').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-board]');
        if (!b) return;
        const s = getSettings();
        s.topicSelected = b.dataset.board ? b.dataset.board.split('|') : [];
        saveSettings();
        syncTopicSettings();
        if (view === 'compose') showCompose(); else showFeed(null);
        syncSelectors();
    });
    document.getElementById('stcm_topics').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const s = getSettings();
        if (b.dataset.topicAct === 'edit') { topicEdit = null; showTopicEditor(); return; }
        if (b.dataset.topicAct === 'free') s.topicSelected = [];
        else if (b.dataset.topicAct === 'mix') s.topicMix = s.topicMix === 'mix' ? 'each' : 'mix';
        else if (b.dataset.topic) {
            const set = new Set(s.topicSelected ?? []);
            if (set.has(b.dataset.topic)) set.delete(b.dataset.topic); else set.add(b.dataset.topic);
            s.topicSelected = [...set];
        }
        saveSettings();
        renderTopicChips();
        renderBoardChips();
        syncTopicSettings();
        // each topic set is its own board (like a gallery / 板): show it right away
        if (b.dataset.topicAct !== 'mix' && (view === 'feed' || view === 'dm-new')) showFeed(null);
    });
    document.getElementById('stcm_feedbar').addEventListener('click', onFeedClick);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !isOpen()) return;
        // let SillyTavern popups (also <dialog>s) on top of ours close first
        const ours = document.getElementById('stcm_overlay');
        if ([...document.querySelectorAll('dialog[open], .popup[open]')].some(d => d !== ours)) return;
        if (closeSheet() | closeMoreMenu()) return;
        if (e.target?.closest?.('#stcm_overlay input, #stcm_overlay textarea')) { e.target.blur(); return; }
        closePanel();
    });
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (isOpen()) applyFold();   // the remembered choice for this screen size
        }, 150);
    });
}

function readIdentity(root) {
    const box = root.closest?.('.stcm-composer');
    const dmPost = box ? getFeed(box.dataset.feed)?.data.posts[Number(box.dataset.idx)] : null;
    if (dmPost?.kind === 'dm') {
        const me = dmPost.dm?.me ?? {};
        return { as: me.as ?? 'mob', nick: me.nick ?? '', charName: me.charName ?? '' };
    }
    const as = root.querySelector('.stcm-cp-as')?.value;
    return {
        as: ['user', 'char'].includes(as) ? as : 'mob',
        nick: root.querySelector('.stcm-cp-nick')?.value ?? '',
        charName: (root.querySelector('.stcm-cp-char')?.value ?? '').trim(),
    };
}

async function onFeedClick(e) {
    const el = e.target.closest('[data-act], #stcm_pins_toggle, #stcm_tr_toggle, #stcm_back, [data-open-feed], [data-del-feed], [data-unpin]');
    if (!el) return;
    const act = el.dataset.act;
    if (act?.startsWith('wi-')) { await onWorldInfoClick(el); return; }
    if (act && view === 'api' && await onApiClick(act, el)) return;
    if (act === 'feed-export') { exportFeeds(); return; }
    if (act === 'feed-import') { document.getElementById('stcm_import_file')?.click(); return; }
    if (act === 'import-cancel') { pendingImport = null; showHistory(); return; }
    if (act === 'import-merge' || act === 'import-replace') {
        const withPins = document.getElementById('stcm_import_pins')?.checked ?? false;
        const withSpaces = document.getElementById('stcm_import_spaces')?.checked ?? false;
        if (act === 'import-replace') {
            const { Popup, POPUP_RESULT } = ctx();
            const ok = Popup?.show?.confirm
                ? (await Popup.show.confirm('피드 바꾸기', '이 채팅의 지금 피드와 반영 목록을 지우고 파일 내용으로 바꿀까요? (먼저 내보내기로 백업해 두면 안전해요)')) === POPUP_RESULT.AFFIRMATIVE
                : confirm('지금 피드를 파일 내용으로 바꿀까요?');
            if (!ok) return;
        }
        await applyImport(act === 'import-replace' ? 'replace' : 'merge', withPins, withSpaces);
        return;
    }
    if (act === 'goto-post') { scrollToPostSmooth(Number(el.dataset.idx)); return; }
    if (act === 'post-toggle') { togglePost(el.dataset.feed, Number(el.dataset.idx)); updateFoldAllButton(getFeed(el.dataset.feed)); return; }
    if (act === 'fold-all') { const f = getFeed(currentFeedId); if (f) setAllOpen(f, !document.getElementById('stcm_fold_all')?.dataset.open); return; }
    if (act?.startsWith('topic')) { await onTopicAction(el); return; }
    if (act?.startsWith('space-')) { await onSpaceAction(el); return; }
    const feedId = el.dataset.feed;
    const idx = el.dataset.idx != null ? Number(el.dataset.idx) : null;

    if (act === 'pin') {
        await togglePin(feedId, idx);
        updatePost(feedId, idx);
        return;
    }
    if (act === 'watch' || act === 'crossref') {
        if (!(await ensureFeedsReady())) return;
        const post = getFeed(feedId)?.data.posts[idx];
        if (!post) return;
        if (act === 'watch') {
            post.watch = !post.watch;
            if (!post.watch) delete post.watch;
            const s = getSettings();
            toastr.info(post.watch
                ? (s.autoReplyEnabled ? `AI 답변 ${s.autoReplyEvery}번마다 이 글을 자동으로 이어가요.` : '지켜보기를 켰어요. 설정에서 "레스·댓글 자동 생성"을 켜면 이어가기 시작해요.')
                : '지켜보기를 껐어요.', '', { timeOut: 2500 });
        } else {
            if (getSettings().crossRef) { toastr.info('설정에서 "모든 생성에서 다른 게시글 참고"가 켜져 있어서 모든 글이 참고해요.'); return; }
            post.crossRef = !post.crossRef;
            if (!post.crossRef) delete post.crossRef;
            toastr.info(post.crossRef ? '이 글을 이어갈 때 같은 커뮤니티의 다른 글도 참고해요.' : '이 글은 다른 글을 참고하지 않아요.', '', { timeOut: 2000 });
        }
        await saveChatStore();
        updatePost(feedId, idx);
        return;
    }
    // Opening/closing the composer re-renders only the posts involved
    const switchComposer = (next) => {
        captureDraft();
        const prevPost = composer && composer.feedId === feedId ? composer.postIdx : null;
        const keepDraft = composer && next && composer.feedId === next.feedId && composer.postIdx === next.postIdx ? composer.draft : null;
        // the same comment box on the same post (another reply target, an anchor) stays the same piece of writing
        const samePost = composer && next && composer.feedId === next.feedId && composer.postIdx === next.postIdx;
        composer = next ? { ...next, draft: next.draft ?? keepDraft, cid: samePost && composer.cid ? composer.cid : newComposerId() } : null;
        syncCommentDraft();   // a kept comment that now answers another comment (or none) remembers that
        if (composer) openPosts.add(`${feedId}:${idx}`);
        if (prevPost != null && prevPost !== idx) updatePost(feedId, prevPost);
        updatePost(feedId, idx, { focusComposer: !!composer });
    };
    if (act === 'comment') {
        const isOpenHere = composer && composer.feedId === feedId && composer.postIdx === idx && composer.replyTo == null;
        switchComposer(isOpenHere ? null : { feedId, postIdx: idx, replyTo: null, place: 'end' });
        return;
    }
    if (act === 'reply') {
        const chatLike = PLATFORMS[getFeed(feedId)?.platform]?.chat;
        switchComposer({ feedId, postIdx: idx, replyTo: Number(el.dataset.ci), place: chatLike ? 'end' : `c${el.dataset.ci}` });
        return;
    }
    if (act === 'ds-open') { openDsPane(feedId, idx); return; }
    if (act === 'dm-new') { showDmCompose(feedId, el.dataset.to ?? ''); return; }
    if (act === 'dm-cancel') { dmDraft = null; showFeed(currentFeedId); return; }
    if (act === 'dm-create') { await createDm(el.closest('.stcm-dm-view')); return; }
    if (act === 'ai-write-dm') {
        const box = el.closest('.stcm-dm-view');
        const feed = getFeed(dmDraft?.feedId);
        if (!feed) return;
        const identity = readIdentity(box);
        if (!checkIdentity(identity)) return;
        const partner = readDmTarget(box);
        const bodyEl = box.querySelector('.stcm-cp-body');
        const out = await aiWrite({
            kind: 'dm', mode: feed.mode, platformId: feed.platform, identity,
            instruction: box.querySelector('.stcm-cp-inst').value,
            draft: bodyEl.value, feed, dmTo: dmSideEn(partner),
        });
        if (out && document.body.contains(bodyEl)) bodyEl.value = out.body;
        return;
    }
    if (act === 'td-toggle') {
        const key = `${feedId}:${idx}`;
        const art = el.closest('.stcm-td-post');
        if (openPosts.has(key)) openPosts.delete(key); else openPosts.add(key);
        art?.classList.toggle('open', openPosts.has(key));
        return;
    }
    if (act === 'td-cat' || act === 'td-filter') {
        const st = tdState(feedId);
        if (act === 'td-cat') st.cat = el.dataset.cat;
        else st.filter = el.dataset.filter;
        tdApply(feedId);
        return;
    }
    if (act === 'td-sort') {
        tdState(feedId).sort = el.dataset.sort;
        showFeed(feedId, { keepScroll: true });
        return;
    }
    if (act === 'td-best') {
        const st = tdState(feedId);
        const n = tdBestList(getFeed(feedId)).length;
        if (n) st.best = (st.best + Number(el.dataset.dir) + n) % n;
        showFeed(feedId, { keepScroll: true });
        return;
    }
    if (act === 'td-open') {
        openPosts.add(`${feedId}:${idx}`);
        const st = tdState(feedId);
        const post = getFeed(feedId)?.data.posts[idx];
        if (post && !tdVisible(getFeed(feedId), post)) { st.cat = '전체'; st.filter = 'all'; st.q = ''; }
        showFeed(feedId, { keepScroll: true });
        scrollToPostSmooth(idx);
        return;
    }
    if (act === 'td-write') {
        const feed = getFeed(feedId);
        if (feed) { selPlatform = feed.platform; selMode = feed.mode; }
        showCompose();
        return;
    }
    if (act === 'anchor') {
        captureDraft();
        const same = composer?.feedId === feedId && composer?.postIdx === idx;
        const prevBody = same ? (composer.draft?.body ?? '') : '';
        const body = `${prevBody}${prevBody && !prevBody.endsWith('\n') ? '\n' : ''}>>${el.dataset.n}\n`;
        switchComposer({ feedId, postIdx: idx, replyTo: null, place: el.dataset.place || 'end', draft: { ...(same ? composer.draft : {}), body } });
        return;
    }
    if (act === 'reply-cancel') {
        if (composer) { captureDraft(); composer.replyTo = null; syncCommentDraft(); }   // a kept reply now goes in as a plain comment
        updatePost(composer?.feedId ?? feedId, composer?.postIdx ?? idx, { focusComposer: true });
        return;
    }
    if (act === 'cancel-comment') {
        const at = composer?.postIdx ?? idx;
        const fid = composer?.feedId ?? feedId;
        captureDraft();   // a kept comment keeps its last edits (closing isn't throwing it away)
        const kept = composer?.draft?.unpostedId && findUnposted(feedState.chatId, composer.draft.unpostedId);
        composer = null;
        if (kept) showFeed(fid, { keepScroll: true });   // it goes back to the list above the posts
        else updatePost(fid, at);
        return;
    }
    if (act === 'submit-comment') {
        const box = el.closest('.stcm-composer');
        await submitPlayerComment({
            feedId: box.dataset.feed,
            postIdx: Number(box.dataset.idx),
            replyTo: composer?.replyTo ?? null,
            body: box.querySelector('.stcm-cp-body').value,
            identity: readIdentity(box),
            react: box.querySelector('.stcm-cp-react').checked,
            media: readMediaRows(box),
            draftId: composer?.draft?.unpostedId ?? '',
        });
        return;
    }
    if (act === 'unposted-open' || act === 'unposted-copy' || act === 'unposted-drop') {
        const d = findUnposted(feedState.chatId, el.dataset.draft);
        if (!d) return;
        if (act === 'unposted-copy') { copyText(draftText(d)); return; }
        if (act === 'unposted-drop') {
            dropUnposted(feedState.chatId, d.id);
            if (composer?.draft?.unpostedId === d.id) delete composer.draft.unpostedId;
            el.closest('.stcm-unposted-hint, .stcm-unposted .row')?.remove();
            document.querySelector('.stcm-compose-view')?.removeAttribute('data-draft');
            toastr.info('보관해 둔 내용을 버렸어요. (입력 칸에 있는 글은 그대로예요)', '', { timeOut: 2500 });
            return;
        }
        const feed = getFeed(currentFeedId);
        if (!feed) return;
        captureDraft();
        if (composer && String(composer.draft?.body ?? '').trim()) { toastr.warning('쓰던 댓글 창을 먼저 등록하거나 닫아 주세요.'); return; }
        const prev = composer?.feedId === feed.id ? composer.postIdx : null;
        composer = null;
        const idx = openCommentDraft(feed, d);
        if (idx == null) return;
        if (prev != null && prev !== idx) updatePost(feed.id, prev);
        showFeed(feed.id, { scrollToPost: idx });
        return;
    }
    if (act === 'older-posts') {
        const feed = getFeed(feedId);
        if (!feed) return;
        pageShown.set(feed.id, (pageShown.get(feed.id) ?? PAGE_SIZE) + PAGE_SIZE);
        showFeed(feed.id, { keepScroll: true });   // draws the next ones under the current list; the view stays
        return;
    }
    if (act === 'cp-photo' || act === 'cp-video') {
        const box = el.closest('.stcm-compose-view, .stcm-composer');
        if (!box) return;
        if (box.querySelectorAll('.stcm-cp-media').length >= MEDIA_MAX) { toastr.info(`사진·영상은 한 글에 ${MEDIA_MAX}개까지 붙일 수 있어요.`); return; }
        addMediaRow(box, act === 'cp-video' ? 'video' : 'photo', '')?.querySelector('textarea')?.focus();
        syncComposeDraft(box);
        return;
    }
    if (act === 'cp-media-del') {
        const box = el.closest('.stcm-compose-view, .stcm-composer');
        el.closest('.stcm-cp-media')?.remove();
        syncComposeDraft(box);
        return;
    }
    if (act === 'ai-photo' && el.closest('.stcm-edit-view')) {
        // a photo / video on a post or comment being edited
        const box = el.closest('.stcm-edit-view');
        const t = editTarget;
        const feed = t ? getFeed(t.feedId) : null;
        const pi = feed ? feed.data.posts.indexOf(t.post) : -1;
        if (!feed || pi < 0) return;
        const row = el.closest('.stcm-cp-media');
        if (!row) return;
        const type = row.dataset.type === 'video' ? 'video' : 'photo';
        const o = t.item;
        const identity = o.isMe ? { as: o.as ?? 'mob', nick: o.author ?? '', charName: o.charName ?? '' } : { as: 'mob', nick: o.author ?? '', charName: '' };
        const out = await aiWrite({
            kind: t.kind === 'post' ? 'post' : 'comment', mode: feed.mode, platformId: feed.platform, identity,
            instruction: '', draft: box.querySelector('.stcm-cp-body').value,
            feed, postIdx: t.kind === 'post' ? null : pi,
            photo: { target: t.kind === 'post' ? 'post' : 'comment', title: box.querySelector('.stcm-cp-title')?.value ?? '', current: row.querySelector('textarea').value, kind: type, others: readMediaRows(box, row) },
        });
        if (out?.image && document.body.contains(row)) {
            row.querySelector('textarea').value = out.image;
            toastr.success(type === 'video' ? 'AI가 영상 묘사를 채웠어요.' : 'AI가 사진 묘사를 채웠어요.', '', { timeOut: 1500 });
        }
        return;
    }
    if (act === 'ai-photo' && el.closest('.stcm-composer')) {
        // a photo / video on a res or comment you are writing
        const box = el.closest('.stcm-composer');
        const identity = readIdentity(box);
        if (!checkIdentity(identity)) return;
        const fid = box.dataset.feed;
        const pi = Number(box.dataset.idx);
        const feed = getFeed(fid);
        if (!feed) return;
        const row = el.closest('.stcm-cp-media');
        if (!row) return;
        const type = row.dataset.type === 'video' ? 'video' : 'photo';
        const mid = row.dataset.mid;
        captureDraft();   // the rows (and what is written) stay even if you leave now
        const cid = composer?.cid;
        const out = await aiWrite({
            kind: composer?.replyTo != null ? 'reply' : 'comment', mode: feed.mode, platformId: feed.platform, identity,
            instruction: box.querySelector('.stcm-cp-inst').value,
            draft: box.querySelector('.stcm-cp-body').value,
            feed, postIdx: pi, replyTo: composer?.replyTo ?? null,
            photo: { target: 'comment', current: row?.querySelector('textarea')?.value ?? '', kind: type, others: readMediaRows(box, row) },
        });
        // the box may have been drawn again while the AI wrote: find the same row in the live one
        const same = !!composer && composer.cid === cid;   // still the comment box it was asked from
        const live = same ? document.querySelector(`#stcm_feed .stcm-composer[data-feed="${CSS.escape(fid)}"][data-idx="${pi}"]`) : null;
        const liveRow = mid ? live?.querySelector(`.stcm-cp-media[data-mid="${CSS.escape(mid)}"]`) : null;   // removed meanwhile: nothing is written
        if (out?.image && liveRow?.dataset.type === type) {
            liveRow.querySelector('textarea').value = out.image;
            captureDraft();
            toastr.success(type === 'video' ? 'AI가 영상 묘사를 채웠어요.' : 'AI가 사진 묘사를 채웠어요.', '', { timeOut: 1500 });
        } else if (out?.image && !live && same) {
            // the box isn't on screen: the row (if it is still there) gets it for when you come back
            const m = (composer.draft?.media ?? []).find(x => x.mid === mid && x.type === type);
            if (m) { m.desc = out.image; syncCommentDraft(); }
        }
        return;
    }
    if (act === 'ai-photo') {
        const box = el.closest('.stcm-compose-view');
        const identity = readIdentity(box);
        if (!checkIdentity(identity)) return;
        const feed = getFeed(currentFeedId);
        const appending = feedMatchesSelection(feed);
        const row = el.closest('.stcm-cp-media');
        const imgEl = row?.querySelector('textarea');
        const others = readMediaRows(box, row);
        const chatId = box.dataset.chat;
        const formId = box.dataset.fid;
        const mid = row?.dataset.mid;
        aiPendingForms.add(formId);
        saveComposeForm(box);
        let out;
        try { out = await aiWrite({
            kind: 'post', mode: selMode, platformId: selPlatform, identity,
            instruction: box.querySelector('.stcm-cp-inst').value,
            draft: box.querySelector('.stcm-cp-body').value,
            feed: appending ? feed : { data: { board: box.querySelector('.stcm-cp-board')?.value ?? '' } },
            photo: { title: box.querySelector('.stcm-cp-title')?.value ?? '', current: imgEl?.value ?? '', kind: row?.dataset.type === 'video' ? 'video' : 'photo', others },
        }); } catch (e) { aiPendingForms.delete(formId); throw e; }
        // into that row of the write form — open now or kept while you were elsewhere (a removed row gets nothing)
        if (out?.image && updateComposeForm(chatId, formId, d => { const m = d.media.find(x => x.mid === mid); if (m) m.desc = out.image; })) {
            toastr.success(row?.dataset.type === 'video' ? 'AI가 영상 묘사를 채웠어요.' : 'AI가 사진 묘사를 채웠어요.', '', { timeOut: 1500 });
        }
        aiPendingForms.delete(formId);   // only now: the answer is in (an empty form is let go below)
        settleComposeForm(chatId, formId);
        return;
    }
    if (act === 'ai-write-post') {
        const box = el.closest('.stcm-compose-view');
        const identity = readIdentity(box);
        if (!checkIdentity(identity)) return;
        const feed = getFeed(currentFeedId);
        const appending = feedMatchesSelection(feed);
        const bodyEl = box.querySelector('.stcm-cp-body');
        const chatId = box.dataset.chat;
        const formId = box.dataset.fid;
        const hasTitle = !!box.querySelector('.stcm-cp-title');
        aiPendingForms.add(formId);   // kept while the AI writes, even if nothing is written yet
        saveComposeForm(box);   // the instruction and what is written so far stay even if you leave now
        let out;
        try { out = await aiWrite({
            kind: 'post', mode: selMode, platformId: selPlatform, identity,
            instruction: box.querySelector('.stcm-cp-inst').value,
            draft: bodyEl.value,
            feed: appending ? feed : { data: { board: box.querySelector('.stcm-cp-board')?.value ?? '' } },
            topic: box.querySelector('.stcm-cp-inst').value.trim() ? null : pickPlayerTopic(),
        }); } catch (e) { aiPendingForms.delete(formId); throw e; }
        // into the write form it was asked from — open now, or kept while you were in another menu / the panel was closed
        if (out && updateComposeForm(chatId, formId, d => {
            if (hasTitle && out.title && !String(d.title ?? '').trim()) d.title = out.title;
            d.body = out.body;
            if (out.nickname && !String(d.identity?.nick ?? '').trim()) d.identity = { ...(d.identity ?? {}), nick: out.nickname };
        })) {
            toastr.success(document.querySelector(`#stcm_feed .stcm-compose-view[data-chat="${CSS.escape(String(chatId ?? ''))}"]`)
                ? 'AI가 쓴 글을 채웠어요. 고친 뒤 올리기를 누르세요.'
                : 'AI가 쓴 글을 글쓰기 창에 넣어 뒀어요. 글쓰기를 열면 보여요.', '', { timeOut: 2500 });
        }
        aiPendingForms.delete(formId);   // only now: the answer is in (an empty form is let go below)
        settleComposeForm(chatId, formId);
        return;
    }
    if (act === 'ai-write-comment') {
        const box = el.closest('.stcm-composer');
        const identity = readIdentity(box);
        if (!checkIdentity(identity)) return;
        const fid = box.dataset.feed;
        const pi = Number(box.dataset.idx);
        const feed = getFeed(fid);
        if (!feed) return;
        const bodyEl = box.querySelector('.stcm-cp-body');
        const anchor = feed.platform === 'fivech' ? (bodyEl.value.match(/^>>(\d+)/)?.[1] ?? null) : null;
        captureDraft();   // what is written and the instruction stay even if you leave now
        const cbox = composer;
        const out = await aiWrite({
            kind: composer?.replyTo != null ? 'reply' : 'comment', mode: feed.mode, platformId: feed.platform, identity,
            instruction: box.querySelector('.stcm-cp-inst').value,
            draft: anchor && bodyEl.value.trim() === `>>${anchor}` ? '' : bodyEl.value,
            feed, postIdx: pi, replyTo: composer?.replyTo ?? null, anchorN: anchor,
        });
        // the composer may have been re-rendered while generating; a box closed and opened again is a new one
        // (another cid): the old answer goes nowhere
        const same = !!composer && composer.cid === cbox?.cid;
        const live = same ? document.querySelector(`#stcm_feed .stcm-composer[data-feed="${CSS.escape(fid)}"][data-idx="${pi}"] .stcm-cp-body`) : null;
        if (out && live) {
            live.value = out.body;
            const nickEl = live.closest('.stcm-composer')?.querySelector('.stcm-cp-nick');
            if (nickEl && out.nickname && !nickEl.value.trim()) nickEl.value = out.nickname;
            if (composer) { composer.draft = { ...(composer.draft ?? {}), body: out.body }; syncCommentDraft(); }
            try { live.focus({ preventScroll: true }); } catch { /* ignore */ }
        } else if (out && same) {
            // the box isn't on screen (another menu, the panel closed): it is there when you come back
            composer.draft = { ...(composer.draft ?? {}), body: out.body, ...(out.nickname && !String(composer.draft?.nick ?? '').trim() ? { nick: out.nickname } : {}) };
            syncCommentDraft();
            toastr.success('AI가 쓴 댓글을 댓글 창에 넣어 뒀어요.', '', { timeOut: 2500 });
        }
        return;
    }
    if (act === 'more') {
        composer = null;
        await generateMoreComments(feedId, idx);
        return;
    }
    if (act === 'more-posts') {
        await generateMorePosts(feedId);
        return;
    }
    if (act === 'tr-post') {
        const post = getFeed(feedId)?.data.posts[idx];
        if (!post) return;
        if (postHasTr(post)) {
            trView.set(post, !trOn(post));
            captureDraft();
            updatePost(feedId, idx);
            // a translation made earlier may be missing parts added since (new comments): fill them in
            if (trView.get(post) && postTrItems(post, idx, false).length) await translatePost(feedId, idx);
        } else {
            await translatePost(feedId, idx);
        }
        return;
    }
    if (act === 'tr-redo') { captureDraft(); await translatePost(feedId, idx, { force: true }); return; }
    if (act === 'tr-edit' || act === 'tr-edit-item') {
        const post = getFeed(feedId)?.data.posts[idx];
        if (!post) return;
        let changed = false;
        if (act === 'tr-edit') {
            if (String(post.title ?? '').trim() && await editTranslation(post, 'title', '제목 번역 고치기')) changed = true;
            if (String(post.body ?? '').trim() && await editTranslation(post, 'body', '본문 번역 고치기')) changed = true;
        } else {
            const ci = Number(el.dataset.ci);
            const ri = el.dataset.ri != null ? Number(el.dataset.ri) : null;
            const item = ri == null ? post.comments[ci] : post.comments[ci]?.replies[ri];
            if (item && await editTranslation(item, 'body', '번역 고치기')) changed = true;
        }
        if (changed) {
            await saveChatStore();
            captureDraft();
            updatePost(feedId, getFeed(feedId).data.posts.indexOf(post));
            if (isPinned(feedId, idx)) refreshInjection();
        }
        return;
    }
    if (act === 'edit-post' || act === 'edit-item') {
        captureDraft();
        showEditItem(feedId, idx, act === 'edit-item' ? Number(el.dataset.ci) : null, act === 'edit-item' && el.dataset.ri != null ? Number(el.dataset.ri) : null);
        return;
    }
    if (act === 'edit-cancel') { const t = editTarget; editTarget = null; showFeed(t?.feedId ?? currentFeedId, { keepScroll: true }); return; }
    if (act === 'edit-save') { await saveEditItem(el.closest('.stcm-edit-view')); return; }
    if (act === 'del-post') {
        const { Popup, POPUP_RESULT } = ctx();
        const f = getFeed(feedId);
        const post = f?.data.posts[idx];
        if (!post) return;
        const kind = postKindLabel(f, post);
        const name = post.kind === 'dm' ? dmPartnerLabel(post) : (post.title || truncate(post.body, 30));
        const what = kind === 'DM' ? `이 DM 대화(${name})를 모두` : kind === '채널' ? `#${name} 채널과 메시지를 모두` : `"${name}" ${kind === '스레' ? '스레와 레스를' : '글과 댓글을'} 모두`;
        const ok = Popup?.show?.confirm
            ? (await Popup.show.confirm(`${kind} 삭제`, esc(`${what} 지울까요?`) + (isPinned(feedId, idx) ? '<br><small>본 채팅에 반영 중인 내용도 함께 빠져요.</small>' : ''))) === POPUP_RESULT.AFFIRMATIVE
            : confirm(`${what} 지울까요?`);
        if (ok) await deleteItem(feedId, idx, null, null);
        return;
    }
    if (act === 'del-item') {
        const ci = Number(el.dataset.ci);
        const ri = el.dataset.ri != null ? Number(el.dataset.ri) : null;
        const f = getFeed(feedId);
        const post = f?.data.posts[idx];
        const item = ri == null ? post?.comments[ci] : post?.comments[ci]?.replies[ri];
        if (!item) return;
        const pf = PLATFORMS[f.platform];
        const kind = pf?.chat ? '메시지' : f.platform === 'fivech' ? '레스' : (ri == null ? '댓글' : '답글');
        const obj = { 댓글: '댓글을', 답글: '답글을', 레스: '레스를', 메시지: '메시지를' }[kind];
        const extra = ri == null && item.replies?.length && !pf?.flat ? `<br><small>달린 답글 ${item.replies.length}개도 함께 지워져요.</small>` : '';
        const { Popup, POPUP_RESULT } = ctx();
        const ok = Popup?.show?.confirm
            ? (await Popup.show.confirm(`${kind} 삭제`, esc(`${item.author || '익명'}: ${truncate(item.body, 60)}`) + `<br>이 ${obj} 지울까요?` + extra)) === POPUP_RESULT.AFFIRMATIVE
            : confirm(`이 ${obj} 지울까요?`);
        if (ok) await deleteItem(feedId, idx, ci, ri);
        return;
    }
    if (act === 'submit-post') {
        const box = el.closest('.stcm-compose-view');
        await submitPlayerPost({
            title: box.querySelector('.stcm-cp-title')?.value ?? '',
            body: box.querySelector('.stcm-cp-body').value,
            board: box.querySelector('.stcm-cp-board')?.value ?? '',
            category: box.querySelector('.stcm-cp-cat')?.value ?? '',
            media: readMediaRows(box),
            identity: readIdentity(box),
            react: box.querySelector('.stcm-cp-react').checked,
            draftId: box.dataset.draft ?? '',
        });
        return;
    }
    if (act === 'cancel-post') {
        // 취소: throw the form away (asked when something is written); "no" keeps it for later
        const v = el.closest('.stcm-compose-view');
        const d = v ? readComposeForm(v) : null;
        const written = d && (d.title.trim() || d.body.trim() || d.inst.trim() || d.media.some(m => m.desc));
        if (written) {
            const { Popup, POPUP_RESULT } = ctx();
            const ok = Popup?.show?.confirm
                ? (await Popup.show.confirm('쓰던 글', '쓰던 내용을 버릴까요?<br><small>"아니요"를 누르면 그대로 보관해 두고, 다음에 글쓰기를 열면 다시 채워져요.</small>')) === POPUP_RESULT.AFFIRMATIVE
                : confirm('쓰던 내용을 버릴까요? (취소를 누르면 보관해 둬요)');
            if (ok) {
                forgetComposeForm(v.dataset.chat);
                if (v.dataset.draft) dropUnposted(v.dataset.chat, v.dataset.draft);   // a kept post thrown away too
            }
        } else if (v) {
            forgetComposeForm(v.dataset.chat);
        }
        showFeed(currentFeedId);
        return;
    }

    if (el.dataset.openFeed) {
        // from the pinned list: open that very post (unfolded / its channel selected)
        const postIdx = el.dataset.openPost != null ? Number(el.dataset.openPost) : null;
        const target = getFeed(el.dataset.openFeed);
        if (target && postIdx != null && target.data.posts[postIdx]) {
            openPosts.add(`${target.id}:${postIdx}`);
            if (PLATFORMS[target.platform]?.chat) dsSel.set(target.id, postIdx);
            showFeed(target.id, { scrollToPost: postIdx });
        } else showFeed(el.dataset.openFeed);
        return;
    }

    if (el.dataset.delFeed) {
        const store = getChatStore();
        const id = el.dataset.delFeed;
        store.feeds = store.feeds.filter(f => f.id !== id);
        store.pins = store.pins.filter(p => p.feedId !== id);
        if (currentFeedId === id) currentFeedId = null;
        await saveChatStore();
        refreshInjection();
        showHistory();
        return;
    }
    if (el.dataset.unpin) {
        const [fid, pi] = el.dataset.unpin.split('|');
        await togglePin(fid, Number(pi));
        showPins();
        return;
    }
    if (el.id === 'stcm_pins_toggle') {
        const store = getChatStore();
        store.pinsEnabled = !store.pinsEnabled;
        await saveChatStore();
        refreshInjection();
        showPins();
        return;
    }
    if (el.id === 'stcm_tr_toggle') {
        showTr = !showTr;
        for (const p of getFeed(currentFeedId)?.data.posts ?? []) trView.delete(p);   // the bar button sets every post
        captureDraft();
        showFeed(currentFeedId, { keepScroll: true });
        return;
    }
    if (el.id === 'stcm_back') {
        showFeed(currentFeedId);
    }
}

function syncSelectors() {
    document.querySelectorAll('#stcm_modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === selMode));
    document.querySelectorAll('#stcm_platforms button').forEach(b => b.classList.toggle('active', b.dataset.platform === selPlatform));
    const store = hasChat() ? getChatStore() : null;
    const cnt = store?.pins.length ?? 0;
    const el = document.getElementById('stcm_pin_count');
    if (el) el.textContent = cnt ? String(cnt) : '';
    const dot = document.getElementById('stcm_more_dot');
    if (dot) dot.textContent = cnt ? String(cnt) : '';
    syncLanguageSelectors();
    renderSpaceChips();
    renderLocaleSelect();
    renderTopicChips();
    renderBoardChips();
}

function renderTopicChips() {
    const el = document.getElementById('stcm_topics');
    if (!el) return;
    const s = getSettings();
    const sel = new Set(s.topicSelected ?? []);
    const topics = parseTopics();
    const anySel = topics.some(t => sel.has(t.name));
    const scopeNote = s.topicScope === 'auto' ? ' title="자동 생성에만 적용돼요"' : '';
    const keepLeft = el.scrollLeft;
    el.innerHTML = `<span class="stcm-topic-label"${scopeNote}><i class="fa-solid fa-tags"></i> 글 주제${s.topicScope === 'auto' ? '(자동만)' : ''}</span>
        <button data-topic-act="free" class="${anySel ? '' : 'active'}">자유</button>
        ${topics.map(t => `<button data-topic="${esc(t.name)}" class="${sel.has(t.name) ? 'active' : ''}" title="${esc(t.desc)}">${esc(t.name)}</button>`).join('')}
        <button data-topic-act="edit" title="주제 추가·관리 (이름·설명 고치기도 여기서)"><i class="fa-solid fa-plus"></i></button>
        <button data-topic-act="mix" class="stcm-topic-mix" title="여러 주제를 골랐을 때 배정 방식" style="${sel.size > 1 ? '' : 'visibility:hidden'}">${s.topicMix === 'mix' ? '섞어서' : '글마다 하나씩'}</button>`;
    el.scrollLeft = keepLeft;
}

// ---------------------------------------------------------------------------
// Community background (per chat) and spaces the user creates (a game cafe, a school gallery…)
// ---------------------------------------------------------------------------
const SPACE_UNIT = { naver: '카페', dcinside: '갤러리', tdgall: '갤', kkangtong: '게시판', reddit: '서브레딧', twitter: '커뮤니티', fivech: '板', weibo: '超话', tieba: '吧', discord: '서버', blind: '라운지', everytime: '학교' };

function spaceUnit(platformId) { return SPACE_UNIT[platformId] ?? '게시판'; }
function customSpaces() { return getSettings().customSpaces; }
function spaceById(id) { return id ? customSpaces().find(s => s.id === id) ?? null : null; }
function feedSpace(f) { return typeof f?.space === 'string' ? f.space : ''; }

/** Space picked above for this community ('' = 기본: the AI picks the board). */
function currentSpace(platformId) {
    const id = getSettings().spaceSelected?.[platformId] || '';
    return spaceById(id)?.platform === platformId ? id : '';
}

function setCurrentSpace(platformId, id) {
    const s = getSettings();
    s.spaceSelected = { ...(s.spaceSelected ?? {}), [platformId]: id || '' };
    saveSettings();
}

const LOCALE_CUSTOM_MAX = 10;   // free-text backgrounds kept per chat

function chatLocale() {
    const st = hasChat() ? getChatStore() : null;
    return st?.locale ?? { mode: 'story', country: '', custom: '' };
}

/** A space's own background wins over the chat's; 'inherit' = use the chat's. */
function effectiveLocale(spaceId) {
    const sp = spaceById(spaceId);
    if (sp?.locale && sp.locale.mode && sp.locale.mode !== 'inherit') return sp.locale;
    return chatLocale();
}

function localeLabel(loc) {
    if (loc?.mode === 'country') return COUNTRIES.find(c => c[0] === loc.country)?.[1] ?? '나라';
    if (loc?.mode === 'custom') return truncate(loc.custom || '직접 입력', 14);
    return '이야기대로';
}

/** Extra lines for <platform_style>: the user's space and where the community lives. */
function sceneText(platformId, spaceId) {
    const parts = [];
    const sp = spaceById(spaceId);
    if (sp) parts.push(fillTpl(getPrompt('community_space'), { ...baseVars(platformId), space: sp.name, about: sp.desc || '(no description)' }));
    const loc = effectiveLocale(spaceId);
    if (loc.mode === 'country') {
        const c = COUNTRIES.find(x => x[0] === loc.country);
        if (c) parts.push(fillTpl(getPrompt('setting_country'), { country: c[2] }));
    } else if (loc.mode === 'custom' && String(loc.custom ?? '').trim()) {
        parts.push(fillTpl(getPrompt('setting_custom'), { setting: String(loc.custom).trim().slice(0, 600) }));
    }
    return parts.join('\n');
}

/** "카페: 기본 · 게임 카페 · ＋" row under the community chips. */
function renderSpaceChips() {
    const el = document.getElementById('stcm_spaces');
    if (!el) return;
    const unit = spaceUnit(selPlatform);
    const cur = currentSpace(selPlatform);
    const list = customSpaces().filter(sp => sp.platform === selPlatform);
    const keepLeft = el.scrollLeft;
    el.innerHTML = `<span class="stcm-topic-label" title="내가 만든 ${unit}"><i class="fa-solid fa-house-flag"></i> ${unit}</span>
        <button data-space="" class="${cur ? '' : 'active'}" title="AI가 어울리는 ${unit}를 정해요">기본</button>
        ${list.map(sp => `<button data-space="${esc(sp.id)}" class="${cur === sp.id ? 'active' : ''}" title="${esc(sp.desc)}">${esc(sp.name)}</button>`).join('')}
        ${cur ? `<button data-space-act="settings" title="'${esc(spaceById(cur)?.name ?? '')}' 설정 바꾸기 (이름·설명·배경)"><i class="fa-solid fa-gear"></i></button>` : ''}
        <button data-space-act="edit" title="${unit} 만들기·관리"><i class="fa-solid fa-plus"></i> 만들기</button>`;
    el.scrollLeft = keepLeft;
    updatePicker();
}

/** "배경" select next to the language select (per chat). Free-text backgrounds written in this chat stay in the
 *  list; "직접 입력…" is always there to write another one. */
function renderLocaleSelect() {
    const sel = document.getElementById('stcm_locale');
    if (!sel) return;
    const loc = chatLocale();
    const customs = (hasChat() ? getChatStore().localeCustoms : null) ?? [];
    const val = loc.mode === 'country' ? `c:${loc.country}` : loc.mode === 'custom' ? `u:${customs.indexOf(loc.custom)}` : loc.mode;
    sel.innerHTML = `<option value="story">배경: 이야기대로</option>
        ${COUNTRIES.map(([k, ko]) => `<option value="c:${k}">배경: ${esc(ko)}</option>`).join('')}
        ${customs.map((t, i) => `<option value="u:${i}" title="${esc(t)}">배경: ${esc(truncate(t, 12))}</option>`).join('')}
        <option value="custom">배경: 직접 입력…</option>
        ${customs.length ? '<option value="manage">배경: 직접 입력한 것 정리…</option>' : ''}`;
    sel.value = val;
    sel.disabled = !hasChat();
    sel.title = loc.mode === 'custom' ? `커뮤니티 배경 (이 채팅): ${loc.custom}` : '커뮤니티 배경 (이 채팅)';
}

async function onLocaleChange(sel) {
    const st = hasChat() ? getChatStore() : null;
    if (!st) return;
    const chatAtStart = ctx().getCurrentChatId?.();
    const v = sel.value;
    const { Popup, POPUP_RESULT } = ctx();
    if (v === 'custom') {
        // a new one (the ones written before stay in the list)
        const text = Popup?.show?.input
            ? await Popup.show.input('커뮤니티 배경 직접 입력', '이 채팅의 커뮤니티 사람들이 사는 곳·때를 적어 주세요. (예: 1990년대 일본 오사카, 2050년 화성 이주민 도시) 앞에 적은 배경은 목록에 그대로 남아서 다시 고를 수 있어요.', '', { rows: 3 })
            : prompt('커뮤니티 배경', '');
        if (text == null || !String(text).trim() || ctx().getCurrentChatId?.() !== chatAtStart) { renderLocaleSelect(); return; }
        const t = String(text).trim().slice(0, 600);
        st.localeCustoms = [t, ...st.localeCustoms.filter(x => x !== t)].slice(0, LOCALE_CUSTOM_MAX);
        st.locale = { mode: 'custom', country: '', custom: t };
    } else if (v === 'manage') {
        // edit or remove one of the written backgrounds (an empty box removes it)
        const list = st.localeCustoms.map((t, i) => `${i + 1}. ${truncate(t, 60)}`).join('\n');
        const pick = Popup?.show?.input
            ? await Popup.show.input('직접 입력한 배경 정리', `고칠 배경의 번호를 적어 주세요.\n${list}`, '1')
            : prompt(`고칠 배경의 번호\n${list}`, '1');
        const k = Number(pick) - 1;
        if (pick == null || !Number.isInteger(k) || !st.localeCustoms[k] || ctx().getCurrentChatId?.() !== chatAtStart) { renderLocaleSelect(); return; }
        const old = st.localeCustoms[k];
        const text = Popup?.show?.input
            ? await Popup.show.input('배경 고치기', '내용을 고쳐 주세요. 칸을 모두 비우면 목록에서 지워요.', old, { rows: 3 })
            : prompt('배경 고치기 (비우면 지움)', old);
        if (text == null || ctx().getCurrentChatId?.() !== chatAtStart) { renderLocaleSelect(); return; }
        const t = String(text).trim().slice(0, 600);
        if (!t) {
            const ok = Popup?.show?.confirm ? (await Popup.show.confirm('배경 지우기', `"${truncate(old, 40)}"을(를) 목록에서 지울까요?`)) === POPUP_RESULT.AFFIRMATIVE : confirm('목록에서 지울까요?');
            if (!ok || ctx().getCurrentChatId?.() !== chatAtStart) { renderLocaleSelect(); return; }
            st.localeCustoms = st.localeCustoms.filter(x => x !== old);
            if (st.locale.mode === 'custom' && st.locale.custom === old) st.locale = { mode: 'story', country: '', custom: '' };
        } else {
            st.localeCustoms = st.localeCustoms.map(x => (x === old ? t : x)).filter((x, i, a) => a.indexOf(x) === i);
            if (st.locale.mode === 'custom' && st.locale.custom === old) st.locale = { mode: 'custom', country: '', custom: t };
        }
    } else if (v.startsWith('u:')) {
        const t = st.localeCustoms[Number(v.slice(2))];
        if (!t) { renderLocaleSelect(); return; }
        st.locale = { mode: 'custom', country: '', custom: t };
    } else if (v.startsWith('c:')) {
        st.locale = { mode: 'country', country: v.slice(2), custom: '' };
    } else {
        st.locale = { mode: 'story', country: '', custom: '' };
    }
    await saveChatStore();
    renderLocaleSelect();
    toastr.info(`이 채팅의 커뮤니티 배경: ${esc(localeLabel(st.locale))}`, '', { timeOut: 1500 });
}

/** Space manager view (＋ on the space row). */
let spaceEdit = null;   // null | { id } ('' = new)

function showSpaceEditor() {
    leaveFeed();
    view = 'spaces';
    const unit = spaceUnit(selPlatform);
    const list = customSpaces().filter(sp => sp.platform === selPlatform);
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">${esc(PLATFORMS[selPlatform]?.label)} ${unit} 만들기·관리 · ${list.length}개</span>`;
    syncSelectors();
    const sp = spaceEdit?.id ? spaceById(spaceEdit.id) : null;
    const loc = sp?.locale ?? { mode: 'inherit' };
    const locVal = loc.mode === 'country' ? `c:${loc.country}` : (loc.mode || 'inherit');
    el.innerHTML = `<div class="stcm-compose-view stcm-space-view">
        <p class="stcm-cp-hint">${esc(PLATFORMS[selPlatform]?.label)}에 나만의 ${unit}를 만들어요. 고르면 그 ${unit} 회원들이 글을 쓰고, 위의 글 주제(연애·자유…)는 그 ${unit} 안에서 글 내용을 정해요. ${unit}마다 글과 판이 따로 쌓여요.</p>
        <div class="stcm-space-form" data-id="${esc(sp?.id ?? '')}">
            <label class="stcm-cp-check">${sp ? `${unit} 고치기` : `새 ${unit}`}</label>
            <input class="stcm-sp-name" type="text" maxlength="40" placeholder="${unit} 이름 (예: ${esc(spacePlaceholder(selPlatform))})" value="${esc(sp?.name ?? '')}">
            <textarea class="stcm-sp-desc" rows="3" maxlength="500" placeholder="어떤 곳인지 (예: 모바일 RPG '별의 노래' 유저들이 모이는 곳. 공략·가챠 인증·잡담이 많고 분위기는 훈훈함)">${esc(sp?.desc ?? '')}</textarea>
            <select class="stcm-sp-locale">
                <option value="inherit" ${locVal === 'inherit' ? 'selected' : ''}>배경: 채팅 설정 따라가기</option>
                <option value="story" ${locVal === 'story' ? 'selected' : ''}>배경: 이야기대로</option>
                ${COUNTRIES.map(([k, ko]) => `<option value="c:${k}" ${locVal === `c:${k}` ? 'selected' : ''}>배경: ${esc(ko)}</option>`).join('')}
                <option value="custom" ${locVal === 'custom' ? 'selected' : ''}>배경: 직접 입력</option>
            </select>
            <input class="stcm-sp-custom ${locVal === 'custom' ? '' : 'stcm-hide'}" type="text" maxlength="300" placeholder="배경 직접 입력 (예: 1990년대 일본 오사카)" value="${esc(loc.mode === 'custom' ? loc.custom ?? '' : '')}">
            <div class="stcm-cp-foot">
                ${sp ? '<button data-act="space-cancel">새로 만들기</button>' : ''}
                <button class="primary" data-act="space-save"><i class="fa-solid fa-floppy-disk"></i> ${sp ? '저장' : '만들기'}</button>
            </div>
        </div>
        ${list.length ? `<div class="stcm-list">${list.map(x => `
            <div class="stcm-li">
                <div class="stcm-li-main" data-act="space-pick" data-id="${esc(x.id)}"><b>${esc(x.name)}</b>${currentSpace(selPlatform) === x.id ? ' <span class="stcm-api-using">선택됨</span>' : ''}
                    <small>${esc(truncate(x.desc || '설명 없음', 100))}${x.locale?.mode && x.locale.mode !== 'inherit' ? ` · 배경: ${esc(localeLabel(x.locale))}` : ''}</small></div>
                <button data-act="space-edit" data-id="${esc(x.id)}" title="고치기"><i class="fa-solid fa-pen"></i></button>
                <button data-act="space-del" data-id="${esc(x.id)}" title="지우기"><i class="fa-solid fa-trash-can"></i></button>
            </div>`).join('')}</div>` : ''}
    </div>`;
    el.scrollTop = 0;
}

function spacePlaceholder(pid) {
    return { naver: '별의 노래 공식 팬카페', dcinside: '별의 노래 갤러리', reddit: 'r/StarSongGame', fivech: 'ゲーム板', discord: '별의 노래 길드 서버', blind: '게임업계 라운지', everytime: '한빛대학교', weibo: '星之歌超话', tieba: '星之歌吧', twitter: '별의 노래 유저 모임', tdgall: '별의 노래 갤', kkangtong: '별의 노래 봇 연구소' }[pid] ?? '게임 카페';
}

async function onSpaceAction(el) {
    const s = getSettings();
    const act = el.dataset.act;
    if (act === 'space-cancel') { spaceEdit = null; showSpaceEditor(); return; }
    if (act === 'space-edit') { spaceEdit = { id: el.dataset.id }; showSpaceEditor(); return; }
    if (act === 'space-pick') { setCurrentSpace(selPlatform, el.dataset.id); spaceEdit = null; showFeed(null); return; }
    if (act === 'space-del') {
        const sp = spaceById(el.dataset.id);
        if (!sp) return;
        const { Popup, POPUP_RESULT } = ctx();
        const ok = Popup?.show?.confirm
            ? (await Popup.show.confirm(`${spaceUnit(sp.platform)} 지우기`, `"${esc(sp.name)}"을(를) 목록에서 지울까요?<br><small>이미 만든 글은 🕘 지난 피드에 남아요.</small>`)) === POPUP_RESULT.AFFIRMATIVE
            : confirm('지울까요?');
        if (!ok) return;
        s.customSpaces = s.customSpaces.filter(x => x.id !== sp.id);
        if (s.spaceSelected?.[sp.platform] === sp.id) setCurrentSpace(sp.platform, '');
        if (spaceEdit?.id === sp.id) spaceEdit = null;
        saveSettings();
        showSpaceEditor();
        return;
    }
    if (act === 'space-save') {
        const form = el.closest('.stcm-space-form');
        const name = form.querySelector('.stcm-sp-name').value.replace(/[\n\r]/g, ' ').trim().slice(0, 40);
        if (!name) { toastr.warning(`${spaceUnit(selPlatform)} 이름을 적어 주세요.`); return; }
        const desc = form.querySelector('.stcm-sp-desc').value.trim().slice(0, 500);
        const lv = form.querySelector('.stcm-sp-locale').value;
        const custom = form.querySelector('.stcm-sp-custom').value.trim().slice(0, 300);
        const locale = lv.startsWith('c:') ? { mode: 'country', country: lv.slice(2), custom: '' }
            : lv === 'custom' ? (custom ? { mode: 'custom', country: '', custom } : { mode: 'inherit' })
            : { mode: lv === 'story' ? 'story' : 'inherit' };
        const id = form.dataset.id || (ctx().uuidv4 ? ctx().uuidv4() : `${Date.now().toString(36)}${randomId(6)}`);
        const entry = { id, platform: selPlatform, name, desc, locale };
        const i = s.customSpaces.findIndex(x => x.id === id);
        if (i >= 0) s.customSpaces[i] = entry; else s.customSpaces.push(entry);
        setCurrentSpace(selPlatform, id);   // a new / edited space is the one you want to see
        spaceEdit = null;
        saveSettings();
        toastr.success(`"${esc(name)}" ${i >= 0 ? '저장했어요' : '만들었어요'}. 지금부터 여기서 생성해요.`);
        showFeed(null);
    }
}

/** Boards that already have posts on the selected community + mode, newest first. */
function boardsFor(platform, mode) {
    const store = hasChat() ? getChatStore() : null;
    const known = new Set(parseTopics().map(t => t.name));
    const map = new Map();
    for (const f of store?.feeds ?? []) {
        if (f.platform !== platform || f.mode !== mode || feedSpace(f) !== currentSpace(platform)) continue;
        const key = feedBoardKey(f);
        if (key && !key.split('|').every(n => known.has(n))) continue;   // a topic of it was deleted
        // the board shows its newest feed, so count that one's posts (older ones live in 🕘 history)
        const b = map.get(key) ?? { key, posts: 0, last: -1 };
        const t = Number(f.createdAt) || 0;
        if (t >= b.last) { b.last = t; b.posts = f.data?.posts?.length ?? 0; }
        map.set(key, b);
    }
    return [...map.values()].sort((a, b) => b.last - a.last);
}

/** "판" row: every board made so far (combined topics too), one click to go there. */
function renderBoardChips() {
    const el = document.getElementById('stcm_boards');
    if (!el) return;
    const cur = currentBoardKey();
    const boards = cur === null ? [] : boardsFor(selPlatform, selMode);
    // worth showing once there is more than one board, or a combined one
    const show = boards.length > 1 || boards.some(b => b.key.includes('|'));
    el.classList.toggle('stcm-hide', !show);
    if (!show) { el.innerHTML = ''; return; }
    const keepLeft = el.scrollLeft;
    // Discord: a topic is its own server, but inside a space you made the server is the space
    const unit = PLATFORMS[selPlatform]?.chat ? (currentSpace(selPlatform) ? '주제' : '서버') : '판';
    el.innerHTML = `<span class="stcm-topic-label" title="지금 커뮤니티·모드에서 만든 ${unit}"><i class="fa-solid fa-table-list"></i> ${unit}</span>
        ${boards.map(b => `<button data-board="${esc(b.key)}" class="${b.key === cur ? 'active' : ''}" title="글 ${b.posts}개">${esc(boardLabel(b.key))} <small>${b.posts}</small></button>`).join('')}`;
    el.scrollLeft = keepLeft;
}

let topicEdit = null;   // name of the topic being edited in the topic manager (null = adding)

function showTopicEditor() {
    leaveFeed();
    view = 'topics';
    const s = getSettings();
    const sel = new Set(s.topicSelected ?? []);
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    const topics = parseTopics();
    const editing = topicEdit && topics.find(t => t.name === topicEdit) ? topics.find(t => t.name === topicEdit) : null;
    if (!editing) topicEdit = null;
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">글 주제 추가·관리 · ${topics.length}개</span>`;
    el.innerHTML = `<div class="stcm-compose-view">
        <p class="stcm-cp-hint">${editing
            ? `<b>"${esc(editing.name)}" 고치기</b> — 이름을 바꿔도 이 주제로 쌓인 판과 글은 새 이름의 판에 그대로 보여요.`
            : '새 주제를 추가하면 바로 선택돼요. 설명은 AI에게 전달되니 원하는 느낌을 적어 주세요. 이미 있는 주제는 <i class="fa-solid fa-pen"></i>로 이름·설명을 고칠 수 있어요.'}</p>
        <div class="stcm-topic-add">
            <input id="stcm_tp_name" type="text" maxlength="40" placeholder="주제 이름 (예: 자캐 목격담)" value="${esc(editing?.name ?? '')}">
            <input id="stcm_tp_desc" type="text" maxlength="200" placeholder="설명 (선택) — 예: 캐릭터를 길에서 봤다는 글" value="${esc(editing?.desc ?? '')}">
            ${editing
                ? '<button data-act="topic-edit-cancel">취소</button><button class="primary" data-act="topic-add"><i class="fa-solid fa-floppy-disk"></i> 저장</button>'
                : '<button class="primary" data-act="topic-add"><i class="fa-solid fa-plus"></i> 추가</button>'}
        </div>
        <div class="stcm-list">
            ${topics.map(t => `
            <div class="stcm-li">
                <div class="stcm-li-main" data-act="topic-toggle" data-name="${esc(t.name)}">
                    <b>${sel.has(t.name) ? '<i class="fa-solid fa-check"></i> ' : ''}${esc(t.name)}</b>
                    ${t.desc ? `<small>${esc(t.desc)}</small>` : ''}
                </div>
                <button data-act="topic-edit" data-name="${esc(t.name)}" title="이름·설명 고치기"><i class="fa-solid fa-pen"></i></button>
                <button data-act="topic-del" data-name="${esc(t.name)}" title="삭제"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join('') || '<div class="stcm-empty">주제가 없어요. 위에서 추가해 보세요.</div>'}
        </div>
        <div class="stcm-cp-foot">
            <label class="stcm-cp-check">적용
                <select id="stcm_topic_scope">
                    <option value="all" ${s.topicScope !== 'auto' ? 'selected' : ''}>직접 생성 + 자동 생성</option>
                    <option value="auto" ${s.topicScope === 'auto' ? 'selected' : ''}>자동 생성만</option>
                </select>
            </label>
            <button data-act="topics-reset">기본 주제 다시 넣기</button>
        </div>
    </div>`;
    const name = document.getElementById('stcm_tp_name');
    const desc = document.getElementById('stcm_tp_desc');
    for (const inp of [name, desc]) {
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) el.querySelector('[data-act="topic-add"]').click();
        });
    }
    document.getElementById('stcm_topic_scope').addEventListener('change', (e) => {
        s.topicScope = e.target.value;
        saveSettings();
        renderTopicChips();
        syncTopicSettings();
    });
    name.focus();
}

function writeTopics(list) {
    const s = getSettings();
    s.topics = list.map(t => t.desc ? `${t.name}: ${t.desc}` : t.name).join('\n');
    const names = new Set(list.map(t => t.name));
    s.topicSelected = (s.topicSelected ?? []).filter(n => names.has(n));
    saveSettings();
    renderTopicChips();
    syncTopicSettings();
}

async function onTopicAction(el) {
    const s = getSettings();
    const act = el.dataset.act;
    const list = parseTopics();
    if (act === 'topic-edit') { topicEdit = el.dataset.name; showTopicEditor(); return; }
    if (act === 'topic-edit-cancel') { topicEdit = null; showTopicEditor(); return; }
    if (act === 'topic-add') {
        const name = document.getElementById('stcm_tp_name').value.replace(/[:：\n|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);   // '|' joins topics in a board key
        const desc = document.getElementById('stcm_tp_desc').value.replace(/\n/g, ' ').trim();
        if (!name) { toastr.warning('주제 이름을 적어 주세요.'); return; }
        const old = topicEdit ? list.find(t => t.name === topicEdit) : null;
        if (old) {
            // editing: new name and description; boards made under the old name follow it
            if (name !== old.name && list.some(t => t.name === name)) { toastr.warning(`"${esc(name)}" 주제가 이미 있어요. 다른 이름을 적어 주세요.`); return; }
            const was = old.name;
            old.desc = desc;
            if (name !== was) {
                old.name = name;
                // boards made under the old name until now follow the new one (a later topic of that name won't)
                const at = Math.max(Date.now(), ...Object.values(s.topicRenames).flat().map(e => e.at + 1));
                s.topicRenames[was] = [...(s.topicRenames[was] ?? []), { to: name, at }];
                s.topicSelected = (s.topicSelected ?? []).map(n => (n === was ? name : n));
            }
            topicEdit = null;
            writeTopics(list);
            toastr.success(name !== was ? `"${esc(was)}" → "${esc(name)}"로 바꿨어요.` : `"${esc(name)}" 설명을 바꿨어요.`, '', { timeOut: 2500 });
            renderBoardChips();
            showTopicEditor();
            return;
        }
        const found = list.find(t => t.name === name);
        if (found) { found.desc = desc || found.desc; toastr.info(`"${esc(name)}" 설명을 바꿨어요.`); }
        else list.push({ name, desc });
        writeTopics(list);
        s.topicSelected = [...new Set([...(s.topicSelected ?? []), name])];
        saveSettings();
        renderTopicChips();
        showTopicEditor();
        return;
    }
    if (act === 'topic-del') {
        writeTopics(list.filter(t => t.name !== el.dataset.name));
        showTopicEditor();
        return;
    }
    if (act === 'topic-toggle') {
        const set = new Set(s.topicSelected ?? []);
        if (set.has(el.dataset.name)) set.delete(el.dataset.name); else set.add(el.dataset.name);
        s.topicSelected = [...set];
        saveSettings();
        renderTopicChips();
        showTopicEditor();
        return;
    }
    if (act === 'topics-reset') {
        // Re-add the default topics that are missing; keep the user's own
        const defaults = String(defaultSettings.topics).split('\n').map(l => {
            const m = l.match(/^([^:：]+)[:：]\s*(.*)$/);
            return { name: (m ? m[1] : l).trim(), desc: m ? m[2].trim() : '' };
        });
        const have = new Set(list.map(t => t.name));
        writeTopics([...list, ...defaults.filter(d => !have.has(d.name))]);
        showTopicEditor();
    }
}

function syncTopicSettings() {
    const s = getSettings();
    const sc = document.getElementById('stcm_set_topicscope');
    if (sc) sc.value = s.topicScope;
    const mx = document.getElementById('stcm_set_topicmix');
    if (mx) mx.value = s.topicMix;
}

function syncLanguageSelectors() {
    const s = getSettings();
    const pairs = [
        ['stcm_lang', s.language, s.customLanguage],
        ['stcm_set_language', s.language, s.customLanguage],
        ['stcm_set_translate', s.translateTo, s.customTranslate],
    ];
    for (const [id, value, custom] of pairs) {
        const sel = document.getElementById(id);
        if (!sel) continue;
        sel.value = value;
        const opt = sel.querySelector('option[value="custom"]');
        if (opt) opt.textContent = custom ? `직접 입력: ${custom}` : '직접 입력…';
    }
    const c1 = document.getElementById('stcm_set_custom_lang');
    const c2 = document.getElementById('stcm_set_custom_tr');
    if (c1) { c1.style.display = s.language === 'custom' ? '' : 'none'; c1.value = s.customLanguage; }
    if (c2) { c2.style.display = s.translateTo === 'custom' ? '' : 'none'; c2.value = s.customTranslate; }
}

function setBusyUI(on, label = '') {
    const ov = document.getElementById('stcm_overlay');
    ov?.classList.toggle('busy', on);
    const pill = document.getElementById('stcm_busy');
    if (pill) pill.querySelector('span').textContent = label;
}

function showError(msg, raw) {
    if (!isOpen()) { toastr.error(esc(msg), '커뮤니티'); return; }
    const feedEl = document.getElementById('stcm_feed');
    const box = `<div class="stcm-empty error"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(msg)}
        ${raw ? `<details><summary>원본 응답 보기</summary><pre>${esc(String(raw).slice(0, 8000))}</pre></details>` : ''}
        ${raw
            ? '<p>최대 토큰을 늘리거나, 글/댓글 수를 줄이거나, 다른 연결 프로필을 써 보세요.</p>'
            : '<p><button class="stcm-link" data-act="err-api"><i class="fa-solid fa-plug"></i> API 설정 열기</button> — 연결 프로필과 연결 테스트를 확인해 보세요.</p>'}</div>`;
    // Show over the feed without moving it
    const eb = document.getElementById('stcm_errbox');
    if (!eb) { feedEl.insertAdjacentHTML('afterbegin', box); return; }
    eb.innerHTML = `<button class="stcm-err-close" data-act="err-close" title="닫기"><i class="fa-solid fa-xmark"></i></button>${box}`;
    eb.classList.add('show');
}

/** Is this feed the board currently picked above (community + mode + space + topic board)? */
function feedMatchesSelection(feed) {
    if (!feed || feed.platform !== selPlatform || feed.mode !== selMode || feedSpace(feed) !== currentSpace(selPlatform)) return false;
    const bk = currentBoardKey();
    return bk === null || feedBoardKey(feed) === bk;
}

/** Newest feed of this chat for a community + mode + space + topic board (or null). */
function latestFeedFor(platform, mode, board = currentBoardKey(), space = currentSpace(platform)) {
    const store = hasChat() ? getChatStore() : null;
    return [...(store?.feeds ?? [])].reverse()
        .find(f => f.platform === platform && f.mode === mode && feedSpace(f) === space && (board === null || feedBoardKey(f) === board)) ?? null;
}

/** Community / mode chip picked: show that board right away (or the write form when writing). */
function onSelectorChange() {
    syncSelectors();
    const store = hasChat() ? getChatStore() : null;
    if (store) {
        store.lastPlatform = selPlatform;
        store.lastMode = selMode;
        saveChatStore();
    }
    if (view === 'compose') { showCompose(); return; }
    if (view === 'spaces') { spaceEdit = null; showSpaceEditor(); return; }   // manage that community's cafes
    if (view === 'dm-new') dmDraft = null;
    showFeed(null);
}

function showFeed(feedId, opts = {}) {
    const sameView = view === 'feed';
    leaveFeed();
    view = 'feed';
    const store = hasChat() ? getChatStore() : null;
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    if (!el) return;
    const prevScroll = el.scrollTop;
    const anchor = sameView ? captureAnchor(el) : null;
    if (sameView) captureDraft();   // a half-written comment survives switching boards and coming back
    document.getElementById('stcm_errbox')?.classList.remove('show');
    syncSelectors();

    if (!store) {
        bar.innerHTML = '';
        el.innerHTML = `<div class="stcm-empty">채팅을 열면 커뮤니티를 볼 수 있어요.</div>`;
        return;
    }
    // An explicit feed (history, new generation…) wins and moves the selectors to it;
    // otherwise show the newest feed of the community + mode picked above, never another community's.
    let feed = feedId ? store.feeds.find(f => f.id === feedId) : null;
    if (feed) {
        selPlatform = feed.platform;
        selMode = feed.mode;
        if (feedSpace(feed) !== currentSpace(feed.platform) && (feedSpace(feed) === '' || spaceById(feedSpace(feed)))) setCurrentSpace(feed.platform, feedSpace(feed));
        const key = feedBoardKey(feed);
        if (currentBoardKey() !== null && key !== currentBoardKey()) {
            const known = new Set(parseTopics().map(t => t.name));
            const want = key ? key.split('|') : [];
            if (want.every(n => known.has(n))) { getSettings().topicSelected = want; saveSettings(); }
        }
        syncSelectors();
    } else {
        feed = latestFeedFor(selPlatform, selMode);
    }
    if (!feed) {
        currentFeedId = null;
        const bk = currentBoardKey();
        const spName = spaceById(currentSpace(selPlatform))?.name;
        const where = `<b>${esc(PLATFORMS[selPlatform]?.label)}</b>${spName ? ` · ${esc(spName)}` : ''} · ${esc(MODES[selMode]?.label)}${bk !== null ? ` · ${esc(boardName(bk, selPlatform))}` : ''}`;
        bar.innerHTML = `<span class="stcm-fb-info">${where}</span>`;
        el.innerHTML = unpostedNotice(null) + `<div class="stcm-empty"><i class="fa-solid fa-comments"></i><br>${store.feeds.length ? `아직 ${where} ${PLATFORMS[selPlatform]?.chat ? '채널이' : '글이'} 없어요.` : '아직 글이 없어요.'}<br><b>생성</b>을 누르거나 <i class="fa-solid fa-pen"></i> 버튼으로 직접 글을 써 보세요.${store.feeds.length ? '<br><small>다른 커뮤니티 글은 <i class="fa-solid fa-clock-rotate-left"></i> 지난 피드에서 볼 수 있어요.</small>' : ''}</div>`;
        el.scrollTop = 0;
        return;
    }
    currentFeedId = feed.id;
    // a renamed cafe / gallery: its feeds show the new name (in every chat, as they are opened)
    const spNow = spaceById(feedSpace(feed));
    if (spNow && feed.data.board !== spNow.name) { feed.data.board = spNow.name; scheduleFeedWrite(); }
    const hasTr = feed.data.posts.some(p => p.body_tr || p.body_ko || p.title_tr || postMedia(p).some(m => m.desc_tr) || p.comments.some(c => c.body_tr || c.body_ko));
    const when = new Date(feed.updatedAt || feed.createdAt).toLocaleString();
    bar.innerHTML = `<span class="stcm-fb-info"><b>${esc(PLATFORMS[feed.platform]?.label)}</b> · ${esc(MODES[feed.mode]?.label)} · #${feedLastAt(feed)} 시점 · ${esc(when)}${currentBoardKey() !== null ? ` · ${esc(boardName(feedBoardKey(feed), feed.platform))}` : (feed.topics?.length ? ` · 주제: ${esc(feed.topics.join(', '))}` : '')}${feed.topic ? ` · “${esc(truncate(feed.topic, 30))}”` : ''}</span>
        ${foldable(feed) && feed.data.posts.length ? '<button id="stcm_fold_all" data-act="fold-all"></button>' : ''}
        ${hasTr ? `<button id="stcm_tr_toggle" class="${showTr ? 'on' : ''}" title="${showTr ? '원문 보기' : '번역 보기'}"><i class="fa-solid fa-language"></i> 번역</button>` : ''}`;
    updateFoldAllButton(feed);
    const render = hasKey(renderers, feed.platform) ? renderers[feed.platform] : renderers.naver;
    indexItems(feed);
    const back = restoreCommentDraft(feed);   // a comment that couldn't be placed earlier: back in its box
    if (back != null) {
        if (PLATFORMS[feed.platform]?.chat) dsSel.set(feed.id, back);
        else if (opts.scrollToPost == null) opts = { ...opts, scrollToPost: back };
    }
    if (opts.scrollToPost != null) revealPost(feed, opts.scrollToPost);
    el.innerHTML = unpostedNotice(feed) + render(feed) + `
        <div class="stcm-older stcm-hide"><button data-act="older-posts" data-feed="${esc(feed.id)}"></button></div>
        <div class="stcm-more-posts"><button data-act="more-posts" data-feed="${esc(feed.id)}"><i class="fa-solid fa-plus"></i> ${PLATFORMS[feed.platform]?.chat ? '이 서버에 채널 더 만들기' : '이 게시판에 글 더 불러오기'}</button></div>`;

    applyFolding(feed, el);
    applyPaging(feed, el);
    if (opts.scrollToPost != null) {
        scrollToPostSmooth(opts.scrollToPost, false);
    } else if (opts.keepScroll && sameView) {
        if (!restoreAnchor(el, anchor)) el.scrollTop = prevScroll;
    } else if (feedScroll.has(feed.id)) {
        el.scrollTop = feedScroll.get(feed.id);
    } else {
        el.scrollTop = 0;
    }
    if (opts.focusComposer) focusComposer();
}

/** The topmost visible block (comment / reply / post) and its offset, keyed so a re-render keeps it in place. */
function captureAnchor(feedEl) {
    const fr = feedEl.getBoundingClientRect();
    let best = null;
    for (const el of feedEl.querySelectorAll('[data-k], [data-post]')) {
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.bottom <= fr.top + 1) continue;
        const key = el.dataset.k != null ? `k:${el.dataset.k}` : `p:${el.dataset.post}`;
        if (r.top >= fr.top) { best = { key, offset: r.top - fr.top }; break; }
        best = { key, offset: r.top - fr.top };
    }
    return best;
}

function restoreAnchor(feedEl, anchor) {
    if (!anchor) return false;
    const [kind, val] = [anchor.key.slice(0, 1), anchor.key.slice(2)];
    const el = feedEl.querySelector(kind === 'k' ? `[data-k="${CSS.escape(val)}"]` : `[data-post="${CSS.escape(val)}"]`);
    if (!el) return false;
    const fr = feedEl.getBoundingClientRect();
    feedEl.scrollTop += (el.getBoundingClientRect().top - fr.top) - anchor.offset;
    return true;
}

// ---------------------------------------------------------------------------
// Settings inside the panel: the extension-drawer settings are moved in (same elements,
// same listeners — nothing is duplicated) and moved back when the view is left.
// ---------------------------------------------------------------------------
let settingsHome = null;   // { marker, content, display } while the settings live in the panel

function showSettingsView() {
    leaveFeed();
    view = 'settings';
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    const content = document.querySelector('#stcm_settings .inline-drawer-content');
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">설정 <small>— 확장 탭의 설정과 같아요</small></span>`;
    document.getElementById('stcm_errbox')?.classList.remove('show');
    syncSelectors();
    if (!content) { el.innerHTML = '<div class="stcm-empty">설정을 찾지 못했어요. 확장 탭에서 열어 주세요.</div>'; return; }
    el.innerHTML = '<div class="stcm-settings-view"></div>';
    if (!settingsHome) {
        const marker = document.createComment('stcm-settings-home');
        content.before(marker);
        settingsHome = { marker, content, display: content.style.display };
    }
    content.style.display = 'block';
    el.querySelector('.stcm-settings-view').appendChild(content);
    const sel = document.getElementById('stcm_set_profile');
    if (sel) sel.innerHTML = connOptionsHtml();
    renderExtMemoryList();
    el.scrollTop = 0;
}

/** Put the settings back into the extension drawer (call before any other view or on close). */
function restoreSettingsHome() {
    if (!settingsHome) return;
    // keep a reference: even if the panel's HTML was replaced meanwhile, the node still exists
    const { marker, content, display } = settingsHome;
    settingsHome = null;
    if (content && marker.parentNode) {
        content.style.display = display;
        marker.replaceWith(content);
    } else marker.remove();
}

/** Remember where the reader was in the current feed before switching views. */
function leaveFeed() {
    if (view === 'compose') {   // last edits: into the write-form memory and the kept post it came from
        const v = document.querySelector('#stcm_feed .stcm-compose-view');
        syncComposeDraft(v);
        saveComposeForm(v);
    }
    if (view === 'feed') captureDraft();   // a half-written comment survives other menus
    restoreSettingsHome();
    const el = document.getElementById('stcm_feed');
    if (view === 'feed' && currentFeedId && el) feedScroll.set(currentFeedId, el.scrollTop);
}

function scrollToPostSmooth(idx, smooth = true) {
    const feedEl = document.getElementById('stcm_feed');
    const cur = getFeed(currentFeedId);
    if (cur && view === 'feed' && revealPost(cur, idx)) showFeed(cur.id, { keepScroll: true });   // draw it first
    const target = feedEl?.querySelector(`[data-post="${idx}"]`);
    if (!target) return;
    if (currentFeedId && target.classList.contains('stcm-fold')) setPostOpen(currentFeedId, idx, true);
    const top = target.getBoundingClientRect().top - feedEl.getBoundingClientRect().top + feedEl.scrollTop - 6;
    feedEl.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

/** Focus the inline composer without letting the browser jump the page. */
function focusComposer() {
    const feedEl = document.getElementById('stcm_feed');
    const box = feedEl?.querySelector('.stcm-composer');
    const ta = box?.querySelector('.stcm-cp-body');
    if (!ta) return;
    try { ta.focus({ preventScroll: true }); } catch { ta.focus(); }
    ta.setSelectionRange(ta.value.length, ta.value.length);
    // Reveal the form only if it is (partly) outside the visible area
    const fr = feedEl.getBoundingClientRect();
    const top = fr.top + stickyInset(feedEl);   // the part under a pinned bar (Discord) is not visible
    const tr = ta.getBoundingClientRect();
    const foot = box.querySelector('.stcm-cp-foot')?.getBoundingClientRect() ?? tr;
    // smallest scroll that shows the text box (and its send button when there is room)
    const need = Math.min(foot.bottom, tr.top + (fr.bottom - top) - 16);
    if (need > fr.bottom) feedEl.scrollBy({ top: need - fr.bottom + 8, behavior: 'smooth' });
    else if (tr.top < top) feedEl.scrollBy({ top: tr.top - top - 8, behavior: 'smooth' });
}

/** Height covered at the top of the feed by pinned bars (Discord channel name / phone channel row). */
function stickyInset(feedEl) {
    let h = 0;
    for (const el of feedEl.querySelectorAll('.stcm-ds-side, .stcm-ds-pane:not(.stcm-hide) .stcm-ds-head')) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'sticky') continue;
        const r = el.getBoundingClientRect();
        if (r.width < feedEl.clientWidth / 2) continue;   // the PC channel list sits beside, not above
        h = Math.max(h, r.height + (parseFloat(cs.top) || 0));
    }
    return Math.max(0, h);
}

/** Keep what the player typed when a post is re-rendered. */
function captureDraft() {
    if (!composer) return;
    const box = document.querySelector('#stcm_feed .stcm-composer');
    if (!box) return;
    const unpostedId = composer.draft?.unpostedId;
    composer.draft = { body: box.querySelector('.stcm-cp-body')?.value ?? '', inst: box.querySelector('.stcm-cp-inst')?.value ?? '', react: box.querySelector('.stcm-cp-react')?.checked !== false, media: readMediaRows(box, null, true), ...readIdentity(box), ...(unpostedId ? { unpostedId } : {}) };
    syncCommentDraft();
}

/** Re-render a single post in place; the rest of the feed and the scroll position stay put. */
function updatePost(feedId, idx, opts = {}) {
    const feedEl = document.getElementById('stcm_feed');
    const feed = getFeed(feedId);
    if (!feedEl || !feed || !isOpen()) return;
    // The user is looking at something else (history, another feed, compose…): the data is saved,
    // it shows up when they come back. Never switch their view from under them.
    if (view !== 'feed' || currentFeedId !== feedId) return;
    if (pagedOut(feed).has(idx)) return;   // behind 과거 글 더보기: not on screen, drawn when shown
    const active = document.activeElement;
    const typing = active && feedEl.contains(active) && active.matches('.stcm-composer textarea, .stcm-composer input')
        ? { cls: active.classList.contains('stcm-cp-body') ? '.stcm-cp-body' : (active.classList.contains('stcm-cp-inst') ? '.stcm-cp-inst' : null), start: active.selectionStart, end: active.selectionEnd }
        : null;
    captureDraft();
    const tpl = document.createElement('template');
    indexItems(feed);
    renderOnly = idx;   // build just this post, not the whole board
    try { tpl.innerHTML = (hasKey(renderers, feed.platform) ? renderers[feed.platform] : renderers.naver)(feed); } finally { renderOnly = null; }
    applyFolding(feed, tpl.content);
    const fresh = tpl.content.querySelector(`[data-post="${idx}"]`);
    const old = feedEl.querySelector(`[data-post="${idx}"]`);
    if (!fresh || !old) {
        showFeed(feedId, { keepScroll: true, focusComposer: opts.focusComposer });
        return;
    }
    const scroll = feedEl.scrollTop;
    const anchor = captureAnchor(feedEl);
    old.replaceWith(fresh);
    updateFoldAllButton(feed);
    feedEl.scrollTop = scroll;
    // Elements before the replaced post keep their index, so this pins the view in place
    restoreAnchor(feedEl, anchor);
    updatePinCount();
    if (opts.focusComposer) focusComposer();
    else if (typing?.cls) {
        const el = feedEl.querySelector(`.stcm-composer ${typing.cls}`);
        if (el) {
            try { el.focus({ preventScroll: true }); } catch { el.focus(); }
            try { el.setSelectionRange(typing.start ?? el.value.length, typing.end ?? el.value.length); } catch { /* ignore */ }
        }
    }
}

function updatePinCount() {
    const store = hasChat() ? getChatStore() : null;
    const cnt = store?.pins.length ?? 0;
    const el = document.getElementById('stcm_pin_count');
    if (el) el.textContent = cnt ? String(cnt) : '';
    const dot = document.getElementById('stcm_more_dot');
    if (dot) dot.textContent = cnt ? String(cnt) : '';
}

// ---------------------------------------------------------------------------
// 수정: change a post / comment / reply / res (generated ones too) — title, body, photos and videos
// ---------------------------------------------------------------------------
let editTarget = null;   // { feedId, post, item, kind: 'post' | 'comment', start }

function showEditItem(feedId, postIdx, ci = null, ri = null) {
    const feed = getFeed(feedId);
    const post = feed?.data.posts[postIdx];
    if (!post) return;
    const item = ci == null ? post : (ri == null ? post.comments[ci] : post.comments[ci]?.replies[ri]);
    if (!item) return;
    const kind = ci == null ? 'post' : 'comment';
    editTarget = { feedId, post, item, kind, start: workTarget() };
    leaveFeed();
    view = 'edit';
    const pf = PLATFORMS[feed.platform];
    const what = kind === 'post' ? postKindLabel(feed, post) : (pf?.chat ? '메시지' : feed.platform === 'fivech' ? '레스' : (ri == null ? '댓글' : '답글'));
    const withTitle = kind === 'post' && (String(post.title ?? '').trim() || pf?.hasTitle || pf?.chat || pf?.thread);
    const withMedia = kind === 'post' || commentMediaOn(feed, post) || postMedia(item).length > 0;
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">${esc(what)} 수정 · <b>${esc(item.author || '익명')}</b></span>`;
    el.innerHTML = `<div class="stcm-compose-view stcm-edit-view">
        <p class="stcm-cp-hint">${item.isMe ? '내가 쓴' : 'AI가 만든'} ${esc(what)}을(를) 고쳐요. 글쓴이·좋아요·${kind === 'post' ? '댓글은' : '답글은'} 그대로예요. 고친 부분의 번역은 지워지니, 필요하면 다시 번역해 주세요.</p>
        ${withTitle ? `<input class="stcm-cp-title" type="text" placeholder="${pf?.chat ? '채널 이름' : '제목'}">` : ''}
        <textarea class="stcm-cp-body" rows="${kind === 'post' ? 8 : 4}" placeholder="본문"></textarea>
        ${withMedia ? '<div class="stcm-cp-medialist"></div>' : ''}
        <div class="stcm-cp-foot">
            ${withMedia ? `<button data-act="cp-photo" class="stcm-cp-photo" title="사진 한 장 더 붙이기"><i class="fa-regular fa-image"></i> 사진</button>
            <button data-act="cp-video" class="stcm-cp-photo" title="영상 하나 더 붙이기"><i class="fa-solid fa-film"></i> 영상</button>` : ''}
            <button data-act="edit-cancel">취소</button>
            <button class="primary" data-act="edit-save"><i class="fa-solid fa-floppy-disk"></i> 저장</button>
        </div>
    </div>`;
    const t = el.querySelector('.stcm-cp-title');
    if (t) t.value = post.title ?? '';
    el.querySelector('.stcm-cp-body').value = item.body ?? '';
    for (const m of postMedia(item)) addMediaRow(el, m.type, m.desc);
    el.scrollTop = 0;
    el.querySelector('.stcm-cp-body').focus();
}

/** Save the edit form: nothing waits before the change, and only the same copy / post / item is changed. */
async function saveEditItem(view) {
    const t = editTarget;
    if (!t || !view) return;
    const feed = getFeed(t.feedId);
    const where = t.kind === 'post' ? [t.post] : [...t.post.comments, ...t.post.comments.flatMap(c => c.replies)];
    if (!feed || !stillTarget(t.start, [feed], t.post) || !where.includes(t.item)) {
        toastr.error('그 사이 채팅이나 피드가 바뀌었거나 글이 지워져서 저장하지 못했어요.', '커뮤니티');
        return;
    }
    const titleEl = view.querySelector('.stcm-cp-title');
    const title = titleEl ? titleEl.value.replace(/[\n\r]/g, ' ').trim().slice(0, 500) : null;
    const body = view.querySelector('.stcm-cp-body').value.trim();
    const media = view.querySelector('.stcm-cp-medialist') ? cleanMedia({ media: readMediaRows(view) }) : null;
    if (!body && !(media?.length) && !title) { toastr.warning('내용을 입력해 주세요. 지우려면 삭제를 써 주세요.'); return; }
    const o = t.item;
    let changed = false;
    if (title != null && title !== (t.post.title ?? '')) { t.post.title = title; delete t.post.title_tr; changed = true; }
    if (body !== String(o.body ?? '').trim()) { o.body = body; delete o.body_tr; delete o.body_ko; changed = true; }
    if (media) {
        const before = postMedia(o);
        const same = media.length === before.length && media.every((m, k) => m.type === before[k].type && m.desc === before[k].desc);
        if (!same) {
            // a photo / video left as it was keeps its translation
            for (const m of media) {
                const was = before.find(x => x.type === m.type && x.desc === m.desc && x.desc_tr);
                if (was) m.desc_tr = was.desc_tr;
            }
            if (media.length) o.media = media; else delete o.media;
            changed = true;
        }
    }
    editTarget = null;
    const idx = feed.data.posts.indexOf(t.post);
    if (!changed) { showFeed(feed.id, { scrollToPost: idx }); return; }
    await saveChatStore();   // the file write is scheduled before this waits
    if (!stillTarget(t.start, [feed], t.post)) return;
    const now = feed.data.posts.indexOf(t.post);
    if (isPinned(feed.id, now)) refreshInjection();
    showFeed(feed.id, { scrollToPost: now });
    toastr.success('고쳤어요.', '', { timeOut: 1500 });
}

function showCompose() {
    if (!hasChat()) { toastr.warning('먼저 채팅을 열어주세요.'); return; }
    leaveFeed();
    view = 'compose';
    syncSelectors();
    const p = PLATFORMS[selPlatform];
    const feed = getFeed(currentFeedId);
    const appending = feedMatchesSelection(feed);
    // a post that couldn't be placed earlier in this chat (the chat / feed changed while it was being sent):
    // it comes back only where it was going (that feed, or the same community · mode · cafe · topic board when it
    // was starting a new feed or its feed is gone), with everything that was picked. It stays kept until posted.
    const u = unposted.get(feedState.chatId);
    const fits = (x) => {
        const orig = x.feedId ? getFeed(x.feedId) : null;
        if (orig) return appending && feed.id === orig.id;
        // the board as it was when the post was kept (topic renames since then still apply; a topic made later doesn't)
        return feedMatchesSelection({ platform: x.platform, mode: x.mode, space: x.space ?? '', boardKey: x.boardKey ?? '', createdAt: Number(x.madeAt) || Date.now() });
    };
    // what you were writing in this chat (left for another menu, the panel closed…) comes back first;
    // otherwise a kept post that fits this board
    const cur = composeDrafts.get(feedState.chatId) ?? null;
    const curKept = cur?.unpostedId ? findUnposted(feedState.chatId, cur.unpostedId) : null;
    const d = cur ? curKept : (u?.posts.find(fits) ?? null);
    const fill = cur ?? d;
    const elsewhere = (u?.posts ?? []).filter(x => x !== d);
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">글쓰기 · <b>${esc(p.label)}</b> · ${esc(MODES[selMode].label)}</span>`;
    // one id per piece of writing: an AI answer only goes back into the very form it was asked from
    const formId = cur?.formId || `f${Date.now().toString(36)}${randomId(5)}`;
    el.innerHTML = `<div class="stcm-compose-view" data-chat="${esc(feedState.chatId ?? '')}" data-fid="${esc(formId)}"${d ? ` data-draft="${esc(d.id)}"` : ''}>
        ${d ? `<p class="stcm-cp-hint stcm-unposted-hint">올리지 못했던 글을 다시 채웠어요. 올리면 보관 목록에서 빠져요 · <a class="stcm-link" data-act="unposted-drop" data-draft="${esc(d.id)}">보관 목록에서 버리기</a></p>` : ''}
        <p class="stcm-cp-hint">${appending
            ? `지금 보고 있는 <b>${esc(feed.data.board || p.label)}</b> 피드에 글이 올라가요.`
            : '선택한 커뮤니티에 새 피드를 만들고 글을 올려요. (위에서 모드·커뮤니티를 바꿀 수 있어요)'}</p>
        ${identityControls(fill?.identity)}
        ${appending || currentSpace(selPlatform) ? '' : `<input class="stcm-cp-board" type="text" placeholder="게시판 / 갤러리 / 서브레딧 / 해시태그 이름 (선택)">`}
        ${p.hasTitle || p.chat ? `<input class="stcm-cp-title" type="text" placeholder="${p.chat ? '채널 이름 (예: 잡담) — 새 채널이 생기고 첫 메시지가 올라가요' : (p.thread ? '스레드 제목' : '제목')}">` : ''}
        ${TD_SKINS[selPlatform] ? `<select class="stcm-cp-cat">${tdCats(selPlatform).filter(c => c !== '전체').map(c => `<option value="${esc(c)}" ${feed && tdState(feed.id).cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
        <textarea class="stcm-cp-body" rows="7" placeholder="${p.thread ? '>>1 본문' : '본문'}"></textarea>
        <div class="stcm-cp-medialist"></div>
        <div class="stcm-cp-ai">
            <input class="stcm-cp-inst" type="text" maxlength="500" placeholder="AI에게 지시 (선택) — 비우면 고른 글 주제에 맞게">
            <button data-act="ai-write-post" title="고른 신분으로 AI가 제목과 본문을 써 줘요. 본문 칸에 글이 있으면 그걸 다듬어요."><i class="fa-solid fa-wand-magic-sparkles"></i> AI로 쓰기</button>
        </div>
        <div class="stcm-cp-foot">
            <button data-act="cp-photo" class="stcm-cp-photo" title="글에 사진 한 장 더 붙이기 (사진 대신 묘사가 들어가요)"><i class="fa-regular fa-image"></i> 사진</button>
            <button data-act="cp-video" class="stcm-cp-photo" title="글에 영상 하나 더 붙이기 (영상 대신 묘사가 들어가요)"><i class="fa-solid fa-film"></i> 영상</button>
            <label class="stcm-cp-check"><input type="checkbox" class="stcm-cp-react" checked> 올리고 바로 반응 생성</label>
            <button data-act="cancel-post">취소</button>
            <button class="primary" data-act="submit-post"><i class="fa-solid fa-paper-plane"></i> 올리기</button>
        </div>
    </div>`;
    el.scrollTop = 0;
    const form = el.querySelector('.stcm-compose-view');
    if (fill) {
        const t = el.querySelector('.stcm-cp-title');
        if (t) t.value = fill.title ?? '';
        el.querySelector('.stcm-cp-body').value = fill.body ?? '';
        const b = el.querySelector('.stcm-cp-board');
        if (b) b.value = fill.board ?? '';
        const cat = el.querySelector('.stcm-cp-cat');
        if (cat && fill.category && [...cat.options].some(o => o.value === fill.category)) cat.value = fill.category;
        el.querySelector('.stcm-cp-react').checked = fill.react !== false;
        el.querySelector('.stcm-cp-inst').value = fill.inst ?? '';
        // rows not filled in yet come back too (an AI description may still be on its way to them)
        for (const m of (Array.isArray(fill.media) ? fill.media : cleanMedia(fill))) addMediaRow(el, m.type, m.desc ?? '', m.mid);
    }
    // every change is kept: in this chat's write-form memory, and in the kept record it came from (if any)
    const sync = () => { syncComposeDraft(form); saveComposeForm(form); };
    form.addEventListener('input', sync);
    form.addEventListener('change', sync);
    form.addEventListener('click', () => setTimeout(sync));
    if (cur) {
        if (elsewhere.length) toastr.info(`쓰던 글을 그대로 채워 뒀어요. (이 채팅에 올리지 못한 글 ${elsewhere.length}개가 더 있어요)`, '', { timeOut: 3500 });
    } else if (d) {
        saveComposeForm(form);
        toastr.info(`올리지 못했던 글을 다시 채워 뒀어요.${elsewhere.length ? ` (못 올린 글 ${elsewhere.length}개가 더 있어요)` : ''}`, '', { timeOut: 3500 });
    } else if (elsewhere.length) {
        const names = [...new Set(elsewhere.map(draftWhere))].join(', ');
        const x = elsewhere[0];
        toastr.info(`이 채팅에 올리지 못한 글이 있어요: ${esc(names)}. 그곳을 골라 글쓰기를 열면 다시 채워져요. (눌러서 전체 복사)`, '', { timeOut: 8000, onclick: () => copyText(draftText(x)) });
    }
    el.querySelector(p.hasTitle ? '.stcm-cp-title' : '.stcm-cp-body')?.focus();
}

function showHistory() {
    leaveFeed();
    view = 'history';
    const store = hasChat() ? getChatStore() : null;
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">지난 피드 (이 채팅)</span>
        <button data-act="feed-export" title="이 채팅의 피드를 파일로 내보내기"><i class="fa-solid fa-file-export"></i> 내보내기</button>
        <button data-act="feed-import" title="피드 파일 불러오기"><i class="fa-solid fa-file-import"></i> 불러오기</button>`;
    const feeds = [...(store?.feeds ?? [])].reverse();
    const pi = pendingImport;
    const importPanel = pi ? `<div class="stcm-import">
        <div><i class="fa-solid fa-file-import"></i> <b>${esc(pi.fileName)}</b> — 피드 ${pi.feeds.length}개${pi.pins.length ? `, 반영 ${pi.pins.length}개` : ''}${pi.chat ? ` <small>(원래 채팅: ${esc(pi.chat)})</small>` : ''}</div>
        ${pi.pins.length ? '<label class="stcm-cp-check"><input type="checkbox" id="stcm_import_pins" checked> 📌 반영 목록도 불러오기</label>' : ''}
        ${pi.cutItems || pi.cutFeeds ? `<div class="stcm-cp-hint">⚠️ 파일이 너무 커서 ${pi.cutFeeds ? `피드 ${pi.cutFeeds}개` : ''}${pi.cutFeeds && pi.cutItems ? ', ' : ''}${pi.cutItems ? `글·댓글 ${pi.cutItems}개` : ''}는 빼고 불러와요.</div>` : ''}
        ${pi.spaces?.length ? `<label class="stcm-cp-check"><input type="checkbox" id="stcm_import_spaces" checked> 카페·갤러리 ${pi.spaces.length}개도 불러오기 <small>(${esc(truncate(pi.spaces.map(sp => sp.name).join(', '), 60))} — 이미 있는 건 그대로 써요)</small></label>` : ''}
        <div class="stcm-cp-foot">
            <button data-act="import-cancel">취소</button>
            <button data-act="import-replace" title="지금 피드를 지우고 파일 내용으로 바꿔요">바꾸기</button>
            <button class="primary" data-act="import-merge" title="지금 피드에 더해요">합치기</button>
        </div>
    </div>` : '';
    if (!feeds.length) { el.innerHTML = importPanel + `<div class="stcm-empty">저장된 피드가 없어요.</div>`; return; }
    el.innerHTML = importPanel + `<div class="stcm-list">${feeds.map(f => `
        <div class="stcm-li">
            <div class="stcm-li-main" data-open-feed="${esc(f.id)}">
                <b>${esc(PLATFORMS[f.platform]?.label)}</b>${feedSpace(f) ? ` › ${esc(spaceById(feedSpace(f))?.name ?? `(지운 ${spaceUnit(f.platform)})`)}` : ''} · ${esc(MODES[f.mode]?.label)} · #${f.atMessage} · 글 ${f.data.posts.length}개${f.topics?.length ? ` · ${esc(f.topics.join(', '))}` : ''}
                <small>${esc(new Date(f.createdAt).toLocaleString())} — ${esc(truncate(f.data.posts.map(p => p.title || p.body).join(' / '), 80))}</small>
            </div>
            <button data-del-feed="${esc(f.id)}" title="삭제"><i class="fa-solid fa-trash-can"></i></button>
        </div>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Export / import of this chat's feed file
// ---------------------------------------------------------------------------
const EXPORT_FORMAT = 'st-community-feed';
let pendingImport = null;   // { feeds, pins, fileName }

function safeFileName(str) {
    return String(str ?? 'chat').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'chat';
}

function exportFeeds() {
    const store = getChatStore();
    const feeds = store?.feeds ?? [];
    if (!feeds.length) { toastr.info('내보낼 피드가 없어요.'); return; }
    const payload = {
        format: EXPORT_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        chat: ctx().getCurrentChatId?.() ?? '',
        feeds,
        pins: store.pins ?? [],
        // the cafes / galleries these feeds were made in, so another install can rebuild them
        spaces: customSpaces().filter(sp => feeds.some(f => feedSpace(f) === sp.id))
            .map(sp => ({ id: sp.id, platform: sp.platform, name: sp.name, desc: sp.desc, locale: sp.locale })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `community-feed_${safeFileName(payload.chat)}_${stamp}.json`;
    (document.getElementById('stcm_overlay') ?? document.body).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toastr.success(`피드 ${feeds.length}개를 내보냈어요.${payload.spaces.length ? ` (카페·갤러리 ${payload.spaces.length}개 포함)` : ''}`);
}

/** A cafe / gallery from an imported file → a safe entry, or null. */
function importSpace(x) {
    if (!x || typeof x !== 'object' || !hasKey(PLATFORMS, x.platform)) return null;
    const id = String(x.id ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
    const name = String(x.name ?? '').replace(/[\n\r]/g, ' ').trim().slice(0, 40);
    if (!id || !name) return null;
    return { id, platform: x.platform, name, desc: typeof x.desc === 'string' ? x.desc.slice(0, 500) : '', locale: cleanLocale(x.locale, true) };
}

/** Add the file's cafes to this install. Same id = already here; same community + name = the same cafe.
 *  Returns old id → id to use. */
function mergeImportedSpaces(list) {
    const s = getSettings();
    const map = new Map();
    let added = 0;
    for (const sp of list) {
        const same = s.customSpaces.find(x => x.id === sp.id && x.platform === sp.platform)
            ?? s.customSpaces.find(x => x.platform === sp.platform && x.name === sp.name);
        if (same) { map.set(sp.id, same.id); continue; }
        // an id taken by a different community's cafe: give this one a fresh id
        const id = s.customSpaces.some(x => x.id === sp.id) ? (ctx().uuidv4 ? ctx().uuidv4() : `${Date.now().toString(36)}${randomId(6)}`) : sp.id;
        s.customSpaces = [...s.customSpaces, { ...sp, id }];
        map.set(sp.id, id);
        added++;
    }
    if (added) saveSettings();
    return { map, added };
}

// Imported files may come from anyone: rebuild every field with known types.
const intOr = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d);

function importItem(o, chatLen = Infinity) {
    const item = normItem(o);
    const media = cleanMedia(o);   // photos / videos on a res or comment you wrote
    if (media.length) item.media = media;
    if (Number.isInteger(o?.at) && o.at >= 0) item.at = Math.min(o.at, Math.max(0, chatLen - 1));
    else if (Number.isInteger(o?.atMax) && o.atMax >= 0) item.atMax = Math.min(o.atMax, Math.max(0, chatLen - 1));
    if (o?.isMe === true) {
        item.isMe = true;
        item.as = ['user', 'char', 'mob'].includes(o.as) ? o.as : 'mob';
        if (item.as === 'char') item.charName = String(o.charName ?? '').slice(0, 100);
    }
    return item;
}

/** Safety limits for imported files. The real limit is the file size (IMPORT_MAX_MB): SillyTavern's server takes
 *  requests up to 500MB, and a saved feed file is sent base64-encoded (about 4/3 bigger). */
const IMPORT_MAX = { feeds: 100000, posts: 1000000, comments: 1000000, replies: 1000000 };
const IMPORT_MAX_MB = 300;

function importFeed(f, chatLen, cut = { n: 0 }) {
    if (!f || typeof f !== 'object' || !hasKey(PLATFORMS, f.platform) || !Array.isArray(f.data?.posts)) return null;
    const take = (arr, max) => {
        const list = Array.isArray(arr) ? arr : [];
        if (list.length > max) cut.n += list.length - max;   // reported to the user before anything is replaced
        return list.slice(0, max);
    };
    const posts = take(f.data.posts, IMPORT_MAX.posts).map((p) => {
        const post = { ...normPost(p), ...importItem(p, chatLen) };
        post.title = String(p?.title ?? '').slice(0, 500);
        post.title_tr = String(p?.title_tr ?? '').slice(0, 500);
        post.comments = take(p?.comments, IMPORT_MAX.comments).map(c => ({
            ...importItem(c, chatLen),
            replies: take(c?.replies, IMPORT_MAX.replies).map(r => importItem(r, chatLen)),
        }));
        if (p?.part != null) post.part = intOr(p.part, 1);
        if (Number.isInteger(p?.batch) && p.batch >= 0) post.batch = Math.min(p.batch, 1e9);
        if (p?.watch === true) post.watch = true;
        if (p?.kind === 'dm' && p.dm && typeof p.dm === 'object') {
            const side = (x) => ({
                as: ['user', 'char', 'mob'].includes(x?.as) ? x.as : 'mob',
                name: String(x?.name ?? '').slice(0, 100),
                charName: String(x?.charName ?? '').slice(0, 100),
                nick: String(x?.nick ?? '').slice(0, 60),
            });
            post.kind = 'dm';
            post.dm = { me: side(p.dm.me), partner: side(p.dm.partner) };
        }
        post.comments.forEach((c, ci) => { const r = p?.comments?.[ci]?.ref; if (Number.isInteger(r) && r >= 0 && r < ci) c.ref = r; });
        if (p?.crossRef === true) post.crossRef = true;
        for (const k of ['prevIdx', 'nextIdx']) if (Number.isInteger(p?.[k])) post[k] = p[k];
        return post;
    });
    for (const p of posts) for (const k of ['prevIdx', 'nextIdx']) if (p[k] != null && (p[k] < 0 || p[k] >= posts.length)) delete p[k];
    return {
        id: String(f.id ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64) || newStoreId(),
        platform: f.platform,
        mode: hasKey(MODES, f.mode) ? f.mode : 'meta',
        topic: String(f.topic ?? '').slice(0, 300),
        topics: Array.isArray(f.topics) ? f.topics.slice(0, 20).map(t => String(t).slice(0, 60)) : [],
        ...(typeof f.lang === 'string' ? { lang: f.lang.replace(/[\n\r<>{}]/g, '').slice(0, 60) } : {}),
        ...(typeof f.boardKey === 'string' ? { boardKey: f.boardKey.slice(0, 600) } : {}),
        ...(typeof f.space === 'string' ? { space: f.space.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64) } : {}),
        createdAt: intOr(f.createdAt, Date.now()),
        ...(Number.isFinite(Number(f.batchAt)) && Number(f.batchAt) > 0 ? { batchAt: Math.floor(Number(f.batchAt)) } : {}),
        // keep it inside this chat so branches made later still carry it
        atMessage: Math.min(intOr(f.atMessage), Math.max(0, chatLen - 1)),
        data: { board: String(f.data.board ?? '').slice(0, 200), posts },
    };
}

/** A pin from a file: it must point at a post that came in with it; the rest is rebuilt from that post. */
function importPin(p, idMap, feedsById) {
    if (!p || typeof p !== 'object') return null;
    const feedId = idMap.get(String(p.feedId));
    const feed = feedId ? feedsById.get(feedId) : null;
    const post = feed && Number.isInteger(p.postIdx) && p.postIdx >= 0 ? feed.data.posts[p.postIdx] : null;
    if (!post) return null;
    return {
        feedId,
        postIdx: p.postIdx,
        platform: feed.platform,
        mode: feed.mode,
        ...(post.kind === 'dm' ? { kind: 'dm' } : {}),
        text: post.kind === 'dm' ? dmToPinText(post) : postToPinText(post),
    };
}

async function readImportFile(file) {
    if (!file) return;
    if (file.size > IMPORT_MAX_MB * 1024 * 1024) { toastr.error(`파일이 너무 커요 (${IMPORT_MAX_MB}MB 이하).`); return; }
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch {
        toastr.error('JSON 파일이 아니에요.');
        return;
    }
    // Accept our export, or a raw stcm-feed-*.json from the server folder
    const feedsIn = Array.isArray(data?.feeds) ? data.feeds : null;
    if (!feedsIn || (data.format && data.format !== EXPORT_FORMAT)) {
        toastr.error('커뮤니티 피드 파일이 아니에요.');
        return;
    }
    const chatLen = ctx().chat?.length ?? 0;
    const cut = { n: 0 };
    const feeds = feedsIn.slice(0, IMPORT_MAX.feeds).map(f => importFeed(f, chatLen, cut)).filter(Boolean);
    const cutFeeds = Math.max(0, feedsIn.length - IMPORT_MAX.feeds);
    if (!feeds.length) { toastr.error('불러올 수 있는 피드가 없어요.'); return; }
    // only cafes some imported feed was made in
    const used = new Set(feeds.map(feedSpace).filter(Boolean));
    const spaces = (Array.isArray(data.spaces) ? data.spaces.slice(0, 100) : []).map(importSpace)
        .filter(sp => sp && used.has(sp.id) && feeds.some(f => f.space === sp.id && f.platform === sp.platform));
    pendingImport = { feeds, pins: Array.isArray(data.pins) ? data.pins : [], spaces, fileName: file.name, chat: String(data.chat ?? ''), cutItems: cut.n, cutFeeds };
    showHistory();
}

async function applyImport(mode, withPins, withSpaces = false) {
    if (!pendingImport || !(await ensureFeedsReady())) return;
    const store = getChatStore();
    const sp = withSpaces && pendingImport.spaces?.length ? mergeImportedSpaces(pendingImport.spaces) : null;
    const idMap = new Map();
    const existing = new Set(mode === 'merge' ? store.feeds.map(f => f.id) : []);
    const incoming = pendingImport.feeds.map((f) => {
        const oldId = f.id;
        let id = oldId;
        while (existing.has(id)) id = newStoreId();
        existing.add(id);
        idMap.set(oldId, id);
        return sp && f.space && sp.map.has(f.space) ? { ...f, id, space: sp.map.get(f.space) } : { ...f, id };
    });
    const byId = new Map(incoming.map(f => [f.id, f]));
    const pinsIn = withPins ? pendingImport.pins : [];
    const pins = pinsIn.map(p => importPin(p, idMap, byId)).filter(Boolean);
    if (pins.length < pinsIn.length) toastr.warning(`반영 목록 중 ${pinsIn.length - pins.length}개는 가리키는 글이 없어서 뺐어요.`);
    if (mode === 'replace') {
        store.feeds = incoming;
        store.pins = pins;
        feedState.gen++;   // the old feed objects are gone: work still waiting on them must not write into them
    } else {
        store.feeds = [...store.feeds, ...incoming].sort((a, b) => a.createdAt - b.createdAt);
        const have = new Set(store.pins.map(p => `${p.feedId}|${p.postIdx}`));
        for (const p of pins) if (!have.has(`${p.feedId}|${p.postIdx}`)) store.pins.push(p);
    }
    const dropped = pruneFeeds(store);
    if (dropped) toastr.warning(`지난 피드 개수 제한(${getSettings().maxFeeds}개) 때문에 오래된 피드 ${dropped}개는 빠졌어요. 반영·지켜보기 중인 피드는 남겨 뒀어요.`);
    const n = incoming.length;
    pendingImport = null;
    currentFeedId = null;
    await saveChatStore();
    refreshInjection();
    toastr.success(`피드 ${n}개를 ${mode === 'replace' ? '바꿔서' : '합쳐서'} 불러왔어요.${sp?.added ? ` 카페·갤러리 ${sp.added}개를 추가했어요.` : ''}`);
    syncSelectors();
    showHistory();
}

// ---------------------------------------------------------------------------
// Connections: SillyTavern connection profiles + APIs added inside this extension
// ---------------------------------------------------------------------------
// Added APIs go through SillyTavern's own server route (/api/backends/chat-completions),
// the same way ST talks to a reverse proxy: the key is sent to the ST server only, never to the page's origin.

/** Is the Connection Manager extension usable? (the service class exists even when the extension is off) */
function connectionManagerOn() {
    const c = ctx();
    if (!c.ConnectionManagerRequestService) return false;
    return !(c.extensionSettings?.disabledExtensions ?? []).includes('connection-manager');
}

/** Profiles the request service can actually use (Chat / Text Completion), sorted by name. */
function connectionProfiles() {
    if (!connectionManagerOn()) return [];
    const svc = ctx().ConnectionManagerRequestService;
    const all = ctx().extensionSettings?.connectionManager?.profiles ?? [];
    const ok = (p) => {
        try { return typeof svc.isProfileSupported === 'function' ? !!svc.isProfileSupported(p) : !!p?.api; }
        catch { return false; }   // unknown API type
    };
    return all.filter(p => p?.id && ok(p)).sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

function customApis() {
    return getSettings().customApis;
}

function normalizeApiUrl(kind, url) {
    let u = String(url ?? '').trim().replace(/\/+$/, '');
    const k = API_KINDS[kind] ?? API_KINDS.openai;
    u = u.replace(k.strip, '').replace(/\/+$/, '');
    return u;
}

function validApiUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
}

function apiHost(url) {
    try { return new URL(url).host; } catch { return String(url ?? ''); }
}

/** What "profileId" points at: '' main API · '<uuid>' an ST profile · 'api:<id>' an API added here. */
function resolveConnection(value = getSettings().profileId) {
    const id = value === 'main' ? '' : (value || '');
    if (!id) return { type: 'main' };
    if (id.startsWith('api:')) return { type: 'api', api: customApis().find(a => a.id === id.slice(4)) ?? null };
    return { type: 'profile', profile: connectionProfiles().find(p => p.id === id) ?? null };
}

function connectionSummary(conn = resolveConnection()) {
    const s = getSettings();
    if (conn.type === 'main') return '지금 실리태번에 연결된 API와 모델을 그대로 써요.';
    if (conn.type === 'api') {
        if (!conn.api) return '고른 API가 지워졌어요. 다른 연결을 골라 주세요.';
        const a = conn.api;
        return `${API_KINDS[a.kind]?.label ?? a.kind} · ${apiWhere(a)} · 모델: ${a.model || '(정해지지 않음)'}`;
    }
    if (!conn.profile) {
        return connectionManagerOn()
            ? '고른 프로필이 없어졌어요. 이대로면 생성이 실패하니 다른 연결을 골라 주세요.'
            : '프로필을 쓰려면 Connection Manager 확장을 켜 주세요. 지금은 다른 연결을 골라야 생성할 수 있어요.';
    }
    const p = conn.profile;
    const override = (s.modelOverrides[p.id] ?? '').trim();
    const bits = [p.api && `API: ${p.api}`, `모델: ${override ? `${override} (따로 지정)` : (p.model || '프로필 기본')}`, p.preset && `프리셋: ${p.preset}`].filter(Boolean);
    return bits.join(' · ');
}

/** <option>s for every place that picks the connection (panel + extension settings). */
function connOptionsHtml() {
    const s = getSettings();
    const cur = s.profileId || '';
    const conn = resolveConnection();
    const profiles = connectionProfiles();
    const apis = customApis();
    let missing = '';
    if (conn.type === 'api' && !conn.api) missing = '(지워진 API — 다시 골라 주세요)';
    if (conn.type === 'profile' && !conn.profile) missing = connectionManagerOn() ? '(지워진 프로필 — 다시 골라 주세요)' : '(Connection Manager 꺼짐 — 생성 불가)';
    return `<option value="">(메인 API 사용)</option>
        ${missing ? `<option value="${esc(cur)}" selected>${missing}</option>` : ''}
        ${apis.length ? `<optgroup label="직접 추가한 API">${apis.map(a => `<option value="api:${esc(a.id)}" ${cur === `api:${a.id}` ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>` : ''}
        ${profiles.length ? `<optgroup label="실리태번 연결 프로필">${profiles.map(p => `<option value="${esc(p.id)}" ${cur === p.id ? 'selected' : ''}>${esc(p.name || p.id)}</option>`).join('')}</optgroup>` : ''}`;
}

/** <option>s for the translation connection ('' = in the same generation call). */
function trConnOptionsHtml() {
    const cur = getSettings().translateConn || '';
    const profiles = connectionProfiles();
    const apis = customApis();
    const known = cur === '' || cur === 'main' || apis.some(a => `api:${a.id}` === cur) || profiles.some(p => p.id === cur);
    return `<option value="" ${cur === '' ? 'selected' : ''}>(따로 안 함 — 글 만들 때 같이 번역)</option>
        <option value="main" ${cur === 'main' ? 'selected' : ''}>(메인 API로 따로 번역)</option>
        ${known ? '' : `<option value="${esc(cur)}" selected>(지워진 연결 — 다시 골라 주세요)</option>`}
        ${apis.length ? `<optgroup label="직접 추가한 API">${apis.map(a => `<option value="api:${esc(a.id)}" ${cur === `api:${a.id}` ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>` : ''}
        ${profiles.length ? `<optgroup label="실리태번 연결 프로필">${profiles.map(p => `<option value="${esc(p.id)}" ${cur === p.id ? 'selected' : ''}>${esc(p.name || p.id)}</option>`).join('')}</optgroup>` : ''}`;
}

function setTranslateConnection(value) {
    const s = getSettings();
    if (s.translateConn !== String(value ?? '')) s.translateModel = '';
    s.translateConn = String(value ?? '');
    saveSettings();
    if (!resolvedTranslation() && value) toastr.info('번역할 언어를 먼저 골라야 자동 번역이 돼요 (⚙ 설정 → 번역 언어).', '', { timeOut: 3000 });
}

/** Re-fill the extension settings dropdown (and the panel's API view when it is open and idle). */
function refreshConnSelectors() {
    const sel = document.getElementById('stcm_set_profile');
    if (sel) sel.innerHTML = connOptionsHtml();
    if (view === 'api' && isOpen() && !apiTesting && !apiEdit) showApi({ keepScroll: true });
}

function setConnection(value) {
    const s = getSettings();
    s.profileId = String(value ?? '');
    saveSettings();
    refreshConnSelectors();
}

// ---- requests -------------------------------------------------------------
function apiErrorText(json) {
    const e = json?.error;
    if (!e) return '';
    if (typeof e === 'string') return e;
    if (e === true) return typeof json?.message === 'string' ? json.message : '요청 실패 — 주소와 키를 확인해 주세요';
    return e.message || e.error?.message || JSON.stringify(e).slice(0, 200);
}

function replyText(json) {
    const ch = json?.choices?.[0];
    let out = ch?.message?.content ?? ch?.text;
    if (out == null && Array.isArray(json?.content)) out = json.content;
    if (Array.isArray(out)) out = out.map(x => (typeof x === 'string' ? x : x?.text ?? '')).join('');
    return typeof out === 'string' ? out : null;
}

async function postBackend(path, body, signal) {
    const res = await fetch(path, { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body), signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const err = apiErrorText(json);
    if (!res.ok || err) throw new Error(truncate(err || (text && !json ? text : `HTTP ${res.status}`), 300));
    return json;
}

async function callCustomApi(api, system, user, signal, extra = {}, tail = null) {
    const kind = API_KINDS[api.kind] ?? API_KINDS.openai;
    if (!String(api.model ?? '').trim()) throw new Error(`"${api.name}"에 모델이 정해지지 않았어요. 커뮤니티 창의 API 설정에서 모델을 적어 주세요.`);
    const body = {
        chat_completion_source: kind.source,
        reverse_proxy: api.url,
        proxy_password: api.key || '',
        model: String(api.model).trim(),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }, ...(tail ? [tail] : [])],
        max_tokens: Number(getSettings().maxTokens) || 4000,
        stream: false,
        ...extra,
    };
    if (api.kind === 'claude') body.use_sysprompt = true;
    if (api.kind === 'google' || api.kind === 'vertex') body.use_makersuite_sysprompt = true;
    if (api.kind === 'vertex') {
        body.vertexai_auth_mode = api.vxMode === 'full' ? 'full' : 'express';
        body.vertexai_region = api.vxRegion || 'us-central1';
        if (api.vxProject) body.vertexai_express_project_id = api.vxProject;
        if (!vertexUsesProxy(api)) { delete body.reverse_proxy; delete body.proxy_password; }   // ST's stored key / account
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let json;
    try {
        json = await postBackend('/api/backends/chat-completions/generate', body, signal);
    } catch (e) {
        if (e?.name === 'AbortError') throw e;
        const msg = String(e?.message ?? e);
        // ST's Vertex errors are in English and name the missing secret; say where to put it
        const hint = api.kind === 'vertex' && !vertexUsesProxy(api) && /key is required|Service Account|not found|credentials|401|403/i.test(msg)
            ? ' — 실리태번 API 연결 화면(Chat Completion → Google Vertex AI)에 Vertex 키나 서비스 계정 JSON을 저장했는지, 인증 방식이 맞는지 확인해 주세요.'
            : '';
        throw new Error(`${api.name}: ${msg}${hint}`);
    }
    const out = replyText(json);
    if (out == null) throw new Error(`${api.name}: 응답에서 글을 찾지 못했어요.`);
    return out;
}

function modelIds(json) {
    const arr = Array.isArray(json) ? json : (json?.data ?? json?.models ?? []);
    const ids = (Array.isArray(arr) ? arr : [])
        .map(m => (typeof m === 'string' ? m : (m?.id ?? m?.name ?? '')))
        .map(x => String(x).replace(/^models\//, '').trim())
        .filter(Boolean);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 500);
}

/** Model list of an added API (or of the form being edited). */
async function listApiModels({ kind, url, key }) {
    if (kind === 'vertex') return [...VERTEX_MODELS];   // SillyTavern can't list Vertex models
    const k = API_KINDS[kind] ?? API_KINDS.openai;
    const json = await postBackend('/api/backends/chat-completions/status', { chat_completion_source: k.source, reverse_proxy: url, proxy_password: key || '' });
    return modelIds(json);
}

/** Is the profile's Chat Completion preset made for the same API as the profile? (no preset → nothing to merge) */
function presetFitsProfile(profile) {
    try {
        const source = ctx().CONNECT_API_MAP?.[profile?.api]?.source;
        if (!profile?.preset || !source) return true;
        const preset = ctx().getPresetManager?.('openai')?.getCompletionPresetByName?.(profile.preset);
        if (!preset) return true;   // ST skips a missing preset by itself
        const presetSource = preset.chat_completion_source ?? ctx().chatCompletionSettings?.chat_completion_source;
        return !presetSource || presetSource === source;
    } catch {
        return true;
    }
}

/** Vertex AI profile → the sign-in fields SillyTavern's server needs (it defaults to express mode without them).
 *  They come from SillyTavern's own Vertex settings (API connection screen); the region from the profile first. */
function vertexProfileFields(profile) {
    if (ctx().CONNECT_API_MAP?.[profile?.api]?.source !== 'vertexai') return null;
    const cc = ctx().chatCompletionSettings ?? {};
    return {
        vertexai_auth_mode: ['express', 'full'].includes(cc.vertexai_auth_mode) ? cc.vertexai_auth_mode : 'express',
        vertexai_region: String(profile['api-url'] || cc.vertexai_region || 'us-central1').trim(),
        vertexai_express_project_id: String(cc.vertexai_express_project_id ?? '').trim(),
    };
}

/** Model list for an ST connection profile (Chat Completion profiles without a proxy preset only). */
async function listProfileModels(profile) {
    const map = ctx().CONNECT_API_MAP?.[profile.api];
    if (!map || map.selected !== 'openai' || !map.source) throw new Error('이 프로필은 목록을 불러올 수 없어요. 모델 이름을 직접 적어 주세요.');
    if (map.source === 'vertexai') return [...VERTEX_MODELS];   // SillyTavern can't list Vertex models
    if (profile.proxy && profile.proxy !== 'None') throw new Error('프록시를 쓰는 프로필이라 목록을 불러올 수 없어요. 모델 이름을 직접 적어 주세요.');
    const body = { chat_completion_source: map.source };
    if (profile['api-url']) body.custom_url = profile['api-url'];
    if (profile['secret-id']) body.secret_id = profile['secret-id'];
    return modelIds(await postBackend('/api/backends/chat-completions/status', body));
}

// ---- API view ---------------------------------------------------------------
let apiTesting = false;
let apiEdit = null;                // null | { id } ('' = new)
const apiModelCache = new Map();   // key → model ids loaded with "목록 불러오기"

/**
 * A real dropdown of the loaded models (a <datalist> filters by the text already typed,
 * so with a model name in the box it looks empty — and it barely works on phones).
 */
function modelPickerHtml(cls, key, current) {
    const ids = apiModelCache.get(key) ?? [];
    if (!ids.length) return `<div class="stcm-modelpick" data-key="${esc(key)}"></div>`;
    const cur = String(current ?? '');
    return `<div class="stcm-modelpick" data-key="${esc(key)}">
        <select class="${cls}">
            <option value="">▼ 불러온 모델에서 고르기 (${ids.length}개)</option>
            ${ids.map(m => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('')}
        </select>
    </div>`;
}

function fillModelPicker(box, cls, key, current) {
    const holder = box?.querySelector(`.stcm-modelpick[data-key="${CSS.escape(key)}"]`) ?? box?.querySelector('.stcm-modelpick');
    if (!holder) return;
    holder.outerHTML = modelPickerHtml(cls, key, current);
    box.querySelector(`.${cls}`)?.focus({ preventScroll: true });
}

function apiFormHtml() {
    const a = apiEdit?.id ? customApis().find(x => x.id === apiEdit.id) : null;
    const kind = a?.kind ?? 'openai';
    return `<div class="stcm-api-form" data-id="${esc(a?.id ?? '')}">
        <label class="stcm-cp-check">${a ? 'API 수정' : '새 API 추가'}</label>
        <input class="stcm-af-name" type="text" maxlength="40" placeholder="이름 (예: 내 프록시, OpenAI)" value="${esc(a?.name ?? '')}">
        <select class="stcm-af-kind">${Object.entries(API_KINDS).map(([k, v]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <p class="stcm-cp-hint stcm-af-kindhint">${esc(API_KINDS[kind].hint)}</p>
        <div class="stcm-af-vertex ${kind === 'vertex' ? '' : 'stcm-hide'}">
            <select class="stcm-af-vxmode">${Object.entries(VERTEX_MODES).map(([k, v]) => `<option value="${k}" ${k === (a?.vxMode ?? 'express') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
            <div class="stcm-cp-row">
                <input class="stcm-af-vxregion" type="text" maxlength="40" placeholder="리전 (기본 us-central1, global도 돼요)" value="${esc(a?.vxRegion ?? '')}">
                <input class="stcm-af-vxproject" type="text" maxlength="64" placeholder="프로젝트 ID (Express, 선택)" value="${esc(a?.vxProject ?? '')}">
            </div>
        </div>
        <input class="stcm-af-url" type="url" maxlength="500" placeholder="${esc(API_KINDS[kind].example)}" value="${esc(a?.url ?? '')}">
        <div class="stcm-cp-row">
            <input class="stcm-af-key" type="password" autocomplete="off" maxlength="500" placeholder="API 키 / 프록시 비밀번호 (없으면 비워 두기)" value="${esc(a?.key ?? '')}">
            <button data-act="af-eye" title="키 보기/숨기기"><i class="fa-solid fa-eye"></i></button>
        </div>
        <div class="stcm-cp-row">
            <input class="stcm-af-model" type="text" maxlength="200" placeholder="모델 이름 (예: gpt-4o-mini)" value="${esc(a?.model ?? '')}">
            <button data-act="af-models"><i class="fa-solid fa-list"></i> 목록 불러오기</button>
        </div>
        ${modelPickerHtml('stcm-af-modelsel', a ? `api:${a.id}` : 'form', a?.model)}
        <p class="stcm-cp-hint">키는 실리태번 설정 파일(settings.json)에 저장되고, 요청은 실리태번 서버를 거쳐 그 주소로 가요. 실리태번이 리버스 프록시 비밀번호를 저장하는 방식과 같아요. 설정 파일을 다른 사람과 공유하지 마세요.</p>
        <div class="stcm-cp-foot">
            <span class="stcm-af-result"></span>
            <button data-act="af-test"><i class="fa-solid fa-plug-circle-check"></i> 테스트</button>
            <button data-act="af-cancel">취소</button>
            <button class="primary" data-act="af-save"><i class="fa-solid fa-floppy-disk"></i> 저장</button>
        </div>
    </div>`;
}

/** Default model of the translation connection (what an empty model box means). */
function trDefaultModel(conn) {
    if (conn.type === 'api') return conn.api?.model || '';
    if (conn.type === 'profile') return String(getSettings().modelOverrides[conn.profile?.id] ?? '').trim() || conn.profile?.model || '';
    return '';
}

/** Model box + "목록 불러오기" for the translation connection (profiles and added APIs only). */
function trModelRow() {
    const s = getSettings();
    if (!s.translateConn || s.translateConn === 'main') return '';
    const conn = resolveConnection(s.translateConn);
    if ((conn.type === 'api' && !conn.api) || (conn.type === 'profile' && !conn.profile)) return '';
    const key = conn.type === 'api' ? `api:${conn.api.id}` : `p:${conn.profile.id}`;
    const def = trDefaultModel(conn);
    return `<label class="stcm-cp-check">번역 모델 <small>비워 두면 ${def ? `그 연결의 모델 (${esc(def)})` : '그 연결의 기본 모델'}을 써요</small></label>
        <div class="stcm-cp-row">
            <input class="stcm-api-trmodel" type="text" maxlength="200" placeholder="${esc(def || '모델 이름')}" value="${esc(s.translateModel ?? '')}">
            <button data-act="api-trmodels"><i class="fa-solid fa-list"></i> 목록 불러오기</button>
        </div>${modelPickerHtml('stcm-api-trmodelsel', key, s.translateModel || def)}`;
}

function showApi({ keepScroll = false } = {}) {
    const el = document.getElementById('stcm_feed');
    const top = el.scrollTop;
    leaveFeed();
    view = 'api';
    document.getElementById('stcm_errbox')?.classList.remove('show');
    const s = getSettings();
    const conn = resolveConnection();
    const bar = document.getElementById('stcm_feedbar');
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">API 설정</span>`;
    syncSelectors();

    let modelRow = '';
    if (conn.type === 'profile' && conn.profile) {
        const p = conn.profile;
        modelRow = `<label class="stcm-cp-check">모델 <small>비워 두면 프로필 모델${p.model ? ` (${esc(p.model)})` : ''}을 써요</small></label>
            <div class="stcm-cp-row">
                <input class="stcm-api-model" type="text" maxlength="200" placeholder="${esc(p.model || '프로필 기본 모델')}" value="${esc(s.modelOverrides[p.id] ?? '')}">
                <button data-act="api-models"><i class="fa-solid fa-list"></i> 목록 불러오기</button>
            </div>${modelPickerHtml('stcm-api-modelsel', `p:${p.id}`, s.modelOverrides[p.id])}`;
    } else if (conn.type === 'api' && conn.api) {
        const a = conn.api;
        modelRow = `<label class="stcm-cp-check">모델</label>
            <div class="stcm-cp-row">
                <input class="stcm-api-model" type="text" maxlength="200" placeholder="모델 이름 (꼭 적어 주세요)" value="${esc(a.model ?? '')}">
                <button data-act="api-models"><i class="fa-solid fa-list"></i> 목록 불러오기</button>
            </div>${modelPickerHtml('stcm-api-modelsel', `api:${a.id}`, a.model)}`;
    }
    const cmNote = !connectionManagerOn()
        ? '<p class="stcm-cp-hint">Connection Manager 확장이 꺼져 있어서 실리태번 연결 프로필은 쓸 수 없어요. 아래에서 API를 직접 추가할 수는 있어요.</p>'
        : '';
    const list = customApis().map(a => `
        <div class="stcm-li">
            <div class="stcm-li-main"><b>${esc(a.name)}</b>${s.profileId === `api:${a.id}` ? ' <span class="stcm-api-using">사용 중</span>' : ''}
                <small>${esc(API_KINDS[a.kind]?.label ?? a.kind)} · ${esc(apiWhere(a))} · ${esc(a.model || '모델 없음')}${a.key ? ' · 키 있음' : (a.kind === 'vertex' && !vertexUsesProxy(a) ? ' · 실리태번 저장 키' : '')}</small></div>
            <button data-act="api-use" data-api="${esc(a.id)}" title="이 API로 생성"><i class="fa-solid fa-check"></i></button>
            <button data-act="api-edit" data-api="${esc(a.id)}" title="수정"><i class="fa-solid fa-pen"></i></button>
            <button data-act="api-del" data-api="${esc(a.id)}" title="삭제"><i class="fa-solid fa-trash-can"></i></button>
        </div>`).join('');

    el.innerHTML = `<div class="stcm-compose-view stcm-api-view">
        <label class="stcm-cp-check">커뮤니티 생성에 쓸 연결</label>
        <select class="stcm-api-conn">${connOptionsHtml()}</select>
        <p class="stcm-cp-hint stcm-api-info">${esc(connectionSummary(conn))}</p>
        ${cmNote}
        ${modelRow}
        <label class="stcm-cp-check">최대 응답 토큰</label>
        <input class="stcm-api-tokens" type="number" min="500" max="32000" step="100" value="${Number(s.maxTokens) || 4000}">
        <p class="stcm-cp-hint">글이 중간에 끊기면 늘려 주세요. 본 채팅의 API 연결은 바뀌지 않고, 여기서 고른 연결은 커뮤니티 생성에만 쓰여요.</p>
        <div class="stcm-cp-foot">
            <span class="stcm-api-result"></span>
            <button data-act="api-test" ${apiTesting ? 'disabled' : ''}><i class="fa-solid fa-plug-circle-check"></i> 연결 테스트</button>
        </div>
    </div>
    <div class="stcm-compose-view stcm-api-view">
        <label class="stcm-cp-check">번역에 쓸 연결</label>
        <select class="stcm-api-trconn">${trConnOptionsHtml()}</select>
        ${trModelRow()}
        <p class="stcm-cp-hint">${resolvedTranslation()
            ? `번역 언어: <b>${esc(resolvedTranslation())}</b>. 따로 고르면 글을 먼저 만들고, 그 연결이 뒤이어 번역해요 (생성 프롬프트가 짧아지고, 번역은 싼 모델에 맡길 수 있어요).`
            : '번역 언어가 정해지지 않았어요. ⚙ 설정의 "번역 언어"에서 고르면 자동 번역이 켜져요. (글의 번역 버튼은 언어를 안 골라도 한국어로 번역해요)'}</p>
        <div class="stcm-cp-foot"><span class="stcm-api-trresult"></span>${getSettings().translateConn ? '<button data-act="api-trtest"><i class="fa-solid fa-plug-circle-check"></i> 번역 테스트</button>' : ''}</div>
    </div>
    <div class="stcm-compose-view stcm-api-view stcm-api-custom">
        <label class="stcm-cp-check">직접 추가한 API</label>
        <p class="stcm-cp-hint">실리태번 API 설정과 따로, 커뮤니티에서만 쓸 API를 추가할 수 있어요. OpenAI 호환 주소, 리버스 프록시, Claude·Gemini 프록시를 지원해요.</p>
        ${list ? `<div class="stcm-list">${list}</div>` : ''}
        ${apiEdit ? apiFormHtml() : '<button class="stcm-api-add" data-act="api-add"><i class="fa-solid fa-plus"></i> API 추가</button>'}
    </div>`;
    syncApiFormFields(el.querySelector('.stcm-api-form'));
    el.scrollTop = keepScroll ? top : 0;
}

/** Show the fields the chosen format needs (Vertex without a proxy has no address / key). */
function syncApiFormFields(form) {
    if (!form) return;
    const kind = form.querySelector('.stcm-af-kind')?.value;
    const k = API_KINDS[kind] ?? API_KINDS.openai;
    const vx = kind === 'vertex';
    const proxy = !vx || form.querySelector('.stcm-af-vxmode')?.value === 'proxy';
    form.querySelector('.stcm-af-kindhint').textContent = k.hint;
    form.querySelector('.stcm-af-url').placeholder = vx ? 'Vertex 리버스 프록시 주소 (실리태번 프록시 칸에 넣는 주소 그대로)' : k.example;
    form.querySelector('.stcm-af-vertex')?.classList.toggle('stcm-hide', !vx);
    form.querySelector('.stcm-af-url')?.classList.toggle('stcm-hide', !proxy);
    form.querySelector('.stcm-af-key')?.closest('.stcm-cp-row')?.classList.toggle('stcm-hide', !proxy);
    const model = form.querySelector('.stcm-af-model');
    if (model) model.placeholder = vx ? '모델 이름 (예: gemini-2.5-flash)' : '모델 이름 (예: gpt-4o-mini)';
}

function readApiForm(box) {
    const kind = API_KINDS[box.querySelector('.stcm-af-kind').value] ? box.querySelector('.stcm-af-kind').value : 'openai';
    const url = normalizeApiUrl(kind, box.querySelector('.stcm-af-url').value);
    const key = box.querySelector('.stcm-af-key').value.trim();
    const model = box.querySelector('.stcm-af-model').value.trim();
    const out = { id: box.dataset.id || '', kind, url, key, model };
    if (kind === 'vertex') {
        const mode = box.querySelector('.stcm-af-vxmode')?.value;
        out.vxMode = VERTEX_MODES[mode] ? mode : 'express';
        const region = (box.querySelector('.stcm-af-vxregion')?.value ?? '').trim().toLowerCase();
        out.vxRegion = /^[a-z0-9-]{2,40}$/.test(region) ? region : 'us-central1';
        out.vxProject = (box.querySelector('.stcm-af-vxproject')?.value ?? '').trim().replace(/[^a-z0-9-]/gi, '').slice(0, 64);
        if (out.vxMode !== 'proxy') { out.url = ''; out.key = ''; }   // never keep a key we don't use
    }
    const name = box.querySelector('.stcm-af-name').value.trim() || (kind === 'vertex' ? 'Vertex AI' : apiHost(url)) || 'API';
    out.name = name.slice(0, 40);
    return out;
}

function setNote(el, text, ok = null) {
    if (!el || !document.body.contains(el)) { if (text && ok !== null) (ok ? toastr.success : toastr.error)(esc(text)); return; }
    el.className = el.className.replace(/\s*\b(ok|bad)\b/g, '');
    if (ok === true) el.classList.add('ok');
    if (ok === false) el.classList.add('bad');
    el.textContent = text;
}

/** Click actions inside the API view. Returns true when handled. */
async function onApiClick(act, el) {
    const s = getSettings();
    if (act === 'api-test') { await testApi(el); return true; }
    if (act === 'api-add') { apiEdit = { id: '' }; apiModelCache.delete('form'); showApi({ keepScroll: true }); document.querySelector('#stcm_feed .stcm-af-name')?.focus({ preventScroll: true }); return true; }
    if (act === 'api-edit') { apiEdit = { id: el.dataset.api }; showApi({ keepScroll: true }); return true; }
    if (act === 'af-cancel') { apiEdit = null; showApi({ keepScroll: true }); return true; }
    if (act === 'api-use') { setConnection(`api:${el.dataset.api}`); showApi({ keepScroll: true }); return true; }
    if (act === 'api-del') {
        const a = customApis().find(x => x.id === el.dataset.api);
        if (!a) return true;
        const { Popup, POPUP_RESULT } = ctx();
        const ok = Popup?.show?.confirm
            ? (await Popup.show.confirm('API 삭제', `"${esc(a.name)}"을(를) 지울까요? 저장된 키도 함께 지워져요.`)) === POPUP_RESULT.AFFIRMATIVE
            : confirm('지울까요?');
        if (!ok) return true;
        s.customApis = s.customApis.filter(x => x.id !== a.id);
        apiModelCache.delete(`api:${a.id}`);
        if (s.profileId === `api:${a.id}`) s.profileId = '';
        if (s.translateConn === `api:${a.id}`) { s.translateConn = ''; s.translateModel = ''; }   // back to translating in the same call
        if (apiEdit?.id === a.id) apiEdit = null;
        saveSettings();
        refreshConnSelectors();
        showApi({ keepScroll: true });
        return true;
    }
    if (act === 'af-eye') {
        const k = el.closest('.stcm-api-form')?.querySelector('.stcm-af-key');
        if (k) k.type = k.type === 'password' ? 'text' : 'password';
        return true;
    }
    if (act === 'af-models' || act === 'af-test' || act === 'af-save') {
        const box = el.closest('.stcm-api-form');
        const note = box.querySelector('.stcm-af-result');
        const f = readApiForm(box);
        const needsUrl = f.kind !== 'vertex' || f.vxMode === 'proxy';
        if (needsUrl && !validApiUrl(f.url)) { setNote(note, '주소를 http:// 또는 https:// 로 시작하게 적어 주세요.', false); return true; }
        if (act === 'af-models') {
            el.disabled = true;
            setNote(note, '목록 불러오는 중…');
            try {
                const ids = await listApiModels(f);
                apiModelCache.set(f.id ? `api:${f.id}` : 'form', ids);
                fillModelPicker(box, 'stcm-af-modelsel', f.id ? `api:${f.id}` : 'form', f.model);
                setNote(note, ids.length ? `모델 ${ids.length}개 — 아래 목록에서 고르세요.` : '목록이 비어 있어요. 모델 이름을 직접 적어 주세요.', ids.length > 0);
            } catch (e) {
                setNote(note, `목록을 못 불러왔어요: ${truncate(String(e?.message ?? e), 120)} (모델 이름은 직접 적어도 돼요)`, false);
            } finally { el.disabled = false; }
            return true;
        }
        if (!f.model) { setNote(note, '모델 이름을 적어 주세요.', false); return true; }
        if (act === 'af-test') {
            el.disabled = true;
            setNote(note, '확인 중…');
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 60000);
            try {
                const reply = await callCustomApi(f, 'This is a connection test.', 'Reply with exactly: OK', ctl.signal);
                setNote(note, reply.trim() ? `응답 받음: ${truncate(reply.trim(), 40)}` : '빈 응답이 왔어요.', !!reply.trim());
            } catch (e) {
                setNote(note, e?.name === 'AbortError' ? '응답이 너무 늦어요 (60초 넘음).' : `실패: ${truncate(String(e?.message ?? e), 400)}`, false);
            } finally { clearTimeout(timer); el.disabled = false; }
            return true;
        }
        // save
        const isNew = !f.id;
        const entry = { id: f.id || (ctx().uuidv4 ? ctx().uuidv4() : `${Date.now().toString(36)}${randomId(6)}`), name: f.name, kind: f.kind, url: f.url, key: f.key, model: f.model };
        if (f.kind === 'vertex') Object.assign(entry, { vxMode: f.vxMode, vxRegion: f.vxRegion, vxProject: f.vxProject });
        if (isNew) {
            s.customApis.push(entry);
            if (apiModelCache.has('form')) apiModelCache.set(`api:${entry.id}`, apiModelCache.get('form'));
            s.profileId = `api:${entry.id}`;   // a new API is usually added to be used
        } else {
            const i = s.customApis.findIndex(x => x.id === f.id);
            if (i >= 0) s.customApis[i] = entry; else s.customApis.push(entry);
        }
        apiModelCache.delete('form');
        apiEdit = null;
        saveSettings();
        refreshConnSelectors();
        showApi({ keepScroll: true });
        toastr.success(isNew ? `"${esc(entry.name)}" 추가 — 지금부터 이 API로 생성해요.` : `"${esc(entry.name)}" 저장했어요.`);
        return true;
    }
    if (act === 'api-trtest') {
        const note = el.closest('.stcm-api-view')?.querySelector('.stcm-api-trresult');
        el.disabled = true;
        setNote(note, '확인 중…');
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 60000);
        try {
            const system = fillTpl(getPrompt('translate_separate'), { translation: trTarget() });
            const raw = await callModel(system, JSON.stringify({ items: [{ id: 0, text: 'Good morning! The festival starts tonight.' }] }), ctl.signal, s.translateConn, s.translateModel, { noTail: true });
            let text = '';
            try { const d = extractJson(raw); text = (Array.isArray(d) ? d : d?.items ?? [])[0]?.text ?? ''; } catch { /* not JSON */ }
            setNote(note, text ? `번역 확인: ${truncate(text, 60)}` : `응답은 왔는데 형식이 달라요: ${truncate(String(raw ?? '').trim(), 60)}`, !!text);
        } catch (e) {
            setNote(note, e?.name === 'AbortError' ? '응답이 너무 늦어요 (60초 넘음).' : `실패: ${truncate(String(e?.message ?? e), 400)}`, false);
        } finally { clearTimeout(timer); el.disabled = false; }
        return true;
    }
    if (act === 'api-trmodels') {
        const conn = resolveConnection(s.translateConn);
        const box = el.closest('.stcm-api-view');
        const note = box.querySelector('.stcm-api-trresult');
        el.disabled = true;
        setNote(note, '목록 불러오는 중…');
        try {
            let ids; let key;
            if (conn.type === 'api' && conn.api) { ids = await listApiModels(conn.api); key = `api:${conn.api.id}`; }
            else if (conn.type === 'profile' && conn.profile) { ids = await listProfileModels(conn.profile); key = `p:${conn.profile.id}`; }
            else return true;
            apiModelCache.set(key, ids);
            fillModelPicker(box, 'stcm-api-trmodelsel', key, box.querySelector('.stcm-api-trmodel')?.value || trDefaultModel(conn));
            setNote(note, ids.length ? `모델 ${ids.length}개 — 아래 목록에서 고르세요.` : '목록이 비어 있어요. 모델 이름을 직접 적어 주세요.', ids.length > 0);
        } catch (e) {
            setNote(note, `목록을 못 불러왔어요: ${truncate(String(e?.message ?? e), 120)}`, false);
        } finally { el.disabled = false; }
        return true;
    }
    if (act === 'api-models') {
        const conn = resolveConnection();
        const box = el.closest('.stcm-api-view');
        const note = box.querySelector('.stcm-api-result');
        el.disabled = true;
        setNote(note, '목록 불러오는 중…');
        try {
            let ids; let key;
            if (conn.type === 'api' && conn.api) { ids = await listApiModels(conn.api); key = `api:${conn.api.id}`; }
            else if (conn.type === 'profile' && conn.profile) { ids = await listProfileModels(conn.profile); key = `p:${conn.profile.id}`; }
            else return true;
            apiModelCache.set(key, ids);
            fillModelPicker(box, 'stcm-api-modelsel', key, box.querySelector('.stcm-api-model')?.value);
            setNote(note, ids.length ? `모델 ${ids.length}개 — 아래 목록에서 고르세요.` : '목록이 비어 있어요. 모델 이름을 직접 적어 주세요.', ids.length > 0);
        } catch (e) {
            setNote(note, `목록을 못 불러왔어요: ${truncate(String(e?.message ?? e), 120)}`, false);
        } finally { el.disabled = false; }
        return true;
    }
    return false;
}

/** change / input inside the API view. Returns true when handled. */
function onApiChange(e) {
    const t = e.target;
    const box = t.closest?.('.stcm-api-view');
    if (!box) return false;
    const s = getSettings();
    if (t.classList.contains('stcm-api-trconn')) {
        if (e.type === 'change') { setTranslateConnection(t.value); showApi({ keepScroll: true }); }
        return true;
    }
    if (t.classList.contains('stcm-api-trmodel')) {
        s.translateModel = t.value.trim().slice(0, 200);
        saveSettings();
        return true;
    }
    if (t.classList.contains('stcm-api-trmodelsel')) {
        if (e.type !== 'change' || !t.value) return true;
        const input = box.querySelector('.stcm-api-trmodel');
        if (input) { input.value = t.value; input.dispatchEvent(new Event('input', { bubbles: true })); }
        return true;
    }
    if (t.classList.contains('stcm-api-modelsel') || t.classList.contains('stcm-af-modelsel')) {
        if (e.type !== 'change' || !t.value) return true;
        const input = t.classList.contains('stcm-af-modelsel') ? t.closest('.stcm-api-form')?.querySelector('.stcm-af-model') : box.querySelector('.stcm-api-model');
        if (input) {
            input.value = t.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
    }
    if (t.classList.contains('stcm-api-conn')) {
        if (e.type !== 'change') return true;
        setConnection(t.value);
        showApi({ keepScroll: true });
        const conn = resolveConnection();
        const name = conn.type === 'api' ? conn.api?.name : conn.type === 'profile' ? (conn.profile?.name || conn.profile?.id) : null;
        toastr.info(name ? `연결: ${esc(name)}` : '메인 API를 써요.', '', { timeOut: 1500 });
        return true;
    }
    if (t.classList.contains('stcm-api-model')) {
        const conn = resolveConnection();
        const v = t.value.trim().slice(0, 200);
        if (conn.type === 'profile' && conn.profile) {
            if (v) s.modelOverrides[conn.profile.id] = v; else delete s.modelOverrides[conn.profile.id];
        } else if (conn.type === 'api' && conn.api) {
            conn.api.model = v;
        } else return true;
        saveSettings();
        box.querySelector('.stcm-api-info').textContent = connectionSummary(conn);
        return true;
    }
    if (t.classList.contains('stcm-api-tokens')) {
        const v = Number(t.value);
        if (t.value === '' || !Number.isFinite(v)) return true;
        s.maxTokens = Math.min(32000, Math.max(500, Math.round(v)));
        if (e.type === 'change') t.value = s.maxTokens;
        saveSettings();
        const setTok = document.getElementById('stcm_set_tokens');
        if (setTok) setTok.value = s.maxTokens;
        return true;
    }
    if (t.classList.contains('stcm-af-kind') || t.classList.contains('stcm-af-vxmode')) {
        const form = t.closest('.stcm-api-form');
        syncApiFormFields(form);
        return true;
    }
    return t.closest('.stcm-api-form') ? true : false;
}

async function testApi(btn) {
    if (apiTesting) return;
    apiTesting = true;
    btn.disabled = true;
    const out = btn.closest('.stcm-api-view')?.querySelector('.stcm-api-result');
    setNote(out, '확인 중…');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);
    let ok = false;
    let msg = '';
    try {
        const reply = await callModel('This is a connection test.', 'Reply with exactly: OK', ctl.signal, undefined, '', { noTail: true });
        ok = !!String(reply ?? '').trim();
        msg = ok ? `응답 받음: ${truncate(String(reply).trim(), 40)}` : '빈 응답이 왔어요. 모델이나 토큰 설정을 확인해 주세요.';
    } catch (e) {
        msg = e?.name === 'AbortError' ? '응답이 너무 늦어요 (60초 넘음).' : `실패: ${truncate(String(e?.message ?? e), 400)}`;
    } finally {
        clearTimeout(timer);
        apiTesting = false;
        btn.disabled = false;
    }
    setNote(out, msg, ok);
}

function showPins() {
    leaveFeed();
    view = 'pins';
    const store = hasChat() ? getChatStore() : null;
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    const on = store?.pinsEnabled ?? true;
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">본편에 반영 중인 글</span>
        <button id="stcm_pins_toggle" class="${on ? 'on' : ''}">${on ? '반영 켜짐' : '반영 꺼짐'}</button>`;
    const pins = store?.pins ?? [];
    syncSelectors();
    if (!pins.length) { el.innerHTML = `<div class="stcm-empty">반영 중인 글이 없어요.<br>글 아래의 <i class="fa-solid fa-thumbtack"></i> 반영 버튼으로 골라보세요.</div>`; return; }
    el.innerHTML = `<div class="stcm-list">${pins.map(p => `
        <div class="stcm-li">
            <div class="stcm-li-main" data-open-feed="${esc(p.feedId)}" data-open-post="${Number(p.postIdx)}">
                <b>${esc(PLATFORMS[p.platform]?.label)}</b> · ${esc(p.mode === 'world' ? '세계관 소문' : '독자 반응')}
                <small>${esc(truncate(p.text, 140))}</small>
            </div>
            <button data-unpin="${esc(p.feedId)}|${p.postIdx}" title="반영 해제"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('')}</div>`;
}

function openPanel(feedId) {
    buildOverlay();
    const s = getSettings();
    const store = hasChat() ? getChatStore() : null;
    selMode = store?.lastMode ?? s.defaultMode;
    selPlatform = store?.lastPlatform ?? s.defaultPlatform;
    if (!hasKey(PLATFORMS, selPlatform)) selPlatform = 'naver';
    if (!hasKey(MODES, selMode)) selMode = 'meta';
    applyTheme();
    applyFold();
    applyCompact();
    applyFullscreen();
    showOverlay();
    if (store && store.unread) {
        store.unread = 0;
        saveChatStore();
    }
    updateBadge();
    // closed in the middle of writing a post (and it is still kept): back to the write form
    const backToWrite = !feedId && reopenCompose && composeDrafts.has(feedState.chatId);
    reopenCompose = false;
    if (hasChat() && !feedState.ready) {
        showLoadingFeed();
        ensureFeedsReady().then(() => {
            if (!isOpen() || view !== 'feed') return;
            if (backToWrite && composeDrafts.has(feedState.chatId)) showCompose(); else showFeed(feedId);
        });
        return;
    }
    if (backToWrite) showCompose(); else showFeed(feedId);
}

/**
 * The panel is a modal <dialog>: the browser puts it in the top layer, so themes, custom CSS or
 * other extensions (transforms, z-index, containers) can't push it off screen.
 */
let savedToastTarget = null;

function showOverlay() {
    const ov = document.getElementById('stcm_overlay');
    if (!ov) return;
    ov.classList.add('open');
    if (!ov.open) {
        try { ov.showModal(); } catch { ov.setAttribute('open', ''); }   // very old browsers: plain open
        // showModal focuses the first button (visible ring); focus the panel itself instead
        try { ov.querySelector('.stcm-modal')?.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    // toasts must sit inside the top layer too, or they'd be hidden behind the dialog
    try {
        if (window.toastr?.options) {
            // remember the page's own target only once: opening again while open must not save ours
            if (savedToastTarget == null && toastr.options.target !== '#stcm_overlay') savedToastTarget = toastr.options.target ?? 'body';
            toastr.options.target = '#stcm_overlay';
        }
        const tc = document.getElementById('toast-container');
        if (tc && tc.parentElement !== ov) ov.appendChild(tc);
    } catch { /* ignore */ }
}

function hideOverlay() {
    const ov = document.getElementById('stcm_overlay');
    if (!ov) return;
    restoreSettingsHome();
    closeSheet();
    closeMoreMenu();
    if (view === 'settings') view = 'feed';
    ov.classList.remove('open');
    try { if (ov.open) ov.close(); } catch { ov.removeAttribute('open'); }
    try {
        if (window.toastr?.options) toastr.options.target = savedToastTarget ?? 'body';
        savedToastTarget = null;
        const tc = document.getElementById('toast-container');
        if (tc && tc.parentElement === ov) document.body.appendChild(tc);
    } catch { /* ignore */ }
}

let reopenCompose = false;   // the panel was closed while writing a post: open it there again

function closePanel() {
    captureDraft();
    reopenCompose = view === 'compose';
    leaveFeed();
    hideOverlay();
}

function updateBadge() {
    const n = hasChat() ? (getChatStore()?.unread ?? 0) : 0;
    const b = document.getElementById('stcm_wand_badge');
    if (b) b.textContent = n ? String(n) : '';
}

// ---------------------------------------------------------------------------
// Wand menu + settings panel
// ---------------------------------------------------------------------------
function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('stcm_wand')) return;
    menu.insertAdjacentHTML('beforeend', `
        <div id="stcm_wand" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
            <div class="fa-solid fa-comments extensionsMenuExtensionButton"></div>
            커뮤니티<span id="stcm_wand_badge" class="stcm-badge"></span>
        </div>`);
    document.getElementById('stcm_wand').addEventListener('click', () => openPanel());
}

function addSettingsPanel() {
    const s = getSettings();
    const platformOpts = Object.entries(PLATFORMS).map(([id, p]) => `<option value="${id}">${p.label}</option>`).join('');
    const promptOpts = Object.entries(PROMPT_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    const html = `
    <div id="stcm_settings" class="extension_settings">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>커뮤니티 피드</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
        <div class="stcm-set">
          <div class="menu_button" id="stcm_set_open"><i class="fa-solid fa-comments"></i> 커뮤니티 열기</div>
          <div class="stcm-sec-tools"><span class="stcm-sec-all" data-sec-all="open">모두 펴기</span> · <span class="stcm-sec-all" data-sec-all="close">모두 접기</span></div>
          <details class="stcm-sec" data-sec="screen">
            <summary><i class="fa-solid fa-display"></i> 화면</summary>
            <div class="stcm-sec-body">
          <label>화면 테마</label>
          <select id="stcm_set_theme" class="text_pole">
            <option value="theme">테마 따라가기 (실리태번 테마 색)</option>
            <option value="light">라이트</option>
            <option value="dark">나이트</option>
          </select>
          <label class="checkbox_label" for="stcm_set_compact"><input type="checkbox" id="stcm_set_compact"> <span>간략한 화면 <small>(커뮤니티·카페·판을 한 칸으로 모아 누르면 고르는 창이 열리고, 지난 피드·반영·월드 인포·테마는 ⋯ 메뉴로, 언어·배경은 작게)</small></span></label>
            </div>
          </details>
          <details class="stcm-sec" data-sec="conn">
            <summary><i class="fa-solid fa-plug"></i> 연결 · 언어 · 번역</summary>
            <div class="stcm-sec-body">
          <label>생성에 쓸 연결 <small>(메인 API · 실리태번 연결 프로필 · 직접 추가한 API — 모델 지정과 API 추가는 커뮤니티 창의 🔌 API 설정에서)</small></label>
          <select id="stcm_set_profile" class="text_pole"></select>

          <label>생성 언어</label>
          <select id="stcm_set_language" class="text_pole">${languageOptions(true, false)}</select>
          <input id="stcm_set_custom_lang" class="text_pole" type="text" placeholder="언어 이름 (예: Catalan, Brazilian Portuguese)">

          <label>번역 언어 <small>(번역 보기에 쓸 언어 — 번역만 다른 API로 하려면 커뮤니티 창의 🔌 API 설정에서)</small></label>
          <select id="stcm_set_translate" class="text_pole">${languageOptions(false, true)}</select>
          <input id="stcm_set_custom_tr" class="text_pole" type="text" placeholder="번역할 언어 이름">
          <div class="stcm-set-grid">
            <label>번역 시점
              <select id="stcm_set_trwhen" class="text_pole">
                <option value="auto">생성할 때 자동으로</option>
                <option value="manual">글의 번역 버튼을 누를 때만</option>
              </select>
            </label>
            <label>번역 보기
              <select id="stcm_set_trdisplay" class="text_pole">
                <option value="replace">번역문만</option>
                <option value="both">원문 위 · 번역문 아래</option>
              </select>
            </label>
          </div>

          <label class="checkbox_label"><input id="stcm_set_minreason" type="checkbox"><span>추론 최소화 <small>(생각하는 모델이 추론을 최소로 — 연결 프로필·직접 추가한 API는 추론 강도를 최소로 보내고, 메인 API는 지시문만 붙어요. 빨라지고 토큰이 줄지만 글 품질이 조금 떨어질 수 있어요)</small></span></label>
            </div>
          </details>
          <details class="stcm-sec" data-sec="amount">
            <summary><i class="fa-solid fa-sliders"></i> 생성 분량 <small>글·댓글 수, 토큰</small></summary>
            <div class="stcm-sec-body">
          <div class="stcm-set-grid">
            <label>새로 생성할 글 개수 <input id="stcm_set_posts" type="number" min="1" max="10" class="text_pole"></label>
            <label>글당 댓글 수 <input id="stcm_set_comments" type="number" min="0" max="20" class="text_pole"></label>
            <label>이어서/반응 댓글 수 <input id="stcm_set_continue" type="number" min="1" max="30" class="text_pole"></label>
            <label>참고할 최근 메시지 <input id="stcm_set_ctx" type="number" min="1" max="100" class="text_pole"></label>
            <label>메시지당 최대 글자 수 <small>(0 = 자르지 않음)</small> <input id="stcm_set_msgchars" type="number" min="0" max="1000000" step="1" class="text_pole"></label>
            <label>최대 응답 토큰 <input id="stcm_set_tokens" type="number" min="500" max="32000" step="100" class="text_pole"></label>
            <label>2ch·레딧 스레드 최대 레스 <input id="stcm_set_cap" type="number" min="10" max="10000" step="10" class="text_pole"></label>
            <label>반영 글 삽입 깊이 <input id="stcm_set_depth" type="number" min="0" max="50" class="text_pole"></label>
          </div>
            </div>
          </details>
          <details class="stcm-sec" data-sec="people">
            <summary><i class="fa-solid fa-user-group"></i> 등장인물 · 닉네임</summary>
            <div class="stcm-sec-body">
          <label>주변 인물(NPC)이 직접 글 쓰기 <small>(세계관 속 모드 — 이야기에 나오는 조연이 커뮤니티에 직접 글·댓글을 다는지)</small></label>
          <select id="stcm_set_npc" class="text_pole">
            <option value="auto">AI가 알아서</option>
            <option value="on">쓰게 하기 (조연 한두 명이 직접 등장)</option>
            <option value="off">쓰지 않게 하기 (이름 없는 일반 이용자만)</option>
          </select>
          <label>언급 범위 <small>(글과 댓글에서 이야기 속 인물을 누구까지 언급할지. 이름·생김새·별명으로 돌려 말하는 것도 막아요. "모두" 말고 다른 걸 고르면 위의 NPC 설정은 쓰지 않고 주변 인물도 나오지 않아요)</small>
            <select id="stcm_set_mention" class="text_pole">
              <option value="all">모두 언급 (제한 없음)</option>
              <option value="char">캐릭터만 언급 (유저·주변 인물은 언급 안 함)</option>
              <option value="user">유저만 언급 (캐릭터·주변 인물은 언급 안 함)</option>
              <option value="none">아무도 언급 안 함 (인물 언급 금지 — 작품 전반·팬덤 이야기, 그 세계의 일상만)</option>
            </select>
          </label>
          <label>내가 쓸 때 닉네임 칸을 비우면
            <select id="stcm_set_nickmode" class="text_pole">
              <option value="random">커뮤니티에 어울리는 랜덤 닉네임 (바로)</option>
              <option value="ai">AI가 사람·글에 맞는 닉네임을 지어 줌 (짧은 요청 1번)</option>
            </select>
          </label>
          <small class="stcm-help">디시·투디갤은 ㅇㅇ, 2ch는 名無しさん, 에브리타임은 익명N처럼 익명 커뮤니티는 원래 방식대로 나와요. 한 글 안에서 같은 신분(모브/유저/같은 캐릭터)은 처음 쓴 닉네임을 계속 써요.</small>
            </div>
          </details>
          <details class="stcm-sec" data-sec="reading">
            <summary><i class="fa-solid fa-book-open"></i> 본 채팅에서 읽는 것 <small>캐릭터 설명, 태그, 월드 인포, 장기기억</small></summary>
            <div class="stcm-sec-body">
          <label class="checkbox_label"><input id="stcm_set_card" type="checkbox"><span>캐릭터·페르소나 설명 포함</span></label>
          <label>본 채팅에서 읽지 않을 태그 <small>(쉼표로 구분, 태그와 안의 내용을 통째로 빼요. 숨긴 메시지는 항상 빼요)</small></label>
          <textarea id="stcm_set_excludetags" class="text_pole" rows="3"></textarea>
          <label class="checkbox_label"><input id="stcm_set_skipnarr" type="checkbox"><span>내레이터·시스템 메모(/sys)도 읽지 않기</span></label>
          <label class="checkbox_label"><input id="stcm_set_wi" type="checkbox"><span>새 채팅에서 월드 인포 자동 참고 <small>(채팅별 선택은 커뮤니티 창의 📚 버튼)</small></span></label>
          <label>월드 인포 최대 글자 수 <input id="stcm_set_wimax" type="number" min="1000" max="100000" step="1000" class="text_pole"></label>
          <label class="checkbox_label"><input id="stcm_set_extmem" type="checkbox"><span>장기기억·요약 확장 내용 포함 <small>(Memoria, 코끼리를 생각하지마, VectFox, 요약, 벡터 저장소 등이 본 채팅에 넣는 기억)</small></span></label>
          <label>기억 최대 글자 수 <input id="stcm_set_extmemmax" type="number" min="500" max="50000" step="500" class="text_pole"></label>
          <div class="stcm-extmem">
            <div class="stcm-prompt-row"><small>읽을 항목 <span class="stcm-help">(기억·요약으로 보이는 건 자동으로 켜져요)</span></small><div class="menu_button" id="stcm_set_extmem_refresh"><i class="fa-solid fa-rotate"></i> 새로고침</div></div>
            <div id="stcm_set_extmem_list"></div>
          </div>
            </div>
          </details>
          <details class="stcm-sec" data-sec="auto">
            <summary><i class="fa-solid fa-rotate"></i> 자동 생성</summary>
            <div class="stcm-sec-body">
          <small class="stcm-help">본 채팅 AI 답변이 올 때마다 셉니다.</small>
          <label class="checkbox_label"><input id="stcm_set_auto" type="checkbox"><span>새 글·새 스레 자동 생성</span></label>
          <div class="stcm-set-grid">
            <label>AI 답변 몇 번마다 <input id="stcm_set_every" type="number" min="1" max="100" class="text_pole"></label>
            <label class="checkbox_label" style="flex-direction:row"><input id="stcm_set_watchnew" type="checkbox"><span>자동으로 만든 글은 바로 지켜보기</span></label>
          </div>
          <label class="checkbox_label"><input id="stcm_set_autoreply" type="checkbox"><span>지켜보는 글에 레스·댓글 자동 생성 <small>(글 아래 <i class="fa-solid fa-eye"></i> 지켜보기)</small></span></label>
          <div class="stcm-set-grid">
            <label>AI 답변 몇 번마다 <input id="stcm_set_replyevery" type="number" min="1" max="100" class="text_pole"></label>
            <label>한 번에 이어갈 글 수 <input id="stcm_set_replymax" type="number" min="1" max="10" class="text_pole"></label>
          </div>
          <small class="stcm-help">지켜보는 글이 많으면 오래 안 이어간 글부터 차례로 돌아가요. 1000레스가 찬 2ch·레딧 스레는 후속 스레를 세우고 지켜보기를 그쪽으로 옮겨요.</small>
          <div class="stcm-set-grid">
            <label>자동 생성 커뮤니티
              <select id="stcm_set_autopf" class="text_pole">
                <option value="last">마지막으로 고른 곳</option>
                <option value="random">랜덤</option>
                ${platformOpts}
              </select>
            </label>
            <label>기본 모드
              <select id="stcm_set_mode" class="text_pole">
                <option value="meta">작품 반응</option>
                <option value="world">세계관 속</option>
              </select>
            </label>
            <label>기본 커뮤니티
              <select id="stcm_set_pf" class="text_pole">${platformOpts}</select>
            </label>
          </div>
            </div>
          </details>
          <details class="stcm-sec" data-sec="topics">
            <summary><i class="fa-solid fa-tags"></i> 글 주제 · 참고 · 추가 지시</summary>
            <div class="stcm-sec-body">
          <small class="stcm-help">글 주제의 추가·삭제·선택은 커뮤니티 창의 주제 줄 <i class="fa-solid fa-plus"></i> 버튼에서 해요.</small>
          <div class="stcm-set-grid">
            <label>주제 적용
              <select id="stcm_set_topicscope" class="text_pole">
                <option value="all">직접 생성 + 자동 생성</option>
                <option value="auto">자동 생성만</option>
              </select>
            </label>
            <label>여러 주제를 골랐을 때
              <select id="stcm_set_topicmix" class="text_pole">
                <option value="each">글마다 하나씩 배정</option>
                <option value="mix">AI가 섞어서</option>
              </select>
            </label>
          </div>

          <label class="checkbox_label"><input id="stcm_set_crossref" type="checkbox"><span>모든 생성에서 다른 게시글 참고 <small>(꺼 두면 글 아래 <i class="fa-solid fa-link"></i>로 그 글만 켤 수 있어요)</small></span></label>
          <label>참고할 다른 글 수 <input id="stcm_set_crossrefcount" type="number" min="1" max="20" class="text_pole"></label>

          <label>추가 지시 <small>(모든 생성에 붙어요. 아무 언어나 OK)</small></label>
          <textarea id="stcm_set_extra" class="text_pole" rows="3"></textarea>
            </div>
          </details>
          <details class="stcm-sec" data-sec="prompt">
            <summary><i class="fa-solid fa-pen-to-square"></i> 프롬프트 편집</summary>
            <div class="stcm-sec-body">
          <small class="stcm-help">AI가 읽는 지시문이에요. 영어 권장.</small>
          <div class="stcm-tail-set">
            <label class="checkbox_label"><input id="stcm_set_tail" type="checkbox"><span>맨 밑 프롬프트 사용 <small>(아래 목록의 "맨 밑 프롬프트" 내용을 모든 생성 요청의 맨 끝에 메시지 하나로 붙여요. 연결 테스트에는 안 붙어요)</small></span></label>
            <label>맨 밑 프롬프트 롤
              <select id="stcm_set_tailrole" class="text_pole">
                <option value="user">User</option>
                <option value="assistant">Assistant (AI가 이 글에 이어서 답해요)</option>
              </select>
            </label>
          </div>
          <select id="stcm_set_prompt_key" class="text_pole">${promptOpts}</select>
          <textarea id="stcm_set_prompt" class="text_pole stcm-prompt-box" rows="10"></textarea>
          <div class="stcm-prompt-row">
            <small id="stcm_set_prompt_state"></small>
            <div class="menu_button" id="stcm_set_prompt_reset">이 항목 기본값으로</div>
            <div class="menu_button" id="stcm_set_prompt_reset_all">전체 기본값으로</div>
          </div>
          <small class="stcm-help">쓸 수 있는 변수: <code>{{char}}</code> <code>{{user}}</code> <code>{{platform}}</code> (커뮤니티 영어 이름), <code>{{language}}</code> (언어 항목), <code>{{translation}}</code> (번역 항목), <code>{{count}}</code> (개수), <code>{{comments}}</code> (글당 댓글 수). 실리태번 매크로도 쓸 수 있어요. 비워 두면 기본값을 써요.</small>
            </div>
          </details>
          <details class="stcm-sec" data-sec="storage">
            <summary><i class="fa-solid fa-server"></i> 피드 저장 · 정리</summary>
            <div class="stcm-sec-body">
          <small class="stcm-help"><i class="fa-solid fa-server"></i> 피드는 채팅 파일이 아니라 서버의 사용자 파일 폴더(<code>data/사용자/user/files/stcm-feed-*.json</code>)에 저장돼요.</small>
          <label>채팅당 지난 피드 최대 개수 <small>(0 = 제한 없음. 넘으면 오래된 것부터 지우지만, 📌 반영·👁 지켜보기 중인 피드는 남겨요)</small>
            <input id="stcm_set_maxfeeds" type="number" min="0" max="1000" class="text_pole">
          </label>
          <div class="menu_button" id="stcm_set_cleanup">삭제된 채팅의 피드 파일 정리</div>
            </div>
          </details>
        </div>
        </div>
      </div>
    </div>`;
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    host?.insertAdjacentHTML('beforeend', html);

    document.getElementById('stcm_set_open').addEventListener('click', () => openPanel());
    // folding sections: remember which ones are open
    const secs = [...document.querySelectorAll('#stcm_settings details.stcm-sec')];
    const open = (s.secOpen && typeof s.secOpen === 'object') ? s.secOpen : {};
    for (const d of secs) {
        d.open = !!open[d.dataset.sec];
        d.addEventListener('toggle', () => {
            const cur = getSettings();
            cur.secOpen = { ...(cur.secOpen ?? {}), [d.dataset.sec]: d.open };
            saveSettings();
            if (d.open && d.dataset.sec === 'reading') renderExtMemoryList();
        });
    }
    document.querySelector('#stcm_settings .stcm-sec-tools')?.addEventListener('click', (e) => {
        const all = e.target.closest('[data-sec-all]')?.dataset.secAll;
        if (all) for (const d of secs) d.open = all === 'open';
    });
    document.getElementById('stcm_set_cleanup').addEventListener('click', cleanupDeletedStores);
    updateCleanupLabel();

    const bind = (id, key, type = 'value') => {
        const el = document.getElementById(id);
        if (!el) return;
        if (type === 'checked') el.checked = !!s[key];
        else el.value = s[key];
        const handler = () => {
            if (type === 'checked') s[key] = el.checked;
            else if (el.type === 'number') {
                if (el.value === '' || !Number.isFinite(Number(el.value))) return;   // keep the old value while typing
                let v = Number(el.value);
                if (el.min !== '') v = Math.max(Number(el.min), v);
                if (el.max !== '') v = Math.min(Number(el.max), v);
                s[key] = v;
            }
            else s[key] = el.value;
            saveSettings();
            if (key === 'pinDepth') refreshInjection();
            if (['language', 'translateTo', 'customLanguage', 'customTranslate'].includes(key)) syncLanguageSelectors();
        };
        el.addEventListener(el.tagName === 'SELECT' || type === 'checked' ? 'change' : 'input', handler);
    };
    bind('stcm_set_language', 'language');
    bind('stcm_set_custom_lang', 'customLanguage');
    bind('stcm_set_translate', 'translateTo');
    bind('stcm_set_custom_tr', 'customTranslate');
    bind('stcm_set_posts', 'postCount');
    bind('stcm_set_comments', 'commentCount');
    bind('stcm_set_continue', 'continueCount');
    bind('stcm_set_ctx', 'contextMessages');
    bind('stcm_set_msgchars', 'storyMsgChars');
    bind('stcm_set_tail', 'tailEnabled', 'checked');
    bind('stcm_set_tailrole', 'tailRole');
    {   // the box shows exactly what is used (0.5 → 1, -3 → 0)
        const el = document.getElementById('stcm_set_msgchars');
        if (el) el.value = String(normMsgChars(s.storyMsgChars));
        el?.addEventListener('change', () => {
            const n = normMsgChars(s.storyMsgChars);
            if (s.storyMsgChars !== n) { s.storyMsgChars = n; saveSettings(); }
            el.value = String(n);
        });
    }
    bind('stcm_set_tokens', 'maxTokens');
    bind('stcm_set_card', 'includeCard', 'checked');
    bind('stcm_set_excludetags', 'excludeTags');
    bind('stcm_set_skipnarr', 'excludeSkipNarrator', 'checked');
    bind('stcm_set_wi', 'includeWorldInfo', 'checked');
    bind('stcm_set_extmem', 'extMemory', 'checked');
    bind('stcm_set_extmemmax', 'extMemoryMax');
    document.getElementById('stcm_set_extmem_refresh')?.addEventListener('click', renderExtMemoryList);
    document.getElementById('stcm_set_extmem_list')?.addEventListener('change', (e) => {
        const key = e.target?.dataset?.extmem;
        if (!key) return;
        getSettings().extMemoryChoice[key] = e.target.checked;
        saveSettings();
    });
    document.querySelector('#stcm_settings .inline-drawer-toggle')?.addEventListener('click', () => setTimeout(renderExtMemoryList, 50));
    renderExtMemoryList();
    bind('stcm_set_wimax', 'wiMaxChars');
    bind('stcm_set_auto', 'autoEnabled', 'checked');
    bind('stcm_set_every', 'autoEvery');
    bind('stcm_set_autopf', 'autoPlatform');
    bind('stcm_set_watchnew', 'autoWatchNew', 'checked');
    bind('stcm_set_autoreply', 'autoReplyEnabled', 'checked');
    bind('stcm_set_replyevery', 'autoReplyEvery');
    bind('stcm_set_replymax', 'autoReplyMax');
    bind('stcm_set_crossref', 'crossRef', 'checked');
    bind('stcm_set_crossrefcount', 'crossRefCount');
    document.getElementById('stcm_set_crossref')?.addEventListener('change', () => { if (isOpen() && view === 'feed') showFeed(currentFeedId, { keepScroll: true }); });
    bind('stcm_set_depth', 'pinDepth');
    bind('stcm_set_cap', 'threadCap');
    bind('stcm_set_theme', 'theme');
    bind('stcm_set_compact', 'compactUi', 'checked');
    document.getElementById('stcm_set_compact')?.addEventListener('change', applyCompact);
    document.getElementById('stcm_set_theme')?.addEventListener('change', applyTheme);
    bind('stcm_set_mode', 'defaultMode');
    bind('stcm_set_npc', 'npcPosts');
    bind('stcm_set_maxfeeds', 'maxFeeds');
    bind('stcm_set_mention', 'mentionScope');
    bind('stcm_set_nickmode', 'nickMode');
    bind('stcm_set_minreason', 'minReasoning', 'checked');
    bind('stcm_set_trwhen', 'translateWhen');
    bind('stcm_set_trdisplay', 'trDisplay');
    document.getElementById('stcm_set_trdisplay')?.addEventListener('change', () => { if (isOpen() && view === 'feed' && currentFeedId) showFeed(currentFeedId, { keepScroll: true }); });

    bind('stcm_set_pf', 'defaultPlatform');
    bind('stcm_set_extra', 'extraInstruction');
    bind('stcm_set_topicscope', 'topicScope');
    bind('stcm_set_topicmix', 'topicMix');
    for (const id of ['stcm_set_topicscope', 'stcm_set_topicmix']) {
        document.getElementById(id)?.addEventListener('change', () => renderTopicChips());
    }
    syncLanguageSelectors();

    // Prompt editor
    const keySel = document.getElementById('stcm_set_prompt_key');
    const box = document.getElementById('stcm_set_prompt');
    const state = document.getElementById('stcm_set_prompt_state');
    const load = () => {
        const k = keySel.value;
        const custom = s.prompts[k];
        box.value = (typeof custom === 'string' && custom.trim()) ? custom : DEFAULT_PROMPTS[k];
        box.placeholder = k === 'tail' ? '여기 적은 글이 요청 맨 끝에 붙어요 (위에서 "맨 밑 프롬프트 사용"을 켜야 들어가요). 예: 출력은 반드시 JSON 하나만.' : '';
        state.textContent = (typeof custom === 'string' && custom.trim()) ? '수정됨' : '기본값';
    };
    keySel.addEventListener('change', load);
    box.addEventListener('input', () => {
        const k = keySel.value;
        if (box.value.trim() === '' || box.value === DEFAULT_PROMPTS[k]) delete s.prompts[k];
        else s.prompts[k] = box.value;
        state.textContent = s.prompts[k] ? '수정됨' : '기본값';
        saveSettings();
    });
    document.getElementById('stcm_set_prompt_reset').addEventListener('click', () => {
        delete s.prompts[keySel.value];
        saveSettings();
        load();
    });
    document.getElementById('stcm_set_prompt_reset_all').addEventListener('click', async () => {
        const { Popup, POPUP_RESULT } = ctx();
        const ok = Popup?.show?.confirm
            ? (await Popup.show.confirm('프롬프트 초기화', '수정한 프롬프트를 모두 기본값으로 되돌릴까요?')) === POPUP_RESULT.AFFIRMATIVE
            : confirm('모두 기본값으로 되돌릴까요?');
        if (!ok) return;
        s.prompts = {};
        saveSettings();
        load();
    });
    load();

    // Connection dropdown (ST profiles + APIs added in the panel)
    const sel = document.getElementById('stcm_set_profile');
    sel.innerHTML = connOptionsHtml();
    sel.addEventListener('change', () => setConnection(sel.value));
}

// ---------------------------------------------------------------------------
// Auto generation + events
// ---------------------------------------------------------------------------
// Background jobs run one after another and wait for any manual generation to finish
let autoChain = Promise.resolve();
const autoPending = new Set();   // kinds already waiting in the chain

function queueAuto(kind, job) {
    if (autoPending.has(kind)) return autoChain;   // one waiting job per kind is enough
    autoPending.add(kind);
    const chatId = ctx().getCurrentChatId?.();
    autoChain = autoChain.then(async () => {
        autoPending.delete(kind);
        for (let waited = 0; busy && waited < 180000; waited += 500) await new Promise(r => setTimeout(r, 500));
        if (busy || ctx().getCurrentChatId?.() !== chatId) return;   // still busy or chat changed: skip this round
        try { await job(); } catch (e) { console.error(`[${MODULE}] auto job failed`, e); }
    });
    return autoChain;
}

/** Watched posts of this chat, least recently continued first. */
function watchedPosts() {
    const out = [];
    for (const feed of getChatStore()?.feeds ?? []) {
        feed.data.posts.forEach((post) => { if (post.watch) out.push({ feed, post }); });
    }
    return out.sort((a, b) => (a.post.autoAt ?? 0) - (b.post.autoAt ?? 0));
}

async function onMessageReceived(messageId, type) {
    const s = getSettings();
    if ((!s.autoEnabled && !s.autoReplyEnabled) || !hasChat()) return;
    // regenerate / swipe replace the last reply; first_message is the greeting → not a new turn
    if (['quiet', 'impersonate', 'swipe', 'continue', 'regenerate', 'first_message'].includes(type)) return;
    const msg = ctx().chat?.[messageId];
    if (!msg || msg.is_user || msg.is_system) return;

    const store = getChatStore();
    let runNew = false;
    let runReplies = false;
    if (s.autoEnabled) {
        store.counter = (store.counter || 0) + 1;
        if (store.counter >= Math.max(1, Number(s.autoEvery) || 5)) { store.counter = 0; runNew = true; }
    }
    if (s.autoReplyEnabled) {
        store.counterReply = (store.counterReply || 0) + 1;
        if (store.counterReply >= Math.max(1, Number(s.autoReplyEvery) || 1)) { store.counterReply = 0; runReplies = true; }
    }
    const c = ctx();
    if (c.saveMetadataDebounced) c.saveMetadataDebounced(); else await c.saveMetadata();

    if (runReplies) {
        // watched posts first, so a full thread gets its follow-up before brand-new threads
        queueAuto('replies', async () => {
            if (!(await ensureFeedsReady())) return;
            const max = Math.max(1, Math.min(10, Number(s.autoReplyMax) || 2));
            for (const { feed, post } of watchedPosts().slice(0, max)) {
                const idx = feed.data.posts.indexOf(post);
                if (idx >= 0) await generateMoreComments(feed.id, idx, { background: true });
            }
        });
    }
    if (runNew) {
        let platformId = s.autoPlatform;
        if (platformId === 'random') {
            const ids = Object.keys(PLATFORMS);
            platformId = ids[Math.floor(Math.random() * ids.length)];
        } else if (platformId === 'last' || !PLATFORMS[platformId]) {
            platformId = store.lastPlatform ?? s.defaultPlatform;
        }
        const mode = store.lastMode ?? s.defaultMode;
        queueAuto('new', async () => {
            const feed = await generateFeed({ mode, platformId, background: true });
            if (feed && s.autoWatchNew) {
                for (const p of lastAdded.get(feed) ?? feed.data.posts) p.watch = true;
                await saveChatStore();
            }
        });
    }
}

async function onChatChanged() {
    abortCtl?.abort();
    captureDraft();   // a kept comment / post being edited: its edits stay with it
    if (view === 'compose') syncComposeDraft(document.querySelector('#stcm_feed .stcm-compose-view'));
    composer = null;
    currentFeedId = null;
    pendingImport = null;
    for (const u of unposted.values()) for (const d of u.comments) d.shown = false;   // kept comments come back on the next visit
    feedScroll.clear();
    await flushFeedWrite();   // previous chat's pending change
    refreshInjection();       // pins live in the chat file, so this works before the feeds load
    updateBadge();
    if (isOpen()) showLoadingFeed();
    await loadFeedsForCurrentChat();
    refreshInjection();
    updateBadge();
    if (isOpen()) {
        const store = hasChat() ? getChatStore() : null;
        selMode = store?.lastMode ?? getSettings().defaultMode;
        selPlatform = store?.lastPlatform ?? getSettings().defaultPlatform;
        showFeed();
    }
}

function showLoadingFeed() {
    restoreSettingsHome();
    if (view === 'settings') view = 'feed';
    const el = document.getElementById('stcm_feed');
    const bar = document.getElementById('stcm_feedbar');
    if (bar) bar.innerHTML = '';
    if (el) el.innerHTML = '<div class="stcm-empty"><i class="fa-solid fa-spinner fa-spin"></i> 피드를 불러오는 중…</div>';
}

/** A chat was deleted: its feed file becomes a cleanup candidate (unopened branches may still need it). */
function onChatDeleted(name) {
    const chatName = String(name ?? '').replace(/\.jsonl$/, '');
    const idx = storeIndex();
    let changed = false;
    for (const info of Object.values(idx)) {
        if (info.chat === chatName && !info.deletedAt) { info.deletedAt = Date.now(); changed = true; }
    }
    if (changed) { saveSettings(); updateCleanupLabel(); }
}

function onChatRenamed(data) {
    const from = String(data?.oldFileName ?? '').replace(/\.jsonl$/, '');
    const to = String(data?.newFileName ?? '').replace(/\.jsonl$/, '');
    if (!from || !to) return;
    const idx = storeIndex();
    for (const info of Object.values(idx)) if (info.chat === from) info.chat = to;
    saveSettings();
}

async function cleanupDeletedStores() {
    const idx = storeIndex();
    const targets = Object.entries(idx).filter(([, i]) => i.deletedAt);
    if (!targets.length) { toastr.info('정리할 파일이 없어요.'); return; }
    const { Popup, POPUP_RESULT } = ctx();
    const msg = `삭제된 채팅의 피드 파일 ${targets.length}개를 지울까요?<br><small>아직 한 번도 열지 않은 브랜치·체크포인트가 그 채팅에서 갈라져 나왔다면, 그 브랜치는 피드를 이어받지 못해요.</small>`;
    const ok = Popup?.show?.confirm ? (await Popup.show.confirm('피드 파일 정리', msg)) === POPUP_RESULT.AFFIRMATIVE : confirm('삭제된 채팅의 피드 파일을 지울까요?');
    if (!ok) return;
    let done = 0;
    for (const [id] of targets) {
        if (id === feedState.storeId) { delete idx[id].deletedAt; continue; }
        if (await deleteStoreFile(id)) { delete idx[id]; done++; }
    }
    saveSettings();
    updateCleanupLabel();
    toastr.success(`파일 ${done}개를 정리했어요.`);
}

function updateCleanupLabel() {
    const el = document.getElementById('stcm_set_cleanup');
    if (!el) return;
    const n = Object.values(storeIndex()).filter(i => i.deletedAt).length;
    el.textContent = n ? `삭제된 채팅의 피드 파일 정리 (${n}개)` : '삭제된 채팅의 피드 파일 정리';
}

function registerCommands() {
    const c = ctx();
    const { SlashCommandParser, SlashCommand, SlashCommandNamedArgument, ARGUMENT_TYPE } = c;
    if (!SlashCommandParser || !SlashCommand) return;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'community',
        aliases: ['cmty'],
        callback: async (args, value) => {
            const topic = String(value ?? '').trim();
            const pf = hasKey(PLATFORMS, args.platform) ? args.platform : null;
            const md = hasKey(MODES, args.mode) ? args.mode : null;
            if (!pf && !md && !topic) { openPanel(); return ''; }
            const store = getChatStore();
            openPanel();
            await generateFeed({
                mode: md ?? store?.lastMode ?? getSettings().defaultMode,
                platformId: pf ?? store?.lastPlatform ?? getSettings().defaultPlatform,
                topic,
            });
            return '';
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'platform',
                description: Object.keys(PLATFORMS).join(' | '),
                typeList: [ARGUMENT_TYPE.STRING],
                enumList: Object.keys(PLATFORMS),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'mode',
                description: 'meta (reader reactions) | world (in-world inhabitants)',
                typeList: [ARGUMENT_TYPE.STRING],
                enumList: Object.keys(MODES),
            }),
        ],
        helpString: '<div>커뮤니티 피드를 엽니다. 인자를 주면 바로 생성합니다.<br><code>/community</code> · <code>/community platform=fivech mode=world 축제 당일 반응</code></div>',
    }));
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(function init() {
    const { eventSource, event_types } = ctx();
    // leaving the page with feed changes not on the server yet: save right away / ask the browser to wait
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && feedState.timer) flushFeedWrite(); });
    window.addEventListener('beforeunload', (e) => {
        if (!hasUnsaved()) return;
        if (feedState.timer) flushFeedWrite();   // starts the upload; the browser's "leave page?" gives it time
        e.preventDefault();
        e.returnValue = '';
    });
    eventSource.on(event_types.APP_READY, () => {
        getSettings();
        addSettingsPanel();
        addWandButton();
        buildOverlay();
        registerCommands();
        refreshInjection();
        updateBadge();
        if (hasChat()) loadFeedsForCurrentChat();
    });
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    for (const k of ['CONNECTION_PROFILE_CREATED', 'CONNECTION_PROFILE_UPDATED', 'CONNECTION_PROFILE_DELETED']) {
        if (event_types[k]) eventSource.on(event_types[k], () => refreshConnSelectors());
    }
    if (event_types.CHAT_DELETED) eventSource.on(event_types.CHAT_DELETED, onChatDeleted);
    if (event_types.GROUP_CHAT_DELETED) eventSource.on(event_types.GROUP_CHAT_DELETED, onChatDeleted);
    if (event_types.CHAT_RENAMED) eventSource.on(event_types.CHAT_RENAMED, onChatRenamed);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
})();
