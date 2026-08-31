import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = "noreply@europatheducation.eu";
const ADMIN_EMAIL = "hasanov.anar.2023@gmail.com";
const SITE_URL = "https://europatheducation.eu";

// ─── Normalize phone number (strip everything except digits) ───
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// ─── Generate a random confirmation token ───
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Generate a unique Jitsi Meet room name ───
function generateJitsiLink(name: string, consultation_utc: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .substring(0, 12);
  const ts = new Date(consultation_utc).getTime().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  const roomName = `europath-${slug}-${ts}${rand}`;
  return `https://meet.jit.si/${roomName}`;
}

// ─── Send email via Resend ───
async function sendEmail(to: string, subject: string, html: string, replyTo?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  const data = await res.json();
  if (!data.id) throw new Error("Failed to send email: " + JSON.stringify(data));
  return data;
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      },
    });
  }

  try {
    const body = await req.json();
    const {
      name,
      email,
      phone,
      consultation_date,
      consultation_time_local,
      consultation_time_local_tz,
      consultation_time_italy,
      consultation_utc,
    } = body;

    if (!name || !email || !phone || !consultation_date || !consultation_time_local || !consultation_utc) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ─── Anti-abuse checks ───

    // 1. Check that consultation is at least 7 days from now
    const consultationDate = new Date(consultation_utc);
    const now = new Date();
    const minDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (consultationDate < minDate) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Консультация должна быть забронирована минимум за 7 дней.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // 2. Check that this phone number hasn't been used more than 2 times
    const phoneNormalized = normalizePhone(phone);
    const { count: phoneCount, error: countError } = await supabase
      .from("consultation_bookings")
      .select("*", { count: "exact", head: true })
      .eq("phone_normalized", phoneNormalized)
      .in("status", ["confirmed", "pending"]);

    if (countError) {
      console.error("Count error:", countError.message);
    }

    if (phoneCount && phoneCount >= 2) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "С этого номера уже забронировано максимум консультаций (2). Пожалуйста, используйте другой номер.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // ─── Create pending booking ───
    const confirmationToken = generateToken();
    const meetLink = generateJitsiLink(name, consultation_utc);

    const { data: booking, error: insertError } = await supabase
      .from("consultation_bookings")
      .insert({
        full_name: name,
        student_email: email,
        consultation_date,
        consultation_time_local,
        consultation_time_local_tz,
        consultation_time_italy,
        consultation_utc,
        meet_link: meetLink,
        status: "pending",
        confirmation_token: confirmationToken,
        phone_normalized: phoneNormalized,
        reminder_sent: false,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Insert error:", insertError.message);
      return new Response(
        JSON.stringify({ success: false, message: "Failed to create booking" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // ─── Send confirmation email to student (in Russian) ───
    const confirmationUrl = `${SITE_URL}/confirm-consultation.html?token=${confirmationToken}&action=confirm`;
    const rejectionUrl = `${SITE_URL}/confirm-consultation.html?token=${confirmationToken}&action=reject`;

    const studentHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a73e8;">📅 Подтвердите вашу консультацию</h2>
        <p>Здравствуйте, ${name}!</p>
        <p>Мы получили ваш запрос на бесплатную консультацию с EuroPath Education. Пожалуйста, подтвердите или отмените запись, нажав на одну из кнопок ниже:</p>
        
        <div style="text-align: center; margin: 24px 0;">
          <a href="${confirmationUrl}" style="display: inline-block; padding: 8px 18px; background: white; color: #333; text-decoration: none; border: 2px solid #4caf50; border-radius: 6px; font-size: 13px; font-weight: bold; margin-right: 10px;">✅ Подтвердить</a>
          <a href="${rejectionUrl}" style="display: inline-block; padding: 8px 18px; background: white; color: #333; text-decoration: none; border: 2px solid #f44336; border-radius: 6px; font-size: 13px; font-weight: bold;">✕ Отменить</a>
        </div>
        
        <table style="border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 4px 12px; font-weight: bold;">Дата:</td><td style="padding: 4px 12px;">${consultation_date}</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Ваше локальное время:</td><td style="padding: 4px 12px;">${consultation_time_local} (${consultation_time_local_tz})</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Итальянское время:</td><td style="padding: 4px 12px;">${consultation_time_italy} (Europe/Rome)</td></tr>
        </table>
        
        <p style="padding: 12px; background: #fff3e0; border-radius: 8px; font-size: 13px;">
          ⚠️ Консультация не подтверждена, пока вы не нажмёте на кнопку «Подтвердить». Ссылка действительна 24 часа.
        </p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #888; font-size: 12px;">
          EuroPath Education<br>
          WhatsApp: +39 328 081 0631<br>
          Instagram: @study.with.anar
        </p>
      </div>
    `;
    await sendEmail(
      email,
      `📅 Подтвердите вашу консультацию — ${consultation_date}`,
      studentHtml,
      ADMIN_EMAIL
    );

    // ─── Send notification to admin (in Russian) ───
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a73e8;">📅 Новая запись на консультацию (ожидает подтверждения)</h2>
        <table style="border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 4px 12px; font-weight: bold;">Имя:</td><td style="padding: 4px 12px;">${name}</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Email:</td><td style="padding: 4px 12px;">${email}</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Телефон:</td><td style="padding: 4px 12px;">${phone}</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Дата:</td><td style="padding: 4px 12px;">${consultation_date}</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Локальное время студента:</td><td style="padding: 4px 12px;">${consultation_time_local} (${consultation_time_local_tz})</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Итальянское время:</td><td style="padding: 4px 12px;">${consultation_time_italy}</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Статус:</td><td style="padding: 4px 12px; color: #f57c00;">Ожидает подтверждения от студента</td></tr>
        </table>
      </div>
    `;
    await sendEmail(
      ADMIN_EMAIL,
      `📅 Новая консультация (ожидает подтверждения): ${name} — ${consultation_date}`,
      adminHtml,
      email
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: "Booking created. Confirmation email sent.",
        status: "pending",
        booking_id: booking.id,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  } catch (err) {
    console.error("Error:", err.message);
    return new Response(
      JSON.stringify({ success: false, message: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  }
});
