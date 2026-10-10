export interface Delivery {
  delivery_id: string;
  lease_id: string;
  channel: "web_push" | "email";
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  recipient_email: string | null;
  notification_id: string;
  importance: "low" | "normal" | "high";
  category:
    "content" | "timeline" | "group" | "account" | "school" | "moderation";
  grouping_key: string | null;
  title: string;
  body: string;
  tag: string;
}

export interface DeliveryResult {
  delivery_id: string;
  lease_id: string;
  outcome: "sent" | "retry" | "dead" | "gone" | "suppressed";
  status_code: number | null;
  error_code: string | null;
}

interface TransportResponse {
  status: number;
}

export interface DispatchDependencies {
  expectedSecret: string;
  claim: () => Promise<Delivery[]>;
  prepare: (delivery: Delivery) => Promise<boolean>;
  complete: (result: DeliveryResult) => Promise<boolean>;
  sendPush: (delivery: Delivery, payload: string) => Promise<TransportResponse>;
  sendEmail: (delivery: Delivery) => Promise<TransportResponse>;
}

/** Android 절전 상태에서 normal은 기기가 깰 때까지 미뤄질 수 있다. */
export function pushUrgency(
  importance: Delivery["importance"],
): "high" | "normal" {
  return importance === "high" ? "high" : "normal";
}

/**
 * 401/403은 이 구독이 지금 VAPID 키로 만들어지지 않았다는 응답이다(키 교체 등). 다시 보내도
 * 영영 실패하므로 404/410처럼 `gone`으로 보내 클라이언트가 새로 구독하게 한다. 이메일의
 * 401/403은 우리 쪽 키 문제라 구독과 무관하다.
 */
function classify(
  status: number,
  channel: Delivery["channel"],
): DeliveryResult["outcome"] {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (channel === "web_push" && (status === 401 || status === 403)) {
    return "gone";
  }
  if (status === 429 || status >= 500) return "retry";
  return "dead";
}

// 한 배치를 순서대로 보내면 느린 Push service 몇 곳만으로 lease(120초)를 넘겨, 다음 실행이
// 같은 항목을 다시 가져가 중복 발송한다. 외부 서비스에 몰리지 않을 만큼만 겹친다.
const SEND_CONCURRENCY = 10;

type Tally = "sent" | "suppressed" | "retry" | "gone" | "dead";

async function processDelivery(
  deps: DispatchDependencies,
  delivery: Delivery,
): Promise<Tally> {
  try {
    if (!(await deps.prepare(delivery))) return "suppressed";
  } catch {
    return "retry";
  }

  let result: DeliveryResult;
  try {
    const response =
      delivery.channel === "web_push"
        ? await deps.sendPush(
            delivery,
            JSON.stringify({
              notificationId: delivery.notification_id,
              deliveryId: delivery.delivery_id,
              importance: delivery.importance,
              category: delivery.category,
              groupingKey: delivery.grouping_key,
              title: delivery.title,
              body: delivery.body,
              tag: delivery.tag,
            }),
          )
        : await deps.sendEmail(delivery);
    result = {
      delivery_id: delivery.delivery_id,
      lease_id: delivery.lease_id,
      outcome: classify(response.status, delivery.channel),
      status_code: response.status,
      error_code: null,
    };
  } catch {
    result = {
      delivery_id: delivery.delivery_id,
      lease_id: delivery.lease_id,
      outcome: "retry",
      status_code: null,
      error_code: "transport_error",
    };
  }

  try {
    if (!(await deps.complete(result))) return "retry";
  } catch {
    return "retry";
  }
  return result.outcome;
}

export function createDispatchHandler(deps: DispatchDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    if (
      !deps.expectedSecret ||
      request.headers.get("x-dispatch-secret") !== deps.expectedSecret
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    let deliveries: Delivery[];
    try {
      deliveries = await deps.claim();
    } catch {
      return Response.json({ error: "claim_failed" }, { status: 500 });
    }

    const totals = {
      claimed: deliveries.length,
      sent: 0,
      suppressed: 0,
      retry: 0,
      gone: 0,
      dead: 0,
    };
    let next = 0;
    const worker = async () => {
      while (next < deliveries.length) {
        const delivery = deliveries[next++];
        totals[await processDelivery(deps, delivery)] += 1;
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(SEND_CONCURRENCY, deliveries.length) },
        worker,
      ),
    );

    console.log("notification dispatch completed", totals);
    return Response.json(totals);
  };
}
