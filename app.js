// Agent Crown Race — public site logic.
// Plain static JS, no build step, no libraries. Reads go through a public
// BSC RPC failover pool (sticky last-good endpoint, 9s timeout per call);
// writes go through the visitor's own connected wallet only.
// While CROWN_CONFIG.contractAddress is empty, the site renders its
// "not live yet" state and every on-chain read is skipped safely.
// UI language: EN (default) / 简体中文 via the topbar toggle; the choice
// persists in localStorage. The agent-prompt bodies stay in English —
// they are machine instructions; only their framing UI is translated.
const CROWN_CONFIG = {
  contractAddress: "",          // CrownRace (CROWN) — filled in after the owner deploys via deploy.html
  chainId: 56,                  // BNB Smart Chain Mainnet
  chainHex: "0x38",
  agentIdAddress: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F", // Binance .ai Agent ID NFT (SPACE ID)
  xUrl: "https://x.com/Fukooooof" // official X profile (@Fukooooof)
};
const CONTRACT = CROWN_CONFIG.contractAddress;
const AGENT_ID = CROWN_CONFIG.agentIdAddress;
const MAX_SUPPLY = 2222;
const FREE_SUPPLY = 500;
const PAID_PRICE_WEI = "700000000000000"; // 0.0007 BNB exactly
const TIERS = [
  { name: "Spark",      priceWei: "150000000000000",  priceBNB: "0.00015", points: 5 },
  { name: "Surge",      priceWei: "500000000000000",  priceBNB: "0.0005",  points: 20 },
  { name: "Crown Rush", priceWei: "1500000000000000", priceBNB: "0.0015",  points: 75 }
];
// Contract function selectors (first 4 bytes of keccak256), computed from the final ABI.
const SEL = {
  mint: "0x1249c58b",            // mint()
  mintPaid: "0x69907b9b",        // mintPaid()
  boost: "0x7f0b2512",           // boost(uint8)
  settleDay: "0xca624b77",       // settleDay()
  totalMinted: "0xa2309ff8",     // totalMinted()
  passPrice: "0xca3286f5",       // passPrice()
  mintOpen: "0x24bbd049",        // mintOpen()
  leader: "0x40eedabb",          // leader()
  leaderPoints: "0x64eb5a86",    // leaderPoints()
  poolToday: "0x17f6425b",       // poolToday()
  pointsOf: "0x4c4bd4c6",        // pointsOf(uint256,address)
  crownsWon: "0xf2cf1b95",       // crownsWon(address)
  kingOfDay: "0xf1b4b8a2",       // kingOfDay(uint256)
  balanceOf: "0x70a08231",       // balanceOf(address) — Crown pass AND Agent ID NFT
  ownerOf: "0x6352211e",         // ownerOf(uint256)
  hasMinted: "0x38e21cce",       // hasMinted(address)
  lastSettledDay: "0x80bc7175"   // lastSettledDay()
};
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BOARD_SCAN_CAP = 800;      // enumerate at most the latest 800 passes for the board

