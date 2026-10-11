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
    importance: "normal",
    category: "content",
    grouping_key: "44444444-4444-4444-8444-444444444444",
    title: "새 알림",
    body: "새 알림이 있습니다.",
    tag: "notification-category:content:44444444-4444-4444-8444-444444444444",
    ...overrides,
  };
}

function dependencies(items: Delivery[]) {
  const completions: DeliveryResult[] = [];
  const payloads: Record<string, unknown>[] = [];
  const deps: DispatchDependencies = {
    expectedSecret: "dispatch-secret",
    claim: () => Promise.resolve(items),
    prepare: () => Promise.resolve(true),
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
      importance: "normal",
      category: "content",
      groupingKey: "44444444-4444-4444-8444-444444444444",
      title: "새 알림",
      body: "새 알림이 있습니다.",
      tag: "notification-category:content:44444444-4444-4444-8444-444444444444",
    });
    assertFalse("endpoint" in payloads[0]);
  },
);

Deno.test(
  "dispatcher suppresses a delivery that fails the final authorization check",
  async () => {
    const { deps, completions, payloads } = dependencies([delivery()]);
    deps.prepare = () => Promise.resolve(false);
    let pushCalls = 0;
    deps.sendPush = () => {
      pushCalls += 1;
      return Promise.resolve({ status: 201 });
    };

    const response = await createDispatchHandler(deps)(
      new Request("http://localhost", {
        method: "POST",
        headers: { "x-dispatch-secret": "dispatch-secret" },
      }),
    );

    assertEquals(await response.json(), {
      claimed: 1,
      sent: 0,
      suppressed: 1,
      retry: 0,
      gone: 0,
      dead: 0,
    });
    assertEquals(pushCalls, 0);
    assertEquals(completions, []);
    assertEquals(payloads, []);
  },
);

Deno.test(
  "dispatcher reports gone subscriptions and retries transient push failures",
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
    const response = await createDispatchHandler(deps)(
      new Request("http://localhost", {
        method: "POST",
        headers: { "x-dispatch-secret": "dispatch-secret" },
      }),
    );
    assertEquals(
      completions.map((item) => item.outcome),
      ["gone", "retry"],
    );
    assertEquals(await response.json(), {
      claimed: 2,
      sent: 0,
      suppressed: 0,
      retry: 1,
      gone: 1,
      dead: 0,
    });
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

Deno.test(
  "dispatcher reports a retry when the database rejects lease completion",
  async () => {
    const { deps } = dependencies([delivery()]);
    deps.complete = () => Promise.resolve(false);

    const response = await createDispatchHandler(deps)(
      new Request("http://localhost", {
        method: "POST",
        headers: { "x-dispatch-secret": "dispatch-secret" },
      }),
    );

    assertEquals(await response.json(), {
      claimed: 1,
      sent: 0,
      suppressed: 0,
      retry: 1,
      gone: 0,
      dead: 0,
    });
  },
);

function post() {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "x-dispatch-secret": "dispatch-secret" },
  });
}

Deno.test(
  "a push rejected for its VAPID key is dead, not gone, since config errors look the same",
  async () => {
    const { deps, completions } = dependencies([delivery()]);
    deps.sendPush = () => Promise.resolve({ status: 403 });
    await createDispatchHandler(deps)(post());
    assertEquals(completions[0]?.outcome, "dead");
  },
);

function key(index: number) {
  return `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
}

Deno.test(
  "a batch is sent with bounded overlap and every item is counted",
  async () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      delivery({ delivery_id: key(index), grouping_key: key(index) }),
    );
    const { deps } = dependencies(items);
    let inFlight = 0;
    let peak = 0;
    deps.sendPush = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { status: 201 };
    };
    const response = await createDispatchHandler(deps)(post());
    assertEquals((await response.json()).sent, 25);
    assertEquals(peak, 10);
  },
);

Deno.test(
  "pushes to one subscription go out one at a time in claim order",
  async () => {
    const items = Array.from({ length: 3 }, (_, index) =>
      delivery({ delivery_id: key(index) }),
    );
    const { deps } = dependencies(items);
    const order: string[] = [];
    let inFlight = 0;
    let peak = 0;
    deps.sendPush = async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      order.push(item.delivery_id);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { status: 201 };
    };
    await createDispatchHandler(deps)(post());
    assertEquals(peak, 1);
    assertEquals(order, [key(0), key(1), key(2)]);
  },
);
