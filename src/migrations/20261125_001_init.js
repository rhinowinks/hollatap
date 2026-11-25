exports.up = async function (knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('email', 254).notNullable().unique();
    t.string('name', 120);
    t.string('industry', 60);
    t.boolean('marketing_opt_in').notNullable().defaultTo(false);
    t.string('plan', 20).notNullable().defaultTo('free'); // free | pro | team
    t.timestamp('plan_expires_at');
    t.timestamp('trial_ends_at');
    t.boolean('founding_member').notNullable().defaultTo(false);
    t.integer('team_id');
    t.string('team_role', 20); // admin | member
    t.string('ref_code', 16).unique();
    t.integer('referred_by');
    t.boolean('is_affiliate').notNullable().defaultTo(false);
    t.string('affiliate_bank', 255);
    t.integer('credit_naira').notNullable().defaultTo(0);
    t.boolean('is_admin').notNullable().defaultTo(false);
    t.timestamp('last_seen_at');
    t.timestamp('deletion_warned_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('login_codes', (t) => {
    t.increments('id').primary();
    t.string('email', 254).notNullable().index();
    t.string('code_hash', 128).notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('expires_at').notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('teams', (t) => {
    t.increments('id').primary();
    t.string('name', 160).notNullable();
    t.string('email_domain', 120).index();
    t.integer('owner_id').notNullable();
    t.integer('seats').notNullable().defaultTo(0);
    t.timestamp('paid_until');
    t.boolean('verified').notNullable().defaultTo(false);
    t.string('template', 20).notNullable().defaultTo('classic');
    t.string('accent', 9).notNullable().defaultTo('#0F1B2D');
    t.binary('logo');
    t.string('logo_type', 40);
    t.string('website', 255);
    t.string('address', 255);
    t.string('phone', 40);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('cards', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().index();
    t.integer('team_id').index();
    t.string('slug', 64).notNullable().unique();
    t.string('full_name', 120).notNullable();
    t.string('job_title', 120);
    t.string('company', 160);
    t.string('phone', 40);
    t.string('whatsapp', 40);
    t.string('email', 254);
    t.string('website', 255);
    t.string('address', 255);
    t.text('bio');
    t.text('links_json'); // [{label,url}]
    t.string('template', 20).notNullable().defaultTo('classic');
    t.string('accent', 9).notNullable().defaultTo('#0F1B2D');
    t.binary('logo');
    t.string('logo_type', 40);
    t.string('mode', 20).notNullable().defaultTo('profile'); // profile|review|menu|whatsapp|booking
    t.string('mode_url', 500);
    t.boolean('footer_removed').notNullable().defaultTo(false);
    t.timestamp('footer_paid_until');
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('views').notNullable().defaultTo(0);
    t.integer('saves').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('leads', (t) => {
    t.increments('id').primary();
    t.integer('card_id').notNullable().index();
    t.string('name', 120).notNullable();
    t.string('email', 254);
    t.string('phone', 40);
    t.string('company', 160);
    t.text('message');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('payments', (t) => {
    t.increments('id').primary();
    t.string('reference', 80).notNullable().unique();
    t.integer('user_id').notNullable().index();
    t.string('kind', 30).notNullable(); // pro | footer | team | nfc | nfc_replacement
    t.integer('quantity').notNullable().defaultTo(1);
    t.integer('target_id'); // card id for footer, team id for team
    t.integer('amount_naira').notNullable();
    t.integer('credit_used').notNullable().defaultTo(0);
    t.integer('discount_naira').notNullable().defaultTo(0);
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | success | failed
    t.text('meta_json');
    t.timestamp('paid_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('commissions', (t) => {
    t.increments('id').primary();
    t.integer('affiliate_id').notNullable().index();
    t.integer('payment_id').notNullable().unique();
    t.integer('rate_pct').notNullable();
    t.integer('amount_naira').notNullable();
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | payable | paid | void
    t.timestamp('payable_at');
    t.timestamp('paid_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('promos', (t) => {
    t.increments('id').primary();
    t.string('title', 120).notNullable();
    t.string('body', 300);
    t.string('cta', 40).notNullable().defaultTo('Learn more');
    t.string('url', 500).notNullable();
    t.string('industry', 60); // null = everyone
    t.string('slot', 20).notNullable().defaultTo('any'); // any | created | dashboard
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('impressions').notNullable().defaultTo(0);
    t.integer('clicks').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('enquiries', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.string('product', 60).notNullable();
    t.string('name', 120).notNullable();
    t.string('email', 254).notNullable();
    t.string('phone', 40);
    t.string('company', 160);
    t.text('message');
    t.string('status', 20).notNullable().defaultTo('new');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('nfc_tags', (t) => {
    t.increments('id').primary();
    t.string('code', 16).notNullable().unique();
    t.string('batch', 40);
    t.integer('card_id');
    t.integer('team_id');
    t.timestamp('claimed_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('nfc_orders', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.integer('team_id');
    t.integer('quantity').notNullable();
    t.string('kind', 20).notNullable().defaultTo('paid'); // paid | included | replacement
    t.string('ship_name', 120);
    t.string('ship_phone', 40);
    t.text('ship_address');
    t.string('status', 20).notNullable().defaultTo('new'); // new | dispatched | delivered
    t.integer('payment_id');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('invites', (t) => {
    t.increments('id').primary();
    t.integer('team_id').notNullable().index();
    t.string('email', 254).notNullable();
    t.string('full_name', 120);
    t.string('job_title', 120);
    t.string('phone', 40);
    t.string('token', 64).notNullable().unique();
    t.timestamp('accepted_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('audit', (t) => {
    t.increments('id').primary();
    t.string('event', 60).notNullable();
    t.integer('user_id');
    t.text('detail');
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  for (const tb of ['audit', 'invites', 'nfc_orders', 'nfc_tags', 'enquiries', 'promos', 'commissions', 'payments', 'leads', 'cards', 'teams', 'login_codes', 'users']) {
    await knex.schema.dropTableIfExists(tb);
  }
};
