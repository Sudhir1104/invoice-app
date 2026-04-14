// Vercel Serverless Function — Stripe Webhook Handler
// POST /api/stripe-webhook
// Handles: checkout.session.completed, customer.subscription.deleted, customer.subscription.updated

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Plan mapping from Stripe price IDs to Supabase plan names
const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_FOUNDING_MONTHLY]: 'starter',
  [process.env.STRIPE_PRICE_FOUNDING_YEARLY]:  'starter',
  [process.env.STRIPE_PRICE_GROWTH_MONTHLY]:   'growth',
  [process.env.STRIPE_PRICE_GROWTH_YEARLY]:    'growth',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {

      // ✅ Payment succeeded — upgrade plan
      case 'checkout.session.completed': {
        const session = event.data.object;
        const tenantId = session.metadata?.tenantId;
        const planName = session.metadata?.planName;

        if (tenantId && planName) {
          await supabase
            .from('tenants')
            .update({
              plan: planName,
              stripe_subscription_id: session.subscription,
              plan_updated_at: new Date().toISOString(),
            })
            .eq('id', tenantId);

          console.log(`✅ Upgraded tenant ${tenantId} to ${planName}`);
        }
        break;
      }

      // ✅ Subscription updated (e.g. plan change)
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const tenantId = subscription.metadata?.tenantId;
        const priceId = subscription.items.data[0]?.price?.id;
        const planName = PRICE_TO_PLAN[priceId];
        const status = subscription.status;

        if (tenantId) {
          const updateData = { stripe_subscription_status: status };
          if (planName) updateData.plan = planName;

          await supabase
            .from('tenants')
            .update(updateData)
            .eq('id', tenantId);

          console.log(`✅ Updated tenant ${tenantId} subscription: ${status}`);
        }
        break;
      }

      // ❌ Subscription cancelled — downgrade to free/trial
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const tenantId = subscription.metadata?.tenantId;

        if (tenantId) {
          await supabase
            .from('tenants')
            .update({
              plan: 'trial',
              stripe_subscription_id: null,
              stripe_subscription_status: 'cancelled',
              plan_updated_at: new Date().toISOString(),
            })
            .eq('id', tenantId);

          console.log(`❌ Cancelled subscription for tenant ${tenantId}`);
        }
        break;
      }

      // ⚠️ Payment failed
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        const { data: tenant } = await supabase
          .from('tenants')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (tenant) {
          await supabase
            .from('tenants')
            .update({ stripe_subscription_status: 'past_due' })
            .eq('id', tenant.id);

          console.log(`⚠️ Payment failed for tenant ${tenant.id}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event: ${event.type}`);
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
