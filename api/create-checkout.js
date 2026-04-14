// Vercel Serverless Function — Create Stripe Checkout Session
// POST /api/create-checkout
// Body: { priceId, tenantId, email, billingPeriod }

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { priceId, tenantId, email, planName } = req.body;

    if (!priceId || !tenantId || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if tenant already has a Stripe customer
    const { data: tenant } = await supabase
      .from('tenants')
      .select('stripe_customer_id, plan')
      .eq('id', tenantId)
      .single();

    let customerId = tenant?.stripe_customer_id;

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { tenantId, planName }
      });
      customerId = customer.id;

      // Save customer ID to Supabase
      await supabase
        .from('tenants')
        .update({ stripe_customer_id: customerId })
        .eq('id', tenantId);
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.APP_URL}/?checkout=success&plan=${planName}`,
      cancel_url: `${process.env.APP_URL}/pricing.html?checkout=cancelled`,
      subscription_data: {
        metadata: { tenantId, planName }
      },
      metadata: { tenantId, planName },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
};
