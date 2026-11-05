// Agent Crown Race — public site logic.
// Plain static JS, no build step, no libraries. Reads go through a public
// BSC RPC failover pool (sticky last-good endpoint, 9s timeout per call);
// writes go through the visitor's own connected wallet only.
// While CROWN_CONFIG.contractAddress is empty, the site renders its
// "not live yet" state and every on-chain read is skipped safely.
const CROWN_CONFIG = {
  contractAddress: "",          // CrownRace (CROWN) — filled in after the owner deploys via deploy.html
  chainId: 56,                  // BNB Smart Chain Mainnet
  chainHex: "0x38",
  agentIdAddress: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F", // Binance .ai Agent ID NFT (SPACE ID)
  xUrl: ""                      // official X profile URL — filled in at launch
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
  const t = $("toast"); if (!t) return;
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 4200);
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
    try { await navigator.clipboard.writeText(el.value); showToast("Agent prompt copied — paste it to your AI agent."); }
    catch { el.select(); showToast("Copy failed — the prompt text is selected, copy it manually."); }
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
      $("statMinted").textContent = total.toLocaleString("en-US");
      $("statFreeLeft").textContent = Math.max(0, FREE_SUPPLY - total).toLocaleString("en-US");
    })(),
    (async () => {
      const price = await readUint(CONTRACT, SEL.passPrice);
      $("statPassPrice").textContent = price === 0n ? "FREE (0 BNB, gas only)" : formatBNB(price);
    })(),
    (async () => {
      const open = await readBool(CONTRACT, SEL.mintOpen);
      const pill = $("liveStatus");
      pill.textContent = open ? "● MINT OPEN — LIVE" : "CONTRACT LIVE — MINT CLOSED";
      pill.className = "status-pill " + (open ? "status-live" : "status-closed");
      const note = $("mintStateNote");
      note.textContent = open
        ? "Mint is OPEN. Free passes are first-come, first-served — when the 500 are gone, passes cost exactly 0.0007 BNB."
        : "The contract is deployed. Mint opens the moment the owner switches it on.";
      note.classList.toggle("ok", open);
    })(),
    (async () => {
      const leader = await readAddress(CONTRACT, SEL.leader);
      $("statLeader").textContent = (!leader || sameAddr(leader, ZERO_ADDRESS)) ? "No boosts yet" : shortenAddress(leader);
    })(),
    (async () => { $("statLeaderPoints").textContent = (await readUint(CONTRACT, SEL.leaderPoints)).toLocaleString("en-US"); })(),
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
  if (note && total > BOARD_SCAN_CAP) note.textContent = `Pass holders of the latest ${BOARD_SCAN_CAP} passes, ranked by points earned today (UTC). Points reset at every settle.`;
}
async function refreshBoard() {
  const list = $("boardList");
  const total = Number(await readUint(CONTRACT, SEL.totalMinted));
  if (total === 0) { list.innerHTML = '<p class="empty">No passes minted yet — the board is waiting for its first racers.</p>'; lastBoardRows = []; return; }
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
  if (!racers.length) { list.innerHTML = '<p class="empty">Passes are out, but nobody has boosted yet today. The crown is wide open.</p>'; return; }
  list.innerHTML = racers.slice(0, 10).map((r, i) => {
    const you = youAddress && sameAddr(r.addr, youAddress);
    return `<div class="board-row${i === 0 ? " board-first" : ""}${you ? " board-you" : ""}"><span class="board-rank">${i === 0 ? "👑" : "#" + (i + 1)}</span><span class="board-addr">${shortenAddress(r.addr)}${you ? ' <b class="you-chip">YOU</b>' : ""}</span><span class="board-meta"><b>${r.points.toLocaleString("en-US")}</b> pts</span></div>`;
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
  if (!kings.length) { list.innerHTML = '<p class="empty">No day has been settled yet — the first king is crowned at the first settle after 00:00 UTC.</p>'; return; }
  const totals = new Map();
  await Promise.allSettled(kings.map(async k => {
    if (!totals.has(k.addr.toLowerCase())) totals.set(k.addr.toLowerCase(), await readUint(CONTRACT, SEL.crownsWon + encAddress(k.addr)).catch(() => 0n));
  }));
  list.innerHTML = kings.map(k => {
    const total = totals.get(k.addr.toLowerCase());
    const you = youAddress && sameAddr(k.addr, youAddress);
    const date = new Date(k.day * 86400000).toISOString().slice(0, 10);
    return `<div class="board-row${you ? " board-you" : ""}"><span class="board-rank">👑</span><span class="board-addr">${shortenAddress(k.addr)}${you ? ' <b class="you-chip">YOU</b>' : ""}</span><span class="board-meta">Day ${k.day} · ${date}${total ? ` · <b>${total.toLocaleString("en-US")}</b> crown${total === 1n ? "" : "s"} total` : ""}</span></div>`;
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
      $("youPass").textContent = bal > 0n ? "✅ Pass held" : (mintedBefore ? "No pass held (minted once before)" : "No pass yet");
    })(),
    (async () => { $("youPoints").textContent = (await readUint(CONTRACT, SEL.pointsOf + encUint(day) + encAddress(youAddress))).toLocaleString("en-US"); })(),
    (async () => { $("youCrowns").textContent = "👑 " + (await readUint(CONTRACT, SEL.crownsWon + encAddress(youAddress))).toLocaleString("en-US"); })(),
    (async () => {
      const idx = lastBoardRows.findIndex(r => sameAddr(r.addr, youAddress));
      const pts = idx >= 0 ? lastBoardRows[idx].points : 0n;
      $("youRank").textContent = (idx >= 0 && pts > 0n) ? "#" + (idx + 1) + " of " + lastBoardRows.filter(r => r.points > 0n).length : "Unranked — no points yet today";
    })()
  ];
  await Promise.allSettled(jobs);
}
$("youCheckBtn").addEventListener("click", () => {
  const v = $("youInput").value.trim();
  if (!validAddress(v)) { showToast("Paste a valid 0x… wallet address first."); return; }
  youAddress = v; paintYou();
});
$("youInput").addEventListener("keydown", e => { if (e.key === "Enter") $("youCheckBtn").click(); });

// ── Wallet connect + direct writes ────────────────────────────
let walletAddress = null;
async function ensureWallet() {
  if (!window.ethereum) { showToast("No wallet found in this browser. Use the agent prompts above, or open this page in a wallet browser."); return null; }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts || !accounts.length) { showToast("No account approved in the wallet."); return null; }
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
$("connectBtn").addEventListener("click", () => { ensureWallet().catch(e => showToast("Wallet connection failed: " + (e.message || e))); });
async function sendTx(data, weiValue, okMsg) {
  if (!contractsReady()) { showToast("The contract is not deployed yet — this button goes live with it."); return; }
  const from = walletAddress || await ensureWallet();
  if (!from) return;
  try {
    const txHash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from, to: CONTRACT, data, value: "0x" + BigInt(weiValue).toString(16) }] });
    showToast(okMsg + " Tx: " + txHash);
    setTimeout(refreshAll, 4000);
  } catch (e) { showToast("Transaction not sent: " + (e.message || e)); }
}
$("mintFreeBtn").addEventListener("click", () => sendTx(SEL.mint, "0", "Free pass mint sent."));
$("mintPaidBtn").addEventListener("click", () => sendTx(SEL.mintPaid, PAID_PRICE_WEI, "Paid pass mint sent (0.0007 BNB)."));
document.querySelectorAll("[data-boost]").forEach(btn => {
  btn.addEventListener("click", () => {
    const tier = Number(btn.getAttribute("data-boost"));
    sendTx(SEL.boost + encUint(tier), TIERS[tier].priceWei, `${TIERS[tier].name} boost sent (+${TIERS[tier].points} points).`);
  });
});
$("settleBtn").addEventListener("click", () => sendTx(SEL.settleDay, "0", "settleDay() sent — the finished day is being crowned."));

// ── Footer wiring + refresh loop ──────────────────────────────
function paintFooter() {
  if (contractsReady()) {
    $("contractAddr").textContent = CONTRACT;
    const scan = $("footerBscScan");
    scan.href = "https://bscscan.com/address/" + CONTRACT; scan.textContent = "BscScan — contract";
    scan.removeAttribute("aria-disabled");
  }
  if (CROWN_CONFIG.xUrl) {
    const x = $("footerX");
    x.href = CROWN_CONFIG.xUrl; x.textContent = "X — official account"; x.removeAttribute("aria-disabled");
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
  loadBoardCache();
  if (contractsReady()) { refreshAll(); setInterval(refreshAll, 60000); }
});
