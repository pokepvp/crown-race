# Agent Crown Race 👑

A daily crown competition for Binance Agent ID (.ai) holders on BNB Chain.

Every UTC day, Crown Pass holders race for the crown: boost your points with small repeatable BNB boosts, and the day's points leader wins the Crown plus 50% of that day's boost pool when the day is settled. The other 50% goes to the project owner.

## Status

**Deployed — mint is open (2026-11-05).** CrownRace is live on BNB Smart Chain at `0x924B1c9203EBC3EE3D4Fd2Af758B2DBDD3856e0c`, deployed by the owner from their own wallet via `deploy.html`, and the owner has opened the mint. The contract was built and fully tested locally (50/50 ganache checks) before deployment.

## How it works

- **Crown Pass (CROWN)** — ERC-721, max supply 2,222, one pass per wallet, minting requires holding a Binance Agent ID (.ai NFT).
- **Free lane** — the first 500 passes are free (`mint()`, value 0). After they are gone, a pass costs exactly 0.0007 BNB (`mintPaid()`).
- **Boosts** (pass holders only, repeatable): Spark 0.00015 BNB = +5 pts · Surge 0.0005 BNB = +20 pts · Crown Rush 0.0015 BNB = +75 pts.
- **Settle** — after 00:00 UTC anyone can call `settleDay()`; the day's leader is paid 50% of the day's boost pool and recorded as that day's King.
- **Paid Founders** — passes #501–#1000 carry the Paid Founder lane (crimson-ribbon art, permanent wall on the site).
- **Opening guarantee (5–11 Nov 2026)** — each day's winner is guaranteed at least 0.002 BNB in total; the contract pays its 50% pool share and the project tops up the rest manually.
- **Weekly Crown Jackpot** — 20% of every paid mint (0.00014 BNB) accrues per 7-day period (Thu–Wed, UTC); the holder with the most daily crowns in the period wins it, paid by the project within 24 hours of the period end.

## Repository structure

- `index.html`, `app.js`, `styles.css`, `icon.svg` — the public site (live race board, Hall of Kings, agent prompt blocks).
- `deploy.html` — owner-only deploy & manage page (deploy, set base URI, open/close mint, settle, withdraw).
- `llms.txt` / `mint.json` — machine-readable mint/boost/settle instructions for AI agents.
- `contracts/CrownRace.sol` — the single contract (pass + boost + daily settle).

Contract source is published here for verification; the deployed contract should be verified on BscScan/Sourcify against this source.
