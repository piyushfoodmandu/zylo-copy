# Native Checkout

> **Status:** implementation source of truth. Arro has shared UCP checkout orchestration and review, native Stripe/Google Pay executors, a standard UCP embedded host for web/iOS/Android, and an isolated Shopify Checkout Kit presentation adapter. These are implementations, not proof of a completed live native purchase. Direct payment still requires the merchant's accepted credential contract and production account configuration. Generic ECP and native SDK behavior still need device/merchant verification through a merchant-returned Order. Apple Pay and the constrained payment-authentication Actions runner are not enabled.
>
> **Protocol baseline:** UCP `2026-08-25`, the latest published release verified on 2026-09-02. See the [release notes](https://github.com/Universal-Commerce-Protocol/ucp/releases/tag/v2026-08-25) and [versioned Checkout specification](https://ucp.dev/2026-08-25/specification/shopping/checkout/).

## Product decision

Arro checkout is **native first**. A shopper using the mobile app should remain in Arro's native interface from cart review through payment and receipt whenever the merchant and an installed payment handler support that path.

UCP does not require a web browser. REST, MCP, A2A, and Embedded Checkout are protocol bindings or integration mechanisms, not product mandates; the [versioned protocol overview](https://ucp.dev/2026-08-25/specification/overview/) describes their distinct roles. Arro's first-party app uses the [UCP REST checkout binding](https://ucp.dev/2026-08-25/specification/shopping/checkout/rest/) through the Arro backend. Arro already exposes MCP for agent clients; neither MCP nor A2A is the first-party shopper UI.

The execution hierarchy is:

1. **Native checkout:** Arro renders checkout; a native provider sheet acquires an opaque payment credential.
2. **Native checkout plus a typed payment action:** Arro stays native except for the isolated browser-capable surface required for device-data collection or a 3DS challenge.
3. **Embedded Checkout:** a supported per-checkout UCP embedded binding selects the generic web iframe or native WebView. When no such binding exists, Shopify-owned payment-handler declarations can select the separate official Checkout Kit adapter on native. Neither the catalog source nor a `/checkout` URL is treated as proof of a merchant platform.
4. **External continuation:** open the merchant's `continue_url` only for `requires_escalation` or an unsupported merchant flow.
5. **Recover, never improvise:** preserve the checkout and reconcile with the merchant after interruption, timeout, or ambiguous completion. Never manufacture a successful order.

An embedded WebView and an external browser are fallbacks. Neither is called “native checkout.” The [versioned Embedded Checkout specification](https://ucp.dev/2026-08-25/specification/shopping/checkout/embedded/) governs when and how a merchant UI may be embedded.

### Shared checkout presentation

Shopify Global Catalog remains the initial discovery source; it does not define
Arro's checkout engine. `Purchase.nextAction.presentation` tells the app which
continuation it can present. Native Stripe/Google Pay execution retains priority
when the merchant checkout is ready and a matching executor is available.

| Presentation | Selection evidence | App behavior |
|---|---|---|
| `ucp_embedded` | Checkout `ucp.services["dev.ucp.shopping"]` contains an `embedded` binding with `config.delegate`, matching the supported session version | Web iframe / native WebView, sharing the same ECP processor |
| `native_checkout`, provider `shopify` | Checkout declares a nonempty `dev.shopify.card` or `dev.shopify.shop_pay` handler list | Native SDK adapter; ordinary exact-URL continuation on web |
| `browser` | No supported embedded binding or installed merchant adapter selected | Merchant's exact continuation URL |

The generic ECP host requests no delegations. The merchant therefore renders
address/payment controls; Arro does not promise credential or fulfillment
delegations it cannot execute. Initialization uses `ec_version` and an empty
`ec_delegate`; Arro relay tokens are never invented as merchant `ec_auth`.
`ec.ready` receives the negotiated UCP envelope. Lifecycle/state notifications
receive no JSON-RPC response. `ec.complete` triggers a merchant refresh, not a
client-authored order. Unsupported authentication and terminal errors close the
embedded context and show an explicit recovery choice. SDK preload applies only
to a selected merchant continuation, never to order or authentication URLs.

The lightweight `@arro/contracts/embedded-checkout` entry point deliberately has
no runtime schema dependency. Importing the schema barrel into Expo's checkout
bundle exposed a TypeBox/Metro SSR failure during verification; web and native
now share only the protocol logic they execute.

Source locations: `packages/contracts/src/embedded-checkout.ts`,
`apps/api/src/checkout-presentation.ts`, `apps/app/src/checkout/`, and
`apps/app/src/payments/checkout-presentation.ts`. The server host relay also uses
the shared protocol processor; it no longer implements invented
`ec.delegation.accept`, `ec.authorization.request`, or `ec.completed` methods.

Research checked 2026-09-05: [Google's native checkout flow](https://developers.google.com/merchant/ucp/guides/overview/native-checkout),
[Shopify Checkout MCP](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp),
[UCP's embedded binding](https://ucp.dev/2026-08-25/specification/shopping/checkout/embedded/),
and [UCP Checker's August release analysis](https://ucpchecker.com/blog/ucp-v2026-08-25-spec-update).
Implementation follows the versioned UCP binding; provider documentation is
checked against the actual merchant response rather than treated as permission
to complete arbitrary merchant payments.

## What shipping ecosystems actually do

The useful comparison is who renders the experience and who remains the
transaction authority—not whether a provider markets an SDK as “native.”

| Product path | Buyer-facing surface | Transaction authority | Lesson for Arro |
|---|---|---|---|
| Google UCP Native Checkout in AI Mode and Gemini | Google renders the checkout directly and uses Google Pay credentials; the merchant exposes create, update and complete REST operations | Merchant stays Merchant of Record and returns the checkout/order state | This is Arro's first-party target: platform-rendered UI, native credential sheet, merchant-authoritative completion—not a browser redirect |
| Google UCP Embedded Checkout | Approved merchant UI runs in an embedded protocol surface | Merchant owns the embedded checkout and final Order | Keep as an explicit compatibility path for bespoke merchant flows, not the default for an executable native handler |
| Shopify agentic commerce | UCP-shaped MCP tools cover discovery, carts and checkout; the documented general flow hands payment to the merchant, while Shop Pay is a separately registered handler | Shopify merchant/checkout remains authoritative | Protocol discovery and cart portability do not imply that Arro can execute every merchant payment method itself |
| Shopify Checkout Kit for mobile | A checkout URL is presented inside Shopify's iOS, Android or React Native SDK using the Embedded Checkout Protocol | Shopify processes payment and creates the order | A contained in-app checkout is much better than losing app context, but it is still an embedded merchant experience rather than Arro-rendered native UCP checkout |
| Shopify accelerated checkout | Shop Pay or Apple Pay can launch from product/cart surfaces after platform, store and wallet configuration | Shopify and the configured payment stack complete the order | Wallet buttons require a real merchant/provider contract; their existence in another ecosystem is not a portable UCP handler Arro may invent |

Primary implementation references: [Google UCP overview](https://developers.google.com/merchant/ucp/guides/overview), [Google native checkout](https://developers.google.com/merchant/ucp/guides/overview/native-checkout), [Shopify agentic commerce](https://shopify.dev/docs/agents), [Shopify Checkout Kit](https://shopify.dev/docs/storefronts/mobile/checkout-kit), and [Shopify accelerated checkouts](https://shopify.dev/docs/storefronts/mobile/checkout-kit/accelerated-checkouts).

The common pattern is stable: the host removes navigation friction and renders
the highest-quality surface it truly owns; it does not steal pricing, tax,
payment or Order authority from the merchant. Arro should therefore share one
checkout state model across web and native while keeping provider SDK execution
platform-specific.

### Verified Shopify path

Arro's current Shopify path is production UCP, not a sandbox: it discovers the
storefront profile, creates the merchant cart, converts that cart into a Checkout
and renders the incomplete Checkout in Arro for buyer/address review. On
2026-09-05 the public Arro API completed that sequence against the live Roborock
US Shopify store and returned HTTP 200 with a durable Arro purchase ID. The web
handoff reached the merchant's production checkout with the exact $1,099.99 item
and live Shop Pay, Google Pay, PayPal, Visa, and Mastercard surfaces. No payment
was submitted. The merchant rejected delivery to the detected Nepal location
because this is a US-store offer; that is a merchant shipping restriction, not a
payment sandbox.

Shopify's deployed `2026-08-25` MCP schema currently requires `checkout` and its
`line_items`, and accepts the cart reference inside that object, while the current
published binding also describes a top-level `cart_id`. Arro sends the same
merchant-issued cart reference in both locations during this binding transition;
it derives the line items from the cart response rather than trusting stale card
data. A valid incomplete Checkout can arrive as MCP `isError: true` alongside
recoverable buyer or delivery messages, so Arro preserves the structured
Checkout and presents those fields instead of collapsing it into a 502.

Authentication is explicit. Exact origin credentials in
`UCP_MERCHANT_AUTH_JSON` win. A configured Shopify client ID/secret selects its
token tier for all cart, checkout and order operations. Without those credentials
Arro deliberately selects Shopify's production anonymous tier and does not mix
in its generic HTTP signature. Arro's signature remains available for merchants
that negotiate it; Shopify rejecting that conformant signature is not worked
around by weakening it.

Anonymous checkout construction is not native payment authority. The returned
`dev.shopify.card` or Shop Pay declaration describes what the merchant accepts;
Arro still needs the matching registered handler/credential contract and the
provider-authorized completion tier before it can acquire a credential and call
Complete Checkout. Shopify currently grants direct `complete_checkout` access
case by case: general-access clients must use `continue_url` when either the
client completion permission or merchant channel is absent. This is an external
entitlement boundary, not a sandbox mode Arro can remove. Arro keeps the
checkout native through review, preloads Shopify's continuation, and presents it
with Checkout Kit inside the iOS/Android app when that executable intersection
ends. On web, the same production continuation navigates in the current tab so
checkout cannot be blocked by popup policy.

`PAYMENTS_ENABLED=false` disables Arro-owned tokenization/payment-action
adapters when no matching production provider contract is configured. It does
not turn Shopify checkout into a sandbox: merchant continuation remains live and
merchant-owned. Setting the flag to true without the corresponding handler,
tokenizer, and provider credentials cannot create Shopify completion authority.

Primary evidence: [Shopify checkout status and escalation](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp), [Shopify Checkout Kit](https://shopify.dev/docs/storefronts/mobile/checkout-kit), and [Shopify staff clarification of the current completion entitlement](https://community.shopify.dev/t/how-can-a-token-tier-ucp-client-obtain-permission-to-call-complete-checkout/36590/9).

## Responsibility boundaries

```text
Arro native app              Arro backend                    Merchant / PSP
--------------------------   -----------------------------   ---------------------------
renders deterministic UI -> owns durable checkout attempt -> owns prices and availability
invokes provider SDK      -> calls merchant UCP REST       -> is Merchant of Record
returns opaque PI id      -> tokenizes through merchant    -> authorizes/captures payment
runs supported actions    -> reconciles checkout/order     -> owns final status and order
```

- The merchant response is authoritative for line items, totals, fulfillment choices, policies, checkout status, and order.
- The merchant remains the Merchant of Record. Arro must identify the merchant before confirmation and must not imply that Arro sold or fulfilled the goods.
- The app advertises only installed execution surfaces. Device readiness is then checked against the merchant's exact handler configuration before Arro shows or invokes a native pay control; a negative result downscopes the next action request to an explicit fallback.
- The merchant returns the authoritative intersection of its accepted instruments and the platform's available instruments. This follows the [UCP payment architecture](https://ucp.dev/2026-08-25/specification/overview/#payment-architecture).
- Arro handles opaque provider credentials, not raw PAN or CVV. Payment credentials must not be written to logs, analytics, crash reports, local storage, or long-lived application records.

## Primary path: live Stripe PaymentSheet on iOS and Android

This is a card checkout, not a browser checkout. The merchant owns the Stripe account and remains Merchant of Record; Arro owns the native presentation and durable UCP attempt. Visa and Mastercard are the only accepted card brands. Eligible Android devices also receive Google Pay from Stripe PaymentSheet with `testEnv: false`.

### 1. Negotiate one exact handler

1. The merchant checkout advertises a Processor Tokenizer declaration with `gateway: stripe`, `environment: PRODUCTION`, `credential_type: stripe_payment_intent`, an HTTPS `native_session_url`, and an HTTPS `/tokenize` endpoint.
2. The installed app advertises `stripe` plus `host_native` on iOS and Android. The backend selects Stripe only when the exact merchant declaration and installed surface intersect.
3. Arro creates a signed, expiring payment action bound to merchant origin, checkout ID, checkout snapshot hash, handler identity, amount, and currency.

### 2. Create the merchant-owned Stripe session

The app posts the signed token to Arro's `POST /v1/payment-actions/{token}/session`. Arro refreshes the merchant checkout and refuses the request if any reviewed term changed. It then calls the merchant's authenticated `native_session_url` with:

- the exact checkout/action binding;
- final amount and currency;
- `capture_method: manual`;
- `payment_method_types: [card]`;
- Visa/Mastercard acceptance; and
- the `arro://checkout` return URL.

The merchant creates or idempotently returns one live PaymentIntent. Arro accepts only a `pk_live_` publishable key, matching client secret and PaymentIntent ID, manual capture, card-only methods, the exact amount/currency, merchant display identity, and an expiry no later than the signed action. That PaymentIntent ID is durably bound to the action and cannot be reused by another action.

### 3. Present and recover natively

The native app initializes Stripe with the merchant publishable key and optional connected-account ID, then presents PaymentSheet from the explicit pay control. It never receives the merchant secret key and never collects PAN or CVC itself. Cancellation returns to the intact checkout. Stripe redirects are routed back through `arro://checkout` and handed to the Stripe SDK.

After a successful confirmation, the app remembers that state for the life of the prepared action. If result delivery fails, another tap resubmits the same PaymentIntent ID and idempotency key without presenting PaymentSheet again. If the app restarts after Arro has accepted the result but merchant tokenization failed temporarily, the backend recreates only the same merchant-idempotent session, requires the existing PaymentIntent binding, and the app resubmits that reference without presenting or authorizing again. Neither path creates a second authorization.

### 4. Exchange and complete through UCP

1. The app submits only `{ type: stripe_payment_intent, paymentIntentId }` to the signed action result endpoint. Client secrets and PaymentMethod details never return.
2. Arro requires an exact match with the PaymentIntent already bound to that action, refreshes the checkout again, and sends the reference to the merchant's authenticated `/tokenize` endpoint with checkout, merchant, snapshot, and action binding.
3. The merchant verifies that the PaymentIntent belongs to its Stripe account, matches the bound checkout/amount/currency, is live and in the expected manually-capturable state, then returns the UCP token. The UCP tokenizer owns binding, participant authorization, expiry, and single-use enforcement; Arro additionally stores the token only in its consume-once Redis vault and caps its TTL at the earlier action expiry.
4. Arro sends the token only to the merchant's UCP completion operation. A PaymentSheet success or a token is not an order. The UI unlocks a receipt only after the merchant returns a `completed` checkout containing its Order.

This follows UCP's [Processor Tokenizer](https://ucp.dev/2026-08-25/specification/payment/examples/processor-tokenizer/) and [tokenization](https://ucp.dev/2026-08-25/specification/payment/tokenization/) model: the business or PSP runs tokenization and processing, while the platform handles an opaque checkout credential.

## Separate Android `com.google.pay` path

Arro also contains a native Android executor for the published [`com.google.pay` UCP handler](https://developers.google.com/pay/api/universal-commerce-protocol/google-pay-payment-handler). It calls `isReadyToPay()` before showing Google's official control, invokes `loadPaymentData()` only from that control, and forwards only the opaque provider result. The checked-in Render configuration leaves this separate route disabled; enable it only after the production merchant ID, handler ID, gateway, and approval reference match one real merchant declaration. The production build does not accept TEST actions.

Google's official [UCP native-checkout flow](https://developers.google.com/merchant/ucp/guides/overview/native-checkout) uses the same authority boundary: platform-rendered checkout, provider credential acquisition, merchant completion, and a merchant-returned Order.

## Typed actions and 3DS

UCP `2026-08-25` defines provider-neutral payment authentication as typed actions. Arro must model actions by type and handler, not as an unstructured `actionUrl`. See the [versioned Payment Authentication extension](https://ucp.dev/2026-08-25/specification/payment/extensions/authentication/).

The constrained native runner must support both required action types before
Arro advertises this extension:

- `dev.ucp.common.payment.device_data_collection`: load in a fresh, isolated browser-capable context without presenting it as a buyer-facing page.
- `dev.ucp.common.payment.three_ds_challenge`: present a focused, buyer-visible blocking surface, normally an isolated native WebView sheet.

Arro advertises the payment-authentication extension only when the build can execute **both** actions and enforce the handler's origin policy. For every action:

1. Require an absolute HTTPS URL whose origin is allowed by the negotiated payment handler.
2. Use a fresh isolated context; do not expose Arro session cookies, arbitrary native bridges, navigation controls, or unrelated app privileges.
3. Implement the specified `action.ready` handshake and accept only the typed `action.done` or `action.error` protocol messages from the expected origin.
4. Treat those messages as advisory. Never infer authentication or payment success from page content, URL navigation, WebView dismissal, or a provider-looking screen.
5. After completion or interruption, fetch the checkout again with bounded backoff. The merchant/PSP's new checkout state is authoritative.

If the app cannot safely run a returned action, it must preserve the attempt and use a merchant-declared embedded or external continuation. It must not silently skip the action or retry a charge as a new purchase.

## Completion and order authority

The app implements the [versioned UCP checkout lifecycle](https://ucp.dev/2026-08-25/specification/shopping/checkout/#checkout-lifecycle) literally:

- `incomplete`: collect or correct information using the merchant's messages and fields.
- `requires_escalation`: the API flow cannot continue. A valid merchant `continue_url` is required; explain the handoff and open it as the final fallback.
- `ready_for_complete`: the checkout has no outstanding action and may be completed after explicit buyer confirmation.
- `complete_in_progress`: the merchant accepted completion work, but no order exists yet. Run a returned typed action or poll `GET` with bounded backoff.
- `completed`: success only when the merchant response includes the order.
- `canceled`: show the terminal cancellation and offer a deliberate new checkout, not an implicit retry.

The complete request returning, the native wallet sheet closing, a 3DS screen saying “success,” or a local optimistic state is **not** an order. Only a merchant-authoritative `completed` checkout containing an order unlocks the receipt and purchase-success analytics.

On a timeout or lost connection after completion begins, Arro first retrieves the existing checkout and reconciles its order. A durable attempt/idempotency guard prevents a second blind completion. Order updates and recovery follow the [versioned UCP Order specification](https://ucp.dev/2026-08-25/specification/shopping/order/); merchant-signed order events are reconciled against `Get Order`, not trusted as partial local truth.

## Provider limits

Native checkout is conditional on real provider and merchant contracts:

- **Stripe cards:** code support does not create a merchant relationship. A launch merchant must own the live Stripe account, expose the authenticated session and tokenization endpoints, create idempotent manual-capture PaymentIntents, process capture/cancellation/refund through its authoritative order lifecycle, and configure any Stripe Connect account explicitly. Arro intentionally has no platform Stripe secret.
- **Google Pay through PaymentSheet:** Android exposure is controlled by Stripe, Google Pay, the device, country/currency, and the merchant Stripe account. `testEnv` is hard-coded false in the production path.
- **Direct `com.google.pay`:** production requires an approved production setup, the correct Google Pay merchant identity, a real PSP/gateway or direct-tokenization configuration, and a merchant UCP handler that accepts the resulting credential. Google's UCP merchant program is currently described as available to [select merchants in supported markets](https://support.google.com/merchants/answer/16837055). Confirm platform eligibility and token ownership with Google, the PSP, and the launch merchant before enabling it.
- **Shop Pay:** `dev.shopify.shop_pay` is a published UCP handler, but platform registration and a `client_id` are prerequisites. Follow Shopify's [Shop Pay payment-handler documentation](https://shopify.dev/docs/agents/carts-and-checkout/shop-pay-handler); do not expose it until the real merchant response and installed adapter agree.
- **Apple Pay:** as of 2026-09-02, Arro has not identified a normative UCP Apple Pay handler comparable to `com.google.pay` or `dev.shopify.shop_pay`. Do not fabricate `com.apple.pay`, relabel an Apple Pay token as another handler, or promise Apple Pay from a generic UCP capability. Add native Apple Pay only after a provider publishes or contracts a compatible handler/tokenization mapping, the merchant/PSP advertises it, and Arro completes the applicable Apple capability, merchant-identifier, PSP, and provider onboarding.

Provider support is an adapter with an explicit handler ID, availability check, acquisition result, cancellation result, and safe error mapping. It is never a generic “wallet token” branch.

## AP2 is optional for human checkout

Arro's human-present native checkout always requires explicit review and confirmation. It does not require AP2. The [versioned UCP AP2 Mandates extension](https://ucp.dev/2026-08-25/specification/payment/extensions/ap2-mandates/) is relevant only when Arro later executes payment autonomously under a buyer-authorized mandate. If negotiated, its deterministic trusted-surface and mandate rules become part of that separate flow; AP2 must not delay or weaken the ordinary native purchase path.

## Mobile UX and accessibility contract

- Keep cart, address, delivery, payment selection, action recovery, and receipt in one resumable native task.
- Use provider-supplied native payment controls and required branding. Do not imitate a wallet button or collect card secrets in Arro UI.
- Give every control a concise screen-reader name, role, state, and error relationship. The pay control announces the merchant and final amount.
- Support dynamic type without clipping, platform text scaling, logical focus order, reduced motion, sufficient contrast, and minimum platform touch targets (44 pt on iOS; 48 dp on Android).
- Move focus to the first invalid field or blocking message after an update. Announce loading, changed totals, action presentation, processing, cancellation, and final order state without relying on color alone.
- Disable duplicate submission while preserving a visible, cancellable-or-recoverable progress state. Back, app suspension, provider cancellation, and network loss must retain the checkout.
- Before an embedded or browser handoff, name the merchant, explain why the handoff is needed, and state that the buyer will return to Arro. Restore focus and reconcile state on return.
- Never trap the buyer in a WebView. Provide an accessible close/back affordance unless the security protocol explicitly controls dismissal, and recover the checkout when the surface closes.

## Launch completion checklist

The implemented paths still need real merchant/device proof. Optional payment
extensions without an executable host remain unadvertised; repository checks do
not replace that missing execution. For the direct Stripe path:

1. Connect one launch merchant's live Stripe account. Implement its idempotent `native_session_url` and `/tokenize` endpoints, including PaymentIntent verification, capture/cancel/refund ownership, and webhook reconciliation.
2. Configure the chosen backend host with the exact production handler and private endpoint authentication. Do not put private payment credentials in an `EXPO_PUBLIC_*` value.
3. Use the chosen public HTTPS app/API origins and build new iOS/Android binaries with Stripe, Google Pay, Checkout Kit and WebView linked. Render/Vercel are the current testing choices, not architectural or launch requirements. Native payment SDKs do not run in Expo Go.
4. On physical iOS and Android devices, complete a controlled low-value live Visa/Mastercard purchase from review through merchant Order. On eligible Android, verify Stripe Google Pay. Exercise buyer cancellation and one temporary network failure after PaymentSheet confirmation; both must preserve the same checkout and avoid a second authorization.
5. Confirm the merchant captures only after its authoritative completion rule, and verify cancellation/refund and webhook reconciliation in the live account.
6. Test screen readers, large text, reduced motion, poor network, app backgrounding, process restart, and provider return links. Verify that logs, traces, analytics, Postgres, and device storage contain no Stripe client secret or UCP token.
7. Keep the payment-authentication extension, direct `com.google.pay`, delegated Shop Pay completion, and Apple Pay unadvertised until each has its own executable provider contract and device proof. Shopify Checkout Kit remains available independently for production merchant continuation.

### Verification on 2026-09-05

- Contracts: 70 tests passed; app: 38 passed; API: 432 passed. API build and app/API typechecks passed.
- Expo production export produced web/SSR, iOS Hermes and Android Hermes bundles. This verifies bundling, not native compilation or execution on a device.
- Built-in browser: live Global Catalog search, product detail, preparation of a $25.59 Roborock checkout, and navigation to the matching merchant checkout succeeded. The merchant displayed wallet/card options and its US-only delivery restriction. No personal details or payment were submitted.
- Restored the existing public API tunnel after it returned HTTP 530; discovery returned HTTP 200 afterward. This local tunnel is not a durable production hosting deployment.
- No generic ECP merchant session or physical-device native payment was completed. Those remain explicit verification gaps.

### Checkout form and prefetch corrections — 2026-09-05

- Shopify Checkout Kit is already installed for the native app. It presents the merchant's checkout; it is not required for UCP calls and does not supply Shopify card fields for Arro's website. See [Shopify Checkout Kit](https://shopify.dev/docs/storefronts/mobile/checkout-kit) and [Checkout MCP](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp).
- The SimplyGoodCoffee checkout returned `requires_escalation`, `extension_interaction_required`, an empty fulfillment-method list, and no embedded transport binding. Merchant-hosted payment remains required for this session; adding form controls does not override that requirement.
- Fixed the missing shopper-session permission for `PATCH /v1/purchases/:id/review`. This had rejected both contact and delivery updates with 403 before they reached the merchant. Ownership and scope checks remain active.
- Added the initial UCP shipping-preference request for checkouts that negotiate shipping but have not issued a method ID. Line bindings come from the current merchant checkout; the app supplies only address facts. The same mapper works independently of Shopify.
- Checkout snapshots now exclude rotating `continue_url` and `expires_at` fields. Field-fingerprint comparisons showed both changing on ordinary Shopify reads while every other field stayed identical. Stored responses retain both fields; merchant identity, status, items, totals, buyer, fulfillment, payment and policies still affect snapshot validation.
- Merchant-rejected updates surface an error instead of a saved-success message. Recoverable field errors preserve the open editor and its draft. Related warnings share one edit action, and required review details no longer appear as a completed review step.
- Desktop category and subcategory menus now use the same real-anchor prefetch behavior as product links. Pointer intent waits 90 ms; keyboard focus and touch start warm immediately. Browser verification observed Garden's loader on keyboard focus and Kids' loader on pointer entry while the URL remained `/`; clicking Kids then reused the loaded data. Temporary tracing was removed.
- Built-in browser verification on a fresh $399.99 SimplyGoodCoffee checkout: a country-only `US` update reached the live merchant and returned the specific remaining address requirements. Repeating the update retained `US` in the open editor, without a 403 or false stale-review error. No personal contact/address details, payment credentials or order submission were supplied. This proves the update path, not full shipping eligibility or completed payment.
- Follow-up checks: API 451 tests, app 52 tests, contracts 72 tests passed; API build and app typecheck passed. Production web/SSR export succeeded. Native-device payment and full-address live checkout remain unverified.

### Contact save and duplicate UI follow-up — 2026-09-05

- Reproduced an upstream Shopify HTTP 429 while reading the live SimplyGoodCoffee checkout. The API previously wrapped this as `ucp_protocol_error`/502, and the app incorrectly described that broad error as an unsupported merchant. It now retains a distinct `ucp_merchant_rate_limited`/429 response and the merchant's retry delay. The app stops status polling on throttling, prevents overlapping reads, and waits before another update. It does not retry a payment automatically.
- The running local API had neither `SHOPIFY_AGENT_CLIENT_ID` nor `SHOPIFY_AGENT_CLIENT_SECRET` configured; only their presence was inspected, not secret values. It therefore selected the anonymous tier. Higher-limit authenticated access uses the existing server-side configuration; no credentials were invented or changed. See [Shopify authentication and rate limits](https://shopify.dev/docs/agents/profiles/auth-and-rate-limiting).
- Removed source-cart reads/writes after checkout conversion. Status reads now call Get Checkout once; review saves retain the authoritative Get Checkout plus Update Checkout, without also reading and rewriting the source cart. The full checkout replacement and snapshot checks remain intact.
- Contact collects email or phone, not a second mandatory set of recipient names. Names appear there only if the merchant explicitly requires buyer names. Delivery owns recipient fields and prefills existing buyer details. A shared lightweight phone formatter strips display punctuation without inventing country codes; invalid numbers stay correctable form errors. MCP invalid-parameter envelopes are distinguished from invalid checkout responses.
- Field warnings have one editor owner; submitting errors are not repeated behind the dialog. Forms do not open with missing-field warning banners before a save attempt. Removed redundant requirement badges, delivery instructions, continuation warnings and API-added success text. Policy disclosures and uneditable blockers remain visible.
- Browser inspection verified the cleaned contact form, delivery entry point and the correct throttle message. A phone-only retry still failed before the merchant update stage. A subsequent email submission was blocked by the tool approval check and was not performed; further personal-data submission requires user approval. No successful contact save, payment or order is claimed by this pass.
- Verification after implementation: API 458 tests, app 59 tests, contracts 81 tests and UCP client 57 tests passed (655 total). App typecheck, the API image build and production web/SSR export passed. Temporary request diagnostics were removed. Live merchant throttling, a successful contact save and native-device payment remain verification gaps.

## Release acceptance

A native-checkout release is acceptable only when all of the following are true:

- A supported iOS or Android buyer can pay by Visa or Mastercard and move from cart to merchant-confirmed order without opening a general browser.
- An eligible Android buyer can use Google Pay inside Stripe PaymentSheet without a general browser.
- The app never presents or invokes a native handler unless its installed adapter, baked environment, merchant configuration, and device readiness all agree; after a negative readiness result, its next request excludes the native surface.
- Typed 3DS/device-data actions use the constrained action runner; arbitrary merchant UI uses only a declared embedded or external fallback.
- Cancellation and interruption resume the same checkout without a duplicate charge or lost cart.
- Receipt and purchase-success telemetry occur only after a merchant `completed` response containing an order.
- A production credential cannot be found in device storage, server logs, analytics, traces, or error reports.
- An unsupported provider or action fails honestly with a clear next route; it never becomes a fabricated native handler or fake success.
