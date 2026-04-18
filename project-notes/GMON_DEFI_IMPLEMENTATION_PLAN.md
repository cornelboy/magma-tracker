# gMON DeFi Tracking Implementation Plan

Created: 2026-04-17
Project: `magma-tracker`
Status: Phase 0 started

## Goal

Extend Magma Tracker from wallet-only gMON balance tracking to full gMON exposure tracking across:

- direct wallet holdings
- Magma redeem state
- lending deposits
- lending debt
- LP positions
- vault positions
- collateral positions

The tracker should report both:

- gross gMON exposure
- net gMON exposure after subtracting borrowed gMON

## Deployment Context

Important constraint:

- The project is already deployed on Vercel.
- This work is an in-place upgrade to a live product, not a fresh rebuild.

Implementation consequence:

- preserve the current deployed experience while adding advanced features
- avoid risky all-at-once rewrites that could break production
- stage refactors so the app remains deployable after each milestone
- keep the current wallet/NFT tracker working while new protocol tracking is added

## Current Codebase Snapshot

Observed current state:

- The live app is the root file `main.js`.
- `src/main.ts` is still the default Vite starter and is not the real app entry.
- The app is currently a browser-only frontend.
- RPC calls, contract ABIs, state, rendering, and event logic are all mixed inside `main.js`.
- Current tracked assets are:
  - gMON wallet balance
  - MON wallet balance
  - Scale NFTs
  - Roarrr NFTs
  - global transfer activity feed

Current important files:

- `main.js`
- `index.html`
- `style.css`

## High-Level Decision

Do not add DeFi protocol tracking directly into the existing monolithic `main.js`.

Before adding protocol integrations, refactor the app into a modular structure so adapters can be added safely and the tracker can be resumed or extended without losing context.

Because the site is already live on Vercel, this refactor should be incremental rather than a hard cutover.

## Proposed Target Structure

```text
src/
  main.ts
  app/
    render.ts
    state.ts
  config/
    contracts.ts
    protocols.ts
  lib/
    provider.ts
    format.ts
    multicall.ts
  types/
    exposure.ts
    protocol.ts
  adapters/
    magmaCore.ts
    neverland.ts
    lp.ts
    vault.ts
    collateral.ts
  services/
    getWalletExposure.ts
    getWalletDashboard.ts
  ui/
    dashboard.ts
    protocolPositions.ts
```

## Exposure Model

Use one normalized shape across all integrations.

```ts
interface WalletExposure {
  wallet: string;
  walletGmon: bigint;
  pendingRedeemShares: bigint;
  claimableRedeemShares: bigint;
  claimableRedeemMon: bigint;
  protocolPositions: ProtocolPosition[];
  grossGmonExposure: bigint;
  borrowedGmon: bigint;
  netGmonExposure: bigint;
}

interface ProtocolPosition {
  protocol: string;
  category: 'lending' | 'lp' | 'vault' | 'collateral' | 'redeem';
  suppliedGmon: bigint;
  borrowedGmon: bigint;
  underlyingGmon: bigint;
  claimableMon: bigint;
  metadata?: Record<string, string>;
}
```

## Calculation Rules

Definitions:

- `walletGmon`: direct `gMON.balanceOf(wallet)`
- `pendingRedeemShares`: shares in pending Magma redeem request
- `claimableRedeemShares`: shares already claimable from redeem request
- `claimableRedeemMon`: `convertToAssets(claimableRedeemShares)`

Recommended exposure math:

- `grossGmonExposure = walletGmon + protocol supplied/underlying gMON + pendingRedeemShares + claimableRedeemShares`
- `borrowedGmon = sum of all gMON debt positions`
- `netGmonExposure = grossGmonExposure - borrowedGmon`

Important display note:

- Claimable MON should be shown separately even if claimable shares are included in gross gMON exposure, so users can see that part of the position is already exiting.

## Confirmed Contracts From Research

These can be implemented immediately if the addresses remain correct:

- Magma gMON: `0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081`
- Neverland gMON aToken: `0x7f81779736968836582d31d36274ed82053ad1ae`
- Neverland gMON stable debt: `0xd8842741b71e01aee846abec07cf26c52302d010`
- Neverland gMON variable debt: `0x905999cc7b7e26c1cb2761f6c00909b65c862b78`

