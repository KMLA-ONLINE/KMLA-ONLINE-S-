import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  createDispatchHandler,
  type Delivery,
  type DeliveryResult,
  type DispatchDependencies,
} from "./handler.ts";

function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    delivery_id: "11111111-1111-4111-8111-111111111111",
    lease_id: "22222222-2222-4222-8222-222222222222",
    channel: "web_push",
    endpoint: "https://push.example.test/one",
    p256dh: "p256dh",
    auth: "auth",
    recipient_email: null,
    notification_id: "33333333-3333-4333-8333-333333333333",
    title: "새 알림",
    body: "새 알림이 있습니다.",
    tag: "notification:33333333-3333-4333-8333-333333333333",
    ...overrides,
  };
}

function dependencies(items: Delivery[]) {
  const completions: DeliveryResult[] = [];
  const payloads: Record<string, unknown>[] = [];
  const deps: DispatchDependencies = {
    expectedSecret: "dispatch-secret",
    claim: () => Promise.resolve(items),
    complete: (result) => {
      completions.push(result);
      return Promise.resolve(true);
    },
    sendPush: (_item, payload) => {
      payloads.push(JSON.parse(payload));
      return Promise.resolve({ status: 201 });
    },
    sendEmail: () => Promise.resolve({ status: 200 }),
  };
  return { deps, completions, payloads };
}

Deno.test("dispatcher rejects requests without its shared secret", async () => {
  const { deps } = dependencies([]);
  const response = await createDispatchHandler(deps)(
    new Request("http://localhost", { method: "POST" }),
  );
  assertEquals(response.status, 401);
});

Deno.test(
  "dispatcher sends an allowlisted push payload and completes the lease",
  async () => {
    const { deps, completions, payloads } = dependencies([delivery()]);
    const response = await createDispatchHandler(deps)(
      new Request("http://localhost", {
        method: "POST",
        headers: { "x-dispatch-secret": "dispatch-secret" },
      }),
    );
    assertEquals(response.status, 200);
    assertEquals(completions[0]?.outcome, "sent");
    assertEquals(payloads[0], {
      notificationId: "33333333-3333-4333-8333-333333333333",
      deliveryId: "11111111-1111-4111-8111-111111111111",
      title: "새 알림",
      body: "새 알림이 있습니다.",
      tag: "notification:33333333-3333-4333-8333-333333333333",
    });
    assertFalse("endpoint" in payloads[0]);
  },
);

Deno.test(
  "dispatcher removes gone subscriptions and retries transient push failures",
  async () => {
    const { deps, completions } = dependencies([
      delivery(),
      delivery({
        delivery_id: "44444444-4444-4444-8444-444444444444",
        lease_id: "55555555-5555-4555-8555-555555555555",
      }),
    ]);
    let call = 0;
    deps.sendPush = () => Promise.resolve({ status: call++ === 0 ? 410 : 503 });
    await createDispatchHandler(deps)(
      new Request("http://localhost", {
        method: "POST",
        headers: { "x-dispatch-secret": "dispatch-secret" },
      }),
    );
    assertEquals(
      completions.map((item) => item.outcome),
      ["gone", "retry"],
    );
  },
);

Deno.test(
  "dispatcher routes email jobs through the configured email adapter",
  async () => {
    const item = delivery({
      channel: "email",
      endpoint: null,
      p256dh: null,
      auth: null,
      recipient_email: "member@example.test",
    });
    const { deps, completions } = dependencies([item]);
    let emailCalls = 0;
    deps.sendEmail = () => {
      emailCalls += 1;
      return Promise.resolve({ status: 202 });
    };
    await createDispatchHandler(deps)(
      new Request("http://localhost", {
        method: "POST",
        headers: { "x-dispatch-secret": "dispatch-secret" },
      }),
    );
    assertEquals(emailCalls, 1);
    assertEquals(completions[0]?.outcome, "sent");
  },
);