// ── i18n — EN / 简体中文 ───────────────────────────────────────
const I18N = {
en: {
  docTitle: "Agent Crown Race — The Daily Crown for Binance Agent ID Holders",
  statusNotLive: "CONTRACT NOT LIVE YET",
  connectWallet: "Connect wallet",
  heroTitle: 'One crown. <span class="gold">Every day.</span>',
  heroSub: 'The daily crown competition for <b>Binance .ai Agent ID</b> holders on BNB Chain. Hold a Crown Race Pass, boost your points, and finish the UTC day on top — the leader is crowned at <b>00:00 UTC</b> and receives <b>50% of that day\'s boost pool</b>.',
  statLeader: "Today's leader",
  statLeaderSub: '<b id="statLeaderPoints">—</b> points today',
  statPool: "Today's boost pool",
  statPoolSub: "winner takes 50% at settle",
  statSettle: "Next settle in",
  statMinted: "Passes minted",
  statMintedSub: '<b id="statFreeLeft">—</b> free passes left of 500',
  noteNotDeployed: "The contract is not deployed yet — this page goes live the moment it is.",
  noteOpen: "Mint is OPEN. Free passes are first-come, first-served — when the 500 are gone, passes cost exactly 0.0007 BNB.",
  noteClosed: "The contract is deployed. Mint opens the moment the owner switches it on.",
  statusOpen: "● MINT OPEN — LIVE",
  statusClosed: "CONTRACT LIVE — MINT CLOSED",
  ctaGetPass: "Get your pass",
  ctaBoost: "Boost your points",
  getPassTitle: "🎟️ Get your Crown Race Pass",
  getPassSub: 'One pass per wallet. Your wallet must hold a Binance <b>.ai Agent ID</b> (<span class="mono small">0x60B9…022F</span>). The first <b>500</b> passes are <b>free</b> — value exactly 0, gas only. After they are gone, a pass costs exactly <b>0.0007 BNB</b>. Total supply is capped at <b>2,222</b>. Next pass price right now: <b id="statPassPrice">—</b>.',
  priceFree: "FREE (0 BNB, gas only)",
  promptMintTitle: "🤖 Agent-first: give this to your AI agent",
  copyPrompt: "COPY PROMPT",
  advancedSummary: "Advanced — mint directly with a connected wallet",
  advIntro: "Connect a wallet that holds a .ai Agent ID. The buttons send the exact contract calls — no approvals are involved.",
  mintFreeBtn: "Mint free pass — mint()",
  mintPaidBtn: "Mint paid pass — 0.0007 BNB",
  mintHint: "Free mint works only while free passes remain; the paid button works only after they run out. The contract enforces both.",
  raceTitle: "🏁 Today's race",
  raceRefresh: "Live from the contract · refreshes every 60s",
  boardNote: "Pass holders ranked by points earned today (UTC). Points reset at every settle.",
  boardNoteCapped: "Pass holders of the latest {cap} passes, ranked by points earned today (UTC). Points reset at every settle.",
  boardEmptyPre: "The board lights up once the contract is live.",
  boardEmptyNoMint: "No passes minted yet — the board is waiting for its first racers.",
  boardEmptyNoBoost: "Passes are out, but nobody has boosted yet today. The crown is wide open.",
  noBoostsYet: "No boosts yet",
  ptsSuffix: "pts",
  youChip: "YOU",
  youTitle: "🪪 Your race card",
  youSub: "Connect a wallet, or paste any address to look up its pass, today's points and crown count.",
  youPlaceholder: "0x… wallet address",
  youLookup: "Look up",
  youWallet: "Wallet",
  youPassLabel: "Pass",
  youPoints: "Points today",
  youRank: "Rank today",
  youCrowns: "Crowns won",
  passHeld: "✅ Pass held",
  passMintedBefore: "No pass held (minted once before)",
  passNone: "No pass yet",
  rankOf: "#{rank} of {total}",
  unranked: "Unranked — no points yet today",
  boostTitle: "🚀 Boost — climb today's board",
  boostSub: "Pass holders only. Every boost is paid in full into <b>today's pool</b> and can be repeated as often as you like. Points count for the current UTC day only.",
  tierCard0: "✦ Spark",
  tierCard1: "⚡ Surge",
  tierCard2: "👑 Crown Rush",
  pts5: "+5 points",
  pts20: "+20 points",
  pts75: "+75 points",
  tierBtn0: "Boost — tier 0",
  tierBtn1: "Boost — tier 1",
  tierBtn2: "Boost — tier 2",
  tierName0: "Spark",
  tierName1: "Surge",
  tierName2: "Crown Rush",
  promptBoostTitle: "🤖 Agent prompt — boost",
  promptSettleTitle: "🤖 Agent prompt — settle the day (anyone can call it)",
  settleBtn: "Call settleDay() from my wallet",
  settleNote: "Permissionless — after 00:00 UTC it crowns the previous day's leader and pays their 50% automatically.",
  hallTitle: "🏛️ Hall of Kings",
  hallRefresh: "Settled days, read from kingOfDay",
  hallNote: "Every settled day crowns one king. Crowns are counted on-chain, forever.",
  hallEmptyPre: "No day has been settled yet.",
  hallEmptyNone: "No day has been settled yet — the first king is crowned at the first settle after 00:00 UTC.",
  hallDayLabel: "Day {day} · {date}",
  hallCrownOne: " · <b>{n}</b> crown total",
  hallCrownsMany: " · <b>{n}</b> crowns total",
  rulesTitle: "📜 The rules — exactly as the contract enforces them",
  rule1: '<b>Who can play.</b> Your wallet must hold a Binance .ai Agent ID (the SPACE ID .ai NFT at <span class="mono small">0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F</span>). The contract checks this on every mint.',
  rule2: '<b>One pass per wallet.</b> A wallet can mint at most one Crown Race Pass, ever, and can hold at most one at a time. Total supply is capped at <b>2,222</b>.',
  rule3: '<b>Free first, then paid.</b> The first <b>500</b> passes are minted with <span class="mono">mint()</span> at value <b>exactly 0</b> (gas only). Once they are gone, passes are minted with <span class="mono">mintPaid()</span> at <b>exactly 0.0007 BNB</b>. There is no paid mint while free passes remain, and no free mint after they run out.',
  rule4: '<b>Mint must be open.</b> Minting works only while the owner has the mint open (<span class="mono">mintOpen()</span> = true). Prices are constants in the contract — nobody can change them after deployment.',
  rule5: '<b>Boosts.</b> Only pass holders can boost. Tier 0 costs exactly <b>0.00015 BNB</b> for <b>+5</b> points, tier 1 exactly <b>0.0005 BNB</b> for <b>+20</b>, tier 2 exactly <b>0.0015 BNB</b> for <b>+75</b>. Boosts can be repeated without limit, and the full amount of every boost enters that day\'s pool.',
  rule6: '<b>Days are UTC days.</b> Points are counted per UTC day and a day ends at <b>00:00 UTC</b> (07:00 WIB). Points do not carry over.',
  rule7: '<b>The lead.</b> The leader is the wallet with the most points today. On a tie, the wallet that reached the tied score <b>first</b> keeps the lead — a later equal score does not take it.',
  rule8: '<b>Settling.</b> After a day has ended, <b>anyone</b> can call <span class="mono">settleDay()</span> — no owner needed. It settles the oldest unsettled day: the day\'s leader is recorded as its king (<span class="mono">kingOfDay</span>, <span class="mono">crownsWon</span> +1) and is paid <b>50% of that day\'s boost pool</b>; the other <b>50%</b> goes to the project owner. A day with no boosts settles with no winner and no payment.',
  rule9: '<b>No approvals, ever.</b> Minting and boosting never ask for token approvals. If anything asks you to approve a token spend for this race, it is not this contract — stop.',
  rule10: '<b>No promises.</b> Points have no monetary value. The only payout that exists is the winner\'s 50% pool share described above, paid by the contract at settle. A win is never guaranteed — it depends entirely on the day\'s competition.',
  notDeployedYet: "not deployed yet",
  bscScanPending: "BscScan — contract (after deployment)",
  bscScanLive: "BscScan — contract",
  llmsLink: "llms.txt for agents",
  footerDisclaimer: "An independent project for Binance Agent ID holders. Not affiliated with Binance. Rules above are the contract's rules — verify them on BscScan before you play.",
  toastCopied: "Agent prompt copied — paste it to your AI agent.",
  toastCopyFailed: "Copy failed — the prompt text is selected, copy it manually.",
  toastBadAddress: "Paste a valid 0x… wallet address first.",
  toastNoWallet: "No wallet found in this browser. Use the agent prompts above, or open this page in a wallet browser.",
  toastNoAccount: "No account approved in the wallet.",
  toastConnectFail: "Wallet connection failed: ",
  toastNotDeployed: "The contract is not deployed yet — this button goes live with it.",
  toastTxFail: "Transaction not sent: ",
  toastMintFree: "Free pass mint sent.",
  toastMintPaid: "Paid pass mint sent (0.0007 BNB).",
  toastBoost: "{name} boost sent (+{points} points).",
  toastSettle: "settleDay() sent — the finished day is being crowned."
},
zh: {
  docTitle: "Agent Crown Race — 币安 Agent ID 持有者每日皇冠争夺赛",
  statusNotLive: "合约尚未上线",
  connectWallet: "连接钱包",
  heroTitle: '一顶皇冠。<span class="gold">每一天。</span>',
  heroSub: '专为 BNB 链上的币安 <b>.ai Agent ID</b> 持有者打造的每日皇冠争夺赛。持有皇冠通行证，为积分助推，在 UTC 当天结束时名列前茅——领先者将于 <b>00:00 UTC</b> 加冕，并获得<b>当日助推奖池的 50%</b>。',
  statLeader: "今日领先者",
  statLeaderSub: '<b id="statLeaderPoints">—</b> 今日积分',
  statPool: "今日助推奖池",
  statPoolSub: "结算时赢家获得 50%",
  statSettle: "距下次结算",
  statMinted: "已铸造通行证",
  statMintedSub: '免费通行证剩余 <b id="statFreeLeft">—</b> 张（共 500 张）',
  noteNotDeployed: "合约尚未部署——部署完成的那一刻，本页面将正式上线。",
  noteOpen: "铸造已开启。免费通行证先到先得——500 张领完后，每张通行证价格为恰好 0.0007 BNB。",
  noteClosed: "合约已部署。项目方开启铸造后即可开始铸造。",
  statusOpen: "● 铸造进行中",
  statusClosed: "合约已上线 — 铸造未开启",
  ctaGetPass: "领取通行证",
  ctaBoost: "助推积分",
  getPassTitle: "🎟️ 领取你的皇冠通行证",
  getPassSub: '每个钱包限领一张。你的钱包必须持有币安 <b>.ai Agent ID</b>（<span class="mono small">0x60B9…022F</span>）。前 <b>500</b> 张通行证<b>免费</b>——金额恰好为 0，仅需 Gas。免费名额用完后，每张通行证价格为恰好 <b>0.0007 BNB</b>。总供应量上限为 <b>2,222</b> 张。当前下一张通行证的价格：<b id="statPassPrice">—</b>。',
  priceFree: "免费（0 BNB，仅需 Gas）",
  promptMintTitle: "🤖 Agent 优先：把这段提示词交给你的 AI Agent",
  copyPrompt: "复制提示词",
  advancedSummary: "高级选项 — 连接钱包直接铸造",
  advIntro: "连接一个持有 .ai Agent ID 的钱包。下方按钮发送的正是合约调用本身——不涉及任何授权。",
  mintFreeBtn: "铸造免费通行证 — mint()",
  mintPaidBtn: "铸造付费通行证 — 0.0007 BNB",
  mintHint: "免费铸造仅在免费通行证尚有剩余时可用；付费按钮仅在免费名额用完后可用。两者均由合约强制执行。",
  raceTitle: "🏁 今日赛事",
  raceRefresh: "数据实时来自合约 · 每 60 秒刷新",
  boardNote: "通行证持有者按今日（UTC）所获积分排名。积分在每次结算后清零。",
  boardNoteCapped: "最近 {cap} 张通行证的持有者，按今日（UTC）所获积分排名。积分在每次结算后清零。",
  boardEmptyPre: "合约上线后，排行榜将在此点亮。",
  boardEmptyNoMint: "尚无通行证被铸造——排行榜正在等待第一批参赛者。",
  boardEmptyNoBoost: "通行证已经发放，但今天还没有人助推。皇冠虚位以待。",
  noBoostsYet: "暂无助推",
  ptsSuffix: "积分",
  youChip: "你",
  youTitle: "🪪 你的参赛卡",
  youSub: "连接钱包，或粘贴任意地址，即可查询其通行证、今日积分和皇冠数量。",
  youPlaceholder: "0x… 钱包地址",
  youLookup: "查询",
  youWallet: "钱包",
  youPassLabel: "通行证",
  youPoints: "今日积分",
  youRank: "今日排名",
  youCrowns: "赢得的皇冠",
  passHeld: "✅ 已持有通行证",
  passMintedBefore: "未持有通行证（此前已铸造过一张）",
  passNone: "尚无通行证",
  rankOf: "第 {rank} 名（共 {total} 人）",
  unranked: "未上榜 — 今日尚无积分",
  boostTitle: "🚀 助推 — 冲击今日排行榜",
  boostSub: "仅限通行证持有者。每笔助推的全部金额都计入<b>今日奖池</b>，助推次数不限。积分仅计入当前 UTC 日。",
  tierCard0: "✦ 火花",
  tierCard1: "⚡ 浪涌",
  tierCard2: "👑 皇冠冲刺",
  pts5: "+5 积分",
  pts20: "+20 积分",
  pts75: "+75 积分",
  tierBtn0: "助推 — 档位 0",
  tierBtn1: "助推 — 档位 1",
  tierBtn2: "助推 — 档位 2",
  tierName0: "火花",
  tierName1: "浪涌",
  tierName2: "皇冠冲刺",
  promptBoostTitle: "🤖 Agent 提示词 — 助推",
  promptSettleTitle: "🤖 Agent 提示词 — 每日结算（任何人都可以调用）",
  settleBtn: "用我的钱包调用 settleDay()",
  settleNote: "无需许可——00:00 UTC 之后，调用即可为前一日的领先者加冕，并自动支付其 50% 奖金。",
  hallTitle: "🏛️ 王者殿堂",
  hallRefresh: "已结算日期，数据来自 kingOfDay",
  hallNote: "每个结算日都会加冕一位王者。皇冠数量永久记录在链上。",
  hallEmptyPre: "尚无任何日期完成结算。",
  hallEmptyNone: "尚无日期完成结算——首位王者将在 00:00 UTC 后的第一次结算时加冕。",
  hallDayLabel: "第 {day} 天 · {date}",
  hallCrownOne: " · 共 <b>{n}</b> 顶皇冠",
  hallCrownsMany: " · 共 <b>{n}</b> 顶皇冠",
  rulesTitle: "📜 规则 — 与合约实际执行完全一致",
  rule1: '<b>参赛资格。</b>你的钱包必须持有币安 .ai Agent ID（SPACE ID .ai NFT，地址为 <span class="mono small">0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F</span>）。合约会在每次铸造时进行验证。',
  rule2: '<b>每个钱包一张通行证。</b>一个钱包最多只能铸造一张皇冠通行证（终身一次），且同一时间最多持有一张。总供应量上限为 <b>2,222</b> 张。',
  rule3: '<b>先免费，后付费。</b>前 <b>500</b> 张通行证通过 <span class="mono">mint()</span> 铸造，金额为<b>恰好 0</b>（仅需 Gas）。免费名额用完后，通行证通过 <span class="mono">mintPaid()</span> 铸造，价格为<b>恰好 0.0007 BNB</b>。免费名额尚有剩余时不能付费铸造，免费名额用完后也不能再免费铸造。',
  rule4: '<b>铸造必须处于开启状态。</b>仅当项目方开启铸造（<span class="mono">mintOpen()</span> = true）时才能铸造。价格是合约中的常量——部署后任何人都无法更改。',
  rule5: '<b>助推。</b>只有通行证持有者可以助推。档位 0 价格为恰好 <b>0.00015 BNB</b>，得 <b>+5</b> 积分；档位 1 为恰好 <b>0.0005 BNB</b>，得 <b>+20</b> 积分；档位 2 为恰好 <b>0.0015 BNB</b>，得 <b>+75</b> 积分。助推可无限次重复，每笔助推的全部金额都计入当日奖池。',
  rule6: '<b>以 UTC 日为准。</b>积分按 UTC 日统计，每日在 <b>00:00 UTC</b>（07:00 WIB）结束。积分不会结转到下一日。',
  rule7: '<b>领先规则。</b>领先者是今日积分最高的钱包。若积分相同，先达到该分数的钱包保持领先——之后达到相同分数者无法反超。',
  rule8: '<b>结算。</b>某日结束后，<b>任何人</b>都可以调用 <span class="mono">settleDay()</span>——无需项目方参与。它会结算最早一个未结算的日期：当日领先者被记录为该日的王者（<span class="mono">kingOfDay</span>，<span class="mono">crownsWon</span> +1），并获得<b>当日助推奖池的 50%</b>；另外 <b>50%</b> 归项目方所有。若某日没有任何助推，则该日结算时没有赢家，也没有任何付款。',
  rule9: '<b>永不需要授权。</b>铸造和助推从不要求代币授权。如果任何界面要求你为本次赛事授权代币支出，那不是本合约——请立即停止。',
  rule10: '<b>不作任何承诺。</b>积分没有任何货币价值。唯一存在的奖励是上文所述的赢家 50% 奖池分成，由合约在结算时支付。获胜从不保证——完全取决于当日的竞争情况。',
  notDeployedYet: "尚未部署",
  bscScanPending: "BscScan — 合约（部署后可用）",
  bscScanLive: "BscScan — 合约",
  llmsLink: "llms.txt（Agent 专用）",
  footerDisclaimer: "面向币安 Agent ID 持有者的独立项目，与币安无隶属关系。以上规则即合约规则——参与前请先在 BscScan 上核实。",
  toastCopied: "提示词已复制 — 粘贴给你的 AI Agent 即可。",
  toastCopyFailed: "复制失败 — 提示词文本已选中，请手动复制。",
  toastBadAddress: "请先粘贴一个有效的 0x… 钱包地址。",
  toastNoWallet: "此浏览器未检测到钱包。请使用上方的 Agent 提示词，或在钱包浏览器中打开本页。",
  toastNoAccount: "钱包中没有已授权的账户。",
  toastConnectFail: "钱包连接失败：",
  toastNotDeployed: "合约尚未部署 — 此按钮将在部署后启用。",
  toastTxFail: "交易未发送：",
  toastMintFree: "免费通行证铸造交易已发送。",
  toastMintPaid: "付费通行证铸造交易已发送（0.0007 BNB）。",
  toastBoost: "{name}助推已发送（+{points} 积分）。",
  toastSettle: "settleDay() 已发送 — 正在为已结束的日期加冕。"
}
};
let lang = "en";
try { const saved = localStorage.getItem("crownrace_lang"); if (saved === "zh" || saved === "en") lang = saved; } catch { /* storage unavailable */ }
function t(key, params) {
  let s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  if (params) for (const k of Object.keys(params)) s = s.split("{" + k + "}").join(String(params[k]));
  return s;
}
function fmtNum(v) { return v.toLocaleString(lang === "zh" ? "zh-CN" : "en-US"); }
function applyLang() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = t("docTitle");
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.getAttribute("data-i18n-html")); });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
  const bEn = $("langEn"), bZh = $("langZh");
  if (bEn) bEn.classList.toggle("active", lang === "en");
  if (bZh) bZh.classList.toggle("active", lang === "zh");
  if (!walletAddress) $("connectBtn").textContent = t("connectWallet");
  if (!contractsReady()) {
    $("liveStatus").textContent = t("statusNotLive");
    const note = $("mintStateNote");
    note.textContent = t("noteNotDeployed"); note.classList.remove("ok");
    $("contractAddr").textContent = t("notDeployedYet");
    $("footerBscScan").textContent = t("bscScanPending");
  }
  buildPrompts();
  if (contractsReady()) { refreshAll(); if (youAddress) paintYou(); }
}
function setLang(l) {
  if (l !== "en" && l !== "zh") return;
  lang = l;
  try { localStorage.setItem("crownrace_lang", l); } catch { /* storage unavailable */ }
  applyLang();
}

