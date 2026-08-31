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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      },
    });
  }

  try {
    // Extract token and action from query string (GET) or body (POST)
    let token = "";
    let action = "confirm";
    const url = new URL(req.url);
    if (req.method === "GET") {
      token = url.searchParams.get("token") || "";
      action = url.searchParams.get("action") || "confirm";
    } else {
      const body = await req.json();
      token = body.token || "";
      action = body.action || "confirm";
    }

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing confirmation token" }),
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

    // Find the booking with this token
    const { data: booking, error: queryError } = await supabase
      .from("consultation_bookings")
      .select("*")
      .eq("confirmation_token", token)
      .single();

    if (queryError || !booking) {
      return new Response(
        JSON.stringify({ success: false, message: "Invalid or expired confirmation link" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // Check if already confirmed
    if (booking.status === "confirmed") {
      // If student is rejecting an already-confirmed booking, allow it
      if (action === "reject") {
        const { error: cancelError } = await supabase
          .from("consultation_bookings")
          .update({ status: "cancelled" })
          .eq("id", booking.id);

        if (cancelError) {
          return new Response(
            JSON.stringify({ success: false, message: "Failed to cancel booking" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            }
          );
        }

        // Notify admin about cancellation
        const adminCancelHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f44336;">❌ Студент отменил подтверждённую консультацию</h2>
            <table style="border-collapse: collapse; margin: 16px 0;">
              <tr><td style="padding: 4px 12px; font-weight: bold;">Имя:</td><td style="padding: 4px 12px;">${booking.full_name}</td></tr>
              <tr><td style="padding: 4px 12px; font-weight: bold;">Email:</td><td style="padding: 4px 12px;">${booking.student_email}</td></tr>
              <tr><td style="padding: 4px 12px; font-weight: bold;">Дата:</td><td style="padding: 4px 12px;">${booking.consultation_date}</td></tr>
              <tr><td style="padding: 4px 12px; font-weight: bold;">Итальянское время:</td><td style="padding: 4px 12px;">${booking.consultation_time_italy}</td></tr>
              <tr><td style="padding: 4px 12px; font-weight: bold;">Статус:</td><td style="padding: 4px 12px; color: #f44336;">Отменено студентом (было подтверждено)</td></tr>
            </table>
          </div>
        `;
        await sendEmail(
          ADMIN_EMAIL,
          `❌ Консультация отменена: ${booking.full_name} — ${booking.consultation_date}`,
          adminCancelHtml,
          booking.student_email
        );

        return new Response(
          JSON.stringify({
            success: true,
            message: "Booking cancelled",
            name: booking.full_name,
            consultation_date: booking.consultation_date,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "already_confirmed",
          meet_link: booking.meet_link,
          name: booking.full_name,
          consultation_date: booking.consultation_date,
          consultation_time_local: booking.consultation_time_local,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // Check if booking is still pending (not expired/cancelled)
    if (booking.status !== "pending") {
      return new Response(
        JSON.stringify({ success: false, message: "Booking is no longer pending" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // Check if confirmation link has expired (24 hours)
    const createdAt = new Date(booking.created_at);
    const now = new Date();
    const hoursSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreation > 24) {
      // Mark as expired
      await supabase
        .from("consultation_bookings")
        .update({ status: "expired" })
        .eq("id", booking.id);

      return new Response(
        JSON.stringify({ success: false, message: "Confirmation link has expired. Please book again." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // ─── REJECT action: student cancels the booking ───
    if (action === "reject") {
      const { error: cancelError } = await supabase
        .from("consultation_bookings")
        .update({ status: "cancelled" })
        .eq("id", booking.id);

      if (cancelError) {
        console.error("Cancel error:", cancelError.message);
        return new Response(
          JSON.stringify({ success: false, message: "Failed to cancel booking" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          }
        );
      }

      // Send cancellation notification to admin (in Russian)
      const adminCancelHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f44336;">❌ Студент отменил консультацию</h2>
          <table style="border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 4px 12px; font-weight: bold;">Имя:</td><td style="padding: 4px 12px;">${booking.full_name}</td></tr>
            <tr><td style="padding: 4px 12px; font-weight: bold;">Email:</td><td style="padding: 4px 12px;">${booking.student_email}</td></tr>
            <tr><td style="padding: 4px 12px; font-weight: bold;">Дата:</td><td style="padding: 4px 12px;">${booking.consultation_date}</td></tr>
            <tr><td style="padding: 4px 12px; font-weight: bold;">Итальянское время:</td><td style="padding: 4px 12px;">${booking.consultation_time_italy}</td></tr>
            <tr><td style="padding: 4px 12px; font-weight: bold;">Статус:</td><td style="padding: 4px 12px; color: #f44336;">Отменено студентом</td></tr>
          </table>
          <p style="color: #888; font-size: 13px;">Студент нажал кнопку «Отменить» в письме подтверждения.</p>
        </div>
      `;
      await sendEmail(
        ADMIN_EMAIL,
        `❌ Консультация отменена: ${booking.full_name} — ${booking.consultation_date}`,
        adminCancelHtml,
        booking.student_email
      );

      return new Response(
        JSON.stringify({
          success: true,
          message: "Booking cancelled",
          name: booking.full_name,
          consultation_date: booking.consultation_date,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // ─── CONFIRM action (default) ───
    // Confirm the booking
    const { error: updateError } = await supabase
      .from("consultation_bookings")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", booking.id);

    if (updateError) {
      console.error("Update error:", updateError.message);
      return new Response(
        JSON.stringify({ success: false, message: "Failed to confirm booking" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // ─── Send confirmed email to student (in Russian) ───
    const studentHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a73e8;">✅ Ваша консультация подтверждена!</h2>
        <p>Здравствуйте, ${booking.full_name}!</p>
        <p>Ваша бесплатная консультация с EuroPath Education подтверждена.</p>
        <table style="border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 4px 12px; font-weight: bold;">Дата:</td><td style="padding: 4px 12px;">${booking.consultation_date}</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Ваше локальное время:</td><td style="padding: 4px 12px;">${booking.consultation_time_local} (${booking.consultation_time_local_tz})</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Итальянское время:</td><td style="padding: 4px 12px;">${booking.consultation_time_italy} (Europe/Rome)</td></tr>
        </table>
        <div style="margin-top: 16px; padding: 16px; background: #e8f5e9; border-radius: 8px; border: 1px solid #4caf50;">
          <p style="margin: 0 0 8px; font-weight: bold; font-size: 15px;">🎥 Ссылка на видеозвонок (Jitsi Meet):</p>
          <p style="margin: 0;"><a href="${booking.meet_link}" style="color: #1a73e8; font-size: 15px; word-break: break-all;">${booking.meet_link}</a></p>
          <p style="margin: 8px 0 0; font-size: 12px; color: #666;">Просто нажмите на ссылку за 5 минут до начала. Работает в браузере — установка не нужна.</p>
        </div>
        <p style="margin-top: 16px;">Ждём встречи с вами!</p>
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
      `✅ Консультация подтверждена — ${booking.consultation_date} в ${booking.consultation_time_local}`,
      studentHtml,
      ADMIN_EMAIL
    );

    // ─── Send confirmed notification to admin (in Russian) ───
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a73e8;">✅ Консультация подтверждена студентом</h2>
        <table style="border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 4px 12px; font-weight: bold;">Имя:</td><td style="padding: 4px 12px;">${booking.full_name}</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Email:</td><td style="padding: 4px 12px;">${booking.student_email}</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Дата:</td><td style="padding: 4px 12px;">${booking.consultation_date}</td></tr>
          <tr><td style="padding: 4px 12px; font-weight: bold;">Итальянское время:</td><td style="padding: 4px 12px;">${booking.consultation_time_italy}</td></tr>
        </table>
        <div style="margin-top: 12px; padding: 12px; background: #e8f5e9; border-radius: 8px; border: 1px solid #4caf50;">
          <p style="margin: 0;"><strong>Jitsi Meet:</strong> <a href="${booking.meet_link}" style="word-break: break-all;">${booking.meet_link}</a></p>
        </div>
      </div>
    `;
    await sendEmail(
      ADMIN_EMAIL,
      `✅ Консультация подтверждена: ${booking.full_name} — ${booking.consultation_date} в ${booking.consultation_time_italy} IT`,
      adminHtml,
      booking.student_email
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: "Consultation confirmed successfully",
        meet_link: booking.meet_link,
        name: booking.full_name,
        consultation_date: booking.consultation_date,
        consultation_time_local: booking.consultation_time_local,
        consultation_time_italy: booking.consultation_time_italy,
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
