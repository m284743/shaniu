# shaniu-mcp

MCP server for **Agent Shaniu (SHANIU)** — the first AI-driven community meme coin on BNB Smart Chain (chainId 56).

- Website: https://bn.shaniu.ai
- Token: `0x67B8c7abeB7A6b6ef29f15032423AfAB4006888f` (ownership renounced, no mint beyond `claim()`)
- Order-book market: `0xCF19D05878Ab8bC53280299442De280afaaA16C8` (no AMM pool)
- Cart (multi-fill): `0x159B19466ECA122DC0E177d9Db6d570Abd1e07d6`
- Docs: https://bn.shaniu.ai/agent · llms.txt: https://bn.shaniu.ai/llms.txt

## Tools

| Tool | Type | What it does |
|---|---|---|
| `shaniu_stats` | read | Supply, pool remaining, claim count, live claim fee (BNB/USD oracle), optional wallet balance / claimed status |
| `shaniu_prepare_claim` | tx-prep | Unsigned `claim()` mint tx `{to, data, valueWei}`. Caller must hold a Binance Agent ID; one claim per address; block-hash lottery reward (50–150 typical, up to 21,000; last claim sweeps the pool) |
| `shaniu_market_orders` | read | Fillable sell orders, cheapest first (id, maker, remaining, price) |
| `shaniu_prepare_buy` | tx-prep | Unsigned `buy` / cart `buyMany` tx with exact BNB cost computed from on-chain prices |
| `shaniu_prepare_list` | tx-prep | Two-step sell: `approve` + `list(amount, priceWei)` |
| `shaniu_invite_stats` | read | Referral program stats (global or per-address) |
| `shaniu_invite_register` | write | Register referral intent (pre-claim) or bind by claim tx hash |

`prepare` tools never sign anything — they return transaction intents for the user's own wallet to sign and broadcast.

## Install

```bash
npm install
node server.js        # stdio transport
```

Environment: `BSC_RPC` (optional, defaults to `https://bsc-dataseed.bnbchain.org`).

### Claude Desktop / Kimi / Cursor config

```json
{
  "mcpServers": {
    "shaniu": {
      "command": "node",
      "args": ["/absolute/path/to/shaniu-mcp/server.js"]
    }
  }
}
```

## Referral quick reference

- Invite link: `https://bn.shaniu.ai/?ref=<INVITER_ADDRESS>`
- Reward per invited claim: 10 / 50 / 200 / 1,000 SHANIU (90% / 8% / 1.8% / 0.2%), budget 210,000 SHANIU
- Register before the invitee claims: `shaniu_invite_register(inviter, invitee)`

## Community

- X: https://x.com/kristi77457
- Telegram: https://t.me/shaniumeme
