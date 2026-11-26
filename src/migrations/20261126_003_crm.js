// Team Portal CRM: how Rhinowinks manages HollaTap customers, leads, deals and messages.
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('staff_role', 20); // owner | sales | support (is_admin users are owners)
    t.boolean('is_demo').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('payments', (t) => { t.boolean('is_demo').notNullable().defaultTo(false); });
  await knex.schema.alterTable('nfc_orders', (t) => { t.boolean('is_demo').notNullable().defaultTo(false); t.text('notes'); });
  await knex.schema.alterTable('enquiries', (t) => { t.boolean('is_demo').notNullable().defaultTo(false); });
  await knex.schema.alterTable('commissions', (t) => { t.boolean('is_demo').notNullable().defaultTo(false); });

  await knex.schema.createTable('crm_contacts', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unique();
    t.integer('enquiry_id');
    t.string('name', 160).notNullable();
    t.string('company', 160);
    t.string('job_title', 120);
    t.string('email', 254).index();
    t.string('phone', 40).index();
    t.string('city', 80);
    t.string('industry', 60);
    t.string('source', 40).notNullable().defaultTo('manual'); // signup | enquiry | enterprise | manual | import | ads | whatsapp | referral | event
    t.string('stage', 20).notNullable().defaultTo('new'); // new | contacted | warm | customer | lost
    t.integer('owner_id').index();
    t.string('tags', 500).notNullable().defaultTo('');
    t.string('birthday', 5); // MM-DD
    t.boolean('sms_ok').notNullable().defaultTo(false);
    t.boolean('email_ok').notNullable().defaultTo(false);
    t.timestamp('last_contacted_at');
    t.boolean('is_demo').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('crm_deals', (t) => {
    t.increments('id').primary();
    t.integer('contact_id').notNullable().index();
    t.string('title', 160).notNullable();
    t.string('product', 60).notNullable();
    t.integer('value_naira').notNullable().defaultTo(0);
    t.string('stage', 20).notNullable().defaultTo('new'); // new | contacted | demo | proposal | won | lost
    t.string('lost_reason', 120);
    t.string('expected_month', 7); // YYYY-MM
    t.integer('owner_id').index();
    t.timestamp('closed_at');
    t.boolean('is_demo').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('crm_activities', (t) => {
    t.increments('id').primary();
    t.integer('contact_id').index();
    t.integer('deal_id').index();
    t.integer('staff_id').index();
    t.string('type', 20).notNullable(); // call | email | sms | whatsapp | visit | meeting | social | note | stage | system
    t.text('summary');
    t.boolean('is_demo').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('crm_tasks', (t) => {
    t.increments('id').primary();
    t.string('title', 200).notNullable();
    t.integer('contact_id').index();
    t.integer('deal_id');
    t.integer('assignee_id').index();
    t.integer('created_by');
    t.timestamp('due_at');
    t.timestamp('done_at');
    t.boolean('is_demo').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('crm_campaigns', (t) => {
    t.increments('id').primary();
    t.string('name', 160).notNullable();
    t.string('channel', 10).notNullable(); // sms | email
    t.text('segment_json');
    t.string('subject', 200);
    t.text('body').notNullable();
    t.string('status', 20).notNullable().defaultTo('draft'); // draft | sending | sent
    t.integer('sent_count').notNullable().defaultTo(0);
    t.integer('failed_count').notNullable().defaultTo(0);
    t.integer('created_by');
    t.timestamp('sent_at');
    t.boolean('is_demo').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('crm_messages', (t) => {
    t.increments('id').primary();
    t.string('channel', 10).notNullable(); // sms | email
    t.string('to', 254).notNullable();
    t.integer('contact_id').index();
    t.integer('campaign_id').index();
    t.integer('staff_id');
    t.string('subject', 200);
    t.text('body');
    t.string('kind', 20).notNullable().defaultTo('manual'); // manual | campaign | birthday | occasion | auto
    t.string('status', 20).notNullable().defaultTo('sent'); // sent | simulated | failed
    t.string('provider_ref', 120);
    t.string('error', 300);
    t.boolean('is_demo').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('crm_occasions', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.string('date', 5); // MM-DD; null = each contact's birthday
    t.boolean('is_birthday').notNullable().defaultTo(false);
    t.string('channel', 10).notNullable().defaultTo('sms'); // sms | email | both
    t.string('subject', 200);
    t.text('body').notNullable();
    t.boolean('auto').notNullable().defaultTo(false);
    t.string('audience', 20).notNullable().defaultTo('all'); // all | customers | leads
    t.integer('last_sent_year');
    t.timestamps(true, true);
  });
  await knex.schema.createTable('crm_templates', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.string('channel', 10).notNullable(); // sms | email | whatsapp
    t.string('subject', 200);
    t.text('body').notNullable();
    t.timestamps(true, true);
  });
  await knex.schema.createTable('crm_settings', (t) => {
    t.string('key', 60).primary();
    t.text('value');
  });
};

exports.down = async function (knex) {
  for (const t of ['crm_settings', 'crm_templates', 'crm_occasions', 'crm_messages', 'crm_campaigns', 'crm_tasks', 'crm_activities', 'crm_deals', 'crm_contacts']) await knex.schema.dropTableIfExists(t);
  await knex.schema.alterTable('users', (t) => { t.dropColumn('staff_role'); t.dropColumn('is_demo'); });
  for (const tb of ['payments', 'enquiries', 'commissions']) await knex.schema.alterTable(tb, (t) => t.dropColumn('is_demo'));
  await knex.schema.alterTable('nfc_orders', (t) => { t.dropColumn('is_demo'); t.dropColumn('notes'); });
};
