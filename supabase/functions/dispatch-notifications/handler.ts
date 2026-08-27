export interface Delivery {
  delivery_id: string;
  lease_id: string;
  channel: "web_push" | "email";
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  recipient_email: string | null;
  notification_id: string;
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

function classify(status: number): DeliveryResult["outcome"] {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500) return "retry";
  return "dead";
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
      dead: 0,
    };
    for (const delivery of deliveries) {
      try {
        if (!(await deps.prepare(delivery))) {
          totals.suppressed += 1;
          continue;
        }
      } catch {
        totals.retry += 1;
        continue;
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
        await deps.complete(result);
      } catch {
        result.outcome = "retry";
      }
      if (result.outcome === "sent") totals.sent += 1;
      else if (result.outcome === "retry") totals.retry += 1;
      else totals.dead += 1;
    }

    console.log("notification dispatch completed", totals);
    return Response.json(totals);
  };
}
