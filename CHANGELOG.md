# Magma Tracker - Development Changelog

## Session Summary (March 22, 2026)

### Features & Additions
- **Live Ecosystem Activity Feed**: Added a real-time feed at the bottom of the page tracking live transfers for gMON, Scale, and Roarrr NFTs.
- **Smart Transaction Classification**: Implemented logic to automatically categorize activity feed events into cleaner actions:
  - **Stake / Unstake** (for gMON interactions with the zero address).
  - **Mint / Burn** (for NFT interactions with the zero address).
  - **Transfer** (for standard wallet-to-wallet movements).
- **Global Market Overview**: Moved the MON/gMON price and historical chart to the top of the page, making it instantly visible before users even search for a wallet.

### Technical Improvements & Bug Fixes
- **Dynamic Block Fetching**: Upgraded the `eth_getLogs` logic to fetch in precise 100-block chunks (up to 5,000 blocks backward) to perfectly comply with Monad RPC rate limits without crashing the feed.
- **RPC & Explorer Configuration**: Switched to the official `https://rpc.monad.xyz` endpoint to bypass local CORS errors, and updated the block explorer links to the official Etherscan-backed `monadscan.com`.
- **UI Polish**: Fixed font readability issues (swapping Audiowide to Inter for generic text) and updated loading placeholders to be more crypto-native ("Scanning recent blocks for activity...").

### Future Ideas Discussed
- **Whale Alerts**: Exploring the possibility of highlighting massive gMON transactions natively in the live feed.
- **Top 50 Leaderboard**: Noted that building a static "Rich List" of top holders will require an enterprise indexer API key in the future, as standard RPC nodes block bulk token-holder queries.
