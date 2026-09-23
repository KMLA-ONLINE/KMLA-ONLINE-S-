/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Edge-only JSR/npm modules are checked by Deno. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.111.0";
import nodemailer from "npm:nodemailer@7.0.6";
import webpush from "npm:web-push@3.6.7";
import {
  createDispatchHandler,
  type Delivery,
  type DeliveryResult,
} from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const dispatchSecret = Deno.env.get("NOTIFICATION_DISPATCH_SECRET") ?? "";
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const resendKey = Deno.env.get("RESEND_API_KEY");
const emailFrom =
  Deno.env.get("NOTIFICATION_EMAIL_FROM") ??
  "KMLA Online <notifications@kmla.online>";

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

if (vapidSubject && vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

async function claim(): Promise<Delivery[]> {
  if (!url || !serviceRoleKey) throw new Error("missing_server_configuration");
  const { data, error } = await supabase.rpc("claim_notification_deliveries", {
    p_limit: 100,
    p_lease_seconds: 120,
  });
  if (error) throw error;
  return (data ?? []) as Delivery[];
}

async function complete(result: DeliveryResult): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_notification_delivery", {
    p_delivery_id: result.delivery_id,
    p_lease_id: result.lease_id,
    p_outcome: result.outcome,
    p_status_code: result.status_code,
    p_error_code: result.error_code,
  });
  if (error) throw error;
  return Boolean(data);
}

async function prepare(delivery: Delivery): Promise<boolean> {
  const { data, error } = await supabase.rpc("prepare_notification_delivery", {
    p_delivery_id: delivery.delivery_id,
    p_lease_id: delivery.lease_id,
  });
  if (error) throw error;
  return Boolean(data);
}

async function sendPush(delivery: Delivery, payload: string) {
  if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    throw new Error("missing_vapid_configuration");
  }
  if (!delivery.endpoint || !delivery.p256dh || !delivery.auth) {
    return { status: 422 };
  }
  try {
    const response = await webpush.sendNotification(
      {
        endpoint: delivery.endpoint,
        keys: { p256dh: delivery.p256dh, auth: delivery.auth },
      },
      payload,
      { TTL: 86400, urgency: "normal" },
    );
    return { status: response.statusCode };
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode);
    if (Number.isInteger(status)) return { status };
    throw error;
  }
}

async function sendEmail(delivery: Delivery) {
  if (!delivery.recipient_email) return { status: 422 };
  const subject = delivery.title;
  const text = `${delivery.body}\n\nKMLA Online에서 확인해 주세요.`;
  if (resendKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [delivery.recipient_email],
        subject,
        text,
      }),
    });
    return { status: response.status };
  }

  const transporter = nodemailer.createTransport({
    host: Deno.env.get("LOCAL_SMTP_HOST") ?? "host.docker.internal",
    port: Number(Deno.env.get("LOCAL_SMTP_PORT") ?? "54625"),
    secure: false,
  });
  await transporter.sendMail({
    from: emailFrom,
    to: delivery.recipient_email,
    subject,
    text,
  });
  return { status: 200 };
}

Deno.serve(
  createDispatchHandler({
    expectedSecret: dispatchSecret,
    claim,
    prepare,
    complete,
    sendPush,
    sendEmail,
  }),
);