// ── Small helpers ─────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function validAddress(a) { return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a); }
function contractsReady() { return validAddress(CONTRACT); }
function pad32(hexNoPrefix) { return hexNoPrefix.padStart(64, "0"); }
function encAddress(address) { return pad32(String(address).toLowerCase().replace(/^0x/, "")); }
function encUint(value) { return pad32(BigInt(value).toString(16)); }
function shortenAddress(a) { return validAddress(a) ? a.slice(0, 6) + "…" + a.slice(-4) : "—"; }
function todayUTC() { return Math.floor(Date.now() / 86400000); }
function formatBNB(wei) {
  const v = BigInt(wei);
  if (v === 0n) return "0 BNB";
  const whole = v / 1000000000000000000n;
  const frac = (v % 1000000000000000000n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return (frac ? whole.toString() + "." + frac : whole.toString()) + " BNB";
}
let toastTimer = null;
function showToast(msg) {
  const t2 = $("toast"); if (!t2) return;
  t2.textContent = msg; t2.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t2.classList.remove("show"), 4200);
}

// ── RPC failover pool (pattern proven on the Pokepvp site) ────
const BSC_RPC_URLS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc.publicnode.com",
  "https://bsc-dataseed2.binance.org",
  "https://bsc-dataseed3.binance.org"
];
let rpcIndex = 0;
async function fetchRpc(url, to, data) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }), signal: ctrl.signal });
    if (!res.ok) throw new Error("RPC HTTP " + res.status);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || "RPC error");
    return json.result;
  } finally { clearTimeout(timer); }
}
async function ethCall(to, data) {
  if (window.ethereum) {
    try { return await window.ethereum.request({ method: "eth_call", params: [{ to, data }, "latest"] }); }
    catch { /* wallet provider failed the read — fall through to the public RPC pool */ }
  }
  let lastError = null;
  for (let attempt = 0; attempt < BSC_RPC_URLS.length; attempt++) {
    const idx = (rpcIndex + attempt) % BSC_RPC_URLS.length;
    try { const out = await fetchRpc(BSC_RPC_URLS[idx], to, data); rpcIndex = idx; return out; }
    catch (e) { lastError = e; }
  }
  throw lastError || new Error("All BSC RPC endpoints failed");
}
async function readUint(to, data) { const out = await ethCall(to, data); return (!out || out === "0x") ? 0n : BigInt(out); }
async function readBool(to, data) { return (await readUint(to, data)) !== 0n; }
async function readAddress(to, data) { const out = await ethCall(to, data); return (!out || out === "0x") ? "" : "0x" + out.slice(-40); }
function sameAddr(a, b) { return validAddress(a) && validAddress(b) && a.toLowerCase() === b.toLowerCase(); }

