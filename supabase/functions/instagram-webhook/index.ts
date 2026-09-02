// Instagram Messaging Webhook Handler
// Receives DM events from Instagram, stores in DB, auto-replies to leads

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const VERIFY_TOKEN = Deno.env.get('INSTAGRAM_WEBHOOK_VERIFY_TOKEN') || 'euro-path-ig-webhook-2026'

// Auto-reply templates (customize these)
const AUTO_REPLY = {
  default: '👋 Привет! Спасибо за сообщение.\n\nЯ — Анар, помогаю студентам из Казахстана поступить в университеты Италии бесплатно (DSU стипендия).\n\nНапиши «ИТАЛИЯ» — я отправлю список программ на 2026/27.',
  italy: '🇮🇹 Список программ (DSU стипендия):\n\n• Sapienza (Рим) — экономика, медицина\n• Bologna — юриспруденция, архитектура\n• Politecnico Milano — инженерия\n• Padova — медицина, психология\n• Turin — инженерия, дизайн\n\nПодробности: europatheducation.eu\n\nУдачи! 🎓',
  help: '💡 Вот что я могу:\n\n1. Напиши «ИТАЛИЯ» — список программ\n2. Напиши «СТУПЕНДИЯ» — про DSU\n3. Любой вопрос — отвечу лично\n\n📩 direct me anytime!',
}

// Helper: detect keyword in message
function detectKeyword(text: string): string | null {
  const lower = text.toLowerCase()
  if (lower.includes('италия') || lower.includes('italy')) return 'italy'
  if (lower.includes('помощь') || lower.includes('help')) return 'help'
  return null
}

// Helper: get page access token from DB
async function getPageToken(supabase: any): Promise<string> {
  const { data } = await supabase
    .from('social_tokens')
    .select('token_value')
    .eq('token_name', 'META_PAGE_ACCESS_TOKEN')
    .single()
  return data?.token_value || ''
}

// Helper: send message via Instagram Messaging API
async function sendInstagramMessage(igUserId: string, text: string, pageToken: string): Promise<boolean> {
  const PAGE_ID = '104201397963733' // Your FB Page ID
  const url = `https://graph.facebook.com/v19.0/${PAGE_ID}/messages`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pageToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: igUserId },
        message: { text },
      }),
    })

    const data = await response.json()
    if (data.error) {
      console.error('Instagram API error:', data.error)
      return false
    }
    return true
  } catch (error) {
    console.error('Send message error:', error)
    return false
  }
}

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // === WEBHOOK VERIFICATION (GET) ===
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified')
      return new Response(challenge, { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  // === WEBHOOK EVENT (POST) ===
  if (req.method === 'POST') {
    try {
      const body = await req.json()

      // Instagram sends X-Hub-Signature for verification (optional, add later)
      console.log('Webhook received:', JSON.stringify(body, null, 2))

      // Check if this is a messaging event
      const entry = body.entry?.[0]
      if (!entry) return new Response('OK', { status: 200 })

      const messaging = entry.messaging?.[0]
      if (!messaging) return new Response('OK', { status: 200 })

      // Extract message data
      const igUserId = messaging.sender?.id
      const message = messaging.message
      if (!igUserId || !message) return new Response('OK', { status: 200 })

      const igMessageId = message.mid
      const messageText = message.text || '[non-text message]'

      console.log(`DM from ${igUserId}: ${messageText}`)

      // Store in database
      const { error: insertError } = await supabase.from('instagram_dms').insert({
        ig_id: igMessageId,
        ig_user_id: igUserId,
        ig_username: null, // Can fetch via API if needed
        message_text: messageText,
        direction: 'received',
        is_read: false,
        is_lead: true, // All DMs are potential leads
        lead_status: 'new',
        metadata: { raw: messaging },
      })

      if (insertError) {
        console.error('DB insert error:', insertError)
        // Don't fail the webhook, log only
      }

      // === AUTO-REPLY LOGIC ===
      const keyword = detectKeyword(messageText)
      const replyText = keyword ? AUTO_REPLY[keyword] : AUTO_REPLY.default

      const pageToken = await getPageToken(supabase)
      if (pageToken) {
        const sent = await sendInstagramMessage(igUserId, replyText, pageToken)
        if (sent) {
          console.log(`Auto-replied to ${igUserId}`)
          // Store the reply
          await supabase.from('instagram_dms').insert({
            ig_id: `reply_${igMessageId}`,
            ig_user_id: igUserId,
            message_text: replyText,
            direction: 'sent',
            is_read: true,
            metadata: { auto_reply: true, trigger_keyword: keyword },
          })
        }
      } else {
        console.error('No page token, cannot auto-reply')
      }

      return new Response('OK', { status: 200 })
    } catch (error) {
      console.error('Webhook error:', error)
      return new Response('Error', { status: 500 })
    }
  }

  return new Response('Method not allowed', { status: 405 })
})