## Missing or Unverified Inputs

These should be added to a protocol registry once verified:

- Curvance gMON market or `cgMON` contract address
- Curvance reader call shape if balance conversion is not 1:1
- vault contract addresses for Enjoyoors / Atlantis / Covenant
- LP pair addresses if factory lookup is not dependable
- CDP/collateral contract addresses for Monata or TownSquare-style integrations
- any wrapped or bridged gMON contract variants that should count toward exposure

Rule:

- Do not silently implement unknown addresses as zero-value placeholders in logic.
- Missing protocols should be marked as `unverified` in registry/config so the UI can display them as unsupported rather than invisible.

## Phase Plan

### Phase 0: Refactor Foundation

Objective:

Move the real app from root `main.js` into modular TypeScript files under `src/` without breaking the deployed product.

Tasks:

- move config and ABI definitions into `src/config/`
- move provider initialization into `src/lib/provider.ts`
- create common formatting helpers
- isolate wallet lookup orchestration from DOM rendering
- keep current wallet balance and NFT features working during refactor
- update Vite entry to use the real TypeScript app instead of the starter template
- preserve the same public page structure unless a UI section is intentionally enhanced
- make sure each intermediate state still builds cleanly for Vercel

Definition of done:

- app behavior matches current tracker
- root `main.js` is no longer the source of truth
- balance lookup flow is modular
- Vercel deployment remains safe after this phase

### Phase 1: Core Magma Exposure

Objective:

Track direct wallet gMON and redeem state.

Tasks:

- add `magmaCore` adapter
- query:
  - `balanceOf(address)`
  - `ownerRequestId(address)`
  - `pendingRedeemRequest(requestId, address)`
  - `claimableRedeemRequest(requestId, address)`
  - `convertToAssets(shares)`
- merge these values into the normalized exposure shape
- add dashboard UI for:
  - wallet gMON
  - pending redeem shares
  - claimable redeem shares
  - claimable MON
  - gross exposure

Definition of done:

- empty wallet returns zeros
- wallet-only holder returns direct balance
- pending redeem and claimable redeem states display correctly

### Phase 2: Neverland Lending Integration

Objective:

Track gMON supplied to and borrowed from Neverland.

Tasks:

- add `neverland` adapter
- read aToken `balanceOf(user)`
- read stable debt `balanceOf(user)`
- read variable debt `balanceOf(user)`
- compute:
  - `suppliedGmon`
  - `borrowedGmon`
  - net contribution
- display Neverland protocol row in UI

Definition of done:

- deposit-only wallet reflects protocol-supplied gMON
- borrowed gMON reduces net exposure but does not hide gross exposure

### Phase 3: Registry-Driven Protocol Framework

Objective:

Make further integrations data-driven instead of hardcoded ad hoc logic.

Tasks:

- add `protocols.ts` registry
- define per-protocol metadata:
  - name
  - category
  - status
  - contracts
  - adapter key
- support toggling protocols on/off by verification state
- make unsupported protocols visible in the UI or logs

Definition of done:

- new protocols can be added mostly by registry entry plus adapter

### Phase 4: LP Positions

Objective:

Track gMON held inside LP tokens.

Tasks:

- implement V2-style LP adapter
- resolve pair address from registry or factory
- read:
  - user LP balance
  - reserves
  - total supply
- compute proportional gMON underlying
- support pairs like:
  - gMON / WMON
  - gMON / USDC

Notes:

- Prefer explicit pair registry entries at first.
- Do not perform expensive factory scans on every wallet lookup.

Definition of done:

- known LP positions correctly show gMON underlying allocation

### Phase 5: Vaults and ERC4626 Positions

Objective:

Track gMON deposited into vaults.

Tasks:

- add ERC4626 vault adapter
- read:
  - `balanceOf(user)`
  - `convertToAssets(shares)`
- report vault shares and underlying gMON

Definition of done:

- known vault positions show correct underlying gMON

### Phase 6: Collateral and CDP Positions

Objective:

Track gMON locked as collateral.

Tasks:

- add collateral adapter per supported protocol
- read collateral balances and related debt
- decide display rules for collateral-only vs collateral plus debt