// ── Agent prompts (kept in sync with the contract constants) ──
function contractLine() {
  return contractsReady() ? CONTRACT : "(not deployed yet — take the address from the official site / mint.json once it is published)";
}
function buildPrompts() {
  const addr = contractLine();
  $("promptMint").value =
`Mint my Crown Race Pass on BNB Chain (chainId 56).
Contract: ${addr}
Preview first, and stop/report if any check fails:
1. Call mintOpen() on the contract — it must return true. Call totalMinted().
2. Check my wallet holds a Binance Agent ID: balanceOf(my wallet) on the .ai NFT contract ${AGENT_ID} must be more than 0.
3. Check balanceOf(my wallet) on the Crown Race contract is 0 — one pass per wallet.
4. If totalMinted() is below 500, call mint() with value exactly 0 wei (gas only).
   If totalMinted() is 500 or more, call mintPaid() with value exactly ${PAID_PRICE_WEI} wei (0.0007 BNB).
Never send any other amount. No token approvals are needed — do not approve anything. Reply with the transaction link.`;
  $("promptBoost").value =
`Boost my points in today's Crown Race on BNB Chain (chainId 56).
Contract: ${addr}
Preview first: confirm balanceOf(my wallet) on the Crown Race contract is 1 — boosts are for pass holders only.
Call boost(1) with value exactly ${TIERS[1].priceWei} wei (${TIERS[1].priceBNB} BNB) for +20 points.
(Other tiers: boost(0) = ${TIERS[0].priceWei} wei, ${TIERS[0].priceBNB} BNB, +5 points · boost(2) = ${TIERS[2].priceWei} wei, ${TIERS[2].priceBNB} BNB, +75 points. Use a different tier only if I name it.)
Points count for the current UTC day only. No token approvals are needed — do not approve anything. If the call would revert, stop and report why. Reply with the transaction link and my new total from pointsOf(today, my wallet).`;
  $("promptSettle").value =
`Settle the finished day of the Crown Race on BNB Chain (chainId 56).
Contract: ${addr}
Only run this after 00:00 UTC. Preview first: read lastSettledDay() on the contract.
Call settleDay() with value 0. It is permissionless — anyone may call it. It settles the oldest unsettled day: that day's points leader is recorded in kingOfDay and is paid 50% of that day's boost pool by the contract automatically.
No token approvals are needed. If it reverts with "Day not ended", the day has not finished — wait and report instead. Reply with the transaction link and the winner from kingOfDay for the settled day.`;
}
document.querySelectorAll("[data-copy]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const el = $(btn.getAttribute("data-copy"));
    if (!el) return;
    try { await navigator.clipboard.writeText(el.value); showToast(t("toastCopied")); }
    catch { el.select(); showToast(t("toastCopyFailed")); }
  });
});

