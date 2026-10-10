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

// 401/403은 `gone`이 아니다. 서버 VAPID 설정이 잘못돼도 같은 응답이 오므로, 그걸 구독 탓으로
// 돌리면 설정 실수 한 번에 모든 구독이 죽은 것으로 표시된다. 키 교체로 어긋난 구독은 클라이언트가
// 구독의 applicationServerKey를 현재 키와 비교해 직접 교체한다.
function classify(status: number): DeliveryResult["outcome"] {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500) return "retry";
  return "dead";
}

// 한 배치를 순서대로 보내면 느린 Push service 몇 곳만으로 lease(120초)를 넘겨, 다음 실행이
// 같은 항목을 다시 가져가 중복 발송한다. 외부 서비스에 몰리지 않을 만큼만 겹친다.
const SEND_CONCURRENCY = 10;

/**
 * 같은 구독으로 가는 항목은 한 줄로 보낸다. 기기는 도착 순서대로 카테고리 카드를 갱신하므로,
 * 겹쳐 보내면 더 오래된 알림이 카드 제목으로 남을 수 있다. Push의 grouping_key는 구독 ID다.
 */
function groupBySubscription(deliveries: Delivery[]): Delivery[][] {
  const groups = new Map<string, Delivery[]>();
  for (const delivery of deliveries) {
    const key =
      delivery.channel === "web_push"
        ? `push:${delivery.grouping_key}`
        : `email:${delivery.delivery_id}`;
    const group = groups.get(key);
    if (group) group.push(delivery);
    else groups.set(key, [delivery]);
  }
  return [...groups.values()];
}

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
      outcome: classify(response.status),
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
    const groups = groupBySubscription(deliveries);
    let next = 0;
    const worker = async () => {
      while (next < groups.length) {
        for (const delivery of groups[next++]) {
          totals[await processDelivery(deps, delivery)] += 1;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SEND_CONCURRENCY, groups.length) }, worker),
    );

    console.log("notification dispatch completed", totals);
    return Response.json(totals);
  };
}
