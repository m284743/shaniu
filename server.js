#!/usr/bin/env node
// Agent Shaniu (SHANIU) MCP server — stdio transport.
// Read tools query BSC via public RPC; "prepare" tools return unsigned
// transaction intents ({to, data, valueWei}) for the agent's own wallet to sign.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPublicClient, http, parseAbi, formatEther, parseEther, encodeFunctionData } from "viem";
import { bsc } from "viem/chains";

const TOKEN = "0x67B8c7abeB7A6b6ef29f15032423AfAB4006888f";
const MARKET = "0xCF19D05878Ab8bC53280299442De280afaaA16C8";
const CART = "0x159B19466ECA122DC0E177d9Db6d570Abd1e07d6";
const API = "https://bn.shaniu.ai";
const RPC = process.env.BSC_RPC || "https://bsc-dataseed.bnbchain.org";

const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function poolRemaining() view returns (uint256)",
  "function claimCount() view returns (uint256)",
  "function claimOpen() view returns (bool)",
  "function claimFeeWei() view returns (uint256)",
  "function hasClaimed(address) view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function claim() payable",
  "function approve(address spender, uint256 value) returns (bool)",
]);
const marketAbi = parseAbi([
  "function orderCount() view returns (uint256)",
  "function orders(uint256) view returns (address maker, uint256 amount, uint256 filled, uint256 priceWei, bool active)",
  "function remaining(uint256 id) view returns (uint256)",
  "function list(uint256 amount, uint256 priceWei) returns (uint256)",
  "function buy(uint256 id, uint256 amount) payable",
  "function delist(uint256 id)",
]);
const cartAbi = parseAbi(["function buyMany(uint256[] ids, uint256[] amounts) payable"]);

const pub = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 15000 }) });
const read = (address, abi, functionName, args = []) =>
  pub.readContract({ address, abi, functionName, args });
const txt = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });

const server = new McpServer(
  { name: "shaniu-mcp", version: "1.0.0" },
  {
    instructions:
      "Agent Shaniu (SHANIU): first AI-driven community meme coin on BSC (chainId 56). " +
      "Mint = call claim() on token 0x67B8c7abeB7A6b6ef29f15032423AfAB4006888f (caller wallet must hold a Binance Agent ID; one claim per address). " +
      "Trade = on-chain order book 0xCF19D05878Ab8bC53280299442De280afaaA16C8 (no AMM pool; never sell via plain transfer). " +
      "All 'prepare' tools return unsigned tx intents {to, data, valueWei} — sign and broadcast with the user's own wallet. Invite link: https://bn.shaniu.ai/?ref=<address>.",
  }
);

server.tool(
  "shaniu_stats",
  "Live SHANIU stats: total supply, claim pool remaining, claim count, current claim fee (wei of BNB, ~0.2 USD via Chainlink oracle), whether claiming is open, and optionally a wallet's balance / claimed status.",
  { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("Optional wallet to check balance and hasClaimed") },
  async ({ address }) => {
    const [supply, pool, count, fee, open] = await Promise.all([
      read(TOKEN, tokenAbi, "totalSupply"),
      read(TOKEN, tokenAbi, "poolRemaining"),
      read(TOKEN, tokenAbi, "claimCount"),
      read(TOKEN, tokenAbi, "claimFeeWei"),
      read(TOKEN, tokenAbi, "claimOpen"),
    ]);
    const out = {
      token: TOKEN, market: MARKET, cart: CART, chainId: 56,
      totalSupply: formatEther(supply),
      poolRemaining: formatEther(pool),
      claimCount: count.toString(),
      claimFeeWei: fee.toString(),
      claimFeeBNB: formatEther(fee),
      claimOpen: open,
    };
    if (address) {
      const [bal, claimed] = await Promise.all([
        read(TOKEN, tokenAbi, "balanceOf", [address]),
        read(TOKEN, tokenAbi, "hasClaimed", [address]),
      ]);
      out.wallet = { address, balanceSHANIU: formatEther(bal), hasClaimed: claimed };
    }
    return txt(out);
  }
);

