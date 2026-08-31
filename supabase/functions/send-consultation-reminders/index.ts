import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = "noreply@europatheducation.eu";
const ADMIN_EMAIL = "hasanov.anar.2023@gmail.com";

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
// Called by pg_cron every 5 minutes via pg_net HTTP POST
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find bookings that:
    // - are confirmed
    // - haven't had a reminder sent yet
    // - consultation is within the next 5-35 minutes (gives a window for the cron to catch it)
    const now = new Date();
    const windowStart = new Date(now.getTime() + 5 * 60 * 1000);   // 5 min from now
    const windowEnd = new Date(now.getTime() + 35 * 60 * 1000);    // 35 min from now

    const { data: upcoming, error: queryError } = await supabase
      .from("consultation_bookings")
      .select("id, full_name, student_email, consultation_date, consultation_time_local, consultation_time_local_tz, consultation_time_italy, consultation_utc, meet_link")
      .eq("status", "confirmed")
      .eq("reminder_sent", false)
      .gte("consultation_utc", windowStart.toISOString())
      .lte("consultation_utc", windowEnd.toISOString());

    if (queryError) {
      console.error("Query error:", queryError.message);
      return new Response(JSON.stringify({ success: false, error: queryError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!upcoming || upcoming.length === 0) {
      return new Response(JSON.stringify({ success: true, reminders_sent: 0, message: "No upcoming consultations needing reminders" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${upcoming.length} consultation(s) needing reminders`);

    let sentCount = 0;
    for (const booking of upcoming) {
      try {
        // Send reminder to student (in Russian)
        const studentHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a73e8;">⏰ Напоминание о консультации</h2>
            <p>Здравствуйте, ${booking.full_name}!</p>
            <p>Ваша консультация с EuroPath Education начнётся через 30 минут.</p>
            <table style="border-collapse: collapse; margin: 16px 0;">
              <tr><td style="padding: 4px 12px; font-weight: bold;">Дата:</td><td style="padding: 4px 12px;">${booking.consultation_date}</td></tr>
              <tr><td style="padding: 4px 12px; font-weight: bold;">Ваше локальное время:</td><td style="padding: 4px 12px;">${booking.consultation_time_local} (${booking.consultation_time_local_tz})</td></tr>
              <tr><td style="padding: 4px 12px; font-weight: bold;">Итальянское время:</td><td style="padding: 4px 12px;">${booking.consultation_time_italy} (Europe/Rome)</td></tr>
            </table>
            <div style="margin-top: 16px; padding: 16px; background: #e8f5e9; border-radius: 8px; border: 1px solid #4caf50;">
              <p style="margin: 0 0 8px; font-weight: bold; font-size: 15px;">🎥 Ссылка на видеозвонок (Jitsi Meet):</p>
              <p style="margin: 0;"><a href="${booking.meet_link}" style="color: #1a73e8; font-size: 15px; word-break: break-all;">${booking.meet_link}</a></p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #666;">Просто нажмите на ссылку. Работает в браузере — установка не нужна.</p>
            </div>
            <p style="margin-top: 16px;">До встречи!</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px;">
              EuroPath Education<br>
              WhatsApp: +39 328 081 0631<br>
              Instagram: @study.with.anar
            </p>
          </div>
        `;
        await sendEmail(
          booking.student_email,
          `⏰ Консультация через 30 минут — ${booking.consultation_date} в ${booking.consultation_time_local}`,
          studentHtml,
          ADMIN_EMAIL
        );

        // Send reminder to admin (in Russian)
        const adminHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a73e8;">⏰ Напоминание: консультация через 30 минут</h2>
            <table style="border-collapse: collapse; margin: 16px 0;">
              <tr><td style="padding: 4px 12px; font-weight: bold;">Имя:</td><td style="padding: 4px 12px;">${booking.full_name}</td></tr>
              <tr><td style="padding: 4px 12px; font-weight: bold;">Email:</td><td style="padding: 4px 12px;">${booking.student_email}</td></tr>
              <tr><td style="padding: 4px 12px; font-weight: bold;">Итальянское время:</td><td style="padding: 4px 12px;">${booking.consultation_time_italy}</td></tr>
            </table>
            <div style="margin-top: 12px; padding: 12px; background: #e8f5e9; border-radius: 8px; border: 1px solid #4caf50;">
              <p style="margin: 0;"><strong>Jitsi Meet:</strong> <a href="${booking.meet_link}" style="word-break: break-all;">${booking.meet_link}</a></p>
            </div>
          </div>
        `;
        await sendEmail(
          ADMIN_EMAIL,
          `⏰ Консультация через 30 мин: ${booking.full_name} — ${booking.consultation_time_italy} IT`,
          adminHtml,
          booking.student_email
        );

        // Mark reminder as sent
        const { error: updateError } = await supabase
          .from("consultation_bookings")
          .update({ reminder_sent: true })
          .eq("id", booking.id);

        if (updateError) {
          console.error(`Failed to mark reminder_sent for ${booking.id}:`, updateError.message);
        } else {
          sentCount++;
          console.log(`Reminder sent for booking ${booking.id} (${booking.full_name})`);
        }
      } catch (err) {
        console.error(`Failed to send reminder for booking ${booking.id}:`, err.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        reminders_sent: sentCount,
        total_checked: upcoming.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error:", err.message);
    return new Response(
      JSON.stringify({ success: false, message: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
