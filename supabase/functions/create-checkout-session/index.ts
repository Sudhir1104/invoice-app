import Stripe from 'https://esm.sh/stripe@13.3.0?target=deno&no-check';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});

const PRICE_IDS: Record<string, string> = {
  founding_monthly: Deno.env.get('STRIPE_FOUNDING_MONTHLY_PRICE_ID') || '',
  founding_yearly:  Deno.env.get('STRIPE_FOUNDING_YEARLY_PRICE_ID') || '',
  starter_monthly:  Deno.env.get('STRIPE_STARTER_MONTHLY_PRICE_ID') || '',
  starter_yearly:   Deno.env.get('STRIPE_STARTER_YEARLY_PRICE_ID') || '',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse the JWT from Authorization header to get user_id
    // We decode it manually to avoid SUPABASE_ANON_KEY dependency
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return new Response(JSON.stringify({ error: 'No token provided' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Decode JWT payload (base64) to get user id
    let userId: string;
    try {
      const parts = token.split('.');
      const payload = JSON.parse(atob(parts[1]));
      userId = payload.sub;
      if (!userId) throw new Error('No sub in JWT');
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create admin supabase client to query DB
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { plan, interval, success_url, cancel_url } = await req.json();

    // Get tenant for this user
    const { data: member } = await supabaseAdmin
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', userId)
      .eq('role', 'owner')
      .maybeSingle();

    const tenantId = member?.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'No tenant found for user' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Determine price
    const priceKey = `${plan}_${interval}`;
    const priceId = PRICE_IDS[priceKey];
    if (!priceId) {
      return new Response(JSON.stringify({ error: `Invalid plan: ${priceKey}. Available: ${Object.keys(PRICE_IDS).join(', ')}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get or create Stripe customer
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('stripe_customer_id, email, name')
      .eq('id', tenantId)
      .single();

    let customerId = tenant?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: tenant?.email || '',
        name: tenant?.name || '',
        metadata: { tenant_id: tenantId, user_id: userId },
      });
      customerId = customer.id;
      await supabaseAdmin.from('tenants').update({ stripe_customer_id: customerId }).eq('id', tenantId);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 30,
        metadata: { tenant_id: tenantId, plan, interval },
      },
      success_url: success_url || `${req.headers.get('origin')}/?checkout=success`,
      cancel_url: cancel_url || `${req.headers.get('origin')}/pricing.html`,
      metadata: { tenant_id: tenantId, plan, interval },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Checkout error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});