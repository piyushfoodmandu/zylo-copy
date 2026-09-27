# Hermes + Arro Quickstart

## Goal

Connect Hermes to Arro's canonical MCP endpoint and prove the shopper flow without adding host-specific commerce logic.

## 1. API

For the current team preview:

```text
https://api.atishghimire.com.np/v1/mcp
```

For production use the release `PUBLIC_BASE_URL`.

## 2. Hermes config

Use:

```text
agent-skills/arro-commerce-preflight/examples/hermes-mcp-config.yaml
```

and the skill:

```text
agent-skills/arro-commerce-preflight/SKILL.md
```

## 3. Smoke flow

Ask Hermes to:
1. run `agent_diagnostics`;
2. search for one real product with `search_products`;
3. inspect it with `get_product_detail`;
4. compare alternatives if useful;
5. prepare a purchase;
6. follow the returned payment/merchant action;
7. confirm only when authority is present;
8. call `get_purchase` until merchant Order state is known.

## 4. What the user should see

At minimum:
- merchant/source name;
- price;
- availability;
- freshness;
- selected product;
- required action;
- merchant-hosted continuation when needed;
- final Order or exact blocker.

Do not expose protocol JSON simply because the host can.

## 5. Verify distribution kit

```bash
npm --workspace @arro/api run verify:agent-distribution-kit
```

This checks the capability manifest, MCP tool surface, skill/examples and rendering evidence.

## 6. Failure handling

If search is unavailable, surface the source error.

If checkout requires a merchant handoff, present it.

If a payment action is pending, do not claim completion.

If completion times out, retrieve/reconcile before another write.

Hermes should remain a clean interaction surface; Arro owns commerce continuity.