server.tool(
  "shaniu_prepare_claim",
  "Prepare an unsigned claim() (mint) transaction. Caller wallet must hold a Binance Agent ID (.ai); one claim per address; reward is a block-hash lottery (50-150 typical, up to 21,000; last claim sweeps the pool). Returns {to, data, valueWei} to sign with the user's wallet.",
  { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Wallet that will claim (gets the tokens)") },
  async ({ address }) => {
    const [fee, claimed, open] = await Promise.all([
      read(TOKEN, tokenAbi, "claimFeeWei"),
      read(TOKEN, tokenAbi, "hasClaimed", [address]),
      read(TOKEN, tokenAbi, "claimOpen"),
    ]);
    if (!open) return txt("Claiming is closed (pool exhausted).");
    if (claimed) return txt(`Address ${address} has already claimed. One claim per address.`);
    return txt({
      to: TOKEN,
      data: encodeFunctionData({ abi: tokenAbi, functionName: "claim" }),
      valueWei: fee.toString(),
      valueBNB: formatEther(fee),
      chainId: 56,
      note: "Sign & broadcast from the claiming wallet. Gas paid by caller. Random SHANIU amount minted to msg.sender.",
    });
  }
);

server.tool(
  "shaniu_market_orders",
  "List currently fillable sell orders on the on-chain order book, cheapest first. Each order: id, maker, remainingSHANIU, priceBNBperToken. No AMM pool exists — buying fills these orders atomically.",
  { limit: z.number().int().min(1).max(100).default(20).describe("Max orders to return") },
  async ({ limit }) => {
    const n = Number(await read(MARKET, marketAbi, "orderCount"));
    // 两轮 multicall：先取 orders，再取 remaining，避免逐单 RPC 超时
    const CHUNK = 200;
    const orderRes = [];
    for (let s = 0; s < n; s += CHUNK) {
      const calls = [];
      for (let i = s; i < Math.min(s + CHUNK, n); i++)
        calls.push({ address: MARKET, abi: marketAbi, functionName: "orders", args: [BigInt(i)] });
      orderRes.push(...await pub.multicall({ contracts: calls, allowFailure: true }));
    }
    const actives = [];
    orderRes.forEach((r, i) => { if (r.status === "success" && r.result[4]) actives.push({ i, o: r.result }); });
    const remRes = [];
    for (let s = 0; s < actives.length; s += CHUNK) {
      const calls = actives.slice(s, s + CHUNK).map((a) => ({
        address: MARKET, abi: marketAbi, functionName: "remaining", args: [BigInt(a.i)],
      }));
      remRes.push(...await pub.multicall({ contracts: calls, allowFailure: true }));
    }
    const rows = [];
    actives.forEach((a, j) => {
      const r = remRes[j];
      if (r?.status === "success" && r.result > 0n)
        rows.push({ id: a.i, maker: a.o[0], remainingSHANIU: formatEther(r.result), priceWei: a.o[3] });
    });
    rows.sort((a, b) => (a.priceWei < b.priceWei ? -1 : 1));
    const out = rows.map(({ priceWei, ...r }) => ({ ...r, priceBNBperToken: formatEther(priceWei) }));
    return txt({ market: MARKET, totalOrders: n, fillable: out.length, orders: out.slice(0, limit) });
  }
);

server.tool(
  "shaniu_prepare_buy",
  "Prepare an unsigned buy transaction that fills one or more sell orders. Computes exact BNB cost. Single order uses the market contract; multiple orders use the cart contract (buyMany) in one tx.",
  {
    fills: z.array(z.object({
      id: z.number().int().min(0).describe("Order id"),
      amountSHANIU: z.string().describe("Amount to buy, e.g. \"100\""),
    })).min(1).max(50),
  },
  async ({ fills }) => {
    let total = 0n;
    const checked = [];
    for (const f of fills) {
      const o = await read(MARKET, marketAbi, "orders", [BigInt(f.id)]);
      if (!o[4]) return txt(`Order ${f.id} is not active.`);
      const r = await read(MARKET, marketAbi, "remaining", [BigInt(f.id)]);
      const amt = parseEther(f.amountSHANIU);
      if (amt <= 0n || amt > r) return txt(`Order ${f.id}: requested ${f.amountSHANIU} exceeds fillable ${formatEther(r)}.`);
      total += (amt * o[3]) / 10n ** 18n;
      checked.push({ id: f.id, amountWei: amt.toString(), priceWei: o[3].toString() });
    }
    if (fills.length === 1) {
      return txt({
        to: MARKET, chainId: 56,
        data: encodeFunctionData({ abi: marketAbi, functionName: "buy", args: [BigInt(fills[0].id), parseEther(fills[0].amountSHANIU)] }),
        valueWei: total.toString(), valueBNB: formatEther(total),
        note: "Atomic fill: SHANIU transfers to buyer, BNB to seller, in one transaction.",
      });
    }
    return txt({
      to: CART, chainId: 56,
      data: encodeFunctionData({
        abi: cartAbi, functionName: "buyMany",
        args: [checked.map((c) => BigInt(c.id)), checked.map((c) => BigInt(c.amountWei))],
      }),
      valueWei: total.toString(), valueBNB: formatEther(total),
      note: "Multi-fill via cart contract. All-or-nothing per order amounts.",
    });
  }
);

server.tool(
  "shaniu_prepare_list",
  "Prepare unsigned transactions to list SHANIU for sale: (1) approve the market contract, (2) list(amount, priceWei). The tokens stay in the seller's wallet until filled — the market is authorization-based, no custody.",
  {
    amountSHANIU: z.string().describe("Total amount to list, e.g. \"817\""),
    priceBNBperToken: z.string().describe("BNB price per 1 SHANIU, e.g. \"0.0000078\""),
  },
  async ({ amountSHANIU, priceBNBperToken }) => {
    const amount = parseEther(amountSHANIU);
    const price = parseEther(priceBNBperToken);
    if (amount <= 0n || price <= 0n) return txt("Amount and price must be positive.");
    return txt({
      steps: [
        {
          step: 1, to: TOKEN, chainId: 56,
          data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [MARKET, amount] }),
          valueWei: "0", note: "Approve market to pull your SHANIU when filled.",
        },
        {
          step: 2, to: MARKET, chainId: 56,
          data: encodeFunctionData({ abi: marketAbi, functionName: "list", args: [amount, price] }),
          valueWei: "0", note: "Creates the sell order. Only you can delist it.",
        },
      ],
      note: "Send step 1, wait for confirmation, then step 2. To cancel later: delist(id) on the market contract.",
    });
  }
);

server.tool(
  "shaniu_invite_stats",
  "Referral program stats: global slots/budget usage, and (with address) one inviter's bound count, earned and pending SHANIU. Invite link format: https://bn.shaniu.ai/?ref=<address>",
  { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() },
  async ({ address }) => {
    const r = await fetch(`${API}/api/invite${address ? `?address=${address}` : ""}`);
    return txt(await r.json());
  }
);

server.tool(
  "shaniu_invite_register",
  "Register a referral binding. Prefer mode=intent BEFORE the invitee calls claim(); or bind after the fact with the invitee's claim tx hash. Always ask your user for consent first. Rewards (10/50/200/1000 SHANIU tiers) roll automatically and are paid in batches.",
  {
    inviter: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    invitee: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    claimTx: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional().describe("Omit for pre-claim intent registration"),
  },
  async ({ inviter, invitee, claimTx }) => {
    const body = claimTx ? { inviter, invitee, claimTx } : { mode: "intent", inviter, invitee };
    const r = await fetch(`${API}/api/invite`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return txt(await r.json());
  }
);

await server.connect(new StdioServerTransport());