// ── Countdown to the next 00:00 UTC settle ────────────────────
function paintCountdown() {
  const now = Date.now();
  const next = (todayUTC() + 1) * 86400000;
  let s = Math.max(0, Math.floor((next - now) / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  $("statCountdown").textContent = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
setInterval(paintCountdown, 1000); paintCountdown();

// ── Hero stats — each stat paints independently (allSettled) ──
async function paintStats() {
  if (!contractsReady()) return;
  const jobs = [
    (async () => {
      const total = Number(await readUint(CONTRACT, SEL.totalMinted));
      $("statMinted").textContent = fmtNum(total);
      $("statFreeLeft").textContent = fmtNum(Math.max(0, FREE_SUPPLY - total));
    })(),
    (async () => {
      const price = await readUint(CONTRACT, SEL.passPrice);
      $("statPassPrice").textContent = price === 0n ? t("priceFree") : formatBNB(price);
    })(),
    (async () => {
      const open = await readBool(CONTRACT, SEL.mintOpen);
      const pill = $("liveStatus");
      pill.textContent = open ? t("statusOpen") : t("statusClosed");
      pill.className = "status-pill " + (open ? "status-live" : "status-closed");
      const note = $("mintStateNote");
      note.textContent = open ? t("noteOpen") : t("noteClosed");
      note.classList.toggle("ok", open);
    })(),
    (async () => {
      const leader = await readAddress(CONTRACT, SEL.leader);
      $("statLeader").textContent = (!leader || sameAddr(leader, ZERO_ADDRESS)) ? t("noBoostsYet") : shortenAddress(leader);
    })(),
    (async () => { $("statLeaderPoints").textContent = fmtNum(await readUint(CONTRACT, SEL.leaderPoints)); })(),
    (async () => { $("statPool").textContent = formatBNB(await readUint(CONTRACT, SEL.poolToday)); })()
  ];
  await Promise.allSettled(jobs);
}

// ── Holder enumeration + race board (Pokepvp pattern) ─────────
// ownerOf over the latest BOARD_SCAN_CAP tokens is the ground truth for
// current holders (passes can change hands). Cached in localStorage.
const boardState = { owners: new Map(), minted: 0, busy: false };
let lastBoardRows = [];
function saveBoardCache() {
  try { localStorage.setItem("crownrace_board_v1", JSON.stringify({ minted: boardState.minted, owners: Object.fromEntries(boardState.owners) })); } catch { /* storage unavailable */ }
}
function loadBoardCache() {
  try {
    const j = JSON.parse(localStorage.getItem("crownrace_board_v1") || "null");
    if (j && typeof j.minted === "number") { boardState.minted = j.minted; boardState.owners = new Map(Object.entries(j.owners || {}).map(([k, v]) => [Number(k), v])); }
  } catch { /* no usable cache */ }
}
async function enumerateOwners(total) {
  const start = Math.max(1, total - BOARD_SCAN_CAP + 1);
  const ids = [];
  for (let id = start; id <= total; id += 1) ids.push(id);
  for (let i = 0; i < ids.length; i += 12) {
    const batch = ids.slice(i, i + 12);
    const res = await Promise.allSettled(batch.map(id => readAddress(CONTRACT, SEL.ownerOf + encUint(id))));
    res.forEach((r, j) => { if (r.status === "fulfilled" && validAddress(r.value) && !sameAddr(r.value, ZERO_ADDRESS)) boardState.owners.set(batch[j], r.value); });
  }
  for (const id of [...boardState.owners.keys()]) if (id < start || id > total) boardState.owners.delete(id);
  boardState.minted = total;
  saveBoardCache();
  const note = $("boardNote");
  if (note && total > BOARD_SCAN_CAP) note.textContent = t("boardNoteCapped", { cap: BOARD_SCAN_CAP });
}
async function refreshBoard() {
  const list = $("boardList");
  const total = Number(await readUint(CONTRACT, SEL.totalMinted));
  if (total === 0) { list.innerHTML = '<p class="empty">' + t("boardEmptyNoMint") + "</p>"; lastBoardRows = []; return; }
  await enumerateOwners(total);
  const day = todayUTC();
  const wallets = [...new Set([...boardState.owners.values()].map(a => a.toLowerCase()))];
  const rows = [];
  for (let i = 0; i < wallets.length; i += 12) {
    const batch = wallets.slice(i, i + 12);
    const res = await Promise.allSettled(batch.map(w => readUint(CONTRACT, SEL.pointsOf + encUint(day) + encAddress(w))));
    res.forEach((r, j) => rows.push({ addr: batch[j], points: r.status === "fulfilled" ? r.value : 0n }));
  }
  const leader = await readAddress(CONTRACT, SEL.leader).catch(() => "");
  rows.sort((a, b) => {
    if (a.points !== b.points) return a.points > b.points ? -1 : 1;
    if (leader && sameAddr(a.addr, leader)) return -1; // tie: the contract's leader (first to the score) ranks first
    if (leader && sameAddr(b.addr, leader)) return 1;
    return 0;
  });
  lastBoardRows = rows;
  const racers = rows.filter(r => r.points > 0n);
  if (!racers.length) { list.innerHTML = '<p class="empty">' + t("boardEmptyNoBoost") + "</p>"; return; }
  list.innerHTML = racers.slice(0, 10).map((r, i) => {
    const you = youAddress && sameAddr(r.addr, youAddress);
    return `<div class="board-row${i === 0 ? " board-first" : ""}${you ? " board-you" : ""}"><span class="board-rank">${i === 0 ? "👑" : "#" + (i + 1)}</span><span class="board-addr">${shortenAddress(r.addr)}${you ? ' <b class="you-chip">' + t("youChip") + "</b>" : ""}</span><span class="board-meta"><b>${fmtNum(r.points)}</b> ${t("ptsSuffix")}</span></div>`;
  }).join("");
}

// ── Hall of Kings ─────────────────────────────────────────────
async function refreshHall() {
  const list = $("hallList");
  const today = todayUTC();
  const days = [];
  for (let d = today - 1; d >= Math.max(0, today - 14); d -= 1) days.push(d);
  const kings = [];
  for (let i = 0; i < days.length; i += 7) {
    const batch = days.slice(i, i + 7);
    const res = await Promise.allSettled(batch.map(d => readAddress(CONTRACT, SEL.kingOfDay + encUint(d))));
    res.forEach((r, j) => { if (r.status === "fulfilled" && validAddress(r.value) && !sameAddr(r.value, ZERO_ADDRESS)) kings.push({ day: batch[j], addr: r.value }); });
  }
  if (!kings.length) { list.innerHTML = '<p class="empty">' + t("hallEmptyNone") + "</p>"; return; }
  const totals = new Map();
  await Promise.allSettled(kings.map(async k => {
    if (!totals.has(k.addr.toLowerCase())) totals.set(k.addr.toLowerCase(), await readUint(CONTRACT, SEL.crownsWon + encAddress(k.addr)).catch(() => 0n));
  }));
  list.innerHTML = kings.map(k => {
    const total = totals.get(k.addr.toLowerCase());
    const you = youAddress && sameAddr(k.addr, youAddress);
    const date = new Date(k.day * 86400000).toISOString().slice(0, 10);
    const crownSuffix = total ? t(total === 1n ? "hallCrownOne" : "hallCrownsMany", { n: fmtNum(total) }) : "";
    return `<div class="board-row${you ? " board-you" : ""}"><span class="board-rank">👑</span><span class="board-addr">${shortenAddress(k.addr)}${you ? ' <b class="you-chip">' + t("youChip") + "</b>" : ""}</span><span class="board-meta">${t("hallDayLabel", { day: k.day, date })}${crownSuffix}</span></div>`;
  }).join("");
}

// ── YOU row ───────────────────────────────────────────────────
let youAddress = "";
async function paintYou() {
  if (!youAddress) return;
  $("youAddr").textContent = shortenAddress(youAddress);
  if (!contractsReady()) return;
  const day = todayUTC();
  const jobs = [
    (async () => {
      const [bal, mintedBefore] = await Promise.all([
        readUint(CONTRACT, SEL.balanceOf + encAddress(youAddress)),
        readBool(CONTRACT, SEL.hasMinted + encAddress(youAddress)).catch(() => false)
      ]);
      $("youPass").textContent = bal > 0n ? t("passHeld") : (mintedBefore ? t("passMintedBefore") : t("passNone"));
    })(),
    (async () => { $("youPoints").textContent = fmtNum(await readUint(CONTRACT, SEL.pointsOf + encUint(day) + encAddress(youAddress))); })(),
    (async () => { $("youCrowns").textContent = "👑 " + fmtNum(await readUint(CONTRACT, SEL.crownsWon + encAddress(youAddress))); })(),
    (async () => {
      const idx = lastBoardRows.findIndex(r => sameAddr(r.addr, youAddress));
      const pts = idx >= 0 ? lastBoardRows[idx].points : 0n;
      $("youRank").textContent = (idx >= 0 && pts > 0n) ? t("rankOf", { rank: idx + 1, total: lastBoardRows.filter(r => r.points > 0n).length }) : t("unranked");
    })()
  ];
  await Promise.allSettled(jobs);
}
$("youCheckBtn").addEventListener("click", () => {
  const v = $("youInput").value.trim();
  if (!validAddress(v)) { showToast(t("toastBadAddress")); return; }
  youAddress = v; paintYou();
});
$("youInput").addEventListener("keydown", e => { if (e.key === "Enter") $("youCheckBtn").click(); });

// ── Wallet connect + direct writes ────────────────────────────
let walletAddress = null;
async function ensureWallet() {
  if (!window.ethereum) { showToast(t("toastNoWallet")); return null; }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts || !accounts.length) { showToast(t("toastNoAccount")); return null; }
  walletAddress = accounts[0];
  try {
    const chain = await window.ethereum.request({ method: "eth_chainId" });
    if (chain !== CROWN_CONFIG.chainHex) {
      try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CROWN_CONFIG.chainHex }] }); }
      catch {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: CROWN_CONFIG.chainHex, chainName: "BNB Smart Chain Mainnet", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: ["https://bsc-dataseed.binance.org/"], blockExplorerUrls: ["https://bscscan.com"] }] });
      }
    }
  } catch { /* chain check is best-effort; the wallet will still refuse a wrong-chain tx */ }
  $("connectBtn").textContent = shortenAddress(walletAddress);
  youAddress = walletAddress; $("youInput").value = walletAddress; paintYou();
  return walletAddress;
}
$("connectBtn").addEventListener("click", () => { ensureWallet().catch(e => showToast(t("toastConnectFail") + (e.message || e))); });
async function sendTx(data, weiValue, okMsg) {
  if (!contractsReady()) { showToast(t("toastNotDeployed")); return; }
  const from = walletAddress || await ensureWallet();
  if (!from) return;
  try {
    const txHash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from, to: CONTRACT, data, value: "0x" + BigInt(weiValue).toString(16) }] });
    showToast(okMsg + " Tx: " + txHash);
    setTimeout(refreshAll, 4000);
  } catch (e) { showToast(t("toastTxFail") + (e.message || e)); }
}
$("mintFreeBtn").addEventListener("click", () => sendTx(SEL.mint, "0", t("toastMintFree")));
$("mintPaidBtn").addEventListener("click", () => sendTx(SEL.mintPaid, PAID_PRICE_WEI, t("toastMintPaid")));
document.querySelectorAll("[data-boost]").forEach(btn => {
  btn.addEventListener("click", () => {
    const tier = Number(btn.getAttribute("data-boost"));
    sendTx(SEL.boost + encUint(tier), TIERS[tier].priceWei, t("toastBoost", { name: t("tierName" + tier), points: TIERS[tier].points }));
  });
});
$("settleBtn").addEventListener("click", () => sendTx(SEL.settleDay, "0", t("toastSettle")));

