// Community Feed for SillyTavern
// Generates fake community posts (Naver Cafe, DCInside, Reddit, X, 2ch, Weibo, Tieba)
// reacting to the current chat, either as a "work" (readers) or as a "world" (inhabitants).
// The player can post / comment (as a bystander or as {{user}}) and get reactions,
// continue threads, load more posts, edit every prompt, and pick any output language.

const MODULE = 'st_community';
const INJECT_KEY = 'st_community_pins';
const MAX_FEEDS_PER_CHAT = 30;
const MAX_THREAD_ITEMS_IN_PROMPT = 60;

// extension_prompt_types / roles are not exported via getContext(); values from script.js
const PROMPT_IN_CHAT = 1;
const ROLE_SYSTEM = 0;

const defaultSettings = Object.freeze({
    profileId: '',
    language: 'native',          // 'native' | a language name (English) | 'custom'
    customLanguage: '',
    translateTo: '',             // '' (off) | a language name | 'custom'
    customTranslate: '',
    postCount: 4,
    commentCount: 5,
    continueCount: 5,
    contextMessages: 20,
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
    topicMix: 'each',            // each: assign one topic per post | mix: let the model mix them
    topicScope: 'all',           // all: manual + auto generation | auto: auto generation only
    threadCap: 1000,             // max posts per thread on capped platforms (2ch, Reddit)
    theme: 'theme',              // light | dark | theme (follow SillyTavern theme)
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

    inject_dm: `[Private Discord direct messages these people actually exchanged. Both sides remember them; let them shape knowledge, mood and dialogue when relevant. Nobody else has seen them unless shared.]`,

    amount_posts: `Write {{count}} posts. Each post has roughly {{comments}} comments (vary it: popular posts more, boring ones fewer). Add replies to some comments where natural, unless the platform style says otherwise.`,

    continue: `Continue the post/thread shown in <thread>. Write {{count}} NEW comments that naturally follow the existing ones, in chronological order. Earlier posters may come back with the same voice; new posters may join. React to the most recent comments first. Do not repeat or paraphrase earlier comments. Keep the platform's culture and the same mode rules.`,

    react_focus: `The player has just posted the item marked as the latest player item. Most of the new comments should respond to it directly (replying, agreeing, arguing, joking, asking follow-up questions, or misunderstanding it), but keep it natural for the platform; a few posters may ignore it.`,

    player_user: `Items marked [PLAYER as {{user}}] were written by the human player, posting as {{user}} under the nickname shown. Other posters only know what the post itself reveals about the author. In the in-world mode they may recognize {{user}} only if the content or nickname makes it obvious.`,

    player_char: `Items marked [CHARACTER: name] were written by that story character themself (the character named in the mark), under the nickname shown. The content reflects that character's own voice, knowledge and intentions. Other posters only know what the post itself reveals; they may or may not realize who wrote it. Characters writing now: {{name}}.`,

    player_mob: `Items marked [PLAYER] were written by the human player as an ordinary community member (a bystander, not a story character). Treat them like any other poster.`,

    language_native: `Write all posts and comments in {{language}}.`,

    language_fixed: `Write all posts and comments in {{language}}, while keeping the platform's culture, formatting and slang flavor, naturally adapted into {{language}}.`,

    translation: `ALSO fill "body_tr" for every post and comment with a natural {{translation}} translation that keeps the tone and slang. If the original is already in {{translation}}, leave "body_tr" empty.`,

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
      "body": "post text; use \\n for line breaks",
      "body_tr": "",
      "time": "relative time as shown on the platform, in the platform's language",
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
Numbers must be plain integers. Escape double quotes inside strings. Every poster must feel like a distinct person with their own voice.`,

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
    translation: '번역 지시',
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
    guide_tieba: '스타일: 바이두 티에바',
    guide_discord: '스타일: 디스코드',
    guide_tdgall: '스타일: 투디갤',
    dm_continue: '디스코드 DM 이어가기 지시',
    inject_dm: '본편 반영: 디스코드 DM',
};

// ---------------------------------------------------------------------------
// Settings / storage helpers
// ---------------------------------------------------------------------------
function ctx() {
    return SillyTavern.getContext();
}

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
};

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
    feedState.timer = setTimeout(() => queueWrite(storeId, feeds), 700);
}

function queueWrite(storeId, feeds) {
    feedState.writing = feedState.writing.then(async () => {
        const json = JSON.stringify(feeds);
        if (storeId === feedState.storeId && json === feedState.lastWritten) return;
        try {
            const size = await uploadStore(storeId, feeds);
            if (storeId === feedState.storeId) feedState.lastWritten = json;
            indexStore(storeId, { size, chat: ctx().getCurrentChatId?.() ?? '' });
            if (feedState.error) { feedState.error = false; toastr.success('커뮤니티 피드를 다시 저장했어요.'); }
        } catch (e) {
            console.error(`[${MODULE}] failed to save feed file`, e);
            if (!feedState.error) toastr.error('커뮤니티 피드를 서버에 저장하지 못했어요. 다음 변경 때 다시 시도해요.', '커뮤니티');
            feedState.error = true;
        }
    });
    return feedState.writing;
}

/** Write any pending change right away (before switching chats). */
async function flushFeedWrite() {
    if (feedState.timer) {
        clearTimeout(feedState.timer);
        feedState.timer = null;
        if (feedState.ready && feedState.storeId) await queueWrite(feedState.storeId, feedState.feeds);
    }
    await feedState.writing;
}

/** Load (or migrate / fork) the feeds of the chat that is open now. */
function loadFeedsForCurrentChat() {
    const run = (async () => {
        feedState.ready = false;
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
        if (legacy && legacy.enumerable && Array.isArray(legacy.value)) {
            // v1.5 and older kept feeds inside the chat file → move them out
            feeds = legacy.value;
            delete st.feeds;
            metaChanged = true;
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
        if (forked) {
            // Branch / checkpoint: keep only what existed up to the branch point
            feeds = feeds.filter(f => (Number(f.atMessage) || 0) < chatLen);
            const ids = new Set(feeds.map(f => f.id));
            st.pins = (st.pins ?? []).filter(p => ids.has(p.feedId));
        }
        const needNewFile = forked || (legacy && legacy.enumerable) || (!st.storeId && feeds.length > 0);
        if (needNewFile) {
            st.storeId = newStoreId();
            st.storeOwner = key;
            metaChanged = true;
        }
        if (st.storeId && !st.storeOwner) { st.storeOwner = key; metaChanged = true; }

        feedState.storeId = st.storeId ?? null;   // null: chat without feeds yet, file made on first save
        feedState.feeds = feeds;
        attachFeeds(st);
        feedState.ready = true;

        if (needNewFile) await queueWrite(st.storeId, feeds);   // copy for branches, migration
        else feedState.lastWritten = JSON.stringify(feeds);
        if (metaChanged) {
            indexStore(st.storeId, { chat: c.getCurrentChatId?.() ?? '', owner: key, from: forked ? 'branch' : undefined });
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
    st.lastPlatform ??= null;
    return st;
}

async function saveChatStore() {
    await ctx().saveMetadata();
    scheduleFeedWrite();
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

function truncate(text, n) {
    text = String(text ?? '');
    return text.length > n ? text.slice(0, n) + '…' : text;
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

function nowLabel(platformId) {
    const p = PLATFORMS[platformId];
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

function languageInstruction(platformId) {
    const fixed = resolvedLanguage();
    const tr = resolvedTranslation();
    const parts = [];
    if (fixed) parts.push(fillTpl(getPrompt('language_fixed'), { language: fixed }));
    else parts.push(fillTpl(getPrompt('language_native'), { language: PLATFORMS[platformId].lang }));
    if (tr) parts.push(fillTpl(getPrompt('translation'), { translation: tr }));
    else parts.push('Leave "body_tr" empty.');
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

    const log = recent
        .map(m => `${m.name}: ${truncate(m.text, 1500)}`)
        .join('\n\n');
    parts.push(`[Story so far — most recent messages, oldest first]\n${log || '(no messages yet)'}`);

    return parts.join('\n\n');
}

function commonBlocks(mode, platformId) {
    const vars = baseVars(platformId);
    return {
        system: fillTpl(getPrompt('system'), vars),
        task: fillTpl(getPrompt(mode === 'world' ? 'mode_world' : 'mode_meta'), vars),
        style: fillTpl(getPrompt(`guide_${platformId}`), vars),
        language: languageInstruction(platformId),
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
    const b = commonBlocks(mode, platformId);
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

/** Serialize one post and its comments for the continuation prompt. */
function serializeThread(feed, postIdx) {
    const post = feed.data.posts[postIdx];
    const userName = ctx().name1 || 'User';
    const lines = [];
    if (feed.data.board) lines.push(`Board: ${feed.data.board}`);

    if (feed.platform === 'fivech') {
        let n = 1;
        const items = [`>>${n} ${whoLine(post)}${playerMark(post, userName)}\nThread title: ${post.title}\n${post.body}`];
        for (const c of post.comments) {
            items.push(`>>${++n} ${whoLine(c)}${playerMark(c, userName)}\n${c.body}`);
            for (const r of c.replies) items.push(`>>${++n} ${whoLine(r)}${playerMark(r, userName)}\n${r.body}`);
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
            if (post.body || post.author) lines.push(`[first] ${whoLine(post)}${playerMark(post, userName)}: ${post.body}`);
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

    lines.push(`[POST] ${whoLine(post)}${playerMark(post, userName)}${post.title ? `\nTitle: ${post.title}` : ''}\n${post.body}`);
    const start = Math.max(0, post.comments.length - MAX_THREAD_ITEMS_IN_PROMPT);
    if (start > 0) lines.push('(… older comments omitted …)');
    post.comments.slice(start).forEach((c, k) => {
        const i = start + k;
        lines.push(`[c${i}] ${whoLine(c)}${playerMark(c, userName)}: ${c.body}`);
        for (const r of c.replies) lines.push(`    ↳ ${whoLine(r)}${playerMark(r, userName)}: ${r.body}`);
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
    const b = commonBlocks(feed.mode, feed.platform);
    const storyText = await buildContextBlock();
    const post = feed.data.posts[postIdx];
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

    return { system: b.system, user };
}

// ---------------------------------------------------------------------------
// Model call + parsing
// ---------------------------------------------------------------------------
async function callModel(system, user, signal) {
    const c = ctx();
    const s = getSettings();
    const svc = c.ConnectionManagerRequestService;

    if (s.profileId && svc) {
        const messages = [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ];
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const prompt = svc.constructPrompt(messages, s.profileId);
        const res = await svc.sendRequest(s.profileId, prompt, Number(s.maxTokens) || 4000, {
            stream: false,
            signal,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
        });
        if (typeof res === 'string') return res;
        return res?.content ?? '';
    }

    // Fallback: main API (generateRaw takes no AbortSignal, so check afterwards)
    const out = await c.generateRaw({
        systemPrompt: system,
        prompt: user,
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
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('JSON을 찾지 못했어요');
    let json = text.slice(start, end + 1);
    try {
        return JSON.parse(json);
    } catch {
        json = escapeControlCharsInStrings(json).replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(json);
    }
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
    return list.slice(0, 200).map(c => ({ ...normItem(c), reply_to: Number.isInteger(Number(c?.reply_to)) ? Number(c.reply_to) : -1 }));
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
    busy = true;
    abortCtl = new AbortController();
    setBusyUI(true, label);
    try {
        return await job({
            signal: abortCtl.signal,
            stillSameChat: () => ctx().getCurrentChatId() === chatIdAtStart,
        });
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

function newFeedObject({ platformId, mode, topic, data }) {
    return {
        id: ctx().uuidv4 ? ctx().uuidv4() : String(Date.now()) + randomId(4),
        platform: platformId,
        mode,
        topic: topic || '',
        createdAt: Date.now(),
        atMessage: (ctx().chat?.length ?? 1) - 1,
        data: data ?? { board: '', posts: [] },
    };
}

async function addFeed(feed) {
    const store = getChatStore();
    store.feeds.push(feed);
    if (store.feeds.length > MAX_FEEDS_PER_CHAT) {
        const removed = store.feeds.splice(0, store.feeds.length - MAX_FEEDS_PER_CHAT);
        const ids = new Set(removed.map(f => f.id));
        store.pins = store.pins.filter(p => !ids.has(p.feedId));
    }
    store.lastMode = feed.mode;
    store.lastPlatform = feed.platform;
    await saveChatStore();
}

/** Generate a brand new feed. */
async function generateFeed({ mode, platformId, topic = '', background = false }) {
    return runJob(`${PLATFORMS[platformId].label} 글을 불러오는 중…`, background, async ({ signal, stillSameChat }) => {
        const { system, user, topicNames } = await buildPostsPrompt({ mode, platformId, topic, background });
        const raw = await callModel(system, user, signal);
        if (!stillSameChat()) { toastr.info('채팅이 바뀌어서 결과를 버렸어요.'); return null; }
        const data = parseOrThrow(parseFeed, raw);
        const feed = newFeedObject({ platformId, mode, topic, data });
        feed.topics = topicNames;
        await addFeed(feed);

        if (background) {
            const store = getChatStore();
            if (!isOpen()) { store.unread += 1; await saveChatStore(); }
            toastr.success(`${PLATFORMS[platformId].label}에 새 글이 올라왔어요`, '커뮤니티', { onclick: () => openPanel(feed.id) });
            updateBadge();
            // Don't yank the reader away from what they're reading; only show it if nothing is open
            if (isOpen() && view === 'feed' && !getFeed(currentFeedId)) showFeed(feed.id);
        } else {
            showFeed(feed.id);
        }
        return feed;
    });
}

/** Append more posts to an existing feed. */
async function generateMorePosts(feedId, topic = '') {
    const feed = getFeed(feedId);
    if (!feed) return null;
    return runJob('글을 더 불러오는 중…', false, async ({ signal, stillSameChat }) => {
        const { system, user, topicNames } = await buildPostsPrompt({ mode: feed.mode, platformId: feed.platform, topic, avoidFeed: feed });
        if (topicNames.length) feed.topics = [...new Set([...(feed.topics ?? []), ...topicNames])];
        const raw = await callModel(system, user, signal);
        if (!stillSameChat()) return null;
        const data = parseOrThrow(parseFeed, raw);
        if (!getFeed(feed.id)) return null;
        feed.data.posts.push(...data.posts);
        if (!feed.data.board && data.board) feed.data.board = data.board;
        await saveChatStore();
        if (isOpen() && view === 'feed' && currentFeedId === feed.id) showFeed(feed.id, { keepScroll: true });
        toastr.success(`글 ${data.posts.length}개가 아래에 추가됐어요.`, '', { timeOut: 1500 });
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
        const b = commonBlocks(feed.mode, feed.platform);
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
        const { system, user } = await buildContinuePrompt({ feed, postIdx, count, playerJustPosted });
        const raw = await callModel(system, user, signal);
        if (!stillSameChat()) return null;
        const list = parseOrThrow(parseComments, raw);
        // the post (or its feed) may have been deleted or moved while generating
        if (!getFeed(feed.id)) return null;
        postIdx = feed.data.posts.indexOf(postRef);
        if (postIdx < 0) return null;
        const post = postRef;
        const existing = post.comments.length;
        const flat = !!PLATFORMS[feed.platform]?.flat;
        const chat = !!PLATFORMS[feed.platform]?.chat;
        for (const c of list) {
            if (isThreadFull(feed, post)) break;
            const { reply_to, ...item } = c;
            if (post.kind === 'dm' && !item.author) item.author = dmSideName(post.dm?.partner);
            if (!flat && reply_to >= 0 && reply_to < existing) {
                post.comments[reply_to].replies.push(item);
            } else {
                if (chat && reply_to >= 0 && reply_to < existing) item.ref = reply_to;
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
function playerItem(platformId, { as, nick, charName, body, title }) {
    const userName = ctx().name1 || 'User';
    const p = PLATFORMS[platformId];
    const author = nick?.trim() || (as === 'user' ? userName : as === 'char' ? charName : p.anon);
    let handle = '';
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    if (platformId === 'fivech') handle = randomId(8);
    else if (platformId === 'tdgall') handle = randomId(4);
    else if (platformId === 'twitter') handle = nick?.trim() || as !== 'mob' ? author.replace(/\s+/g, '_') : `user${digits}${randomId(3).toLowerCase()}`;
    else if (platformId === 'reddit') handle = nick?.trim() || as !== 'mob' ? author.replace(/\s+/g, '_') : `throwaway_${digits}`;
    const item = { isMe: true, as, author, handle, body, body_tr: '', time: nowLabel(platformId), likes: 0 };
    if (as === 'char') item.charName = charName;
    if (title !== undefined) Object.assign(item, { title, tags: [], views: 1, shares: 0, comments: [] });
    return item;
}

async function rememberIdentity({ as, nick, charName }) {
    const store = getChatStore();
    store.identity = { as, nick: nick ?? '', charName: charName ?? store.identity?.charName ?? '' };
    await saveChatStore();
}

/** Validate identity; returns false if a character name is required but missing. */
function checkIdentity(id) {
    if (id.as === 'char' && !id.charName?.trim()) {
        toastr.warning('어느 캐릭터로 쓸지 이름을 적어 주세요.');
        return false;
    }
    return true;
}

async function submitPlayerPost({ title, body, identity, react, board, category }) {
    if (!body.trim()) { toastr.warning('내용을 입력해 주세요.'); return; }
    if (!(await ensureFeedsReady())) return;
    if (!checkIdentity(identity)) return;
    await rememberIdentity(identity);

    // Append to the currently viewed feed when it matches the selection, otherwise start a new feed
    let feed = getFeed(currentFeedId);
    if (!feed || feed.platform !== selPlatform || feed.mode !== selMode) {
        feed = newFeedObject({ platformId: selPlatform, mode: selMode, data: { board: board?.trim() || '', posts: [] } });
        await addFeed(feed);
    }
    const pf = PLATFORMS[feed.platform];
    const post = playerItem(feed.platform, { ...identity, body: body.trim(), title: pf.hasTitle || pf.chat ? (title.trim() || (pf.chat ? '잡담' : '')) : '' });
    if (category) post.tags = [category];
    feed.data.posts.push(post);
    const postIdx = feed.data.posts.length - 1;
    if (pf.chat) dsSel.set(feed.id, postIdx);
    if (feed.platform === 'tdgall') tdOpen.add(`${feed.id}:${postIdx}`);
    await saveChatStore();
    showFeed(feed.id, { scrollToPost: postIdx });
    if (react) await generateMoreComments(feed.id, postIdx, { playerJustPosted: true });
}

async function submitPlayerComment({ feedId, postIdx, replyTo, body, identity, react }) {
    const feed = getFeed(feedId);
    const post = feed?.data.posts[postIdx];
    if (!post) return;
    if (!body.trim()) { toastr.warning('내용을 입력해 주세요.'); return; }
    if (!checkIdentity(identity)) return;
    if (isThreadFull(feed, post)) { toastr.warning('이 스레드는 꽉 찼어요. 후속 스레에 써 주세요.'); return; }
    await rememberIdentity(identity);

    const item = playerItem(feed.platform, { ...identity, body: body.trim() });
    const flat = !!PLATFORMS[feed.platform]?.flat;
    if (replyTo != null && replyTo >= 0 && post.comments[replyTo] && !flat) {
        post.comments[replyTo].replies.push(item);
    } else {
        if (PLATFORMS[feed.platform]?.chat && replyTo != null && post.comments[replyTo]) item.ref = replyTo;
        post.comments.push({ ...item, replies: [] });
    }
    composer = null;
    await saveChatStore();
    updatePost(feed.id, postIdx);
    if (isPinned(feed.id, postIdx)) refreshInjection();
    if (react) await generateMoreComments(feed.id, postIdx, { playerJustPosted: true });
}

async function deletePlayerItem(feedId, postIdx, ci, ri) {
    const feed = getFeed(feedId);
    const post = feed?.data.posts[postIdx];
    if (!post) return;
    const target = ci == null ? post : (ri == null ? post.comments[ci] : post.comments[ci]?.replies[ri]);
    if (!target?.isMe && !(ci == null && post.kind === 'dm')) return;
    if (ci == null) {
        // Delete the whole post (only allowed for player posts); drop pins pointing at it and shift later ones
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
        refreshInjection();
    } else if (ri == null) {
        post.comments.splice(ci, 1);
    } else {
        post.comments[ci]?.replies.splice(ri, 1);
    }
    await saveChatStore();
    if (ci == null) showFeed(feedId, { keepScroll: true });
    else updatePost(feedId, postIdx);
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

function playerLanguage(platformId) {
    const fixed = resolvedLanguage();
    return fixed
        ? fillTpl(getPrompt('language_fixed'), { language: fixed })
        : fillTpl(getPrompt('language_native'), { language: PLATFORMS[platformId].lang });
}

/** Topic for a player-written post: one of the selected topic chips (when the scope allows manual use). */
function pickPlayerTopic() {
    if (getSettings().topicScope === 'auto') return null;
    const topics = selectedTopics();
    return topics.length ? topics[Math.floor(Math.random() * topics.length)] : null;
}

async function aiWrite({ kind, mode, platformId, identity, instruction, draft, feed, postIdx, replyTo, anchorN, topic, dmTo }) {
    return runJob('글을 쓰는 중…', false, async ({ signal, stillSameChat }) => {
        const b = commonBlocks(mode, platformId);
        const storyText = await buildContextBlock();
        const dmPost = feed && postIdx != null && feed.data.posts[postIdx]?.kind === 'dm';
        const kindLabel = dmPost || kind === 'dm' ? 'direct message'
            : PLATFORMS[platformId]?.chat ? 'chat message'
            : ({ post: platformId === 'fivech' ? 'thread (title + opening post)' : 'post', comment: 'comment', reply: 'reply' }[kind] ?? kind);
        const parts = [
            `<story_context>\n${storyText}\n</story_context>`,
            `<task>\n${b.task}\n</task>`,
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
        parts.push(`<language>\n${playerLanguage(platformId)}\n</language>`);
        if (b.extra) parts.push(`<extra_instructions>\n${b.extra}\n</extra_instructions>`);
        parts.push(fillTpl(getPrompt('player_write'), { ...b.vars, kind: kindLabel, author: describeAuthor(identity, platformId) }));

        const raw = await callModel(b.system, parts.join('\n\n'), signal);
        if (!stillSameChat()) return null;
        let title = '';
        let body = '';
        try {
            const data = extractJson(raw);
            title = String(data.title ?? '').slice(0, 500);
            body = String(data.body ?? '');
        } catch {
            body = String(raw ?? '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/gi, '').trim();
        }
        if (!body.trim()) throw Object.assign(new Error('빈 글이 왔어요'), { isParse: true, raw });
        return { title, body };
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
    lines.push(`${head}${authorLabel(post)}: ${truncate(post.body, 500)}`);
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
        lines.push(`  ↳ ${authorLabel(c)}: ${truncate(c.body, storyAuthor(c) ? 400 : 150)}`);
        const rs = c.replies.filter(r => storyAuthor(r));
        const others = c.replies.filter(r => !storyAuthor(r)).slice(0, storyAuthor(c) ? 3 : 1);
        for (const r of c.replies) {
            if (rs.includes(r) || others.includes(r)) lines.push(`      ↳ ${authorLabel(r)}: ${truncate(r.body, storyAuthor(r) ? 400 : 120)}`);
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
        c.setExtensionPrompt(INJECT_KEY, '', PROMPT_IN_CHAT, Number(s.pinDepth) || 4, false, ROLE_SYSTEM);
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
    c.setExtensionPrompt(INJECT_KEY, blocks.join('\n\n'), PROMPT_IN_CHAT, Number(s.pinDepth) || 4, false, ROLE_SYSTEM);
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
let composer = null;   // { feedId, postIdx, replyTo }

function txt(o, platform) {
    const tr = o.body_tr || o.body_ko;
    const useTr = showTr && tr && String(tr).trim();
    return fmt(useTr ? tr : o.body, platform);
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
function itemLinks(feed, i, ci, ri, o, n = null) {
    const links = [];
    if (ri == null && feed.platform !== 'fivech') {
        links.push(`<a class="stcm-link" data-act="reply" data-feed="${esc(feed.id)}" data-idx="${i}" data-ci="${ci}">답글</a>`);
    }
    if (feed.platform === 'fivech') {
        const place = ci == null ? 'op' : (ri == null ? `c${ci}` : `r${ci}.${ri}`);
        links.push(`<a class="stcm-link" data-act="anchor" data-feed="${esc(feed.id)}" data-idx="${i}" data-n="${n}" data-place="${place}">&gt;&gt;${n}</a>`);
    }
    if (o?.isMe) {
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
        <button class="stcm-pin ${on ? 'on' : ''}" data-act="pin" data-feed="${esc(feed.id)}" data-idx="${i}" title="본편에 반영"><i class="fa-solid fa-thumbtack"></i>${on ? '반영 중' : '반영'}</button>
        ${post.isMe || post.kind === 'dm' ? `<button data-act="del-post" data-feed="${esc(feed.id)}" data-idx="${i}" title="${post.kind === 'dm' ? 'DM 삭제' : '내 글 삭제'}"><i class="fa-solid fa-trash-can"></i></button>` : ''}
    </div>`;
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
            ? `<div class="stcm-5-res stcm-closed"><div class="stcm-5-head"><span class="n">${threadCap('fivech') + 1}</span> 名前：<span class="name">${threadCap('fivech') + 1}</span> <span class="id">Over ${threadCap('fivech')} Thread</span></div><div class="stcm-body">このスレッドは${threadCap('fivech')}を超えました。<br>新しいスレッドを立ててください。</div></div>`
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

function identityControls(draft) {
    const store = getChatStore();
    const id = draft?.as ? draft : (store?.identity ?? { as: 'mob', nick: '', charName: '' });
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
        <input class="stcm-cp-nick" type="text" maxlength="40" value="${esc(id.nick)}" placeholder="닉네임 (비우면 기본 이름)">
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
    const ident = isDm ? `<div class="stcm-cp-target">보내는 사람: <b>${esc(dmSideName(post.dm?.me))}</b> → <b>${esc(dmPartnerLabel(post))}</b></div>` : identityControls(composer.draft);
    return `<div class="stcm-composer" data-feed="${esc(feed.id)}" data-idx="${i}">
        ${ident}
        ${target ? `<div class="stcm-cp-target">↳ <b>${esc(target.author)}</b>님에게 ${chat ? '답장' : '답글'} <a class="stcm-link" data-act="reply-cancel">취소</a></div>` : ''}
        <textarea class="stcm-cp-body" rows="3" placeholder="${esc(ph)}">${esc(composer.draft?.body ?? '')}</textarea>
        <div class="stcm-cp-ai">
            <input class="stcm-cp-inst" type="text" maxlength="500" value="${esc(composer.draft?.inst ?? '')}" placeholder="AI에게 지시 (선택) — 비우면 알아서">
            <button data-act="ai-write-comment" title="고른 신분으로 AI가 써 줘요. 칸에 글이 있으면 그걸 다듬어요."><i class="fa-solid fa-wand-magic-sparkles"></i> AI로 쓰기</button>
        </div>
        <div class="stcm-cp-foot">
            <label class="stcm-cp-check"><input type="checkbox" class="stcm-cp-react" checked> 반응 생성</label>
            <button data-act="cancel-comment">취소</button>
            <button class="primary" data-act="submit-comment"><i class="fa-solid fa-paper-plane"></i> 등록</button>
        </div>
    </div>`;
}

function postFooter(feed, i) {
    return postActions(feed, i) + slotAt(feed, i, 'end');
}

// ---------------------------------------------------------------------------
// Renderers per platform
// ---------------------------------------------------------------------------
const renderers = {
    naver(feed) {
        const d = feed.data;
        return `<div class="stcm-skin stcm-naver">
            <div class="stcm-n-top"><i class="fa-solid fa-mug-hot"></i> ${esc(d.board || '카페')}</div>
            ${d.posts.map((p, i) => `
            <article class="stcm-n-post" data-post="${i}">
                <div class="stcm-n-board">${esc(p.tags?.[0] || '자유게시판')}</div>
                <h3>${esc(p.title)}</h3>
                <div class="stcm-n-meta">${avatar(p.author)}<b>${esc(p.author)}</b>${meBadge(p)}<span>${esc(p.time)}</span><span>조회 ${num(p.views, 'ko')}</span></div>
                <div class="stcm-body">${txt(p, 'naver')}</div>
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
            ${d.posts.map((p, i) => `
            <article class="stcm-dc-post" data-post="${i}">
                <h3>${esc(p.title)} <span class="stcm-dc-cnt">[${p.comments.reduce((a, c) => a + 1 + c.replies.length, 0)}]</span></h3>
                <div class="stcm-dc-meta"><span>${who(p)}</span><span>${esc(p.time)}</span><span>조회 ${num(p.views)}</span><span>추천 ${num(p.likes)}</span></div>
                <div class="stcm-body">${txt(p, 'dcinside')}</div>
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
                <div class="stcm-body">${txt(c, 'reddit')}</div>
                <div class="stcm-r-cact"><i class="fa-solid fa-arrow-up"></i> ${num(c.likes)} <i class="fa-solid fa-arrow-down"></i>${itemLinks(feed, i, ci, ri, c)}</div>
                ${ri == null ? (c.replies ?? []).map((r, rj) => comment(r, i, ci, rj)).join('') + slotAt(feed, i, `c${ci}`) : ''}
            </div>`;
        return `<div class="stcm-skin stcm-reddit">
            <div class="stcm-r-top"><i class="fa-brands fa-reddit-alien"></i> ${esc(sub)}</div>
            ${d.posts.map((p, i) => `
            <article class="stcm-r-post" data-post="${i}">
                <div class="stcm-r-meta"><b>${esc(sub)}</b> · Posted by ${esc(uname(p))}${meBadge(p)} · ${esc(p.time)}</div>
                <h3>${esc(p.title)}${p.tags?.[0] ? ` <span class="stcm-flair">${esc(p.tags[0])}</span>` : ''}</h3>
                <div class="stcm-body">${txt(p, 'reddit')}</div>
                <div class="stcm-r-act"><span class="vote"><i class="fa-solid fa-arrow-up"></i> ${num(p.likes)} <i class="fa-solid fa-arrow-down"></i></span><span><i class="fa-regular fa-comment"></i> ${p.comments.reduce((a, c) => a + 1 + c.replies.length, 0)} Comments</span></div>
                <div class="stcm-r-comments">${p.comments.map((c, ci) => comment(c, i, ci, null)).join('')}</div>
                ${postFooter(feed, i)}
            </article>`).join('')}
        </div>`;
    },

    twitter(feed) {
        const d = feed.data;
        const handle = (o) => `@${esc(String(o.handle || o.author || 'user').replace(/^@/, ''))}`;
        const tweet = (o, isReply, links = '', replyCount = 0, key = '') => `
            <div class="stcm-t-tweet ${isReply ? 'reply' : ''}" data-k="${key}">
                ${avatar(o.author)}
                <div class="stcm-t-main">
                    <div class="stcm-t-head"><b>${esc(o.author)}</b>${meBadge(o)}<span>${handle(o)} · ${esc(o.time)}</span></div>
                    <div class="stcm-body">${txt(o, 'twitter')}</div>
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
            ${d.posts.map((p, i) => `
            <article class="stcm-t-thread" data-post="${i}">
                ${tweet(p, false, '', p.comments.length, `${i}.op`)}
                ${p.comments.map((c, ci) => tweet(c, true, itemLinks(feed, i, ci, null, c), c.replies.length, `${i}.${ci}`) + c.replies.map((r, ri) => tweet(r, true, itemLinks(feed, i, ci, ri, r), 0, `${i}.${ci}.${ri}`)).join('') + (slotAt(feed, i, `c${ci}`) ? `<div class="stcm-t-foot">${slotAt(feed, i, `c${ci}`)}</div>` : '')).join('')}
                <div class="stcm-t-foot">${postFooter(feed, i)}</div>
            </article>`).join('')}
        </div>`;
    },

    fivech(feed) {
        const d = feed.data;
        const res = (o, n, links, key) => `
            <div class="stcm-5-res" data-k="${key}">
                <div class="stcm-5-head"><span class="n">${n}</span> 名前：<span class="name">${esc(o.author || '名無しさん')}</span>${meBadge(o)} <span class="date">${esc(o.time)}</span> <span class="id">ID:${esc(o.handle || '????????')}</span></div>
                <div class="stcm-body">${txt(o, 'fivech')}</div>
                ${links}
            </div>`;
        return `<div class="stcm-skin stcm-5ch">
            <div class="stcm-5-top">${esc(d.board || '板')}</div>
            ${d.posts.map((p, i) => {
                let n = 1;
                const all = [res(p, n, itemLinks(feed, i, null, null, p, 1), `${i}.op`) + slotAt(feed, i, 'op')];
                p.comments.forEach((c, ci) => {
                    all.push(res(c, ++n, itemLinks(feed, i, ci, null, c, n), `${i}.${ci}`) + slotAt(feed, i, `c${ci}`));
                    c.replies.forEach((r, ri) => {
                        all.push(res(r, ++n, itemLinks(feed, i, ci, ri, r, n), `${i}.${ci}.${ri}`) + slotAt(feed, i, `r${ci}.${ri}`));
                    });
                });
                return `<article class="stcm-5-thread" data-post="${i}">
                    <h3>${esc(p.title)} <small>(${n})</small></h3>
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
            ${d.posts.map((p, i) => `
            <article class="stcm-w-post" data-post="${i}">
                <div class="stcm-w-head">${avatar(p.author)}<div><b>${esc(p.author)}</b>${meBadge(p)}<small>${esc(p.time)} 来自 微博客户端</small></div></div>
                ${p.title ? `<h3>${esc(p.title)}</h3>` : ''}
                <div class="stcm-body">${txt(p, 'weibo')}</div>
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
        const nameOf = (p) => (p.kind === 'dm' ? dmPartnerLabel(p) : String(p.title || '일반').replace(/^#\s*/, ''));
        const msgHtml = (o, i, ci, ri, p) => {
            const refTo = p && o.ref != null ? p.comments[o.ref] : null;
            const canDm = !o.isMe && o.author && p?.kind !== 'dm';
            return `<div class="stcm-ds-msg" data-k="${i}.${ci ?? 'op'}${ri != null ? '.' + ri : ''}">
                ${avatar(o.author)}
                <div class="stcm-ds-mbody">
                    ${refTo ? `<div class="stcm-ds-ref"><i class="fa-solid fa-reply"></i> <b>${esc(refTo.author)}</b> ${esc(truncate(refTo.body, 60))}</div>` : ''}
                    <div class="stcm-ds-mhead"><b style="color:${hashColor(o.author)}">${esc(o.author || 'user')}</b>${meBadge(o)}<span>${esc(o.time)}</span>${canDm ? `<a class="stcm-link" data-act="dm-new" data-feed="${esc(feed.id)}" data-to="${esc(o.author)}" title="이 사람에게 DM">DM</a>` : ''}</div>
                    <div class="stcm-body">${txt(o, 'discord')}</div>
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

    tdgall(feed) {
        const d = feed.data;
        const st = tdState(feed.id);
        const items = d.posts.map((p, i) => ({ p, i }));
        const base = tdBaseNo(feed.id);
        const order = st.sort === 'best'
            ? [...items].sort((a, b) => (b.p.likes || 0) - (a.p.likes || 0))
            : [...items].reverse();   // newest first, like a real board
        const best = tdBestList(feed);
        const bi = Math.max(0, Math.min(st.best, best.length - 1));
        const counts = {};
        for (const { p } of items) counts[tdCatOf(p)] = (counts[tdCatOf(p)] ?? 0) + 1;
        const fid = esc(feed.id);
        const who = (o) => `<b>${esc(o.author || 'ㅇㅇ')}</b>${o.handle ? `<small class="stcm-td-code">${esc(o.handle)}</small>` : ''}${meBadge(o)}`;
        const catList = TD_CATS.map(c => `<button class="stcm-td-catitem ${c === st.cat ? 'active' : ''}" data-act="td-cat" data-feed="${fid}" data-cat="${esc(c)}"><span class="ico">${TD_ICONS[c] ?? '•'}</span><span>${c === '전체' ? '전체 글' : esc(c)}</span>${c !== '전체' && counts[c] ? `<small>${counts[c]}</small>` : ''}${c === '전체' ? '<i class="fa-solid fa-chevron-right"></i>' : ''}</button>`).join('');
        const chips = TD_CATS.map(c => `<button class="stcm-td-chip ${c === st.cat ? 'active' : ''}" data-act="td-cat" data-feed="${fid}" data-cat="${esc(c)}"><span class="ico">${TD_ICONS[c] ?? '•'}</span>${esc(c)}</button>`).join('');
        const rows = order.map(({ p, i }) => {
            const cat = tdCatOf(p);
            const n = p.comments.reduce((a, c) => a + 1 + c.replies.length, 0);
            const open = tdOpen.has(`${feed.id}:${i}`) || (composer && composer.feedId === feed.id && composer.postIdx === i);
            return `<article class="stcm-td-post ${open ? 'open' : ''} ${tdVisible(feed, p) ? '' : 'stcm-hide'}" data-post="${i}">
                <div class="stcm-td-row" data-act="td-toggle" data-feed="${fid}" data-idx="${i}">
                    <span class="no">${base + i + 1}</span>
                    <span class="cat">${esc(cat)}</span>
                    <span class="tt">${p.isMe ? '<i class="fa-solid fa-pen-nib stcm-td-mine"></i>' : ''}${esc(p.title || truncate(p.body, 40))}${n ? ` <em>[${n}]</em>` : ''}</span>
                    <span class="au">${esc(p.author || 'ㅇㅇ')}</span>
                    <span class="tm">${esc(p.time)}</span>
                    <span class="vw">${num(p.views, 'ko')}</span>
                    <span class="rc">${num(p.likes)}</span>
                </div>
                <div class="stcm-td-detail">
                    <div class="stcm-td-dhead">
                        <span class="stcm-td-badge">${esc(cat)}</span>
                        <h3>${esc(p.title)}</h3>
                        <div class="stcm-td-meta">${who(p)}<span>${esc(p.time)}</span><span>조회 ${num(p.views, 'ko')}</span><span>추천 ${num(p.likes)}</span><span>댓글 ${n}</span></div>
                    </div>
                    <div class="stcm-body">${txt(p, 'tdgall')}</div>
                    <div class="stcm-td-rec"><span class="up"><i class="fa-solid fa-thumbs-up"></i> 추천 ${num(p.likes)}</span><span><i class="fa-regular fa-thumbs-down"></i> 비추 ${Math.floor((Number(p.likes) || 0) / 9)}</span></div>
                    <div class="stcm-td-comments">
                    ${p.comments.length ? `<div class="stcm-td-ctitle">댓글 <b>${n}</b></div>` : ''}
                    ${p.comments.map((c, ci) => `
                        <div class="stcm-td-c" data-k="${i}.${ci}"><div class="h">${who(c)}<span>${esc(c.time)}</span></div><div class="stcm-body">${txt(c, 'tdgall')}</div>${itemLinks(feed, i, ci, null, c)}</div>
                        ${c.replies.map((r, ri) => `<div class="stcm-td-c reply" data-k="${i}.${ci}.${ri}"><div class="h"><i class="fa-solid fa-reply fa-rotate-180"></i> ${who(r)}<span>${esc(r.time)}</span></div><div class="stcm-body">${txt(r, 'tdgall')}</div>${itemLinks(feed, i, ci, ri, r)}</div>`).join('')}
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
                <a class="tt" data-act="td-open" data-feed="${fid}" data-idx="${bestPost.i}">${esc(bestPost.p.title || truncate(bestPost.p.body, 40))}${bestPost.p.comments.length ? ` <em>[${bestPost.p.comments.length}]</em>` : ''}</a>
                <span class="pager"><button data-act="td-best" data-feed="${fid}" data-dir="-1" aria-label="이전"><i class="fa-solid fa-chevron-left"></i></button>${bi + 1}/${best.length}<button data-act="td-best" data-feed="${fid}" data-dir="1" aria-label="다음"><i class="fa-solid fa-chevron-right"></i></button></span>
            </div>` : '';
        return `<div class="stcm-skin stcm-tdgall">
            <div class="stcm-td-brand"><span class="logo"><span class="mark">🐧</span>투디갤</span>${d.board ? `<span class="board">${esc(d.board)}</span>` : ''}</div>
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
                        <div class="stcm-td-head"><span class="no">번호</span><span class="cat">카테고리</span><span class="tt">제목</span><span class="au">글쓴이</span><span class="tm">날짜</span><span class="vw">조회</span><span class="rc">추천</span></div>
                        ${rows || '<div class="stcm-empty">글이 없어요.</div>'}
                        <div class="stcm-td-none stcm-hide">조건에 맞는 글이 없어요.</div>
                    </div>
                </div>
            </div>
            <button class="stcm-td-write" data-act="td-write" data-feed="${fid}"><i class="fa-solid fa-pen-to-square"></i> 글쓰기</button>
        </div>`;
    },

    tieba(feed) {
        const d = feed.data;
        const bar = String(d.board || '贴').replace(/吧$/, '');
        return `<div class="stcm-skin stcm-tieba">
            <div class="stcm-tb-top"><i class="fa-solid fa-paw"></i> ${esc(bar)}吧</div>
            ${d.posts.map((p, i) => {
                let floor = 1;
                return `<article class="stcm-tb-thread" data-post="${i}">
                <h3>${esc(p.title)}</h3>
                <div class="stcm-tb-floor op">
                    <div class="stcm-tb-user">${avatar(p.author)}<b>${esc(p.author)}</b><span class="lz">楼主</span>${meBadge(p)}</div>
                    <div class="stcm-body">${txt(p, 'tieba')}</div>
                    <small>${floor}楼 · ${esc(p.time)}</small>
                </div>
                ${p.comments.map((c, ci) => `
                <div class="stcm-tb-floor" data-k="${i}.${ci}">
                    <div class="stcm-tb-user">${avatar(c.author)}<b>${esc(c.author)}</b>${c.author === p.author ? '<span class="lz">楼主</span>' : ''}${meBadge(c)}</div>
                    <div class="stcm-body">${txt(c, 'tieba')}</div>
                    <small>${++floor}楼 · ${esc(c.time)}</small>${itemLinks(feed, i, ci, null, c)}
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
const tdCat = new Map();       // feedId → 투디갤 board tab
const tdOpen = new Set();      // `${feedId}:${idx}` posts expanded in the 투디갤 list
const TD_CATS = ['전체', '투디', '웹툰', '소설', '게임', 'AI', '괴담', '남극'];

const TD_ICONS = { '전체': '📌', '투디': '💬', '웹툰': '📺', '소설': '📖', '게임': '🎮', 'AI': '🤖', '괴담': '👻', '남극': '🐧' };
const tdStates = new Map();   // feedId → { cat, sort, q, filter, best }

function tdState(feedId) {
    if (!tdStates.has(feedId)) tdStates.set(feedId, { cat: tdCat.get(feedId) ?? '전체', sort: 'latest', q: '', filter: 'all', best: 0 });
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
    if (st.cat !== '전체' && tdCatOf(p) !== st.cat) return false;
    if (st.filter === 'me' && !(p.isMe || p.comments.some(c => c.isMe || c.replies.some(r => r.isMe)))) return false;
    if (st.filter === 'best') {
        const cut = tdBestList(feed).at(-1)?.p.likes ?? Infinity;
        if ((p.likes || 0) < cut || !(p.likes > 0)) return false;
    }
    const q = st.q.trim().toLowerCase();
    if (q && !`${p.title} ${p.body}`.toLowerCase().includes(q)) return false;
    return true;
}

/** Re-apply tab / filter / search without re-rendering (no jumps, keeps typing focus). */
function tdApply(feedId) {
    const feed = getFeed(feedId);
    const skin = document.querySelector('#stcm_feed .stcm-tdgall');
    if (!feed || !skin) return;
    const st = tdState(feedId);
    let shown = 0;
    skin.querySelectorAll('.stcm-td-post').forEach(a => {
        const p = feed.data.posts[Number(a.dataset.post)];
        const vis = p ? tdVisible(feed, p) : false;
        a.classList.toggle('stcm-hide', !vis);
        if (vis) shown++;
    });
    skin.querySelector('.stcm-td-none')?.classList.toggle('stcm-hide', shown > 0 || !feed.data.posts.length);
    skin.querySelectorAll('[data-act="td-cat"]').forEach(b => b.classList.toggle('active', b.dataset.cat === st.cat));
    skin.querySelectorAll('[data-act="td-filter"]').forEach(b => b.classList.toggle('active', b.dataset.filter === st.filter));
}

function tdCatOf(p) {
    const t = String(p?.tags?.[0] ?? '').replace(/(갤러리|갤|게시판)$/, '').trim();
    const hit = TD_CATS.find(c => c !== '전체' && c.toLowerCase() === t.toLowerCase());
    return hit ?? '투디';
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
    return dmSideName(p.dm?.partner) || p.title || 'DM';
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

let dmDraft = null;   // { feedId, to }

function showDmCompose(feedId, toName = '') {
    const feed = getFeed(feedId);
    if (!feed) return;
    leaveFeed();
    view = 'dm-new';
    dmDraft = { feedId, to: toName };
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
    const body = box.querySelector('.stcm-cp-body').value.trim();
    const react = box.querySelector('.stcm-cp-react').checked;
    if (!body && !react) { toastr.warning('첫 메시지를 쓰거나 "상대가 먼저 말 걸기"를 켜 주세요.'); return; }
    await rememberIdentity(me);
    const post = {
        kind: 'dm',
        dm: { me: { as: me.as, nick: me.nick, charName: me.charName }, partner },
        author: '', handle: '', title: dmSideName(partner), body: '', body_tr: '', time: '', likes: 0, views: 0, shares: 0, tags: [],
        comments: [],
    };
    if (body) post.comments.push({ ...playerItem(feed.platform, { ...me, body }), replies: [] });
    feed.data.posts.push(post);
    const idx = feed.data.posts.length - 1;
    dsSel.set(feed.id, idx);
    await saveChatStore();
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
    const t = e.target;
    if (t.classList.contains('stcm-cp-as')) {
        const row = t.closest('.stcm-cp-row');
        const charInput = row?.querySelector('.stcm-cp-char');
        if (charInput) charInput.style.display = t.value === 'char' ? '' : 'none';
        if (t.value === 'char') charInput?.focus();
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
let view = 'feed';   // feed | history | pins | compose | wi | topics
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
          <div class="stcm-hbtns">
            <button id="stcm_btn_write" title="글쓰기"><i class="fa-solid fa-pen"></i></button>
            <button id="stcm_btn_fold" title="위쪽 메뉴 접기/펴기"><i class="fa-solid fa-chevron-up"></i></button>
            <button id="stcm_btn_theme" title="화면 테마"><i class="fa-solid fa-circle-half-stroke"></i></button>
            <button id="stcm_btn_wi" title="참고할 월드 인포"><i class="fa-solid fa-book-atlas"></i></button>
            <button id="stcm_btn_history" title="지난 피드"><i class="fa-solid fa-clock-rotate-left"></i></button>
            <button id="stcm_btn_pins" title="반영 중인 글"><i class="fa-solid fa-thumbtack"></i><span id="stcm_pin_count"></span></button>
            <button id="stcm_btn_close" title="닫기"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>
        <div class="stcm-controls">
          <div class="stcm-seg" id="stcm_modes">
            ${Object.entries(MODES).map(([id, m]) => `<button data-mode="${id}"><i class="fa-solid ${m.icon}"></i> ${m.label}</button>`).join('')}
          </div>
          <div class="stcm-chips" id="stcm_platforms">
            ${Object.entries(PLATFORMS).map(([id, p]) => `<button data-platform="${id}" class="pf-${id}"><i class="${p.brand ? 'fa-brands' : 'fa-solid'} ${p.icon}"></i> ${p.label}</button>`).join('')}
          </div>
          <div class="stcm-chips stcm-topics" id="stcm_topics"></div>
          <div class="stcm-genrow">
            <input id="stcm_topic" type="text" placeholder="주제/요청 (선택) — 예: 방금 고백 장면 반응, 축제 날 시장 풍경" />
            <select id="stcm_lang" title="생성 언어">${languageOptions(true, false)}</select>
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
        selMode = b.dataset.mode;
        syncSelectors();
        if (view === 'compose') showCompose();
    });
    document.getElementById('stcm_platforms').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-platform]');
        if (!b) return;
        selPlatform = b.dataset.platform;
        syncSelectors();
        if (view === 'compose') showCompose();
    });
    document.getElementById('stcm_feed').addEventListener('click', onFeedClick);
    document.getElementById('stcm_feed').addEventListener('change', onFeedChange);
    document.getElementById('stcm_feed').addEventListener('input', (e) => {
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
        if (e.target.closest('[data-act="err-close"]')) document.getElementById('stcm_errbox').classList.remove('show');
    });
    document.getElementById('stcm_topics').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const s = getSettings();
        if (b.dataset.topicAct === 'edit') { showTopicEditor(); return; }
        if (b.dataset.topicAct === 'free') s.topicSelected = [];
        else if (b.dataset.topicAct === 'mix') s.topicMix = s.topicMix === 'mix' ? 'each' : 'mix';
        else if (b.dataset.topic) {
            const set = new Set(s.topicSelected ?? []);
            if (set.has(b.dataset.topic)) set.delete(b.dataset.topic); else set.add(b.dataset.topic);
            s.topicSelected = [...set];
        }
        saveSettings();
        renderTopicChips();
        syncTopicSettings();
    });
    document.getElementById('stcm_feedbar').addEventListener('click', onFeedClick);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !isOpen()) return;
        // let SillyTavern popups (also <dialog>s) on top of ours close first
        const ours = document.getElementById('stcm_overlay');
        if ([...document.querySelectorAll('dialog[open], .popup[open]')].some(d => d !== ours)) return;
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
    if (act === 'feed-export') { exportFeeds(); return; }
    if (act === 'feed-import') { document.getElementById('stcm_import_file')?.click(); return; }
    if (act === 'import-cancel') { pendingImport = null; showHistory(); return; }
    if (act === 'import-merge' || act === 'import-replace') {
        const withPins = document.getElementById('stcm_import_pins')?.checked ?? false;
        if (act === 'import-replace') {
            const { Popup, POPUP_RESULT } = ctx();
            const ok = Popup?.show?.confirm
                ? (await Popup.show.confirm('피드 바꾸기', '이 채팅의 지금 피드와 반영 목록을 지우고 파일 내용으로 바꿀까요? (먼저 내보내기로 백업해 두면 안전해요)')) === POPUP_RESULT.AFFIRMATIVE
                : confirm('지금 피드를 파일 내용으로 바꿀까요?');
            if (!ok) return;
        }
        await applyImport(act === 'import-replace' ? 'replace' : 'merge', withPins);
        return;
    }
    if (act === 'goto-post') {
        document.querySelector(`#stcm_feed [data-post="${el.dataset.idx}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
    }
    if (act?.startsWith('topic')) { await onTopicAction(el); return; }
    if (act === 'goto-post') {
        document.querySelector(`#stcm_feed [data-post="${el.dataset.idx}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
    }
    if (act === 'topics-save' || act === 'topics-reset') {
        const s = getSettings();
        s.topics = act === 'topics-reset' ? defaultSettings.topics : document.getElementById('stcm_topic_text').value;
        s.topicScope = document.getElementById('stcm_topic_scope').value;
        const names = new Set(parseTopics().map(t => t.name));
        s.topicSelected = (s.topicSelected ?? []).filter(n => names.has(n));
        saveSettings();
        syncTopicSettings();
        renderTopicChips();
        if (act === 'topics-reset') { showTopicEditor(); return; }
        toastr.success('주제 목록을 저장했어요.');
        showFeed(currentFeedId);
        return;
    }
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
        composer = next ? { ...next, draft: next.draft ?? keepDraft } : null;
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
        if (tdOpen.has(key)) tdOpen.delete(key); else tdOpen.add(key);
        art?.classList.toggle('open', tdOpen.has(key));
        return;
    }
    if (act === 'td-cat' || act === 'td-filter') {
        const st = tdState(feedId);
        if (act === 'td-cat') { st.cat = el.dataset.cat; tdCat.set(feedId, st.cat); }
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
        tdOpen.add(`${feedId}:${idx}`);
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
        if (composer) { composer.replyTo = null; }
        updatePost(composer?.feedId ?? feedId, composer?.postIdx ?? idx, { focusComposer: true });
        return;
    }
    if (act === 'cancel-comment') {
        const at = composer?.postIdx ?? idx;
        const fid = composer?.feedId ?? feedId;
        composer = null;
        updatePost(fid, at);
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
        });
        return;
    }
    if (act === 'ai-write-post') {
        const box = el.closest('.stcm-compose-view');
        const identity = readIdentity(box);
        if (!checkIdentity(identity)) return;
        const feed = getFeed(currentFeedId);
        const appending = feed && feed.platform === selPlatform && feed.mode === selMode;
        const bodyEl = box.querySelector('.stcm-cp-body');
        const out = await aiWrite({
            kind: 'post', mode: selMode, platformId: selPlatform, identity,
            instruction: box.querySelector('.stcm-cp-inst').value,
            draft: bodyEl.value,
            feed: appending ? feed : { data: { board: box.querySelector('.stcm-cp-board')?.value ?? '' } },
            topic: box.querySelector('.stcm-cp-inst').value.trim() ? null : pickPlayerTopic(),
        });
        if (out && document.body.contains(bodyEl)) {
            const titleEl = box.querySelector('.stcm-cp-title');
            if (titleEl && out.title && !titleEl.value.trim()) titleEl.value = out.title;
            bodyEl.value = out.body;
            toastr.success('AI가 쓴 글을 채웠어요. 고친 뒤 올리기를 누르세요.', '', { timeOut: 2000 });
        }
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
        const out = await aiWrite({
            kind: composer?.replyTo != null ? 'reply' : 'comment', mode: feed.mode, platformId: feed.platform, identity,
            instruction: box.querySelector('.stcm-cp-inst').value,
            draft: anchor && bodyEl.value.trim() === `>>${anchor}` ? '' : bodyEl.value,
            feed, postIdx: pi, replyTo: composer?.replyTo ?? null, anchorN: anchor,
        });
        // the composer may have been re-rendered while generating
        const live = document.querySelector(`#stcm_feed .stcm-composer[data-feed="${CSS.escape(fid)}"][data-idx="${pi}"] .stcm-cp-body`);
        if (out && live) {
            live.value = out.body;
            if (composer) composer.draft = { ...(composer.draft ?? {}), body: out.body };
            try { live.focus({ preventScroll: true }); } catch { /* ignore */ }
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
    if (act === 'del-post') {
        const { Popup, POPUP_RESULT } = ctx();
        const isDm = getFeed(feedId)?.data.posts[idx]?.kind === 'dm';
        const ok = Popup?.show?.confirm
            ? (await Popup.show.confirm(isDm ? 'DM 삭제' : '내 글 삭제', isDm ? '이 DM 대화를 모두 지울까요?' : '이 글과 달린 댓글을 모두 지울까요?')) === POPUP_RESULT.AFFIRMATIVE
            : confirm('지울까요?');
        if (ok) await deletePlayerItem(feedId, idx, null, null);
        return;
    }
    if (act === 'del-item') {
        await deletePlayerItem(feedId, idx, Number(el.dataset.ci), el.dataset.ri != null ? Number(el.dataset.ri) : null);
        return;
    }
    if (act === 'submit-post') {
        const box = el.closest('.stcm-compose-view');
        await submitPlayerPost({
            title: box.querySelector('.stcm-cp-title')?.value ?? '',
            body: box.querySelector('.stcm-cp-body').value,
            board: box.querySelector('.stcm-cp-board')?.value ?? '',
            category: box.querySelector('.stcm-cp-cat')?.value ?? '',
            identity: readIdentity(box),
            react: box.querySelector('.stcm-cp-react').checked,
        });
        return;
    }
    if (act === 'cancel-post') {
        showFeed(currentFeedId);
        return;
    }

    if (el.dataset.openFeed) { showFeed(el.dataset.openFeed); return; }

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
    syncLanguageSelectors();
    renderTopicChips();
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
        <button data-topic-act="edit" title="주제 추가·관리"><i class="fa-solid fa-plus"></i></button>
        <button data-topic-act="mix" class="stcm-topic-mix" title="여러 주제를 골랐을 때 배정 방식" style="${sel.size > 1 ? '' : 'visibility:hidden'}">${s.topicMix === 'mix' ? '섞어서' : '글마다 하나씩'}</button>`;
    el.scrollLeft = keepLeft;
}

function showTopicEditor() {
    leaveFeed();
    view = 'topics';
    const s = getSettings();
    const sel = new Set(s.topicSelected ?? []);
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    const topics = parseTopics();
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">글 주제 추가·관리 · ${topics.length}개</span>`;
    el.innerHTML = `<div class="stcm-compose-view">
        <p class="stcm-cp-hint">새 주제를 추가하면 바로 선택돼요. 설명은 AI에게 전달되니 원하는 느낌을 적어 주세요. (같은 이름이면 설명이 바뀌어요)</p>
        <div class="stcm-topic-add">
            <input id="stcm_tp_name" type="text" maxlength="40" placeholder="주제 이름 (예: 자캐 목격담)">
            <input id="stcm_tp_desc" type="text" maxlength="200" placeholder="설명 (선택) — 예: 캐릭터를 길에서 봤다는 글">
            <button class="primary" data-act="topic-add"><i class="fa-solid fa-plus"></i> 추가</button>
        </div>
        <div class="stcm-list">
            ${topics.map(t => `
            <div class="stcm-li">
                <div class="stcm-li-main" data-act="topic-toggle" data-name="${esc(t.name)}">
                    <b>${sel.has(t.name) ? '<i class="fa-solid fa-check"></i> ' : ''}${esc(t.name)}</b>
                    ${t.desc ? `<small>${esc(t.desc)}</small>` : ''}
                </div>
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
    if (act === 'topic-add') {
        const name = document.getElementById('stcm_tp_name').value.replace(/[:：\n]/g, ' ').trim();
        const desc = document.getElementById('stcm_tp_desc').value.replace(/\n/g, ' ').trim();
        if (!name) { toastr.warning('주제 이름을 적어 주세요.'); return; }
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
        <p>최대 토큰을 늘리거나, 글/댓글 수를 줄이거나, 다른 연결 프로필을 써 보세요.</p></div>`;
    // Show over the feed without moving it
    const eb = document.getElementById('stcm_errbox');
    if (!eb) { feedEl.insertAdjacentHTML('afterbegin', box); return; }
    eb.innerHTML = `<button class="stcm-err-close" data-act="err-close" title="닫기"><i class="fa-solid fa-xmark"></i></button>${box}`;
    eb.classList.add('show');
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
    document.getElementById('stcm_errbox')?.classList.remove('show');
    syncSelectors();

    if (!store) {
        bar.innerHTML = '';
        el.innerHTML = `<div class="stcm-empty">채팅을 열면 커뮤니티를 볼 수 있어요.</div>`;
        return;
    }
    const feed = store.feeds.find(f => f.id === feedId) ?? store.feeds.at(-1);
    if (!feed) {
        bar.innerHTML = '';
        el.innerHTML = `<div class="stcm-empty"><i class="fa-solid fa-comments"></i><br>아직 글이 없어요.<br>모드와 커뮤니티를 고르고 <b>생성</b>을 누르거나,<br><i class="fa-solid fa-pen"></i> 버튼으로 직접 글을 써 보세요.</div>`;
        return;
    }
    if (feed.id !== currentFeedId && composer?.feedId !== feed.id) composer = null;
    currentFeedId = feed.id;
    const hasTr = feed.data.posts.some(p => p.body_tr || p.body_ko || p.comments.some(c => c.body_tr || c.body_ko));
    const when = new Date(feed.createdAt).toLocaleString();
    bar.innerHTML = `<span class="stcm-fb-info"><b>${esc(PLATFORMS[feed.platform]?.label)}</b> · ${esc(MODES[feed.mode]?.label)} · #${feed.atMessage} 시점 · ${esc(when)}${feed.topics?.length ? ` · 주제: ${esc(feed.topics.join(', '))}` : ''}${feed.topic ? ` · “${esc(truncate(feed.topic, 30))}”` : ''}</span>
        ${hasTr ? `<button id="stcm_tr_toggle" class="${showTr ? 'on' : ''}" title="${showTr ? '원문 보기' : '번역 보기'}"><i class="fa-solid fa-language"></i> 번역</button>` : ''}`;
    const render = renderers[feed.platform] ?? renderers.naver;
    el.innerHTML = render(feed) + `
        <div class="stcm-more-posts"><button data-act="more-posts" data-feed="${esc(feed.id)}"><i class="fa-solid fa-plus"></i> ${PLATFORMS[feed.platform]?.chat ? '이 서버에 채널 더 만들기' : '이 게시판에 글 더 불러오기'}</button></div>`;

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

/** Remember where the reader was in the current feed before switching views. */
function leaveFeed() {
    const el = document.getElementById('stcm_feed');
    if (view === 'feed' && currentFeedId && el) feedScroll.set(currentFeedId, el.scrollTop);
}

function scrollToPostSmooth(idx, smooth = true) {
    const feedEl = document.getElementById('stcm_feed');
    const target = feedEl?.querySelector(`[data-post="${idx}"]`);
    if (!target) return;
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
    const tr = ta.getBoundingClientRect();
    const foot = box.querySelector('.stcm-cp-foot')?.getBoundingClientRect() ?? tr;
    // smallest scroll that shows the text box (and its send button when there is room)
    const need = Math.min(foot.bottom, tr.top + fr.height - 16);
    if (need > fr.bottom) feedEl.scrollBy({ top: need - fr.bottom + 8, behavior: 'smooth' });
    else if (tr.top < fr.top) feedEl.scrollBy({ top: tr.top - fr.top - 8, behavior: 'smooth' });
}

/** Keep what the player typed when a post is re-rendered. */
function captureDraft() {
    if (!composer) return;
    const box = document.querySelector('#stcm_feed .stcm-composer');
    if (!box) return;
    composer.draft = { body: box.querySelector('.stcm-cp-body')?.value ?? '', inst: box.querySelector('.stcm-cp-inst')?.value ?? '', ...readIdentity(box) };
}

/** Re-render a single post in place; the rest of the feed and the scroll position stay put. */
function updatePost(feedId, idx, opts = {}) {
    const feedEl = document.getElementById('stcm_feed');
    const feed = getFeed(feedId);
    if (!feedEl || !feed || !isOpen()) return;
    // The user is looking at something else (history, another feed, compose…): the data is saved,
    // it shows up when they come back. Never switch their view from under them.
    if (view !== 'feed' || currentFeedId !== feedId) return;
    const active = document.activeElement;
    const typing = active && feedEl.contains(active) && active.matches('.stcm-composer textarea, .stcm-composer input')
        ? { cls: active.classList.contains('stcm-cp-body') ? '.stcm-cp-body' : (active.classList.contains('stcm-cp-inst') ? '.stcm-cp-inst' : null), start: active.selectionStart, end: active.selectionEnd }
        : null;
    captureDraft();
    const tpl = document.createElement('template');
    tpl.innerHTML = (renderers[feed.platform] ?? renderers.naver)(feed);
    const fresh = tpl.content.querySelector(`[data-post="${idx}"]`);
    const old = feedEl.querySelector(`[data-post="${idx}"]`);
    if (!fresh || !old) {
        showFeed(feedId, { keepScroll: true, focusComposer: opts.focusComposer });
        return;
    }
    const scroll = feedEl.scrollTop;
    const anchor = captureAnchor(feedEl);
    old.replaceWith(fresh);
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
}

function showCompose() {
    if (!hasChat()) { toastr.warning('먼저 채팅을 열어주세요.'); return; }
    leaveFeed();
    view = 'compose';
    syncSelectors();
    const p = PLATFORMS[selPlatform];
    const feed = getFeed(currentFeedId);
    const appending = feed && feed.platform === selPlatform && feed.mode === selMode;
    const bar = document.getElementById('stcm_feedbar');
    const el = document.getElementById('stcm_feed');
    bar.innerHTML = `<button id="stcm_back"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button><span class="stcm-fb-info">글쓰기 · <b>${esc(p.label)}</b> · ${esc(MODES[selMode].label)}</span>`;
    el.innerHTML = `<div class="stcm-compose-view">
        <p class="stcm-cp-hint">${appending
            ? `지금 보고 있는 <b>${esc(feed.data.board || p.label)}</b> 피드에 글이 올라가요.`
            : '선택한 커뮤니티에 새 피드를 만들고 글을 올려요. (위에서 모드·커뮤니티를 바꿀 수 있어요)'}</p>
        ${identityControls()}
        ${appending ? '' : `<input class="stcm-cp-board" type="text" placeholder="게시판 / 갤러리 / 서브레딧 / 해시태그 이름 (선택)">`}
        ${p.hasTitle || p.chat ? `<input class="stcm-cp-title" type="text" placeholder="${p.chat ? '채널 이름 (예: 잡담) — 새 채널이 생기고 첫 메시지가 올라가요' : (p.thread ? '스레드 제목' : '제목')}">` : ''}
        ${selPlatform === 'tdgall' ? `<select class="stcm-cp-cat">${TD_CATS.filter(c => c !== '전체').map(c => `<option value="${esc(c)}" ${feed && tdState(feed.id).cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
        <textarea class="stcm-cp-body" rows="7" placeholder="${p.thread ? '>>1 본문' : '본문'}"></textarea>
        <div class="stcm-cp-ai">
            <input class="stcm-cp-inst" type="text" maxlength="500" placeholder="AI에게 지시 (선택) — 비우면 고른 글 주제에 맞게">
            <button data-act="ai-write-post" title="고른 신분으로 AI가 제목과 본문을 써 줘요. 본문 칸에 글이 있으면 그걸 다듬어요."><i class="fa-solid fa-wand-magic-sparkles"></i> AI로 쓰기</button>
        </div>
        <div class="stcm-cp-foot">
            <label class="stcm-cp-check"><input type="checkbox" class="stcm-cp-react" checked> 올리고 바로 반응 생성</label>
            <button data-act="cancel-post">취소</button>
            <button class="primary" data-act="submit-post"><i class="fa-solid fa-paper-plane"></i> 올리기</button>
        </div>
    </div>`;
    el.scrollTop = 0;
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
                <b>${esc(PLATFORMS[f.platform]?.label)}</b> · ${esc(MODES[f.mode]?.label)} · #${f.atMessage} · 글 ${f.data.posts.length}개${f.topics?.length ? ` · ${esc(f.topics.join(', '))}` : ''}
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
    toastr.success(`피드 ${feeds.length}개를 내보냈어요.`);
}

// Imported files may come from anyone: rebuild every field with known types.
const intOr = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d);

function importItem(o) {
    const item = normItem(o);
    if (o?.isMe === true) {
        item.isMe = true;
        item.as = ['user', 'char', 'mob'].includes(o.as) ? o.as : 'mob';
        if (item.as === 'char') item.charName = String(o.charName ?? '').slice(0, 100);
    }
    return item;
}

function importFeed(f, chatLen) {
    if (!f || typeof f !== 'object' || !PLATFORMS[f.platform] || !Array.isArray(f.data?.posts)) return null;
    const posts = f.data.posts.slice(0, 500).map((p) => {
        const post = { ...normPost(p), ...importItem(p) };
        post.title = String(p?.title ?? '').slice(0, 500);
        post.comments = (Array.isArray(p?.comments) ? p.comments : []).slice(0, 5000).map(c => ({
            ...importItem(c),
            replies: (Array.isArray(c?.replies) ? c.replies : []).slice(0, 2000).map(importItem),
        }));
        if (p?.part != null) post.part = intOr(p.part, 1);
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
        mode: MODES[f.mode] ? f.mode : 'meta',
        topic: String(f.topic ?? '').slice(0, 300),
        topics: Array.isArray(f.topics) ? f.topics.slice(0, 20).map(t => String(t).slice(0, 60)) : [],
        createdAt: intOr(f.createdAt, Date.now()),
        // keep it inside this chat so branches made later still carry it
        atMessage: Math.min(intOr(f.atMessage), Math.max(0, chatLen - 1)),
        data: { board: String(f.data.board ?? '').slice(0, 200), posts },
    };
}

function importPin(p, idMap) {
    if (!p || typeof p !== 'object') return null;
    const feedId = idMap.get(String(p.feedId));
    if (!feedId || !Number.isInteger(p.postIdx)) return null;
    return {
        feedId,
        postIdx: p.postIdx,
        platform: PLATFORMS[p.platform] ? p.platform : 'naver',
        mode: p.mode === 'world' ? 'world' : 'meta',
        text: String(p.text ?? '').slice(0, 6000),
    };
}

async function readImportFile(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toastr.error('파일이 너무 커요 (50MB 이하).'); return; }
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
    const feeds = feedsIn.slice(0, 200).map(f => importFeed(f, chatLen)).filter(Boolean);
    if (!feeds.length) { toastr.error('불러올 수 있는 피드가 없어요.'); return; }
    pendingImport = { feeds, pins: Array.isArray(data.pins) ? data.pins : [], fileName: file.name, chat: String(data.chat ?? '') };
    showHistory();
}

async function applyImport(mode, withPins) {
    if (!pendingImport || !(await ensureFeedsReady())) return;
    const store = getChatStore();
    const idMap = new Map();
    const existing = new Set(mode === 'merge' ? store.feeds.map(f => f.id) : []);
    const incoming = pendingImport.feeds.map((f) => {
        const oldId = f.id;
        let id = oldId;
        while (existing.has(id)) id = newStoreId();
        existing.add(id);
        idMap.set(oldId, id);
        return { ...f, id };
    });
    const pins = withPins ? pendingImport.pins.map(p => importPin(p, idMap)).filter(Boolean) : [];
    if (mode === 'replace') {
        store.feeds = incoming;
        store.pins = pins;
    } else {
        store.feeds = [...store.feeds, ...incoming].sort((a, b) => a.createdAt - b.createdAt);
        const have = new Set(store.pins.map(p => `${p.feedId}|${p.postIdx}`));
        for (const p of pins) if (!have.has(`${p.feedId}|${p.postIdx}`)) store.pins.push(p);
    }
    if (store.feeds.length > MAX_FEEDS_PER_CHAT) {
        const removed = store.feeds.splice(0, store.feeds.length - MAX_FEEDS_PER_CHAT);
        const gone = new Set(removed.map(f => f.id));
        store.pins = store.pins.filter(p => !gone.has(p.feedId));
        toastr.warning(`채팅당 최대 ${MAX_FEEDS_PER_CHAT}개라서 오래된 피드 ${removed.length}개는 빠졌어요.`);
    }
    const n = incoming.length;
    pendingImport = null;
    currentFeedId = null;
    await saveChatStore();
    refreshInjection();
    toastr.success(`피드 ${n}개를 ${mode === 'replace' ? '바꿔서' : '합쳐서'} 불러왔어요.`);
    showHistory();
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
            <div class="stcm-li-main" data-open-feed="${esc(p.feedId)}">
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
    if (!PLATFORMS[selPlatform]) selPlatform = 'naver';
    if (!MODES[selMode]) selMode = 'meta';
    applyTheme();
    applyFold();
    showOverlay();
    if (store && store.unread) {
        store.unread = 0;
        saveChatStore();
    }
    updateBadge();
    if (hasChat() && !feedState.ready) {
        showLoadingFeed();
        ensureFeedsReady().then(() => { if (isOpen() && view === 'feed') showFeed(feedId); });
        return;
    }
    showFeed(feedId);
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
            savedToastTarget = toastr.options.target ?? 'body';
            toastr.options.target = '#stcm_overlay';
        }
        const tc = document.getElementById('toast-container');
        if (tc && tc.parentElement !== ov) ov.appendChild(tc);
    } catch { /* ignore */ }
}

function hideOverlay() {
    const ov = document.getElementById('stcm_overlay');
    if (!ov) return;
    ov.classList.remove('open');
    try { if (ov.open) ov.close(); } catch { ov.removeAttribute('open'); }
    try {
        if (window.toastr?.options) toastr.options.target = savedToastTarget ?? 'body';
        const tc = document.getElementById('toast-container');
        if (tc && tc.parentElement === ov) document.body.appendChild(tc);
    } catch { /* ignore */ }
}

function closePanel() {
    captureDraft();
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
        <div class="inline-drawer-content stcm-set">
          <div class="menu_button" id="stcm_set_open"><i class="fa-solid fa-comments"></i> 커뮤니티 열기</div>

          <small class="stcm-help"><i class="fa-solid fa-server"></i> 피드는 채팅 파일이 아니라 서버의 사용자 파일 폴더(<code>data/사용자/user/files/stcm-feed-*.json</code>)에 저장돼요.</small>
          <div class="menu_button" id="stcm_set_cleanup">삭제된 채팅의 피드 파일 정리</div>

          <label>화면 테마</label>
          <select id="stcm_set_theme" class="text_pole">
            <option value="theme">테마 따라가기 (실리태번 테마 색)</option>
            <option value="light">라이트</option>
            <option value="dark">나이트</option>
          </select>

          <label>생성에 쓸 연결 프로필 <small>(비우면 지금 메인 API 사용)</small></label>
          <select id="stcm_set_profile" class="text_pole"></select>

          <label>생성 언어</label>
          <select id="stcm_set_language" class="text_pole">${languageOptions(true, false)}</select>
          <input id="stcm_set_custom_lang" class="text_pole" type="text" placeholder="언어 이름 (예: Catalan, Brazilian Portuguese)">

          <label>번역 함께 생성 <small>(피드에서 번역 보기로 전환, 토큰 많이 씀)</small></label>
          <select id="stcm_set_translate" class="text_pole">${languageOptions(false, true)}</select>
          <input id="stcm_set_custom_tr" class="text_pole" type="text" placeholder="번역할 언어 이름">

          <div class="stcm-set-grid">
            <label>새로 생성할 글 개수 <input id="stcm_set_posts" type="number" min="1" max="10" class="text_pole"></label>
            <label>글당 댓글 수 <input id="stcm_set_comments" type="number" min="0" max="20" class="text_pole"></label>
            <label>이어서/반응 댓글 수 <input id="stcm_set_continue" type="number" min="1" max="30" class="text_pole"></label>
            <label>참고할 최근 메시지 <input id="stcm_set_ctx" type="number" min="1" max="100" class="text_pole"></label>
            <label>최대 응답 토큰 <input id="stcm_set_tokens" type="number" min="500" max="32000" step="100" class="text_pole"></label>
            <label>2ch·레딧 스레드 최대 레스 <input id="stcm_set_cap" type="number" min="10" max="10000" step="10" class="text_pole"></label>
            <label>반영 글 삽입 깊이 <input id="stcm_set_depth" type="number" min="0" max="50" class="text_pole"></label>
          </div>

          <label class="checkbox_label"><input id="stcm_set_card" type="checkbox"><span>캐릭터·페르소나 설명 포함</span></label>
          <label>본 채팅에서 읽지 않을 태그 <small>(쉼표로 구분, 태그와 안의 내용을 통째로 빼요. 숨긴 메시지는 항상 빼요)</small></label>
          <textarea id="stcm_set_excludetags" class="text_pole" rows="3"></textarea>
          <label class="checkbox_label"><input id="stcm_set_skipnarr" type="checkbox"><span>내레이터·시스템 메모(/sys)도 읽지 않기</span></label>
          <label class="checkbox_label"><input id="stcm_set_wi" type="checkbox"><span>새 채팅에서 월드 인포 자동 참고 <small>(채팅별 선택은 커뮤니티 창의 📚 버튼)</small></span></label>
          <label>월드 인포 최대 글자 수 <input id="stcm_set_wimax" type="number" min="1000" max="100000" step="1000" class="text_pole"></label>

          <hr>
          <label><b>본 채팅 진행에 맞춰 자동 생성</b> <small>(AI 답변이 올 때마다 셉니다)</small></label>
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

          <hr>
          <label>글 주제 <small>(추가·삭제·선택은 커뮤니티 창의 주제 줄 <i class="fa-solid fa-plus"></i> 버튼에서)</small></label>
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

          <hr>
          <label class="checkbox_label"><input id="stcm_set_crossref" type="checkbox"><span>모든 생성에서 다른 게시글 참고 <small>(꺼 두면 글 아래 <i class="fa-solid fa-link"></i>로 그 글만 켤 수 있어요)</small></span></label>
          <label>참고할 다른 글 수 <input id="stcm_set_crossrefcount" type="number" min="1" max="20" class="text_pole"></label>

          <label>추가 지시 <small>(모든 생성에 붙어요. 아무 언어나 OK)</small></label>
          <textarea id="stcm_set_extra" class="text_pole" rows="3"></textarea>

          <hr>
          <label><b>프롬프트 편집</b> <small>(AI가 읽는 지시문. 영어 권장)</small></label>
          <select id="stcm_set_prompt_key" class="text_pole">${promptOpts}</select>
          <textarea id="stcm_set_prompt" class="text_pole stcm-prompt-box" rows="10"></textarea>
          <div class="stcm-prompt-row">
            <small id="stcm_set_prompt_state"></small>
            <div class="menu_button" id="stcm_set_prompt_reset">이 항목 기본값으로</div>
            <div class="menu_button" id="stcm_set_prompt_reset_all">전체 기본값으로</div>
          </div>
          <small class="stcm-help">쓸 수 있는 변수: <code>{{char}}</code> <code>{{user}}</code> <code>{{platform}}</code> (커뮤니티 영어 이름), <code>{{language}}</code> (언어 항목), <code>{{translation}}</code> (번역 항목), <code>{{count}}</code> (개수), <code>{{comments}}</code> (글당 댓글 수). 실리태번 매크로도 쓸 수 있어요. 비워 두면 기본값을 써요.</small>
        </div>
      </div>
    </div>`;
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    host?.insertAdjacentHTML('beforeend', html);

    document.getElementById('stcm_set_open').addEventListener('click', () => openPanel());
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
    bind('stcm_set_tokens', 'maxTokens');
    bind('stcm_set_card', 'includeCard', 'checked');
    bind('stcm_set_excludetags', 'excludeTags');
    bind('stcm_set_skipnarr', 'excludeSkipNarrator', 'checked');
    bind('stcm_set_wi', 'includeWorldInfo', 'checked');
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
    document.getElementById('stcm_set_theme')?.addEventListener('change', applyTheme);
    bind('stcm_set_mode', 'defaultMode');
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

    // Connection profile dropdown
    const svc = ctx().ConnectionManagerRequestService;
    const sel = document.getElementById('stcm_set_profile');
    try {
        if (!svc) throw new Error('no service');
        svc.handleDropdown('#stcm_set_profile', s.profileId, (profile) => {
            s.profileId = profile?.id ?? '';
            saveSettings();
        });
        const first = sel.querySelector('option[value=""]');
        if (first) { first.textContent = '(메인 API 사용)'; delete first.dataset.i18n; }
    } catch (e) {
        sel.innerHTML = '<option value="">(Connection Manager 사용 불가 — 메인 API 사용)</option>';
        sel.disabled = true;
        s.profileId = '';
    }
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
                for (const p of feed.data.posts) p.watch = true;
                await saveChatStore();
            }
        });
    }
}

async function onChatChanged() {
    abortCtl?.abort();
    composer = null;
    currentFeedId = null;
    pendingImport = null;
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
    for (const [id, info] of Object.entries(idx)) {
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
            const pf = args.platform && PLATFORMS[args.platform] ? args.platform : null;
            const md = args.mode && MODES[args.mode] ? args.mode : null;
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
    if (event_types.CHAT_DELETED) eventSource.on(event_types.CHAT_DELETED, onChatDeleted);
    if (event_types.GROUP_CHAT_DELETED) eventSource.on(event_types.GROUP_CHAT_DELETED, onChatDeleted);
    if (event_types.CHAT_RENAMED) eventSource.on(event_types.CHAT_RENAMED, onChatRenamed);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
})();
