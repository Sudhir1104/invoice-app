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

  const signature = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
  const body = await req.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature!, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  console.log('Webhook event received:', event.type);

  try {
    switch (event.type) {

      // ── Checkout completed → trial started ──
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenant_id;
        const plan = session.metadata?.plan;
        const interval = session.metadata?.interval;

        if (!tenantId) break;

        // Get card fingerprint to prevent trial abuse
        let cardFingerprint: string | null = null;
        if (session.payment_intent) {
          try {
            const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string);
            if (pi.payment_method) {
              const pm = await stripe.paymentMethods.retrieve(pi.payment_method as string);
              cardFingerprint = pm.card?.fingerprint || null;
            }
          } catch (_) { /* card fingerprint is best-effort */ }
        }

        // Get subscription to find trial end date
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const trialEnd = subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null;

        // Update tenant with plan info
        await supabase
          .from('tenants')
          .update({
            plan: plan === 'founding' ? 'founding_starter' : 'starter',
            plan_interval: interval,
            stripe_customer_id: session.customer as string,
            stripe_card_fingerprint: cardFingerprint,
            had_trial: true,
            trial_ends_at: trialEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tenantId);

        // If founding plan — claim the slot
        if (plan === 'founding') {
          const { data: claimResult } = await supabase.rpc('claim_founding_slot', {
            p_tenant_id: tenantId
          });
          console.log('Founding slot claim result:', claimResult);

          // Log when we hit 50
          if (claimResult?.slots_remaining === 0) {
            console.log('🎉 All 50 founding member slots are now taken!');
          }
        }

        console.log(`Tenant ${tenantId} upgraded to ${plan} ${interval}`);
        break;
      }

      // ── Subscription active (trial ended, payment taken) ──
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenant_id;

        if (!tenantId) break;

        const status = subscription.status; // active, past_due, canceled, etc.
        const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

        await supabase
          .from('tenants')
          .update({
            subscription_ends_at: currentPeriodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tenantId);

        console.log(`Subscription updated for tenant ${tenantId}: ${status}`);
        break;
      }

      // ── Subscription cancelled ──
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenant_id;

        if (!tenantId) break;

        // Downgrade to free plan
        await supabase
          .from('tenants')
          .update({
            plan: 'free',
            plan_interval: null,
            subscription_ends_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tenantId);

        console.log(`Tenant ${tenantId} downgraded to free (subscription cancelled)`);
        break;
      }

      // ── Payment failed ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        // Find tenant by stripe_customer_id
        const { data: tenant } = await supabase
          .from('tenants')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (tenant) {
          // You could send an email here via Resend
          // For now just log it
          console.log(`Payment failed for tenant ${tenant.id}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