Definition of done:

- collateral is reported distinctly from wallet or lending balances

### Phase 7: UX and Reliability

Objective:

Make the tracker resilient and readable.

Tasks:

- add per-adapter error isolation
- show partial data if one protocol fails
- add loading states for protocol rows
- cache static registry/config data
- reduce duplicate RPC reads with batched calls where possible
- export protocol exposure data in CSV

Definition of done:

- one failing adapter does not blank the full dashboard

## Vercel Rollout Strategy

Recommended release approach:

1. keep current features stable while introducing the new data layer behind the same UI
2. land Magma core exposure first
3. land Neverland after core output is validated
4. add deeper protocol coverage only after known-good production checks

Recommended engineering constraints for live deployment:

- avoid a large one-shot rewrite
- keep the current `index.html` and styling compatible where possible
- ensure `vite build` passes at every milestone
- minimize extra RPC calls on initial page load
- only fetch protocol positions after a wallet lookup, not globally
- fail soft if a protocol adapter breaks

Optional later improvement for Vercel:

- move heavy or expensive aggregation into serverless functions only if browser RPC limits become a problem
- keep MVP browser-side if response time remains acceptable

## UI Changes Needed

Current cards are too limited for protocol tracking.

Recommended dashboard additions:

- wallet gMON
- gMON in protocols
- borrowed gMON
- net gMON exposure
- claimable MON

Recommended protocol section:

- table or card list of protocol positions
- one row per protocol and category
- columns:
  - protocol
  - category
  - supplied
  - borrowed
  - underlying
  - notes

## Testing Plan

Test cases to cover:

1. empty wallet
2. wallet with only direct gMON balance
3. wallet with pending redeem
4. wallet with claimable redeem
5. wallet with Neverland deposit only
6. wallet with Neverland deposit plus gMON debt
7. wallet with mixed wallet balance plus protocol balance
8. protocol failure where one adapter errors and others still render

Testing strategy:

- unit test adapter calculations with mocked contract responses
- run manual wallet checks against known addresses
- compare aggregate output against direct on-chain inspection

## Risks and Constraints

- The app is client-side, so every new integration increases browser RPC load.
- Unknown protocol addresses block complete coverage.
- LP and vault tracking can become inaccurate if assumptions about reserve math or share conversion are wrong.
- Monad RPC limits may require call batching or request throttling.
- Browser-only architecture is acceptable for MVP on Vercel, but serverless routes or an indexer may be needed later for scale.
- Since the app is already live, regressions to existing wallet/NFT tracking are a deployment risk.

## Recommended MVP Scope

Implement first:

1. Phase 0 refactor
2. Phase 1 Magma core exposure
3. Phase 2 Neverland integration
4. basic protocol UI
5. deploy in small safe increments on Vercel

Delay until verified:

- Curvance
- LP tracking
- vault tracking
- collateral/CDP integrations

## Session Resume Checklist

When work resumes, start here:

1. create normalized exposure types
2. implement `magmaCore` adapter
3. implement `getWalletExposure()`
4. update dashboard UI to show exposure instead of only wallet balance
5. implement Neverland adapter
6. verify output on at least one real wallet per scenario
7. confirm the build remains safe for Vercel deployment before broadening protocol coverage

## Open Questions

- Should pending redeem shares count in the top-line exposure number, or should they be displayed only as a separate exit-state bucket?
- Should claimable redeem shares continue counting toward gross exposure after they are claimable, or should top-line shift to claimable MON?
- Do we want unsupported protocols listed in the UI as "coming soon" or hidden entirely?
- Is the project staying browser-only for MVP, or should a lightweight API route be introduced later?

## Change Log

### 2026-04-17

- Created persistent implementation plan file for gMON DeFi exposure tracking.
- Captured current architecture limits and phased rollout.
- Defined MVP scope as Magma core plus Neverland.
- Added deployment context and rollout guidance for the existing live Vercel app.
- Started Phase 0 refactor.
- Added shared modules under `src/config` and `src/lib`.
- Moved the live app entry from root `main.js` to `src/main.ts`.
- Updated `index.html` to load the TypeScript app entry.
- Confirmed `npm run build` passes after the refactor.