// ── Language toggle ───────────────────────────────────────────
$("langEn").addEventListener("click", () => setLang("en"));
$("langZh").addEventListener("click", () => setLang("zh"));

// ── Footer wiring + refresh loop ──────────────────────────────
function paintFooter() {
  if (contractsReady()) {
    $("contractAddr").textContent = CONTRACT;
    const scan = $("footerBscScan");
    scan.href = "https://bscscan.com/address/" + CONTRACT; scan.textContent = t("bscScanLive");
    scan.removeAttribute("aria-disabled");
  }
  if (CROWN_CONFIG.xUrl) {
    const x = $("footerX");
    x.href = CROWN_CONFIG.xUrl; x.textContent = "X — @Fukooooof"; x.removeAttribute("aria-disabled");
  }
}
async function refreshAll() {
  if (!contractsReady() || boardState.busy) return;
  boardState.busy = true;
  try { await paintStats(); await refreshBoard(); await refreshHall(); if (youAddress) await paintYou(); }
  catch { /* keep the last good render */ }
  finally { boardState.busy = false; }
}
document.addEventListener("DOMContentLoaded", () => {
  buildPrompts();
  paintFooter();
  applyLang();
  loadBoardCache();
  if (contractsReady()) { refreshAll(); setInterval(refreshAll, 60000); }
});
