import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get tenant for this user
    const { data: member } = await supabaseAdmin
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .single();

    if (!member) {
      return new Response(JSON.stringify({ error: 'No tenant found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get stripe_customer_id from tenant
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('stripe_customer_id')
      .eq('id', member.tenant_id)
      .single();

    if (!tenant?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'No Stripe customer found. Please subscribe first.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { return_url } = await req.json().catch(() => ({}));

    // Create Stripe customer portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: return_url || 'https://invoice.bluesquaresolutions.com.au/app',
    });

    return new Response(JSON.stringify({ url: portalSession.url }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Customer portal error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
