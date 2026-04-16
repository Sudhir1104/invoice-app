import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});

const PRICE_IDS: Record<string, string> = {
  founding_monthly: Deno.env.get('STRIPE_FOUNDING_MONTHLY_PRICE_ID')!,
  founding_yearly:  Deno.env.get('STRIPE_FOUNDING_YEARLY_PRICE_ID')!,
  starter_monthly:  Deno.env.get('STRIPE_STARTER_MONTHLY_PRICE_ID')!,
  starter_yearly:   Deno.env.get('STRIPE_STARTER_YEARLY_PRICE_ID')!,
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get the authenticated user from Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { plan, interval, success_url, cancel_url } = await req.json();

    // Determine price key
    const priceKey = `${plan}_${interval}`; // e.g. founding_monthly
    const priceId = PRICE_IDS[priceKey];

    if (!priceId) {
      return new Response(JSON.stringify({ error: `Invalid plan: ${priceKey}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Use service role to check/update tenant data
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get the tenant for this user
    const { data: member } = await supabaseAdmin
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .single();

    if (!member) {
      return new Response(JSON.stringify({ error: 'No tenant found for user' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // If founding plan — check slots available
    if (plan === 'founding') {
      const { data: status } = await supabaseAdmin.rpc('get_founding_status');
      if (!status?.available) {
        return new Response(JSON.stringify({
          error: 'founding_full',
          message: 'All founding member spots are taken. Please choose the standard Starter plan.'
        }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Get or create Stripe customer
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('stripe_customer_id, name')
      .eq('id', member.tenant_id)
      .single();

    let customerId = tenant?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: tenant?.name || user.email,
        metadata: {
          tenant_id: member.tenant_id,
          user_id: user.id,
        },
      });
      customerId = customer.id;

      // Save customer ID to tenant
      await supabaseAdmin
        .from('tenants')
        .update({ stripe_customer_id: customerId })
        .eq('id', member.tenant_id);
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 30,
        metadata: {
          tenant_id: member.tenant_id,
          plan: plan,
          interval: interval,
        },
      },
      success_url: success_url || `${req.headers.get('origin')}/app?checkout=success`,
      cancel_url: cancel_url || `${req.headers.get('origin')}/pricing.html?checkout=cancelled`,
      metadata: {
        tenant_id: member.tenant_id,
        plan: plan,
        interval: interval,
      },
    });

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Checkout error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
